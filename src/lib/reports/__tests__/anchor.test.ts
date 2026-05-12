import { parseAnchorList, shouldFireAtAnchorList } from '../anchor';

/** KST hh:mm 을 UTC Date 로 변환 */
function kst(y: number, mo: number, d: number, hh: number, mm: number): Date {
  return new Date(Date.UTC(y, mo - 1, d, hh - 9, mm));
}

describe('parseAnchorList', () => {
  test('단일 시각', () => {
    expect(parseAnchorList('08:00')).toEqual([{ hh: 8, mm: 0 }]);
  });
  test('콤마 구분 다중', () => {
    expect(parseAnchorList('08:00, 17:00')).toEqual([{ hh: 8, mm: 0 }, { hh: 17, mm: 0 }]);
  });
  test('공백 다양', () => {
    expect(parseAnchorList(' 08:00 , 17:30 ,23:59')).toEqual([
      { hh: 8, mm: 0 }, { hh: 17, mm: 30 }, { hh: 23, mm: 59 },
    ]);
  });
  test('잘못된 시각 무시', () => {
    expect(parseAnchorList('08:00, 25:00, 17:60, 09:30')).toEqual([
      { hh: 8, mm: 0 }, { hh: 9, mm: 30 },
    ]);
  });
  test('빈값/null', () => {
    expect(parseAnchorList(null)).toEqual([]);
    expect(parseAnchorList('')).toEqual([]);
    expect(parseAnchorList('  ')).toEqual([]);
  });
});

describe('shouldFireAtAnchorList', () => {
  const anchors = parseAnchorList('08:00, 17:00');

  test('08:00 KST 직후 last=어제 → 발송', () => {
    const now = kst(2026, 5, 8, 8, 5);          // 오늘 08:05 KST
    const last = kst(2026, 5, 7, 17, 5);        // 어제 17:05 발송
    expect(shouldFireAtAnchorList(anchors, last, now)).toBe(true);
  });

  test('17:00 KST 직후 last=오늘 08:05 → 발송', () => {
    const now = kst(2026, 5, 8, 17, 5);
    const last = kst(2026, 5, 8, 8, 5);
    expect(shouldFireAtAnchorList(anchors, last, now)).toBe(true);
  });

  test('11:00 KST (anchor 사이) last=오늘 08:05 → 미발송', () => {
    const now = kst(2026, 5, 8, 11, 0);
    const last = kst(2026, 5, 8, 8, 5);
    expect(shouldFireAtAnchorList(anchors, last, now)).toBe(false);
  });

  test('07:55 KST last=어제 17:05 → 아직 08:00 미도래 → 미발송', () => {
    const now = kst(2026, 5, 8, 7, 55);
    const last = kst(2026, 5, 7, 17, 5);
    expect(shouldFireAtAnchorList(anchors, last, now)).toBe(false);
  });

  test('첫 발송 (last=null) — 가장 최근 anchor 도래 시 발송', () => {
    const now = kst(2026, 5, 8, 17, 5);
    expect(shouldFireAtAnchorList(anchors, null, now)).toBe(true);
  });

  test('anchor 빈 리스트 → 항상 false', () => {
    expect(shouldFireAtAnchorList([], null, new Date())).toBe(false);
  });
});
