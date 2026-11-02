/**
 * T-130 WP2 — 사전(`src/lib/ops/reason-dictionary.ts`)의 **문구 표 고정**. 승인 데모 v1(사용자 「전부 권고대로」)의 4-1~4-7·청산 이름·시그널 운명·차단 칩 표를
 * 글자 단위로 단언한다 — 표가 바뀌면 이 시험이 실패해 데모/가이드와 어긋남을 알린다. (코드 ↔ 사전 키 일치는 `reason-dictionary-keys.test.ts`)
 *
 * 규칙: 새 문구를 이 시험에서 지어내지 않는다 — 가이드(`T-130` Designer 구현 가이드 4장)의 글자를 그대로 옮겼다.
 */
jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));

import * as dict from '@/lib/ops/reason-dictionary';
import { VALIDATION_GATE_INDICATOR } from '@/lib/signals/paper-fill';
import { JOB_SPECS } from '@/lib/strategy/records/job-slots';

describe('4-1 요청·섹션 조회 실패 → 칩 「! 조회 실패 · {말}」', () => {
  test.each([
    ['network', '연결 끊김'], ['timeout', '응답 시간 초과'], ['api_error', '서버가 실패로 응답'], ['bad_json', '응답 해석 실패'],
    ['missing', '응답에 항목 없음'], ['db_error', 'DB 오류'], ['not_migrated', '기록 표 준비 전'],
    ['internal_error', '서버 내부 오류'], ['not_select', '서버 내부 오류'], ['error', '원인 모름'],
  ])('%s → %s', (code, word) => {
    const r = dict.errorChipText(code);
    expect(r.text).toBe(`! 조회 실패 · ${word}`);
    expect(r.word).toBe(word);
  });
  test('http_{세 자리} → 서버 오류 {세 자리} (정규식 ^http_(\\d{3})$ — 두 자리·네 자리·접두 불일치는 모르는 코드)', () => {
    expect(dict.errorChipText('http_503').text).toBe('! 조회 실패 · 서버 오류 503');
    expect(dict.errorChipText('http_401').word).toBe('서버 오류 401');
    expect(dict.errorChipText('http_50').text).toBe('! 조회 실패 · 알 수 없는 사유');
    expect(dict.errorChipText('http_5033').text).toBe('! 조회 실패 · 알 수 없는 사유');
    expect(dict.errorChipText('xhttp_503').text).toBe('! 조회 실패 · 알 수 없는 사유');
  });
  test('빈 코드·null·undefined → 원인 모름', () => {
    for (const c of ['', '  ', null, undefined]) expect(dict.errorChipText(c).text).toBe('! 조회 실패 · 원인 모름');
  });
  test('unauthorized → 칩 전체 「! 로그인 필요」, 원인 말은 「로그인 필요」', () => {
    const r = dict.errorChipText('unauthorized');
    expect(r.text).toBe('! 로그인 필요');
    expect(r.word).toBe('로그인 필요');
  });
  test('모르는 코드 → 「! 조회 실패 · 알 수 없는 사유」 — 영문 코드를 칩 글자에 쓰지 않는다', () => {
    const r = dict.errorChipText('totally_new_code');
    expect(r.text).toBe('! 조회 실패 · 알 수 없는 사유');
    expect(r.text).not.toContain('totally_new_code');
    expect(r.code).toBeNull();
  });
  test('D4-A: code(원문)는 showCode 일 때만 — 분석 › 데이터 상태 전용. 빈 코드는 null', () => {
    expect(dict.errorChipText('balances_unknown').code).toBeNull();
    expect(dict.errorChipText('balances_unknown', { showCode: true }).code).toBe('balances_unknown');
    expect(dict.errorChipText('totally_new_code', { showCode: true })).toEqual({ text: '! 조회 실패 · 알 수 없는 사유', word: '알 수 없는 사유', code: 'totally_new_code' });
    expect(dict.errorChipText('', { showCode: true }).code).toBeNull();
    expect(dict.errorChipText('unauthorized', { showCode: true }).code).toBe('unauthorized');
    // 칩 글자(text)에는 어느 경우에도 코드가 섞이지 않는다 — 코드는 별도 필드
    expect(dict.errorChipText('db_error', { showCode: true }).text).toBe('! 조회 실패 · DB 오류');
  });
  test('FETCH_ERROR_KO 표 전체(키 10개)', () => {
    expect(dict.FETCH_ERROR_KO).toEqual({
      network: '연결 끊김', timeout: '응답 시간 초과', api_error: '서버가 실패로 응답', bad_json: '응답 해석 실패', missing: '응답에 항목 없음',
      db_error: 'DB 오류', not_migrated: '기록 표 준비 전', internal_error: '서버 내부 오류', not_select: '서버 내부 오류', error: '원인 모름',
    });
  });
});

describe('4-2 지표 자체 실패 → 칩 전체 문구 (「조회 실패」 틀을 쓰지 않는다)', () => {
  test.each([
    ['balances_unknown', '! 잔고를 읽지 못함'],
    ['exit_switch_db_error', '! 청산 스위치 읽기 실패'],
    ['holdings_error', '! 보유 종목 읽기 실패'],
    ['all_sources_failed', '! 데이터 원천을 하나도 읽지 못함'],
    ['evaluated_zero', '! 평가 종목 0 — 분석 이상'],
    ['strategies_error', '! 전략 목록 읽기 실패'],
  ])('%s → %s', (code, chip) => {
    const r = dict.errorChipText(code);
    expect(r.text).toBe(chip);
    expect(r.text).not.toContain('조회 실패 ·');
    expect(r.word).toBe(chip.replace(/^! /, ''));
  });
  test('METRIC_ERROR_CHIP_KO 표 전체(키 6개)', () => {
    expect(dict.METRIC_ERROR_CHIP_KO).toEqual({
      balances_unknown: '! 잔고를 읽지 못함', exit_switch_db_error: '! 청산 스위치 읽기 실패', holdings_error: '! 보유 종목 읽기 실패',
      all_sources_failed: '! 데이터 원천을 하나도 읽지 못함', evaluated_zero: '! 평가 종목 0 — 분석 이상', strategies_error: '! 전략 목록 읽기 실패',
    });
  });
  test('문구가 없는 run_failed 는 모르는 코드와 같다(후속) — 홈·거래·분석에서 영문이 보이지 않는다', () => {
    expect(dict.errorChipText('run_failed').text).toBe('! 조회 실패 · 알 수 없는 사유');
  });
});

describe('4-3 분석 사유', () => {
  test('값 변경·추가', () => {
    expect(dict.ANALYSIS_REASON_KO.overseas_market_disabled).toBe('해외 시장 꺼짐(서버 설정)');
    expect(dict.ANALYSIS_REASON_KO.rag_fail).toBe('뉴스 참고 자료 조회 실패');
    expect(dict.ANALYSIS_REASON_KO.no_symbols).toBe('대상 종목 없음');
    // 나머지 12개는 그대로(T-128 문구 불변)
    expect(dict.ANALYSIS_REASON_KO).toMatchObject({
      weekend: '주말', holiday: '휴장', market_holiday: '휴장', overseas_disabled: '해외 장마감 후 분석 꺼짐', us_session_open: '미국 장 진행 중',
      no_new_session: '새 세션 없음', holidays_unknown: '휴장표 모름', fx_unknown: '환율 모름', fx_inconsistent: '환율 불일치',
      earnings_unknown: '실적 일정 모름', candles_unavailable: '일봉 없음', candle_scale_suspect: '일봉 단위 의심',
    });
    // (T-143 WP-A) symbol_source_fail·universe_disabled·universe_run_expired 가 더해져 18, 그 뒤
    //   M-8 의 universe_wrong_weekday·universe_outside_window 로 20 — 전부 「조용히 안 돈 것」을 홈에서 말로 보이게 한다
    expect(Object.keys(dict.ANALYSIS_REASON_KO)).toHaveLength(20);
    expect(dict.ANALYSIS_REASON_KO).toMatchObject({
      universe_wrong_weekday: '해외 분석 대상 산출 — 설정된 요일·회차가 아님',
      universe_outside_window: '해외 분석 대상 산출 — 설정된 시간 창 밖',
    });
  });
  test('모르는 코드는 「알 수 없는 사유」 — 「사유 코드 x」 로 영문을 보이지 않는다', () => {
    expect(dict.analysisReasonText('brand_new')).toBe('알 수 없는 사유');
    expect(dict.analysisReasonText(null)).toBeNull();
    expect(dict.analysisReasonText('  ')).toBeNull();
  });
  test('skipReasonCode: 정리한 값이 skipped·skip 이면 사유 없음(null) — 기본값을 코드로 돌려주지 않는다', () => {
    expect(dict.skipReasonCode({ skipReason: 'weekend' })).toBe('weekend');
    expect(dict.skipReasonCode({ skipReason: null, evaluated: { reason: 'skip:no_new_session' } })).toBe('no_new_session');
    expect(dict.skipReasonCode({ skipReason: null, evaluated: { reason: 'skipped' } })).toBeNull();
    expect(dict.skipReasonCode({ skipReason: null, evaluated: { reason: 'skip:skipped' } })).toBeNull();
    expect(dict.skipReasonCode({ skipReason: null, evaluated: { reason: 'skip' } })).toBeNull();
    expect(dict.skipReasonCode({ skipReason: 'skipped' })).toBeNull();
    expect(dict.skipReasonCode({ skipReason: 'skipped', evaluated: { reason: 'weekend' } })).toBe('weekend');   // 직접 값이 사유 없음이면 Metric.reason 을 본다
    expect(dict.skipReasonCode({})).toBeNull();
  });
  test('skipText: 코드 없음 「건너뜀 · 사유 기록 없음」 · 모르는 코드 「건너뜀 · 알 수 없는 사유」 · 알려진 코드 「건너뜀 · 주말」', () => {
    expect(dict.skipText(null)).toBe('건너뜀 · 사유 기록 없음');
    expect(dict.skipText(undefined)).toBe('건너뜀 · 사유 기록 없음');
    expect(dict.skipText('brand_new')).toBe('건너뜀 · 알 수 없는 사유');
    expect(dict.skipText('weekend')).toBe('건너뜀 · 주말');
    // 사유 없는 건너뜀의 기본값이 코드로 들어와도 사유 없음(서버 최근 활동 경로 ↔ 화면 지표 경로가 같은 글자)
    expect(dict.skipText('skipped')).toBe('건너뜀 · 사유 기록 없음');
    expect(dict.skipText('skip')).toBe('건너뜀 · 사유 기록 없음');
    expect(dict.skipText('  ')).toBe('건너뜀 · 사유 기록 없음');
    expect(dict.skipText(dict.skipReasonCode({ skipReason: null, evaluated: { reason: 'skipped' } }))).toBe('건너뜀 · 사유 기록 없음');
  });
});

describe('4-4 데이터 이상 — 서버 사전에는 없고 화면 쪽(check-copy)에 있으나 대체어 상수는 사전', () => {
  test('대체어 상수', () => {
    expect(dict.UNKNOWN_REASON).toBe('알 수 없는 사유');
    expect(dict.UNKNOWN_JOB).toBe('알 수 없는 작업');
  });
});

describe('4-5 잡 이름', () => {
  const TABLE: Array<[string, string]> = [
    ['post-market-domestic', '국내 장마감 분석'], ['post-market-overseas', '해외 장마감 분석'], ['strategy-eval', '장중 전략 평가'],
    ['entry-watcher', '진입 감시'], ['signal-expiry', '시그널 만료 처리'], ['signal-followup', '시그널 사후 추적'],
    ['portfolio-snapshot', '포트폴리오 스냅샷'], ['trade-report', '거래 리포트 발송'], ['daily-bars', '일봉 수집'],
    ['broker-fills', '브로커 원장 수집'], ['news-fetch-domestic', '국내 뉴스 수집(아침)'], ['news-fetch-domestic-pm', '국내 뉴스 수집(오후)'],
    ['news-fetch-overseas', '해외 뉴스 수집'], ['sync-stock-meta', '국내 종목 정보 동기화'], ['rs-update-domestic', '국내 상대강도 갱신'],
    ['research-cycle-domestic', '국내 리서치'], ['research-cycle-overseas', '해외 리서치'], ['kis-fundamentals-snapshot', '해외 재무 지표 수집'],
    ['edgar-sync', '미국 공시 수집'], ['holdings-premarket', '보유 종목 개장 전 공시 확인'], ['holding-checker', '보유 종목 점검'], ['stop-alert', '손절 알림'],
    // (T-143 WP-A) 해외 분석 대상 월간 산출 — 매월 첫째 일요일 창에서 돈다
    ['overseas-universe-refresh', '해외 분석 대상 갱신'],
  ];
  test.each(TABLE)('%s → %s', (id, name) => { expect(dict.jobNameText(id)).toBe(name); });
  test('표 전체(키 23개) — 위 표와 같다', () => {
    expect(dict.JOB_NAME_KO).toEqual(Object.fromEntries(TABLE));
  });
  test('뉴스 확인(peek): {HH} 는 id 의 두 자리 그대로', () => {
    expect(dict.jobNameText('news-peek-domestic-10')).toBe('국내 뉴스 확인 10시');
    expect(dict.jobNameText('news-peek-domestic-13')).toBe('국내 뉴스 확인 13시');
    expect(dict.jobNameText('news-peek-overseas-06')).toBe('해외 뉴스 확인 06시');
    expect(dict.jobNameText('news-peek-overseas-9')).toBe('알 수 없는 작업');          // 한 자리·세 자리는 정규식 불일치
    expect(dict.jobNameText('news-peek-asia-10')).toBe('알 수 없는 작업');
  });
  test('모르는 잡·빈 값 → 「알 수 없는 작업」 — 영문 id 를 그대로 보이지 않는다', () => {
    for (const id of ['strategy-eval-x', 'export-llm-trainset', '', null, undefined]) expect(dict.jobNameText(id as string | null | undefined)).toBe('알 수 없는 작업');
    expect(dict.jobNameText('constructor')).toBe('알 수 없는 작업');                    // Object 프로토타입 키가 새어 나오지 않는다
  });
  test('실행 기록 잡 표(JOB_SPECS)의 모든 잡이 이름을 갖는다 — 잡이 늘면 이 시험이 알린다', () => {
    const unnamed = JOB_SPECS.map((s) => s.jobId).filter((id) => dict.jobNameText(id) === dict.UNKNOWN_JOB);
    expect(unnamed).toEqual([]);
  });
});

describe('4-6 주문 차단·거부 사유', () => {
  test('차단 사유(승인 문구)', () => {
    expect(dict.ORDER_REASON_KO).toMatchObject({
      kill_switch: '모든거래차단 ON', validation_gate: '검증 관문', order_limit: '1회 주문 한도 초과', daily_limit: '일일 누적 한도 초과',
      symbol_not_allowed: '거래 차단 종목', vol_block: '변동폭 가드 · 차단 임계', vol_panic: '변동폭 가드 · 패닉 임계',
      invalid_side: '주문 방향 오류', dry_run: '가상 주문 · 실거래여부 OFF',
    });
  });
  test('증권사 거부 15개는 그대로', () => {
    expect(dict.ORDER_REASON_KO).toMatchObject({
      kis_rejected: '증권사 거부', kis_4xx: '증권사 요청 거부', kis_5xx: '증권사 서버 오류 — 결과 확인 필요', network_error: '연결 오류 — 결과 확인 필요',
      rate_limit: '증권사 호출 한도 초과', kis_token: '증권사 인증 토큰 오류', insufficient_balance: '주문 가능 금액 부족', insufficient_qty: '주문 가능 수량 부족',
      price_unit: '호가 단위 오류', market_closed: '장 마감·시간 외', time_restriction: '주문 가능 시간 아님', trading_halt: '거래 정지·관리 종목',
      auction_phase: '단일가·동시호가 구간', bad_number_field: '수량·가격 값 오류', qty_calc_failed: '수량 계산 실패',
    });
    expect(Object.keys(dict.ORDER_REASON_KO)).toHaveLength(24);
  });
  test('orderReasonText: 없음 null · 알려진 코드 말 · 모르는 코드 「알 수 없는 사유」', () => {
    expect(dict.orderReasonText(null)).toBeNull();
    expect(dict.orderReasonText('')).toBeNull();
    expect(dict.orderReasonText('kill_switch')).toBe('모든거래차단 ON');
    expect(dict.orderReasonText('totally_new')).toBe('알 수 없는 사유');
  });
  test('안전 상태 오류(safetyErrorsText)는 D4-A 예외 — 모르는 코드에 「사유 코드 x」 유지(안전 상태를 못 읽는 이유를 숨기지 않는다)', () => {
    expect(dict.safetyErrorsText('db_unreachable,dry_run_mismatch')).toBe('DB 연결 실패 · 사유 코드 dry_run_mismatch');
    expect(dict.safetyErrorsText('kill_switch_mismatch')).toBe('사유 코드 kill_switch_mismatch');
    expect(dict.safetyErrorsText('')).toBeNull();
  });
});

describe('4-7 AI 판단 제외 사유', () => {
  const TABLE: Array<[string, string]> = [
    ['candle_fail', '일봉 조회 실패'], ['stale_candle', '일봉이 최신 아님'], ['blackout', '실적 발표 전후라 제외'],
    ['prefilter_unaffordable', '사전 금액 필터 — 1주 가격이 커서 제외'], ['llm_error', 'AI 응답 실패'], ['schema_invalid', 'AI 응답 형식 오류'],
    ['zone_out_of_range', '진입 구간이 범위 밖'], ['low_confidence', 'AI 신뢰도 60 미만'], ['unaffordable', '1주도 살 수 없음'],
    ['duplicate', '같은 시그널이 이미 있음'], ['validation_blocked', '검증 관문 차단'], ['insert_fail', '시그널 저장 실패'],
  ];
  test.each(TABLE)('%s → %s', (code, text) => { expect(dict.exclusionText(code)).toBe(text); });
  test('표 전체(키 12개) · 모르는 코드·빈 값 → 「알 수 없는 사유」', () => {
    expect(dict.EXCLUSION_KO).toEqual(Object.fromEntries(TABLE));
    for (const c of ['brand_new', '', null, undefined, 'constructor']) expect(dict.exclusionText(c as string | null | undefined)).toBe('알 수 없는 사유');
  });
});

describe('청산 이름 (D8-A) — 한 벌', () => {
  test('승인된 이름 4개', () => {
    expect(dict.EXIT_KIND_LABEL).toEqual({ hard_stop: '손실한도 손절', eod_loss_cut: '장마감 전 손절', trailing_stop: '트레일링 스탑', target_profit: '목표 익절' });
    expect(dict.exitKindLabel('trailing_stop')).toBe('트레일링 스탑');
    expect(dict.exitKindLabel('target_profit')).toBe('목표 익절');
  });
  test('모르는 코드·없음 → 「청산」(지금과 같음)', () => {
    expect(dict.exitKindLabel('nope')).toBe('청산');
    expect(dict.exitKindLabel(null)).toBe('청산');
    expect(dict.exitKindLabel('')).toBe('청산');
  });
});

describe('시그널 운명 (D7-A) · 차단 칩 (5번)', () => {
  test('비교 상수는 VALIDATION_GATE_INDICATOR(paper-fill) 와 같은 값 — 사전이 DB 풀을 import 하지 않으려고 타입으로만 묶었으므로 값 일치를 여기서 고정한다', () => {
    expect(VALIDATION_GATE_INDICATOR).toBe('validation_gate');
    expect(dict.signalFate('skipped', VALIDATION_GATE_INDICATOR)).toEqual({ blocked: true, chip: '⊘ 차단 · 검증 관문' });
  });
  test('skipped + gate=validation_gate → 차단 / skipped + gate 없음·다른 값 → 건너뜀(차단 아님) / 그 밖 상태 → null', () => {
    expect(dict.signalFate('skipped', 'validation_gate')).toEqual({ blocked: true, chip: '⊘ 차단 · 검증 관문' });
    expect(dict.signalFate('skipped', null)).toEqual({ blocked: false, chip: '건너뜀 · 사유 기록 없음' });
    expect(dict.signalFate('skipped', undefined)).toEqual({ blocked: false, chip: '건너뜀 · 사유 기록 없음' });
    expect(dict.signalFate('skipped', 'min_qty')).toEqual({ blocked: false, chip: '건너뜀 · 사유 기록 없음' });
    for (const st of ['approved', 'expired', 'awaiting_approval', 'ai_skipped', '', null, undefined]) expect(dict.signalFate(st, 'validation_gate')).toBeNull();
  });
  test('skippedFate(gate) = signalFate("skipped", gate) (null 없음)', () => {
    for (const g of ['validation_gate', null, undefined, 'x']) expect(dict.skippedFate(g)).toEqual(dict.signalFate('skipped', g));
  });
  test('blockedChipText: validation_gate → 「⊘ 차단 · 검증 관문」 · engine_off → 차단이 아니라 off 칩 「엔진 꺼짐」 · 그 밖·없음 → 「⊘ 차단」', () => {
    expect(dict.blockedChipText('validation_gate')).toEqual({ kind: 'blocked', text: '⊘ 차단 · 검증 관문' });
    expect(dict.blockedChipText('engine_off')).toEqual({ kind: 'off', text: '엔진 꺼짐' });
    expect(dict.blockedChipText('order_max_unset')).toEqual({ kind: 'blocked', text: '⊘ 차단' });
    expect(dict.blockedChipText(null)).toEqual({ kind: 'blocked', text: '⊘ 차단' });
    expect(dict.blockedChipText(undefined)).toEqual({ kind: 'blocked', text: '⊘ 차단' });
  });
});
