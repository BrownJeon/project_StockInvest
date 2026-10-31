/**
 * T-132 — 어댑터와 **실제** `kisFetch` 를 함께 돌려, 게이트웨이 일시 오류 뒤 같은 호출이 복구되는지 본다.
 *
 * 다른 어댑터 시험은 `kis-http` 모듈 전체를 모킹하므로 "옵션을 넘겼다"까지만 확인된다. 이 파일은
 * `kisFetch` 를 모킹하지 않고 `global.fetch` 만 바꿔 **연결 자체**를 검증한다 — 이 task 가 고치려는
 * 바로 그 사건(2026-10-31 KIS 장애: 실패 직후 같은 TR 이 1초 뒤 성공)이 재현되는지.
 */
jest.mock('../kis-auth', () => ({
  getKisToken:        jest.fn(async () => 'tok'),
  invalidateKisToken: jest.fn(async () => {}),
  kisBaseUrl:         jest.fn(() => 'https://mock-base'),
}));
jest.mock('@/lib/credentials', () => ({
  getCredential: jest.fn(async (key: string) => (key === 'KIS_ACCOUNT_NO' ? '12345678' : '01')),
}));
jest.mock('../fx', () => ({ getUsdKrwRate: jest.fn(async () => FX) }));

import usdCashFixture from './fixtures/ctrp6504r-closed-20261020.json';
import { getBalances as domGetBalances } from '../kis-domestic';
import { getBalances as ovsGetBalances, getUsdCash, UsdCashUnavailableError } from '../kis-overseas';
import { __resetKisThrottleForTest } from '../kis-throttle';

/**
 * 이 파일에서 환율이 쓰이는 곳은 **해외 보유 단가 환산 한 곳**이다(`getUsdCash` 는 환율을 부르지
 * 않는다 — 처음 적었던 "픽스처 정합 검사에 필요" 는 사실이 아니었다, Reviewer I-4).
 * 값을 1400 에서 바꾼 이유는 따로 있다: 단가 100 × 1400 = 140,000 은 **환율을 상수로 고정한 변이도
 * 같은 값**이 되어 시험이 그것을 못 잡았다. 기존 T-056 시험과 같은 실측값을 쓴다.
 */
const FX = 1332.1;

const GATEWAY   = '{"rt_cd":"1","msg_cd":"EGW00300","msg1":"Gateway 라우팅 오류가 발생했습니다."}';
const SESSION_FULL = '{"rt_cd":"9","msg_cd":"OPSQ1002","msg1":"SESSION FULL"}';
const DOM_OK = JSON.stringify({
  rt_cd: '0',
  output1: [{ pdno: '005930', hldg_qty: '30', pchs_avg_pric: '69300' }],
  output2: [{ dnca_tot_amt: '100000', prvs_rcdl_excc_amt: '80138' }],
});
const OVS_OK = JSON.stringify({
  rt_cd: '0',
  // 단가는 **소수 곱이 나오는 값**으로 둔다 — 정수(100×1332.1=133,210)면 반올림 변이를 못 잡는다(I-5).
  output1: [{ ovrs_pdno: 'AAPL', ovrs_cblc_qty: '2', ovrs_excg_cd: 'NASD', pchs_avg_pric: '123.45' }],
});
const USD_OK = JSON.stringify(usdCashFixture);

const originalFetch = global.fetch;
let fetchMock: jest.Mock;

function res(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
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

describe('국내 잔고 — 일시 오류 뒤 복구', () => {
  test('EGW00300(HTTP 500) 한 번 → 재시도로 정상 잔고를 돌려준다', async () => {
    fetchMock
      .mockResolvedValueOnce(res(500, GATEWAY))
      .mockResolvedValueOnce(res(200, DOM_OK));
    await expect(domGetBalances()).resolves.toEqual([
      { currency: 'KRW', free: 80_138, locked: 19_862 },
      { currency: '005930', free: 30, locked: 0, avgPrice: 69_300 },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('SESSION FULL(HTTP 200) 두 번 뒤 성공 — 예산 2회를 다 쓰고 복구', async () => {
    fetchMock
      .mockResolvedValueOnce(res(200, SESSION_FULL))
      .mockResolvedValueOnce(res(200, SESSION_FULL))
      .mockResolvedValueOnce(res(200, DOM_OK));
    await expect(domGetBalances()).resolves.toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test('🔴 계속 실패하면 던진다 — 재시도가 실패를 숨기지 않는다', async () => {
    fetchMock.mockImplementation(async () => res(500, GATEWAY));
    await expect(domGetBalances()).rejects.toThrow(/EGW00300/);
    expect(fetchMock).toHaveBeenCalledTimes(3);   // 최초 1 + 재시도 2
  });

  test('🔴 토큰 만료(EGW00123)는 재시도가 아니라 재발급 경로로 간다', async () => {
    const { invalidateKisToken } = jest.requireMock('../kis-auth') as { invalidateKisToken: jest.Mock };
    fetchMock
      .mockResolvedValueOnce(res(500, '{"rt_cd":"1","msg_cd":"EGW00123","msg1":"기간이 만료된 token"}'))
      .mockResolvedValueOnce(res(200, DOM_OK));
    await expect(domGetBalances()).resolves.toHaveLength(2);
    expect(invalidateKisToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);   // 재시도 2회가 끼어들지 않았다
  });
});

describe('해외 보유 — 일시 오류 뒤 복구', () => {
  test('EGW00300 한 번 → 재시도로 보유 목록을 돌려준다', async () => {
    fetchMock
      .mockResolvedValueOnce(res(500, GATEWAY))
      .mockResolvedValueOnce(res(200, OVS_OK));
    const r = await ovsGetBalances();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ currency: 'NAS:AAPL', free: 2, locked: 0 });
    expect(r[0].avgPrice).toBeCloseTo(123.45 * FX, 6);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('🔴 계속 SESSION FULL 이면 던진다 — 빈 보유 목록으로 퇴화하지 않는다', async () => {
    fetchMock.mockImplementation(async () => res(200, SESSION_FULL));
    await expect(ovsGetBalances()).rejects.toThrow(/200 업무실패 rt_cd=9/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

/**
 * (Reviewer L-5b) USD 예수금은 **한도 0 을 막는 실효가 가장 큰** 경로다 — 이 틱에 USD 예수금을 모르면
 * `order-limits` 가 해외 1회·일일 한도를 0 으로 낸다(실측: 10-31 09:42~10:30). 그래서 배선을 줄 스캔이
 * 아니라 종단으로 고정한다. 값 파싱 계약은 `kis-overseas-usd-cash.test.ts` 가 따로 지킨다.
 */
describe('해외 USD 예수금 — 일시 오류 뒤 복구', () => {
  test('EGW00300(HTTP 500) 한 번 → 재시도로 예수금을 돌려준다', async () => {
    fetchMock
      .mockResolvedValueOnce(res(500, GATEWAY))
      .mockResolvedValueOnce(res(200, USD_OK));
    const r = await getUsdCash();
    expect(r.source).toBe('CTRP6504R');
    expect(r.usd).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('SESSION FULL(HTTP 200) 두 번 뒤 성공', async () => {
    fetchMock
      .mockResolvedValueOnce(res(200, SESSION_FULL))
      .mockResolvedValueOnce(res(200, SESSION_FULL))
      .mockResolvedValueOnce(res(200, USD_OK));
    await expect(getUsdCash()).resolves.toMatchObject({ source: 'CTRP6504R' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test('🔴 계속 실패하면 UsdCashUnavailableError — 0 으로 읽지 않는다', async () => {
    fetchMock.mockImplementation(async () => res(200, SESSION_FULL));
    await expect(getUsdCash()).rejects.toThrow(UsdCashUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
