/**
 * T-074 자금 이동 원장 — API 응답·요청 타입 (서버·클라이언트 공용, 타입 전용).
 *
 * WP-B(화면)가 이 파일의 타입을 그대로 쓴다. 경로·필드는 Designer 구현 가이드 3절 표를 따른다.
 *  - 시각 문자열은 전부 **KST 벽시계**: 발생 시각 'YYYY-MM-DD HH:mm', 그 밖 'YYYY-MM-DD HH:mm:ss'.
 *  - 금액은 숫자: 원화 = 정수(원), 달러 = 소수 2자리까지($). 순입금·손익 등 원화 환산값은 정수(원)로 반올림해 둔다.
 *  - 응답 봉투: 성공 `{ ok: true, data: LedgerFeed, ... }`, 실패 `LedgerErrorBody`.
 */
import type { LedgerRules } from './rules';

export type EntryKind = 'deposit' | 'withdrawal' | 'exchange';
export type Currency = 'KRW' | 'USD';
export type AnchorStatus = 'pending' | 'matched' | 'unmatched';

/** 반영 상태 근거에 붙는 '환전으로 정정' 제안 (Analyst Q3 #2 · 데모 e6.suggest) */
export interface ExchangeSuggestion {
  kind: 'exchange';
  snapshotId: number;
  snapshotTs: string;
  /** 그 단계의 원화 현금 변화(원, 부호 있음) */
  krwDelta: number;
  /** 그 단계의 달러 현금 변화($, 부호 있음) */
  usdDelta: number;
}

export interface EntryAnchorView {
  status: AnchorStatus;
  /** 처음 반영된 스냅샷 (matched 일 때만) */
  snapshotId: number | null;
  snapshotTs: string | null;
  /** 반영 근거 또는 불일치 사유(한국어 문장) */
  detail: string | null;
  /** 이번 조회에서 다시 맞춰 본 결과에만 붙는다 */
  suggest: ExchangeSuggestion | null;
}

export interface EntryVoidView {
  /** cancel = 기록 취소, super = 정정으로 대체됨 */
  type: 'cancel' | 'super';
  reason: string | null;
  at: string | null;
  byUserId: number | null;
  /** super 일 때 대체한 새 기록 id */
  by: number | null;
}

export interface LedgerEntryView {
  id: number;
  clientEntryId: string;
  kind: EntryKind;
  /** 'YYYY-MM-DD HH:mm' KST */
  occurredAt: string;
  /** 입출금: 통화 / 환전: 낸 통화 */
  currency: Currency;
  /** 항상 양수 */
  amount: number;
  /** 환전 전용: 받은 통화 */
  counterCurrency: Currency | null;
  /** 환전 전용: 받은 금액(양수) */
  counterAmount: number | null;
  memo: string | null;
  source: 'user' | 'import';
  createdAt: string;
  createdByUserId: number | null;
  anchor: EntryAnchorView;
  /** USD 입출금 원화 환산 환율(반영 스냅샷 USD 행, 불일치면 기록 뒤 첫 스냅샷), 환전은 비용 추정용 반영 스냅샷 환율 */
  fxRateUsed: number | null;
  fxSource: 'snapshot' | 'user' | null;
  /** 순입금용 원화 환산(원). KRW 흐름 = 금액, USD 흐름 = 금액 × fxRateUsed, 환전·미확정 = null */
  krwEquiv: number | null;
  /** 이 기록이 대체한(정정한) 원래 기록 id */
  supersedes: number | null;
  /** 이 기록을 대체한 새 기록 id (정정됨) */
  supersededBy: number | null;
  void: EntryVoidView | null;
  /** 기준 시각 이전 기록 — 계산 제외 */
  beforeBaseline: boolean;
}

export interface BaselineHistoryEntry {
  version: number;
  at: string;
  baselineAt: string;
  snapshotId: number;
  confirmed: { krwCash: number | null; usdCash: number | null };
  baselineTotalKrw: number;
}

export interface BaselineView {
  version: number;
  updatedAt: string;
  /** 기준 시각 = 기준 스냅샷 ts 'YYYY-MM-DD HH:mm:ss' */
  at: string;
  snapshotId: number;
  /** 스냅샷에서 복사해 동결한 값 */
  totalKrw: number;
  krwCash: number;
  usdCash: number | null;
  fx: number | null;
  /** 사용자가 KIS 앱에서 확인한 현금 — 없으면 null(스냅샷 값 사용) */
  confirmed: { krwCash: number | null; usdCash: number | null; at: string | null; note: string | null };
  /** 기준 총자산 = totalKrw + (확인 달러 − 스냅샷 달러) × fx + (확인 원화 − 스냅샷 원화) */
  baselineTotalKrw: number;
  /** 확인하지 않은 현금이 있으면 true ('기준 미확정' 임시 계산) */
  unconfirmed: boolean;
  history: BaselineHistoryEntry[];
}

export interface UsdGapHint {
  /** 지금 빠져 보이는 달러 현금($) — Analyst Q5 의 'X' */
  usd: number;
  /** 그 원화 환산(원, 최신 환율) */
  krw: number;
  /** 빠지기 시작한 스냅샷 시각 */
  sinceTs: string;
}

export interface SnapshotView {
  id: number;
  ts: string;
  totalKrw: number;
  krwCash: number | null;
  usdCash: number | null;
  fx: number | null;
  stale: boolean;
  ageMin: number;
  /** Y ↔ Y+X 왕복 패턴이 진행 중이고 지금 X 가 빠져 있으면 */
  usdGapHint: UsdGapHint | null;
}

export interface BaselineOption {
  id: number;
  ts: string;
  totalKrw: number;
  krwCash: number | null;
  usdCash: number | null;
  fx: number | null;
  /** today_morning(권장) · latest · yesterday_morning — 한 스냅샷이 여러 표지를 가질 수 있다 */
  tags: ('today_morning' | 'latest' | 'yesterday_morning')[];
}

export interface LedgerSummaryLast {
  id: number;
  occurredAt: string;
  kind: EntryKind;
  currency: Currency;
  amount: number;
  counterCurrency: Currency | null;
  counterAmount: number | null;
  status: AnchorStatus;
}

/** 데모 `calc()` 결과와 같은 의미 (Analyst Q1 MVP) */
export interface LedgerSummary {
  /** 입출금 뺀 투자 손익(원) = 현재 총자산 − 기준 총자산 − 순입금 */
  P: number;
  /** 수익률(근사, %, Modified Dietz) — 분모 ≤ 0 이면 null(계산 불가) */
  R: number | null;
  /** 기준 총자산(원) */
  b0: number;
  /** 현재 총자산(원, 최신 스냅샷) */
  v: number;
  /** 순입금(넣은 돈 − 뺀 돈, 원) — 반영 대기 제외 */
  net: number;
  inflow: number;
  outflow: number;
  /** 반영 대기 — 손익에서 빠져 있음 (krw 는 부호 있는 합) */
  pending: { count: number; krw: number };
  unmatched: number;
  /** 기준 이전 기록 수(계산 제외) */
  pre: number;
  /** 살아 있는 기록 수 */
  live: number;
  /** 취소·정정된 기록 수 */
  voids: number;
  last: LedgerSummaryLast | null;
  /** 기준부터 경과 일수(내림) */
  days: number;
  unconfirmed: boolean;
  /** 환율이 없어 원화로 환산하지 못한 USD 기록 수(0 이 정상) */
  fxMissing: number;
}

export interface CandidateView {
  /** 안정 키 `${스냅샷 id}-${통화}` — 재조회에도 같다 */
  key: string;
  snapshotId: number;
  ts: string;
  prevSnapshotId: number;
  prevTs: string;
  currency: Currency;
  /** 현금 변화(부호 있음): 원화 = 원, 달러 = $ */
  delta: number;
  direction: 'deposit' | 'withdrawal';
  state: 'open' | 'dismissed';
  reason: string | null;
  dismissedAt: string | null;
  dismissedByUserId: number | null;
}

export interface LedgerFeed {
  baseline: BaselineView | null;
  snapshot: SnapshotView | null;
  entries: LedgerEntryView[];
  summary: LedgerSummary | null;
  /** 최신순 */
  candidates: CandidateView[];
  baselineOptions: BaselineOption[];
  rules: LedgerRules;
  /** 서버 현재 시각(KST) */
  now: string;
  /** 지연 매칭 결과를 DB 에 남기지 못했으면 false(화면 숫자는 이번 계산 그대로 맞다) */
  persisted: boolean;
  /** 스냅샷 읽기가 scanMaxRows 에서 잘렸으면 true */
  scanTruncated: boolean;
}

// ─── 요청 ────────────────────────────────────────────────────────────────

export interface EntryRequestBody {
  clientEntryId: string;
  kind: EntryKind;
  /** 'YYYY-MM-DD HH:mm' KST */
  occurredAt: string;
  currency: Currency;
  /** 문자열 권장("2,000,000"·"118.60"). 숫자도 받는다 */
  amount: string | number;
  counterCurrency?: Currency | null;
  counterAmount?: string | number | null;
  memo?: string | null;
  fromCandidateKey?: string | null;
  baseVersion: number;
}

export interface CorrectRequestBody extends EntryRequestBody {
  reason?: string | null;
}

export interface CancelRequestBody {
  reason: string;
}

export interface BaselineRequestBody {
  snapshotId: number;
  confirmed?: { krwCash?: string | number | null; usdCash?: string | number | null; note?: string | null } | null;
  /** 현재 기준 version (첫 저장은 0) */
  baseVersion: number;
}

export interface DismissRequestBody {
  reason: string;
}

// ─── 검증·응답 코드 ──────────────────────────────────────────────────────

export type ValidationCode =
  | 'required' | 'format' | 'sign' | 'amount' | 'decimals' | 'max'
  | 'future' | 'before_baseline' | 'kind' | 'currency' | 'same_currency'
  | 'too_long' | 'no_fx' | 'not_found' | 'invalid';

export interface FieldError {
  code: ValidationCode;
  message: string;
}

export type EntryField =
  | 'clientEntryId' | 'kind' | 'occurredAt' | 'currency' | 'amount'
  | 'counterCurrency' | 'counterAmount' | 'memo' | 'reason' | 'fromCandidateKey' | 'baseVersion';

export type WarningCode = 'big_amount' | 'near_duplicate' | 'fx_deviation';

export interface LedgerWarning {
  code: WarningCode;
  message: string;
  existingId?: number;
}

export type LedgerErrorCode =
  | 'bad_request'      // 400 본문이 JSON 이 아님
  | 'validation'       // 422 fieldErrors
  | 'not_found'        // 404
  | 'duplicate'        // 409 살아 있는 같은 (종류·통화·금액·분) 기록 → existingId
  | 'client_entry_conflict' // 409 같은 clientEntryId 로 내용(또는 정정 대상)이 다른 요청 → existingId·data (Reviewer M1)
  | 'baseline_version' // 409 기록 저장 시 기준 버전 불일치 → latest
  | 'no_baseline'      // 409 기준 없음
  | 'version'          // 409 기준 저장 시 버전 불일치 → latest
  | 'already_voided'   // 409 이미 취소·정정됨
  | 'not_voided'       // 409 되살릴 것이 없음
  | 'superseded'       // 409 정정으로 대체된 기록은 되살리지 않음
  | 'already_handled'  // 409 후보가 이미 처리됨
  | 'not_dismissed'    // 409 되돌릴 '입출금 아님' 표시 없음
  | 'not_migrated'     // 503 cash_flow_ledger 테이블 없음 (마이그레이션 전)
  | 'unauthorized'
  | 'server_error';    // 500

export interface LedgerErrorBody {
  ok: false;
  code: LedgerErrorCode;
  /** 한국어 문장 */
  error: string;
  fieldErrors?: Partial<Record<EntryField | 'snapshotId' | 'krwCash' | 'usdCash' | 'note', FieldError>>;
  existingId?: number;
  latest?: BaselineView | null;
  /** 같은 clientEntryId 로 다시 보내도 두 번 기록되지 않는다(500 재시도 안내) */
  retrySafe?: boolean;
  /** 충돌 응답에 최신 화면 데이터를 실을 수 있을 때 */
  data?: LedgerFeed;
}

// ─── 성공 응답 (모든 쓰기 응답에 최신 화면 데이터 `data` 가 실린다 — 화면은 그것으로 교체) ─────────

/** GET /api/cash-ledger */
export interface LedgerFeedResponse {
  ok: true;
  data: LedgerFeed;
}

/** POST …/entries/:id/cancel · …/entries/:id/restore */
export interface EntryActionResponse {
  ok: true;
  data: LedgerFeed;
  entry: LedgerEntryView;
}

/** PUT /api/cash-ledger/baseline */
export interface BaselineWriteResponse {
  ok: true;
  data: LedgerFeed;
  baseline: BaselineView;
}

/** POST …/candidates/:key/dismiss · …/candidates/:key/reopen */
export interface CandidateWriteResponse {
  ok: true;
  data: LedgerFeed;
  /** 표시 뒤의 후보(그 사이 기록돼 사라졌으면 null) */
  candidate: CandidateView | null;
}

/** POST /api/cash-ledger/rematch */
export interface RematchResponse {
  ok: true;
  data: LedgerFeed;
  /** 반영 상태가 바뀌어 저장된 기록 수 */
  changed: number;
}

/** POST /api/cash-ledger/entries · …/entries/:id/correct */
export interface EntryWriteResponse {
  ok: true;
  data: LedgerFeed;
  entry: LedgerEntryView;
  /** 정정에서: 대체된 원래 기록 */
  original?: LedgerEntryView;
  warnings: LedgerWarning[];
  /** 같은 clientEntryId 가 이미 저장돼 있어 새로 쓰지 않고 그 기록을 돌려줬다 */
  replayed: boolean;
  /** fromCandidateKey 가 이번 저장 뒤 더는 열린 후보가 아니다 */
  candidateResolved: boolean | null;
}
