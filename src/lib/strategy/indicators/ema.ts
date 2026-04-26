/**
 * Exponential Moving Average (Wilder-style multiplier: 2/(period+1))
 * Seeded with SMA of the first `period` values.
 */
export function ema(values: number[], period: number): (number | null)[] {
  if (period <= 0) throw new RangeError('period must be > 0');
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;

  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i++) prev += values[i];
  prev /= period;
  out[period - 1] = prev;

  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function emaLast(values: number[], period: number): number | null {
  const arr = ema(values, period);
  return arr[arr.length - 1] ?? null;
}
