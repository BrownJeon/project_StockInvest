/**
 * T-165 — 순수 분류 함수 `classifyMacroRegime` (Analyst §2~§6·§9, Leader G4-1·G7-2·G7-3).
 *
 * 기대값 원천:
 *  - Analyst 오라클 18건(H1~H16·S1·S2) — `fixtures/analyst-expected-cases.ts`(변환 스크립트로 옮긴 리터럴)
 *  - 그 밖의 실제 날짜 기대값(발표 전날·2023-05 경계)은 Analyst 오라클 계산기(`t165_gen.py` 의 classify 원문)를
 *    같은 입력으로 돌린 값을 리터럴로 옮겼다(Developer, 2026-11-12 — 8만여 시점 전수 대조 일치 후).
 *  - 합성 경계(9조합·반올림·gap 등)는 규칙에서 직접 계산한 값.
 * 이 파일은 저장소 밖 파일을 읽지 않는다. 네트워크·DB 0.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  addMonths,
  classifyMacroRegime,
  DEFAULT_MACRO_REGIME_TABLES,
  etDateOf,
  isoSeconds,
  minusCalendarMonths,
  monthDiff,
  type ClassifyMacroRegimeInput,
  type MacroRegimeTables,
} from '../classify';
import type { CpiReleaseRow } from '../cpi-release-schedule';
import type { FomcTargetRangeRow } from '../fomc-target-range';
import { RULE_VERSION, type CpiIndexByMonth, type MacroRegimeRecord } from '../types';
import { ANALYST_CASES } from './fixtures/analyst-expected-cases';

/** BLS 공공자료 — CUUR0000SA0 2017-01 ~ 2026-10 (2025-10 = null, 미공표) */
const CPI_FIXTURE: CpiIndexByMonth = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'cpi-cuur0000sa0-2017-2026.json'), 'utf8'),
).index;

const at = (iso: string) => new Date(iso);
function run(asOfIso: string, extra: Partial<ClassifyMacroRegimeInput> = {}): MacroRegimeRecord {
  return classifyMacroRegime({ asOf: at(asOfIso), cpiIndex: CPI_FIXTURE, fetchedAt: null, fetchStatus: 'ok', ...extra });
}

// ─── Analyst 오라클 18건 ──────────────────────────────────────────────────────
describe('Analyst 기대값 오라클 (H1~H16·S1·S2) — 실제 정적 표 + BLS 실측 지수', () => {
  it('오라클은 18건이다 (변환 누락 방지)', () => {
    expect(ANALYST_CASES).toHaveLength(18);
  });

  it.each(ANALYST_CASES.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const rec = run(c.asOfUtc);
    expect(rec).toMatchObject(c.expected);
    expect(rec.reasonCodes).toEqual(c.expected.reasonCodes);
    expect(rec.ruleVersion).toBe(RULE_VERSION);
    // 오라클이 축을 생략한 경우(= 미계산) 우리 기록도 그 축이 비어 있어야 한다
    if (!('cpi' in c.expected)) {
      expect(rec.cpi.referenceMonth).toBeNull();
      expect(rec.cpi.yoyPct).toBeNull();
      expect(rec.cpi.hot).toBeNull();
    }
    if (!('rate' in c.expected)) {
      expect(rec.rate.deltaPct).toBeNull();
      expect(rec.rate.direction).toBeNull();
    }
  });

  it('🔴 H1 2021-08-16 은 hot_hold 다 — 영상의 "유형⑤" 라벨은 look-ahead 였다 (FFR 0%, 첫 인상 전)', () => {
    const rec = run('2021-08-16T14:00:00Z');
    expect(rec.label).toBe('hot_hold');
    expect(rec.isType5).toBe(false);
    expect(rec.cpi.yoyPct).toBe(5.4);
    expect(rec.rate.deltaPct).toBe(0);
  });
});

// ─── 발표일 정렬 (look-ahead 방지) ────────────────────────────────────────────
describe('발표일 정렬 — 발표 시각(등호 포함) 이후에만 그 달을 쓴다', () => {
  it.each([
    // [설명, asOf, 기대 기준월]
    ['발표 전날 (EDT, 2022-07-12 08:30 ET)', '2022-07-12T12:30:00Z', '2022-05'],
    ['당일 08:29 EDT (H4)', '2022-07-13T12:29:00Z', '2022-05'],
    ['당일 08:30 EDT (H5, 등호 포함)', '2022-07-13T12:30:00Z', '2022-06'],
    ['당일 08:29 EST (H12)', '2026-11-10T13:29:00Z', '2026-09'],
    ['당일 08:30 EST (H13) — 2026-10 발표됐으나 기준월 2025-10 미공표 → 2026-09', '2026-11-10T13:30:00Z', '2026-09'],
  ])('%s', (_d, asOf, month) => {
    expect(run(asOf).cpi.referenceMonth).toBe(month);
  });

  it('발표 1초 전에는 그 달 값이 캐시에 있어도 쓰지 않는다 (실시간 look-ahead 0)', () => {
    expect(run('2022-07-13T12:29:59Z').cpi.referenceMonth).toBe('2022-05');
    expect(run('2022-07-13T12:30:00Z').cpi.referenceMonth).toBe('2022-06');
  });

  it('발표 전날 기대값 전체 — 오라클 계산기 산출과 같다', () => {
    expect(run('2022-07-12T12:30:00Z')).toMatchObject({
      asOfEtDate: '2022-07-12',
      cpi: { referenceMonth: '2022-05', releaseAtUtc: '2022-06-10T12:30:00Z', index: 292.296, baseIndex: 269.195, yoyPctRaw: 8.5815, yoyPct: 8.6, hot: true, monthGap: 2 },
      rate: { upperPct: 1.75, compareDate: '2022-01-12', upper6mAgoPct: 0.25, deltaPct: 1.5, direction: 'tightening' },
      label: 'hot_tightening', isType5: true, reasonCodes: [],
    });
  });
});

// ─── 합성 입력 — 분류 경계 ───────────────────────────────────────────────────
/**
 * 합성 세계: 판정 시각 2030-06-15 12:00 ET. 2030-05 치가 2030-06-10 에 발표됐고 기준 2029-05 = 100.
 * 정책금리: 2029-12-15 효력 상단 U0, 2030-03-01 효력 상단 U1 → 6개월 비교일 2029-12-15.
 */
const SYN_AS_OF = '2030-06-15T16:00:00Z';
function synTables(u0: number, u1: number): Partial<MacroRegimeTables> {
  const fomcRows: FomcTargetRangeRow[] = [
    { effectiveDate: '2029-12-15', lowerPct: u0 - 0.25, upperPct: u0 },
    { effectiveDate: '2030-03-01', lowerPct: u1 - 0.25, upperPct: u1 },
  ];
  const cpiReleaseSchedule: CpiReleaseRow[] = [
    { referenceMonth: '2030-02', releaseAtUtc: '2030-03-12T12:30:00Z', confirmed: true },
    { referenceMonth: '2030-03', releaseAtUtc: '2030-04-10T12:30:00Z', confirmed: true },
    { referenceMonth: '2030-04', releaseAtUtc: '2030-05-12T12:30:00Z', confirmed: true },
    { referenceMonth: '2030-05', releaseAtUtc: '2030-06-10T12:30:00Z', confirmed: true },
    { referenceMonth: '2030-06', releaseAtUtc: '2030-07-14T12:30:00Z', confirmed: false },
  ];
  return { fomcRows, cpiReleaseSchedule, decisionDates: ['2030-07-29'], verifiedThrough: '2030-06-15' };
}
function syn(index: Record<string, number | null>, u0 = 5.5, u1 = 5.5, extra: Partial<ClassifyMacroRegimeInput> = {}) {
  return classifyMacroRegime({ asOf: at(SYN_AS_OF), cpiIndex: index, tables: synTables(u0, u1), ...extra });
}

describe('분류 경계 — yoyPct 3.9/4.0/4.1 × Δ −0.25/0/+0.25 (9조합 중 유형⑤ 는 2개)', () => {
  const cases: Array<[number, number, string]> = [];
  for (const y of [3.9, 4.0, 4.1]) {
    for (const [d, dir] of [[-0.25, 'easing'], [0, 'hold'], [0.25, 'tightening']] as const) {
      cases.push([y, d, `${y >= 4.0 ? 'hot' : 'normal'}_${dir}`]);
    }
  }
  it.each(cases)('yoy %s · Δ %s → %s', (y, d, label) => {
    const rec = syn({ '2030-05': 100 + y, '2029-05': 100 }, 5.5, 5.5 + d);
    expect(rec.cpi.yoyPct).toBe(y);
    expect(rec.rate.deltaPct).toBe(d);
    expect(rec.label).toBe(label);
    expect(rec.isType5).toBe(label === 'hot_tightening');
    expect(rec.reasonCodes).toEqual([]);
  });
  it('유형⑤ 는 (4.0,+0.25)·(4.1,+0.25) 두 조합뿐이다', () => {
    expect(cases.filter(([, , l]) => l === 'hot_tightening').map(([y, d]) => [y, d])).toEqual([[4.0, 0.25], [4.1, 0.25]]);
  });
});

describe('반올림 경계 — 임계 비교는 소수 1자리 반올림 후 (BLS 헤드라인과 같은 값)', () => {
  it('raw 3.95 → 4.0 → hot (의도된 동작)', () => {
    const rec = syn({ '2030-05': 103.95, '2029-05': 100 });
    expect(rec.cpi.yoyPctRaw).toBe(3.95);
    expect(rec.cpi.yoyPct).toBe(4.0);
    expect(rec.cpi.hot).toBe(true);
  });
  it('raw 3.949 → 3.9 → normal', () => {
    const rec = syn({ '2030-05': 103.949, '2029-05': 100 });
    expect(rec.cpi.yoyPctRaw).toBe(3.949);
    expect(rec.cpi.yoyPct).toBe(3.9);
    expect(rec.cpi.hot).toBe(false);
  });
  it('실제 경계 2023-05 (raw 4.0476 → 4.0) — 2023-06-20 은 hot_tightening (오라클 계산기 산출)', () => {
    expect(run('2023-06-20T14:00:00Z')).toMatchObject({
      cpi: { referenceMonth: '2023-05', yoyPctRaw: 4.0476, yoyPct: 4.0, hot: true },
      rate: { upperPct: 5.25, upper6mAgoPct: 4.5, deltaPct: 0.75, direction: 'tightening' },
      label: 'hot_tightening', isType5: true,
    });
  });
  it('음의 YoY 도 -0 이 아닌 값으로 기록한다', () => {
    const rec = syn({ '2030-05': 99.99, '2029-05': 100 });
    expect(Object.is(rec.cpi.yoyPct, -0)).toBe(false);
    expect(rec.cpi.yoyPct).toBe(0);
    expect(rec.cpi.hot).toBe(false);
  });
});

describe('Δ 부동소수 — 소수 2자리 반올림', () => {
  it('5.25 → 5.50 = +0.25 (5.5−5.25 의 오차 없이)', () => {
    const rec = syn({ '2030-05': 104, '2029-05': 100 }, 5.25, 5.5);
    expect(rec.rate.deltaPct).toBe(0.25);
    expect(rec.rate.direction).toBe('tightening');
    expect(rec.label).toBe('hot_tightening');
  });
  it('0.3 vs 0.1+0.2 처럼 부동소수 오차뿐인 Δ 는 소수 2자리 반올림으로 정확히 0 → hold (tightening 으로 오분류하지 않는다)', () => {
    expect(syn({ '2030-05': 104, '2029-05': 100 }, 0.3, 0.1 + 0.2).rate).toMatchObject({ deltaPct: 0, direction: 'hold' });
  });
});

describe('결측·이상 값 — 그 달은 없음으로 보고 이전 달로 내려간다', () => {
  const base = { '2030-04': 103, '2029-04': 100, '2029-05': 100 };
  it.each([
    ['null ("-")', null],
    ['NaN', Number.NaN],
    ['0', 0],
    ['음수', -1],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['문자열', '104' as unknown as number],
  ])('기준월 값이 %s 이면 2030-04 로 fallback', (_d, v) => {
    const rec = syn({ ...base, '2030-05': v as number | null });
    expect(rec.cpi.referenceMonth).toBe('2030-04');
    expect(rec.cpi.monthGap).toBe(2);
    expect(rec.cpi.yoyPct).toBe(3);
  });
  it('12개월 전(기준) 값이 없어도 그 달을 못 쓴다 (2025-10 미공표 → 2026-10 YoY 불가와 같은 경우)', () => {
    const rec = syn({ '2030-05': 104, '2029-05': null, '2030-04': 103, '2029-04': 100 });
    expect(rec.cpi.referenceMonth).toBe('2030-04');
  });
  it('gap 3 은 허용, gap 4 는 cpi_stale', () => {
    // 2030-03(gap 3)만 쓸 수 있는 경우
    const ok = syn({ '2030-03': 102, '2029-03': 100 });
    expect(ok.cpi).toMatchObject({ referenceMonth: '2030-03', monthGap: 3 });
    expect(ok.reasonCodes).toEqual([]);
    // 2030-02(gap 4)만 있는 경우 → stale (값이 있어도 쓰지 않는다)
    const stale = syn({ '2030-02': 102, '2029-02': 100 });
    expect(stale.label).toBe('unknown');
    expect(stale.reasonCodes).toEqual(['cpi_stale']);
    expect(stale.cpi.referenceMonth).toBeNull();
    expect(stale.rate.direction).toBe('hold'); // 금리 축은 채운다(사후 검증용)
  });
});

describe('발표 기준 releaseBasis (G7-2) — 연기된 발표의 사후 재계산 look-ahead 방지', () => {
  /** 2030-05 치 예정 T=2030-06-10 08:30 ET 였으나 실제로는 T+1 에 발표됐다. 최신 응답에는 값이 있다. */
  const idx = { '2030-05': 104.5, '2029-05': 100, '2030-04': 103, '2029-04': 100 };
  const midDelay = '2030-06-11T00:00:00Z'; // T~T+1 사이 (ET 2030-06-10 20:00)
  function tablesWith(row: CpiReleaseRow): Partial<MacroRegimeTables> {
    const t = synTables(5.5, 5.5);
    return { ...t, cpiReleaseSchedule: [...t.cpiReleaseSchedule!.filter((r) => r.referenceMonth !== '2030-05'), row] };
  }
  const planned = { referenceMonth: '2030-05', releaseAtUtc: '2030-06-10T12:30:00Z', confirmed: false };
  const corrected = { referenceMonth: '2030-05', releaseAtUtc: '2030-06-11T12:30:00Z', confirmed: true };

  it('live: 예정 시각이 지났으면 그 달을 쓴다 (운영 — 실제로 연기되면 API 에 값이 없어 자동 안전)', () => {
    const rec = classifyMacroRegime({ asOf: at(midDelay), cpiIndex: idx, tables: tablesWith(planned) });
    expect(rec.cpi.referenceMonth).toBe('2030-05');
  });
  it('confirmed_only: 미확인 행은 미발표 — T~T+1 구간은 이전 달', () => {
    const rec = classifyMacroRegime({ asOf: at(midDelay), cpiIndex: idx, tables: tablesWith(planned), releaseBasis: 'confirmed_only' });
    expect(rec.cpi.referenceMonth).toBe('2030-04');
    expect(rec.cpi.expectedReferenceMonth).toBe('2030-04');
  });
  it('confirmed_only + 실제 날짜로 고친 확인 행: T+1 전에는 이전 달, T+1 08:30 ET 부터 그 달', () => {
    const before = classifyMacroRegime({ asOf: at(midDelay), cpiIndex: idx, tables: tablesWith(corrected), releaseBasis: 'confirmed_only' });
    const after = classifyMacroRegime({ asOf: at('2030-06-11T12:30:00Z'), cpiIndex: idx, tables: tablesWith(corrected), releaseBasis: 'confirmed_only' });
    expect(before.cpi.referenceMonth).toBe('2030-04');
    expect(after.cpi.referenceMonth).toBe('2030-05');
  });
  it('실제 표: 2026-12-10 발표 직후 2026-11 값이 들어와도 confirmed_only 는 미확인 행을 쓰지 않는다', () => {
    const idx2 = { ...CPI_FIXTURE, '2026-11': 340, '2025-11': 324.122 };
    const asOf = '2026-12-10T14:00:00Z';
    expect(run(asOf, { cpiIndex: idx2 }).cpi.referenceMonth).toBe('2026-11');
    expect(run(asOf, { cpiIndex: idx2, releaseBasis: 'confirmed_only' }).cpi.referenceMonth).toBe('2026-09');
  });
  it('실제 표: 확인된 구간(≤2026-10)에서는 두 기준이 같다', () => {
    for (const c of ANALYST_CASES.filter((x) => x.asOfUtc <= '2026-11-12')) {
      expect(run(c.asOfUtc, { releaseBasis: 'confirmed_only' })).toEqual(run(c.asOfUtc));
    }
  });
});

describe('발표 지연 표시 (G7-3) — expectedReferenceMonth · lagsSchedule', () => {
  it('H14 2026-11-11: 일정상 2026-10 이 발표됐지만 기준월 미공표로 2026-09 를 쓴다 → lagsSchedule true', () => {
    expect(run('2026-11-11T14:00:00Z').cpi).toMatchObject({ referenceMonth: '2026-09', expectedReferenceMonth: '2026-10', lagsSchedule: true });
  });
  it('H5 발표 순간: 일정과 일치 → false / H4 1분 전: 일정상 최신이 아직 2022-05 → false', () => {
    expect(run('2022-07-13T12:30:00Z').cpi).toMatchObject({ referenceMonth: '2022-06', expectedReferenceMonth: '2022-06', lagsSchedule: false });
    expect(run('2022-07-13T12:29:00Z').cpi).toMatchObject({ referenceMonth: '2022-05', expectedReferenceMonth: '2022-05', lagsSchedule: false });
  });
  it('발표 뒤 캐시에 그 달이 아직 없으면 true (예: 08:30 직후 수집분이 이전 응답)', () => {
    const idx = { ...CPI_FIXTURE } as Record<string, number | null>;
    delete idx['2022-06'];
    expect(run('2022-07-13T13:00:00Z', { cpiIndex: idx }).cpi).toMatchObject({ referenceMonth: '2022-05', expectedReferenceMonth: '2022-06', lagsSchedule: true });
  });
  it('일정표가 시작되기 전(2009)은 expected 없음 → false', () => {
    expect(run('2009-06-16T14:00:00Z').cpi).toMatchObject({ expectedReferenceMonth: null, lagsSchedule: false });
  });
});

describe('사유 코드 — 미로딩·캐시 낡음·순서', () => {
  it('cpiIndex null → cpi_not_loaded (cpi_stale 를 겹쳐 적지 않는다 — 미로딩은 오류와 따로 센다)', () => {
    const rec = classifyMacroRegime({ asOf: at('2026-11-11T14:00:00Z'), cpiIndex: null });
    expect(rec.label).toBe('unknown');
    expect(rec.reasonCodes).toEqual(['cpi_not_loaded']);
    expect(rec.cpi.fetchStatus).toBe('not_attempted');
    expect(rec.rate).toMatchObject({ deltaPct: 0.25, direction: 'tightening' }); // 금리 축은 채운다
  });
  it('마지막 성공이 7일 초과 → cpi_cache_stale (정확히 7일은 아직 아님), 물가 축 값은 그대로 기록', () => {
    const asOf = '2026-11-11T14:00:00Z';
    const exactly7d = new Date(at(asOf).getTime() - 7 * 86_400_000);
    const over7d = new Date(exactly7d.getTime() - 1000);
    const fresh = run(asOf, { fetchedAt: exactly7d });
    expect(fresh.reasonCodes).toEqual([]);
    expect(fresh.cpi.cacheAgeSec).toBe(7 * 86_400);
    const stale = run(asOf, { fetchedAt: over7d, fetchStatus: 'timeout' });
    expect(stale.label).toBe('unknown');
    expect(stale.reasonCodes).toEqual(['cpi_cache_stale']);
    expect(stale.cpi).toMatchObject({ referenceMonth: '2026-09', yoyPct: 3.7, fetchStatus: 'timeout', fetchedAtUtc: '2026-11-04T13:59:59Z' });
  });
  it('여러 사유는 Analyst §6 우선순위 순서로 함께 적는다', () => {
    const rec = run('2027-12-20T14:00:00Z', { fetchedAt: at('2026-11-11T00:00:00Z') });
    expect(rec.reasonCodes).toEqual(['cpi_cache_stale', 'cpi_stale', 'rate_table_stale', 'rate_schedule_exhausted']);
  });
  it('nextKnownDecisionDate — 결정일 당일은 그날, 일정 소진 뒤는 null', () => {
    expect(run('2026-12-09T14:00:00Z').rate.nextKnownDecisionDate).toBe('2026-12-09');
    expect(run('2026-11-11T14:00:00Z').rate.nextKnownDecisionDate).toBe('2026-12-09');
    expect(run('2027-12-20T14:00:00Z').rate.nextKnownDecisionDate).toBeNull();
  });
  it('결정일 당일(2026-12-09)은 아직 낡음이 아니다 — 지난 다음 날부터 rate_table_stale', () => {
    expect(run('2026-12-09T22:00:00Z').reasonCodes).not.toContain('rate_table_stale');
    expect(run('2026-12-10T14:00:00Z').reasonCodes).toContain('rate_table_stale');
  });
});

describe('기록 형식', () => {
  it('Analyst §7 필드 + G7-3 필드를 모두 갖는다', () => {
    const rec = run('2026-11-11T14:00:00Z', { fetchedAt: at('2026-11-11T13:00:00Z') });
    expect(Object.keys(rec).sort()).toEqual(['asOfEtDate', 'asOfUtc', 'cpi', 'isType5', 'label', 'rate', 'reasonCodes', 'ruleVersion']);
    expect(Object.keys(rec.cpi).sort()).toEqual([
      'baseIndex', 'baseMonth', 'cacheAgeSec', 'expectedReferenceMonth', 'fetchStatus', 'fetchedAtUtc', 'hot', 'index',
      'lagsSchedule', 'monthGap', 'referenceMonth', 'releaseAtUtc', 'seriesId', 'yoyPct', 'yoyPctRaw',
    ]);
    expect(Object.keys(rec.rate).sort()).toEqual([
      'compareDate', 'deltaPct', 'direction', 'nextKnownDecisionDate', 'tableVerifiedThrough', 'upper6mAgoPct', 'upperEffectiveFrom', 'upperPct',
    ]);
    expect(rec.cpi).toMatchObject({ seriesId: 'CUUR0000SA0', fetchedAtUtc: '2026-11-11T13:00:00Z', cacheAgeSec: 3600 });
    expect(rec.rate.tableVerifiedThrough).toBe('2026-11-11');
  });
  it('직렬화 크기가 작다 (eval_funnel detail 60,000자 한도 대비)', () => {
    expect(JSON.stringify(run('2026-11-11T14:00:00Z')).length).toBeLessThan(1500);
  });
  it('asOfUtc 는 초 단위로 자른다', () => {
    expect(run('2026-11-11T14:00:00.987Z').asOfUtc).toBe('2026-11-11T14:00:00Z');
  });
});

describe('순수성·무예외', () => {
  it('같은 입력이면 같은 출력, 입력을 바꾸지 않는다, Date.now 를 쓰지 않는다', () => {
    const idx = Object.freeze({ ...CPI_FIXTURE });
    const spy = jest.spyOn(Date, 'now').mockImplementation(() => { throw new Error('Date.now 를 쓰면 안 된다'); });
    try {
      const a = classifyMacroRegime({ asOf: at('2022-06-16T14:00:00Z'), cpiIndex: idx });
      const b = classifyMacroRegime({ asOf: at('2022-06-16T14:00:00Z'), cpiIndex: idx });
      expect(a).toEqual(b);
      expect(a.label).toBe('hot_tightening');
    } finally {
      spy.mockRestore();
    }
    expect(idx).toEqual(CPI_FIXTURE);
  });
  it.each([
    ['Invalid Date', { asOf: new Date('nope'), cpiIndex: CPI_FIXTURE }],
    ['asOf 가 Date 가 아님', { asOf: '2026-11-11' as unknown as Date, cpiIndex: CPI_FIXTURE }],
    ['표가 망가짐', { asOf: at('2026-11-11T14:00:00Z'), cpiIndex: CPI_FIXTURE, tables: { cpiReleaseSchedule: 42 as unknown as CpiReleaseRow[] } }],
    ['지수 접근이 던짐', {
      asOf: at('2026-11-11T14:00:00Z'),
      cpiIndex: new Proxy({}, { get() { throw new Error('boom'); }, getOwnPropertyDescriptor() { throw new Error('boom'); } }) as CpiIndexByMonth,
    }],
    ['입력 자체가 undefined', undefined as unknown as ClassifyMacroRegimeInput],
  ])('%s → 던지지 않고 unknown(internal_error)', (_d, input) => {
    let rec: MacroRegimeRecord | undefined;
    expect(() => { rec = classifyMacroRegime(input as ClassifyMacroRegimeInput); }).not.toThrow();
    expect(rec!.label).toBe('unknown');
    expect(rec!.reasonCodes).toEqual(['internal_error']);
    expect(rec!.isType5).toBe(false);
  });
});

describe('날짜 도우미', () => {
  it.each([
    // 서머타임 시작 2026-03-08 02:00 EST → 03:00 EDT
    ['2026-03-08T04:59:00Z', '2026-03-07'], // 23:59 EST
    ['2026-03-08T05:00:00Z', '2026-03-08'], // 00:00 EST
    ['2026-03-08T06:59:00Z', '2026-03-08'], // 01:59 EST
    ['2026-03-08T07:00:00Z', '2026-03-08'], // 03:00 EDT
    // 서머타임 끝 2026-11-01 02:00 EDT → 01:00 EST
    ['2026-11-01T03:59:00Z', '2026-10-31'], // 23:59 EDT
    ['2026-11-01T04:00:00Z', '2026-11-01'], // 00:00 EDT
    ['2026-11-02T04:59:00Z', '2026-11-01'], // 23:59 EST
    ['2026-11-02T05:00:00Z', '2026-11-02'], // 00:00 EST
  ])('etDateOf(%s) = %s', (iso, day) => {
    expect(etDateOf(at(iso))).toBe(day);
  });
  it.each([
    ['2026-08-31', '2026-02-28'],
    ['2024-08-31', '2024-02-29'],
    ['2026-01-15', '2025-07-15'],
    ['2026-12-31', '2026-06-30'],
    ['2009-06-16', '2008-12-16'],
  ])('minusCalendarMonths(%s, 6) = %s', (d, e) => {
    expect(minusCalendarMonths(d, 6)).toBe(e);
  });
  it('월 연산', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2025-12', 1)).toBe('2026-01');
    expect(addMonths('2026-10', -12)).toBe('2025-10');
    expect(monthDiff('2026-11', '2026-09')).toBe(2);
    expect(monthDiff('2026-01', '2025-10')).toBe(3);
    expect(isoSeconds(at('2026-01-02T03:04:05.678Z'))).toBe('2026-01-02T03:04:05Z');
  });
  it('기본 표는 동결돼 있다(런 사이 오염 방지)', () => {
    expect(Object.isFrozen(DEFAULT_MACRO_REGIME_TABLES)).toBe(true);
    expect(Object.isFrozen(DEFAULT_MACRO_REGIME_TABLES.fomcRows)).toBe(true);
    expect(Object.isFrozen(DEFAULT_MACRO_REGIME_TABLES.fomcRows[0])).toBe(true);
    expect(Object.isFrozen(DEFAULT_MACRO_REGIME_TABLES.cpiReleaseSchedule)).toBe(true);
    expect(Object.isFrozen(DEFAULT_MACRO_REGIME_TABLES.decisionDates)).toBe(true);
  });
});
