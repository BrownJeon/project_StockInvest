/**
 * T-143 WP-A — 월간 산출 엔진(관문·단계·예산). 라우트는 이 함수 하나를 부른다.
 *
 * 정본: `docs/design/2026-11-01-t143-wpa-nyse50-spec.md` §3·§4.
 *
 * ## 왜 한 번에 끝내지 않나
 * 후보가 2,763개(마스터 필터 뒤 실측 1,964 + DR 70)이고 KIS 현재가상세는 실측 0.46~0.93초/건이다 →
 * 직렬 15~43분. 러너의 하트비트 상한(300초)에 **어떤 경우도 한 번에 들어가지 않는다.**
 * 그래서 호출 1회가 **100초 예산 안에서 한 단계만** 처리하고 커서를 저장하고 돌아간다(`daily-bars` 와 같은 방식).
 * 러너는 창(첫째 일요일 01:10~05:50 KST) 안에서 매 틱 다시 부르고, 응답의 `final` 만 본다.
 *
 * ## 외부 호출은 세 가지뿐이고 전부 읽기다
 *  1. SEC 상장 목록 1회(`listing`) — 선언 User-Agent 없으면 아예 부르지 않는다.
 *  2. KIS 종목 마스터 zip 1회(`listing`) — 정적 파일, API 키·토큰·초당 한도와 무관하다.
 *  3. KIS 해외 현재가상세 N회(`scan`·`retry`) — `bulk` lane, 동시성 2.
 * **주문·시그널을 만들지 않는다.** `src/lib/safety/**` 를 import 하지 않고 `orders`·`signals` 에 쓰지 않는다.
 */
import { createHash } from 'node:crypto';
import {
  SEC_COMPANY_TICKERS_EXCHANGE_URL, indexByCik, indexByTicker, internalSymbolFor, isNoncommonTicker,
  kisSymbolCandidates, looksLikeForeignIssuerName, noncommonSuffixOf, nyseRows, parseSecExchangeResponse,
  type SecListingRow,
} from './sec-listing';
import { isOverseasSymbol } from '@/lib/exchanges/kis-symbols';
import { classifyByMaster, type OverseasMasterFile } from './kis-overseas-master';
import { drVirtualRanks, rankCandidates, type RankInput } from './rank';
import { buildProposals, type ProposalDraft } from './proposal-rules';
import {
  advanceRun, applyScanOutcome, closeRun, createRun, finalizeRun, insertProposals, isTerminalPhase,
  readFinalizeRows, readPendingCandidates, readPrevTopSymbols, readProgress, readRecentSnapshotSymbols,
  readRetryCandidates, readRun, readSymbolCikMap, saveListing, type CandidateInsert, type CandidateVerdict,
  type RunPhase, type ScanOutcome, type ScanProgress,
} from './refresh-store';
import type { Queryable, TxConnection } from './store';

/** 한 호출의 작업 예산. 러너 curl 상한은 120초다(라우트 100 + 네트워크 여유). */
export const BUDGET_MS = 100_000;
/** 스캔 동시성 — 2. KIS 왕복 지연이 지배하므로 2면 약 2배이고, 4 이상은 5 req/s 벽에 닿아 이득이 없다. */
export const SCAN_CONCURRENCY = 2;
/** 한 청크에 집어오는 후보 수(예산이 남아도 이 수까지만 — 한 번에 수천 행을 메모리에 올리지 않는다). */
export const SCAN_CHUNK_ROWS = 400;
/** 제안 규칙 E·D 가 「KIS 조회가 되고 있나」를 볼 때의 최근 창(일). */
export const SNAPSHOT_LOOKBACK_DAYS = 3;

/** 한 종목의 KIS 현재가상세 원값(어댑터가 주는 값 중 이 작업이 쓰는 것만). */
export interface PriceDetailValues {
  tomv: number | null;
  shar: number | null;
  last: number | null;
  curr: string | null;
  etypNm: string | null;
  rsym: string | null;
}

export type FetchPriceOutcome =
  | { kind: 'ok'; values: PriceDetailValues }
  /** 판정 불가·빈 응답 — 상장폐지·거래정지·표기 불일치 중 하나다. 재시도하지 않는다. */
  | { kind: 'missing'; error: string }
  /** 유량(스로틀) — **그 자리에서 청크를 멈춘다**(증폭 방지). 그 종목은 `pending` 으로 남는다. */
  | { kind: 'throttled'; error: string }
  /** 네트워크·토큰 등 — `retry` 단계에서 한 번 더 본다. */
  | { kind: 'error'; error: string };

/** 엔진이 밖에서 받는 것 — 전부 주입이라 시험이 외부에 나가지 않는다. */
export interface RefreshDeps {
  db: Queryable;
  getConnection?: () => Promise<TxConnection>;
  nowMs: () => number;
  /** SEC 상장 목록. `null` = 선언 User-Agent 가 없다(부르지 않는다). */
  fetchSecListing: (() => Promise<{ json: unknown; sha256: string }>) | null;
  fetchMaster: () => Promise<OverseasMasterFile>;
  /** KIS 요청 표기(`BRK/B`)로 조회한다 — 내부 심볼이 아니다. */
  fetchPrice: (kisSymb: string) => Promise<FetchPriceOutcome>;
  /** 수동 목록(판독기와 같은 값 — 제안 규칙의 대상). */
  readManualList: () => Promise<string[]>;
  /** 내부 심볼 → SEC 티커(`toSecTicker`). */
  secTickerOf: (symbol: string) => string | null;
}

export interface RefreshConfig {
  topN: number;
  excludeDr: boolean;
}

export type RefreshStatus =
  | 'listing' | 'scan_partial' | 'scan_done' | 'retry_done' | 'complete'
  | 'failed' | 'expired' | 'tables_missing' | 'throttled';

export interface RefreshResult {
  ok: boolean;
  status: RefreshStatus;
  /** 「이달 더 부르지 마라」 — 러너는 이 값만 본다. */
  final: boolean;
  runId: number | null;
  runKey: string;
  phase: RunPhase | null;
  progress: ScanProgress | null;
  elapsedMs: number;
  lastError?: string;
  /** `complete` 일 때만 — 알림 조립의 입력. */
  /**
   * (M-2) 실패·만료의 **분류어**. `lastError` 는 사람이 읽는 문장이라 `job_run_log.error_code` 에 넣을 수 없다
   * (`codeWord` 가 `:`·공백을 거부한다) → 앞머리 식별자만 따로 낸다.
   */
  failCode?: string;
  /**
   * `complete` 일 때만 — 알림 조립의 입력.
   *
   * 🔴 `firstRun` 이 따로 있는 이유(high-2): 직전 complete run 이 없으면 **diff 가 없으므로** `added`·`removed` 는
   * 비는 것이 맞다. 그런데 「변화 0 = 침묵」 판정이 그 빈 값을 보고 **가장 크게 바뀌는 회차(0 → 상위 N)를
   * 유일하게 조용히** 만들었다 — L-A1(「자동 목록만 바뀌어도 알린다」)의 목적과 정면으로 어긋난다.
   * 그래서 1회차는 **「목록이 처음 만들어졌다」는 사건 자체**로 알리고, 그 입력으로 `top`(산출된 상위 N)을 함께 낸다.
   */
  changes?: { added: string[]; removed: string[]; proposalsCreated: number; firstRun: boolean; top: string[] };
}

/** `lastError` 의 앞머리 식별자만 — `insufficient_candidates:1/2` → `insufficient_candidates`. 없으면 undefined. */
export function failCodeOf(error: string): string | undefined {
  const m = /^[a-z][a-z0-9_]{0,47}/.exec(error.trim().toLowerCase());
  return m ? m[0] : undefined;
}

function emptyProgress(): ScanProgress {
  return { pending: 0, ok: 0, excluded: 0, kisMissing: 0, kisError: 0, total: 0 };
}

/**
 * 한 호출 = 한 단계. 관문은 라우트가 이미 통과시켰고(인증·스위치·휴장·창), 여기서는 **표·run 상태**만 본다.
 */
export async function runUniverseRefresh(
  deps: RefreshDeps,
  cfg: RefreshConfig,
  runKey: string,
): Promise<RefreshResult> {
  const t0 = deps.nowMs();
  const done = (r: Omit<RefreshResult, 'elapsedMs' | 'runKey'>): RefreshResult =>
    ({ ...r, runKey, elapsedMs: deps.nowMs() - t0 });

  const existing = await readRun(runKey, deps.db);
  if (existing.kind === 'not_migrated') {
    return done({ ok: true, status: 'tables_missing', final: true, runId: null, phase: null, progress: null });
  }
  if (existing.kind === 'error') {
    return done({
      ok: false, status: 'failed', final: false, runId: null, phase: null, progress: null,
      lastError: existing.error, failCode: 'run_read_failed',
    });
  }

  let run = existing.data;
  if (run && isTerminalPhase(run.phase)) {
    // 이달은 끝났다(성공·실패·만료 모두). 같은 달에 다시 부르지 않게 final 로 답한다.
    const prog = await readProgress({ runId: run.runId, db: deps.db });
    return done({
      ok: run.phase === 'complete',
      status: run.phase as RefreshStatus,
      final: true,
      runId: run.runId,
      phase: run.phase,
      progress: prog.kind === 'ok' ? prog.data : null,
      lastError: run.lastError ?? undefined,
      // (M-2) 이 달이 실패·만료로 닫혔다는 사실이 `job_run_log` 로 가야 한다
      failCode: run.phase === 'complete' ? undefined : (failCodeOf(run.lastError ?? '') ?? run.phase),
    });
  }

  if (!run) {
    const created = await createRun({ runKey, topN: cfg.topN, nowMs: deps.nowMs(), db: deps.db });
    if (created.kind === 'not_migrated') {
      return done({ ok: true, status: 'tables_missing', final: true, runId: null, phase: null, progress: null });
    }
    if (created.kind === 'error') {
      return done({
        ok: false, status: 'failed', final: false, runId: null, phase: null, progress: null,
        lastError: created.error, failCode: 'run_create_failed',
      });
    }
    run = created.data;
  }

  const fail = async (error: string): Promise<RefreshResult> => {
    await closeRun({ runId: run!.runId, phase: 'failed', error, nowMs: deps.nowMs(), db: deps.db }).catch(() => undefined);
    const prog = await readProgress({ runId: run!.runId, db: deps.db });
    return done({
      ok: false, status: 'failed', final: true, runId: run!.runId, phase: 'failed',
      progress: prog.kind === 'ok' ? prog.data : null, lastError: error, failCode: failCodeOf(error),
    });
  };

  try {
    if (run.phase === 'listing') return await doListing(deps, cfg, run.runId, runKey, t0, fail, done);
    if (run.phase === 'scan') return await doScan(deps, run.runId, runKey, t0, 'scan', fail, done);
    if (run.phase === 'retry') return await doScan(deps, run.runId, runKey, t0, 'retry', fail, done);
    if (run.phase === 'finalize') return await doFinalize(deps, cfg, run.runId, runKey, t0, fail, done);
    return await fail(`unknown_phase:${run.phase}`);
  } catch (e) {
    return await fail(`fatal:${e instanceof Error ? e.message : String(e)}`.slice(0, 250));
  }
}

type DoneFn = (r: Omit<RefreshResult, 'elapsedMs' | 'runKey'>) => RefreshResult;
type FailFn = (error: string) => Promise<RefreshResult>;

// ── listing ─────────────────────────────────────────────────────────────────

async function doListing(
  deps: RefreshDeps, cfg: RefreshConfig, runId: number, _runKey: string, _t0: number,
  fail: FailFn, done: DoneFn,
): Promise<RefreshResult> {
  if (!deps.fetchSecListing) return await fail('sec_user_agent_missing');

  let sec: { json: unknown; sha256: string };
  try {
    sec = await deps.fetchSecListing();
  } catch (e) {
    return await fail(`sec_fetch:${e instanceof Error ? e.message : String(e)}`.slice(0, 250));
  }
  const secFetchedAt = deps.nowMs();

  let master: OverseasMasterFile;
  try {
    master = await deps.fetchMaster();
  } catch (e) {
    // 🔴 마스터 없이 추측 표기로 KIS 를 부르지 않는다 — BRK.B 하나로도 상위 50 의 정확성이 깨진다
    return await fail(`master_unavailable:${e instanceof Error ? e.message : String(e)}`.slice(0, 250));
  }
  const masterFetchedAt = deps.nowMs();

  let all: SecListingRow[];
  let droppedRows: number;
  try {
    const parsed = parseSecExchangeResponse(sec.json);
    all = parsed.rows;
    droppedRows = parsed.dropped;
  } catch (e) {
    return await fail(`sec_shape:${e instanceof Error ? e.message : String(e)}`.slice(0, 250));
  }

  const nyse = nyseRows(all);
  const counts: Record<string, unknown> = {
    sec_rows: all.length,
    sec_dropped_rows: droppedRows,
    sec_nyse: nyse.length,
    master_rows: master.rows,
    master_dropped_rows: master.dropped,
  };
  const bySuffix: Record<string, number> = {};
  const masterType: Record<string, number> = {};
  const masterEtp: Record<string, number> = {};
  let prefiltered = 0;
  let badSymbol = 0;
  let classKept = 0;
  let masterMissing = 0;
  let drCandidates = 0;

  const candidates: CandidateInsert[] = [];
  nyse.forEach((row, i) => {
    const symbol = internalSymbolFor('NYS', row.ticker);
    const base = {
      ord: i, symbol, secTicker: row.ticker, cik: row.cik, secName: row.name,
      kisSymb: null as string | null, kisEnam: null as string | null, kisStis: null as string | null,
      kisIsdr: null as string | null, kisEtyp: null as string | null,
    };
    /**
      * 🔴 내부 심볼 규약을 통과하지 못하면 **여기서 빼고 센다.**
      *
      * 그러지 않으면 자동 목록에는 들어가고(`readAutoPart` 는 걸러 내지 않는다) 분석 대상을 만드는
      * `loadUsTargetSymbols` 가 **조용히 떨어뜨린다** → 「자동 50인데 분석 대상 49」가 흔적 없이 된다.
      * 2026-11-01 파일에서는 후보 2,763건 중 0건이지만, 목록은 매달 바뀐다.
      */
     if (!isOverseasSymbol(symbol)) {
      badSymbol += 1;
      candidates.push({ ...base, status: 'excluded', exclusion: 'symbol_format' });
      return;
    }
    if (isNoncommonTicker(row.ticker)) {
      prefiltered += 1;
      bySuffix[noncommonSuffixOf(row.ticker)] = (bySuffix[noncommonSuffixOf(row.ticker)] ?? 0) + 1;
      candidates.push({ ...base, status: 'excluded', exclusion: 'prefilter_noncommon' });
      return;
    }
    if (row.ticker.includes('-')) classKept += 1;
    const v = classifyByMaster(master, kisSymbolCandidates(row.ticker));
    if (v.kind === 'master_missing') {
      masterMissing += 1;
      candidates.push({ ...base, status: 'excluded', exclusion: 'master_missing' });
      return;
    }
    if (v.kind === 'master_type') {
      masterType[v.value] = (masterType[v.value] ?? 0) + 1;
      candidates.push({
        ...base, kisSymb: v.entry.symb, kisEnam: v.entry.enam, kisStis: v.entry.stis || null,
        kisIsdr: v.entry.isdr || null, kisEtyp: v.entry.etyp || null, status: 'excluded', exclusion: 'master_type',
      });
      return;
    }
    if (v.kind === 'master_etp') {
      masterEtp[v.value] = (masterEtp[v.value] ?? 0) + 1;
      candidates.push({
        ...base, kisSymb: v.entry.symb, kisEnam: v.entry.enam, kisStis: v.entry.stis || null,
        kisIsdr: v.entry.isdr || null, kisEtyp: v.entry.etyp || null, status: 'excluded', exclusion: 'master_etp',
      });
      return;
    }
    // ready — DR 도 **스캔한다**(L-A2 의 가상 순위를 알려면 tomv 가 필요하다. 제외는 finalize 에서)
    if (v.entry.isdr === 'Y') drCandidates += 1;
    candidates.push({
      ...base, kisSymb: v.entry.symb, kisEnam: v.entry.enam, kisStis: v.entry.stis || null,
      kisIsdr: v.entry.isdr || null, kisEtyp: v.entry.etyp || null, status: 'pending', exclusion: null,
    });
  });

  const scanTargets = candidates.filter((c) => c.status === 'pending').length;
  counts.prefiltered_noncommon = { total: prefiltered, by_suffix: bySuffix };
  counts.class_share_kept = classKept;
  counts.symbol_format = badSymbol;
  counts.master_missing = masterMissing;
  counts.master_type = masterType;
  counts.master_etp = masterEtp;
  counts.dr_candidates = drCandidates;
  counts.scan_targets = scanTargets;
  counts.top_n = cfg.topN;
  counts.exclude_dr = cfg.excludeDr;

  if (scanTargets === 0) return await fail('no_scan_targets');

  const saved = await saveListing({
    runId, candidates,
    sec: { fetchedAtMs: secFetchedAt, sha256: sec.sha256, rows: all.length },
    master: { fetchedAtMs: masterFetchedAt, sha256: master.sha256, rows: master.rows },
    countsJson: JSON.stringify(counts),
    nowMs: deps.nowMs(),
    getConnection: deps.getConnection,
  });
  if (saved.kind === 'not_migrated') {
    return done({ ok: true, status: 'tables_missing', final: true, runId, phase: null, progress: null });
  }
  if (saved.kind === 'error') return await fail(`listing_save:${saved.error}`);

  const prog = await readProgress({ runId, db: deps.db });
  return done({
    ok: true, status: 'listing', final: false, runId, phase: 'scan',
    progress: prog.kind === 'ok' ? prog.data : null,
  });
}

// ── scan / retry ────────────────────────────────────────────────────────────

async function doScan(
  deps: RefreshDeps, runId: number, _runKey: string, t0: number, mode: 'scan' | 'retry',
  fail: FailFn, done: DoneFn,
): Promise<RefreshResult> {
  const read = mode === 'scan' ? readPendingCandidates : readRetryCandidates;
  const batch = await read({ runId, limit: SCAN_CHUNK_ROWS, db: deps.db });
  if (batch.kind === 'not_migrated') {
    return done({ ok: true, status: 'tables_missing', final: true, runId, phase: null, progress: null });
  }
  if (batch.kind === 'error') return await fail(`${mode}_read:${batch.error}`);

  if (batch.data.length === 0) {
    // 이 단계는 끝났다 — 다음 단계로
    const next: RunPhase = mode === 'scan' ? 'retry' : 'finalize';
    await advanceRun({ runId, phase: next, nowMs: deps.nowMs(), db: deps.db });
    const prog = await readProgress({ runId, db: deps.db });
    return done({
      ok: true, status: mode === 'scan' ? 'scan_done' : 'retry_done', final: false, runId, phase: next,
      progress: prog.kind === 'ok' ? prog.data : null,
    });
  }

  const overBudget = () => deps.nowMs() - t0 >= BUDGET_MS;
  let throttled = false;
  let maxOrd = 0;
  let cursor = 0;

  // 유계 동시성 — 예산을 넘기거나 스로틀을 만나면 **새 작업을 집지 않는다**
  const items = batch.data;
  const workers = Array.from({ length: Math.min(SCAN_CONCURRENCY, items.length) }, async () => {
    for (;;) {
      if (throttled || overBudget()) return;
      const i = cursor++;
      if (i >= items.length) return;
      const c = items[i];
      if (!c.kisSymb) {
        await applyScanOutcome({
          runId, nowMs: deps.nowMs(), db: deps.db,
          outcome: { ord: c.ord, status: 'kis_missing', error: 'kis_symb 없음(마스터 표기 미확인)' },
        }).catch(() => undefined);
        maxOrd = Math.max(maxOrd, c.ord);
        continue;
      }
      let r: FetchPriceOutcome;
      try {
        r = await deps.fetchPrice(c.kisSymb);
      } catch (e) {
        r = { kind: 'error', error: `unexpected:${e instanceof Error ? e.message : String(e)}` };
      }
      if (r.kind === 'throttled') {
        // 🔴 증폭 방지 — 스로틀을 만나면 그 자리에서 청크를 멈춘다(이 종목은 pending 으로 남아 다음 틱이 다시 집는다)
        throttled = true;
        return;
      }
      const outcome: ScanOutcome = r.kind === 'ok'
        ? { ord: c.ord, status: 'ok', ...r.values }
        : { ord: c.ord, status: r.kind === 'missing' ? 'kis_missing' : 'kis_error', error: r.error };
      await applyScanOutcome({ runId, outcome, nowMs: deps.nowMs(), db: deps.db }).catch((e) => {
        console.warn(`[universe/refresh] 결과 저장 실패 ord=${c.ord}: ${e instanceof Error ? e.message : String(e)}`);
      });
      maxOrd = Math.max(maxOrd, c.ord);
    }
  });
  await Promise.all(workers);

  await advanceRun({ runId, cursorPos: maxOrd, nowMs: deps.nowMs(), db: deps.db }).catch(() => undefined);
  const prog = await readProgress({ runId, db: deps.db });
  return done({
    ok: true,
    status: throttled ? 'throttled' : 'scan_partial',
    final: false,
    runId,
    phase: mode,
    progress: prog.kind === 'ok' ? prog.data : null,
  });
}

// ── finalize ────────────────────────────────────────────────────────────────

async function doFinalize(
  deps: RefreshDeps, cfg: RefreshConfig, runId: number, _runKey: string, _t0: number,
  fail: FailFn, done: DoneFn,
): Promise<RefreshResult> {
  const rowsOut = await readFinalizeRows({ runId, db: deps.db });
  if (rowsOut.kind === 'not_migrated') {
    return done({ ok: true, status: 'tables_missing', final: true, runId, phase: null, progress: null });
  }
  if (rowsOut.kind === 'error') return await fail(`finalize_read:${rowsOut.error}`);

  const inputs: RankInput[] = rowsOut.data.map((r) => ({
    ord: r.ord, symbol: r.symbol, cik: r.cik, curr: r.curr, etypNm: r.etypNm,
    tomv: r.tomv, shar: r.shar, last: r.last, isDr: r.isDr,
  }));
  const result = rankCandidates(inputs, cfg.topN, { excludeDr: cfg.excludeDr });

  if (result.top.length < cfg.topN) {
    // 🔴 50도 못 채우는 상태는 원천이 깨진 것이다 — 자동 목록을 **바꾸지 않고** 실패로 닫는다
    return await fail(`insufficient_candidates:${result.top.length}/${cfg.topN}`);
  }

  const prevOut = await readPrevTopSymbols({ runId, db: deps.db });
  const prev = prevOut.kind === 'ok' ? prevOut.data : [];
  const firstRun = prevOut.kind === 'ok' && prev.length === 0;
  const topSymbols = result.top.map((r) => r.symbol);
  const prevSet = new Set(prev);
  const topSet = new Set(topSymbols);
  const added = firstRun ? [] : topSymbols.filter((s) => !prevSet.has(s));
  const removed = firstRun ? [] : prev.filter((s) => !topSet.has(s));

  const dr = cfg.excludeDr ? drVirtualRanks(inputs, cfg.topN) : { count: 0, ranks: {} };
  /**
   * 🔴 **ADR 제외가 얼마나 비어 있는지 함께 보고한다**(Reviewer high-1).
   *
   * `dr_*` 수치만 보면 「ADR 은 처리됐다」로 읽힌다. 그러나 탐지가 KIS 마스터 `isdr` **한 열**뿐이고 그 열은
   * ADR 을 대부분 `N` 으로 둔다 → 상위 N 안에 **이름상 외국 발행사로 보이는데 `isdr=N` 인 종목**이 남는다.
   * 그 수와 심볼을 **추정치로** 적어, 읽는 사람이 안전장치가 비어 있음을 알 수 있게 한다.
   * ⚠ 이름 표지로 **제외하지 않는다**(오탐). 정확한 판정은 켜기 전 별도 설계다.
   */
  /**
    * 🔴 출처는 **마스터 `kis_enam`** 이다 — SEC `name` 이 아니다.
    *   2026-11-01 보관본 실측: SEC NYSE 3,269행에서 이 힌트에 걸리는 이름은 **0건**(ADR 10종 0/10),
    *   마스터 `enam` 에서는 **180행**(ADR 10종 중 9종, TTE 만 miss). SEC 이름에 걸면 운영에서 늘 `count:0` 이 되어
    *   **「의심 없음」으로 읽힌다** — 이 필드를 만든 목적과 정반대다. 출처를 되돌리지 말 것.
    */
  const enamByOrd = new Map(rowsOut.data.map((r) => [r.ord, r.kisEnam]));
  const suspects = result.top
    .filter((r) => !r.isDr && looksLikeForeignIssuerName(enamByOrd.get(r.ord) ?? null))
    .map((r) => ({ symbol: r.symbol, rank: r.rankNo, enam: (enamByOrd.get(r.ord) ?? '').slice(0, 60) }));
  const counts: Record<string, unknown> = {
    ...result.counts,
    threshold_cap_usd: result.thresholdCapUsd,
    prev_top_n: prev.length,
    added: added.length,
    removed: removed.length,
    first_run: firstRun,
    dr_in_virtual_top: dr.count,
    dr_virtual_ranks: dr.ranks,
    // 🔴 탐지 방법과 그 한계를 수치와 **같은 자리에** 적는다 — 「ADR 은 걸러졌다」로 오해하지 않게(high-1)
    dr_detection: {
      method: 'kis_master_isdr_only',
      limitation: 'isdr 열이 ADR 을 대부분 N 으로 둔다(2026-11-01 보관본: 이 힌트에 걸린 180행 중 115행이 N). 이 수치는 ADR 전체가 아니다',
      proper_check_pending: 'SEC 20-F/40-F/6-K 제출 여부 — 켜기 전 별도 설계',
    },
    // 이름 기반 **추정치**. 제외에 쓰지 않았다(오탐). 켜기 전에 사람이 이 목록을 본다
    foreign_suspects_in_top: {
      method: 'name_hint_adr_ads_spon',
      source: 'kis_master_enam',
      source_note: 'SEC name 에는 이 표지가 없다(실측 적중 0) — 마스터 영문명으로 본다',
      estimate_only: true,
      excluded_by_this: false,
      count: suspects.length,
      items: suspects,
    },
    finalized_at_ms: deps.nowMs(),
  };

  const verdicts: CandidateVerdict[] = result.candidates.map((c) => ({
    ord: c.ord, capUsed: c.capUsed, capAlt: c.capAlt, capSource: c.capSource,
    capRatio: c.capRatio, capFlag: c.capFlag, exclusion: c.exclusion, rankNo: c.rankNo,
  }));

  const fin = await finalizeRun({
    runId, verdicts,
    auto: result.top.map((r) => ({ symbol: r.symbol, rankNo: r.rankNo as number, marketCap: r.capUsed })),
    countsJson: JSON.stringify(counts), added, removed,
    nowMs: deps.nowMs(), getConnection: deps.getConnection,
  });
  if (fin.kind === 'not_migrated') {
    return done({ ok: true, status: 'tables_missing', final: true, runId, phase: null, progress: null });
  }
  if (fin.kind === 'error') return await fail(`finalize_write:${fin.error}`);

  // ── 변경 제안 — **수동 목록 종목에만**. 여기서 실패해도 산출은 이미 확정이다(complete 를 되돌리지 않는다)
  let proposalsCreated = 0;
  try {
    proposalsCreated = await createProposals(deps);
  } catch (e) {
    console.warn(`[universe/refresh] 제안 생성 실패(산출은 확정됨): ${e instanceof Error ? e.message : String(e)}`);
  }

  const prog = await readProgress({ runId, db: deps.db });
  return done({
    ok: true, status: 'complete', final: true, runId, phase: 'complete',
    progress: prog.kind === 'ok' ? prog.data : null,
    // 🔴 1회차는 `added`·`removed` 가 비어도 **알릴 사건**이다(high-2) — `firstRun`·`top` 이 그 입력이다
    changes: { added, removed, proposalsCreated, firstRun, top: topSymbols },
  });
}

/**
 * 제안 생성 — 규칙 A~F. **SEC 파일을 다시 부르지 않는다**: `listing` 이 그 달 한 번 받았고 이 단계는 같은 호출
 * 흐름의 뒤가 아닐 수 있다(청크가 여러 틱에 걸친다). 그래서 **그때 저장한 후보 표**를 SEC 의 대리로 쓴다 —
 * 후보 표에는 NYSE 행 전체(제외분 포함)가 `sec_ticker`·`cik` 와 함께 남아 있다.
 *
 * ⚠ 한계: 후보 표는 **NYSE 행만** 담는다. 그래서 규칙 A(「나스닥으로 이전」)의 판정에 필요한
 * 「그 티커가 Nasdaq 에 있다」는 사실을 이 표만으로는 알 수 없다 → **그 달의 SEC 파일을 한 번 더 읽어야 한다.**
 * 호출을 늘리지 않으려고 `listing` 단계에서 **수동 목록 종목에 대한 제안을 미리 계산해 두는 쪽**이 맞지만,
 * 그러면 `kis_ok`(스캔 결과)를 아직 모른다. 둘을 동시에 만족시키는 길이 없어 **SEC 1회를 더 부른다**
 * (월 1회 산출에서 SEC 호출 2회 — 간격 ≥250ms·쿨다운은 `SecClient` 가 지킨다).
 */
async function createProposals(deps: RefreshDeps): Promise<number> {
  if (!deps.fetchSecListing) return 0;
  const manual = await deps.readManualList();
  if (manual.length === 0) return 0;

  const sec = await deps.fetchSecListing();
  const parsed = parseSecExchangeResponse(sec.json);
  const byTicker = indexByTicker(parsed.rows);
  const byCik = indexByCik(parsed.rows);
  const cikMap = await readSymbolCikMap(deps.db);
  const recent = await readRecentSnapshotSymbols({ days: SNAPSHOT_LOOKBACK_DAYS, db: deps.db });

  const drafts = buildProposals({
    manual,
    secByTicker: byTicker,
    secByCik: byCik,
    cikOf: (s) => cikMap.get(s) ?? null,
    secTickerOf: deps.secTickerOf,
    // 🔴 표를 못 읽었으면 **모름(null)** 이다 — 모름을 실패로 보면 멀쩡한 종목을 빼라고 제안한다
    kisOk: (s) => (recent == null ? null : recent.has(s)),
    secShaPrefix: sec.sha256.slice(0, 8),
  });
  if (drafts.length === 0) return 0;
  const ins = await insertProposals({
    drafts, collectedAtMs: deps.nowMs(), nowMs: deps.nowMs(), db: deps.db,
  });
  if (ins.kind !== 'ok') {
    console.warn(`[universe/refresh] 제안 저장 실패: ${ins.kind === 'error' ? ins.error : ins.kind}`);
    return 0;
  }
  // 같은 지문이 이미 있으면 INSERT IGNORE 가 0행이다 — **새로 생긴 것만** 센다(알림 조건의 입력)
  return ins.data.inserted.length;
}

/** `run_key` — KST 벽시계의 `YYYY-MM`. 창이 열린 달이다. */
export function runKeyOf(nowMs: number): string {
  return new Date(nowMs + 9 * 3600_000).toISOString().slice(0, 7);
}

export { SEC_COMPANY_TICKERS_EXCHANGE_URL, emptyProgress };
