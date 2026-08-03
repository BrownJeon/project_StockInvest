import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { kis } from '@/lib/exchanges/kis';
import { getMarketFromSymbol, type Market } from '@/lib/exchanges/kis-symbols';
import { getCurrentMarket, isDomesticOpen, isOverseasOpen } from '@/lib/strategy/market-hours';
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
  type BatchDecision,
  type BatchSymbolInput,
  type MarketContext,
  type MarketSummary,
  type RecentTrade,
  type SkipCategory,
} from '@/lib/strategy/ai-filter';
import { prefilterCandidate } from '@/lib/strategy/ai-prefilter';
import { buildRegimeBucket, lookupRecentSkip, getRegimePerformance } from '@/lib/strategy/ai-dedup';
import { fetchMacroIndicators } from '@/lib/strategy/macro';
import { marketSessionInfo } from '@/lib/strategy/market-hours';
import { refreshUniverse, getUniverseSymbols, getAlwaysIncludeSymbols } from '@/lib/strategy/universe';
import { checkPortfolioStability } from '@/lib/strategy/portfolio-stability';
import {
  evaluateExit,
  isLateSessionBuyBlockKST,
  EXIT_STRATEGY_ID,
  EXIT_UNIT_RATIO_MIN,
  EXIT_UNIT_RATIO_MAX,
} from '@/lib/strategy/exit-engine';
import { upsertPositionState, reconcilePositionState, loadPositionState } from '@/lib/strategy/position-state';
import type { Candle, Ticker } from '@/lib/exchanges/types';
import type { StrategyMeta } from './rules/types';
import { STRATEGY_REGISTRY } from './rules';
import { getAnalystStyle, getStyleConfig } from './style';
import { classifyMarketState, getRulesForState, ALWAYS_ACTIVE_RULES } from './market-state';
import type { AnalystStyle, StyleConfig } from './style';
import { sendAlert } from '@/lib/notify';
import { EvalFunnelRecorder } from './eval-funnel';
import type { FunnelGate } from './eval-funnel-labels';

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

/**
 * Phase AC(장마감 후 시나리오) 전용 룰 — `post-market-engine.ts`가 별도로 실행하며
 * intraday `STRATEGY_REGISTRY`에는 의도적으로 없다. `strategies` 테이블을 두 실행기가
 * 공유하다 보니 intraday 조회에도 걸리는데, 이는 코드-DB 불일치(결함)가 아니라
 * 실행기 분리에 따른 정상 현상이므로 eval_funnel에는 error가 아닌 skip으로 기록한다.
 */
const POST_MARKET_ONLY_STRATEGY_IDS = new Set(['eod-high-close-v1', 'inside-bar-v1', 'oversold-bounce-daily-v1']);


interface HeldEntry {
  qty: number;
  avgPrice?: number;
}

/**
 * 심볼별 "얼마나 깊이 갔는가" 추적기 — eval_funnel `final` 행(깔때기 SQL의 축)을 만드는 데 쓴다.
 * 같은 심볼에 후보가 여럿이면 **가장 깊이 간 후보**의 결과를 채택한다.
 */
interface SymbolOutcome {
  /** 이 심볼(의 가장 깊이 간 후보)이 도달한 stage */
  stage: number;
  /** 그 stage 에서 후보를 죽인 gate. 통과만 하고 아직 죽지 않았으면 null */
  gate: FunnelGate | null;
  rawCandidates: number;
  signalIds: number[];
}

function createOutcomeTracker() {
  const map = new Map<string, SymbolOutcome>();
  const ensure = (symbol: string): SymbolOutcome => {
    let cur = map.get(symbol);
    if (!cur) { cur = { stage: 0, gate: null, rawCandidates: 0, signalIds: [] }; map.set(symbol, cur); }
    return cur;
  };
  return {
    map,
    /** stage 까지 **통과**했음 (죽지 않음) — 더 깊은 값일 때만 갱신하고 gate 는 비운다 */
    advance(symbol: string, stage: number): void {
      const cur = ensure(symbol);
      if (stage > cur.stage) { cur.stage = stage; cur.gate = null; }
    },
    /** stage 에서 gate 에 의해 **죽었음** — 같은 stage 면 죽인 게이트를 우선 채택 */
    kill(symbol: string, stage: number, gate: FunnelGate): void {
      const cur = ensure(symbol);
      if (stage >= cur.stage) { cur.stage = stage; cur.gate = gate; }
    },
    setRaw(symbol: string, rawCandidates: number): void {
      ensure(symbol).rawCandidates = rawCandidates;
    },
    markSignal(symbol: string, signalId: number): void {
      const cur = ensure(symbol);
      cur.stage = 99; cur.gate = 'signal_created'; cur.signalIds.push(signalId);
    },
  };
}
type OutcomeTracker = ReturnType<typeof createOutcomeTracker>;

/** AI 스킵 카테고리 → eval_funnel gate ID */
function aiGateForSkipCategory(cat: SkipCategory | undefined): FunnelGate {
  switch (cat) {
    case 'ai_low_confidence':    return 'ai_low_confidence';
    case 'ai_failed':            return 'ai_failed_nonheld';
    case 'dedup_reuse':          return 'dedup_regime';
    case 'portfolio_guard':      return 'portfolio_guard_other';
    case 'market_state_neutral': return 'market_state_rule_inactive';
    case 'rule_prefilter':       return 'prefilter_bypassed_no_summary';
    case 'ai_rejected':
    default:                     return 'ai_rejected';
  }
}

/**
 * createSignal **예외 격리** 래퍼 (T-002 H2).
 *
 * 이전에는 `signals.status` ENUM 에 `pending_approval` 이 없어 STRICT 모드에서 INSERT 가
 * 하드 에러를 던졌고, 미보호 호출이라 그 예외가 **runMarket 전체를 중단**시켰다.
 * 후보 한 건의 실패가 런 전체를 죽이면 안 된다 — 실패는 eval_funnel 에 남기고 다음 후보로 계속한다.
 *
 * 절대 throw 하지 않는다.
 */
export async function createSignalGuarded(
  input: Candidate | (SignalInput & { strategyId: string }),
  rec: EvalFunnelRecorder,
  outcome?: OutcomeTracker,
): Promise<{ ok: boolean; signalId?: number; error?: string }> {
  const base = {
    symbol: input.symbol,
    side: input.side as 'buy' | 'sell',
    strategyId: input.strategyId ?? null,
  };
  try {
    const res = await createSignal(input);
    if (res.ok) {
      rec.pass('signal_created', { ...base, detail: { signalId: res.signalId } });
      outcome?.markSignal(input.symbol, res.signalId);
      return { ok: true, signalId: res.signalId };
    }
    const gate: FunnelGate =
      res.errorCode === 'duplicate_active_signal' ? 'duplicate_active_signal'
      : res.errorCode === 'symbol_blacklisted'    ? 'symbol_blacklisted'
      :                                             'signal_create_failed';
    rec.record({
      ...base,
      gate,
      verdict: gate === 'signal_create_failed' ? 'error' : 'skip',
      reason: res.errorCode ?? (res.error ? res.error.slice(0, 64) : null),
      detail: { error: res.error, dupSignalId: gate === 'duplicate_active_signal' ? res.signalId : undefined },
    });
    outcome?.kill(input.symbol, 11, gate);
    console.warn(`[signal-create] ${input.symbol} ${input.side} 생성 거부: ${res.error}`);
    return { ok: false, error: res.error };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    // ★ H2 핵심 — 여기서 예외를 삼키지 않으면 런 전체가 죽는다.
    console.error(`[signal-create] ${input.symbol} ${input.side} 생성 예외 — 런은 계속 진행: ${error}`);
    rec.error('signal_create_failed', { ...base, reason: 'exception', detail: { error } });
    outcome?.kill(input.symbol, 11, 'signal_create_failed');
    return { ok: false, error };
  }
}

async function getHeldAmounts(market: Market): Promise<Map<string, HeldEntry>> {
  try {
    const balances = await kis.getBalances();
    const map = new Map<string, HeldEntry>();
    for (const b of balances) {
      if (b.currency === 'KRW' || b.currency === 'USD') continue;
      const qty = Number(b.free) + Number(b.locked);
      if (qty <= 0) continue;
      const symbolMarket = getMarketFromSymbol(b.currency);
      if (symbolMarket !== market) continue;
      map.set(b.currency, { qty, avgPrice: b.avgPrice });
    }
    return map;
  } catch {
    return new Map();
  }
}

/**
 * cron 한 틱에서 분석 대상 종목 리스트 빌드 (시장별, 투자성향 universeSource 기반 tier 필터).
 *
 * 합산: strategy profile별 top N + 보유 종목 + always-include 핵심 시총 상위.
 * 정책 (2026-05-05): topN 5/8/5 → 15/20/15 상향 + always-include 도입.
 *   사유: 005930 같은 시총 1위 종목이 score 기반 top 5/8/5에서 밀려 누락된 사례 발견 (11% 급등 미감지).
 *   상향 + always-include로 안정 대형주 영구 포함 + 모멘텀 종목 누락 폭 축소.
 */
async function getEvalSymbols(
  market: Market,
  heldAmounts: Map<string, HeldEntry>,
  universeSource: 'volume-top' | 'kospi200' | 'kospi100' = 'volume-top',
): Promise<string[]> {
  const set = new Set<string>();
  const [trend, meanRev, breakout, alwaysInclude] = await Promise.all([
    getUniverseSymbols('trend',    30, market, universeSource),
    getUniverseSymbols('mean-rev', 40, market, universeSource),
    getUniverseSymbols('breakout', 30, market, universeSource),
    getAlwaysIncludeSymbols(market),
  ]);
  for (const s of [...trend, ...meanRev, ...breakout, ...alwaysInclude]) set.add(s);
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
  heldAvgPrice?: number;
  rawCandidateCount: number;
  error?: string;
  /** eval_funnel — 이 심볼이 collect 단계에서 도달한 가장 깊은 stage */
  outcomeStage: number;
  /** eval_funnel — 위 stage 에서 이 심볼(의 마지막 후보)을 죽인 gate. 살아서 통과했으면 null */
  outcomeGate: FunnelGate | null;
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
  heldAmounts: Map<string, HeldEntry>,
  amountKRW: number,
  style: StyleConfig,
  rec: EvalFunnelRecorder,
): Promise<CollectedContext | null> {
  let ticker: Ticker;
  try {
    ticker = await kis.getTicker(symbol);
  } catch (e) {
    rec.error('ticker_error', { symbol, detail: { error: String(e).slice(0, 300) } });
    return {
      symbol, ticker: {} as Ticker, candidates: [], summary: null, aiCandles: [],
      recentTrades: [], rawCandidateCount: 0, error: `ticker:${e}`,
      outcomeStage: 1, outcomeGate: 'ticker_error',
    };
  }

  const pool = getPool();
  const candleCache = new Map<string, Candle[]>();
  const { pickAdaptiveInterval } = await import('./adaptive-interval');
  const intervalCache = new Map<string, string>();
  // baseInterval → 종목 변동성에 따른 adaptive interval로 매핑
  const resolveInterval = async (baseInterval: string): Promise<string> => {
    if (intervalCache.has(baseInterval)) return intervalCache.get(baseInterval)!;
    const adaptive = await pickAdaptiveInterval(symbol, baseInterval);
    intervalCache.set(baseInterval, adaptive);
    return adaptive;
  };
  const candleFetchFailed = new Set<string>();
  const getCandlesFor = async (interval: string, minCandles: number): Promise<Candle[] | null> => {
    if (!candleCache.has(interval)) {
      try {
        const c = await kis.getCandles(symbol, interval, Math.max(minCandles + 10, 60));
        candleCache.set(interval, c);
      } catch (e) {
        candleFetchFailed.add(interval);
        void e;
        return null;
      }
    }
    return candleCache.get(interval) ?? null;
  };

  // 재매수 쿨다운
  // ⚠️ 관측 메모 (T-002): status IN ('executed','accepted') 는 signals.status ENUM 에 **존재하지 않는 값**이라
  //    이 쿨다운은 사실상 영구 무효 상태다. Phase 1 에서는 동작을 바꾸지 않고(고치면 매수가 줄어 소생 목표와 충돌)
  //    eval_funnel `cooldown_rebuy` 게이트 기록으로 "0건"임을 실측한 뒤 Phase 2 §4-3 통합 쿨다운에서 교정한다.
  //    (exit 쿨다운은 중복 청산 = 안전 이슈라 H3 로 이번에 교정했다.)
  const recentSellCheck = await pool.query<RowDataPacket[]>(
    `SELECT id FROM signals
     WHERE symbol = ? AND side = 'sell' AND status IN ('executed','accepted')
       AND created_at > DATE_SUB(NOW(), INTERVAL ? MINUTE)
     LIMIT 1`,
    [symbol, style.rebuyCooldownMin],
  );
  const hasRecentSell = (recentSellCheck[0] as RowDataPacket[]).length > 0;

  // 24h 내 같은 (strategy, side)로 ai_skipped 이력이 있는 (strategy, side) 집합 — 반복 후행 발화 차단
  // dedup이 regimeBucket 단위로 작동해도 5분 봉 내 ATR/RSI 미세 변동으로 hit 안 되는 케이스 보강.
  // 이력 기반 광역 차단 — 룰의 후행 본질을 시간 단위로 막는다.
  const recentSkipsRows = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT strategy_id, side FROM signals
     WHERE symbol = ? AND status = 'ai_skipped'
       AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
       AND JSON_EXTRACT(indicators, '$.ai.skipCategory') IN ('ai_rejected', 'ai_low_confidence')`,
    [symbol],
  );
  const skippedRecently = new Set<string>();
  for (const r of recentSkipsRows[0] as RowDataPacket[]) {
    skippedRecently.add(`${r.strategy_id}:${r.side}`);
  }

  // ─── 시장 상태 분류 — 30m 캔들로 지표 계산 후 활성 룰 결정 ───
  const preCandles = await getCandlesFor('30m', 30);
  const preSummary = preCandles && preCandles.length >= 20
    ? buildMarketSummary(preCandles, ticker) : null;
  const marketState = preSummary ? classifyMarketState(preSummary) : null;
  const stateRuleIds = marketState ? new Set(getRulesForState(marketState)) : null;

  // ── eval_funnel 계측: collect 행에 stage 2~5 를 압축 기록 ────────────────
  const rules = {
    active:              [] as string[],
    inactive:            [] as string[],   // market_state_rule_inactive
    candlesFetchFailed:  [] as string[],   // candles_fetch_failed
    insufficientCandles: [] as Array<{ id: string; interval: string; got: number; need: number }>,
    noFire:              [] as string[],   // rule_no_fire
    fired:               [] as string[],
  };
  const guardDrops: Record<string, number> = {
    losing_position_buy_block: 0,
    sell_not_held: 0,
    cooldown_rebuy: 0,
    skip_seal_24h: 0,
    sell_amount_below_min: 0,
  };
  // 이 심볼이 collect 안에서 도달한 가장 깊은 stage (final 행의 축)
  let outcomeStage = 2;
  let outcomeGate: FunnelGate | null = null;
  /** stage 에서 gate 에 의해 죽음 */
  const kill = (stage: number, gate: FunnelGate) => {
    if (stage >= outcomeStage) { outcomeStage = stage; outcomeGate = gate; }
  };

  if (!preSummary) {
    // 30m 캔들 20봉 미만 → 분류 불가 → fail-open(전 룰 실행). 지금까지 완전 무기록이던 지점.
    rec.error('market_state_preclassify_failed', {
      symbol,
      detail: { candleCount: preCandles?.length ?? 0, failOpen: true },
    });
  }

  if (marketState === 'neutral') {
    console.log(`[market-state] ${symbol} → neutral: 관망 (1d 룰은 계속 실행)`);
  } else if (marketState) {
    console.log(`[market-state] ${symbol} → ${marketState}: 활성 룰 [${[...(stateRuleIds ?? [])].join(', ')}]`);
  }

  const candidates: Candidate[] = [];

  for (const { id, meta } of strategies) {
    // 1d 룰 및 ALWAYS_ACTIVE 룰은 시장 상태와 무관하게 항상 실행
    if (stateRuleIds !== null && !ALWAYS_ACTIVE_RULES.has(id) && !stateRuleIds.has(id)) {
      rules.inactive.push(id);
      // 다른 활성 룰이 이 심볼에서 더 깊은 stage에 도달하면 아래 kill()이 덮어쓴다 (monotonic).
      kill(2, 'market_state_rule_inactive');
      continue;
    }
    rules.active.push(id);
    const effectiveInterval = await resolveInterval(meta.interval);
    const candles = await getCandlesFor(effectiveInterval, meta.minCandles);
    if (!candles) {
      rules.candlesFetchFailed.push(id);
      kill(3, 'candles_fetch_failed');
      continue;
    }
    if (candles.length < meta.minCandles) {
      rules.insufficientCandles.push({ id, interval: effectiveInterval, got: candles.length, need: meta.minCandles });
      kill(3, 'insufficient_candles');
      continue;
    }

    const rawSignals = meta.fn({ strategyId: id, symbol, candles, ticker, amountKRW, style });
    if (rawSignals.length === 0) rules.noFire.push(id);
    else rules.fired.push(id);
    // 룰이 실행된 시점에서 stage 4 도달 — 미발화면 여기가 사망 지점
    kill(4, 'rule_no_fire');

    // -0.3% 이하 손실 중인 보유 포지션은 추가매수 차단 (물타기 손실 누적 방지).
    // portfolio-stability.ts의 maxPositionsPerSymbol은 24h 누적 매수 횟수 제한이며,
    // 이 로직은 미실현 손실 기준의 즉시 차단으로 별개 레이어다.
    // 주식 호가 스프레드 노이즈(-0.1~0.3%) 감안해 -0.5%로 설정 (코인 -0.3%보다 완화)
    const LOSS_BLOCK_PCT = -0.5;
    for (const sig of rawSignals) {
      const gateBase = { symbol, strategyId: id, side: sig.side as 'buy' | 'sell' };
      if (sig.side === 'buy' && heldAmounts.has(symbol)) {
        const heldEntry = heldAmounts.get(symbol)!;
        if (heldEntry.avgPrice && heldEntry.avgPrice > 0) {
          const currentPrice = ticker.price ?? 0;
          const lossPct = ((currentPrice - heldEntry.avgPrice) / heldEntry.avgPrice) * 100;
          if (lossPct <= LOSS_BLOCK_PCT) {
            console.log(`[losing-position-block] ${symbol} → buy skipped (loss=${lossPct.toFixed(2)}%)`);
            guardDrops.losing_position_buy_block++;
            kill(5, 'losing_position_buy_block');
            rec.skip('losing_position_buy_block', {
              ...gateBase,
              detail: { lossPct: Number(lossPct.toFixed(2)), avgPrice: heldEntry.avgPrice, price: currentPrice },
            });
            continue;
          }
          // 손실이 LOSS_BLOCK_PCT 초과(수익 중)이면 추가매수 허용 — 아래 로직으로 계속
        } else {
          // avgPrice 없으면 경고만 — 차단하지 않음 (KIS 잔고 응답 결손 시 정상 운영 보호)
          console.warn(`[losing-position-block] ${symbol} → avgPrice unavailable, buy allowed`);
        }
      }
      if (sig.side === 'sell' && !heldAmounts.has(symbol)) {
        guardDrops.sell_not_held++;
        kill(5, 'sell_not_held');
        rec.skip('sell_not_held', { ...gateBase, detail: { strategyId: id } });
        continue;
      }
      if (sig.side === 'buy' && hasRecentSell) {
        guardDrops.cooldown_rebuy++;
        kill(5, 'cooldown_rebuy');
        rec.skip('cooldown_rebuy', { ...gateBase, detail: { cooldownMin: style.rebuyCooldownMin } });
        continue;
      }
      // 24h 광역 차단 — sell도 동일 적용 (이미 +9% 평가익 보유 중인데 5회 매도 시그널 같은 패턴 방지)
      if (skippedRecently.has(`${id}:${sig.side}`)) {
        guardDrops.skip_seal_24h++;
        kill(5, 'skip_seal_24h');
        rec.skip('skip_seal_24h', { ...gateBase, detail: { strategyId: id, side: sig.side } });
        continue;
      }

      if (sig.side === 'sell') {
        const entry = heldAmounts.get(symbol)!;
        const heldQty = entry.qty;
        const heldValue = Math.round(heldQty * (ticker.price ?? 0));
        if (heldValue < sig.amountKRW) {
          guardDrops.sell_amount_below_min++;
          kill(5, 'sell_amount_below_min');
          rec.skip('sell_amount_below_min', { ...gateBase, detail: { heldValue, wanted: sig.amountKRW } });
          continue;
        }
        candidates.push({ ...sig, strategyId: id, quantity: heldQty, amountKRW: heldValue });
      } else {
        candidates.push({ ...sig, strategyId: id });
      }
      // 가드를 통과한 후보 — stage 6 이상으로 진행
      kill(6, 'regime_gate_macro_bear');
    }
  }

  const heldEntry = heldAmounts.get(symbol);

  // collect 행 1건/심볼/런 — stage 2~5 를 JSON 1행에 압축 (T-002 §2)
  rec.record({
    gate: 'collect',
    symbol,
    verdict: candidates.length > 0 ? 'pass' : 'skip',
    reason: candidates.length > 0 ? null : outcomeGate,
    detail: {
      marketState,
      rsi14: preSummary?.rsi14 ?? null,
      rules,
      guardDrops,
      rawCandidates: candidates.length,
    },
  });

  if (candidates.length === 0) {
    return {
      symbol, ticker, candidates: [], summary: null, aiCandles: [],
      recentTrades: [], heldQty: heldEntry?.qty, heldAvgPrice: heldEntry?.avgPrice,
      rawCandidateCount: 0,
      outcomeStage, outcomeGate,
    };
  }

  const aiCandles = await getCandlesFor('30m', 30) ?? [];
  const summary = aiCandles.length > 0 ? buildMarketSummary(aiCandles, ticker) : null;
  const recentTrades = await getRecentTrades(symbol);

  return {
    symbol, ticker, candidates, summary, aiCandles, recentTrades,
    heldQty: heldEntry?.qty, heldAvgPrice: heldEntry?.avgPrice,
    rawCandidateCount: candidates.length,
    outcomeStage, outcomeGate,
  };
}

interface SkipAuditPayload {
  reasoning: string;
  category: SkipCategory;
  confidence: number;
  warnings?: string[];
  ev?: AiEvEstimate;
  regimeBucket?: string;
  prefilterReason?: string;
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
          ...(payload.prefilterReason ? { prefilterReason: payload.prefilterReason } : {}),
          ev: payload.ev,
          regimeBucket: payload.regimeBucket,
        },
      }),
      priceAtSkip,
      market,
    ],
  );
}

/**
 * 보유 포지션 통합 청산 — exit-engine으로 hard_stop / target_profit / trailing_stop / eod_loss_cut 발화.
 * AI 필터 우회 (긴급도 + 룰 명확성). 발화 시 createSignal → submitOrder 정상 경로.
 *
 * 안전:
 *  - 보유 종목만 순회 (미보유 시 sell 시그널 부적합)
 *  - reconcile 후 미보유 row 자동 정리
 *  - 동일 심볼+exit_kind에 대한 5분 쿨다운 (createSignal 중복 방지)
 */
async function runExitEngine(
  market: Market,
  heldAmounts: Map<string, HeldEntry>,
  style: StyleConfig,
  rec: EvalFunnelRecorder,
): Promise<number> {
  const heldSymbols = [...heldAmounts.keys()];
  // reconcile은 항상 실행 (미보유 row 정리)
  try {
    await reconcilePositionState(market, heldSymbols);
  } catch (e) {
    console.warn(`[exit-engine:${market}] reconcile 실패: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (heldSymbols.length === 0) return 0;

  const pool = getPool();

  // system_config 'exit_hard_stop_enabled' = false 이면 hard_stop 시그널 생성 스킵
  let hardStopEnabled = true;
  try {
    const [cfgRows] = await pool.query<(RowDataPacket & { value: string })[]>(
      "SELECT value FROM system_config WHERE `key` = 'exit_hard_stop_enabled' LIMIT 1",
    );
    if (cfgRows.length > 0) {
      try { hardStopEnabled = JSON.parse(cfgRows[0].value) !== false; } catch { /* keep true */ }
    }
  } catch { /* DB 실패 시 기본 활성 */ }

  let created = 0;

  for (const symbol of heldSymbols) {
    const entry = heldAmounts.get(symbol);
    if (!entry || entry.qty <= 0) continue;
    if (!entry.avgPrice || entry.avgPrice <= 0) {
      // avgPrice 없으면 trailing 계산 불가 → skip (KIS 잔고 응답 결손)
      rec.error('exit_avg_price_missing', { symbol, side: 'sell', detail: { qty: entry.qty } });
      continue;
    }

    let ticker: Ticker;
    try {
      ticker = await kis.getTicker(symbol);
    } catch (e) {
      console.warn(`[exit-engine] ticker 조회 실패 ${symbol}: ${e instanceof Error ? e.message : String(e)}`);
      rec.error('exit_ticker_error', { symbol, side: 'sell', detail: { error: String(e).slice(0, 300) } });
      continue;
    }
    if (!ticker.price || ticker.price <= 0) {
      rec.error('exit_price_invalid', { symbol, side: 'sell', detail: { price: ticker.price ?? null } });
      continue;
    }

    // peak 갱신 (state upsert) — peak는 GREATEST(prev, current)로 자동 보존
    try {
      await upsertPositionState(symbol, market, ticker.price, entry.avgPrice, entry.qty);
    } catch (e) {
      console.warn(`[exit-engine] state upsert 실패 ${symbol}: ${e instanceof Error ? e.message : String(e)}`);
      rec.error('exit_state_upsert_failed', { symbol, side: 'sell', detail: { error: String(e).slice(0, 300) } });
      continue;
    }

    const state = await loadPositionState(symbol, market);
    if (!state) {
      rec.error('exit_state_missing', { symbol, side: 'sell' });
      continue;
    }

    // 단위(USD/KRW) 불일치 사전 감지 — evaluateExit 내부와 동일 임계. 무기록 지점이었음.
    const unitRatio = state.entryPrice > 0 ? ticker.price / state.entryPrice : 0;
    if (unitRatio < EXIT_UNIT_RATIO_MIN || unitRatio > EXIT_UNIT_RATIO_MAX) {
      rec.error('exit_unit_mismatch', {
        symbol, side: 'sell',
        detail: { ratio: Number(unitRatio.toFixed(4)), price: ticker.price, entry: state.entryPrice },
      });
      // evaluateExit 이 동일 조건으로 null 을 반환하므로 아래에서 자연히 exit_no_fire 없이 종료
    }

    const exitSig = evaluateExit({ symbol, market, ticker, state, style });
    if (!exitSig) {
      if (unitRatio >= EXIT_UNIT_RATIO_MIN && unitRatio <= EXIT_UNIT_RATIO_MAX) {
        rec.pass('exit_no_fire', {
          symbol, side: 'sell',
          detail: { pnlPct: Number((((ticker.price - state.entryPrice) / state.entryPrice) * 100).toFixed(2)) },
        });
      }
      continue;
    }

    // hard_stop 시그널 생성 비활성화 여부 체크
    if (exitSig.exitKind === 'hard_stop' && !hardStopEnabled) {
      console.log(`[exit-engine] ${symbol} hard_stop 스킵 (exit_hard_stop_enabled=false)`);
      rec.skip('exit_hard_stop_disabled', { symbol, side: 'sell', detail: { exitKind: exitSig.exitKind } });
      continue;
    }

    // 동일 심볼+exit_kind에 대한 5분 쿨다운 — createSignal 중복 방지
    // (cron이 1분 tick이라 같은 청산 룰이 5번 연속 발화되면 중복 주문 우려)
    //
    // ⚠️ T-002 H3 — 'executed','accepted' 는 signals.status ENUM 에 **존재하지 않는 값**이라
    //    이 쿨다운은 지금까지 사실상 무효였다(중복 청산 시그널 위험 = 안전 이슈).
    //    실존 상태값으로 교정: auto_submitted / approved / approved_pending_entry / executing /
    //    pending / pending_approval.
    const [recent] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM signals
        WHERE symbol=? AND strategy_id=? AND side='sell'
          AND status IN ('auto_submitted','approved','approved_pending_entry','executing','pending','pending_approval')
          AND created_at > DATE_SUB(NOW(), INTERVAL 5 MINUTE)
          AND JSON_EXTRACT(indicators, '$.exit_kind') = ?
        LIMIT 1`,
      [symbol, EXIT_STRATEGY_ID, exitSig.exitKind],
    );
    if ((recent as RowDataPacket[]).length > 0) {
      rec.skip('exit_cooldown_5m', {
        symbol, side: 'sell',
        detail: { exitKind: exitSig.exitKind, prevSignalId: (recent as RowDataPacket[])[0].id },
      });
      continue; // 쿨다운 중
    }

    // ★ H2 — createSignal 예외가 런 전체를 죽이던 지점. 반드시 격리한다.
    const res = await createSignalGuarded(exitSig, rec);
    if (res.ok) {
      created++;
      console.log(`[exit-engine] ${symbol} ${exitSig.exitKind} 시그널 발화 (signalId=${res.signalId})`);
    } else {
      rec.error('exit_create_failed', {
        symbol, side: 'sell',
        detail: { exitKind: exitSig.exitKind, error: res.error },
      });
      console.warn(`[exit-engine] ${symbol} ${exitSig.exitKind} 시그널 실패: ${res.error}`);
    }
  }
  return created;
}

/** context에 prefilter + portfolio guard + dedup을 적용해 AI 호출 필요 후보를 추려낸다. */
async function applyFilters(
  ctx: CollectedContext,
  analystStyle: AnalystStyle,
  style: StyleConfig,
  market: Market,
  heldAmounts: Map<string, HeldEntry>,
  rec: EvalFunnelRecorder,
  outcome: OutcomeTracker,
): Promise<{ needsAi: Candidate[]; regimeBucket: string | null }> {
  const pool = getPool();
  const { symbol, candidates, summary, aiCandles, ticker } = ctx;

  /** prefilter reason → eval_funnel gate ID */
  const PREFILTER_GATE: Record<string, FunnelGate> = {
    liquidity_dead:       'prefilter_liquidity_dead',
    atr_zero:             'prefilter_atr_zero',
    rsi_extreme_counter:  'prefilter_rsi_extreme_counter',
    strong_counter_trend: 'prefilter_strong_counter_trend',
    blowoff_top:          'prefilter_blowoff_top',
  };

  // 1) pre-filter (summary 없으면 skip)
  let survived: Candidate[] = candidates;
  if (!summary) {
    // fail-open — 프리필터를 통째로 생략하고 전 후보 통과. 지금까지 무기록이던 지점.
    rec.error('prefilter_bypassed_no_summary', {
      symbol,
      detail: { candidates: candidates.length, failOpen: true },
    });
  }
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
      const [reasonKey, ...detailParts] = reason.split(':');
      const detail = detailParts.join(':').trim();
      const { formatPrefilterReason } = await import('./skip-reason-formatter');
      const key = reasonKey.trim();
      rec.skip(PREFILTER_GATE[key] ?? 'prefilter_bypassed_no_summary', {
        symbol, strategyId: cand.strategyId, side: cand.side as 'buy' | 'sell',
        reason: key, detail: { detail },
      });
      outcome.kill(symbol, 7, PREFILTER_GATE[key] ?? 'prefilter_bypassed_no_summary');
      await insertSkipAuditPool(pool, cand, symbol, ticker.price, {
        reasoning: formatPrefilterReason(key, detail, cand.side),
        category: 'rule_prefilter',
        prefilterReason: key,
        confidence: 0,
      });
    }
    if (skipped.length > 0) {
      console.log(`[prefilter] ${symbol} → ${skipped.length}/${candidates.length} skipped (${skipped.map(p => p.reason.split(':')[0]).join(',')})`);
    }
    survived = passed;
  }

  if (survived.length === 0) return { needsAi: [], regimeBucket: null };

  // 1.4) 장마감 N분 전 신규 매수 차단 (국내장만, 기본 30분 → KST 15:00~15:30 buy skip)
  // 사유: 시간외 거래 없음 → 마감 직전 매수는 익일 갭다운 위험에 무방비 노출.
  // sell은 차단하지 않음 (청산은 시간 무관 허용).
  if (market === 'domestic' && isLateSessionBuyBlockKST(new Date(), style.lateSessionBuyBlockMin)) {
    const lateBlocked: Candidate[] = [];
    const passed: Candidate[] = [];
    for (const cand of survived) {
      if (cand.side === 'buy') lateBlocked.push(cand);
      else passed.push(cand);
    }
    for (const cand of lateBlocked) {
      await insertSkipAuditPool(pool, cand, symbol, ticker.price, {
        reasoning: `[매수 차단 — 장마감 임박] KST 15:30 폐장까지 ${style.lateSessionBuyBlockMin}분 이내 신규 매수 금지 (시간외 거래 없음 → 익일 갭다운 위험 회피)`,
        category: 'rule_prefilter',
        prefilterReason: 'late_session_buy_block',
        confidence: 0,
      });
      rec.skip('late_session_buy_block', { symbol, strategyId: cand.strategyId, side: 'buy', detail: { minutesBlock: style.lateSessionBuyBlockMin } });
      outcome.kill(symbol, 7, 'late_session_buy_block');
    }
    if (lateBlocked.length > 0) {
      console.log(`[late-session-block] ${symbol} → ${lateBlocked.length} buy skipped`);
    }
    survived = passed;
    if (survived.length === 0) return { needsAi: [], regimeBucket: null };
  }

  // 1.5) portfolio stability 가드 — buy 시그널만 검사 (sell·해외는 자동 pass).
  //   stableCoreRatioMin 위반 + maxPositionsPerSymbol 한도 초과 → 거절. AI 호출 비용 절약.
  if (market === 'domestic') {
    const guarded: Candidate[] = [];
    let guardSkips = 0;
    for (const cand of survived) {
      if (cand.side !== 'buy') { guarded.push(cand); continue; }
      const decision = await checkPortfolioStability({
        symbol, side: cand.side, amountKRW: cand.amountKRW,
        market, style, heldAmounts,
      });
      if (decision.verdict === 'skip') {
        guardSkips++;
        const reasonKor = decision.reason === 'core_ratio_below_min'
          ? '코어(KOSPI 100) 비율 미달'
          : decision.reason === 'max_positions_exceeded'
            ? '24h 종목당 매수 한도 초과'
            : (decision.reason ?? '안전성 가드');
        await insertSkipAuditPool(pool, cand, symbol, ticker.price, {
          reasoning: `[매수 포트폴리오 안전 가드] ${reasonKor} — ${decision.detail ?? ''}`.trim(),
          category: 'portfolio_guard',
          confidence: 0,
        });
        const gate: FunnelGate =
          decision.reason === 'core_ratio_below_min'   ? 'portfolio_core_ratio'
          : decision.reason === 'max_positions_exceeded' ? 'portfolio_max_positions'
          :                                                 'portfolio_guard_other';
        rec.skip(gate, { symbol, strategyId: cand.strategyId, side: 'buy', detail: { detail: decision.detail } });
        outcome.kill(symbol, 8, gate);
      } else {
        guarded.push(cand);
      }
    }
    if (guardSkips > 0) {
      console.log(`[portfolio_guard] ${symbol} → ${guardSkips}/${survived.length} skipped`);
    }
    survived = guarded;
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

    );
    if (hit.hit && hit.prev) {
      dedupHits++;
      const sideKor = cand.side === 'sell' ? '매도' : '매수';
      await insertSkipAuditPool(pool, cand, symbol, ticker.price, {
        reasoning: `[${sideKor} 중복 제거] 같은 시장 상태에서 최근 같은 결정 반복 — 재평가 생략 | 이전 사유: "${hit.prev.reasoning.slice(0, 150)}"`,
        category: 'dedup_reuse',
        confidence: hit.prev.confidence,
        warnings: hit.prev.warnings,
        ev: hit.prev.ev,
        regimeBucket,
      });
      rec.skip('dedup_regime', { symbol, strategyId: cand.strategyId, side: cand.side as 'buy' | 'sell', detail: { regimeBucket, prevConfidence: hit.prev.confidence } });
      outcome.kill(symbol, 9, 'dedup_regime');
    } else {
      needsAi.push(cand);
    }
  }
  if (dedupHits > 0) {
    console.log(`[dedup] ${symbol} → ${dedupHits}/${survived.length} hits (bucket=${regimeBucket})`);
  }

  return { needsAi, regimeBucket };
}

/** 최근 3시간 거시 지수 맥락 + universe 평균 지표 + 시장 세션 phase + 거시 지수(KOSPI/SP500/USD-KRW) */
async function buildMarketContext(contexts: CollectedContext[], market: Market): Promise<MarketContext> {
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

  // 시장 세션 phase + 마감까지 남은 분
  const session = marketSessionInfo(market);

  // 거시 지표 (KOSPI / SP500 / USD-KRW) — 5분 캐시, 실패 시 null
  let macro = { kospiChangePct: null as number | null, sp500ChangePct: null as number | null, usdKrwChangePct: null as number | null };
  try { macro = await fetchMacroIndicators(); } catch { /* keep nulls */ }

  return {
    btc3hChangePct, btc3hVolRatio, avgVolumeRatio, highVolCount,
    recentExecutedBuys, recentExecutedSells,
    sessionPhase: session.phase, minutesToClose: session.minutesToClose,
    kospiChangePct: macro.kospiChangePct,
    sp500ChangePct: macro.sp500ChangePct,
    usdKrwChangePct: macro.usdKrwChangePct,
  };
}

/** 배치 AI 결과를 각 context에 적용 — createSignal 또는 ai_skipped insert. */
async function applyBatchDecisions(
  needsAiMap: Map<string, { ctx: CollectedContext; needsAi: Candidate[]; regimeBucket: string | null }>,
  batchDecisions: BatchDecision[],
  results: Map<string, EvalResult>,
  style: StyleConfig,
  analystStyle: AnalystStyle,
  rec: EvalFunnelRecorder,
  outcome: OutcomeTracker,
): Promise<void> {
  const pool = getPool();
  const { formatSkipReason } = await import('./skip-reason-formatter');
  const styleNameMap: Record<string, string> = { aggressive: '공격적', neutral: '중립적', stable: '안정적' };
  for (const d of batchDecisions) {
    const entry = needsAiMap.get(d.symbol);
    if (!entry) continue;
    const { ctx, needsAi, regimeBucket } = entry;

    if (d.selectedIndices.length === 0 || d.skipCategory === 'ai_failed') {
      const gate = aiGateForSkipCategory(d.skipCategory);
      for (const sig of needsAi) {
        await insertSkipAuditPool(pool, sig, d.symbol, ctx.ticker.price, {
          reasoning: formatSkipReason({
            category: d.skipCategory ?? 'ai_rejected',
            side: sig.side,
            confidence: d.confidence,
            rawReasoning: d.reasoning,
            minConfidence: style.minAiConfidence,
            styleName: styleNameMap[analystStyle] ?? analystStyle,
          }),
          category: d.skipCategory ?? 'ai_rejected',
          confidence: d.confidence,
          warnings: d.warnings,
          ev: d.ev,
          regimeBucket: regimeBucket ?? undefined,
        });
      }
      rec.skip(gate, { symbol: d.symbol, detail: { confidence: d.confidence, skipCategory: d.skipCategory ?? null, candidates: needsAi.length } });
      outcome.kill(d.symbol, 10, gate);
      results.set(d.symbol, {
        symbol: d.symbol,
        signalsCreated: 0,
        candidateCount: needsAi.length,
        rawCandidates: ctx.rawCandidateCount,
      });
      continue;
    }

    // 다중 승인: selectedIndices에 포함된 인덱스는 createSignal, 그 외는 ai_skipped audit
    const selectedSet = new Set(d.selectedIndices);
    let createdCount = 0;
    let firstSelectedSide: 'buy' | 'sell' | undefined;
    let firstSelectedStrategy: string | undefined;
    for (let i = 0; i < needsAi.length; i++) {
      const cand = needsAi[i];
      if (selectedSet.has(i)) {
        const pickedRank = d.selectedIndices.indexOf(i);  // 0-based EV 순위
        const enriched: Candidate = {
          ...cand,
          reasoning: [
            cand.reasoning,
            `[AI ${d.confidence}%${d.selectedIndices.length > 1 ? ` · ${pickedRank + 1}/${d.selectedIndices.length}` : ''}] ${d.reasoning}`,
            ...(d.warnings.length ? [`경고: ${d.warnings.join(' / ')}`] : []),
          ].filter(Boolean).join('\n'),
          indicators: {
            ...(cand.indicators as object ?? {}),
            ai: {
              confidence: d.confidence, warnings: d.warnings,
              selectedFrom: needsAi.length, ev: d.ev,
              regimeBucket: regimeBucket ?? undefined,
              pickedRank, picksTotal: d.selectedIndices.length,
            },
          },
        };
        const res = await createSignalGuarded(enriched, rec, outcome);
        if (res.ok) {
          createdCount++;
          if (firstSelectedSide === undefined) firstSelectedSide = cand.side;
          if (firstSelectedStrategy === undefined) firstSelectedStrategy = cand.strategyId;
        }
      } else {
        await insertSkipAuditPool(pool, cand, d.symbol, ctx.ticker.price, {
          reasoning: (await import('./skip-reason-formatter')).formatSkipReason({
            category: d.skipCategory ?? 'ai_rejected',
            side: cand.side,
            confidence: d.confidence,
            rawReasoning: d.reasoning,
            minConfidence: style.minAiConfidence,
            styleName: ({aggressive:'공격적',neutral:'중립적',stable:'안정적'} as any)[analystStyle] ?? analystStyle,
          }),
          category: d.skipCategory ?? 'ai_rejected',
          confidence: d.confidence,
          warnings: d.warnings,
          ev: d.ev,
          regimeBucket: regimeBucket ?? undefined,
        });
        outcome.kill(d.symbol, 10, aiGateForSkipCategory(d.skipCategory));
      }
    }

    results.set(d.symbol, {
      symbol: d.symbol,
      signalsCreated: createdCount,
      selectedStrategy: firstSelectedStrategy,
      candidateCount: needsAi.length,
      rawCandidates: ctx.rawCandidateCount,
      side: firstSelectedSide,
    });
  }
}

/** 배치 실패 시 보유 심볼만 per-symbol fallback. 비보유는 ai_failed 스킵. */
async function fallbackPerSymbol(
  needsAiMap: Map<string, { ctx: CollectedContext; needsAi: Candidate[]; regimeBucket: string | null }>,
  style: StyleConfig,
  analystStyle: AnalystStyle,
  heldAmounts: Map<string, HeldEntry>,
  results: Map<string, EvalResult>,
  reason: string,
  market: Market,
  rec: EvalFunnelRecorder,
  outcome: OutcomeTracker,
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

      if (aiResult.selectedIndices.length === 0) {
        const gate = aiGateForSkipCategory(aiResult.skipCategory);
        for (const sig of needsAi) {
          await insertSkipAuditPool(pool, sig, symbol, ctx.ticker.price, {
            reasoning: (await import('./skip-reason-formatter')).formatSkipReason({
            category: aiResult.skipCategory ?? 'ai_rejected',
            side: sig.side,
            confidence: aiResult.confidence,
            rawReasoning: aiResult.reasoning,
            minConfidence: style.minAiConfidence,
            styleName: ({aggressive:'공격적',neutral:'중립적',stable:'안정적'} as any)[analystStyle] ?? analystStyle,
          }),
            category: aiResult.skipCategory ?? 'ai_rejected',
            confidence: aiResult.confidence,
            warnings: aiResult.warnings,
            ev: aiResult.ev,
            regimeBucket: regimeBucket ?? undefined,
          });
        }
        rec.skip(gate, { symbol, detail: { confidence: aiResult.confidence, skipCategory: aiResult.skipCategory ?? null, candidates: needsAi.length } });
        outcome.kill(symbol, 10, gate);
        results.set(symbol, { symbol, signalsCreated: 0, candidateCount: needsAi.length, rawCandidates: ctx.rawCandidateCount });
      } else {
        const selectedSet = new Set(aiResult.selectedIndices);
        let createdCount = 0;
        let firstSide: 'buy' | 'sell' | undefined;
        let firstStrategy: string | undefined;
        for (let i = 0; i < needsAi.length; i++) {
          const cand = needsAi[i];
          if (selectedSet.has(i)) {
            const pickedRank = aiResult.selectedIndices.indexOf(i);
            const enriched: Candidate = {
              ...cand,
              reasoning: [
                cand.reasoning,
                `[AI ${aiResult.confidence}%${aiResult.selectedIndices.length > 1 ? ` · ${pickedRank + 1}/${aiResult.selectedIndices.length}` : ''}] ${aiResult.reasoning}`,
                ...(aiResult.warnings.length ? [`경고: ${aiResult.warnings.join(' / ')}`] : []),
              ].filter(Boolean).join('\n'),
              indicators: {
                ...(cand.indicators as object ?? {}),
                ai: {
                  confidence: aiResult.confidence, warnings: aiResult.warnings,
                  selectedFrom: needsAi.length, ev: aiResult.ev,
                  regimeBucket: regimeBucket ?? undefined,
                  pickedRank, picksTotal: aiResult.selectedIndices.length,
                },
              },
            };
            const res = await createSignalGuarded(enriched, rec, outcome);
            if (res.ok) {
              createdCount++;
              if (firstSide === undefined) firstSide = cand.side;
              if (firstStrategy === undefined) firstStrategy = cand.strategyId;
            }
          } else {
            await insertSkipAuditPool(pool, cand, symbol, ctx.ticker.price, {
              reasoning: (await import('./skip-reason-formatter')).formatSkipReason({
            category: aiResult.skipCategory ?? 'ai_rejected',
            side: cand.side,
            confidence: aiResult.confidence,
            rawReasoning: aiResult.reasoning,
            minConfidence: style.minAiConfidence,
            styleName: ({aggressive:'공격적',neutral:'중립적',stable:'안정적'} as any)[analystStyle] ?? analystStyle,
          }),
              category: aiResult.skipCategory ?? 'ai_rejected',
              confidence: aiResult.confidence,
              warnings: aiResult.warnings,
              ev: aiResult.ev,
              regimeBucket: regimeBucket ?? undefined,
            });
            outcome.kill(symbol, 10, aiGateForSkipCategory(aiResult.skipCategory));
          }
        }
        results.set(symbol, {
          symbol, signalsCreated: createdCount, selectedStrategy: firstStrategy,
          candidateCount: needsAi.length, rawCandidates: ctx.rawCandidateCount, side: firstSide,
        });
      }
    } else {
      skippedCount++;
      for (const sig of needsAi) {
        await insertSkipAuditPool(pool, sig, symbol, ctx.ticker.price, {
          reasoning: `[${sig.side === 'sell' ? '매도' : '매수'} AI 호출 실패] AI 응답을 받지 못해 다음 평가 주기에 재시도 — ${reason}`,
          category: 'ai_failed',
          confidence: 0,
          regimeBucket: regimeBucket ?? undefined,
        });
      }
      rec.skip('ai_failed_nonheld', { symbol, detail: { reason, candidates: needsAi.length } });
      outcome.kill(symbol, 10, 'ai_failed_nonheld');
      results.set(symbol, { symbol, signalsCreated: 0, candidateCount: needsAi.length, rawCandidates: ctx.rawCandidateCount });
    }
  }

  console.log(`[ai-batch] fallback: ${fallbackCount} held per-symbol, ${skippedCount} non-held skipped (${reason})`);
}

/** 시장별 평가 실행 (단일 시장). runAll에서 라우팅. */
async function runMarket(market: Market, opts: { force?: boolean } = {}): Promise<RunAllResult> {
  // 시장별 개장시간 가드 — 닫혀있으면 실가격이 정지된 상태라 시그널 무의미. force도 우회 불가.
  const open = market === 'domestic' ? await isDomesticOpen() : await isOverseasOpen();
  if (!open) {
    return { ran: 0, skipped: 0, skippedStrategyIds: [], results: [], errors: [`${market}_market_closed`], universeRefreshed: false };
  }
  // 장 마감은 정상 상태라 기록하지 않는다 — 장외 5분마다 빈 run 행이 쌓일 뿐이다.
  const rec = new EvalFunnelRecorder(market);
  const outcome = createOutcomeTracker();

  if (!(await isAnalystEnabled())) {
    rec.skip('analyst_disabled');
    await rec.flush();
    return { ran: 0, skipped: 0, skippedStrategyIds: [], results: [], errors: ['analyst_disabled'], universeRefreshed: false };
  }

  const pool = getPool();
  const analystStyle = await getAnalystStyle();
  const style = await getStyleConfig();

  // 현재 투자 성향이 applicable_styles에 포함된 전략만 평가 — FIND_IN_SET으로 SET 컬럼 검사
  const [rows] = await pool.query<StrategyRow[]>(
    `SELECT id, enabled, backtest_interval_h, next_backtest_at
     FROM strategies
     WHERE enabled = 1 AND FIND_IN_SET(?, applicable_styles) > 0`,
    [analystStyle],
  );

  const { refreshed: universeRefreshed } = await refreshUniverse(market, opts.force);

  const now = new Date();
  const dueStrategies: Array<ActiveStrategy & { row: StrategyRow }> = [];
  const skippedStrategyIds: string[] = [];

  for (const row of rows) {
    const meta = STRATEGY_REGISTRY[row.id];
    if (!meta) {
      if (POST_MARKET_ONLY_STRATEGY_IDS.has(row.id)) {
        rec.skip('strategy_unregistered', { strategyId: row.id, reason: 'post_market_only' });
      } else {
        // DB에 enabled인데 코드 레지스트리에 없다 = 코드-DB 불일치. 정상 skip이 아니라 결함이다.
        rec.error('strategy_unregistered', { strategyId: row.id });
      }
      skippedStrategyIds.push(row.id);
      continue;
    }
    if (!opts.force && row.next_backtest_at && row.next_backtest_at > now) {
      rec.skip('strategy_throttled', {
        strategyId: row.id,
        detail: { nextBacktestAt: row.next_backtest_at, intervalH: row.backtest_interval_h },
      });
      skippedStrategyIds.push(row.id);
      continue;
    }
    dueStrategies.push({ id: row.id, meta, row });
  }

  if (dueStrategies.length === 0) {
    rec.skip('no_due_strategies', { detail: { throttledOrUnregistered: skippedStrategyIds } });
    await rec.flush();
    return { ran: 0, skipped: skippedStrategyIds.length, skippedStrategyIds, results: [], errors: [], universeRefreshed };
  }

  const heldAmounts = await getHeldAmounts(market);

  // ─── Exit Engine — 보유 포지션 통합 청산 시그널 (AI 필터 우회) ───────────
  // 1. position_state reconcile (미보유 row 일괄 정리)
  // 2. 보유 종목별 ticker 조회 + state upsert (peak 갱신) + evaluateExit 평가
  // 3. 청산 시그널 발화 시 createSignal → submitOrder 정상 경로
  // 안전장치(DRY_RUN/KILL_SWITCH/order_limits/blacklist)는 모두 통과한다.
  const exitSignalsCreated = await runExitEngine(market, heldAmounts, style, rec);
  if (exitSignalsCreated > 0) {
    console.log(`[exit-engine:${market}] ${exitSignalsCreated} 청산 시그널 발화`);
  }

  const activeStrategies: ActiveStrategy[] = dueStrategies.map(s => ({ id: s.id, meta: s.meta }));
  // 해외 시장은 universeSource 'volume-top' 고정 (KOSPI 분류 미적용). 국내만 style 분기.
  const universeSrc = market === 'domestic' ? 'volume-top' : 'volume-top'; // 단일성향: 기본값 고정
  const symbols = await getEvalSymbols(market, heldAmounts, universeSrc);
  // 수수료(왕복 0.43% 한국 주식 — 단방향 0.215%) + micro 변동 buffer = 0.5%
  // effectiveMax 그대로 쓰면 micro 초과로 order_limit 차단 빈발. 0.995 곱으로 사전 차감.
  const FEE_BUFFER_PCT = 0.005;
  const rawMax = await getEffectiveOrderMax('kis', market);
  // Phase 0 fail-safe: rawMax 0 = 한도 미설정(DB 키 부재) 또는 포트폴리오 평가액 조회 실패.
  // 이전에는 Infinity → ORDER_MAX_KRW env 폴백(최소 10만원)으로 매수를 계속 발화했다(fail-open).
  // 이제는 신규 매수 후보를 전면 스킵한다. 매도·청산(exit-engine, sell 후보)은 그대로 진행.
  const orderLimitConfigured = Number.isFinite(rawMax) && rawMax > 0;
  const defaultAmountKRW = orderLimitConfigured ? Math.floor(rawMax * (1 - FEE_BUFFER_PCT)) : 0;

  const errors: string[] = [];
  if (!orderLimitConfigured) {
    console.error(
      `[strategy-eval:${market}] 주문 한도 미설정(effectiveOrderMax=0) — 신규 매수 후보 전면 스킵. ` +
      `설정 > 안전장치에서 safety_order_max_pct 를 설정하거나 포트폴리오 조회 상태를 확인하라. (매도·청산은 계속 진행)`,
    );
    errors.push(`${market}_order_limit_unconfigured`);
  }
  const results = new Map<string, EvalResult>();

  // ─── Regime Gate — 거시 지수 하드 게이트 ──────────────────────────────────
  // KOSPI 또는 S&P500 전일 대비 -1.5% 이하 하락 시 신규 매수 전면 차단.
  // 주식은 코인(-2%)보다 낮은 임계(-1.5%)로 더 민감하게 반응 (변동성이 작음).
  // 보유 종목 손절·매도는 계속 진행 (exit-engine은 이미 완료된 상태).
  // macro API 실패 시 게이트 미발동 — 가용성 우선.
  let regimeGateBlocked = false;
  try {
    const macro = await fetchMacroIndicators();
    const bearConditions = [
      macro.kospiChangePct != null && macro.kospiChangePct <= -1.5,
      macro.sp500ChangePct != null && macro.sp500ChangePct <= -1.5,
    ].filter(Boolean).length;

    // KOSPI와 S&P500 모두 -1.5% 이하일 때만 차단 (OR은 S&P500 단독 야간 급락에 KOSPI 정상일 때도 발동하는 오발동 위험)
    if (bearConditions >= 2) {
      const kospiStr = macro.kospiChangePct != null ? `${macro.kospiChangePct.toFixed(2)}%` : 'N/A';
      const sp500Str = macro.sp500ChangePct != null ? `${macro.sp500ChangePct.toFixed(2)}%` : 'N/A';
      console.log(`[regime-gate] BLOCKED: kospi=${kospiStr} sp500=${sp500Str} — 신규 매수 차단`);
      sendAlert(
        'warning',
        '거시 지수 하락 — 신규 매수 차단',
        `KOSPI: ${kospiStr} / S&P500: ${sp500Str}\n전일 대비 -1.5% 이하 하락 감지. 보유 종목 매도·손절은 계속 진행.`,
      );
      regimeGateBlocked = true;
    }
  } catch (e) {
    console.warn(`[regime-gate] macro 조회 실패 — 게이트 미발동 (매수 허용): ${e instanceof Error ? e.message : String(e)}`);
  }

  // 1단계: 모든 심볼의 후보 수집 (AI 호출 없음)
  const contexts: CollectedContext[] = [];
  for (const symbol of symbols) {
    const ctx = await collectCandidates(symbol, activeStrategies, heldAmounts, defaultAmountKRW, style, rec);
    if (!ctx) continue;
    // collect 단계의 지역 추적 결과를 런 전체 tracker로 승계 (final 행의 축)
    if (ctx.outcomeGate) outcome.kill(symbol, ctx.outcomeStage, ctx.outcomeGate);
    else outcome.advance(symbol, ctx.outcomeStage);
    outcome.setRaw(symbol, ctx.rawCandidateCount);
    if (ctx.error) {
      errors.push(`${symbol}: ${ctx.error}`);
      results.set(symbol, { symbol, signalsCreated: 0, error: ctx.error });
      // 운영 진단용 — errors 카운트만 표시되면 어떤 종목·어떤 단계에서 실패했는지 추적 불가.
      // ctx.error 포맷은 `ticker:Error: ...`. 동일 종목이 반복 실패하면 패턴 분석 가능.
      console.warn(`[strategy-eval:ctx-error] symbol=${symbol} reason=${ctx.error}`);
      continue;
    }
    // candidate 0건이라도 보유 종목이면 시나리오 청산(트레일링/시간만료/손절)을 위해 contexts에 포함.
    // 미보유 + candidate 0건만 즉시 종료. (TradingInvest fix와 동일 — 매도 시그널 누락 방지)
    const isHeld = !!ctx.heldQty && ctx.heldQty > 0;
    if (ctx.candidates.length === 0 && !isHeld) {
      results.set(symbol, { symbol, signalsCreated: 0, rawCandidates: 0 });
      continue;
    }
    contexts.push(ctx);
  }

  // 2단계: 각 context에 prefilter + dedup 적용, AI 필요한 후보만 수집
  // regime gate 발동 또는 주문 한도 미설정(fail-safe) 시 buy 후보를 사전 제거 (sell·보유 종목 매도는 유지)
  const buyBlocked = regimeGateBlocked || !orderLimitConfigured;
  const needsAiMap = new Map<string, { ctx: CollectedContext; needsAi: Candidate[]; regimeBucket: string | null }>();
  for (const ctx of contexts) {
    if (buyBlocked && ctx.candidates.some(c => c.side === 'buy')) {
      // buy 후보만 제거 — sell은 통과
      ctx.candidates = ctx.candidates.filter(c => c.side !== 'buy');
      if (ctx.candidates.length === 0 && !(ctx.heldQty && ctx.heldQty > 0)) {
        // collectCandidates가 남긴 stage 6 placeholder(regime_gate_macro_bear)를 그대로 물려받으면
        // 실제 원인이 order_limit_unconfigured(Phase 0 fail-safe)일 때 오분류된다 — 실제 원인으로 교정.
        const gate: FunnelGate = regimeGateBlocked ? 'regime_gate_macro_bear' : 'order_limit_unconfigured';
        rec.skip(gate, { symbol: ctx.symbol, side: 'buy' });
        outcome.kill(ctx.symbol, 6, gate);
        continue;
      }
    }
    const { needsAi, regimeBucket } = await applyFilters(ctx, analystStyle, style, market, heldAmounts, rec, outcome);
    if (needsAi.length === 0) {
      results.set(ctx.symbol, { symbol: ctx.symbol, signalsCreated: 0, candidateCount: 0, rawCandidates: ctx.rawCandidateCount });
      continue;
    }
    needsAiMap.set(ctx.symbol, { ctx, needsAi, regimeBucket });
  }

  // 3단계: 남은 심볼들을 배치 AI 호출로 일괄 처리
  if (needsAiMap.size > 0) {
    const batchInputs: BatchSymbolInput[] = [];
    for (const [symbol, entry] of needsAiMap) {
      if (!entry.ctx.summary) {
        // summary 없으면 배치 입력 불가 — 지금까지 성공 경로에서 후보가 무기록으로 증발하던 지점 (T-002 ai_input_no_summary).
        rec.error('ai_input_no_summary', { symbol, detail: { candidates: entry.needsAi.length } });
        outcome.kill(symbol, 10, 'ai_input_no_summary');
        results.set(symbol, {
          symbol, signalsCreated: 0,
          candidateCount: entry.needsAi.length, rawCandidates: entry.ctx.rawCandidateCount,
        });
        continue;
      }
      // regime 누적 성과 조회 (5건 미만이면 null — 프롬프트 미주입)
      const regimeStats = entry.regimeBucket ? await getRegimePerformance(entry.regimeBucket, 30) : null;
      batchInputs.push({
        symbol: entry.ctx.symbol,
        candidates: entry.needsAi,
        summary: entry.ctx.summary,
        recentTrades: entry.ctx.recentTrades,
        heldQty: entry.ctx.heldQty,
        heldAvgPrice: entry.ctx.heldAvgPrice,
        regimeStats,
      });
    }

    if (batchInputs.length > 0) {
      const marketContext = await buildMarketContext(contexts, market);
      const batchResult = await aiSelectSignalBatch(batchInputs, style, analystStyle, marketContext, market);

      if (batchResult.error || batchResult.decisions.length === 0) {
        if (batchResult.error) {
          rec.error('ai_batch_failed', { detail: { error: batchResult.error, batchSize: batchInputs.length } });
        }
        await fallbackPerSymbol(needsAiMap, style, analystStyle, heldAmounts, results, batchResult.error ?? 'empty decisions', market, rec, outcome);
      } else {
        await applyBatchDecisions(needsAiMap, batchResult.decisions, results, style, analystStyle, rec, outcome);
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

  // 종목별 final 행 — 깔때기의 축. "이 종목이 몇 단계까지 갔고 무엇에 죽었나"를 1행으로 압축한다.
  // 개별 게이트 skip 행과 별도로 남겨야 단계별 감쇠율을 단일 쿼리로 뽑을 수 있다.
  for (const [symbol, o] of outcome.map) {
    rec.record({
      symbol,
      gate: 'final',
      stage: o.stage,
      verdict: o.gate === 'signal_created' ? 'pass' : 'skip',
      reason: o.gate,
      detail: { rawCandidates: o.rawCandidates, signalIds: o.signalIds },
    });
  }
  rec.record({
    gate: 'run',
    verdict: 'pass',
    detail: {
      symbols: symbols.length,
      strategies: activeStrategies.length,
      skippedStrategyIds,
      exitSignalsCreated,
      buyBlocked,
      signalsCreated: totalApproved,
      errors: errors.length,
    },
  });
  await rec.flush();

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
 *  - opts.force: 양 시장 시도하지만 닫혀있는 시장은 runMarket 단계에서 거부.
 *  - opts.market: 특정 시장 시도하지만 닫혀있으면 거부.
 *  - **runMarket 자체에 isDomesticOpen/isOverseasOpen 가드 내장** — 어떤 진입점이든 시장 폐장 시 신호 발화 차단.
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
