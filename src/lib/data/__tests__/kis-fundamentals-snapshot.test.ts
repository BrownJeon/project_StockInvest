/**
 * T-059 Part A — kis-fundamentals-snapshot 본체: tables_missing 이면 KIS 호출 0, 종목 격리, 유량 실패 시 중단,
 * DB 시각은 NOW()/CURDATE()(JS 시각 문자열 바인딩 없음), bulk 우선순위.
 */
const detailMock = jest.fn();
const priorities: string[] = [];
jest.mock('@/lib/exchanges/kis-overseas', () => ({ getPriceDetail: (...a: unknown[]) => detailMock(...a) }));
jest.mock('@/lib/exchanges/kis-throttle', () => ({
  withKisPriority: (p: string, fn: () => Promise<unknown>) => { priorities.push(p); return fn(); },
  isKisThrottleFailure: (e: unknown) => (e as Error)?.name === 'KisThrottleTimeoutError',
}));

import { runKisFundamentalsSnapshot, SNAPSHOT_UPSERT_SQL } from '../kis-fundamentals-snapshot';
import { UpsertSim } from './sql-upsert-sim';
import type { Queryable } from '../us-data-db';

function db(tables: string[], positions: string[] = [], favorites: string[] = []) {
  const log: Array<{ sql: string; params: unknown[] }> = [];
  const q: Queryable = {
    async query<T>(sql: string, params: unknown[] = []) {
      const s = sql.replace(/\s+/g, ' ').trim();
      log.push({ sql: s, params });
      if (s.includes('information_schema.TABLES')) return [(params[0] as string[]).filter((t) => tables.includes(t)).map((t) => ({ t })) as T, undefined];
      if (s.startsWith('SELECT symbol FROM position_state')) return [positions.map((symbol) => ({ symbol })) as T, undefined];
      if (s.startsWith('SELECT symbol FROM stock_favorites')) return [favorites.map((symbol) => ({ symbol })) as T, undefined];
      return [{ affectedRows: 1 } as T, undefined];
    },
  };
  return { q, log, inserts: () => log.filter((l) => l.sql.startsWith('INSERT INTO us_fundamentals_snapshot')) };
}

const detail = (symbol: string) => ({
  symbol, lastPrice: 10, per: 1, pbr: 2, eps: 3, bps: 4, marketCap: 5, shares: 6, high52: 7, low52: 8,
  high52Date: '2026-08-01', low52Date: null, currency: 'USD', sector: null, etpType: null, raw: { last: '10' },
});

const ORIG = process.env.OVERSEAS_UNIVERSE_SYMBOLS;
beforeEach(() => { detailMock.mockReset(); priorities.length = 0; process.env.OVERSEAS_UNIVERSE_SYMBOLS = 'NAS:AAPL,NAS:INTC'; });
afterAll(() => { process.env.OVERSEAS_UNIVERSE_SYMBOLS = ORIG; });

test('🔴 테이블이 없으면 skipped:tables_missing — KIS 호출 0·쓰기 0', async () => {
  const d = db([]);
  const r = await runKisFundamentalsSnapshot({ db: d.q, log: () => undefined });
  expect(r).toEqual({ ok: true, skipped: 'tables_missing', missing: ['us_fundamentals_snapshot'] });
  expect(detailMock).not.toHaveBeenCalled();
  expect(d.inserts()).toHaveLength(0);
});

test('대상 = 보유 ∪ 즐겨찾기 ∪ universe(해외 형식만), 직렬·bulk, 시각은 DB NOW()/CURDATE()', async () => {
  const d = db(['us_fundamentals_snapshot'], ['NAS:SMH', '005930'], ['NAS:MU', '000660']);
  const order: string[] = [];
  detailMock.mockImplementation(async (s: string) => { order.push(s); return detail(s); });
  const r = await runKisFundamentalsSnapshot({ db: d.q, log: () => undefined });
  expect(r).toMatchObject({ ok: true, targets: 4, written: 4, failed: [] });
  expect(order).toEqual(['NAS:AAPL', 'NAS:INTC', 'NAS:MU', 'NAS:SMH']);
  expect(priorities).toEqual(['bulk', 'bulk', 'bulk', 'bulk']);
  const ins = d.inserts()[0];
  expect(ins.sql).toMatch(/VALUES \(\?, CURDATE\(\),.*'kis_price_detail', NOW\(\)\)/);
  expect(ins.params.some((p) => typeof p === 'string' && /T\d{2}:\d{2}:\d{2}/.test(p))).toBe(false);   // ISO 시각 문자열 없음
  expect(ins.params.slice(0, 5)).toEqual(['NAS:AAPL', 1, 2, 3, 4]);
});

test('🔴 한 종목 실패(빈 응답·형식 이상)는 그 종목만 행 없음, 나머지는 기록', async () => {
  const d = db(['us_fundamentals_snapshot']);
  detailMock.mockImplementation(async (s: string) => {
    if (s === 'NAS:AAPL') throw Object.assign(new Error('지표 8개가 모두 비어 있음'), { name: 'PriceDetailUnavailableError' });
    return detail(s);
  });
  const r = await runKisFundamentalsSnapshot({ db: d.q, log: () => undefined });
  expect(r.ok).toBe(true);
  expect(r.written).toBe(1);
  expect(r.failed).toEqual([{ symbol: 'NAS:AAPL', error: expect.stringContaining('PriceDetailUnavailableError') }]);
  expect(d.inserts().map((i) => i.params[0])).toEqual(['NAS:INTC']);
});

test('유량 대기 실패면 남은 종목을 부르지 않고 중단', async () => {
  const d = db(['us_fundamentals_snapshot']);
  detailMock.mockImplementation(async () => { throw Object.assign(new Error('timeout'), { name: 'KisThrottleTimeoutError' }); });
  const r = await runKisFundamentalsSnapshot({ db: d.q, log: () => undefined });
  expect(r).toMatchObject({ ok: false, aborted: 'kis_throttle', written: 0 });
  expect(detailMock).toHaveBeenCalledTimes(1);
});

test('🔴 (C-3) 한 종목의 DB 쓰기 오류는 failed 에 남기고 다음 종목을 계속 처리(오류 코드만, 값 없음)', async () => {
  const d = db(['us_fundamentals_snapshot']);
  const orig = d.q.query.bind(d.q);
  d.q.query = (async (sql: string, params: unknown[] = []) => {
    if (sql.includes('INSERT INTO us_fundamentals_snapshot') && params[0] === 'NAS:AAPL') {
      throw Object.assign(new Error("Incorrect date value: '2026-13-40' for column h52_date"), { code: 'ER_TRUNCATED_WRONG_VALUE' });
    }
    return orig(sql, params);
  }) as typeof d.q.query;
  detailMock.mockImplementation(async (s: string) => detail(s));
  const r = await runKisFundamentalsSnapshot({ db: d.q, log: () => undefined });
  expect(r).toMatchObject({ ok: true, written: 1, failed: [{ symbol: 'NAS:AAPL', error: 'db_write_failed: ER_TRUNCATED_WRONG_VALUE' }] });
  expect(d.inserts().map((i) => i.params[0])).toContain('NAS:INTC');
});

describe('🔴 (C-2) 같은 날 재실행 — 부분 응답이 정상 값을 NULL 로 덮지 않는다', () => {
  const full = (v: number) => ['NAS:INTC', v, v + 1, v + 2, v + 3, 1e11, 4e9, 40, 20, '2026-08-01', '2025-11-05', 36, 'USD', '반도체', null, `{"v":${v}}`];
  const partial = ['NAS:INTC', null, null, 7, null, null, null, null, null, null, null, 37, null, null, null, '{"partial":1}'];
  const sim = () => new UpsertSim(['symbol', 'snapshot_date']);

  test('완전 → 부분: 빠진 값은 보존, 새로 온 값·raw_output·observed_at 은 갱신', () => {
    const s = sim();
    s.exec(SNAPSHOT_UPSERT_SQL, full(1));
    s.exec(SNAPSHOT_UPSERT_SQL, partial);
    expect(s.only()).toMatchObject({ per: 1, pbr: 2, eps: 7, bps: 4, market_cap: 1e11, h52: 40, l52: 20, h52_date: '2026-08-01', last_price: 37, currency: 'USD', sector: '반도체', raw_output: '{"partial":1}', observed_at: '@now' });
  });
  test('완전 → 완전: 값 갱신', () => {
    const s = sim();
    s.exec(SNAPSHOT_UPSERT_SQL, full(1));
    s.exec(SNAPSHOT_UPSERT_SQL, full(5));
    expect(s.only()).toMatchObject({ per: 5, pbr: 6, eps: 7, bps: 8, raw_output: '{"v":5}' });
  });
  test('부분 → 완전: 빈 칸을 채움', () => {
    const s = sim();
    s.exec(SNAPSHOT_UPSERT_SQL, partial);
    s.exec(SNAPSHOT_UPSERT_SQL, full(3));
    expect(s.only()).toMatchObject({ per: 3, pbr: 4, eps: 5, bps: 6, h52: 40 });
  });
  test('첫 삽입이 부분이면 NULL 그대로(채워 넣지 않음)', () => {
    const s = sim();
    s.exec(SNAPSHOT_UPSERT_SQL, partial);
    expect(s.only()).toMatchObject({ per: null, pbr: null, eps: 7, bps: null, market_cap: null, snapshot_date: '@today', source: 'kis_price_detail' });
  });
});
