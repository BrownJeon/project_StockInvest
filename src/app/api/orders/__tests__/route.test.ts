import { POST } from '../route';
import { submitOrder } from '@/lib/safety/dry-run';

jest.mock('@/lib/safety/dry-run', () => ({
  submitOrder: jest.fn(async () => ({ ok: true, orderId: 1 })),
}));

jest.mock('@/lib/exchanges/kis', () => ({ kis: { createOrder: jest.fn() } }));

function req(body: unknown) {
  return new Request('http://x/api/orders', { method: 'POST', body: JSON.stringify(body) });
}

describe('POST /api/orders — 수량 방어', () => {
  beforeEach(() => jest.clearAllMocks());

  test('소수점 수량은 정수로 버림 처리된 뒤 submitOrder 에 전달된다', async () => {
    await POST(req({
      symbol: '005930', side: 'buy', type: 'limit', price: 70000, quantity: 3.7,
    }));

    expect(submitOrder).toHaveBeenCalledTimes(1);
    const orderReq = (submitOrder as jest.Mock).mock.calls[0][0];
    expect(orderReq.quantity).toBe(3);
  });

  test('정수 수량은 그대로 통과한다 — 회귀 없음', async () => {
    await POST(req({
      symbol: '005930', side: 'buy', type: 'limit', price: 70000, quantity: 5,
    }));

    const orderReq = (submitOrder as jest.Mock).mock.calls[0][0];
    expect(orderReq.quantity).toBe(5);
  });

  test('1주 미만 소수점(0.x)은 0주가 되어 submitOrder까지는 통과하지만 그 이하로 축소되지 않는다', async () => {
    await POST(req({
      symbol: '005930', side: 'buy', type: 'limit', price: 70000, quantity: 0.4,
    }));

    const orderReq = (submitOrder as jest.Mock).mock.calls[0][0];
    expect(orderReq.quantity).toBe(0);
  });

  test('quantity 미지정 + amountKRW만 있는 지정가 주문도 정수 수량으로 사전 산출된다', async () => {
    await POST(req({
      symbol: '005930', side: 'buy', type: 'limit', price: 70000, amountKRW: 250000,
    }));

    const orderReq = (submitOrder as jest.Mock).mock.calls[0][0];
    expect(Number.isInteger(orderReq.quantity)).toBe(true);
    expect(orderReq.quantity).toBe(3); // floor(250000/70000)=3
  });

  test('시장가 + quantity 미지정은 어댑터에 위임하도록 quantity를 undefined로 둔다 — 회귀 없음', async () => {
    await POST(req({
      symbol: '005930', side: 'buy', type: 'market', amountKRW: 250000,
    }));

    const orderReq = (submitOrder as jest.Mock).mock.calls[0][0];
    expect(orderReq.quantity).toBeUndefined();
  });

  test('symbol/side/type 누락은 여전히 400 — 회귀 없음', async () => {
    const res = await POST(req({ side: 'buy' }));
    expect(res.status).toBe(400);
    expect(submitOrder).not.toHaveBeenCalled();
  });
});
