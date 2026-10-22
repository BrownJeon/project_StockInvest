/**
 * T-070 연속조회 — 커서 이동·종료 조건(reached·exhausted·no_progress·page_cap·budget·error)·중복 제거.
 */
import { paginateDaily, type PaginateOptions } from '../daily-bars-paginate';
import { fakeMarket, makeBars } from './fake-bars-db';

const US = makeBars('2023-01-02', '2026-10-21');   // 약 994 평일

function opts(extra: Partial<PaginateOptions> & Pick<PaginateOptions, 'fetchPage'>): PaginateOptions {
  return {
    market: 'US', symbol: 'NAS:MU', adjMode: 'adjusted', startCursor: null, stopAt: '2025-10-22',
    maxPages: 20, takeCall: () => true, ...extra,
  };
}

describe('paginateDaily', () => {
  test('해외: 100행 페이지를 BYMD = 받은 가장 오래된 날 − 1일로 넘기며 stopAt 에 닿으면 끝(reached)', async () => {
    const m = fakeMarket({ 'NAS:MU': US });
    const r = await paginateDaily(opts({ fetchPage: m.fetchPage }));
    expect(r.reason).toBe('reached');
    expect(m.requests.map((x) => x.endDate)).toEqual([null, '2026-06-03', '2026-01-14'])   // 평일 100개 = 정확히 20주;
    expect(r.calls).toBe(3);
    expect(r.rowsPerCall).toEqual([100, 100, 100]);
    expect(r.merge.bars).toHaveLength(300);
    expect(r.merge.duplicates).toBe(0);
    expect(r.merge.bars[0].tradeDate <= '2025-10-22').toBe(true);
    expect(r.merge.bars[r.merge.bars.length - 1].tradeDate).toBe('2026-10-21');
  });

  test('겹치는 페이지(KIS 가 BYMD 를 포함해 돌려줌)는 날짜당 1행으로 합친다', async () => {
    const m = fakeMarket({ 'NAS:MU': US });
    const overlapping: PaginateOptions['fetchPage'] = async (req) => {
      const p = await m.fetchPage({ ...req, endDate: req.endDate ? addOne(req.endDate) : null });
      return p;
    };
    const r = await paginateDaily(opts({ fetchPage: overlapping }));
    expect(r.merge.duplicates).toBeGreaterThan(0);
    const dates = r.merge.bars.map((b) => b.tradeDate);
    expect(new Set(dates).size).toBe(dates.length);
  });

  test('(R-1b) satisfiedAt: 하한이 stopAt 에 못 가도 연속성 기준일 이하이면 reached', async () => {
    const m = fakeMarket({ 'NAS:NEW': makeBars('2026-10-14', '2026-10-21') });
    const r = await paginateDaily(opts({ fetchPage: m.fetchPage, symbol: 'NAS:NEW', stopAt: '2026-10-11', satisfiedAt: '2026-10-16', maxPages: 4 }));
    expect(r).toMatchObject({ reason: 'reached', calls: 1 });
    const r2 = await paginateDaily(opts({ fetchPage: m.fetchPage, symbol: 'NAS:NEW', stopAt: '2026-10-11', maxPages: 4 }));
    expect(r2.reason).toBe('exhausted');            // 기준일 없이 부르면 상장 이전까지 내려가 빈 페이지
    expect(r2.calls).toBe(2);
  });

  test('빈 페이지 = 상장 이전(exhausted)', async () => {
    const m = fakeMarket({ 'NAS:NEW': makeBars('2026-06-01', '2026-10-21') });
    const r = await paginateDaily(opts({ fetchPage: m.fetchPage, symbol: 'NAS:NEW' }));
    expect(r.reason).toBe('exhausted');
    expect(r.merge.bars[0].tradeDate).toBe('2026-06-01');
    expect(r.calls).toBe(3);   // 100행 + 나머지 + 빈 페이지
  });

  test('커서를 무시하는 응답은 no_progress 로 멈춘다(무한 루프 방지)', async () => {
    const m = fakeMarket({ 'NAS:MU': US }, { ignoreCursor: true });
    const r = await paginateDaily(opts({ fetchPage: m.fetchPage }));
    expect(r.reason).toBe('no_progress');
    expect(r.calls).toBe(2);
  });

  test('페이지 상한(page_cap)', async () => {
    const m = fakeMarket({ 'NAS:MU': US }, { pageSize: 10 });
    const r = await paginateDaily(opts({ fetchPage: m.fetchPage, maxPages: 4 }));
    expect(r.reason).toBe('page_cap');
    expect(r.calls).toBe(4);
  });

  test('예산 소진(budget) — 호출하지 않고 끝내며 그때까지 받은 행을 돌려준다', async () => {
    const m = fakeMarket({ 'NAS:MU': US });
    let left = 2;
    const r = await paginateDaily(opts({ fetchPage: m.fetchPage, takeCall: () => (left-- > 0) }));
    expect(r.reason).toBe('budget');
    expect(r.calls).toBe(2);
    expect(r.merge.bars).toHaveLength(200);
  });

  test('조회 실패(error) — 오류와 그때까지의 행을 돌려준다', async () => {
    const m = fakeMarket({ 'NAS:MU': US });
    let n = 0;
    const boom = new Error('kis 500');
    const r = await paginateDaily(opts({ fetchPage: async (req) => { if (n++ === 1) throw boom; return m.fetchPage(req); } }));
    expect(r.reason).toBe('error');
    expect(r.error).toBe(boom);
    expect(r.merge.bars).toHaveLength(100);
    expect(r.calls).toBe(2);
  });

  test('국내: 요청 기간 시작일(coveredFrom)로 하한을 잡아 다음 기간으로 넘어간다', async () => {
    const KR = makeBars('2023-01-02', '2026-10-22');
    const m = fakeMarket({ '005930': KR }, { today: '2026-10-22' });
    const r = await paginateDaily(opts({ fetchPage: m.fetchPage, market: 'KR', symbol: '005930', stopAt: '2025-10-22' }));
    expect(r.reason).toBe('reached');
    expect(m.requests.map((x) => x.endDate)).toEqual([null, '2026-06-04', '2026-01-15']);
    expect(r.coveredFloor).toBe('2025-10-22');
    // 기간이 이어져 빠진 평일이 없다
    const expected = KR.filter((b) => b.tradeDate >= '2025-10-22').length;
    expect(r.merge.bars).toHaveLength(expected);
  });
});

function addOne(d: string): string {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
}
