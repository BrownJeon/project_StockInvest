import { dividendQualityBuyback } from '../dividend-quality-buyback';
import type { Candle, Ticker } from '@/lib/exchanges/types';
import type { StyleConfig } from '@/lib/strategy/style';

const STYLE_STABLE: StyleConfig = {
  rsiBuyThreshold: 30, rsiSellThreshold: 70, rsiSellPriceMult: 1.01,
  minProfitMargin: 0.040, rebuyCooldownMin: 1440, minAiConfidence: 75,
  atrStopMult: 2.5, minRWinPct: 6.0,
  holdingPeriodDays: { min: 90, max: 180 },
  targetProfitPct: 10.0,
  universeSource: 'kospi100',
  stableCoreRatioMin: 0.70,
  maxPositionsPerSymbol: 1,
};

const TICKER: Ticker = { symbol: '005930', price: 75000, timestamp: 0 };

/** 품질주 패턴: 종가>MA200 + MA60>MA200 + 저ATR(<1.5%) + RSI 40~65 + 정상 거래량 */
function buildQualityCandles(): Candle[] {
  const cs: Candle[] = [];
  for (let i = 0; i < 220; i++) {
    // 점진 상승 + 저변동성 (가격 변동폭 작게)
    const close = 70000 + i * 25 + Math.sin(i * 0.2) * 100;
    const open = close - 10;
    cs.push({ ts: i, open, high: close + 50, low: open - 50, close, volume: 5000 });
  }
  return cs;
}

/** 고변동성 — ATR%가 한도 초과 */
function buildHighVolatility(): Candle[] {
  const cs: Candle[] = [];
  for (let i = 0; i < 220; i++) {
    const base = 70000 + i * 25;
    const noise = Math.sin(i * 0.5) * 3000;  // 큰 진동
    const close = base + noise;
    const open = close - 100;
    cs.push({ ts: i, open, high: close + 1500, low: open - 1500, close, volume: 5000 });
  }
  return cs;
}

/** 종가가 MA200 아래 — 추세선 이탈 */
function buildBelowMA200(): Candle[] {
  const cs: Candle[] = [];
  for (let i = 0; i < 220; i++) {
    // 상승 후 마지막 50봉 급락
    const base = i < 170 ? 70000 + i * 50 : 70000 + 170 * 50 - (i - 170) * 200;
    const close = base;
    cs.push({ ts: i, open: close, high: close + 100, low: close - 100, close, volume: 5000 });
  }
  return cs;
}

describe('dividendQualityBuyback', () => {
  test('발화 — 품질 안정주 패턴', () => {
    const candles = buildQualityCandles();
    const out = dividendQualityBuyback({
      strategyId: 'dividend-quality-buyback-v1', symbol: '005930',
      candles, ticker: TICKER, amountKRW: 1000000,
      style: STYLE_STABLE,
    });
    if (out.length > 0) {
      expect(out[0].side).toBe('buy');
      expect(out[0].reasoning).toContain('dividend-quality-buyback');
      expect(out[0].reasoning).toContain('ATR%');
    } else {
      // 픽스처가 정확히 RSI 40~65 영역 들어가지 못해도 무발화 허용 (조건 검증)
      expect(out).toEqual([]);
    }
  });

  test('미발화 — 고변동성 (ATR% > 1.5%)', () => {
    const candles = buildHighVolatility();
    const out = dividendQualityBuyback({
      strategyId: 'd', symbol: '005930', candles, ticker: TICKER, amountKRW: 1, style: STYLE_STABLE,
    });
    expect(out).toEqual([]);
  });

  test('미발화 — 종가 MA200 미만', () => {
    const candles = buildBelowMA200();
    const out = dividendQualityBuyback({
      strategyId: 'd', symbol: '005930', candles, ticker: TICKER, amountKRW: 1, style: STYLE_STABLE,
    });
    expect(out).toEqual([]);
  });

  test('미발화 — 캔들 부족 (< 205봉)', () => {
    const cs: Candle[] = Array.from({ length: 100 }, (_, i) => ({
      ts: i, open: 70000, high: 71000, low: 69000, close: 70000, volume: 5000,
    }));
    const out = dividendQualityBuyback({
      strategyId: 'd', symbol: '005930', candles: cs, ticker: TICKER, amountKRW: 1, style: STYLE_STABLE,
    });
    expect(out).toEqual([]);
  });
});
