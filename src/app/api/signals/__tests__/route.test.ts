/**
 * T-028 — `POST /api/signals` 수치 필드 런타임 가드.
 *
 * [[T-027-nonnumber-quantity-guard]] 가 `POST /api/orders` 에서 닫은 것과 같은 클래스의 구멍이
 * 여기에 남아 있었다. 시그널은 `createSignal` → (auto_submit 이면) `submitOrder` 까지 이어지는
 * **주문 발원 경로**이므로 같은 규칙을 적용한다.
 *
 * 🔴 이 파일의 최대 목적은 **과도차단 회귀 방지**다 — 실계좌 실거래 중이라 정상 시그널 생성을
 *    막는 것 자체가 사고다. 아래 "과도차단 회귀 방지" 블록이 그 방어선이다.
 */
import { POST } from '../route';
import { createSignal } from '@/lib/signals/service';
import { isEngineEnabled } from '@/lib/signals/router';
import { isDomesticOpen, isOverseasOpen } from '@/lib/strategy/market-hours';

jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));
jest.mock('@/lib/signals/service', () => ({
  createSignal: jest.fn(async () => ({ ok: true, signalId: 1, autoSubmitted: false })),
}));
jest.mock('@/lib/signals/router', () => ({ isEngineEnabled: jest.fn(async () => true) }));
jest.mock('@/lib/strategy/market-hours', () => ({
  isDomesticOpen: jest.fn(async () => true),
  isOverseasOpen: jest.fn(async () => true),
}));

const mockedCreateSignal = createSignal as jest.MockedFunction<typeof createSignal>;

function req(body: unknown) {
  return new Request('http://x/api/signals', { method: 'POST', body: JSON.stringify(body) });
}

/** 이 라우트가 요구하는 최소 유효 본문. */
function validBody(over: Record<string, unknown> = {}) {
  return {
    symbol: '005930', side: 'buy', orderType: 'limit',
    price: 70000, quantity: 5, amountKRW: 350000,
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (isEngineEnabled as jest.Mock).mockResolvedValue(true);
  (isDomesticOpen as jest.Mock).mockResolvedValue(true);
  (isOverseasOpen as jest.Mock).mockResolvedValue(true);
  mockedCreateSignal.mockResolvedValue({ ok: true, signalId: 1, autoSubmitted: false } as never);
});

// ── 과도차단 회귀 방지 (최우선) ───────────────────────────────────────────────
describe('POST /api/signals — 정상 시그널 생성은 그대로 통과한다 (과도차단 회귀 방지)', () => {
  test('지정가 시그널이 createSignal 까지 도달한다', async () => {
    const res = await POST(req(validBody()));

    expect(res.status).toBe(200);
    expect(mockedCreateSignal).toHaveBeenCalledTimes(1);
    expect(mockedCreateSignal.mock.calls[0][0]).toMatchObject({
      symbol: '005930', side: 'buy', orderType: 'limit',
      price: 70000, quantity: 5, amountKRW: 350000,
    });
  });

  test('시장가 시그널(price 생략)도 그대로 통과한다', async () => {
    const res = await POST(req({
      symbol: '005930', side: 'buy', orderType: 'market', amountKRW: 350000,
    }));

    expect(res.status).toBe(200);
    expect(mockedCreateSignal).toHaveBeenCalledTimes(1);
  });

  test('해외 심볼 시그널도 그대로 통과한다', async () => {
    const res = await POST(req(validBody({ symbol: 'NAS:AAPL' })));

    expect(res.status).toBe(200);
    expect(mockedCreateSignal).toHaveBeenCalledTimes(1);
  });

  test('매도 시그널도 그대로 통과한다', async () => {
    const res = await POST(req(validBody({ side: 'sell' })));

    expect(res.status).toBe(200);
    expect(mockedCreateSignal).toHaveBeenCalledTimes(1);
  });

  test.each([[1], [5], [3.7], [1000]])('정상 number quantity %p 은 createSignal 까지 간다', async (qty) => {
    const res = await POST(req(validBody({ quantity: qty })));

    expect(res.status).toBe(200);
    expect(mockedCreateSignal).toHaveBeenCalledTimes(1);
  });

  test.each([['price'], ['quantity']])(
    '%s 를 null 로 보내는 것은 "미지정"이지 오류가 아니다 — 하위 사이징이 파생한다',
    async (field) => {
      const res = await POST(req(validBody({ [field]: null })));

      expect(res.status).toBe(200);
      expect(mockedCreateSignal).toHaveBeenCalledTimes(1);
    },
  );

  test('price·quantity 를 아예 생략하는 기존 호출 형태도 통과한다', async () => {
    const res = await POST(req({
      symbol: '005930', side: 'buy', orderType: 'limit', amountKRW: 350000,
    }));

    expect(res.status).toBe(200);
    expect(mockedCreateSignal).toHaveBeenCalledTimes(1);
  });
});

// ── 가드 본체 ────────────────────────────────────────────────────────────────
describe('POST /api/signals — 비-number 수치 필드 런타임 가드 (T-028)', () => {
  /**
   * ⚠️ `NaN`·`Infinity` 는 여기에 없다 — **JSON 으로 전송 자체가 불가능**하기 때문이다
   * (`JSON.stringify({p: NaN})` → `{"p":null}`). 이 경계에서는 도달할 수 없는 값이고,
   * 그 사실을 아래 별도 테스트로 고정한다.
   */
  const NON_NUMBERS: Array<[string, unknown]> = [
    ['숫자 모양 문자열', '70000'],
    ['소수 모양 문자열', '3.7'],
    ['비숫자 문자열', 'abc'],
    ['객체', { v: 1 }],
    ['배열', [1]],
    ['boolean', true],
  ];

  describe.each([['limit'], ['market']] as const)('%s 시그널', (orderType) => {
    test.each(NON_NUMBERS)('price=%s → 400 + createSignal 미호출', async (_label, value) => {
      const res = await POST(req(validBody({ orderType, price: value })));

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({
        ok: false, error: 'price must be a finite number',
      });
      expect(mockedCreateSignal).not.toHaveBeenCalled();
    });

    test.each(NON_NUMBERS)('quantity=%s → 400 + createSignal 미호출', async (_label, value) => {
      const res = await POST(req(validBody({ orderType, quantity: value })));

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({
        ok: false, error: 'quantity must be a finite number',
      });
      expect(mockedCreateSignal).not.toHaveBeenCalled();
    });

    test.each(NON_NUMBERS)('amountKRW=%s → 400 + createSignal 미호출', async (_label, value) => {
      const res = await POST(req(validBody({ orderType, amountKRW: value })));

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({
        ok: false, error: 'amountKRW must be a finite number',
      });
      expect(mockedCreateSignal).not.toHaveBeenCalled();
    });
  });

  test('매도도 동일하게 400 — 매도는 상위 한도 검사를 건너뛰므로 특히 중요하다', async () => {
    const res = await POST(req(validBody({ side: 'sell', price: '70000' })));

    expect(res.status).toBe(400);
    expect(mockedCreateSignal).not.toHaveBeenCalled();
  });

  test('거절은 흔적을 남긴다 — signals 행이 없으므로 console.warn 이 유일한 기록이다', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await POST(req(validBody({ price: 'abc' })));

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('api/signals POST');
      expect(warn.mock.calls[0][0]).toContain('price');
      expect(warn.mock.calls[0][0]).toContain('005930');
    } finally {
      warn.mockRestore();
    }
  });

  test.each([['NaN', Number.NaN], ['Infinity', Number.POSITIVE_INFINITY]])(
    '%s 은 JSON 직렬화에서 null 이 되므로 이 경계에는 애초에 도달하지 못한다 (사실 고정)',
    async (_label, value) => {
      expect(JSON.parse(JSON.stringify({ price: value })).price).toBeNull();

      const res = await POST(req(validBody({ price: value })));

      // null = 미지정으로 처리되어 400 이 아니다. 이 값들을 막는 책임은 어댑터·한도 가드에 있다.
      expect(res.status).toBe(200);
    },
  );
});

// ── 기존 게이트와의 순서 관계 ────────────────────────────────────────────────
describe('POST /api/signals — 기존 게이트 회귀 없음', () => {
  test('required 누락은 여전히 기존 문구로 400 — 수치 가드가 앞지르지 않는다', async () => {
    const res = await POST(req({ side: 'buy' }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'symbol/side/orderType/amountKRW required',
    });
    expect(mockedCreateSignal).not.toHaveBeenCalled();
  });

  test('amountKRW=0 은 기존 required 검사가 먼저 잡는다 (수치 가드가 문구를 바꾸지 않는다)', async () => {
    const res = await POST(req(validBody({ amountKRW: 0 })));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'symbol/side/orderType/amountKRW required',
    });
  });

  test('엔진 비활성은 여전히 403 — 수치 가드보다 앞선다', async () => {
    (isEngineEnabled as jest.Mock).mockResolvedValue(false);

    const res = await POST(req(validBody({ price: 'abc' })));

    expect(res.status).toBe(403);
    expect(mockedCreateSignal).not.toHaveBeenCalled();
  });

  test('폐장 409 는 유효한 본문에 대해 그대로 유지된다', async () => {
    (isDomesticOpen as jest.Mock).mockResolvedValue(false);

    const res = await POST(req(validBody()));

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: 'domestic_market_closed' });
    expect(mockedCreateSignal).not.toHaveBeenCalled();
  });

  test('폐장이어도 비-number 는 400 으로 먼저 걸린다 — 무엇이 잘못됐는지가 더 유용하다', async () => {
    (isDomesticOpen as jest.Mock).mockResolvedValue(false);

    const res = await POST(req(validBody({ price: 'abc' })));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'price must be a finite number' });
  });

  test('createSignal 예외는 여전히 signal_create_failed 500 으로 분류된다', async () => {
    mockedCreateSignal.mockRejectedValue(new Error('ER_LOCK_DEADLOCK'));

    const res = await POST(req(validBody()));

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ error: 'signal_create_failed' });
  });
});
