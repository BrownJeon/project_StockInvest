/**
 * T-108 사유 코드 → 화면 말 (순수, 시험 B-3). 서버가 주는 짧은 분류어를 영문 그대로 보이지 않는다.
 * 알려진 코드만 한글로 바꾸고, **모르는 코드는 「사유 코드 {code}」** — 지어낸 해석을 붙이지 않는다.
 *
 * - 주문 차단·거부 사유(`orders.blocked_by`): 정본 = `src/lib/safety/dry-run.ts`(차단 분기 · `categorizeRejectReason`)
 *   · `src/lib/safety/order-limits.ts`(order_limit·daily_limit·symbol_not_allowed).
 * - 장마감 분석 건너뜀 사유: 정본 = `src/lib/strategy/post-market-overseas.ts`(skipped: …)·`post-market-engine.ts`(weekend).
 *   **건너뜀을 「휴장」으로 단정하지 않는다** — 휴장은 엔진이 휴장이라고 말한 코드일 때만.
 */

/** 주문 차단·거부 사유 — 확인 필요 「주문 거부」 부제 등. */
export const ORDER_REASON_KO: Readonly<Record<string, string>> = {
  kill_switch: '모든거래차단',
  dry_run: '실거래 차단(가상 주문)',
  symbol_not_allowed: '거래 제외 종목',
  order_limit: '1회 주문 한도',
  daily_limit: '1일 주문 한도',
  validation_gate: '검증 관문',
  invalid_side: '주문 방향 오류',
  kis_rejected: '증권사 거부',
  kis_4xx: '증권사 요청 거부',
  kis_5xx: '증권사 서버 오류 — 결과 확인 필요',
  network_error: '연결 오류 — 결과 확인 필요',
  rate_limit: '증권사 호출 한도 초과',
  kis_token: '증권사 인증 토큰 오류',
  insufficient_balance: '주문 가능 금액 부족',
  insufficient_qty: '주문 가능 수량 부족',
  price_unit: '호가 단위 오류',
  market_closed: '장 마감·시간 외',
  time_restriction: '주문 가능 시간 아님',
  trading_halt: '거래 정지·관리 종목',
  auction_phase: '단일가·동시호가 구간',
  bad_number_field: '수량·가격 값 오류',
  qty_calc_failed: '수량 계산 실패',
};

/** 주문 사유 코드 → 말. 없으면 null, 모르는 코드는 「사유 코드 {code}」. */
export function orderReasonText(code: string | null | undefined): string | null {
  if (code == null) return null;
  const c = String(code).trim();
  if (!c) return null;
  return ORDER_REASON_KO[c] ?? `사유 코드 ${c}`;
}

/**
 * 장마감 분석 사유 — 건너뜀(skipReason: 200 skipped — weekend·overseas_disabled·overseas_market_disabled·us_session_open·no_new_session)과
 * 실패(failReason: 데이터 모름 503 은 failed 로 기록 — holidays_unknown·fx_unknown·earnings_unknown·candles_unavailable·fx_inconsistent·candle_scale_suspect).
 */
export const ANALYSIS_REASON_KO: Readonly<Record<string, string>> = {
  weekend: '주말',
  holiday: '휴장',
  market_holiday: '휴장',
  overseas_disabled: '해외 장마감 후 분석 꺼짐', // 설정 화면 토글 「해외 장마감 후 분석 (미국 시나리오)」 과 같은 이름
  overseas_market_disabled: '해외 시장 꺼짐(서버 환경 설정)', // 화면 토글이 아니라 서버 환경변수 KIS_OVERSEAS_ENABLED
  us_session_open: '미국 장 진행 중',
  no_new_session: '새 세션 없음',
  holidays_unknown: '휴장표 모름',
  fx_unknown: '환율 모름',
  fx_inconsistent: '환율 불일치',
  earnings_unknown: '실적 일정 모름',
  candles_unavailable: '일봉 없음',
  candle_scale_suspect: '일봉 단위 의심',
};

/** 분석 사유 코드 → 말. 없으면 null, 모르는 코드는 「사유 코드 {code}」. */
export function analysisReasonText(code: string | null | undefined): string | null {
  if (code == null) return null;
  const c = String(code).trim();
  if (!c) return null;
  return ANALYSIS_REASON_KO[c] ?? `사유 코드 ${c}`;
}

/** 서버가 준 건너뜀 사유 코드 — `skipReason` 이 있으면 그것, 없으면 Metric.reason(옛 `skip:<코드>` 표기도 읽는다). */
export function skipReasonCode(row: { skipReason?: string | null; evaluated?: { reason?: string } | null }): string | null {
  const direct = row.skipReason;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const r = row.evaluated?.reason;
  if (typeof r === 'string' && r.trim()) {
    const c = r.startsWith('skip:') ? r.slice(5).trim() : r.trim();
    return c && c !== 'skip' ? c : null;
  }
  return null;
}

/** 「건너뜀 · 주말」 / 모르는 코드 「건너뜀 · 사유 코드 x」 / 코드 없음 「건너뜀 · 사유 모름」 — 「휴장」 으로 단정하지 않는다. */
export function skipText(code: string | null | undefined): string {
  return `건너뜀 · ${analysisReasonText(code) ?? '사유 모름'}`;
}

/** 안전 상태 읽기 오류 코드(SafetyStateDTO.errors) → 말. */
export const SAFETY_ERROR_KO: Readonly<Record<string, string>> = {
  db_unreachable: 'DB 연결 실패',
  strategies_error: '전략 목록 읽기 실패',
  exit_switch_db_error: '청산 스위치 읽기 실패',
  notify_read_error: '알림 설정 읽기 실패',
  dry_run_read_error: '실거래여부 읽기 실패',
  kill_switch_read_error: '모든거래차단 읽기 실패',
};
export function safetyErrorsText(codes: string | null | undefined): string | null {
  if (!codes) return null;
  const list = String(codes).split(',').map((c) => c.trim()).filter(Boolean);
  if (list.length === 0) return null;
  return list.map((c) => SAFETY_ERROR_KO[c] ?? `사유 코드 ${c}`).join(' · ');
}
