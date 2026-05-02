import { rsiLast } from '../indicators/rsi';
import { smaLast } from '../indicators/sma';
import type { RuleFunction } from './types';

/**
 * RSI(14) 과매도 반등 매수 전용 전략:
 * - 매수: RSI < buyT AND price < MA20 AND 반등 시작 (현재봉 양봉 또는 저점 상승)
 *
 * 반전 확인 이유: "더 떨어지는 중"이 아닌 "오르기 시작하는 순간"을 포착하기 위함.
 * 매도(과열 청산) 분기는 rsi-overbought-exit-v1로 분리되었음.
 */
export const rsiOversold: RuleFunction = ({ strategyId, symbol, candles, ticker, amountKRW, style }) => {
  if (candles.length < 22) return [];
  const closes = candles.map(c => c.close);
  const r = rsiLast(closes, 14);
  const ma20 = smaLast(closes, 20);
  if (r == null || ma20 == null) return [];

  const n = candles.length - 1;
  const cur = candles[n];
  const prev = candles[n - 1];

  const price = ticker.price;
  const buyT  = style.rsiBuyThreshold;
  const sellM = style.rsiSellPriceMult;

  // 반등 확인: 현재봉 양봉(close > open) 또는 저점이 직전봉보다 높아짐
  const buyReversal  = cur.close > cur.open || cur.low >= prev.low;

  // 공격 모드(sellM≤1.00)일 땐 매수측도 대칭 완화: price < MA20×1.005
  const buyPriceMax = sellM <= 1.0 ? ma20 * 1.005 : ma20;
  if (r < buyT && price < buyPriceMax && buyReversal) {
    const reversalNote = cur.close > cur.open ? '양봉 반전' : '저점 상승';
    return [{
      strategyId, symbol, side: 'buy', orderType: 'limit', price, amountKRW,
      reasoning: `RSI14=${r.toFixed(1)} < ${buyT}, price=${price} < MA20=${ma20.toFixed(0)}, ${reversalNote} → 과매도 반등 시작`,
      indicators: { rsi14: r, ma20, price, reversalNote },
    }];
  }
  return [];
};
