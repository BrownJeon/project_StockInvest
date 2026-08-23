/**
 * ResearchTab 용 추천 조립 — T-033, 목표가 차트 기반 재설계 T-034.
 *
 * 검증 포인트:
 *  - 미보유 종목은 매도 판단(sell)을 만들지 않고, 시세도 조회하지 않는다
 *  - `position_state` 는 SELECT 만 한다
 *  - 시세·포지션 조회가 실패해도 매수 추천은 그대로 나온다
 *  - 🔴 목표가는 저장된 차트 값 그대로이며 **진입가·현재가에 반응하지 않는다**
 */
type QueryImpl = (sql: string, params?: unknown[]) => Promise<unknown>;

let queryImpl: QueryImpl;
const queryCalls: { sql: string; params?: unknown[] }[] = [];

jest.mock('@/lib/db', () => ({
  getPool: () => ({
    query: (sql: string, params?: unknown[]) => {
      queryCalls.push({ sql, params });
      return queryImpl(sql, params);
    },
  }),
}));

import { buildResearchRecommendations, type RecommendationInput } from '../recommendation-view';
import { TARGET_HORIZON_DAYS } from '../pattern/price-targets';
import type { SymbolQuote } from '@/lib/display-amount';
import type { PrecursorAnalysis, PriceTargets } from '../types';

/** T-035 — 시세 조회는 KRW·USD 쌍을 돌려준다. 국내 종목은 USD 가 없다. */
const quotes = (m: Record<string, SymbolQuote>) => async () => new Map(Object.entries(m));
const krwOnly = (m: Record<string, number>) =>
  quotes(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { krw: v, usd: null }])));

const rows = (r: unknown[]): Promise<unknown> => Promise.resolve([r, []]);

const analysis = {
  evaluatedDays: 500, positiveDays: 40, baseRate: 0.08, labelToleranceDays: 3,
  lowSampleWarning: false, note: 'note',
  rules: [{ id: 'rsi_lt_30', label: 'RSI14 < 30 (과매도)', triggerCount: 40, hitCount: 25, precision: 0.625, lift: 2.1 }],
} as PrecursorAnalysis;

function targets(over: Partial<PriceTargets> = {}): PriceTargets {
  return {
    asOfDate: '2026-08-19', asOfPrice: 70_000, currency: 'KRW',
    atr14: 1_500, expectedMove: 1_500 * Math.sqrt(10),
    buyZone: { price: 67_000, basis: '볼린저 하단(20,2)' },
    sellTarget: { price: 73_000, basis: '최근 60거래일 고점' },
    buyReachable: true, sellReachable: true,
    horizonDays: TARGET_HORIZON_DAYS, horizonTradingDays: 10,
    ...over,
  };
}

function input(symbol: string, over: Partial<RecommendationInput> = {}): RecommendationInput {
  return {
    symbol, market: 'domestic', dataRangeTo: '2026-08-19',
    todayActiveRuleIds: ['rsi_lt_30'], precursorAnalysis: analysis,
    priceTargets: targets(),
    ...over,
  };
}

const NOW = new Date('2026-08-20T00:00:00Z');
const HELD = { symbol: '005930', market: 'domestic', entry_price: 70_000, qty: 10, first_seen_at: '2026-08-08T00:00:00Z' };
let warnSpy: jest.SpyInstance;

beforeEach(() => {
  queryCalls.length = 0;
  queryImpl = () => rows([]);
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { warnSpy.mockRestore(); jest.clearAllMocks(); });

describe('buildResearchRecommendations', () => {
  test('미보유 + 매수고려 종목 — 차트 목표가를 그대로 싣고 시세는 조회하지 않는다', async () => {
    const fetchPrices = jest.fn(async () => new Map<string, SymbolQuote>());
    const out = await buildResearchRecommendations([input('005930')], fetchPrices, NOW);

    const v = out.get('005930')!;
    expect(v.buy.action).toBe('buy');
    expect(v.asOfDate).toBe('2026-08-19');
    expect(v.sell).toBeNull();
    expect(v.holding).toBeNull();
    expect(v.targets?.buyZone?.price).toBe(67_000);
    expect(v.targets?.currency).toBe('KRW');
    // T-034 — 목표가가 캔들에서 나오므로 미보유 종목에는 현재가가 필요 없다(KIS 호출 감소)
    expect(fetchPrices).not.toHaveBeenCalled();
  });

  test('기한 내 닿을 지지선이 없으면 buy 가 아니라 hold 로 내려간다', async () => {
    const out = await buildResearchRecommendations(
      [input('005930', { priceTargets: targets({ buyZone: null, buyReachable: null }) })],
      async () => new Map<string, SymbolQuote>(), NOW,
    );
    const v = out.get('005930')!;
    expect(v.buy.action).toBe('hold');
    expect(v.buy.downgradeReason).toBe('no_support_level');
  });

  test('관망(hold) 종목은 매수 근거만 나오고 시세를 조회하지 않는다', async () => {
    const fetchPrices = jest.fn(async () => new Map<string, SymbolQuote>());
    const out = await buildResearchRecommendations(
      [input('005930', { todayActiveRuleIds: [] })],   // 오늘 충족 규칙 0개 → hold
      fetchPrices, NOW,
    );

    const v = out.get('005930')!;
    expect(v.buy.action).toBe('hold');
    expect(fetchPrices).not.toHaveBeenCalled();
  });

  test('🔴 position_state 는 SELECT 만 한다 (INSERT/UPDATE/DELETE 없음)', async () => {
    queryImpl = () => rows([HELD]);
    await buildResearchRecommendations([input('005930')], krwOnly({ '005930': 82_000 }), NOW);

    const posQueries = queryCalls.filter(c => /position_state/.test(c.sql));
    expect(posQueries).toHaveLength(1);
    for (const c of queryCalls) {
      expect(c.sql).not.toMatch(/INSERT|UPDATE|DELETE/i);
    }
  });

  test('보유 종목 — 보유일수·현재가는 표시로 채우고 판정은 차트에서 낸다', async () => {
    queryImpl = () => rows([HELD]);
    const out = await buildResearchRecommendations(
      [input('005930')],
      krwOnly({ '005930': 82_000 }),
      NOW,
    );
    const v = out.get('005930')!;
    expect(v.holding?.daysSinceEntry).toBe(12);
    expect(v.holding?.nowPriceKRW).toBe(82_000);
    expect(v.holding?.entryPriceKRW).toBe(70_000);
    // 12일째 < 기한 14일, 저항 후보도 있으므로 아직 진행중
    expect(v.sell?.action).toBe('hold');
    expect(v.sell?.reason).toBe('in_progress');
    expect(v.sell?.horizonDays).toBe(TARGET_HORIZON_DAYS);
    expect(v.sell?.gainPct).toBeCloseTo(17.14, 2);   // 표시 전용
  });

  test('🔴 보유기간이 아무리 길어도 매도 판정이 바뀌지 않는다 (기간초과 판정 폐기)', async () => {
    // first_seen_at 을 3년 전으로 — 예전 설계였다면 "기간 초과"로 매도 고려가 떴다.
    queryImpl = () => rows([{ ...HELD, first_seen_at: '2023-08-08T00:00:00Z' }]);
    const out = await buildResearchRecommendations(
      [input('005930')], krwOnly({ '005930': 82_000 }), NOW,
    );
    const v = out.get('005930')!;
    expect(v.sell?.action).toBe('hold');
    expect(v.sell?.reason).toBe('in_progress');
    expect(v.sell?.daysSinceEntry).toBeGreaterThan(1000);   // 표시용으로는 살아 있다
  });

  test('🔴 진입가가 달라져도 매도 목표가·판정은 그대로다 (T-034 핵심 회귀)', async () => {
    const run = async (entryPrice: number) => {
      queryImpl = () => rows([{ ...HELD, entry_price: entryPrice }]);
      const out = await buildResearchRecommendations(
        [input('005930')], krwOnly({ '005930': 57_000 }), NOW,
      );
      return out.get('005930')!;
    };
    const cheap = await run(30_000);       // 크게 이익
    const stuck = await run(675_724);      // 크게 물림(NAS:SNPS 사례)

    expect(stuck.targets?.sellTarget?.price).toBe(cheap.targets?.sellTarget?.price);
    expect(stuck.targets?.sellTarget?.price).toBe(73_000);
    expect(stuck.sell?.action).toBe(cheap.sell?.action);
    expect(stuck.sell?.reason).toBe(cheap.sell?.reason);
    // 손익률만 달라진다(사용자 참고용)
    expect(stuck.sell?.gainPct).not.toBeCloseTo(cheap.sell!.gainPct!, 2);
  });

  test('시세 조회 실패 — 손익만 비고 판정·목표가는 살아 있다', async () => {
    queryImpl = () => rows([HELD]);
    const out = await buildResearchRecommendations(
      [input('005930')],
      async () => { throw new Error('KIS down'); },
      NOW,
    );
    const v = out.get('005930')!;
    expect(v.buy.action).toBe('buy');
    expect(v.sell?.action).toBe('hold');
    expect(v.sell?.gainPct).toBeNull();
    expect(v.holding?.nowPriceKRW).toBeNull();
    expect(v.targets?.sellTarget?.price).toBe(73_000);
  });

  test('저장된 목표가가 없으면(구버전 행) 매도는 판단 보류가 된다', async () => {
    queryImpl = () => rows([HELD]);
    const out = await buildResearchRecommendations(
      [input('005930', { priceTargets: null })],
      krwOnly({ '005930': 82_000 }), NOW,
    );
    const v = out.get('005930')!;
    expect(v.targets).toBeNull();
    expect(v.sell?.action).toBe('insufficient_data');
  });

  test('position_state 조회가 던져도 추천 전체가 사라지지 않는다', async () => {
    queryImpl = () => Promise.reject(new Error('db down'));
    const out = await buildResearchRecommendations([input('005930')], async () => new Map(), NOW);
    expect(out.get('005930')!.buy.action).toBe('buy');
    expect(out.get('005930')!.sell).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  test('시세 조회는 보유 종목으로만 좁힌다(미보유는 목표가에 현재가가 필요 없다)', async () => {
    queryImpl = () => rows([{ ...HELD, first_seen_at: null }]);
    const fetchPrices = jest.fn(async () => new Map<string, SymbolQuote>());
    await buildResearchRecommendations(
      [
        input('005930'),                                   // 보유중 → 포함
        input('NAS:MU', { market: 'overseas' }),            // 미보유 + 매수고려 → 제외
        input('000660', { todayActiveRuleIds: [] }),         // 미보유 + 관망 → 제외
      ],
      fetchPrices, NOW,
    );
    const [priceTargets] = fetchPrices.mock.calls[0] as [{ symbol: string; market: string }[]];
    expect(priceTargets.map(t => t.symbol)).toEqual(['005930']);
  });

  // ── T-035 — 해외 종목 금액의 달러 표기 ──────────────────────────────────
  //
  // 진입가 USD 는 DB 에 없다. 같은 시세 응답의 KRW/USD 쌍에서 환율을 얻어 역산한다.
  // 🔴 이건 **현재 환율 환산본**이지 매수 당시 체결가가 아니다(화면이 그 사실을 고지한다).
  const HELD_OVERSEAS = {
    symbol: 'NAS:SNPS', market: 'overseas', entry_price: 669_858, qty: 16,
    first_seen_at: '2026-08-08T00:00:00Z',
  };
  /** NAS:SNPS 실사례 근사 — KRW 553,109 / USD 397.92 (환율 ≈ 1,390) */
  const SNPS_QUOTE = { krw: 553_109, usd: 397.92 };

  test('🔴 해외 보유 종목 — 진입가·현재가가 달러로 나온다 (환율은 시세 쌍에서 역산)', async () => {
    queryImpl = () => rows([HELD_OVERSEAS]);
    const out = await buildResearchRecommendations(
      [input('NAS:SNPS', { market: 'overseas' })],
      quotes({ 'NAS:SNPS': SNPS_QUOTE }), NOW,
    );
    const d = out.get('NAS:SNPS')!.holding!.display;
    expect(d.entryPrice.currency).toBe('USD');
    expect(d.entryPrice.basis).toBe('usd_converted');
    expect(d.entryPrice.value!).toBeCloseTo(669_858 * (397.92 / 553_109), 6);
    // 현재가는 시세의 USD 원가 그 자체와 같은 값이 된다
    expect(d.nowPrice.currency).toBe('USD');
    expect(d.nowPrice.value!).toBeCloseTo(397.92, 6);
    // 원본 KRW 는 그대로 남는다 — 손익·판정은 여전히 이 값으로 계산된다
    expect(out.get('NAS:SNPS')!.holding!.entryPriceKRW).toBe(669_858);
    expect(out.get('NAS:SNPS')!.holding!.nowPriceKRW).toBe(553_109);
  });

  test('국내 보유 종목은 계속 원화다 — 환산 경로에 들어가지 않는다', async () => {
    queryImpl = () => rows([HELD]);
    const out = await buildResearchRecommendations(
      [input('005930')], krwOnly({ '005930': 82_000 }), NOW,
    );
    const d = out.get('005930')!.holding!.display;
    expect(d.entryPrice).toEqual({ value: 70_000, currency: 'KRW', basis: 'krw_native', sourceKRW: 70_000 });
    expect(d.nowPrice.currency).toBe('KRW');
    expect(d.nowPrice.value).toBe(82_000);
  });

  test('🔴 해외인데 USD 원가가 없으면 원화로 폴백하고 그 사실이 드러난다', async () => {
    queryImpl = () => rows([HELD_OVERSEAS]);
    const out = await buildResearchRecommendations(
      [input('NAS:SNPS', { market: 'overseas' })],
      quotes({ 'NAS:SNPS': { krw: 553_109, usd: null } }), NOW,
    );
    const d = out.get('NAS:SNPS')!.holding!.display;
    expect(d.entryPrice.currency).toBe('KRW');
    expect(d.entryPrice.basis).toBe('krw_fallback');
    expect(d.entryPrice.value).toBe(669_858);   // 숫자를 지어내지 않는다
  });

  test('시세 조회가 통째로 실패해도 진입가는 원화로 표시된다', async () => {
    queryImpl = () => rows([HELD_OVERSEAS]);
    const out = await buildResearchRecommendations(
      [input('NAS:SNPS', { market: 'overseas' })],
      async () => { throw new Error('KIS down'); }, NOW,
    );
    const d = out.get('NAS:SNPS')!.holding!.display;
    expect(d.entryPrice.basis).toBe('krw_fallback');
    expect(d.entryPrice.value).toBe(669_858);
    expect(d.nowPrice.value).toBeNull();        // 현재가는 정말 없다
  });

  test('🔴 환율이 달라져도 판정·손익률은 한 톨도 변하지 않는다 (통화 혼용 회귀)', async () => {
    const run = async (usd: number) => {
      queryImpl = () => rows([HELD_OVERSEAS]);
      const out = await buildResearchRecommendations(
        [input('NAS:SNPS', { market: 'overseas' })],
        quotes({ 'NAS:SNPS': { krw: 553_109, usd } }), NOW,
      );
      return out.get('NAS:SNPS')!;
    };
    const a = await run(397.92);
    const b = await run(397.92 * 2);   // 환율만 절반이 된 세계

    expect(b.sell!.action).toBe(a.sell!.action);
    expect(b.sell!.reason).toBe(a.sell!.reason);
    expect(b.sell!.gainPct).toBe(a.sell!.gainPct);
    expect(b.targets!.sellTarget!.price).toBe(a.targets!.sellTarget!.price);
    expect(b.holding!.entryPriceKRW).toBe(a.holding!.entryPriceKRW);
    // 달라지는 건 오직 달러 **표시값**이고, 정확히 2배다(상수 KRW 항이 끼면 실패)
    expect(b.holding!.display.entryPrice.value!).toBeCloseTo(a.holding!.display.entryPrice.value! * 2, 6);
  });

  test('입력이 비면 쿼리조차 쏘지 않는다', async () => {
    const out = await buildResearchRecommendations([], async () => new Map(), NOW);
    expect(out.size).toBe(0);
    expect(queryCalls).toHaveLength(0);
  });
});
