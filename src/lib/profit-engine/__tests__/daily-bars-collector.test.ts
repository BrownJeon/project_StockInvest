/**
 * T-070 수집기 — 백필·증분·재개·멱등 upsert·조정 변경 재수집·품질 게이트·중단 조건·쓰기 대상(daily_bars 하나).
 * 실제 DB·KIS 호출 없음: 가짜 DB(코드의 실제 upsert SQL 해석)와 합성 시장 데이터만 쓴다.
 */
jest.mock('@/lib/exchanges/kis-http', () => ({
  kisFetch: () => { throw new Error('시험에서 실제 KIS 호출 금지'); },
  isKisRateLimited: () => false,
}));
jest.mock('@/lib/exchanges/kis-auth', () => ({
  getKisToken: () => { throw new Error('시험에서 토큰 조회 금지'); },
  kisBaseUrl: () => 'https://kis.example',
}));
jest.mock('@/lib/credentials', () => ({ getCredential: async () => 'x' }));

import { __resetDailyBarsLockForTest, DEFAULT_GAP_MS, runDailyBarsCollect, type CollectDeps } from '../daily-bars-collector';
import { KisDailyError, type FetchDailyPage } from '../daily-bars-kis';
import { DAILY_BARS_UPSERT_SQL, upsertBars, type Queryable } from '../daily-bars-store';
import { findGaps } from '../daily-bars-quality';
import type { RawBar } from '../daily-bars-quality';
import { FakeBarsDb, fakeMarket, makeBars, type Row } from './fake-bars-db';

/** KST 'YYYY-MM-DD HH:MM' */
const kst = (s: string) => new Date(`${s.replace(' ', 'T')}:00+09:00`);
const NOW = kst('2026-10-22 21:00');          // 미국 ET 10-22 08:00 → 최근 확정 10-21, 국내 10-22 확정
const NEXT = kst('2026-10-24 06:10');         // 미국 ET 10-23 17:10 → 10-23 확정
const US_DATA = () => makeBars('2022-01-03', '2026-10-21');

function deps(db: FakeBarsDb, fetchPage: FetchDailyPage, extra: Partial<CollectDeps> = {}): CollectDeps {
  return { db: db as unknown as Queryable, fetchPage, now: () => NOW, sleep: async () => {}, gapMs: 0, log: () => {}, ...extra };
}
const strip = (rows: Row[]) => rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'fetched_at')));
const closesOf = (rows: Row[]) => Object.fromEntries(rows.map((r) => [r.trade_date, r.close]));

beforeEach(() => __resetDailyBarsLockForTest());

describe('테이블 미적용', () => {
  test('daily_bars 가 없으면 KIS 호출 0 으로 건너뛴다', async () => {
    const db = new FakeBarsDb();
    db.tables.clear();
    const fetchPage = jest.fn();
    const r = await runDailyBarsCollect(deps(db, fetchPage), { symbols: ['NAS:MU'] });
    expect(r).toEqual({ ok: true, skipped: 'tables_missing', missing: ['daily_bars'] });
    expect(fetchPage).not.toHaveBeenCalled();
  });
});

describe('백필 → 증분 → 멱등', () => {
  test('신규 종목 1년 백필: USD 원값·adjusted·확정·출처·KST 시각', async () => {
    const db = new FakeBarsDb();
    const m = fakeMarket({ 'NAS:MU': US_DATA() });
    const r = await runDailyBarsCollect(deps(db, m.fetchPage), { symbols: ['NAS:MU'], years: 1 });
    expect(r.ok).toBe(true);
    expect(r.symbols![0]).toMatchObject({ symbol: 'NAS:MU', market: 'US', modes: ['backfill'], status: 'done', reasons: ['reached'], calls: 3 });
    const rows = db.rows('US', 'NAS:MU');
    expect(rows).toHaveLength(300);                                         // 데이터셋 하한(reached)이라 가장 오래된 봉도 쓴다
    expect(String(rows[0].trade_date) <= '2025-10-22').toBe(true);
    expect(rows[rows.length - 1].trade_date).toBe('2026-10-21');
    const src = Object.fromEntries(US_DATA().map((b) => [b.tradeDate, b.close]));
    for (const row of rows) {
      expect(row).toMatchObject({ currency: 'USD', adj_mode: 'adjusted', is_final: 1, flags: null, source: 'kis_dailyprice', fetched_at: '2026-10-22 21:00:00' });
      expect(row.close).toBe(src[String(row.trade_date)]);                  // 환산 없음
    }
    expect(m.requests.every((q) => q.adjMode === 'adjusted')).toBe(true);
  });

  test('이미 최신·완료면 호출 0, 다음 날 증분은 1호출로 새 봉만 더하고 겹침 비교', async () => {
    const db = new FakeBarsDb();
    const m = fakeMarket({ 'NAS:MU': US_DATA() });
    await runDailyBarsCollect(deps(db, m.fetchPage), { symbols: ['NAS:MU'], years: 1 });
    const before = strip(db.rows());
    const again = await runDailyBarsCollect(deps(db, m.fetchPage), { symbols: ['NAS:MU'], years: 1 });
    expect(again.symbols![0]).toMatchObject({ modes: ['up_to_date'], status: 'skipped', calls: 0 });
    expect(strip(db.rows())).toEqual(before);

    m.data.set('NAS:MU', makeBars('2022-01-03', '2026-10-23'));
    const inc = await runDailyBarsCollect(deps(db, m.fetchPage, { now: () => NEXT }), { symbols: ['NAS:MU'], years: 1 });
    expect(inc.symbols![0]).toMatchObject({ modes: ['incremental'], status: 'done', calls: 1 });
    expect(inc.symbols![0].adjChange!.compared).toBeGreaterThan(5);
    expect(inc.symbols![0].adjChange!.mismatches).toBe(0);
    expect(db.rows()).toHaveLength(302);
  });

  test('멱등: 같은 데이터로 증분을 다시 돌려도(휴장일 헛호출) 행은 그대로', async () => {
    const db = new FakeBarsDb();
    const m = fakeMarket({ 'NAS:MU': US_DATA() });
    await runDailyBarsCollect(deps(db, m.fetchPage), { symbols: ['NAS:MU'], years: 1 });
    const before = strip(db.rows());
    // 다음 날이지만 새 봉이 없다(공휴일) → 증분 호출은 하지만 결과가 같아야 한다
    const r1 = await runDailyBarsCollect(deps(db, m.fetchPage, { now: () => NEXT }), { symbols: ['NAS:MU'], years: 1 });
    const r2 = await runDailyBarsCollect(deps(db, m.fetchPage, { now: () => NEXT }), { symbols: ['NAS:MU'], years: 1 });
    expect(r1.symbols![0].calls).toBe(1);
    expect(r2.symbols![0].calls).toBe(1);
    expect(strip(db.rows())).toEqual(before);
  });
});

describe('예산 초과 시 중단·재개', () => {
  test('호출 예산 2로 나눠 돌려도 한 번에 받은 결과와 같다(가장 오래된 봉은 다음에 다시 받음)', async () => {
    const full = new FakeBarsDb();
    await runDailyBarsCollect(deps(full, fakeMarket({ 'NAS:MU': US_DATA() }).fetchPage), { symbols: ['NAS:MU'], years: 3 });

    const db = new FakeBarsDb();
    const m = fakeMarket({ 'NAS:MU': US_DATA() });
    const first = await runDailyBarsCollect(deps(db, m.fetchPage), { symbols: ['NAS:MU'], years: 3, maxCalls: 2 });
    expect(first.symbols![0]).toMatchObject({ status: 'partial', reasons: ['budget'], calls: 2, written: 199 });
    expect(first.remaining).toEqual(['NAS:MU']);
    expect(first.budget).toMatchObject({ maxCalls: 2, calls: 2, exhausted: true });
    const minAfterFirst = String(db.rows()[0].trade_date);

    let runs = 1;
    let last = first;
    while (last.remaining!.length && runs < 20) {
      m.requests.length = 0;
      last = await runDailyBarsCollect(deps(db, m.fetchPage), { symbols: ['NAS:MU'], years: 3, maxCalls: 2 });
      if (runs === 1) {
        expect(last.symbols![0].modes).toEqual(['backfill_continue']);
        // 저장된 MIN 의 전날부터 이어 간다
        const d = new Date(`${minAfterFirst}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1);
        expect(m.requests[0].endDate).toBe(d.toISOString().slice(0, 10));
      }
      runs++;
    }
    expect(last.remaining).toEqual([]);
    // 페이지 경계가 달라 하한 너머로 더 받은 행 수는 다를 수 있다 — 3년 하한(2023-10-23)까지 덮었고, 겹치는 구간은 행 단위로 같아야 한다
    const minSplit = String(db.rows()[0].trade_date);
    expect(minSplit <= '2023-10-23').toBe(true);
    expect(strip(db.rows())).toEqual(strip(full.rows().filter((x) => String(x.trade_date) >= minSplit)));
  });

  test('시간 예산(maxMs)도 호출 전에 확인한다', async () => {
    const db = new FakeBarsDb();
    const m = fakeMarket({ 'NAS:MU': US_DATA() });
    let t = NOW.getTime();
    const fetchPage: FetchDailyPage = async (req) => { t += 30_000; return m.fetchPage(req); };
    const r = await runDailyBarsCollect(deps(db, fetchPage, { now: () => new Date(t), maxMs: 100_000 }), { symbols: ['NAS:MU'], years: 5 });
    expect(r.budget).toMatchObject({ calls: 4, exhausted: true });
    expect(r.symbols![0].status).toBe('partial');
  });

  test('여러 종목: 예산이 다하면 남은 종목을 remaining 으로 돌려준다', async () => {
    const db = new FakeBarsDb();
    const m = fakeMarket({ 'NAS:AAA': US_DATA(), 'NAS:BBB': US_DATA(), 'NAS:CCC': US_DATA() });
    const r = await runDailyBarsCollect(deps(db, m.fetchPage), { symbols: ['NAS:AAA', 'NAS:BBB', 'NAS:CCC'], years: 1, maxCalls: 4 });
    expect(r.symbols!.map((s) => [s.symbol, s.status])).toEqual([['NAS:AAA', 'done'], ['NAS:BBB', 'partial']]);
    expect(r.remaining).toEqual(['NAS:BBB', 'NAS:CCC']);
  });
});

describe('(R-1) 오래된 MAX 증분 — 예산이 작아도 영구 결측이 생기지 않는다', () => {
  test('MAX 가 6개월 전 + maxCalls=1: 저장분과 이어진 칸만 쓰고, 다음 실행들이 새 MAX 에서 이어 받아 빈틈 없이 끝난다', async () => {
    const db = new FakeBarsDb();
    const m = fakeMarket({ 'NAS:MU': makeBars('2022-01-03', '2026-04-21') });
    await runDailyBarsCollect(deps(db, m.fetchPage, { now: () => kst('2026-04-22 21:00') }), { symbols: ['NAS:MU'], years: 1 });
    expect(db.rows().slice(-1)[0].trade_date).toBe('2026-04-21');
    m.data.set('NAS:MU', US_DATA());
    const contiguous = () => {
      const rows = db.rows();
      const want = US_DATA().filter((b) => b.tradeDate >= String(rows[0].trade_date) && b.tradeDate <= String(rows[rows.length - 1].trade_date));
      return rows.map((x) => x.trade_date).join() === want.map((b) => b.tradeDate).join();
    };
    const r1 = await runDailyBarsCollect(deps(db, m.fetchPage), { symbols: ['NAS:MU'], years: 1, maxCalls: 1 });
    expect(r1.symbols![0]).toMatchObject({ modes: ['incremental'], status: 'partial', calls: 1 });
    expect(m.requests.slice(-1)[0].endDate).toBe('2026-08-19');          // 04-21 + 120일 — 앞으로 한 칸
    expect(String(db.rows().slice(-1)[0].trade_date) < '2026-10-21').toBe(true);
    expect(contiguous()).toBe(true);                                       // 구멍 없음
    expect(r1.symbols![0].quality!.storedGaps).toBe(0);
    let last = r1;
    for (let i = 0; i < 5 && last.remaining!.length; i++) {
      last = await runDailyBarsCollect(deps(db, m.fetchPage), { symbols: ['NAS:MU'], years: 1, maxCalls: 1 });
      expect(contiguous()).toBe(true);
    }
    expect(db.rows().slice(-1)[0].trade_date).toBe('2026-10-21');
    expect(findGaps(db.rows().map((x) => ({ tradeDate: String(x.trade_date) })))).toEqual([]);
    const done = await runDailyBarsCollect(deps(db, m.fetchPage), { symbols: ['NAS:MU'], years: 1 });
    expect(done.symbols![0].modes).toEqual(['up_to_date']);
  });

  test('저장분까지 닿지 않은(이어졌는지 모르는) 증분 페이지는 쓰지 않는다 — 커서를 무시하는 응답', async () => {
    const db = new FakeBarsDb();
    const m = fakeMarket({ 'NAS:MU': makeBars('2022-01-03', '2026-04-21') });
    await runDailyBarsCollect(deps(db, m.fetchPage, { now: () => kst('2026-04-22 21:00') }), { symbols: ['NAS:MU'], years: 1 });
    const before = strip(db.rows());
    const broken = fakeMarket({ 'NAS:MU': US_DATA() }, { ignoreCursor: true });   // 늘 최신 100행만 — 기준일(04-21)에 못 닿는다
    const r = await runDailyBarsCollect(deps(db, broken.fetchPage), { symbols: ['NAS:MU'], years: 1 });
    expect(r.symbols![0]).toMatchObject({ status: 'partial', error: 'incremental_not_contiguous:no_progress' });
    expect(strip(db.rows())).toEqual(before);
  });

  test('칸당 4장으로도 기준일에 못 닿으면(호출당 10행) 쓰지 않는다 — page_cap', async () => {
    const db = new FakeBarsDb();
    const m = fakeMarket({ 'NAS:MU': makeBars('2022-01-03', '2026-04-21') });
    await runDailyBarsCollect(deps(db, m.fetchPage, { now: () => kst('2026-04-22 21:00') }), { symbols: ['NAS:MU'], years: 1 });
    const before = strip(db.rows());
    const tiny = fakeMarket({ 'NAS:MU': US_DATA() }, { pageSize: 10 });
    const r = await runDailyBarsCollect(deps(db, tiny.fetchPage), { symbols: ['NAS:MU'], years: 1 });
    expect(r.symbols![0]).toMatchObject({ status: 'partial', calls: 4, error: 'incremental_not_contiguous:page_cap' });
    expect(strip(db.rows())).toEqual(before);
  });

  test('(T-1) 한 실행 안에서 여러 칸을 앞으로 돈다 — 14개월 빈틈을 칸 수만큼의 호출로 끝낸다', async () => {
    const db = new FakeBarsDb();
    const m = fakeMarket({ 'NAS:MU': makeBars('2022-01-03', '2025-08-20') });
    await runDailyBarsCollect(deps(db, m.fetchPage, { now: () => kst('2025-08-21 21:00') }), { symbols: ['NAS:MU'], years: 1 });
    m.data.set('NAS:MU', US_DATA());
    m.requests.length = 0;
    const r = await runDailyBarsCollect(deps(db, m.fetchPage), { symbols: ['NAS:MU'], years: 1 });
    expect(r.symbols![0]).toMatchObject({ modes: ['incremental'], status: 'done' });
    expect(r.symbols![0].calls).toBe(4);                                  // 2025-08-20 → +120일 ×3 → 오늘 칸
    expect(m.requests.map((q) => q.endDate)).toEqual(['2025-12-18', '2026-04-17', '2026-08-15', null]);
    expect(db.rows().slice(-1)[0].trade_date).toBe('2026-10-21');
    expect(findGaps(db.rows().map((x) => ({ tradeDate: String(x.trade_date) })))).toEqual([]);
    expect(r.symbols![0].quality!.storedGaps).toBe(0);
  });

  test('(T-099 F1) 여러 칸 + 첫 칸 겹침의 최신 저장 봉만 잠정값 → 재수집 없이 마지막 칸까지 이어 가고 adjChange 를 누적', async () => {
    const db = new FakeBarsDb();
    const m = fakeMarket({ 'NAS:MU': makeBars('2022-01-03', '2025-08-20') });
    await runDailyBarsCollect(deps(db, m.fetchPage, { now: () => kst('2025-08-21 21:00') }), { symbols: ['NAS:MU'], years: 1 });
    const latest = db.rows().find((x) => x.trade_date === '2025-08-20')!;
    const finalClose = latest.close;
    latest.close = Math.round((Number(finalClose) - 0.5) * 10000) / 10000;  // 첫 칸 겹침의 최신 저장 봉 = 잠정값
    m.data.set('NAS:MU', US_DATA());
    m.requests.length = 0;
    const r = await runDailyBarsCollect(deps(db, m.fetchPage), { symbols: ['NAS:MU'], years: 1 });
    expect(r.symbols![0]).toMatchObject({ modes: ['incremental'], status: 'done', calls: 4 });   // 재수집 없음, 칸 수만큼
    expect(m.requests.map((q) => q.endDate)).toEqual(['2025-12-18', '2026-04-17', '2026-08-15', null]);
    // 첫 칸 8개(그중 최신 1개 불일치) + 뒤 칸 겹침 26개(전부 일치) — 칸마다 누적
    expect(r.symbols![0].adjChange).toEqual({ compared: 34, mismatches: 1, settling: 1 });
    expect(db.rows().filter((x) => x.flags !== null)).toEqual([]);
    expect(db.rows().find((x) => x.trade_date === '2025-08-20')!.close).toBe(finalClose);
    expect(db.rows().slice(-1)[0].trade_date).toBe('2026-10-21');           // 마지막 칸까지 도달
    expect(findGaps(db.rows().map((x) => ({ tradeDate: String(x.trade_date) })))).toEqual([]);
  });

  test('(T-099 F1) 첫 칸과 둘째 칸 모두 정착 중 불일치 → settling 이 칸마다 더해져 2(덮어쓰기 아님)', async () => {
    const db = new FakeBarsDb();
    const m = fakeMarket({ 'NAS:MU': makeBars('2022-01-03', '2025-08-20') });
    await runDailyBarsCollect(deps(db, m.fetchPage, { now: () => kst('2025-08-21 21:00') }), { symbols: ['NAS:MU'], years: 1 });
    db.rows().find((x) => x.trade_date === '2025-08-20')!.close = 50;      // 첫 칸: 저장 최신 봉 잠정(약 −50%, 20배 미만)
    m.data.set('NAS:MU', US_DATA());
    m.requests.length = 0;
    // 첫 칸 응답의 가장 최신 봉(2025-12-18)만 잠정값으로 준다 → 둘째 칸이 그 봉을 확정값으로 다시 받아 불일치
    const finalOf1218 = US_DATA().find((b) => b.tradeDate === '2025-12-18')!.close;
    let call = 0;
    const fetchPage: FetchDailyPage = async (req) => {
      const page = await m.fetchPage(req);
      call++;
      if (call === 1) page.rows = page.rows.map((b) => (b.tradeDate === '2025-12-18' ? { ...b, close: b.close - 0.5 } : b));
      return page;
    };
    const r = await runDailyBarsCollect(deps(db, fetchPage), { symbols: ['NAS:MU'], years: 1 });
    expect(r.symbols![0]).toMatchObject({ modes: ['incremental'], status: 'done', calls: 4 });
    expect(r.symbols![0].adjChange).toEqual({ compared: 34, mismatches: 2, settling: 2 });
    expect(db.rows().filter((x) => x.flags !== null)).toEqual([]);
    expect(db.rows().find((x) => x.trade_date === '2025-12-18')!.close).toBe(finalOf1218);
    expect(db.rows().slice(-1)[0].trade_date).toBe('2026-10-21');
  });

  test('(T-1) storedGaps 는 저장분의 9일 초과 빈틈 수를 센다', async () => {
    const db = new FakeBarsDb();
    const m = fakeMarket({ 'NAS:MU': US_DATA() });
    await runDailyBarsCollect(deps(db, m.fetchPage), { symbols: ['NAS:MU'], years: 1 });
    for (const k of [...db.sim.rows.keys()]) {
      const d = k.split('|')[2];
      if ((d >= '2026-03-02' && d <= '2026-03-13') || (d >= '2026-06-01' && d <= '2026-06-12')) db.sim.rows.delete(k);
    }
    const r = await runDailyBarsCollect(deps(db, m.fetchPage), { symbols: ['NAS:MU'], years: 1 });
    expect(r.symbols![0]).toMatchObject({ modes: ['up_to_date'], calls: 0 });
    expect(r.symbols![0].quality!.storedGaps).toBe(2);
  });
});

describe('(Codex C2 지적1) 최신 행이 장중 값이면 확정 시각 뒤 다시 받아 확정으로 바꾼다', () => {
  const lastRow = (db: FakeBarsDb) => db.rows().slice(-1)[0];

  test('① 해외 여름(EDT): KST 05:20 저장(ET 16:20, 미확정) → 06:00 재실행 = 1호출·is_final=1', async () => {
    const db = new FakeBarsDb();
    const m = fakeMarket({ 'NAS:MU': US_DATA() });
    await runDailyBarsCollect(deps(db, m.fetchPage, { now: () => kst('2026-10-22 05:20') }), { symbols: ['NAS:MU'], years: 1 });
    expect(lastRow(db)).toMatchObject({ trade_date: '2026-10-21', is_final: 0 });
    const r = await runDailyBarsCollect(deps(db, m.fetchPage, { now: () => kst('2026-10-22 06:00') }), { symbols: ['NAS:MU'], years: 1 });
    expect(r.symbols![0]).toMatchObject({ modes: ['incremental'], status: 'done', calls: 1 });
    expect(lastRow(db)).toMatchObject({ trade_date: '2026-10-21', is_final: 1 });
    // ⑤ 이미 확정이면 0호출
    const again = await runDailyBarsCollect(deps(db, m.fetchPage, { now: () => kst('2026-10-22 06:30') }), { symbols: ['NAS:MU'], years: 1 });
    expect(again.symbols![0]).toMatchObject({ modes: ['up_to_date'], calls: 0 });
  });

  test('② 해외 겨울(EST): KST 05:30 저장(ET 15:30) → 06:45 재실행 = 1호출·확정', async () => {
    const db = new FakeBarsDb();
    const m = fakeMarket({ 'NAS:MU': makeBars('2022-01-03', '2026-11-03') });
    await runDailyBarsCollect(deps(db, m.fetchPage, { now: () => kst('2026-11-04 05:30') }), { symbols: ['NAS:MU'], years: 1 });
    expect(lastRow(db)).toMatchObject({ trade_date: '2026-11-03', is_final: 0 });
    const early = await runDailyBarsCollect(deps(db, m.fetchPage, { now: () => kst('2026-11-04 06:20') }), { symbols: ['NAS:MU'], years: 1 });
    expect(early.symbols![0]).toMatchObject({ calls: 0 });                     // ET 16:20 — 아직 확정 시각 전
    const r = await runDailyBarsCollect(deps(db, m.fetchPage, { now: () => kst('2026-11-04 06:45') }), { symbols: ['NAS:MU'], years: 1 });
    expect(r.symbols![0]).toMatchObject({ modes: ['incremental'], calls: 1 });
    expect(lastRow(db)).toMatchObject({ trade_date: '2026-11-03', is_final: 1 });
  });

  test('③ 금요일 봉: 토요일 KST 05:20 저장 → 토요일 06:00 재실행 = 1호출, 그 뒤 주말 내내 0호출', async () => {
    const db = new FakeBarsDb();
    const m = fakeMarket({ 'NAS:MU': makeBars('2022-01-03', '2026-10-23') });
    await runDailyBarsCollect(deps(db, m.fetchPage, { now: () => kst('2026-10-24 05:20') }), { symbols: ['NAS:MU'], years: 1 });
    expect(lastRow(db)).toMatchObject({ trade_date: '2026-10-23', is_final: 0 });
    const r = await runDailyBarsCollect(deps(db, m.fetchPage, { now: () => kst('2026-10-24 06:00') }), { symbols: ['NAS:MU'], years: 1 });
    expect(r.symbols![0]).toMatchObject({ calls: 1 });
    expect(lastRow(db)).toMatchObject({ is_final: 1 });
    const sun = await runDailyBarsCollect(deps(db, m.fetchPage, { now: () => kst('2026-10-25 12:00') }), { symbols: ['NAS:MU'], years: 1 });
    expect(sun.symbols![0]).toMatchObject({ calls: 0 });
  });

  test('④ 국내: 10:00 저장(미확정) → 14:00 재실행 0호출 → 15:50 재실행 1호출·확정', async () => {
    const db = new FakeBarsDb();
    const m = fakeMarket({ '005930': makeBars('2023-01-02', '2026-10-22', 60000, 10) }, { today: '2026-10-22' });
    await runDailyBarsCollect(deps(db, m.fetchPage, { now: () => kst('2026-10-22 10:00') }), { symbols: ['005930'], years: 1 });
    expect(lastRow(db)).toMatchObject({ trade_date: '2026-10-22', is_final: 0 });
    const mid = await runDailyBarsCollect(deps(db, m.fetchPage, { now: () => kst('2026-10-22 14:00') }), { symbols: ['005930'], years: 1 });
    expect(mid.symbols![0]).toMatchObject({ modes: ['up_to_date'], calls: 0 });
    const r = await runDailyBarsCollect(deps(db, m.fetchPage, { now: () => kst('2026-10-22 15:50') }), { symbols: ['005930'], years: 1 });
    expect(r.symbols![0]).toMatchObject({ modes: ['incremental'], calls: 1 });
    expect(lastRow(db)).toMatchObject({ trade_date: '2026-10-22', is_final: 1 });
  });

  test('⑤ KIS 가 아직 그 날을 주지 않으면 1호출로 끝나고(한 실행 안 반복 없음) 행은 미확정 그대로', async () => {
    const db = new FakeBarsDb();
    const m = fakeMarket({ 'NAS:MU': US_DATA() });
    await runDailyBarsCollect(deps(db, m.fetchPage, { now: () => kst('2026-10-22 05:20') }), { symbols: ['NAS:MU'], years: 1 });
    m.data.set('NAS:MU', makeBars('2022-01-03', '2026-10-20'));
    m.requests.length = 0;
    const r = await runDailyBarsCollect(deps(db, m.fetchPage, { now: () => kst('2026-10-22 06:00') }), { symbols: ['NAS:MU'], years: 1 });
    expect(r.symbols![0]).toMatchObject({ modes: ['incremental'], status: 'done', calls: 1 });
    expect(m.requests).toHaveLength(1);
    expect(lastRow(db)).toMatchObject({ trade_date: '2026-10-21', is_final: 0 });
  });
});

describe('(R-1b) 상장 직후·호출당 행수가 적은 경우에도 증분이 멈추지 않는다', () => {
  test('상장 6일차 백필 → 3주 뒤 증분이 1호출로 정상 전진', async () => {
    const db = new FakeBarsDb();
    const m = fakeMarket({ 'NAS:NEW': makeBars('2026-10-14', '2026-10-21') });
    await runDailyBarsCollect(deps(db, m.fetchPage), { symbols: ['NAS:NEW'], years: 1 });
    expect(db.rows()).toHaveLength(6);
    m.data.set('NAS:NEW', makeBars('2026-10-14', '2026-11-11'));
    const r = await runDailyBarsCollect(deps(db, m.fetchPage, { now: () => kst('2026-11-12 21:00') }), { symbols: ['NAS:NEW'], years: 1 });
    // 증분 1호출(reached)로 전진 — 뒤의 backfill_continue 1호출은 상장 이전이라 빈 페이지(알려진 한계: 상장 직후 종목의 헛호출)
    expect(r.symbols![0]).toMatchObject({ modes: ['incremental', 'backfill_continue'], status: 'done', calls: 2, reasons: ['reached', 'exhausted'] });
    expect(db.rows().map((x) => x.trade_date)).toEqual(makeBars('2026-10-14', '2026-11-11').map((b) => b.tradeDate));
  });

  test.each([8, 9, 10, 11, 12])('저장 이력이 기준일 전 %i일(겹침 10일 경계 근처)이어도 1호출로 전진', async (k) => {
    const start = shiftDate('2026-10-21', -k);
    const db = new FakeBarsDb();
    const m = fakeMarket({ 'NAS:NEW': makeBars(start, '2026-10-21') });
    await runDailyBarsCollect(deps(db, m.fetchPage), { symbols: ['NAS:NEW'], years: 1 });
    m.data.set('NAS:NEW', makeBars(start, '2026-11-11'));
    const r = await runDailyBarsCollect(deps(db, m.fetchPage, { now: () => kst('2026-11-12 21:00') }), { symbols: ['NAS:NEW'], years: 1 });
    expect(r.symbols![0]).toMatchObject({ status: 'done' });
    expect(r.symbols![0].modes[0]).toBe('incremental');
    expect(r.symbols![0].reasons[0]).toBe('reached');               // 증분은 1호출로 저장분과 이어짐
    expect(r.symbols![0].rowsPerCall.length).toBeLessThanOrEqual(2);  // + 상장 이전 빈 페이지 1호출(backfill_continue)
    expect(db.rows().slice(-1)[0].trade_date).toBe('2026-11-11');
    expect(findGaps(db.rows().map((x) => ({ tradeDate: String(x.trade_date) })))).toEqual([]);
  });

  test.each([90, 50])('해외 호출당 %i행(100 미만) 응답이어도 6개월 빈틈이 멈추지 않고 이어진다', async (pageSize) => {
    const db = new FakeBarsDb();
    const seed = fakeMarket({ 'NAS:MU': makeBars('2022-01-03', '2026-04-21') });
    await runDailyBarsCollect(deps(db, seed.fetchPage, { now: () => kst('2026-04-22 21:00') }), { symbols: ['NAS:MU'], years: 1 });
    const m = fakeMarket({ 'NAS:MU': US_DATA() }, { pageSize });
    const r = await runDailyBarsCollect(deps(db, m.fetchPage), { symbols: ['NAS:MU'], years: 1 });
    expect(r.symbols![0]).toMatchObject({ modes: ['incremental'], status: 'done' });
    expect(db.rows().slice(-1)[0].trade_date).toBe('2026-10-21');
    expect(findGaps(db.rows().map((x) => ({ tradeDate: String(x.trade_date) })))).toEqual([]);
    const rows = db.rows();
    const want = US_DATA().filter((b) => b.tradeDate >= String(rows[0].trade_date));
    expect(rows.map((x) => x.trade_date)).toEqual(want.map((b) => b.tradeDate));
  });
});

function shiftDate(d: string, n: number): string {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

describe('(R-2a) 확정 봉 보호 — 반대 방향', () => {
  test('확정 행 위에 장중 값을 upsert 해도 값·is_final 이 그대로', async () => {
    const db = new FakeBarsDb();
    const bar = { tradeDate: '2026-10-21', open: 10, high: 11, low: 9, close: 10.5, volume: 100, turnover: null, flags: [], hasPredecessor: true };
    const ctx = (final: boolean) => ({ market: 'US' as const, symbol: 'NAS:MU', adjMode: 'adjusted' as const, source: 'kis_dailyprice', isFinal: () => final, now: NOW });
    await upsertBars(db as unknown as Queryable, [bar], ctx(true));
    await upsertBars(db as unknown as Queryable, [{ ...bar, open: 1, high: 1, low: 1, close: 1, volume: 1, flags: ['zero_volume'] }], ctx(false));
    expect(db.rows()[0]).toMatchObject({ open: 10, high: 11, low: 9, close: 10.5, volume: 100, flags: null, is_final: 1 });
    // 반대로 장중 → 확정은 갱신된다
    await upsertBars(db as unknown as Queryable, [{ ...bar, tradeDate: '2026-10-22', close: 7 }], ctx(false));
    await upsertBars(db as unknown as Queryable, [{ ...bar, tradeDate: '2026-10-22', close: 8 }], ctx(true));
    expect(db.rows()[1]).toMatchObject({ close: 8, is_final: 1 });
  });
  test('upsert SQL 구조: 값 열은 전부 확정 보호 IF, is_final 대입은 맨 끝의 GREATEST', () => {
    const sql = DAILY_BARS_UPSERT_SQL.replace(/\s+/g, ' ');
    const tail = sql.slice(sql.indexOf('ON DUPLICATE KEY UPDATE') + 24);
    const assigns: string[] = [];
    let depth = 0, cur = '';
    for (const ch of tail) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { assigns.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    assigns.push(cur.trim());
    expect(assigns[assigns.length - 1]).toBe('is_final = GREATEST(is_final, VALUES(is_final))');
    for (const c of ['open', 'high', 'low', 'close', 'volume', 'turnover', 'flags', 'source', 'fetched_at']) {
      expect(assigns).toContain(`${c} = IF(is_final = 1 AND VALUES(is_final) = 0, ${c}, VALUES(${c}))`);
    }
    expect(assigns.filter((a) => a.startsWith('is_final'))).toHaveLength(1);
  });
});

describe('(R-2b) 기본 호출 간격', () => {
  test('gapMs 를 주지 않으면 호출 사이마다 400ms 를 기다린다(종목이 바뀌어도)', async () => {
    expect(DEFAULT_GAP_MS).toBe(400);
    const db = new FakeBarsDb();
    const m = fakeMarket({ 'NAS:AAA': US_DATA(), 'NAS:BBB': US_DATA() });
    const waits: number[] = [];
    const d = deps(db, m.fetchPage, { sleep: async (ms: number) => { waits.push(ms); } });
    delete d.gapMs;
    const r = await runDailyBarsCollect(d, { symbols: ['NAS:AAA', 'NAS:BBB'], years: 1 });
    expect(r.budget!.calls).toBe(6);
    expect(waits).toEqual([400, 400, 400, 400, 400]);
  });
});

describe('조정 기준 변경 감지 → 전체 재수집', () => {
  const adjusted = (to: string) => makeBars('2022-01-03', to).map((b) => (
    b.tradeDate < '2026-10-21' ? { ...b, close: Math.round(b.close * 0.998 * 10000) / 10000 } : b));

  test('겹침 종가가 바뀌면 stale 표시 후 끝까지 다시 받아 새 기준으로 바꾼다', async () => {
    const db = new FakeBarsDb();
    const m = fakeMarket({ 'NAS:MU': US_DATA() });
    await runDailyBarsCollect(deps(db, m.fetchPage), { symbols: ['NAS:MU'], years: 1 });
    const oldMin = String(db.rows()[0].trade_date);
    m.data.set('NAS:MU', adjusted('2026-10-23'));
    const r = await runDailyBarsCollect(deps(db, m.fetchPage, { now: () => NEXT }), { symbols: ['NAS:MU'], years: 1 });
    expect(r.symbols![0].modes).toEqual(['incremental', 'refetch']);
    expect(r.symbols![0].adjChange!.mismatches).toBeGreaterThan(0);
    expect(r.symbols![0].status).toBe('done');
    const rows = db.rows();
    const want = closesOf(adjusted('2026-10-23').map((b) => ({ trade_date: b.tradeDate, close: b.close })));
    for (const row of rows) {
      expect(row.close).toBe(want[String(row.trade_date)]);
      expect(row.flags).toBeNull();
    }
    expect(String(rows[0].trade_date) <= oldMin).toBe(true);
  });

  test('재수집이 예산으로 끊겨도 stale 표시가 남아 다음 실행이 이어 간다', async () => {
    const db = new FakeBarsDb();
    const m = fakeMarket({ 'NAS:MU': US_DATA() });
    await runDailyBarsCollect(deps(db, m.fetchPage), { symbols: ['NAS:MU'], years: 1 });
    m.data.set('NAS:MU', adjusted('2026-10-23'));
    const r1 = await runDailyBarsCollect(deps(db, m.fetchPage, { now: () => NEXT }), { symbols: ['NAS:MU'], years: 1, maxCalls: 1 });
    expect(r1.symbols![0]).toMatchObject({ modes: ['incremental', 'refetch'], status: 'partial', calls: 1 });
    expect(r1.symbols![0].reasons).toEqual(['reached', 'budget']);
    expect(db.rows().filter((x) => x.flags === 'adj_stale').length).toBeGreaterThan(100);
    const r2 = await runDailyBarsCollect(deps(db, m.fetchPage, { now: () => NEXT }), { symbols: ['NAS:MU'], years: 1 });
    expect(r2.symbols![0]).toMatchObject({ modes: ['refetch'], status: 'done' });
    expect(db.rows().filter((x) => x.flags !== null)).toEqual([]);
  });

  test('재수집 뒤에도 KIS 가 더 주지 않는 날짜의 stale 행은 orphan 으로 바꿔 반복하지 않는다', async () => {
    const db = new FakeBarsDb();
    const m = fakeMarket({ 'NAS:MU': US_DATA() });
    await runDailyBarsCollect(deps(db, m.fetchPage), { symbols: ['NAS:MU'], years: 1 });
    m.data.set('NAS:MU', adjusted('2026-10-23').filter((b) => b.tradeDate !== '2026-03-02'));
    await runDailyBarsCollect(deps(db, m.fetchPage, { now: () => NEXT }), { symbols: ['NAS:MU'], years: 1 });
    expect(db.rows().filter((x) => x.flags !== null).map((x) => [x.trade_date, x.flags])).toEqual([['2026-03-02', 'adj_orphan']]);
    const again = await runDailyBarsCollect(deps(db, m.fetchPage, { now: () => NEXT }), { symbols: ['NAS:MU'], years: 1 });
    expect(again.symbols![0]).toMatchObject({ modes: ['up_to_date'], calls: 0 });
  });

  test('저장분이 다른 조정 모드(raw)면 전체 재수집 대상', async () => {
    const db = new FakeBarsDb();
    const m = fakeMarket({ 'NAS:MU': US_DATA() });
    await runDailyBarsCollect(deps(db, m.fetchPage, { adjMode: 'raw' }), { symbols: ['NAS:MU'], years: 1 });
    expect(db.rows()[0].adj_mode).toBe('raw');
    const r = await runDailyBarsCollect(deps(db, m.fetchPage), { symbols: ['NAS:MU'], years: 1 });
    expect(r.symbols![0].modes).toEqual(['refetch']);
    expect(new Set(db.rows().map((x) => x.adj_mode))).toEqual(new Set(['adjusted']));
  });
});

describe('(T-099) 정착 중인 최신 봉 — 재수집하지 않고 겹침 재기록으로 덮는다', () => {
  test('미국형: 저장 최신 봉(10-21)만 잠정값 → 증분 1호출로 끝, stale·재수집 없음, 최신 봉은 새 값으로 덮인다', async () => {
    const db = new FakeBarsDb();
    const m = fakeMarket({ 'NAS:MU': US_DATA() });
    await runDailyBarsCollect(deps(db, m.fetchPage), { symbols: ['NAS:MU'], years: 1 });
    const row = db.rows().find((x) => x.trade_date === '2026-10-21')!;
    const finalClose = row.close;
    row.close = 524.9988;                                                   // 마감 직후 저장한 잠정 종가(진단 MSFT 모양)
    const before = closesOf(db.rows());
    m.data.set('NAS:MU', makeBars('2022-01-03', '2026-10-23'));
    m.requests.length = 0;
    const r = await runDailyBarsCollect(deps(db, m.fetchPage, { now: () => NEXT }), { symbols: ['NAS:MU'], years: 1 });
    expect(r.symbols![0]).toMatchObject({ modes: ['incremental'], status: 'done', calls: 1 });
    expect(r.symbols![0].adjChange).toEqual({ compared: 8, mismatches: 1, settling: 1 });
    expect(m.requests).toHaveLength(1);
    expect(db.rows().filter((x) => x.flags !== null)).toEqual([]);           // adj_stale 표시 없음
    expect(db.rows().find((x) => x.trade_date === '2026-10-21')!.close).toBe(finalClose);
    expect(db.rows()).toHaveLength(302);
    // 겹침 밖 과거 행은 손대지 않았다
    for (const x of db.rows().filter((y) => String(y.trade_date) < '2026-10-12')) expect(x.close).toBe(before[String(x.trade_date)]);
  });

  test('국내형: 저장 최신 봉(10-22)만 213500 → 215500 식으로 다르면 증분 1호출, stale 없음, 덮어쓰기', async () => {
    const data = makeBars('2023-01-02', '2026-10-22', 200000, 100);
    const db = new FakeBarsDb();
    await runDailyBarsCollect(deps(db, fakeMarket({ '005930': data }, { today: '2026-10-22' }).fetchPage, { now: () => kst('2026-10-22 16:00') }),
      { symbols: ['005930'], years: 1 });
    const row = db.rows('KR', '005930').find((x) => x.trade_date === '2026-10-22')!;
    expect(row.is_final).toBe(1);
    const finalClose = row.close;
    row.close = Number(finalClose) - 2000;                                  // 잠정 종가(진단 005930 의 −0.9% 모양)
    const m2 = fakeMarket({ '005930': makeBars('2023-01-02', '2026-10-23', 200000, 100) }, { today: '2026-10-23' });
    const r = await runDailyBarsCollect(deps(db, m2.fetchPage, { now: () => kst('2026-10-23 16:00') }), { symbols: ['005930'], years: 1 });
    expect(r.symbols![0]).toMatchObject({ modes: ['incremental'], status: 'done', calls: 1 });
    expect(r.symbols![0].adjChange).toMatchObject({ mismatches: 1, settling: 1 });
    expect(m2.requests).toHaveLength(1);
    expect(db.rows().filter((x) => x.flags !== null)).toEqual([]);
    expect(db.rows('KR', '005930').find((x) => x.trade_date === '2026-10-22')!.close).toBe(finalClose);
    expect(db.rows('KR', '005930').slice(-1)[0]).toMatchObject({ trade_date: '2026-10-23', is_final: 1 });
  });

  test('최신 3개가 다르면(K 초과) 지금처럼 stale 표시 + 재수집', async () => {
    const db = new FakeBarsDb();
    const m = fakeMarket({ 'NAS:MU': US_DATA() });
    await runDailyBarsCollect(deps(db, m.fetchPage), { symbols: ['NAS:MU'], years: 1 });
    for (const d of ['2026-10-19', '2026-10-20', '2026-10-21']) {
      const x = db.rows().find((y) => y.trade_date === d)!;
      x.close = Math.round(Number(x.close) * 0.99 * 10000) / 10000;          // 1% 차이(단위 혼입 아님)
    }
    m.data.set('NAS:MU', makeBars('2022-01-03', '2026-10-23'));
    const r = await runDailyBarsCollect(deps(db, m.fetchPage, { now: () => NEXT }), { symbols: ['NAS:MU'], years: 1 });
    expect(r.symbols![0].modes).toEqual(['incremental', 'refetch']);
    expect(r.symbols![0].adjChange).toEqual({ compared: 8, mismatches: 3, settling: 0 });
    expect(r.symbols![0].calls).toBe(4);                                     // 증분 1 + 재수집 3(1년 ≈ 300행 / 100행)
    expect(r.symbols![0].status).toBe('done');
    expect(db.rows().filter((x) => x.flags !== null)).toEqual([]);           // 재수집이 끝까지 돌아 stale 이 풀렸다
  });
});

describe('품질 게이트 적용', () => {
  test('분할(종가 1/2)은 그날만 corp_action_suspect 로 표시하고 행은 뺀지 않는다, 거래량 0 도 표시', async () => {
    const data: RawBar[] = US_DATA().map((b) => (b.tradeDate >= '2026-08-03' ? { ...b, close: b.close / 2 } : b))
      .map((b) => (b.tradeDate === '2026-09-15' ? { ...b, volume: 0 } : b));
    const db = new FakeBarsDb();
    await runDailyBarsCollect(deps(db, fakeMarket({ 'NAS:MU': data }).fetchPage), { symbols: ['NAS:MU'], years: 1 });
    const flagged = db.rows().filter((x) => x.flags !== null).map((x) => [x.trade_date, x.flags]);
    expect(flagged).toEqual([['2026-08-03', 'corp_action_suspect'], ['2026-09-15', 'zero_volume']]);
    expect(db.rows()).toHaveLength(300);
  });

  test('(R-5) 저장분 0 + 첫 페이지부터 빈 응답은 done 이 아니라 no_data', async () => {
    const r = await runDailyBarsCollect(deps(new FakeBarsDb(), fakeMarket({}).fetchPage), { symbols: ['NAS:ZZZZ'], years: 1 });
    expect(r.symbols![0]).toMatchObject({ status: 'no_data', calls: 1, written: 0 });
    expect(r.ok).toBe(true);
  });

  test('저장분 통화가 다르면(KRW) 쓰지 않고 호출도 하지 않는다', async () => {
    const db = new FakeBarsDb();
    db.seed({ market: 'US', symbol: 'NAS:MU', trade_date: '2026-10-20', close: 250000, currency: 'KRW', adj_mode: 'adjusted', is_final: 1, flags: null });
    const m = fakeMarket({ 'NAS:MU': US_DATA() });
    const r = await runDailyBarsCollect(deps(db, m.fetchPage), { symbols: ['NAS:MU'], years: 1 });
    expect(r.symbols![0]).toMatchObject({ status: 'failed', calls: 0 });
    expect(r.symbols![0].error).toMatch(/currency_mismatch: market=US expected=USD found=KRW/);
    expect(m.requests).toHaveLength(0);
    expect(db.rows()).toHaveLength(1);
  });

  test('저장 종가가 수십 배(환산값 혼입)면 증분을 쓰지 않는다', async () => {
    const db = new FakeBarsDb();
    for (const b of makeBars('2025-10-20', '2026-10-21')) {
      db.seed({ market: 'US', symbol: 'NAS:MU', trade_date: b.tradeDate, close: b.close * 1400, currency: 'USD', adj_mode: 'adjusted', is_final: 1, flags: null });
    }
    const before = strip(db.rows());
    const m = fakeMarket({ 'NAS:MU': makeBars('2022-01-03', '2026-10-23') });
    const r = await runDailyBarsCollect(deps(db, m.fetchPage, { now: () => NEXT }), { symbols: ['NAS:MU'], years: 1 });
    expect(r.symbols![0].status).toBe('failed');
    expect(r.symbols![0].error).toMatch(/unit_mismatch/);
    expect(strip(db.rows())).toEqual(before);
  });

  test('국내: KRW·itemchartprice, 장중 봉은 is_final=0 이고 확정 후 1로 갱신, 확정 봉은 장중 값으로 되돌리지 않는다', async () => {
    const data = makeBars('2023-01-02', '2026-10-22', 60000, 10);
    const db = new FakeBarsDb();
    const m = fakeMarket({ '005930': data }, { today: '2026-10-22' });
    await runDailyBarsCollect(deps(db, m.fetchPage, { now: () => kst('2026-10-22 16:00') }), { symbols: ['005930'], years: 1 });
    let last = db.rows('KR', '005930').slice(-1)[0];
    expect(last).toMatchObject({ trade_date: '2026-10-22', is_final: 1, currency: 'KRW', source: 'kis_itemchartprice' });

    const db2 = new FakeBarsDb();
    await runDailyBarsCollect(deps(db2, m.fetchPage, { now: () => kst('2026-10-22 10:00') }), { symbols: ['005930'], years: 1 });
    last = db2.rows().slice(-1)[0];
    expect(last).toMatchObject({ trade_date: '2026-10-22', is_final: 0 });
    // 확정 뒤 증분: 1 로 갱신
    m.data.set('005930', makeBars('2023-01-02', '2026-10-23', 60000, 10));
    await runDailyBarsCollect(deps(db2, m.fetchPage, { now: () => kst('2026-10-23 16:00') }), { symbols: ['005930'], years: 1 });
    expect(db2.rows().find((x) => x.trade_date === '2026-10-22')).toMatchObject({ is_final: 1 });
  });
});

describe('중단 조건 — 남은 종목도 같을 실패는 그 자리에서 멈춘다', () => {
  const two = ['NAS:AAA', 'NAS:BBB'];
  test('레이트리밋(백오프 소진) → kis_rate_limited', async () => {
    const db = new FakeBarsDb();
    const fetchPage: FetchDailyPage = async () => { throw new KisDailyError('rate_limited', 'status=500'); };
    const r = await runDailyBarsCollect(deps(db, fetchPage), { symbols: two, years: 1 });
    expect(r).toMatchObject({ ok: false, aborted: 'kis_rate_limited', remaining: ['NAS:BBB'] });
    expect(r.symbols![0]).toMatchObject({ status: 'failed' });
  });
  test('유량 대기 실패 → kis_throttle, 인증 실패 → kis_auth', async () => {
    const throttled: FetchDailyPage = async () => { throw Object.assign(new Error('wait'), { name: 'KisThrottleTimeoutError' }); };
    expect((await runDailyBarsCollect(deps(new FakeBarsDb(), throttled), { symbols: two })).aborted).toBe('kis_throttle');
    const auth: FetchDailyPage = async () => { throw new KisDailyError('auth', 'status=401'); };
    expect((await runDailyBarsCollect(deps(new FakeBarsDb(), auth), { symbols: two })).aborted).toBe('kis_auth');
  });
  test('종목별 업무 실패는 다음 종목으로, 3연속이면 멈춘다', async () => {
    const fetchPage: FetchDailyPage = async () => { throw new KisDailyError('rt_cd', 'rt_cd=7'); };
    const r = await runDailyBarsCollect(deps(new FakeBarsDb(), fetchPage), { symbols: ['NAS:A', 'NAS:B', 'NAS:C', 'NAS:D'] });
    expect(r).toMatchObject({ ok: false, aborted: 'consecutive_failures', remaining: ['NAS:D'] });
    expect(r.symbols!.map((s) => s.status)).toEqual(['failed', 'failed', 'failed']);
  });
  test('도중 실패면 받은 페이지까지는 쓰고 partial', async () => {
    const db = new FakeBarsDb();
    const m = fakeMarket({ 'NAS:MU': US_DATA() });
    let n = 0;
    const fetchPage: FetchDailyPage = async (req) => { if (n++ === 1) throw new KisDailyError('http', 'status=502'); return m.fetchPage(req); };
    const r = await runDailyBarsCollect(deps(db, fetchPage), { symbols: ['NAS:MU'], years: 1 });
    expect(r.symbols![0]).toMatchObject({ status: 'partial', written: 99 });
    expect(r.ok).toBe(true);
  });
});

describe('대상·잠금·쓰기 범위', () => {
  test('기본 대상 = 보유 먼저 → 90일 시그널(발화 수 순), 형식 밖 심볼 제외, 중복 제거', async () => {
    const db = new FakeBarsDb();
    db.positions = ['NAS:MU', '005930'];
    db.signalCounts = [{ symbol: 'NAS:INTC', n: 5 }, { symbol: 'NAS:MU', n: 3 }, { symbol: 'BAD', n: 9 }, { symbol: '000660', n: 1 }];
    const m = fakeMarket({});
    const r = await runDailyBarsCollect(deps(db, m.fetchPage), { years: 1 });
    expect(r.targets).toBe(4);
    expect(r.symbols!.map((s) => s.symbol)).toEqual(['NAS:MU', '005930', 'NAS:INTC', '000660']);
  });
  test('보유 조회가 실패해도 시그널 종목으로 계속', async () => {
    const db = new FakeBarsDb();
    db.failPositions = true;
    db.signalCounts = [{ symbol: 'NAS:INTC', n: 5 }];
    const r = await runDailyBarsCollect(deps(db, fakeMarket({}).fetchPage), { years: 1 });
    expect(r.targetErrors).toEqual(['position_state']);
    expect(r.symbols!.map((s) => s.symbol)).toEqual(['NAS:INTC']);
  });
  test('동시 실행은 already_running', async () => {
    const db = new FakeBarsDb();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const m = fakeMarket({ 'NAS:MU': US_DATA() });
    const slow: FetchDailyPage = async (req) => { await gate; return m.fetchPage(req); };
    const first = runDailyBarsCollect(deps(db, slow), { symbols: ['NAS:MU'], years: 1 });
    const second = await runDailyBarsCollect(deps(db, slow), { symbols: ['NAS:MU'], years: 1 });
    expect(second).toEqual({ ok: false, skipped: 'already_running' });
    release();
    await first;
  });
  test('여러 시나리오 전체에서 쓰기 SQL 대상은 daily_bars 하나뿐', async () => {
    const db = new FakeBarsDb();
    db.positions = ['NAS:MU'];
    const m = fakeMarket({ 'NAS:MU': US_DATA() });
    await runDailyBarsCollect(deps(db, m.fetchPage), { years: 1 });
    m.data.set('NAS:MU', makeBars('2022-01-03', '2026-10-23').map((b) => ({ ...b, close: b.close * 0.99 })));
    await runDailyBarsCollect(deps(db, m.fetchPage, { now: () => NEXT }), { years: 1 });
    expect(db.queries.some((q) => q.sql.startsWith('UPDATE daily_bars'))).toBe(true);
    expect(db.writtenTables()).toEqual(['daily_bars']);
  });
});
