/**
 * T-108 X5 — 보유 종목의 「청산 임계 대비 현재 구간」 순수 판정 (가이드 §4.4 holdings.zone, 계약 §11.1·§11.2 X5).
 *
 * 청산 엔진(`strategy/exit-engine.ts evaluateExit`)을 **부르지 않는다**(부작용·의존 회피) — 같은 임계·같은 비교 방향·같은 우선순위를
 * 여기서 다시 쓰고, 시험(A-7)이 `evaluateExit` 와 같은 입력으로 결과를 대조해 드리프트를 막는다.
 *
 * 우선순위(첫 일치 — 엔진과 같다):
 *   1. eod_cut      : 국내 ∧ KST 평일 15:20~15:29 ∧ pnl ≤ −eodLossCutPct
 *   2. hard_stop    : pnl ≤ −(시나리오 stopHi | hardStopPct)  또는 시나리오 stopLo
 *   3. take_profit  : 시나리오 targetHi 이상 또는 pnl ≥ (시나리오 targetLo | targetProfitPct)
 *   4. trailing_active : (peak−entry)/entry ≥ trailingActivatePct  — 되돌림이 임계를 넘었는지는 detail.fromPeakPct 로 보인다
 *   5. neutral
 * not_evaluated: 해외인데 미국 정규장이 아님 · 가격/진입가 없음·0 이하 · price/entry 비율이 [0.3, 3.0] 밖(엔진의 단위 불일치 가드).
 *
 * 임계는 호출자가 `getStyleConfig()`(엔진과 같은 판독기 — 코드 기본값 ⊕ `style_default_*`)로 넘긴다.
 * 비율이라 환율과 무관하다(가격·진입가가 같은 단위일 때 — 엔진도 같은 가정).
 */
import { EXIT_UNIT_RATIO_MAX, EXIT_UNIT_RATIO_MIN, isEodWindowKST } from '@/lib/strategy/exit-engine';
import type { ExitZone, Market } from './types';

export interface ZoneThresholds {
  hardStopPct: number;
  eodLossCutPct: number;
  targetProfitPct: number;
  trailingActivatePct: number;
  trailingDrawdownPct: number;
}

export interface ScenarioExit { targetLo: number; targetHi: number; stopLo: number; stopHi: number }

export interface ZoneInput {
  market: Market;
  price: number | null;
  entry: number | null;
  peak: number | null;
  scenario: ScenarioExit | null;
  thresholds: ZoneThresholds;
  now: Date;
  /** 해외: 지금 미국 정규장이 열려 있는가. 국내는 보지 않는다. */
  overseasOpen: boolean;
}

export interface ZoneResult {
  zone: ExitZone;
  pnlPct: number | null;
  detail: { thresholdPct?: number; fromPeakPct?: number };
}

function finitePos(v: number | null): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

function validScenario(s: ScenarioExit | null): s is ScenarioExit {
  return !!s && [s.targetLo, s.targetHi, s.stopLo, s.stopHi].every((x) => typeof x === 'number' && Number.isFinite(x));
}

export function classifyExitZone(input: ZoneInput): ZoneResult {
  const { market, price, entry, peak, thresholds: t, now } = input;
  if (market === 'overseas' && !input.overseasOpen) return { zone: 'not_evaluated', pnlPct: null, detail: {} };
  if (!finitePos(price) || !finitePos(entry)) return { zone: 'not_evaluated', pnlPct: null, detail: {} };
  const ratio = price / entry;
  if (ratio < EXIT_UNIT_RATIO_MIN || ratio > EXIT_UNIT_RATIO_MAX) return { zone: 'not_evaluated', pnlPct: null, detail: {} };

  const pnl = ((price - entry) / entry) * 100;
  const pnlPct = Math.round(pnl * 100) / 100;
  const sc = validScenario(input.scenario) ? input.scenario : null;

  if (market === 'domestic' && isEodWindowKST(now) && pnl <= -t.eodLossCutPct) {
    return { zone: 'eod_cut', pnlPct, detail: { thresholdPct: -t.eodLossCutPct } };
  }
  const hardStop = sc ? sc.stopHi : t.hardStopPct;
  if (pnl <= -hardStop) return { zone: 'hard_stop', pnlPct, detail: { thresholdPct: -hardStop } };
  if (sc && pnl <= -sc.stopLo) return { zone: 'hard_stop', pnlPct, detail: { thresholdPct: -sc.stopLo } };
  if (sc && pnl >= sc.targetHi) return { zone: 'take_profit', pnlPct, detail: { thresholdPct: sc.targetHi } };
  const target = sc ? sc.targetLo : t.targetProfitPct;
  if (pnl >= target) return { zone: 'take_profit', pnlPct, detail: { thresholdPct: target } };

  if (finitePos(peak)) {
    const peakGain = ((peak - entry) / entry) * 100;
    if (peakGain >= t.trailingActivatePct) {
      const fromPeak = ((price - peak) / peak) * 100;
      return { zone: 'trailing_active', pnlPct, detail: { fromPeakPct: Math.round(fromPeak * 100) / 100, thresholdPct: -t.trailingDrawdownPct } };
    }
  }
  return { zone: 'neutral', pnlPct, detail: {} };
}

/** 트레일링 활성 여부만(X3 「트레일링 활성 n」) — 위 4번과 같은 식. */
export function isTrailingActive(entry: number | null, peak: number | null, activatePct: number): boolean {
  if (!finitePos(entry) || !finitePos(peak)) return false;
  return ((peak - entry) / entry) * 100 >= activatePct;
}
