/**
 * T-136 QA F-1 — `getKisToken()` 의 **발급 경로**가 진행 중인 재발급에 합류하는지.
 *
 * ## 무엇이 문제였나
 *
 * `invalidateKisToken()` 은 예전부터 `refreshInFlight` 로 중복 발급을 막았는데, `getKisToken()` 이
 * DB 캐시에서 "행 없음" 을 보고 `issueAndStore` 로 떨어지는 경로만 **그 단일화를 비껴갔다.**
 *
 * 행이 없는 흔한 이유가 **방금 다른 호출의 `invalidateKisToken()` 이 그 행을 지웠기 때문**이라, 토큰이
 * 죽은 순간에는 이 두 경로가 거의 항상 겹친다. 그러면 같은 순간 발급이 두 번 일어나고 KIS 의
 * "앱키당 1분 1회"(`EGW00133`)에 걸린 쪽이 **60초를 기다린다** — 그 대기는 `getKisToken()` 을 쓰는 모든
 * 경로를 막고, **`createOrder` 도 그 경로다.**
 *
 * QA 가 혼합 토큰(죽은 토큰 2개가 10ms 차로 실패) 시나리오로 15/15 재현했다. HEAD 는 같은 조건에서
 * 발급 1회였으므로 **T-136 의 판단 경로가 새로 만든 회귀**였다.
 */
jest.mock('@/lib/credentials', () => ({
  getCredential: jest.fn(async (k: string) => (k === 'KIS_APP_KEY' ? 'ak' : 'as')),
}));

/** DB 는 **항상 "행 없음"** — 토큰이 막 지워진 직후 상태를 고정한다. */
jest.mock('@/lib/db', () => ({
  getPool: () => ({ query: jest.fn(async () => [[], []]) }),
}));

jest.mock('../kis-http', () => ({
  kisFetch: jest.fn(async (_url: string, _init: unknown, opts: Record<string, unknown>) => {
    tokenPCalls += 1;
    tokenPOpts.push(opts);
    await new Promise(r => setTimeout(r, 25));           // 발급 왕복
    return new Response(JSON.stringify({ access_token: `tok-${tokenPCalls}`, expires_in: 86_400 }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  }),
}));

import { getKisToken, invalidateKisToken } from '../kis-auth';

let tokenPCalls = 0;
const tokenPOpts: Record<string, unknown>[] = [];

/** 기본(성공) 발급 동작. 실패 시험이 `mockImplementation` 으로 덮으므로 매번 되돌린다 — `restoreAllMocks` 는 공장 모의의 구현을 되돌리지 않는다. */
function okIssue() {
  const { kisFetch } = jest.requireMock('../kis-http') as { kisFetch: jest.Mock };
  kisFetch.mockImplementation(async (_url: string, _init: unknown, opts: Record<string, unknown>) => {
    tokenPCalls += 1;
    tokenPOpts.push(opts);
    await new Promise(r => setTimeout(r, 25));
    return new Response(JSON.stringify({ access_token: `tok-${tokenPCalls}`, expires_in: 86_400 }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  });
}

beforeEach(() => {
  tokenPCalls = 0;
  tokenPOpts.length = 0;
  okIssue();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test('🔴 재발급 진행 중에 getKisToken 이 들어오면 발급은 **1회**다 (QA F-1)', async () => {
  const a = invalidateKisToken();            // refreshInFlight 설정 + 발급 시작
  await new Promise(r => setTimeout(r, 10));  // 그 사이에
  const b = getKisToken();                    // 행 없음 → 합류해야 한다
  const [ta, tb] = await Promise.all([a, b]);
  expect(tokenPCalls).toBe(1);                // 합류하지 않으면 2 가 되고 EGW00133 대기가 생긴다
  expect(ta).toBe(tb);                        // 같은 토큰을 받는다
});

/**
 * 🔴 **아직 남아 있는 구멍을 사실대로 고정한다.**
 *
 * `getKisToken()` 끼리의 동시 호출은 **여전히 중복 발급한다** — 첫 호출이 `refreshInFlight` 를 세우지
 * 않기 때문이다(그 플래그는 `invalidateKisToken()` 만 세운다). T-136 이 고친 것은 "재발급이 진행 중일
 * 때 합류한다" 까지이고, 발급 **자체**의 단일화는 후속 후보 5 다.
 *
 * **T-138 이 이 구멍을 닫았다** — `test.failing` 이던 아래 시험이 이제 정상으로 통과한다. T-136 이
 * 공백을 시험으로 적어 두고 T-138 이 그것을 통과시킨 것이 이 두 task 의 연결점이다.
 * (T-136 당시 기록: 단언을 현재 동작에 맞춰 두면 나쁜 동작을 "정상" 으로 못 박는 셈이므로
 *  `test.failing` 으로 원하는 동작을 적어 뒀다.)
 */
test('🔴 getKisToken 끼리의 동시 호출도 발급 1회다 (T-138 — T-136 의 test.failing 을 전환)', async () => {
  const first = getKisToken();
  await new Promise(r => setTimeout(r, 5));
  await Promise.all([first, getKisToken(), getKisToken(), getKisToken()]);
  expect(tokenPCalls).toBe(1);
});

/**
 * 🔴 갱신 시각 폭주 재현 (T-138). 2026-10-30 KST 16:00 에 `token-p` 가 118건 호출돼 111건이 403 거절당한
 * 그 모양이다 — 진행 중인 조회 전부가 같은 순간 캐시 미스를 보고 각자 발급으로 내려갔다.
 */
test('🔴 동시 40건이 캐시 미스를 봐도 발급은 1회다 (10-30 폭주 재현)', async () => {
  const tokens = await Promise.all(Array.from({ length: 40 }, () => getKisToken()));
  expect(tokenPCalls).toBe(1);
  expect(new Set(tokens).size).toBe(1);        // 40건이 같은 토큰을 받는다
});

/**
 * 🔴 **두 경로가 같은 비행을 공유한다** 의 **나머지 절반** (T-138 감사 C-1).
 *
 * 위 시험들은 `getKisToken()` 끼리의 공유만 증명한다. `invalidateKisToken()` 쪽 전환을 되돌리는 변이가
 * 기존 7건을 전부 통과해 살아남았다(감사 변이 M1) — 코드는 맞는데 **증명이 없었다.**
 */
test('🔴 getKisToken 이 띄운 비행에 invalidateKisToken 도 합류한다 (발급 1회)', async () => {
  const first = getKisToken();                 // 비행 시작(발급 왕복 25ms)
  await new Promise(r => setTimeout(r, 5));
  const second = invalidateKisToken();         // 진행 중인 비행에 올라타야 한다
  const [a, b] = await Promise.all([first, second]);
  expect(tokenPCalls).toBe(1);
  expect(a).toBe(b);
});

test('🔴 발급이 끝난 뒤의 호출은 새 비행을 만든다 (비행이 영구히 남지 않는다)', async () => {
  await getKisToken();
  expect(tokenPCalls).toBe(1);
  await getKisToken();
  expect(tokenPCalls).toBe(2);                 // 캐시가 항상 "행 없음" 이므로 다시 발급한다
});

test('🔴 발급이 실패해도 비행이 남지 않는다 — 다음 호출이 다시 시도한다', async () => {
  const { kisFetch } = jest.requireMock('../kis-http') as { kisFetch: jest.Mock };
  kisFetch.mockImplementationOnce(async () => {
    tokenPCalls += 1;
    return new Response('{"msg_cd":"OTHER"}', { status: 500 });
  });
  const settled = await Promise.allSettled([getKisToken(), getKisToken()]);
  expect(settled.map(r => r.status)).toEqual(['rejected', 'rejected']);   // 같은 비행을 공유해 함께 실패
  expect(tokenPCalls).toBe(1);
  okIssue();
  await expect(getKisToken()).resolves.toMatch(/^tok-/);                  // 비행이 비워져 복구된다
}, 20_000);

/**
 * 🔴 합류한 발급이 **실패할 때** 함께 실패하는가 (fail-closed).
 *
 * 이것이 이 변경의 유일한 손실이다 — 종전에는 합류하지 않고 독립 발급해서 성공할 수도 있었다. 감사
 * 4차 판단은 "받아들일 만하다"다: 거절은 fail-closed 이고 `refreshInFlight` 가 비워지면 다음 호출이
 * 다시 발급해 복구하며, HEAD 가 이기는 경우는 첫 발급만 빠르게 실패하는 좁은 틈뿐이다.
 *
 * `EGW00133` 대신 **HTTP 500** 을 쓴다 — `EGW00133` 은 `issueAndStore` 의 60초 대기를 타서 단위 시험이
 * 그 시간을 실제로 기다린다(처음 그렇게 적었다가 30초 타임아웃으로 깨졌다).
 */
test('🔴 합류한 발급이 실패하면 둘 다 실패한다 (fail-closed) — 그리고 다음 호출은 복구한다', async () => {
  const { kisFetch } = jest.requireMock('../kis-http') as { kisFetch: jest.Mock };
  kisFetch.mockImplementation(async () => {
    tokenPCalls += 1;
    await new Promise(r => setTimeout(r, 10));
    return new Response('{"msg_cd":"OTHER","msg1":"서버 오류"}', { status: 500 });
  });

  const a = invalidateKisToken();
  await new Promise(r => setTimeout(r, 5));
  const b = getKisToken();                       // 합류해야 한다
  const settled = await Promise.allSettled([a, b]);
  expect(settled.map(r => r.status)).toEqual(['rejected', 'rejected']);

  // `refreshInFlight` 가 비워졌으므로 다음 호출은 다시 발급해 복구한다.
  const before = tokenPCalls;
  kisFetch.mockImplementation(async () => {
    tokenPCalls += 1;
    return new Response(JSON.stringify({ access_token: 'recovered', expires_in: 86_400 }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  });
  await expect(getKisToken()).resolves.toBe('recovered');
  expect(tokenPCalls).toBeGreaterThan(before);
}, 20_000);

/**
 * (남은 미시험) `EGW00133` 60초 대기 **자체의 거동**은 시험하지 않는다 — 실패 전파는 바로 위 시험이
 * 고정하므로 그쪽은 미검증이 아니다(5차 감사 권고 3: 처음 쓴 「실패 전파 미검증으로 남긴다」는
 * 그 시험을 넣은 뒤로 거짓이 됐다). 남은 것은 대기 시간 자체다 — 발급 실패 경로는 `kis-auth.issueAndStore` 의 재시도와
 * `EGW00133` 60초 대기를 그대로 타므로 단위 시험에서 돌리면 그 대기를 실제로 기다리게 된다(처음 그렇게
 * 적었다가 30초 타임아웃으로 깨졌다). 합류한 호출이 같은 Promise 를 받는다는 것은 위 첫 시험이
 * 고정하고, 실패 전파는 그 Promise 의 성질이다. 정식 시험은 가짜 타이머가 필요하다 — 미검증으로 남긴다.
 */

/**
 * 🔴 발급 호출에 **상한이 있는지** (T-136 QA F-A).
 *
 * 없으면 `kisFetch` 기본값(무제한)이라, 응답 없는 서버에 걸리면 undici 헤더 타임아웃까지 **약 5분**을
 * 매달린다(QA 실측 300,754ms). 그 동안 `getKisToken()` 을 쓰는 **모든** 경로가 멈추는데 `createOrder`
 * 도 그 경로다. T-136 이 합류를 넣어 영향 범위가 넓어졌으므로(합류한 호출도 함께 매달린다) 필수다.
 */
test('🔴 발급 호출은 timeoutMs 로 유계다 — 무계 매달림이 주문 경로를 멈추지 않게', async () => {
  await getKisToken();
  expect(tokenPOpts).toHaveLength(1);
  expect(tokenPOpts[0]).toMatchObject({ priority: 'critical', label: 'tokenP' });
  const t = tokenPOpts[0].timeoutMs;
  expect(typeof t).toBe('number');
  /**
   * **위아래 둘 다** 묶는다(5차 감사 권고 1). 상한만 두면 `1` 같은 값이 통과하는데, 그러면 모든 발급이
   * 즉시 끊겨 **전면 중단**이다(시험은 모른다). 하한 근거는 운영 실측 — `token-p` 129건의 최대 지연이
   * 204ms, KIS 전체 163,474건의 p99.9 가 1.2초, 성공한 가장 느린 호출이 4.0초다. 3초면 정상 응답을
   * 끊지 않고, 30초면 무계 5분과 두 자릿수 차이다. 그 사이에서 값은 자유롭게 조정한다.
   */
  expect(t as number).toBeGreaterThanOrEqual(3_000);
  expect(t as number).toBeLessThanOrEqual(30_000);
});
