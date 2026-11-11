/**
 * T-165 — 정적 표 무결성 (Leader G4-2). 운영자가 표를 손으로 갱신할 때 깨지기 쉬운 성질을 고정한다.
 * 원천 대조(Analyst JSON 과 행 단위 일치)는 변환 직후 dev 스크립트로 확인했다(task Developer 절).
 */
import { CPI_RELEASE_SCHEDULE } from '../cpi-release-schedule';
import { FOMC_DECISION_DATES, FOMC_TARGET_RANGE_ROWS, VERIFIED_THROUGH } from '../fomc-target-range';
import { addMonths } from '../classify';

const isAscendingUnique = (xs: readonly string[]) => xs.every((x, i) => i === 0 || xs[i - 1] < x);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

describe('정책금리 목표 범위 표 (openmarket.htm)', () => {
  it('33행 · 효력일 오름차순·중복 없음 · 형식', () => {
    expect(FOMC_TARGET_RANGE_ROWS).toHaveLength(33);
    const dates = FOMC_TARGET_RANGE_ROWS.map((r) => r.effectiveDate);
    expect(isAscendingUnique(dates)).toBe(true);
    for (const d of dates) expect(d).toMatch(DAY_RE);
    expect(dates[0]).toBe('2008-12-16');
  });
  it('모든 행의 폭이 0.25%p 이고 하단 ≥ 0', () => {
    for (const r of FOMC_TARGET_RANGE_ROWS) {
      expect(Math.round((r.upperPct - r.lowerPct) * 100) / 100).toBe(0.25);
      expect(r.lowerPct).toBeGreaterThanOrEqual(0);
    }
  });
  it.each([
    ['2008-12-16', 0.0, 0.25],
    ['2015-12-17', 0.25, 0.5],
    ['2020-03-16', 0.0, 0.25],
    ['2022-06-16', 1.5, 1.75],
    ['2023-07-27', 5.25, 5.5],
    ['2025-12-11', 3.5, 3.75],
    ['2026-09-17', 3.75, 4.0],
  ])('표본 %s = %s–%s', (d, lo, hi) => {
    expect(FOMC_TARGET_RANGE_ROWS.find((r) => r.effectiveDate === d)).toEqual({ effectiveDate: d, lowerPct: lo, upperPct: hi });
  });
  it('2009~2014·2021 은 변경 행이 없다', () => {
    for (const y of ['2009', '2010', '2011', '2012', '2013', '2014', '2021']) {
      expect(FOMC_TARGET_RANGE_ROWS.filter((r) => r.effectiveDate.startsWith(y))).toHaveLength(0);
    }
  });
  it('VERIFIED_THROUGH = 2026-11-11, 마지막 행 효력일보다 늦다', () => {
    expect(VERIFIED_THROUGH).toBe('2026-11-11');
    expect(VERIFIED_THROUGH >= FOMC_TARGET_RANGE_ROWS[FOMC_TARGET_RANGE_ROWS.length - 1].effectiveDate).toBe(true);
  });
  it('동결돼 있다', () => {
    expect(Object.isFrozen(FOMC_TARGET_RANGE_ROWS)).toBe(true);
    expect(FOMC_TARGET_RANGE_ROWS.every((r) => Object.isFrozen(r))).toBe(true);
  });
});

describe('정례 FOMC 결정일 (fomccalendars.htm)', () => {
  it('24건 · 오름차순 · 2025~2027 연 8회', () => {
    expect(FOMC_DECISION_DATES).toHaveLength(24);
    expect(isAscendingUnique(FOMC_DECISION_DATES)).toBe(true);
    for (const y of ['2025', '2026', '2027']) {
      expect(FOMC_DECISION_DATES.filter((d) => d.startsWith(y))).toHaveLength(8);
    }
    expect(FOMC_DECISION_DATES).not.toContain('2025-08-22'); // notation vote — 금리 결정 아님
    expect(FOMC_DECISION_DATES).toContain('2026-10-28');
    expect(FOMC_DECISION_DATES).toContain('2026-12-09');
    expect(FOMC_DECISION_DATES[FOMC_DECISION_DATES.length - 1]).toBe('2027-12-08');
    expect(Object.isFrozen(FOMC_DECISION_DATES)).toBe(true);
  });
  it('VERIFIED_THROUGH 이전의 결정일은 모두 확인 범위 안이다(배포 시점에 이미 낡지 않았다)', () => {
    const past = FOMC_DECISION_DATES.filter((d) => d < '2026-11-11');
    expect(past[past.length - 1] <= VERIFIED_THROUGH).toBe(true);
  });
});

describe('CPI 발표 일정 표 (BLS)', () => {
  const months = CPI_RELEASE_SCHEDULE.map((r) => r.referenceMonth);
  it('83행 · 2021-01 ~ 2027-11 연속 (빠진 달 없음)', () => {
    expect(CPI_RELEASE_SCHEDULE).toHaveLength(83);
    expect(months[0]).toBe('2021-01');
    expect(months[months.length - 1]).toBe('2027-11');
    months.forEach((m, i) => { if (i > 0) expect(m).toBe(addMonths(months[i - 1], 1)); });
  });
  it('2025-10 치만 미공표(null)이고 확인된 사실이다', () => {
    const nulls = CPI_RELEASE_SCHEDULE.filter((r) => r.releaseAtUtc === null);
    expect(nulls).toEqual([{ referenceMonth: '2025-10', releaseAtUtc: null, confirmed: true }]);
  });
  it('confirmed: 2026-10 치까지 true, 2026-11 치부터 false (G7-2)', () => {
    for (const r of CPI_RELEASE_SCHEDULE) expect(r.confirmed).toBe(r.referenceMonth <= '2026-10');
    expect(CPI_RELEASE_SCHEDULE.filter((r) => r.confirmed)).toHaveLength(70);
  });
  it('모든 발표 시각은 미 동부 08:30 이고, 기준월이 끝난 뒤이며, 시간순이다', () => {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    let prev = 0;
    for (const r of CPI_RELEASE_SCHEDULE) {
      if (r.releaseAtUtc === null) continue;
      expect(r.releaseAtUtc).toMatch(/^\d{4}-\d{2}-\d{2}T1[23]:30:00Z$/);
      const t = Date.parse(r.releaseAtUtc);
      expect(fmt.format(new Date(t))).toBe('08:30');
      const monthEnd = Date.parse(`${addMonths(r.referenceMonth, 1)}-01T00:00:00Z`);
      expect(t).toBeGreaterThan(monthEnd);
      expect(t).toBeGreaterThan(prev);
      prev = t;
    }
  });
  it.each([
    ['2022-06', '2022-07-13T12:30:00Z'],
    ['2025-09', '2025-10-24T12:30:00Z'],
    ['2025-11', '2025-12-18T13:30:00Z'],
    ['2026-10', '2026-11-10T13:30:00Z'],
    ['2026-11', '2026-12-10T13:30:00Z'],
  ])('표본 %s → %s', (m, t) => {
    expect(CPI_RELEASE_SCHEDULE.find((r) => r.referenceMonth === m)?.releaseAtUtc).toBe(t);
  });
  it('동결돼 있다', () => {
    expect(Object.isFrozen(CPI_RELEASE_SCHEDULE)).toBe(true);
    expect(CPI_RELEASE_SCHEDULE.every((r) => Object.isFrozen(r))).toBe(true);
  });
});
