/**
 * T-087 Codex C2 — 응답 행 날짜 범위 검사(순수)와 complete 판정 입력(rowsOutOfRange·maxKisCalls). 값은 합성.
 *  - 국내 [queryFrom, queryTo] 엄격 · 해외 [queryFrom−1, queryTo+1](KST 주문일 ↔ 현지 조회일 차이 — normalize.rowDateBounds 주석) · 잔고 해당 없음
 */
import { assessRunCompleteness, rowDateBounds, splitByRowDate } from '../normalize';
import type { CompletenessInput } from '../types';

const base: CompletenessInput = {
  market: 'domestic', kind: 'fills', sourceTr: 'TTTC0081R', fetchOutcome: 'ended', lastTrCont: 'E', sumCheck: 'match',
  duplicateKeys: 0, pages: 1, kisCalls: 1, normalizeIssues: 0,
};

describe('rowDateBounds', () => {
  test('국내 엄격 · 해외 ±1일 · 잔고 null', () => {
    expect(rowDateBounds('domestic', 'fills', '2026-11-01', '2026-11-05')).toEqual({ from: '2026-11-01', to: '2026-11-05' });
    expect(rowDateBounds('domestic', 'realized_pnl', '2026-11-01', '2026-11-05')).toEqual({ from: '2026-11-01', to: '2026-11-05' });
    expect(rowDateBounds('overseas', 'fills', '2026-11-01', '2026-11-05')).toEqual({ from: '2026-10-31', to: '2026-11-06' });
    expect(rowDateBounds('overseas', 'realized_pnl', '2026-12-31', '2026-12-31')).toEqual({ from: '2026-12-30', to: '2027-01-01' });
    expect(rowDateBounds('domestic', 'position_snapshot', '2026-11-05', '2026-11-05')).toBeNull();
    expect(rowDateBounds('overseas', 'position_snapshot', '2026-11-05', '2026-11-05')).toBeNull();
  });
  test('조회 범위 형식 오류는 던진다', () => {
    expect(() => rowDateBounds('domestic', 'fills', '2026-11-06', '2026-11-05')).toThrow(RangeError);
    expect(() => rowDateBounds('domestic', 'fills', 'x', '2026-11-05')).toThrow(RangeError);
  });
});

describe('splitByRowDate', () => {
  const items = ['2026-10-31', '2026-11-01', '2026-11-05', '2026-11-06', '0000-00-00', '', '2026-11-03'];
  test('🔴 국내 — 경계 포함, 하루 밖·읽을 수 없는 날짜는 밖', () => {
    const r = splitByRowDate(items, (d) => d, rowDateBounds('domestic', 'fills', '2026-11-01', '2026-11-05'));
    expect(r).toEqual({ inRange: ['2026-11-01', '2026-11-05', '2026-11-03'], outOfRange: 4 });
  });
  test('🔴 해외 — queryFrom−1·queryTo+1 은 안, 그 밖은 밖', () => {
    const r = splitByRowDate([...items, '2026-10-30', '2026-11-07'], (d) => d, rowDateBounds('overseas', 'fills', '2026-11-01', '2026-11-05'));
    expect(r).toEqual({ inRange: ['2026-10-31', '2026-11-01', '2026-11-05', '2026-11-06', '2026-11-03'], outOfRange: 4 });
  });
  test('bounds null(잔고) → 전부 안', () => {
    expect(splitByRowDate(items, (d) => d, null)).toEqual({ inRange: items, outOfRange: 0 });
  });
});

describe('assessRunCompleteness — 추가 입력', () => {
  test('범위 밖 행이 있으면 incomplete(rows_out_of_range) · 0 이면 complete', () => {
    expect(assessRunCompleteness({ ...base, rowsOutOfRange: 0 })).toEqual({ status: 'complete', reasons: [] });
    expect(assessRunCompleteness({ ...base, rowsOutOfRange: 1 })).toEqual({ status: 'incomplete', reasons: ['rows_out_of_range'] });
  });
  test('🔴 호출이 상한을 넘으면 incomplete(call_cap_exceeded) · 같으면 complete · 상한 미지정이면 기존 동작', () => {
    expect(assessRunCompleteness({ ...base, kisCalls: 13, maxKisCalls: 12 })).toEqual({ status: 'incomplete', reasons: ['call_cap_exceeded'] });
    expect(assessRunCompleteness({ ...base, kisCalls: 12, maxKisCalls: 12 }).status).toBe('complete');
    expect(assessRunCompleteness({ ...base, kisCalls: 13 }).status).toBe('complete');
  });
});
