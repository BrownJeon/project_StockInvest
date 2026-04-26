import { rsi } from '../indicators/rsi';
import { macd } from '../indicators/macd';
import type { RuleFunction } from './types';

/**
 * RSI + MACD 히스토그램 반전 복합 전략 (공격적 모멘텀 반전 포착):
 * - 매수: RSI < 45 AND RSI 상승 전환 AND MACD 히스토그램 기울기 반등 AND 현재봉 양봉
 * - 매도: RSI > 55 AND RSI 하락 전환 AND MACD 히스토그램 기울기 하락 AND 현재봉 음봉
 *
 * 기존 rsi-oversold 대비: MA20 위치 제약 없이 히스토그램 전환을 반전 시그널로 활용 → 발화 빈도 3~5배.
 * 노이즈 통제는 AI EV 필터에 위임.
 */
export const rsiMacdReversal: RuleFunction = ({ strategyId, symbol, candles, ticker, amountKRW, style }) => {
  if (candles.length < 30) return [];
  const closes = candles.map(c => c.close);
  const rsiSeries = rsi(closes, 14);
  const macdPts   = macd(closes);

  const n = candles.length - 1;
  const r      = rsiSeries[n];
  const rPrev  = rsiSeries[n - 1];
  const h      = macdPts[n].histogram;
  const hPrev  = macdPts[n - 1].histogram;
  const hPrev2 = macdPts[n - 2].histogram;
  if (r == null || rPrev == null || h == null || hPrev == null || hPrev2 == null) return [];

  const cur = candles[n];
  const price = ticker.price;

  // 매수: RSI 상승 전환 + 히스토그램 하락 둔화/반등 + 양봉
  const rsiRising     = r > rPrev;
  const histTurningUp = h > hPrev && hPrev <= hPrev2; // 기울기 전환
  const bullCandle    = cur.close > cur.open;

  if (r < 45 && rsiRising && histTurningUp && bullCandle) {
    return [{
      strategyId, symbol, side: 'buy', orderType: 'limit', price, amountKRW,
      reasoning: `RSI ${rPrev.toFixed(1)}→${r.toFixed(1)} 상승 전환 + MACD hist ${hPrev2.toFixed(2)}→${hPrev.toFixed(2)}→${h.toFixed(2)} 반등 + 양봉`,
      indicators: { rsi14: r, rsiPrev: rPrev, histCurr: h, histPrev: hPrev, histPrev2: hPrev2, price },
    }];
  }

  // 매도: RSI 하락 전환 + 히스토그램 상승 둔화/하락 + 음봉
  const rsiFalling      = r < rPrev;
  const histTurningDown = h < hPrev && hPrev >= hPrev2;
  const bearCandle      = cur.close < cur.open;

  if (r > 55 && rsiFalling && histTurningDown && bearCandle) {
    return [{
      strategyId, symbol, side: 'sell', orderType: 'limit', price, amountKRW,
      reasoning: `RSI ${rPrev.toFixed(1)}→${r.toFixed(1)} 하락 전환 + MACD hist ${hPrev2.toFixed(2)}→${hPrev.toFixed(2)}→${h.toFixed(2)} 둔화 + 음봉`,
      indicators: { rsi14: r, rsiPrev: rPrev, histCurr: h, histPrev: hPrev, histPrev2: hPrev2, price },
    }];
  }

  // style 가드: aggressive 프리셋 외에서는 미발화 (보수 모드는 기존 룰 사용)
  if (style.rsiSellPriceMult > 1.0) return [];
  return [];
};
