/**
 * T-118 — 피드별 겹침 검사(feed-check.ts) + 상태 `feeds`(status.ts) + 캡처 진입점 연결(raw-capture.ts) 시험.
 *
 * DB 는 목(풀·쿼리 스텁)이다 — 운영 DB 접속 없음. 검증 범위:
 *  - 순수 함수: 피드 묶기(feed_host 없는 행 제외·발행시각 없는 행은 개수만·피드 상한) · 판정(이어짐·gap·bootstrap·skipped) · 연속 gap 수
 *  - 직전 값 조회: SQL·파라미터(발행시각 하한·호스트 목록) · 값 정규화(문자열·Date·NULL·이상한 값) · 실패·상한 초과 → 전부 skipped
 *  - 캡처 진입점: 조회는 저장(INSERT)과 나란히 — `first_seen_at < 이번 캡처 시각` 으로 이번 캡처의 새 행을 뺀다 · 4초 공유 마감 안
 *    (조회는 최대 1초) · 조회가 늦거나 실패해도 저장·상태 기록은 그대로 ·
 *    상태 `feeds` 형태 · 기존 필드 8개 하위 호환 · 연속 gap 수 증가·초기화·유지 · 응답을 못 받은 시도는 직전 feeds 를 옮김
 */
import {
  CI_FEED_CHECK_TIMEOUT_MS,
  CI_FEED_LOOKBACK_DAYS,
  CI_FEED_MAX,
  CI_FEED_PREV_NEWEST_SQL,
  classifyFeeds,
  nextConsecutiveGaps,
  readPrevNewestByFeed,
  summarizeFeeds,
} from '../feed-check';
import { CI_RAW_ITEM_UPSERT_SQL, captureFetchOutcome, prepareCaptureRows } from '../raw-capture';
import { nextCaptureStatus, nextFeeds, readPrevFeeds, readPrevFailures } from '../status';

const mockQuery = jest.fn();
jest.mock('@/lib/db', () => ({ getPool: () => ({ query: (...a: unknown[]) => mockQuery(...a) }) }));

const NOW = new Date('2026-10-28T03:04:05Z'); // KST 2026-10-28 12:04:05
const later = <T>(ms: number | undefined, v: T) => (ms ? new Promise<T>((res) => setTimeout(() => res(v), ms)) : Promise.resolve(v));

interface Db {
  prevStatus?: unknown;
  feedRows?: { feed_host: string; newest: unknown }[];
  feedError?: Error;
  feedDelay?: number;
  insertDelay?: number;
  switchValue?: unknown;
}
function db(o: Db = {}) {
  mockQuery.mockImplementation((sql: string, params: unknown[]) => {
    if (sql.startsWith('SELECT value FROM system_config')) {
      if (params[0] === 'ci_capture_enabled') return Promise.resolve([[{ value: 'switchValue' in o ? o.switchValue : true }]]);
      return Promise.resolve([o.prevStatus === undefined ? [] : [{ value: o.prevStatus }]]);
    }
    if (sql === CI_FEED_PREV_NEWEST_SQL) {
      if (o.feedError) return Promise.reject(o.feedError);
      return later(o.feedDelay, [o.feedRows ?? []]);
    }
    if (sql === CI_RAW_ITEM_UPSERT_SQL) {
      const n = (params[0] as unknown[][]).length;
      return later(o.insertDelay, [{ affectedRows: n, info: `Records: ${n}  Duplicates: 0  Warnings: 0` }]);
    }
    if (sql.startsWith('INSERT INTO system_config')) return Promise.resolve([{ affectedRows: 1 }]);
    return Promise.reject(new Error(`unexpected sql ${sql}`));
  });
}
const calls = () => mockQuery.mock.calls as [string, unknown[]][];
const sqlOrder = () => calls().map(([s]) => (s === CI_FEED_PREV_NEWEST_SQL ? 'feed' : s === CI_RAW_ITEM_UPSERT_SQL ? 'insert' : s.startsWith('INSERT') ? 'status_write' : 'select_config'));
const statusWrites = () => calls().filter(([s]) => s.startsWith('INSERT INTO system_config'));
const statusOf = (i = 0) => JSON.parse(String(statusWrites()[i][1][1]));

/** 해외 피드 항목 — 발행시각은 UTC ISO(M4 계약), 저장·비교는 KST. */
const item = (host: string, n: number, pubUtc: string | null) => ({
  guid: `https://${host}/a/${n}`, link: `https://${host}/a/${n}`, title: `t${n}`, published_at: pubUtc, pub_date_raw: 'x', feed_host: host,
});
const CNBC = 'www.cnbc.com';
const YAHOO = 'finance.yahoo.com';
// CNBC 3건(KST 09:00·10:00·11:00), Yahoo 2건(KST 11:30·12:00)
const ITEMS = [
  item(CNBC, 1, '2026-10-28T00:00:00Z'), item(CNBC, 2, '2026-10-28T01:00:00Z'), item(CNBC, 3, '2026-10-28T02:00:00Z'),
  item(YAHOO, 1, '2026-10-28T02:30:00Z'), item(YAHOO, 2, '2026-10-28T03:00:00Z'),
];

let warn: jest.SpyInstance;
let log: jest.SpyInstance;
beforeEach(() => {
  mockQuery.mockReset();
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  log = jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  warn.mockRestore();
  log.mockRestore();
});

describe('순수 함수', () => {
  test('summarizeFeeds — feed_host 별 개수·가장 오래된/최신 발행시각(KST), 발행시각 없는 행은 개수만, feed_host 없는 행은 뺀다', () => {
    const { rows } = prepareCaptureRows([...ITEMS, item(CNBC, 4, null), { guid: 'g', link: null, title: 'x', published_at: '2026-10-28T00:00:00Z' }]);
    expect(summarizeFeeds(rows)).toEqual({
      [YAHOO]: { oldestPub: '2026-10-28 11:30:00', newestPub: '2026-10-28 12:00:00', items: 2 },
      [CNBC]: { oldestPub: '2026-10-28 09:00:00', newestPub: '2026-10-28 11:00:00', items: 4 },
    });
  });

  test(`summarizeFeeds — 피드가 ${CI_FEED_MAX}개를 넘으면 이름순 앞쪽 ${CI_FEED_MAX}개만(상태 크기 상한)`, () => {
    const rows = Array.from({ length: CI_FEED_MAX + 3 }, (_, i) => ({ feedHost: `f${String(i).padStart(2, '0')}.example.com`, publishedAt: '2026-10-28 10:00:00' }));
    const out = summarizeFeeds(rows);
    expect(Object.keys(out)).toHaveLength(CI_FEED_MAX);
    expect(Object.keys(out)[0]).toBe('f00.example.com');
  });

  test.each([
    ['이어짐 — 이번 가장 오래된 < 직전 최신', '2026-10-28 09:30:00', false],
    ['이어짐 — 같으면(같은 기사·같은 초) 이어진 것으로 본다', '2026-10-28 09:00:00', false],
    ['🔴 gap — 이번 가장 오래된 > 직전 최신(사이 기사를 못 봤을 수 있음)', '2026-10-28 08:59:59', true],
    ['🔴 bootstrap — 직전 값 없음(첫 캡처는 gap 으로 세지 않는다)', null, 'bootstrap'],
    ['skipped — 직전 값을 해석 못 함', undefined, 'skipped'],
  ])('classifyFeeds: %s', (_n, prev, want) => {
    const out = classifyFeeds({ [CNBC]: { oldestPub: '2026-10-28 09:00:00', newestPub: '2026-10-28 11:00:00', items: 3 } }, new Map([[CNBC, prev as string | null | undefined]]));
    expect(out[CNBC].gap).toBe(want);
  });

  test('classifyFeeds — 조회 실패(null)면 전부 skipped · 이번 응답에 발행시각이 하나도 없으면 skipped', () => {
    const s = { [CNBC]: { oldestPub: '2026-10-28 09:00:00', newestPub: '2026-10-28 11:00:00', items: 3 }, [YAHOO]: { oldestPub: null, newestPub: null, items: 2 } };
    expect(Object.values(classifyFeeds(s, null)).map((o) => o.gap)).toEqual(['skipped', 'skipped']);
    expect(classifyFeeds(s, new Map([[CNBC, '2026-10-28 10:00:00'], [YAHOO, '2026-10-28 10:00:00']]))[YAHOO].gap).toBe('skipped');
  });

  test('🔴 nextConsecutiveGaps — gap 이면 +1, 이어짐·bootstrap 이면 0, skipped 면 그대로', () => {
    expect(nextConsecutiveGaps(2, true)).toBe(3);
    expect(nextConsecutiveGaps(2, false)).toBe(0);
    expect(nextConsecutiveGaps(2, 'bootstrap')).toBe(0);
    expect(nextConsecutiveGaps(2, 'skipped')).toBe(2);
  });

  test('readPrevFeeds — 손상·없음은 {}, 형태가 맞는 칸만(호스트 꼴·필드 타입), 문자열 JSON·객체 모두', () => {
    expect(readPrevFeeds(undefined)).toEqual({});
    expect(readPrevFeeds('{not json')).toEqual({});
    expect(readPrevFeeds({ feeds: [1] })).toEqual({});
    const raw = { feeds: { [CNBC]: { oldestPub: '2026-10-28 09:00:00', newestPub: 'bad', items: 3, gap: true, consecutiveGaps: 4 }, 'Bad Host!': { consecutiveGaps: 9 }, [YAHOO]: 'x' } };
    const want = { [CNBC]: { oldestPub: '2026-10-28 09:00:00', newestPub: null, items: 3, gap: true, consecutiveGaps: 4 } };
    expect(readPrevFeeds(raw)).toEqual(want);
    expect(readPrevFeeds(JSON.stringify(raw))).toEqual(want);
    expect(readPrevFeeds({ feeds: { [CNBC]: { gap: 'weird', consecutiveGaps: -1, items: 1.5 } } })).toEqual({ [CNBC]: { oldestPub: null, newestPub: null, items: 0, gap: 'skipped', consecutiveGaps: 0 } });
  });

  test('nextFeeds — 검사 결과 없으면 직전 그대로, 있으면 연속 수를 이어 센다(이번에 없는 피드는 빠진다)', () => {
    const prev = { [CNBC]: { oldestPub: null, newestPub: null, items: 1, gap: true as const, consecutiveGaps: 2 }, [YAHOO]: { oldestPub: null, newestPub: null, items: 1, gap: true as const, consecutiveGaps: 5 } };
    expect(nextFeeds(prev, undefined)).toBe(prev);
    const out = nextFeeds(prev, { [CNBC]: { oldestPub: 'a', newestPub: 'b', items: 3, gap: true } });
    expect(out).toEqual({ [CNBC]: { oldestPub: 'a', newestPub: 'b', items: 3, gap: true, consecutiveGaps: 3 } });
  });

  test('🔴 nextCaptureStatus — 기존 필드 8개는 그대로(하위 호환) + feeds, prevFeeds 를 안 주면 {}', () => {
    const v = nextCaptureStatus(1, { mode: 'peek', status: 'ok', fetched: 5, inserted: 5, duplicates: 0, rejected: 0 }, NOW);
    expect(Object.keys(v)).toEqual(['lastAt', 'mode', 'status', 'fetched', 'inserted', 'duplicates', 'rejected', 'consecutiveFailures', 'feeds']);
    expect(v).toMatchObject({ lastAt: '2026-10-28 12:04:05', mode: 'peek', status: 'ok', fetched: 5, consecutiveFailures: 0, feeds: {} });
    expect(readPrevFailures(JSON.stringify(v))).toBe(0);
  });
});

describe('직전 값 조회 readPrevNewestByFeed', () => {
  test('🔴 SQL·파라미터 — 읽기 1회, 발행시각 하한(7일 전 KST)·이번 캡처 시각(새 행 제외)·호스트 목록, source_kind rss, MAX 를 KST 문자열로', async () => {
    db({ feedRows: [{ feed_host: CNBC, newest: '2026-10-28 10:00:00' }] });
    const m = await readPrevNewestByFeed([CNBC, YAHOO], Date.now() + 4000, NOW);
    expect(calls()).toHaveLength(1);
    expect(calls()[0][1]).toEqual(['2026-10-21 12:04:05', '2026-10-28 12:04:05', [CNBC, YAHOO]]);
    expect(CI_FEED_LOOKBACK_DAYS).toBe(7);
    expect(CI_FEED_PREV_NEWEST_SQL).toMatch(/^SELECT feed_host, DATE_FORMAT\(MAX\(published_at\), '%Y-%m-%d %H:%i:%s'\) AS newest FROM ci_raw_item WHERE source_kind = 'rss' AND published_at >= \? AND first_seen_at < \? AND feed_host IN \(\?\) GROUP BY feed_host$/);
    expect(m).toEqual(new Map([[CNBC, '2026-10-28 10:00:00'], [YAHOO, null]]));
  });

  test('값 정규화 — Date 는 KST 문자열로, NULL 은 없음(null), 이상한 값은 해석 못 함(undefined)', async () => {
    db({ feedRows: [{ feed_host: CNBC, newest: new Date('2026-10-28T01:00:00Z') }, { feed_host: YAHOO, newest: null }, { feed_host: 'x.example.com', newest: 'garbage' }] });
    const m = await readPrevNewestByFeed([CNBC, YAHOO, 'x.example.com'], Date.now() + 4000, NOW);
    expect(m).toEqual(new Map<string, string | null | undefined>([[CNBC, '2026-10-28 10:00:00'], [YAHOO, null], ['x.example.com', undefined]]));
  });

  test('조회 실패 → null(던지지 않음) · 호스트 없음 → 쿼리 없이 빈 맵 · 마감이 지났으면 쿼리 없이 null', async () => {
    db({ feedError: new Error('ER_NO_SUCH_TABLE') });
    await expect(readPrevNewestByFeed([CNBC], Date.now() + 4000, NOW)).resolves.toBeNull();
    mockQuery.mockReset();
    db();
    expect(await readPrevNewestByFeed([], Date.now() + 4000, NOW)).toEqual(new Map());
    expect(await readPrevNewestByFeed([CNBC], Date.now() - 1, NOW)).toBeNull();
    expect(calls()).toHaveLength(0);
  });

  test(`🔴 상한 ${CI_FEED_CHECK_TIMEOUT_MS}ms — 조회가 늦으면 그 시각에 null(마감이 더 남아 있어도)`, async () => {
    jest.useFakeTimers();
    db({ feedDelay: 3000 });
    const t0 = Date.now();
    let at = -1;
    const p = readPrevNewestByFeed([CNBC], Date.now() + 4000, NOW).then((r) => { at = Date.now() - t0; return r; });
    await jest.advanceTimersByTimeAsync(5000);
    expect(await p).toBeNull();
    expect(at).toBe(CI_FEED_CHECK_TIMEOUT_MS);
  });
});

describe('캡처 진입점 — 상태 feeds', () => {
  test('🔴 조회와 저장은 나란히(같은 now) — 조회의 first_seen_at 기준 = 저장 행의 first_seen_at, 상태 기록은 둘 다 끝난 뒤', async () => {
    db();
    await captureFetchOutcome({ market: 'overseas', mode: 'peek', ok: true, items: ITEMS, assumeEnabled: true, now: NOW });
    expect(sqlOrder()).toEqual(['feed', 'insert', 'select_config', 'status_write']);
    expect(calls()[0][1]).toEqual(['2026-10-21 12:04:05', '2026-10-28 12:04:05', [YAHOO, CNBC]]);
    const firstSeen = (calls()[1][1][0] as unknown[][]).map((r) => r[6]);   // INSERT 열 순서: … published_at, first_seen_at …
    expect(new Set(firstSeen)).toEqual(new Set(['2026-10-28 12:04:05']));
  });

  test('🔴 저장이 조회를 기다리지 않는다 — 조회 3초·저장 0.2초면 저장은 0.2초에 끝나고 조회는 1초에 건너뜀', async () => {
    jest.useFakeTimers();
    let insertDoneAt = -1;
    const t0 = Date.now();
    mockQuery.mockImplementation((sql: string, params: unknown[]) => {
      if (sql === CI_FEED_PREV_NEWEST_SQL) return later(3000, [[]]);
      if (sql === CI_RAW_ITEM_UPSERT_SQL) {
        const n = (params[0] as unknown[][]).length;
        return later(200, [{ affectedRows: n, info: `Records: ${n}  Duplicates: 0  Warnings: 0` }]).then((v) => { insertDoneAt = Date.now() - t0; return v; });
      }
      if (sql.startsWith('SELECT')) return Promise.resolve([[]]);
      return Promise.resolve([{ affectedRows: 1 }]);
    });
    const p = captureFetchOutcome({ market: 'overseas', mode: 'peek', ok: true, items: ITEMS, assumeEnabled: true, now: NOW });
    await jest.advanceTimersByTimeAsync(20_000);
    const r = await p;
    expect(insertDoneAt).toBe(200);
    expect(r.capture?.status).toBe('ok');
  });

  test('🔴 첫 캡처 = bootstrap(gap 으로 세지 않음), 기존 필드 그대로', async () => {
    db();
    const r = await captureFetchOutcome({ market: 'overseas', mode: 'peek', ok: true, items: ITEMS, assumeEnabled: true, now: NOW });
    expect(statusOf()).toEqual({
      lastAt: '2026-10-28 12:04:05', mode: 'peek', status: 'ok', fetched: 5, inserted: 5, duplicates: 0, rejected: 0, consecutiveFailures: 0,
      feeds: {
        [YAHOO]: { oldestPub: '2026-10-28 11:30:00', newestPub: '2026-10-28 12:00:00', items: 2, gap: 'bootstrap', consecutiveGaps: 0 },
        [CNBC]: { oldestPub: '2026-10-28 09:00:00', newestPub: '2026-10-28 11:00:00', items: 3, gap: 'bootstrap', consecutiveGaps: 0 },
      },
    });
    expect(r.status).toEqual(statusOf());
    expect(r.deadline).toBe('ok');
  });

  test('🔴 이어짐·gap 판정 + 연속 gap 수: gap 이면 직전 +1, 이어지면 0 으로 초기화', async () => {
    db({
      prevStatus: JSON.stringify({ consecutiveFailures: 0, feeds: { [CNBC]: { consecutiveGaps: 3, gap: true }, [YAHOO]: { consecutiveGaps: 1, gap: true } } }),
      // CNBC 직전 최신 10:00 ≥ 이번 가장 오래된 09:00 → 이어짐 / Yahoo 직전 최신 11:00 < 이번 가장 오래된 11:30 → gap
      feedRows: [{ feed_host: CNBC, newest: '2026-10-28 10:00:00' }, { feed_host: YAHOO, newest: '2026-10-28 11:00:00' }],
    });
    await captureFetchOutcome({ market: 'overseas', mode: 'peek', ok: true, items: ITEMS, assumeEnabled: true, now: NOW });
    expect(statusOf().feeds).toEqual({
      [YAHOO]: { oldestPub: '2026-10-28 11:30:00', newestPub: '2026-10-28 12:00:00', items: 2, gap: true, consecutiveGaps: 2 },
      [CNBC]: { oldestPub: '2026-10-28 09:00:00', newestPub: '2026-10-28 11:00:00', items: 3, gap: false, consecutiveGaps: 0 },
    });
  });

  test('🔴 직전 값 조회 실패 → 모든 피드 skipped(연속 수 유지), 저장·상태 기록은 그대로', async () => {
    db({ prevStatus: { feeds: { [CNBC]: { consecutiveGaps: 2, gap: true } } }, feedError: new Error('deadlock') });
    const r = await captureFetchOutcome({ market: 'overseas', mode: 'peek', ok: true, items: ITEMS, assumeEnabled: true, now: NOW });
    expect(r.capture).toEqual({ status: 'ok', inserted: 5, duplicates: 0, rejected: 0 });
    expect(statusOf()).toMatchObject({ status: 'ok', consecutiveFailures: 0 });
    expect(statusOf().feeds[CNBC]).toMatchObject({ gap: 'skipped', consecutiveGaps: 2 });
    expect(statusOf().feeds[YAHOO]).toMatchObject({ gap: 'skipped', consecutiveGaps: 0 });
  });

  test('🔴 조회가 늦으면(3초) 1초에 검사만 건너뛰고 저장·상태 기록은 마감 안에 끝난다 — deadline ok, 합계 < 4초', async () => {
    jest.useFakeTimers();
    db({ feedDelay: 3000, insertDelay: 500 });
    const t0 = Date.now();
    let at = -1;
    const p = captureFetchOutcome({ market: 'overseas', mode: 'peek', ok: true, items: ITEMS, assumeEnabled: true, now: NOW }).then((r) => { at = Date.now() - t0; return r; });
    await jest.advanceTimersByTimeAsync(20_000);
    const r = await p;
    expect(at).toBe(CI_FEED_CHECK_TIMEOUT_MS);   // 저장(0.5초)과 나란히 — 둘 중 늦은 쪽(조회 상한 1초)
    expect(r.deadline).toBe('ok');
    expect(r.capture?.status).toBe('ok');
    expect(Object.values(statusOf().feeds).map((f) => (f as { gap: unknown }).gap)).toEqual(['skipped', 'skipped']);
  });

  test('🔴 마감이 거의 다 쓰였으면(스위치 3.5초) 조회는 남은 0.5초만 — 저장은 조회와 나란히 끝나 그대로 성공, 합계 4초', async () => {
    jest.useFakeTimers();
    mockQuery.mockImplementation((sql: string, params: unknown[]) => {
      if (sql.startsWith('SELECT value FROM system_config')) return later(params[0] === 'ci_capture_enabled' ? 3500 : 0, [[{ value: true }]]);
      if (sql === CI_FEED_PREV_NEWEST_SQL) return later(5000, [[]]);
      if (sql === CI_RAW_ITEM_UPSERT_SQL) { const n = (params[0] as unknown[][]).length; return Promise.resolve([{ affectedRows: n, info: `Records: ${n}  Duplicates: 0  Warnings: 0` }]); }
      return Promise.resolve([{ affectedRows: 1 }]);
    });
    const t0 = Date.now();
    let at = -1;
    const p = captureFetchOutcome({ market: 'overseas', mode: 'peek', ok: true, items: ITEMS, now: NOW }).then((r) => { at = Date.now() - t0; return r; });
    await jest.advanceTimersByTimeAsync(20_000);
    const r = await p;
    expect(at).toBe(4000);
    expect(r.capture).toEqual({ status: 'ok', inserted: 5, duplicates: 0, rejected: 0 });   // 조회가 저장 시간을 빼앗지 않는다
    expect(r.deadline).toBe('status_skipped');   // 상태 기록은 조회를 기다려 마감에 닿음 — 기존 'partial' 규칙
    expect(sqlOrder()).toEqual(['select_config', 'feed', 'insert']);
  });

  test('🔴 M4 실패(fetch_failed)·구 M4(no_items) → 조회 없음, 직전 feeds 를 그대로 옮긴다(연속 gap 수 보존)', async () => {
    const prevFeeds = { [CNBC]: { oldestPub: '2026-10-28 09:00:00', newestPub: '2026-10-28 11:00:00', items: 3, gap: true, consecutiveGaps: 2 } };
    db({ prevStatus: JSON.stringify({ consecutiveFailures: 1, feeds: prevFeeds }) });
    await captureFetchOutcome({ market: 'overseas', mode: 'peek', ok: false, assumeEnabled: true, now: NOW });
    await captureFetchOutcome({ market: 'overseas', mode: 'peek', ok: true, items: undefined, assumeEnabled: true, now: NOW });
    expect(calls().some(([s]) => s === CI_FEED_PREV_NEWEST_SQL)).toBe(false);
    expect(statusOf(0)).toMatchObject({ status: 'fetch_failed', consecutiveFailures: 2, feeds: prevFeeds });
    expect(statusOf(1)).toMatchObject({ status: 'no_items', feeds: prevFeeds });
  });

  test('ingest 캡처도 같은 검사(06:00 ingest 가 쌓은 행이 다음 peek 의 직전 값이 된다)', async () => {
    db({ feedRows: [{ feed_host: CNBC, newest: '2026-10-28 10:00:00' }] });
    await captureFetchOutcome({ market: 'overseas', mode: 'ingest', ok: true, items: ITEMS, now: NOW });
    expect(sqlOrder()).toEqual(['select_config', 'feed', 'insert', 'select_config', 'status_write']);
    expect(statusOf()).toMatchObject({ mode: 'ingest', feeds: { [CNBC]: { gap: false }, [YAHOO]: { gap: 'bootstrap' } } });
  });

  test('스위치 꺼짐 → 조회 포함 DB 접근은 스위치 읽기 1회뿐', async () => {
    db({ switchValue: 'false' });
    await captureFetchOutcome({ market: 'overseas', mode: 'ingest', ok: true, items: ITEMS, now: NOW });
    expect(sqlOrder()).toEqual(['select_config']);
  });

  test('상태 크기 — 해외 피드 4개 실측 꼴이면 JSON 1KB 미만', async () => {
    db();
    const hosts = ['www.cnbc.com', 'feeds.content.dowjones.io', 'feeds.bloomberg.com', 'finance.yahoo.com'];
    const items = hosts.flatMap((h, i) => Array.from({ length: 20 }, (_, k) => item(h, i * 100 + k, `2026-10-28T0${k % 4}:0${i}:00Z`)));
    await captureFetchOutcome({ market: 'overseas', mode: 'peek', ok: true, items, assumeEnabled: true, now: NOW });
    expect(Object.keys(statusOf().feeds)).toHaveLength(4);
    expect(String(statusWrites()[0][1][1]).length).toBeLessThan(1024);
  });
});
