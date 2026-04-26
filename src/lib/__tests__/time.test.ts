import { formatRelativeTime, kstTodayStart } from '../time';

describe('kstTodayStart', () => {
  test('UTC 14:59에도 KST 기준 같은 날 00:00 반환 (= UTC 전날 15:00)', () => {
    // 2026-04-19 14:59 UTC = 2026-04-19 23:59 KST
    const now = new Date(Date.UTC(2026, 3, 19, 14, 59, 0));
    const start = kstTodayStart(now);
    // KST 2026-04-19 00:00 = UTC 2026-04-18 15:00
    expect(start.toISOString()).toBe('2026-04-18T15:00:00.000Z');
  });

  test('UTC 15:01 (=KST 다음날 00:01)에는 KST 다음 날 00:00 반환', () => {
    const now = new Date(Date.UTC(2026, 3, 19, 15, 1, 0));
    const start = kstTodayStart(now);
    // KST 2026-04-20 00:00 = UTC 2026-04-19 15:00
    expect(start.toISOString()).toBe('2026-04-19T15:00:00.000Z');
  });

  test('UTC 자정도 KST 오늘 (= UTC 전날 15:00) 반환', () => {
    const now = new Date(Date.UTC(2026, 3, 19, 0, 0, 0));
    const start = kstTodayStart(now);
    // KST 2026-04-19 09:00, 같은 날 KST 00:00 = UTC 2026-04-18 15:00
    expect(start.toISOString()).toBe('2026-04-18T15:00:00.000Z');
  });
});

describe('formatRelativeTime', () => {
  test('5초 미만은 "방금 전"', () => {
    const now = Date.now();
    expect(formatRelativeTime(now - 2_000)).toBe('방금 전');
  });

  test('분/시간/일 단위', () => {
    const now = Date.now();
    expect(formatRelativeTime(now - 30 * 1000)).toBe('30초 전');
    expect(formatRelativeTime(now - 2 * 60 * 1000)).toBe('2분 전');
    expect(formatRelativeTime(now - 3 * 3600 * 1000)).toBe('3시간 전');
    expect(formatRelativeTime(now - 2 * 86400 * 1000)).toBe('2일 전');
  });

  test('null/undefined 방어', () => {
    expect(formatRelativeTime(null)).toBe('-');
    expect(formatRelativeTime(undefined)).toBe('-');
  });
});
