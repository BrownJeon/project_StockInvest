/**
 * T-108 장마감 AI 분석 1회(시장별 마지막 세션) — 홈 A1·A2 · 오늘의 분석 표 · 분석 › 오늘 분석 (가이드 §4.7 A1·A2, §2.3.6).
 *
 * 원천:
 *  - 실행 기록 `job_run_log`(T-112): `job_id='post-market-{domestic|overseas}'` · `recorder IN ('runner_hook','route')` 의
 *    가장 최근 슬롯 1행 → 상태·`counts_json.evaluated`·`counts_json.candidates`. 롤업 행(`runner_rollup`)은 보지 않는다.
 *  - 시그널 `signals`: `scenario_source='post-market'` ∧ 시장 ∧ 실행 시작 ~ +2시간(행이 없으면 예정 슬롯 ~ +2시간) — 상태별 건수.
 *  - 판단 기록(T-112, 헤더·후보 표 — `judgment-read.ts` 가 유일한 reader): baseline ∧ 운영 릴리스 행만(개발 서버 행 제외).
 *    같은 창 안 최근 1회. 헤더 후보 수 ≠ 패턴 있는 후보 행 수면 불완전 → `partial`.
 *
 * 「0」 규칙(가이드 §2.3.3·§4.7): 실행 상태가 `ok` 일 때만 0 을 `zero` 로 쓴다. 실행을 모르면 시그널 0 을 0 으로 쓰지 않는다.
 * 첫 배포 상태: 테이블 없음(1146) → `prep:not_migrated` · 기록 스위치 꺼짐 → `prep:record_off` · 켜짐 + 행 없음 → `unknown`.
 *
 * 슬롯·창은 `JOB_SPECS`(records/job-slots)에서 읽는다 — 화면·여기 상수로 16:00·08:00 을 박지 않는다.
 */
import { AWAITING_APPROVAL_STATUSES, sqlStatusList } from '@/lib/signals/statuses';
import { specFor } from '@/lib/strategy/records/job-slots';
import { readRecordSwitchState, type RecordSwitchKey } from '@/lib/strategy/records/record-switch';
import { etDateOf } from '@/lib/strategy/us-session';
import { readJudgmentHeader } from './judgment-read';
import { counted, errorMetric, metric, prepMetric, staleIf, unknownMetric } from './metric';
import { count, num, OpsQueryError, parseJsonObject, type OpsReader } from './read-only';
import {
  isTradingDay, kstDateOf, kstIso, kstSql, lastDailySlotMs, nextDailySlotMs, sessionRef, toMs, type ClosedDays,
} from './sessions';
import type { AnalysisRunRow, ByMarket, Market, Metric } from './types';

export const POST_MARKET_JOB: Readonly<Record<Market, string>> = {
  domestic: 'post-market-domestic',
  overseas: 'post-market-overseas',
};
/** 실행 시작 뒤 이 시간 안에 생긴 장마감 시그널을 그 실행의 것으로 본다(가이드 §4.7 A2). */
export const ANALYSIS_SIGNAL_WINDOW_MS = 2 * 3600_000;
/** 슬롯 창(windowMin) 뒤 이만큼 더 기다려도 행이 없으면 「그 슬롯 기록 없음」. 분석이 길게 도는 날의 여유. */
export const ANALYSIS_ROW_GRACE_EXTRA_MIN = 30;

const AWAITING = sqlStatusList(AWAITING_APPROVAL_STATUSES);

export const LAST_JOB_ROW_SQL =
  `SELECT status, scheduled_slot_at, started_at, counts_json, degraded_reason,
          DATE_FORMAT(session_date_kst, '%Y-%m-%d') AS sdk, DATE_FORMAT(session_date_et, '%Y-%m-%d') AS sde
     FROM job_run_log
    WHERE job_id = ? AND recorder IN ('runner_hook', 'route')
    ORDER BY scheduled_slot_at DESC, started_at DESC LIMIT 1`;

export const RUN_SIGNALS_SQL =
  `SELECT status, COUNT(*) AS n,
          SUM(status IN (${AWAITING}) AND (expires_at IS NULL OR expires_at >= ?)) AS live_pending
     FROM signals
    WHERE market = ? AND created_at >= ? AND created_at < ? AND scenario_source = 'post-market'
    GROUP BY status`;

type JobStatus = NonNullable<AnalysisRunRow['runStatus']>;
const JOB_STATUSES: readonly JobStatus[] = ['ok', 'partial', 'failed', 'skipped', 'missing', 'degraded'];

export interface JobRowView {
  status: JobStatus;
  slotMs: number | null;
  startedMs: number | null;
  counts: Record<string, unknown> | null;
  degradedReason: string | null;
  sessionKst: string | null;
  sessionEt: string | null;
}

/** 기록 없음의 이유 — 표·스위치 상태로 갈린다. */
export type NoRowReason = 'not_migrated' | 'record_off' | 'no_record' | 'switch_unknown';

export async function noRowReason(key: RecordSwitchKey, tableMissing: boolean): Promise<NoRowReason> {
  if (tableMissing) return 'not_migrated';
  const s = await readRecordSwitchState(key);
  if (s.enabled) return 'no_record';
  return s.source === 'missing' || s.source === 'value' ? 'record_off' : 'switch_unknown';
}

/** 「기록 없음」 이유 → 지표 상태. prep = 준비 중, 그 밖 = 모름. */
export function noRowMetric<T>(why: NoRowReason): Metric<T> {
  return why === 'not_migrated' || why === 'record_off' ? prepMetric<T>(why) : unknownMetric<T>(why);
}

export async function readLastJobRow(r: OpsReader, jobId: string): Promise<{ row: JobRowView | null; tableMissing: boolean }> {
  let rows: Record<string, unknown>[];
  try {
    rows = await r.rows(LAST_JOB_ROW_SQL, [jobId]);
  } catch (e) {
    if (e instanceof OpsQueryError && e.code === 'not_migrated') return { row: null, tableMissing: true };
    throw e;
  }
  const x = rows[0];
  if (!x) return { row: null, tableMissing: false };
  const status = String(x.status) as JobStatus;
  if (!JOB_STATUSES.includes(status)) return { row: null, tableMissing: false };
  return {
    row: {
      status,
      slotMs: toMs(x.scheduled_slot_at),
      startedMs: toMs(x.started_at),
      counts: parseJsonObject(x.counts_json),
      degradedReason: x.degraded_reason == null ? null : String(x.degraded_reason),
      sessionKst: typeof x.sdk === 'string' ? x.sdk : null,
      sessionEt: typeof x.sde === 'string' ? x.sde : null,
    },
    tableMissing: false,
  };
}

export interface JudgmentView {
  kind: 'none' | 'found';
  id?: number;
  why?: NoRowReason;
  buy?: number; withPattern?: number; candidateCount?: number;
  top?: { code: string; count: number } | null;
  startedMs?: number | null;
}

async function readJudgment(r: OpsReader, market: Market, startMs: number, endMs: number): Promise<JudgmentView> {
  const h = await readJudgmentHeader(r, market, startMs, endMs);
  if (h.kind === 'not_migrated') return { kind: 'none', why: 'not_migrated' };
  if (h.kind === 'none') return { kind: 'none', why: await noRowReason('judgment_record_enabled', false) };
  return { kind: 'found', id: h.id, buy: h.buy, withPattern: h.withPattern, candidateCount: h.candidateCount, top: h.top, startedMs: h.startedMs };
}

interface SignalCounts { created: number; blocked: number; pending: number }

async function readRunSignals(r: OpsReader, market: Market, startMs: number, endMs: number): Promise<SignalCounts> {
  const rows = await r.rows<Record<string, unknown>>(RUN_SIGNALS_SQL, [kstSql(r.nowMs), market, kstSql(startMs), kstSql(endMs)]);
  const out: SignalCounts = { created: 0, blocked: 0, pending: 0 };
  for (const row of rows) {
    const n = count(row.n);
    out.created += n;
    if (String(row.status) === 'skipped') out.blocked += n;
    out.pending += count(row.live_pending);
  }
  return out;
}

/**
 * 건너뜀 사유 코드. classifyRun 이 200 건너뜀을 `skip:<코드>`(코드 없으면 'skip')로 적는다 — 접두를 떼고 분류어만 돌려준다.
 * 관측된 코드: 국내 weekend · 해외 overseas_disabled·overseas_market_disabled·us_session_open·no_new_session.
 * (해외의 데이터 모름 503 — holidays_unknown·fx_unknown 등 — 은 skipped 가 아니라 failed 로 기록되어 failReason 으로 온다.)
 */
export function skipReasonOf(degraded: string | null): string | null {
  if (!degraded) return null;
  const m = /^skip:([a-z][a-z0-9_]{0,47})$/.exec(degraded);
  if (m) return m[1];
  return /^[a-z][a-z0-9_]{0,47}$/.test(degraded) && degraded !== 'skip' ? degraded : null;
}

/** counts_json 의 숫자 키 하나 — 없으면 null(0 아님). */
function countKey(c: Record<string, unknown> | null, key: string): number | null {
  if (!c) return null;
  const n = num(c[key]);
  return n == null || n < 0 ? null : Math.trunc(n);
}

export interface AnalysisRunsResult {
  rows: ByMarket<AnalysisRunRow>;
  /** 마지막 예정 슬롯에 기록이 없으면 그 슬롯 시각(ISO) — 확인 필요 #9 */
  slotUnrecorded: ByMarket<string | null>;
  /** 두 시장 모두 실행 기록 행이 있는가 — A4 「분석 실패」를 알 수 있는가 */
  bothRecorded: boolean;
  /** 시장별 그 실행의 시그널 창·판단 기록(분석 › 오늘 분석의 후보 목록이 같은 창을 쓴다) */
  windows: ByMarket<{ startMs: number; endMs: number; judgment: JudgmentView }>;
}

/**
 * 순수 조립 — 시험(A-6)이 상태 규칙을 이 함수로 본다.
 * job: 실행 기록 1행(없으면 null) · why: 행이 없을 때의 이유 · stale: 행이 마지막 예정 슬롯보다 오래됐는가.
 */
export function buildRunRow(input: {
  market: Market;
  sessionDate: string;
  job: JobRowView | null;
  why: NoRowReason | null;
  stale: boolean;
  signals: SignalCounts;
  judgment: JudgmentView;
  nextRunAt: string | null;
}): AnalysisRunRow {
  const { market, sessionDate, job, why, stale, signals, judgment } = input;
  const asOf = job?.startedMs != null ? kstIso(job.startedMs) : null;
  const status = job?.status ?? null;
  // 건너뜀 사유 코드 — 실행 기록 degraded_reason 'skip:<코드>' 에서 접두를 뗀다(classifyRun 규칙). 'skip' 만이면 모름(null).
  const skipCode = status === 'skipped' ? skipReasonOf(job?.degradedReason ?? null) : null;
  const failReason = status === 'failed' || status === 'degraded' || status === 'partial' ? job?.degradedReason ?? null : null;
  const completed = status === 'ok' || status === 'partial' || status === 'degraded';

  // 실행 기록 기반 지표(평가 종목·규칙 후보) — 상태 게이트를 먼저 본다.
  const fromCounts = (key: string, zeroIsError: boolean): Metric<number> => {
    if (!job) return noRowMetric<number>(why ?? 'no_record');
    if (status === 'failed') return errorMetric<number>('run_failed');
    if (status === 'skipped') return metric<number>('off_hours', null, asOf, skipCode ?? 'skipped');
    if (status === 'missing') return unknownMetric<number>('run_missing', asOf);
    const v = countKey(job.counts, key);
    if (v == null) return unknownMetric<number>('no_counts', asOf);
    if (v === 0) {
      if (zeroIsError) return metric<number>('error', 0, asOf, 'evaluated_zero');
      return status === 'ok' ? metric<number>('zero', 0, asOf) : metric<number>('partial', 0, asOf, status ?? undefined);
    }
    return status === 'ok' ? metric<number>('available', v, asOf) : metric<number>('partial', v, asOf, status ?? undefined);
  };

  const evaluated = fromCounts('evaluated', true);
  const ruleCandidates = fromCounts('candidates', false);

  // 시그널 — 사실(행)이 있으면 그 수는 맞다. 0 은 실행이 ok 일 때만 「확인된 0」.
  const candidatesKnown = ruleCandidates.state === 'available' || ruleCandidates.state === 'zero' || ruleCandidates.state === 'partial';
  let signalsCreated: Metric<number>;
  if (signals.created > 0) {
    // 시그널 행은 사실이다 — 다만 실행이 ok 이고 후보 수까지 있을 때만 「완전」.
    if (status === 'ok' && candidatesKnown) signalsCreated = metric<number>('available', signals.created, asOf);
    else if (status === 'partial' || status === 'degraded') signalsCreated = metric<number>('partial', signals.created, asOf, status);
    else signalsCreated = metric<number>('partial', signals.created, asOf, status === 'failed' ? 'run_failed' : 'no_candidate_counts');
  } else if (status === 'ok') {
    signalsCreated = metric<number>('zero', 0, asOf);
  } else if (status === 'skipped') {
    signalsCreated = metric<number>('off_hours', null, asOf, skipCode ?? 'skipped');
  } else if (completed) {
    signalsCreated = metric<number>('partial', 0, asOf, status ?? undefined);
  } else if (!job) {
    signalsCreated = noRowMetric<number>(why ?? 'no_record');
  } else {
    signalsCreated = unknownMetric<number>(status === 'failed' ? 'run_failed' : 'run_missing', asOf);
  }
  const sigKnown = signalsCreated.state === 'available' || signalsCreated.state === 'zero' || signalsCreated.state === 'partial';
  const sub = (n: number): Metric<number> => (sigKnown && signalsCreated.value != null ? counted(n, asOf) : { ...signalsCreated, value: null });
  const signalsBlocked = sub(signals.blocked);
  const signalsPending = sub(signals.pending);

  // 판단 기록 — AI 매수 판단·제외 사유 1위.
  let aiBuy: Metric<number>;
  let topExclusion: AnalysisRunRow['topExclusion'];
  if (status === 'skipped') {
    aiBuy = metric<number>('off_hours', null, asOf, skipCode ?? 'skipped');
    topExclusion = metric('off_hours', null, asOf, skipCode ?? 'skipped');
  } else if (judgment.kind === 'none') {
    aiBuy = noRowMetric<number>(judgment.why ?? 'no_record');
    topExclusion = noRowMetric(judgment.why ?? 'no_record');
  } else {
    const jAsOf = judgment.startedMs != null ? kstIso(judgment.startedMs) : asOf;
    const incomplete = (judgment.withPattern ?? 0) !== (judgment.candidateCount ?? 0);
    const buy = judgment.buy ?? 0;
    aiBuy = incomplete ? metric<number>('partial', buy, jAsOf, 'incomplete_candidates') : counted(buy, jAsOf);
    const t = judgment.top;
    topExclusion = t
      ? metric(incomplete ? 'partial' : 'available', { code: t.code, label: t.code, count: t.count }, jAsOf, incomplete ? 'incomplete_candidates' : undefined)
      : metric(incomplete ? 'partial' : 'zero', null, jAsOf, incomplete ? 'incomplete_candidates' : 'no_exclusion');
  }

  const S = 'older_than_last_slot';
  return {
    session: sessionRef(market, sessionDate),
    runStartedAt: asOf,
    runStatus: status,
    skipReason: skipCode,
    failReason,
    evaluated: staleIf(evaluated, stale, S),
    ruleCandidates: staleIf(ruleCandidates, stale, S),
    aiBuy: staleIf(aiBuy, stale, S),
    signalsCreated: staleIf(signalsCreated, stale, S),
    signalsBlocked: staleIf(signalsBlocked, stale, S),
    signalsPending: staleIf(signalsPending, stale, S),
    topExclusion: staleIf(topExclusion, stale, S),
    nextRunAt: input.nextRunAt,
  };
}

/** 다음 분석 시각 — 그 슬롯이 새 세션을 분석하는 날만(국내 = KST 거래일, 해외 = 슬롯 시점 ET 날짜가 미국 거래일). 휴장표 모르면 null. */
export function nextAnalysisAt(market: Market, nowMs: number, closed: ClosedDays): string | null {
  const spec = specFor(POST_MARKET_JOB[market]);
  const set = closed[market];
  if (!spec?.slotTime || !set) return null;
  const pred = market === 'domestic'
    ? (s: number) => isTradingDay('domestic', kstDateOf(s), set)
    : (s: number) => isTradingDay('overseas', etDateOf(new Date(s)), set);
  const s = nextDailySlotMs(spec.slotTime, nowMs, pred);
  return s == null ? null : kstIso(s);
}

async function readOne(r: OpsReader, market: Market, closed: ClosedDays): Promise<{ row: AnalysisRunRow; unrecordedSlot: string | null; recorded: boolean; window: { startMs: number; endMs: number; judgment: JudgmentView } }> {
  const jobId = POST_MARKET_JOB[market];
  const spec = specFor(jobId);
  if (!spec?.slotTime || !spec.windowMin) throw new Error(`job spec 없음: ${jobId}`);
  const lastSlot = lastDailySlotMs(spec.slotTime, r.nowMs, spec.windowMin + ANALYSIS_ROW_GRACE_EXTRA_MIN);

  const { row: job, tableMissing } = await readLastJobRow(r, jobId);
  const why = job ? null : await noRowReason('job_run_log_enabled', tableMissing);
  const stale = !!job && job.slotMs != null && job.slotMs < lastSlot;

  const baseMs = job ? (job.startedMs ?? job.slotMs ?? lastSlot) : lastSlot;
  const winEnd = baseMs + ANALYSIS_SIGNAL_WINDOW_MS;
  const sessionDate = job
    ? (market === 'domestic' ? job.sessionKst : job.sessionEt) ?? (market === 'domestic' ? kstDateOf(job.slotMs ?? baseMs) : etDateOf(new Date(job.slotMs ?? baseMs)))
    : (market === 'domestic' ? kstDateOf(lastSlot) : etDateOf(new Date(lastSlot)));

  const [signals, judgment] = await Promise.all([
    readRunSignals(r, market, baseMs, winEnd),
    readJudgment(r, market, baseMs, winEnd),
  ]);
  const row = buildRunRow({ market, sessionDate, job, why, stale, signals, judgment, nextRunAt: nextAnalysisAt(market, r.nowMs, closed) });
  return { row, unrecordedSlot: !job || stale ? kstIso(lastSlot) : null, recorded: !!job, window: { startMs: baseMs, endMs: winEnd, judgment } };
}

export async function readAnalysisRuns(r: OpsReader, closed: ClosedDays): Promise<AnalysisRunsResult> {
  const [d, o] = await Promise.all([readOne(r, 'domestic', closed), readOne(r, 'overseas', closed)]);
  return {
    rows: { domestic: d.row, overseas: o.row },
    slotUnrecorded: { domestic: d.unrecordedSlot, overseas: o.unrecordedSlot },
    bothRecorded: d.recorded && o.recorded,
    windows: { domestic: d.window, overseas: o.window },
  };
}
