import { bollinger } from '../indicators/bollinger';
import { atr } from '../indicators/atr';
import type { RuleFunction } from './types';

/**
 * 볼린저 Squeeze → 확장 돌파 전략:
 * - 최근 5봉의 BB width 최소값이 ATR×1.5 이하면 "squeeze 구간"으로 판단
 * - 매수: squeeze 직후 현재 종가가 상단 돌파 AND volumeRatio ≥ 0.7
 * - 매도: squeeze 직후 현재 종가가 하단 이탈
 *
 * 기존 bb-breakout 대비: "저변동 → 고변동 전환" 구간을 객관 판별해 고확률 패턴만 포착.
 */
export const bbSqueezeExpansion: RuleFunction = ({ strategyId, symbol, candles, ticker, amountKRW, style }) => {
  if (candles.length < 25) return [];
  const closes = candles.map(c => c.close);
  const bands = bollinger(closes, 20, 2);
  const atrSeries = atr(candles.map(c => ({ high: c.high, low: c.low, close: c.close })), 14);

  const n = closes.length - 1;
  const cur = bands[n];
  if (cur.upper == null || cur.middle == null || cur.lower == null) return [];

  const atrNow = atrSeries[n];
  if (atrNow == null) return [];

  // 최근 5봉 BB width 최소값
  const widths: number[] = [];
  for (let i = Math.max(0, n - 5); i <= n - 1; i++) {
    const b = bands[i];
    if (b.upper != null && b.lower != null) widths.push(b.upper - b.lower);
  }
  if (widths.length < 4) return [];
  const minWidth = Math.min(...widths);

  const squeezeActive = minWidth <= atrNow * 1.5;
  if (!squeezeActive) return [];

  const price = ticker.price;

  // 볼륨 체크 (24h 기준 미제공이면 통과)
  const vol = candles[n].volume;
  const volAvg20 = candles.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
  const volRatio = volAvg20 > 0 ? vol / volAvg20 : 1;

  // 거래량비 하한은 style 주입 (T-003 §3) — 코드 기본 0.7, 운영값 1.2 는 DB override.
  // 근거: 장중 AI 관문 제거로 질적 거절이 사라진 만큼 **가짜 돌파 필터를 강화**해 보상한다.
  // (0.7 은 평균 거래량보다 적어도 돌파를 인정하던 값이라 사실상 필터가 아니었다)
  const volRatioMin = style.bbSqueezeVolRatioMin;

  if (closes[n] > cur.upper && volRatio >= volRatioMin) {
    return [{
      strategyId, symbol, side: 'buy', orderType: 'limit', price, amountKRW,
      reasoning: `BB squeeze(width ${minWidth.toFixed(0)} ≤ ATR×1.5 ${(atrNow*1.5).toFixed(0)}) 직후 상단 돌파, volRatio=${volRatio.toFixed(2)} ≥ ${volRatioMin}`,
      indicators: { upper: cur.upper, middle: cur.middle, lower: cur.lower, price, minWidth, atr: atrNow, volRatio },
    }];
  }
  if (closes[n] < cur.lower) {
    return [{
      strategyId, symbol, side: 'sell', orderType: 'limit', price, amountKRW,
      reasoning: `BB squeeze 직후 하단 이탈 → 청산 권고`,
      indicators: { upper: cur.upper, middle: cur.middle, lower: cur.lower, price, minWidth, atr: atrNow },
    }];
  }
  return [];
};
