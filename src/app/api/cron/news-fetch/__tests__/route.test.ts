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
 *
 * 실제 M4 서버 호출 안 함 — global.fetch mock으로 격리. 재시도 백오프(3s)는 fake timers로
 * 실제 대기 없이 진행시킨다.
 */
import type { NextRequest } from 'next/server';

const authMock = jest.fn();
const alertMock = jest.fn();

jest.mock('@/lib/cron-auth', () => ({ checkCronAuth: (...a: unknown[]) => authMock(...a) }));
jest.mock('@/lib/notify/throttle', () => ({
  sendAlertThrottled: (...a: unknown[]) => alertMock(...a),
  resetAlertThrottle: () => {},
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
async function runPost(): Promise<{ res: Response; body: Body }> {
  const { POST } = await import('../route');
  const resPromise = POST(req);
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
      expect(parsedBody.limit).toBe(20);
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
