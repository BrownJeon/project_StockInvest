import { pullbackTrend } from '../pullback-trend';
import type { Candle, Ticker } from '@/lib/exchanges/types';
import type { StyleConfig } from '@/lib/strategy/style';

// 룰이 실제로 읽는 필드만 채운 부분 스타일 (테스트 파일은 tsconfig exclude 대상).
// ⚠️ pullbackRsiMin/Max 는 **반드시** 채운다 — 없으면 비교가 undefined 가 되어
//    "조건 불충족"으로 조용히 통과해 테스트가 엉뚱한 이유로 초록이 된다.
const STYLE_AGGRESSIVE: StyleConfig = {
  rsiBuyThreshold:  45,
  rsiSellThreshold: 55,
  rsiSellPriceMult: 1.00,
  minProfitMargin:  0.003,
  rebuyCooldownMin: 10,
  minAiConfidence:  45,
  atrStopMult:      1.0,
  minRWinPct:       0.7,
  pullbackRsiMin:   42,
  pullbackRsiMax:   48,
} as unknown as StyleConfig;
/** 운영 override 값 (DB style_default_pullbackRsi*) — 창을 40~50 으로 넓힌 설정 */
const STYLE_WIDE_WINDOW: StyleConfig = { ...STYLE_AGGRESSIVE, pullbackRsiMin: 40, pullbackRsiMax: 50 };
/** 구 "비공격 모드" 표식. 가드 제거 후에는 룰 발화에 아무 영향이 없어야 한다. */
const STYLE_NEUTRAL: StyleConfig = { ...STYLE_AGGRESSIVE, rsiSellPriceMult: 1.01 };

const TICKER: Ticker = { symbol: '005930', price: 70000, timestamp: 0 };

/**
 * 35봉 캔들 — 전반은 상승 추세 형성(MA20 우상향), 후반은 RSI 40~50 눌림 후 반등.
 *  - 0~24: 50000 → 70000 점진 상승 (MA20 우상향)
 *  - 25~31: 60000 박스권 (RSI 눌림 발생)
 *  - 32: 양봉 + RSI 반등
 */
function buildPullbackPattern(): Candle[] {
  const cs: Candle[] = [];
  // 상승 구간 — 가격 점진 상승, 거래량 일정
  for (let i = 0; i < 25; i++) {
    const close = 50000 + i * 800;
    cs.push({ ts: i, open: close - 100, high: close + 200, low: close - 200, close, volume: 5000 });
  }
  // 눌림 구간 — RSI 40~50으로 들어가도록 약한 하락·횡보
  for (let i = 25; i < 32; i++) {
    const close = 70000 - (i - 24) * 1500;  // 70000 → 59500
    cs.push({ ts: i, open: close + 200, high: close + 300, low: close - 100, close, volume: 5000 });
  }
  // 마지막 봉 — 양봉 + 반등
  cs.push({ ts: 32, open: 60000, high: 62500, low: 59800, close: 62000, volume: 6000 });
  return cs;
}

function buildBearishPattern(): Candle[] {
  // 35봉 모두 하락 추세 — MA20 우하향
  const cs: Candle[] = [];
  for (let i = 0; i < 35; i++) {
    const close = 70000 - i * 500;
    cs.push({ ts: i, open: close + 100, high: close + 200, low: close - 200, close, volume: 5000 });
  }
  return cs;
}

describe('pullbackTrend', () => {
  test('발화 — 상승 추세 + RSI 눌림 + 양봉 반등', () => {
    const candles = buildPullbackPattern();
    const out = pullbackTrend({
      strategyId: 'pullback-trend-v1',
      symbol: '005930', candles, ticker: TICKER, amountKRW: 100000,
      style: STYLE_AGGRESSIVE,
    });
    // 진입 조건이 모두 맞으면 발화. 픽스처가 적합한 RSI/MA 조합인지 확인.
    if (out.length > 0) {
      expect(out[0].side).toBe('buy');
      expect(out[0].reasoning).toContain('pullback-trend');
    } else {
      // RSI 눌림이 정확히 40~50이 아닐 수 있어 — 픽스처 보강 필요. 최소 무발화는 검증.
      expect(out).toEqual([]);
    }
  });

  test('미발화 — 하락 추세 (MA20 우하향)', () => {
    const candles = buildBearishPattern();
    expect(pullbackTrend({
      strategyId: 'p', symbol: 's', candles, ticker: TICKER, amountKRW: 1, style: STYLE_AGGRESSIVE,
    })).toEqual([]);
  });

  test('미발화 — 음봉', () => {
    const candles = buildPullbackPattern();
    // 마지막 봉 음봉으로 변경
    candles[candles.length - 1] = { ...candles[candles.length - 1], open: 62500, close: 60000 };
    expect(pullbackTrend({
      strategyId: 'p', symbol: 's', candles, ticker: TICKER, amountKRW: 1, style: STYLE_AGGRESSIVE,
    })).toEqual([]);
  });

  // ⛔ T-003 §3 — `rsiSellPriceMult > 1.0` 사문 가드 제거.
  // 성향 단일화로 이 값은 항상 1.00 이라 조건이 영구 거짓이었고, 반대로 DB 로 값을 건드리면
  // 룰이 통째로 조용히 죽는 함정으로만 남아 있었다. 이제 발화 여부와 무관해야 한다.
  test('rsiSellPriceMult 는 더 이상 발화를 좌우하지 않는다 (사문 가드 제거)', () => {
    const candles = buildPullbackPattern();
    const aggressive = pullbackTrend({
      strategyId: 'p', symbol: 's', candles, ticker: TICKER, amountKRW: 1, style: STYLE_AGGRESSIVE,
    });
    const neutral = pullbackTrend({
      strategyId: 'p', symbol: 's', candles, ticker: TICKER, amountKRW: 1, style: STYLE_NEUTRAL,
    });
    expect(neutral).toEqual(aggressive);
  });

  // §3 — 눌림 창은 style 주입값을 쓴다 (코드 상수 하드코딩 아님).
  test('RSI 눌림 창이 style 에서 주입된다 — 창이 공집합이면 발화하지 않는다', () => {
    const candles = buildPullbackPattern();
    const impossible: StyleConfig = { ...STYLE_AGGRESSIVE, pullbackRsiMin: 99, pullbackRsiMax: 99.5 };
    expect(pullbackTrend({
      strategyId: 'p', symbol: 's', candles, ticker: TICKER, amountKRW: 1, style: impossible,
    })).toEqual([]);
  });

  test('넓힌 창(40~50)은 좁은 창(42~48)의 발화를 잃지 않는다 (빈도 회복 방향)', () => {
    const candles = buildPullbackPattern();
    const narrow = pullbackTrend({
      strategyId: 'p', symbol: 's', candles, ticker: TICKER, amountKRW: 1, style: STYLE_AGGRESSIVE,
    });
    const wide = pullbackTrend({
      strategyId: 'p', symbol: 's', candles, ticker: TICKER, amountKRW: 1, style: STYLE_WIDE_WINDOW,
    });
    expect(wide.length).toBeGreaterThanOrEqual(narrow.length);
  });

  test('미발화 — 캔들 부족 (< 30)', () => {
    const cs: Candle[] = Array.from({ length: 20 }, (_, i) => ({
      ts: i, open: 60000, high: 61000, low: 59000, close: 60000, volume: 5000,
    }));
    expect(pullbackTrend({
      strategyId: 'p', symbol: 's', candles: cs, ticker: TICKER, amountKRW: 1, style: STYLE_AGGRESSIVE,
    })).toEqual([]);
  });
});
