import { sma } from '../indicators/sma';
import type { RuleFunction } from './types';

/**
 * MA 골든크로스/데드크로스 전략:
 * - 매수: MA5가 MA20을 상향 돌파 (이전 바: MA5 ≤ MA20, 현재 바: MA5 > MA20)
 * - 매도: MA5가 MA20을 하향 돌파 (이전 바: MA5 ≥ MA20, 현재 바: MA5 < MA20)
 */
export const maCross: RuleFunction = ({ strategyId, symbol, candles, ticker, amountKRW, style: _style }) => {
  if (candles.length < 22) return [];
  const closes = candles.map(c => c.close);
  const ma5  = sma(closes, 5);
  const ma20 = sma(closes, 20);

  const n = closes.length - 1;
  const cur5  = ma5[n];  const prev5  = ma5[n - 1];
  const cur20 = ma20[n]; const prev20 = ma20[n - 1];
  if (cur5 == null || prev5 == null || cur20 == null || prev20 == null) return [];

  const price = ticker.price;

  // 1) 교차 엣지 매수 (전통)
  if (prev5 <= prev20 && cur5 > cur20) {
    return [{
      strategyId, symbol, side: 'buy', orderType: 'limit', price, amountKRW,
      reasoning: `골든크로스 MA5=${cur5.toFixed(0)} > MA20=${cur20.toFixed(0)} (prev: ${prev5.toFixed(0)}≤${prev20.toFixed(0)})`,
      indicators: { ma5: cur5, ma20: cur20, price, kind: 'cross' },
    }];
  }
  // 2) 교차 엣지 매도 (전통)
  if (prev5 >= prev20 && cur5 < cur20) {
    return [{
      strategyId, symbol, side: 'sell', orderType: 'limit', price, amountKRW,
      reasoning: `데드크로스 MA5=${cur5.toFixed(0)} < MA20=${cur20.toFixed(0)} (prev: ${prev5.toFixed(0)}≥${prev20.toFixed(0)})`,
      indicators: { ma5: cur5, ma20: cur20, price, kind: 'cross' },
    }];
  }

  // 3) Pullback 매수: 상승추세 중(MA5>MA20) 종가가 MA5 아래로 되눌림 직후 반등
  if (cur5 > cur20 && prev5 > prev20 && closes[n - 1] <= prev5 && closes[n] > cur5) {
    return [{
      strategyId, symbol, side: 'buy', orderType: 'limit', price, amountKRW,
      reasoning: `상승추세 MA5 pullback 진입 close[${closes[n - 1].toFixed(0)}→${closes[n].toFixed(0)}], MA5=${cur5.toFixed(0)}`,
      indicators: { ma5: cur5, ma20: cur20, price, kind: 'pullback' },
    }];
  }
  // 4) Pullback 매도: 하락추세 중(MA5<MA20) 종가가 MA5 위로 반등 후 재하락
  if (cur5 < cur20 && prev5 < prev20 && closes[n - 1] >= prev5 && closes[n] < cur5) {
    return [{
      strategyId, symbol, side: 'sell', orderType: 'limit', price, amountKRW,
      reasoning: `하락추세 MA5 반등 후 재하락 close[${closes[n - 1].toFixed(0)}→${closes[n].toFixed(0)}], MA5=${cur5.toFixed(0)}`,
      indicators: { ma5: cur5, ma20: cur20, price, kind: 'pullback' },
    }];
  }

  return [];
};
