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
  isTransientKisFailure,
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

// ── T-132 일시 실패 재시도 (옵트인) ──────────────────────────────────────────
//
// 2026-10-31 KIS 측 장애 실측 두 모양. 둘 다 같은 창에서 나왔고, 1초 뒤 같은 호출은 성공했다.
const GATEWAY_BODY = '{"rt_cd":"1","msg_cd":"EGW00300","msg1":"Gateway 라우팅 오류가 발생했습니다."}';
const SESSION_FULL_BODY = '{"rt_cd":"9","msg_cd":"OPSQ1002","msg1":"SESSION FULL"}';
const OK_BODY = '{"rt_cd":"0","output1":[]}';

describe('일시 실패 판정 (isTransientKisFailure)', () => {
  it.each([
    [500, GATEWAY_BODY,     true,  'HTTP 500 게이트웨이 오류'],
    [503, '',               true,  '본문 없는 5xx'],
    [200, SESSION_FULL_BODY, true, 'HTTP 200 + rt_cd=9 (SESSION FULL)'],
    [200, OK_BODY,          false, '정상 응답'],
    [200, '{"access_token":"x"}', false, 'rt_cd 없는 응답(tokenP) — 실패로 보지 않는다'],
    [403, '{"error_code":"EGW00133"}', false, '토큰 1분당 1회 — 성격이 다르다'],
    [500, '{"rt_cd":"1","msg_cd":"EGW00123","msg1":"기간이 만료된 token 입니다."}', false,
      '토큰 만료 — 재시도가 아니라 재발급이 답이다(호출부 담당)'],
    [500, '{"rt_cd":"1","msg_cd":"EGW00121"}', false, '유효하지 않은 토큰'],
  ])('status=%s → %s (%s)', (status, body, expected) => {
    expect(isTransientKisFailure(status as number, body as string)).toBe(expected);
  });
});

describe('transientRetries (T-132)', () => {
  it('🔴 기본값은 0 — 진짜 5xx 에 재시도하지 않는다 (T-017 doctrine 회귀)', async () => {
    fetchMock.mockResolvedValue(res(500, GATEWAY_BODY));
    const r = await kisFetch('https://kis.example/balance');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.status).toBe(500);
    expect(kisAttempts(r)).toBe(1);
  });

  it('켜면 일시 5xx 를 재시도하고, 중간에 성공하면 그 응답을 돌려준다', async () => {
    fetchMock
      .mockResolvedValueOnce(res(500, GATEWAY_BODY))
      .mockResolvedValueOnce(res(200, OK_BODY));
    const r = await kisFetch('https://kis.example/balance', {}, { transientRetries: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(r.ok).toBe(true);
    expect(await r.json()).toEqual({ rt_cd: '0', output1: [] });
    expect(kisAttempts(r)).toBe(2);
  });

  it('HTTP 200 + rt_cd≠0(SESSION FULL)도 재시도 대상이다', async () => {
    fetchMock
      .mockResolvedValueOnce(res(200, SESSION_FULL_BODY))
      .mockResolvedValueOnce(res(200, OK_BODY));
    const r = await kisFetch('https://kis.example/balance', {}, { transientRetries: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(kisBodyText(r)).toBe(OK_BODY);
  });

  it('소진하면 마지막 응답을 그대로 돌려준다 — 호출부의 실패 처리가 그대로 동작하게', async () => {
    // 본문은 한 번만 읽히므로 호출마다 새 Response 를 준다(한 객체를 재사용하면 2회차부터 본문이 '').
    fetchMock.mockImplementation(async () => res(500, GATEWAY_BODY));
    const r = await kisFetch('https://kis.example/balance', {}, { transientRetries: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(3);   // 최초 1 + 재시도 2
    expect(r.status).toBe(500);
    expect(kisBodyText(r)).toBe(GATEWAY_BODY);
    expect(kisAttempts(r)).toBe(3);
  });

  it('정상 응답에는 재시도하지 않는다', async () => {
    fetchMock.mockResolvedValue(res(200, OK_BODY));
    await kisFetch('https://kis.example/balance', {}, { transientRetries: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('🔴 레이트리밋에는 일시 실패 예산을 쓰지 않는다 — 두 번 물러서면 증폭이 부활한다', async () => {
    fetchMock.mockImplementation(async () => res(500, RATE_LIMIT_BODY));
    const r = await kisFetch('https://kis.example/balance', {}, { transientRetries: 2 });
    // 레이트리밋 재시도 2회만(총 3회). 여기에 일시 재시도 2회가 더 붙으면 9회가 된다.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(isKisRateLimited(r)).toBe(true);
  });

  it('토큰 오류(403 EGW00133)는 켜 두어도 재시도하지 않는다', async () => {
    fetchMock.mockResolvedValue(res(403, '{"error_code":"EGW00133"}'));
    await kisFetch('https://kis.example/oauth2/tokenP', {}, { transientRetries: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('음수·0 은 재시도 없음으로 다룬다', async () => {
    fetchMock.mockResolvedValue(res(500, GATEWAY_BODY));
    await kisFetch('https://kis.example/balance', {}, { transientRetries: -3 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 멱등성 울타리 — transientRetries 는 GET 에만 (T-132 M-1)', () => {
  it.each(['POST', 'post', 'PUT', 'DELETE'])('%s 에 켜면 요청을 보내기 전에 던진다', async (method) => {
    await expect(kisFetch('https://kis.example/order', { method }, { transientRetries: 2, label: 'x createOrder' }))
      .rejects.toThrow(/GET 조회에만 허용/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('method 미지정(GET 기본)·명시 GET 은 통과한다', async () => {
    fetchMock.mockImplementation(async () => res(200, OK_BODY));
    await kisFetch('https://kis.example/balance', {}, { transientRetries: 2 });
    await kisFetch('https://kis.example/balance', { method: 'GET' }, { transientRetries: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('transientRetries 를 켜지 않은 POST(주문 경로)는 영향 없다', async () => {
    fetchMock.mockImplementation(async () => res(200, OK_BODY));
    await kisFetch('https://kis.example/order', { method: 'POST' }, { priority: 'critical' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('재시도 요약 줄 (T-132 L-6·N-1)', () => {
  /** `console.warn` 호출 전부를 한 문자열로 */
  const warnText = () => (console.warn as jest.Mock).mock.calls.map(c => String(c[0])).join('\n');

  it('500 뒤 복구되면 "성공" 으로 적는다', async () => {
    fetchMock
      .mockResolvedValueOnce(res(500, GATEWAY_BODY))
      .mockResolvedValueOnce(res(200, OK_BODY));
    await kisFetch('https://kis.example/balance', {}, { transientRetries: 2, label: 'domestic getBalances' });
    expect(warnText()).toMatch(/일시 실패 재시도 성공 \(domestic getBalances\) — 2회 시도/);
  });

  it('🔴 HTTP 200 SESSION FULL 로 소진되면 "성공" 이라고 적지 않는다 (N-1 오집계)', async () => {
    fetchMock.mockImplementation(async () => res(200, SESSION_FULL_BODY));
    await kisFetch('https://kis.example/balance', {}, { transientRetries: 2 });
    expect(warnText()).toMatch(/일시 실패 재시도 소진 — 3회 시도/);
    expect(warnText()).not.toMatch(/재시도 성공/);
  });

  it('재시도를 하지 않은 호출에는 요약 줄이 없다', async () => {
    fetchMock.mockResolvedValue(res(200, OK_BODY));
    await kisFetch('https://kis.example/balance', {}, { transientRetries: 2 });
    expect(warnText()).not.toMatch(/일시 실패 재시도/);
  });

  it('transientRetries 는 5 로 깎인다 — 장애 중 한 호출이 수십 번 때리지 않게 (I-2)', async () => {
    fetchMock.mockImplementation(async () => res(500, GATEWAY_BODY));
    await kisFetch('https://kis.example/balance', {}, { transientRetries: 50 });
    expect(fetchMock).toHaveBeenCalledTimes(6);   // 최초 1 + 재시도 5
  }, 20_000);
});
