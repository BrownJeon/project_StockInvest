/**
 * T-087 (T-081 WP-D1a) — 브로커 체결 원장 공개 타입(순수). DB·네트워크·안전장치 import 없음.
 *
 * 정규화 행 타입의 키는 **DDL 열 이름 그대로**(snake_case)다 — 수집기(Dev-2)가 INSERT/UPDATE 열 목록을 그대로 만들 수 있게 했다.
 * 계좌·run 관련 열(`account_id`·`account_fingerprint`·`first/last_run_id`·`first/last_seen_at`·`revision`·`captured_at`·`run_id`·`is_baseline`)
 * 과 D2 파생열(`fee_*` 는 예외 — {@link FeeEstimate} 참고, `tax_native`·`fx_*`·USD `amount_krw_est`·`app_order_id`·`reconcile_state`·
 * `derived_for_revision`)은 여기서 만들지 않는다.
 *
 * DECIMAL·DATE·TIME 값은 **문자열**(DB 에 그대로 넣는 표기)이다 — JS number 로 바꾸지 않는다(`decimal.ts`).
 * DDL 정본: `scripts/migrations/T-081-wpd-broker-fills.sql`. 설계 정본: `docs/design/2026-10-25-wpd-broker-fills-design.md` v3.1.
 */
export type { LedgerQueryResult, LedgerFetchOutcome } from '@/lib/exchanges/kis-ledger-query';

export type BrokerMarket = 'domestic' | 'overseas';
export type BrokerRunKind = 'fills' | 'realized_pnl' | 'position_snapshot';
export type BrokerCurrency = 'KRW' | 'USD';
export type BrokerSide = 'buy' | 'sell';
export type SettleState = 'open' | 'closed' | 'unknown';
export type RunStatus = 'running' | 'complete' | 'incomplete' | 'failed';
export type SumCheck = 'pending' | 'match' | 'mismatch' | 'unavailable';
export type PositiveCheck = 'pending' | 'confirmed' | 'unconfirmed' | 'n/a';
export type DateBasis = 'kst' | 'local' | 'unknown';

/** 정규화 입력 — 어댑터 결과에서 정규화에 필요한 부분만(구조적 타입). */
export interface RawLedgerBatch {
  market: BrokerMarket;
  kind: BrokerRunKind;
  trId: string;
  rows: Record<string, unknown>[];
}

/** 행 하나를 정규화하지 못한 이유. **값은 담지 않는다**(필드 이름·사유 코드만) — run.error·로그에 그대로 쓸 수 있다. */
export interface NormalizeIssue {
  /** 응답 안 행 순번(0부터). */
  index: number;
  reason: string;
  field?: string;
}

/** `broker_fills` 의 원문열 + 수집기 파생열(`settle_state`·KRW `amount_krw_est`) + 수집 메타 일부. */
export interface BrokerFillRow {
  broker: 'kis';
  market: BrokerMarket;
  order_date: string;              // KST 주문일 YYYY-MM-DD (국내 ord_dt / 해외 dmst_ord_dt)
  local_order_date: string | null; // 해외 ord_dt(현지). 국내 null
  broker_order_no: string;
  orig_order_no: string | null;
  order_time: string | null;       // HH:MM:SS — 주문 시각(체결 시각 아님)
  symbol: string;                  // 앱 규약(국내 종목코드 / 해외 'NAS:TICKER')
  broker_symbol: string;
  exchange_code: string | null;
  side: BrokerSide;
  currency: BrokerCurrency;
  order_qty: string | null;
  filled_qty: string;
  remaining_qty: string | null;
  cancelled_qty: string | null;
  rejected_qty: string | null;
  avg_fill_price: string;
  fill_amount: string;
  order_type_code: string | null;
  revise_cancel_code: string | null;
  broker_status_name: string | null;
  reject_reason: string | null;
  fractional_hint: string | null;
  settle_state: SettleState;
  /** KRW 행만 = fill_amount(수집기 파생). USD 행은 null — 환산은 D2 소유라 수집기가 쓰지 않는다. */
  amount_krw_est: string | null;
  source_tr: string;
  raw_hash: string;
  raw_json: string;
}

/**
 * 수집기가 `fee_kind IN ('unknown','estimated')` 일 때만 쓰는 추정 수수료(설계 §3.2 ⑤·L-5). `allocated`/`actual` 행에는 쓰지 않는다
 * — 그 판단은 현재 DB 행을 본 수집기 몫이다. 국내 행은 null(국내 수수료는 D2 가 기간손익 `fee` 를 배분한다).
 */
export interface FeeEstimate {
  fee_kind: 'estimated';
  fee_native: string;    // DECIMAL(18,6)
  fee_rate_pct: string;  // DECIMAL(8,5)
}

export interface NormalizedFill {
  row: BrokerFillRow;
  /** 응답 안 중복 검사용 자연키(계좌 제외 — 한 응답은 한 계좌). DB 콜레이션(general_ci)처럼 대소문자를 접는다. */
  key: string;
  /**
   * 취소·정정 신호(설계 L-4) — 수집기 단조 가드가 "수량 감소·closed→open" 을 허용할지 판단할 때 쓴다.
   * 국내: `cncl_cfrm_qty > 0` 또는 `cncl_yn='Y'` / 해외: `rvse_cncl_dvsn ∈ {'01','02'}`. 모르는 코드는 신호 없음(= 낡은 응답으로 건너뜀 쪽, fail-closed).
   */
  cancelOrReviseSignal: boolean;
  feeEstimate: FeeEstimate | null;
}

/** `broker_realized_pnl` 원문열 + 메타 일부. */
export interface BrokerRealizedPnlRow {
  broker: 'kis';
  market: BrokerMarket;
  trade_date: string;
  grain: 'day' | 'day_symbol';
  symbol: string;          // day 이면 ''
  broker_symbol: string;   // day 이면 ''
  exchange_code: string | null;
  currency: BrokerCurrency;
  sell_qty: string | null;
  buy_qty: string | null;
  sell_amount_native: string | null;
  buy_amount_native: string | null;
  avg_sell_price: string | null;
  avg_buy_price: string | null;
  realized_pnl_native: string;
  fee_native: string | null;
  tax_native: string | null;
  loan_interest_native: string | null;
  pnl_rate_pct: string | null;
  fx_usdkrw: string | null;
  fx_first_notice: string | null;
  source_tr: string;
  raw_hash: string;
  raw_json: string;
}

export interface NormalizedRealizedPnl {
  row: BrokerRealizedPnlRow;
  key: string;
}

/** `broker_position_snapshots` 원문열 + 메타 일부(`is_baseline`·`captured_at`·`run_id` 는 수집기). */
export interface BrokerPositionSnapshotRow {
  broker: 'kis';
  market: BrokerMarket;
  as_of: string;
  symbol: string;
  broker_symbol: string;
  exchange_code: string | null;
  currency: BrokerCurrency;
  qty: string;
  avg_price_native: string;
  purchase_amount_native: string | null;
  cost_includes_fee: 'unknown';
  source_tr: string;
  raw_hash: string;
  raw_json: string;
}

export interface NormalizedPositionSnapshot {
  row: BrokerPositionSnapshotRow;
  key: string;
}

export interface NormalizeBatch<T> {
  items: T[];
  issues: NormalizeIssue[];
}

/** 합계 대조 결과(설계 §3.4). `reasons` 는 사유 코드만(값 없음). */
export interface SumCheckResult {
  result: Exclude<SumCheck, 'pending'>;
  reasons: string[];
}

/** run 완전성 판정 입력 — DDL `chk_bfr_complete` 와 같은 조건 + 정규화·쓰기 실패. */
export interface CompletenessInput {
  market: BrokerMarket;
  kind: BrokerRunKind;
  sourceTr: string;
  fetchOutcome: 'ended' | 'truncated' | 'failed';
  lastTrCont: string | null;
  sumCheck: SumCheck;
  duplicateKeys: number;
  pages: number;
  kisCalls: number;
  /** 정규화하지 못한 행 수(0 이 아니면 complete 불가). */
  normalizeIssues: number;
  /** 쓰기 단계에서 건너뛴 행 수(1213 재시도 소진 등 — 수집기가 센다). 0 이 아니면 complete 불가. */
  writeFailures?: number;
}

export interface CompletenessResult {
  status: Exclude<RunStatus, 'running'>;
  reasons: string[];
}
