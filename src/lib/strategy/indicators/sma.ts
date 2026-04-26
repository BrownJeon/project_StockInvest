/**
 * Simple Moving Average
 * Returns null for each position where insufficient data exists.
 */
export function sma(values: number[], period: number): (number | null)[] {
  if (period <= 0) throw new RangeError('period must be > 0');
  const out: (number | null)[] = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j];
    out[i] = sum / period;
  }
  return out;
}

/** Returns the last non-null SMA value, or null if insufficient data. */
export function smaLast(values: number[], period: number): number | null {
  if (values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i];
  return sum / period;
}
