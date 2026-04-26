import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { kis } from '@/lib/exchanges/kis';
import { getMarketFromSymbol, type Market } from '@/lib/exchanges/kis-symbols';
import { getCurrentMarket } from '@/lib/strategy/market-hours';
import { createSignal } from '@/lib/signals/service';
import { isAnalystEnabled } from '@/lib/signals/router';
import type { SignalInput } from '@/lib/signals/router';
import { getEffectiveOrderMax } from '@/lib/safety/order-limits';
import {
  aiSelectSignal,
  aiSelectSignalBatch,
  buildMarketSummary,
  getRecentTrades,
  type AiEvEstimate,
  type BatchSymbolInput,
  type MarketContext,
  type MarketSummary,
  type RecentTrade,
  type SkipCategory,
} from '@/lib/strategy/ai-filter';
import { prefilterCandidate } from '@/lib/strategy/ai-prefilter';
import { buildRegimeBucket, lookupRecentSkip } from '@/lib/strategy/ai-dedup';
import { refreshUniverse, getUniverseSymbols } from '@/lib/strategy/universe';
import type { Candle, Ticker } from '@/lib/exchanges/types';
import type { StrategyMeta } from './rules/types';
import { STRATEGY_REGISTRY } from './rules';
import { getAnalystStyle, getStyleConfig } from './style';
import type { AnalystStyle, StyleConfig } from './style';

interface StrategyRow extends RowDataPacket {
  id: string;
  enabled: number;
  backtest_interval_h: number;
  next_backtest_at: Date | null;
}

export interface EvalResult {
  symbol: string;
  signalsCreated: number;
  selectedStrategy?: string;
  candidateCount?: number;
  side?: 'buy' | 'sell';
  error?: string;
  /** 전략 룰이 생성한 원시 후보 수 (AI 필터 전). 노이즈 점검용 */
  rawCandidates?: number;
}

export interface RunAllResult {
  ran: number;
  skipped: number;
  skippedStrategyIds: string[];
  results: EvalResult[];
  errors: string[];
  universeRefreshed?: boolean;
}

type ActiveStrategy = { id: string; meta: StrategyMeta };
type Candidate = SignalInput & { strategyId: string };


async function getHeldAmounts(market: Market): Promise<Map<string, number>> {
  try {
    const balances = await kis.getBalances();
    const map = new Map<string, number>();
    for (const b of balances) {
      if (b.currency === 'KRW' || b.currency === 'USD') continue;
      const qty = Number(b.free) + Number(b.locked);
      if (qty <= 0) continue;
      // currency 자체가 심볼 (국내: 6자리 숫자, 해외: 'NAS:AAPL')
      const symbolMarket = getMarketFromSymbol(b.currency);
      if (symbolMarket !== market) continue;
      map.set(b.currency, qty);
    }
    return map;
  } catch {
    return new Map();
  }
}

/** 거래대금 TOP 20 + 보유 종목 합산 (시장별) */
async function getEvalSymbols(
  market: Market,
  heldAmounts: Map<string, number>,
): Promise<string[]> {
  const set = new Set<string>();
  const [trend, meanRev, breakout] = await Promise.all([
    getUniverseSymbols('trend', 5, market),
    getUniverseSymbols('mean-rev', 5, market),
    getUniverseSymbols('breakout', 5, market),
  ]);
  for (const s of [...trend, ...meanRev, ...breakout]) set.add(s);
  for (const s of heldAmounts.keys()) set.add(s);
  return [...set];
}

interface CollectedContext {
  symbol: string;
  ticker: Ticker;
  candidates: Candidate[];
  summary: MarketSummary | null;
  aiCandles: Candle[];
  recentTrades: RecentTrade[];
  heldQty?: number;
  rawCandidateCount: number;
  error?: string;
}

/**
 * 단일 종목의 후보 수집 (AI 호출 없음):
 *  1. 티커·캔들 fetch
 *  2. 활성 전략 실행 → 후보 시그널 수집
 *  3. 포지션 가드·매도 수량 보정·재매수 쿨다운 적용
 *  4. MarketSummary + RecentTrades 준비
 */
async function collectCandidates(
  symbol: string,
  strategies: ActiveStrategy[],
  heldAmounts: Map<string, number>,
  amountKRW: number,
  style: StyleConfig,
): Promise<CollectedContext | null> {
  let ticker: Ticker;
  try {
    ticker = await kis.getTicker(symbol);
  } catch (e) {
    return {
      symbol, ticker: {} as Ticker, candidates: [], summary: null, aiCandles: [],
      recentTrades: [], rawCandidateCount: 0, error: `ticker:${e}`,
    };
  }

  const pool = getPool();
  const candleCache = new Map<string, Candle[]>();
  const getCandlesFor = async (interval: string, minCandles: number): Promise<Candle[] | null> => {
    if (!candleCache.has(interval)) {
      try {
        const c = await kis.getCandles(symbol, interval, Math.max(minCandles + 10, 60));
        candleCache.set(interval, c);
      } catch { return null; }
    }
    return candleCache.get(interval) ?? null;
  };

  // 재매수 쿨다운
  const recentSellCheck = await pool.query<RowDataPacket[]>(
    `SELECT id FROM signals
     WHERE symbol = ? AND side = 'sell' AND status IN ('executed','accepted')
       AND created_at > DATE_SUB(NOW(), INTERVAL ? MINUTE)
     LIMIT 1`,
    [symbol, style.rebuyCooldownMin],
  );
  const hasRecentSell = (recentSellCheck[0] as RowDataPacket[]).length > 0;

  const candidates: Candidate[] = [];

  for (const { id, meta } of strategies) {
    const candles = await getCandlesFor(meta.interval, meta.minCandles);
    if (!candles || candles.length < meta.minCandles) continue;

    const rawSignals = meta.fn({ strategyId: id, symbol, candles, ticker, amountKRW, style });

    for (const sig of rawSignals) {
      if (sig.side === 'buy' && heldAmounts.has(symbol)) continue;
      if (sig.side === 'sell' && !heldAmounts.has(symbol)) continue;
      if (sig.side === 'buy' && hasRecentSell) continue;

      if (sig.side === 'sell') {
        const heldQty = heldAmounts.get(symbol)!;
        const heldValue = Math.round(heldQty * (ticker.price ?? 0));
        if (heldValue < sig.amountKRW) continue;
        candidates.push({ ...sig, strategyId: id, quantity: heldQty, amountKRW: heldValue });
      } else {
        candidates.push({ ...sig, strategyId: id });
      }
    }
  }

  if (candidates.length === 0) {
    return {
      symbol, ticker, candidates: [], summary: null, aiCandles: [],
      recentTrades: [], heldQty: heldAmounts.get(symbol), rawCandidateCount: 0,
    };
  }

  const aiCandles = await getCandlesFor('30m', 30) ?? [];
  const summary = aiCandles.length > 0 ? buildMarketSummary(aiCandles, ticker) : null;
  const recentTrades = await getRecentTrades(symbol);

  return {
    symbol, ticker, candidates, summary, aiCandles, recentTrades,
    heldQty: heldAmounts.get(symbol), rawCandidateCount: candidates.length,
  };
}

interface SkipAuditPayload {
  reasoning: string;
  category: SkipCategory;
  confidence: number;
  warnings?: string[];
  ev?: AiEvEstimate;
  regimeBucket?: string;
}

/** signals 테이블에 ai_skipped 레코드 insert — prefilter/dedup/AI 거절 공용 */
async function insertSkipAuditPool(
  pool: ReturnType<typeof getPool>,
  cand: Candidate,
  symbol: string,
  priceAtSkip: number,
  payload: SkipAuditPayload,
): Promise<void> {
  const market = getMarketFromSymbol(symbol);
  await pool.query<ResultSetHeader>(
    `INSERT INTO signals (strategy_id, symbol, side, order_type, amount_krw, reasoning, indicators, status, expires_at, price_at_skip, market)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'ai_skipped', DATE_ADD(NOW(), INTERVAL 30 MINUTE), ?, ?)`,
    [
      cand.strategyId, symbol, cand.side, cand.orderType, cand.amountKRW,
      payload.reasoning,
      JSON.stringify({
        ...(cand.indicators as object ?? {}),
        ai: {
          confidence: payload.confidence,
          warnings: payload.warnings ?? [],
          skipCategory: payload.category,
          ev: payload.ev,
          regimeBucket: payload.regimeBucket,
        },
      }),
      priceAtSkip,
      market,
    ],
  );
}

/** context에 prefilter + dedup을 적용해 AI 호출 필요 후보를 추려낸다. */
async function applyFilters(
  ctx: CollectedContext,
  analystStyle: AnalystStyle,
  heldAmounts: Map<string, number>,
): Promise<{ needsAi: Candidate[]; regimeBucket: string | null }> {
  const pool = getPool();
  const { symbol, candidates, summary, aiCandles, ticker } = ctx;

  // 1) pre-filter (summary 없으면 skip)
  let survived: Candidate[] = candidates;
  if (summary) {
    const passed: Candidate[] = [];
    const skipped: Array<{ cand: Candidate; reason: string }> = [];
    for (const cand of candidates) {
      const decision = prefilterCandidate(cand, summary, aiCandles, analystStyle);
      if (decision.verdict === 'skip') {
        skipped.push({ cand, reason: `${decision.reason}: ${decision.detail ?? ''}`.trim() });
      } else {
        passed.push(cand);
      }
    }
    for (const { cand, reason } of skipped) {
      await insertSkipAuditPool(pool, cand, symbol, ticker.price, {
        reasoning: `[rule_prefilter] ${reason}`,
        category: 'rule_prefilter',
        confidence: 0,
      });
    }
    if (skipped.length > 0) {
      console.log(`[prefilter] ${symbol} → ${skipped.length}/${candidates.length} skipped (${skipped.map(p => p.reason.split(':')[0]).join(',')})`);
    }
    survived = passed;
  }

  if (survived.length === 0) return { needsAi: [], regimeBucket: null };

  // 2) dedup (보유 심볼 제외)
  const regimeBucket = summary ? buildRegimeBucket(summary) : null;
  const isHeld = heldAmounts.has(symbol);

  if (!regimeBucket || isHeld) {
    return { needsAi: survived, regimeBucket };
  }

  const needsAi: Candidate[] = [];
  let dedupHits = 0;
  for (const cand of survived) {
    const hit = await lookupRecentSkip(
      { symbol, strategyId: cand.strategyId, side: cand.side, regime: regimeBucket },
      analystStyle,
    );
    if (hit.hit && hit.prev) {
      dedupHits++;
      await insertSkipAuditPool(pool, cand, symbol, ticker.price, {
        reasoning: `[dedup_reuse] ${hit.prev.reasoning.slice(0, 200)}`,
        category: 'dedup_reuse',
        confidence: hit.prev.confidence,
        warnings: hit.prev.warnings,
        ev: hit.prev.ev,
        regimeBucket,
      });
    } else {
      needsAi.push(cand);
    }
  }
  if (dedupHits > 0) {
    console.log(`[dedup] ${symbol} → ${dedupHits}/${survived.length} hits (bucket=${regimeBucket})`);
  }

  return { needsAi, regimeBucket };
}

/** 최근 3시간 거시 지수 맥락 + universe 평균 지표를 수집한다. (코스피·SP500 등 거시 지수 조회 미구현 — null 유지) */
async function buildMarketContext(contexts: CollectedContext[]): Promise<MarketContext> {
  const pool = getPool();

  const btc3hChangePct: number | null = null;
  const btc3hVolRatio: number | null = null;

  // Universe 평균 volumeRatio, 고변동 종목 수 (현재 수집된 context 기반)
  const validSummaries = contexts.map(c => c.summary).filter((s): s is MarketSummary => !!s);
  const avgVolumeRatio = validSummaries.length > 0
    ? validSummaries.reduce((s, v) => s + v.volumeRatio, 0) / validSummaries.length
    : null;
  const highVolCount = validSummaries.filter(s =>
    s.atr14 != null && s.currentPrice > 0 && (s.atr14 / s.currentPrice) * 100 >= 3,
  ).length;

  // 최근 3h 체결 건수 (전체 universe)
  let recentExecutedBuys = 0;
  let recentExecutedSells = 0;
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT side, COUNT(*) AS n FROM signals
       WHERE status IN ('executed','accepted')
         AND created_at > DATE_SUB(NOW(), INTERVAL 3 HOUR)
       GROUP BY side`,
    );
    for (const r of rows) {
      if (r.side === 'buy') recentExecutedBuys = Number(r.n);
      else if (r.side === 'sell') recentExecutedSells = Number(r.n);
    }
  } catch {
    // ignore
  }

  return { btc3hChangePct, btc3hVolRatio, avgVolumeRatio, highVolCount, recentExecutedBuys, recentExecutedSells };
}

/** 배치 AI 결과를 각 context에 적용 — createSignal 또는 ai_skipped insert. */
async function applyBatchDecisions(
  needsAiMap: Map<string, { ctx: CollectedContext; needsAi: Candidate[]; regimeBucket: string | null }>,
  batchDecisions: Array<{ symbol: string; selectedIndex: number; confidence: number; reasoning: string; warnings: string[]; skipCategory?: SkipCategory; ev?: AiEvEstimate }>,
  results: Map<string, EvalResult>,
): Promise<void> {
  const pool = getPool();
  for (const d of batchDecisions) {
    const entry = needsAiMap.get(d.symbol);
    if (!entry) continue;
    const { ctx, needsAi, regimeBucket } = entry;

    if (d.selectedIndex === -1 || d.skipCategory === 'ai_failed') {
      for (const sig of needsAi) {
        await insertSkipAuditPool(pool, sig, d.symbol, ctx.ticker.price, {
          reasoning: `[${d.skipCategory ?? 'ai_rejected'}:${d.confidence}%] ${d.reasoning}`,
          category: d.skipCategory ?? 'ai_rejected',
          confidence: d.confidence,
          warnings: d.warnings,
          ev: d.ev,
          regimeBucket: regimeBucket ?? undefined,
        });
      }
      results.set(d.symbol, {
        symbol: d.symbol,
        signalsCreated: 0,
        candidateCount: needsAi.length,
        rawCandidates: ctx.rawCandidateCount,
      });
      continue;
    }

    const selected = needsAi[d.selectedIndex];
    const enriched: Candidate = {
      ...selected,
      reasoning: [
        selected.reasoning,
        `[AI ${d.confidence}%] ${d.reasoning}`,
        ...(d.warnings.length ? [`경고: ${d.warnings.join(' / ')}`] : []),
      ].filter(Boolean).join('\n'),
      indicators: {
        ...(selected.indicators as object ?? {}),
        ai: { confidence: d.confidence, warnings: d.warnings, selectedFrom: needsAi.length, ev: d.ev, regimeBucket: regimeBucket ?? undefined },
      },
    };

    const res = await createSignal(enriched);
    results.set(d.symbol, {
      symbol: d.symbol,
      signalsCreated: res.ok ? 1 : 0,
      selectedStrategy: selected.strategyId,
      candidateCount: needsAi.length,
      rawCandidates: ctx.rawCandidateCount,
      side: selected.side,
    });
  }
}

/** 배치 실패 시 보유 심볼만 per-symbol fallback. 비보유는 ai_failed 스킵. */
async function fallbackPerSymbol(
  needsAiMap: Map<string, { ctx: CollectedContext; needsAi: Candidate[]; regimeBucket: string | null }>,
  style: StyleConfig,
  analystStyle: AnalystStyle,
  heldAmounts: Map<string, number>,
  results: Map<string, EvalResult>,
  reason: string,
  market: Market,
): Promise<void> {
  const pool = getPool();
  let fallbackCount = 0;
  let skippedCount = 0;

  for (const [symbol, entry] of needsAiMap) {
    const { ctx, needsAi, regimeBucket } = entry;
    const isHeld = heldAmounts.has(symbol);

    if (isHeld) {
      fallbackCount++;
      const aiResult = await aiSelectSignal(symbol, needsAi, ctx.aiCandles, ctx.ticker, style, analystStyle, market);

      if (aiResult.selectedIndex === -1) {
        for (const sig of needsAi) {
          await insertSkipAuditPool(pool, sig, symbol, ctx.ticker.price, {
            reasoning: `[${aiResult.skipCategory ?? 'ai_rejected'}:${aiResult.confidence}%] ${aiResult.reasoning}`,
            category: aiResult.skipCategory ?? 'ai_rejected',
            confidence: aiResult.confidence,
            warnings: aiResult.warnings,
            ev: aiResult.ev,
            regimeBucket: regimeBucket ?? undefined,
          });
        }
        results.set(symbol, { symbol, signalsCreated: 0, candidateCount: needsAi.length, rawCandidates: ctx.rawCandidateCount });
      } else {
        const selected = needsAi[aiResult.selectedIndex];
        const enriched: Candidate = {
          ...selected,
          reasoning: [
            selected.reasoning,
            `[AI ${aiResult.confidence}%] ${aiResult.reasoning}`,
            ...(aiResult.warnings.length ? [`경고: ${aiResult.warnings.join(' / ')}`] : []),
          ].filter(Boolean).join('\n'),
          indicators: {
            ...(selected.indicators as object ?? {}),
            ai: { confidence: aiResult.confidence, warnings: aiResult.warnings, selectedFrom: needsAi.length, ev: aiResult.ev, regimeBucket: regimeBucket ?? undefined },
          },
        };
        const res = await createSignal(enriched);
        results.set(symbol, {
          symbol, signalsCreated: res.ok ? 1 : 0, selectedStrategy: selected.strategyId,
          candidateCount: needsAi.length, rawCandidates: ctx.rawCandidateCount, side: selected.side,
        });
      }
    } else {
      skippedCount++;
      for (const sig of needsAi) {
        await insertSkipAuditPool(pool, sig, symbol, ctx.ticker.price, {
          reasoning: `[ai_failed] 배치 실패 + 비보유 → 다음 tick 재시도. ${reason}`,
          category: 'ai_failed',
          confidence: 0,
          regimeBucket: regimeBucket ?? undefined,
        });
      }
      results.set(symbol, { symbol, signalsCreated: 0, candidateCount: needsAi.length, rawCandidates: ctx.rawCandidateCount });
    }
  }

  console.log(`[ai-batch] fallback: ${fallbackCount} held per-symbol, ${skippedCount} non-held skipped (${reason})`);
}

/** 시장별 평가 실행 (단일 시장). runAll에서 라우팅. */
async function runMarket(market: Market, opts: { force?: boolean } = {}): Promise<RunAllResult> {
  if (!(await isAnalystEnabled())) {
    return { ran: 0, skipped: 0, skippedStrategyIds: [], results: [], errors: ['analyst_disabled'], universeRefreshed: false };
  }

  const pool = getPool();
  const [rows] = await pool.query<StrategyRow[]>(
    `SELECT id, enabled, backtest_interval_h, next_backtest_at FROM strategies WHERE enabled = 1`,
  );

  const analystStyle = await getAnalystStyle();
  const style = getStyleConfig(analystStyle);

  const { refreshed: universeRefreshed } = await refreshUniverse(market, opts.force);

  const now = new Date();
  const dueStrategies: Array<ActiveStrategy & { row: StrategyRow }> = [];
  const skippedStrategyIds: string[] = [];

  for (const row of rows) {
    const meta = STRATEGY_REGISTRY[row.id];
    if (!meta) { skippedStrategyIds.push(row.id); continue; }
    if (!opts.force && row.next_backtest_at && row.next_backtest_at > now) {
      skippedStrategyIds.push(row.id);
      continue;
    }
    dueStrategies.push({ id: row.id, meta, row });
  }

  if (dueStrategies.length === 0) {
    return { ran: 0, skipped: skippedStrategyIds.length, skippedStrategyIds, results: [], errors: [], universeRefreshed };
  }

  const heldAmounts = await getHeldAmounts(market);
  const activeStrategies: ActiveStrategy[] = dueStrategies.map(s => ({ id: s.id, meta: s.meta }));
  const symbols = await getEvalSymbols(market, heldAmounts);
  const defaultAmountKRW = await getEffectiveOrderMax('kis', market);

  const errors: string[] = [];
  const results = new Map<string, EvalResult>();

  // 1단계: 모든 심볼의 후보 수집 (AI 호출 없음)
  const contexts: CollectedContext[] = [];
  for (const symbol of symbols) {
    const ctx = await collectCandidates(symbol, activeStrategies, heldAmounts, defaultAmountKRW, style);
    if (!ctx) continue;
    if (ctx.error) {
      errors.push(`${symbol}: ${ctx.error}`);
      results.set(symbol, { symbol, signalsCreated: 0, error: ctx.error });
      continue;
    }
    if (ctx.candidates.length === 0) {
      results.set(symbol, { symbol, signalsCreated: 0, rawCandidates: 0 });
      continue;
    }
    contexts.push(ctx);
  }

  // 2단계: 각 context에 prefilter + dedup 적용, AI 필요한 후보만 수집
  const needsAiMap = new Map<string, { ctx: CollectedContext; needsAi: Candidate[]; regimeBucket: string | null }>();
  for (const ctx of contexts) {
    const { needsAi, regimeBucket } = await applyFilters(ctx, analystStyle, heldAmounts);
    if (needsAi.length === 0) {
      results.set(ctx.symbol, { symbol: ctx.symbol, signalsCreated: 0, candidateCount: 0, rawCandidates: ctx.rawCandidateCount });
      continue;
    }
    needsAiMap.set(ctx.symbol, { ctx, needsAi, regimeBucket });
  }

  // 3단계: 남은 심볼들을 배치 AI 호출로 일괄 처리
  if (needsAiMap.size > 0) {
    const batchInputs: BatchSymbolInput[] = [];
    for (const [, entry] of needsAiMap) {
      if (!entry.ctx.summary) continue; // summary 없으면 배치 입력 불가 → fallback 경로로
      batchInputs.push({
        symbol: entry.ctx.symbol,
        candidates: entry.needsAi,
        summary: entry.ctx.summary,
        recentTrades: entry.ctx.recentTrades,
        heldQty: entry.ctx.heldQty,
      });
    }

    if (batchInputs.length > 0) {
      const marketContext = await buildMarketContext(contexts);
      const batchResult = await aiSelectSignalBatch(batchInputs, style, analystStyle, marketContext, market);

      if (batchResult.error || batchResult.decisions.length === 0) {
        await fallbackPerSymbol(needsAiMap, style, analystStyle, heldAmounts, results, batchResult.error ?? 'empty decisions', market);
      } else {
        await applyBatchDecisions(needsAiMap, batchResult.decisions, results);
      }
    }
  }

  // 실행된 전략들의 next_backtest_at 업데이트
  for (const { id, row } of dueStrategies) {
    const nextRun = new Date(now.getTime() + row.backtest_interval_h * 3600_000);
    await pool.query(
      `UPDATE strategies SET last_backtest_at=?, next_backtest_at=? WHERE id=?`,
      [now, nextRun, id],
    );
  }

  // 결과 배열화 (symbols 순서 유지)
  const resultsArray: EvalResult[] = [];
  for (const sym of symbols) {
    const r = results.get(sym);
    if (r) resultsArray.push(r);
  }

  // 신호 품질 로그
  const totalRaw = resultsArray.reduce((s, r) => s + (r.rawCandidates ?? 0), 0);
  const totalApproved = resultsArray.reduce((s, r) => s + r.signalsCreated, 0);
  const totalSkipped = totalRaw - totalApproved;
  if (totalRaw > 0) {
    const rate = Math.round((totalApproved / totalRaw) * 100);
    console.log(`[quality:${market}] 후보 ${totalRaw}건 → AI승인 ${totalApproved} / AI스킵 ${totalSkipped} (승인율 ${rate}%)`);
  }

  return { ran: symbols.length, skipped: skippedStrategyIds.length, skippedStrategyIds, results: resultsArray, errors, universeRefreshed };
}

function mergeRunResults(...rs: RunAllResult[]): RunAllResult {
  return {
    ran: rs.reduce((s, r) => s + r.ran, 0),
    skipped: rs.reduce((s, r) => s + r.skipped, 0),
    skippedStrategyIds: rs.flatMap(r => r.skippedStrategyIds),
    results: rs.flatMap(r => r.results),
    errors: rs.flatMap(r => r.errors),
    universeRefreshed: rs.some(r => r.universeRefreshed),
  };
}

/**
 * 활성 전략 평가 — 시장(국내/해외) 자동 라우팅.
 *  - 기본: 현재 열려있는 시장 1곳에서만 실행. 모두 닫혀있으면 'all_markets_closed'.
 *  - opts.force: 양 시장 모두 강제 실행 후 결과 머지.
 *  - opts.market: 특정 시장만 강제.
 */
export async function runAll(opts: { force?: boolean; market?: Market } = {}): Promise<RunAllResult> {
  if (opts.market) {
    return runMarket(opts.market, opts);
  }
  if (opts.force) {
    const [d, o] = await Promise.all([
      runMarket('domestic', opts).catch(e => ({
        ran: 0, skipped: 0, skippedStrategyIds: [], results: [],
        errors: [`domestic: ${e instanceof Error ? e.message : String(e)}`],
        universeRefreshed: false,
      } as RunAllResult)),
      runMarket('overseas', opts).catch(e => ({
        ran: 0, skipped: 0, skippedStrategyIds: [], results: [],
        errors: [`overseas: ${e instanceof Error ? e.message : String(e)}`],
        universeRefreshed: false,
      } as RunAllResult)),
    ]);
    return mergeRunResults(d, o);
  }
  const m = await getCurrentMarket();
  if (!m) {
    return { ran: 0, skipped: 0, skippedStrategyIds: [], results: [], errors: ['all_markets_closed'], universeRefreshed: false };
  }
  return runMarket(m, opts);
}
