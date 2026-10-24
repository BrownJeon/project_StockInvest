/**
 * T-074 validate.ts — 데모 parseAmt·validateEntry 와 같은 규칙·문구 + 서버 쪽 추가 검사. 합성값만 쓴다.
 */
import {
  codePointLength, entryOneLine, isCandidateKey, isClientEntryId, parseAmount, parseCash, parseShortText, toFieldErrors,
  validateEntryInput, type ValidationContext,
} from '../validate';
import { krRead, fmtSignedUsd, fmtSignedWon, fmtUsd, fmtWon, fmtRate } from '../korean-amount';
import { parseKstWall } from '../kst';
import { candidateRuleSentence, isUsd, RULE } from '../rules';

const NOW = parseKstWall('2026-09-15 09:55:00')!;
const BASE_AT = parseKstWall('2026-09-01 07:10:00')!;
const ctx = (over: Partial<ValidationContext> = {}): ValidationContext => ({
  nowMs: NOW, baselineAtMs: BASE_AT, snapshot: { totalKrw: 21_780_000, fx: 1250 }, entries: [], ...over,
});

describe('parseAmount — 데모 parseAmt', () => {
  test.each([
    ['2,000,000', 'KRW', 2_000_000],
    [' 1 000 ', 'KRW', 1000],
    ['118.60', 'USD', 118.6],
    ['118.6', 'USD', 118.6],
    ['00100', 'KRW', 100],
    [2_000_000, 'KRW', 2_000_000],
  ] as const)('%p (%s) → %p', (raw, ccy, v) => {
    expect(parseAmount(raw, ccy)).toEqual({ value: v });
  });
  test.each([
    ['-1000', 'KRW', 'sign'],
    ['−1000', 'KRW', 'sign'],
    [-5, 'KRW', 'sign'],
    ['+1000', 'KRW', 'format'],
    ['1e5', 'KRW', 'format'],
    ['abc', 'KRW', 'format'],
    ['.5', 'USD', 'format'],
    [Number.NaN, 'KRW', 'format'],
    [{ v: 1 }, 'KRW', 'format'],
    ['0', 'KRW', 'amount'],
    ['0.00', 'USD', 'amount'],
    ['100.0', 'KRW', 'decimals'],
    ['0.5', 'KRW', 'decimals'],
    ['1.234', 'USD', 'decimals'],
    [0.1 + 0.2, 'USD', 'decimals'],
    ['1000000000001', 'KRW', 'max'],
    ['1000000000.01', 'USD', 'max'],
  ] as const)('%p (%s) → 오류 %s', (raw, ccy, code) => {
    const r = parseAmount(raw, ccy);
    expect('error' in r && r.error.code).toBe(code);
  });
  test('빈 값·null → empty', () => {
    expect(parseAmount('', 'KRW')).toEqual({ empty: true });
    expect(parseAmount('  ', 'KRW')).toEqual({ empty: true });
    // 쉼표만은 빈 값이 아니라 형식 오류(Reviewer L1 — 쉼표는 천 단위 자리일 때만)
    expect(parseAmount(' , ', 'KRW')).toMatchObject({ error: { code: 'format' } });
    expect(parseAmount(null, 'KRW')).toEqual({ empty: true });
    expect(parseAmount(undefined, 'USD')).toEqual({ empty: true });
  });
  test('문구는 데모 그대로', () => {
    const msg = (raw: string, c: 'KRW' | 'USD') => { const r = parseAmount(raw, c); return 'error' in r ? r.error.message : ''; };
    expect(msg('-1', 'KRW')).toBe('부호는 넣지 않습니다. 나간 돈이면 위에서 종류를 ‘출금’으로 고르세요.');
    expect(msg('x', 'KRW')).toBe('숫자만 넣어 주세요.');
    expect(msg('0', 'KRW')).toBe('0보다 큰 금액을 넣어 주세요.');
    expect(msg('1.5', 'KRW')).toBe('원화는 1원 단위로 넣어 주세요(소수점 없음).');
    expect(msg('1.555', 'USD')).toBe('달러는 센트(소수 둘째 자리)까지만 넣어 주세요.');
  });
  test('parseCash 는 0 을 허용(기준 현금 확인값)', () => {
    expect(parseCash('0', 'KRW')).toEqual({ value: 0 });
    expect(parseCash('0.00', 'USD')).toEqual({ value: 0 });
    expect('error' in parseCash('-1', 'USD')).toBe(true);
  });
});

describe('validateEntryInput — 데모 validateEntry', () => {
  const dep = (over: Record<string, unknown> = {}) => ({ kind: 'deposit', occurredAt: '2026-09-15 09:50', currency: 'KRW', amount: '500,000', ...over });

  test('정상 입금 → 오류 0 · 정규화 값', () => {
    const v = validateEntryInput(dep({ memo: '  월급 일부 ' }), ctx());
    expect(v.count).toBe(0);
    expect(v.value).toEqual({
      kind: 'deposit', occurredAt: '2026-09-15 09:50', occurredAtMs: parseKstWall('2026-09-15 09:50'), currency: 'KRW', amount: 500_000,
      counterCurrency: null, counterAmount: null, memo: '월급 일부',
    });
    expect(v.warnings).toEqual([]);
  });

  test('미래 시각 거부(지금 분은 허용)', () => {
    expect(validateEntryInput(dep({ occurredAt: '2026-09-15 09:56' }), ctx()).errors.occurredAt).toEqual({ code: 'future', message: '아직 오지 않은 시각입니다. 지금(09-15 09:55) 이전으로 넣어 주세요.' });
    expect(validateEntryInput(dep({ occurredAt: '2026-09-15 09:55' }), ctx({ nowMs: NOW + 30_000 })).count).toBe(0);
  });

  test('🔴 기준 시각 이전·같은 분 → 차단(blocked), 기준 직후 분은 허용', () => {
    const before = validateEntryInput(dep({ occurredAt: '2026-09-01 07:10' }), ctx());
    expect(before.blocked).toBe(true);
    expect(before.errors.occurredAt).toBeUndefined();
    expect(before.count).toBe(1);
    expect(before.value).toBeNull();
    expect(toFieldErrors(before).occurredAt).toEqual({ code: 'before_baseline', message: '기준 시각(09-01 07:10) 이전이라 기록할 수 없습니다.' });
    expect(validateEntryInput(dep({ occurredAt: '2026-09-01 07:11' }), ctx()).blocked).toBe(false);
    // 기준 07:10:30 이면 07:10 은 이전 → 차단
    expect(validateEntryInput(dep({ occurredAt: '2026-09-01 07:10' }), ctx({ baselineAtMs: BASE_AT + 30_000 })).blocked).toBe(true);
  });

  test('시각 형식: 빈 값 required · 초가 있으면(:00 제외) format · 달력에 없는 날짜 format', () => {
    expect(validateEntryInput(dep({ occurredAt: '' }), ctx()).errors.occurredAt?.code).toBe('required');
    expect(validateEntryInput(dep({ occurredAt: '2026-09-15 09:50:30' }), ctx()).errors.occurredAt?.code).toBe('format');
    expect(validateEntryInput(dep({ occurredAt: '2026-09-15 09:50:00' }), ctx()).count).toBe(0);
    expect(validateEntryInput(dep({ occurredAt: '2026-02-30 09:00' }), ctx()).errors.occurredAt?.code).toBe('format');
    expect(validateEntryInput(dep({ occurredAt: '2026-09-15T09:50' }), ctx()).count).toBe(0);
  });

  test('종류·통화 값 검사(서버만 받을 수 있는 입력)', () => {
    const v = validateEntryInput(dep({ kind: 'dividend', currency: 'EUR' }), ctx());
    expect(v.errors.kind?.code).toBe('kind');
    expect(v.errors.currency?.code).toBe('currency');
  });

  test('큰 금액(현재 총자산의 50% 이상) 경고 — 저장은 막지 않는다', () => {
    const v = validateEntryInput(dep({ amount: '10890000' }), ctx());
    expect(v.count).toBe(0);
    expect(v.warnings.map((w) => w.code)).toEqual(['big_amount']);
    expect(v.warnings[0].message).toBe('현재 총자산(21,780,000원)의 절반이 넘는 금액입니다. 자릿수와 통화(원·달러)를 확인하세요.');
    expect(validateEntryInput(dep({ amount: '10889999' }), ctx()).warnings).toEqual([]);
    // 달러는 최신 환율로 환산해 본다: $8,712 × 1,250 = 10,890,000
    expect(validateEntryInput(dep({ currency: 'USD', amount: '8712' }), ctx()).warnings.map((w) => w.code)).toEqual(['big_amount']);
  });

  test('24시간 안 같은 금액 기록 경고(취소된 것·정정 대상·다른 종류는 제외)', () => {
    const entries = [
      { id: 1, kind: 'deposit' as const, currency: 'KRW' as const, amount: 500_000, counterCurrency: null, counterAmount: null, occurredAt: '2026-09-14 09:51', void: null },
      { id: 2, kind: 'deposit' as const, currency: 'KRW' as const, amount: 500_000, counterCurrency: null, counterAmount: null, occurredAt: '2026-09-15 09:00', void: { type: 'cancel' as const, reason: 'x', at: null, byUserId: null, by: null } },
    ];
    const v = validateEntryInput(dep(), ctx({ entries }));
    expect(v.warnings).toEqual([{ code: 'near_duplicate', existingId: 1, message: '24시간 안에 같은 금액 기록이 있습니다(#1 · 09-14 09:51 입금 500,000원). 같은 돈을 두 번 넣지 않았는지 확인하세요.' }]);
    expect(validateEntryInput(dep({ occurredAt: '2026-09-15 09:51' }), ctx({ entries })).warnings.map((w) => w.code)).toEqual(['near_duplicate']);   // 정확히 24h 는 경고
    expect(validateEntryInput(dep({ occurredAt: '2026-09-15 09:52' }), ctx({ entries })).warnings).toEqual([]);   // 24h 1분 넘음
    expect(validateEntryInput({ ...dep(), targetId: 1 }, ctx({ entries })).warnings).toEqual([]);
    expect(validateEntryInput(dep({ kind: 'withdrawal' }), ctx({ entries })).warnings).toEqual([]);
  });

  test('환전: 양쪽 금액 필수 · 같은 통화 거부 · 적용 환율·비용(추정) · ±3% 넘으면 경고', () => {
    const ex = (over: Record<string, unknown> = {}) => ({ kind: 'exchange', occurredAt: '2026-09-05 13:00', currency: 'KRW', amount: '1,260,000', counterCurrency: 'USD', counterAmount: '1000', ...over });
    const ok = validateEntryInput(ex(), ctx());
    expect(ok.count).toBe(0);
    expect(ok.derived.rate).toBe(1260);
    expect(ok.derived.diffPct).toBeCloseTo(0.8, 10);
    expect(ok.derived.costKrw).toBe(10_000);
    expect(ok.value).toMatchObject({ kind: 'exchange', currency: 'KRW', amount: 1_260_000, counterCurrency: 'USD', counterAmount: 1000 });
    const miss = validateEntryInput(ex({ amount: '', counterAmount: '' }), ctx());
    expect(miss.errors.amount).toEqual({ code: 'required', message: '낸 금액을 넣어 주세요.' });
    expect(miss.errors.counterAmount).toEqual({ code: 'required', message: '받은 금액을 넣어 주세요.' });
    expect(validateEntryInput(ex({ counterCurrency: 'KRW' }), ctx()).errors.counterCurrency?.code).toBe('same_currency');
    const far = validateEntryInput(ex({ amount: '1,300,000' }), ctx());
    expect(far.warnings[0]).toEqual({ code: 'fx_deviation', message: '적용 환율이 앱 환율(1,250.00원/$)과 4.0% 다릅니다. 두 금액의 자릿수를 확인하세요.' });
    expect(validateEntryInput(ex({ amount: '1,287,500' }), ctx()).warnings).toEqual([]);   // 정확히 3.0% 는 경고 아님(> 3)
    // 달러→원화: 비용 = $1,000 × 1,250 − 1,245,000 = 5,000
    expect(validateEntryInput(ex({ currency: 'USD', amount: '1000', counterCurrency: 'KRW', counterAmount: '1245000' }), ctx()).derived.costKrw).toBe(5_000);
  });

  test('입출금의 counter_* 입력은 무시하고 null 로 저장', () => {
    expect(validateEntryInput(dep({ counterCurrency: 'USD', counterAmount: '5' }), ctx()).value).toMatchObject({ counterCurrency: null, counterAmount: null });
  });

  test('메모 200자(코드포인트)까지 — 이모지 1자 = 1', () => {
    expect(validateEntryInput(dep({ memo: '가'.repeat(200) }), ctx()).count).toBe(0);
    expect(validateEntryInput(dep({ memo: '😀'.repeat(200) }), ctx()).count).toBe(0);
    expect(validateEntryInput(dep({ memo: '가'.repeat(201) }), ctx()).errors.memo?.code).toBe('too_long');
    expect(validateEntryInput(dep({ memo: 5 }), ctx()).errors.memo?.code).toBe('format');
    expect(codePointLength('😀a')).toBe(2);
  });

  test('기준이 없으면 기준 이전 검사를 하지 않는다(서버는 따로 409 no_baseline)', () => {
    expect(validateEntryInput(dep({ occurredAt: '2020-01-01 00:00' }), ctx({ baselineAtMs: null })).count).toBe(0);
  });
});

describe('작은 검사들', () => {
  test('isUsd — 원장 통화 조회표', () => {
    expect([isUsd('USD'), isUsd('KRW')]).toEqual([true, false]);
    expect(isUsd('JPY' as never)).toBe(false);
  });
  test('clientEntryId 8~36자 영숫자·-·_ , 후보 키 `${id}-${통화}`', () => {
    expect(isClientEntryId('3f1c2a9e-0b7d-4c55-9a51-2f3e4d5c6b7a')).toBe(true);
    expect(isClientEntryId('c1a2b3c4')).toBe(true);
    expect(isClientEntryId('short')).toBe(false);
    expect(isClientEntryId("x'; DROP--")).toBe(false);
    expect(isCandidateKey('1340-KRW')).toBe(true);
    expect(isCandidateKey('1340-EUR')).toBe(false);
    expect(isCandidateKey('0-KRW')).toBe(false);
    expect(isCandidateKey('1340-KRW;')).toBe(false);
  });
  test('parseShortText 필수·길이', () => {
    expect(parseShortText('  ', { label: '사유', required: true })).toEqual({ error: { code: 'required', message: '사유를 넣어 주세요.' } });
    expect(parseShortText(' 잘못 입력 ', { label: '사유', required: true })).toEqual({ value: '잘못 입력' });
    expect(parseShortText(null, { label: '메모' })).toEqual({ value: null });
  });
  test('entryOneLine', () => {
    expect(entryOneLine({ kind: 'deposit', currency: 'KRW', amount: 1_000_000, counterCurrency: null, counterAmount: null })).toBe('입금 1,000,000원');
    expect(entryOneLine({ kind: 'exchange', currency: 'KRW', amount: 1_260_000, counterCurrency: 'USD', counterAmount: 1000 })).toBe('환전 1,260,000원 → $1,000.00');
  });
});

describe('korean-amount — 데모 krRead·won·swon·usd·rt', () => {
  test.each([
    [2_056_912, '205만 6,912원'],
    [2_000_000, '200만원'],
    [123_456_789, '1억 2,345만 6,789원'],
    [100_000_000_000, '1,000억원'],
    [5_000, '5,000원'],
    [0, '0원'],
    [-2_000_000, '−200만원'],
  ])('krRead(%p) = %p', (n, s) => {
    expect(krRead(n)).toBe(s);
  });
  test('원·달러·환율 표기(음수 기호 U+2212)', () => {
    expect(fmtWon(-300_000)).toBe('−300,000원');
    expect(fmtSignedWon(830_000)).toBe('+830,000원');
    expect(fmtSignedWon(0)).toBe('0원');
    expect(fmtUsd(1000)).toBe('$1,000.00');
    expect(fmtSignedUsd(-368.6)).toBe('−$368.60');
    expect(fmtRate(1256.2)).toBe('1,256.20');
  });
  test('후보 카드 알림 기준 문장은 상수로 찍는다', () => {
    expect(candidateRuleSentence()).toBe('알림 기준: 보유 수량이 그대로인데 원화 현금이 50,000원 이상, 또는 달러 현금이 $50 이상 바뀐 스냅샷. 매매·배당·이자일 수도 있어 자동으로 기록하지 않습니다.');
    expect(candidateRuleSentence({ ...RULE, krw: 70_000, usd: 30 })).toContain('70,000원 이상, 또는 달러 현금이 $30 이상');
  });
});
