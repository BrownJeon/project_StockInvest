import type { Candle } from '@/lib/exchanges/types';
import { rsiLast } from '../indicators/rsi';
import { smaLast } from '../indicators/sma';
import type { DailyCandidate } from './eod-high-close';

/**
 * 내부봉 눌림 패턴 (Inside Bar):
 * - 당일 고가 < 전일 고가 AND 당일 저가 > 전일 저가 (전일 범위 안에 포함)
 * - 당일 body (|종가 - 시가|) < 전일 body의 60% (압축)
 * - 거래량 감소: 당일 < 20일 평균 × 0.8 (눌림 확인)
 * - MA5 > MA20 (상승 추세 중 눌림)
 *
 * → 압축 에너지가 다음날 방향성 돌파로 이어질 기대
 */
export function insideBar(symbol: string, dailyCandles: Candle[]): DailyCandidate | null {
  if (dailyCandles.length < 22) return null;

  const n = dailyCandles.length - 1;
  const today = dailyCandles[n];
  const prev  = dailyCandles[n - 1];
  const closes  = dailyCandles.map(c => c.close);
  const volumes = dailyCandles.map(c => c.volume ?? 0);

  // 내부봉 조건
  if (today.high >= prev.high || today.low <= prev.low) return null;

  // body 압축 조건
  const todayBody = Math.abs(today.close - today.open);
  const prevBody  = Math.abs(prev.close  - prev.open);
  if (prevBody <= 0 || todayBody / prevBody > 0.60) return null;

  // 거래량 감소 (눌림 신호)
  const vol20Avg = volumes.slice(-21, -1).reduce((s, v) => s + v, 0) / 20;
  const volRatio = vol20Avg > 0 ? today.volume / vol20Avg : 1;
  if (volRatio > 0.9) return null; // 0.9배 초과면 눌림 불충분

  // 상승 추세 확인 (MA5 > MA20)
  const ma5  = smaLast(closes, 5);
  const ma20 = smaLast(closes, 20);
  if (ma5 == null || ma20 == null || ma5 <= ma20) return null;

  const rsi14 = rsiLast(closes, 14);

  return {
    symbol,
    pattern: 'inside-bar',
    close:    today.close,
    high:     today.high,
    low:      today.low,
    open:     today.open,
    volume:   today.volume,
    volRatio,
    rsi14,
    ma5,
    ma20,
    reasoning: `내부봉 눌림: body압축=${(todayBody / prevBody * 100).toFixed(0)}% 거래량=${volRatio.toFixed(2)}x MA5=${ma5.toFixed(0)}>MA20=${ma20.toFixed(0)}`,
  };
}
