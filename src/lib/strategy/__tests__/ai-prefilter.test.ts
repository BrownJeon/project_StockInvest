/**
 * 프리필터 단위 테스트 (T-003 §1 ④ 안전·집행 단계).
 *
 * 지키는 계약:
 *  1. **완화 금지 게이트**는 그대로 작동한다 — liquidity_dead(상장폐지 방지) · atr_zero ·
 *     rsi_extreme_counter. §6-6 안전 회귀 기준.
 *  2. `strong_counter_trend` 는 **삭제**됐다 — 전역 추세 게이트가 역추세 룰(과매도 반등)의
 *     존재 이유와 정면 충돌했고 14일간 3,028건으로 프리필터 사살의 ~100%를 차지했다.
 *  3. `blowoff_top` 은 도달 불능이던 사문(priceChange5>30% — 국내 상한가가 30%)에서
 *     실측 가능한 임계(>10% && RSI>80)로 교정됐다.
 */
import type { Candle } from '@/lib/exchanges/types';
import type { Candidate, MarketSummary } from '../ai-filter';
import { prefilterCandidate } from '../ai-prefilter';

function candles(n: number, opts: { volume?: number; trailingZeroVolumes?: number } = {}): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      ts: new Date(Date.UTC(2026, 7, 6, i)).toISOString(),
      open: 100, high: 101, low: 99, close: 100,
      volume: opts.volume ?? 1000,
    } as Candle);
  }
  const z = opts.trailingZeroVolumes ?? 0;
  for (let i = out.length - z; i < out.length; i++) out[i].volume = 0;
  return out;
}

function summary(over: Partial<MarketSummary> = {}): MarketSummary {
  return {
    currentPrice: 100,
    priceChange5: 0,
    volumeRatio: 1,
    rsi14: 50,
    ema20: 100,
    ema60: 100,
    macd: 0, macdSignal: 0, macdHistogram: 0,
    bbUpper: 110, bbMiddle: 100, bbLower: 90,
    atr14: 2,
    high24h: 105, low24h: 95,
    recentCandles: [],
    poc: null, vah: null, val: null,
    ...over,
  } as MarketSummary;
}

function cand(side: 'buy' | 'sell' = 'buy'): Candidate {
  return { symbol: '005930', side, orderType: 'market', amountKRW: 100_000, strategyId: 'rsi-oversold-v1' };
}

describe('완화 금지 게이트 — 현행과 동일하게 작동해야 한다 (§6-6)', () => {
  test('liquidity_dead — 말미 무거래 + 거래량비 급락이면 차단 (상장폐지 패턴)', () => {
    const d = prefilterCandidate(cand(), summary({ volumeRatio: 0.1 }), candles(30, { trailingZeroVolumes: 1 }), 'neutral');
    expect(d.verdict).toBe('skip');
    expect(d.reason).toBe('liquidity_dead');
  });

  test('liquidity_dead — 1h 축 1봉 무거래는 구 30m 축 2봉과 등가(실시간 1시간)라 여전히 잡힌다', () => {
    // 임계를 2로 두면 2시간 무거래를 요구해 오히려 둔감해진다. 1봉에서 잡히는지 고정.
    const d = prefilterCandidate(cand(), summary({ volumeRatio: 0.05 }), candles(30, { trailingZeroVolumes: 1 }), 'aggressive');
    expect(d.reason).toBe('liquidity_dead');
  });

  test('liquidity_dead — 거래량비가 정상이면 무거래 봉만으로는 차단하지 않는다', () => {
    const d = prefilterCandidate(cand(), summary({ volumeRatio: 1.0 }), candles(30, { trailingZeroVolumes: 1 }), 'neutral');
    expect(d.verdict).toBe('pass');
  });

  test('atr_zero — 변동성 0 종목은 진입 금지', () => {
    for (const atr14 of [0, null]) {
      const d = prefilterCandidate(cand(), summary({ atr14 }), candles(30), 'neutral');
      expect(d.verdict).toBe('skip');
      expect(d.reason).toBe('atr_zero');
    }
  });

  test('rsi_extreme_counter — RSI 85 이상 매수 / 15 이하 매도 차단', () => {
    expect(prefilterCandidate(cand('buy'), summary({ rsi14: 85 }), candles(30), 'neutral').reason)
      .toBe('rsi_extreme_counter');
    expect(prefilterCandidate(cand('sell'), summary({ rsi14: 15 }), candles(30), 'neutral').reason)
      .toBe('rsi_extreme_counter');
    // 경계 밖은 통과
    expect(prefilterCandidate(cand('buy'), summary({ rsi14: 84 }), candles(30), 'neutral').verdict).toBe('pass');
  });
});

describe('strong_counter_trend 삭제 (D1)', () => {
  test('EMA20 이 EMA60 대비 5% 이상 아래여도 매수를 차단하지 않는다', () => {
    // 구 코드는 여기서 strong_counter_trend 로 죽였다 — 과매도 반등 룰의 존재 이유와 충돌.
    const d = prefilterCandidate(
      cand('buy'),
      summary({ ema20: 90, ema60: 100, rsi14: 32 }),
      candles(30),
      'neutral',
    );
    expect(d.verdict).toBe('pass');
    expect(d.reason).toBeUndefined();
  });

  test('극단적 하락추세에서도 통과 — 차단은 regime_gate·losing_position_block·사람 승인이 맡는다', () => {
    const d = prefilterCandidate(cand('buy'), summary({ ema20: 50, ema60: 100, rsi14: 25 }), candles(30), 'aggressive');
    expect(d.verdict).toBe('pass');
  });
});

describe('blowoff_top 임계 교정', () => {
  // ⚠️ 실효 창은 RSI ∈ (80, 85) 다 — 85 이상은 rsi_extreme_counter 가 먼저 잡는다(더 이른 게이트).
  test('5봉 +12% && RSI 83 → 차단 (구 조건 >30% 였다면 통과했을 케이스)', () => {
    const d = prefilterCandidate(cand('buy'), summary({ priceChange5: 12, rsi14: 83 }), candles(30), 'neutral');
    expect(d.verdict).toBe('skip');
    expect(d.reason).toBe('blowoff_top');
  });

  test('구 임계(>30%)는 국내 상한가 30% 때문에 도달 불능이었다 — 교정 전이면 통과했을 값', () => {
    // priceChange5 12% 는 구 조건(>30%)에서는 절대 걸리지 않던 구간이다.
    const d = prefilterCandidate(cand('buy'), summary({ priceChange5: 12, rsi14: 81 }), candles(30), 'neutral');
    expect(d.reason).toBe('blowoff_top');
  });

  test('RSI 가 80 이하면 급등만으로는 차단하지 않는다', () => {
    const d = prefilterCandidate(cand('buy'), summary({ priceChange5: 15, rsi14: 78 }), candles(30), 'neutral');
    expect(d.verdict).toBe('pass');
  });

  test('상승폭이 10% 이하면 과열만으로는 차단하지 않는다', () => {
    // RSI 85 는 rsi_extreme_counter 에 먼저 걸리므로 82 로 확인
    const d = prefilterCandidate(cand('buy'), summary({ priceChange5: 8, rsi14: 82 }), candles(30), 'neutral');
    expect(d.verdict).toBe('pass');
  });

  test('매도 후보에는 적용되지 않는다', () => {
    const d = prefilterCandidate(cand('sell'), summary({ priceChange5: 20, rsi14: 84 }), candles(30), 'neutral');
    expect(d.verdict).toBe('pass');
  });
});
