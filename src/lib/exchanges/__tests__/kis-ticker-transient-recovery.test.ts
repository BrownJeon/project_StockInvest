/**
 * T-133 — 시세 어댑터와 **실제** `kisFetch` 를 함께 돌려, 게이트웨이 일시 오류 뒤 같은 조회가
 * 복구되는지 본다. `kis-ticker-business-failure.test.ts` 는 `kis-http` 를 모킹하므로 "옵션을 넘겼다"
 * 까지만 확인된다. 이 파일은 `global.fetch` 만 바꿔 **연결 자체**를 검증한다 — 2026-10-31 KIS 장애
 * (실패 직후 같은 TR 이 1초 뒤 성공)가 재현되는지.
 *
 * 예산 계약도 여기서 고정한다 — 응답 기반 재시도는 **게이트웨이 한 곳**(`transientRetries: 2`,
 * 총 3회 시도)이고, 해외의 **던진 예외 재시도 1회**는 그대로 남아 있다(T-133 WP2).
 */
jest.mock('../kis-auth', () => ({
  // `getKisToken()` 은 **호출마다 DB 를 읽는다**(kis-auth 실구현). 그 성질이 T-133 의 토큰 분기
  // 전제이므로, 시험에서도 호출 시점의 `tokenValue` 를 돌려주는 모양으로 둔다.
  getKisToken:        jest.fn(async () => tokenValue),
  invalidateKisToken: jest.fn(async () => { tokenValue = 'reissued'; }),
  kisBaseUrl:         jest.fn(() => 'https://mock-base'),
}));
jest.mock('@/lib/credentials', () => ({
  getCredential: jest.fn(async (key: string) => (key === 'KIS_ACCOUNT_NO' ? '12345678' : '01')),
}));
jest.mock('../fx', () => ({ getUsdKrwRate: jest.fn(async () => FX) }));

import { getTicker as domGetTicker } from '../kis-domestic';
import { getTicker as ovsGetTicker } from '../kis-overseas';
import { __resetKisThrottleForTest } from '../kis-throttle';

const FX = 1332.1;

/** 모킹한 `getKisToken()` 이 돌려줄 값. 시험이 "다른 프로세스가 회전시킨" 상황을 만들 때 바꾼다. */
let tokenValue = 'tok';

const GATEWAY      = '{"rt_cd":"1","msg_cd":"EGW00300","msg1":"Gateway 라우팅 오류가 발생했습니다."}';
const SESSION_FULL = '{"rt_cd":"9","msg_cd":"OPSQ1002","msg1":"SESSION FULL"}';
const DOM_OK = JSON.stringify({
  rt_cd: '0',
  output: { stck_prpr: '70000', stck_oprc: '69000', stck_hgpr: '71000', stck_lwpr: '68000',
            acml_vol: '1234', acml_tr_pbmn: '86380000' },
});
const OVS_OK = JSON.stringify({
  rt_cd: '0',
  // 소수 단가 — 정수(100×1332.1)면 환율을 상수로 고정한 변이를 못 잡는다.
  output: { last: '123.45', open: '120.5', high: '125.5', low: '119.5', tvol: '1000', tamt: '123450' },
});

const originalFetch = global.fetch;
let fetchMock: jest.Mock;

function res(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  /**
   * `jest.mock` 공장이 만든 `jest.fn`(`getKisToken`·`invalidateKisToken`)은 모듈당 하나라
   * **호출 횟수가 시험 사이에 누적된다** — `restoreAllMocks()` 는 spy 만 되돌리고 이것들은 안 지운다.
   * 토큰 시험 3건이 `invalidateKisToken` 호출 횟수를 단언하므로, 여기서 비우지 않으면 시험 순서에
   * 결과가 딸려 간다(변이 검증에서 실제로 드러났다). `clearAllMocks` 는 구현이 아니라 기록만 지운다.
   */
  jest.clearAllMocks();
  tokenValue = 'tok';
  __resetKisThrottleForTest(1000);
  fetchMock = jest.fn();
  (global as unknown as { fetch: unknown }).fetch = fetchMock;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  (global as unknown as { fetch: unknown }).fetch = originalFetch;
  jest.restoreAllMocks();
  __resetKisThrottleForTest();
});

describe('국내 시세 — 일시 오류 뒤 복구', () => {
  /**
   * n 번째 fetch 가 **어떤 토큰으로** 나갔는지. 토큰 분기의 요지는 "재시도가 새 토큰을 쓴다" 인데,
   * 호출 횟수만 세면 첫 헤더를 재사용하는 변이가 통과한다(T-133 Reviewer L-6, 변이 T4).
   */
  const authOf = (n: number): string | undefined =>
    (fetchMock.mock.calls[n]?.[1] as { headers?: Record<string, string> } | undefined)?.headers?.Authorization;

  test('EGW00300(HTTP 500) 한 번 → 재시도로 시세를 돌려준다', async () => {
    fetchMock
      .mockImplementationOnce(async () => res(500, GATEWAY))
      .mockImplementationOnce(async () => res(200, DOM_OK));
    await expect(domGetTicker('005930')).resolves.toMatchObject({ symbol: '005930', price: 70000 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('🔴 SESSION FULL(HTTP 200) 두 번 뒤 성공 — 예전에는 1회로 끝났다', async () => {
    fetchMock
      .mockImplementationOnce(async () => res(200, SESSION_FULL))
      .mockImplementationOnce(async () => res(200, SESSION_FULL))
      .mockImplementationOnce(async () => res(200, DOM_OK));
    await expect(domGetTicker('005930')).resolves.toMatchObject({ price: 70000 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test('🔴 계속 SESSION FULL 이면 소진 후 던진다 — 예산은 3회(1+2), 종전 국내 예산과 같다', async () => {
    fetchMock.mockImplementation(async () => res(200, SESSION_FULL));
    await expect(domGetTicker('005930')).rejects.toThrow(/200 업무실패 rt_cd=9/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  /**
   * 🔴 (T-133 Reviewer L-9) 토큰 분기가 **토큰 오류일 때만** 도는지. 조건을 넓히는 변이(모든 오류를
   * 토큰 오류로 보기)가 642건 전부 통과로 살아남았다 — 그러면 멀쩡한 토큰을 지우는 M-2 로 되돌아간다.
   */
  test('🔴 토큰 오류가 아닌 지속 500 은 재발급 없이 소진 후 던진다 (예산 3회)', async () => {
    const { invalidateKisToken } = jest.requireMock('../kis-auth') as { invalidateKisToken: jest.Mock };
    fetchMock.mockImplementation(async () => res(500, GATEWAY));
    await expect(domGetTicker('005930')).rejects.toThrow(/KIS getTicker 005930: 500/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(invalidateKisToken).not.toHaveBeenCalled();   // 토큰 오류가 아니면 DB 토큰을 건드리지 않는다
  });

  test('정상 응답은 재시도하지 않는다 (1회) — 토큰도 한 번만 읽는다', async () => {
    const { getKisToken } = jest.requireMock('../kis-auth') as { getKisToken: jest.Mock };
    fetchMock.mockImplementationOnce(async () => res(200, DOM_OK));
    await domGetTicker('005930');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    /**
     * (T-133 Reviewer 라운드 4 Info) 건강한 경로의 DB 읽기를 **1회로 고정**한다. 이것이 없으면
     * "방금 쓴 토큰" 을 `getKisToken()` 으로 한 번 더 읽는 라운드 3 설계로 되돌아가도 시험이 통과한다
     * (동작이 같고 읽기만 2배가 되므로 — 유니버스 150종목 스캔이면 SELECT +150회).
     */
    expect(getKisToken).toHaveBeenCalledTimes(1);
  });

  /**
   * 🔴 토큰 만료는 게이트웨이가 재시도하지 **않는다**(`isTransientKisFailure` 가 토큰 오류를 제외) —
   * 어댑터 몫이다. 그 어댑터 분기가 **재발급을 먼저 하면 안 된다**는 것이 이 두 시험의 요지다
   * (T-133 Reviewer M-2): 다른 프로세스가 이미 회전시켜 둔 토큰을 `invalidateKisToken()` 이 지우면
   * KIS 의 "앱키당 1분 1회"(`EGW00133`)에 걸려 `issueAndStore` 가 60초를 기다리고, 그 사이 같은
   * 프로세스의 모든 `getKisToken()`(주문 경로 포함)이 막힌다.
   */
  test('🔴 다른 프로세스가 회전시켜 뒀으면 재발급하지 않고 재읽기로 복구한다', async () => {
    const { invalidateKisToken } = jest.requireMock('../kis-auth') as { invalidateKisToken: jest.Mock };
    fetchMock
      .mockImplementationOnce(async () => {
        tokenValue = 'rotated-by-other-process';   // 이 요청이 나가는 동안 DB 가 회전했다
        return res(500, '{"rt_cd":"1","msg_cd":"EGW00123","msg1":"기간이 만료된 token"}');
      })
      .mockImplementationOnce(async () => res(200, DOM_OK));
    await expect(domGetTicker('005930')).resolves.toMatchObject({ price: 70000 });
    expect(invalidateKisToken).not.toHaveBeenCalled();   // ← M-2 회귀 가드
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authOf(0)).toBe('Bearer tok');
    expect(authOf(1)).toBe('Bearer rotated-by-other-process');   // ← 재시도가 새 토큰을 썼다
  });

  test('🔴 DB 토큰이 방금 쓴 것과 같을 때만 재발급한다', async () => {
    const { invalidateKisToken } = jest.requireMock('../kis-auth') as { invalidateKisToken: jest.Mock };
    fetchMock
      .mockImplementationOnce(async () => res(500, '{"rt_cd":"1","msg_cd":"EGW00123","msg1":"기간이 만료된 token"}'))
      .mockImplementationOnce(async () => res(200, DOM_OK));
    await expect(domGetTicker('005930')).resolves.toMatchObject({ price: 70000 });
    expect(invalidateKisToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);   // 일시 재시도 2회가 끼어들지 않았다
    expect(authOf(1)).toBe('Bearer reissued');    // ← 재발급된 토큰으로 재시도했다
  });

  /**
   * 🔴 (T-133 QA #2) 토큰 판정은 **게이트웨이와 같은 출처**(`isKisTokenError`)여야 한다.
   * `EGW00121` 을 손으로 빠뜨리면, 게이트웨이는 그것을 토큰 오류로 보고 재시도를 건너뛰는데
   * 어댑터는 재발급도 하지 않아 **아무도 복구하지 않는 사각지대**가 된다. 종전 코드는 500 이면
   * 무조건 재시도해서 그 경우를 우연히 덮고 있었으므로, 빠뜨리면 기능 후퇴다.
   */
  test('🔴 EGW00121 도 토큰 분기로 간다 (EGW00123 만 보면 후퇴)', async () => {
    const { invalidateKisToken } = jest.requireMock('../kis-auth') as { invalidateKisToken: jest.Mock };
    fetchMock
      .mockImplementationOnce(async () => {
        tokenValue = 'rotated-by-other-process';
        return res(500, '{"rt_cd":"1","msg_cd":"EGW00121","msg1":"유효하지 않은 token 입니다."}');
      })
      .mockImplementationOnce(async () => res(200, DOM_OK));
    await expect(domGetTicker('005930')).resolves.toMatchObject({ price: 70000 });
    expect(invalidateKisToken).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authOf(1)).toBe('Bearer rotated-by-other-process');
  });

  test('🔴 토큰 만료가 두 번이어도 재발급은 1회다 (T-136 감사 H-1 계열 가드)', async () => {
    const { invalidateKisToken } = jest.requireMock('../kis-auth') as { invalidateKisToken: jest.Mock };
    fetchMock.mockImplementation(async () =>
      res(500, '{"rt_cd":"1","msg_cd":"EGW00123","msg1":"기간이 만료된 token"}'));
    await expect(domGetTicker('005930')).rejects.toThrow(/KIS getTicker 005930: 500/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(invalidateKisToken).toHaveBeenCalledTimes(1);
  });

  /**
   * 🔴 레이트리밋 예산과 일시 실패 예산은 **별도 카운터**다(T-132). 시세 경로에서도 그런지 고정한다 —
   * 레이트리밋은 게이트웨이가 2회 재시도해 소진하고, 어댑터는 즉시 던진다(일시 2회를 더 쓰지 않는다).
   */
  test('🔴 레이트리밋은 게이트웨이 예산만 쓰고 즉시 던진다 (총 3회, 5회가 아니다)', async () => {
    fetchMock.mockImplementation(async () =>
      res(500, '{"rt_cd":"1","msg_cd":"EGW00201","msg1":"초당 거래건수를 초과하였습니다."}'));
    await expect(domGetTicker('005930')).rejects.toThrow(/레이트리밋 — 백오프 재시도 소진/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('해외 시세 — 일시 오류 뒤 복구', () => {
  test('🔴 SESSION FULL(HTTP 200) 한 번 → 재시도로 시세를 돌려준다', async () => {
    fetchMock
      .mockImplementationOnce(async () => res(200, SESSION_FULL))
      .mockImplementationOnce(async () => res(200, OVS_OK));
    const t = await ovsGetTicker('NAS:AAPL');
    expect(t.price).toBeCloseTo(123.45 * FX, 6);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('계속 EGW00300 이면 소진 후 상태 코드로 던진다 (예산 3회)', async () => {
    fetchMock.mockImplementation(async () => res(500, GATEWAY));
    await expect(ovsGetTicker('NAS:AAPL')).rejects.toThrow(/KIS overseas getTicker NAS:AAPL: 500/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test('🔴 던진 예외(네트워크)는 바깥 루프가 1회 재시도한다 — T-133 이 지우지 않았다', async () => {
    fetchMock
      .mockImplementationOnce(async () => { throw new Error('socket hang up'); })
      .mockImplementationOnce(async () => res(200, OVS_OK));
    await expect(ovsGetTicker('NAS:AAPL')).resolves.toMatchObject({ symbol: 'NAS:AAPL' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('🔴 예외가 두 번이면 던진다 — 무한 재시도가 아니다', async () => {
    fetchMock.mockImplementation(async () => { throw new Error('socket hang up'); });
    await expect(ovsGetTicker('NAS:AAPL')).rejects.toThrow(/KIS overseas getTicker NAS:AAPL: socket hang up/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('정상 응답은 재시도하지 않는다 (1회)', async () => {
    fetchMock.mockImplementationOnce(async () => res(200, OVS_OK));
    await ovsGetTicker('NAS:AAPL');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  /** (T-133 라운드 2 Reviewer 지적) 해외에도 레이트리밋 예산 분리를 고정한다 — 바깥 예외 루프는 안 돈다. */
  test('🔴 레이트리밋은 게이트웨이 예산만 쓰고 즉시 던진다 (총 3회 — 예외 루프가 돌지 않는다)', async () => {
    fetchMock.mockImplementation(async () =>
      res(500, '{"rt_cd":"1","msg_cd":"EGW00201","msg1":"초당 거래건수를 초과하였습니다."}'));
    await expect(ovsGetTicker('NAS:AAPL')).rejects.toThrow(/레이트리밋 — 백오프 재시도 소진/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
