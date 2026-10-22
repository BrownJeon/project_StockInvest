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

/**
 * T-027 — `quantity?: number` 는 **타입 선언일 뿐 런타임 가드가 아니다.**
 * 비-number 가 들어오면 `sizeOrderQuantity` 가 값을 만들지 못해 원본이 그대로 남고,
 * 어댑터의 `quantity <= 0` 이 `'3.7' <= 0 → false` 로 통과시켜 라이브 주문 호출까지 갔다.
 * 여기서 400 으로 끊어 **`submitOrder` 에도 도달하지 못하게** 한다(어댑터 방어와 이중화).
 */
describe('POST /api/orders — 비-number 수치 필드 런타임 가드 (T-027)', () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * ⚠️ `NaN`·`Infinity`·`-Infinity` 는 여기에 없다 — **JSON 으로 전송 자체가 불가능**하기 때문이다
   * (`JSON.stringify({q: NaN})` → `{"q":null}`). 즉 이 경계에서는 도달할 수 없는 값이고,
   * 그 사실을 아래 별도 테스트로 고정한다. 내부 연산이 만들어 내는 NaN 은 어댑터·한도 검사
   * 쪽 가드가 담당한다(방어 이중화의 나머지 절반).
   */
  const NON_NUMBERS: Array<[string, unknown]> = [
    ['숫자 모양 문자열', '3.7'],
    ['정수 모양 문자열', '5'],
    ['빈 문자열', ''],
    ['객체', { v: 1 }],
    ['배열', [1]],
    ['boolean', true],
  ];

  describe.each([['limit'], ['market']] as const)('%s 주문', (type) => {
    test.each(NON_NUMBERS)('quantity=%s → 400 + submitOrder 미호출', async (_label, value) => {
      const res = await POST(req({
        symbol: '005930', side: 'buy', type, price: 70000, quantity: value,
      }));

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({ ok: false, error: 'quantity must be a finite number' });
      expect(submitOrder).not.toHaveBeenCalled();
    });
  });

  test.each(NON_NUMBERS)('price=%s → 400 (한도 검사 NaN 우회 차단)', async (_label, value) => {
    const res = await POST(req({
      symbol: '005930', side: 'buy', type: 'limit', price: value, quantity: 5,
    }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'price must be a finite number' });
    expect(submitOrder).not.toHaveBeenCalled();
  });

  test.each(NON_NUMBERS)('amountKRW=%s → 400', async (_label, value) => {
    const res = await POST(req({
      symbol: '005930', side: 'buy', type: 'market', amountKRW: value,
    }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'amountKRW must be a finite number' });
    expect(submitOrder).not.toHaveBeenCalled();
  });

  test.each([['NaN', Number.NaN], ['Infinity', Number.POSITIVE_INFINITY], ['-Infinity', Number.NEGATIVE_INFINITY]])(
    '%s 은 JSON 직렬화에서 null 이 되므로 이 경계에는 애초에 도달하지 못한다 (사실 고정)',
    async (_label, value) => {
      // 실제 HTTP 요청과 동일하게 JSON.stringify 를 거친다 → null 로 바뀐다.
      expect(JSON.parse(JSON.stringify({ quantity: value })).quantity).toBeNull();

      const res = await POST(req({
        symbol: '005930', side: 'buy', type: 'limit', price: 70000, quantity: value,
      }));

      // null = 미지정으로 처리되어 400 이 아니다. 이 값들을 막는 책임은 어댑터 가드에 있다.
      expect(res.status).toBe(200);
    },
  );

  test('매도도 동일하게 400 — 매도는 상위 한도 검사를 건너뛰므로 특히 중요하다', async () => {
    const res = await POST(req({
      symbol: '005930', side: 'sell', type: 'limit', price: 70000, quantity: '3.7',
    }));

    expect(res.status).toBe(400);
    expect(submitOrder).not.toHaveBeenCalled();
  });

  // ── 과도차단 회귀 방지 ──────────────────────────────────────────────────────
  test.each([[1], [5], [3.7], [0.4], [1000]])(
    '정상 number 수량 %p 은 여전히 submitOrder 까지 간다',
    async (qty) => {
      const res = await POST(req({
        symbol: '005930', side: 'buy', type: 'limit', price: 70000, quantity: qty,
      }));

      expect(res.status).toBe(200);
      expect(submitOrder).toHaveBeenCalledTimes(1);
    },
  );

  test.each([['quantity'], ['price'], ['amountKRW']])(
    '%s 를 null 로 보내는 것은 "미지정"이지 오류가 아니다 — 하위 로직이 파생한다',
    async (field) => {
      const body: Record<string, unknown> = {
        symbol: '005930', side: 'buy', type: 'limit', price: 70000, quantity: 5, amountKRW: 350000,
      };
      body[field] = null;

      const res = await POST(req(body));

      expect(res.status).toBe(200);
      expect(submitOrder).toHaveBeenCalledTimes(1);
    },
  );

  test('필드를 아예 생략하는 기존 호출 형태도 그대로 통과한다', async () => {
    const res = await POST(req({ symbol: '005930', side: 'buy', type: 'market', amountKRW: 250000 }));

    expect(res.status).toBe(200);
    expect(submitOrder).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 T-072 F-1 — 직접 주문은 전략 귀속이 없다(매수는 G6 가 막는다)', () => {
  beforeEach(() => jest.clearAllMocks());

  test.each([undefined, 'manual', 'signal', 'auto'])('source=%s 여도 attribution 은 {strategy, null, null} — 클라이언트가 고르는 source 는 판정 근거가 아니다', async (source) => {
    await POST(req({ symbol: '005930', side: 'buy', type: 'limit', price: 70000, quantity: 1, ...(source ? { source } : {}) }));
    expect(submitOrder).toHaveBeenCalledTimes(1);
    expect((submitOrder as jest.Mock).mock.calls[0][2]).toMatchObject({
      attribution: { kind: 'strategy', strategyId: null, signalId: null },
    });
  });

  test('본문에 strategyId 같은 필드를 넣어도 귀속으로 쓰지 않는다', async () => {
    await POST(req({ symbol: '005930', side: 'buy', type: 'limit', price: 70000, quantity: 1, strategyId: 'validated-v1', attribution: { kind: 'strategy', strategyId: 'validated-v1' } }));
    expect((submitOrder as jest.Mock).mock.calls[0][2].attribution).toEqual({ kind: 'strategy', strategyId: null, signalId: null });
  });
});

describe('🔴 T-072 WP-2d — side 정규화: 변형은 정확한 값으로, buy/sell 이 아니면 400 + 한국어', () => {
  beforeEach(() => jest.clearAllMocks());

  test.each([['BUY', 'buy'], ['Buy', 'buy'], ['buy ', 'buy'], ['SELL', 'sell'], [' sell ', 'sell']])('side=%p → submitOrder 에 정확히 %p', async (raw, norm) => {
    await POST(req({ symbol: '005930', side: raw, type: 'limit', price: 70000, quantity: 1 }));
    expect(submitOrder).toHaveBeenCalledTimes(1);
    expect((submitOrder as jest.Mock).mock.calls[0][0].side).toBe(norm);
  });

  test.each([['purchase'], ['   '], [123], [['sell']]])('side=%p → 400 + 한국어, submitOrder 미호출', async (raw) => {
    const res = await POST(req({ symbol: '005930', side: raw, type: 'limit', price: 70000, quantity: 1 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: '주문 방향은 buy 또는 sell 이어야 합니다 (대소문자·앞뒤 공백은 허용)' });
    expect(submitOrder).not.toHaveBeenCalled();
  });
});
