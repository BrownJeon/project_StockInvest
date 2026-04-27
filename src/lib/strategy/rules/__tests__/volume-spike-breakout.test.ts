import { volumeSpikeBreakout } from '../volume-spike-breakout';
import type { Candle, Ticker } from '@/lib/exchanges/types';
import type { StyleConfig } from '@/lib/strategy/style';

const STYLE_AGGRESSIVE: StyleConfig = {
  rsiBuyThreshold:  45,
  rsiSellThreshold: 55,
  rsiSellPriceMult: 1.00,   // 공격
  minProfitMargin:  0.003,
  rebuyCooldownMin: 10,
  minAiConfidence:  45,
  atrStopMult:      1.0,
  minRWinPct:       0.7,
};

const STYLE_NEUTRAL: StyleConfig = { ...STYLE_AGGRESSIVE, rsiSellPriceMult: 1.01 };

const TICKER: Ticker = { symbol: '005930', price: 70000, timestamp: 0 };

/**
 * 22봉 캔들 생성 — 직전 20봉은 평균 가격 60000, 거래량 10000.
 * 끝에서 두 번째 봉(prev) close 60000, 마지막 봉(cur) close = closeOverride.
 */
function buildCandles(opts: {
  curClose:  number;
  curOpen:   number;
  curVolume: number;
  curHigh?:  number;
  prevClose?: number;
  prior20High?: number;
}): Candle[] {
  const cs: Candle[] = [];
  // 직전 20봉 — close 60000, vol 10000
  for (let i = 0; i < 20; i++) {
    const high = opts.prior20High ?? 61000;
    cs.push({
      ts: i, open: 60000, high, low: 59000, close: 60000, volume: 10000,
    });
  }
  // n-1 봉 (prev)
  cs.push({ ts: 20, open: 60000, high: 61000, low: 59500, close: opts.prevClose ?? 60000, volume: 10000 });
  // n 봉 (cur)
  cs.push({
    ts: 21,
    open:  opts.curOpen,
    high:  opts.curHigh ?? opts.curClose,
    low:   opts.curOpen - 100,
    close: opts.curClose,
    volume: opts.curVolume,
  });
  return cs;
}

describe('volumeSpikeBreakout', () => {
  test('발화 — 거래량 ×3 + 신고가 돌파 + ATR 이격 + 양봉', () => {
    const candles = buildCandles({
      curClose: 65000, curOpen: 60000, curVolume: 35000,  // 평균 10000 × 3.5
      prevClose: 60000,
      prior20High: 61000,
    });
    const out = volumeSpikeBreakout({
      strategyId: 'volume-spike-breakout-v1',
      symbol: '005930', candles, ticker: TICKER, amountKRW: 100000,
      style: STYLE_AGGRESSIVE,
    });
    expect(out.length).toBe(1);
    expect(out[0].side).toBe('buy');
    expect(out[0].reasoning).toContain('volume-spike-breakout');
  });

  test('미발화 — 음봉', () => {
    const candles = buildCandles({
      curClose: 59000, curOpen: 60000, curVolume: 35000,  // 음봉
      prevClose: 60000,
    });
    expect(volumeSpikeBreakout({
      strategyId: 'v', symbol: 's', candles, ticker: TICKER, amountKRW: 1, style: STYLE_AGGRESSIVE,
    })).toEqual([]);
  });

  test('미발화 — 거래량 평균 대비 ×2.9 (×3 미만)', () => {
    const candles = buildCandles({
      curClose: 65000, curOpen: 60000, curVolume: 29000,
      prevClose: 60000,
    });
    expect(volumeSpikeBreakout({
      strategyId: 'v', symbol: 's', candles, ticker: TICKER, amountKRW: 1, style: STYLE_AGGRESSIVE,
    })).toEqual([]);
  });

  test('미발화 — 신고가 돌파 안 됨 (close <= prior20High)', () => {
    const candles = buildCandles({
      curClose: 61000, curOpen: 60000, curVolume: 35000,
      prevClose: 60000,
      prior20High: 61000,  // close 61000 = prior20High → 돌파 안 됨
    });
    expect(volumeSpikeBreakout({
      strategyId: 'v', symbol: 's', candles, ticker: TICKER, amountKRW: 1, style: STYLE_AGGRESSIVE,
    })).toEqual([]);
  });

  test('미발화 — ATR 이격 부족 (gap < ATR×0.5)', () => {
    // prev close 60000, cur close 60050 → gap 50, ATR ~1000 → ATR×0.5=500 → 미통과
    const candles = buildCandles({
      curClose: 65000, curOpen: 60000, curVolume: 35000,
      prevClose: 64980,  // gap 20
      prior20High: 61000,
    });
    expect(volumeSpikeBreakout({
      strategyId: 'v', symbol: 's', candles, ticker: TICKER, amountKRW: 1, style: STYLE_AGGRESSIVE,
    })).toEqual([]);
  });

  test('미발화 — 비공격 모드 (rsiSellPriceMult > 1.0)', () => {
    const candles = buildCandles({
      curClose: 65000, curOpen: 60000, curVolume: 35000,
      prevClose: 60000,
    });
    expect(volumeSpikeBreakout({
      strategyId: 'v', symbol: 's', candles, ticker: TICKER, amountKRW: 1, style: STYLE_NEUTRAL,
    })).toEqual([]);
  });

  test('미발화 — 캔들 부족 (< 22)', () => {
    const cs: Candle[] = Array.from({ length: 10 }, (_, i) => ({
      ts: i, open: 60000, high: 61000, low: 59000, close: 60000, volume: 10000,
    }));
    expect(volumeSpikeBreakout({
      strategyId: 'v', symbol: 's', candles: cs, ticker: TICKER, amountKRW: 1, style: STYLE_AGGRESSIVE,
    })).toEqual([]);
  });
});
