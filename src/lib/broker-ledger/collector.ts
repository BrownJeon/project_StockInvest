/**
 * T-087 (T-081 WP-D1a) — 브로커 체결 원장 **"앞으로 수집"** 수집기. 크론 라우트(`src/app/api/cron/broker-fills/route.ts`)가 부른다.
 *
 * 이 모듈은 DB 풀·KIS 조회 함수·지문 함수를 **전부 주입받는다** — `@/lib/db`·`@/lib/safety` 를 import 하지 않고(정적 시험), 거래소 모듈은 타입만 쓴다.
 * 그래서 일회용 MariaDB + 모킹한 조회 함수로 그대로 시험할 수 있다(KIS 실호출 없음).
 *
 * 설계 정본: `docs/design/2026-10-25-wpd-broker-fills-design.md` v3.1 §2.3(지문)·§3(수집 계약 전부)·§4.3(baseline)·§7(D1a).
 *
 * ## 한 번의 실행
 *  1. 표 5개가 없으면(1146) `not_migrated` — 아무것도 쓰지 않는다(라우트는 503).
 *  2. 스위치 `system_config.broker_fills_cron_enabled` — **JSON true 일 때만 켜짐**(키 없음·false·읽기 오류 = 꺼짐, 기본 꺼짐).
 *     cron 이면 꺼졌을 때 `skipped(switch_off)`(KIS·DB 쓰기 0). manual 은 스위치와 무관하게 1회 돈다(라우트 주석 — Reviewer 판단 사항).
 *  3. 계좌 지문(서버 비밀 HMAC) — 키 없음·계좌 없음이면 **실행하지 않는다**(`preflight_failed`, KIS 0). run 행도 쓰지 않는다
 *     (`account_fingerprint NOT NULL` 이라 지문 없이 행을 만들 수 없다 — 결과·로그로만 드러난다).
 *  4. single-flight: 명명 락 `GET_LOCK(…, 0)`(프로세스 간 원자적) + `running` 이 10분 안에 시작됐으면 건너뜀, 그보다 오래된 running 은 `failed(stale_running)`.
 *  5. 직전 **성공**(complete/incomplete) run 의 지문과 다르면 → 이번 계획의 run 을 전부 `failed(account_changed)` 로 기록하고 KIS 를 부르지 않는다(L-d ①).
 *  6. 작업(시장 2 × 종류 3) 순서대로: cron 이면 연속 3회 failed 인 (시장·종류)는 `halted`(KIS 0) · 국내 체결의 85일 밖 창은 run 행 없이 건너뜀(L-c) ·
 *     `running` INSERT → KIS 조회(run 당 호출 12·페이지 30·예산) → 정규화 → 응답 안 자연키 중복 제외 → 행마다 트랜잭션 upsert → complete 판정 → 최종 UPDATE.
 *  7. 잔고 run 이 complete 이고 그 (계좌·시장)의 첫 complete 잔고 run 이면 그날 행을 baseline 으로 표시(§4.3, 기록만).
 *
 * ## fail-closed
 *  - complete 판정은 Dev-1 `assessRunCompleteness`(DB CHECK 보다 느슨하지 않음). DB 가 그래도 complete 를 거부하면(4025) incomplete 로 낮춰 다시 쓴다.
 *  - `positive_check` 는 `pending`(체결·기간손익)/`n/a`(잔고)로만 쓴다 — confirmed/unconfirmed 는 D2 소유(L-e).
 *  - 결과 객체·로그에는 건수·상태·사유 코드만 담는다(계좌·키·금액 없음). run.error 에는 설계가 허용한 브로커 주문번호 메모가 들어갈 수 있다.
 *  - 알림을 보내지 않는다(D1a 범위 — 실패는 run.error 와 로그만).
 */
import type { LedgerQueryOptions, LedgerQueryResult } from '@/lib/exchanges/kis-ledger-query';
import {
  addDaysIso, assessRunCompleteness, checkSums, initialPositiveCheck, kstDate, normalizeFills, normalizePositionSnapshot, normalizeRealizedPnl,
  partitionDuplicates, queryRangeForWindow, rowDateBounds, runErrorText, sourceTrMatches, splitByRowDate, trContDbValue, withinDomesticFillsTrWindow,
} from './normalize';
import {
  checkAndCloseRunning, errCode, errnoOf, finishRun, inRowTx, insertFailedRun, insertRunningRun, isHalted, isLedgerTableMissing,
  kstDateTime, lastSuccessfulFingerprint, ledgerTablesPresent, markBaselineIfFirst, readCronSwitch, releaseCollectorLock, tryCollectorLock,
  upsertFill, upsertPositionSnapshot, upsertRealizedPnl,
  type NewRun, type RetryDeps, type RunFinish, type SqlConnection, type SqlPool, type UpsertMeta, type UpsertOutcome,
} from './store';
import type { BrokerMarket, BrokerRunKind, NormalizeIssue } from './types';

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 상수(설계 §3.5·§3.6·§3.7)
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** 원장 기준일 — D1a 는 이 날 이후만 다룬다("앞으로 수집"). 이전 구간은 D1b(백필, 별도 승인). */
export const LEDGER_START_DATE = '2026-10-25';
/** 일일 실행 창 `[오늘−7일, 오늘]`(정정·늦은 체결·D+2 정산 겹침). */
export const DAILY_WINDOW_DAYS = 7;
/** 주 1회 넓은 창 `[오늘−35일, 오늘]`(기준일 이전으로는 자른다). */
export const WEEKLY_WINDOW_DAYS = 35;
/** 넓은 창을 쓰는 요일(KST, 0 = 일요일 — 국내·미국 모두 휴장인 날 아침). */
export const WEEKLY_WIDE_WINDOW_DOW = 0;
/** run 당 KIS 호출 상한(L-8). 어댑터 기본값(LEDGER_MAX_CALLS)과 같다 — 시험이 둘을 대조한다. */
export const RUN_MAX_KIS_CALLS = 12;
/** run 당 페이지 상한(§3.5). */
export const RUN_MAX_PAGES = 30;
/** 라우트 시간 예산(§3.7) — 크론 러너 curl 상한 90초보다 짧다. */
export const ROUTE_TIME_BUDGET_MS = 75_000;
/**
 * 새 **페이지·새 작업**을 시작할 수 있는 마지막 시각 = 실행 시작 + 35초(그리고 전체 예산 안).
 * 이유: 어댑터는 페이지를 **시작하기 전에만** 예산을 본다. 한 페이지는 kisFetch 유량 대기(최대 30초) + 통신(20초) 한 번만으로도 50초까지 걸릴 수 있어
 * "75초 전에만 시작"으로는 크론 러너 curl 상한 90초를 넘긴다. 35 + 50 = 85 < 90초. 정상 실행(6 run)은 10초 안팎이라 이 창으로 충분하다.
 * 남는 한계: 레이트리밋 재시도(최대 3회 시도)·토큰 재발급까지 겹치면 한 페이지가 더 길어질 수 있다 — 그때 curl 은 000 으로 끝나지만
 * 서버 쪽 실행은 계속돼 run 을 정상으로 닫고(행 단위 트랜잭션), 다음 실행은 single-flight 가 막는다(데이터 손상 없음).
 */
export const PAGE_START_WINDOW_MS = 35_000;
/** KIS 를 부른 작업 사이 간격(§3.6 "청크 사이 1초"). */
export const BETWEEN_JOBS_SLEEP_MS = 1_000;

export const MARKETS: readonly BrokerMarket[] = ['domestic', 'overseas'];
export const KINDS: readonly BrokerRunKind[] = ['fills', 'realized_pnl', 'position_snapshot'];

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 주입 인터페이스
// ─────────────────────────────────────────────────────────────────────────────────────────────

export type LedgerFetchOptions = LedgerQueryOptions;

export interface MarketLedgerFetchers {
  fills(q: { from: string; to: string }, opts: LedgerFetchOptions): Promise<LedgerQueryResult>;
  realizedPnl(q: { from: string; to: string }, opts: LedgerFetchOptions): Promise<LedgerQueryResult>;
  positions(opts: LedgerFetchOptions): Promise<LedgerQueryResult>;
}

export interface LedgerFetchers {
  domestic: MarketLedgerFetchers;
  overseas: MarketLedgerFetchers;
  /** run 행에 미리 적을 TR ID(실전 T…/모의 V…). 어댑터 결과의 trId 와 다르면 그 run 은 failed(source_tr_mismatch) — 쓰기 0. */
  trId(market: BrokerMarket, kind: BrokerRunKind): string;
}

export type AccountFingerprintResult = { ok: true; fingerprint: string } | { ok: false; error: string };

export interface CollectorDeps {
  db: SqlPool;
  fetchers: LedgerFetchers;
  /** 어댑터에 넘길 지문 함수(서버 비밀 HMAC — `fingerprintSecret`). 키 없으면 null. */
  fingerprint: (accountIdentity: string) => string | null;
  /** 실행 전 지문(계좌 원문은 호출자 안에서만). 키 없음·계좌 없음이면 ok:false. */
  accountFingerprint: () => Promise<AccountFingerprintResult>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  log?: (line: string) => void;
  /** 시험용 — 창 계획 함수(기본 {@link planJobWindow}). 85일 밖 건너뜀 경로를 시험하려고 둔다. 운영 배선(라우트)은 넘기지 않는다. */
  planWindow?: (market: BrokerMarket, kind: BrokerRunKind, nowMs: number) => JobWindow | null;
}

export interface CollectRequest {
  trigger: 'cron' | 'manual';
  /** 전체 예산 끝(epoch ms) — 이 뒤로는 행을 더 쓰지 않는다. 기본 = 시작 + 75초. 새 페이지·새 작업은 그보다 이른 {@link PAGE_START_WINDOW_MS} 까지만. */
  deadlineMs?: number;
  markets?: readonly BrokerMarket[];
  kinds?: readonly BrokerRunKind[];
  accountId?: number;
}

export type JobStatus = 'complete' | 'incomplete' | 'failed' | 'halted' | 'skipped';

export interface JobReport {
  market: BrokerMarket;
  kind: BrokerRunKind;
  status: JobStatus;
  runId: number | null;
  pages: number;
  kisCalls: number;
  rowsSeen: number;
  inserted: number;
  updated: number;
  unchanged: number;
  staleSkipped: number;
  duplicateKeys: number;
  normalizeIssues: number;
  writeFailures: number;
  /** 사유 코드만(값·계좌·주문번호 없음). */
  reasons: string[];
}

export type CollectResult =
  | { status: 'not_migrated' }
  | { status: 'skipped'; reason: 'switch_off' | 'in_progress'; switchEnabled: boolean }
  | { status: 'preflight_failed'; error: string; switchEnabled: boolean }
  | { status: 'done'; switchEnabled: boolean; closedStale: number; jobs: JobReport[] };

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 창 계획(순수)
// ─────────────────────────────────────────────────────────────────────────────────────────────

export interface JobWindow { windowFrom: string; windowTo: string; queryFrom: string; queryTo: string }

/**
 * (시장·종류)의 이번 창. 체결·기간손익 = `[max(오늘−N, 기준일), 오늘]`(N = 일요일 35 · 그 밖 7), 잔고 = 오늘 하루. 조회 범위는 Dev-1 `queryRangeForWindow`
 * (해외 체결·기간손익 ±1일). 오늘이 기준일보다 이르면 null(시계 이상 — 작업 건너뜀).
 */
export function planJobWindow(market: BrokerMarket, kind: BrokerRunKind, nowMs: number): JobWindow | null {
  const today = kstDate(nowMs);
  if (today < LEDGER_START_DATE) return null;
  let from = today;
  if (kind !== 'position_snapshot') {
    const dow = new Date(nowMs + 9 * 3_600_000).getUTCDay();
    const days = dow === WEEKLY_WIDE_WINDOW_DOW ? WEEKLY_WINDOW_DAYS : DAILY_WINDOW_DAYS;
    from = addDaysIso(today, -days);
    if (from < LEDGER_START_DATE) from = LEDGER_START_DATE;
  }
  const q = queryRangeForWindow(market, kind, from, today);
  return { windowFrom: from, windowTo: today, queryFrom: q.queryFrom, queryTo: q.queryTo };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 내부 도우미
// ─────────────────────────────────────────────────────────────────────────────────────────────

function emptyReport(market: BrokerMarket, kind: BrokerRunKind, status: JobStatus, reasons: string[] = []): JobReport {
  return { market, kind, status, runId: null, pages: 0, kisCalls: 0, rowsSeen: 0, inserted: 0, updated: 0, unchanged: 0, staleSkipped: 0,
    duplicateKeys: 0, normalizeIssues: 0, writeFailures: 0, reasons };
}

/** 정규화 실패 요약 — `normalize:<사유>:<필드>×n`(값 없음). */
function issueSummary(issues: NormalizeIssue[]): string[] {
  const m = new Map<string, number>();
  for (const i of issues) {
    const k = `normalize:${i.reason}${i.field ? `:${i.field}` : ''}`;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].slice(0, 8).map(([k, n]) => `${k}x${n}`);
}

const SAFE_ORDER_NO = /^[0-9A-Za-z]{1,20}$/;

interface JobCtx {
  conn: SqlConnection;
  deps: Required<Pick<CollectorDeps, 'fetchers' | 'fingerprint' | 'planWindow'>> & { now: () => number; sleep: (ms: number) => Promise<void>; log: (l: string) => void };
  retry: RetryDeps;
  accountId: number;
  fingerprint: string;
  trigger: 'cron' | 'manual';
  deadlineMs: number;
  /** 새 페이지·새 작업 시작 마감(≤ deadlineMs). */
  pageDeadlineMs: number;
}

async function fetchFor(ctx: JobCtx, market: BrokerMarket, kind: BrokerRunKind, w: JobWindow): Promise<LedgerQueryResult> {
  const f = ctx.deps.fetchers[market];
  const opts: LedgerFetchOptions = {
    fingerprint: ctx.deps.fingerprint, maxPages: RUN_MAX_PAGES, maxCalls: RUN_MAX_KIS_CALLS, deadlineMs: ctx.pageDeadlineMs, now: ctx.deps.now,
  };
  if (kind === 'fills') return f.fills({ from: w.queryFrom, to: w.queryTo }, opts);
  if (kind === 'realized_pnl') return f.realizedPnl({ from: w.queryFrom, to: w.queryTo }, opts);
  return f.positions(opts);
}

/** 최종 UPDATE — DB 가 complete 를 CHECK 로 거부하면(4025) incomplete 로 낮춰 다시 쓴다. 그래도 안 되면 failed. */
async function finishSafely(ctx: JobCtx, runId: number, f: RunFinish, reasons: string[]): Promise<Exclude<JobStatus, 'halted' | 'skipped'>> {
  const attempts: RunFinish[] = [f];
  if (f.status === 'complete') attempts.push({ ...f, status: 'incomplete', error: runErrorText([f.error, 'db_check_rejected_complete']) });
  if (f.status !== 'failed') attempts.push({ ...f, status: 'failed', error: runErrorText([f.error, 'db_check_rejected']) });
  for (const a of attempts) {
    try {
      const ok = await finishRun(ctx.conn, runId, a);
      if (!ok) { reasons.push('run_closed_elsewhere'); return a.status; }
      if (a !== f) reasons.push(a.status === 'incomplete' ? 'db_check_rejected_complete' : 'db_check_rejected');
      return a.status;
    } catch (e) {
      if (errnoOf(e) === 4025) continue;   // ER_CONSTRAINT_FAILED — 한 단계 낮춰 다시
      reasons.push(`finish_${errCode(e)}`);
      return 'failed';   // run 은 running 으로 남고 다음 실행의 single-flight 가 10분 뒤 stale_running 으로 닫는다
    }
  }
  reasons.push('finish_rejected');
  return 'failed';
}

async function runJob(ctx: JobCtx, market: BrokerMarket, kind: BrokerRunKind, haltSince: string | null): Promise<JobReport> {
  const { conn } = ctx;
  if (ctx.deps.now() >= ctx.pageDeadlineMs) return emptyReport(market, kind, 'skipped', ['time_budget']);
  if (ctx.trigger === 'cron' && await isHalted(conn, ctx.accountId, market, kind, haltSince, ctx.fingerprint)) {
    ctx.deps.log(`[broker-fills] ${market}/${kind} halted — 연속 실패 3회, 자동 실행 중단(스위치를 끄고 다시 켜거나 수동 실행 성공으로 재개)`);
    return emptyReport(market, kind, 'halted', ['consecutive_failures']);
  }
  const startedMs = ctx.deps.now();
  const w = ctx.deps.planWindow(market, kind, startedMs);
  if (!w) return emptyReport(market, kind, 'skipped', ['before_ledger_start']);
  // L-c: 국내 3개월 TR 의 85일 밖 창은 KIS 도 run 행도 없이 건너뛴다(DDL chk_bfr_3m_tr 가 failed 행도 거부한다)
  if (market === 'domestic' && kind === 'fills' && !withinDomesticFillsTrWindow(w.queryFrom, kstDate(startedMs))) {
    return emptyReport(market, kind, 'skipped', ['outside_tr_window']);
  }
  const sourceTr = ctx.deps.fetchers.trId(market, kind);
  if (!sourceTrMatches(market, kind, sourceTr)) return emptyReport(market, kind, 'skipped', ['source_tr_unknown']);

  const run: NewRun = {
    accountId: ctx.accountId, accountFingerprint: ctx.fingerprint, market, kind, sourceTr, ...w,
    trigger: ctx.trigger, startedAt: kstDateTime(startedMs), positiveCheck: initialPositiveCheck(kind),
  };
  const runId = await insertRunningRun(conn, run);
  const rep = emptyReport(market, kind, 'failed');
  rep.runId = runId;

  const failWith = async (code: string, res?: LedgerQueryResult | null): Promise<JobReport> => {
    rep.reasons.push(code);
    rep.pages = res?.pages ?? 0;
    rep.kisCalls = res?.kisCalls ?? 0;
    rep.status = await finishSafely(ctx, runId, {
      status: 'failed', finishedAt: kstDateTime(ctx.deps.now()), lastTrCont: trContDbValue(res?.lastTrCont), sumCheck: 'pending',
      pages: rep.pages, kisCalls: rep.kisCalls, rowsSeen: 0, rowsInserted: 0, rowsUpdated: 0, rowsStaleSkipped: 0, duplicateKeys: 0,
      error: runErrorText([code]),
    }, rep.reasons);
    return rep;
  };

  const progress = { writes: 0 };
  try {
    return await runJobBody(ctx, market, kind, w, sourceTr, runId, rep, failWith, progress);
  } catch (e) {
    // 예상하지 못한 예외(프로그램 오류·연결 끊김) — running 으로 남기지 않는다. 이미 쓴 행이 있으면 incomplete(받은 행은 사실), 없으면 failed.
    const code = `job_exception_${errCode(e)}`;
    if (progress.writes === 0) return failWith(code);
    rep.reasons.push(code);
    rep.status = await finishSafely(ctx, runId, {
      status: 'incomplete', finishedAt: kstDateTime(ctx.deps.now()), lastTrCont: null, sumCheck: 'pending', pages: rep.pages, kisCalls: rep.kisCalls,
      rowsSeen: rep.rowsSeen, rowsInserted: rep.inserted, rowsUpdated: rep.updated, rowsStaleSkipped: rep.staleSkipped, duplicateKeys: rep.duplicateKeys,
      error: runErrorText([code]),
    }, rep.reasons);
    return rep;
  }
}

async function runJobBody(
  ctx: JobCtx, market: BrokerMarket, kind: BrokerRunKind, w: JobWindow, sourceTr: string, runId: number, rep: JobReport,
  failWith: (code: string, res?: LedgerQueryResult | null) => Promise<JobReport>, progress: { writes: number },
): Promise<JobReport> {
  const { conn } = ctx;
  let res: LedgerQueryResult;
  try {
    res = await fetchFor(ctx, market, kind, w);
  } catch (e) {
    return failWith(e instanceof RangeError ? 'fetch_range_error' : 'fetch_exception');
  }
  if (res.trId !== sourceTr) return failWith('source_tr_mismatch', res);
  if (res.queryFrom !== w.queryFrom || res.queryTo !== w.queryTo) return failWith(kind === 'position_snapshot' ? 'snapshot_date_mismatch' : 'query_range_mismatch', res);
  if (res.accountFingerprint != null && res.accountFingerprint !== ctx.fingerprint) return failWith('account_changed', res);
  if (res.outcome === 'skipped') return failWith(res.error ?? 'outside_tr_window', res);
  if (res.outcome === 'failed') return failWith(res.error ?? 'fetch_failed', res);
  if (res.accountFingerprint == null) return failWith('fingerprint_missing_in_result', res);

  // ── 정규화 → 응답 안 중복 제외 → 행마다 트랜잭션 upsert ──
  rep.pages = res.pages;
  rep.kisCalls = res.kisCalls;
  rep.rowsSeen = res.rows.length;
  const memo: string[] = [];
  const counts: Record<UpsertOutcome, number> = { inserted: 0, updated: 0, unchanged: 0, stale: 0, stale_conflict: 0 };
  let normalizeIssues: NormalizeIssue[] = [];
  let duplicateKeys = 0;
  let writeFailures = 0;
  // (Codex C2 High) 행 날짜가 조회 범위(국내 엄격·해외 ±1일 — normalize.rowDateBounds 근거) 밖이면 원장에 쓰지 않고 run 을 incomplete 로
  let rowsOutOfRange = 0;
  const bounds = rowDateBounds(market, kind, res.queryFrom, res.queryTo);
  const meta: UpsertMeta = { accountId: ctx.accountId, accountFingerprint: ctx.fingerprint, runId, seenAt: kstDateTime(ctx.deps.now()) };

  type Writer = { key: string; orderNo: string | null; write: (c: SqlConnection) => Promise<UpsertOutcome> };
  let writers: Writer[] = [];
  if (kind === 'fills') {
    const n = normalizeFills(res);
    normalizeIssues = n.issues;
    const d = splitByRowDate(n.items, (it) => it.row.order_date, bounds);
    rowsOutOfRange = d.outOfRange;
    const p = partitionDuplicates(d.inRange);
    duplicateKeys = p.duplicateKeys;
    writers = p.writable.map((it) => ({ key: it.key, orderNo: it.row.broker_order_no, write: (c) => upsertFill(c, it, meta) }));
  } else if (kind === 'realized_pnl') {
    const n = normalizeRealizedPnl(res);
    normalizeIssues = n.issues;
    const d = splitByRowDate(n.items, (it) => it.row.trade_date, bounds);
    rowsOutOfRange = d.outOfRange;
    const p = partitionDuplicates(d.inRange);
    duplicateKeys = p.duplicateKeys;
    writers = p.writable.map((it) => ({ key: it.key, orderNo: null, write: (c) => upsertRealizedPnl(c, it, meta) }));
  } else {
    const n = normalizePositionSnapshot(res, res.queryFrom);
    normalizeIssues = n.issues;
    const p = partitionDuplicates(n.items);
    duplicateKeys = p.duplicateKeys;
    writers = p.writable.map((it) => ({ key: it.key, orderNo: null, write: (c) => upsertPositionSnapshot(c, it, meta) }));
  }

  for (let i = 0; i < writers.length; i++) {
    if (ctx.deps.now() >= ctx.deadlineMs) {
      writeFailures += writers.length - i;
      memo.push('time_budget_writes');
      break;
    }
    const wr = writers[i];
    const tx = await inRowTx(conn, wr.write, ctx.retry);
    if (tx.ok) {
      counts[tx.value] += 1;
      if (tx.value === 'inserted' || tx.value === 'updated') progress.writes += 1;
      rep.inserted = counts.inserted; rep.updated = counts.updated; rep.unchanged = counts.unchanged; rep.staleSkipped = counts.stale + counts.stale_conflict;
      if (tx.value === 'stale') memo.push(wr.orderNo && SAFE_ORDER_NO.test(wr.orderNo) ? `stale:${wr.orderNo}` : 'stale');
      if (tx.value === 'stale_conflict') memo.push(wr.orderNo && SAFE_ORDER_NO.test(wr.orderNo) ? `stale_conflict:${wr.orderNo}` : 'stale_conflict');
      if (tx.value === 'updated' && kind === 'realized_pnl') memo.push('pnl_revised');
      if (tx.retries > 0) memo.push('lock_retried');
    } else {
      writeFailures += 1;
      memo.push(`write_${tx.error}${wr.orderNo && SAFE_ORDER_NO.test(wr.orderNo) ? `:${wr.orderNo}` : ''}`);
    }
  }

  const sum = checkSums(res);
  const assess = assessRunCompleteness({
    market, kind, sourceTr, fetchOutcome: res.outcome, lastTrCont: res.lastTrCont, sumCheck: sum.result,
    // 낡은 응답 건너뜀(stale)은 데이터 손실이 아니라 complete 를 막지 않는다. 가드가 **새 정보를 버린** 경우(stale_conflict)는 쓰기 실패처럼 센다 → incomplete.
    duplicateKeys, pages: res.pages, kisCalls: res.kisCalls, normalizeIssues: normalizeIssues.length, writeFailures: writeFailures + counts.stale_conflict,
    rowsOutOfRange, maxKisCalls: RUN_MAX_KIS_CALLS,
  });

  rep.inserted = counts.inserted;
  rep.updated = counts.updated;
  rep.unchanged = counts.unchanged;
  rep.staleSkipped = counts.stale + counts.stale_conflict;
  rep.duplicateKeys = duplicateKeys;
  rep.normalizeIssues = normalizeIssues.length;
  rep.writeFailures = writeFailures;
  const codeReasons = [
    ...(res.error ? [res.error] : []), ...assess.reasons, ...sum.reasons, ...issueSummary(normalizeIssues),
    ...(duplicateKeys ? [`duplicate_keys:${duplicateKeys}`] : []),
    ...(counts.stale_conflict ? ['stale_newer_info_discarded'] : []),
    ...(rowsOutOfRange ? [`row_out_of_range:${rowsOutOfRange}`] : []),   // 건수만(날짜 값 없음)
  ];
  // 응답용 사유는 코드만(주문번호 메모 제외)
  rep.reasons.push(...codeReasons, ...[...new Set(memo.map((x) => x.replace(/:[0-9A-Za-z]{1,20}$/, '')))]);

  rep.status = await finishSafely(ctx, runId, {
    status: assess.status, finishedAt: kstDateTime(ctx.deps.now()), lastTrCont: trContDbValue(res.lastTrCont), sumCheck: sum.result,
    pages: res.pages, kisCalls: res.kisCalls, rowsSeen: res.rows.length, rowsInserted: counts.inserted, rowsUpdated: counts.updated,
    rowsStaleSkipped: counts.stale + counts.stale_conflict, duplicateKeys, error: runErrorText([...codeReasons, ...memo]),
  }, rep.reasons);

  if (kind === 'position_snapshot' && rep.status === 'complete') {
    try {
      await markBaselineIfFirst(conn, ctx.accountId, market, res.queryFrom);
    } catch (e) {
      rep.reasons.push(`baseline_${errCode(e)}`);
    }
  }
  return rep;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 진입점
// ─────────────────────────────────────────────────────────────────────────────────────────────

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function collectBrokerLedger(deps: CollectorDeps, req: CollectRequest): Promise<CollectResult> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const log = deps.log ?? ((l: string) => console.log(l));
  const startMs = now();
  const deadlineMs = req.deadlineMs ?? startMs + ROUTE_TIME_BUDGET_MS;
  const accountId = req.accountId ?? 1;
  const markets = (req.markets ?? MARKETS).filter((m) => MARKETS.includes(m));
  const kinds = (req.kinds ?? KINDS).filter((k) => KINDS.includes(k));

  try {
    if (!(await ledgerTablesPresent(deps.db))) return { status: 'not_migrated' };
  } catch (e) {
    if (isLedgerTableMissing(e)) return { status: 'not_migrated' };
    throw e;
  }

  const sw = await readCronSwitch(deps.db);
  if (req.trigger === 'cron' && !sw.enabled) return { status: 'skipped', reason: 'switch_off', switchEnabled: false };

  const fp = await deps.accountFingerprint().catch(() => ({ ok: false as const, error: 'fingerprint_error' }));
  if (!fp.ok) return { status: 'preflight_failed', error: fp.error, switchEnabled: sw.enabled };
  if (!/^[0-9a-f]{16}$/.test(fp.fingerprint)) return { status: 'preflight_failed', error: 'fingerprint_invalid', switchEnabled: sw.enabled };

  const conn = await deps.db.getConnection();
  let locked = false;
  try {
    locked = await tryCollectorLock(conn);
    if (!locked) return { status: 'skipped', reason: 'in_progress', switchEnabled: sw.enabled };
    const running = await checkAndCloseRunning(conn, accountId, now());
    if (running.fresh > 0) return { status: 'skipped', reason: 'in_progress', switchEnabled: sw.enabled };

    const ctx: JobCtx = {
      conn, retry: { sleep, random: deps.random ?? Math.random }, accountId, fingerprint: fp.fingerprint, trigger: req.trigger, deadlineMs,
      pageDeadlineMs: Math.min(deadlineMs, startMs + PAGE_START_WINDOW_MS),
      deps: { fetchers: deps.fetchers, fingerprint: deps.fingerprint, planWindow: deps.planWindow ?? planJobWindow, now, sleep, log },
    };
    const haltSince = req.trigger === 'cron' ? sw.updatedAt : null;
    const jobs: JobReport[] = [];

    // L-d ①: 직전 성공 run 과 지문이 다르면 이번 계획 전부 failed(account_changed) — KIS 0, 원장 쓰기 0
    const prevFp = await lastSuccessfulFingerprint(conn, accountId);
    if (prevFp != null && prevFp !== fp.fingerprint) {
      for (const market of markets) {
        for (const kind of kinds) {
          if (req.trigger === 'cron' && await isHalted(conn, accountId, market, kind, haltSince, fp.fingerprint)) { jobs.push(emptyReport(market, kind, 'halted', ['consecutive_failures'])); continue; }
          const t = now();
          const w = ctx.deps.planWindow(market, kind, t);
          const tr = deps.fetchers.trId(market, kind);
          if (!w || !sourceTrMatches(market, kind, tr)) { jobs.push(emptyReport(market, kind, 'skipped', [w ? 'source_tr_unknown' : 'before_ledger_start'])); continue; }
          if (market === 'domestic' && kind === 'fills' && !withinDomesticFillsTrWindow(w.queryFrom, kstDate(t))) { jobs.push(emptyReport(market, kind, 'skipped', ['outside_tr_window'])); continue; }
          const id = await insertFailedRun(conn, {
            accountId, accountFingerprint: fp.fingerprint, market, kind, sourceTr: tr, ...w, trigger: req.trigger, startedAt: kstDateTime(t),
            positiveCheck: initialPositiveCheck(kind),
          }, 'account_changed');
          jobs.push({ ...emptyReport(market, kind, 'failed', ['account_changed']), runId: id });
        }
      }
      log(`[broker-fills] account_changed — 직전 성공 run 과 계좌 지문이 달라 수집하지 않음(KIS 0). 지문 재설정 절차는 설계 §2.3 L-d`);
      return { status: 'done', switchEnabled: sw.enabled, closedStale: running.closedStale, jobs };
    }

    let first = true;
    for (const market of markets) {
      for (const kind of kinds) {
        if (!first && jobs.length > 0 && jobs[jobs.length - 1].kisCalls > 0 && now() + BETWEEN_JOBS_SLEEP_MS < ctx.pageDeadlineMs) {
          await sleep(BETWEEN_JOBS_SLEEP_MS);
        }
        first = false;
        jobs.push(await runJob(ctx, market, kind, haltSince));
      }
    }
    const brief = jobs.map((j) => `${j.market}/${j.kind}=${j.status}(+${j.inserted}/~${j.updated}/=${j.unchanged}/stale${j.staleSkipped}/kis${j.kisCalls})`).join(' ');
    log(`[broker-fills] ${req.trigger} ${brief}`);
    return { status: 'done', switchEnabled: sw.enabled, closedStale: running.closedStale, jobs };
  } finally {
    // (감사 L3) 락을 풀지 못했으면(오류·결과 1 아님) 그 연결을 풀에 돌려주지 않고 폐기한다 — 락을 잡은 연결이 풀에 남아
    //   다른 코드가 그 연결을 재사용하면 다음 실행이 계속 in_progress 로 막힌다. 연결이 끊기면 서버가 락을 푼다.
    let released = !locked;
    if (locked) { try { released = await releaseCollectorLock(conn); } catch { released = false; } }
    if (!released && typeof conn.destroy === 'function') conn.destroy();
    else conn.release();
  }
}
