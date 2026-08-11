/**
 * T-018 — 어댑터 레벨: **주문 조회 실패가 빈 배열이 되지 않는다.**
 *
 * 이 파일이 못 박는 세 개의 삼킴 지점(국내·해외 각각):
 *
 * | 지점 | 예전 동작 | 지금 |
 * |---|---|---|
 * | `!res.ok` | `return []` — KIS 레이트리밋은 **HTTP 500** 이라 전부 여기 떨어졌다 | throw |
 * | `rt_cd !== '0'` (HTTP 200) | `return []` — **API 레벨 에러**를 "0건"과 동일 취급 | throw |
 * | `catch` | `return []` (해외는 **로그조차 없었다**) | 전파 |
 *
 * 반대로 `rt_cd='0'` + 목록 없음은 API 가 스스로 "성공"이라 말한 것이므로 **0건으로 읽는다**.
 * 이 경계를 흐리면 반대 방향의 조용한 정지(영원한 미판정)가 생긴다.
 */
const kisFetchMock = jest.fn();

jest.mock('@/lib/exchanges/kis-http', () => {
  const actual = jest.requireActual('@/lib/exchanges/kis-http');
  return { ...actual, kisFetch: (...a: unknown[]) => kisFetchMock(...a) };
});
jest.mock('@/lib/exchanges/kis-auth', () => ({
  getKisToken:        jest.fn(async () => 'test-token'),
  invalidateKisToken: jest.fn(async () => 'test-token'),
  kisBaseUrl:         () => 'https://kis.example',
}));
jest.mock('@/lib/credentials', () => ({
  getCredential: jest.fn(async (k: string) =>
    k === 'KIS_ACCOUNT_NO' ? '12345678' : k === 'KIS_ACCOUNT_PRODUCT' ? '01' : 'x'),
}));
jest.mock('@/lib/exchanges/fx', () => ({
  getUsdKrwRate: jest.fn(async () => 1400),
  usdToKrw:      jest.fn(async (usd: number) => usd * 1400),
}));

import * as dom from '@/lib/exchanges/kis-domestic';
import * as ovs from '@/lib/exchanges/kis-overseas';
import { KisThrottleQueueFullError, KisThrottleTimeoutError } from '@/lib/exchanges/kis-throttle';

/** 실측 레이트리밋 응답 — HTTP 500 + EGW00201 */
const rateLimited = () => new Response(
  JSON.stringify({ rt_cd: '1', msg_cd: 'EGW00201', msg1: '초당 거래건수를 초과하였습니다.' }),
  { status: 500 },
);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); });

const CASES = [
  {
    market: '국내',
    active:    () => dom.getActiveOrders(),
    completed: () => dom.getCompletedOrders('005930', Date.now() - 60_000, Date.now(), 100),
    /** 이 어댑터에서 체결 목록이 실리는 필드 */
    completedField: 'output1' as const,
  },
  {
    market: '해외',
    active:    () => ovs.getActiveOrders(),
    completed: () => ovs.getCompletedOrders('NAS:AAPL', Date.now() - 60_000, Date.now(), 100),
    completedField: 'output' as const,
  },
];

describe.each(CASES)('$market getActiveOrders — 실패를 삼키지 않는다', (c) => {
  test('🔴 HTTP 500 레이트리밋 → 빈 배열이 아니라 예외', async () => {
    kisFetchMock.mockResolvedValue(rateLimited());
    await expect(c.active()).rejects.toThrow(/EGW00201|500/);
  });

  test('🔴 HTTP 200 + rt_cd!=0 → API 레벨 에러이므로 예외', async () => {
    kisFetchMock.mockResolvedValue(json({ rt_cd: '1', msg_cd: 'APBK0919', msg1: '조회할 자료가 없습니다' }));
    await expect(c.active()).rejects.toThrow(/rt_cd=1/);
  });

  test('🔴 네트워크 예외 → 전파된다 (예전엔 catch 가 [] 로 바꿨다)', async () => {
    kisFetchMock.mockRejectedValue(new Error('fetch failed'));
    await expect(c.active()).rejects.toThrow('fetch failed');
  });

  test.each([
    ['KisThrottleQueueFullError', new KisThrottleQueueFullError('normal', 192)],
    ['KisThrottleTimeoutError',   new KisThrottleTimeoutError('normal', 30_000, 30_000, 'q')],
  ])('🔴 T-017 %s 도 전파된다 — "미체결 0건"으로 읽히면 안 된다', async (_n, err) => {
    kisFetchMock.mockRejectedValue(err);
    await expect(c.active()).rejects.toBe(err);
  });

  test('output 이 배열이 아니면(해석 불가) 예외', async () => {
    kisFetchMock.mockResolvedValue(json({ rt_cd: '0', output: 'oops' }));
    await expect(c.active()).rejects.toThrow(/형식 이상/);
  });

  test('rt_cd=0 + output 없음 → 진짜 0건으로 읽는다 (반대 방향 정지 방지)', async () => {
    kisFetchMock.mockResolvedValue(json({ rt_cd: '0' }));
    await expect(c.active()).resolves.toEqual([]);
  });

  test('정상 응답은 그대로 파싱된다', async () => {
    kisFetchMock.mockResolvedValue(json({
      rt_cd: '0',
      output: [
        { odno: 'A1', pdno: '005930', rmn_qty: '3', nccs_qty: '3', ovrs_excg_cd: 'NASD' },
        { odno: 'A2', pdno: '000660', rmn_qty: '0', nccs_qty: '0', ovrs_excg_cd: 'NASD' }, // 잔량 0 → 제외
      ],
    }));
    const r = await c.active();
    expect(r).toHaveLength(1);
    expect(r[0].orderId).toBe('A1');
  });
});

describe.each(CASES)('$market getCompletedOrders — 실패를 삼키지 않는다', (c) => {
  test('🔴 HTTP 500 레이트리밋 → 예외', async () => {
    kisFetchMock.mockResolvedValue(rateLimited());
    await expect(c.completed()).rejects.toThrow(/EGW00201|500/);
  });

  test('🔴 HTTP 200 + rt_cd!=0 → 예외', async () => {
    kisFetchMock.mockResolvedValue(json({ rt_cd: '1', msg_cd: 'EGW00215', msg1: '초당 거래건수를 초과하였습니다.' }));
    await expect(c.completed()).rejects.toThrow(/rt_cd=1/);
  });

  test('🔴 네트워크 예외 → 전파된다', async () => {
    kisFetchMock.mockRejectedValue(new Error('fetch failed'));
    await expect(c.completed()).rejects.toThrow('fetch failed');
  });

  test('토큰 만료(EGW00123)는 1회 재발급 후 재시도한다 (기존 동작 유지)', async () => {
    kisFetchMock
      .mockResolvedValueOnce(new Response('{"msg_cd":"EGW00123","msg1":"만료된 token 입니다"}', { status: 500 }))
      .mockResolvedValueOnce(json({ rt_cd: '0', [c.completedField]: [] }));
    await expect(c.completed()).resolves.toEqual([]);
    expect(kisFetchMock).toHaveBeenCalledTimes(2);
  });

  test('토큰 재발급 후에도 실패하면 예외 (무한 루프 없음)', async () => {
    kisFetchMock.mockResolvedValue(new Response('{"msg_cd":"EGW00123","msg1":"만료된 token 입니다"}', { status: 500 }));
    await expect(c.completed()).rejects.toThrow(/500/);
    expect(kisFetchMock).toHaveBeenCalledTimes(2);
  });

  test('rt_cd=0 + 목록 없음 → 체결 0건', async () => {
    kisFetchMock.mockResolvedValue(json({ rt_cd: '0' }));
    await expect(c.completed()).resolves.toEqual([]);
  });

  test('정상 응답은 그대로 파싱된다', async () => {
    kisFetchMock.mockResolvedValue(json({
      rt_cd: '0',
      [c.completedField]: [{
        odno: 'F1', sll_buy_dvsn_cd: '02',
        tot_ccld_qty: '2', ft_ccld_qty: '2',
        avg_prvs: '70000', ft_ccld_unpr3: '210.5',
        ord_dt: '20260811', dmst_ord_dt: '20260811', ord_tmd: '093012',
      }],
    }));
    const r = await c.completed();
    expect(r).toHaveLength(1);
    expect(r[0].orderId).toBe('F1');
    expect(r[0].side).toBe('buy');
  });
});
