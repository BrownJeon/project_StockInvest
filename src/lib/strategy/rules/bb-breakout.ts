import { bollinger } from '../indicators/bollinger';
import { atr } from '../indicators/atr';
import type { RuleFunction } from './types';

/**
 * 볼린저 밴드 돌파 전략:
 * - 매수: 이전 바 종가가 upper 밴드 아래, 현재 바 종가가 upper 돌파 + 거래량(≥1.2x) + ATR 거리(≤1.5x) 가드
 * - 매도: 종가가 lower 밴드 아래로 하락 (포지션 청산)
 *
 * 매수 가드 (Phase O 강화): 가짜 돌파 차단을 위해
 *   - 거래량 직전 20봉 평균 대비 1.2x 이상
 *   - 현재가가 middle 대비 1.5×ATR 이내 (추격 매수 패턴 차단)
 */
export const bbBreakout: RuleFunction = ({ strategyId, symbol, candles, ticker, amountKRW, style: _style }) => {
  if (candles.length < 22) return [];
  const closes = candles.map(c => c.close);
  const bands = bollinger(closes, 20, 2);

  const n = closes.length - 1;
  const cur  = bands[n];
  const prev = bands[n - 1];
  if (cur.upper == null || cur.middle == null || cur.lower == null || prev.upper == null) return [];

  const price = ticker.price;
  const prev2 = bands[n - 2];

  // 상단 돌파 매수: 직전 2봉 중 1봉 이상이 upper 아래 → 현재 종가 > upper (엣지 윈도우 2봉)
  const breakoutBuy =
    (closes[n - 1] <= prev.upper && closes[n] > cur.upper) ||
    (prev2 != null && prev2.upper != null && closes[n - 2] <= prev2.upper && closes[n] > cur.upper);
  if (breakoutBuy) {
    // 거래량 가드 — 직전 20봉 평균 대비 1.2x 이상이어야 진성 돌파로 인정
    const vol = candles[n].volume ?? 0;
    const volAvg20 = candles.slice(-20).reduce((s, c) => s + (c.volume ?? 0), 0) / 20;
    const volRatio = volAvg20 > 0 ? vol / volAvg20 : 1;
    if (volRatio < 1.2) return [];

    // ATR 거리 가드 — middle 대비 1.5×ATR 초과면 추격 패턴 차단
    const atrSeries = atr(candles.map(c => ({ high: c.high, low: c.low, close: c.close })), 14);
    const atrNow = atrSeries[n];
    const distance = closes[n] - cur.middle;
    if (atrNow != null && distance > atrNow * 1.5) return [];

    return [{
      strategyId, symbol, side: 'buy', orderType: 'limit', price, amountKRW,
      reasoning: `BB 상단 돌파 price=${closes[n].toFixed(0)} > upper=${cur.upper.toFixed(0)}, vol×${volRatio.toFixed(2)}, dist=${atrNow != null ? (distance / atrNow).toFixed(2) : 'na'}×ATR`,
      indicators: { upper: cur.upper, middle: cur.middle, lower: cur.lower, price, volRatio, atrDistanceRatio: atrNow != null ? distance / atrNow : null },
    }];
  }

  // 하단 이탈 매도: 전통 조건
  if (closes[n] < cur.lower) {
    return [{
      strategyId, symbol, side: 'sell', orderType: 'limit', price, amountKRW,
      reasoning: `BB 하단 이탈 price=${closes[n].toFixed(0)} < lower=${cur.lower.toFixed(0)} → 청산`,
      indicators: { upper: cur.upper, middle: cur.middle, lower: cur.lower, price },
    }];
  }

  // 중앙선 재이탈 매도 (조기 청산): 직전봉 중앙선 위 → 현재봉 종가가 중앙선 아래로
  if (prev.middle != null && closes[n - 1] > prev.middle && closes[n] < cur.middle) {
    return [{
      strategyId, symbol, side: 'sell', orderType: 'limit', price, amountKRW,
      reasoning: `BB 중앙선 재이탈 price=${closes[n].toFixed(0)} < middle=${cur.middle.toFixed(0)} → 조기 청산`,
      indicators: { upper: cur.upper, middle: cur.middle, lower: cur.lower, price, reason: 'middle_reentry' },
    }];
  }

  return [];
};
