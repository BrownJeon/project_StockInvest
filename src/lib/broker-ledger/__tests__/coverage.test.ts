/**
 * T-087 Dev-2 — 커버리지 순수 함수(설계 §3.4 L-2·L-6). 시각은 KST 벽시계 문자열(합성).
 */
import { COVERAGE_MATCH_MARGIN_MS, isRangeCovered, kstWallMs, mergeCoverage, stepCoverage, stepRange } from '../coverage';

const W = (windowFrom: string, effectiveTo: string) => ({ windowFrom, effectiveTo });

describe('kstWallMs', () => {
  test('문자열·Date 를 같은 자(KST 벽시계)로', () => {
    expect(kstWallMs('2026-11-03 07:21:00')).toBe(Date.UTC(2026, 10, 3, 7, 21, 0));
    expect(kstWallMs('2026-11-03')).toBe(Date.UTC(2026, 10, 3));
    expect(kstWallMs(new Date('2026-11-02T22:21:00Z'))).toBe(Date.UTC(2026, 10, 3, 7, 21, 0));
  });
  test('해석 불가 → null(커버리지를 넓히지 않는다)', () => {
    for (const v of ['', '2026-02-30', '2026-11-03 25:00:00', 'x', '2026/11/03']) expect(kstWallMs(v)).toBeNull();
    expect(kstWallMs(new Date(NaN))).toBeNull();
  });
});

describe('mergeCoverage — effective_to 기준 병합(L-2)', () => {
  test('🔴 날짜 인접(window_to+1 = 다음 window_from)이라도 앞 창이 07:25 에 끝났으면 그날 오후는 틈 — 잇지 않는다', () => {
    const m = mergeCoverage([W('2026-10-25', '2026-10-25 07:25:00'), W('2026-10-26', '2026-10-27 07:25:00')]);
    expect(m).toHaveLength(2);
    expect(stepCoverage([W('2026-10-25', '2026-10-25 07:25:00'), W('2026-10-26', '2026-10-27 07:25:00')], '2026-10-25 22:00:00', '2026-10-25 23:00:00')).toBe('coverage_gap');
  });
  test('겹치거나 맞닿으면 잇는다(끝 = 다음 시작 포함), 순서 무관', () => {
    const m = mergeCoverage([W('2026-10-28', '2026-11-03 07:21:00'), W('2026-10-27', '2026-10-28 00:00:00')]);
    expect(m).toEqual([{ startMs: Date.UTC(2026, 9, 27), endMs: Date.UTC(2026, 10, 3, 7, 21) }]);
  });
  test('해석 불가·끝<시작 창은 버린다', () => {
    expect(mergeCoverage([W('bad', '2026-11-03 07:21:00'), W('2026-11-03', '2026-11-02 00:00:00')])).toEqual([]);
  });
  test('독립 검토 fail-open 재현 — 5월 incomplete·6월 failed(입력에 없음) + 10월 complete → 6월 단계는 틈', () => {
    expect(stepCoverage([W('2026-10-01', '2026-10-08 07:21:00')], '2026-06-10 08:00:00', '2026-06-10 09:00:00')).toBe('coverage_gap');
  });
});

describe('stepRange / isRangeCovered — [prev − L, cur](L-6)', () => {
  test('L = 1일', () => {
    expect(COVERAGE_MATCH_MARGIN_MS).toBe(86_400_000);
    expect(stepRange('2026-11-03 08:00:00', '2026-11-03 09:00:00')).toEqual({ fromMs: Date.UTC(2026, 10, 2, 8), toMs: Date.UTC(2026, 10, 3, 9) });
    expect(stepRange('2026-11-03 09:00:00', '2026-11-03 08:00:00')).toBeNull();   // 역순
  });
  test('🔴 −L 때문에 창 시작 직후 단계는 커버되지 않는다(경계 체결 여유)', () => {
    const w = [W('2026-10-27', '2026-11-03 07:21:00')];
    expect(stepCoverage(w, '2026-10-27 08:00:00', '2026-10-27 09:00:00')).toBe('coverage_gap');
    expect(stepCoverage(w, '2026-10-28 00:00:00', '2026-10-28 01:00:00')).toBe('covered');
    expect(stepCoverage(w, '2026-11-03 07:00:00', '2026-11-03 07:21:00')).toBe('covered');   // 끝 포함
    expect(stepCoverage(w, '2026-11-03 07:00:00', '2026-11-03 07:21:01')).toBe('coverage_gap');   // 실행 뒤 1초
  });
  test('병합 구간 하나가 통째로 포함해야 한다', () => {
    const iv = mergeCoverage([W('2026-10-27', '2026-10-28 00:00:00'), W('2026-10-29', '2026-10-30 00:00:00')]);
    expect(isRangeCovered(iv, Date.UTC(2026, 9, 27, 1), Date.UTC(2026, 9, 29, 1))).toBe(false);
  });
});
