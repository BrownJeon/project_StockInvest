import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { kis, getBalancesDetailed } from '@/lib/exchanges/kis';
import { getMarketFromSymbol, type Market } from '@/lib/exchanges/kis-symbols';
import { getCurrentMarket, isDomesticOpen, isOverseasOpen } from '@/lib/strategy/market-hours';
import { createSignal, type CreateSignalErrorCode } from '@/lib/signals/service';
import { getEngineSwitches } from '@/lib/signals/router';
import type { AutopilotMode, SignalInput } from '@/lib/signals/router';
import { getEffectiveOrderMax } from '@/lib/safety/order-limits';
// ⚠️ D4 — 장중 AI 완전 제거 (T-003 §1). `ai-filter` 에서 가져오는 것은 **순수 지표 계산기**
//    `buildMarketSummary` 와 그 타입뿐이다. AI 호출 함수(aiSelectSignal·aiSelectSignalBatch)와
//    `claude` CLI spawn 경로는 이 파일에서 완전히 사라졌다.
//    (ai-filter.ts 자체를 순수 모듈과 AI 모듈로 쪼개는 정리는 별도 backlog)
import {
  buildMarketSummary,
  type MarketSummary,
} from '@/lib/strategy/ai-filter';
import { prefilterCandidate } from '@/lib/strategy/ai-prefilter';
import {
  COOLDOWN_TTL_MIN,
  type CooldownSet,
  loadActiveCooldowns,
  setCooldown,
} from '@/lib/strategy/cooldowns';
import { fetchMacroIndicators } from '@/lib/strategy/macro';
import { refreshUniverse, getUniverseSymbols, getAlwaysIncludeSymbols } from '@/lib/strategy/universe';
import { checkPortfolioStability } from '@/lib/strategy/portfolio-stability';
import {
  evaluateExit,
  isLateSessionBuyBlockKST,
  EXIT_UNIT_RATIO_MIN,
  EXIT_UNIT_RATIO_MAX,
} from '@/lib/strategy/exit-engine';
import { upsertPositionState, reconcilePositionState, loadPositionState } from '@/lib/strategy/position-state';
import {
  readExitEngineSwitch,
  describeExitEngineSwitch,
  EXIT_ENGINE_ENABLED_KEY,
  type ExitSwitchSource,
} from '@/lib/strategy/exit-switch';
import type { Candle, Ticker } from '@/lib/exchanges/types';
import type { StrategyMeta } from './rules/types';
import { STRATEGY_REGISTRY } from './rules';
import { getStyleConfig, roundTripCostPct } from './style';
// D1 핵심 — market-state 는 **게이트가 아니라 라벨**이다. getRulesForState / STATE_RULES 는
// 삭제됐다(활성창 ∩ 발화창 = ∅ 데드락이 stage 4 에서 후보의 95% 를 죽이던 원인).
import { classifyMarketState, type MarketStateCategory } from './market-state';
import type { StyleConfig } from './style';
import { sendAlert } from '@/lib/notify';
import { sendAlertThrottled } from '@/lib/notify/throttle';
import { EvalFunnelRecorder } from './eval-funnel';
import type { FunnelGate, FunnelVerdict } from './eval-funnel-labels';
import { openSellProposalPreview, type SellProposalPreviewRun } from './sell-proposal-preview';

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
 * exit-engine 한 틱의 결과. 예전엔 생성 건수(number)만 돌려줬는데, T-015 이후로는
 * **"자동 청산이 켜져 있었는가 / 몇 건이 꺼져 있어서 막혔는가"** 가 생성 건수만큼 중요하다.
 * `created=0` 이 "조건 미충족"인지 "꺼져 있어서 안 함"인지 구분되지 않으면 관측이 거짓말을 한다.
 */
interface ExitEngineRunResult {
  /** 실제 생성된 청산 시그널 수 */
  created: number;
  /** 이번 틱에 자동 청산이 활성이었는가 (마스터 스위치) */
  enabled: boolean;
  /** 발화 조건은 충족했으나 마스터 OFF 로 **차단된** 청산 수 */
  blocked: number;
  /** 스위치 판독 출처 — config / absent / unparsable / db_error */
  switchSource: ExitSwitchSource;
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

/**
 * 장중 룰의 **단일 시간축** (T-003 §2).
 *
 * 구조: 게이트는 raw 30m, 룰은 adaptive 1h 승격, AI 프롬프트는 30m 표기 — 3중 축 불일치였다.
 * `rsi-oversold` 의 유일한 발화 경로가 이 불일치(23/90 종목만 1h 승격)였다는 사실 자체가
 * 위험의 증명이다. 레짐에 따라 룰의 의미가 바뀌면 백테스트가 불가능하고, 백테스트가
 * 불가능한 룰은 운용할 수 없다.
 *
 * 그래서 장중은 1h 하나로 고정하고 `adaptive-interval` 은 엔진 경로에서 분리한다
 * (모듈 자체는 universe 스코어링 입력으로 보존).
 * market-state 라벨 · 룰 지표 · 승인 카드가 **전부 이 축의 같은 summary 객체**에서 나온다.
 */
const INTRADAY_INTERVAL = '1h';

/** 룰이 선언한 interval 을 엔진 실행 축으로 정규화한다. 1d 룰만 1d, 나머지는 전부 1h. */
export function resolveEngineInterval(declared: string): string {
  return declared === '1d' ? '1d' : INTRADAY_INTERVAL;
}

/**
 * `createSignalGuarded` 의 반환 계약.
 *
 * 🔴 T-020 라운드 2 — `recordedVerdict` 가 핵심이다. **이 함수는 모든 결과(성공·정책 스킵·
 * 실패·예외)를 이미 `eval_funnel` 에 기록한다.** 그런데 호출부가 그 사실을 알 방법이 없어서
 * exit-engine 루프는 `!ok` 이기만 하면 `exit_create_failed`(verdict=`error`)를 **한 번 더**
 * 썼다. 같은 사건이 두 행이 되고, 그중 하나가 정기 리포트의 "⚠ 이상" 절에 "청산 시그널
 * 생성 실패"로 올라간다 — 1주 미만이라 정책대로 스킵한 정상 상황까지.
 *
 * 그러면 운영자는 그 라벨이 대체로 무해하다는 것을 학습하고 **무시하기 시작한다.** 그런데
 * 같은 라벨에 진짜 청산 실패(DB 장애·예외)도 찍힌다 — 가짜가 진짜를 묻는다. `order-sync` 가
 * 알림 키를 나눠 "한쪽이 다른 쪽을 억누르지 않게" 한 원칙(T-018 H-4(B))이 이 지점만 빠져
 * 있었다. 호출부가 **이미 기록된 판정의 성격**을 볼 수 있게 해서 일반적으로 막는다.
 */
export interface GuardedSignalResult {
  ok: boolean;
  signalId?: number;
  error?: string;
  /** `createSignal` 이 준 기계 판독 코드. 예외 경로에서는 undefined */
  errorCode?: CreateSignalErrorCode;
  /** 이 함수가 `eval_funnel` 에 **이미 기록한** 게이트 */
  recordedGate?: FunnelGate;
  /**
   * 그 기록의 verdict. 호출부는 이 값 하나로 판단한다 —
   * `'skip'` = 정책 판단(정상)이므로 **추가 기록 금지**,
   * `'error'` = 진짜 실패이므로 자기 트랙(예: exit)의 게이트로 한 번 더 남겨도 된다.
   *
   * 게이트 이름을 나열해 분기하지 **않는** 이유: 새 게이트가 추가될 때마다 호출부를 같이
   * 고쳐야 하는 구조가 되면 이 결함이 그대로 재발한다. verdict 는 그 판단을 이미 담고 있다.
   */
  recordedVerdict?: FunnelVerdict;
}

/**
 * createSignal **예외 격리** 래퍼 (T-002 H2).
 *
 * 이전에는 `signals.status` ENUM 에 `pending_approval` 이 없어 STRICT 모드에서 INSERT 가
 * 하드 에러를 던졌고, 미보호 호출이라 그 예외가 **runMarket 전체를 중단**시켰다.
 * 후보 한 건의 실패가 런 전체를 죽이면 안 된다 — 실패는 eval_funnel 에 남기고 다음 후보로 계속한다.
 *
 * **기록 책임은 전적으로 이 함수에 있다** — 호출부는 결과를 다시 기록하지 않는다
 * (진입 경로가 이미 그 패턴이다). 예외적으로 자기 트랙 게이트를 덧붙여야 한다면
 * {@link GuardedSignalResult.recordedVerdict} 를 보고 판단하라.
 *
 * 절대 throw 하지 않는다.
 */
export async function createSignalGuarded(
  input: Candidate | (SignalInput & { strategyId: string }),
  rec: EvalFunnelRecorder,
  outcome?: OutcomeTracker,
): Promise<GuardedSignalResult> {
  const base = {
    symbol: input.symbol,
    side: input.side as 'buy' | 'sell',
    strategyId: input.strategyId ?? null,
  };
  try {
    // T-072 F-16 — 엔진은 같은 후보를 매 틱 재평가한다. 검증 관문에 막힌 매수는 진입 쿨다운을 **원자 선점**한 실행만
    // 감사 행·가상 체결을 남기고, 그 선점이 곧 진입 쿨다운(120분)이 된다 — 막힌 매수가 틱마다 재발화해 중복으로 쌓이지 않는다.
    // (매도·청산 입력에는 영향 없다 — 관문은 매수에만 걸리고 선점은 관문에 막혔을 때만 일어난다.)
    const res = await createSignal(input, undefined, { origin: 'engine', claimEntryCooldown: true });
    if (res.ok) {
      rec.pass('signal_created', { ...base, detail: { signalId: res.signalId } });
      outcome?.markSignal(input.symbol, res.signalId);
      return { ok: true, signalId: res.signalId, recordedGate: 'signal_created', recordedVerdict: 'pass' };
    }
    const gate: FunnelGate =
      res.errorCode === 'duplicate_active_signal' ? 'duplicate_active_signal'
      : res.errorCode === 'symbol_blacklisted'    ? 'symbol_blacklisted'
      // T-020 — 1주 미만 스킵은 **실패가 아니라 정책 스킵**이다. `signal_create_failed`
      // 로 뭉개면 verdict 가 'error' 가 되어 "엔진이 고장났다"로 읽힌다.
      : res.errorCode === 'quantity_below_min'    ? 'quantity_below_min'
      // T-058 — 실시간 현금 부족으로 시그널을 만들지 않은 것도 **정책 건너뜀**이다. 엔진 고장(error)으로 집계하지 않는다.
      : res.errorCode === 'insufficient_cash'     ? 'insufficient_cash'
      // T-072 — 검증 전 전략의 매수 차단은 정책 건너뜀(skip). 조회 실패로 막은 것은 인프라 이상이라 error 로 따로 센다.
      : res.errorCode === 'validation_gate'       ? 'validation_gate'
      : res.errorCode === 'validation_lookup_error' ? 'validation_lookup_error'
      :                                             'signal_create_failed';
    const verdict: FunnelVerdict = gate === 'signal_create_failed' || gate === 'validation_lookup_error' ? 'error' : 'skip';
    const v = res.validation;
    rec.record({
      ...base,
      gate,
      verdict,
      // T-072 — reason 은 관문 사유(unvalidated|unregistered|null_strategy|invalid_status|lookup_error)
      reason: v ? v.reason : (res.errorCode ?? (res.error ? res.error.slice(0, 64) : null)),
      detail: v
        ? {
          strategyId: v.strategyId, status: v.status, signalId: v.auditSignalId, paperFillId: v.paperFillId,
          recorded: v.recorded, claim: v.claim,
        }
        : { error: res.error, dupSignalId: gate === 'duplicate_active_signal' ? res.signalId : undefined },
    });
    outcome?.kill(input.symbol, 11, gate);
    // T-058 — 현금 부족 건너뜀은 룰이 매 틱 재발화할 때마다 생긴다. 경고는 게이트가 (시장·심볼·방향) 1시간 1회로 이미 남긴다.
    // T-072 — 검증 관문 건너뜀은 지금 모든 매수에 해당하는 예정된 결과라 경고하지 않는다(funnel 에 남는다). 조회 실패는 경고한다.
    if (res.errorCode !== 'insufficient_cash' && res.errorCode !== 'validation_gate') {
      console.warn(`[signal-create] ${input.symbol} ${input.side} 생성 거부: ${res.error}`);
    }
    return { ok: false, error: res.error, errorCode: res.errorCode, recordedGate: gate, recordedVerdict: verdict };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    // ★ H2 핵심 — 여기서 예외를 삼키지 않으면 런 전체가 죽는다.
    console.error(`[signal-create] ${input.symbol} ${input.side} 생성 예외 — 런은 계속 진행: ${error}`);
    rec.error('signal_create_failed', { ...base, reason: 'exception', detail: { error } });
    outcome?.kill(input.symbol, 11, 'signal_create_failed');
    return { ok: false, error, recordedGate: 'signal_create_failed', recordedVerdict: 'error' };
  }
}

/**
 * 보유 조회 결과 — **"보유 없음"과 "모름"을 타입으로 강제 구분한다.**
 *
 * 예전에는 조회 실패도 빈 `Map` 을 돌려줬다. 호출부는 그 둘을 구분할 방법이 없었고,
 * 결과적으로 *조회 실패* 가 *보유 없음* 으로 읽혀 다음이 조용히 벌어졌다:
 *
 *  1. `runExitEngine` 이 손절·트레일링 신호를 **한 건도 만들지 않는다** (보호할 게 없다고 판단).
 *  2. 매도 신호가 `!heldAmounts.has(symbol)` 로 **거부**된다 (`sell_not_held`).
 *  3. 🔴 가장 나쁜 것 — `reconcilePositionState(market, [])` 가
 *     `DELETE FROM position_state WHERE market=?` 로 그 시장의 **트레일링 peak 상태를 전부
 *     지운다**. 즉 잔고 조회가 한 번 실패하면 고점 추적이 초기화돼, 복구된 뒤에도 트레일링
 *     손절이 잘못된 기준으로 계산된다.
 *
 * 셋 다 "포지션에서 빠져나가는 경로"를 막는 방향이라 fail-open 이다. 유니온 타입으로 바꿔
 * 호출부가 `known` 을 검사하지 않으면 컴파일이 안 되게 한다.
 */
export type HeldAmountsResult =
  | { known: true;  amounts: Map<string, HeldEntry> }
  | { known: false; reason: string };

/**
 * 이 시장의 보유 수량 맵.
 *
 * **`getBalancesDetailed()` 를 쓰는 이유**: `kis.getBalances()` 는 T-012 이후 한 시장이라도
 * 실패하면 던진다. 그 계약을 여기에 그대로 적용하면 *해외* 조회 실패가 *국내* 보유까지
 * 지우는 회귀가 된다 — 이 함수는 자기 시장 하나만 알면 되므로 시장별 결과를 직접 본다.
 *
 * 자기 시장이 실패하면 `{ known: false }` 를 돌려준다. **빈 맵을 돌려주지 않는다.**
 */
async function getHeldAmounts(market: Market): Promise<HeldAmountsResult> {
  try {
    const r = await getBalancesDetailed();
    const mine = r.failed.find(f => f.market === market);
    if (mine) return { known: false, reason: mine.error };
    /**
     * 이 시장이 `failed` 에도 `ok` 에도 없다 = 조회를 **시도조차 하지 않았다**
     * (`KIS_OVERSEAS_ENABLED=false` 이면 overseas 는 task 에서 빠진다).
     * 이때도 "보유 없음"이 아니라 "모름"이다 — 시도하지 않은 것을 0으로 읽으면 안 된다.
     */
    if (!r.ok.includes(market)) {
      return { known: false, reason: `${market} 잔고를 조회하지 않았음 (시장 비활성화 설정 확인)` };
    }
    const map = new Map<string, HeldEntry>();
    for (const b of r.balances) {
      if (b.currency === 'KRW' || b.currency === 'USD') continue;
      const qty = Number(b.free) + Number(b.locked);
      if (qty <= 0) continue;
      if (getMarketFromSymbol(b.currency) !== market) continue;
      map.set(b.currency, { qty, avgPrice: b.avgPrice });
    }
    return { known: true, amounts: map };
  } catch (e) {
    return { known: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 시장별 "모름" 이 언제부터 계속되고 있는지. 성공하면 지운다.
 *
 * 한 번의 레이트리밋 블립(실측상 수천 건 발생)마다 critical 을 쏘면 경보 피로로 진짜 신호를
 * 놓친다. 반대로 계속 warning 이면 **몇 시간째 청산이 멈춰 있는 상태**가 묻힌다.
 * → 첫 발생은 warning(30분 스로틀), 같은 시장이 연속으로 `HELD_UNKNOWN_ESCALATE_MS` 이상
 *   모름 상태면 critical 로 승격한다.
 */
const heldUnknownSince = new Map<Market, number>();
const HELD_UNKNOWN_ESCALATE_MS = 30 * 60 * 1000;

/** 테스트/진단용 — 승격 타이머 초기화. */
export function resetHeldUnknownState(): void {
  heldUnknownSince.clear();
}

/**
 * 보유 미확인 상태를 **소리나게** 만든다 (T-007 원칙 — 조용한 실패 금지).
 * 로그는 매번, 텔레그램은 스로틀. 지속되면 critical 로 승격.
 */
function notifyHeldAmountsUnknown(market: Market, error: string, nowMs = Date.now()): void {
  const since = heldUnknownSince.get(market) ?? nowMs;
  if (!heldUnknownSince.has(market)) heldUnknownSince.set(market, nowMs);
  const blindMs = nowMs - since;

  console.error(
    `[engine] ${market} 잔고 조회 실패 — 보유 종목을 알 수 없어 이번 틱의 청산 평가·매도 승인·`
    + `position_state 정리를 모두 건너뛴다 (${Math.round(blindMs / 60_000)}분째): ${error}`,
  );

  const escalated = blindMs >= HELD_UNKNOWN_ESCALATE_MS;
  sendAlertThrottled(
    escalated ? `engine:held_unknown_critical:${market}` : `engine:held_unknown:${market}`,
    escalated ? 'critical' : 'warning',
    escalated
      ? `🚨 ${market} 보유 종목을 ${Math.round(blindMs / 60_000)}분째 확인하지 못했습니다`
      : `${market} 잔고 조회 실패 — 청산 평가 생략`,
    `보유 종목을 확인할 수 없어 손절·익절 신호가 만들어지지 않고 매도 신호도 거부됩니다.\n`
    + `보유 목록을 모르는 상태에서 position_state(트레일링 고점)를 정리하면 고점이 지워지므로 `
    + `그 정리도 건너뜁니다.\n`
    + `사유: ${error}\n`
    + '반복되면 KIS 레이트리밋(EGW00201)·토큰 상태를 확인하세요.',
    escalated ? 60 * 60 * 1000 : undefined,
  );
}

/** 보유 조회가 성공했을 때 — 승격 타이머를 지우고, 승격 상태였다면 회복을 알린다. */
function noteHeldAmountsKnown(market: Market): void {
  const since = heldUnknownSince.get(market);
  if (since == null) return;
  heldUnknownSince.delete(market);
  const blindMin = Math.round((Date.now() - since) / 60_000);
  if (Date.now() - since >= HELD_UNKNOWN_ESCALATE_MS) {
    sendAlert(
      'info',
      `✅ ${market} 보유 종목 조회 정상화`,
      `${blindMin}분간의 미확인 상태가 해소됐습니다. 청산 평가가 재개됩니다.`,
    );
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
  /** ② 에서 산출한 **1h 단일 축** summary. 룰 지표·market-state 라벨·프리필터가 전부 이걸 쓴다. */
  summary: MarketSummary | null;
  /** summary 를 만든 1h 캔들 (프리필터 유동성 판정에 재사용) */
  summaryCandles: Candle[];
  /** D1 — 게이트가 아니라 **라벨**. 승인 카드·indicators·eval_funnel 에 기록만 한다. */
  marketState: MarketStateCategory | null;
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
 * ② 룰 발화 + ③ 억제 — 단일 종목의 후보 수집 (T-003 §1).
 *
 * ② (fail-open 성격): 티커·캔들 확보 → 결정론 룰 조건. 캔들 실패는 **해당 룰만** skip + error
 *    기록이고 런은 계속된다.
 * ③ (fail-open): 포지션 가드 · 통합 쿨다운 · 매도 수량 정합. 조회 실패는 통과 + error 기록 —
 *    스팸의 최종 방어선은 ④ 의 `duplicate_active_signal` 과 승인 절차다.
 *
 * **AI 호출 없음** (D4). **market-state 게이팅 없음** (D1 — 라벨만 부착).
 */
async function collectCandidates(
  symbol: string,
  strategies: ActiveStrategy[],
  heldAmounts: Map<string, HeldEntry>,
  amountKRW: number,
  style: StyleConfig,
  rec: EvalFunnelRecorder,
  cooldowns: CooldownSet,
): Promise<CollectedContext | null> {
  let ticker: Ticker;
  try {
    ticker = await kis.getTicker(symbol);
  } catch (e) {
    rec.error('ticker_error', { symbol, detail: { error: String(e).slice(0, 300) } });
    return {
      symbol, ticker: {} as Ticker, candidates: [], summary: null, summaryCandles: [],
      marketState: null, rawCandidateCount: 0, error: `ticker:${e}`,
      outcomeStage: 1, outcomeGate: 'ticker_error',
    };
  }

  const candleCache = new Map<string, Candle[]>();
  const getCandlesFor = async (interval: string, minCandles: number): Promise<Candle[] | null> => {
    if (!candleCache.has(interval)) {
      try {
        const c = await kis.getCandles(symbol, interval, Math.max(minCandles + 10, 60));
        candleCache.set(interval, c);
      } catch (e) {
        void e;
        return null;
      }
    }
    return candleCache.get(interval) ?? null;
  };

  // ─── ② 단일 축(1h) summary — 룰 지표·market-state 라벨·프리필터의 **공통 원천** ───
  const summaryCandles = await getCandlesFor(INTRADAY_INTERVAL, 30) ?? [];
  const summary = summaryCandles.length >= 20 ? buildMarketSummary(summaryCandles, ticker) : null;
  // D1 — 분류는 유지하되 **게이트가 아니라 라벨**. 분류 불가면 라벨 null 일 뿐 아무것도 막지 않는다
  // (그래서 `market_state_preclassify_failed` fail-open 분기 자체가 사라졌다).
  const marketState = summary ? classifyMarketState(summary) : null;

  // ── eval_funnel 계측: collect 행에 stage 2~5 를 압축 기록 ────────────────
  const rules = {
    active:              [] as string[],
    candlesFetchFailed:  [] as string[],   // candles_fetch_failed
    insufficientCandles: [] as Array<{ id: string; interval: string; got: number; need: number }>,
    noFire:              [] as string[],   // rule_no_fire
    fired:               [] as string[],
  };
  const guardDrops: Record<string, number> = {
    losing_position_buy_block: 0,
    sell_not_held: 0,
    cooldown_rebuy: 0,
    cooldown_entry: 0,
    sell_amount_below_min: 0,
  };
  // 이 심볼이 collect 안에서 도달한 가장 깊은 stage (final 행의 축)
  let outcomeStage = 2;
  let outcomeGate: FunnelGate | null = null;
  /** stage 에서 gate 에 의해 죽음 */
  const kill = (stage: number, gate: FunnelGate) => {
    if (stage >= outcomeStage) { outcomeStage = stage; outcomeGate = gate; }
  };

  // ③ 쿨다운 조회 실패는 fail-open + error 기록 (심볼당 1회만 남긴다 — 런당 수천 행 방지)
  if (cooldowns.loadError) {
    rec.error('cooldown_lookup_error', { symbol, detail: { error: cooldowns.loadError, failOpen: true } });
  }
  const rebuyBlocked = cooldowns.isActive({ scope: 'rebuy', symbol });

  const candidates: Candidate[] = [];

  for (const { id, meta } of strategies) {
    // D1 — 모든 활성 룰을 무조건 실행한다. 상태별 활성 룰 선별(STATE_RULES)은 삭제됐다:
    // `rsi-oversold` 의 활성창(RSI∈[35,38))과 발화창(RSI<35)의 교집합이 공집합이라
    // 룰이 구조적으로 발화 불가능했고, 그것이 stage 4 에서 후보 95% 가 죽던 최상류 병목이었다.
    rules.active.push(id);
    const effectiveInterval = resolveEngineInterval(meta.interval);
    const candles = await getCandlesFor(effectiveInterval, meta.minCandles);
    if (!candles) {
      rules.candlesFetchFailed.push(id);
      kill(3, 'candles_fetch_failed');
      rec.error('candles_fetch_failed', { symbol, strategyId: id, detail: { interval: effectiveInterval } });
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
      // ③ 통합 쿨다운 — rebuy (symbol). 매도 직후 재매수는 거래세 왕복 낭비다.
      if (sig.side === 'buy' && rebuyBlocked) {
        guardDrops.cooldown_rebuy++;
        kill(5, 'cooldown_rebuy');
        rec.skip('cooldown_rebuy', {
          ...gateBase,
          detail: { until: cooldowns.until({ scope: 'rebuy', symbol }), ttlMin: COOLDOWN_TTL_MIN.rebuy },
        });
        continue;
      }
      // ③ 통합 쿨다운 — entry (symbol, strategy, side).
      // 구 ai-dedup 60분 + 24h skip 봉인을 대체한다. regime 버킷은 키에서 제외 —
      // 버킷 경계 진동(RSI 39.9↔40.1)으로 쿨다운이 우회되던 결함을 없앤다.
      const entryKey = { scope: 'entry' as const, symbol, strategyId: id, side: sig.side as 'buy' | 'sell' };
      if (cooldowns.isActive(entryKey)) {
        guardDrops.cooldown_entry++;
        kill(5, 'cooldown_entry');
        rec.skip('cooldown_entry', { ...gateBase, detail: { until: cooldowns.until(entryKey) } });
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
        candidates.push({
          ...sig, strategyId: id, quantity: heldQty, amountKRW: heldValue,
          indicators: withEngineLabels(sig.indicators, effectiveInterval, marketState),
        });
      } else {
        candidates.push({
          ...sig, strategyId: id,
          indicators: withEngineLabels(sig.indicators, effectiveInterval, marketState),
        });
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
      marketState,                 // D1 — 라벨. 국면별 룰 성과 사후 분석(레짐 학습 루프)의 축
      interval: INTRADAY_INTERVAL,
      rsi14: summary?.rsi14 ?? null,
      rules,
      guardDrops,
      rawCandidates: candidates.length,
    },
  });

  return {
    symbol, ticker, candidates, summary, summaryCandles, marketState,
    heldQty: heldEntry?.qty, heldAvgPrice: heldEntry?.avgPrice,
    rawCandidateCount: candidates.length,
    outcomeStage, outcomeGate,
  };
}

/**
 * 후보 indicators 에 엔진 라벨을 덧붙인다 — 승인 카드·사후 분석의 원천.
 *  - `interval`: 이 후보가 어느 시간축에서 나왔는가 (§6-4 검증 기준: 전부 '1h' 또는 '1d')
 *  - `market_state`: D1 로 게이트에서 강등된 국면 라벨 (사람 판단 보조)
 */
function withEngineLabels(
  indicators: unknown,
  interval: string,
  marketState: MarketStateCategory | null,
): Record<string, unknown> {
  const base = (indicators != null && typeof indicators === 'object')
    ? { ...(indicators as Record<string, unknown>) }
    : {};
  base.interval = interval;
  base.market_state = marketState;
  return base;
}

interface SkipAuditPayload {
  reasoning: string;
  /**
   * 스킵 사유 분류. AI 제거 후에도 **`ai_skipped` 상태 값과 카테고리 어휘는 그대로 둔다** —
   * analytics·RAG 백필 쿼리 다수가 `status='ai_skipped'` 와 `$.ai.skipCategory` 에 묶여 있고,
   * 기존 13,811행이 그 어휘로 쌓여 있다 (Leader 승인: 이관하지 않는다).
   */
  category: 'rule_prefilter' | 'portfolio_guard';
  confidence: number;
  warnings?: string[];
  prefilterReason?: string;
}

/** signals 테이블에 감사 레코드 insert — 프리필터·포트폴리오 가드 공용 */
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
 *  - 동일 심볼+exit_kind 통합 쿨다운 15분 (§4-3 scope='exit')
 *
 * ⚠️ **이 함수는 시장이 열려 있는 한 무조건 실행된다.** 엔진 스위치·활성 전략 수·평가 주기와
 *    무관하다 — 보유 종목 보호는 신규 진입 로직의 하위 기능이 아니다 (Leader 결정 ①).
 *
 * 🔕 **T-015 — 마스터 스위치**: `system_config.exit_engine_enabled` 가 `true` 가 아니면
 *    네 종류 청산 시그널을 **한 건도 만들지 않는다**(=주문도 나가지 않는다).
 *    다만 `reconcilePositionState` 와 `upsertPositionState`(진입가·고점 추적)는 **그대로
 *    돈다** — 나중에 다시 켰을 때 트레일링 기준선이 리셋되어 있으면 안 되기 때문이다.
 */
async function runExitEngine(
  market: Market,
  held: HeldAmountsResult,
  style: StyleConfig,
  rec: EvalFunnelRecorder,
  cooldowns: CooldownSet,
): Promise<ExitEngineRunResult> {
  // ─── 0) 마스터 스위치 판독 ────────────────────────────────────────────────
  // held.known 검사보다 **앞에서** 읽는다 — 잔고를 모르는 틱에서도 "자동 청산이 꺼져 있다"는
  // 사실은 똑같이 참이고, 운영자가 로그·run 행에서 그 상태를 놓치면 안 되기 때문이다.
  // 이 호출은 절대 throw 하지 않으며, 어떤 실패도 `enabled=false`(fail-closed)로 수렴한다.
  const exitSwitch = await readExitEngineSwitch();
  const empty: ExitEngineRunResult = {
    created: 0, enabled: exitSwitch.enabled, blocked: 0, switchSource: exitSwitch.source,
  };

  /**
   * 🔴 **보유를 모르면 아무것도 하지 않는다.**
   *
   * 특히 `reconcilePositionState` 보다 **먼저** 빠져나가야 한다 — 빈 목록으로 reconcile 하면
   * `DELETE FROM position_state WHERE market=?` 가 그 시장의 트레일링 고점을 전부 지운다.
   * 조회 실패 한 번으로 고점 이력이 사라지면, 잔고가 복구된 뒤에도 트레일링 손절이 잘못된
   * 기준(재진입 시점 가격)으로 계산된다. "모름"은 "정리해도 된다"가 절대 아니다.
   */
  if (!held.known) {
    notifyHeldAmountsUnknown(market, held.reason);
    rec.error('balances_unknown', {
      side: 'sell',
      reason: 'balances_unknown',
      detail: { market, error: held.reason.slice(0, 300), skipped: ['exit_eval', 'position_state_reconcile'] },
    });
    return empty;
  }
  noteHeldAmountsKnown(market);

  const heldAmounts = held.amounts;
  const heldSymbols = [...heldAmounts.keys()];
  // reconcile은 항상 실행 (미보유 row 정리) — 단 보유 목록을 **아는** 경우에만.
  try {
    await reconcilePositionState(market, heldSymbols);
  } catch (e) {
    console.warn(`[exit-engine:${market}] reconcile 실패: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (heldSymbols.length === 0) return empty;

  const hardStopEnabled = exitSwitch.hardStopEnabled;

  // 🔕 마스터 OFF — **매 틱 소리내어 말한다.** 조용한 플래그는 "손절이 지켜주고 있다"는
  //    오해를 낳고, 그 오해가 이 스위치의 유일한 실패 모드다.
  if (!exitSwitch.enabled) {
    console.warn(
      `[exit-engine:${market}] 🔕 ${describeExitEngineSwitch(exitSwitch)} | ` +
      `보유 ${heldSymbols.length}종목의 진입가·고점(peak) 추적은 계속됩니다. ` +
      `다시 켜려면 설정 > 안전장치의 "자동 청산 엔진" 토글 또는 system_config.${EXIT_ENGINE_ENABLED_KEY}=true.`,
    );
  }

  let created = 0;
  let blocked = 0;

  // ─── T-055 1단계 — 매도 제안 **미리보기**(읽기 전용 시뮬레이션) ─────────────────
  //
  // 자동 청산 마스터가 OFF 일 때만 연다(설계 §2.2 — 둘 다 켜지면 자동 엔진이 우선이고 제안은 없다.
  // 자동 매도가 실제로 나가는 상태에서 "제안했을 것" 요약을 보내면 오해만 낳는다).
  // `sell_proposal_preview_enabled` 가 불리언 true 가 아니거나 임계값이 무효면 null 이고,
  // 그때 아래 루프에서 하는 일은 0이다. 결과는 eval_funnel 과 하루 1회 요약뿐 —
  // 시그널·주문·쿨다운·position_state 쓰기 없음. 어떤 예외도 청산 평가·틱으로 새지 않게 격리한다.
  let preview: SellProposalPreviewRun | null = null;
  if (!exitSwitch.enabled) {
    try {
      preview = await openSellProposalPreview(market, heldSymbols.length);
    } catch (e) {
      preview = null;
      console.warn(`[sell-proposal-preview:${market}] 열기 실패 — 미리보기 생략 (청산 엔진 영향 없음): ${e instanceof Error ? e.message : String(e)}`);
    }
  }

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

    // T-055 미리보기 — evaluateExit 의 발화 여부와 **무관하게** 보유 종목마다 판정한다.
    // (마스터 게이트 블록 안에 두면 evaluateExit 이 null 인 종목 — 예: hardStopPct 를 10 으로 올린
    //  상태의 −7% 포지션 — 이 미리보기에서 통째로 빠진다.) 이미 조회한 ticker·state·잔고만 넘긴다.
    if (preview) {
      try {
        preview.observe({ symbol, ticker, state, kis: entry }, rec);
      } catch (e) {
        console.warn(`[sell-proposal-preview:${market}] ${symbol} 관측 예외 (청산 엔진 영향 없음): ${e instanceof Error ? e.message : String(e)}`);
      }
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

    // 🔕 T-015 마스터 스위치 — **네 종류 전부** 여기서 끊는다.
    //
    // 위치가 중요하다. `evaluateExit`(순수 함수, 부작용 없음) **뒤**이고
    // `createSignalGuarded`(→ createSignal → submitOrder) **앞**이다. 그래서:
    //   - 주문 경로는 확실히 차단된다 (이 심볼의 유일한 청산 시그널 생산자가 아래 한 줄이다)
    //   - "껐지만 무엇이 발화했을 뻔했는가"는 eval_funnel 에 그대로 남는다 (깜깜이 방지)
    //   - 위쪽 upsertPositionState(고점 갱신)는 이미 실행된 뒤다 (추적 유지)
    // 쿨다운도 걸지 않는다 — 차단은 "시도했다"가 아니므로 재켜짐 시 즉시 정상 평가돼야 한다.
    if (!exitSwitch.enabled) {
      blocked++;
      const pnlPct = Number((((ticker.price - state.entryPrice) / state.entryPrice) * 100).toFixed(2));
      console.warn(
        `[exit-engine] 🔕 ${symbol} ${exitSig.exitKind} 발화 조건 충족 (평가손익 ${pnlPct}%) — ` +
        `자동 청산 엔진 OFF 이므로 시그널·주문을 만들지 않습니다 (${EXIT_ENGINE_ENABLED_KEY}=${exitSwitch.enabled}, source=${exitSwitch.source})`,
      );
      rec.skip('exit_engine_disabled', {
        symbol, side: 'sell',
        reason: exitSwitch.source,
        detail: { exitKind: exitSig.exitKind, pnlPct, wouldHaveFired: true },
      });
      continue;
    }

    // hard_stop 시그널 생성 비활성화 여부 체크
    if (exitSig.exitKind === 'hard_stop' && !hardStopEnabled) {
      console.log(`[exit-engine] ${symbol} hard_stop 스킵 (exit_hard_stop_enabled=false)`);
      rec.skip('exit_hard_stop_disabled', { symbol, side: 'sell', detail: { exitKind: exitSig.exitKind } });
      continue;
    }

    // ③ 통합 쿨다운 — exit (symbol, exit_kind) 15분.
    //
    // ⚠️ 이 자리는 원래 signals.status 를 조회했고, 그 목록에 실존하지 않는 값
    //    ('executed','accepted')이 있어 쿨다운이 **영구 무효**였다(T-002 H3 — 중복 청산 위험).
    //    상태 테이블 의존을 끊어 상태 어휘가 바뀌어도 쿨다운이 조용히 죽지 않게 한다.
    //    1차 방어선은 여전히 ④ 의 `duplicate_active_signal`(동일 심볼+방향 활성 시그널)이고,
    //    이건 같은 청산 종류의 재발화를 막는 2차 방어선이다.
    const exitKey = { scope: 'exit' as const, symbol, exitKind: exitSig.exitKind };
    if (cooldowns.isActive(exitKey)) {
      rec.skip('cooldown_exit', {
        symbol, side: 'sell',
        detail: { exitKind: exitSig.exitKind, until: cooldowns.until(exitKey), ttlMin: COOLDOWN_TTL_MIN.exit },
      });
      continue; // 쿨다운 중
    }

    // ★ H2 — createSignal 예외가 런 전체를 죽이던 지점. 반드시 격리한다.
    const res = await createSignalGuarded(exitSig, rec);
    if (res.ok) {
      created++;
      // 쿨다운은 **생성 성공 시에만** 건다 — 실패한 시도로 다음 tick 의 재시도를 막으면
      // 손절이 통째로 유실된다.
      await setCooldown(exitKey, COOLDOWN_TTL_MIN.exit, `exit:${exitSig.exitKind}`);
      console.log(`[exit-engine] ${symbol} ${exitSig.exitKind} 시그널 발화 (signalId=${res.signalId})`);
    } else if (res.recordedVerdict === 'skip') {
      // 🔴 T-020 라운드 2 — **정책 스킵은 여기서 다시 기록하지 않는다.**
      //
      // `createSignalGuarded` 가 이미 게이트별로(`quantity_below_min`·`symbol_blacklisted`·
      // `duplicate_active_signal` …) `verdict='skip'` 행을 남겼다. 여기서 무조건
      // `exit_create_failed`(verdict=`error`)를 덧쓰면 같은 사건이 두 행이 되고, 그중 하나가
      // 정기 리포트의 "⚠ 이상" 절에 **"청산 시그널 생성 실패"** 로 올라간다.
      //
      // hard_stop·eod_loss_cut 은 모드 무관 강제 auto_submit 이라 반드시 이 경로를 탄다.
      // 즉 손절이 1주 미만이라 정책대로 스킵될 때마다 거짓 경보가 함께 찍히고, 운영자는 곧
      // 그 라벨을 무시하도록 길들여진다 — 그러면 **진짜** 청산 실패가 그 안에 묻힌다.
      //
      // 게이트 이름을 나열해 특례를 파지 않고 `recordedVerdict` 로 가르는 이유: 새 스킵
      // 게이트가 추가될 때마다 여기를 같이 고쳐야 하는 구조면 같은 결함이 그대로 재발한다.
      // 진입(매수) 경로는 원래 호출부가 추가 기록을 하지 않는다 — 그 패턴에 맞춘 것이다.
      console.log(
        `[exit-engine] ${symbol} ${exitSig.exitKind} 시그널 스킵(${res.recordedGate}): ${res.error}`,
      );
    } else {
      // 진짜 실패·예외 — exit 트랙(stage 29) 게이트로 한 번 더 남긴다.
      // `createSignalGuarded` 의 기록은 stage 11(진입 축)이라, 이걸 없애면 청산 실패가
      // exit 트랙에서 사라진다. 그건 반대 방향의 침묵이다.
      rec.error('exit_create_failed', {
        symbol, side: 'sell',
        detail: { exitKind: exitSig.exitKind, error: res.error },
      });
      console.warn(`[exit-engine] ${symbol} ${exitSig.exitKind} 시그널 실패: ${res.error}`);
    }
  }

  // T-055 미리보기 요약 — 하루 1회(시장 거래일, DB 표식). **기다리지 않는다**: 선점 쿼리·전송이
  // 느리거나 실패해도 이 틱의 나머지(경보·진입 평가·eval_funnel flush)는 그대로 진행된다.
  if (preview) {
    try {
      void preview.finish().catch((e: unknown) => {
        console.warn(`[sell-proposal-preview:${market}] 요약 예외 (틱 영향 없음): ${e instanceof Error ? e.message : String(e)}`);
      });
    } catch (e) {
      console.warn(`[sell-proposal-preview:${market}] 요약 시작 실패 (틱 영향 없음): ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 🔕 실제로 **막힌 청산이 있었던** 틱만 알린다. 조건이 하나도 발화하지 않았다면
  //    알릴 것도 없다 — 경보 피로를 만들지 않으면서 "손절이 안 나갔다"는 사실은 반드시 전한다.
  if (!exitSwitch.enabled && blocked > 0) {
    sendAlertThrottled(
      `exit-engine:disabled:${market}`,
      'warning',
      `🔕 자동 청산 OFF — 청산 조건 ${blocked}건이 주문 없이 지나갔습니다 (${market})`,
      `${describeExitEngineSwitch(exitSwitch)}\n\n`
      + `이번 평가에서 손절·익절·트레일링 조건을 충족한 보유 종목이 ${blocked}건 있었지만 `
      + '자동 매도 주문은 나가지 않았습니다. **현재 이 시스템은 손실을 자동으로 끊지 않습니다.**\n'
      + '청산이 필요하면 직접 주문하세요.\n'
      + `(진입가·고점 추적은 계속되므로 다시 켜면 정상 기준으로 재개됩니다 — 설정 > 안전장치 "자동 청산 엔진")`,
      12 * 60 * 60 * 1000,
    );
  }

  return { created, enabled: exitSwitch.enabled, blocked, switchSource: exitSwitch.source };
}

/**
 * ④ 안전·집행 (T-003 §1) — fail-closed 가 기본이되 게이트별 방향을 지킨다.
 *
 *  fail-closed (통과시키면 돈이 나감): 블랙리스트 · 주문한도 · 유동성고갈 · createSignal 검증
 *  fail-open  (차단하면 기회 상실): macro 게이트 · 프리필터 — 기록 남기고 통과
 *
 * assist 모드에서는 `portfolio_core_ratio` 를 **경고 라벨로 강등**한다 (사람이 보는 자리이므로).
 * auto 모드에서만 하드 게이트로 유지한다.
 */
async function applyFilters(
  ctx: CollectedContext,
  style: StyleConfig,
  market: Market,
  heldAmounts: Map<string, HeldEntry>,
  rec: EvalFunnelRecorder,
  outcome: OutcomeTracker,
  autopilotMode: AutopilotMode,
): Promise<Candidate[]> {
  const pool = getPool();
  const { symbol, candidates, summary, summaryCandles, ticker } = ctx;

  /** prefilter reason → eval_funnel gate ID */
  const PREFILTER_GATE: Record<string, FunnelGate> = {
    liquidity_dead:       'prefilter_liquidity_dead',
    atr_zero:             'prefilter_atr_zero',
    rsi_extreme_counter:  'prefilter_rsi_extreme_counter',
    blowoff_top:          'prefilter_blowoff_top',
  };

  // 1) pre-filter.
  // summary 는 ② 에서 룰과 같은 1h 축으로 항상 산출되므로 "summary 없어서 프리필터 생략"
  // (`prefilter_bypassed_no_summary`) 분기가 소멸했다 — 캔들 자체가 없으면 룰도 발화 못 해
  // 여기 도달하지 않는다.
  let survived: Candidate[] = candidates;
  if (summary) {
    const passed: Candidate[] = [];
    const skipped: Array<{ cand: Candidate; reason: string }> = [];
    for (const cand of candidates) {
      const decision = prefilterCandidate(cand, summary, summaryCandles);
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
      const gate = PREFILTER_GATE[key] ?? 'prefilter_liquidity_dead';
      rec.skip(gate, {
        symbol, strategyId: cand.strategyId, side: cand.side as 'buy' | 'sell',
        reason: key, detail: { detail },
      });
      outcome.kill(symbol, 7, gate);
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

  if (survived.length === 0) return [];

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
    if (survived.length === 0) return [];
  }

  // 1.5) portfolio stability 가드 — buy 시그널만 검사 (sell·해외는 자동 pass).
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
        const reasonKor = decision.reason === 'core_ratio_below_min'
          ? '코어(KOSPI 100) 비율 미달'
          : decision.reason === 'max_positions_exceeded'
            ? '24h 종목당 매수 한도 초과'
            : (decision.reason ?? '안전성 가드');
        const gate: FunnelGate =
          decision.reason === 'core_ratio_below_min'   ? 'portfolio_core_ratio'
          : decision.reason === 'max_positions_exceeded' ? 'portfolio_max_positions'
          :                                                 'portfolio_guard_other';

        // §1 — `portfolio_core_ratio` 는 **assist/manual 에선 경고 라벨로 강등**한다.
        // 사람이 승인 카드를 보는 자리이므로 하드 차단 대신 경고를 붙여 통과시키고,
        // 사람이 없는 auto 모드에서만 하드 게이트로 남긴다.
        // (max_positions·기타 가드는 물타기 상한이라 모드와 무관하게 하드 유지)
        if (gate === 'portfolio_core_ratio' && autopilotMode !== 'auto') {
          rec.pass('portfolio_core_ratio', {
            symbol, strategyId: cand.strategyId, side: 'buy',
            reason: 'label_only',
            detail: { detail: decision.detail, autopilotMode, demotedToLabel: true },
          });
          guarded.push({
            ...cand,
            indicators: {
              ...(cand.indicators as Record<string, unknown> ?? {}),
              warnings: [
                ...(((cand.indicators as Record<string, unknown> | undefined)?.warnings as string[] | undefined) ?? []),
                `코어 비율 경고: ${decision.detail ?? reasonKor}`,
              ],
            },
          });
          continue;
        }

        guardSkips++;
        await insertSkipAuditPool(pool, cand, symbol, ticker.price, {
          reasoning: `[매수 포트폴리오 안전 가드] ${reasonKor} — ${decision.detail ?? ''}`.trim(),
          category: 'portfolio_guard',
          confidence: 0,
        });
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

  // ③ dedup(regime 버킷) 은 §4-3 통합 쿨다운(scope='entry')으로 대체돼 여기서 사라졌다.
  //   버킷 경계 진동으로 우회되던 결함 + AI 스킵 이력 의존이 함께 제거된다.
  return survived;
}

// ─── D4: 장중 AI 완전 제거 (T-003 §1·§4) ────────────────────────────────
//
//   여기 있던 buildMarketContext / applyBatchDecisions / fallbackPerSymbol 이 삭제됐다.
//   근거: `claude` CLI 직접 spawn 이 매수 경로의 **하드 게이트**였고 실측 실패 사유 상위가
//   "claude exit 143"(89건)·"claude exit 1"(22건)이었다. 외부 프로세스의 가용성이
//   매매 가능 여부를 결정하는 구조 자체가 결함이다.
//
//   AI 의 질적 거절을 대체하는 것: (a) assist 모드의 사람 승인, (b) 승인 카드의 market-state
//   라벨·post-market 시나리오, (c) 룰 자체 조건 강화, (d) auto 모드의 소액 한도.
//   post-market(밤 배치) AI 시나리오 생성은 이 제거 범위 밖이며 그대로 유지된다.

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

  const pool = getPool();
  const style = await getStyleConfig();

  // ─── ① 실행 자격 — ENGINE_ENABLED (T-003 §4-1, Leader 결정 ①) ────────────
  //
  // `ENGINE_ENABLED=false` 는 **신규 진입 생성만** 멈춘다. 보유 종목 청산(손절·트레일링)은
  // 기회 포착이 아니라 리스크 관리이므로 계속 돈다 — 엔진을 껐다고 이미 산 종목의 손절까지
  // 멈추면 켜둔 것보다 위험하다. "전부 멈춤"은 KILL_SWITCH 가 담당한다.
  // 구 `ANALYST_ENABLED` 가 엔진 마스터와 라우팅 정책을 겸직하던 이중 의미를 여기서 끊는다.
  const switches = await getEngineSwitches();
  const cooldowns = await loadActiveCooldowns();

  // ─── Exit Engine — 보유 포지션 청산 (①~④ 사슬과 **병렬 트랙**) ────────────
  //
  // ⚠️ 위치가 중요하다. 여기는 "시장이 열려 있다"만 확인된 지점이고, 아래 어떤 게이트보다도
  //    앞선다. 엔진 스위치·활성 전략 수·평가 주기가 보유 종목 보호를 좌우해선 안 된다.
  //    (구 코드는 `dueStrategies.length === 0` 조기 return 뒤에 있어서, 전 전략이 throttle 된
  //     tick 에서는 손절·트레일링이 통째로 실행되지 않는 구멍이 있었다.)
  // 1. position_state reconcile (미보유 row 일괄 정리)
  // 2. 보유 종목별 ticker 조회 + state upsert (peak 갱신) + evaluateExit 평가
  // 3. 청산 시그널 발화 시 createSignal → submitOrder 정상 경로
  // 안전장치(DRY_RUN/KILL_SWITCH/order_limits/blacklist)는 모두 통과한다.
  // 🔕 T-015 — `exit_engine_enabled ≠ true` 면 2~3 은 하지 않는다. 1(reconcile)과
  //    2 의 state upsert(고점 추적)는 그대로 돈다.
  const held = await getHeldAmounts(market);
  const exitRun = await runExitEngine(market, held, style, rec, cooldowns);
  const exitSignalsCreated = exitRun.created;
  /** run 행 detail 공통 — "청산이 왜 0건인가"를 항상 설명 가능하게 남긴다. */
  const exitTrack = {
    exitSignalsCreated,
    exitEngineEnabled: exitRun.enabled,
    exitBlockedByDisable: exitRun.blocked,
    exitSwitchSource: exitRun.switchSource,
  };
  if (exitSignalsCreated > 0) {
    console.log(`[exit-engine:${market}] ${exitSignalsCreated} 청산 시그널 발화`);
  }

  /**
   * 🔴 보유를 모르면 **이 틱 전체를 중단한다** (신규 진입 평가도 하지 않는다).
   *
   * 청산만 건너뛰고 진입 평가를 계속하면 더 나쁜 조합이 된다:
   *  - `heldAmounts.has(symbol)` 기반 게이트가 전부 "미보유"로 판정돼
   *    `losing_position_buy_block`(손실 중 추가매수 차단)·종목당 한도가 무력화된다
   *    → **이미 들고 있는 종목을 모른 채 더 사는** 경로가 열린다.
   *  - 반대로 매도 신호는 `sell_not_held` 로 전부 거부된다.
   * 즉 "모름" 상태에서 진입만 도는 것은 한쪽 방향으로만 열린 문이다. 아무것도 안 하는 쪽이
   * 안전하다 — cron 은 5분마다 다시 돌고, 복구되면 그 틱에서 정상 평가된다.
   */
  if (!held.known) {
    rec.record({
      gate: 'run',
      verdict: 'skip',
      reason: 'balances_unknown',
      detail: { error: held.reason.slice(0, 300), exitEvaluated: false, ...exitTrack },
    });
    await rec.flush();
    return {
      ran: 0, skipped: 0, skippedStrategyIds: [], results: [],
      errors: ['balances_unknown'], universeRefreshed: false,
    };
  }
  const heldAmounts = held.amounts;

  if (!switches.engineEnabled) {
    rec.skip('engine_disabled', {
      detail: { autopilotMode: switches.autopilotMode, source: switches.source, heldSymbols: heldAmounts.size },
    });
    rec.record({
      gate: 'run',
      // verdict='skip' — 런은 돌았지만 **전체 평가는 아니다**. eval-funnel-query 의
      // fullEvalRuns(gate='run' AND verdict='pass')를 부풀리지 않으려면 pass 여선 안 된다.
      verdict: 'skip',
      reason: 'engine_disabled',
      detail: {
        engineEnabled: false,
        // 🔕 T-015 — 자동 청산까지 꺼져 있으면 이 틱은 "청산 전용"이 아니라 **관측 전용**이다.
        exitOnly: exitRun.enabled,
        heldSymbols: heldAmounts.size,
        ...exitTrack,
      },
    });
    await rec.flush();
    return {
      ran: 0, skipped: 0, skippedStrategyIds: [], results: [],
      errors: ['engine_disabled'], universeRefreshed: false,
    };
  }

  // ⛔ D3 — `FIND_IN_SET(analystStyle, applicable_styles)` 제거.
  //    성향 단일화(2026-05-09) 후에도 `getAnalystStyle()` 이 항상 'aggressive' 를 반환했고,
  //    그 값이 SET 컬럼 검사에 들어가 ma-cross·weekly-trend-follow·dividend-quality·inside-bar
  //    4종이 **UI 에서 켜져 있어도 영구 제외**됐다 (사망 원인 #3).
  //    이제 **`strategies.enabled` 가 단일 진실**이다 — UI 토글이 곧 실행 여부다.
  //    `applicable_styles` 컬럼은 화면 표시용으로 남지만 실행 경로는 더 이상 읽지 않는다.
  const [rows] = await pool.query<StrategyRow[]>(
    `SELECT id, enabled, backtest_interval_h, next_backtest_at
     FROM strategies
     WHERE enabled = 1`,
  );

  const { refreshed: universeRefreshed } = await refreshUniverse(market, opts.force);

  const activeStrategies: ActiveStrategy[] = [];
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
    // ⛔ `strategy_throttled` 삭제 (§1) — `next_backtest_at` 이 평가 주기를 6h(운영값 5분)로
    //    조이던 겸직을 끊는다. 룰은 결정론이고 반복 발화는 ③ entry 쿨다운(봉 단위)이 막으므로
    //    매 tick 전 활성 전략을 평가해도 과평가 부작용이 없다.
    //    `next_backtest_at`/`backtest_interval_h` 는 이제 백테스트 스케줄 전용이다.
    activeStrategies.push({ id: row.id, meta });
  }

  // ⛔ `no_due_strategies` 게이트 삭제 (§1) — 별도 skip 행 대신 run 행에 기록한다.
  //    이 시점에 이미 exit-engine 은 실행된 뒤다.
  if (activeStrategies.length === 0) {
    rec.record({
      gate: 'run',
      verdict: 'skip',
      reason: 'no_active_strategies',
      detail: { unregistered: skippedStrategyIds, heldSymbols: heldAmounts.size, ...exitTrack },
    });
    await rec.flush();
    return { ran: 0, skipped: skippedStrategyIds.length, skippedStrategyIds, results: [], errors: [], universeRefreshed };
  }

  // 해외 시장은 universeSource 'volume-top' 고정 (KOSPI 분류 미적용). 국내만 style 분기.
  const universeSrc = market === 'domestic' ? 'volume-top' : 'volume-top'; // 단일성향: 기본값 고정
  const symbols = await getEvalSymbols(market, heldAmounts, universeSrc);
  // 주문 금액 buffer = 실효 왕복 비용 + micro 변동 여유.
  //
  // 구 하드코딩 0.5% 는 "왕복 0.43%(코인원 0.2%×2 이식 잔재) + micro 0.07%" 였다.
  // 비용 항만 실측값(§3: feePct 0.18% + slippagePct 0.15% = 0.33%)으로 교체하고,
  // ⚠️ **micro 여유분은 유지한다** — 이 buffer 의 나머지 절반은 시그널 산출 시점과 주문 송신
  //    시점 사이의 가격 변동을 흡수하는 용도라 0 으로 만들면 order_limit 거부가 빈발한다.
  //    (비용 재도출이 의도치 않게 주문 실패율을 올리는 부작용을 막는다)
  const MICRO_VARIATION_BUFFER_PCT = 0.0007;
  const FEE_BUFFER_PCT = roundTripCostPct(style) / 100 + MICRO_VARIATION_BUFFER_PCT;
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
    const error = e instanceof Error ? e.message : String(e);
    console.warn(`[regime-gate] macro 조회 실패 — 게이트 미발동 (매수 허용): ${error}`);
    // §1 — macro 는 **fail-open 유지 + error 기록**. 억제 필터지 자금 안전장치가 아니라서
    // fail-closed 로 하면 외부 API 장애가 매수를 전면 차단한다(제품 사망 재발 패턴).
    // 다만 무기록으로 넘어가면 "왜 매수가 걸러지지 않았나"를 사후에 못 본다.
    rec.error('regime_gate_macro_error', { detail: { error: error.slice(0, 300), failOpen: true } });
  }

  // ─── ② 룰 발화 + ③ 억제 — 심볼별 후보 수집 (AI 호출 없음) ────────────────
  const contexts: CollectedContext[] = [];
  for (const symbol of symbols) {
    const ctx = await collectCandidates(symbol, activeStrategies, heldAmounts, defaultAmountKRW, style, rec, cooldowns);
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

  // ─── ④ 안전·집행 — 프리필터·장마감·포트폴리오 가드 통과분을 즉시 시그널로 만든다 ──
  // regime gate 발동 또는 주문 한도 미설정(fail-safe) 시 buy 후보를 사전 제거 (sell·보유 종목 매도는 유지)
  const buyBlocked = regimeGateBlocked || !orderLimitConfigured;
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
    const survived = await applyFilters(
      ctx, style, market, heldAmounts, rec, outcome, switches.autopilotMode,
    );
    if (survived.length === 0) {
      results.set(ctx.symbol, { symbol: ctx.symbol, signalsCreated: 0, candidateCount: 0, rawCandidates: ctx.rawCandidateCount });
      continue;
    }
    // ④ 통과 = 시그널 생성. AI 관문이 사라져 여기가 곧 터미널이다.
    outcome.advance(ctx.symbol, 11);
    let createdCount = 0;
    for (const cand of survived) {
      // createSignalGuarded 가 blacklist / duplicate_active_signal / 생성 실패를 전부
      // eval_funnel 에 기록한다 (무기록 게이트 금지 — §1).
      const res = await createSignalGuarded(cand, rec, outcome);
      // T-072 — 검증 관문에 막힌 매수(`validation_gate`)는 createSignal 안에서 진입 쿨다운을 이미 선점했다(F-16). 여기서 다시 걸지 않는다.
      if (!res.ok) continue;
      createdCount++;
      // ③ entry 쿨다운 — 같은 (symbol, strategy, side)의 반복 발화를 봉 주기×2 동안 막는다.
      await setCooldown(
        { scope: 'entry', symbol: ctx.symbol, strategyId: cand.strategyId, side: cand.side as 'buy' | 'sell' },
        COOLDOWN_TTL_MIN.entry,
        'signal_created',
      );
      // ③ rebuy 쿨다운 — 매도 시그널 직후 같은 종목 재매수 차단.
      // ⚠️ 사양은 "매도 **체결** 시"라고 쓰지만 체결 이벤트 훅이 아직 없어 **시그널 생성 시점**에 건다.
      //    (보수적 방향 — 체결보다 이른 시점이라 차단 구간이 조금 더 길다)
      if (cand.side === 'sell') {
        await setCooldown({ scope: 'rebuy', symbol: ctx.symbol }, COOLDOWN_TTL_MIN.rebuy, 'sell_signal');
      }
    }
    results.set(ctx.symbol, {
      symbol: ctx.symbol,
      signalsCreated: createdCount,
      selectedStrategy: survived[0]?.strategyId,
      side: survived[0]?.side as 'buy' | 'sell' | undefined,
      candidateCount: survived.length,
      rawCandidates: ctx.rawCandidateCount,
    });
  }

  // ⛔ `next_backtest_at` 재기록 삭제 (§4-4) — 평가 주기와의 겸직을 끊었으므로 평가 경로가
  //    이 컬럼을 더 이상 쓰지도, 갱신하지도 않는다. 백테스트 스케줄러 전용 컬럼으로 복원.

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
      ...exitTrack,
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
