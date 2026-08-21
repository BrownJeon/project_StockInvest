/**
 * ResearchTab 용 추천 조립 — T-033.
 *
 * 검증 포인트:
 *  - 미보유 종목은 매도 판단(sell)을 만들지 않고, 시세도 조회하지 않는다
 *  - `position_state` 는 SELECT 만 한다
 *  - 시세·포지션 조회가 실패해도 매수 추천은 그대로 나온다
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
import type { PrecursorAnalysis } from '../types';

const rows = (r: unknown[]): Promise<unknown> => Promise.resolve([r, []]);

const analysis = {
  evaluatedDays: 500, positiveDays: 40, baseRate: 0.08, labelToleranceDays: 3,
  lowSampleWarning: false, note: 'note',
  rules: [{ id: 'rsi_lt_30', label: 'RSI14 < 30 (과매도)', triggerCount: 40, hitCount: 25, precision: 0.625, lift: 2.1 }],
} as PrecursorAnalysis;

function input(symbol: string, over: Partial<RecommendationInput> = {}): RecommendationInput {
  return {
    symbol, market: 'domestic', dataRangeTo: '2026-08-19',
    todayActiveRuleIds: ['rsi_lt_30'], precursorAnalysis: analysis,
    avgRallyPct: 20, avgDaysToRally: 10, eventCount: 12,
    ...over,
  };
}

const NOW = new Date('2026-08-20T00:00:00Z');
let warnSpy: jest.SpyInstance;

beforeEach(() => {
  queryCalls.length = 0;
  queryImpl = () => rows([]);
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { warnSpy.mockRestore(); jest.clearAllMocks(); });

describe('buildResearchRecommendations', () => {
  test('미보유 종목 — 매수 추천만 나오고 시세 조회를 하지 않는다', async () => {
    const fetchPrices = jest.fn(async () => new Map<string, number>());
    const out = await buildResearchRecommendations([input('005930')], fetchPrices, NOW);

    const v = out.get('005930')!;
    expect(v.buy.action).toBe('buy');
    expect(v.asOfDate).toBe('2026-08-19');
    expect(v.sell).toBeNull();
    expect(v.holding).toBeNull();
    expect(fetchPrices).not.toHaveBeenCalled();
  });

  test('🔴 position_state 는 SELECT 만 한다 (INSERT/UPDATE/DELETE 없음)', async () => {
    queryImpl = () => rows([
      { symbol: '005930', market: 'domestic', entry_price: 70_000, qty: 10, first_seen_at: '2026-08-08T00:00:00Z' },
    ]);
    await buildResearchRecommendations([input('005930')], async () => new Map([['005930', 82_000]]), NOW);

    const posQueries = queryCalls.filter(c => /position_state/.test(c.sql));
    expect(posQueries).toHaveLength(1);
    for (const c of queryCalls) {
      expect(c.sql).not.toMatch(/INSERT|UPDATE|DELETE/i);
    }
  });

  test('보유 종목 — 진입가·보유일수·현재가로 매도 판단을 만든다', async () => {
    queryImpl = () => rows([
      { symbol: '005930', market: 'domestic', entry_price: 70_000, qty: 10, first_seen_at: '2026-08-08T00:00:00Z' },
    ]);
    const out = await buildResearchRecommendations(
      [input('005930')],
      async () => new Map([['005930', 82_000]]),   // +17.1% → 목표(20%×0.8=16%) 도달
      NOW,
    );
    const v = out.get('005930')!;
    expect(v.holding?.daysSinceEntry).toBe(12);
    expect(v.holding?.nowPriceKRW).toBe(82_000);
    expect(v.sell?.action).toBe('sell');
    expect(v.sell?.reason).toBe('target_reached');
    expect(v.holding?.targetProgressPct).toBeCloseTo(85.7, 1);
  });

  test('시세 조회 실패 — 매도는 판단 보류로 떨어지고 매수 추천은 살아 있다', async () => {
    queryImpl = () => rows([
      { symbol: '005930', market: 'domestic', entry_price: 70_000, qty: 10, first_seen_at: '2026-08-08T00:00:00Z' },
    ]);
    const out = await buildResearchRecommendations(
      [input('005930')],
      async () => { throw new Error('KIS down'); },
      NOW,
    );
    const v = out.get('005930')!;
    expect(v.buy.action).toBe('buy');
    expect(v.sell?.action).toBe('insufficient_data');
    expect(v.holding?.nowPriceKRW).toBeNull();
  });

  test('position_state 조회가 던져도 추천 전체가 사라지지 않는다', async () => {
    queryImpl = () => Promise.reject(new Error('db down'));
    const out = await buildResearchRecommendations([input('005930')], async () => new Map(), NOW);
    expect(out.get('005930')!.buy.action).toBe('buy');
    expect(out.get('005930')!.sell).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  test('시세 조회는 보유중인 추적 종목으로만 좁힌다', async () => {
    queryImpl = () => rows([
      { symbol: '005930', market: 'domestic', entry_price: 70_000, qty: 10, first_seen_at: null },
    ]);
    const fetchPrices = jest.fn(async () => new Map<string, number>());
    await buildResearchRecommendations([input('005930'), input('NAS:MU', { market: 'overseas' })], fetchPrices, NOW);
    expect(fetchPrices).toHaveBeenCalledWith([{ symbol: '005930', market: 'domestic' }]);
  });

  test('입력이 비면 쿼리조차 쏘지 않는다', async () => {
    const out = await buildResearchRecommendations([], async () => new Map(), NOW);
    expect(out.size).toBe(0);
    expect(queryCalls).toHaveLength(0);
  });
});
