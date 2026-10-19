import { formatRelativeTime, kstTodayStart, toKstDatetime } from '../time';

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

describe('toKstDatetime (T-050) — DB 가 KST 인 DATETIME 컬럼에 문자열로 바인딩할 값', () => {
  // 구현의 +9h 산술과 다른 경로(Intl)로 만든 독립 기대값. sv-SE 는 'YYYY-MM-DD HH:mm:ss' 로 나온다.
  const oracle = (d: Date) => d.toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 19);

  test('🔴 UTC 벽시계가 아니라 KST 벽시계 — UTC 01:00 은 10:00', () => {
    expect(toKstDatetime(new Date('2026-10-18T01:00:00Z'))).toBe('2026-10-18 10:00:00');
  });

  test('날짜 경계: UTC 15:00 은 다음 날 00:00, 14:59:59 는 같은 날 23:59:59', () => {
    expect(toKstDatetime(new Date('2026-10-17T15:00:00Z'))).toBe('2026-10-18 00:00:00');
    expect(toKstDatetime(new Date('2026-12-31T14:59:59Z'))).toBe('2026-12-31 23:59:59');
    expect(toKstDatetime(new Date('2026-12-31T15:00:00Z'))).toBe('2027-01-01 00:00:00');
  });

  test('밀리초는 버리고 초 단위로 — 윤일 포함 여러 시점이 독립 계산과 같다', () => {
    const samples = ['2028-02-28T15:00:00.999Z', '2028-02-29T14:59:59.001Z', '2026-03-31T23:59:59Z', '2026-01-01T00:00:00Z'];
    for (const iso of samples) expect(toKstDatetime(new Date(iso))).toBe(oracle(new Date(iso)));
  });
});
