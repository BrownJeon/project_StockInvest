/**
 * T-108 청산 로직 지표 — 홈 3줄(X1·X3·X4) · 분석 › 검증·성과 X1~X6 (가이드 §2.3.5·§4.7, 계약 §11.2·§11.3).
 *
 * 원천: 장중 룰 평가 기록 `eval_funnel`(30일 롤링) — 청산 트랙 stage 21~29 · `gate='run'` 틱 행 · 청산 발화 `signal_created`
 * (`strategy_id='exit-engine-v1'`, stage 99) / 청산 시그널 `signals.strategy_id='exit-engine-v1'` ⋈ `orders`(consumed_order_id).
 *
 * 분류(계약 §11.3 그대로):
 *  - `exit_no_fire` = 정상 0(평가했고 조건 미충족) — 유일하게 0 으로 쓰는 상태
 *  - `exit_hard_stop_disabled` = 정책 스킵(손실한도 손절 OFF — 조건 충족 **종목 수**, 틱 수 아님 D12)
 *  - stage 21~24 의 `verdict='error'` = 데이터 이상 · `exit_create_failed` = 생성 실패
 *  - 발화 = `signal_created`(exit-engine-v1) 종목 수
 *  - 장외·휴장(그 시장 세션일 run 0행) = `off_hours` — 「이상 없음」과 다르다
 * 「오늘」 = 시장별 세션일(국내 KST 날짜, 해외 ET 날짜). 해외를 KST 자정으로 자르지 않는다.
 * 미리보기(`sell_proposal_preview`, stage 26)는 판정이 아니라 세지 않는다.
 */
import { AWAITING_APPROVAL_STATUSES } from '@/lib/signals/statuses';
import { EXIT_STRATEGY_ID } from '@/lib/strategy/exit-engine';
import { isTrailingActive } from './exit-zone';
import { readHoldings, readPositionStates, readStyle, summarizeZones } from './holdings';
import { metric } from './metric';
import { count, type OpsReader } from './read-only';
import {
  currentSessionDay, isSessionOpenAt, kstIso, kstSql, localDateOf, overseasOpenInfo, sessionHours,
  isTradingDay, toMs, type ClosedDays, type SessionDay,
} from './sessions';
import type {
  ByMarket, ExitDetail, ExitJudgmentCounts, ExitLines, ExitProposals, Market, Metric, SafetyStateDTO,
} from './types';

/** 장중인데 마지막 평가가 이보다 오래면 stale (계약 §11.2 X1). */
export const EXIT_RUN_STALE_MS = 15 * 60_000;
/** 연속 일수 창 — eval_funnel 보존 30일. */
export const STREAK_WINDOW_DAYS = 30;

const DATA_ERROR_GATES = new Set([
  'exit_avg_price_missing', 'exit_ticker_error', 'exit_price_invalid', 'exit_state_upsert_failed', 'exit_state_missing', 'exit_unit_mismatch',
  // T-134 — stage 23 error(position_state 조회 실패로 그 종목 평가를 건너뜀). 계약 §11.3 「stage 21~24 의 error = 데이터 이상」 그대로.
  'exit_state_load_failed',
]);

export const RUN_SUMMARY_SQL =
  `SELECT COUNT(*) AS n, MAX(ts) AS last_ts, SUM(reason = 'balances_unknown') AS bu
     FROM eval_funnel WHERE gate = 'run' AND market = ? AND ts >= ? AND ts < ?`;
export const LAST_RUN_SQL =
  `SELECT ts, reason FROM eval_funnel WHERE gate = 'run' AND market = ? AND ts >= ? AND ts < ? ORDER BY ts DESC LIMIT 1`;
export const EXIT_GATES_SQL =
  `SELECT gate, verdict, symbol, COUNT(*) AS n FROM eval_funnel
    WHERE market = ? AND ts >= ? AND ts < ? AND stage BETWEEN 21 AND 29
    GROUP BY gate, verdict, symbol`;
export const EXIT_FIRED_SQL =
  `SELECT COUNT(DISTINCT symbol) AS s FROM eval_funnel
    WHERE gate = 'signal_created' AND strategy_id = ? AND market = ? AND ts >= ? AND ts < ?`;
export const STREAK_SQL =
  `SELECT gate, DATE_FORMAT(ts, '%Y-%m-%d %H:00:00') AS h FROM eval_funnel
    WHERE gate IN ('run', 'exit_hard_stop_disabled') AND market = ? AND ts >= ?
    GROUP BY gate, h`;
export const EXIT_PROPOSALS_SQL =
  `SELECT s.status, s.created_at, s.expires_at, JSON_VALUE(s.indicators, '$.exit_kind') AS exit_kind,
          o.status AS ostatus, o.blocked_by
     FROM signals s LEFT JOIN orders o ON o.id = s.consumed_order_id
    WHERE s.market = ? AND s.created_at >= ? AND s.created_at < ? AND s.strategy_id = ?
    ORDER BY s.created_at ASC LIMIT 500`;
export const EXIT_PROPOSALS_LIMIT = 500;

export interface RunSummary { runs: number; lastMs: number | null; lastReason: string | null; balancesUnknown: number }

export async function readRunSummary(r: OpsReader, market: Market, day: SessionDay): Promise<RunSummary> {
  const p = [market, kstSql(day.startMs), kstSql(day.endMs)];
  const [sum, last] = await Promise.all([r.rows<Record<string, unknown>>(RUN_SUMMARY_SQL, p), r.rows<Record<string, unknown>>(LAST_RUN_SQL, p)]);
  const s = sum[0] ?? {};
  return {
    runs: count(s.n),
    lastMs: toMs(last[0]?.ts ?? s.last_ts),
    lastReason: last[0]?.reason == null ? null : String(last[0].reason),
    balancesUnknown: count(s.bu),
  };
}

/** X1 마지막 평가 — 순수. */
export function lastEvalMetric(market: Market, run: RunSummary, nowMs: number, closed: ReadonlySet<string> | null): ExitLines['lastEval']['domestic'] {
  const at = run.lastMs != null ? kstIso(run.lastMs) : null;
  if (!closed) {
    // 휴장표를 모르면 장중 여부를 추정하지 않는다 — 평가가 있으면 그 값, 없으면 모름.
    return run.runs > 0
      ? metric('available', { at, runsToday: run.runs, sessionOpen: false }, at, 'holidays_unknown')
      : metric('unknown', { at: null, runsToday: 0, sessionOpen: false }, null, 'holidays_unknown');
  }
  const open = isSessionOpenAt(market, nowMs, closed);
  const value = { at, runsToday: run.runs, sessionOpen: open };
  if (run.runs === 0) {
    if (!open) return metric('off_hours', value, null);
    const openMs = sessionHours(market, localDateOf(market, nowMs)).openMs;
    return nowMs - openMs > EXIT_RUN_STALE_MS ? metric('stale', value, null, 'no_runs') : metric('unknown', value, null, 'no_runs_yet');
  }
  if (run.lastReason === 'balances_unknown') return metric('error', value, at, 'balances_unknown');
  if (open && run.lastMs != null && nowMs - run.lastMs > EXIT_RUN_STALE_MS) return metric('stale', value, at, 'last_run_old');
  return metric('available', value, at);
}

/**
 * 연속 세션일 수 — 오늘부터 거꾸로, run 이 있었던 날(= 엔진이 돈 세션일)마다 hit 가 이어진 수. 순수.
 * run 이 없던 날(주말·휴장·러너 정지)은 건너뛴다. 창 안 모든 세션일이 hit 면 capped(「30일 이상」).
 */
export function consecutiveSessionDays(sessionDays: ReadonlySet<string>, hitDays: ReadonlySet<string>, today: string, windowStart: string): { days: number; capped: boolean } {
  const ordered = [...sessionDays].filter((d) => d <= today).sort().reverse();
  if (!hitDays.has(today)) return { days: 0, capped: false };
  let days = 0;
  for (const d of ordered) {
    if (!hitDays.has(d)) break;
    days++;
  }
  const oldest = ordered[ordered.length - 1];
  const capped = days === ordered.length && oldest != null && oldest <= windowStart;
  return { days, capped };
}

async function readStreak(r: OpsReader, market: Market, today: string): Promise<{ days: number; capped: boolean }> {
  const fromMs = r.nowMs - (STREAK_WINDOW_DAYS + 1) * 86_400_000;
  const rows = await r.rows<{ gate: unknown; h: unknown }>(STREAK_SQL, [market, kstSql(fromMs)]);
  const sessionDays = new Set<string>();
  const hitDays = new Set<string>();
  for (const row of rows) {
    const ms = toMs(row.h);
    if (ms == null) continue;
    const d = localDateOf(market, ms + 30 * 60_000);   // 시(hour) 칸의 가운데 — 해외 ET 날짜 경계는 장중에 없다
    if (String(row.gate) === 'run') sessionDays.add(d); else hitDays.add(d);
  }
  for (const d of hitDays) sessionDays.add(d);   // 스킵 행이 있으면 그날 엔진이 돌았다
  return consecutiveSessionDays(sessionDays, hitDays, today, localDateOf(market, r.nowMs - (STREAK_WINDOW_DAYS - 1) * 86_400_000));
}

export interface ExitGateSets {
  judged: Set<string>; noFire: Set<string>; hardStopOff: Set<string>; dataErrors: Set<string>; createFailed: Set<string>;
  engineOff: Set<string>; cooldown: Set<string>;
  hardStopOffTicks: number;
}

export function groupExitGates(rows: readonly { gate: unknown; verdict: unknown; symbol: unknown; n: unknown }[]): ExitGateSets {
  const g: ExitGateSets = {
    judged: new Set(), noFire: new Set(), hardStopOff: new Set(), dataErrors: new Set(), createFailed: new Set(),
    engineOff: new Set(), cooldown: new Set(), hardStopOffTicks: 0,
  };
  for (const row of rows) {
    const gate = String(row.gate);
    if (gate === 'sell_proposal_preview') continue;   // 미리보기는 판정이 아니다
    const sym = row.symbol == null ? null : String(row.symbol);
    if (!sym) continue;
    g.judged.add(sym);
    if (gate === 'exit_no_fire') g.noFire.add(sym);
    else if (gate === 'exit_hard_stop_disabled') { g.hardStopOff.add(sym); g.hardStopOffTicks += count(row.n); }
    else if (gate === 'exit_create_failed') g.createFailed.add(sym);
    else if (gate === 'exit_engine_disabled') g.engineOff.add(sym);
    else if (gate === 'cooldown_exit' || gate === 'exit_cooldown_5m') g.cooldown.add(sym);
    else if (String(row.verdict) === 'error' && DATA_ERROR_GATES.has(gate)) g.dataErrors.add(sym);
  }
  return g;
}

interface MarketExit { run: RunSummary; day: SessionDay; gates: ExitGateSets | null; fired: number; streak: { days: number; capped: boolean } }

async function readMarketExit(r: OpsReader, market: Market): Promise<MarketExit> {
  const day = currentSessionDay(market, r.nowMs);
  const run = await readRunSummary(r, market, day);
  if (run.runs === 0) return { run, day, gates: null, fired: 0, streak: { days: 0, capped: false } };
  const p = [market, kstSql(day.startMs), kstSql(day.endMs)];
  const [gateRows, firedRows] = await Promise.all([
    r.rows<{ gate: unknown; verdict: unknown; symbol: unknown; n: unknown }>(EXIT_GATES_SQL, p),
    r.rows<{ s: unknown }>(EXIT_FIRED_SQL, [EXIT_STRATEGY_ID, ...p]),
  ]);
  const gates = groupExitGates(gateRows);
  const streak = gates.hardStopOff.size > 0 ? await readStreak(r, market, day.ref.sessionDate) : { days: 0, capped: false };
  return { run, day, gates, fired: count(firedRows[0]?.s), streak };
}

/**
 * 그 시장 오늘 run 0행일 때의 상태 — 가동 줄(X1 lastEval)과 **같은 판정**을 쓴다(한 화면에서 「장외」와 「오래됨」이 엇갈리지 않게).
 * 장외 → off_hours · 개장 중 15분 이내 → unknown(no_runs_yet) · 넘으면 stale(no_runs) · 휴장표 모름 → unknown(holidays_unknown).
 */
export function noRunMetric<T>(lastEval: ExitLines['lastEval']['domestic']): Metric<T> {
  if (lastEval.state === 'off_hours') return metric<T>('off_hours', null, null);
  if (lastEval.state === 'stale') return metric<T>('stale', null, null, lastEval.reason ?? 'no_runs');
  return metric<T>('unknown', null, null, lastEval.reason ?? 'no_runs');
}

function judgmentMetric(x: MarketExit, trailingActive: number | null, lastEval: ExitLines['lastEval']['domestic']): Metric<ExitJudgmentCounts> {
  if (!x.gates) return noRunMetric<ExitJudgmentCounts>(lastEval);
  const g = x.gates;
  const v: ExitJudgmentCounts = {
    noFire: g.noFire.size, hardStopOffHit: g.hardStopOff.size, hardStopOffDays: x.streak.days, dataErrors: g.dataErrors.size,
    fired: x.fired, trailingActive: trailingActive ?? 0, hardStopOffTicks: g.hardStopOffTicks, hardStopOffDaysCapped: x.streak.capped,
    createFailed: g.createFailed.size, engineOffHit: g.engineOff.size, cooldown: g.cooldown.size,
  };
  const at = x.run.lastMs != null ? kstIso(x.run.lastMs) : null;
  // 「확인된 0」은 정상 0(exit_no_fire)뿐일 때만 — 정책 스킵(엔진 꺼짐 틱·쿨다운)·데이터 이상·생성 실패·발화가 하나라도 있으면 아니다.
  const quiet = v.hardStopOffHit + v.fired + v.dataErrors + v.createFailed + v.engineOffHit + v.cooldown === 0;
  // 30일 보존 한정 — 영구 기록은 T-126. 트레일링 활성 수를 못 읽었으면 partial.
  if (trailingActive == null) return metric('partial', v, at, 'trailing_unknown');
  return metric(quiet ? 'zero' : 'available', v, at, 'retention_30d');
}

/**
 * X4 — 오늘(시장별 세션일) 청산 시그널과 그 주문. 순수.
 * 시그널 1건은 **정확히 한 칸**에 들어간다(합 = total): 주문이 붙었으면 주문 상태로(가상·모든거래차단·체결·송신·그 밖),
 * 없으면 시그널 상태로(승인 대기(만료 전)·만료(상태 expired 또는 승인 대기인데 만료 시각 지남)·거절·그 밖).
 * submittedLive 는 체결(filled)을 포함한 「실제 송신」 수라 칸 합에는 filled 를 한 번만 넣는다.
 */
export function summarizeProposals(rows: readonly Record<string, unknown>[], nowMs: number): ExitProposals {
  const awaiting = new Set<string>(AWAITING_APPROVAL_STATUSES);
  const p: ExitProposals = {
    total: rows.length, virtual: 0, awaitingApproval: 0, submittedLive: 0, blockedByKill: 0, filled: 0,
    firstKind: null, firstAt: null, expired: 0, rejected: 0, other: 0,
  };
  let firstVirtual: { at: number; kind: string | null } | null = null;
  let firstAny: { at: number; kind: string | null } | null = null;
  for (const row of rows) {
    const at = toMs(row.created_at);
    const kind = row.exit_kind == null ? null : String(row.exit_kind);
    const st = String(row.status);
    const os = row.ostatus == null ? null : String(row.ostatus);
    if (at != null && (!firstAny || at < firstAny.at)) firstAny = { at, kind };
    if (os != null) {
      if (os === 'dry_run') {
        p.virtual++;
        if (at != null && (!firstVirtual || at < firstVirtual.at)) firstVirtual = { at, kind };
      } else if (os === 'blocked' && String(row.blocked_by) === 'kill_switch') p.blockedByKill++;
      else if (os === 'filled' || os === 'partially_filled') { p.filled++; p.submittedLive++; }
      else if (os === 'accepted' || os === 'cancelled' || os === 'rejected') p.submittedLive++;
      else p.other++;
      continue;
    }
    if (awaiting.has(st)) {
      const exp = toMs(row.expires_at);
      if (exp == null || exp >= nowMs) p.awaitingApproval++; else p.expired++;
    } else if (st === 'expired') p.expired++;
    else if (st === 'rejected') p.rejected++;
    else p.other++;
  }
  const first = firstVirtual ?? firstAny;
  if (first) { p.firstKind = first.kind; p.firstAt = kstIso(first.at); }
  return p;
}

async function readProposals(r: OpsReader): Promise<Metric<ExitProposals>> {
  const one = async (m: Market) => {
    const day = currentSessionDay(m, r.nowMs);
    return r.rows<Record<string, unknown>>(EXIT_PROPOSALS_SQL, [m, kstSql(day.startMs), kstSql(day.endMs), EXIT_STRATEGY_ID]);
  };
  const [d, o] = await Promise.all([one('domestic'), one('overseas')]);
  const rows = [...d, ...o];
  const p = summarizeProposals(rows, r.nowMs);
  // 상한에 닿으면 잘린 것 — 숫자는 하한이다.
  if (d.length >= EXIT_PROPOSALS_LIMIT || o.length >= EXIT_PROPOSALS_LIMIT) return metric('partial', p, kstIso(r.nowMs), 'truncated');
  return metric(p.total > 0 ? 'available' : 'zero', p, kstIso(r.nowMs));
}

function engineMetric(safety: SafetyStateDTO): Metric<{ enabled: boolean; hardStopEnabled: boolean }> {
  const e = safety.exitEngine;
  if (!e || e.source === 'db_error') return metric<{ enabled: boolean; hardStopEnabled: boolean }>('error', null, safety.readAt, 'exit_switch_db_error');
  return metric('available', { enabled: e.enabled, hardStopEnabled: e.hardStopEnabled }, safety.readAt, e.source === 'config' ? undefined : e.source);
}

/** 시장별 트레일링 활성 종목 수(position_state 고점 ≥ 활성 임계). 실패하면 null. */
async function readTrailingActive(r: OpsReader): Promise<ByMarket<number> | null> {
  try {
    const [states, style] = await Promise.all([readPositionStates(r), readStyle(r)]);
    const out: ByMarket<number> = { domestic: 0, overseas: 0 };
    for (const s of states.values()) if (isTrailingActive(s.entry, s.peak, style.thresholds.trailingActivatePct)) out[s.market]++;
    return out;
  } catch {
    return null;
  }
}

export interface ExitRead { lines: ExitLines; markets: ByMarket<MarketExit> }

export async function readExitLines(r: OpsReader, closed: ClosedDays, safety: SafetyStateDTO): Promise<ExitRead> {
  const [d, o, proposals, trailing] = await Promise.all([
    readMarketExit(r, 'domestic'), readMarketExit(r, 'overseas'), readProposals(r), readTrailingActive(r),
  ]);
  const ov = closed.overseas ? overseasOpenInfo(r.nowMs, closed.overseas) : { next: null, change: null };
  const engine = engineMetric(safety);
  const engineOff = engine.state === 'available' && engine.value?.enabled === false;
  const lastEval = { domestic: lastEvalMetric('domestic', d.run, r.nowMs, closed.domestic), overseas: lastEvalMetric('overseas', o.run, r.nowMs, closed.overseas) };
  const judg = (x: MarketExit, m: Market): Metric<ExitJudgmentCounts> =>
    engineOff ? metric<ExitJudgmentCounts>('blocked', null, null, 'engine_off') : judgmentMetric(x, trailing ? trailing[m] : null, lastEval[m]);
  const lines: ExitLines = {
    engine,
    lastEval,
    nextOverseasOpenKst: ov.next ? kstIso(ov.next.openMs) : null,
    nextOverseasOpenChange: ov.change,
    judgments: { domestic: judg(d, 'domestic'), overseas: judg(o, 'overseas') },
    // 엔진 OFF 면 「청산 제안 0」은 확인된 0 이 아니라 엔진 꺼짐이다(가이드 §2.3.5). 기록이 있으면(과거 틱) 그대로 보인다.
    proposals: engineOff && proposals.state === 'zero' ? metric<ExitProposals>('blocked', null, null, 'engine_off') : proposals,
  };
  return { lines, markets: { domestic: d, overseas: o } };
}

/** X6 — 국내 오늘 장중 5분 슬롯 기대치 − run 행 수(근사). 순수. */
export function gapMetric(run: RunSummary, nowMs: number, closed: ReadonlySet<string> | null): ExitDetail['gap'] {
  if (!closed) return metric('unknown', null, null, 'holidays_unknown');
  const d = localDateOf('domestic', nowMs);
  if (!isTradingDay('domestic', d, closed)) return metric('off_hours', null, null);
  const { openMs, closeMs } = sessionHours('domestic', d);
  if (nowMs < openMs) return metric('off_hours', null, null);
  const expectedSlots = Math.floor((Math.min(nowMs, closeMs) - openMs) / (5 * 60_000));
  const gap = Math.max(0, expectedSlots - run.runs);
  return metric('prep', { expectedSlots, runs: run.runs, gap, balancesUnknown: run.balancesUnknown }, run.lastMs != null ? kstIso(run.lastMs) : null, 'approx_until_t112');
}

export async function readExitDetail(r: OpsReader, closed: ClosedDays, safety: SafetyStateDTO): Promise<ExitDetail> {
  const [{ lines, markets }, states, holdings] = await Promise.all([
    readExitLines(r, closed, safety),
    readPositionStates(r),
    readHoldings(r, closed).then((h) => h, () => null),
  ]);
  const coverage = (m: Market): Metric<{ positions: number; evaluated: number; dataErrors: number; notEvaluated: number }> => {
    const x = markets[m];
    const held = [...states.entries()].filter(([, v]) => v.market === m).map(([k]) => k.split('|')[1]);
    if (!x.gates) {
      const base = noRunMetric<{ positions: number; evaluated: number; dataErrors: number; notEvaluated: number }>(lines.lastEval[m]);
      return { ...base, value: { positions: held.length, evaluated: 0, dataErrors: 0, notEvaluated: held.length } };
    }
    const at = x.run.lastMs != null ? kstIso(x.run.lastMs) : null;
    if (held.length === 0) return metric('zero', { positions: 0, evaluated: 0, dataErrors: 0, notEvaluated: 0 }, at);
    const evaluated = held.filter((s) => x.gates!.judged.has(s)).length;
    return metric('available', { positions: held.length, evaluated, dataErrors: x.gates.dataErrors.size, notEvaluated: held.length - evaluated }, at);
  };
  let zones: ExitDetail['zones'];
  if (!holdings) zones = metric('error', null, null, 'holdings_error');
  else {
    const z = summarizeZones(holdings.rows);
    const v = { hardStop: z.hard_stop, eodCut: z.eod_cut, takeProfit: z.take_profit, trailingActive: z.trailing_active, neutral: z.neutral, notEvaluated: z.not_evaluated, snapshotAt: holdings.snapshotAt };
    zones = metric(holdings.stale ? 'stale' : holdings.rows.length === 0 ? 'zero' : 'available', v, holdings.snapshotAt, holdings.stale ? 'snapshot_old' : undefined);
  }
  return { ...lines, coverage: { domestic: coverage('domestic'), overseas: coverage('overseas') }, zones, gap: gapMetric(markets.domestic.run, r.nowMs, closed.domestic) };
}

