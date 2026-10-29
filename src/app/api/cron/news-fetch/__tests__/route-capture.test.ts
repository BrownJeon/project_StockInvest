/**
 * /api/cron/news-fetch — T-116 뉴스 최초 관측 캡처(`?mode=peek` · ingest 의 `items`) 시험.
 *
 * 기존 route.test.ts(T-036·T-103·T-106·T-115)는 손대지 않았다 — 그 파일의 ingest 시나리오는 M4 응답에 `items` 가 없어 캡처 모듈을
 * 부르지 않는다. 여기서는 캡처 모듈(`@/lib/corp-intel/raw-capture`)을 목으로 막고 라우트의 분기만 본다(DB 접속 없음).
 *  1. peek + 스위치 꺼짐(또는 읽기 예외) → M4 호출 0, `{ok:true, skipped:'capture_disabled'}` 200
 *  2. peek + 켜짐 → 요청 본문 `{market, limit, mode:'peek'}` · 🔴 recordNewsOutcome 미호출 · 캡처 호출(assumeEnabled)
 *  3. peek 실패(재시도 소진)·토큰 누락 → news-fetch:* 알림 없음 · recordNewsOutcome 없음 · HTTP 200
 *  4. ingest + items → 캡처 호출(mode ingest) · 응답·HTTP·재시도·알림·T-106 기록은 캡처가 던져도 같다
 *  5. 구 M4(items 없음) → ingest 는 캡처 미호출, peek 은 no_items 로 응답
 *  6. mode 해석 — 정확히 'peek' 만 peek(대소문자·공백·빈 값은 ingest, 본문에 mode 없음), 400·401 이 먼저
 *  7. (T-118) peek 의 M4 호출은 1회·20초(재시도 없음) — ingest 의 3회×60초(+대기 3초×2 = 최악 186초)는 그대로
 */
import * as fs from 'fs';
import * as path from 'path';
import type { NextRequest } from 'next/server';

const authMock = jest.fn();
const alertMock = jest.fn();
const healthMock = jest.fn();
const switchMock = jest.fn();
const captureMock = jest.fn();

jest.mock('@/lib/cron-auth', () => ({ checkCronAuth: (...a: unknown[]) => authMock(...a) }));
jest.mock('@/lib/notify/throttle', () => ({
  sendAlertThrottled: (...a: unknown[]) => alertMock(...a),
  resetAlertThrottle: () => {},
}));
jest.mock('@/lib/rag/news-health', () => ({ recordNewsOutcome: (...a: unknown[]) => healthMock(...a) }));
jest.mock('@/lib/corp-intel/raw-capture', () => ({
  readCaptureSwitch: (...a: unknown[]) => switchMock(...a),
  captureFetchOutcome: (...a: unknown[]) => captureMock(...a),
}));

function jsonResponse(status: number, body: unknown, ok = status < 400): Response {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}
function reqWith(q: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:3003/api/cron/news-fetch');
  for (const [k, v] of Object.entries(q)) url.searchParams.set(k, v);
  return { nextUrl: url } as unknown as NextRequest;
}
const ITEMS = [
  { guid: 'g1', link: 'https://www.yna.co.kr/view/1', title: 't1', published_at: '2026-10-28T01:00:00+00:00', pub_date_raw: 'x', feed_host: 'www.yna.co.kr' },
  { guid: 'g2', link: 'https://www.yna.co.kr/view/2', title: 't2', published_at: null, pub_date_raw: null, feed_host: 'www.yna.co.kr' },
];

/** M4 목 — status(market) 로 응답 코드, body(market) 로 성공 본문. 요청 본문을 기록한다. */
function m4(opts: { status?: (m: string) => number; body?: (m: string) => unknown } = {}) {
  const bodies: Record<string, unknown>[] = [];
  const fn = jest.fn().mockImplementation(async (_url: string, init: RequestInit) => {
    const b = JSON.parse(init.body as string) as Record<string, unknown>;
    bodies.push(b);
    const s = (opts.status ?? (() => 200))(String(b.market));
    if (s !== 200) return jsonResponse(s, { error: 'boom' }, false);
    return jsonResponse(200, (opts.body ?? (() => ({ upserted: 0, fresh: 5, mode: b.mode ?? 'ingest', items: ITEMS })))(String(b.market)));
  });
  return { fn, bodies };
}

let originalFetch: typeof globalThis.fetch;
beforeEach(() => {
  jest.useFakeTimers();
  for (const m of [authMock, alertMock, healthMock, switchMock, captureMock]) m.mockReset();
  authMock.mockReturnValue(undefined);
  healthMock.mockResolvedValue({ streak: 0, alerted: false });
  switchMock.mockResolvedValue({ enabled: true, source: 'value' });
  captureMock.mockResolvedValue({ capture: { status: 'ok', inserted: 2, duplicates: 0, rejected: 0 }, status: null, deadline: 'ok' });
  originalFetch = globalThis.fetch;
  process.env.M4_ADMIN_TOKEN = 'test-admin-token';
  delete process.env.ADMIN_TOKEN;
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

async function runPost(r: NextRequest) {
  const { POST } = await import('../route');
  const p = POST(r);
  await jest.runAllTimersAsync();
  const res = await p;
  return { res, body: (await res.json()) as Record<string, unknown> };
}

describe('peek — 스위치 꺼짐', () => {
  test('🔴 꺼짐 → M4 호출 0, {ok:true, skipped:capture_disabled} 200, 캡처·T-106·알림 0', async () => {
    switchMock.mockResolvedValue({ enabled: false, source: 'missing' });
    const { fn } = m4();
    globalThis.fetch = fn;
    const { res, body } = await runPost(reqWith({ market: 'domestic', mode: 'peek' }));
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, skipped: 'capture_disabled' });
    expect(fn).not.toHaveBeenCalled();
    expect(captureMock).not.toHaveBeenCalled();
    expect(healthMock).not.toHaveBeenCalled();
    expect(alertMock).not.toHaveBeenCalled();
  });

  test('스위치 읽기가 던져도 꺼짐으로 본다(M4 호출 0)', async () => {
    switchMock.mockRejectedValue(new Error('db down'));
    const { fn } = m4();
    globalThis.fetch = fn;
    const { res, body } = await runPost(reqWith({ market: 'overseas', mode: 'peek' }));
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, skipped: 'capture_disabled' });
    expect(fn).not.toHaveBeenCalled();
  });

  test('꺼짐이면 토큰이 없어도 설정 알림 없이 건너뜀', async () => {
    switchMock.mockResolvedValue({ enabled: false, source: 'missing' });
    delete process.env.M4_ADMIN_TOKEN;
    globalThis.fetch = jest.fn();
    const { body } = await runPost(reqWith({ mode: 'peek' }));
    expect(body).toEqual({ ok: true, skipped: 'capture_disabled' });
    expect(alertMock).not.toHaveBeenCalled();
  });
});

describe('peek — 스위치 켜짐', () => {
  test('🔴 본문에 mode:peek · limit 100, recordNewsOutcome 미호출(upserted 0 거짓 경고 방지), 캡처 호출', async () => {
    const { fn, bodies } = m4();
    globalThis.fetch = fn;
    const { res, body } = await runPost(reqWith({ market: 'domestic', mode: 'peek' }));
    expect(res.status).toBe(200);
    expect(bodies).toEqual([{ market: 'domestic', limit: 100, mode: 'peek' }]);
    expect(healthMock).not.toHaveBeenCalled();
    expect(alertMock).not.toHaveBeenCalled();
    expect(captureMock).toHaveBeenCalledTimes(1);
    expect(captureMock.mock.calls[0][0]).toEqual({ market: 'domestic', mode: 'peek', ok: true, items: ITEMS, assumeEnabled: true });
    expect(body).toEqual({
      ok: true, mode: 'peek',
      markets: [{ market: 'domestic', ok: true, upserted: 0, attempts: 1 }],
      capture: [{ market: 'domestic', status: 'ok', inserted: 2, duplicates: 0, rejected: 0 }],
    });
    expect(switchMock).toHaveBeenCalledTimes(1);
  });

  test('🔴 시장 미지정 peek → 두 시장 모두 peek, recordNewsOutcome 0회', async () => {
    const { fn, bodies } = m4();
    globalThis.fetch = fn;
    const { body } = await runPost(reqWith({ mode: 'peek' }));
    expect(bodies.map((b) => b.mode)).toEqual(['peek', 'peek']);
    expect(healthMock).not.toHaveBeenCalled();
    expect(captureMock).toHaveBeenCalledTimes(2);
    expect((body.markets as unknown[]).length).toBe(2);
  });

  test('🔴 (T-118) peek 실패 → M4 1회만(재시도 없음), news-fetch:* 알림 없음, T-106 기록 없음, 캡처는 ok:false 로(상태에 실패), HTTP 200·ok false', async () => {
    const { fn, bodies } = m4({ status: () => 502 });
    globalThis.fetch = fn;
    captureMock.mockResolvedValue({ capture: null, status: null });
    const { res, body } = await runPost(reqWith({ market: 'overseas', mode: 'peek' }));
    expect(res.status).toBe(200);
    expect(bodies).toHaveLength(1);                           // (T-118) peek 는 재시도하지 않는다
    expect(body).toMatchObject({ markets: [{ market: 'overseas', ok: false, upserted: 0, attempts: 1 }] });
    expect(alertMock).not.toHaveBeenCalled();
    expect(healthMock).not.toHaveBeenCalled();
    expect(captureMock.mock.calls[0][0]).toMatchObject({ market: 'overseas', mode: 'peek', ok: false });
    expect(body).toMatchObject({ ok: false, mode: 'peek', capture: [{ market: 'overseas', status: 'fetch_failed', inserted: 0 }] });
  });

  test('peek 토큰 누락 → M4 호출 0, 알림 없음, 200', async () => {
    delete process.env.M4_ADMIN_TOKEN;
    const fn = jest.fn();
    globalThis.fetch = fn;
    const { res, body } = await runPost(reqWith({ market: 'domestic', mode: 'peek' }));
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: false, mode: 'peek', markets: [] });
    expect(fn).not.toHaveBeenCalled();
    expect(alertMock).not.toHaveBeenCalled();
    expect(captureMock).not.toHaveBeenCalled();
  });

  test('peek 캡처가 던져도 200·ok true, 알림·T-106 없음', async () => {
    const { fn } = m4();
    globalThis.fetch = fn;
    captureMock.mockRejectedValue(new Error('boom'));
    const { res, body } = await runPost(reqWith({ market: 'domestic', mode: 'peek' }));
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, mode: 'peek', capture: [{ market: 'domestic', status: 'failed' }] });
    expect(alertMock).not.toHaveBeenCalled();
    expect(healthMock).not.toHaveBeenCalled();
  });

  test.each([
    ['status_skipped', { status: 'ok', inserted: 2, duplicates: 0, rejected: 0 }, 'partial'],
    ['insert_skipped', { status: 'failed', inserted: 0, duplicates: 0, rejected: 0, reason: 'deadline' }, 'failed'],
    ['ok', { status: 'ok', inserted: 2, duplicates: 0, rejected: 0 }, 'ok'],
  ])('(Leader 결정 Q8) 공유 마감 %s → 응답 capture.status %s 쪽으로 구분', async (deadline, capture, _x) => {
    const { fn } = m4();
    globalThis.fetch = fn;
    captureMock.mockResolvedValue({ capture, status: null, deadline });
    const { res, body } = await runPost(reqWith({ market: 'domestic', mode: 'peek' }));
    expect(res.status).toBe(200);
    const want = deadline === 'status_skipped' ? 'partial' : capture.status;
    expect(body).toMatchObject({ ok: true, capture: [{ market: 'domestic', status: want }] });
    expect(alertMock).not.toHaveBeenCalled();
  });

  test('peek 인데 구 M4(items 없음) → 캡처는 items undefined 로 불리고 응답 status no_items', async () => {
    const { fn } = m4({ body: () => ({ upserted: 20 }) });
    globalThis.fetch = fn;
    captureMock.mockResolvedValue({ capture: null, status: null });
    const { body } = await runPost(reqWith({ market: 'domestic', mode: 'peek' }));
    expect(captureMock.mock.calls[0][0]).toMatchObject({ ok: true, items: undefined });
    expect(body).toMatchObject({ capture: [{ market: 'domestic', status: 'no_items' }] });
    expect(healthMock).not.toHaveBeenCalled();
  });
});

describe('ingest — items 캡처(동작·응답·재시도·알림 불변)', () => {
  test('🔴 ingest + items → 캡처(mode ingest, 스위치는 캡처 모듈이 읽음), 본문은 {market, limit} 그대로, 응답에 capture 없음, T-106 기록 그대로', async () => {
    const { fn, bodies } = m4({ body: (m) => ({ upserted: m === 'domestic' ? 4 : 6, items: ITEMS }) });
    globalThis.fetch = fn;
    const { res, body } = await runPost(reqWith({ market: 'domestic' }));
    expect(res.status).toBe(200);
    expect(bodies).toEqual([{ market: 'domestic', limit: 100 }]);
    expect(body).toEqual({ ok: true, markets: [{ market: 'domestic', ok: true, upserted: 4, attempts: 1 }] });
    expect(captureMock).toHaveBeenCalledTimes(1);
    expect(captureMock.mock.calls[0][0]).toEqual({ market: 'domestic', mode: 'ingest', ok: true, items: ITEMS, assumeEnabled: false });
    expect(switchMock).not.toHaveBeenCalled();
    expect(healthMock).toHaveBeenCalledWith({ channel: 'fetch', market: 'domestic', count: 4 });
  });

  /** 같은 시나리오를 캡처 정상/던짐 두 번 돌려 응답·HTTP·알림·T-106·M4 호출 수가 같은지 비교. */
  async function scenario(status: (m: string) => number, q: Record<string, string>, captureThrows: boolean) {
    for (const m of [alertMock, healthMock, captureMock]) m.mockReset();
    healthMock.mockResolvedValue({ streak: 0, alerted: false });
    if (captureThrows) captureMock.mockRejectedValue(new Error('capture exploded'));
    else captureMock.mockResolvedValue({ capture: { status: 'ok', inserted: 1, duplicates: 0, rejected: 0 }, status: null });
    let n = 0;
    globalThis.fetch = jest.fn().mockImplementation(async (_u: string, init: RequestInit) => {
      const b = JSON.parse(init.body as string) as { market: string };
      n++;
      const s = status(b.market);
      return s === 200 ? jsonResponse(200, { upserted: 3, items: ITEMS }) : jsonResponse(s, {}, false);
    });
    const { res, body } = await runPost(reqWith(q));
    jest.resetModules();
    return { http: res.status, body, alerts: alertMock.mock.calls.map((c) => c.slice(0, 2)), health: healthMock.mock.calls.map((c) => c[0]), m4calls: n };
  }

  test.each([
    ['두 시장 정상', () => 200, {}],
    ['국내 지정 정상', () => 200, { market: 'domestic' }],
    ['두 시장 부분 실패(국내 500)', (m: string) => (m === 'domestic' ? 500 : 200), {}],
    ['해외 지정 3회 소진', () => 502, { market: 'overseas' }],
  ])('🔴 %s — 캡처가 던져도 응답·HTTP·알림·T-106·M4 시도 수 동일', async (_n, status, q) => {
    const a = await scenario(status as (m: string) => number, q as Record<string, string>, false);
    const b = await scenario(status as (m: string) => number, q as Record<string, string>, true);
    expect(b).toEqual(a);
    expect(a.http).toBe(200);
  });

  test('재시도 뒤 성공 → attempts 2, 캡처 1회(성공한 응답의 items)', async () => {
    let k = 0;
    globalThis.fetch = jest.fn().mockImplementation(async () => (++k < 2 ? jsonResponse(503, {}, false) : jsonResponse(200, { upserted: 2, items: ITEMS })));
    const { body } = await runPost(reqWith({ market: 'overseas' }));
    expect(body).toEqual({ ok: true, markets: [{ market: 'overseas', ok: true, upserted: 2, attempts: 2 }] });
    expect(captureMock).toHaveBeenCalledTimes(1);
  });

  test('ingest 재시도 소진 실패 → 캡처 모듈 미호출, 기존 알림 그대로', async () => {
    globalThis.fetch = jest.fn().mockImplementation(async () => jsonResponse(502, {}, false));
    await runPost(reqWith({ market: 'domestic' }));
    expect(captureMock).not.toHaveBeenCalled();
    expect(alertMock.mock.calls.map((c) => c.slice(0, 2))).toEqual([['news-fetch:domestic:failed', 'critical']]);
  });

  test('🔴 구 M4(items 없음) ingest → 캡처 미호출, 응답·T-106 그대로', async () => {
    globalThis.fetch = jest.fn().mockImplementation(async () => jsonResponse(200, { upserted: 9 }));
    const { body } = await runPost(reqWith({ market: 'domestic' }));
    expect(body).toEqual({ ok: true, markets: [{ market: 'domestic', ok: true, upserted: 9, attempts: 1 }] });
    expect(captureMock).not.toHaveBeenCalled();
    expect(healthMock).toHaveBeenCalledWith({ channel: 'fetch', market: 'domestic', count: 9 });
  });

  test('items 가 배열이 아니면(객체·문자열) 없는 것과 같다', async () => {
    globalThis.fetch = jest.fn().mockImplementation(async () => jsonResponse(200, { upserted: 1, items: { a: 1 } }));
    await runPost(reqWith({ market: 'domestic' }));
    expect(captureMock).not.toHaveBeenCalled();
  });
});

/** AbortSignal 을 지키는 멈춘 M4 — abort 되면 AbortError 로 끝난다. 호출마다 시작 시각(가짜 시계)을 남긴다. */
function hangingM4() {
  const starts: number[] = [];
  const bodies: Record<string, unknown>[] = [];
  const fn = jest.fn().mockImplementation((_u: string, init: RequestInit) => {
    starts.push(Date.now());
    bodies.push(JSON.parse(init.body as string) as Record<string, unknown>);
    return new Promise((_res, rej) => {
      init.signal?.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); });
    });
  });
  return { fn, starts, bodies };
}

describe('(T-118) M4 호출 규칙 — peek 1회·20초, ingest 3회×60초 그대로', () => {
  async function timedPost(q: Record<string, string>) {
    const { POST } = await import('../route');
    const t0 = Date.now();
    let doneAt = -1;
    const p = POST(reqWith(q)).then((r) => { doneAt = Date.now() - t0; return r; });
    await jest.runAllTimersAsync();
    const res = await p;
    return { res, body: (await res.json()) as { markets: { market: string; ok: boolean; attempts: number; error?: string }[] }, ms: doneAt, t0 };
  }

  test('🔴 peek + M4 멈춤 → 1회만 부르고 20초에 끊고 끝(라우트 약 20초), 알림·T-106 없음', async () => {
    const h = hangingM4();
    globalThis.fetch = h.fn;
    captureMock.mockResolvedValue({ capture: null, status: null, deadline: 'ok' });
    const { res, body, ms } = await timedPost({ market: 'overseas', mode: 'peek' });
    expect(res.status).toBe(200);
    expect(h.fn).toHaveBeenCalledTimes(1);
    expect(ms).toBe(20_000);
    expect(body.markets).toEqual([{ market: 'overseas', ok: false, upserted: 0, attempts: 1, error: 'timeout after 20000ms' }]);
    expect(alertMock).not.toHaveBeenCalled();
    expect(healthMock).not.toHaveBeenCalled();
  });

  test('peek 시장 미지정 + M4 멈춤 → 시장별 1회(병렬), 라우트 약 20초', async () => {
    const h = hangingM4();
    globalThis.fetch = h.fn;
    captureMock.mockResolvedValue({ capture: null, status: null, deadline: 'ok' });
    const { ms } = await timedPost({ mode: 'peek' });
    expect(h.fn).toHaveBeenCalledTimes(2);
    expect(ms).toBe(20_000);
  });

  test('🔴 ingest + M4 멈춤 → 그대로 3회 × 60초 + 대기 3초 × 2 = 186초, 알림 그대로, 시도 시작 0·63·126초', async () => {
    const h = hangingM4();
    globalThis.fetch = h.fn;
    const { body, ms, t0 } = await timedPost({ market: 'domestic' });
    expect(h.fn).toHaveBeenCalledTimes(3);
    expect(h.bodies).toEqual([{ market: 'domestic', limit: 100 }, { market: 'domestic', limit: 100 }, { market: 'domestic', limit: 100 }]);
    expect(h.starts.map((t) => t - t0)).toEqual([0, 63_000, 126_000]);
    expect(ms).toBe(186_000);
    expect(body.markets).toEqual([{ market: 'domestic', ok: false, upserted: 0, attempts: 3, error: 'timeout after 60000ms' }]);
    expect(alertMock.mock.calls.map((c) => c.slice(0, 2))).toEqual([['news-fetch:domestic:failed', 'critical']]);
    expect(healthMock).toHaveBeenCalledWith({ channel: 'fetch', market: 'domestic', count: 0 });
  });

  test('🔴 ingest 502 → 그대로 3회(재시도 규칙 불변), peek 502 → 1회', async () => {
    const a = m4({ status: () => 502 });
    globalThis.fetch = a.fn;
    await runPost(reqWith({ market: 'overseas' }));
    expect(a.bodies).toHaveLength(3);
    jest.resetModules();
    const b = m4({ status: () => 502 });
    globalThis.fetch = b.fn;
    captureMock.mockResolvedValue({ capture: null, status: null });
    await runPost(reqWith({ market: 'overseas', mode: 'peek' }));
    expect(b.bodies).toHaveLength(1);
  });

  test('정적 — peek 상수 1회·20초, ingest 상수 3회·60초·3초 불변, 모드별 규칙 함수가 peek 에만 peek 상수를 준다', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'route.ts'), 'utf8');
    expect(src).toMatch(/^const PEEK_MAX_ATTEMPTS = 1;$/m);
    expect(src).toMatch(/^const PEEK_REQUEST_TIMEOUT_MS = 20_000;$/m);
    expect(src).toMatch(/^const MAX_ATTEMPTS = 3;$/m);
    expect(src).toMatch(/^const REQUEST_TIMEOUT_MS = 60_000;$/m);
    expect(src).toMatch(/^const RETRY_BACKOFF_MS = 3_000;$/m);
    expect(src).toMatch(/return mode === 'peek'\s*\? \{ maxAttempts: PEEK_MAX_ATTEMPTS, timeoutMs: PEEK_REQUEST_TIMEOUT_MS \}\s*: \{ maxAttempts: MAX_ATTEMPTS, timeoutMs: REQUEST_TIMEOUT_MS \};/);
  });
});

describe('mode 해석', () => {
  test.each(['PEEK', 'Peek', ' peek', 'peek ', '', 'ingest', 'x'])('mode=%p → ingest(본문에 mode 없음, 스위치 안 읽음)', async (mode) => {
    const { fn, bodies } = m4({ body: () => ({ upserted: 1 }) });
    globalThis.fetch = fn;
    await runPost(reqWith({ market: 'domestic', mode }));
    expect(bodies).toEqual([{ market: 'domestic', limit: 100 }]);
    expect(switchMock).not.toHaveBeenCalled();
    expect(healthMock).toHaveBeenCalledTimes(1);
  });

  test('잘못된 market + mode=peek → 400, 스위치·M4 0', async () => {
    const fn = jest.fn();
    globalThis.fetch = fn;
    const { res, body } = await runPost(reqWith({ market: 'KR', mode: 'peek' }));
    expect(res.status).toBe(400);
    expect(body).toEqual({ ok: false, error: 'invalid_market' });
    expect(switchMock).not.toHaveBeenCalled();
    expect(fn).not.toHaveBeenCalled();
  });

  test('인증 실패 + mode=peek → 401, 스위치·M4 0', async () => {
    authMock.mockReturnValue(jsonResponse(401, { ok: false }, false));
    const fn = jest.fn();
    globalThis.fetch = fn;
    const { POST } = await import('../route');
    const res = await POST(reqWith({ mode: 'peek' }));
    expect(res.status).toBe(401);
    expect(switchMock).not.toHaveBeenCalled();
    expect(fn).not.toHaveBeenCalled();
  });
});
