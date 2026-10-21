/**
 * T-059 Part A — XBRL 분기값 추출 규칙 고정.
 *
 * 픽스처 `fixtures/mu-companyfacts.sample.json` 은 Micron(CIK 723125) companyfacts 실응답(분석가가 2026-10-20 받은 원문)에서
 * 태그 5개·행 일부만 잘라 낸 발췌다(공개 SEC 데이터, 개인정보 없음).
 */
import fixture from './fixtures/mu-companyfacts.sample.json';
import {
  extractFramedFacts, pickConceptValue, isValidFramedPeriod, frameSequence, XBRL_CONCEPTS, FACT_FORMS,
} from '../xbrl-facts';
import { EdgarParseError } from '../parse';

const MU = 723125;
const rows = () => extractFramedFacts(JSON.parse(JSON.stringify(fixture)), MU);
const frames = (tag: string) => rows().filter((r) => r.tag === tag).map((r) => r.frame).sort();

describe('frame 이 있는 분기·연간·시점 값만 — YTD 누적 배제', () => {
  test('MU 매출: 6·9개월 누적(YTD) 행은 하나도 들어오지 않는다', () => {
    const rev = rows().filter((r) => r.tag === 'RevenueFromContractWithCustomerExcludingAssessedTax');
    // 픽스처의 YTD 원문: 2024-08-30~2025-02-27(16,762M)·2024-08-30~2025-05-29(26,063M)·2025-08-29~2026-02-26(37,503M)·~2026-05-28(78,959M)
    for (const ytd of [16762000000, 26063000000, 37503000000, 78959000000]) {
      expect(rev.some((r) => r.val === ytd)).toBe(false);
    }
    expect(rev.map((r) => r.frame).sort()).toEqual(['CY2018Q3', 'CY2025', 'CY2025Q1', 'CY2025Q2', 'CY2025Q4', 'CY2026', 'CY2026Q1', 'CY2026Q2']);
  });

  test('🔴 회계연도 4분기 단독 frame 은 없다 — CY2025Q3(MU FQ4 FY2025) 결측을 그대로 둔다(만들어 내지 않는다)', () => {
    expect(frames('EarningsPerShareDiluted')).toEqual(['CY2025', 'CY2025Q1', 'CY2025Q2', 'CY2025Q4', 'CY2026', 'CY2026Q1', 'CY2026Q2']);
    expect(rows().some((r) => r.frame === 'CY2025Q3')).toBe(false);
    // "최근 4개 분기 frame" 은 연속이 아니다 → 합산하면 TTM 이 아니다.
    const q = frames('EarningsPerShareDiluted').filter((f) => frameSequence(f) != null).slice(-4).map((f) => frameSequence(f)!);
    const contiguous = q.every((v, i) => i === 0 || v - q[i - 1] === 1);
    expect(contiguous).toBe(false);
  });

  test('frameSequence 는 분기 frame 만 번호를 준다', () => {
    expect(frameSequence('CY2025Q4')! - frameSequence('CY2025Q3')!).toBe(1);
    expect(frameSequence('CY2026Q1')! - frameSequence('CY2025Q4')!).toBe(1);
    expect(frameSequence('CY2025')).toBeNull();
    expect(frameSequence('CY2025Q4I')).toBeNull();
  });

  test('시점(…I) frame 은 start 가 없을 때만, 53주 회계연도(371일) 연간값은 통과', () => {
    const sh = rows().filter((r) => r.tag === 'EntityCommonStockSharesOutstanding');
    expect(sh.map((r) => r.frame).sort()).toEqual(['CY2026Q1I', 'CY2026Q2I', 'CY2026Q3I']);
    expect(sh.every((r) => r.periodStart === null && r.taxonomy === 'dei' && r.unit === 'shares')).toBe(true);
    const fy26 = rows().find((r) => r.tag === 'EarningsPerShareDiluted' && r.frame === 'CY2026')!;
    expect(fy26).toMatchObject({ periodStart: '2025-08-29', periodEnd: '2026-09-03', val: 74.33, form: '10-K' });
  });

  test('기간 길이 방어: frame 이 붙었어도 분기 70~110일·연간 340~390일 밖이면 버린다', () => {
    expect(isValidFramedPeriod('CY2026Q2', '2026-02-27', '2026-05-28')).toBe(true);    // 91일
    expect(isValidFramedPeriod('CY2026Q2', '2025-08-29', '2026-05-28')).toBe(false);   // 9개월 YTD
    expect(isValidFramedPeriod('CY2026', '2025-08-29', '2026-09-03')).toBe(true);      // 371일
    expect(isValidFramedPeriod('CY2026', '2026-02-27', '2026-05-28')).toBe(false);
    expect(isValidFramedPeriod('CY2026Q2I', null, '2026-05-28')).toBe(true);
    expect(isValidFramedPeriod('CY2026Q2I', '2026-02-27', '2026-05-28')).toBe(false);
    expect(isValidFramedPeriod('CY2026Q2', null, '2026-05-28')).toBe(false);
    expect(isValidFramedPeriod('FY2026', '2025-08-29', '2026-09-03')).toBe(false);     // 알 수 없는 frame 형식
  });
});

describe('🔴 양식 — 10-Q·10-K(+정정·20-F·40-F)만, 8-K 사실은 버린다', () => {
  test('MU SalesRevenueNet 의 8-K frame 행(2014·2017 제출)은 하나도 들어오지 않는다', () => {
    const src = (fixture as { facts: Record<string, Record<string, { units: Record<string, Array<{ form: string; frame?: string }>> }>> })
      .facts['us-gaap'].SalesRevenueNet.units.USD;
    expect(src.filter((x) => x.form === '8-K' && x.frame).length).toBeGreaterThan(0);   // 원문에는 있다
    const got = rows().filter((r) => r.tag === 'SalesRevenueNet');
    expect(got.length).toBeGreaterThan(0);
    expect(got.every((r) => r.form === '10-Q' || r.form === '10-K')).toBe(true);
    expect(FACT_FORMS.has('8-K')).toBe(false);
  });

  test('화이트리스트 밖 태그(AccountsPayableCurrent)는 넣지 않는다', () => {
    expect(rows().some((r) => r.tag === 'AccountsPayableCurrent')).toBe(false);
  });
});

describe('🔴 같은 (tag, unit, frame) 중복 — 가장 늦은 filed 하나만(정정 이력은 버린다)', () => {
  test('정정 공시가 같은 frame 을 다시 실으면 늦은 filed 값을 쓴다, 순서 무관', () => {
    const base = { start: '2026-02-27', end: '2026-05-28', fy: 2026, fp: 'Q3', frame: 'CY2026Q2' };
    const mk = (order: 'old-first' | 'new-first') => {
      const old = { ...base, val: 24.67, accn: '0000723125-26-000015', form: '10-Q', filed: '2026-06-25' };
      const amend = { ...base, val: 24.5, accn: '0000723125-26-000030', form: '10-Q/A', filed: '2026-08-01' };
      return {
        cik: MU,
        facts: { 'us-gaap': { EarningsPerShareDiluted: { units: { 'USD/shares': order === 'old-first' ? [old, amend] : [amend, old] } } } },
      };
    };
    for (const o of ['old-first', 'new-first'] as const) {
      const r = extractFramedFacts(mk(o), MU);
      expect(r).toHaveLength(1);
      expect(r[0]).toMatchObject({ val: 24.5, filed: '2026-08-01', accn: '0000723125-26-000030', form: '10-Q/A' });
    }
  });

  test('같은 filed 면 accn 이 큰 쪽(나중 접수) 하나', () => {
    const base = { start: '2026-02-27', end: '2026-05-28', frame: 'CY2026Q2', form: '10-Q', filed: '2026-06-25' };
    const j = { cik: MU, facts: { 'us-gaap': { NetIncomeLoss: { units: { USD: [
      { ...base, val: 1, accn: '0000723125-26-000016' }, { ...base, val: 2, accn: '0000723125-26-000015' },
    ] } } } } };
    expect(extractFramedFacts(j, MU).map((r) => r.val)).toEqual([1]);
  });
});

describe('🔴 매출 대체 태그 선택 규칙 (frame 마다 우선순위 첫 번째, 합산·평균 없음)', () => {
  test('우선순위 목록이 고정돼 있다', () => {
    expect(XBRL_CONCEPTS.revenue.tags).toEqual([
      'us-gaap:Revenues',
      'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax',
      'us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax',
      'us-gaap:SalesRevenueNet',
      'ifrs-full:Revenue',
    ]);
  });

  test('MU: 2018 이전 Revenues 가 있으면 그것, 이후(Revenues 없음)는 RevenueFromContract…', () => {
    const r = rows();
    expect(pickConceptValue(r, 'revenue', 'CY2018Q3')?.tag).toBe('us-gaap:Revenues');   // 두 태그 모두 있는 frame
    expect(pickConceptValue(r, 'revenue', 'CY2026Q2')).toMatchObject({
      tag: 'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax', val: 41456000000, unit: 'USD',
    });
    expect(pickConceptValue(r, 'revenue', 'CY2018Q1')?.tag).toBe('us-gaap:Revenues');
  });

  test('Revenues·RFCC 가 없고 SalesRevenueNet 만 있는 frame 은 SalesRevenueNet', () => {
    const only = rows().filter((x) => x.tag === 'SalesRevenueNet');
    const f = only[0].frame;
    expect(pickConceptValue(only, 'revenue', f)?.tag).toBe('us-gaap:SalesRevenueNet');
  });

  test('없으면 null — 0 이나 다른 frame 값으로 채우지 않는다', () => {
    expect(pickConceptValue(rows(), 'revenue', 'CY2025Q3')).toBeNull();
    expect(pickConceptValue(rows(), 'eps_diluted', 'CY2025Q3')).toBeNull();
    expect(pickConceptValue([], 'revenue', 'CY2026Q2')).toBeNull();
  });
});

describe('최상위 형식 이상은 던진다(종목 격리는 호출부)', () => {
  test.each([
    ['null', null],
    ['cik 불일치', { cik: 1, facts: {} }],
    ['facts 없음', { cik: MU }],
  ])('%s', (_n, j) => {
    expect(() => extractFramedFacts(j, MU)).toThrow(EdgarParseError);
  });

  test('개별 사실 형식 이상(val 문자열·accn 없음)은 그 사실만 버린다', () => {
    const j = { cik: MU, facts: { 'us-gaap': { NetIncomeLoss: { units: { USD: [
      { start: '2026-02-27', end: '2026-05-28', frame: 'CY2026Q2', val: '123', accn: '0000723125-26-000015', form: '10-Q', filed: '2026-06-25' },
      { start: '2026-02-27', end: '2026-05-28', frame: 'CY2026Q2', val: 5, form: '10-Q', filed: '2026-06-25' },
      { start: '2025-11-28', end: '2026-02-26', frame: 'CY2026Q1', val: 7, accn: '0000723125-26-000006', form: '10-Q', filed: '2026-03-19' },
    ] } } } } };
    expect(extractFramedFacts(j, MU).map((r) => r.frame)).toEqual(['CY2026Q1']);
  });
});
