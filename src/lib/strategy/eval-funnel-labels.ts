/**
 * eval_funnel 게이트 ID · 단계(stage) · 한글 라벨 — **순수 상수 모듈**.
 *
 * DB(`mysql2`)를 import 하지 않으므로 클라이언트 컴포넌트에서도 안전하게 import 할 수 있다.
 * 실제 기록기는 `eval-funnel.ts`, 집계 쿼리는 `eval-funnel-query.ts`.
 *
 * ⚠️ gate ID는 **영구 저장되는 안정 식별자**다. 리네임 금지 (T-002 §3).
 *    새 게이트를 추가할 때는 목록 끝에 append 하고 STAGE·LABEL을 함께 채운다.
 */

export type FunnelMarket = 'domestic' | 'overseas';
export type FunnelVerdict = 'pass' | 'skip' | 'error';

/**
 * 단계(stage) 번호 체계 — T-002 §0.
 *  0  런 게이트 (시장·스위치·스로틀)
 *  1  심볼 열거·티커
 *  2  시장상태 분류 → 룰 활성화
 *  3  캔들 확보
 *  4  룰 발화
 *  5  포지션·이력 가드
 *  6  거시 레짐 게이트
 *  7  프리필터 + 장마감 매수차단
 *  8  포트폴리오 안정성 가드
 *  9  dedup (레짐 버킷)
 * 10  AI 관문
 * 11  createSignal 게이트
 * 99  시그널 생성됨 (터미널 성공)
 * 21~29 exit-engine 병렬 트랙
 */
export const FUNNEL_GATES = [
  // ─── 집계용 특수 행 ────────────────────────────────────────────────
  'run',
  'collect',
  'final',
  // ─── stage 0 — 런 게이트 ──────────────────────────────────────────
  'market_closed',
  'analyst_disabled',
  'strategy_unregistered',
  'strategy_throttled',
  'no_due_strategies',
  // ─── stage 1 — 심볼·티커 ──────────────────────────────────────────
  'ticker_error',
  // ─── stage 2 — 시장상태 ───────────────────────────────────────────
  'market_state_preclassify_failed',
  'market_state_rule_inactive',
  // ─── stage 3 — 캔들 ───────────────────────────────────────────────
  'candles_fetch_failed',
  'insufficient_candles',
  // ─── stage 4 — 룰 발화 ────────────────────────────────────────────
  'rule_no_fire',
  // ─── stage 5 — 포지션·이력 가드 ───────────────────────────────────
  'losing_position_buy_block',
  'sell_not_held',
  'cooldown_rebuy',
  'skip_seal_24h',
  'sell_amount_below_min',
  // ─── stage 6 — 거시 레짐 ──────────────────────────────────────────
  'regime_gate_macro_bear',
  'regime_gate_macro_error',
  /** SI 확장 — Phase 0 fail-safe. 주문 한도 미설정 시 신규 매수 전면 스킵 (engine.ts) */
  'order_limit_unconfigured',
  // ─── stage 7 — 프리필터·장마감 ────────────────────────────────────
  'prefilter_bypassed_no_summary',
  'prefilter_liquidity_dead',
  'prefilter_atr_zero',
  'prefilter_rsi_extreme_counter',
  'prefilter_strong_counter_trend',
  'prefilter_blowoff_top',
  'late_session_buy_block',
  // ─── stage 8 — 포트폴리오 가드 ────────────────────────────────────
  'portfolio_max_positions',
  'portfolio_core_ratio',
  'portfolio_guard_other',
  // ─── stage 9 — dedup ──────────────────────────────────────────────
  'dedup_regime',
  'dedup_lookup_error',
  // ─── stage 10 — AI 관문 ───────────────────────────────────────────
  'ai_input_no_summary',
  'ai_stage1_reject',
  'ai_batch_failed',
  'ai_failed_nonheld',
  'ai_missing_in_batch',
  'ai_rejected',
  'ai_low_confidence',
  // ─── stage 11 — createSignal ──────────────────────────────────────
  'symbol_blacklisted',
  'duplicate_active_signal',
  'signal_create_failed',
  // ─── stage 99 — 터미널 성공 ───────────────────────────────────────
  'signal_created',
  // ─── stage 21~29 — exit-engine 병렬 트랙 ──────────────────────────
  'exit_avg_price_missing',
  'exit_ticker_error',
  'exit_price_invalid',
  'exit_state_upsert_failed',
  'exit_state_missing',
  'exit_unit_mismatch',
  'exit_no_fire',
  'exit_hard_stop_disabled',
  'exit_cooldown_5m',
  'exit_create_failed',
] as const;

export type FunnelGate = (typeof FUNNEL_GATES)[number];

/** gate → stage 매핑. `final` 행의 stage는 "죽은 단계"라 동적으로 지정한다. */
export const GATE_STAGE: Record<FunnelGate, number> = {
  run: 0,
  // collect 행은 stage 2~5를 1행에 압축 — 시작 단계인 2로 고정
  collect: 2,
  // final 행의 stage는 호출부에서 동적 지정 (기본값은 0)
  final: 0,

  market_closed: 0,
  analyst_disabled: 0,
  strategy_unregistered: 0,
  strategy_throttled: 0,
  no_due_strategies: 0,

  ticker_error: 1,

  market_state_preclassify_failed: 2,
  market_state_rule_inactive: 2,

  candles_fetch_failed: 3,
  insufficient_candles: 3,

  rule_no_fire: 4,

  losing_position_buy_block: 5,
  sell_not_held: 5,
  cooldown_rebuy: 5,
  skip_seal_24h: 5,
  sell_amount_below_min: 5,

  regime_gate_macro_bear: 6,
  regime_gate_macro_error: 6,
  order_limit_unconfigured: 6,

  prefilter_bypassed_no_summary: 7,
  prefilter_liquidity_dead: 7,
  prefilter_atr_zero: 7,
  prefilter_rsi_extreme_counter: 7,
  prefilter_strong_counter_trend: 7,
  prefilter_blowoff_top: 7,
  late_session_buy_block: 7,

  portfolio_max_positions: 8,
  portfolio_core_ratio: 8,
  portfolio_guard_other: 8,

  dedup_regime: 9,
  dedup_lookup_error: 9,

  ai_input_no_summary: 10,
  ai_stage1_reject: 10,
  ai_batch_failed: 10,
  ai_failed_nonheld: 10,
  ai_missing_in_batch: 10,
  ai_rejected: 10,
  ai_low_confidence: 10,

  symbol_blacklisted: 11,
  duplicate_active_signal: 11,
  signal_create_failed: 11,

  signal_created: 99,

  exit_avg_price_missing: 21,
  exit_ticker_error: 22,
  exit_price_invalid: 22,
  exit_state_upsert_failed: 23,
  exit_state_missing: 23,
  exit_unit_mismatch: 24,
  exit_no_fire: 24,
  exit_hard_stop_disabled: 25,
  exit_cooldown_5m: 25,
  exit_create_failed: 29,
};

/** 사용자 화면·리포트용 한글 라벨 (T-002 §4 "한글 라벨 매핑") */
export const GATE_LABEL_KO: Record<FunnelGate, string> = {
  run: '런',
  collect: '후보 수집',
  final: '최종',

  market_closed: '시장 폐장',
  analyst_disabled: '자동분석 꺼짐',
  strategy_unregistered: '전략 미등록',
  strategy_throttled: '전략 평가 주기 미도래',
  no_due_strategies: '평가할 전략 없음',

  ticker_error: '시세 조회 실패',

  market_state_preclassify_failed: '국면 분류 불가',
  market_state_rule_inactive: '국면상 룰 비활성',

  candles_fetch_failed: '캔들 조회 실패',
  insufficient_candles: '캔들 부족',

  rule_no_fire: '룰 미발화',

  losing_position_buy_block: '손실 중 추가매수 차단',
  sell_not_held: '미보유 매도',
  cooldown_rebuy: '재매수 쿨다운',
  skip_seal_24h: '24시간 재발화 봉인',
  sell_amount_below_min: '매도 수량 미달',

  regime_gate_macro_bear: '거시 급락 매수 차단',
  regime_gate_macro_error: '거시 지표 조회 실패',
  order_limit_unconfigured: '주문 한도 미설정',

  prefilter_bypassed_no_summary: '프리필터 생략(지표 없음)',
  prefilter_liquidity_dead: '유동성 고갈',
  prefilter_atr_zero: '변동성 0',
  prefilter_rsi_extreme_counter: 'RSI 극단 역행',
  prefilter_strong_counter_trend: '하락추세 매수 차단',
  prefilter_blowoff_top: '급등 과열 추격',
  late_session_buy_block: '장마감 임박 매수 차단',

  portfolio_max_positions: '종목당 매수 한도 초과',
  portfolio_core_ratio: '코어 비율 미달',
  portfolio_guard_other: '포트폴리오 가드',

  dedup_regime: '중복 평가 생략',
  dedup_lookup_error: '중복 조회 실패',

  ai_input_no_summary: 'AI 입력 누락',
  ai_stage1_reject: 'AI 1차 거절',
  ai_batch_failed: 'AI 배치 실패',
  ai_failed_nonheld: 'AI 실패(비보유 스킵)',
  ai_missing_in_batch: 'AI 응답 누락',
  ai_rejected: 'AI 거절',
  ai_low_confidence: 'AI 신뢰도 미달',

  symbol_blacklisted: '거래 금지 종목',
  duplicate_active_signal: '활성 시그널 중복',
  signal_create_failed: '시그널 생성 실패',

  signal_created: '시그널 생성',

  exit_avg_price_missing: '청산: 매입단가 결손',
  exit_ticker_error: '청산: 시세 조회 실패',
  exit_price_invalid: '청산: 가격 이상',
  exit_state_upsert_failed: '청산: 포지션 갱신 실패',
  exit_state_missing: '청산: 포지션 없음',
  exit_unit_mismatch: '청산: 단위 불일치',
  exit_no_fire: '청산 조건 미충족',
  exit_hard_stop_disabled: '청산: 하드손절 비활성',
  exit_cooldown_5m: '청산 쿨다운',
  exit_create_failed: '청산 시그널 생성 실패',
};

/**
 * 6단계 미니 깔때기 바 정의 (T-002 §4-4). `final` 행의 stage 기준 생존 집계.
 *
 * 모수는 **평가 트랙 전용**이다 (T-004 analyst 판정). 단위는 건이 아니라 symbol×run —
 * `종목평가` 라벨을 쓰는 이유(유니버스 실제 종목 수 60~90 와의 혼동 방지)와
 * 터미널이 `전략시그널` 인 이유(exit 엔진 청산 시그널은 이 사슬의 게이트를 하나도
 * 통과하지 않아 여기 포함되지 않음)가 모두 이것이다.
 */
export const FUNNEL_STEPS: Array<{ key: string; label: string; minStage: number }> = [
  { key: 'evaluated', label: '종목평가',     minStage: 0  },
  { key: 'fired',     label: '룰 발화',      minStage: 5  },
  { key: 'guard',     label: '가드 통과',    minStage: 7  },
  { key: 'prefilter', label: '프리필터 통과', minStage: 9  },
  { key: 'ai',        label: 'AI 통과',      minStage: 11 },
  { key: 'signal',    label: '전략시그널',    minStage: 99 },
];

export function gateLabelKo(gate: string | null | undefined): string {
  if (!gate) return '알 수 없음';
  return GATE_LABEL_KO[gate as FunnelGate] ?? gate;
}
