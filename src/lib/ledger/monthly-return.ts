/**
 * T-081 WP-F — **월 수익률(수정 Dietz, KST 달력월)** 순수 함수. DB·네트워크·시계 사용 0 — 스냅샷·원장 행·`now` 는 인자로 받는다.
 *
 * 정책 근거: 통합 절차 §8.2(월 지표는 실현/평가·원통화/환율·비용·외부 입출금 경계를 명시하고, 결측·분모 오류는 불명으로 표시),
 * S00 보고서 §7 C05(수정 Dietz, KST 달력월, 선결 = USD 행 정의·원장 기준). 이 함수는 -5% 재평가 사건 판정·알림·DB 쓰기를 하지 않는다.
 * T-074 `computeSummary`(기준 이후 누적 성과)를 이름만 바꾼 것이 아니다 — 기간이 달력월이고, 끝점이 그 달 경계 스냅샷이다.
 *
 * ## 식
 *   R = (E_end − E_start − ΣF) ÷ (E_start + Σ w_i·F_i) × 100,   w_i = (t_end − t_i) ÷ (t_end − t_start)
 *   F = 외부 순입금(입금 +, 출금 −, 원화 환산). **환전은 F 가 아니다**(통화 간 이동, 아래 '환전 비용').
 *   gainKrw = E_end − E_start − ΣF  ← §8.2 의 금액식. 수익률은 같은 분자를 쓰므로 금액식과 대사된다.
 *
 * ## 설계 결정 (근거)
 * 1. **측정 창 = 경계 스냅샷 시각**, 달력 경계 그 자체가 아니다.
 *    E_start = 월 시작(KST 1일 00:00) 이하 마지막 스냅샷, E_end = 기간 끝(월 말 24:00 또는 `now`) 이하 마지막 스냅샷.
 *    흐름은 `t_start < t ≤ t_end`(스냅샷 시각 기준)에 들 때만 F 로 센다. 가중치 T 도 t_end − t_start 다.
 *    이유: 총자산은 스냅샷 시각에만 관측된다. 달력 경계로 흐름을 고르면 "마지막 스냅샷(23:00) 뒤 23:30 입금"이 E_end 에는
 *    없는데 F 에서는 빠져 가짜 손실이 되고, 반대로 "전월 말 스냅샷 뒤·자정 전 입금"은 E_end 에는 있는데 F 에 없어 가짜 수익이 된다.
 *    `t ≤ t_end` 는 원장 매칭 규칙(`predictAnchor`: 직전 스냅샷 < t ≤ 그 스냅샷 = 그 스냅샷에 반영)과 같다.
 *    이 규칙이면 M월의 E_end 스냅샷과 M+1월의 E_start 스냅샷이 같은 행이 되어 달끼리 끊김·겹침 없이 이어진다.
 *    흐름 시각은 반영된(matched) 기록이면 반영 스냅샷 시각, 아니면 기록 시각(`computeSummary` 와 같다).
 * 2. **환전 비용**: 환전은 F 에 넣지 않는다(금액이 있어도 무시). 스프레드·수수료는 총자산 하락으로 E_end 에 이미 들어가 있으므로
 *    투자 비용(수익률을 깎는 쪽)으로 남긴다. 비용을 F 로 빼면 실제로 잃은 돈이 수익률에서 사라진다(T-074 머리말과 같은 판단).
 * 3. **원장 기준(`cash_ledger_baseline.at`) 없음 → 불명.** 기준이 없으면 원장이 그 기간에 완전하다는 보장이 없다 — 흐름 0건이
 *    "입출금 없음"인지 "아직 안 적음"인지 구별할 수 없고, 안 적힌 입금은 그대로 수익률이 된다(S01 수용 기준 1 "입금 수익화 금지").
 *    10-23 처럼 원장 밖 입금·환전이 실제로 있었으므로 '부분'으로 숫자를 보여 주지 않는다. 기준이 측정 창 안(t_start 보다 뒤)이면
 *    창 앞부분의 흐름이 원장 밖일 수 있어 역시 불명, 창 안 흐름의 기록 시각이 기준 이전이어도 불명.
 * 4. **USD 가려짐**(T-080): 끝점 스냅샷의 USD 행이 qty 0 이고 직전 20h 안에 양수 행이 있으면 `src/lib/safety/hidden-usd-carry.ts` 의
 *    `assessHiddenUsdCarry` 로 이월 보정한 총액을 쓴다(`usdHiddenAdjusted=true`). 새로 구현하지 않고 **그 함수를 재사용**한다 —
 *    가려짐 판정·이월값·매수 정황 가드(중간 행 포함)·환율 범위가 감사된 한 구현에만 있어야 둘이 갈라지지 않는다.
 *    단 **import 하지 않고 인자(`deps.assessHiddenUsd`)로 주입**받는다: T-074 정적 불변식(`static-invariants.test.ts` 3번)이
 *    `src/lib/ledger/**` 가 `@/lib/safety/*` 를 import 하는 것을 막는다(type import 포함). 시그니처는 구조적으로 맞춰 두어
 *    호출자(원장 밖)가 `assessHiddenUsdCarry` 를 그대로 넘기면 된다(시험이 실제 함수를 넘겨 고정한다).
 *    **주입이 없으면 fail-closed**: 끝점에 가려진 USD 행이 하나라도 있으면 불명(`usd_hidden_assessor_missing`).
 *    그 함수의 `suppress`·임계·대칭 판정(킬스위치 보류용)은 쓰지 않고, 쪽별 결과(`baseline`·`current` 의 state·adjustedTotal)만 읽는다.
 *    이월할 수 없는 가려짐(근거 없음·20h 초과·매수 정황·환율 범위 밖·판독 불가)은 **불명** — 오차가 USD 비중(최대 약 11%)이라
 *    월 -5% 판단을 뒤집을 수 있는 크기여서 '부분' 숫자로 보이면 안 된다.
 *    USD 행이 한쪽에만 있으면(예: T-056 이전 스냅샷 → 이후 스냅샷) 총액 정의가 달라 **불명**, 양쪽 다 없으면 정의는 같지만 달러 예수금이
 *    총액에 없을 수 있어 **부분**.
 * 5. **허용 오차**(스냅샷 크론은 시간당, 양 시장 마감 중에는 90분 안 스냅샷이 있으면 건너뛰므로 정상 간격은 최대 약 2시간):
 *    - 끝: 기간 끝 이전 3h(`END_MAX_AGE_MS`) 밖이면 불명 — 정상 간격 2h + 여유 1h. 그보다 낡으면 크론 장애로 본다.
 *    - 시작: 3h(`START_FRESH_MS`) 안이면 정상, 3h~36h(`START_MAX_AGE_MS`)는 **부분**(그 사이 시장 변동이 이번 달로 넘어온다),
 *      36h 밖이면 불명. 36h = 하루 크론 장애 + 여유. 시작 쪽만 완화한 이유: 끝점은 그 달 값 자체라 엄격해야 하고, 시작점은
 *      직전 달 마지막 관측이 조금 낡아도 이번 달 수익률의 오염은 그 사이 변동분뿐이며 '부분'으로 드러난다.
 * 6. 반영 대기(`pending`) 기록이 창 안에 있으면 기록대로 F 에 넣고 **부분**(스냅샷 매칭 전이라 반영 시각이 불확실).
 *
 * ## 2차 (Reviewer 16:20 판정 반영 — H-1·H-2·M-1~M-4·L)
 * 7. (H-1) 이월을 쓴 쪽의 (마지막 양수 관측 `lastSeenMs`, 그 가려진 스냅샷] 구간에 **환전 기록 또는 통화 USD 입출금 기록**이
 *    있으면(기록 시각·반영 시각 중 하나라도 구간 안, 측정 창 밖이어도) 이월 불가 → 불명(`usd_hidden_flow_in_gap`).
 *    이월은 "마지막으로 보인 달러가 그대로 있다"는 가정이라, 그 사이 KRW→USD 환전(10-23 사건과 같은 모양)·USD 입출금이 있으면
 *    이월값이 틀린다. `lastSeenMs` 를 모르면 검사할 수 없으므로 역시 불명. 기록되지 않은 환전·출금은 못 잡으므로 이월을 쓴 달은
 *    항상 **부분**(`usd_hidden_carried_unverifiable_exchange`).
 * 8. (H-2) 원장 완전성 신호 `openLedgerCandidates` **필수**: T-074 `detectCandidates` 출력(기록 안 된 입출금 후보)을 그대로 넘긴다.
 *    미제공 → 불명(`ledger_completeness_unknown`), 측정 창 (S0, S1] 안 시각의 `open` 후보가 하나라도 있으면 불명(`ledger_open_candidates`).
 *    기준이 있어도 안 적힌 입금은 수익률이 되기 때문이다(흐름 0건 10,000,000→15,000,000 이 +50% 로 나오던 경로). `dismissed`(사용자가
 *    '입출금 아님'으로 표시) 후보는 세지 않는다. 시각을 읽을 수 없는 open 후보는 창 안으로 본다(불명).
 * 9. (M-1) 창 안에 `unmatched`(스냅샷에서 맞는 현금 변화를 못 찾음) 또는 반영 상태가 없는 기록이 있으면 **부분**(`flow_unmatched`) —
 *    T-074 `computeSummary` 가 같은 상태를 `unmatched` 건수로 세어 경고하는 것과 같다. 금액은 기록대로 F 에 넣는다.
 * 10. (M-2) 수익률 < −100% → 불명(`return_below_minus_100`, 무레버리지 계좌에서 불가능 — 수정 Dietz 근사가 깨진 신호).
 *    분모 < 시작 총자산 × `LARGE_FLOW_DENOM_MIN_RATIO` 또는 |단일 흐름| > 시작 총자산 × `LARGE_FLOW_SINGLE_MAX_RATIO` → **부분**(`large_flow`):
 *    큰 흐름은 반영 시각 오차(스냅샷 간격)가 곧 수익률 오차가 된다. 두 임계는 **제안값, 정책 결정 대기**.
 * 11. (M-3) 끝점 USD 행의 미결제 매도 대금(`ustl_sll_amt_smtl`, T-056: 총액에 넣지 않음·체결기준 여부 미판별)이 양수면 **부분**
 *    (`usd_unsettled_sale`). `parseSnapshotRow` 는 이 값을 노출하지 않는다. 그래서 (a) 입력 선택 필드 `unsettledSaleUsd` 가 있으면 그 값을,
 *    (b) 없으면 positions 행 중 `ustl_sll_amt_smtl` 필드를 가진 행을 본다(크론이 이 필드를 USD 행에만 쓴다 —
 *    `portfolio-snapshot/route.ts`). (b) 는 통화 비교를 하지 않으므로 T-056 울타리의 USD 비교 지점을 늘리지 않는다.
 *    필드가 있는데 숫자로 읽을 수 없으면 양수와 같게 본다(부분).
 * 12. (M-4) 끝점과 같은 ms 의 스냅샷이 둘 이상이고 총액 또는 positions 가 다르면 불명(`snapshot_ts_conflict`). 리뷰어 제안(총액 차이)보다
 *    엄격하게 positions 차이도 막는다 — 총액이 같아도 positions 가 다르면 USD 판독·이월이 입력 순서에 따라 달라지기 때문이다.
 *    완전히 같으면 하나로 본다(어느 행을 골라도 결과가 같다).
 * 13. (L) 끝 시각 정의의 한계를 결과 필드 `periodEndNote` 로 드러낸다: `kst_month_end_midsession`(KST 월 말 24:00 = 미국 정규장 중간 시세,
 *    C05 "미국 폐장 후 확정"과 다를 수 있음) / `in_progress_now`(진행 중인 달).
 *
 * ## 하지 않는 것 / 한계
 * - "미국 폐장 후 확정"(C05)은 끝 시각을 KST 월 말 24:00 로 둔 이번 정의와 다르게 해석될 수 있다(24:00 은 미국 정규장 중간).
 *   끝 시각 정의는 정책 결정 사항이다 — 이 함수는 리더 지시대로 24:00(진행 중이면 now)을 쓴다.
 * - 스냅샷 총액의 현금 정의(USD 행 의미 R08, KIS 와의 $ 불일치)는 그대로 받는다. T-074 기준의 '확인 현금' 보정은 쓰지 않는다.
 * - 주입 평가기와 `HiddenUsdAssessor` 의 구조적 호환은 **이 파일 안에서 컴파일 시 점검할 방법이 없다**: 실제 함수 타입을 참조하려면
 *   safety 를 import(type import 포함)해야 하는데 T-074 정적 불변식이 막는다. 시험이 실제 함수를 대입하지만 tsconfig 가 시험을 제외하고
 *   jest(swc)는 타입을 지우므로 CI 가 강제하지 않는다 — 호출부 연결 task 에서 실제 대입이 타입 검사되는 소스(원장 밖)에 두어야 한다.
 *   시험은 대신 실제 반환값의 필드 모양을 런타임으로 점검한다.
 */
// safety 모듈은 import 하지 않는다(위 4번). 원장 안의 순수 모듈만 쓴다.
import { parseSnapshotRow } from './snapshots';
import { parseKstWall } from './kst';
import { isUsd } from './rules';
import type { CandidateView } from './types';

const HOUR_MS = 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * HOUR_MS;

/** 끝 스냅샷 허용 나이 — 넘으면 불명 */
export const END_MAX_AGE_MS = 3 * HOUR_MS;
/** 시작 스냅샷이 이 안이면 정상 */
export const START_FRESH_MS = 3 * HOUR_MS;
/** 시작 스냅샷 허용 나이 — 넘으면 불명(START_FRESH_MS ~ 이 값은 부분) */
export const START_MAX_AGE_MS = 36 * HOUR_MS;
/** `assessHiddenUsdCarry` 필수 인자 — 쓰지 않는 `suppress` 계산용 자리값(결과의 suppress 는 읽지 않는다) */
const UNUSED_THRESHOLD_PCT = 10;
/** (M-2) 분모가 시작 총자산의 이 비율보다 작으면 부분 — **제안값, 정책 결정 대기** */
export const LARGE_FLOW_DENOM_MIN_RATIO = 0.5;
/** (M-2) 단일 흐름 절대값이 시작 총자산의 이 비율보다 크면 부분 — **제안값, 정책 결정 대기** */
export const LARGE_FLOW_SINGLE_MAX_RATIO = 0.5;
/** (M-2) 이보다 낮은 수익률(%)은 불명 */
export const RETURN_FLOOR_PCT = -100;

export interface MonthlySnapshotInput {
  /** 스냅샷 순간(instant) — mysql2(`timezone:'+09:00'`)가 돌려주는 Date 그대로 */
  ts: Date;
  /** `portfolio_snapshots.total_krw` */
  totalKrw: number;
  /** `portfolio_snapshots.positions` 원본(JSON 문자열 또는 배열) — USD 행 판독·이월 근거에 쓴다 */
  positions: unknown;
  /** (M-3) 미결제 매도 대금($) — 주면 positions 의 `ustl_sll_amt_smtl` 대신 이 값을 본다. 없으면 positions 에서 읽는다 */
  unsettledSaleUsd?: number | null;
}

export type MonthlyFlowKind = 'deposit' | 'withdrawal' | 'exchange';

export interface MonthlyFlowInput {
  /** `cash_flow_ledger.kind`. 취소·정정으로 대체된 행은 호출자가 빼고 넘긴다 */
  kind: MonthlyFlowKind;
  currency: 'KRW' | 'USD';
  /** 기록 시각(순간, KST 분 단위 입력) */
  occurredAt: Date;
  /** 반영 스냅샷 시각 — `anchorStatus='matched'` 일 때만 쓴다 */
  reflectedAt?: Date | null;
  /** 원장 반영 상태. 없으면 `unmatched` 와 같게 본다(부분) */
  anchorStatus?: 'pending' | 'matched' | 'unmatched';
  /** 원화 환산액(양수, 방향은 kind). 입출금인데 null·NaN·0 이하이면 불명. 환전은 무시 */
  amountKrwEquiv: number | null;
}

export interface MonthlyReturnInput {
  /** 'YYYY-MM' (KST 달력월) */
  month: string;
  now: Date;
  snapshots: readonly MonthlySnapshotInput[];
  flows: readonly MonthlyFlowInput[];
  /** `cash_ledger_baseline.at`(순간). 없으면 불명 */
  baselineAt?: Date | null;
  /**
   * (H-2) 원장 완전성 신호 — T-074 `detectCandidates` 출력 그대로(기록 안 된 입출금 후보). **필수**: 미제공이면 불명.
   * `ts` 는 후보 스냅샷의 KST 벽시계('YYYY-MM-DD HH:mm:ss'), `state='dismissed'` 는 세지 않는다.
   */
  openLedgerCandidates: readonly Pick<CandidateView, 'ts' | 'state'>[] | undefined;
}

/** 스냅샷 positions 한 행 — `snapshot-composition.ts` `CompositionPosition` 과 같은 모양(구조적 호환) */
export interface UsdPositionLike {
  currency: string;
  value_krw: number;
  qty?: number;
  price?: number;
}

/** 주입받는 가려짐 평가기의 쪽별 결과 — `hidden-usd-carry.ts` `CarrySide` 의 부분집합 */
export interface HiddenUsdSideLike {
  /** 'absent' | 'visible' | 'hidden_carried' | 'hidden_*'(이월 불가) | 'unknown' */
  state: string;
  carriedQty: number;
  carriedPrice: number;
  carriedKRW: number;
  adjustedTotal: number;
  /** 이월에 쓴 마지막 양수 USD 스냅샷 시각(ms) — `CarrySide.lastSeenMs` 와 같다 */
  lastSeenMs: number | null;
}

/** `assessHiddenUsdCarry` 와 구조적으로 같은 시그니처 — 호출자가 그 함수를 그대로 넘긴다 */
export type HiddenUsdAssessor = (input: {
  baseline: { ts: unknown; total: number; positions: UsdPositionLike[] | null };
  current: { ts: unknown; total: number; positions: UsdPositionLike[] | null };
  priors: readonly { ts: unknown; positions: unknown }[];
  thresholdPct: number;
}) => { baseline: HiddenUsdSideLike; current: HiddenUsdSideLike };

export interface MonthlyReturnDeps {
  /** 없으면 가려진 USD 끝점은 불명(fail-closed) */
  assessHiddenUsd?: HiddenUsdAssessor;
}

export type MonthlyReturnStatus = 'ok' | 'partial' | 'unknown';

export interface MonthlyReturnResult {
  month: string;
  status: MonthlyReturnStatus;
  /** % (음수 = 손실). unknown 이면 null */
  returnPct: number | null;
  /** E_end − E_start − ΣF (원). unknown 이면 null */
  gainKrw: number | null;
  startEquityKrw: number | null;
  endEquityKrw: number | null;
  netFlowKrw: number | null;
  denominatorKrw: number | null;
  periodEnd: 'month_end' | 'now';
  /** (L) 끝 시각 정의의 한계 표시 — 위 13번. month 를 읽지 못했거나 시작 전 달이면 null */
  periodEndNote: 'kst_month_end_midsession' | 'in_progress_now' | null;
  /** 달력 기간 [시작, 끝] (순간) — month 를 읽을 수 없으면 null */
  periodStartAt: Date | null;
  periodEndAt: Date | null;
  /** 실제 측정 창 = 경계 스냅샷 시각 */
  startSnapshotAt: Date | null;
  endSnapshotAt: Date | null;
  /** F 로 센 입출금 건수 */
  flowCount: number;
  /** '코드: 설명' 목록 — unknown/partial 사유와 참고 사항 */
  reasons: string[];
  usdHiddenAdjusted: boolean;
}

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** 'YYYY-MM' → KST 달력월 [시작, 다음 달 시작) 순간 ms. Asia/Seoul 은 서머타임이 없어 +9h 고정. */
export function kstMonthRange(month: string): { startMs: number; endMs: number } | null {
  const m = typeof month === 'string' ? MONTH_RE.exec(month) : null;
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  return {
    startMs: Date.UTC(y, mo - 1, 1) - KST_OFFSET_MS,
    endMs: Date.UTC(y, mo, 1) - KST_OFFSET_MS,   // mo=12 → 다음 해 1월 1일
  };
}

function msOf(d: unknown): number | null {
  if (!(d instanceof Date)) return null;
  const t = d.getTime();
  return Number.isFinite(t) ? t : null;
}

interface Snap { ms: number; total: number; positions: unknown; idx: number; unsettledSaleUsd?: number | null }

/** boundary 이하 마지막 스냅샷 (같은 시각이면 입력 순서상 뒤) */
function lastAtOrBefore(series: readonly Snap[], boundary: number): Snap | null {
  let best: Snap | null = null;
  for (const s of series) {
    if (s.ms > boundary) continue;
    if (!best || s.ms > best.ms || (s.ms === best.ms && s.idx > best.idx)) best = s;
  }
  return best;
}

/** S 와 같은 ms 의 다른 행이 총액·positions·미결제 매도 입력 중 하나라도 다르면 true (M-4) — 같으면 어느 행을 골라도 결과가 같다 */
function hasTsConflict(series: readonly Snap[], s: Snap): boolean {
  const key = (x: Snap) => { try { return JSON.stringify(x.positions); } catch { return `#${x.idx}`; } };
  const k = key(s);
  return series.some((x) => x !== s && x.ms === s.ms && (x.total !== s.total || key(x) !== k || (x.unsettledSaleUsd ?? null) !== (s.unsettledSaleUsd ?? null)));
}

/** (M-3) 미결제 매도 대금 신호. 입력 필드가 있으면 그 값, 없으면 positions 의 `ustl_sll_amt_smtl` 필드(USD 행 전용 필드) */
function unsettledSale(snap: Snap, positions: readonly UsdPositionLike[]): boolean {
  const given = snap.unsettledSaleUsd;
  if (given !== undefined && given !== null) return !(typeof given === 'number' && Number.isFinite(given) && given <= 0);
  for (const p of positions) {
    if (!p || typeof p !== 'object' || !('ustl_sll_amt_smtl' in p)) continue;
    const v = (p as { ustl_sll_amt_smtl?: unknown }).ustl_sll_amt_smtl;
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    if (!Number.isFinite(n) || n > 0) return true;
  }
  return false;
}

function hiddenReason(side: '시작' | '끝', s: HiddenUsdSideLike): string {
  return `usd_hidden_not_carried: ${side} 스냅샷 USD 행이 가려졌는데 이월할 수 없음(${s.state})`;
}

/** positions 원본 → 배열. JSON 문자열이면 파싱. 배열이 아니면 null (`parseSnapshotPositions` 와 같은 의미) */
function parsePositions(raw: unknown): UsdPositionLike[] | null {
  try {
    const v: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? (v as UsdPositionLike[]) : null;
  } catch {
    return null;
  }
}

/**
 * 평가기를 주입받지 않았을 때만 쓰는 최소 판독 — 가려짐 여부만 본다(이월하지 않는다).
 * positions 의 USD 행 판독은 원장 모듈의 기존 단일 지점 `snapshots.ts` `parseSnapshotRow` 를 재사용한다
 * (T-056 울타리 `usd-cash-balance-fence.test.ts` 허용 목록의 'lib/ledger/snapshots.ts' 항목 — 새 USD 비교 지점을 만들지 않는다).
 * USD 행 없음 = absent, 센트 > 0 = visible, 0 = hidden(수량을 못 읽어 0 이 된 행도 여기 — 결과는 어차피 불명), 음수 = unknown.
 */
function localUsdState(positions: readonly UsdPositionLike[], ts: Date, total: number): 'absent' | 'visible' | 'hidden' | 'unknown' {
  const row = parseSnapshotRow({ id: 0, ts, total_krw: total, positions });
  if (!row) return 'unknown';
  if (!row.usd) return 'absent';
  if (row.usd.cents > 0) return 'visible';
  return row.usd.cents === 0 ? 'hidden' : 'unknown';
}

/**
 * @param deps.assessHiddenUsd `assessHiddenUsdCarry`(src/lib/safety/hidden-usd-carry.ts)를 넘긴다. 없으면 가려진 USD 끝점은 불명.
 */
export function computeMonthlyReturn(input: MonthlyReturnInput, deps: MonthlyReturnDeps = {}): MonthlyReturnResult {
  const blockers: string[] = [];
  const cautions: string[] = [];
  const notes: string[] = [];
  const range = kstMonthRange(input.month);
  const nowMs = msOf(input.now);

  const out: MonthlyReturnResult = {
    month: input.month, status: 'unknown', returnPct: null, gainKrw: null,
    startEquityKrw: null, endEquityKrw: null, netFlowKrw: null, denominatorKrw: null,
    periodEnd: 'month_end', periodEndNote: null, periodStartAt: null, periodEndAt: null, startSnapshotAt: null, endSnapshotAt: null,
    flowCount: 0, reasons: [], usdHiddenAdjusted: false,
  };
  const finish = (): MonthlyReturnResult => {
    out.status = blockers.length > 0 ? 'unknown' : cautions.length > 0 ? 'partial' : 'ok';
    if (out.status === 'unknown') { out.returnPct = null; out.gainKrw = null; }
    out.reasons = [...new Set([...blockers, ...cautions, ...notes])];
    return out;
  };

  if (!range) { blockers.push(`invalid_month: 'YYYY-MM' 형식이 아님(${String(input.month)})`); return finish(); }
  if (nowMs == null) { blockers.push('invalid_now: now 를 읽을 수 없음'); return finish(); }
  if (nowMs < range.startMs) {
    out.periodStartAt = new Date(range.startMs);
    blockers.push('month_not_started: 아직 시작하지 않은 달');
    return finish();
  }
  const inProgress = nowMs < range.endMs;
  const periodEndMs = inProgress ? nowMs : range.endMs;
  out.periodEnd = inProgress ? 'now' : 'month_end';
  out.periodEndNote = inProgress ? 'in_progress_now' : 'kst_month_end_midsession';
  out.periodStartAt = new Date(range.startMs);
  out.periodEndAt = new Date(periodEndMs);
  if (inProgress) notes.push('in_progress: 진행 중인 달 — 기간 끝은 now');

  // ── 스냅샷 ────────────────────────────────────────────────────────────
  const series: Snap[] = [];
  let ignoredSnaps = 0;
  const rawSnaps = Array.isArray(input.snapshots) ? input.snapshots : [];
  rawSnaps.forEach((s, idx) => {
    const ms = msOf(s?.ts);
    const total = s?.totalKrw;
    if (ms == null || typeof total !== 'number' || !Number.isFinite(total)) { ignoredSnaps++; return; }
    series.push({ ms, total, positions: s.positions, idx, unsettledSaleUsd: s.unsettledSaleUsd });
  });
  if (ignoredSnaps > 0) notes.push(`snapshot_rows_ignored: 시각·총액을 읽을 수 없는 스냅샷 ${ignoredSnaps}행 제외`);

  const S0 = lastAtOrBefore(series, range.startMs);
  const S1 = lastAtOrBefore(series, periodEndMs);
  if (!S0) blockers.push('no_start_snapshot: 월 시작 이전 스냅샷 없음');
  if (!S1) blockers.push('no_end_snapshot: 기간 끝 이전 스냅샷 없음');
  if (!S0 || !S1) return finish();
  out.startSnapshotAt = new Date(S0.ms);
  out.endSnapshotAt = new Date(S1.ms);
  if (hasTsConflict(series, S0)) blockers.push('snapshot_ts_conflict: 시작 스냅샷과 같은 시각에 내용이 다른 행이 있음');
  if (hasTsConflict(series, S1)) blockers.push('snapshot_ts_conflict: 끝 스냅샷과 같은 시각에 내용이 다른 행이 있음');

  const startAge = range.startMs - S0.ms;
  const endAge = periodEndMs - S1.ms;
  if (startAge > START_MAX_AGE_MS) blockers.push(`start_stale: 시작 스냅샷이 월 시작보다 ${(startAge / HOUR_MS).toFixed(1)}h 앞 (허용 ${START_MAX_AGE_MS / HOUR_MS}h)`);
  else if (startAge > START_FRESH_MS) cautions.push(`start_aged: 시작 스냅샷이 월 시작보다 ${(startAge / HOUR_MS).toFixed(1)}h 앞 — 그 사이 변동이 이번 달에 포함됨`);
  if (endAge > END_MAX_AGE_MS) blockers.push(`end_stale: 끝 스냅샷이 기간 끝보다 ${(endAge / HOUR_MS).toFixed(1)}h 앞 (허용 ${END_MAX_AGE_MS / HOUR_MS}h)`);
  if (!(S1.ms > S0.ms)) { blockers.push('empty_window: 월 시작 뒤 스냅샷이 없어 측정 창 길이가 0'); return finish(); }

  // ── 끝점 총액 + USD 가려짐 ───────────────────────────────────────────
  let eStart = Math.round(S0.total);
  let eEnd = Math.round(S1.total);
  const p0 = parsePositions(S0.positions);
  const p1 = parsePositions(S1.positions);
  if (p0 && unsettledSale(S0, p0)) cautions.push('usd_unsettled_sale: 시작 스냅샷에 미결제 매도 대금 — 총액 포함 여부 미판별(T-056)');
  if (p1 && unsettledSale(S1, p1)) cautions.push('usd_unsettled_sale: 끝 스냅샷에 미결제 매도 대금 — 총액 포함 여부 미판별(T-056)');
  const carriedGaps: { name: '시작' | '끝'; from: number | null; to: number }[] = [];
  if (!p0 || !p1) {
    blockers.push('positions_unreadable: 끝점 스냅샷 positions 를 읽을 수 없어 USD 가려짐 판정 불가');
  } else if (!(eStart > 0)) {
    blockers.push(`start_equity_nonpositive: 시작 총자산 ${eStart}`);
  } else if (!deps.assessHiddenUsd) {
    const local: ['시작' | '끝', ReturnType<typeof localUsdState>][] = [
      ['시작', localUsdState(p0, new Date(S0.ms), eStart)], ['끝', localUsdState(p1, new Date(S1.ms), eEnd)],
    ];
    const absent = local.filter(([, st]) => st === 'absent').length;
    for (const [name, st] of local) {
      if (st === 'unknown') blockers.push(`usd_unreadable: ${name} 스냅샷 USD 행을 읽을 수 없음`);
      else if (st === 'hidden') blockers.push(`usd_hidden_assessor_missing: ${name} 스냅샷 USD 행이 가려졌는데 이월 평가기가 주입되지 않음`);
    }
    if (absent === 1) blockers.push('usd_row_asymmetric: USD 행이 한쪽 스냅샷에만 있음 — 총자산 정의가 달라 비교 불가');
    if (absent === 2) cautions.push('usd_absent_both: 양쪽 스냅샷에 USD 행 없음 — 달러 예수금이 총자산에 빠져 있을 수 있음');
  } else {
    const blockersBefore = blockers.length;
    let a: { baseline: HiddenUsdSideLike; current: HiddenUsdSideLike } | null = null;
    try {
      a = deps.assessHiddenUsd({
        baseline: { ts: new Date(S0.ms), total: eStart, positions: p0 },
        current: { ts: new Date(S1.ms), total: eEnd, positions: p1 },
        priors: series.map((s) => ({ ts: new Date(s.ms), positions: s.positions })),
        thresholdPct: UNUSED_THRESHOLD_PCT,
      });
    } catch (e) {
      blockers.push(`usd_assessor_failed: 가려짐 평가 실패(${e instanceof Error ? e.message : String(e)})`);
    }
    const sides: ['시작' | '끝', HiddenUsdSideLike][] = a ? [['시작', a.baseline], ['끝', a.current]] : [];
    const absent = sides.filter(([, s]) => s.state === 'absent').length;
    for (const [name, s] of sides) {
      if (s.state === 'unknown') blockers.push(`usd_unreadable: ${name} 스냅샷 USD 행·시각을 읽을 수 없음`);
      else if (s.state === 'hidden_carried') {
        carriedGaps.push({ name, from: typeof s.lastSeenMs === 'number' && Number.isFinite(s.lastSeenMs) ? s.lastSeenMs : null, to: name === '시작' ? S0.ms : S1.ms });
        notes.push(`usd_hidden_carried: ${name} 스냅샷 USD 가려짐 — 직전 양수 행($${s.carriedQty} × ${s.carriedPrice})으로 ${Math.round(s.carriedKRW)}원 이월`);
      } else if (s.state !== 'absent' && s.state !== 'visible') blockers.push(hiddenReason(name, s));
    }
    if (absent === 1) blockers.push('usd_row_asymmetric: USD 행이 한쪽 스냅샷에만 있음 — 총자산 정의가 달라 비교 불가');
    if (absent === 2) cautions.push('usd_absent_both: 양쪽 스냅샷에 USD 행 없음 — 달러 예수금이 총자산에 빠져 있을 수 있음');
    // (H-1) 이월 구간 안 환전·USD 흐름 → 이월 불가. 측정 창 밖 흐름도 본다(시작점 이월은 창 시작 이전 구간이다)
    for (const g of carriedGaps) {
      if (g.from == null) { blockers.push(`usd_hidden_flow_in_gap: ${g.name} 스냅샷 이월 근거 시각을 몰라 구간 안 환전·USD 흐름을 검사할 수 없음`); continue; }
      const inGap = (t: number | null) => t != null && t > (g.from as number) && t <= g.to;
      for (const f of Array.isArray(input.flows) ? input.flows : []) {
        if (!f || !(f.kind === 'exchange' || isUsd(f.currency))) continue;
        if (inGap(msOf(f.occurredAt)) || inGap(msOf(f.reflectedAt))) {
          blockers.push(`usd_hidden_flow_in_gap: ${g.name} 스냅샷 이월 구간(마지막 양수 관측 뒤) 안에 환전 또는 USD 입출금 기록 — 이월값을 믿을 수 없음`);
          break;
        }
      }
    }
    if (a && blockers.length === blockersBefore) {   // 이 절에서 막힌 것이 없을 때만 이월값을 쓴다
      if (a.baseline.state === 'hidden_carried') { eStart = Math.round(a.baseline.adjustedTotal); out.usdHiddenAdjusted = true; }
      if (a.current.state === 'hidden_carried') { eEnd = Math.round(a.current.adjustedTotal); out.usdHiddenAdjusted = true; }
    }
    if (carriedGaps.length > 0) {
      cautions.push('usd_hidden_carried_unverifiable_exchange: USD 가려짐 이월을 씀 — 원장에 기록되지 않은 환전·출금은 검사할 수 없음');
    }
  }
  out.startEquityKrw = eStart;
  out.endEquityKrw = eEnd;

  // ── 원장 기준 ─────────────────────────────────────────────────────────
  const baseMs = input.baselineAt == null ? null : msOf(input.baselineAt);
  if (input.baselineAt == null) blockers.push('baseline_missing: 원장 기준 미설정 — 입출금 기록의 완전성을 보장할 수 없음');
  else if (baseMs == null) blockers.push('baseline_invalid: 원장 기준 시각을 읽을 수 없음');
  else if (baseMs > S0.ms) blockers.push('baseline_inside_window: 원장 기준이 측정 창 시작보다 뒤 — 창 앞부분 입출금이 원장 밖일 수 있음');

  // ── 원장 완전성 (H-2) ─────────────────────────────────────────────────
  const cands = input.openLedgerCandidates;
  if (!Array.isArray(cands)) {
    blockers.push('ledger_completeness_unknown: 기록 안 된 입출금 후보(openLedgerCandidates)를 받지 못함');
  } else {
    let openIn = 0;
    for (const c of cands) {
      if (!c || c.state === 'dismissed') continue;
      const wall = parseKstWall(c.ts);
      const ms = wall == null ? null : wall - KST_OFFSET_MS;
      if (ms == null || (ms > S0.ms && ms <= S1.ms)) openIn++;
    }
    if (openIn > 0) blockers.push(`ledger_open_candidates: 측정 창 안 기록 안 된 입출금 후보 ${openIn}건 — 원장이 완전하지 않음`);
  }

  // ── 흐름 ──────────────────────────────────────────────────────────────
  const T = S1.ms - S0.ms;
  let net = 0;
  let weighted = 0;
  let count = 0;
  let exchanges = 0;
  let outside = 0;
  let pendingIn = 0;
  let unmatchedIn = 0;
  let maxAbsFlow = 0;
  const rawFlows = Array.isArray(input.flows) ? input.flows : [];
  for (const f of rawFlows) {
    const occ = msOf(f?.occurredAt);
    if (occ == null) { blockers.push('flow_time_invalid: 기록 시각을 읽을 수 없는 입출금 기록'); continue; }
    const refl = f.anchorStatus === 'matched' ? msOf(f.reflectedAt) : null;
    const t = refl ?? occ;
    if (!(t > S0.ms && t <= S1.ms)) { outside++; continue; }
    if (f.kind === 'exchange') { exchanges++; continue; }
    if (f.kind !== 'deposit' && f.kind !== 'withdrawal') { blockers.push(`flow_kind_invalid: 알 수 없는 종류(${String(f.kind)})`); continue; }
    const amt = f.amountKrwEquiv;
    if (typeof amt !== 'number' || !Number.isFinite(amt) || !(amt > 0)) {
      blockers.push(`flow_amount_invalid: 원화 환산액이 없거나 잘못된 ${f.kind} 기록(${String(amt)})`);
      continue;
    }
    if (baseMs != null && occ <= baseMs) blockers.push('flow_before_baseline: 측정 창 안 흐름의 기록 시각이 원장 기준 이전');
    if (f.anchorStatus === 'pending') pendingIn++;
    else if (f.anchorStatus !== 'matched') unmatchedIn++;
    const cf = (f.kind === 'deposit' ? 1 : -1) * Math.round(amt);
    maxAbsFlow = Math.max(maxAbsFlow, Math.abs(cf));
    const w = (S1.ms - t) / T;
    net += cf;
    weighted += w * cf;
    count++;
  }
  if (pendingIn > 0) cautions.push(`flow_pending: 반영 대기 기록 ${pendingIn}건을 기록 시각대로 포함`);
  if (unmatchedIn > 0) cautions.push(`flow_unmatched: 스냅샷에 반영이 확인되지 않은 기록 ${unmatchedIn}건을 기록대로 포함`);
  if (exchanges > 0) notes.push(`exchange_ignored: 환전 ${exchanges}건 — 순입금 0(스프레드·수수료는 총자산 변화로 수익률에 포함)`);
  if (outside > 0) notes.push(`flow_outside_window: 측정 창(시작 스냅샷 < t ≤ 끝 스냅샷) 밖 기록 ${outside}건 제외`);
  out.flowCount = count;
  out.netFlowKrw = net;

  const den = eStart + weighted;
  out.denominatorKrw = Number.isFinite(den) ? den : null;
  if (!Number.isFinite(den) || !(den > 0)) blockers.push(`denominator_nonpositive: 분모(시작 총자산 + 가중 순입금) ${den}`);
  else if (eStart > 0 && (den < eStart * LARGE_FLOW_DENOM_MIN_RATIO || maxAbsFlow > eStart * LARGE_FLOW_SINGLE_MAX_RATIO)) {
    cautions.push(`large_flow: 시작 총자산 대비 큰 흐름(분모 ${Math.round(den)}원, 최대 단일 흐름 ${maxAbsFlow}원) — 반영 시각 오차가 수익률 오차가 됨`);
  }
  if (blockers.length === 0) {
    const gain = eEnd - eStart - net;
    const r = (gain / den) * 100;
    if (!Number.isFinite(r)) blockers.push('return_nonfinite: 수익률이 유한값이 아님');
    else if (r < RETURN_FLOOR_PCT) blockers.push(`return_below_minus_100: 수익률 ${r.toFixed(2)}% — −100% 미만은 근사가 깨진 신호`);
    else { out.gainKrw = gain; out.returnPct = r; }
  }
  return finish();
}
