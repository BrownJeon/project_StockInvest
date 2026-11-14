/**
 * T-070 일봉 수집기 본체 — `POST /api/cron/daily-bars` 가 부른다(수동 호출, 그리고 cron-runner 정기 증분: T-117 매일 07:40 전 시장 ·
 * T-170 매일 18:10 국내만 — 쿼리 `?market=KR`, 본문 아님: 러너 call() 은 본문 인자 끝에 `}` 를 덧붙인다 — daily-bars-request.ts).
 *
 * ⚠ 이 모듈은 **주문·시그널을 만들지 않는다.** KIS 읽기 GET → `daily_bars` upsert 뿐. 주문·안전장치·시그널·전략 모듈을 import 하지 않는다.
 *
 * 한 번 실행 = 예산(호출 수 maxCalls·시간 maxMs) 안에서 대상 종목을 순서대로 처리한다. 예산이 다하면 멈추고, 다음 실행이 이어 간다.
 * 이어 가기 상태는 별도 테이블 없이 저장된 행에서 읽는다(승인 범위가 daily_bars 1개 — T-070 사용자 결정):
 *  - 행 없음                          → 백필: 오늘부터 과거로 years 년
 *  - MAX(trade_date) < 최근 확정 평일, 또는 최신 행이 장중 값인데 그 날 확정 시각이 지남
 *                                     → 증분: MAX 에서 앞으로 120일 칸씩(저장분과 10일 겹침 — 늘 연속, 조정 기준 변경 감지)
 *                                        (T-099) 겹침 불일치가 가장 최근 비교 봉 2개 안에만 있으면 '정착 중인 최신 봉'으로 보고
 *                                        재수집하지 않는다 — 받은 페이지 재기록이 잠정값을 확정값으로 덮는다(daily-bars-quality.detectAdjustmentChange).
 *                                        한계: 저장된 가장 최신 봉은 다음 증분 전까지 잠정일 수 있다(다음 날 증분이 고친다).
 *  - 'adj_stale' 행 있음               → 재수집: adj_stale 아닌 가장 이른 날의 전날부터 과거로(저장된 가장 이른 날·years 하한 중 이른 쪽까지)
 *  - MIN(trade_date) > years 하한+7일  → 백필 이어 가기: MIN 전날부터 과거로
 *  - 그 밖                            → 호출 0 (이미 최신·완료)
 * 쓰기는 멱등 upsert 라 같은 구간을 다시 받아도 결과가 같다.
 *
 * 품질 게이트: daily-bars-quality. 통화 혼합·단위 혼입이면 그 종목은 **쓰지 않는다**. 페이지 경계에서 전일 종가를 모르는 가장 오래된 봉은
 * (데이터셋 하한에 닿은 경우가 아니면) 이번에 쓰지 않고 다음 실행에서 다시 받는다 — 기업행위 의심 표시를 빠뜨리지 않기 위해서다.
 *
 * 호출 부하: KIS 요청은 bulk 레인(daily-bars-kis), 호출 사이 간격 gapMs(기본 400ms ≈ 초당 2.5건 — 공유 한도 5건/초의 절반),
 *   유량 대기 실패·레이트리밋·인증 실패는 남은 종목도 같을 것이므로 **그 자리에서 실행을 멈춘다**(증폭 방지).
 */
import {
  assertSingleCurrency, annotateBars, CurrencyMismatchError, detectAdjustmentChange, findGaps,
  FLAG_ADJ_STALE, FLAG_CORP_ACTION, FLAG_ZERO_VOLUME,
  type AdjMode, type AnnotatedBar, type RawBar,
} from './daily-bars-quality';
import { isKisThrottleFailure } from '@/lib/exchanges/kis-throttle';
import { addDays, isFinalBar, lastExpectedFinalDate, marketLocal, type BarMarket } from './daily-bars-time';
import { fetchKisDailyPage, KisDailyError, SOURCE_BY_MARKET, type FetchDailyPage } from './daily-bars-kis';
import { paginateDaily, type PaginateReason, type PaginateResult } from './daily-bars-paginate';
import {
  DAILY_BARS_TABLE, findMissingTables, loadDefaultTargets, loadStoredBars, loadSymbolState, markSymbolStale,
  marketOfSymbol, relabelOrphans, upsertBars, type Queryable, type SymbolState, type Target,
} from './daily-bars-store';

export const DEFAULT_YEARS = 3;
export const MAX_YEARS = 5;
export const DEFAULT_MAX_CALLS = 150;
export const MAX_CALLS_CAP = 600;
export const DEFAULT_MAX_MS = 100_000;
export const DEFAULT_GAP_MS = 400;
/** 증분 때 저장분과 겹쳐 받는 달력 일수(약 5~7거래일). */
export const INCREMENTAL_OVERLAP_DAYS = 10;
/**
 * 증분 한 칸이 기준일 뒤로 덮는 달력 일수. 겹침 10일과 합쳐 130일 = 평일 ≤94일 → 해외 100행 한 페이지가 겹침 시작일보다
 * **더 과거까지** 내려가(주말·휴일로 시작해도) reached 가 되고, 국내는 요청 기간(≤139일) 하나에 들어간다.
 */
export const INCREMENTAL_STEP_DAYS = 120;
/** 증분 한 칸에서 받을 수 있는 최대 페이지 수(호출당 행수가 예상보다 적을 때 대비 — 평소 1장). */
export const INCREMENTAL_STEP_PAGES = 4;
/** 증분 칸 수 상한(약 35년) — 실제 상한은 실행 예산이다. */
export const MAX_INCREMENTAL_STEPS = 100;
/** 백필 하한을 이 정도 덜 채웠어도 완료로 본다(하한 날짜가 휴장일일 수 있음). */
export const BACKFILL_SLACK_DAYS = 7;
/** 연속 실패가 이만큼이면 멈춘다. */
export const MAX_CONSECUTIVE_FAILURES = 3;

export interface CollectOptions {
  symbols?: string[];
  years?: number;
  maxCalls?: number;
  /** (T-170) 기본 대상을 이 시장만 남긴다(보유 포함). symbols 와 함께 주면 라우트가 400 으로 거부한다 — 여기서는 기본 대상에만 적용한다. */
  market?: BarMarket;
}

export interface CollectDeps {
  db: Queryable;
  fetchPage?: FetchDailyPage;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  maxMs?: number;
  gapMs?: number;
  adjMode?: AdjMode;
  log?: (line: string) => void;
}

export type SymbolMode = 'backfill' | 'incremental' | 'refetch' | 'backfill_continue' | 'up_to_date';

export interface SymbolReport {
  symbol: string;
  market: BarMarket;
  modes: SymbolMode[];
  calls: number;
  written: number;
  /** no_data = 저장분이 없는데 첫 조회부터 빈 응답(R-5 — 잘못된 심볼·상장 전·응답 형식 문제를 '완료'로 숨기지 않음) */
  status: 'done' | 'partial' | 'failed' | 'skipped' | 'no_data';
  reasons: PaginateReason[];
  rowsPerCall: number[];
  /** mismatches = 겹침 불일치 총수, settling = 그중 정착 중인 최신 봉으로 보고 재수집하지 않은 수(T-099) */
  adjChange?: { compared: number; mismatches: number; settling: number };
  /** gaps = 이번에 받은 봉의 빈틈, storedGaps = 실행 뒤 저장분 전체의 9일 초과 빈틈(안전망 — 거래정지와 구별 안 함) */
  quality?: { corpActionSuspect: number; zeroVolume: number; duplicates: number; conflicts: number; orderViolations: number; dropped: number; gaps: number; storedGaps: number };
  error?: string;
}

export interface CollectResult {
  ok: boolean;
  /** (T-170) 기본 대상 시장 필터(없으면 전 시장). 로그·응답에서 아침(전 시장)·저녁(국내) 실행을 구별한다. */
  market?: BarMarket;
  skipped?: 'tables_missing' | 'already_running';
  missing?: string[];
  aborted?: 'kis_throttle' | 'kis_rate_limited' | 'kis_auth' | 'consecutive_failures';
  years?: number;
  budget?: { maxCalls: number; calls: number; maxMs: number; elapsedMs: number; exhausted: boolean };
  targets?: number;
  targetErrors?: string[];
  processed?: number;
  remaining?: string[];
  symbols?: SymbolReport[];
}

let running = false;

/** 시험 전용 — 동시 실행 잠금 해제. */
export function __resetDailyBarsLockForTest(): void {
  running = false;
}

export async function runDailyBarsCollect(deps: CollectDeps, opts: CollectOptions = {}): Promise<CollectResult> {
  if (running) return { ok: false, skipped: 'already_running' };
  running = true;
  try {
    return await inner(deps, opts);
  } finally {
    running = false;
  }
}

function abortKind(e: unknown): CollectResult['aborted'] | null {
  if (isKisThrottleFailure(e)) return 'kis_throttle';
  if (e instanceof KisDailyError && e.kind === 'rate_limited') return 'kis_rate_limited';
  if (e instanceof KisDailyError && e.kind === 'auth') return 'kis_auth';
  return null;
}

const errText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 200);

async function inner(deps: CollectDeps, opts: CollectOptions): Promise<CollectResult> {
  const { db } = deps;
  const log = deps.log ?? ((l: string) => console.log(l));
  const nowFn = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => { const t = setTimeout(r, ms); t.unref?.(); }));
  const fetchPage = deps.fetchPage ?? fetchKisDailyPage;
  const adjMode: AdjMode = deps.adjMode ?? 'adjusted';
  const maxMs = deps.maxMs ?? DEFAULT_MAX_MS;
  const gapMs = deps.gapMs ?? DEFAULT_GAP_MS;
  const years = Math.min(MAX_YEARS, Math.max(1, Math.floor(opts.years ?? DEFAULT_YEARS)));
  const maxCalls = Math.min(MAX_CALLS_CAP, Math.max(1, Math.floor(opts.maxCalls ?? DEFAULT_MAX_CALLS)));

  const missing = await findMissingTables(db, [DAILY_BARS_TABLE]);
  if (missing.length > 0) {
    log(`[daily-bars] skipped: tables_missing (${missing.join(',')}) — scripts/migrations/T-070-daily-bars.sql 미적용`);
    return { ok: true, skipped: 'tables_missing', missing };
  }

  let targets: Target[];
  let targetErrors: string[] = [];
  if (opts.symbols && opts.symbols.length) {
    targets = [];
    for (const symbol of new Set(opts.symbols)) {
      const market = marketOfSymbol(symbol);
      if (market) targets.push({ symbol, market, origin: 'request' });
      else targetErrors.push(`invalid_symbol:${symbol.slice(0, 40)}`);
    }
  } else {
    const t = await loadDefaultTargets(db, { market: opts.market });
    targets = t.targets;
    targetErrors = t.errors;
  }

  const t0 = nowFn().getTime();
  let calls = 0;
  let budgetHit = false;
  const takeCall = () => {
    if (calls >= maxCalls || nowFn().getTime() - t0 >= maxMs) { budgetHit = true; return false; }
    calls++;
    return true;
  };
  let lastCallAt = 0;
  const pace = async () => {
    const wait = lastCallAt + gapMs - nowFn().getTime();
    if (wait > 0) await sleep(wait);
  };
  /** 호출 간격은 여기 한 곳에서 지킨다 — 앞 호출이 **끝난** 시각부터 gapMs(종목이 바뀌어도 같다). */
  const pagedFetch: FetchDailyPage = async (req) => {
    await pace();
    try {
      return await fetchPage(req);
    } finally {
      lastCallAt = nowFn().getTime();
    }
  };

  const res: CollectResult = { ok: true, years, targets: targets.length, targetErrors, symbols: [], remaining: [] };
  if (opts.market && !(opts.symbols && opts.symbols.length)) res.market = opts.market;
  let consecutiveFailures = 0;
  let i = 0;
  for (; i < targets.length; i++) {
    if (budgetHit || res.aborted) break;
    const tgt = targets[i];
    const rep = await collectSymbol({
      db, tgt, years, adjMode, now: nowFn(), fetchPage: pagedFetch, takeCall,
    });
    res.symbols!.push(rep);
    if (rep.status === 'failed') consecutiveFailures++; else if (rep.calls > 0) consecutiveFailures = 0;
    if (rep.abort) {
      res.ok = false;
      res.aborted = rep.abort;
    } else if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      res.ok = false;
      res.aborted = 'consecutive_failures';
    }
    delete rep.abort;
    // 예산이 이 종목 도중에 다했으면 이 종목도 남은 목록에 넣는다(다음 실행이 이어 간다)
    if (rep.status === 'partial' && rep.reasons.includes('budget')) { i++; res.remaining!.push(tgt.symbol); break; }
  }
  for (; i < targets.length; i++) res.remaining!.push(targets[i].symbol);
  res.processed = res.symbols!.length;
  res.budget = { maxCalls, calls, maxMs, elapsedMs: nowFn().getTime() - t0, exhausted: budgetHit };
  const written = res.symbols!.reduce((a, s) => a + s.written, 0);
  log(`[daily-bars] done market=${res.market ?? 'all'} ok=${res.ok} targets=${res.targets} processed=${res.processed} calls=${calls}/${maxCalls} written=${written}`
    + ` remaining=${res.remaining!.length}${res.aborted ? ` aborted=${res.aborted}` : ''}`
    + ` failed=${res.symbols!.filter((s) => s.status === 'failed').map((s) => s.symbol).join(',') || '-'}`);
  return res;
}

interface SymbolCtx {
  db: Queryable;
  tgt: Target;
  years: number;
  adjMode: AdjMode;
  now: Date;
  fetchPage: FetchDailyPage;
  takeCall: () => boolean;
}

type InternalReport = SymbolReport & { abort?: CollectResult['aborted'] };

function pagesFor(market: BarMarket, years: number): number {
  // 해외 100행/호출, 국내 139일/호출 기준 + 여유
  return market === 'US' ? Math.ceil((years * 262) / 100) + 3 : Math.ceil((years * 365) / 140) + 3;
}

async function collectSymbol(c: SymbolCtx): Promise<InternalReport> {
  const { db, tgt, now } = c;
  const { market, symbol } = tgt;
  const rep: InternalReport = { symbol, market, modes: [], calls: 0, written: 0, status: 'done', reasons: [], rowsPerCall: [] };
  const q: NonNullable<SymbolReport['quality']> = {
    corpActionSuspect: 0, zeroVolume: 0, duplicates: 0, conflicts: 0, orderViolations: 0, dropped: 0, gaps: 0, storedGaps: 0,
  };
  const targetOldest = addDays(marketLocal(market, now).date, -Math.round(c.years * 365));
  const isFinal = (d: string) => isFinalBar(market, d, now);
  const upsertCtx = { market, symbol, adjMode: c.adjMode, source: SOURCE_BY_MARKET[market], isFinal, now };

  const run = async (
    startCursor: string | null, stopAt: string, maxPages = pagesFor(market, c.years) + 2, satisfiedAt?: string,
  ): Promise<PaginateResult> => {
    const r = await paginateDaily({
      fetchPage: c.fetchPage, market, symbol, adjMode: c.adjMode, startCursor, stopAt, satisfiedAt,
      maxPages, takeCall: c.takeCall,
    });
    rep.calls += r.calls;
    rep.reasons.push(r.reason);
    rep.rowsPerCall.push(...r.rowsPerCall);
    q.duplicates += r.merge.duplicates;
    q.conflicts += r.merge.conflicts.size;
    q.orderViolations += r.merge.orderViolations;
    q.dropped += r.dropped;
    return r;
  };

  /** 받은 봉에 품질 표시를 붙여 쓴다. 데이터셋 하한이 아닌데 전일 종가를 모르는 가장 오래된 봉은 보류한다. */
  const write = async (r: PaginateResult, atDatasetFloor: boolean): Promise<void> => {
    if (!r.merge.bars.length) return;
    const context = (await loadStoredBars(db, market, symbol, null))
      .filter((s) => !s.flags.includes(FLAG_ADJ_STALE) && !s.flags.includes('adj_orphan'));
    let ann: AnnotatedBar[] = annotateBars(r.merge.bars, context, r.merge.conflicts);
    if (!atDatasetFloor && ann.length && !ann[0].hasPredecessor) ann = ann.slice(1);
    for (const b of ann) {
      if (b.flags.includes(FLAG_CORP_ACTION)) q.corpActionSuspect++;
      if (b.flags.includes(FLAG_ZERO_VOLUME)) q.zeroVolume++;
    }
    q.gaps += findGaps(r.merge.bars).length;
    rep.written += await upsertBars(db, ann, upsertCtx);
  };

  const finish = (r: PaginateResult): boolean => {
    if (r.reason === 'error') {
      const kind = abortKind(r.error);
      rep.error = errText(r.error);
      rep.status = r.merge.bars.length ? 'partial' : 'failed';
      if (kind) rep.abort = kind;
      return false;
    }
    if (r.reason === 'budget' || r.reason === 'page_cap' || r.reason === 'no_progress') {
      rep.status = 'partial';
      return r.reason !== 'budget';
    }
    return true;
  };
  const floorReached = (r: PaginateResult) => r.reason === 'reached' || r.reason === 'exhausted';

  const body = async (): Promise<void> => {
    let st: SymbolState = await loadSymbolState(db, market, symbol);
    assertSingleCurrency(market, st.currencies);

    // 조정 모드가 바뀌었으면(예: raw → adjusted) 저장분 전체가 다른 기준이다 → 재수집 대상
    if (st.count > 0 && st.adjModes.some((m) => m !== c.adjMode) && st.staleCount < st.count) {
      await markSymbolStale(db, market, symbol);
      st = await loadSymbolState(db, market, symbol);
    }

    if (st.count === 0) {
      rep.modes.push('backfill');
      const r = await run(null, targetOldest);
      await write(r, floorReached(r));
      finish(r);
      // (R-5) 저장분이 없는데 첫 조회부터 빈 응답 — 잘못된 심볼·상장 전·응답 형식 문제를 '완료'로 숨기지 않는다
      if (floorReached(r) && r.merge.bars.length === 0 && r.calls > 0) rep.status = 'no_data';
      return;
    }

    // 1) 증분 (R-1) — 저장 MAX 에서 **앞으로** 한 칸씩 받는다. 각 요청은 [기준일−10일, 기준일+120일] 을 덮으므로(해외 100행 > 평일 94일,
    //    국내는 요청 기간 자체) 받은 페이지가 저장분과 반드시 이어진다. 예산이 중간에 끊겨도 쓴 데까지가 연속이라 구멍이 생기지 않고,
    //    다음 실행이 새 MAX 에서 이어 간다. (R-1b) **연속성 판정은 "받은 하한 ≤ 기준일"** 이다 — 10일 겹침은 조정 감지용이라 있는 만큼만
    //    비교한다(상장 직후 종목). 호출당 행수가 예상보다 적으면 같은 칸 안에서 최대 INCREMENTAL_STEP_PAGES 장까지 과거로 더 받는다.
    //    그래도 기준일에 닿지 않으면(이어졌는지 모름) **쓰지 않는다**.
    // (Codex C2 지적1) 최신 행이 장중(is_final=0)으로 저장됐는데 지금은 그 날 확정 시각이 지났으면 다시 받아 확정으로 바꾼다.
    //   장중에는 isFinalBar 가 거짓이라 추가 호출 0. 최신 행 하나만 읽는다.
    let needIncremental = st.maxDate! < lastExpectedFinalDate(market, now);
    if (!needIncremental && isFinalBar(market, st.maxDate!, now)) {
      const latest = await loadStoredBars(db, market, symbol, st.maxDate!);
      needIncremental = latest.length > 0 && !latest[0].isFinal;
    }
    if (needIncremental) {
      rep.modes.push('incremental');
      const today = marketLocal(market, now).date;
      let anchor = st.maxDate!;
      let compared = 0;
      let mismatches = 0;
      let settling = 0;
      for (let step = 0; step < MAX_INCREMENTAL_STEPS; step++) {
        const stepEnd = addDays(anchor, INCREMENTAL_STEP_DAYS);
        const end = stepEnd < today ? stepEnd : null;           // null = 오늘 기준(마지막 칸)
        const overlapFrom = addDays(anchor, -INCREMENTAL_OVERLAP_DAYS);
        const r = await run(end, overlapFrom, INCREMENTAL_STEP_PAGES, anchor);
        if (r.reason !== 'reached') {
          if (!finish(r)) return;                                 // 예산·오류
          rep.status = 'partial';
          rep.error = `incremental_not_contiguous:${r.reason}`;   // 이어졌는지 모르는 페이지는 쓰지 않았다
          return;
        }
        const stored = await loadStoredBars(db, market, symbol, overlapFrom);
        const adj = detectAdjustmentChange(r.merge.bars, stored);
        compared += adj.compared;
        mismatches += adj.mismatches.length;
        settling += adj.settling;
        rep.adjChange = { compared, mismatches, settling };
        if (adj.unitMismatch) throw new CurrencyMismatchError(market, ['unit_mismatch']);
        if (adj.changed) {
          // 과거 전체가 낡았다 — 표시하고 이 페이지를 쓴 뒤 아래 재수집으로 넘어간다(남은 최신 구간은 다음 실행의 증분이 잇는다)
          await markSymbolStale(db, market, symbol);
          await write(r, false);
          break;
        }
        // 불일치가 없거나 정착 중인 최신 봉뿐(adj.settling > 0)이면 stale 표시 없이 쓰기만 한다 — 겹침 재기록이 잠정값을 확정값으로 덮는다
        await write(r, false);
        if (end === null) break;
        anchor = end;
      }
      st = await loadSymbolState(db, market, symbol);
    }

    // 2) 재수집 — adj_stale 행이 있으면 fresh 하한 전날부터 과거로
    if (st.staleCount > 0) {
      rep.modes.push('refetch');
      const cursor = st.minFreshDate ? addDays(st.minFreshDate, -1) : null;
      const stopAt = st.minDate! < targetOldest ? st.minDate! : targetOldest;
      const r = await run(cursor, stopAt);
      await write(r, floorReached(r));
      const complete = finish(r) && floorReached(r);
      if (complete) {
        st = await loadSymbolState(db, market, symbol);
        // 새로 받은 구간 아래에도 남은 stale 행(KIS 가 더 주지 않는 날짜)은 재수집 무한 반복을 막기 위해 orphan 으로 바꾼다
        if (st.staleCount > 0) await relabelOrphans(db, market, symbol);
      }
      return;
    }

    // 3) 백필 이어 가기
    if (st.minDate! > addDays(targetOldest, BACKFILL_SLACK_DAYS)) {
      rep.modes.push('backfill_continue');
      const r = await run(addDays(st.minDate!, -1), targetOldest);
      await write(r, floorReached(r));
      finish(r);
      return;
    }

    if (!rep.modes.length) {
      rep.modes.push('up_to_date');
      rep.status = 'skipped';
    }
  };

  try {
    await body();
    // 안전망(R-1): 저장분 전체의 달력 빈틈(9일 초과)을 보고한다 — 거래정지 등 실제 휴장과 구별하지 않으므로 표시만 한다
    if (rep.status !== 'failed') {
      const all = await loadStoredBars(db, market, symbol, null);
      q.storedGaps = findGaps(all.filter((b) => !b.flags.includes(FLAG_ADJ_STALE))).length;
    }
    rep.quality = q;
    return rep;
  } catch (e) {
    rep.status = 'failed';
    rep.error = e instanceof CurrencyMismatchError ? e.message : errText(e);
    const kind = abortKind(e);
    if (kind) rep.abort = kind;
    rep.quality = q;
    return rep;
  }
}

/** 시험·문서용: 라우트 본문 검증에 쓰는 심볼 형식(국내 6자리, 해외 'EXCD:TICKER' 의 NAS/NYS/AMS). */
export const ROUTE_SYMBOL_PATTERN = /^(\d{6}|(NAS|NYS|AMS):[A-Z][A-Z0-9.]*)$/;
/** (R-9c) daily_bars.symbol 은 VARCHAR(32) — 넘으면 DB 오류이므로 본문 검증에서 거부한다. */
export const ROUTE_SYMBOL_MAX_LEN = 32;

export type { RawBar };
