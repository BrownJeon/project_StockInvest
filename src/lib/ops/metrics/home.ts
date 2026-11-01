/**
 * T-108 `GET /api/ops/home` 본체 → `HomeDTO` (가이드 §4.3 · §2.3).
 *
 * 1. 안전 상태(같은 판독기)를 한 번 읽어 단계를 정하고 지표 세트를 고른다 — observe|halt|unknown → 관찰 세트 A, mixed|live → 실거래 세트 B.
 * 2. 섹션을 병렬로 읽는다(`section()` — 한 섹션 실패는 그 섹션만 error, HTTP 200).
 * 3. 「확인 필요」는 그 입력(건수·주문 문제·청산·분석·데이터 이상) 중 하나라도 실패하면 **목록 대신 error** — 빈 목록이
 *    「지금 확인할 것 없음」으로 읽히는 것을 막는다. 단계 unknown 이면 맨 앞에 safety_unknown 줄. 빈 상태 문장의 항목별 근거는 checkCoverage.
 * 4. 데이터 이상(A4)은 **모든 단계에서** 계산한다(실거래 단계에서 스냅샷 정체·수집 실패가 가장 필요한 신호 — Reviewer R-DATA Major-2).
 * KIS·FX 외부 호출 없음, 쓰기 없음, 캐시 없음.
 */
import { readActivity } from './activity';
import { readAnalysisRuns, type AnalysisRunsResult } from './analysis-runs';
import { buildAnomalies, readDataSources, readJobFailures } from './anomalies';
import { buildChecks, checkCoverage, type RejectedToday } from './checks';
import { readExitLines } from './exit-lines';
import { readLiveSet } from './live-set';
import { errorMetric } from './metric';
import { homePostmortem, readPostmortemSample } from './postmortem-sample';
import { count, createReader, errorCodeOf, section, type OpsReader } from './read-only';
import { readSafetyState, toSafetyDTO, type SafetyStateExtra } from './safety-state';
import { currentSessionDay, kstIso, kstSql, loadClosedDays, type ClosedDays } from './sessions';
import { readUniverseProposalBrief } from './universe-read';
import { countApproval } from './signal-counts';
import { metricSetFor } from './stage';
import type { HomeDTO, Market, ObserveSet, SafetyStateDTO, Section } from './types';

const TODAY_WINDOWS = `((market = 'domestic' AND created_at >= ? AND created_at < ?) OR (market = 'overseas' AND created_at >= ? AND created_at < ?))`;
/** 거부·실패 */
const REJECTED_COND = `status IN ('rejected', 'failed')`;
/** 안전장치(한도·관문 등)에 막힌 주문 — 모든거래차단 차단은 확인 필요 #1 이 말하므로 뺀다 */
const BLOCKED_COND = `status = 'blocked' AND (blocked_by IS NULL OR blocked_by <> 'kill_switch')`;

export const REJECTED_COUNT_SQL = `SELECT market, COUNT(*) AS n FROM orders WHERE ${TODAY_WINDOWS} AND ${REJECTED_COND} GROUP BY market`;
export const REJECTED_LATEST_SQL = `SELECT market, symbol, side, blocked_by FROM orders WHERE ${TODAY_WINDOWS} AND ${REJECTED_COND} ORDER BY created_at DESC LIMIT 1`;
export const BLOCKED_COUNT_SQL = `SELECT market, COUNT(*) AS n FROM orders WHERE ${TODAY_WINDOWS} AND ${BLOCKED_COND} GROUP BY market`;
export const BLOCKED_LATEST_SQL = `SELECT market, symbol, side, blocked_by FROM orders WHERE ${TODAY_WINDOWS} AND ${BLOCKED_COND} ORDER BY created_at DESC LIMIT 1`;

async function readOrderIssue(r: OpsReader, countSql: string, latestSql: string): Promise<RejectedToday> {
  const d = currentSessionDay('domestic', r.nowMs);
  const o = currentSessionDay('overseas', r.nowMs);
  const p = [kstSql(d.startMs), kstSql(d.endMs), kstSql(o.startMs), kstSql(o.endMs)];
  const [cnt, latest] = await Promise.all([r.rows<Record<string, unknown>>(countSql, p), r.rows<Record<string, unknown>>(latestSql, p)]);
  const total = cnt.reduce((a, x) => a + count(x.n), 0);
  const l = latest[0];
  const market: Market = String(l?.market) === 'overseas' ? 'overseas' : 'domestic';
  return {
    count: total,
    latest: l ? { symbol: String(l.symbol), side: String(l.side), reason: l.blocked_by == null ? null : String(l.blocked_by).slice(0, 120), market } : null,
  };
}

/** 오늘(시장별 세션일) 거부·실패 주문과 안전장치 차단 주문. */
export async function readOrderIssuesToday(r: OpsReader): Promise<{ rejected: RejectedToday; blocked: RejectedToday }> {
  const [rejected, blocked] = await Promise.all([
    readOrderIssue(r, REJECTED_COUNT_SQL, REJECTED_LATEST_SQL),
    readOrderIssue(r, BLOCKED_COUNT_SQL, BLOCKED_LATEST_SQL),
  ]);
  return { rejected, blocked };
}

/** 데이터 이상 재료(원천 7개 + 오늘 실행 실패) — **모든 단계에서** 읽는다(Reviewer R-DATA Major-2). 원천마다 실패 격리라 던지지 않는다. */
async function readAnomalyParts(r: OpsReader, closed: ClosedDays) {
  const [sources, jobFailures] = await Promise.all([readDataSources(r, closed), readJobFailures(r)]);
  return { sources, jobFailures };
}

/** 관찰 세트 전용 — 사후 추적(A3). 실패는 그 지표만 「조회 실패」. */
async function readPostmortemMetric(r: OpsReader, closed: ClosedDays): Promise<ObserveSet['postmortem']> {
  return readPostmortemSample(r, closed).then((p) => homePostmortem(p, r.nowMs), (e): ObserveSet['postmortem'] => errorMetric(errorCodeOf(e)));
}

export interface HomeDeps {
  readSafety: (nowMs: number) => Promise<SafetyStateDTO & SafetyStateExtra>;
  reader: (nowMs: number) => OpsReader;
}

const DEFAULT_DEPS: HomeDeps = {
  readSafety: (nowMs) => readSafetyState(nowMs),
  reader: (nowMs) => createReader({ nowMs }),
};

function firstError(...ss: (Section<unknown> | null)[]): string | null {
  for (const s of ss) if (s && s.state === 'error') return s.error;
  return null;
}

export async function buildHome(nowMs: number = Date.now(), deps: HomeDeps = DEFAULT_DEPS): Promise<HomeDTO> {
  const safety = await deps.readSafety(nowMs);
  const stage = safety.stage;
  const set = metricSetFor(stage);
  const r = deps.reader(nowMs);
  const closed = await loadClosedDays(r);

  const [approval, orderIssues, analysis, exit, activity, anomalyParts, postmortem, live, universeProposals] = await Promise.all([
    section('approval', () => countApproval(r)),
    section('orders', () => readOrderIssuesToday(r)),
    section<AnalysisRunsResult>('analysis', () => readAnalysisRuns(r, closed)),
    section('exit', async () => (await readExitLines(r, closed, safety)).lines),
    section('activity', () => readActivity(r)),
    section('anomalies', () => readAnomalyParts(r, closed)),
    set === 'observe' ? readPostmortemMetric(r, closed) : Promise.resolve(null),
    set === 'live' ? section('live', () => readLiveSet(r, stage)) : Promise.resolve(null),
    // T-143 — 해외 분석 대상 변경 제안. **`section()` 으로 감싸지 않는다**: 이 값은 「확인 필요」의 fail-closed 집합
    // 밖이고(가이드 §3.4) 스스로 실패를 null 로 흡수한다. 섹션 오류 목록에 넣으면 가장 덜 급한 값 하나가
    // 「모든거래차단 ON」 줄까지 가린다.
    readUniverseProposalBrief(r, kstSql(nowMs)),
  ]);

  const counts: HomeDTO['counts'] = approval.state === 'ok' && orderIssues.state === 'ok'
    ? { state: 'ok', data: { approval: approval.data.approval, earliestExpiry: approval.data.earliestExpiry, rejectedToday: orderIssues.data.rejected.count } }
    : { state: 'error', error: firstError(approval, orderIssues) ?? 'internal_error' };

  const analysisSec: HomeDTO['analysis'] = analysis.state === 'ok' ? { state: 'ok', data: analysis.data.rows } : analysis;

  // 데이터 이상(A4) — 모든 단계. 분석 실행 기록을 못 읽었으면 「분석 실패를 아는가」 = false(partial).
  const anomalies: HomeDTO['anomalies'] = anomalyParts.state === 'ok'
    ? { state: 'ok', data: buildAnomalies(anomalyParts.data.sources, anomalyParts.data.jobFailures, analysis.state === 'ok' && analysis.data.bothRecorded, kstIso(nowMs)) }
    : anomalyParts;

  let observe: HomeDTO['observe'] = null;
  if (set === 'observe') {
    observe = analysis.state === 'ok' && anomalies.state === 'ok' && postmortem
      ? { state: 'ok', data: { analysis: analysis.data.rows, postmortem, anomalies: anomalies.data } }
      : { state: 'error', error: firstError(analysis, anomalies) ?? 'internal_error' };
  }

  const checkErr = firstError(approval, orderIssues, exit, analysis, anomalies);
  let checks: HomeDTO['checks'];
  let checkCoverageV: HomeDTO['checkCoverage'] = null;
  if (checkErr || approval.state !== 'ok' || orderIssues.state !== 'ok' || exit.state !== 'ok' || analysis.state !== 'ok' || anomalies.state !== 'ok') {
    checks = { state: 'error', error: checkErr ?? 'internal_error' };
  } else {
    const exitFillsToday = live && live.state === 'ok'
      ? (live.data.fillsToday.domestic.value?.exitSells ?? 0) + (live.data.fillsToday.overseas.value?.exitSells ?? 0)
      : null;
    const input = {
      stage, safety, killSwitchSince: safety.killSwitchSince, approval: approval.data,
      rejected: orderIssues.data.rejected, blocked: orderIssues.data.blocked, exit: exit.data,
      exitFillsToday, anomalies: anomalies.data, slotUnrecorded: analysis.data.slotUnrecorded,
      universeProposals,
    };
    checks = { state: 'ok', data: buildChecks(input) };
    checkCoverageV = checkCoverage(input);
  }

  return {
    generatedAt: kstIso(nowMs),
    stage,
    safety: toSafetyDTO(safety),
    checks,
    checkCoverage: checkCoverageV,
    anomalies,
    counts,
    analysis: analysisSec,
    observe,
    live: set === 'live' ? live : null,
    exit,
    activity,
  };
}
