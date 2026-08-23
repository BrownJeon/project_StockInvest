/**
 * T-033 — 리포트가 새로 읽는 데이터 3종의 계약 검증 (DB·KIS 모킹).
 *
 *  1. `fetchSymbolBaselinePrices` — 종목별 baseline 단가가 **total_krw 와 같은 행**에서 나온다
 *  2. `fetchCurrentPricesKRW`     — 중복 제거 + 시장별 분리 호출, 한쪽 실패가 다른 쪽을 죽이지 않음
 *  3. `fetchResearchDigest`       — 표본부족은 "매수 고려"로 승격되지 않는다
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

const domesticTickers = jest.fn();
const overseasTickers = jest.fn();
jest.mock('@/lib/exchanges/kis', () => ({
  getKisTickers: (...a: unknown[]) => domesticTickers(...a),
  getKisOverseasTickers: (...a: unknown[]) => overseasTickers(...a),
}));

const latestResults = jest.fn();
jest.mock('@/lib/research/storage', () => ({
  getLatestResearchResults: () => latestResults(),
}));

import { PRECURSOR_NOTE } from '@/lib/research/pattern/precursor-analysis';
import {
  fetchCurrentPricesKRW,
  fetchPortfolioBaselineKRW,
  fetchResearchDigest,
  fetchSymbolBaselinePrices,
} from '../trade-report';
import type { PrecursorRuleStat, PriceTargets } from '@/lib/research/types';

const rows = (r: unknown[]): Promise<unknown> => Promise.resolve([r, []]);

let warnSpy: jest.SpyInstance;
beforeEach(() => {
  queryCalls.length = 0;
  queryImpl = () => rows([]);
  domesticTickers.mockReset();
  overseasTickers.mockReset();
  latestResults.mockReset();
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore();
  jest.clearAllMocks();
});

const RANGE_START = new Date('2026-08-20T00:00:00Z');

/** 스냅샷 후보 행 + 24h median 행을 한 번에 세팅 */
function mockSnapshots(candidates: { total_krw: number; positions: unknown }[], medians: number[]) {
  queryImpl = (sql: string) => {
    if (/DATE_SUB/.test(sql)) return rows(medians.map(v => ({ total_krw: v })));
    if (/portfolio_snapshots/.test(sql)) return rows(candidates);
    return rows([]);
  };
}

describe('fetchSymbolBaselinePrices — outlier 가드는 total_krw 와 같은 행 기준', () => {
  const OUTLIER = {
    total_krw: 50_000_000,                                     // median 1,000,000 대비 50배 → 제외
    positions: JSON.stringify([{ currency: '000660', qty: 10, price: 999_999, value_krw: 9_999_990 }]),
  };
  const GOOD = {
    total_krw: 1_000_000,
    positions: JSON.stringify([
      { currency: 'KRW',    qty: 500_000, price: 1,       value_krw: 500_000 },
      { currency: '000660', qty: 10,      price: 200_000, value_krw: 2_000_000 },
    ]),
  };

  test('제외된 행의 단가는 쓰지 않고, 채택된 행의 단가를 돌려준다', async () => {
    mockSnapshots([OUTLIER, GOOD], [1_000_000]);
    const prices = await fetchSymbolBaselinePrices(RANGE_START, ['000660']);
    expect(prices.get('000660')).toBe(200_000);
  });

  test('같은 조건에서 fetchPortfolioBaselineKRW 도 같은 행을 고른다(총액-단가 시점 일치)', async () => {
    mockSnapshots([OUTLIER, GOOD], [1_000_000]);
    expect(await fetchPortfolioBaselineKRW(RANGE_START)).toBe(1_000_000);
  });

  test('그 시점에 보유하지 않았던 심볼은 Map 에 없다(0으로 채우지 않는다)', async () => {
    mockSnapshots([GOOD], [1_000_000]);
    const prices = await fetchSymbolBaselinePrices(RANGE_START, ['000660', '005930']);
    expect(prices.has('005930')).toBe(false);
    expect(prices.size).toBe(1);
  });

  test('단가 0/음수(시세 실패 sentinel)는 버린다', async () => {
    mockSnapshots(
      [{ total_krw: 1_000_000, positions: JSON.stringify([{ currency: '005930', qty: 1, price: 0, value_krw: 0 }]) }],
      [1_000_000],
    );
    expect((await fetchSymbolBaselinePrices(RANGE_START, ['005930'])).size).toBe(0);
  });

  test('positions 가 배열/객체로 와도(드라이버 차이) 파싱한다', async () => {
    mockSnapshots(
      [{ total_krw: 1_000_000, positions: [{ currency: '005930', qty: 1, price: 70_000, value_krw: 70_000 }] }],
      [1_000_000],
    );
    expect((await fetchSymbolBaselinePrices(RANGE_START, ['005930'])).get('005930')).toBe(70_000);
  });

  test('깨진 JSON·스냅샷 없음은 빈 Map (던지지 않는다)', async () => {
    mockSnapshots([{ total_krw: 1_000_000, positions: '{{broken' }], [1_000_000]);
    expect((await fetchSymbolBaselinePrices(RANGE_START, ['005930'])).size).toBe(0);

    queryImpl = () => rows([]);
    expect((await fetchSymbolBaselinePrices(RANGE_START, ['005930'])).size).toBe(0);
  });

  test('심볼 목록이 비면 쿼리조차 쏘지 않는다', async () => {
    mockSnapshots([{ total_krw: 1, positions: '[]' }], [1]);
    expect((await fetchSymbolBaselinePrices(RANGE_START, [])).size).toBe(0);
    expect(queryCalls).toHaveLength(0);
  });
});

describe('fetchCurrentPricesKRW', () => {
  test('🔴 심볼 중복을 제거하고 시장별로 나눠 호출한다 (KIS 함수는 중복제거를 안 한다)', async () => {
    domesticTickers.mockResolvedValue([{ symbol: '005930', price: 70_000 }]);
    overseasTickers.mockResolvedValue([{ symbol: 'NAS:MU', price: 150_000 }]);

    const prices = await fetchCurrentPricesKRW([
      { symbol: '005930', market: 'domestic' },
      { symbol: '005930', market: 'domestic' },
      { symbol: 'NAS:MU', market: 'overseas' },
    ]);

    expect(domesticTickers).toHaveBeenCalledWith(['005930']);
    expect(overseasTickers).toHaveBeenCalledWith(['NAS:MU']);
    expect(prices.get('005930')).toBe(70_000);
    expect(prices.get('NAS:MU')).toBe(150_000);
  });

  test('market 값이 손상되면 심볼 포맷으로 판별한다', async () => {
    domesticTickers.mockResolvedValue([]);
    overseasTickers.mockResolvedValue([]);
    await fetchCurrentPricesKRW([
      { symbol: '005930', market: '' },
      { symbol: 'NAS:MU', market: 'nonsense' },
    ]);
    expect(domesticTickers).toHaveBeenCalledWith(['005930']);
    expect(overseasTickers).toHaveBeenCalledWith(['NAS:MU']);
  });

  test('한쪽 시장 조회가 실패해도 다른 쪽 결과는 살아남는다', async () => {
    domesticTickers.mockResolvedValue([{ symbol: '005930', price: 70_000 }]);
    overseasTickers.mockRejectedValue(new Error('KIS overseas down'));

    const prices = await fetchCurrentPricesKRW([
      { symbol: '005930', market: 'domestic' },
      { symbol: 'NAS:MU', market: 'overseas' },
    ]);
    expect(prices.get('005930')).toBe(70_000);
    expect(prices.has('NAS:MU')).toBe(false);
  });

  test('가격 0/NaN 은 Map 에 넣지 않는다 — 0 은 -100% 로 표시된다', async () => {
    domesticTickers.mockResolvedValue([
      { symbol: '005930', price: 0 },
      { symbol: '000660', price: Number.NaN },
    ]);
    const prices = await fetchCurrentPricesKRW([
      { symbol: '005930', market: 'domestic' },
      { symbol: '000660', market: 'domestic' },
    ]);
    expect(prices.size).toBe(0);
  });

  test('대상이 없으면 KIS 를 부르지 않는다', async () => {
    expect((await fetchCurrentPricesKRW([])).size).toBe(0);
    expect(domesticTickers).not.toHaveBeenCalled();
    expect(overseasTickers).not.toHaveBeenCalled();
  });
});

describe('fetchResearchDigest', () => {
  function statRule(over: Partial<PrecursorRuleStat> = {}): PrecursorRuleStat {
    return {
      id: 'rsi_lt_30', label: 'RSI14 < 30 (과매도)',
      triggerCount: 40, hitCount: 25, precision: 0.625, lift: 2.1,
      ...over,
    };
  }
  function targets(over: Partial<PriceTargets> = {}): PriceTargets {
    return {
      asOfDate: '2026-08-19', asOfPrice: 70_000, currency: 'KRW',
      atr14: 1_500, expectedMove: 1_500 * Math.sqrt(10),
      buyZone: { price: 67_000, basis: '볼린저 하단(20,2)' },
      sellTarget: { price: 73_000, basis: '최근 60거래일 고점' },
      buyReachable: true, sellReachable: true,
      horizonDays: 14, horizonTradingDays: 10,
      ...over,
    };
  }
  function result(symbol: string, over: Record<string, unknown> = {}) {
    return {
      symbol, market: 'domestic', runDate: '2026-08-20',
      dataRangeFrom: '2020-01-01', dataRangeTo: '2026-08-19',
      eventCount: 12, events: [], avgRallyPct: 18, avgDaysToRally: 3,
      precursorAnalysis: { rules: [statRule()] },
      todayActiveRuleIds: ['rsi_lt_30'],
      // T-034 — 기한 내 도달 가능한 매수 희망가가 있어야 buy 가 유지된다
      priceTargets: targets(),
      dataWarnings: [], error: null, createdAt: null,
      ...over,
    };
  }

  test('매수 고려 종목을 세고 근거를 함께 싣는다', async () => {
    latestResults.mockResolvedValue({
      tracked: [{ symbol: '005930', name: '삼성전자', market: 'domestic' }],
      results: [result('005930')],
    });
    const d = await fetchResearchDigest();
    expect(d.trackedCount).toBe(1);
    expect(d.activeCount).toBe(1);
    expect(d.items).toHaveLength(1);
    expect(d.items[0].buy.action).toBe('buy');
    expect(d.items[0].asOfDate).toBe('2026-08-19');
    expect(d.note).toBe(PRECURSOR_NOTE);
    // T-034 — 저장된 차트 목표가를 그대로 싣는다(리포트에서 재계산하지 않는다)
    expect(d.items[0].targets?.buyZone?.price).toBe(67_000);
  });

  test('🔴 T-034 — 기한 내 닿을 지지선이 없으면 "매수 고려"로 올리지 않는다', async () => {
    latestResults.mockResolvedValue({
      tracked: [{ symbol: '005930', name: null, market: 'domestic' }],
      results: [result('005930', {
        priceTargets: targets({ buyZone: { price: 40_000, basis: '볼린저 하단(20,2)' }, buyReachable: false }),
      })],
    });
    const d = await fetchResearchDigest();
    expect(d.activeCount).toBe(0);
    expect(d.items).toHaveLength(0);       // hold 는 리포트에 싣지 않는다
  });

  test('T-034 — 저장된 목표가가 없는 구버전 행은 게이트 없이 기존 판정을 유지한다', async () => {
    latestResults.mockResolvedValue({
      tracked: [{ symbol: '005930', name: null, market: 'domestic' }],
      results: [result('005930', { priceTargets: null })],
    });
    const d = await fetchResearchDigest();
    expect(d.items[0].buy.action).toBe('buy');
    expect(d.items[0].targets).toBeNull();
  });

  test('🔴 표본부족은 매수 고려로 승격되지 않고, 항목으로만 남는다', async () => {
    latestResults.mockResolvedValue({
      tracked: [{ symbol: '005930', name: null, market: 'domestic' }],
      results: [result('005930', {
        precursorAnalysis: { rules: [statRule({ triggerCount: 4, hitCount: 3, precision: 0.75, lift: 5 })] },
      })],
    });
    const d = await fetchResearchDigest();
    expect(d.activeCount).toBe(0);
    expect(d.items[0].buy.action).toBe('insufficient_data');
    expect(d.items[0].buy.triggerCount).toBe(4);
  });

  test('관망(hold)은 리포트에 싣지 않는다 — 매일 전 종목이 걸려 신호가 묻힌다', async () => {
    latestResults.mockResolvedValue({
      tracked: [{ symbol: '005930', name: null, market: 'domestic' }],
      results: [result('005930', { todayActiveRuleIds: [] })],
    });
    const d = await fetchResearchDigest();
    expect(d.activeCount).toBe(0);
    expect(d.items).toHaveLength(0);
    expect(d.trackedCount).toBe(1);   // 추적 수는 그대로 보고한다
  });

  test('분석 실패(error) 행은 추천 대상에서 제외한다', async () => {
    latestResults.mockResolvedValue({
      tracked: [{ symbol: '005930', name: null, market: 'domestic' }],
      results: [result('005930', { error: 'yahoo down' })],
    });
    const d = await fetchResearchDigest();
    expect(d.items).toHaveLength(0);
  });

  test('매수 고려가 먼저, 그 안에서는 lift 내림차순', async () => {
    latestResults.mockResolvedValue({
      tracked: [
        { symbol: 'A', name: null, market: 'domestic' },
        { symbol: 'B', name: null, market: 'domestic' },
        { symbol: 'C', name: null, market: 'domestic' },
      ],
      results: [
        result('A', { precursorAnalysis: { rules: [statRule({ lift: 2.0 })] } }),
        result('B', { precursorAnalysis: { rules: [statRule({ triggerCount: 3, lift: 9 })] } }),
        result('C', { precursorAnalysis: { rules: [statRule({ lift: 3.5 })] } }),
      ],
    });
    const d = await fetchResearchDigest();
    expect(d.items.map(i => i.symbol)).toEqual(['C', 'A', 'B']);
  });

  test('조회가 실패하면 빈 다이제스트로 폴백하고 던지지 않는다', async () => {
    latestResults.mockRejectedValue(new Error('db down'));
    const d = await fetchResearchDigest();
    expect(d).toEqual({ trackedCount: 0, activeCount: 0, items: [], note: PRECURSOR_NOTE });
  });
});
