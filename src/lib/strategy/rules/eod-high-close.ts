import type { Candle } from '@/lib/exchanges/types';
import { rsiLast } from '../indicators/rsi';
import { smaLast } from '../indicators/sma';

export interface DailyCandidate {
  symbol: string;
  pattern: 'eod-high-close' | 'inside-bar' | 'oversold-bounce';
  close: number;
  high: number;
  low: number;
  open: number;
  volume: number;
  volRatio: number;
  rsi14: number | null;
  ma5: number | null;
  ma20: number | null;
  reasoning: string;
}

/**
 * 당일 고점 마감 패턴:
 * - 당일 종가가 (고가 - 저가) 범위의 상위 30% 이내 위치
 * - 거래량이 20일 평균의 1.5배 이상
 * - RSI 50 이상 (과매수 아님, 70 미만)
 *
 * → 다음날 갭업 또는 모멘텀 지속 기대
 */
export function eodHighClose(symbol: string, dailyCandles: Candle[]): DailyCandidate | null {
  if (dailyCandles.length < 22) return null;

  const today = dailyCandles[dailyCandles.length - 1];
  const closes = dailyCandles.map(c => c.close);
  const volumes = dailyCandles.map(c => c.volume ?? 0);

  const range = today.high - today.low;
  if (range <= 0) return null;

  // 고점 마감 조건: 종가가 고저 범위의 상위 30% 이내
  const closePosition = (today.close - today.low) / range;
  if (closePosition < 0.70) return null;

  // 거래량 조건: 20일 평균 대비 1.5x 이상
  const vol20Avg = volumes.slice(-21, -1).reduce((s, v) => s + v, 0) / 20;
  const volRatio = vol20Avg > 0 ? today.volume / vol20Avg : 0;
  if (volRatio < 1.5) return null;

  // RSI 조건: 50~70 범위 (모멘텀 있으나 과매수 아님)
  const rsi14 = rsiLast(closes, 14);
  if (rsi14 == null || rsi14 < 50 || rsi14 > 75) return null;

  const ma5  = smaLast(closes, 5);
  const ma20 = smaLast(closes, 20);

  return {
    symbol,
    pattern: 'eod-high-close',
    close:    today.close,
    high:     today.high,
    low:      today.low,
    open:     today.open,
    volume:   today.volume,
    volRatio,
    rsi14,
    ma5,
    ma20,
    reasoning: `당일 고점 마감: 종가위치=${(closePosition * 100).toFixed(0)}% 거래량=${volRatio.toFixed(1)}x RSI=${rsi14.toFixed(0)}`,
  };
}
