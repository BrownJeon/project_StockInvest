/**
 * /api/cron/news-fetch — T-118 피드별 겹침 검사를 **라우트부터** 본다(캡처 모듈은 진짜, DB 풀만 가짜 — 운영 DB 접속 없음).
 *
 * route-capture.test.ts 는 캡처 모듈을 목으로 막고 라우트 분기만 본다. 여기서는 peek·ingest 요청이 실제로
 *   스위치 읽기 → (M4) → 겹침 검사 조회 + 저장 → 상태 기록(`ci_capture_status:<market>` 의 `feeds`)
 * 까지 가는지, 그리고 그 과정이 응답·HTTP·알림·T-106 기록을 바꾸지 않는지 본다.
 *  - 이어짐(false)·gap(true)·bootstrap·skipped(조회 실패·조회 지연) · 연속 gap 수 증가·초기화
 *  - 상태 JSON 의 기존 필드 8개 유지(하위 호환) + feeds
 *  - peek 응답 형식 그대로 · ingest 응답·T-106 기록 그대로(peek 는 T-106 미호출)
 */
import type { NextRequest } from 'next/server';
import { CI_FEED_PREV_NEWEST_SQL } from '@/lib/corp-intel/feed-check';
import { CI_RAW_ITEM_UPSERT_SQL } from '@/lib/corp-intel/raw-capture';

const authMock = jest.fn();
const alertMock = jest.fn();
const healthMock = jest.fn();
const mockQuery = jest.fn();

jest.mock('@/lib/cron-auth', () => ({ checkCronAuth: (...a: unknown[]) => authMock(...a) }));
jest.mock('@/lib/notify/throttle', () => ({ sendAlertThrottled: (...a: unknown[]) => alertMock(...a), resetAlertThrottle: () => {} }));
jest.mock('@/lib/rag/news-health', () => ({ recordNewsOutcome: (...a: unknown[]) => healthMock(...a) }));
jest.mock('@/lib/db', () => ({ getPool: () => ({ query: (...a: unknown[]) => mockQuery(...a) }) }));

const CNBC = 'www.cnbc.com';
const MW = 'feeds.content.dowjones.io';
const item = (host: string, n: number, pubUtc: string) => ({
  guid: `https://${host}/a/${n}`, link: `https://${host}/a/${n}`, title: `t${n}`, published_at: pubUtc, pub_date_raw: 'x', feed_host: host,
});
// CNBC KST 06:00~08:00, MarketWatch KST 09:00~09:30
const ITEMS = [
  item(CNBC, 1, '2026-10-27T21:00:00Z'), item(CNBC, 2, '2026-10-27T23:00:00Z'),
  item(MW, 1, '2026-10-28T00:00:00Z'), item(MW, 2, '2026-10-28T00:30:00Z'),
];

interface Db { prevStatus?: unknown; feedRows?: { feed_host: string; newest: string | null }[]; feedError?: Error; feedDelay?: number }
function db(o: Db = {}) {
  mockQuery.mockImplementation((sql: string, params: unknown[]) => {
    if (sql.startsWith('SELECT value FROM system_config')) {
      if (params[0] === 'ci_capture_enabled') return Promise.resolve([[{ value: 'true' }]]);
      return Promise.resolve([o.prevStatus === undefined ? [] : [{ value: o.prevStatus }]]);
    }
    if (sql === CI_FEED_PREV_NEWEST_SQL) {
      if (o.feedError) return Promise.reject(o.feedError);
      const v = [o.feedRows ?? []];
      return o.feedDelay ? new Promise((r) => setTimeout(() => r(v), o.feedDelay)) : Promise.resolve(v);
    }
    if (sql === CI_RAW_ITEM_UPSERT_SQL) {
      const n = (params[0] as unknown[][]).length;
      return Promise.resolve([{ affectedRows: n, info: `Records: ${n}  Duplicates: 0  Warnings: 0` }]);
    }
    if (sql.startsWith('INSERT INTO system_config')) return Promise.resolve([{ affectedRows: 1 }]);
    return Promise.reject(new Error(`unexpected sql ${sql}`));
  });
}
const statusWrites = () => (mockQuery.mock.calls as [string, unknown[]][]).filter(([s]) => s.startsWith('INSERT INTO system_config'));
const statusOf = () => JSON.parse(String(statusWrites()[0][1][1])) as Record<string, unknown> & { feeds: Record<string, Record<string, unknown>> };

function reqWith(q: Record<string, string>): NextRequest {
  const url = new URL('http://localhost:3003/api/cron/news-fetch');
  for (const [k, v] of Object.entries(q)) url.searchParams.set(k, v);
  return { nextUrl: url } as unknown as NextRequest;
}
function m4ok(body: unknown) {
  const bodies: unknown[] = [];
  globalThis.fetch = jest.fn().mockImplementation(async (_u: string, init: RequestInit) => {
    bodies.push(JSON.parse(init.body as string));
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
  });
  return bodies;
}
async function runPost(q: Record<string, string>) {
  const { POST } = await import('../route');
  const p = POST(reqWith(q));
  await jest.runAllTimersAsync();
  const res = await p;
  return { res, body: (await res.json()) as Record<string, unknown> };
}

let originalFetch: typeof globalThis.fetch;
beforeEach(() => {
  jest.useFakeTimers();
  for (const m of [authMock, alertMock, healthMock, mockQuery]) m.mockReset();
  authMock.mockReturnValue(undefined);
  healthMock.mockResolvedValue({ streak: 0, alerted: false });
  originalFetch = globalThis.fetch;
  process.env.M4_ADMIN_TOKEN = 'test-admin-token';
  process.env.AI_API_BASE = 'http://m4.local:8000';
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  globalThis.fetch = originalFetch;
  jest.resetModules();
});

describe('peek → 상태 feeds (진짜 캡처 모듈, 가짜 DB)', () => {
  test('🔴 이어짐(CNBC)·gap(MarketWatch) + 연속 gap 수 증가·초기화, 기존 필드 유지, 응답 형식 그대로, T-106·알림 없음', async () => {
    db({
      prevStatus: JSON.stringify({ lastAt: 'x', mode: 'peek', status: 'ok', consecutiveFailures: 0, feeds: { [CNBC]: { consecutiveGaps: 4 }, [MW]: { consecutiveGaps: 1 } } }),
      feedRows: [{ feed_host: CNBC, newest: '2026-10-28 07:30:00' }, { feed_host: MW, newest: '2026-10-28 08:10:00' }],
    });
    m4ok({ upserted: 0, mode: 'peek', items: ITEMS });
    const { res, body } = await runPost({ market: 'overseas', mode: 'peek' });
    expect(res.status).toBe(200);
    expect(body).toEqual({
      ok: true, mode: 'peek',
      markets: [{ market: 'overseas', ok: true, upserted: 0, attempts: 1 }],
      capture: [{ market: 'overseas', status: 'ok', inserted: 4, duplicates: 0, rejected: 0 }],
    });
    const st = statusOf();
    expect(statusWrites()[0][1][0]).toBe('ci_capture_status:overseas');
    for (const k of ['lastAt', 'mode', 'status', 'fetched', 'inserted', 'duplicates', 'rejected', 'consecutiveFailures']) expect(st).toHaveProperty(k);
    expect(st).toMatchObject({ mode: 'peek', status: 'ok', fetched: 4, inserted: 4, consecutiveFailures: 0 });
    expect(st.feeds).toEqual({
      [CNBC]: { oldestPub: '2026-10-28 06:00:00', newestPub: '2026-10-28 08:00:00', items: 2, gap: false, consecutiveGaps: 0 },
      [MW]: { oldestPub: '2026-10-28 09:00:00', newestPub: '2026-10-28 09:30:00', items: 2, gap: true, consecutiveGaps: 2 },
    });
    expect(healthMock).not.toHaveBeenCalled();
    expect(alertMock).not.toHaveBeenCalled();
  });

  test('🔴 첫 캡처(직전 행 없음) → 두 피드 모두 bootstrap, 연속 gap 0', async () => {
    db();
    m4ok({ upserted: 0, items: ITEMS });
    await runPost({ market: 'overseas', mode: 'peek' });
    expect(Object.values(statusOf().feeds).map((f) => [f.gap, f.consecutiveGaps])).toEqual([['bootstrap', 0], ['bootstrap', 0]]);
  });

  test('🔴 직전 값 조회 실패 → skipped(연속 수 유지) · 저장·응답은 그대로', async () => {
    db({ prevStatus: { feeds: { [MW]: { consecutiveGaps: 3 } } }, feedError: new Error('ER_LOCK_WAIT_TIMEOUT') });
    m4ok({ upserted: 0, items: ITEMS });
    const { body } = await runPost({ market: 'overseas', mode: 'peek' });
    expect(body).toMatchObject({ ok: true, capture: [{ market: 'overseas', status: 'ok', inserted: 4 }] });
    expect(statusOf().feeds[MW]).toMatchObject({ gap: 'skipped', consecutiveGaps: 3 });
    expect(statusOf().feeds[CNBC]).toMatchObject({ gap: 'skipped', consecutiveGaps: 0 });
  });

  test('🔴 직전 값 조회 지연(3초) → 1초에 skipped, 저장·응답 ok(partial 아님)', async () => {
    db({ feedDelay: 3000 });
    m4ok({ upserted: 0, items: ITEMS });
    const { body } = await runPost({ market: 'overseas', mode: 'peek' });
    expect(body).toMatchObject({ ok: true, capture: [{ market: 'overseas', status: 'ok', inserted: 4 }] });
    expect(Object.values(statusOf().feeds).map((f) => f.gap)).toEqual(['skipped', 'skipped']);
  });
});

describe('ingest → 상태 feeds, 응답·T-106 그대로', () => {
  test('🔴 ingest(해외) + items → 응답 형식·T-106 기록 그대로, 상태에 feeds(mode ingest)', async () => {
    db({ feedRows: [{ feed_host: CNBC, newest: '2026-10-28 06:00:00' }] });
    const bodies = m4ok({ upserted: 7, fresh: 3, items: ITEMS });
    const { res, body } = await runPost({ market: 'overseas' });
    expect(res.status).toBe(200);
    expect(bodies).toEqual([{ market: 'overseas', limit: 100 }]);
    expect(body).toEqual({ ok: true, markets: [{ market: 'overseas', ok: true, upserted: 7, attempts: 1 }] });
    expect(healthMock).toHaveBeenCalledWith({ channel: 'fetch', market: 'overseas', count: 3 });
    expect(alertMock).not.toHaveBeenCalled();
    expect(statusOf()).toMatchObject({ mode: 'ingest', feeds: { [CNBC]: { gap: false }, [MW]: { gap: 'bootstrap' } } });
  });
});
