/**
 * RAG retrieval — M4 Qdrant 3개 collection 병렬 검색 (Phase AB).
 *
 * 호출자: ai-filter-stage1.ts buildStage1Prompt.
 * 정책:
 *  - Promise.allSettled로 부분 실패 허용 (한 collection 죽어도 나머지 진행)
 *  - 전체 timeout 5초 (Stage 1 30초 budget의 1/6)
 *  - rag_enabled=false 또는 에러 → 빈 컨텍스트 반환 (호출자가 RAG 없이 진행)
 */
import { getKbClient, recordKbSuccess, recordKbFailure, type KbHit } from './m4-kb';
import { buildCacheKey, cacheGet, cacheSet } from './cache';
import { filterValidHits } from './format';

export type Market = 'domestic' | 'overseas' | 'crypto';

export interface RagContext {
  pastSignals: KbHit[];
  recentNews:  KbHit[];
  macroContext: KbHit[];
  totalChars: number;
  elapsedMs: number;
  errors: string[];
}

const EMPTY_CONTEXT: RagContext = {
  pastSignals: [], recentNews: [], macroContext: [],
  totalChars: 0, elapsedMs: 0, errors: [],
};

const DEFAULT_TOP_K_SIGNALS = 5;
const DEFAULT_TOP_K_NEWS = 3;
const DEFAULT_TOP_K_MACRO = 2;
const DEFAULT_LOOKBACK_DAYS = 7;          // news/macro — 신선도 강하게
const DEFAULT_LOOKBACK_DAYS_SIGNALS = 30; // signals — 시그널은 더 길게 (시장 레짐 변화 감지 위해 30일)
const DEFAULT_MIN_SCORE = 0.5;            // bge-m3 기준 — score < 0.5 는 노이즈 (운영 데이터로 임계값 재조정 가능)
const DEFAULT_TIMEOUT_MS = 5000;

export interface RetrievalOptions {
  topKSignals?: number;
  topKNews?: number;
  topKMacro?: number;
  lookbackDays?: number;
  /** signals 컬렉션 전용 lookback. 미지정 시 DEFAULT_LOOKBACK_DAYS_SIGNALS(30) 사용. */
  lookbackDaysSignals?: number;
  /** 검색 결과 score 임계값 — 이 미만의 hit 는 제외 (D-2). 0 이면 비활성. */
  minScore?: number;
  timeoutMs?: number;
  /** signals collection 이름 강제 — 'signals.stockinvest' | 'signals.tradinginvest' */
  signalsCollection?: string;
}

function nDaysAgoIso(days: number): string {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function settledOr<T>(r: PromiseSettledResult<T>, fallback: T, errors: string[], label: string): T {
  if (r.status === 'fulfilled') return r.value;
  errors.push(`${label}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
  return fallback;
}

function chooseNewsCollection(market: Market): string {
  switch (market) {
    case 'overseas': return 'news.us_market';
    case 'crypto':   return 'news.us_market';   // 코인은 영문 뉴스 주도
    default:         return 'news.kr_market';   // domestic
  }
}

function chooseSignalsCollection(market: Market): string {
  return market === 'crypto' ? 'signals.tradinginvest' : 'signals.stockinvest';
}

function totalCharsOf(ctx: Omit<RagContext, 'totalChars' | 'elapsedMs' | 'errors'>): number {
  let n = 0;
  for (const arr of [ctx.pastSignals, ctx.recentNews, ctx.macroContext]) {
    for (const h of arr) n += (h.text?.length ?? 0);
  }
  return n;
}

/** D-2: score 임계값 미만 hit 제외. minScore=0 또는 음수면 그대로 통과. */
function filterByScore(hits: KbHit[], minScore: number): KbHit[] {
  if (!Number.isFinite(minScore) || minScore <= 0) return hits;
  return hits.filter(h => h.score >= minScore);
}

/**
 * D-4: 캐시를 경유한 search wrapper.
 * cache hit → 즉시 return. miss → 실 호출 + 결과 저장.
 * 빈 결과·에러는 캐시되지 않음 (cache.ts 정책).
 */
async function searchWithCache(
  client: Awaited<ReturnType<typeof getKbClient>>,
  collection: string,
  query: string,
  opts: { topK?: number; filter?: Record<string, unknown>; timeoutMs?: number },
): Promise<KbHit[]> {
  const key = buildCacheKey(collection, query, opts.topK, opts.filter);
  const cached = cacheGet(key);
  if (cached) return cached;
  const hits = await client.search(collection, query, opts);
  cacheSet(key, hits);
  return hits;
}

/**
 * 병렬 RAG 검색.
 * 5초 timeout 안에 모든 collection 시도. 부분 실패 시에도 가능한 만큼 컨텍스트 반환.
 */
export async function retrieveRagContext(
  queryText: string,
  market: Market,
  opts: RetrievalOptions = {},
): Promise<RagContext> {
  const startedAt = Date.now();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const lookbackDays = opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const lookbackDaysSignals = opts.lookbackDaysSignals ?? DEFAULT_LOOKBACK_DAYS_SIGNALS;
  const minScore = opts.minScore ?? DEFAULT_MIN_SCORE;
  const topKSignals = opts.topKSignals ?? DEFAULT_TOP_K_SIGNALS;
  const topKNews    = opts.topKNews    ?? DEFAULT_TOP_K_NEWS;
  const topKMacro   = opts.topKMacro   ?? DEFAULT_TOP_K_MACRO;

  if (!queryText.trim()) return { ...EMPTY_CONTEXT };

  let client;
  try {
    client = await getKbClient();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes('circuit breaker open')) {
      recordKbFailure('getKbClient');
    }
    return { ...EMPTY_CONTEXT, errors: [msg] };
  }

  const signalsCollection = opts.signalsCollection ?? chooseSignalsCollection(market);
  const newsCollection    = chooseNewsCollection(market);
  const dateFilter        = { date: { gte: nDaysAgoIso(lookbackDays) } };
  // D-1: signals 도 신선도 필터 적용 (별도 lookback) — 1년 전 시그널이 hits[0] 되는 것 차단
  const signalsDateFilter = { date: { gte: nDaysAgoIso(lookbackDaysSignals) } };
  const errors: string[] = [];

  // 전체 timeout — 5초 후 race
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`RAG retrieval timeout ${timeoutMs}ms`)), timeoutMs),
  );

  try {
    const settled = await Promise.race([
      Promise.allSettled([
        searchWithCache(client, signalsCollection, queryText, { topK: topKSignals, filter: signalsDateFilter, timeoutMs: timeoutMs - 500 }),
        searchWithCache(client, newsCollection,    queryText, { topK: topKNews,    filter: dateFilter,        timeoutMs: timeoutMs - 500 }),
        searchWithCache(client, 'news.macro',      queryText, { topK: topKMacro,   filter: dateFilter,        timeoutMs: timeoutMs - 500 }),
      ]),
      timeoutPromise,
    ]);

    const [pastSignalsR, recentNewsR, macroContextR] = settled;
    const pastSignalsRaw  = settledOr(pastSignalsR,  [] as KbHit[], errors, signalsCollection);
    const recentNewsRaw   = settledOr(recentNewsR,   [] as KbHit[], errors, newsCollection);
    const macroContextRaw = settledOr(macroContextR, [] as KbHit[], errors, 'news.macro');

    // 서킷 브레이커 피드백: 모두 실패하면 failure 기록, 하나라도 성공하면 리셋
    const allFailed = [pastSignalsR, recentNewsR, macroContextR].every(r => r.status === 'rejected');
    const anySucceeded = [pastSignalsR, recentNewsR, macroContextR].some(r => r.status === 'fulfilled');
    if (allFailed) recordKbFailure('all-collections');
    else if (anySucceeded) recordKbSuccess();

    // D-7: schema 검증 — 깨진 hit 제외
    const pastSignalsValid = filterValidHits(pastSignalsRaw);
    const recentNewsValid  = filterValidHits(recentNewsRaw);
    const macroContextValid = filterValidHits(macroContextRaw);
    const droppedByValidation =
      pastSignalsValid.invalidCount + recentNewsValid.invalidCount + macroContextValid.invalidCount;

    // D-2: score 임계값 미만 제외 — 무관한 hit 의 LLM 환각 방지
    const pastSignals  = filterByScore(pastSignalsValid.valid,  minScore);
    const recentNews   = filterByScore(recentNewsValid.valid,   minScore);
    const macroContext = filterByScore(macroContextValid.valid, minScore);
    const droppedByScore =
      (pastSignalsValid.valid.length - pastSignals.length) +
      (recentNewsValid.valid.length - recentNews.length) +
      (macroContextValid.valid.length - macroContext.length);

    const totalChars = totalCharsOf({ pastSignals, recentNews, macroContext });
    const elapsedMs = Date.now() - startedAt;

    console.log(
      `[rag-retrieval] (${market}) past=${pastSignals.length} news=${recentNews.length} macro=${macroContext.length} ` +
      `chars=${totalChars} elapsed=${elapsedMs}ms` +
      `${droppedByValidation ? ` droppedByValidation=${droppedByValidation}` : ''}` +
      `${droppedByScore ? ` droppedByScore=${droppedByScore}(<${minScore})` : ''}` +
      `${errors.length ? ` errors=${errors.length}` : ''}`,
    );

    return { pastSignals, recentNews, macroContext, totalChars, elapsedMs, errors };
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.warn(`[rag-retrieval] failed — empty context: ${errMsg}`);
    return { ...EMPTY_CONTEXT, elapsedMs: Date.now() - startedAt, errors: [errMsg] };
  }
}
