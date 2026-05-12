/**
 * RAG retrieval 단위 테스트 (Phase AB).
 *
 * 검증:
 *   1. 3 collection 병렬 검색 + 결과 합산
 *   2. 부분 실패 — 한 collection 죽어도 나머지 진행
 *   3. 빈 query → 빈 컨텍스트
 *   4. 시장별 collection 라우팅 (domestic/overseas/crypto)
 */
import { retrieveRagContext } from '../retrieval';
import * as kbModule from '../m4-kb';
import { _resetCache } from '../cache';

jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));
jest.mock('@/lib/credentials', () => ({ getCredential: jest.fn() }));

describe('retrieveRagContext', () => {
  let searchMock: jest.SpyInstance;

  beforeEach(() => {
    kbModule._resetKbClientCache();
    _resetCache();   // D-4: 테스트 간 캐시 격리
    process.env.AI_API_BASE = 'http://m4api.local:8000';
    process.env.AI_API_KEY  = 'test-key';
    searchMock = jest.spyOn(kbModule.M4KbClient.prototype, 'search')
      .mockImplementation(async (collection: string) => {
        if (collection.startsWith('signals.')) return [{ id: 's1', score: 0.9, text: 'past', metadata: {} }];
        if (collection === 'news.kr_market' || collection === 'news.us_market') return [{ id: 'n1', score: 0.8, text: 'news', metadata: {} }];
        if (collection === 'news.macro') return [{ id: 'm1', score: 0.7, text: 'macro', metadata: {} }];
        return [];
      });
  });

  afterEach(() => {
    searchMock.mockRestore();
    kbModule._resetKbClientCache();
  });

  test('domestic — signals.stockinvest + news.kr_market + news.macro 병렬', async () => {
    const ctx = await retrieveRagContext('삼성전자 RSI 과매도', 'domestic');
    expect(ctx.pastSignals).toHaveLength(1);
    expect(ctx.recentNews).toHaveLength(1);
    expect(ctx.macroContext).toHaveLength(1);
    expect(ctx.totalChars).toBeGreaterThan(0);
    expect(ctx.errors).toHaveLength(0);

    const calledCollections = searchMock.mock.calls.map(c => c[0]);
    expect(calledCollections).toContain('signals.stockinvest');
    expect(calledCollections).toContain('news.kr_market');
    expect(calledCollections).toContain('news.macro');
  });

  test('overseas — news.us_market 라우팅', async () => {
    await retrieveRagContext('AAPL momentum', 'overseas');
    const collections = searchMock.mock.calls.map(c => c[0]);
    expect(collections).toContain('news.us_market');
    expect(collections).not.toContain('news.kr_market');
  });

  test('crypto — signals.tradinginvest + news.us_market', async () => {
    await retrieveRagContext('BTC RSI', 'crypto');
    const collections = searchMock.mock.calls.map(c => c[0]);
    expect(collections).toContain('signals.tradinginvest');
    expect(collections).toContain('news.us_market');
  });

  test('부분 실패 — news.macro만 죽어도 나머지 정상', async () => {
    searchMock.mockImplementation(async (collection: string) => {
      if (collection === 'news.macro') throw new Error('boom');
      return [{ id: 'x', score: 0.5, text: 't', metadata: {} }];
    });
    const ctx = await retrieveRagContext('q', 'domestic');
    expect(ctx.pastSignals).toHaveLength(1);
    expect(ctx.recentNews).toHaveLength(1);
    expect(ctx.macroContext).toHaveLength(0);
    expect(ctx.errors).toHaveLength(1);
    expect(ctx.errors[0]).toContain('news.macro');
  });

  test('빈 query → 즉시 빈 컨텍스트', async () => {
    const ctx = await retrieveRagContext('   ', 'domestic');
    expect(ctx.pastSignals).toHaveLength(0);
    expect(ctx.totalChars).toBe(0);
    expect(searchMock).not.toHaveBeenCalled();
  });

  // D-1: signals 컬렉션에도 dateFilter 적용 검증
  test('D-1: signals 검색에도 date filter 적용 (lookbackDaysSignals)', async () => {
    await retrieveRagContext('q', 'domestic', { lookbackDaysSignals: 14 });
    const signalsCall = searchMock.mock.calls.find(c => c[0] === 'signals.stockinvest');
    expect(signalsCall).toBeDefined();
    const opts = signalsCall![2];
    expect(opts.filter).toBeDefined();
    expect(opts.filter.date.gte).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // 14일 전 날짜인지 — gte 가 today 보다 과거여야 함
    const gte = new Date(opts.filter.date.gte + 'T00:00:00Z');
    const today = new Date();
    const diffDays = Math.round((today.getTime() - gte.getTime()) / (24 * 3600 * 1000));
    expect(diffDays).toBeGreaterThanOrEqual(13);
    expect(diffDays).toBeLessThanOrEqual(15);
  });

  test('D-1: signals lookback 미지정 시 default 30일', async () => {
    await retrieveRagContext('q', 'domestic');
    const signalsCall = searchMock.mock.calls.find(c => c[0] === 'signals.stockinvest');
    const gte = new Date(signalsCall![2].filter.date.gte + 'T00:00:00Z');
    const today = new Date();
    const diffDays = Math.round((today.getTime() - gte.getTime()) / (24 * 3600 * 1000));
    expect(diffDays).toBeGreaterThanOrEqual(29);
    expect(diffDays).toBeLessThanOrEqual(31);
  });

  // D-2: minScore 필터링 검증
  test('D-2: minScore 미만 hit 제외', async () => {
    searchMock.mockImplementation(async (collection: string) => {
      if (collection === 'signals.stockinvest') return [
        { id: 'high', score: 0.9, text: 'good',  metadata: {} },
        { id: 'low',  score: 0.3, text: 'noisy', metadata: {} },
      ];
      return [];
    });
    const ctx = await retrieveRagContext('q', 'domestic', { minScore: 0.5 });
    expect(ctx.pastSignals).toHaveLength(1);
    expect(ctx.pastSignals[0].id).toBe('high');
  });

  test('D-2: minScore=0 이면 모든 hit 통과', async () => {
    searchMock.mockImplementation(async (collection: string) => {
      if (collection === 'signals.stockinvest') return [
        { id: 'a', score: 0.1, text: 't', metadata: {} },
        { id: 'b', score: 0.9, text: 't', metadata: {} },
      ];
      return [];
    });
    const ctx = await retrieveRagContext('q', 'domestic', { minScore: 0 });
    expect(ctx.pastSignals).toHaveLength(2);
  });

  // D-4: 캐시 hit 검증
  test('D-4: 동일 query 2회 호출 시 두 번째는 search 미호출 (캐시 hit)', async () => {
    await retrieveRagContext('동일쿼리', 'domestic');
    const callsAfterFirst = searchMock.mock.calls.length;
    await retrieveRagContext('동일쿼리', 'domestic');
    const callsAfterSecond = searchMock.mock.calls.length;
    expect(callsAfterSecond).toBe(callsAfterFirst);   // 캐시 적중 — 추가 호출 없음
  });

  test('D-4: 다른 query → 캐시 miss → 새로 호출', async () => {
    await retrieveRagContext('쿼리A', 'domestic');
    const callsAfterA = searchMock.mock.calls.length;
    await retrieveRagContext('쿼리B', 'domestic');
    expect(searchMock.mock.calls.length).toBeGreaterThan(callsAfterA);
  });

  // D-7: schema 검증
  test('D-7: 깨진 hit (id 누락) 제외', async () => {
    searchMock.mockImplementation(async (collection: string) => {
      if (collection === 'signals.stockinvest') return [
        { id: 'good', score: 0.9, text: 't', metadata: {} },
        { score: 0.8, text: 'no-id', metadata: {} } as any,    // id 누락
      ];
      return [];
    });
    const ctx = await retrieveRagContext('q', 'domestic', { minScore: 0 });
    expect(ctx.pastSignals).toHaveLength(1);
    expect(ctx.pastSignals[0].id).toBe('good');
  });

  test('D-2: minScore default(0.5) 자동 적용', async () => {
    searchMock.mockImplementation(async (collection: string) => {
      if (collection === 'signals.stockinvest') return [
        { id: 'pass', score: 0.5, text: 't', metadata: {} },
        { id: 'drop', score: 0.49, text: 't', metadata: {} },
      ];
      return [];
    });
    const ctx = await retrieveRagContext('q', 'domestic');  // opts 미지정
    expect(ctx.pastSignals).toHaveLength(1);
    expect(ctx.pastSignals[0].id).toBe('pass');
  });
});
