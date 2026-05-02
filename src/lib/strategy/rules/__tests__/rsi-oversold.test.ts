import { rsiOversold } from '../rsi-oversold';
import type { Candle, Ticker } from '@/lib/exchanges/types';
import type { StyleConfig } from '@/lib/strategy/style';

const STYLE_AGGRESSIVE: StyleConfig = {
  rsiBuyThreshold:  45,
  rsiSellThreshold: 55,
  rsiSellPriceMult: 1.00,
  minProfitMargin:  0.003,
  rebuyCooldownMin: 10,
  minAiConfidence:  45,
  atrStopMult:      1.0,
  minRWinPct:       0.7,
} as StyleConfig;

const TICKER: Ticker = { symbol: '005930', price: 50000, timestamp: 0 };

/**
 * 30봉 — 점진 하락으로 RSI<45 만들고 마지막 봉을 양봉으로 반전.
 */
function buildOversoldPattern(): Candle[] {
  const cs: Candle[] = [];
  for (let i = 0; i < 25; i++) {
    const close = 70000 - i * 800; // 70000 → 50800
    cs.push({ ts: i, open: close + 200, high: close + 300, low: close - 200, close, volume: 5000 });
  }
  for (let i = 25; i < 29; i++) {
    const close = 50000 - (i - 25) * 200;
    cs.push({ ts: i, open: close + 100, high: close + 200, low: close - 100, close, volume: 5000 });
  }
  // 마지막 봉 — 양봉 반전
  cs.push({ ts: 29, open: 49000, high: 50500, low: 48800, close: 50300, volume: 6000 });
  return cs;
}

/**
 * 30봉 — 점진 상승으로 RSI 고점 영역 + price > MA20 (sell 분기 발화 가능 패턴).
 * sell 분기가 분리되었으므로 발화 0건이 정답.
 */
function buildOverboughtPattern(): Candle[] {
  const cs: Candle[] = [];
  for (let i = 0; i < 25; i++) {
    const close = 50000 + i * 800;
    cs.push({ ts: i, open: close - 200, high: close + 200, low: close - 300, close, volume: 5000 });
  }
  for (let i = 25; i < 29; i++) {
    const close = 70000 + (i - 25) * 200;
    cs.push({ ts: i, open: close - 100, high: close + 200, low: close - 100, close, volume: 5000 });
  }
  // 마지막 봉 — 음봉 반전 (sell 트리거 패턴)
  cs.push({ ts: 29, open: 71000, high: 71200, low: 69800, close: 70000, volume: 6000 });
  return cs;
}

describe('rsiOversold (buy-only)', () => {
  test('미발화 — 과열 청산 패턴 (sell 분기 분리됨)', () => {
    const candles = buildOverboughtPattern();
    const overboughtTicker: Ticker = { symbol: '005930', price: 71000, timestamp: 0 };
    const out = rsiOversold({
      strategyId: 'rsi-oversold-v1',
      symbol: '005930', candles, ticker: overboughtTicker, amountKRW: 100000,
      style: STYLE_AGGRESSIVE,
    });
    // sell 분기 제거되었으므로 절대 sell 시그널 발화 없음
    expect(out.filter(s => s.side === 'sell')).toEqual([]);
  });

  test('발화 가능성 — 과매도 반등 패턴이면 buy 발화', () => {
    const candles = buildOversoldPattern();
    const out = rsiOversold({
      strategyId: 'rsi-oversold-v1',
      symbol: '005930', candles, ticker: TICKER, amountKRW: 100000,
      style: STYLE_AGGRESSIVE,
    });
    if (out.length > 0) {
      expect(out[0].side).toBe('buy');
      expect(out[0].reasoning).toContain('과매도 반등');
    } else {
      expect(out).toEqual([]);
    }
  });

  test('미발화 — 캔들 부족 (< 22)', () => {
    const cs: Candle[] = Array.from({ length: 20 }, (_, i) => ({
      ts: i, open: 60000, high: 61000, low: 59000, close: 60000, volume: 5000,
    }));
    expect(rsiOversold({
      strategyId: 'p', symbol: 's', candles: cs, ticker: TICKER, amountKRW: 1, style: STYLE_AGGRESSIVE,
    })).toEqual([]);
  });
});
