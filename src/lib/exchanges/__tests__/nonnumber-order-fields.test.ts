/**
 * T-027 — 비-number 수치 필드가 주문 가드를 통과해 라이브 KIS 주문 호출까지 도달하던 문제.
 *
 * 이 스위트가 고정하는 것은 두 가지다.
 *  ① **막혀야 하는 것**: 타입이 깨진 `quantity`(그리고 국내 지정가의 `price`)가 어댑터에서
 *     차단되고 **`kisFetch` 가 한 번도 호출되지 않는다**(= 라이브 주문 API 미도달).
 *  ② **막히면 안 되는 것**: 정상 수량(정수·소수 number)은 **여전히 송신된다**. 과도차단은
 *     실매매를 멈추는 사고이므로 회귀 테스트를 같은 파일에 둔다.
 */
import { kisFetch } from '../kis-http';
import { createOrder as createDomesticOrder } from '../kis-domestic';
import { createOrder as createOverseasOrder } from '../kis-overseas';
import { unusableQuantityReason } from '../order-quantity';
import type { OrderRequest } from '../types';

jest.mock('../kis-auth', () => ({
  getKisToken: jest.fn(async () => 'tok'),
  kisBaseUrl: jest.fn(() => 'https://mock-base'),
}));

jest.mock('@/lib/credentials', () => ({
  getCredential: jest.fn(async (key: string) => {
    if (key === 'KIS_ACCOUNT_NO') return '12345678';
    if (key === 'KIS_ACCOUNT_PRODUCT') return '01';
    return '';
  }),
}));

jest.mock('../kis-http', () => ({
  kisFetch: jest.fn(),
  isKisRateLimited: jest.fn(() => false),
  kisBodyText: jest.fn(() => ''),
}));

jest.mock('@/lib/exchanges/fx', () => ({
  getUsdKrwRate: jest.fn(async () => 1400),
  usdToKrw: jest.fn(async (usd: number) => usd * 1400),
}));

function orderAccepted() {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ rt_cd: '0', msg1: '', output: { ODNO: 'ODNO-1' } }),
    text: async () => '',
  };
}

/** `quantity` 자리에 들어올 수 있는 비-number 런타임 값들. */
const NON_NUMBER_QUANTITIES: Array<[label: string, value: unknown]> = [
  ['숫자 모양 문자열 (\'3.7\')', '3.7'],
  ['정수 모양 문자열 (\'5\')',   '5'],
  ['빈 문자열',                  ''],
  ['NaN',                        Number.NaN],
  ['Infinity',                   Number.POSITIVE_INFINITY],
  ['-Infinity',                  Number.NEGATIVE_INFINITY],
  ['객체',                       { qty: 5 }],
  ['배열',                       [5]],
  ['boolean true',               true],
];

/** `??` 폴백이 동작해야 하는 값 — 타입 오류가 아니라 "미지정"으로 취급된다. */
const ABSENT_QUANTITIES: Array<[label: string, value: unknown]> = [
  ['null', null],
  ['undefined', undefined],
];

function domesticReq(over: Partial<Record<string, unknown>>): OrderRequest {
  return {
    exchange: 'kis', symbol: '005930', side: 'buy', type: 'limit',
    price: 70000, ...over,
  } as OrderRequest;
}

function overseasReq(over: Partial<Record<string, unknown>>): OrderRequest {
  return {
    exchange: 'kis', symbol: 'NAS:AAPL', side: 'buy', type: 'limit',
    price: 280000, ...over,
  } as OrderRequest;
}

describe('unusableQuantityReason — 사유를 두 갈래로 구분한다', () => {
  test.each(NON_NUMBER_QUANTITIES)('%s 는 타입 오류로 분류된다', (_label, value) => {
    const reason = unusableQuantityReason(value);
    expect(reason).toMatch(/quantity 타입 오류/);
  });

  test.each([[0], [-1], [-0.5]])('%p 은 기존 문구 그대로 "계산 실패" 다 — 분류 정규식 회귀 없음', (value) => {
    expect(unusableQuantityReason(value)).toBe('quantity 계산 실패');
  });

  test('context 를 주면 해외 어댑터의 기존 문구가 글자 그대로 재현된다', () => {
    expect(unusableQuantityReason(0, '해외는 USD 가격·수량 필수'))
      .toBe('quantity 계산 실패 (해외는 USD 가격·수량 필수)');
  });

  test.each([[1], [3], [3.7], [0.0001], [1e6]])('유효 수량 %p 은 통과한다 (null 반환)', (value) => {
    expect(unusableQuantityReason(value)).toBeNull();
  });

  test('어떤 이상값을 넣어도 던지지 않는다 — 진단 문자열 생성이 사고를 만들면 안 된다', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => unusableQuantityReason(circular)).not.toThrow();
    expect(() => unusableQuantityReason(Symbol('q'))).not.toThrow();
    expect(() => unusableQuantityReason(10n)).not.toThrow();
    expect(() => unusableQuantityReason(Object.create(null))).not.toThrow();
  });
});

describe('kis-domestic createOrder — 비-number quantity 는 라이브 호출 전에 막힌다', () => {
  beforeEach(() => jest.clearAllMocks());

  describe.each([['limit'], ['market']] as const)('%s 주문', (type) => {
    test.each(NON_NUMBER_QUANTITIES)('%s → 거부 + KIS 미호출', async (_label, value) => {
      const res = await createDomesticOrder(domesticReq({ type, quantity: value }));

      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/quantity 타입 오류/);
      expect(kisFetch).not.toHaveBeenCalled();
    });
  });

  test.each(ABSENT_QUANTITIES)('%s + 금액 없음 → 기존 "계산 실패" 경로 유지 (문구 회귀 없음)', async (_label, value) => {
    const res = await createDomesticOrder(domesticReq({ quantity: value }));

    expect(res.ok).toBe(false);
    expect(res.error).toBe('quantity 계산 실패');
    expect(kisFetch).not.toHaveBeenCalled();
  });

  test('quantity 미지정 + amountKRW 로 파생되는 기존 경로는 그대로 송신된다 — 회귀 없음', async () => {
    (kisFetch as jest.Mock).mockResolvedValueOnce(orderAccepted());

    const res = await createDomesticOrder(domesticReq({ quantity: undefined, amountKRW: 210000 }));

    expect(res.ok).toBe(true);
    expect(kisFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse((kisFetch as jest.Mock).mock.calls[0][1].body as string);
    expect(body.ORD_QTY).toBe('3'); // floor(210000/70000)
  });

  test.each([[1], [5], [3.7], [100]])('정상 수량 %p 은 여전히 송신된다 — 과도차단 회귀 없음', async (qty) => {
    (kisFetch as jest.Mock).mockResolvedValueOnce(orderAccepted());

    const res = await createDomesticOrder(domesticReq({ quantity: qty }));

    expect(res.ok).toBe(true);
    expect(kisFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse((kisFetch as jest.Mock).mock.calls[0][1].body as string);
    expect(body.ORD_QTY).toBe(String(qty)); // 국내는 가공 없이 통과 (T-018)
  });

  test('매도도 동일하게 막힌다 — 매도는 상위 한도 검사를 건너뛰므로 여기가 마지막 방어선이다', async () => {
    const res = await createDomesticOrder(domesticReq({ side: 'sell', quantity: '3.7' }));

    expect(res.ok).toBe(false);
    expect(kisFetch).not.toHaveBeenCalled();
  });
});

describe('kis-domestic createOrder — 비-number price(지정가)도 막힌다', () => {
  beforeEach(() => jest.clearAllMocks());

  test.each([['\'abc\'', 'abc'], ['NaN', Number.NaN], ['객체', {}]])(
    '지정가 price=%s → 거부 + KIS 미호출 (ORD_UNPR "NaN" 송신 방지)',
    async (_label, value) => {
      const res = await createDomesticOrder(domesticReq({ price: value, quantity: 5 }));

      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/price 타입 오류/);
      expect(kisFetch).not.toHaveBeenCalled();
    },
  );

  // 🔴 과도차단 회귀 방지의 핵심 케이스. `POST /api/signals` 는 본문 price 를 그대로 흘리고
  //    mysql2 는 DECIMAL 을 문자열로 돌려준다 — 숫자 문자열 price 는 **오늘 정상 송신되는 값**이다.
  //    quantity 처럼 `typeof === 'number'` 를 요구했다면 여기서 실매매가 끊겼을 것이다.
  test.each([['70000'], ['70000.0']])('숫자 문자열 price %p 는 기존처럼 송신된다 — 과도차단 회귀 없음', async (value) => {
    (kisFetch as jest.Mock).mockResolvedValueOnce(orderAccepted());

    const res = await createDomesticOrder(domesticReq({ price: value, quantity: 2 }));

    expect(res.ok).toBe(true);
    const body = JSON.parse((kisFetch as jest.Mock).mock.calls[0][1].body as string);
    expect(body.ORD_UNPR).toBe('70000');
  });

  test('시장가는 price 를 쓰지 않으므로 판정 대상이 아니다 — 회귀 없음', async () => {
    (kisFetch as jest.Mock).mockResolvedValueOnce(orderAccepted());

    const res = await createDomesticOrder(domesticReq({ type: 'market', price: Number.NaN, quantity: 2 }));

    expect(res.ok).toBe(true);
    const body = JSON.parse((kisFetch as jest.Mock).mock.calls[0][1].body as string);
    expect(body.ORD_UNPR).toBe('0');
  });

  test('가격 0 인 지정가는 기존 동작(브로커 거절에 맡김)을 그대로 둔다 — 동작 변경 없음', async () => {
    (kisFetch as jest.Mock).mockResolvedValueOnce(orderAccepted());

    await createDomesticOrder(domesticReq({ price: 0, quantity: 1 }));

    expect(kisFetch).toHaveBeenCalledTimes(1);
  });
});

describe('kis-overseas createOrder — 비-number quantity 는 라이브 호출 전에 막힌다', () => {
  beforeEach(() => jest.clearAllMocks());

  describe.each([['limit'], ['market']] as const)('%s 주문', (type) => {
    test.each(NON_NUMBER_QUANTITIES)('%s → 거부 + KIS 미호출', async (_label, value) => {
      const res = await createOverseasOrder(overseasReq({ type, quantity: value }));

      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/quantity 타입 오류/);
      expect(kisFetch).not.toHaveBeenCalled();
    });
  });

  test.each(ABSENT_QUANTITIES)('%s → 기존 문구 그대로 유지 (분류·로그 회귀 없음)', async (_label, value) => {
    const res = await createOverseasOrder(overseasReq({ quantity: value }));

    expect(res.ok).toBe(false);
    expect(res.error).toBe('quantity 계산 실패 (해외는 USD 가격·수량 필수)');
    expect(kisFetch).not.toHaveBeenCalled();
  });

  test.each([[1], [4], [3.7]])('정상 수량 %p 은 여전히 송신된다 — 과도차단 회귀 없음', async (qty) => {
    (kisFetch as jest.Mock).mockResolvedValueOnce(orderAccepted());

    const res = await createOverseasOrder(overseasReq({ quantity: qty }));

    expect(res.ok).toBe(true);
    expect(kisFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse((kisFetch as jest.Mock).mock.calls[0][1].body as string);
    expect(body.ORD_QTY).toBe(String(Math.floor(qty))); // 해외는 정수 절삭 (T-018)
  });
});

/**
 * T-027 Reviewer MEDIUM-1 — 국내에만 있던 price 유한성 가드를 해외에도 대칭으로 둔 건.
 *
 * 기존 `adjPrice <= 0` 는 `NaN` 은 막지만 **`Infinity` 는 통과**시켜(`Infinity > 0` → true)
 * `OVRS_ORD_UNPR: "Infinity"` 가 라이브로 나갈 수 있었다.
 *
 * 🔴 이 describe 의 회귀 테스트가 특히 중요하다: **해외 매도는 상위 한도 검사를 건너뛰므로**
 * (청산 우선 정책) 여기서 과도차단하면 곧바로 "청산이 막히는" 사고다 — 원 결함보다 훨씬 무겁다.
 */
describe('kis-overseas createOrder — 비-number price 도 막힌다 (MEDIUM-1)', () => {
  beforeEach(() => jest.clearAllMocks());

  // 국내와 달리 `type` 으로 스코프하지 않는다: KIS 해외는 `ORD_DVSN:'00'`(지정가) 고정이라
  // 시장가도 같은 `usdPrice` 에서 호가를 파생시킨다 — 즉 모든 주문이 price 를 쓴다.
  describe.each([['limit'], ['market']] as const)('%s 주문', (type) => {
    test.each([
      ['Infinity', Number.POSITIVE_INFINITY],
      ['-Infinity', Number.NEGATIVE_INFINITY],
      ['NaN', Number.NaN],
      ['\'abc\'', 'abc'],
      ['객체', {}],
    ])('price=%s → 거부 + KIS 미호출', async (_label, value) => {
      const res = await createOverseasOrder(overseasReq({ type, price: value, quantity: 3 }));

      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/price 타입 오류/);
      expect(kisFetch).not.toHaveBeenCalled();
    });
  });

  test('Infinity 매도도 막힌다 — 매도는 한도 검사를 건너뛰므로 여기가 유일한 방어선이다', async () => {
    const res = await createOverseasOrder(
      overseasReq({ side: 'sell', price: Number.POSITIVE_INFINITY, quantity: 3 }),
    );

    expect(res.ok).toBe(false);
    expect(kisFetch).not.toHaveBeenCalled();
  });

  // ── 과도차단 회귀 방지 (이 task 최대 위험) ─────────────────────────────────
  test.each([['280000'], ['280000.0']])(
    '숫자 문자열 price %p 는 여전히 송신된다 — mysql2 DECIMAL round-trip 경로를 끊지 않는다',
    async (value) => {
      (kisFetch as jest.Mock).mockResolvedValueOnce(orderAccepted());

      const res = await createOverseasOrder(overseasReq({ price: value, quantity: 3 }));

      expect(res.ok).toBe(true);
      expect(kisFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse((kisFetch as jest.Mock).mock.calls[0][1].body as string);
      expect(body.OVRS_ORD_UNPR).toBe('200'); // 280000 KRW / fx 1400 = $200
    },
  );

  test('숫자 문자열 price 로 매도해도 통과한다 — 청산 경로 회귀 없음', async () => {
    (kisFetch as jest.Mock).mockResolvedValueOnce(orderAccepted());

    const res = await createOverseasOrder(overseasReq({ side: 'sell', price: '280000', quantity: 3 }));

    expect(res.ok).toBe(true);
    expect(kisFetch).toHaveBeenCalledTimes(1);
  });

  test('정상 number price 지정가는 그대로 송신된다', async () => {
    (kisFetch as jest.Mock).mockResolvedValueOnce(orderAccepted());

    const res = await createOverseasOrder(overseasReq({ price: 280000, quantity: 3 }));

    expect(res.ok).toBe(true);
    const body = JSON.parse((kisFetch as jest.Mock).mock.calls[0][1].body as string);
    expect(body.OVRS_ORD_UNPR).toBe('200');
  });

  test('시장가는 공격적 호가(+0.5%)가 그대로 적용된다 — 기존 가격 로직 무변경', async () => {
    (kisFetch as jest.Mock).mockResolvedValueOnce(orderAccepted());

    await createOverseasOrder(overseasReq({ type: 'market', price: 280000, quantity: 3 }));

    const body = JSON.parse((kisFetch as jest.Mock).mock.calls[0][1].body as string);
    expect(body.OVRS_ORD_UNPR).toBe('201'); // round(200 * 1.005)
  });

  test('price 0/미지정은 기존 "USD 가격 계산 실패" 경로 그대로 — 문구 회귀 없음', async () => {
    const res = await createOverseasOrder(overseasReq({ price: 0, quantity: 3 }));

    expect(res.ok).toBe(false);
    expect(res.error).toBe('USD 가격 계산 실패 (FX 환산 오류)');
    expect(kisFetch).not.toHaveBeenCalled();
  });
});
