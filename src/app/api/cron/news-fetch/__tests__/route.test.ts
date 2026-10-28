/**
 * /api/cron/news-fetch — 인증·재시도·실패 알림 회귀 테스트 (T-036).
 *
 * 이 라우트는 SAFETY_PATHS 대상(`^src/app/api/cron/`)이다. 107일 무성 실패(실측 12,060건)를
 * 낳았던 결함 — 재시도 부재·실패 알림 부재 — 이 재발하지 않는지 검증한다.
 *
 * 검증 범위:
 *  1. `checkCronAuth()` 가 거부하면 M4 호출을 전혀 하지 않는다 (401 그대로 반환)
 *  2. 정상 응답 — 시장별 upserted 파싱, 알림 없음
 *  3. 재시도 — 한 시장이 처음 실패해도 MAX_ATTEMPTS 이내 성공하면 재시도로 복구되고 알림 없음
 *  4. 부분 실패 — 한 시장만 전량 재시도 소진 시 warning 알림, 성공한 시장은 정상 반영
 *  5. 전체 실패 — 두 시장 다 소진 시 critical 알림, 응답 ok=false (그러나 HTTP 200)
 *  6. M4_ADMIN_TOKEN(및 ADMIN_TOKEN) 미설정 — 호출 없이 즉시 critical 알림 후 스킵 (fail-safe)
 *  7. (T-103) `?market=domestic|overseas` — 그 시장만 호출(응답 배열 길이 1), 미지정은 두 시장(기존 알림 키 불변),
 *     허용 밖 값은 인증 통과 후 400 invalid_market·M4 호출 0(인증이 먼저), 단일 시장 전량 실패는
 *     `news-fetch:<market>:failed` critical(본문에 시장명), 토큰 누락 fail-safe 는 단일 시장에서도 그대로.
 *
 * 실제 M4 서버 호출 안 함 — global.fetch mock으로 격리. 재시도 백오프(3s)는 fake timers로
 * 실제 대기 없이 진행시킨다.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { NextRequest } from 'next/server';

const authMock = jest.fn();
const alertMock = jest.fn();

jest.mock('@/lib/cron-auth', () => ({ checkCronAuth: (...a: unknown[]) => authMock(...a) }));
jest.mock('@/lib/notify/throttle', () => ({
  sendAlertThrottled: (...a: unknown[]) => alertMock(...a),
  resetAlertThrottle: () => {},
}));
// T-106 — 뉴스 0건 연속 감시 기록. 실제 모듈은 getPool()(실 DB·스키마 설정)을 부르므로 이 파일에서는 항상 목으로 막는다.
const healthMock = jest.fn();
jest.mock('@/lib/rag/news-health', () => ({
  recordNewsOutcome: (...a: unknown[]) => healthMock(...a),
}));

const req = {} as NextRequest;

interface Body {
  ok: boolean;
  error?: string;
  markets: { market: string; ok: boolean; upserted: number; attempts: number; error?: string }[];
}

function jsonResponse(status: number, body: unknown, ok = status < 400): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

let originalFetch: typeof globalThis.fetch;
let originalAdminToken: string | undefined;
let originalAdminTokenFallback: string | undefined;

beforeEach(() => {
  jest.useFakeTimers();
  authMock.mockReset();
  alertMock.mockReset();
  healthMock.mockReset();
  healthMock.mockResolvedValue({ streak: 0, alerted: false });
  authMock.mockReturnValue(undefined);
  originalFetch = globalThis.fetch;
  originalAdminToken = process.env.M4_ADMIN_TOKEN;
  originalAdminTokenFallback = process.env.ADMIN_TOKEN;
  process.env.M4_ADMIN_TOKEN = 'test-admin-token';
  delete process.env.ADMIN_TOKEN;
  process.env.AI_API_BASE = 'http://m4.local:8000';
});

afterEach(() => {
  jest.useRealTimers();
  globalThis.fetch = originalFetch;
  if (originalAdminToken === undefined) delete process.env.M4_ADMIN_TOKEN;
  else process.env.M4_ADMIN_TOKEN = originalAdminToken;
  if (originalAdminTokenFallback === undefined) delete process.env.ADMIN_TOKEN;
  else process.env.ADMIN_TOKEN = originalAdminTokenFallback;
  jest.resetModules();
});

/** POST 실행 후 재시도 백오프(fake timer)를 전부 흘려보내고 응답을 반환한다. */
async function runPost(r: NextRequest = req): Promise<{ res: Response; body: Body }> {
  const { POST } = await import('../route');
  const resPromise = POST(r);
  await jest.runAllTimersAsync();
  const res = await resPromise;
  const body = (await res.json()) as Body;
  return { res, body };
}

describe('인증', () => {
  test('🔴 인증 실패 시 M4 를 전혀 호출하지 않고 401 을 그대로 돌려준다', async () => {
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock;
    authMock.mockReturnValue(jsonResponse(401, { ok: false, error: 'unauthorized' }, false));

    const { POST } = await import('../route');
    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(alertMock).not.toHaveBeenCalled();
  });
});

describe('정상 응답', () => {
  test('두 시장 모두 첫 시도에 성공 — upserted 파싱, 알림 없음', async () => {
    const fetchMock = jest.fn().mockImplementation(async (url: string, init: RequestInit) => {
      const parsed = JSON.parse(init.body as string) as { market: string };
      const upserted = parsed.market === 'domestic' ? 12 : 7;
      return jsonResponse(200, { upserted });
    });
    globalThis.fetch = fetchMock;

    const { body } = await runPost();

    expect(body.ok).toBe(true);
    expect(body.markets).toHaveLength(2);
    const domestic = body.markets.find((m) => m.market === 'domestic')!;
    const overseas = body.markets.find((m) => m.market === 'overseas')!;
    expect(domestic).toMatchObject({ ok: true, upserted: 12, attempts: 1 });
    expect(overseas).toMatchObject({ ok: true, upserted: 7, attempts: 1 });
    expect(alertMock).not.toHaveBeenCalled();
  });

  test('요청 형식 — X-Admin-Token 헤더 + market/limit 바디, AI_API_BASE 기준 URL', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    globalThis.fetch = jest.fn().mockImplementation(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse(200, { upserted: 1 });
    });

    await runPost();

    expect(calls).toHaveLength(2);
    for (const { url, init } of calls) {
      expect(url).toBe('http://m4.local:8000/v1/news/fetch');
      expect(init.method).toBe('POST');
      const headers = init.headers as Record<string, string>;
      expect(headers['X-Admin-Token']).toBe('test-admin-token');
      const parsedBody = JSON.parse(init.body as string);
      // (T-115) 두 시장 공통 20 → 시장별 100(국내 100·해외 100). 시장별 값은 아래 'T-115 시장별 limit' 묶음이 따로 본다.
      expect(parsedBody.limit).toBe(100);
      expect(['domestic', 'overseas']).toContain(parsedBody.market);
    }
  });
});

describe('재시도', () => {
  test('한 시장이 처음 실패해도 재시도 이내 성공하면 복구되고 알림 없음', async () => {
    let overseasCalls = 0;
    globalThis.fetch = jest.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const parsed = JSON.parse(init.body as string) as { market: string };
      if (parsed.market === 'overseas') {
        overseasCalls++;
        if (overseasCalls < 2) return jsonResponse(503, {}, false);
        return jsonResponse(200, { upserted: 3 });
      }
      return jsonResponse(200, { upserted: 5 });
    });

    const { body } = await runPost();

    const overseas = body.markets.find((m) => m.market === 'overseas')!;
    expect(overseas).toMatchObject({ ok: true, upserted: 3, attempts: 2 });
    expect(body.ok).toBe(true);
    expect(alertMock).not.toHaveBeenCalled();
    expect(overseasCalls).toBe(2);
  });

  test('시장별 최대 시도 횟수는 3회(최초 1 + 재시도 2)를 넘지 않는다', async () => {
    let calls = 0;
    globalThis.fetch = jest.fn().mockImplementation(async () => {
      calls++;
      return jsonResponse(500, {}, false);
    });

    await runPost();

    // domestic + overseas 각 3회 = 6
    expect(calls).toBe(6);
  });
});

describe('부분 실패', () => {
  test('한 시장만 전량 소진 시 warning 알림, 성공 시장은 정상 반영', async () => {
    globalThis.fetch = jest.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const parsed = JSON.parse(init.body as string) as { market: string };
      if (parsed.market === 'overseas') return jsonResponse(500, { error: 'boom' }, false);
      return jsonResponse(200, { upserted: 9 });
    });

    const { body } = await runPost();

    expect(body.ok).toBe(false);
    const domestic = body.markets.find((m) => m.market === 'domestic')!;
    const overseas = body.markets.find((m) => m.market === 'overseas')!;
    expect(domestic).toMatchObject({ ok: true, upserted: 9 });
    expect(overseas).toMatchObject({ ok: false, attempts: 3 });
    expect(overseas.error).toContain('500');

    expect(alertMock).toHaveBeenCalledTimes(1);
    const [key, level, title] = alertMock.mock.calls[0];
    expect(key).toBe('news-fetch:partial_failed');
    expect(level).toBe('warning');
    expect(title).toContain('부분 실패');
  });
});

describe('전체 실패', () => {
  test('두 시장 다 소진 시 critical 알림 + ok=false, 그러나 HTTP 200', async () => {
    globalThis.fetch = jest.fn().mockImplementation(async () => jsonResponse(500, {}, false));

    const { res, body } = await runPost();

    expect(res.status).toBe(200); // 예상된 실패는 흡수 — 500은 진짜 예외 전용
    expect(body.ok).toBe(false);
    expect(body.markets.every((m) => !m.ok)).toBe(true);

    expect(alertMock).toHaveBeenCalledTimes(1);
    const [key, level, title] = alertMock.mock.calls[0];
    expect(key).toBe('news-fetch:all_failed');
    expect(level).toBe('critical');
    expect(title).toContain('전체 실패');
  });

  test('타임아웃(AbortError)도 실패로 집계되고 재시도된다', async () => {
    globalThis.fetch = jest.fn().mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_, reject) => {
        const signal = init.signal as AbortSignal | undefined;
        signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });

    const { body } = await runPost();

    expect(body.ok).toBe(false);
    for (const m of body.markets) {
      expect(m.ok).toBe(false);
      expect(m.error).toMatch(/timeout after/);
    }
    expect(alertMock).toHaveBeenCalledWith(
      'news-fetch:all_failed', 'critical', expect.any(String), expect.any(String),
    );
  });
});

describe('설정 누락 — fail-safe', () => {
  test('M4_ADMIN_TOKEN·ADMIN_TOKEN 둘 다 없으면 호출 없이 즉시 critical 알림 후 스킵', async () => {
    delete process.env.M4_ADMIN_TOKEN;
    delete process.env.ADMIN_TOKEN;
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock;

    const { res, body } = await runPost();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.markets).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(alertMock).toHaveBeenCalledTimes(1);
    const [key, level] = alertMock.mock.calls[0];
    expect(key).toBe('news-fetch:config');
    expect(level).toBe('critical');
  });

  test('ADMIN_TOKEN(레거시 폴백)만 있어도 정상 동작', async () => {
    delete process.env.M4_ADMIN_TOKEN;
    process.env.ADMIN_TOKEN = 'legacy-admin-token';
    globalThis.fetch = jest.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      expect(headers['X-Admin-Token']).toBe('legacy-admin-token');
      return jsonResponse(200, { upserted: 1 });
    });

    const { body } = await runPost();
    expect(body.ok).toBe(true);
  });
});

describe('예외 흡수', () => {
  test('예상 밖 프로그램 오류는 500 으로 흡수한다', async () => {
    globalThis.fetch = jest.fn().mockImplementation(() => {
      throw new TypeError('unexpected sync throw outside per-market catch');
    });
    // resolveM4Base/Token 은 정상이라 프로그램 흐름상 이 예외는 fetchNewsOnce 내부에서
    // 잡혀 시장별 실패로 흡수된다 — 여기서는 그 계약을 재확인한다(진짜 500 트리거는
    // Promise.all 밖의 코드 변경 없이는 재현이 어려우므로, 최소한 흡수 후 200 을 검증).
    const { res, body } = await runPost();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(false);
  });
});

// ── T-103 시장 지정(?market=) ─────────────────────────────────────────────────────
/** 운영 Next 요청처럼 nextUrl 을 가진 최소 요청. market 이 undefined 면 쿼리 없음. */
function reqWith(market?: string): NextRequest {
  const url = new URL('http://localhost:3003/api/cron/news-fetch');
  if (market !== undefined) url.searchParams.set('market', market);
  return { nextUrl: url } as unknown as NextRequest;
}

/** 시장별 호출 횟수를 세는 fetch mock. status(market) 로 응답 코드를 정한다. */
function countingFetch(status: (market: string) => number = () => 200) {
  const counts: Record<string, number> = {};
  const fn = jest.fn().mockImplementation(async (_url: string, init: RequestInit) => {
    const { market } = JSON.parse(init.body as string) as { market: string };
    counts[market] = (counts[market] ?? 0) + 1;
    const s = status(market);
    return s === 200 ? jsonResponse(200, { upserted: market === 'domestic' ? 4 : 6 }) : jsonResponse(s, { error: 'boom' }, false);
  });
  return { fn, counts };
}

describe('T-103 시장 지정 — 정상', () => {
  test('market=domestic — 국내만 1회 호출(해외 0), 응답 markets 길이 1, 알림 없음', async () => {
    const { fn, counts } = countingFetch();
    globalThis.fetch = fn;

    const { res, body } = await runPost(reqWith('domestic'));

    expect(res.status).toBe(200);
    expect(counts).toEqual({ domestic: 1 });
    expect(body).toEqual({ ok: true, markets: [{ market: 'domestic', ok: true, upserted: 4, attempts: 1 }] });
    expect(alertMock).not.toHaveBeenCalled();
  });

  // (T-115) limit 기대값 20 → 100(시장별 상수). URL·헤더·본문 키 구성은 그대로.
  test('market=overseas — 해외만 1회 호출(국내 0), 요청 형식(URL·헤더)은 기존과 같고 limit 은 해외 값 100', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    globalThis.fetch = jest.fn().mockImplementation(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse(200, { upserted: 6 });
    });

    const { body } = await runPost(reqWith('overseas'));

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://m4.local:8000/v1/news/fetch');
    expect((calls[0].init.headers as Record<string, string>)['X-Admin-Token']).toBe('test-admin-token');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ market: 'overseas', limit: 100 });
    expect(body).toEqual({ ok: true, markets: [{ market: 'overseas', ok: true, upserted: 6, attempts: 1 }] });
    expect(alertMock).not.toHaveBeenCalled();
  });

  test('단일 시장도 재시도 3회 상한 그대로 — 2번째에 성공하면 attempts 2, 알림 없음', async () => {
    let n = 0;
    globalThis.fetch = jest.fn().mockImplementation(async () => (++n < 2 ? jsonResponse(503, {}, false) : jsonResponse(200, { upserted: 2 })));

    const { body } = await runPost(reqWith('overseas'));

    expect(n).toBe(2);
    expect(body.markets).toEqual([{ market: 'overseas', ok: true, upserted: 2, attempts: 2 }]);
    expect(alertMock).not.toHaveBeenCalled();
  });
});

describe('T-103 시장 미지정 — 하위 호환(두 시장)', () => {
  test('nextUrl 이 있어도 market 이 없으면 두 시장 각 1회', async () => {
    const { fn, counts } = countingFetch();
    globalThis.fetch = fn;

    const { body } = await runPost(reqWith());

    expect(counts).toEqual({ domestic: 1, overseas: 1 });
    expect(body.ok).toBe(true);
    expect(body.markets.map((m) => m.market).sort()).toEqual(['domestic', 'overseas']);
  });

  test('미지정 경로 부분 실패 — 기존 키 news-fetch:partial_failed · warning 불변(시장별 키 안 씀)', async () => {
    const { fn } = countingFetch((m) => (m === 'domestic' ? 500 : 200));
    globalThis.fetch = fn;

    await runPost(reqWith());

    expect(alertMock).toHaveBeenCalledTimes(1);
    expect(alertMock.mock.calls[0].slice(0, 2)).toEqual(['news-fetch:partial_failed', 'warning']);
  });

  test('미지정 경로 전체 실패 — 기존 키 news-fetch:all_failed · critical 불변', async () => {
    const { fn, counts } = countingFetch(() => 500);
    globalThis.fetch = fn;

    await runPost(reqWith());

    expect(counts).toEqual({ domestic: 3, overseas: 3 });
    expect(alertMock).toHaveBeenCalledTimes(1);
    expect(alertMock.mock.calls[0].slice(0, 2)).toEqual(['news-fetch:all_failed', 'critical']);
  });
});

describe('T-103 잘못된 시장 값', () => {
  test.each(['', 'Domestic', 'OVERSEAS', 'all', 'kr', 'domestic,overseas', ' overseas'])(
    '🔴 market=%p → 400 invalid_market, M4 호출 0, 알림 0',
    async (bad) => {
      const fetchMock = jest.fn();
      globalThis.fetch = fetchMock;

      const { res, body } = await runPost(reqWith(bad));

      expect(res.status).toBe(400);
      expect(body).toEqual({ ok: false, error: 'invalid_market' });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(alertMock).not.toHaveBeenCalled();
    },
  );

  test('🔴 인증이 먼저 — 인증 실패면 잘못된 시장 값이어도 401(400 아님), M4 호출 0', async () => {
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock;
    authMock.mockReturnValue(jsonResponse(401, { ok: false, error: 'unauthorized' }, false));

    const { POST } = await import('../route');
    const res = await POST(reqWith('nope'));

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(alertMock).not.toHaveBeenCalled();
  });

  test('🔴 인증 실패면 정상 시장 값이어도 401, M4 호출 0', async () => {
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock;
    authMock.mockReturnValue(jsonResponse(401, { ok: false, error: 'unauthorized' }, false));

    const { POST } = await import('../route');
    const res = await POST(reqWith('overseas'));

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('잘못된 값 + 토큰 누락 — 400 이 먼저(설정 알림 안 보냄)', async () => {
    delete process.env.M4_ADMIN_TOKEN;
    delete process.env.ADMIN_TOKEN;
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock;

    const { res } = await runPost(reqWith('xx'));

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(alertMock).not.toHaveBeenCalled();
  });
});

describe('T-103 단일 시장 전량 실패 알림', () => {
  test.each([
    ['domestic', '국내'],
    ['overseas', '해외'],
  ])('🔴 market=%s(%s) 3회 소진 → news-fetch:<market>:failed · critical, 본문에 시장명, HTTP 200·ok=false',async (market, label) => {
    const { fn, counts } = countingFetch(() => 502);
    globalThis.fetch = fn;

    const { res, body } = await runPost(reqWith(market));

    expect(res.status).toBe(200);
    expect(counts).toEqual({ [market]: 3 });
    expect(body.ok).toBe(false);
    expect(body.markets).toHaveLength(1);
    expect(body.markets[0]).toMatchObject({ market, ok: false, upserted: 0, attempts: 3 });
    expect(body.markets[0].error).toContain('502');

    expect(alertMock).toHaveBeenCalledTimes(1);
    const [key, level, title, text] = alertMock.mock.calls[0] as [string, string, string, string];
    expect(key).toBe(`news-fetch:${market}:failed`);
    expect(level).toBe('critical');
    expect(title).toContain(market);
    expect(title).toContain(label);
    expect(text).toContain(market);
    expect(text).toContain(label);
    expect(text).toContain('502');
    // 두 시장 경로 키를 쓰지 않는다
    expect(alertMock.mock.calls.flat()).not.toContain('news-fetch:all_failed');
    expect(alertMock.mock.calls.flat()).not.toContain('news-fetch:partial_failed');
  });

  test('단일 시장 타임아웃 소진도 같은 시장별 키(critical)', async () => {
    globalThis.fetch = jest.fn().mockImplementation((_url: string, init: RequestInit) => new Promise((_, reject) => {
      (init.signal as AbortSignal).addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    }));

    const { body } = await runPost(reqWith('domestic'));

    expect(body.markets[0].error).toMatch(/timeout after/);
    expect(alertMock).toHaveBeenCalledWith('news-fetch:domestic:failed', 'critical', expect.any(String), expect.any(String));
  });
});

describe('T-103 토큰 누락 — 단일 시장', () => {
  test.each(['domestic', 'overseas'])('market=%s 에서도 호출 없이 news-fetch:config critical 1회 후 스킵(200, markets [])', async (market) => {
    delete process.env.M4_ADMIN_TOKEN;
    delete process.env.ADMIN_TOKEN;
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock;

    const { res, body } = await runPost(reqWith(market));

    expect(res.status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.markets).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(alertMock).toHaveBeenCalledTimes(1);
    const [key, level, , text] = alertMock.mock.calls[0] as [string, string, string, string];
    expect(key).toBe('news-fetch:config');
    expect(level).toBe('critical');
    expect(text).toContain(market);
  });
});

describe('T-103 정적 — 호출 기록 지점 불변', () => {
  test("trackCall('m4', 'news.fetch' 호출 지점은 1곳 그대로", () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'route.ts'), 'utf8');
    expect(src.match(/trackCall\('m4', 'news\.fetch'/g)?.length).toBe(1);
  });
});

describe('T-106 뉴스 0건 연속 감시 — 수집 채널 기록', () => {
  const healthArgs = () =>
    (healthMock.mock.calls.map((c) => c[0]) as { channel: string; market: string; count: number }[])
      .sort((a, b) => a.market.localeCompare(b.market));

  test('두 시장 성공·fresh 없음 → 시장별 upserted 를 fetch 채널로 기록, 응답 형식 불변(fresh 키 없음)', async () => {
    const { fn } = countingFetch();
    globalThis.fetch = fn;

    const { res, body } = await runPost();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      markets: [
        { market: 'domestic', ok: true, upserted: 4, attempts: 1 },
        { market: 'overseas', ok: true, upserted: 6, attempts: 1 },
      ],
    });
    expect(healthArgs()).toEqual([
      { channel: 'fetch', market: 'domestic', count: 4 },
      { channel: 'fetch', market: 'overseas', count: 6 },
    ]);
    expect(alertMock).not.toHaveBeenCalled();
  });

  test('🔴 M4 응답에 숫자 fresh 가 있으면 upserted 대신 fresh 로 센다(낡은 기사 재저장 = upserted 20, fresh 0) — 응답에는 싣지 않는다', async () => {
    globalThis.fetch = jest.fn().mockImplementation(async () => jsonResponse(200, { upserted: 20, fresh: 0 }));

    const { body } = await runPost(reqWith('overseas'));

    expect(body).toEqual({ ok: true, markets: [{ market: 'overseas', ok: true, upserted: 20, attempts: 1 }] });
    expect(healthArgs()).toEqual([{ channel: 'fetch', market: 'overseas', count: 0 }]);
  });

  test('fresh 가 양수면 그 값으로 센다', async () => {
    globalThis.fetch = jest.fn().mockImplementation(async () => jsonResponse(200, { upserted: 20, fresh: 7 }));
    await runPost(reqWith('domestic'));
    expect(healthArgs()).toEqual([{ channel: 'fetch', market: 'domestic', count: 7 }]);
  });

  test.each([
    ['문자열', '5'],
    ['음수', -1],
    ['null', null],
    ['객체', { n: 1 }],
  ])('fresh 가 %s 이면 무시하고 upserted 로 센다', async (_n, fresh) => {
    globalThis.fetch = jest.fn().mockImplementation(async () => jsonResponse(200, { upserted: 9, fresh }));
    const { body } = await runPost(reqWith('domestic'));
    expect(body.markets).toEqual([{ market: 'domestic', ok: true, upserted: 9, attempts: 1 }]);
    expect(healthArgs()).toEqual([{ channel: 'fetch', market: 'domestic', count: 9 }]);
  });

  test('🔴 단일 시장 3회 소진 실패 → 0 으로 기록, 기존 알림 키·심각도 그대로', async () => {
    const { fn } = countingFetch(() => 502);
    globalThis.fetch = fn;

    const { body } = await runPost(reqWith('overseas'));

    expect(body.markets[0]).toMatchObject({ market: 'overseas', ok: false, upserted: 0, attempts: 3 });
    expect(healthArgs()).toEqual([{ channel: 'fetch', market: 'overseas', count: 0 }]);
    expect(alertMock).toHaveBeenCalledTimes(1);
    expect(alertMock.mock.calls[0][0]).toBe('news-fetch:overseas:failed');
    expect(alertMock.mock.calls[0][1]).toBe('critical');
  });

  test('두 시장 부분 실패 → 실패 시장 0·성공 시장 upserted, 기존 partial_failed warning 그대로', async () => {
    const { fn } = countingFetch((m) => (m === 'domestic' ? 500 : 200));
    globalThis.fetch = fn;

    const { body } = await runPost();

    expect(body.ok).toBe(false);
    expect(healthArgs()).toEqual([
      { channel: 'fetch', market: 'domestic', count: 0 },
      { channel: 'fetch', market: 'overseas', count: 6 },
    ]);
    expect(alertMock).toHaveBeenCalledTimes(1);
    expect(alertMock.mock.calls[0][0]).toBe('news-fetch:partial_failed');
    expect(alertMock.mock.calls[0][1]).toBe('warning');
  });

  test('🔴 감시 기록이 던져도(이론상 없음) 응답·HTTP 상태·기존 알림은 그대로', async () => {
    healthMock.mockRejectedValue(new Error('db down'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { fn } = countingFetch();
    globalThis.fetch = fn;

    const { res, body } = await runPost(reqWith('domestic'));

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, markets: [{ market: 'domestic', ok: true, upserted: 4, attempts: 1 }] });
    expect(alertMock).not.toHaveBeenCalled();
    expect(healthMock).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  test('토큰 누락 스킵·잘못된 market 400·인증 실패에서는 기록하지 않는다', async () => {
    globalThis.fetch = jest.fn();
    delete process.env.M4_ADMIN_TOKEN;
    await runPost(reqWith('domestic'));
    process.env.M4_ADMIN_TOKEN = 'test-admin-token';
    await runPost(reqWith('DOMESTIC'));
    authMock.mockReturnValue(jsonResponse(401, { ok: false, error: 'unauthorized' }, false));
    await runPost();
    expect(healthMock).not.toHaveBeenCalled();
  });
});

describe('T-115 시장별 limit', () => {
  /** 시장 → 요청 본문 목록(재시도 포함 모든 시도). */
  function bodyRecorder(status: (market: string) => number = () => 200) {
    const bodies: { market: string; limit: unknown }[] = [];
    const fn = jest.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const b = JSON.parse(init.body as string) as { market: string; limit: unknown };
      bodies.push(b);
      const s = status(b.market);
      return s === 200 ? jsonResponse(200, { upserted: 1 }) : jsonResponse(s, {}, false);
    });
    return { fn, bodies };
  }

  test.each([
    ['domestic', 100],
    ['overseas', 100],
  ])('🔴 market=%s → 요청 본문 limit = %i (본문 키는 market·limit 둘뿐)', async (market, limit) => {
    const { fn, bodies } = bodyRecorder();
    globalThis.fetch = fn;

    await runPost(reqWith(market));

    expect(bodies).toEqual([{ market, limit }]);
  });

  test('🔴 시장 미지정(두 시장) — 시장마다 자기 limit(국내 100·해외 100)', async () => {
    const { fn, bodies } = bodyRecorder();
    globalThis.fetch = fn;

    await runPost();

    expect([...bodies].sort((a, b) => a.market.localeCompare(b.market))).toEqual([
      { market: 'domestic', limit: 100 },
      { market: 'overseas', limit: 100 },
    ]);
  });

  test('재시도마다 같은 limit — 3회 소진 시 세 본문 모두 100, 시도 상한·알림은 그대로', async () => {
    const { fn, bodies } = bodyRecorder(() => 502);
    globalThis.fetch = fn;

    const { body } = await runPost(reqWith('domestic'));

    expect(bodies).toEqual([
      { market: 'domestic', limit: 100 },
      { market: 'domestic', limit: 100 },
      { market: 'domestic', limit: 100 },
    ]);
    expect(body.markets[0]).toMatchObject({ market: 'domestic', ok: false, attempts: 3 });
    expect(alertMock).toHaveBeenCalledTimes(1);
    expect(alertMock.mock.calls[0].slice(0, 2)).toEqual(['news-fetch:domestic:failed', 'critical']);
  });

  test('정적 — 옛 공통 상수 NEWS_FETCH_LIMIT 없음 · 시장별 상수 값 · 재시도 3·시도당 60초·대기 3초 불변 · 라우트 외 export 없음', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'route.ts'), 'utf8');
    expect(src).not.toMatch(/\bNEWS_FETCH_LIMIT\b/);
    expect(src).toMatch(/^const NEWS_FETCH_LIMITS: Readonly<Record<Market, number>> = \{ domestic: 100, overseas: 100 \};$/m);
    expect(src).toMatch(/^const MAX_ATTEMPTS = 3;$/m);
    expect(src).toMatch(/^const REQUEST_TIMEOUT_MS = 60_000;$/m);
    expect(src).toMatch(/^const RETRY_BACKOFF_MS = 3_000;$/m);
    // Next App Router 는 route.ts 의 HTTP 메서드·설정 외 export 를 빌드에서 거부한다 — 상수를 export 하지 않는다.
    const exported = [...src.matchAll(/^export\s+(?:async\s+)?(?:const|function|let)\s+(\w+)/gm)].map((m) => m[1]).sort();
    expect(exported).toEqual(['POST', 'dynamic']);
  });
});
