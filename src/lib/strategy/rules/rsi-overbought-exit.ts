import { rsiLast } from '../indicators/rsi';
import { smaLast } from '../indicators/sma';
import type { RuleFunction } from './types';

/**
 * RSI(14) 과열 청산 전용 전략 (보유 종목 차익실현):
 *  - 매도: RSI > sellT+3 AND price > MA20 * sellM AND 하락 시작
 *
 * rsi-oversold-v1에서 분리. 매수/매도 의도를 전략 ID로 명확히 구분해 분석가가
 * "지금 매수 후보인지 청산 후보인지"를 헷갈리지 않도록 함.
 *
 * 발화 조건을 oversold 대비 강화:
 *  - sellT 기준 +3p (RSI 정점 근처에서만 발화 — late_entry 거절 감소 목표)
 *  - 거래량 직전 5봉 평균 대비 0.5x 이상 (호가 깊이 확보, 미체결 방지)
 */
export const rsiOverboughtExit: RuleFunction = ({ strategyId, symbol, candles, ticker, amountKRW, style }) => {
  if (candles.length < 22) return [];
  const closes = candles.map(c => c.close);
  const r = rsiLast(closes, 14);
  const ma20 = smaLast(closes, 20);
  if (r == null || ma20 == null) return [];

  const n = candles.length - 1;
  const cur = candles[n];
  const prev = candles[n - 1];

  const price = ticker.price;
  const sellT = style.rsiSellThreshold + 3;
  const sellM = style.rsiSellPriceMult;
  const sellReversal = cur.close < cur.open || cur.high <= prev.high;

  // 거래량 가드: 직전 5봉 평균의 50% 미만이면 발화 안함 (호가 깊이 부족 → 미체결 위험)
  const recentVols = candles.slice(-6, -1).map(c => c.volume ?? 0);
  const avgVol = recentVols.reduce((s, v) => s + v, 0) / Math.max(1, recentVols.length);
  if (avgVol > 0 && (cur.volume ?? 0) < avgVol * 0.5) return [];

  if (r > sellT && price > ma20 * sellM && sellReversal) {
    const reversalNote = cur.close < cur.open ? '음봉 반전' : '고점 하락';
    return [{
      strategyId, symbol, side: 'sell', orderType: 'limit', price, amountKRW,
      reasoning: `RSI14=${r.toFixed(1)} > ${sellT}, price=${price} > MA20×${sellM}=${(ma20 * sellM).toFixed(0)}, ${reversalNote} → 과열 청산`,
      indicators: { rsi14: r, ma20, price, reversalNote, avgVol, curVol: cur.volume },
    }];
  }
  return [];
};
