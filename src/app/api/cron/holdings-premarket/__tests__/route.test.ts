/**
 * /api/cron/holdings-premarket — T-119 보유 종목 개장 전 공시 체크포인트 라우트 시험.
 *
 * 실제 corp-intel 모듈·실제 SecClient·parseSubmissions 를 쓰고, DB(가짜 풀 — 표 5개를 메모리로 흉내)·전역 fetch(SEC)·알림 발송만 가짜로 바꾼다.
 * 외부 호출 없음 — fetch 는 대역, 알림은 `dispatchAlert` 목.
 *  1. 인증 401(본체·DB·SEC 0) · 스위치 꺼짐/키 없음/해석 불가 → SEC 0 · UA 없음 → SEC 0
 *  2. 보유 0건 → no_holdings · 오래된/없는 스냅샷 → stale_holdings (SEC 0)
 *  3. 새 공시 → ci_raw_item 1행 + 알림 1건 · 같은 공시 재실행 → 알림 0·first_seen_at 불변 · 24시간 지난 공시·us_filings 에 있는 공시 → 알림 0
 *  4. SecBlockedError(429)·HTTP 500·타임아웃(Abort) → 상태 갱신·연속 실패 알림(2회째, ET 하루 1건)
 *  5. 테이블 없음(ci_raw_item·symbol_cik_map) · 🔴 us_filings 쓰기 0(모든 시나리오) · 요청 수 상한 8 · 10건 초과 요약 1건
 *  6. T-175 알림 재시도 — 실패 후 재시도 성공 · 전부 실패(3회, 식별자 로그) · 첫 시도 성공 시 1회 · 채널 없음 재시도 없음 · 시간 예산 · 요약 실패
 *     (재시도 간격 sleep 만 기록용 가짜로 바꾼다 — 재시도 규칙·예산 판단은 실제 `@/lib/notify/send-retry`)
 */
import { NextResponse, type NextRequest } from 'next/server';
import { __resetSecBlockStateForTest } from '@/lib/data/us-edgar/sec-client';

const authMock = jest.fn();
const dispatchMock = jest.fn();
jest.mock('@/lib/cron-auth', () => ({ checkCronAuth: (...a: unknown[]) => authMock(...a) }));
jest.mock('@/lib/notify', () => ({ dispatchAlert: (...a: unknown[]) => dispatchMock(...a) }));
// T-175 — 재시도 간격(2·5초)을 실제로 기다리지 않게 sleep 만 바꾼다. 간격 값은 기록해 확인한다.
const mockRetrySleeps: number[] = [];
jest.mock('@/lib/notify/send-retry', () => {
  const actual = jest.requireActual('@/lib/notify/send-retry');
  return {
    ...actual,
    sendWithRetry: (send: unknown, o: Record<string, unknown>) =>
      actual.sendWithRetry(send, { ...o, sleep: async (ms: number) => { mockRetrySleeps.push(ms); } }),
  };
});

// ── 가짜 DB ─────────────────────────────────────────────────────────────────
interface CiRow { key: string; first: string; last: string; values: unknown[] }
interface FakeState {
  config: Map<string, unknown>;
  snapshot: { ts: Date; positions: unknown } | null;
  cikMap: Array<{ symbol: string; cik: number }>;
  usFilings: Set<string>;
  ci: Map<string, CiRow>;
  noTable: Set<string>;
  sql: string[];
}
let st: FakeState;
const noTable = () => Object.assign(new Error('no table'), { code: 'ER_NO_SUCH_TABLE', errno: 1146 });
async function fakeQuery(sql: string, params: unknown[] = []): Promise<unknown> {
  st.sql.push(sql);
  const s = sql.replace(/\s+/g, ' ').trim();
  if (s.startsWith('SELECT value FROM system_config')) {
    const k = params[0] as string;
    return [st.config.has(k) ? [{ value: st.config.get(k) }] : []];
  }
  if (s.startsWith('INSERT INTO system_config')) {
    st.config.set(params[0] as string, params[1]);
    return [{ affectedRows: 1 }];
  }
  if (s.startsWith('SELECT ts, positions FROM portfolio_snapshots')) {
    if (st.noTable.has('portfolio_snapshots')) throw new Error('db down');
    return [st.snapshot ? [st.snapshot] : []];
  }
  if (s.startsWith('SELECT symbol, cik FROM symbol_cik_map')) {
    if (st.noTable.has('symbol_cik_map')) throw noTable();
    const want = params[0] as string[];
    return [st.cikMap.filter((r) => want.includes(r.symbol))];
  }
  if (s.startsWith('SELECT accession FROM us_filings')) {
    return [(params[0] as string[]).filter((a) => st.usFilings.has(a)).map((accession) => ({ accession }))];
  }
  if (s.startsWith('SELECT source_key FROM ci_raw_item')) {
    if (st.noTable.has('ci_raw_item')) throw noTable();
    return [(params[0] as string[]).filter((a) => st.ci.has(a)).map((source_key) => ({ source_key }))];
  }
  if (s.startsWith('INSERT INTO ci_raw_item')) {
    if (st.noTable.has('ci_raw_item')) throw noTable();
    const rows = params[0] as unknown[][];
    let affected = 0;
    for (const v of rows) {
      const key = v[1] as string;
      const prev = st.ci.get(key);
      if (prev) {
        // ON DUPLICATE KEY UPDATE last_seen_at = VALUES(last_seen_at) — first_seen_at 은 그대로
        affected += prev.last === v[7] ? 1 : 2;   // mysql2 FOUND_ROWS: 안 바뀐 기존 행도 1
        prev.last = v[7] as string;
      } else {
        st.ci.set(key, { key, first: v[6] as string, last: v[7] as string, values: v });
        affected += 1;
      }
    }
    return [{ affectedRows: affected }];
  }
  throw new Error(`fake db: unexpected SQL ${s.slice(0, 80)}`);
}
jest.mock('@/lib/db', () => ({ getPool: () => ({ query: (sql: string, p?: unknown[]) => fakeQuery(sql, p) }) }));

// ── 가짜 SEC ────────────────────────────────────────────────────────────────
interface SubFiling { accession: string; form: string; items?: string; acceptedAt: string | null; filed?: string; doc?: string }
let secPlan: Map<number, SubFiling[] | number | 'abort'>;
const secCalls: string[] = [];
function submissions(cik: number, list: SubFiling[]) {
  return {
    cik: String(cik), name: `CO ${cik}`, entityType: 'operating', tickers: [],
    filings: {
      recent: {
        accessionNumber: list.map((x) => x.accession),
        filingDate: list.map((x) => x.filed ?? (x.acceptedAt ?? '2026-01-01').slice(0, 10)),
        reportDate: list.map(() => ''),
        acceptanceDateTime: list.map((x) => x.acceptedAt ?? ''),
        form: list.map((x) => x.form),
        items: list.map((x) => x.items ?? ''),
        primaryDocument: list.map((x) => x.doc ?? 'doc.htm'),
      },
    },
  };
}
const fetchMock = jest.fn(async (url: string) => {
  secCalls.push(url);
  const m = /CIK(\d{10})\.json$/.exec(url);
  const cik = m ? Number(m[1]) : -1;
  const plan = secPlan.get(cik);
  if (plan === 'abort') throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  if (typeof plan === 'number') return new Response('x', { status: plan });
  if (!plan) return new Response('nf', { status: 404 });
  return new Response(JSON.stringify(submissions(cik, plan)), { status: 200 });
});

const req = {} as NextRequest;
/** 라우트가 쓰는 것과 같은 모듈 레지스트리의 sec-client 쿨다운을 비운다(beforeEach 의 resetModules 뒤 라우트는 새 인스턴스를 쓴다). */
async function resetBlockInRouteRegistry() {
  (await import('@/lib/data/us-edgar/sec-client')).__resetSecBlockStateForTest();
}
const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString().replace(/\.\d{3}Z$/, '.000Z');
const H = 3600_000;
const POS = (syms: string[]) => [
  { currency: 'KRW', qty: 100000, price: 1, value_krw: 100000 },
  { currency: 'USD', qty: 10, price: 1400, value_krw: 14000 },
  ...syms.map((s) => ({ currency: s, qty: 1, price: 100000, value_krw: 100000 })),
];
const AAPL = 320193;
const MSFT = 789019;

function reset(opts: { switchVal?: unknown | null; holdings?: string[]; snapshotAgeMs?: number } = {}) {
  st = {
    config: new Map(),
    snapshot: { ts: new Date(Date.now() - (opts.snapshotAgeMs ?? 30 * 60_000)), positions: JSON.stringify(POS(opts.holdings ?? ['NAS:AAPL', 'NAS:MSFT'])) },
    cikMap: [{ symbol: 'NAS:AAPL', cik: AAPL }, { symbol: 'NAS:MSFT', cik: MSFT }],
    usFilings: new Set(),
    ci: new Map(),
    noTable: new Set(),
    sql: [],
  };
  if (opts.switchVal !== null) st.config.set('holdings_premarket_enabled', opts.switchVal === undefined ? 'true' : opts.switchVal);
  secPlan = new Map([[AAPL, []], [MSFT, []]]);
}

async function call() {
  const { POST } = await import('../route');
  const res = await POST(req);
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}
const status = () => {
  const v = st.config.get('holdings_premarket_status');
  return v ? JSON.parse(String(v)) as Record<string, unknown> : null;
};
/** 🔴 us_filings 에 대한 쓰기 문장이 하나라도 있었는가 */
const usFilingsWrites = () => st.sql.filter((s) => /\b(INSERT|UPDATE|DELETE|REPLACE)\b[\s\S]*\bus_filings\b/i.test(s));

let realFetch: typeof globalThis.fetch;
beforeEach(() => {
  jest.resetModules();
  __resetSecBlockStateForTest();
  authMock.mockReset().mockReturnValue(undefined);
  dispatchMock.mockReset().mockResolvedValue({ channel: 'both', delivered: ['telegram'], failed: [], unconfigured: [] });
  fetchMock.mockClear();
  secCalls.length = 0;
  mockRetrySleeps.length = 0;
  realFetch = globalThis.fetch;
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  process.env.SEC_USER_AGENT = 'StockInvest test ops@example.com';
  reset();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  globalThis.fetch = realFetch;
  jest.restoreAllMocks();
  // 모든 시나리오 공통 불변식
  expect(usFilingsWrites()).toEqual([]);
});

describe('관문 — 인증·스위치·UA·보유', () => {
  test('🔴 인증 실패 → 401, DB·SEC·알림 0', async () => {
    authMock.mockReturnValue(NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 }));
    const r = await call();
    expect(r.status).toBe(401);
    expect(st.sql).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  test.each([
    ['키 없음', null], ['false', 'false'], ['"true" 문자열', '"true"'], ['해석 불가', 'yes'], ['1', '1'],
  ])('🔴 스위치 %s → {ok:true, skipped:switch_off}, SEC 0·알림 0·보유 읽기 0', async (_n, v) => {
    reset({ switchVal: v });
    const r = await call();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, skipped: 'switch_off', status: 'switch_off' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(st.sql.some((s) => /portfolio_snapshots|symbol_cik_map|ci_raw_item|us_filings/.test(s))).toBe(false);
    expect(status()).toMatchObject({ status: 'switch_off', consecutiveFailures: 0 });
  });

  test('SEC_USER_AGENT 없음·@ 없음 → no_user_agent, SEC 0', async () => {
    for (const ua of [undefined, 'no-email']) {
      if (ua === undefined) delete process.env.SEC_USER_AGENT; else process.env.SEC_USER_AGENT = ua;
      reset();
      const r = await call();
      expect(r.body).toMatchObject({ ok: true, status: 'no_user_agent' });
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  test('미국 보유 0건 → no_holdings, SEC 0', async () => {
    reset({ holdings: [] });
    const r = await call();
    expect(r.body).toMatchObject({ ok: true, status: 'no_holdings', holdings: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('스냅샷 3시간 초과·없음 → stale_holdings, SEC 0', async () => {
    reset({ snapshotAgeMs: 3 * H + 60_000 });
    let r = await call();
    expect(r.body).toMatchObject({ ok: true, status: 'stale_holdings' });
    reset();
    st.snapshot = null;
    r = await call();
    expect(r.body).toMatchObject({ ok: true, status: 'stale_holdings', detail: 'snapshot_age=none' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('CIK 매핑 없는 보유 종목은 SEC 를 부르지 않고 unmapped 로 보고', async () => {
    reset({ holdings: ['NAS:AAPL', 'AMS:SPY'] });
    const r = await call();
    expect(r.body).toMatchObject({ status: 'ok', holdings: 2, checked: 1, unmapped: ['AMS:SPY'] });
    expect(secCalls).toEqual(['https://data.sec.gov/submissions/CIK0000320193.json']);
  });
});

describe('🔴 새 공시 판정·기록·알림', () => {
  test('새 공시 → ci_raw_item 1행 + 알림 1건(info) · 같은 공시 재실행 → 알림 0·first_seen_at 불변', async () => {
    secPlan.set(AAPL, [
      { accession: '0000320193-26-000101', form: '8-K', items: '2.02,9.01', acceptedAt: iso(-1 * H), doc: 'a8k.htm' },
      { accession: '0000320193-26-000050', form: '4', acceptedAt: iso(-1 * H) },   // us_filings 양식 집합 밖 → 무시
    ]);
    const r1 = await call();
    expect(r1.status).toBe(200);
    expect(r1.body).toMatchObject({ ok: true, status: 'ok', holdings: 2, checked: 2, newFilings: 1, alerted: 1, requests: 2 });
    expect(st.ci.size).toBe(1);
    const row = st.ci.get('0000320193-26-000101')!;
    expect(row.values[0]).toBe('sec_filing');
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    const [level, title, body] = dispatchMock.mock.calls[0];
    expect(level).toBe('info');
    expect(title).toBe('보유 종목 개장 전 공시');
    // 접수 시각이 실제 시계 now−1h 라 ET·KST 날짜 경계(KST 13~14시·00~01시)에서는 모듈이 의도대로 날짜(MM-DD)를 붙인다 — 날짜 접두는 선택(T-119 QA 결함 #1)
    expect(body).toMatch(/^AAPL 8-K\(실적 발표 Item 2\.02\) — 접수 ET (?:\d{2}-\d{2} )?\d{2}:\d{2} \(KST (?:\d{2}-\d{2} )?\d{2}:\d{2}\)\. 분석에 아직 반영되지 않은 새 공시입니다\. 알림만, 주문 없음\.\n/);
    expect(body).toContain('https://www.sec.gov/Archives/edgar/data/320193/000032019326000101/a8k.htm');
    const firstSeen = row.first;

    await new Promise((r) => setTimeout(r, 1100));   // 다른 초 — last_seen_at 갱신
    const r2 = await call();
    expect(r2.body).toMatchObject({ status: 'ok', newFilings: 0, alerted: 0, alreadyCaptured: 1 });
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(st.ci.get('0000320193-26-000101')!.first).toBe(firstSeen);
    expect(st.ci.get('0000320193-26-000101')!.last >= firstSeen).toBe(true);
  });

  test('24시간 지난 공시·us_filings 에 이미 있는 공시 → 기록·알림 0', async () => {
    secPlan.set(AAPL, [
      { accession: '0000320193-26-000201', form: '10-Q', acceptedAt: iso(-25 * H) },
      { accession: '0000320193-26-000202', form: '8-K', acceptedAt: iso(-2 * H) },
    ]);
    st.usFilings.add('0000320193-26-000202');
    const r = await call();
    expect(r.body).toMatchObject({ status: 'ok', newFilings: 0, alerted: 0, outOfWindow: 1, inUsFilings: 1 });
    expect(st.ci.size).toBe(0);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  test('같은 CIK 를 공유하는 두 심볼(GOOG·GOOGL) → SEC 1회·알림 1건에 두 티커', async () => {
    reset({ holdings: ['NAS:GOOG', 'NAS:GOOGL'] });
    st.cikMap = [{ symbol: 'NAS:GOOG', cik: 1652044 }, { symbol: 'NAS:GOOGL', cik: 1652044 }];
    secPlan = new Map([[1652044, [{ accession: '0001652044-26-000010', form: '8-K', items: '7.01', acceptedAt: iso(-H) }]]]);
    const r = await call();
    expect(r.body).toMatchObject({ checked: 1, newFilings: 1, alerted: 1, requests: 1 });
    expect(dispatchMock.mock.calls[0][2]).toMatch(/^GOOG·GOOGL 8-K — 접수/);
  });

  test('10건 초과 → 요약 1건만', async () => {
    secPlan.set(AAPL, Array.from({ length: 11 }, (_, i) => ({
      accession: `0000320193-26-0003${String(i).padStart(2, '0')}`, form: '8-K', acceptedAt: iso(-H - i * 60_000),
    })));
    const r = await call();
    expect(r.body).toMatchObject({ newFilings: 11, alerted: 1 });
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock.mock.calls[0][1]).toBe('보유 종목 개장 전 공시 11건(요약)');
  });

  test('알림이 전달되지 않으면 failed(alert_undelivered) — 행은 남는다', async () => {
    secPlan.set(AAPL, [{ accession: '0000320193-26-000401', form: '8-K', acceptedAt: iso(-H) }]);
    dispatchMock.mockResolvedValue({ channel: 'both', delivered: [], failed: [{ channel: 'telegram', error: 'x' }], unconfigured: [] });
    const r = await call();
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ ok: false, status: 'failed', newFilings: 1, alerted: 0 });
    expect(String(r.body.detail)).toContain('alert_undelivered=1');
  });

  test('ci_raw_item 테이블 없음 → skipped_no_table, 알림 0', async () => {
    secPlan.set(AAPL, [{ accession: '0000320193-26-000501', form: '8-K', acceptedAt: iso(-H) }]);
    st.noTable.add('ci_raw_item');
    const r = await call();
    expect(r.body).toMatchObject({ ok: true, status: 'skipped_no_table', alerted: 0 });
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  test('symbol_cik_map 테이블 없음 → skipped_no_table, SEC 0', async () => {
    st.noTable.add('symbol_cik_map');
    const r = await call();
    expect(r.body).toMatchObject({ ok: true, status: 'skipped_no_table', detail: 'symbol_cik_map' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('🔴 SEC 실패·상한·연속 실패 알림', () => {
  test('429 → blocked, 즉시 중단(다음 CIK 안 부름) · 503', async () => {
    secPlan.set(AAPL, 429);
    const r = await call();
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ ok: false, status: 'blocked', requests: 1 });
    expect(secCalls).toHaveLength(1);
    expect(status()).toMatchObject({ status: 'blocked', consecutiveFailures: 1 });
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  test('HTTP 500(재시도 1회 포함) → 그 종목만 건너뛰고 failed, 다른 종목은 확인', async () => {
    secPlan.set(AAPL, 500);
    secPlan.set(MSFT, [{ accession: '0000789019-26-000001', form: '8-K', acceptedAt: iso(-H) }]);
    const r = await call();
    expect(r.body).toMatchObject({ ok: false, status: 'failed', checked: 2, newFilings: 1, alerted: 1, requests: 3 });
    expect(String(r.body.detail)).toContain('cik_failed=320193:SecHttpError');
  });

  test('타임아웃(Abort) → failed', async () => {
    secPlan.set(AAPL, 'abort');
    const r = await call();
    expect(r.body).toMatchObject({ status: 'failed' });
  });

  test('연속 2회 실패 → 실패 알림(warning) 1건, 같은 ET 날 다시 실패해도 추가 실패 알림 없음, 성공하면 0 으로', async () => {
    secPlan.set(AAPL, 429);
    await call();
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(secCalls).toHaveLength(1);
    await resetBlockInRouteRegistry();
    await call();
    expect(secCalls).toHaveLength(2);   // 쿨다운이 아니라 실제 429 를 다시 받았다
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock.mock.calls[0][0]).toBe('warning');
    expect(dispatchMock.mock.calls[0][1]).toBe('보유 종목 개장 전 공시 확인 실패');
    expect(status()).toMatchObject({ consecutiveFailures: 2, failureAlertEtDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    await resetBlockInRouteRegistry();
    const r3 = await call();
    expect(r3.body).toMatchObject({ failureAlert: false });
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(status()).toMatchObject({ consecutiveFailures: 3 });
    secPlan.set(AAPL, []);
    await resetBlockInRouteRegistry();
    await call();
    expect(status()).toMatchObject({ status: 'ok', consecutiveFailures: 0 });
  });

  test('🔴 요청 수 상한 8 — 보유 10종목(CIK 10)이어도 SEC 요청 ≤ 8, 나머지는 unchecked → failed', async () => {
    const syms = Array.from({ length: 10 }, (_, i) => `NAS:T${i}`);
    reset({ holdings: syms });
    st.cikMap = syms.map((s, i) => ({ symbol: s, cik: 1000 + i }));
    secPlan = new Map(syms.map((_, i) => [1000 + i, []]));
    const r = await call();
    expect(secCalls.length).toBeLessThanOrEqual(8);
    expect(r.body.requests).toBe(secCalls.length);
    expect(r.body).toMatchObject({ status: 'failed' });
    expect(String(r.body.detail)).toMatch(/unchecked_cap=\d+/);
  }, 20_000);

  test('손상된 positions → no_holdings(SEC 0) · 스냅샷 읽기 DB 예외 → 503 failed(상태 기록)', async () => {
    st.snapshot = { ts: new Date(), positions: '[' };
    let r = await call();
    expect(r.body).toMatchObject({ status: 'no_holdings' });
    reset();
    st.noTable.add('portfolio_snapshots');
    r = await call();
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ ok: false, status: 'failed' });
    expect(status()).toMatchObject({ status: 'failed', consecutiveFailures: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('🔴 T-175 알림 전송 재시도·미전달 식별자', () => {
  const FAIL = { channel: 'telegram', delivered: [], failed: [{ channel: 'telegram', error: 'fetch failed (ETIMEDOUT)' }], unconfigured: [] };
  const OK = { channel: 'telegram', delivered: ['telegram'], failed: [], unconfigured: [] };
  const NVDA_LIKE = { accession: '0000320193-26-000701', form: '8-K', acceptedAt: iso(-H), doc: 'n8k.htm' };
  const URL_701 = 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000701/n8k.htm';
  const undeliveredLines = () => (console.warn as jest.Mock).mock.calls.map((c) => String(c[0])).filter((l) => l.includes('HP_ALERT_UNDELIVERED'));

  test('첫 시도 실패 → 2초 뒤 재시도로 전달 → ok·alerted 1·미전달 로그 없음', async () => {
    secPlan.set(AAPL, [NVDA_LIKE]);
    dispatchMock.mockReset().mockResolvedValueOnce(FAIL).mockResolvedValueOnce(OK);
    const r = await call();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, status: 'ok', newFilings: 1, alerted: 1 });
    expect(dispatchMock).toHaveBeenCalledTimes(2);
    expect(dispatchMock.mock.calls[1]).toEqual(dispatchMock.mock.calls[0]);   // 같은 알림을 다시 보낸다
    expect(mockRetrySleeps).toEqual([2_000]);
    expect(undeliveredLines()).toEqual([]);
  });

  test('🔴 첫 시도 성공 → 1회만(중복 없음)', async () => {
    secPlan.set(AAPL, [NVDA_LIKE]);
    const r = await call();
    expect(r.body).toMatchObject({ status: 'ok', alerted: 1 });
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(mockRetrySleeps).toEqual([]);
  });

  test('🔴 끝내 실패 → 3회 시도(간격 2·5초) · 503 failed(alert_undelivered=1) · 식별자(심볼·양식·접수번호·SEC 링크) 로그', async () => {
    secPlan.set(AAPL, [NVDA_LIKE]);
    dispatchMock.mockReset().mockResolvedValue(FAIL);
    const r = await call();
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ ok: false, status: 'failed', newFilings: 1, alerted: 0 });
    expect(String(r.body.detail)).toContain('alert_undelivered=1');
    expect(dispatchMock).toHaveBeenCalledTimes(3);
    expect(mockRetrySleeps).toEqual([2_000, 5_000]);
    const lines = undeliveredLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('reason=failed');
    expect(lines[0]).toContain('symbols=NAS:AAPL');
    expect(lines[0]).toContain('form=8-K');
    expect(lines[0]).toContain('accession=0000320193-26-000701');
    expect(lines[0]).toContain(`url=${URL_701}`);
    expect(status()).toMatchObject({ status: 'failed' });
    expect(st.ci.has('0000320193-26-000701')).toBe(true);   // 행은 남는다(실행 간 재전송은 범위 밖)
  });

  test('채널 없음(notify_channel=none) → 재시도 없이 미전달', async () => {
    secPlan.set(AAPL, [NVDA_LIKE]);
    dispatchMock.mockReset().mockResolvedValue({ channel: 'none', delivered: [], failed: [], unconfigured: [] });
    const r = await call();
    expect(r.body).toMatchObject({ status: 'failed', alerted: 0 });
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(undeliveredLines()[0]).toContain('reason=unconfigured');
  });

  test('🔴 시간 예산 — 알림 단계 끝(55초)을 넘기면 새 시도를 시작하지 않는다(재시도·다음 공시 모두)', async () => {
    secPlan.set(AAPL, [NVDA_LIKE]);
    secPlan.set(MSFT, [{ accession: '0000789019-26-000702', form: '8-K', acceptedAt: iso(-H) }]);
    const realNow = Date.now.bind(Date);
    let offset = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => realNow() + offset);
    dispatchMock.mockReset().mockImplementation(async () => { offset += 30_000; return FAIL; });
    const r = await call();
    // AAPL: 시도1(→30초) · 2초 뒤 시도2 가능(32≤55)(→60초) · 5초 뒤는 예산 밖 / MSFT: 60초>55초 → 시도 0
    expect(dispatchMock).toHaveBeenCalledTimes(2);
    expect(mockRetrySleeps).toEqual([2_000]);
    expect(r.body).toMatchObject({ status: 'failed', newFilings: 2, alerted: 0 });
    expect(String(r.body.detail)).toContain('alert_undelivered=2');
    const lines = undeliveredLines();
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => /accession=(\S+)/.exec(l)?.[1]).sort()).toEqual(['0000320193-26-000701', '0000789019-26-000702']);
    expect(lines.every((l) => l.includes('reason=budget'))).toBe(true);
  });

  test('요약 알림(10건 초과)이 끝내 실패 → 새 공시 11건 전부의 식별자를 남긴다', async () => {
    secPlan.set(AAPL, Array.from({ length: 11 }, (_, i) => ({
      accession: `0000320193-26-0008${String(i).padStart(2, '0')}`, form: '8-K', acceptedAt: iso(-H - i * 60_000),
    })));
    dispatchMock.mockReset().mockResolvedValue(FAIL);
    const r = await call();
    expect(r.body).toMatchObject({ status: 'failed', newFilings: 11, alerted: 0 });
    expect(String(r.body.detail)).toContain('alert_undelivered=1');
    expect(dispatchMock).toHaveBeenCalledTimes(3);
    expect(dispatchMock.mock.calls.every((c) => c[1] === '보유 종목 개장 전 공시 11건(요약)')).toBe(true);
    const lines = undeliveredLines();
    expect(lines).toHaveLength(11);
    expect(new Set(lines.map((l) => /accession=(\S+)/.exec(l)?.[1])).size).toBe(11);
  });
});
