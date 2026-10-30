/**
 * T-112 safe-text — 기록기 공용 헬퍼 시험(순수 함수 + 시간 상한).
 *  1. truncateCodePoints/clampText: 코드포인트 단위·서로게이트 쌍 보존·짝 없는 서로게이트 → U+FFFD·비문자열 null·max 이상값
 *  2. normalizeSymbol: trim·대문자·32자 초과/빈 값/비문자열 거부
 *  3. dedupeBy: 첫 행 유지·순서 유지
 *  4. errno 판별: 4025·1146 은 errno 숫자로만(code 문자열 무시 — F6)
 *  5. withDeadline / withDeadlineSafe: 시간 안 값·시간 초과 undefined·거부 전파/흡수·늦은 거부 흡수
 */
import {
  SYMBOL_MAX,
  clampText,
  dedupeBy,
  isCheckViolation,
  isNoSuchTable,
  isRowDataError,
  normalizeSymbol,
  truncateCodePoints,
  withDeadline,
  withDeadlineSafe,
} from '../safe-text';

const EMOJI = '\u{1F600}'; // 서로게이트 쌍 1개 = 코드포인트 1개, UTF-16 길이 2

describe('truncateCodePoints / clampText (F3)', () => {
  it('비문자열은 null', () => {
    for (const v of [undefined, null, 1, true, {}, [], Symbol('x')]) expect(truncateCodePoints(v, 10)).toBeNull();
  });
  it('짧으면 그대로, 길면 코드포인트 max 개', () => {
    expect(truncateCodePoints('abc', 5)).toBe('abc');
    expect(truncateCodePoints('abcdef', 3)).toBe('abc');
    expect(truncateCodePoints('한글가나다', 2)).toBe('한글');
  });
  it('이모지 500개 + 1 → 이모지 500개(반쪽 서로게이트 없음) — JS slice 와 다르다', () => {
    const s = EMOJI.repeat(501);
    const out = truncateCodePoints(s, 500)!;
    expect(Array.from(out)).toHaveLength(500);
    expect(out).toBe(EMOJI.repeat(500));
    // 대조: UTF-16 slice 는 마지막 쌍을 쪼갠다
    expect(s.slice(0, 499).endsWith('\uD83D')).toBe(true);
    expect(/[\uD800-\uDBFF]$/.test(out)).toBe(false);
  });
  it('경계: 글자 499개 + 이모지 → 500 코드포인트 그대로(UTF-16 길이 501 이어도 자르지 않는다)', () => {
    const s = 'a'.repeat(499) + EMOJI;
    expect(s.length).toBe(501);
    expect(truncateCodePoints(s, 500)).toBe(s);
  });
  it('짝 없는 서로게이트는 U+FFFD 로 바꾼다(코드포인트 수 유지)', () => {
    expect(truncateCodePoints('a\uD83Db', 10)).toBe('a�b');
    expect(truncateCodePoints('a\uDE00b', 10)).toBe('a�b');
    expect(truncateCodePoints(`\uD83D${EMOJI}`, 10)).toBe(`�${EMOJI}`);
  });
  it('따옴표·백슬래시·탭·줄바꿈·SQL 주석은 그대로(이스케이프는 바인딩이 한다)', () => {
    const s = `it's "x" \\ \t\n -- ;`;
    expect(truncateCodePoints(s, 100)).toBe(s);
  });
  it('max 가 0·음수·NaN·무한이면 빈 문자열, 소수는 내림', () => {
    expect(truncateCodePoints('abc', 0)).toBe('');
    expect(truncateCodePoints('abc', -1)).toBe('');
    expect(truncateCodePoints('abc', Number.NaN)).toBe('');
    expect(truncateCodePoints('abc', Number.POSITIVE_INFINITY)).toBe('');
    expect(truncateCodePoints('abcdef', 2.9)).toBe('ab');
  });
  it('clampText 는 같은 함수', () => {
    expect(clampText).toBe(truncateCodePoints);
  });
});

describe('normalizeSymbol (F5)', () => {
  it('trim·대문자', () => {
    expect(normalizeSymbol(' nas:mu ')).toBe('NAS:MU');
    expect(normalizeSymbol('NAS:MU')).toBe('NAS:MU');
    expect(normalizeSymbol('005930')).toBe('005930');
  });
  it('빈 값·비문자열·짝 없는 서로게이트 → null', () => {
    for (const v of ['', '   ', null, undefined, 5930, {}, 'A\uD83D']) expect(normalizeSymbol(v)).toBeNull();
  });
  it(`${SYMBOL_MAX}자 허용, 초과는 자르지 않고 거부`, () => {
    expect(normalizeSymbol('A'.repeat(SYMBOL_MAX))).toBe('A'.repeat(SYMBOL_MAX));
    expect(normalizeSymbol('A'.repeat(SYMBOL_MAX + 1))).toBeNull();
    expect(normalizeSymbol(`  ${'a'.repeat(SYMBOL_MAX)}  `)).toBe('A'.repeat(SYMBOL_MAX));
  });
});

describe('dedupeBy (F5)', () => {
  it('정규화 키로 같은 종목의 두 번째 행을 버린다(순서 유지, 첫 행 유지)', () => {
    const rows = [
      { s: 'nas:mu', n: 1 }, { s: 'NAS:AAPL', n: 2 }, { s: 'NAS:MU ', n: 3 }, { s: 'nas:aapl', n: 4 }, { s: 'NAS:TSLA', n: 5 },
    ];
    const out = dedupeBy(rows, (r) => normalizeSymbol(r.s) ?? '');
    expect(out.map((r) => r.n)).toEqual([1, 2, 5]);
  });
  it('빈 입력', () => {
    expect(dedupeBy([], (x: string) => x)).toEqual([]);
  });
});

describe('errno 판별 (F6)', () => {
  it('4025 = CHECK 위반 — mysql2 의 엉뚱한 code 문자열과 무관', () => {
    expect(isCheckViolation({ errno: 4025, code: 'ER_INNODB_AUTOEXTEND_SIZE_OUT_OF_RANGE' })).toBe(true);
    expect(isCheckViolation({ errno: 4025 })).toBe(true);
    expect(isCheckViolation({ code: 'ER_CHECK_CONSTRAINT_VIOLATED' })).toBe(false);
    expect(isCheckViolation({ errno: '4025' })).toBe(false);
    expect(isCheckViolation(null)).toBe(false);
    expect(isCheckViolation(new Error('x'))).toBe(false);
  });
  it('1146 = 테이블 없음 — errno 숫자로', () => {
    expect(isNoSuchTable({ errno: 1146, code: 'ER_NO_SUCH_TABLE' })).toBe(true);
    expect(isNoSuchTable({ errno: 1146 })).toBe(true);
    expect(isNoSuchTable({ code: 'ER_NO_SUCH_TABLE' })).toBe(false);
    expect(isNoSuchTable({ errno: 1062 })).toBe(false);
    expect(isNoSuchTable(undefined)).toBe(false);
  });
  it('행 데이터 오류(그 행만 빼면 되는 종류)와 연결 오류를 가른다', () => {
    for (const n of [4025, 1406, 1366, 1265, 1264, 4038, 1048, 1292]) expect(isRowDataError({ errno: n })).toBe(true);
    for (const n of [1146, 1062, 2013, 1205, 1064]) expect(isRowDataError({ errno: n })).toBe(false);
    expect(isRowDataError({ code: 'ECONNRESET' })).toBe(false);
  });
});

describe('withDeadline / withDeadlineSafe', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('시간 안에 끝나면 값', async () => {
    await expect(withDeadline(Promise.resolve(7), 100)).resolves.toBe(7);
  });
  it('시간 초과면 undefined', async () => {
    const never = new Promise<number>(() => {});
    const p = withDeadline(never, 2000);
    jest.advanceTimersByTime(1999);
    let settled = false;
    void p.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    jest.advanceTimersByTime(1);
    await expect(p).resolves.toBeUndefined();
  });
  it('시간 안의 거부는 던진다(호출자가 errno 판별)', async () => {
    await expect(withDeadline(Promise.reject(Object.assign(new Error('x'), { errno: 1146 })), 100)).rejects.toMatchObject({ errno: 1146 });
  });
  it('마감 뒤의 늦은 거부는 흡수된다(처리되지 않은 거부 없음)', async () => {
    let rej!: (e: unknown) => void;
    const late = new Promise<number>((_, r) => { rej = r; });
    const p = withDeadline(late, 50);
    jest.advanceTimersByTime(50);
    await expect(p).resolves.toBeUndefined();
    const handler = jest.fn();
    process.on('unhandledRejection', handler);
    rej(new Error('late'));
    jest.useRealTimers();
    await new Promise((r) => setImmediate(r));
    process.off('unhandledRejection', handler);
    expect(handler).not.toHaveBeenCalled();
  });
  it('ms 가 0·음수·NaN 이면 기다리지 않고 undefined', async () => {
    await expect(withDeadline(new Promise(() => {}), 0)).resolves.toBeUndefined();
    await expect(withDeadline(new Promise(() => {}), -5)).resolves.toBeUndefined();
    await expect(withDeadline(new Promise(() => {}), Number.NaN)).resolves.toBeUndefined();
  });
  it('withDeadlineSafe 는 거부도 undefined + onError 호출, onError 가 던져도 흡수', async () => {
    const onError = jest.fn(() => { throw new Error('log fail'); });
    await expect(withDeadlineSafe(Promise.reject(new Error('boom')), 100, onError)).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
    await expect(withDeadlineSafe(Promise.resolve('v'), 100)).resolves.toBe('v');
    const p = withDeadlineSafe(new Promise(() => {}), 10);
    jest.advanceTimersByTime(10);
    await expect(p).resolves.toBeUndefined();
  });
});
