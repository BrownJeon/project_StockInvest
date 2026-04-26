import { rsi } from '../indicators/rsi';
import { macd } from '../indicators/macd';
import type { RuleFunction } from './types';

/**
 * 3중 확인 매수/매도 (Mean-rev, 강한 합의 시점만 진입):
 * - 매수: RSI < 35 AND MACD bullish cross 직후 (히스토그램 음→양 전환) AND 거래량 ≥ 20봉 평균 × 1.5 AND 양봉
 * - 매도: RSI > 65 AND MACD bearish cross 직후 (히스토그램 양→음 전환) AND 거래량 ≥ 20봉 평균 × 1.5 AND 음봉
 *
 * 발화 빈도 매우 낮음 / 정확도 매우 높음. 진입 후 손절 거리 짧음.
 * 공격적투자 전용.
 */
export const tripleConfirmation: RuleFunction = ({ strategyId, symbol, candles, ticker, amountKRW, style }) => {
  if (candles.length < 30) return [];
  const closes = candles.map(c => c.close);
  const rsiSeries = rsi(closes, 14);
  const macdPts   = macd(closes);

  const n = candles.length - 1;
  const r     = rsiSeries[n];
  const h     = macdPts[n].histogram;
  const hPrev = macdPts[n - 1].histogram;
  if (r == null || h == null || hPrev == null) return [];

  const cur = candles[n];
  const price = ticker.price;

  // 거래량 검증
  const volAvg20 = candles.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
  const volRatio = volAvg20 > 0 ? cur.volume / volAvg20 : 0;
  if (volRatio < 1.5) return [];

  const bullCandle = cur.close > cur.open;
  const bearCandle = cur.close < cur.open;

  // Bullish: histogram 음 → 양 전환 (cross 직후)
  const bullishCross = hPrev <= 0 && h > 0;
  if (r < 35 && bullishCross && bullCandle) {
    return [{
      strategyId, symbol, side: 'buy', orderType: 'limit', price, amountKRW,
      reasoning: `3중 확인 매수: RSI=${r.toFixed(1)}<35 + MACD hist ${hPrev.toFixed(2)}→${h.toFixed(2)} 양전환 + 거래량 ×${volRatio.toFixed(2)} + 양봉`,
      indicators: { rsi14: r, histCurr: h, histPrev: hPrev, volRatio, price },
    }];
  }

  // Bearish: histogram 양 → 음 전환
  const bearishCross = hPrev >= 0 && h < 0;
  if (r > 65 && bearishCross && bearCandle) {
    return [{
      strategyId, symbol, side: 'sell', orderType: 'limit', price, amountKRW,
      reasoning: `3중 확인 매도: RSI=${r.toFixed(1)}>65 + MACD hist ${hPrev.toFixed(2)}→${h.toFixed(2)} 음전환 + 거래량 ×${volRatio.toFixed(2)} + 음봉`,
      indicators: { rsi14: r, histCurr: h, histPrev: hPrev, volRatio, price },
    }];
  }

  // aggressive 프리셋 외 미발화
  if (style.rsiSellPriceMult > 1.0) return [];
  return [];
};
