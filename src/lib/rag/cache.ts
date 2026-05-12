/**
 * D-4: RAG 검색 결과 in-process LRU 캐시.
 *
 * 동기:
 *   Stage 1 batch 가 5종목 동시 처리 시 같은 macro/news 컬렉션을 query 만 약간 다르게
 *   여러 번 호출 → M4 임베딩·검색 부하 누적. 결정적 검색 결과(같은 collection+query+topK+filter)는
 *   짧은 TTL 안에서 재사용 가능.
 *
 * 정책:
 *   - 키: collection + query(앞 200자) + topK + filter(JSON)
 *   - TTL: 60초 (시장 데이터 신선도와 stage1 batch 주기 절충)
 *   - 용량: 최대 200 entry (LRU eviction). 초과 시 가장 오래 사용 안 한 항목 제거
 *   - 음수 캐싱: 빈 결과·에러는 캐시하지 않음 (다음 호출 때 재시도)
 */
import type { KbHit } from './m4-kb';

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_MAX_ENTRIES = 200;

interface CacheEntry {
  hits: KbHit[];
  expiresAt: number;
}

/** Map 의 insertion-order 가 LRU 순서가 됨 (set 시 delete + set 으로 끝으로 이동). */
const _cache = new Map<string, CacheEntry>();
let _ttlMs = DEFAULT_TTL_MS;
let _maxEntries = DEFAULT_MAX_ENTRIES;

let _hits = 0;
let _misses = 0;

export function buildCacheKey(
  collection: string,
  query: string,
  topK: number | undefined,
  filter: Record<string, unknown> | undefined,
): string {
  const q = (query ?? '').slice(0, 200);
  const f = filter ? JSON.stringify(filter) : '';
  return `${collection}|${topK ?? ''}|${f}|${q}`;
}

export function cacheGet(key: string): KbHit[] | null {
  const entry = _cache.get(key);
  if (!entry) {
    _misses++;
    return null;
  }
  if (entry.expiresAt < Date.now()) {
    _cache.delete(key);
    _misses++;
    return null;
  }
  // LRU touch — 키를 끝으로 재이동
  _cache.delete(key);
  _cache.set(key, entry);
  _hits++;
  return entry.hits;
}

export function cacheSet(key: string, hits: KbHit[]): void {
  // 음수 캐싱 회피 — 빈 배열은 저장 안 함 (다음에 재시도)
  if (!hits || hits.length === 0) return;

  if (_cache.has(key)) _cache.delete(key);
  _cache.set(key, { hits, expiresAt: Date.now() + _ttlMs });

  // LRU evict — 용량 초과 시 가장 오래된 것부터 제거
  while (_cache.size > _maxEntries) {
    const oldestKey = _cache.keys().next().value;
    if (oldestKey === undefined) break;
    _cache.delete(oldestKey);
  }
}

export function cacheStats(): { size: number; hits: number; misses: number; ttlMs: number; maxEntries: number } {
  return { size: _cache.size, hits: _hits, misses: _misses, ttlMs: _ttlMs, maxEntries: _maxEntries };
}

/** 테스트·운영 — 캐시 초기화 */
export function _resetCache(opts?: { ttlMs?: number; maxEntries?: number }): void {
  _cache.clear();
  _hits = 0;
  _misses = 0;
  if (opts?.ttlMs != null) _ttlMs = opts.ttlMs;
  if (opts?.maxEntries != null) _maxEntries = opts.maxEntries;
}
