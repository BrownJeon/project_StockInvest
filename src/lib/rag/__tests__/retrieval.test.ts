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

jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));
jest.mock('@/lib/credentials', () => ({ getCredential: jest.fn() }));

describe('retrieveRagContext', () => {
  let searchMock: jest.SpyInstance;

  beforeEach(() => {
    kbModule._resetKbClientCache();
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
});
