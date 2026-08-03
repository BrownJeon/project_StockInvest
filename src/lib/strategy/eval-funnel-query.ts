import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { FUNNEL_STEPS, gateLabelKo, type FunnelMarket } from './eval-funnel-labels';

/**
 * eval_funnel 집계 쿼리 (T-002 §4) — 대시보드 카드 · trade-report 요약이 공유하는 단일 소스.
 * DB(mysql2)를 import하므로 서버 전용(API route / cron)에서만 사용한다.
 */

export interface FunnelStepCount {
  key: string;
  label: string;
  count: number;
  /** 직전 단계 대비 생존율(%). 첫 단계는 null */
  pctOfPrev: number | null;
}

export interface FunnelReasonCount {
  gate: string;
  label: string;
  count: number;
}

export interface FunnelAnomaly {
  label: string;
  count: number;
}

export interface EvalFunnelSummary {
  market: FunnelMarket;
  rangeStart: Date;
  rangeEnd: Date;
  runs: number;
  fullEvalRuns: number;
  symbolsEvaluated: number;
  buySignals: number;
  sellSignals: number;
  steps: FunnelStepCount[];
  /** 최다 차단 top3 (final, verdict=skip 기준) */
  bottlenecks: FunnelReasonCount[];
  anomalies: FunnelAnomaly[];
  /** market_state 분류가 neutral이었던 collect 행 비율(%). 표본 없으면 null */
  neutralPct: number | null;
}

function pct(n: number, of: number): number {
  return of > 0 ? Math.round((n / of) * 1000) / 10 : 0;
}

export async function getEvalFunnelSummary(
  market: FunnelMarket,
  rangeStart: Date,
  rangeEnd: Date,
): Promise<EvalFunnelSummary> {
  const pool = getPool();
  const params = [market, rangeStart, rangeEnd];

  // 1) 런 카운트 — run/analyst_disabled/no_due_strategies는 런 1회당 정확히 1행 (market_closed는 의도적 무기록).
  const [runRows] = await pool.query<RowDataPacket[]>(
    `SELECT gate, verdict, COUNT(*) AS n
       FROM eval_funnel
      WHERE market = ? AND gate IN ('run','analyst_disabled','no_due_strategies') AND ts BETWEEN ? AND ?
      GROUP BY gate, verdict`,
    params,
  );
  let runs = 0;
  let fullEvalRuns = 0;
  for (const r of runRows) {
    const n = Number(r.n);
    runs += n;
    if (r.gate === 'run' && r.verdict === 'pass') fullEvalRuns += n;
  }

  // 2) final 행 stage 분포 — 6단계 미니 깔때기(FUNNEL_STEPS)의 원천 데이터.
  const [stageRows] = await pool.query<RowDataPacket[]>(
    `SELECT stage, COUNT(*) AS n
       FROM eval_funnel
      WHERE market = ? AND gate = 'final' AND ts BETWEEN ? AND ?
      GROUP BY stage`,
    params,
  );
  let symbolsEvaluated = 0;
  const stageEntries: Array<[number, number]> = [];
  for (const r of stageRows) {
    const stage = Number(r.stage);
    const n = Number(r.n);
    stageEntries.push([stage, n]);
    symbolsEvaluated += n;
  }
  const steps: FunnelStepCount[] = [];
  let prevCount: number | null = null;
  for (const step of FUNNEL_STEPS) {
    const count = stageEntries.filter(([s]) => s >= step.minStage).reduce((sum, [, n]) => sum + n, 0);
    steps.push({
      key: step.key,
      label: step.label,
      count,
      pctOfPrev: prevCount != null ? pct(count, prevCount) : null,
    });
    prevCount = count;
  }

  // 3) 매수/매도 시그널 건수 — signal_created(pass) 이벤트 기준 (final은 심볼당 1행이라 다중 시그널 심볼을 과소집계함).
  const [sideRows] = await pool.query<RowDataPacket[]>(
    `SELECT side, COUNT(*) AS n
       FROM eval_funnel
      WHERE market = ? AND gate = 'signal_created' AND verdict = 'pass' AND ts BETWEEN ? AND ?
      GROUP BY side`,
    params,
  );
  let buySignals = 0;
  let sellSignals = 0;
  for (const r of sideRows) {
    if (r.side === 'buy') buySignals = Number(r.n);
    else if (r.side === 'sell') sellSignals = Number(r.n);
  }

  // 4) 최다 차단 top3 — final(verdict=skip) reason 기준.
  const [bottleneckRows] = await pool.query<RowDataPacket[]>(
    `SELECT reason, COUNT(*) AS n
       FROM eval_funnel
      WHERE market = ? AND gate = 'final' AND verdict = 'skip' AND ts BETWEEN ? AND ?
      GROUP BY reason
      ORDER BY n DESC
      LIMIT 3`,
    params,
  );
  const bottlenecks: FunnelReasonCount[] = bottleneckRows.map(r => ({
    gate: String(r.reason ?? ''),
    label: gateLabelKo(r.reason as string | null),
    count: Number(r.n),
  }));

  // 5) 이상 배너 — AI 배치 실패 / 자동분석 꺼짐 / fail-open(verdict=error) 게이트.
  const anomalies: FunnelAnomaly[] = [];
  const [aiBatchFailedRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM eval_funnel
      WHERE market = ? AND gate = 'ai_batch_failed' AND ts BETWEEN ? AND ?`,
    params,
  );
  const aiBatchFailedCount = Number(aiBatchFailedRows[0]?.n ?? 0);
  if (aiBatchFailedCount > 0) anomalies.push({ label: 'AI 배치 실패', count: aiBatchFailedCount });

  const [analystDisabledRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM eval_funnel
      WHERE market = ? AND gate = 'analyst_disabled' AND ts BETWEEN ? AND ?`,
    params,
  );
  const analystDisabledCount = Number(analystDisabledRows[0]?.n ?? 0);
  if (analystDisabledCount > 0) anomalies.push({ label: '자동분석 꺼짐', count: analystDisabledCount });

  const [errorGateRows] = await pool.query<RowDataPacket[]>(
    `SELECT gate, COUNT(*) AS n FROM eval_funnel
      WHERE market = ? AND verdict = 'error' AND ts BETWEEN ? AND ?
        AND gate NOT IN ('ai_batch_failed')
      GROUP BY gate
      ORDER BY n DESC
      LIMIT 5`,
    params,
  );
  for (const r of errorGateRows) {
    anomalies.push({ label: gateLabelKo(r.gate as string), count: Number(r.n) });
  }

  // 6) neutral 시장상태 비율 — collect 행 detail.marketState 기준.
  const [neutralRows] = await pool.query<RowDataPacket[]>(
    `SELECT
        SUM(JSON_UNQUOTE(JSON_EXTRACT(detail, '$.marketState')) = 'neutral') AS neutral_n,
        COUNT(*) AS total_n
       FROM eval_funnel
      WHERE market = ? AND gate = 'collect' AND ts BETWEEN ? AND ?`,
    params,
  );
  const neutralTotal = Number(neutralRows[0]?.total_n ?? 0);
  const neutralPct = neutralTotal > 0
    ? pct(Number(neutralRows[0]?.neutral_n ?? 0), neutralTotal)
    : null;

  return {
    market, rangeStart, rangeEnd,
    runs, fullEvalRuns, symbolsEvaluated,
    buySignals, sellSignals,
    steps, bottlenecks, anomalies, neutralPct,
  };
}
