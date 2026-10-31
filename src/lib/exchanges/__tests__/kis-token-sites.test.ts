/**
 * T-136 — 토큰 분기를 공용 헬퍼로 바꾼 **사이트들**이 실제로 복구하는지, 실제 `kisFetch` 로 본다.
 *
 * `kis-token-retry.test.ts` 는 헬퍼 자체와 정적 울타리를 보고, 이 파일은 **배선**을 본다 —
 * 어댑터가 (a) `EGW00121` 에서도 재시도하는지 (b) 회전된 토큰을 **지우지 않는지**
 * (c) 재시도 요청이 **새 토큰으로** 나가는지. `global.fetch` 만 바꾸고 나머지는 실제 코드다.
 *
 * 배경: 이 세 가지가 어긋나 있던 것이 T-133 QA #2 와 감사 M-2 다. M-2 쪽은 조용한 사고라 특히
 * 무섭다 — 조회 한 건을 구하려다 `EGW00133` 60초 대기에 들어가면 같은 프로세스의 `createOrder` 가
 * 그동안 토큰을 못 받는다.
 */
jest.mock('../kis-auth', () => ({
  getKisToken:        jest.fn(async () => tokenValue),
  invalidateKisToken: jest.fn(async () => { tokenValue = 'reissued'; }),
  kisBaseUrl:         jest.fn(() => 'https://mock-base'),
}));
jest.mock('@/lib/credentials', () => ({
  getCredential: jest.fn(async (key: string) => (key === 'KIS_ACCOUNT_NO' ? '12345678' : '01')),
}));
jest.mock('../fx', () => ({ getUsdKrwRate: jest.fn(async () => 1332.1) }));

import usdCashFixture from './fixtures/ctrp6504r-closed-20261020.json';
import { getBalances as domGetBalances } from '../kis-domestic';
import { getBalances as ovsGetBalances, getUsdCash } from '../kis-overseas';
import { __resetKisThrottleForTest } from '../kis-throttle';

let tokenValue = 'tok';

const EXPIRED_123 = '{"rt_cd":"1","msg_cd":"EGW00123","msg1":"기간이 만료된 token 입니다."}';
const INVALID_121 = '{"rt_cd":"1","msg_cd":"EGW00121","msg1":"유효하지 않은 token 입니다."}';
const DOM_OK = JSON.stringify({
  rt_cd: '0',
  output1: [{ pdno: '005930', hldg_qty: '30', pchs_avg_pric: '69300' }],
  output2: [{ dnca_tot_amt: '100000', prvs_rcdl_excc_amt: '80138' }],
});
const OVS_OK = JSON.stringify({
  rt_cd: '0',
  output1: [{ ovrs_pdno: 'AAPL', ovrs_cblc_qty: '2', ovrs_excg_cd: 'NASD', pchs_avg_pric: '123.45' }],
});
const USD_OK = JSON.stringify(usdCashFixture);

const originalFetch = global.fetch;
let fetchMock: jest.Mock;

function res(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'content-type': 'application/json' } });
}
/** n 번째 fetch 가 어떤 토큰으로 나갔는지 — "재시도가 새 토큰을 쓴다" 를 호출 횟수로는 못 본다. */
const authOf = (n: number): string | undefined =>
  (fetchMock.mock.calls[n]?.[1] as { headers?: Record<string, string> } | undefined)?.headers?.Authorization;

function authMocks() {
  return jest.requireMock('../kis-auth') as { getKisToken: jest.Mock; invalidateKisToken: jest.Mock };
}

beforeEach(() => {
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

describe('국내 잔고 (kis-domestic getBalances)', () => {
  test('🔴 EGW00121 도 토큰 분기로 간다 — 예전 사본은 EGW00123 만 봐서 아무도 복구하지 않았다', async () => {
    fetchMock
      .mockImplementationOnce(async () => res(500, INVALID_121))
      .mockImplementationOnce(async () => res(200, DOM_OK));
    await expect(domGetBalances()).resolves.toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authOf(1)).toBe('Bearer reissued');
  });

  test('🔴 회전된 토큰은 지우지 않는다 (M-2 회귀 가드) — 재시도는 그 토큰으로 나간다', async () => {
    const { invalidateKisToken } = authMocks();
    fetchMock
      .mockImplementationOnce(async () => { tokenValue = 'rotated'; return res(500, EXPIRED_123); })
      .mockImplementationOnce(async () => res(200, DOM_OK));
    await expect(domGetBalances()).resolves.toHaveLength(2);
    expect(invalidateKisToken).not.toHaveBeenCalled();
    expect(authOf(0)).toBe('Bearer tok');
    expect(authOf(1)).toBe('Bearer rotated');
  });

  test('🔴 토큰 오류가 두 번이어도 재발급은 1회다 (감사 H-1 이 숨었던 이유 — 횟수를 세지 않았다)', async () => {
    const { invalidateKisToken } = authMocks();
    fetchMock.mockImplementation(async () => res(500, EXPIRED_123));
    await expect(domGetBalances()).rejects.toThrow(/KIS getBalances: 500/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(invalidateKisToken).toHaveBeenCalledTimes(1);
  });
});

describe('해외 보유 (kis-overseas fetchBalancesForExchange)', () => {
  test('🔴 EGW00121 에서 복구하고 재시도는 새 토큰으로 나간다', async () => {
    fetchMock
      .mockImplementationOnce(async () => res(500, INVALID_121))
      .mockImplementationOnce(async () => res(200, OVS_OK));
    const r = await ovsGetBalances();
    expect(r).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authOf(1)).toBe('Bearer reissued');
  });

  test('🔴 회전된 토큰은 지우지 않는다 (M-2 회귀 가드)', async () => {
    const { invalidateKisToken } = authMocks();
    fetchMock
      .mockImplementationOnce(async () => { tokenValue = 'rotated'; return res(500, EXPIRED_123); })
      .mockImplementationOnce(async () => res(200, OVS_OK));
    await expect(ovsGetBalances()).resolves.toHaveLength(1);
    expect(invalidateKisToken).not.toHaveBeenCalled();
    expect(authOf(1)).toBe('Bearer rotated');
  });
});

describe('해외 USD 예수금 (kis-overseas getUsdCash)', () => {
  test('🔴 EGW00121 에서 복구한다 — 한도 0 으로 떨어지지 않는다', async () => {
    fetchMock
      .mockImplementationOnce(async () => res(500, INVALID_121))
      .mockImplementationOnce(async () => res(200, USD_OK));
    await expect(getUsdCash()).resolves.toMatchObject({ source: 'CTRP6504R' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authOf(1)).toBe('Bearer reissued');
  });

  test('🔴 회전된 토큰은 지우지 않는다 (M-2 회귀 가드)', async () => {
    const { invalidateKisToken } = authMocks();
    fetchMock
      .mockImplementationOnce(async () => { tokenValue = 'rotated'; return res(500, EXPIRED_123); })
      .mockImplementationOnce(async () => res(200, USD_OK));
    await expect(getUsdCash()).resolves.toMatchObject({ source: 'CTRP6504R' });
    expect(invalidateKisToken).not.toHaveBeenCalled();
    expect(authOf(1)).toBe('Bearer rotated');
  });
});

describe('토큰 오류가 아닌 실패는 토큰 분기를 타지 않는다', () => {
  test('🔴 지속 게이트웨이 500 — 재발급 0회, 일시 재시도 예산 3회만 쓴다', async () => {
    const { invalidateKisToken } = authMocks();
    fetchMock.mockImplementation(async () =>
      res(500, '{"rt_cd":"1","msg_cd":"EGW00300","msg1":"Gateway 라우팅 오류가 발생했습니다."}'));
    await expect(domGetBalances()).rejects.toThrow(/KIS getBalances: 500/);
    expect(invalidateKisToken).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
