/**
 * T-070 시각 판정 — 확정 봉·최근 확정 평일·오프아워 창. 시각은 UTC 로 고정해 넣는다.
 */
import {
  addDays, checkOffHoursWindow, daysBetween, isFinalBar, isYmd, lastExpectedFinalDate, marketLocal, ymdFromCompact,
} from '../daily-bars-time';

/** KST 'YYYY-MM-DD HH:MM' → Date */
const kst = (s: string) => new Date(`${s.replace(' ', 'T')}:00+09:00`);

describe('날짜 유틸', () => {
  test('addDays·daysBetween 은 달력 산술(월말·윤년)', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-10-01', '2026-10-22')).toBe(21);
  });
  test('ymdFromCompact 는 형식·실재 날짜만', () => {
    expect(ymdFromCompact('20261021')).toBe('2026-10-21');
    expect(ymdFromCompact('20260230')).toBeNull();
    expect(ymdFromCompact('2026102')).toBeNull();
    expect(ymdFromCompact(20261021)).toBeNull();
    expect(isYmd('2026-13-01')).toBe(false);
  });
});

describe('isFinalBar — 미국 ET 16:30, 국내 KST 15:40', () => {
  test('미국: 서머타임 중 ET 16:29 는 미확정, 16:30 은 확정 (KST 05:29 / 05:30 다음날)', () => {
    // 2026-10-21(수) ET 16:29 EDT = 2026-10-22 05:29 KST
    expect(isFinalBar('US', '2026-10-21', kst('2026-10-22 05:29'))).toBe(false);
    expect(isFinalBar('US', '2026-10-21', kst('2026-10-22 05:30'))).toBe(true);
    expect(isFinalBar('US', '2026-10-20', kst('2026-10-22 05:29'))).toBe(true);
    expect(isFinalBar('US', '2026-10-22', kst('2026-10-22 05:30'))).toBe(false);   // 미래(현지 기준)
  });
  test('미국: 서머타임 끝난 뒤(11-02 이후) ET 16:30 = KST 06:30', () => {
    expect(isFinalBar('US', '2026-11-03', kst('2026-11-04 06:29'))).toBe(false);
    expect(isFinalBar('US', '2026-11-03', kst('2026-11-04 06:30'))).toBe(true);
  });
  test('국내: 15:39 미확정, 15:40 확정', () => {
    expect(isFinalBar('KR', '2026-10-22', kst('2026-10-22 15:39'))).toBe(false);
    expect(isFinalBar('KR', '2026-10-22', kst('2026-10-22 15:40'))).toBe(true);
    expect(isFinalBar('KR', '2026-10-21', kst('2026-10-22 09:00'))).toBe(true);
  });
  test('marketLocal 은 거래소 현지 날짜', () => {
    expect(marketLocal('US', kst('2026-10-22 08:00')).date).toBe('2026-10-21');
    expect(marketLocal('KR', kst('2026-10-22 08:00')).date).toBe('2026-10-22');
  });
});

describe('lastExpectedFinalDate', () => {
  test('평일 마감 전이면 전 평일, 마감 후면 그날', () => {
    expect(lastExpectedFinalDate('KR', kst('2026-10-22 10:00'))).toBe('2026-10-21');
    expect(lastExpectedFinalDate('KR', kst('2026-10-22 16:00'))).toBe('2026-10-22');
  });
  test('주말·월요일 장 전은 금요일', () => {
    expect(lastExpectedFinalDate('KR', kst('2026-10-25 12:00'))).toBe('2026-10-23');   // 일
    expect(lastExpectedFinalDate('KR', kst('2026-10-26 09:00'))).toBe('2026-10-23');   // 월 장 전
    // 미국: KST 월 07:00 = ET 일 18:00 → 금
    expect(lastExpectedFinalDate('US', kst('2026-10-26 07:00'))).toBe('2026-10-23');
    // KST 토 06:00 = ET 금 17:00 → 금 확정
    expect(lastExpectedFinalDate('US', kst('2026-10-24 06:00'))).toBe('2026-10-23');
  });
});

describe('checkOffHoursWindow — KST 05:10~08:30·15:40~22:20, 정각 앞뒤·08:00 회피', () => {
  test.each([
    ['2026-10-22 05:20', true, undefined],
    ['2026-10-22 06:30', true, undefined],
    ['2026-10-22 16:10', true, undefined],
    ['2026-10-22 22:15', true, undefined],
    ['2026-10-22 05:05', false, 'outside_window'],
    ['2026-10-22 09:30', false, 'outside_window'],      // 국내 장중
    ['2026-10-22 23:30', false, 'outside_window'],      // 미국 장중
    ['2026-10-22 22:18', false, 'window_ending'],
    ['2026-10-22 08:28', false, 'window_ending'],
    ['2026-10-22 08:05', false, 'avoid_0800_job'],
    ['2026-10-22 07:56', false, 'avoid_0800_job'],
    ['2026-10-22 06:01', false, 'near_hour_mark'],
    ['2026-10-22 16:58', false, 'near_hour_mark'],
  ])('%s → ok=%s (%s)', (t, ok, reason) => {
    const r = checkOffHoursWindow(kst(t));
    expect(r.ok).toBe(ok);
    expect(r.reason).toBe(reason);
    expect(r.kst).toBe(t.slice(11));
  });
});
