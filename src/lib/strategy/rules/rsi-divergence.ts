import { rsi } from '../indicators/rsi';
import type { RuleFunction } from './types';

/**
 * RSI 다이버전스 (반전 조기 포착):
 * - Bullish: 직전 N봉 가격 신저가 갱신 AND 같은 구간 RSI는 신저가 미갱신 AND 양봉 반전
 * - Bearish: 직전 N봉 가격 신고가 갱신 AND RSI는 신고가 미달 AND 음봉 반전
 *
 * 발화 빈도 매우 낮음 / 정확도 높음. 추세 약화 시점 탐지.
 * 공격적투자 전용 (rsi-macd-reversal과 동일 가드).
 */
const LOOKBACK = 10;

export const rsiDivergence: RuleFunction = ({ strategyId, symbol, candles, ticker, amountKRW, style }) => {
  if (candles.length < LOOKBACK + 14) return [];
  const closes = candles.map(c => c.close);
  const rsiSeries = rsi(closes, 14);

  const n = candles.length - 1;
  const cur = candles[n];
  const price = ticker.price;
  const r = rsiSeries[n];
  if (r == null) return [];

  // 직전 LOOKBACK 봉 (n-LOOKBACK ... n-1)에서 가격·RSI 최저/최고 추출
  const start = n - LOOKBACK;
  let priceLowIdx = start, priceHighIdx = start;
  for (let i = start + 1; i <= n - 1; i++) {
    if (closes[i] < closes[priceLowIdx]) priceLowIdx = i;
    if (closes[i] > closes[priceHighIdx]) priceHighIdx = i;
  }
  const priceLow = closes[priceLowIdx];
  const priceHigh = closes[priceHighIdx];
  const rsiAtPriceLow  = rsiSeries[priceLowIdx];
  const rsiAtPriceHigh = rsiSeries[priceHighIdx];
  if (rsiAtPriceLow == null || rsiAtPriceHigh == null) return [];

  const bullCandle = cur.close > cur.open;
  const bearCandle = cur.close < cur.open;

  // Bullish divergence: 현재 종가가 priceLow 갱신(또는 근접) 인데 RSI는 더 높음
  if (
    cur.close <= priceLow * 1.002 &&
    r > rsiAtPriceLow + 3 &&         // RSI 다이버전스 마진 3pt
    r < 50 &&                         // 여전히 약세 영역
    bullCandle
  ) {
    return [{
      strategyId, symbol, side: 'buy', orderType: 'limit', price, amountKRW,
      reasoning: `Bullish 다이버전스: 가격 ${priceLow.toFixed(0)}→${cur.close.toFixed(0)} 신저가 근접, RSI ${rsiAtPriceLow.toFixed(1)}→${r.toFixed(1)} 미동행 + 양봉`,
      indicators: { rsi14: r, rsiAtPriceLow, priceLow, currentClose: cur.close, lookback: LOOKBACK },
    }];
  }

  // Bearish divergence: 현재 종가가 priceHigh 갱신(또는 근접)인데 RSI는 더 낮음
  if (
    cur.close >= priceHigh * 0.998 &&
    r < rsiAtPriceHigh - 3 &&
    r > 50 &&
    bearCandle
  ) {
    return [{
      strategyId, symbol, side: 'sell', orderType: 'limit', price, amountKRW,
      reasoning: `Bearish 다이버전스: 가격 ${priceHigh.toFixed(0)}→${cur.close.toFixed(0)} 신고가 근접, RSI ${rsiAtPriceHigh.toFixed(1)}→${r.toFixed(1)} 미동행 + 음봉`,
      indicators: { rsi14: r, rsiAtPriceHigh, priceHigh, currentClose: cur.close, lookback: LOOKBACK },
    }];
  }

  // aggressive 프리셋 외 미발화
  if (style.rsiSellPriceMult > 1.0) return [];
  return [];
};
