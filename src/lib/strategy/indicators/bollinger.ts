import { sma } from './sma';

export interface BollingerPoint {
  upper: number | null;
  middle: number | null;
  lower: number | null;
}

/**
 * Bollinger Bands: middle = SMA(period), upper/lower = middle ± k * stddev
 * Defaults: period=20, k=2
 */
export function bollinger(
  closes: number[],
  period = 20,
  k = 2,
): BollingerPoint[] {
  const mid = sma(closes, period);
  return closes.map((_, i) => {
    const m = mid[i];
    if (m == null) return { upper: null, middle: null, lower: null };
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) variance += (closes[j] - m) ** 2;
    const std = Math.sqrt(variance / period);
    return { upper: m + k * std, middle: m, lower: m - k * std };
  });
}

export function bollingerLast(
  closes: number[],
  period = 20,
  k = 2,
): BollingerPoint {
  const arr = bollinger(closes, period, k);
  return arr[arr.length - 1] ?? { upper: null, middle: null, lower: null };
}
