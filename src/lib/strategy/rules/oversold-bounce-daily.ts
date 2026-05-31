import type { Candle } from '@/lib/exchanges/types';
import { rsiLast } from '../indicators/rsi';
import { smaLast } from '../indicators/sma';
import { bollinger } from '../indicators/bollinger';
import type { DailyCandidate } from './eod-high-close';

/**
 * 일봉 과매도 반등 패턴:
 * - RSI(14) < 35 (과매도 구간)
 * - 당일 종가가 전일 저가보다 높음 (전저점 위 마감 — 추가 하락 차단)
 * - 종가가 BB 하단 밴드 위 (밴드 밖에서 마감하면 과매도 지속 위험)
 * - 최근 3일 중 최소 1일 이상 양봉 (반등 시도 확인)
 *
 * → 단기 반등(1~3일) 기대
 */
export function oversoldBounceDaily(symbol: string, dailyCandles: Candle[]): DailyCandidate | null {
  if (dailyCandles.length < 22) return null;

  const n = dailyCandles.length - 1;
  const today = dailyCandles[n];
  const prev  = dailyCandles[n - 1];
  const closes  = dailyCandles.map(c => c.close);
  const volumes = dailyCandles.map(c => c.volume ?? 0);

  // RSI 과매도 조건
  const rsi14 = rsiLast(closes, 14);
  if (rsi14 == null || rsi14 >= 35) return null;

  // 전저점 위 마감 (바닥 지지 확인)
  if (today.close <= prev.low) return null;

  // BB 하단 위 마감
  const bands = bollinger(closes, 20, 2);
  const curBand = bands[n];
  if (curBand.lower == null || today.close < curBand.lower) return null;

  // 최근 3일 중 1일 이상 양봉
  const recentBullish = dailyCandles.slice(-3).filter(c => c.close > c.open).length;
  if (recentBullish === 0) return null;

  const ma5  = smaLast(closes, 5);
  const ma20 = smaLast(closes, 20);
  const vol20Avg = volumes.slice(-21, -1).reduce((s, v) => s + v, 0) / 20;
  const volRatio = vol20Avg > 0 ? today.volume / vol20Avg : 1;

  return {
    symbol,
    pattern: 'oversold-bounce',
    close:    today.close,
    high:     today.high,
    low:      today.low,
    open:     today.open,
    volume:   today.volume,
    volRatio,
    rsi14,
    ma5,
    ma20,
    reasoning: `과매도 반등: RSI=${rsi14.toFixed(0)} BB하단위=${curBand.lower.toFixed(0)} 전저점위=${prev.low.toFixed(0)} 최근양봉=${recentBullish}/3`,
  };
}
