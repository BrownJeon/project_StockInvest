export interface OHLC { high: number; low: number; close: number }

/**
 * Average True Range (Wilder's smoothed method)
 * TR = max(high−low, |high−prevClose|, |low−prevClose|)
 * ATR[period] = SMA(TR[1..period]), then Wilder smoothing.
 */
export function atr(candles: OHLC[], period = 14): (number | null)[] {
  if (period <= 0) throw new RangeError('period must be > 0');
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length <= period) return out;

  // True range for each bar
  const tr: number[] = [0]; // index 0 has no prev — seed with 0, not used in avg
  for (let i = 1; i < candles.length; i++) {
    const { high, low } = candles[i];
    const prevClose = candles[i - 1].close;
    tr.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }

  // Seed: SMA of first `period` true ranges (indices 1..period)
  let prev = 0;
  for (let i = 1; i <= period; i++) prev += tr[i];
  prev /= period;
  out[period] = prev;

  for (let i = period + 1; i < candles.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

export function atrLast(candles: OHLC[], period = 14): number | null {
  const arr = atr(candles, period);
  return arr[arr.length - 1] ?? null;
}
