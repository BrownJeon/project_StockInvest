/**
 * D-4 회귀 — RAG search 결과 in-process LRU 캐시.
 */
import { buildCacheKey, cacheGet, cacheSet, cacheStats, _resetCache } from '../cache';
import type { KbHit } from '../m4-kb';

const sampleHits: KbHit[] = [{ id: 'a', score: 0.9, text: 't', metadata: {} }];

describe('cache', () => {
  beforeEach(() => {
    _resetCache({ ttlMs: 60_000, maxEntries: 200 });
  });

  test('buildCacheKey: 같은 입력 → 같은 키', () => {
    const k1 = buildCacheKey('news.macro', 'hello', 3, { date: { gte: '2026-01-01' } });
    const k2 = buildCacheKey('news.macro', 'hello', 3, { date: { gte: '2026-01-01' } });
    expect(k1).toBe(k2);
  });

  test('buildCacheKey: filter 다르면 다른 키', () => {
    const k1 = buildCacheKey('news.macro', 'q', 3, { date: { gte: '2026-01-01' } });
    const k2 = buildCacheKey('news.macro', 'q', 3, { date: { gte: '2026-02-01' } });
    expect(k1).not.toBe(k2);
  });

  test('cache miss → set → hit', () => {
    const key = buildCacheKey('c', 'q', 5, undefined);
    expect(cacheGet(key)).toBeNull();
    cacheSet(key, sampleHits);
    expect(cacheGet(key)).toEqual(sampleHits);
    expect(cacheStats().hits).toBe(1);
    expect(cacheStats().misses).toBe(1);
  });

  test('TTL 만료 → null', async () => {
    _resetCache({ ttlMs: 50, maxEntries: 200 });
    const key = buildCacheKey('c', 'q', 5, undefined);
    cacheSet(key, sampleHits);
    expect(cacheGet(key)).not.toBeNull();
    await new Promise(r => setTimeout(r, 70));
    expect(cacheGet(key)).toBeNull();
  });

  test('빈 hits → 음수 캐싱 안 함', () => {
    const key = buildCacheKey('c', 'q', 5, undefined);
    cacheSet(key, []);
    expect(cacheGet(key)).toBeNull();
    expect(cacheStats().size).toBe(0);
  });

  test('LRU eviction — maxEntries 초과 시 가장 오래된 것 제거', () => {
    _resetCache({ ttlMs: 60_000, maxEntries: 3 });
    cacheSet(buildCacheKey('c1', 'q', 1, undefined), sampleHits);
    cacheSet(buildCacheKey('c2', 'q', 1, undefined), sampleHits);
    cacheSet(buildCacheKey('c3', 'q', 1, undefined), sampleHits);
    expect(cacheStats().size).toBe(3);
    cacheSet(buildCacheKey('c4', 'q', 1, undefined), sampleHits);   // c1 evict
    expect(cacheStats().size).toBe(3);
    expect(cacheGet(buildCacheKey('c1', 'q', 1, undefined))).toBeNull();
    expect(cacheGet(buildCacheKey('c4', 'q', 1, undefined))).not.toBeNull();
  });

  test('LRU touch — get 호출 시 최신으로 이동', () => {
    _resetCache({ ttlMs: 60_000, maxEntries: 3 });
    const k1 = buildCacheKey('c1', 'q', 1, undefined);
    const k2 = buildCacheKey('c2', 'q', 1, undefined);
    const k3 = buildCacheKey('c3', 'q', 1, undefined);
    cacheSet(k1, sampleHits);
    cacheSet(k2, sampleHits);
    cacheSet(k3, sampleHits);
    cacheGet(k1);   // touch — k1 최신화
    cacheSet(buildCacheKey('c4', 'q', 1, undefined), sampleHits);   // 이젠 k2 가 evict
    expect(cacheGet(k1)).not.toBeNull();
    expect(cacheGet(k2)).toBeNull();
  });
});
