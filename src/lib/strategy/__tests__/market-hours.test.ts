import { isUSDST } from '../market-hours';

describe('isUSDST (US DST 자동 계산)', () => {
  test('1월 한복판은 EST', () => {
    expect(isUSDST(new Date('2026-01-15T12:00:00Z'))).toBe(false);
  });
  test('2026년 3월 8일(둘째 일요일) 직전은 EST', () => {
    // 3월 둘째 일요일 02:00 EST = 07:00 UTC. 06:59 UTC면 아직 EST.
    expect(isUSDST(new Date('2026-03-08T06:59:00Z'))).toBe(false);
  });
  test('2026년 3월 8일 07:00 UTC 이후는 EDT', () => {
    expect(isUSDST(new Date('2026-03-08T07:00:00Z'))).toBe(true);
  });
  test('7월 한복판은 EDT', () => {
    expect(isUSDST(new Date('2026-07-15T12:00:00Z'))).toBe(true);
  });
  test('2026년 11월 1일(첫째 일요일) 06:00 UTC 이후는 EST', () => {
    // 11월 첫째 일요일 02:00 EDT = 06:00 UTC. 05:59 UTC면 아직 EDT.
    expect(isUSDST(new Date('2026-11-01T05:59:00Z'))).toBe(true);
    expect(isUSDST(new Date('2026-11-01T06:00:00Z'))).toBe(false);
  });
  test('12월 한복판은 EST', () => {
    expect(isUSDST(new Date('2026-12-15T12:00:00Z'))).toBe(false);
  });
  test('2027년 3월 14일(둘째 일요일)도 자동 처리', () => {
    expect(isUSDST(new Date('2027-03-14T06:59:00Z'))).toBe(false);
    expect(isUSDST(new Date('2027-03-14T07:00:00Z'))).toBe(true);
  });
});
