/**
 * sell-proposal — **매도 제안** 판정기 (T-055). 순수 함수, DB·KIS·시그널 I/O 없음.
 *
 * 자동 청산 엔진(`exit-engine.ts` `evaluateExit`)과 같은 입력(포지션 상태·시세)을 보고
 * "이 보유 종목을 **사람에게** 팔지 물어볼 것인가"만 판정한다. 주문을 내지도, 시그널을 만들지도
 * 않는다. 1단계(읽기 전용 시뮬레이션)에서는 엔진이 이 결과를 `eval_funnel` 과 하루 1회 요약에만
 * 쓰고, 2단계에서 사람 승인용 시그널의 원천이 된다.
 *
 * ## 🔴 `exit_kind` 를 만들지 않는다
 *
 * `signals/router.ts` 의 `routeSignal` 은 `indicators.exit_kind ∈ {hard_stop, eod_loss_cut}` 이면
 * 모드와 무관하게 **승인 없이 auto_submit** 한다(T-015 가 생산자를 끊어 도달 불가로 만든 분기).
 * 이 판정기의 출력이 그 키를 가지면 "제안"이 승인 없이 주문으로 가는 길이 되살아난다.
 * 그래서 출력 초안은 `exit_kind`·`exitKind` 를 **어떤 깊이에도** 갖지 않고, 판정 근거는
 * `indicators.proposal` 에 담는다(테스트가 고정). `indicators.ai`(진입 시나리오·가격 구간)도
 * 금지 — 있으면 승인 경로가 매도를 "진입 감시"로 보낸다(T-055 §1.3 E).
 *
 * ## 판정 규칙 (T-055 §3.3, 사용자 확정 2026-10-19)
 *
 * | 직전 결정(`lastDecision`)          | 대상(pass) 조건                                          | trigger  |
 * |------------------------------------|----------------------------------------------------------|----------|
 * | 없음                               | 진입가 대비 손익 ≤ −stopPct                              | `stop`   |
 * | `active`(승인 대기 중인 제안 있음) | 손익 < −stopPct + reboundExitPct (회복 폭 미만 = 유지)    | `hold`   |
 * | `rejected`·`expired`·`superseded`  | 손익 ≤ −stopPct **그리고** 기준가 대비 ≤ −restepPct       | `restep` |
 *
 * - 비교 전에 손익%를 소수 6자리로 반올림한다. 진입가 331,500 · 현재가 311,610 처럼 정확히 −6% 인
 *   값이 이진 부동소수 오차로 −5.999999… 가 되어 빠지는 일을 막는다.
 * - 1단계 엔진은 `lastDecision` 에 항상 `null` 을 넘긴다(제안 시그널이 아직 없다). 나머지 두 행은
 *   2단계에서 `signals` 의 마지막 결정 행으로 채운다 — 지금은 판정기가 받을 수 있게만 해 둔다.
 * - 입력 결손·비정상(진입가·현재가·수량·정책·기준가)은 전부 **제안하지 않음**(skip)이다.
 *   제안은 주문이 아니지만, 2단계에서 승인 한 번이 되돌릴 수 없는 시장가 매도가 되므로 근거가
 *   불확실한 제안은 만들지 않는다 — "모르면 묻지도 않는다"(T-015 의 "모르면 팔지 않는다"와 같은 방향).
 */
import type { Ticker } from '@/lib/exchanges/types';
import type { PositionState } from './position-state';
import { EXIT_UNIT_RATIO_MIN, EXIT_UNIT_RATIO_MAX } from './exit-engine';

/** 제안 시그널·eval_funnel 행의 strategy_id. 자동 청산(`exit-engine-v1`)과 다른 값이어야 한다. */
export const SELL_PROPOSAL_STRATEGY_ID = 'sell-proposal-v1';

/** 제안 종류. 1·2단계는 손절 제안만, 비중 축소(`concentration`)는 3단계. */
export type SellProposalKind = 'stop_loss';

/** 판정 임계값 — 전부 **양수 크기**(%). stopPct=6 은 "−6% 이하"를 뜻한다. */
export interface SellProposalPolicy {
  /** 진입가 대비 손실이 이 값 이상이면 제안 (`sell_proposal_stop_pct`) */
  stopPct: number;
  /** 거절·만료·철회 뒤 기준가 대비 추가 하락이 이 값 이상이면 재제안 (`sell_proposal_restep_pct`) */
  restepPct: number;
  /** 활성 제안이 임계값 위로 이만큼 회복하면 철회 (`sell_proposal_rebound_exit_pct`) */
  reboundExitPct: number;
}

/**
 * 허용 범위 — 밖이면 정책 무효(아무것도 하지 않음).
 * stopPct 하한 1 은 "정상 변동을 손절 제안으로 오인"하지 않기 위한 바닥, 상한 50 은 −52% 포지션이
 * 이미 있는 계좌에서 의미 있는 상한이다. 자동 엔진 `hardStopPct`(상한 10, `style.ts`)와 **독립**이다.
 */
export const SELL_PROPOSAL_POLICY_RANGES = {
  stopPct: [1, 50],
  restepPct: [1, 50],
  reboundExitPct: [0, 5],
} as const satisfies Record<keyof SellProposalPolicy, readonly [number, number]>;

/**
 * 직전 제안의 결정. 2단계에서 `signals`(strategy_id='sell-proposal-v1') 최신 행으로 채운다.
 * `referencePrice` = 그 제안을 만들 때의 현재가(`indicators.proposal.current_price`).
 */
export type SellProposalLastDecision =
  | { status: 'active'; referencePrice: number }
  | { status: 'rejected' | 'expired' | 'superseded'; referencePrice: number };

export type SellProposalTrigger = 'stop' | 'restep' | 'hold';

export type SellProposalSkipReason =
  | 'policy_invalid'
  | 'price_invalid'
  | 'entry_invalid'
  | 'no_position'
  | 'quantity_below_min'
  | 'unit_mismatch'
  | 'above_threshold'
  | 'restep_not_met'
  | 'rebound_withdraw'
  | 'reference_invalid'
  | 'decision_invalid';

/**
 * 제안 초안. `signals/router.ts` 의 `SignalInput` 과 **구조적으로 호환**되게 만들되(2단계 재사용),
 * 이 모듈은 router 를 import 하지 않는다 — 판정기가 시그널 계층에 의존하지 않게 하려는 것이다.
 */
export interface SellProposalDraft {
  strategyId: typeof SELL_PROPOSAL_STRATEGY_ID;
  symbol: string;
  side: 'sell';
  orderType: 'market';
  price: number;
  quantity: number;
  amountKRW: number;
  reasoning: string;
  indicators: {
    proposal: {
      kind: SellProposalKind;
      trigger: SellProposalTrigger;
      entry_price: number;
      current_price: number;
      pnl_pct: number;
      threshold_pct: number;
      reference_price: number | null;
    };
  };
}

export type SellProposalEvaluation =
  | {
      verdict: 'pass';
      kind: SellProposalKind;
      trigger: SellProposalTrigger;
      pnlPct: number;
      thresholdPct: number;
      draft: SellProposalDraft;
    }
  | {
      verdict: 'skip';
      reason: SellProposalSkipReason;
      /** 손익을 계산할 수 없었으면 null */
      pnlPct: number | null;
      /** 정책이 무효였으면 null */
      thresholdPct: number | null;
    };

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 비교용 반올림 — 소수 6자리. 경계값(정확히 −6%)이 부동소수 오차로 빠지지 않게 한다. */
function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

/**
 * 정책 검증. 문제 목록(빈 배열 = 유효)을 돌려준다. 정책 판독기(`sell-proposal-policy.ts`)와
 * 판정기가 **같은 규칙**을 쓴다 — 판독기가 놓친 값이 들어와도 판정기가 다시 거부한다(방어 2겹).
 */
export function validateSellProposalPolicy(policy: unknown): string[] {
  if (policy == null || typeof policy !== 'object') return ['정책 없음'];
  const p = policy as Record<string, unknown>;
  const problems: string[] = [];
  for (const key of Object.keys(SELL_PROPOSAL_POLICY_RANGES) as (keyof SellProposalPolicy)[]) {
    const v = p[key];
    const [lo, hi] = SELL_PROPOSAL_POLICY_RANGES[key];
    if (!isFiniteNumber(v)) problems.push(`${key} 숫자 아님(${JSON.stringify(v) ?? String(v)})`);
    else if (v < lo || v > hi) problems.push(`${key}=${v} 범위 [${lo}, ${hi}] 밖`);
  }
  if (problems.length === 0 && (p.reboundExitPct as number) >= (p.stopPct as number)) {
    problems.push(`reboundExitPct(${String(p.reboundExitPct)}) ≥ stopPct(${String(p.stopPct)}) — 철회 밴드가 진입가 위로 넘어간다`);
  }
  return problems;
}

const fmtW = (v: number) => Math.round(v).toLocaleString('ko-KR');
const fmtPct = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;

/**
 * 보유 포지션 1건에 대한 매도 제안 판정.
 *
 * @param state        `position_state` 행 — 진입가는 KIS 잔고의 매입평균(`pchs_avg_pric`)이다
 * @param ticker       현재 시세 — `price` 만 쓴다(국내 원화, 해외는 원화 환산가). USD 원가는 읽지 않는다:
 *                     통화 경계는 `currency-mixing-fence.test.ts` 가 파일 목록으로 고정하고 있고,
 *                     USD 병기는 2단계 메시지에서 `display-amount` 경유로 리뷰와 함께 넣는다.
 * @param policy       `readSellProposalPreviewPolicy()` 가 검증한 임계값
 * @param lastDecision 같은 종목의 직전 제안 결정. 1단계는 항상 null
 */
export function evaluateSellProposal(
  state: PositionState,
  ticker: Ticker,
  policy: SellProposalPolicy,
  lastDecision: SellProposalLastDecision | null,
): SellProposalEvaluation {
  // ── 0) 정책 ────────────────────────────────────────────────────────────
  if (validateSellProposalPolicy(policy).length > 0) {
    return { verdict: 'skip', reason: 'policy_invalid', pnlPct: null, thresholdPct: null };
  }
  const thresholdPct = -policy.stopPct;

  // ── 1) 입력 값 ─────────────────────────────────────────────────────────
  const price = ticker?.price;
  if (!isFiniteNumber(price) || price <= 0) {
    return { verdict: 'skip', reason: 'price_invalid', pnlPct: null, thresholdPct };
  }
  const entry = state?.entryPrice;
  if (!isFiniteNumber(entry) || entry <= 0) {
    return { verdict: 'skip', reason: 'entry_invalid', pnlPct: null, thresholdPct };
  }

  // 단위 sanity — 자동 엔진과 같은 상수(단일 소스). USD 평단 × KRW 시세 같은 불일치는 손익을
  // 수천 % 로 만들어 엉뚱한 제안을 낳는다(2026-05-13 사고 유형).
  const ratio = price / entry;
  if (ratio < EXIT_UNIT_RATIO_MIN || ratio > EXIT_UNIT_RATIO_MAX) {
    return { verdict: 'skip', reason: 'unit_mismatch', pnlPct: null, thresholdPct };
  }
  const pnlPct = round6((price - entry) / entry * 100);

  const qty = state.qty;
  if (!isFiniteNumber(qty) || qty <= 0) {
    return { verdict: 'skip', reason: 'no_position', pnlPct, thresholdPct };
  }
  // 주식은 정수 주만 주문된다. 1주 미만이면 제안해도 승인 시 주문이 성립하지 않는다.
  const quantity = Math.floor(qty);
  if (quantity < 1) {
    return { verdict: 'skip', reason: 'quantity_below_min', pnlPct, thresholdPct };
  }

  // ── 2) 직전 결정에 따른 판정 ────────────────────────────────────────────
  let trigger: SellProposalTrigger;
  let referencePrice: number | null = null;

  if (lastDecision == null) {
    if (pnlPct > thresholdPct) return { verdict: 'skip', reason: 'above_threshold', pnlPct, thresholdPct };
    trigger = 'stop';
  } else if (lastDecision.status === 'active') {
    // 히스테리시스 — 임계값 위로 reboundExitPct 이상 회복해야 철회한다(경계 떨림 방지).
    if (pnlPct >= round6(thresholdPct + policy.reboundExitPct)) {
      return { verdict: 'skip', reason: 'rebound_withdraw', pnlPct, thresholdPct };
    }
    trigger = 'hold';
    referencePrice = isFiniteNumber(lastDecision.referencePrice) ? lastDecision.referencePrice : null;
  } else if (
    lastDecision.status === 'rejected'
    || lastDecision.status === 'expired'
    || lastDecision.status === 'superseded'
  ) {
    if (pnlPct > thresholdPct) return { verdict: 'skip', reason: 'above_threshold', pnlPct, thresholdPct };
    const ref = lastDecision.referencePrice;
    if (!isFiniteNumber(ref) || ref <= 0) {
      return { verdict: 'skip', reason: 'reference_invalid', pnlPct, thresholdPct };
    }
    const dropFromRefPct = round6((price - ref) / ref * 100);
    if (dropFromRefPct > -policy.restepPct) {
      return { verdict: 'skip', reason: 'restep_not_met', pnlPct, thresholdPct };
    }
    trigger = 'restep';
    referencePrice = ref;
  } else {
    return { verdict: 'skip', reason: 'decision_invalid', pnlPct, thresholdPct };
  }

  // ── 3) 제안 초안 — 전량·시장가 (사용자 확정 Q4·Q5: 금액 상한 없음, 전량만) ──────────
  const head = trigger === 'restep' ? '[손절 재제안]' : '[손절 제안]';
  const refNote = trigger === 'restep' && referencePrice != null
    ? ` · 직전 제안가 ₩${fmtW(referencePrice)} 대비 추가 −${policy.restepPct}% 이상 하락`
    : '';
  const reasoning =
    `${head} 손익 ${fmtPct(pnlPct)} ≤ -${policy.stopPct}% `
    + `(진입 ₩${fmtW(entry)} KIS 매입평균 → 현재 ₩${fmtW(price)})${refNote}`;

  const draft: SellProposalDraft = {
    strategyId: SELL_PROPOSAL_STRATEGY_ID,
    symbol: state.symbol,
    side: 'sell',
    orderType: 'market',
    price,
    quantity,
    amountKRW: Math.round(quantity * price),
    reasoning,
    indicators: {
      proposal: {
        kind: 'stop_loss',
        trigger,
        entry_price: entry,
        current_price: price,
        pnl_pct: Number(pnlPct.toFixed(4)),
        threshold_pct: thresholdPct,
        reference_price: referencePrice,
      },
    },
  };

  return { verdict: 'pass', kind: 'stop_loss', trigger, pnlPct, thresholdPct, draft };
}
