/**
 * 급등·급락 사이클 탐지 — T-032.
 *
 * 정의:
 *  1. trough — 시점 i의 조정종가가 트레일링 `lookbackDays` 구간의 **최저 종가**일 때.
 *     동률(평탄 구간)이면 **최초 인덱스만** trough로 채택한다(결정적).
 *  2. rally — trough 이후 `rallyWindowDays` 이내 최고가(조정)가 trough 종가 대비
 *     `rallyThresholdPct` 이상이면 랠리 이벤트.
 *  3. confirmedCycle — 랠리 peak 이후 `postRallyDeclineWindowDays` 이내 peak 대비
 *     `postRallyDeclinePct` 이상 재하락하면 true. 관측 구간이 시계열 끝에 걸려
 *     아직 알 수 없으면 **null(보류)** — false로 단정하지 않는다.
 *
 * 엣지 케이스 처리:
 *  - forward window가 시계열 끝을 넘어가는데 랠리도 아직 없으면 이벤트로 기록하지 않고
 *    `pendingTroughCount`로만 센다("랠리 없음"과 구분).
 *  - 이벤트를 찾으면 peak 다음 인덱스로 점프해 같은 랠리를 중복 카운트하지 않는다.
 *  - 입력 캔들은 **조정 후** 값이어야 한다(분할이 가짜 폭락으로 잡히는 것을 막는다).
 */
import type { DailyCandle, RallyCycleConfig, RallyDetectionResult, RallyEvent } from '../types';
import { DEFAULT_RALLY_CYCLE_CONFIG } from '../types';

/**
 * 시점 i가 트레일링 `lookback` 구간의 최초 최저 종가인가.
 * 시점 i 이후 데이터를 전혀 보지 않는다(인과적).
 */
function isTrailingTrough(candles: DailyCandle[], i: number, lookback: number): boolean {
  const from = Math.max(0, i - lookback + 1);
  let minIdx = from;
  let minVal = candles[from].close;
  for (let j = from + 1; j <= i; j++) {
    if (candles[j].close < minVal) {
      minVal = candles[j].close;
      minIdx = j;
    }
  }
  return minIdx === i;
}

export function detectRallyEvents(
  candles: DailyCandle[],
  config: Partial<RallyCycleConfig> = {},
): RallyDetectionResult {
  const cfg: RallyCycleConfig = { ...DEFAULT_RALLY_CYCLE_CONFIG, ...config };
  const empty: RallyDetectionResult = {
    events: [],
    troughIndices: [],
    pendingTroughCount: 0,
    avgRallyPct: null,
    avgDaysToRally: null,
  };
  if (!Array.isArray(candles) || candles.length === 0) return empty;
  if (cfg.lookbackDays <= 0 || cfg.rallyWindowDays <= 0) {
    throw new RangeError('lookbackDays and rallyWindowDays must be > 0');
  }

  const n = candles.length;
  const events: RallyEvent[] = [];
  const troughIndices: number[] = [];
  let pendingTroughCount = 0;

  // 트레일링 구간이 온전히 채워진 시점부터 평가 — 데이터가 짧은 초반 구간의 오탐 방지.
  let i = cfg.lookbackDays - 1;
  while (i < n) {
    if (!isTrailingTrough(candles, i, cfg.lookbackDays)) {
      i++;
      continue;
    }

    const troughClose = candles[i].close;
    if (!(troughClose > 0)) { i++; continue; }

    const rallyEnd = Math.min(n - 1, i + cfg.rallyWindowDays);
    const windowTruncated = i + cfg.rallyWindowDays > n - 1;

    // forward window 안 최고가 — 임계치를 처음 넘긴 지점이 아니라 구간 최고점을 peak로 본다.
    let peakIdx = -1;
    let peakPrice = -Infinity;
    for (let j = i + 1; j <= rallyEnd; j++) {
      if (candles[j].high > peakPrice) {
        peakPrice = candles[j].high;
        peakIdx = j;
      }
    }

    const rallyPct = peakIdx >= 0 ? ((peakPrice - troughClose) / troughClose) * 100 : -Infinity;

    if (peakIdx < 0 || rallyPct < cfg.rallyThresholdPct) {
      // 아직 관측 구간이 남아 있는데 랠리가 없다 → 판단 보류(랠리 없음으로 단정 금지)
      if (windowTruncated) pendingTroughCount++;
      i++;
      continue;
    }

    // ── 재하락(사이클 확정) 관측 ────────────────────────────────────────────
    const declineEnd = Math.min(n - 1, peakIdx + cfg.postRallyDeclineWindowDays);
    const declineWindowTruncated = peakIdx + cfg.postRallyDeclineWindowDays > n - 1;

    let minLow = Infinity;
    let minIdx = -1;
    for (let j = peakIdx + 1; j <= declineEnd; j++) {
      if (candles[j].low < minLow) {
        minLow = candles[j].low;
        minIdx = j;
      }
    }

    let confirmedCycle: boolean | null;
    let declinePct: number | null = null;
    let declineDate: string | null = null;
    let daysToDecline: number | null = null;

    if (minIdx < 0) {
      // 관측할 봉이 하나도 없다 → 보류
      confirmedCycle = null;
    } else {
      declinePct = ((peakPrice - minLow) / peakPrice) * 100;
      if (declinePct >= cfg.postRallyDeclinePct) {
        confirmedCycle = true;
        declineDate = candles[minIdx].date;
        daysToDecline = minIdx - peakIdx;
      } else if (declineWindowTruncated) {
        // 아직 관측 구간이 남았는데 조건 미달 → 보류
        confirmedCycle = null;
      } else {
        confirmedCycle = false;
      }
    }

    events.push({
      troughIndex: i,
      troughDate: candles[i].date,
      troughClose,
      peakIndex: peakIdx,
      peakDate: candles[peakIdx].date,
      peakPrice,
      rallyPct,
      daysToRally: peakIdx - i,
      confirmedCycle,
      declinePct,
      declineDate,
      daysToDecline,
    });
    troughIndices.push(i);

    // 같은 랠리를 다시 세지 않도록 peak 다음으로 점프
    i = peakIdx + 1;
  }

  const avgRallyPct = events.length
    ? events.reduce((s, e) => s + e.rallyPct, 0) / events.length
    : null;
  const avgDaysToRally = events.length
    ? events.reduce((s, e) => s + e.daysToRally, 0) / events.length
    : null;

  return { events, troughIndices, pendingTroughCount, avgRallyPct, avgDaysToRally };
}
