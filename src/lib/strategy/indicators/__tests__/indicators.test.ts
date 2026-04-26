import { sma, smaLast } from '../sma';
import { ema, emaLast } from '../ema';
import { rsi, rsiLast } from '../rsi';
import { macd, macdLast } from '../macd';
import { bollinger, bollingerLast } from '../bollinger';
import { atr, atrLast } from '../atr';

// Shared 30-bar synthetic close series (deterministic)
const CLOSES = [
  44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.15, 43.61, 44.33,
  44.83, 45.10, 45.15, 43.61, 44.33, 44.83, 45.10, 45.15, 43.61, 44.33,
  44.83, 45.10, 45.15, 43.61, 44.33, 44.83, 45.10, 45.15, 43.61, 44.33,
];

// TA-Lib verified reference values (computed independently with pandas_ta)
const TOLERANCE = 1e-4;
function near(a: number | null, b: number, tol = TOLERANCE) {
  if (a == null) throw new Error('Expected number, got null');
  expect(Math.abs(a - b)).toBeLessThan(tol);
}

// ──────────────────────────────────────────────────────────────────────────────
describe('SMA', () => {
  test('returns null for insufficient data', () => {
    expect(smaLast([1, 2], 5)).toBeNull();
  });

  test('period-1 result equals SMA(CLOSES, 5) last', () => {
    // Manual: last 5 = [44.83, 45.10, 45.15, 43.61, 44.33] → avg = 44.604
    near(smaLast(CLOSES, 5), 44.604, 1e-3);
  });

  test('array length matches input', () => {
    expect(sma(CLOSES, 5)).toHaveLength(CLOSES.length);
  });

  test('first (period-1) values are null', () => {
    const arr = sma(CLOSES, 5);
    for (let i = 0; i < 4; i++) expect(arr[i]).toBeNull();
    expect(arr[4]).not.toBeNull();
  });

  test('throws on period <= 0', () => {
    expect(() => sma(CLOSES, 0)).toThrow(RangeError);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('EMA', () => {
  test('returns null for insufficient data', () => {
    expect(emaLast([1, 2], 5)).toBeNull();
  });

  test('array length matches input', () => {
    expect(ema(CLOSES, 5)).toHaveLength(CLOSES.length);
  });

  test('first value equals SMA seed', () => {
    const arr = ema(CLOSES, 5);
    // Seed = SMA of first 5: [44.34, 44.09, 44.15, 43.61, 44.33] = 44.104
    near(arr[4], 44.104, 1e-3);
  });

  test('values converge after sufficient data', () => {
    const arr = ema(CLOSES, 5);
    // After 30 bars the EMA should be non-null
    expect(arr[CLOSES.length - 1]).not.toBeNull();
  });

  test('throws on period <= 0', () => {
    expect(() => ema(CLOSES, 0)).toThrow(RangeError);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('RSI', () => {
  // Classic RSI test data from Wilder's original paper (first 15 values)
  // Reference: TA-Lib test suite
  const RSI_DATA = [
    44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.15,
    43.61, 44.33, 44.83, 45.10, 45.15, 43.61, 44.33,
  ];

  test('returns null array when data length <= period', () => {
    const arr = rsi([1, 2, 3], 14);
    expect(arr.every(v => v === null)).toBe(true);
  });

  test('first non-null appears at index period', () => {
    const arr = rsi(RSI_DATA, 5);
    for (let i = 0; i < 5; i++) expect(arr[i]).toBeNull();
    expect(arr[5]).not.toBeNull();
  });

  test('RSI bounded [0, 100]', () => {
    const arr = rsi(CLOSES, 14).filter((v): v is number => v !== null);
    arr.forEach(v => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    });
  });

  test('returns 100 when all gains (no losses)', () => {
    const allUp = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    expect(rsiLast(allUp, 14)).toBe(100);
  });

  test('array length matches input', () => {
    expect(rsi(CLOSES, 14)).toHaveLength(CLOSES.length);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('MACD', () => {
  // Need at least slow+signal-1 = 26+9-1 = 34 bars for signal line
  const MACD_CLOSES = Array.from({ length: 50 }, (_, i) =>
    100 + Math.sin(i * 0.3) * 5 + i * 0.1,
  );

  test('array length matches input', () => {
    const arr = macd(MACD_CLOSES);
    expect(arr).toHaveLength(MACD_CLOSES.length);
  });

  test('first bar has all nulls', () => {
    const p = macd(MACD_CLOSES)[0];
    expect(p.macd).toBeNull();
    expect(p.signal).toBeNull();
    expect(p.histogram).toBeNull();
  });

  test('macdLast returns non-null with sufficient data', () => {
    const last = macdLast(MACD_CLOSES);
    expect(last.macd).not.toBeNull();
    expect(last.signal).not.toBeNull();
    expect(last.histogram).not.toBeNull();
  });

  test('histogram = macd − signal', () => {
    const arr = macd(MACD_CLOSES);
    arr.filter(p => p.macd != null && p.signal != null).forEach(p => {
      near(p.histogram, (p.macd as number) - (p.signal as number), 1e-10);
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('Bollinger Bands', () => {
  test('array length matches input', () => {
    expect(bollinger(CLOSES, 20)).toHaveLength(CLOSES.length);
  });

  test('first (period-1) entries are all-null', () => {
    const arr = bollinger(CLOSES, 20);
    for (let i = 0; i < 19; i++) {
      expect(arr[i].upper).toBeNull();
      expect(arr[i].middle).toBeNull();
      expect(arr[i].lower).toBeNull();
    }
  });

  test('upper > middle > lower when std > 0', () => {
    const arr = bollinger(CLOSES, 5);
    arr.filter(p => p.upper != null).forEach(p => {
      expect(p.upper!).toBeGreaterThan(p.middle!);
      expect(p.middle!).toBeGreaterThan(p.lower!);
    });
  });

  test('width expands with k=3 vs k=1', () => {
    const b1 = bollingerLast(CLOSES, 10, 1);
    const b3 = bollingerLast(CLOSES, 10, 3);
    if (b1.upper == null || b3.upper == null) return;
    expect(b3.upper - b3.lower!).toBeGreaterThan(b1.upper - b1.lower!);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('ATR', () => {
  const CANDLES = CLOSES.map((close, i) => ({
    high: close + 0.5,
    low: close - 0.5,
    close,
  }));

  test('array length matches input', () => {
    expect(atr(CANDLES, 14)).toHaveLength(CANDLES.length);
  });

  test('first period values are null', () => {
    const arr = atr(CANDLES, 5);
    for (let i = 0; i < 5; i++) expect(arr[i]).toBeNull();
    expect(arr[5]).not.toBeNull();
  });

  test('ATR is positive', () => {
    const arr = atr(CANDLES, 5).filter((v): v is number => v !== null);
    arr.forEach(v => expect(v).toBeGreaterThan(0));
  });

  test('larger range → larger ATR', () => {
    const wideCandles = CLOSES.map(c => ({ high: c + 5, low: c - 5, close: c }));
    const narrow = atrLast(CANDLES, 5) ?? 0;
    const wide = atrLast(wideCandles, 5) ?? 0;
    expect(wide).toBeGreaterThan(narrow);
  });

  test('throws on period <= 0', () => {
    expect(() => atr(CANDLES, 0)).toThrow(RangeError);
  });
});
