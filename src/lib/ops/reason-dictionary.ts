/**
 * 사유 코드 → 화면 말 — **단일 출처** (T-128 A2). 서버(`src/lib/ops/metrics/activity.ts`)와 화면(`src/components/ops/reason-copy.ts`
 * 가 이 모듈을 그대로 다시 내보낸다)이 같은 사전을 쓴다. 예전에는 서버 `REASON_KO` 와 화면 사전이 두 벌이라 같은 코드가 다른 말
 * (예: overseas_disabled 「해외 분석 꺼짐」 / 「해외 장마감 후 분석 꺼짐」)이 됐다 — 화면이 서버 문구를 덮어써 사용자에게는 화면 쪽만 보였으므로
 * 화면 쪽 문구를 정본으로 남겼다(보이는 글자 불변).
 *
 * 순수 모듈(React·DB·Node 의존 없음) — 서버·클라이언트 어디서든 import 한다.
 * 서버가 내는 사유 코드마다 이 사전에 말이 있거나 허용 목록(`KNOWN_UNMAPPED`)에 이유와 함께 있어야 한다 —
 * 키 일치 시험 `src/lib/ops/__tests__/reason-dictionary-keys.test.ts`.
 *
 * T-130(데모 v1 승인 — 사용자 「전부 권고대로」)부터 문구 값은 승인된 데모 표(4-1~4-7·청산 이름·시그널 운명)의 글자를 그대로 쓴다.
 * 이 파일에서 새 한국어 문구를 지어내지 않는다 — 표에 없는 코드는 아래 대체어(UNKNOWN_*)로만 말한다.
 *
 * D4-A 규칙: 사전에 없는 코드는 홈·거래·분석(오늘 분석·검증·성과)에서 **한국어 대체어만** 보이고, 분석 › 데이터 상태에서만 한국어 뒤에 작은 코드를 붙인다
 * (`errorChipText` 의 `showCode`). 단 안전 상태 읽기 오류(`safetyErrorsText`)는 예외 — 안전 상태를 못 읽는 이유를 홈에서 숨기지 않으려고 모르는 코드에
 * 지금처럼 「사유 코드 {code}」 를 유지한다.
 *
 * - 주문 차단·거부 사유(`orders.blocked_by`): 정본 = `src/lib/safety/dry-run.ts`(차단 분기 · `categorizeRejectReason`)
 *   · `src/lib/safety/order-limits.ts`(order_limit·daily_limit·symbol_not_allowed).
 * - 장마감 분석 건너뜀 사유: 정본 = `src/lib/strategy/post-market-overseas.ts`(skipped: …)·`post-market-engine.ts`(weekend).
 *   **건너뜀을 「휴장」으로 단정하지 않는다** — 휴장은 엔진이 휴장이라고 말한 코드일 때만.
 */
// 비교 상수는 `VALIDATION_GATE_INDICATOR`(paper-fill.ts) 와 같은 값이어야 한다. 그러나 그 모듈은 DB 풀(`@/lib/db`)을 import 하므로
// 이 순수 모듈(클라이언트 번들에 들어간다)이 값으로 가져오면 브라우저 번들이 깨진다 → **타입으로만** 묶는다(런타임 import 없음).
// 값이 바뀌면 아래 `VALIDATION_GATE` 의 타입이 어긋나 tsc 가 실패한다(+ 같은 값 단언 시험 `reason-dictionary-t130.test.ts`).
import type { VALIDATION_GATE_INDICATOR } from '@/lib/signals/paper-fill';

/** 사전에 없는 사유 코드의 한국어 대체어(홈·거래·분석 — 영문 코드를 그대로 보이지 않는다). */
export const UNKNOWN_REASON = '알 수 없는 사유';
/** 사전에 없는 잡 id 의 한국어 대체어. */
export const UNKNOWN_JOB = '알 수 없는 작업';

/** 주문 차단·거부 사유 — 확인 필요 「주문 거부」 부제 등. */
export const ORDER_REASON_KO: Readonly<Record<string, string>> = {
  kill_switch: '모든거래차단 ON',
  dry_run: '가상 주문 · 실거래여부 OFF',
  symbol_not_allowed: '거래 차단 종목',
  order_limit: '1회 주문 한도 초과',
  daily_limit: '일일 누적 한도 초과',
  vol_block: '변동폭 가드 · 차단 임계',
  vol_panic: '변동폭 가드 · 패닉 임계',
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

/** 주문 사유 코드 → 말. 없으면 null, 모르는 코드는 「알 수 없는 사유」. */
export function orderReasonText(code: string | null | undefined): string | null {
  if (code == null) return null;
  const c = String(code).trim();
  if (!c) return null;
  return ORDER_REASON_KO[c] ?? UNKNOWN_REASON;
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
  overseas_market_disabled: '해외 시장 꺼짐(서버 설정)', // 화면 토글이 아니라 서버 환경변수 KIS_OVERSEAS_ENABLED
  us_session_open: '미국 장 진행 중',
  no_new_session: '새 세션 없음',
  holidays_unknown: '휴장표 모름',
  fx_unknown: '환율 모름',
  fx_inconsistent: '환율 불일치',
  earnings_unknown: '실적 일정 모름',
  candles_unavailable: '일봉 없음',
  candle_scale_suspect: '일봉 단위 의심',
  rag_fail: '뉴스 참고 자료 조회 실패',
  no_symbols: '대상 종목 없음',
  // (T-143 WP-A) 해외 분석이 **대상 목록 원천을 읽지 못해 폴백으로** 돈 회차. 분석 자체는 성공해도 `ok` 가 아니다 —
  //   목록이 조용히 줄어든 채 몇 주가 지나는 것이 이 프로젝트가 반복해서 겪은 실패 유형이라 홈에 올린다.
  symbol_source_fail: '분석 대상 목록 원천 조회 실패',
  // (T-143 WP-A) 해외 분석 대상 자동 산출 스위치가 꺼져 있어 그 달 산출을 하지 않았다
  universe_disabled: '해외 분석 대상 자동 산출 꺼짐',
  // (T-143 WP-A) 지난 달 산출이 창 안에 끝나지 않아 만료로 닫혔다 — 자동 목록은 그 전 달 것으로 남아 있다
  universe_run_expired: '해외 분석 대상 산출 미완료(만료)',
  // (T-143 WP-A · M-8) 관문 거절이 성공으로 묻히지 않게. 설정(`system_config`)과 러너 상수가 어긋났다는 뜻이다.
  universe_wrong_weekday: '해외 분석 대상 산출 — 설정된 요일·회차가 아님',
  universe_outside_window: '해외 분석 대상 산출 — 설정된 시간 창 밖',
};

/** 분석 사유 코드 → 말. 없으면 null, 모르는 코드는 「알 수 없는 사유」. */
export function analysisReasonText(code: string | null | undefined): string | null {
  if (code == null) return null;
  const c = String(code).trim();
  if (!c) return null;
  return ANALYSIS_REASON_KO[c] ?? UNKNOWN_REASON;
}

/** 사유 없는 건너뜀이 남기는 기본값 — 코드가 아니라 「사유 없음」 이다(`analysis-runs.ts` `skipCode ?? 'skipped'`, 옛 `skip` 접두 단독). */
const NO_SKIP_REASON: ReadonlySet<string> = new Set(['skipped', 'skip']);

/**
 * 서버가 준 건너뜀 사유 코드 — `skipReason` 이 있으면 그것, 없으면 Metric.reason(옛 `skip:<코드>` 표기도 읽는다).
 * 정리한 값이 `skipped`·`skip` 이면 사유 없음(null) — 예전에는 기본값 `skipped` 를 코드로 돌려 「건너뜀 · 사유 코드 skipped」 가 나왔다(T-130).
 */
export function skipReasonCode(row: { skipReason?: string | null; evaluated?: { reason?: string } | null }): string | null {
  const clean = (v: unknown): string | null => {
    if (typeof v !== 'string') return null;
    const t = v.trim();
    const c = t.startsWith('skip:') ? t.slice(5).trim() : t;
    return c && !NO_SKIP_REASON.has(c) ? c : null;
  };
  return clean(row.skipReason) ?? clean(row.evaluated?.reason);
}

/**
 * 「건너뜀 · 주말」 / 모르는 코드 「건너뜀 · 알 수 없는 사유」 / 코드 없음 「건너뜀 · 사유 기록 없음」 — 「휴장」 으로 단정하지 않는다.
 * `skipped`·`skip`(사유 없는 건너뜀의 기본값)이 코드로 들어와도 사유 없음으로 말한다 — 서버 최근 활동(`skipReasonOf` 는 `skipped` 를 코드로 통과시킨다)과
 * 화면 지표 경로(`skipReasonCode`)가 같은 글자가 되게 하려고 여기서도 거른다.
 */
export function skipText(code: string | null | undefined): string {
  const c = code == null ? '' : String(code).trim();
  return `건너뜀 · ${(c && !NO_SKIP_REASON.has(c) ? analysisReasonText(c) : null) ?? '사유 기록 없음'}`;
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
/** 예외(D4-A) — 모르는 코드는 「사유 코드 {code}」 를 유지한다: 안전 상태를 못 읽은 이유는 홈에서 숨기지 않는다. */
export function safetyErrorsText(codes: string | null | undefined): string | null {
  if (!codes) return null;
  const list = String(codes).split(',').map((c) => c.trim()).filter(Boolean);
  if (list.length === 0) return null;
  return list.map((c) => SAFETY_ERROR_KO[c] ?? `사유 코드 ${c}`).join(' · ');
}

// ── 조회 실패 칩 (T-130 4-1·4-2) ─────────────────────────────────────────────

/** 4-1 요청·섹션 조회 실패 사유 → 말. 칩은 `! 조회 실패 · {말}`. (`unauthorized` 는 칩 전체가 따로 — `errorChipText`) */
export const FETCH_ERROR_KO: Readonly<Record<string, string>> = {
  network: '연결 끊김',
  timeout: '응답 시간 초과',
  api_error: '서버가 실패로 응답',
  bad_json: '응답 해석 실패',
  missing: '응답에 항목 없음',
  db_error: 'DB 오류',
  not_migrated: '기록 표 준비 전',
  internal_error: '서버 내부 오류',
  not_select: '서버 내부 오류',
  error: '원인 모름',
};

/** 4-2 지표 자체 실패 → **칩 전체 문구**(「조회 실패」 틀을 쓰지 않는다). */
export const METRIC_ERROR_CHIP_KO: Readonly<Record<string, string>> = {
  balances_unknown: '! 잔고를 읽지 못함',
  exit_switch_db_error: '! 청산 스위치 읽기 실패',
  holdings_error: '! 보유 종목 읽기 실패',
  all_sources_failed: '! 데이터 원천을 하나도 읽지 못함',
  evaluated_zero: '! 평가 종목 0 — 분석 이상',
  strategies_error: '! 전략 목록 읽기 실패',
};

export const LOGIN_REQUIRED_CHIP = '! 로그인 필요';
const FETCH_PREFIX = '! 조회 실패 · ';
const HTTP_CODE = /^http_(\d{3})$/;

/**
 * 조회 실패 코드 → 칩 글자.
 * - `text` = 칩 전체(`! 조회 실패 · 연결 끊김` / `! 잔고를 읽지 못함` / `! 로그인 필요`)
 * - `word` = 원인 말만(접두 `! 조회 실패 · `·`! ` 없이) — 「확인 필요」 조회 실패 부제처럼 문장 안에 넣을 때
 * - `code` = 원문 코드 — `showCode` 일 때만(분석 › 데이터 상태. 그 밖 화면은 영문 코드를 보이지 않는다, D4-A). 빈 코드·null 이면 null
 */
export function errorChipText(
  code: string | null | undefined,
  opts: { showCode?: boolean } = {},
): { text: string; word: string; code: string | null } {
  const raw = code == null ? '' : String(code).trim();
  const shown = opts.showCode && raw ? raw : null;
  if (raw === 'unauthorized') return { text: LOGIN_REQUIRED_CHIP, word: '로그인 필요', code: shown };
  if (raw && Object.prototype.hasOwnProperty.call(METRIC_ERROR_CHIP_KO, raw)) {
    const chip = METRIC_ERROR_CHIP_KO[raw];
    return { text: chip, word: chip.replace(/^!\s*/, ''), code: shown };
  }
  const http = HTTP_CODE.exec(raw);
  const word = http
    ? `서버 오류 ${http[1]}`
    : !raw ? FETCH_ERROR_KO.error
    : Object.prototype.hasOwnProperty.call(FETCH_ERROR_KO, raw) ? FETCH_ERROR_KO[raw]
    : UNKNOWN_REASON;
  return { text: `${FETCH_PREFIX}${word}`, word, code: shown };
}

// ── 잡 이름 (T-130 4-5) ──────────────────────────────────────────────────────

/**
 * 실행 기록 잡 id → 화면 이름. 잡 목록 정본 = `src/lib/strategy/records/job-slots.ts` `JOB_SPECS`.
 * 뉴스 확인(peek)은 시각이 id 에 들어 있어(`news-peek-domestic-10`) `jobNameText` 가 정규식으로 푼다.
 * 이름 확신이 낮았던 4개(kis-fundamentals-snapshot·holdings-premarket·holding-checker·stop-alert)는 각 `api/cron/<잡>/route.ts` 머리 주석으로 뜻을 확인했다.
 */
export const JOB_NAME_KO: Readonly<Record<string, string>> = {
  'post-market-domestic': '국내 장마감 분석',
  'post-market-overseas': '해외 장마감 분석',
  'strategy-eval': '장중 전략 평가',
  'entry-watcher': '진입 감시',
  'signal-expiry': '시그널 만료 처리',
  'signal-followup': '시그널 사후 추적',
  'portfolio-snapshot': '포트폴리오 스냅샷',
  'trade-report': '거래 리포트 발송',
  'daily-bars': '일봉 수집',
  'daily-bars-kr': '국내 일봉 수집(저녁)',   // (T-170) 18:10 국내 전용 실행
  'broker-fills': '브로커 원장 수집',
  'news-fetch-domestic': '국내 뉴스 수집(아침)',
  'news-fetch-domestic-pm': '국내 뉴스 수집(오후)',
  'news-fetch-overseas': '해외 뉴스 수집',
  'sync-stock-meta': '국내 종목 정보 동기화',
  'rs-update-domestic': '국내 상대강도 갱신',
  'research-cycle-domestic': '국내 리서치',
  'research-cycle-overseas': '해외 리서치',
  'kis-fundamentals-snapshot': '해외 재무 지표 수집',
  'edgar-sync': '미국 공시 수집',
  'holdings-premarket': '보유 종목 개장 전 공시 확인',
  'holding-checker': '보유 종목 점검',
  'stop-alert': '손절 알림',
  // (T-143 WP-A) 월 1회 산출. 가이드 0.2 의 이름을 쓴다 — 폐기된 T-137 의 「해외 분석 종목 갱신」이 아니다
  'overseas-universe-refresh': '해외 분석 대상 갱신',
};
const NEWS_PEEK = /^news-peek-(domestic|overseas)-(\d{2})$/;

/** 잡 id → 화면 이름. 모르는 잡은 「알 수 없는 작업」(영문 id 를 그대로 보이지 않는다). */
export function jobNameText(id: string | null | undefined): string {
  const j = id == null ? '' : String(id).trim();
  if (j && Object.prototype.hasOwnProperty.call(JOB_NAME_KO, j)) return JOB_NAME_KO[j];
  const m = NEWS_PEEK.exec(j);
  if (m) return `${m[1] === 'domestic' ? '국내' : '해외'} 뉴스 확인 ${m[2]}시`;
  return UNKNOWN_JOB;
}

// ── AI 판단 제외 사유 (T-130 4-7) ────────────────────────────────────────────

/** 장마감 AI 판단에서 종목이 빠진 이유(`judgment` 후보 행의 `exclusion_code`) → 말. */
export const EXCLUSION_KO: Readonly<Record<string, string>> = {
  candle_fail: '일봉 조회 실패',
  stale_candle: '일봉이 최신 아님',
  blackout: '실적 발표 전후라 제외',
  prefilter_unaffordable: '사전 금액 필터 — 1주 가격이 커서 제외',
  llm_error: 'AI 응답 실패',
  schema_invalid: 'AI 응답 형식 오류',
  zone_out_of_range: '진입 구간이 범위 밖',
  low_confidence: 'AI 신뢰도 60 미만',
  unaffordable: '1주도 살 수 없음',
  duplicate: '같은 시그널이 이미 있음',
  validation_blocked: '검증 관문 차단',
  insert_fail: '시그널 저장 실패',
};

/** 제외 코드 → 말. 모르는 코드는 「알 수 없는 사유」. */
export function exclusionText(code: string | null | undefined): string {
  const c = code == null ? '' : String(code).trim();
  return c && Object.prototype.hasOwnProperty.call(EXCLUSION_KO, c) ? EXCLUSION_KO[c] : UNKNOWN_REASON;
}

// ── 청산 이름 (T-130 D8-A) ───────────────────────────────────────────────────

/**
 * 청산 종류 표시 이름 — **한 벌**(홈 확인 필요 `check-copy.ts`·서버 최근 활동 `activity.ts` 가 따로 갖던 두 벌을 이것으로 합쳤다).
 * 텔레그램 승인 메시지·저장된 시그널 사유 앞머리([목표 익절]·[트레일링 스탑])와 같은 이름 — 용어 정정표 §12.
 */
export const EXIT_KIND_LABEL: Readonly<Record<string, string>> = {
  hard_stop: '손실한도 손절',
  eod_loss_cut: '장마감 전 손절',
  trailing_stop: '트레일링 스탑',
  target_profit: '목표 익절',
};
export function exitKindLabel(code: string | null | undefined): string {
  if (!code) return '청산';
  return EXIT_KIND_LABEL[code] ?? '청산';
}

// ── 시그널 운명·차단 칩 (T-130 D7-A·5번) ─────────────────────────────────────

/** 검증 관문 감사 행의 `indicators.gate` 값 — `VALIDATION_GATE_INDICATOR`(paper-fill.ts)와 같은 값(타입으로 묶음). */
const VALIDATION_GATE: typeof VALIDATION_GATE_INDICATOR = 'validation_gate';

export interface SignalFate { blocked: boolean; chip: string }

/**
 * 시그널 상태 → 「막혔나, 건너뛰었나」. `skipped` 는 두 경우다 — 검증 관문에 막힌 것(`indicators.gate='validation_gate'`)과
 * 그 밖(수량 1주 미만 등 gate 없음). 둘을 같은 「차단」으로 부르지 않는다(6번·D7-A).
 * - `skipped` + gate=validation_gate → 차단(`⊘ 차단 · 검증 관문`)
 * - `skipped` 그 밖 → 차단 아님(`건너뜀 · 사유 기록 없음`)
 * - 그 밖 상태 → null (호출부의 기존 사전을 그대로 쓴다)
 */
export function signalFate(status: string | null | undefined, gate: string | null | undefined): SignalFate | null {
  return status === 'skipped' ? skippedFate(gate) : null;
}

/** 상태가 이미 `skipped` 로 정해진 호출부(차단 시그널 카드 — 조회 조건이 skipped)용 — `signalFate('skipped', gate)` 와 같다(null 이 없다). */
export function skippedFate(gate: string | null | undefined): SignalFate {
  return gate === VALIDATION_GATE
    ? { blocked: true, chip: '⊘ 차단 · 검증 관문' }
    : { blocked: false, chip: '건너뜀 · 사유 기록 없음' };
}

/**
 * `blocked` 지표 상태의 칩 — 사유별로 말한다(5번 「차단」 규칙).
 * - `validation_gate` → `⊘ 차단 · 검증 관문`
 * - `engine_off` → **차단이 아니라** 꺼짐(`off` 칩 「엔진 꺼짐」)
 * - 그 밖·없음 → `⊘ 차단`(문구 없는 사유는 T-130 후속)
 */
export function blockedChipText(reason: string | null | undefined): { kind: 'blocked' | 'off'; text: string } {
  if (reason === 'engine_off') return { kind: 'off', text: '엔진 꺼짐' };
  if (reason === VALIDATION_GATE) return { kind: 'blocked', text: '⊘ 차단 · 검증 관문' };
  return { kind: 'blocked', text: '⊘ 차단' };
}
