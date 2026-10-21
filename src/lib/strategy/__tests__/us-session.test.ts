/**
 * T-062 — 미국 세션 날짜·시각(us-session.ts). DST 는 실행 시각이 아니라 **목표 세션 날짜**에서 판정한다(T-046 류 1시간 어긋남 방지).
 * S-4 — KIS 해외 일봉 `ts` 는 `xymd` 의 UTC 자정이므로 시간대 변환 없이 날짜를 읽는다(실제 어댑터로 원시 xymd 를 통과시켜 확인).
 */
import {
  addDaysYmd, candleSessionDate, etDateOf, etMinutesOf, isUsRegularSessionOpen, isUsTradingDay, lastCompletedSessionEt,
  loadUsClosedDaysStrict, nextSessionsEt, sessionWindowUtc, yearsNeededFor,
} from '../us-session';
import { toKstDatetime } from '../post-market-engine';
import { getCandles as overseasGetCandles } from '@/lib/exchanges/kis-overseas';
import { kisFetch } from '@/lib/exchanges/kis-http';

jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));
jest.mock('@/lib/exchanges/kis-auth', () => ({ getKisToken: jest.fn(async () => 'tok'), invalidateKisToken: jest.fn(), kisBaseUrl: jest.fn(() => 'https://mock-base') }));
jest.mock('@/lib/credentials', () => ({ getCredential: jest.fn(async () => '') }));
jest.mock('@/lib/exchanges/kis-http', () => ({ kisFetch: jest.fn(), isKisRateLimited: jest.fn(() => false), kisBodyText: jest.fn(() => '') }));
jest.mock('@/lib/exchanges/fx', () => ({ getUsdKrwRate: jest.fn(async () => 1330) }));

/** 2026·2027 NYSE 휴장(반일장 포함 — market_holidays 와 같은 구성, half_day 도 닫힘). */
const US_CLOSED_2026_2027 = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07',
  '2026-11-26', '2026-11-27', '2026-12-24', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18', '2027-07-05', '2027-09-06',
  '2027-11-25', '2027-11-26', '2027-12-23', '2027-12-24',
]);
const C = US_CLOSED_2026_2027;
const kst = (s: string) => new Date(`${s}+09:00`);   // KST 벽시계 → Date

describe('ET 날짜·분 — isUSDST 재사용', () => {
  test.each([
    ['수 08:00 KST (EDT) → 화 19:00 ET', '2026-10-21T08:00:00', '2026-10-20', 19 * 60],
    ['토 08:00 KST (EST, 11월) → 금 18:00 ET', '2026-11-07T08:00:00', '2026-11-06', 18 * 60],
    ['DST 종료 직전 일 01:59 EDT = 05:59Z', '2026-11-01T14:59:00', '2026-11-01', 1 * 60 + 59],
    ['DST 종료 직후 = 06:00Z → 01:00 EST', '2026-11-01T15:00:00', '2026-11-01', 1 * 60],
  ])('%s', (_n, k, date, min) => {
    expect(etDateOf(kst(k))).toBe(date);
    expect(etMinutesOf(kst(k))).toBe(min);
  });
});

describe('lastCompletedSessionEt / isUsRegularSessionOpen', () => {
  test.each([
    ['평일 수 08:00 KST → D0 = 화', '2026-10-21T08:00:00', '2026-10-20', false],
    ['토 08:00 KST → D0 = 금(금요일 장 마감 뒤)', '2026-10-24T08:00:00', '2026-10-23', false],
    ['일 08:00 KST = ET 토 → 새 세션 없음', '2026-10-25T08:00:00', null, false],
    ['월 08:00 KST = ET 일 → 새 세션 없음', '2026-10-26T08:00:00', null, false],
    ['추수감사절(목, 휴장) 다음 날 08:00 KST → 없음', '2026-11-27T08:00:00', null, false],
    ['반일장(11-27 금) 다음 날 08:00 KST → 닫힘 취급이라 없음 (D-2)', '2026-11-28T08:00:00', null, false],
    ['장중 10:00 EDT', '2026-10-21T23:00:00', null, true],
    ['장 시작 전 08:00 EDT', '2026-10-21T21:00:00', null, false],
    ['15:59 EDT 는 아직 장중', '2026-10-22T04:59:00', null, true],
    ['16:00 EDT 정각 → D0 = 그날', '2026-10-22T05:00:00', '2026-10-21', false],
  ])('%s', (_n, k, d0, open) => {
    expect(lastCompletedSessionEt(kst(k), C)).toBe(d0);
    expect(isUsRegularSessionOpen(kst(k), C)).toBe(open);
  });

  test('isUsTradingDay: 주말·휴장·반일장은 거래일 아님', () => {
    expect(isUsTradingDay('2026-10-21', C)).toBe(true);
    expect(isUsTradingDay('2026-10-24', C)).toBe(false);
    expect(isUsTradingDay('2026-11-26', C)).toBe(false);
    expect(isUsTradingDay('2026-11-27', C)).toBe(false);
  });
});

describe('nextSessionsEt — 휴장 건너뛰기', () => {
  test.each([
    ['평일 D0 10-20', '2026-10-20', ['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-26', '2026-10-27']],
    ['금 D0 → 월', '2026-10-23', ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']],
    ['🔴 휴장 전날 11-25 → 추수감사절·반일장 건너뛰고 11-30', '2026-11-25', ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04']],
    ['🔴 연말 연도 경계 12-31 → 2027-01-04', '2026-12-31', ['2027-01-04', '2027-01-05', '2027-01-06', '2027-01-07', '2027-01-08']],
    ['성탄 전 반일장·성탄 → 12-28', '2026-12-23', ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-04']],
  ])('%s', (_n, d0, expected) => {
    expect(nextSessionsEt(d0 as string, 5, C)).toEqual(expected);
  });

  test('주말뿐인 달력에서 60일 안에 못 찾으면 던진다(무한 루프 없음)', () => {
    const all = new Set<string>();
    for (let i = 1; i <= 70; i++) all.add(addDaysYmd('2026-10-20', i));
    expect(() => nextSessionsEt('2026-10-20', 1, all)).toThrow(/60일/);
  });
});

describe('sessionWindowUtc → KST 저장 문자열 (DST 는 목표 날짜에서)', () => {
  const kstWin = (d: string) => {
    const w = sessionWindowUtc(d);
    return [toKstDatetime(new Date(w.openUtc)), toKstDatetime(new Date(w.closeUtc))];
  };
  test('EDT 평일: 09:30/16:00 ET = 22:30 / 다음 날 05:00 KST', () => {
    expect(kstWin('2026-10-21')).toEqual(['2026-10-21 22:30:00', '2026-10-22 05:00:00']);
  });
  test('🔴 DST 종료 주: 금(EDT) 실행 → 월 11-02(EST) 세션 = 23:30 / 06:00 KST', () => {
    const now = kst('2026-10-31T08:00:00');                       // 토 08:00 KST = 금 19:00 EDT
    const d0 = lastCompletedSessionEt(now, C);
    expect(d0).toBe('2026-10-30');
    const s1 = nextSessionsEt(d0!, 5, C)[0];
    expect(s1).toBe('2026-11-02');
    expect(kstWin(s1)).toEqual(['2026-11-02 23:30:00', '2026-11-03 06:00:00']);
  });
  test('🔴 DST 시작 주: 금(EST) 실행 → 월 2027-03-15(EDT) 세션 = 22:30 / 05:00 KST', () => {
    const now = kst('2027-03-13T08:00:00');                       // 토 08:00 KST = 금 18:00 EST
    const d0 = lastCompletedSessionEt(now, C);
    expect(d0).toBe('2027-03-12');
    const s1 = nextSessionsEt(d0!, 5, C)[0];
    expect(s1).toBe('2027-03-15');
    expect(kstWin(s1)).toEqual(['2027-03-15 22:30:00', '2027-03-16 05:00:00']);
  });
  test('EST 겨울: 2027-01-04 = 23:30 / 06:00 KST', () => {
    expect(kstWin('2027-01-04')).toEqual(['2027-01-04 23:30:00', '2027-01-05 06:00:00']);
  });
});

describe('🔴 S-4 candleSessionDate — KIS 원시 xymd → 실제 어댑터 → ts → 날짜 (시간대 변환 없음)', () => {
  const mFetch = kisFetch as jest.Mock;
  const respond = (xymds: string[]) => mFetch.mockResolvedValueOnce({
    ok: true, status: 200,
    json: async () => ({ rt_cd: '0', output2: xymds.map(x => ({ xymd: x, open: '27.1', high: '27.6', low: '27.0', clos: '27.4', tvol: '1000' })) }),
  });

  test.each([
    ['평일(EDT)', ['20261020', '20261019', '20261016'], '2026-10-20'],
    ['DST 종료 뒤 첫 월요일(EST)', ['20261102', '20261030'], '2026-11-02'],
    ['DST 시작 뒤 첫 월요일(EDT)', ['20270315', '20270312'], '2027-03-15'],
    ['연말 연도 경계', ['20261231', '20261230'], '2026-12-31'],
    ['연초', ['20270104', '20261231'], '2027-01-04'],
  ])('%s: 마지막 봉 날짜 = xymd 그대로', async (_n, xymds, expected) => {
    respond(xymds as string[]);
    const candles = await overseasGetCandles('NAS:CMCSA', '1d', 60);
    const last = candles[candles.length - 1];
    expect(candleSessionDate(last.ts)).toBe(expected);
    // 가격은 KRW 환산(× 1330) — 어댑터 동작 확인(바꾸지 않음)
    expect(last.close).toBeCloseTo(27.4 * 1330, 6);
  });

  test('🔴 ET 로 변환하면 하루 전 날짜가 된다 — 그래서 변환하지 않는다(Codex C1 [medium])', async () => {
    respond(['20261020']);
    const [c] = await overseasGetCandles('NAS:CMCSA', '1d', 60);
    expect(etDateOf(new Date(c.ts))).toBe('2026-10-19');      // 잘못된 방법
    expect(candleSessionDate(c.ts)).toBe('2026-10-20');       // 이 모듈의 방법
  });

  test('NaN·Infinity ts → null', () => {
    expect(candleSessionDate(Number.NaN)).toBeNull();
    expect(candleSessionDate(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('yearsNeededFor', () => {
  test.each([
    ['10월 → 그해만', '2026-10-21T08:00:00', [2026]],
    ['12월 하순 → 다음 해 포함', '2026-12-20T08:00:00', [2026, 2027]],
    ['1월 초 → 전년 포함', '2027-01-05T08:00:00', [2026, 2027]],
  ])('%s', (_n, k, ys) => {
    expect(yearsNeededFor(kst(k as string))).toEqual(ys);
  });
});

describe('loadUsClosedDaysStrict — 모르면 던진다(market-hours 의 fail-open 과 다름)', () => {
  const db = (rows: unknown) => ({ query: jest.fn().mockResolvedValue([rows, undefined]) });

  test('행 → 집합, SQL 은 overseas·DATE_FORMAT 문자열·연도 IN', async () => {
    const d = db([{ d: '2026-11-26' }, { d: '2026-11-27' }]);
    const set = await loadUsClosedDaysStrict(d as never, [2026]);
    expect([...set]).toEqual(['2026-11-26', '2026-11-27']);
    const [sql, params] = d.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("market = 'overseas'");
    expect(sql).toContain("DATE_FORMAT(holiday_date, '%Y-%m-%d')");
    expect(sql).not.toMatch(/half_day/);   // 🔴 반일장 행도 닫힘(D-2) — half_day 로 거르지 않는다(Reviewer L-1 U02)
    expect(params).toEqual([[2026]]);
  });
  test('🔴 요청한 연도 중 행이 0개인 연도가 있으면 던진다', async () => {
    await expect(loadUsClosedDaysStrict(db([{ d: '2026-12-25' }]) as never, [2026, 2027])).rejects.toThrow(/2027/);
  });
  test('🔴 DB 오류는 삼키지 않는다', async () => {
    const d = { query: jest.fn().mockRejectedValue(new Error('ECONNRESET')) };
    await expect(loadUsClosedDaysStrict(d as never, [2026])).rejects.toThrow('ECONNRESET');
  });
  test('날짜 형식 이상 → 던진다', async () => {
    await expect(loadUsClosedDaysStrict(db([{ d: null }]) as never, [2026])).rejects.toThrow(/형식/);
  });
  test('빈 연도 목록 → 던진다', async () => {
    await expect(loadUsClosedDaysStrict(db([]) as never, [])).rejects.toThrow();
  });
});
