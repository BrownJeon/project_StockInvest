/**
 * T-059 Part A — kis-fundamentals-snapshot 본체: tables_missing 이면 KIS 호출 0, 종목 격리, 유량 실패 시 중단,
 * DB 시각은 NOW()/CURDATE()(JS 시각 문자열 바인딩 없음), bulk 우선순위.
 *
 * T-145 ⑨ 추가 — **1회 90초 마감 + DB 이어받기**. 고정하는 것:
 *  · 마감 초과면 `ok:true`·`complete:false`·`partial:true`·`stopped:'budget'`·`remaining` 정확(실패가 **아니다**)
 *  · 마감 안이면 `complete:true`·`remaining:0`
 *  · 오늘 행이 있는 종목은 **다시 부르지 않는다**(새 표·설정 행·진행률 파일 없이 DB 한 줄로 이어받는다)
 *  · 마감 종료(`stopped`)와 유량 중단(`aborted`)이 **구분된다** — 라우트가 전자는 200, 후자는 503 이다
 *  · 첫 종목은 언제나 처리한다(앞 조회가 마감을 다 써도 **진행이 멈추지 않는다**)
 *
 * 🔴 (Reviewer M-1) **이어받기 질의의 날짜 조건을 대역이 고정한다.** 전에는 대역이
 * `SELECT symbol FROM us_fundamentals_snapshot` 로 시작하는 **아무 질의**에나 「오늘 수집분」을 돌려줬다 →
 * `WHERE snapshot_date = CURDATE()` 를 `<= CURDATE()` 로 바꾸는 변이가 이 파일 18개를 **전부 통과했다**.
 * 회귀하면 어제 행 때문에 모든 종목이 영구히 「완료」로 읽혀 **스냅샷이 `ok` 를 보고하면서 조용히 멈춘다**.
 * 이제 대역은 **정확한 WHERE 문구**(`DONE_TODAY_SQL`)에만 오늘 수집분을 주고, 날짜 조건이 다른 질의에는
 * 실 DB 처럼 **어제 행이 섞인 집합**을 준다 — 그러면 그 변이가 「전부 완료」로 읽혀 단언이 깨진다.
 */
const detailMock = jest.fn();
const priorities: string[] = [];
jest.mock('@/lib/exchanges/kis-overseas', () => ({ getPriceDetail: (...a: unknown[]) => detailMock(...a) }));
jest.mock('@/lib/exchanges/kis-throttle', () => ({
  withKisPriority: (p: string, fn: () => Promise<unknown>) => { priorities.push(p); return fn(); },
  isKisThrottleFailure: (e: unknown) => (e as Error)?.name === 'KisThrottleTimeoutError',
}));

import {
  runKisFundamentalsSnapshot, SNAPSHOT_DEFAULT_BUDGET_MS, SNAPSHOT_MAX_BUDGET_MS, SNAPSHOT_MIN_BUDGET_MS,
  SNAPSHOT_UPSERT_SQL,
} from '../kis-fundamentals-snapshot';
import { UpsertSim } from './sql-upsert-sim';
import type { Queryable } from '../us-data-db';

/** `readDoneToday` 가 보내는 **정확한** 질의. 이 문구가 아니면 대역은 오늘 수집분을 주지 않는다(Reviewer M-1). */
const DONE_TODAY_SQL = 'SELECT symbol FROM us_fundamentals_snapshot WHERE snapshot_date = CURDATE()';
/**
 * 🔴 날짜 조건이 느슨해진 질의에 실 DB 가 줄 **어제 행**. 기본값이 비어 있으면 안 된다 —
 * 비면 `<= CURDATE()` 변이가 오늘 집합과 같은 답을 받아 아무 단언도 깨지지 않는다.
 * 이 파일이 쓰는 대상 심볼을 모두 담는다(= 변이가 걸리면 「전부 완료」가 된다).
 */
const YESTERDAY_ROWS = ['NAS:AAPL', 'NAS:INTC', 'NAS:MU', 'NAS:NVDA', 'NAS:SMH'] as const;

function db(
  tables: string[], positions: string[] = [], favorites: string[] = [], doneToday: string[] = [],
  yesterday: readonly string[] = YESTERDAY_ROWS,
) {
  const log: Array<{ sql: string; params: unknown[] }> = [];
  const q: Queryable = {
    async query<T>(sql: string, params: unknown[] = []) {
      const s = sql.replace(/\s+/g, ' ').trim();
      log.push({ sql: s, params });
      if (s.includes('information_schema.TABLES')) return [(params[0] as string[]).filter((t) => tables.includes(t)).map((t) => ({ t })) as T, undefined];
      // T-145 ⑨ — 이어받기의 유일한 상태(오늘 이미 받은 종목)
      if (s.startsWith('SELECT symbol FROM us_fundamentals_snapshot')) {
        // 🔴 (Reviewer M-1) 날짜 조건이 **정확히** `= CURDATE()` 일 때만 오늘 수집분이다.
        //   그 밖(`<= CURDATE()`·조건 없음 등)은 실 DB 처럼 **어제 행까지** 섞어 준다.
        if (s === DONE_TODAY_SQL) return [doneToday.map((symbol) => ({ symbol })) as T, undefined];
        const loose = [...new Set([...doneToday, ...yesterday])];
        return [loose.map((symbol) => ({ symbol })) as T, undefined];
      }
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

describe('🔴 T-145 ⑨ — 1회 마감(기본 90초) + DB 이어받기', () => {
  /** 종목 하나 처리마다 `stepMs` 만큼 가는 가짜 시계. */
  function clock(stepMs: number) {
    let t = 1_000_000;
    return { now: () => t, tick: () => { t += stepMs; } };
  }

  test('🔴 마감을 넘기면 끊고 **실패가 아니다** — ok:true · complete:false · partial:true · remaining 정확', async () => {
    process.env.OVERSEAS_UNIVERSE_SYMBOLS = 'NAS:AAPL,NAS:INTC,NAS:MU,NAS:NVDA';
    const d = db(['us_fundamentals_snapshot']);
    const c = clock(40_000);                       // 종목당 40초
    detailMock.mockImplementation(async (sym: string) => { c.tick(); return detail(sym); });
    const r = await runKisFundamentalsSnapshot({ db: d.q, log: () => undefined, nowMs: c.now, budgetMs: 90_000 });
    // 1번째(0초) → 2번째(40초) → 3번째 앞에서 80초 → 4번째 앞에서 120초 ≥ 90 → 끊는다
    expect(r).toMatchObject({
      ok: true, stopped: 'budget', complete: false, partial: true, remaining: 1, written: 3, targets: 4,
    });
    expect(r.aborted).toBeUndefined();             // 유량 중단과 구분된다
    expect(detailMock).toHaveBeenCalledTimes(3);
    expect(d.inserts()).toHaveLength(3);
  });

  test('마감 안에 끝나면 complete:true · remaining:0 · partial 없음', async () => {
    process.env.OVERSEAS_UNIVERSE_SYMBOLS = 'NAS:AAPL,NAS:INTC';
    const d = db(['us_fundamentals_snapshot']);
    const c = clock(1_000);
    detailMock.mockImplementation(async (sym: string) => { c.tick(); return detail(sym); });
    const r = await runKisFundamentalsSnapshot({ db: d.q, log: () => undefined, nowMs: c.now, budgetMs: 90_000 });
    expect(r).toMatchObject({ ok: true, complete: true, remaining: 0, written: 2 });
    expect(r.partial).toBeUndefined();
    expect(r.stopped).toBeUndefined();
  });

  test('🔴 오늘 행이 있는 종목은 **다시 부르지 않는다**(이어받기 — 새 상태를 만들지 않는다)', async () => {
    process.env.OVERSEAS_UNIVERSE_SYMBOLS = 'NAS:AAPL,NAS:INTC,NAS:MU';
    const d = db(['us_fundamentals_snapshot'], [], [], ['NAS:AAPL', 'NAS:MU']);
    const order: string[] = [];
    detailMock.mockImplementation(async (sym: string) => { order.push(sym); return detail(sym); });
    const r = await runKisFundamentalsSnapshot({ db: d.q, log: () => undefined });
    expect(order).toEqual(['NAS:INTC']);
    expect(r).toMatchObject({ ok: true, targets: 3, alreadyDone: 2, written: 1, complete: true, remaining: 0 });
  });

  test('오늘 행이 전부 있으면 KIS 호출 0 으로 즉시 끝난다(창의 남은 틱이 싸게 끝나는 근거)', async () => {
    process.env.OVERSEAS_UNIVERSE_SYMBOLS = 'NAS:AAPL,NAS:INTC';
    const d = db(['us_fundamentals_snapshot'], [], [], ['NAS:AAPL', 'NAS:INTC']);
    const r = await runKisFundamentalsSnapshot({ db: d.q, log: () => undefined });
    expect(detailMock).not.toHaveBeenCalled();
    expect(d.inserts()).toHaveLength(0);
    expect(r).toMatchObject({ ok: true, targets: 2, alreadyDone: 2, written: 0, complete: true, remaining: 0 });
  });

  test('🔴 마감 종료와 유량 중단이 구분된다 — 유량은 ok:false·aborted 이고 partial 을 싣지 않는다', async () => {
    process.env.OVERSEAS_UNIVERSE_SYMBOLS = 'NAS:AAPL,NAS:INTC,NAS:MU';
    const d = db(['us_fundamentals_snapshot']);
    detailMock.mockImplementation(async () => { throw Object.assign(new Error('timeout'), { name: 'KisThrottleTimeoutError' }); });
    const r = await runKisFundamentalsSnapshot({ db: d.q, log: () => undefined });
    expect(r).toMatchObject({ ok: false, aborted: 'kis_throttle', complete: false, remaining: 3 });
    expect(r.stopped).toBeUndefined();
    expect(r.partial).toBeUndefined();             // ok:false 는 classifyRun 이 failed 로 남긴다(partial 과 섞지 않는다)
  });

  test('🔴 앞 조회가 마감을 다 써도 **한 종목은 처리한다** — 진행이 0인 고리가 생기지 않는다', async () => {
    process.env.OVERSEAS_UNIVERSE_SYMBOLS = 'NAS:AAPL,NAS:INTC,NAS:MU';
    const d = db(['us_fundamentals_snapshot']);
    detailMock.mockImplementation(async (sym: string) => detail(sym));
    // 첫 호출(= t0 기록)은 1,000,000 이고 그 뒤 모든 조회는 +60초다 → **첫 종목 앞에서 이미 마감 초과** 상태다
    let n = 0;
    const nowMs = () => (n++ === 0 ? 1_000_000 : 1_060_000);
    const r = await runKisFundamentalsSnapshot({ db: d.q, log: () => undefined, nowMs, budgetMs: 1_000 });
    expect(r).toMatchObject({ ok: true, stopped: 'budget', complete: false, remaining: 2, written: 1 });
    expect(detailMock).toHaveBeenCalledTimes(1);
  });

  test('오늘 수집분 조회가 실패하면 **전부 다시 돈다**(덜 하는 쪽이 아니라 더 하는 쪽으로 틀린다)', async () => {
    process.env.OVERSEAS_UNIVERSE_SYMBOLS = 'NAS:AAPL,NAS:INTC';
    const d = db(['us_fundamentals_snapshot'], [], [], ['NAS:AAPL']);
    const orig = d.q.query.bind(d.q);
    d.q.query = (async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM us_fundamentals_snapshot WHERE snapshot_date')) throw Object.assign(new Error('x'), { code: 'ER_LOCK_WAIT_TIMEOUT' });
      return orig(sql, params);
    }) as typeof d.q.query;
    detailMock.mockImplementation(async (sym: string) => detail(sym));
    const r = await runKisFundamentalsSnapshot({ db: d.q, log: () => undefined });
    expect(r).toMatchObject({ ok: true, alreadyDone: 0, written: 2 });
  });

  test('마감 기본값은 90초이고 환경변수로만 바꾼다(코드에 적힌 값)', () => {
    expect(SNAPSHOT_DEFAULT_BUDGET_MS).toBe(90_000);
  });

  test('`KIS_FUND_BUDGET_MS` 가 양의 정수가 아니면 기본값을 쓴다', async () => {
    process.env.OVERSEAS_UNIVERSE_SYMBOLS = 'NAS:AAPL,NAS:INTC,NAS:MU';
    const ORIG_B = process.env.KIS_FUND_BUDGET_MS;
    try {
      for (const bad of ['0', '-5', 'abc', '']) {
        process.env.KIS_FUND_BUDGET_MS = bad;
        const d = db(['us_fundamentals_snapshot']);
        const c = clock(40_000);                   // 종목당 40초 → 기본 90초면 3번째 앞에서 80초라 계속, 4번째 없음
        detailMock.mockReset();
        detailMock.mockImplementation(async (sym: string) => { c.tick(); return detail(sym); });
        const r = await runKisFundamentalsSnapshot({ db: d.q, log: () => undefined, nowMs: c.now });
        expect(r).toMatchObject({ complete: true, written: 3 });
      }
      process.env.KIS_FUND_BUDGET_MS = '50000';    // 50초 → 2번째 뒤 80초에서 끊는다
      const d2 = db(['us_fundamentals_snapshot']);
      const c2 = clock(40_000);
      detailMock.mockReset();
      detailMock.mockImplementation(async (sym: string) => { c2.tick(); return detail(sym); });
      const r2 = await runKisFundamentalsSnapshot({ db: d2.q, log: () => undefined, nowMs: c2.now });
      expect(r2).toMatchObject({ stopped: 'budget', written: 2, remaining: 1 });
    } finally {
      if (ORIG_B === undefined) delete process.env.KIS_FUND_BUDGET_MS; else process.env.KIS_FUND_BUDGET_MS = ORIG_B;
    }
  });
});

describe('🔴 (Reviewer M-1) 이어받기 질의의 날짜 조건', () => {
  it('🔴 보내는 질의는 **오늘 하루**만 본다 — `= CURDATE()` 이고 `<=`·`>=`·BETWEEN 이 아니다', async () => {
    const d = db(['us_fundamentals_snapshot']);
    detailMock.mockImplementation(async (sym: string) => detail(sym));
    await runKisFundamentalsSnapshot({ db: d.q, log: () => undefined });
    const q = d.log.filter((l) => l.sql.startsWith('SELECT symbol FROM us_fundamentals_snapshot'));
    expect(q).toHaveLength(1);                               // 실행마다 한 번만 읽는다
    expect(q[0].sql).toBe(DONE_TODAY_SQL);
    expect(q[0].sql).toMatch(/WHERE snapshot_date = CURDATE\(\)$/);
    for (const bad of ['<=', '>=', '<', '>', 'BETWEEN', 'DATE_SUB', 'INTERVAL']) {
      expect(q[0].sql).not.toContain(bad);
    }
  });

  it('🔴 어제 행은 「완료」가 아니다 — 날짜 조건이 느슨해지면 그날 수집이 통째로 멈춘다', async () => {
    process.env.OVERSEAS_UNIVERSE_SYMBOLS = 'NAS:AAPL,NAS:INTC';
    // 대역은 느슨한 질의에만 어제 행을 준다. 구현이 `= CURDATE()` 를 쓰므로 **어제 행이 섞이지 않는다**
    const d = db(['us_fundamentals_snapshot'], [], [], [], ['NAS:AAPL', 'NAS:INTC']);
    detailMock.mockImplementation(async (sym: string) => detail(sym));
    const r = await runKisFundamentalsSnapshot({ db: d.q, log: () => undefined });
    expect(r).toMatchObject({ ok: true, targets: 2, alreadyDone: 0, written: 2, complete: true });
    expect(detailMock).toHaveBeenCalledTimes(2);
    // 느슨해진 질의였다면 이 값들이 0·2 가 된다(= 조용히 멈춘다)
    expect(r.written).not.toBe(0);
    expect(r.alreadyDone).not.toBe(2);
  });

  it('(대역 자가 점검) 느슨한 질의에는 대역이 실제로 어제 행을 준다 — 변이 감도의 근거', async () => {
    const d = db(['us_fundamentals_snapshot'], [], [], [], ['NAS:AAPL']);
    const [loose] = await d.q.query<Array<{ symbol: string }>>(
      'SELECT symbol FROM us_fundamentals_snapshot WHERE snapshot_date <= CURDATE()',
    );
    expect(loose.map((x) => x.symbol)).toEqual(['NAS:AAPL']);
    const [exact] = await d.q.query<Array<{ symbol: string }>>(DONE_TODAY_SQL);
    expect(exact).toEqual([]);
  });
});

describe('🔴 (Reviewer L-7) `KIS_FUND_BUDGET_MS` 상한·하한 클램프', () => {
  const ORIG_B = process.env.KIS_FUND_BUDGET_MS;
  afterEach(() => {
    if (ORIG_B === undefined) delete process.env.KIS_FUND_BUDGET_MS; else process.env.KIS_FUND_BUDGET_MS = ORIG_B;
  });

  /** 마감이 실제로 몇 ms 로 쓰였나 — 종목당 `stepMs` 로 시계를 밀어 **몇 종목에서 끊기는지**로 역산한다. */
  async function writtenWith(stepMs: number, symbols: number): Promise<{ written: number; stopped?: string }> {
    process.env.OVERSEAS_UNIVERSE_SYMBOLS = Array.from({ length: symbols }, (_, i) => `NAS:S${String(i).padStart(3, '0')}`).join(',');
    const d = db(['us_fundamentals_snapshot'], [], [], [], []);
    let t = 1_000_000;
    detailMock.mockReset();
    detailMock.mockImplementation(async (sym: string) => { t += stepMs; return detail(sym); });
    const r = await runKisFundamentalsSnapshot({ db: d.q, log: () => undefined, nowMs: () => t });
    return { written: r.written ?? -1, stopped: r.stopped };
  }

  it('🔴 상한을 넘기면 상한으로 줄이고 **경고를 남긴다** — 조용히 무시하지 않는다', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    process.env.KIS_FUND_BUDGET_MS = '600000';                 // 10분 — 러너 curl 상한 110초를 크게 넘는다
    // 종목당 10초 · 40종목 → 상한 100초면 11번째 앞에서 끊긴다(100초 ≥ 100초). 600초였다면 40개 전부 처리된다
    const r = await writtenWith(10_000, 40);
    expect(r.stopped).toBe('budget');
    expect(r.written).toBe(10);
    expect(r.written).not.toBe(40);                            // 상한이 없으면 이 값이 40 이 된다
    const msg = warn.mock.calls.flat().join(' ');
    expect(msg).toContain('KIS_FUND_BUDGET_MS');
    expect(msg).toContain('600000');                           // 운영자가 넣은 값
    expect(msg).toContain(String(SNAPSHOT_MAX_BUDGET_MS));     // 실제로 쓰인 값
    expect(msg).toMatch(/already_running|창이 멈/);             // 왜 위험한지도 말한다
    warn.mockRestore();
  });

  it('🔴 하한보다 작으면 하한으로 올리고 경고를 남긴다', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    process.env.KIS_FUND_BUDGET_MS = '1000';                   // 1초
    // 종목당 10초 → 하한 30초면 4번째 앞에서 끊긴다. 1초였다면 첫 종목만(i>0 가드) 처리된다
    const r = await writtenWith(10_000, 40);
    expect(r.stopped).toBe('budget');
    expect(r.written).toBe(3);
    expect(r.written).not.toBe(1);
    const msg = warn.mock.calls.flat().join(' ');
    expect(msg).toContain('KIS_FUND_BUDGET_MS');
    expect(msg).toContain('1000');
    expect(msg).toContain(String(SNAPSHOT_MIN_BUDGET_MS));
    expect(msg).toMatch(/끝나지 않/);
    warn.mockRestore();
  });

  it('범위 안의 값은 그대로 쓰고 경고가 없다', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    process.env.KIS_FUND_BUDGET_MS = '50000';                  // 50초 — 종목당 10초면 6번째 앞에서 끊긴다
    const r = await writtenWith(10_000, 40);
    expect([r.stopped, r.written]).toEqual(['budget', 5]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('경계값(상한·하한 그 자체)은 클램프되지 않는다', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const v of [SNAPSHOT_MIN_BUDGET_MS, SNAPSHOT_MAX_BUDGET_MS, SNAPSHOT_DEFAULT_BUDGET_MS]) {
      process.env.KIS_FUND_BUDGET_MS = String(v);
      await writtenWith(10_000, 40);
    }
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('🔴 상한·하한·기본값의 관계가 코드에 고정돼 있다 — 상한은 러너 curl 상한(110초) 안이어야 한다', () => {
    expect(SNAPSHOT_MIN_BUDGET_MS).toBe(30_000);
    expect(SNAPSHOT_DEFAULT_BUDGET_MS).toBe(90_000);
    expect(SNAPSHOT_MAX_BUDGET_MS).toBe(100_000);
    expect(SNAPSHOT_MIN_BUDGET_MS).toBeLessThan(SNAPSHOT_DEFAULT_BUDGET_MS);
    expect(SNAPSHOT_DEFAULT_BUDGET_MS).toBeLessThanOrEqual(SNAPSHOT_MAX_BUDGET_MS);
    expect(SNAPSHOT_MAX_BUDGET_MS).toBeLessThan(110_000);      // KIS_FUND_CURL_MAX_TIME=110초
  });

  it('🔴 `.env.example` 이 이 변수와 기본값·클램프 범위를 적고 있다(환경변수는 훅이 막지 못한다)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const env = fs.readFileSync(path.join(process.cwd(), '.env.example'), 'utf8');
    expect(env).toContain('KIS_FUND_BUDGET_MS=');
    expect(env).toContain(String(SNAPSHOT_DEFAULT_BUDGET_MS));
    expect(env).toContain(String(SNAPSHOT_MIN_BUDGET_MS));
    expect(env).toContain(String(SNAPSHOT_MAX_BUDGET_MS));
  });
});
