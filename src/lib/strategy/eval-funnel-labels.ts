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
  /** Phase 2 D2 — `analyst_disabled` 를 대체하는 엔진 마스터 스위치(ENGINE_ENABLED=false). */
  'engine_disabled',
  'strategy_throttled',
  'no_due_strategies',
  /**
   * T-012 — 증권사 잔고 조회 실패로 **보유 종목을 알 수 없어** 이 틱을 통째로 건너뜀.
   * "보유 없음"이 아니라 "모름"이다. 청산 평가·position_state 정리·진입 평가가 모두 생략된다.
   */
  'balances_unknown',
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
  'adaptive_buy_sizing',
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
  // Phase 2 §4-3 이후 신규 기록 없음 (통합 쿨다운으로 대체). 과거 행 조회용으로 보존.
  'dedup_regime',
  'dedup_lookup_error',
  // ─── stage 5 — 통합 쿨다운 (Phase 2 §4-3) ─────────────────────────
  /** entry 쿨다운 — (symbol, strategy, side) 2h / 사람 거부 시 4h */
  'cooldown_entry',
  /** exit 쿨다운 — (symbol, exit_kind) 15분 */
  'cooldown_exit',
  /** 쿨다운 조회 실패 — fail-open + error 기록 */
  'cooldown_lookup_error',
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
  /**
   * T-020 — 사이징 결과가 **1주 미만**이라 주문을 내지 않았다.
   * 실패(`signal_create_failed`)가 아니라 **정책 스킵**이다: 주식은 정수 주식 수로만
   * 거래되므로 1주를 못 사는 금액은 애초에 주문이 성립하지 않는다. `sell_amount_below_min`
   * (stage 5, 매도 전용)의 진입판 대응물.
   */
  'quantity_below_min',
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
  /**
   * T-015 — 자동 청산 **마스터 스위치 OFF**(`system_config.exit_engine_enabled ≠ true`)로
   * 청산 시그널 생성이 차단됨. 발화 조건은 **충족했다** — 껐기 때문에 주문이 안 나간 것이다.
   * `exit_hard_stop_disabled`(hard_stop 만 개별 차단)보다 상위 게이트다.
   */
  'exit_engine_disabled',
  /**
   * T-055 1단계 — 매도 제안 **읽기 전용 시뮬레이션**. 보유 종목마다 "사람에게 매도를 제안했을
   * 것인가"를 기록만 한다(pass = 제안 대상, skip = 아님 — reason 에 사유). 시그널·주문은 없다.
   * strategy_id='sell-proposal-v1'. 자동 청산 OFF 이고 `sell_proposal_preview_enabled=true` 일 때만.
   */
  'sell_proposal_preview',
  /**
   * T-058 — stage 11(createSignal). 매수인데 **실시간 가용 현금**(국내 KRW / 해외 USD)이 사이징된 주문 전체 비용(수량 × 지정가 × 1.002)에 못 미쳐
   * 시그널을 만들지 않았다(행·알림 없음). 실패가 아니라 정책 스킵이다(`quantity_below_min` 과 같은 성격).
   * 행의 `market` 으로 국내·해외 건너뜀을 따로 센다.
   */
  'insufficient_cash',
  /**
   * T-072 (D5) — stage 11(createSignal). 매수인데 귀속 전략이 **검증 상태가 아니다**(`unvalidated`·미등록·귀속 없음·상태값 이상).
   * 승인 가능한 시그널·알림을 만들지 않고 승인 불가 감사 행(`skipped`)과 가상 체결(`paper_fills`)만 남긴다. 정책 건너뜀(skip)이다.
   * reason = 관문 사유(unvalidated|unregistered|null_strategy|invalid_status).
   */
  'validation_gate',
  /** T-072 — 검증 상태 **조회 실패**(마이그레이션 전 컬럼 없음·DB 장애)로 매수를 막았다. 막는 것은 같지만 인프라 이상이라 verdict error. */
  'validation_lookup_error',
  /**
   * T-134 — exit 트랙 stage 23(`exit_state_upsert_failed`·`exit_state_missing` 과 같은 단계). 보유 종목의 position_state **조회가 던져**
   * 그 종목을 평가하지 않고 건너뛰었다(시그널·쿨다운·추가 쓰기 없음, 같은 틱의 다른 종목은 계속 평가). 행이 **없는** 것(`exit_state_missing`)과 다르다.
   */
  'exit_state_load_failed',
  /**
   * T-148 — stage 1. 수집(`collectCandidates`)이 **잡히지 않은 예외로 중단**됐다(지표 계산·룰 함수 등).
   * `ticker_error` 와 섞지 않는다: 저쪽은 `collectCandidates` 가 스스로 잡아 기록하는 **예상된** 실패고
   * 이쪽은 코드 결함에 가깝다. 수집을 동시성 팬아웃으로 바꾸면서 생긴 라벨이다 — 직렬이었을 때 이 예외는
   * 런 전체를 중단시켰고 funnel 에 아무 행도 남지 않았다.
   * ⚠️ stage 1 은 `ticker_error` 와 맞춘 값이고 실제 예외 지점은 stage 2~4(지표·룰)일 수 있다 —
   *    단계별 감쇠율을 볼 때 이 행은 "티커 단계 사망"이 아니라 "수집 중단"으로 읽어야 한다.
   */
  'collect_threw',
  /**
   * T-168 — stage 11(createSignal). 무제한(적응 배분) 모드에서 장중 엔진이 **미검증으로 분류**해 감사 전용(`validationAuditOnly`)으로
   * 보낸 매수 후보를 검증 관문(G1)이 **통과**시켰다(분류와 G1 사이 검증 상태 변경 경합). 시그널·감사 행·가상 체결·주문·쿨다운 없이 끝냈다 —
   * 다음 틱에 검증된 후보로 적응 배분 경로를 탄다. 정책 건너뜀(skip)이다. 평소 0건.
   */
  'validation_audit_only_passed',
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
  engine_disabled: 0,
  strategy_unregistered: 0,
  strategy_throttled: 0,
  no_due_strategies: 0,
  balances_unknown: 0,

  ticker_error: 1,
  collect_threw: 1,

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
  adaptive_buy_sizing: 8,

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

  cooldown_entry: 5,
  cooldown_exit: 25,
  cooldown_lookup_error: 5,

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
  quantity_below_min: 11,

  signal_created: 99,

  exit_avg_price_missing: 21,
  exit_ticker_error: 22,
  exit_price_invalid: 22,
  exit_state_upsert_failed: 23,
  exit_state_missing: 23,
  exit_unit_mismatch: 24,
  exit_no_fire: 24,
  exit_hard_stop_disabled: 25,
  exit_engine_disabled: 25,
  exit_cooldown_5m: 25,
  exit_create_failed: 29,
  // exit 트랙(21~29) 안, 판정(24) 뒤·생성(29) 앞. `final` 행을 쓰지 않으므로 6단계 깔때기에 섞이지 않는다.
  sell_proposal_preview: 26,
  insufficient_cash: 11,
  validation_gate: 11,
  validation_lookup_error: 11,
  exit_state_load_failed: 23,
  validation_audit_only_passed: 11,
};

/** 사용자 화면·리포트용 한글 라벨 (T-002 §4 "한글 라벨 매핑") */
export const GATE_LABEL_KO: Record<FunnelGate, string> = {
  run: '런',
  collect: '후보 수집',
  final: '최종',

  market_closed: '시장 폐장',
  analyst_disabled: '자동분석 꺼짐',
  engine_disabled: '엔진 중지 (신규 진입만 중단 — 보유 청산 보호는 계속)',
  strategy_unregistered: '전략 미등록',
  strategy_throttled: '전략 평가 주기 미도래',
  no_due_strategies: '평가할 전략 없음',
  balances_unknown: '잔고 조회 실패 — 보유 미확인 (평가 전체 생략)',

  ticker_error: '시세 조회 실패',
  collect_threw: '수집 중단 — 처리되지 않은 예외',

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
  adaptive_buy_sizing: '가용 잔금 배분',

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

  cooldown_entry: '진입 쿨다운',
  cooldown_exit: '청산 쿨다운',
  cooldown_lookup_error: '쿨다운 조회 실패',

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
  quantity_below_min: '주문 수량 1주 미만 (금액 부족)',

  signal_created: '시그널 생성',

  exit_avg_price_missing: '청산: 매입단가 결손',
  exit_ticker_error: '청산: 시세 조회 실패',
  exit_price_invalid: '청산: 가격 이상',
  exit_state_upsert_failed: '청산: 포지션 갱신 실패',
  exit_state_missing: '청산: 포지션 없음',
  exit_unit_mismatch: '청산: 단위 불일치',
  exit_no_fire: '청산 조건 미충족',
  exit_hard_stop_disabled: '청산: 손실한도 손절 꺼짐',
  exit_engine_disabled: '🔕 자동 청산 엔진 OFF — 발화 조건 충족했으나 주문 안 함',
  exit_cooldown_5m: '청산 쿨다운',
  exit_create_failed: '청산 시그널 생성 실패',
  sell_proposal_preview: '매도 제안 시뮬레이션 (시그널·주문 없음)',
  insufficient_cash: '실시간 현금 부족 (매수 시그널 미생성)',
  validation_gate: '검증 전 전략 — 신규 매수 차단 (가상 체결만 기록)',
  validation_lookup_error: '전략 검증 상태 조회 실패 — 신규 매수 차단',
  exit_state_load_failed: '청산: 포지션 조회 실패',
  validation_audit_only_passed: '감사 전용 매수가 검증 관문 통과(분류 뒤 상태 변경) — 시그널·주문 미생성',
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
  // Phase 2 D4 로 장중 AI 가 제거돼 stage 10 은 더 이상 발생하지 않는다.
  // key 는 UI·쿼리 호환을 위해 유지하고 라벨만 실제 의미로 바꾼다 (④ 안전·집행 통과분).
  { key: 'ai',        label: '안전게이트 통과', minStage: 11 },
  { key: 'signal',    label: '전략시그널',    minStage: 99 },
];

export function gateLabelKo(gate: string | null | undefined): string {
  if (!gate) return '알 수 없음';
  return GATE_LABEL_KO[gate as FunnelGate] ?? gate;
}
