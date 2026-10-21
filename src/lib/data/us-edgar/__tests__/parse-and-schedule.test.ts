/**
 * T-059 Part A — company_tickers·submissions 파서, 8-K Item 2.02 추출, 실적 창(±7일) 추정 규칙 고정.
 * 픽스처: `fixtures/intc-submissions.sample.json`(Intel 실응답 2026-10-21 발췌 33행), `fixtures/company-tickers.sample.json`(8건 발췌).
 */
import subFixture from './fixtures/intc-submissions.sample.json';
import tickersFixture from './fixtures/company-tickers.sample.json';
import {
  parseCompanyTickers, toSecTicker, parseSubmissions, extractEarningsReleaseDates, hasItem202, EdgarParseError,
  addDays, daysBetween, etDateString,
} from '../parse';
import { estimateNextEarningsWindow, ESTIMATE_HALF_WINDOW_DAYS } from '../earnings-schedule';

const INTC = 50863;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe('company_tickers', () => {
  test('티커 → CIK, 클래스주는 SEC 표기(BRK-B)로 찾는다', () => {
    const m = parseCompanyTickers(clone(tickersFixture));
    expect(m.get('INTC')?.cik).toBe(INTC);
    expect(m.get(toSecTicker('NYS:BRK.B')!)?.cik).toBe(1067983);
    expect(m.get('GOOG')?.cik).toBe(m.get('GOOGL')?.cik);           // 같은 CIK 를 공유
    expect(m.get(toSecTicker('NAS:SMH')!)).toBeUndefined();        // ETF 는 없다 → 호출부가 unmapped 로 건너뜀
  });
  test('국내 심볼은 SEC 티커가 없다', () => {
    expect(toSecTicker('005930')).toBeNull();
  });
  test('빈 객체·배열·유효 항목 0개는 던진다(빈 매핑으로 덮지 않게)', () => {
    expect(() => parseCompanyTickers({})).toThrow(EdgarParseError);
    expect(() => parseCompanyTickers([])).toThrow(EdgarParseError);
    expect(() => parseCompanyTickers({ 0: { cik_str: 'x', ticker: '' } })).toThrow(EdgarParseError);
  });
});

describe('submissions → 8-K Item 2.02', () => {
  test('필요 양식만 남기고 Form 4 는 버린다, 2.02 판정은 정확히 "2.02" 항목', () => {
    const p = parseSubmissions(clone(subFixture), INTC);
    expect(p.entityType).toBe('operating');
    expect(p.filings.some((f) => f.form === '4')).toBe(false);
    expect(p.filings.every((f) => /^\d{10}-\d{2}-\d{6}$/.test(f.accession))).toBe(true);
    expect(hasItem202('2.02,9.01')).toBe(true);
    expect(hasItem202('12.02,9.01')).toBe(false);
    expect(hasItem202('2.05,9.01')).toBe(false);
    const latest = p.filings.find((f) => f.accession === '0000050863-26-000155')!;
    expect(latest).toMatchObject({
      form: '8-K', isEarningsRelease: true, filed: '2026-07-23', acceptedAtUtc: '2026-07-23T20:09:00.000Z',
      primaryDocUrl: 'https://www.sec.gov/Archives/edgar/data/50863/000005086326000155/intc-20260723.htm',
    });
  });

  test('발표일은 filingDate — reportDate 가 다른 사건일로 앞당겨진 8-K(2024-10-28 → 실제 발표 10-31)', () => {
    const p = parseSubmissions(clone(subFixture), INTC);
    const rel = extractEarningsReleaseDates(p.filings);
    expect(rel).toContain('2024-10-31');
    expect(rel).not.toContain('2024-10-28');
    expect(rel.slice(-4)).toEqual(['2025-10-23', '2026-01-22', '2026-04-23', '2026-07-23']);
  });

  test('21일 안 예비 실적 + 정식 발표는 나중 것 하나 (INTC 2021-01-14 예비 → 2021-01-21)', () => {
    const p = parseSubmissions(clone(subFixture), INTC);
    const rel = extractEarningsReleaseDates(p.filings);
    expect(rel).toContain('2021-01-21');
    expect(rel).not.toContain('2021-01-14');
  });

  test('8-K/A(정정)는 발표일이 아니다', () => {
    const p = parseSubmissions(clone(subFixture), INTC);
    const amended = { ...p.filings[0], accession: '0000050863-26-000999', form: '8-K/A', items: '2.02', filed: '2026-08-15', isEarningsRelease: false };
    expect(extractEarningsReleaseDates([...p.filings, amended])).not.toContain('2026-08-15');
  });

  test('형식 이상: cik 불일치·recent 없음·배열 길이 불일치는 던진다', () => {
    expect(() => parseSubmissions(clone(subFixture), 1)).toThrow(EdgarParseError);
    const a = clone(subFixture) as { filings: { recent?: Record<string, unknown[]> } };
    delete a.filings.recent;
    expect(() => parseSubmissions(a, INTC)).toThrow(EdgarParseError);
    const b = clone(subFixture) as { filings: { recent: Record<string, unknown[]> } };
    b.filings.recent.items.pop();
    expect(() => parseSubmissions(b, INTC)).toThrow(/길이 불일치/);
  });

  test('개별 행 형식 이상(accession·filingDate)은 그 행만 버린다', () => {
    const b = clone(subFixture) as { filings: { recent: Record<string, unknown[]> } };
    const n = b.filings.recent.form.length;
    const i = b.filings.recent.form.findIndex((f) => f === '8-K');
    b.filings.recent.filingDate[i] = 'not-a-date';
    const p = parseSubmissions(b, INTC);
    expect(p.filings.length).toBeLessThan(n);
    expect(p.filings.length).toBeGreaterThan(0);
  });
});

describe('🔴 실적 창 추정 — 날짜를 단정하지 않는다(±7일 창만)', () => {
  test('INTC: 4분기 전 발표(2025-10-23)+364일 중심, 창 10-15~10-29 — 실제 공식 일정 10-29(T-057 §4)가 창 안', () => {
    const rel = extractEarningsReleaseDates(parseSubmissions(clone(subFixture), INTC).filings);
    const e = estimateNextEarningsWindow(rel, '2026-10-21');
    expect(e).toEqual({
      ok: true,
      fiscalPeriod: 'after-2026-07-23',
      windowStart: '2026-10-15',
      windowEnd: '2026-10-29',
      basis: { method: 'yoy_364d', anchor: '2025-10-23', latest: '2026-07-23', releasesUsed: 4 },
    });
    // 결과 어디에도 단일 날짜 필드가 없다
    expect(Object.keys(e)).not.toContain('eventDate');
    if (e.ok) expect(daysBetween(e.windowStart, e.windowEnd)).toBe(2 * ESTIMATE_HALF_WINDOW_DAYS);
  });

  test('364일은 요일을 보존한다', () => {
    const d = new Date('2025-10-23T12:00:00Z').getUTCDay();
    expect(new Date(`${addDays('2025-10-23', 364)}T12:00:00Z`).getUTCDay()).toBe(d);
  });

  test('발표 2~3건이면 직전 + 91일', () => {
    const e = estimateNextEarningsWindow(['2026-01-22', '2026-04-23', '2026-07-23'], '2026-08-01');
    expect(e).toMatchObject({ ok: true, windowStart: addDays('2026-07-23', 84), windowEnd: addDays('2026-07-23', 98) });
    if (e.ok) expect(e.basis.method).toBe('last_plus_91d');
  });

  test('주기가 분기와 안 맞으면(4분기 전 + 364 가 직전 + 60~120일 밖) 직전 + 91일로', () => {
    // 최근 4건이 한 달 간격(비정상) → r3+364 는 r0+60~120 밖
    const e = estimateNextEarningsWindow(['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01'], '2026-07-02');
    expect(e.ok && e.basis.method).toBe('last_plus_91d');
  });

  test('발표 1건 이하 → 추정 안 함', () => {
    expect(estimateNextEarningsWindow([], '2026-10-21')).toMatchObject({ ok: false, reason: 'insufficient_history' });
    expect(estimateNextEarningsWindow(['2026-07-23'], '2026-10-21')).toMatchObject({ ok: false, reason: 'insufficient_history' });
  });

  test('창 끝이 오늘보다 앞이면 추정 안 함(window_passed) — 창 끝 당일은 유효', () => {
    const rel = ['2025-10-23', '2026-01-22', '2026-04-23', '2026-07-23'];
    expect(estimateNextEarningsWindow(rel, '2026-10-29').ok).toBe(true);
    expect(estimateNextEarningsWindow(rel, '2026-10-30')).toMatchObject({ ok: false, reason: 'window_passed' });
  });

  test('etDateString — KST 오전은 미국 동부 전날', () => {
    expect(etDateString(new Date('2026-10-21T22:00:00Z'))).toBe('2026-10-21');   // KST 10-22 07:00
    expect(etDateString(new Date('2026-10-22T03:59:00Z'))).toBe('2026-10-21');   // EDT 23:59
    expect(etDateString(new Date('2026-12-01T04:59:00Z'))).toBe('2026-11-30');   // EST 23:59
  });
});
