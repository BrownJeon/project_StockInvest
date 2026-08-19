/**
 * 선행지표 피처 시계열 — T-032.
 *
 * 🔴 **불변식(이 기능 전체의 신뢰도 근거): 시점 t의 피처는 `candles[0..t]`에만 의존한다.**
 * 미래 캔들이 시점 t의 값을 조금이라도 바꾸면 "선행지표"라는 주장 자체가 무너진다
 * (look-ahead bias). `__tests__/precursor-features.test.ts`가 이걸 회귀 검증한다.
 *
 * 재사용하는 지표는 전부 인과적 구현임을 확인했다(`src/lib/strategy/indicators/`):
 *  - `rsi()`  — Wilder 스무딩, 시점 t까지의 gain/loss만 누적
 *  - `atr()`  — 동일
 *  - `bollinger()` / `sma()` — 트레일링 window만 합산
 * 따라서 전체 배열에 대해 한 번만 계산해도 안전하다(슬라이딩 재계산 불필요).
 * 이 파일은 위 지표들을 **import만** 하고 수정하지 않는다(SAFETY_PATHS 대상 디렉토리).
 */
import { atr } from '@/lib/strategy/indicators/atr';
import { bollinger } from '@/lib/strategy/indicators/bollinger';
import { rsi } from '@/lib/strategy/indicators/rsi';
import { sma } from '@/lib/strategy/indicators/sma';
import type { DailyCandle, PrecursorFeatures } from '../types';

export interface PrecursorFeatureConfig {
  rsiPeriod: number;
  atrPeriod: number;
  bbPeriod: number;
  bbK: number;
  volumeAvgPeriod: number;
  /** 누적낙폭 계산에 쓰는 트레일링 최고 종가 구간 */
  drawdownLookbackDays: number;
}

export const DEFAULT_PRECURSOR_FEATURE_CONFIG: PrecursorFeatureConfig = {
  rsiPeriod: 14,
  atrPeriod: 14,
  bbPeriod: 20,
  bbK: 2,
  volumeAvgPeriod: 20,
  drawdownLookbackDays: 60,
};

export function computePrecursorSeries(
  candles: DailyCandle[],
  config: Partial<PrecursorFeatureConfig> = {},
): PrecursorFeatures[] {
  const cfg = { ...DEFAULT_PRECURSOR_FEATURE_CONFIG, ...config };
  if (!Array.isArray(candles) || candles.length === 0) return [];

  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);

  const rsiSeries = rsi(closes, cfg.rsiPeriod);
  const atrSeries = atr(candles, cfg.atrPeriod);
  const bbSeries = bollinger(closes, cfg.bbPeriod, cfg.bbK);
  const volAvg = sma(volumes, cfg.volumeAvgPeriod);

  // 트레일링 최고 종가 — 시점 i 이전만 훑는다(O(n·window)이지만 수년치 일봉이라 무시 가능).
  const out: PrecursorFeatures[] = [];
  for (let i = 0; i < candles.length; i++) {
    const from = Math.max(0, i - cfg.drawdownLookbackDays + 1);
    let trailingHigh = closes[from];
    for (let j = from + 1; j <= i; j++) {
      if (closes[j] > trailingHigh) trailingHigh = closes[j];
    }
    const drawdownPct =
      trailingHigh > 0 ? ((trailingHigh - closes[i]) / trailingHigh) * 100 : null;

    const atrVal = atrSeries[i];
    const bb = bbSeries[i];
    const avgVol = volAvg[i];

    out.push({
      index: i,
      date: candles[i].date,
      rsi14: rsiSeries[i] ?? null,
      atrPct: atrVal != null && closes[i] > 0 ? (atrVal / closes[i]) * 100 : null,
      bbPercentB:
        bb && bb.upper != null && bb.lower != null && bb.upper > bb.lower
          ? (closes[i] - bb.lower) / (bb.upper - bb.lower)
          : null,
      drawdownPct,
      volumeRatio: avgVol != null && avgVol > 0 ? volumes[i] / avgVol : null,
    });
  }
  return out;
}
