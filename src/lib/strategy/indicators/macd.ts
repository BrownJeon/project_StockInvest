import { ema } from './ema';

export interface MacdPoint {
  macd: number | null;
  signal: number | null;
  histogram: number | null;
}

/**
 * MACD: EMA(fast) − EMA(slow), signal = EMA(macd, signalPeriod)
 * Defaults: fast=12, slow=26, signal=9
 */
export function macd(
  closes: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): MacdPoint[] {
  const fastEma = ema(closes, fast);
  const slowEma = ema(closes, slow);

  const macdLine: (number | null)[] = closes.map((_, i) => {
    if (fastEma[i] == null || slowEma[i] == null) return null;
    return (fastEma[i] as number) - (slowEma[i] as number);
  });

  // Build dense array for signal EMA calculation
  const macdValues = macdLine.filter((v): v is number => v !== null);
  const signalDense = ema(macdValues, signalPeriod);

  // Map signal back to original indices
  const signalLine: (number | null)[] = new Array(closes.length).fill(null);
  let denseIdx = 0;
  for (let i = 0; i < closes.length; i++) {
    if (macdLine[i] !== null) {
      signalLine[i] = signalDense[denseIdx] ?? null;
      denseIdx++;
    }
  }

  return closes.map((_, i) => {
    const m = macdLine[i];
    const s = signalLine[i];
    return {
      macd: m,
      signal: s,
      histogram: m != null && s != null ? m - s : null,
    };
  });
}

export function macdLast(
  closes: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): MacdPoint {
  const arr = macd(closes, fast, slow, signalPeriod);
  return arr[arr.length - 1] ?? { macd: null, signal: null, histogram: null };
}
