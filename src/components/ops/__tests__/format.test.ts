/**
 * T-108 B-3 — 공통 서식(가이드 §2.1 표 각 행) · U+2212 · fallback 환율 환산 숨김.
 * 재조회 훅의 순수 상태 전이(applyOutcome·readEnvelope)도 여기서 본다(jsdom 없음 — 훅 자체는 QA 브라우저 확인).
 */
import {
  CHIP, DASH, MINUS, fmtCount, fmtEtSession, fmtKrw, fmtKstDateTime, fmtKstHm, fmtKstTime, fmtPct, fmtPnlKrw,
  fmtSession, fmtSessionDate, fmtUsd, fmtUsdWithKrw, kstDateKey,
} from '@/components/ops/format';
import { INITIAL_POLL, OPS_FETCH_TIMEOUT_MS, applyOutcome, fetchOpsWithTimeout, readEnvelope, type PollState } from '@/components/ops/useOpsPoll';
import { analysisReasonText, orderReasonText, safetyErrorsText, skipReasonCode, skipText } from '@/components/ops/reason-copy';

// 2026-10-30(목) 16:20 KST — 데모 가정 시각
const NOW = Date.parse('2026-10-30T16:20:00+09:00');

describe('B-3 금액', () => {
  test('원화: ₩ + ko-KR 천 단위, 소수 없음', () => {
    expect(fmtKrw(1240000)).toBe('₩1,240,000');
    expect(fmtKrw(480000.4)).toBe('₩480,000');
    expect(fmtKrw(0)).toBe('₩0');
    expect(fmtKrw(-8100)).toBe(`${MINUS}₩8,100`);
  });
  test('달러: $ + 소수 2자리', () => {
    expect(fmtUsd(310)).toBe('$310.00');
    expect(fmtUsd(182.4)).toBe('$182.40');
    expect(fmtUsd(1234.567)).toBe('$1,234.57');
    expect(fmtUsd(-3.5)).toBe(`${MINUS}$3.50`);
    expect(fmtUsd(-0.001)).toBe('$0.00'); // 반올림 뒤 0 이면 부호 없음
  });
  test('손익 금액: 부호 + 색 + 글자(이익/손실) — 색만으로 구분하지 않음', () => {
    expect(fmtPnlKrw(12300)).toEqual({ text: '+₩12,300 (이익)', tone: 'up' });
    expect(fmtPnlKrw(-8100)).toEqual({ text: `${MINUS}₩8,100 (손실)`, tone: 'down' });
    expect(fmtPnlKrw(0)).toEqual({ text: '₩0', tone: null });
    expect(fmtPnlKrw(-8100).text.startsWith('−')).toBe(true);
    expect(fmtPnlKrw(-8100).text).not.toContain('-');
  });
  test('손익률: 소수 1자리, 음수 U+2212', () => {
    expect(fmtPct(-2.1)).toEqual({ text: '−2.1%', tone: 'down' });
    expect(fmtPct(2.7)).toEqual({ text: '+2.7%', tone: 'up' });
    expect(fmtPct(-0.04)).toEqual({ text: '0.0%', tone: null });
    expect(fmtPct(-0.6).text).not.toContain('-');
  });
  test('건수: 정수 + 단위', () => {
    expect(fmtCount(44, '종목')).toBe('44종목');
    expect(fmtCount(3)).toBe('3건');
    expect(fmtCount(1200, '건')).toBe('1,200건');
  });
});

describe('B-3 시각 (KST, 브라우저 시간대 무관)', () => {
  test('오늘이면 HH:MM, 아니면 MM-DD HH:MM', () => {
    expect(fmtKstTime('2026-10-30T16:00:00+09:00', NOW)).toBe('16:00');
    expect(fmtKstTime('2026-10-29T16:05:00+09:00', NOW)).toBe('10-29 16:05');
    // UTC 표기도 KST 로 바꾼다 — 10-30 00:30Z = 10-30 09:30 KST
    expect(fmtKstTime('2026-10-30T00:30:00Z', NOW)).toBe('09:30');
    // KST 자정 경계: 10-29 15:00Z = 10-30 00:00 KST(오늘)
    expect(fmtKstTime('2026-10-29T15:00:00Z', NOW)).toBe('00:00');
    expect(fmtKstTime('2026-10-29T14:59:00Z', NOW)).toBe('10-29 23:59');
  });
  test('해석 불가·없음 → —', () => {
    expect(fmtKstTime(null, NOW)).toBe(DASH);
    expect(fmtKstTime('x', NOW)).toBe(DASH);
    expect(fmtKstHm(undefined)).toBe(DASH);
  });
  test('HH:MM 만 · MM-DD HH:MM 항상', () => {
    expect(fmtKstHm('2026-10-31T08:00:00+09:00')).toBe('08:00');
    expect(fmtKstDateTime('2026-10-31T09:00:00+09:00')).toBe('10-31 09:00');
    expect(kstDateKey(NOW)).toBe('2026-10-30');
  });
  test('세션일: 국내 MM-DD · 해외 ET MM-DD (ET 날짜 그대로)', () => {
    expect(fmtSessionDate('2026-10-30')).toBe('10-30');
    expect(fmtEtSession('2026-10-29')).toBe('ET 10-29');
    expect(fmtSession({ sessionDate: '2026-10-29', tz: 'ET' })).toBe('ET 10-29');
    expect(fmtSession({ sessionDate: '2026-10-30', tz: 'KST' })).toBe('10-30');
    expect(fmtSessionDate('10/30')).toBe(DASH);
    expect(fmtSession(null)).toBe(DASH);
  });
});

describe('B-3 원화 환산 — 환율 시각이 있을 때만, fallback·24h 초과면 숨김(D9)', () => {
  test('fx_rates · 24h 이내 → $310.00 ≈ ₩431,600 · meta 「환율 16:15」', () => {
    expect(fmtUsdWithKrw({ usd: 310, krw: 431600, fxAt: '2026-10-30T16:15:00+09:00', fxSource: 'fx_rates', nowMs: NOW }))
      .toEqual({ text: '$310.00 ≈ ₩431,600', converted: true, fxMeta: '환율 16:15' });
  });
  test('fallback → 환산 숨김 + 사유(기본 환율로 원화를 지어내지 않음)', () => {
    const r = fmtUsdWithKrw({ usd: 310, krw: 427800, fxAt: '2026-10-30T16:15:00+09:00', fxSource: 'fallback', rate: 1380, nowMs: NOW });
    expect(r).toEqual({ text: '$310.00', converted: false, fxMeta: '환율 1,380.0 기본값(fallback) — 원화 환산 숨김' });
    expect(r.text).not.toContain('₩');
    expect(fmtUsdWithKrw({ usd: 310, krw: null, fxAt: null, fxSource: null, nowMs: NOW }).fxMeta).toBe('환율 기본값(fallback) — 원화 환산 숨김');
  });
  test('fx_rates 라도 krw 없음 → 숨김', () => {
    expect(fmtUsdWithKrw({ usd: 5, krw: null, fxAt: '2026-10-30T16:15:00+09:00', fxSource: 'fx_rates', nowMs: NOW }).converted).toBe(false);
  });
  test('24시간 초과 → 숨김 + 오래됨 기준 시각', () => {
    const r = fmtUsdWithKrw({ usd: 310, krw: 431600, fxAt: '2026-10-29T16:00:00+09:00', fxSource: 'fx_rates', nowMs: NOW });
    expect(r).toEqual({ text: '$310.00', converted: false, fxMeta: '환율 오래됨 · 기준 10-29 16:00 — 원화 환산 숨김' });
  });
});

describe('B-3 상태 칩 문구(데모 C 절)', () => {
  test('어휘 그대로', () => {
    expect(CHIP.zero).toBe('✓ 확인된 0');
    expect(CHIP.noIssue).toBe('✓ 이상 없음');
    expect(CHIP.unknown).toBe('◌ 미수집');
    expect(CHIP.error('db_error')).toBe('! 조회 실패 · db_error');
    expect(CHIP.stale('10-29 16:05')).toBe('오래됨 · 기준 10-29 16:05');
    expect(CHIP.fewer(8)).toBe('건수 적음 · 8건 (30건 미만)');
    expect(CHIP.blocked('검증 통과 전략 0')).toBe('⊘ 차단 · 검증 통과 전략 0');
    expect(CHIP.offHours('22:30')).toBe('장외 · 개장 22:30 KST');
    expect(CHIP.prep('T-112 기록')).toBe('준비 중 · T-112 기록 뒤');
  });
});

describe('재조회 상태 전이 (useOpsPoll 순수 부분)', () => {
  type D = { n: number };
  const ok = (n: number) => ({ ok: true as const, data: { n } });
  const fail = (code: string) => ({ ok: false as const, code });
  test('첫 성공 → ok · lastOkAt', () => {
    expect(applyOutcome<D>(INITIAL_POLL as PollState<D>, ok(1), 1000, true)).toEqual({ status: 'ok', data: { n: 1 }, lastOkAt: 1000, error: null });
  });
  test('첫 응답부터 실패 → error (지표·띠 모두)', () => {
    expect(applyOutcome<D>(INITIAL_POLL as PollState<D>, fail('network'), 1000, true)).toEqual({ status: 'error', data: null, lastOkAt: null, error: 'network' });
    expect(applyOutcome<D>(INITIAL_POLL as PollState<D>, fail('network'), 1000, false).status).toBe('error');
  });
  test('지표: 성공 뒤 실패 → 마지막 값을 오래됨(stale)으로 유지', () => {
    const s1 = applyOutcome<D>(INITIAL_POLL as PollState<D>, ok(1), 1000, true);
    expect(applyOutcome(s1, fail('http_503'), 2000, true)).toEqual({ status: 'stale', data: { n: 1 }, lastOkAt: 1000, error: 'http_503' });
  });
  test('안전 띠: 성공 뒤 실패 → 마지막 값을 버리고 error(오래된 안전 값을 보이지 않음)', () => {
    const s1 = applyOutcome<D>(INITIAL_POLL as PollState<D>, ok(1), 1000, false);
    expect(applyOutcome(s1, fail('network'), 2000, false)).toEqual({ status: 'error', data: null, lastOkAt: 1000, error: 'network' });
  });
  test('stale 뒤 성공 → ok', () => {
    const s = applyOutcome<D>({ status: 'stale', data: { n: 1 }, lastOkAt: 1000, error: 'x' }, ok(2), 3000, true);
    expect(s).toEqual({ status: 'ok', data: { n: 2 }, lastOkAt: 3000, error: null });
  });
  test('봉투 해석: 401 unauthorized · 5xx http_503 · {ok:false} api_error · JSON 아님 bad_json · 정상', () => {
    expect(readEnvelope(401, { ok: false })).toEqual({ ok: false, code: 'unauthorized' });
    expect(readEnvelope(503, { ok: false, error: 'x' })).toEqual({ ok: false, code: 'http_503' });
    expect(readEnvelope(200, { ok: false, error: 'boom' })).toEqual({ ok: false, code: 'api_error' });
    expect(readEnvelope(200, undefined)).toEqual({ ok: false, code: 'bad_json' });
    expect(readEnvelope(200, null)).toEqual({ ok: false, code: 'api_error' });
    expect(readEnvelope(200, { ok: true, data: { n: 1 } })).toEqual({ ok: true, data: { n: 1 } });
  });
});


describe('요청 시간 상한 (R-UI Minor ⑤ — 멈춘 요청이면 [다시 시도] 무동작이던 문제)', () => {
  /** 응답하지 않는 fetch — signal 이 끊기면 AbortError 로 끝난다 */
  const hanging = ((_u: string, init?: RequestInit) => new Promise<Response>((_res, rej) => {
    init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  })) as unknown as typeof fetch;
  const okFetch = (async () => ({ status: 200, json: async () => ({ ok: true, data: { n: 1 } }) })) as unknown as typeof fetch;
  test('기본 상한 10초', () => { expect(OPS_FETCH_TIMEOUT_MS).toBe(10_000); });
  test('상한을 넘으면 요청을 끊고 timeout 실패(→ 상태가 error/stale 로 바뀌고 다음 요청이 나갈 수 있다)', async () => {
    const t0 = Date.now();
    await expect(fetchOpsWithTimeout('/x', { timeoutMs: 30, fetchImpl: hanging })).resolves.toEqual({ ok: false, code: 'timeout' });
    expect(Date.now() - t0).toBeLessThan(2000);
  });
  test('바깥에서 끊으면(언마운트·새 요청) null — 상태를 바꾸지 않는다', async () => {
    const ac = new AbortController();
    const p = fetchOpsWithTimeout('/x', { timeoutMs: 5000, fetchImpl: hanging, signal: ac.signal });
    ac.abort();
    await expect(p).resolves.toBeNull();
  });
  test('제때 오면 그대로', async () => {
    await expect(fetchOpsWithTimeout('/x', { timeoutMs: 1000, fetchImpl: okFetch })).resolves.toEqual({ ok: true, data: { n: 1 } });
  });
  test('훅: [다시 시도] 는 진행 중 요청을 버리고 새로 보낸다(force) · 주기 재조회는 겹치지 않는다', () => {
    const src = require('fs').readFileSync(require('path').resolve(__dirname, '../useOpsPoll.ts'), 'utf8') as string;
    expect(src).toContain("if (inflight.current && !force) return;");
    expect(src).toContain('refresh: () => { void load(true); }');
    expect(src).toContain('fetchOpsWithTimeout<T>(url, { timeoutMs, signal: ac.signal })');
  });
});

describe('사유 코드 → 말 (영문 분류코드·「휴장」 단정 금지)', () => {
  test('주문 사유: 알려진 코드는 한글, 모르는 코드는 「사유 코드 x」, 없음은 null', () => {
    expect(orderReasonText('kill_switch')).toBe('모든거래차단');
    expect(orderReasonText('order_limit')).toBe('1회 주문 한도');
    expect(orderReasonText('validation_gate')).toBe('검증 관문');
    expect(orderReasonText('kis_rejected')).toBe('증권사 거부');
    expect(orderReasonText('x_y')).toBe('사유 코드 x_y');
    expect(orderReasonText(null)).toBeNull();
    expect(orderReasonText('  ')).toBeNull();
  });
  test('건너뜀: 「휴장」 은 엔진이 휴장이라고 한 코드일 때만 · 모르는 코드 · 코드 없음', () => {
    expect(skipText('weekend')).toBe('건너뜀 · 주말');
    expect(skipText('no_new_session')).toBe('건너뜀 · 새 세션 없음');
    expect(skipText('mystery')).toBe('건너뜀 · 사유 코드 mystery');
    expect(skipText(null)).toBe('건너뜀 · 사유 모름');
    for (const c of ['weekend', 'overseas_disabled', 'overseas_market_disabled', 'us_session_open', 'no_new_session', 'holidays_unknown', 'mystery', null]) {
      expect(skipText(c)).not.toContain('휴장 ·');
      expect(skipText(c)).not.toMatch(/· 휴장$/);
    }
    expect(analysisReasonText('holidays_unknown')).toBe('휴장표 모름');
  });
  test('건너뜀 코드 읽기: skipReason 우선 · 옛 skip:<코드> · 그냥 skip 은 모름', () => {
    expect(skipReasonCode({ skipReason: 'weekend' })).toBe('weekend');
    expect(skipReasonCode({ skipReason: null, evaluated: { reason: 'skip:no_new_session' } })).toBe('no_new_session');
    expect(skipReasonCode({ skipReason: null, evaluated: { reason: 'us_session_open' } })).toBe('us_session_open');
    expect(skipReasonCode({ skipReason: null, evaluated: { reason: 'skip' } })).toBeNull();
    expect(skipReasonCode({ skipReason: null, evaluated: null })).toBeNull();
  });
  test('안전 상태 읽기 오류 코드', () => {
    expect(safetyErrorsText('db_unreachable, strategies_error')).toBe('DB 연결 실패 · 전략 목록 읽기 실패');
    expect(safetyErrorsText('zzz')).toBe('사유 코드 zzz');
    expect(safetyErrorsText('')).toBeNull();
  });
});
