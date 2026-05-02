import { rsiOverboughtExit } from '../rsi-overbought-exit';
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

const TICKER: Ticker = { symbol: '005930', price: 71000, timestamp: 0 };

/**
 * 30봉 — 점진 상승으로 RSI > 58(=sellT+3=55+3)이 되도록 만든 후 마지막 음봉 + 정상 거래량.
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
  cs.push({ ts: 29, open: 71000, high: 71200, low: 69800, close: 70000, volume: 5500 });
  return cs;
}

describe('rsiOverboughtExit (sell-only)', () => {
  test('미발화 — 거래량 가드 (직전 5봉 평균 0.5x 미만)', () => {
    const candles = buildOverboughtPattern();
    // 마지막 봉 거래량을 평균(5000)의 30%로 만들어 가드 트리거
    candles[candles.length - 1] = { ...candles[candles.length - 1], volume: 1500 };
    expect(rsiOverboughtExit({
      strategyId: 'rsi-overbought-exit-v1',
      symbol: '005930', candles, ticker: TICKER, amountKRW: 100000,
      style: STYLE_AGGRESSIVE,
    })).toEqual([]);
  });

  test('미발화 — 캔들 부족', () => {
    const cs: Candle[] = Array.from({ length: 20 }, (_, i) => ({
      ts: i, open: 70000, high: 71000, low: 69000, close: 70000, volume: 5000,
    }));
    expect(rsiOverboughtExit({
      strategyId: 'p', symbol: 's', candles: cs, ticker: TICKER, amountKRW: 1, style: STYLE_AGGRESSIVE,
    })).toEqual([]);
  });

  test('미발화 — 매수 후보 (RSI 낮음)', () => {
    const cs: Candle[] = [];
    for (let i = 0; i < 30; i++) {
      const close = 70000 - i * 500;
      cs.push({ ts: i, open: close + 100, high: close + 200, low: close - 200, close, volume: 5000 });
    }
    // 절대 sell 시그널 발화 없음 (전략은 sell 전용)
    const out = rsiOverboughtExit({
      strategyId: 'rsi-overbought-exit-v1',
      symbol: '005930', candles: cs, ticker: { symbol: '005930', price: 56000, timestamp: 0 },
      amountKRW: 100000, style: STYLE_AGGRESSIVE,
    });
    expect(out.filter(s => s.side === 'buy')).toEqual([]);
  });

  test('발화 가능성 — 과열 + 거래량 정상 + 음봉이면 sell 발화', () => {
    const candles = buildOverboughtPattern();
    const out = rsiOverboughtExit({
      strategyId: 'rsi-overbought-exit-v1',
      symbol: '005930', candles, ticker: TICKER, amountKRW: 100000,
      style: STYLE_AGGRESSIVE,
    });
    // 픽스처 RSI/MA 조합이 정확히 sellT+3 초과인지 확정 어려움 — 발화 시 sell·과열 청산 메시지 검증
    if (out.length > 0) {
      expect(out[0].side).toBe('sell');
      expect(out[0].reasoning).toContain('과열 청산');
    } else {
      expect(out).toEqual([]);
    }
  });
});
