/**
 * T-058 — 게이트가 계산하는 해외 USD 단가 = **실제 주문 어댑터가 송신하는 단가**(`OVRS_ORD_UNPR`).
 *
 * 게이트는 `kis-overseas.ts` 의 `roundToTickOverseas`(비공개)를 복제한다(그 파일은 수정하지 않는다). 복제가 어긋나면
 * 막는 기준과 실제 주문이 갈라지므로, 진짜 `createOrder` 를 `kisFetch` 목으로 돌려 송신 본문과 직접 대조한다.
 * 수량도 같은지 본다 — 게이트·주문 모두 `buildOrderRequest` 의 정수 수량을 그대로 쓴다.
 */
import { kisFetch } from '@/lib/exchanges/kis-http';
import { createOrder as createOverseasOrder } from '@/lib/exchanges/kis-overseas';
import { getUsdKrwRate } from '@/lib/exchanges/fx';
import type { OrderRequest } from '@/lib/exchanges/types';
import { overseasLimitUnitUsd } from '../signal-cash-gate';

jest.mock('@/lib/exchanges/kis-auth', () => ({
  getKisToken: jest.fn(async () => 'tok'),
  invalidateKisToken: jest.fn(),
  kisBaseUrl: jest.fn(() => 'https://mock-base'),
}));
jest.mock('@/lib/credentials', () => ({
  getCredential: jest.fn(async (key: string) => (key === 'KIS_ACCOUNT_NO' ? '12345678' : key === 'KIS_ACCOUNT_PRODUCT' ? '01' : '')),
}));
jest.mock('@/lib/exchanges/kis-http', () => ({
  kisFetch: jest.fn(),
  isKisRateLimited: jest.fn(() => false),
  kisBodyText: jest.fn(() => ''),
}));
jest.mock('@/lib/exchanges/fx', () => ({ getUsdKrwRate: jest.fn() }));

const fetchMock = kisFetch as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  fetchMock.mockResolvedValue({
    ok: true, status: 200, headers: { get: () => null },
    json: async () => ({ rt_cd: '0', msg1: '', output: { ODNO: 'ODNO-1' } }), text: async () => '',
  });
});

const CASES: Array<[krwPrice: number, fx: number]> = [
  [280_000, 1400],               // $200 정수
  [67_109.0336, 1327.84],        // $50.54 → $51 (운영 DB NYS:BAC 형태)
  [66_000, 1327.84],             // $49.70 → $50
  [122_924.788, 1327.84],        // NAS:INTC 형태
  [1_814_446.8856, 1327.84],     // NAS:SNDK 형태(고가)
  [700, 1400],                   // $0.5 (1달러 미만)
  [172.79, 1400],                // $0.1234…
  [1_399.3, 1400],               // $0.9995 (1달러 경계 바로 아래)
  [1_400.7, 1400],               // $1.0005 (1달러 경계 바로 위)
];

test.each(CASES)('원화 %d · 환율 %d → 게이트 단가 = 송신 OVRS_ORD_UNPR, 수량 동일', async (krwPrice, fx) => {
  (getUsdKrwRate as jest.Mock).mockResolvedValue(fx);
  const req: OrderRequest = {
    exchange: 'kis', symbol: 'NAS:AAPL', side: 'buy', type: 'limit', price: krwPrice, quantity: 3,
    amountKRW: krwPrice * 3, market: 'overseas', currency: 'USD',
  };
  const r = await createOverseasOrder(req);
  expect(r.ok).toBe(true);
  const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
  expect(Number(body.OVRS_ORD_UNPR)).toBe(overseasLimitUnitUsd(krwPrice, fx));
  expect(body.ORD_QTY).toBe('3');
});

test('잔금 검증을 마친 해외 지정가는 환율을 다시 읽지 않고 검증된 가격 그대로 송신한다', async () => {
  const req: OrderRequest = {
    exchange: 'kis', symbol: 'NAS:AAPL', side: 'buy', type: 'limit', price: 140_000, quantity: 2,
    amountKRW: 300_000, market: 'overseas', currency: 'USD', verifiedAdaptiveLimitUsd: 99,
  };
  expect((await createOverseasOrder(req)).ok).toBe(true);
  expect(getUsdKrwRate).not.toHaveBeenCalled();
  expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toMatchObject({ OVRS_ORD_UNPR: '99', ORD_QTY: '2' });
});
