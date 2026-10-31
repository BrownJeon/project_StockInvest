/**
 * T-017 — **주문은 대량 스캔 뒤에 서지 않는다.**
 *
 * 유량 스로틀을 매매 시스템에 넣을 때 가장 위험한 실패는 이것이다:
 * *실제 매도 주문이 150건짜리 universe 스캔 뒤에 줄을 서서 몇십 초 늦게 나가는 것.*
 * 손절이 늦으면 그대로 돈이 샌다.
 *
 * 방어는 두 겹이다. 이 파일은 그 두 겹을 각각 고정한다.
 *  1. `submitOrder` 가 **주문 준비 전 구간**(한도 산정용 잔고 조회 포함)을 `critical` 로 실행
 *  (T-132) 주문·취소는 `transientRetries` 를 **켜지 않는다** — 재시도의 전제는 멱등성이고 주문은 멱등하지
 *  않다. 줄 스캔이 아니라 실제 호출 옵션으로 못 박는다(`kisFetch` 안에 GET 전용 런타임 가드도 있다).
 *
 *  2. `createOrder`/`cancelOrder` 가 호출 지점에서 `priority:'critical'` 을 **명시** —
 *     주변 컨텍스트가 `bulk` 여도(strategy-eval 틱 안의 청산 주문) 강등되지 않는다
 */
const kisFetchMock = jest.fn();

jest.mock('@/lib/exchanges/kis-http', () => {
  const actual = jest.requireActual('@/lib/exchanges/kis-http');
  return {
    ...actual,
    kisFetch: (...a: unknown[]) => kisFetchMock(...a),
  };
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
import {
  withKisPriority,
  acquireKisSlot,
  __resetKisThrottleForTest,
} from '@/lib/exchanges/kis-throttle';
import { KisThrottleTimeoutError, KisThrottleQueueFullError } from '@/lib/exchanges/kis-throttle';
import type { KisFetchOptions } from '@/lib/exchanges/kis-http';

const okOrder = () =>
  new Response(JSON.stringify({ rt_cd: '0', output: { ODNO: '0000123' } }), { status: 200 });

beforeEach(() => {
  jest.clearAllMocks();
  __resetKisThrottleForTest(1000);
  kisFetchMock.mockImplementation(async () => okOrder());
});
afterEach(() => { __resetKisThrottleForTest(); });

/** kisFetch 호출에 실린 옵션 */
const optsOf = (call: number): KisFetchOptions => kisFetchMock.mock.calls[call][2] as KisFetchOptions;

describe('주문 송신·취소는 항상 critical lane 을 명시한다', () => {
  it('국내 매수 주문', async () => {
    const r = await dom.createOrder({
      exchange: 'kis', symbol: '005930', side: 'buy', type: 'limit', price: 70_000, quantity: 1,
    });
    expect(r.ok).toBe(true);
    expect(optsOf(0).priority).toBe('critical');
    expect(optsOf(0).transientRetries ?? 0).toBe(0);
  });

  it('국내 주문 취소', async () => {
    await dom.cancelOrder({ symbol: '005930', exchangeOrderId: '0000123' });
    expect(optsOf(0).priority).toBe('critical');
    expect(optsOf(0).transientRetries ?? 0).toBe(0);
  });

  it('해외 매도 주문', async () => {
    const r = await ovs.createOrder({
      exchange: 'kis', symbol: 'NAS:AAPL', side: 'sell', type: 'market',
      price: 280_000, quantity: 2,
    });
    expect(r.ok).toBe(true);
    expect(optsOf(0).priority).toBe('critical');
    expect(optsOf(0).transientRetries ?? 0).toBe(0);
  });

  it('해외 주문 취소', async () => {
    await ovs.cancelOrder({ symbol: 'NAS:AAPL', exchangeOrderId: '0000123' });
    expect(optsOf(0).priority).toBe('critical');
    expect(optsOf(0).transientRetries ?? 0).toBe(0);
  });

  it('🔑 bulk 컨텍스트(strategy-eval 틱) 안에서도 강등되지 않는다', async () => {
    // runAll 은 withKisPriority('bulk') 안에서 돈다. 그 안에서 청산 주문이 나가는 상황.
    await withKisPriority('bulk', () => dom.createOrder({
      exchange: 'kis', symbol: '005930', side: 'sell', type: 'market', quantity: 5,
    }));
    expect(optsOf(0).priority).toBe('critical');
  });
});

describe('시세·잔고 조회는 lane 을 명시하지 않는다 (컨텍스트를 따른다)', () => {
  it('getTicker 는 priority 를 지정하지 않는다', async () => {
    kisFetchMock.mockImplementation(async () =>
      new Response(JSON.stringify({ output: { stck_prpr: '71000' } }), { status: 200 }));
    await dom.getTicker('005930');
    expect(optsOf(0).priority).toBeUndefined();
  });

  it('universe 스캔 컨텍스트에서는 bulk 로 흘러간다', async () => {
    kisFetchMock.mockImplementation(async () =>
      new Response(JSON.stringify({ output: { stck_prpr: '71000' } }), { status: 200 }));
    // 명시 priority 가 없으므로 acquireKisSlot 이 컨텍스트(bulk)를 읽는다.
    await withKisPriority('bulk', () => dom.getTicker('005930'));
    expect(optsOf(0).priority).toBeUndefined();   // 어댑터는 lane 을 강제하지 않는다
  });
});

describe('실제 대기열에서 주문이 스캔을 추월한다 (end-to-end)', () => {
  it('20건 스캔이 밀려 있어도 주문이 먼저 나간다', async () => {
    __resetKisThrottleForTest(10);
    const order: string[] = [];

    // 버스트를 소진시킨다.
    await Promise.all(Array.from({ length: 10 }, () => acquireKisSlot('normal')));

    // universe 스캔이 bulk 로 줄을 선다.
    const scan = Array.from({ length: 20 }, (_, i) =>
      acquireKisSlot('bulk').then(() => order.push(`scan${i}`)));

    // 그 뒤에 실주문이 들어온다 — 어댑터를 그대로 통과시킨다.
    kisFetchMock.mockImplementation(async (_u: string, _i: RequestInit, o: KisFetchOptions) => {
      await acquireKisSlot(o.priority ?? 'normal');
      order.push('ORDER');
      return okOrder();
    });
    await dom.createOrder({
      exchange: 'kis', symbol: '005930', side: 'sell', type: 'market', quantity: 5,
    });

    expect(order[0]).toBe('ORDER');
    await Promise.all(scan);
  });
});

/**
 * reviewer HIGH-2 후속 — 스로틀이 만든 실패가 **"보유 없음"으로 퇴화하지 않는지**.
 *
 * T-014 의 핵심 계약은 "모르는 것을 0으로 읽지 않는다"였다. 스로틀은 새로운 실패 원인을
 * 두 개(대기열 초과·대기 시간 초과) 추가했으므로, 그 둘도 반드시 **던져서**
 * `getBalancesDetailed` → `failed[]` → `BalancesIncompleteError` → `{known:false}` 경로를
 * 타야 한다. 여기서 빈 배열로 삼켜지면 T-014 가 되살아난다.
 */
describe('스로틀 실패는 잔고를 빈 배열로 만들지 않는다 (T-014 계약)', () => {
  const throttleErrors = [
    ['대기 시간 초과', () => new KisThrottleTimeoutError('normal', 30_000, 30_000, 'bulk=640')],
    ['대기열 초과',   () => new KisThrottleQueueFullError('normal', 192)],
  ] as const;

  it.each(throttleErrors)('국내 잔고 — %s 는 throw 된다', async (_label, mk) => {
    kisFetchMock.mockImplementation(async () => { throw mk(); });
    // 빈 배열([])을 돌려주면 호출부가 "보유 종목 없음"으로 읽는다 — 반드시 던져야 한다.
    await expect(dom.getBalances()).rejects.toThrow();
  });

  it.each(throttleErrors)('해외 잔고 — %s 는 throw 된다', async (_label, mk) => {
    kisFetchMock.mockImplementation(async () => { throw mk(); });
    await expect(ovs.getBalances()).rejects.toThrow();
  });

  it('던져진 오류는 스로틀 실패로 식별 가능하다 (진단이 원인을 잃지 않는다)', async () => {
    kisFetchMock.mockImplementation(async () => {
      throw new KisThrottleTimeoutError('normal', 30_000, 30_000, 'bulk=640');
    });
    const err = await dom.getBalances().catch(e => e);
    expect(err.name).toBe('KisThrottleTimeoutError');
    expect(String(err.message)).toContain('대기 시간 초과');
  });
});
