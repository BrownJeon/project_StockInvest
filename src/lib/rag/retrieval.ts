/**
 * RAG retrieval — M4 Qdrant 3개 collection 병렬 검색 (Phase AB).
 *
 * 호출자: ai-filter-stage1.ts buildStage1Prompt.
 * 정책:
 *  - Promise.allSettled로 부분 실패 허용 (한 collection 죽어도 나머지 진행)
 *  - 전체 timeout 5초 (Stage 1 30초 budget의 1/6)
 *  - rag_enabled=false 또는 에러 → 빈 컨텍스트 반환 (호출자가 RAG 없이 진행)
 */
import { getKbClient, type KbHit } from './m4-kb';

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
const DEFAULT_LOOKBACK_DAYS = 7;
const DEFAULT_TIMEOUT_MS = 5000;

export interface RetrievalOptions {
  topKSignals?: number;
  topKNews?: number;
  topKMacro?: number;
  lookbackDays?: number;
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
  const topKSignals = opts.topKSignals ?? DEFAULT_TOP_K_SIGNALS;
  const topKNews    = opts.topKNews    ?? DEFAULT_TOP_K_NEWS;
  const topKMacro   = opts.topKMacro   ?? DEFAULT_TOP_K_MACRO;

  if (!queryText.trim()) return { ...EMPTY_CONTEXT };

  let client;
  try {
    client = await getKbClient();
  } catch (e) {
    return { ...EMPTY_CONTEXT, errors: [`getKbClient: ${e instanceof Error ? e.message : String(e)}`] };
  }

  const signalsCollection = opts.signalsCollection ?? chooseSignalsCollection(market);
  const newsCollection    = chooseNewsCollection(market);
  const dateFilter = { date: { gte: nDaysAgoIso(lookbackDays) } };
  const errors: string[] = [];

  // 전체 timeout — 5초 후 race
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`RAG retrieval timeout ${timeoutMs}ms`)), timeoutMs),
  );

  try {
    const settled = await Promise.race([
      Promise.allSettled([
        client.search(signalsCollection, queryText, { topK: topKSignals, timeoutMs: timeoutMs - 500 }),
        client.search(newsCollection,    queryText, { topK: topKNews, filter: dateFilter, timeoutMs: timeoutMs - 500 }),
        client.search('news.macro',      queryText, { topK: topKMacro, filter: dateFilter, timeoutMs: timeoutMs - 500 }),
      ]),
      timeoutPromise,
    ]);

    const [pastSignalsR, recentNewsR, macroContextR] = settled;
    const pastSignals  = settledOr(pastSignalsR,  [] as KbHit[], errors, signalsCollection);
    const recentNews   = settledOr(recentNewsR,   [] as KbHit[], errors, newsCollection);
    const macroContext = settledOr(macroContextR, [] as KbHit[], errors, 'news.macro');

    const totalChars = totalCharsOf({ pastSignals, recentNews, macroContext });
    const elapsedMs = Date.now() - startedAt;

    console.log(
      `[rag-retrieval] (${market}) past=${pastSignals.length} news=${recentNews.length} macro=${macroContext.length} chars=${totalChars} elapsed=${elapsedMs}ms${errors.length ? ` errors=${errors.length}` : ''}`,
    );

    return { pastSignals, recentNews, macroContext, totalChars, elapsedMs, errors };
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.warn(`[rag-retrieval] failed — empty context: ${errMsg}`);
    return { ...EMPTY_CONTEXT, elapsedMs: Date.now() - startedAt, errors: [errMsg] };
  }
}
