/**
 * T-097 — "주가(수량) 먼저, 결과 금액으로 처리" 사이징의 **순수 계산**과 기록 형태.
 *
 * 확정 설계(task `T-097-price-first-sizing.md` §사용자 설계 결정과 확정 설계):
 *  1. 수량 규칙은 그대로(`floor(금액 ÷ 가격)`, 0 이면 불성립). 최소 1주는 옵션(기본 OFF, 이번에는 아무 호출부도 켜지 않음).
 *  2. 한도 판정 금액 = `max(목표금액, 실현액)` — 단 **옵션이 실제로 적용된 경우(0주 → 1주)에만** 계산한다. 그 밖(옵션 OFF·옵션 ON 이지만
 *     내림이 1주 이상)은 목표금액을 **값 비교 없이 그대로** 쓴다 → 옵션 OFF 에서 주문 요청이 모든 입력에 대해 T-097 이전과 같다
 *     (Codex C2: 고정 허용치로 잡음을 거르던 1·2라운드 방식은 3.5e13 원 이상 금액에서 곱셈 오차가 허용치를 넘었다).
 *  3. 시그널 생성 시 `indicators.sizing` 에 이 계산을 남긴다(DDL 없음). `signals.amount_krw`·`orders.amount_krw` 의 의미는 그대로.
 *
 * 이 파일은 I/O 가 없다. DB·환율 조회·주문 송신을 하지 않는다.
 */
import type { Market } from '@/lib/exchanges/kis-symbols';
import { overseasLimitUnitUsd } from './signal-cash-gate';

/** 기록 규칙 버전. 규칙이 바뀌면 값을 올려 사후검증(T-072 표본·H-G)이 섞이지 않게 한다. */
export const SIZING_RULE = 'qty_first_v1' as const;

/** 수량이 어디서 왔나(기록용). 한도 기준 금액을 올릴지는 이것이 아니라 `minOneShareApplied` 로 정한다. */
export type SizingQuantitySource =
  /** 지정가 + 수량 미지정 → 금액 ÷ 가격으로 정했다(최소 1주 옵션이 적용될 수 있는 유일한 출처) */
  | 'amount'
  /** 시그널이 수량을 들고 왔다(exit-engine 보유수량·직접 주문 등) — 한도 기준 금액은 목표금액 그대로(현행) */
  | 'requested'
  /** 여기서 수량을 정하지 않았다(시장가 등 — 어댑터가 금액에서 파생) */
  | 'unresolved';

/**
 * 시그널 행 `indicators.sizing` 에 남기는 값. 생성 시점의 계산이며, 승인 시점 주문은 그때의 호가 추격 설정으로 다시 계산된다.
 *
 * | 필드 | 의미 |
 * |---|---|
 * | `targetKrw` | 시그널 금액(= `signals.amount_krw`, 엔진 슬롯) |
 * | `quantity` | 주문 수량(정수). `0` = 1주 미만 불성립, `null` = 여기서 미확정 |
 * | `unitPriceKrw` | 호가 추격까지 반영된 지정가(원). 해외도 **원화 환산값**(실제 송신 단가는 정수 달러로 반올림 — ±$0.5/주) |
 * | `realizedKrw` | `quantity × unitPriceKrw`(원). 수량이 0·미확정이면 `null` |
 * | `limitBasisKrw` | 안전 한도(1회·일일)가 볼 금액 = 주문 요청 `amountKRW`. 최소 1주 옵션이 적용됐으면 `max(목표, 실현액)`, 아니면 목표 그대로 |
 */
export interface SizingSnapshot {
  rule: typeof SIZING_RULE;
  targetKrw: number;
  quantity: number | null;
  unitPriceKrw: number | null;
  realizedKrw: number | null;
  limitBasisKrw: number;
  quantitySource: SizingQuantitySource;
  /** `minOneShare` 옵션으로 0주를 1주로 올렸는가(옵션 OFF 면 항상 false) */
  minOneShareApplied: boolean;
  /** 이 계산에 쓴 호가 추격 비율(0.005 = +0.5%). 0 이면 추격 없음 */
  chasePct: number;
}

function isPositiveFinite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/**
 * 실현액(원) = 수량 × 단가. 수량이 양의 정수가 아니거나 단가가 비정상이면 `null`.
 *
 * 해외는 단가가 **원화 환산값**이다. `fxRate` 를 주면 실제 송신 단가와 같은 계산(`overseasLimitUnitUsd` — 어댑터의
 * 정수 달러 반올림)으로 `수량 × USD 단가 × 환율` 을 돌려준다. 주지 않으면 원화 환산 단가 그대로 곱한다(정수 달러 반올림 오차 ±$0.5/주,
 * 단가 $50 에서 약 ±1%). 2026-10-26 기준 주문 경로(`buildOrderRequest`)는 동기 함수라 환율이 없어 후자를 쓴다 — T-097 Developer 보고 참고.
 */
export function computeRealizedKrw(args: {
  market: Market;
  quantity: number | null | undefined;
  unitPriceKrw: number | null | undefined;
  fxRate?: number | null;
}): number | null {
  const { market, quantity, unitPriceKrw, fxRate } = args;
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity <= 0) return null;
  if (!isPositiveFinite(unitPriceKrw)) return null;
  if (market === 'overseas' && fxRate != null) {
    if (!isPositiveFinite(fxRate)) return null;
    const unitUsd = overseasLimitUnitUsd(unitPriceKrw, fxRate);
    if (unitUsd == null) return null;
    return quantity * unitUsd * fxRate;
  }
  return quantity * unitPriceKrw;
}

/**
 * 한도 판정 금액 = `max(목표금액, 실현액)` (설계 2, Q-C "보수적").
 *
 *  - 목표금액이 유한한 양수가 아니면(NaN·0·음수·숫자가 아닌 값) **받은 값을 그대로** 돌려준다 — 오늘처럼 한도 검사(`checkOrderMax` 의
 *    `!(amount > 0)`)가 막게 둔다. 실현액으로 "고쳐" 주면 막혀야 할 주문이 통과할 수 있다.
 *  - 실현액이 없거나 비정상이면 목표금액.
 *  - 그 밖은 엄격한 `max` — 허용치 없음. 이 함수는 옵션이 적용된 경우에만 불린다({@link computeSizingSnapshot}): 그때는 내림이 0주였으므로
 *    `fl(목표 ÷ 단가) < 1` → 단가 > 목표(정확히 반올림되는 나눗셈의 단조성) → 실현액(1 × 단가) > 목표라 잡음을 거를 일이 없다.
 */
export function limitBasisKrw(targetKrw: number, realizedKrw: number | null | undefined): number {
  if (!isPositiveFinite(targetKrw)) return targetKrw;
  if (realizedKrw == null || !Number.isFinite(realizedKrw)) return targetKrw;
  return realizedKrw > targetKrw ? realizedKrw : targetKrw;
}

/**
 * 사이징 결과를 기록 형태로 만든다. `limitBasisKrw` 는 주문 요청의 `amountKRW` 로 그대로 쓰인다(`buildOrderRequest`).
 *
 * 🔴 한도 기준을 실현액으로 올리는 것은 **최소 1주 옵션이 실제로 적용됐을 때(`minOneShareApplied === true`)만**이다 — 값 비교가 아니라 분기다.
 *  - 옵션 OFF(기본): `limitBasisKrw` 는 언제나 `targetKrw` 그 자체 → 주문 요청 `amountKRW` 가 T-097 이전과 모든 입력에서 같다.
 *  - 옵션 ON 이지만 내림이 1주 이상: 실현액 ≤ 목표(수학적으로)라 올릴 이유가 없고, 부동소수점 곱셈 오차로 올라가는 일도 막는다.
 *  - 수량을 들고 온 주문(`requested`)·시장가(`unresolved`)는 옵션이 적용되지 않으므로 목표 그대로(현행). `requested` 에 max 를 적용하면
 *    오늘 통과하는 매수가 한도에서 막히는 동작 변경이라 이번 범위 밖이다(Reviewer 동의).
 */
export function computeSizingSnapshot(args: {
  market: Market;
  targetKrw: number;
  quantity: number | undefined;
  unitPriceKrw: number | null | undefined;
  quantitySource: SizingQuantitySource;
  minOneShareApplied?: boolean;
  chasePct: number;
  fxRate?: number | null;
}): SizingSnapshot {
  const realizedKrw = computeRealizedKrw({
    market: args.market, quantity: args.quantity, unitPriceKrw: args.unitPriceKrw, fxRate: args.fxRate,
  });
  const basis = args.minOneShareApplied === true ? limitBasisKrw(args.targetKrw, realizedKrw) : args.targetKrw;
  return {
    rule: SIZING_RULE,
    targetKrw: args.targetKrw,
    quantity: args.quantity ?? null,
    unitPriceKrw: isPositiveFinite(args.unitPriceKrw) ? args.unitPriceKrw : null,
    realizedKrw,
    limitBasisKrw: basis,
    quantitySource: args.quantitySource,
    minOneShareApplied: args.minOneShareApplied === true,
    chasePct: args.chasePct,
  };
}

/**
 * `indicators` 에 `sizing` 키를 붙인 새 값을 돌려준다(원본 불변).
 *  - `null`·`undefined` → `{ sizing }`
 *  - 일반 객체 → `{ ...indicators, sizing }` (호출부가 `sizing` 을 미리 넣어 왔어도 서버 계산으로 덮는다)
 *  - 배열·문자열 등 → 그대로(붙일 자리가 없다. 기록만 생략)
 */
export function attachSizingSnapshot(indicators: unknown, sizing: SizingSnapshot): unknown {
  if (indicators == null) return { sizing };
  if (typeof indicators === 'object' && !Array.isArray(indicators)) {
    return { ...(indicators as Record<string, unknown>), sizing };
  }
  return indicators;
}

/**
 * 저장된 `indicators` 에서 `sizing` 을 읽는다(4번 텔레그램 줄이 쓸 읽기 경로). 규칙 버전이 다르거나 형태가 깨졌으면 `null`.
 * `indicators` 는 객체 또는 JSON 문자열(DB 행 그대로) 모두 받는다.
 */
export function readSizingSnapshot(indicators: unknown): SizingSnapshot | null {
  let obj: unknown = indicators;
  if (typeof obj === 'string') {
    try { obj = JSON.parse(obj); } catch { return null; }
  }
  if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const s = (obj as Record<string, unknown>)['sizing'];
  if (s == null || typeof s !== 'object' || Array.isArray(s)) return null;
  const r = s as Record<string, unknown>;
  if (r.rule !== SIZING_RULE) return null;
  if (!isPositiveFinite(r.targetKrw) || !isPositiveFinite(r.limitBasisKrw)) return null;
  const q = r.quantity;
  if (!(q === null || (typeof q === 'number' && Number.isInteger(q) && q >= 0))) return null;
  const numOrNull = (v: unknown): number | null => (isPositiveFinite(v) ? v : null);
  const src = r.quantitySource;
  return {
    rule: SIZING_RULE,
    targetKrw: r.targetKrw,
    quantity: q as number | null,
    unitPriceKrw: numOrNull(r.unitPriceKrw),
    realizedKrw: numOrNull(r.realizedKrw),
    limitBasisKrw: r.limitBasisKrw,
    quantitySource: src === 'amount' || src === 'requested' || src === 'unresolved' ? src : 'unresolved',
    minOneShareApplied: r.minOneShareApplied === true,
    chasePct: typeof r.chasePct === 'number' && Number.isFinite(r.chasePct) ? r.chasePct : 0,
  };
}
