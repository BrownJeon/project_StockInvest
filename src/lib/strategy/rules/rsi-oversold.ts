import { rsiLast } from '../indicators/rsi';
import { smaLast } from '../indicators/sma';
import type { RuleFunction } from './types';

/**
 * RSI(14) 역추세 + 반전 확인 전략:
 * - 매수: RSI < buyT AND price < MA20 AND 반등 시작 (현재봉 양봉 또는 저점 상승)
 * - 매도: RSI > sellT AND price > MA20 * sellM AND 하락 시작 (현재봉 음봉 또는 고점 하락)
 *
 * 반전 확인 이유: "더 떨어지는 중"이 아닌 "오르기/내리기 시작하는 순간"을 포착하기 위함.
 * 조건 하나만 충족해도 통과 (느슨한 기준 — 지나친 필터링 방지).
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
  const sellT = style.rsiSellThreshold;
  const sellM = style.rsiSellPriceMult;

  // 반등 확인: 현재봉 양봉(close > open) 또는 저점이 직전봉보다 높아짐
  const buyReversal  = cur.close > cur.open || cur.low >= prev.low;
  // 하락 확인: 현재봉 음봉(close < open) 또는 고점이 직전봉보다 낮아짐
  const sellReversal = cur.close < cur.open || cur.high <= prev.high;

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
  if (r > sellT && price > ma20 * sellM && sellReversal) {
    const reversalNote = cur.close < cur.open ? '음봉 반전' : '고점 하락';
    return [{
      strategyId, symbol, side: 'sell', orderType: 'limit', price, amountKRW,
      reasoning: `RSI14=${r.toFixed(1)} > ${sellT}, price=${price} > MA20×${sellM}=${(ma20 * sellM).toFixed(0)}, ${reversalNote} → 과열 하락 시작`,
      indicators: { rsi14: r, ma20, price, reversalNote },
    }];
  }
  return [];
};
