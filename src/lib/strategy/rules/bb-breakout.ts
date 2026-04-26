import { bollinger } from '../indicators/bollinger';
import type { RuleFunction } from './types';

/**
 * 볼린저 밴드 돌파 전략:
 * - 매수: 이전 바 종가가 upper 밴드 아래, 현재 바 종가가 upper 돌파 (추세 추종)
 * - 매도: 종가가 lower 밴드 아래로 하락 (포지션 청산)
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
    return [{
      strategyId, symbol, side: 'buy', orderType: 'limit', price, amountKRW,
      reasoning: `BB 상단 돌파 price=${closes[n].toFixed(0)} > upper=${cur.upper.toFixed(0)}`,
      indicators: { upper: cur.upper, middle: cur.middle, lower: cur.lower, price },
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
