/**
 * T-017 — KIS 단일 관문(`kisFetch`) 계약.
 *
 * 이 파일이 지키는 핵심 회귀는 **재시도 증폭**이다.
 *
 * KIS 레이트리밋은 `HTTP 500 + {"rt_cd":"1","msg_cd":"EGW00201"}` 로 온다. 기존
 * `kis-domestic.getTicker` 는 `status === 500` 이면 300ms 뒤 무조건 재시도했으므로,
 * **레이트리밋을 맞을 때마다 곧바로 한 번 더 때려서** 과부하를 키웠다. 여기서는
 * 레이트리밋과 진짜 5xx 를 구분하고, 레이트리밋은 백오프 후 **유량 토큰을 새로 받아** 재시도한다.
 */
import {
  kisFetch,
  isKisRateLimited,
  isKisRateLimitBody,
  kisAttempts,
  kisBodyText,
} from '@/lib/exchanges/kis-http';
import {
  acquireKisSlot,
  getKisThrottleStats,
  KisThrottleQueueFullError,
  __resetKisThrottleForTest,
  __LANE_CAPACITY,
} from '@/lib/exchanges/kis-throttle';

/** 실측 레이트리밋 응답 (운영 로그에서 그대로 가져옴) */
const RATE_LIMIT_BODY =
  '{"rt_cd":"1","msg1":"초당 거래건수를 초과하였습니다.","msg_cd":"EGW00201","message":"EGW00201"}';
const RATE_LIMIT_BODY_215 = '{"rt_cd":"1","msg_cd":"EGW00215"}';

const originalFetch = global.fetch;
let fetchMock: jest.Mock;

function res(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  __resetKisThrottleForTest(1000);   // 유량은 이 파일의 관심사가 아니다 — 넉넉히 열어 둔다
  fetchMock = jest.fn();
  (global as unknown as { fetch: unknown }).fetch = fetchMock;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  (global as unknown as { fetch: unknown }).fetch = originalFetch;
  jest.restoreAllMocks();
  __resetKisThrottleForTest();
});

describe('레이트리밋 본문 식별', () => {
  it.each([
    [RATE_LIMIT_BODY,      true,  'EGW00201'],
    [RATE_LIMIT_BODY_215,  true,  'EGW00215'],
    ['초당 거래건수를 초과하였습니다.', true, '한글 메시지만 있는 경우'],
    ['{"rt_cd":"1","msg_cd":"EGW00123"}', false, '토큰 만료'],
    ['{"error_code":"EGW00133"}',         false, '토큰 1분당 1회 — 성격이 다르다'],
    ['{"rt_cd":"0"}',                     false, '정상'],
    ['',                                  false, '빈 본문'],
  ])('%s → %s (%s)', (body, expected) => {
    expect(isKisRateLimitBody(body)).toBe(expected);
  });

  it('EGW00133(토큰 1분당 1회)은 레이트리밋으로 재시도하지 않는다 — 이중 백오프 방지', async () => {
    fetchMock.mockResolvedValue(res(403, '{"error_code":"EGW00133"}'));
    const r = await kisFetch('https://kis.example/oauth2/tokenP', {}, { priority: 'critical' });
    expect(fetchMock).toHaveBeenCalledTimes(1);   // 재시도 없음
    expect(isKisRateLimited(r)).toBe(false);
    expect(r.status).toBe(403);
  });
});

describe('재시도 증폭 방지', () => {
  it('레이트리밋은 즉시 재시도하지 않고 백오프 후 다시 줄을 선다', async () => {
    fetchMock.mockResolvedValue(res(500, RATE_LIMIT_BODY));
    const callTimes: number[] = [];
    fetchMock.mockImplementation(async () => {
      callTimes.push(Date.now());
      return res(500, RATE_LIMIT_BODY);
    });

    await kisFetch('https://kis.example/x', {}, { rateLimitRetries: 1 });

    expect(callTimes).toHaveLength(2);
    // 기존 동작(300ms 즉시 재시도)보다 **확실히 더 물러선다** — 최소 백오프 400ms.
    expect(callTimes[1] - callTimes[0]).toBeGreaterThanOrEqual(400);
  });

  it('재시도할 때마다 유량 토큰을 새로 소비한다 (대기열 우회 금지)', async () => {
    // ⚠️ mockResolvedValue 로 **같은 Response 인스턴스**를 재사용하면 두 번째 읽기가
    //    "Body has already been read" 로 실패해 실제와 다른 상황이 된다. 매번 새로 만든다.
    fetchMock.mockImplementation(async () => res(500, RATE_LIMIT_BODY));
    const before = getKisThrottleStats().granted;
    await kisFetch('https://kis.example/x', {}, { rateLimitRetries: 2 });
    // 3회 시도 = 토큰 3개. 재시도가 스로틀을 우회하면 이 수가 1이 된다.
    expect(getKisThrottleStats().granted - before).toBe(3);
  });

  it('재시도를 소진하면 마지막 응답을 레이트리밋으로 표시해 돌려준다', async () => {
    fetchMock.mockImplementation(async () => res(500, RATE_LIMIT_BODY));
    const r = await kisFetch('https://kis.example/x', {}, { rateLimitRetries: 1 });
    expect(r.status).toBe(500);
    expect(isKisRateLimited(r)).toBe(true);       // 호출부가 "또 때리지 말라"를 알 수 있어야 한다
    expect(kisAttempts(r)).toBe(2);
  });

  it('중간에 성공하면 거기서 멈춘다', async () => {
    fetchMock
      .mockResolvedValueOnce(res(500, RATE_LIMIT_BODY))
      .mockResolvedValueOnce(res(200, '{"rt_cd":"0","output":{"stck_prpr":"71000"}}'));

    const r = await kisFetch('https://kis.example/x', {}, { rateLimitRetries: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(r.ok).toBe(true);
    expect(isKisRateLimited(r)).toBe(false);
    await expect(r.json()).resolves.toMatchObject({ rt_cd: '0' });
  });

  it('rateLimitRetries=0 이면 재시도하지 않는다', async () => {
    fetchMock.mockImplementation(async () => res(500, RATE_LIMIT_BODY));
    const r = await kisFetch('https://kis.example/x', {}, { rateLimitRetries: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(isKisRateLimited(r)).toBe(true);
  });
});

describe('진짜 서버 오류는 종전대로 — kisFetch 가 삼키거나 재시도하지 않는다', () => {
  it('레이트리밋이 아닌 500 은 재시도하지 않고 그대로 반환한다 (호출부 재시도 로직 보존)', async () => {
    fetchMock.mockResolvedValue(res(500, '{"rt_cd":"1","msg1":"서버 내부 오류"}'));
    const r = await kisFetch('https://kis.example/x');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.status).toBe(500);
    expect(isKisRateLimited(r)).toBe(false);
  });

  it('4xx 도 그대로 반환한다', async () => {
    fetchMock.mockResolvedValue(res(401, '{"msg":"unauthorized"}'));
    const r = await kisFetch('https://kis.example/x');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.status).toBe(401);
  });

  it('네트워크 예외는 그대로 전파된다', async () => {
    fetchMock.mockRejectedValue(new Error('fetch failed'));
    await expect(kisFetch('https://kis.example/x')).rejects.toThrow('fetch failed');
  });
});

describe('본문 재생 — 호출부는 종전처럼 읽는다', () => {
  it('원본이 소비된 뒤에도 호출부는 json() 으로 읽을 수 있다', async () => {
    // kisFetch 는 레이트리밋 판정을 위해 원본 본문을 이미 읽었다. 재생본이 없다면
    // 호출부의 res.json() 이 "Body has already been read" 로 실패한다.
    fetchMock.mockImplementation(async () => res(200, '{"a":1}'));
    const r = await kisFetch('https://kis.example/x');
    await expect(r.json()).resolves.toEqual({ a: 1 });
  });

  it('본문을 소비한 뒤에도 원문을 진단용으로 얻을 수 있다 (kisBodyText)', async () => {
    fetchMock.mockImplementation(async () => res(500, RATE_LIMIT_BODY));
    const r = await kisFetch('https://kis.example/x', {}, { rateLimitRetries: 0 });
    await r.text();                                   // 호출부가 본문을 소비
    expect(kisBodyText(r)).toContain('EGW00201');      // 그래도 원문은 남아 있다
  });

  it('상태코드·ok·헤더가 보존된다', async () => {
    fetchMock.mockImplementation(async () => res(503, 'nope'));
    const r = await kisFetch('https://kis.example/x');
    expect(r.status).toBe(503);
    expect(r.ok).toBe(false);
    expect(r.headers.get('content-type')).toBe('application/json');
  });

  it('204(본문 없음) 응답에서 터지지 않는다', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const r = await kisFetch('https://kis.example/x');
    expect(r.status).toBe(204);
  });
});

describe('타임아웃 — 스로틀 대기 시간이 타임아웃을 잡아먹지 않는다', () => {
  it('타이머는 토큰을 받은 뒤에 걸린다', async () => {
    // 유량을 조여 대기가 발생하게 만든다.
    __resetKisThrottleForTest(4);              // 버스트 4, 이후 250ms 간격
    await Promise.all(Array.from({ length: 4 }, () => acquireKisSlot('normal')));

    let signalAbortedAtFetch = false;
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      signalAbortedAtFetch = (init?.signal as AbortSignal | undefined)?.aborted ?? false;
      return res(200, '{"ok":true}');
    });

    // 타임아웃 200ms < 대기 250ms. 타이머가 대기 **전에** 걸렸다면 abort 된 채로 fetch 에 닿는다.
    const r = await kisFetch('https://kis.example/x', {}, { timeoutMs: 200 });
    expect(signalAbortedAtFetch).toBe(false);
    expect(r.ok).toBe(true);
  });

  it('timeoutMs 미지정이면 signal 을 붙이지 않는다 (기존 동작 보존)', async () => {
    fetchMock.mockResolvedValue(res(200, '{}'));
    await kisFetch('https://kis.example/x', { headers: { a: 'b' } });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeUndefined();
    expect(init.headers).toEqual({ a: 'b' });
  });
});

describe('대기열 초과는 kisFetch 밖으로 그대로 전파된다', () => {
  it('KisThrottleQueueFullError 를 던지고 fetch 를 부르지 않는다', async () => {
    __resetKisThrottleForTest(0.2);
    Array.from({ length: __LANE_CAPACITY.bulk }, () => acquireKisSlot('bulk').catch(() => {}));

    await expect(kisFetch('https://kis.example/x', {}, { priority: 'bulk' }))
      .rejects.toThrow(KisThrottleQueueFullError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
