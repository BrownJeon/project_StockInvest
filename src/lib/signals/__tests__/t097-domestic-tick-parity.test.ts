/**
 * T-097 Q-E (Leader 결정 ①) — 국내 "수량" 줄의 단가 = **실제 주문 어댑터가 송신하는 단가**(`ORD_UNPR`), "=" 금액 = 그 단가 × 수량.
 *
 * 줄은 `kis-domestic.ts` 의 `roundToTick`(export 만 추가, 로직 무변경)을 그대로 쓴다. 이 시험은 세 가지를 서로 대조한다.
 *  1. 줄의 단가(`buildQuantityLine`)
 *  2. 어댑터 소스의 호가단위 규칙을 이 파일에 손으로 옮긴 독립 기대값(가장 가까운 호가, 정확히 절반이면 위 — `Math.round`)
 *  3. 진짜 `createOrder` 를 `kisFetch` 목으로 돌려 얻은 송신 본문의 `ORD_UNPR`
 * 경계 격자: 호가단위가 바뀌는 지점(2천·5천·2만·5만·20만·50만 원) ±1원·±0.5원, 반 호가 지점, 호가 추격 +0.5% 가 경계를 넘는 사례.
 */
import { kisFetch } from '@/lib/exchanges/kis-http';
import { createOrder as createDomesticOrder, roundToTick } from '@/lib/exchanges/kis-domestic';
import type { OrderRequest } from '@/lib/exchanges/types';
import { buildQuantityLine } from '../approval-notify';
import { renderQuantityLine } from '../approval-message';
import { computeSizingSnapshot } from '../sizing-snapshot';

jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));
jest.mock('@/lib/auth/session', () => ({ getSessionSecret: jest.fn() }));
jest.mock('../../notify', () => ({ dispatchAlertWithTelegram: jest.fn(), getSymbolLabel: jest.fn(), sendAlert: jest.fn() }));
jest.mock('../../notify/telegram-api', () => ({ sendTelegramMessage: jest.fn() }));
jest.mock('../../notify/telegram', () => ({ sendTelegramAlert: jest.fn() }));
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

const fetchMock = kisFetch as jest.Mock;
beforeEach(() => {
  jest.clearAllMocks();
  fetchMock.mockResolvedValue({
    ok: true, status: 200, headers: { get: () => null },
    json: async () => ({ rt_cd: '0', msg1: '', output: { ODNO: 'ODNO-1' } }), text: async () => '',
  });
});

/** `kis-domestic.ts` `tickSize` 를 소스에서 그대로 옮긴 독립 규칙(KOSPI/KOSDAQ 공통, 2024년 기준) */
function expectedTick(price: number): number {
  const tick = price < 2000 ? 1 : price < 5000 ? 5 : price < 20000 ? 10 : price < 50000 ? 50
    : price < 200000 ? 100 : price < 500000 ? 500 : 1000;
  return Math.round(price / tick) * tick;
}

const lineFor = (unitPriceKrw: number, quantity: number) => buildQuantityLine({
  side: 'buy', orderType: 'limit', market: 'domestic',
  indicators: { sizing: computeSizingSnapshot({ market: 'domestic', targetKrw: unitPriceKrw * quantity + 1, quantity, unitPriceKrw, quantitySource: 'amount', chasePct: 0 }) },
});

const BOUNDARIES = [2_000, 5_000, 20_000, 50_000, 200_000, 500_000];
const GRID: number[] = [
  ...BOUNDARIES.flatMap((b) => [b - 1, b - 0.5, b, b + 0.5, b + 1]),
  // 반 호가 지점(정확히 절반 → 위), 그 바로 아래·위
  48_525, 48_524.99, 48_525.01, 50_050, 50_049.99, 200_250, 200_249.99, 500_500, 500_499.99, 1_002.5, 3_002.5, 10_005,
  // 호가 추격 +0.5% (기본 limitChasePct) — 경계를 넘거나 호가 사이에 떨어지는 사례
  48_300 * 1.005, 50_000 * 1.005, 500_000 * 1.005, 1_990 * 1.005, 4_980 * 1.005, 19_950 * 1.005, 49_800 * 1.005,
  199_500 * 1.005, 70_000 * 1.005, 245_000 * 1.005,
];

describe('🔴 국내 줄 단가 = 어댑터 송신 단가(ORD_UNPR), "=" = 단가 × 수량', () => {
  test.each(GRID.map((p) => [p]))('기록 단가 %d → 줄·독립 규칙·어댑터 송신이 같다', async (price) => {
    const q = 3;
    const line = lineFor(price, q);
    expect(line).not.toBeNull();
    if (!line || line.market !== 'domestic') throw new Error('unreachable');
    expect(line.unitKrw).toBe(expectedTick(price));
    expect(line.unitKrw).toBe(roundToTick(price));
    expect(line.totalKrw).toBe(q * line.unitKrw);
    expect(Number.isInteger(line.unitKrw)).toBe(true);

    const req: OrderRequest = {
      exchange: 'kis', symbol: '005930', side: 'buy', type: 'limit', price, quantity: q,
      amountKRW: price * q, market: 'domestic', currency: 'KRW',
    } as OrderRequest;
    const r = await createDomesticOrder(req);
    expect(r.ok).toBe(true);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.ORD_UNPR).toBe(String(line.unitKrw));
    expect(body.ORD_QTY).toBe(String(q));
  });

  test('보고된 사례: 48,300 × 1.005 → 2주 × ₩48,550 (= ₩97,100) — 기록값 그대로였다면 ₩48,541·₩97,083', () => {
    const line = lineFor(48_300 * 1.005, 2);
    expect(line).toEqual({ market: 'domestic', quantity: 2, unitKrw: 48_550, totalKrw: 97_100 });
    expect(renderQuantityLine(line)).toBe('수량   2주 × ₩48,550  (= ₩97,100)');
  });

  test('반올림 방향 = 가장 가까운 호가(아래로도 위로도), 정확히 절반이면 위 — 어댑터 `Math.round(price / tick) * tick`', () => {
    expect(lineFor(48_520, 1)).toMatchObject({ unitKrw: 48_500 });        // 아래로
    expect(lineFor(48_530, 1)).toMatchObject({ unitKrw: 48_550 });        // 위로
    expect(lineFor(48_525, 1)).toMatchObject({ unitKrw: 48_550 });        // 절반 → 위
    expect(lineFor(48_524.99, 1)).toMatchObject({ unitKrw: 48_500 });
  });

  test('가격대별(5만 원대·50만 원대 포함): 추격 +0.5% 가 호가단위 경계를 넘는 경우', () => {
    // 부동소수점: 1.005 는 이진수로 1.00499999… 라 50,000 × 1.005 = 50,249.99999… → 100원 단위 → 50,200 (절반 아님).
    // 어댑터도 같은 값을 같은 함수로 반올림하므로 줄과 송신은 같다(위 격자 시험이 송신 본문으로 대조한다).
    expect(renderQuantityLine(lineFor(50_000 * 1.005, 1))).toBe('수량   1주 × ₩50,200  (= ₩50,200)');
    expect(renderQuantityLine(lineFor(49_800 * 1.005, 2))).toBe('수량   2주 × ₩50,000  (= ₩100,000)');    // 50,048.99… → 100원 단위
    expect(renderQuantityLine(lineFor(500_000 * 1.005, 1))).toBe('수량   1주 × ₩502,000  (= ₩502,000)');  // 502,499.99… → 1,000원 단위
    expect(renderQuantityLine(lineFor(199_500 * 1.005, 1))).toBe('수량   1주 × ₩200,500  (= ₩200,500)');  // 200,497.49… → 500원 단위
    expect(renderQuantityLine(lineFor(4_980 * 1.005, 10))).toBe('수량   10주 × ₩5,000  (= ₩50,000)');     // 5,004.9 → 10원 단위(5천~2만)
    expect(renderQuantityLine(lineFor(1_990 * 1.005, 10))).toBe('수량   10주 × ₩2,000  (= ₩20,000)');     // 1,999.94… → 1원 단위 → 2,000
    expect(renderQuantityLine(lineFor(19_950 * 1.005, 1))).toBe('수량   1주 × ₩20,050  (= ₩20,050)');     // 20,049.74… → 50원 단위
  });

  test('반올림 결과가 0원이면(단가 0.5원 미만 — 비현실 기록) 줄 값 자체가 없다', () => {
    expect(roundToTick(0.4)).toBe(0);
    expect(lineFor(0.4, 1)).toBeNull();
  });

  test('어댑터가 여전히 지정가를 roundToTick 으로 송신한다(소스 고정) — 바뀌면 이 줄의 근거가 사라진다', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const src: string = require('fs').readFileSync(require('path').join(__dirname, '../../exchanges/kis-domestic.ts'), 'utf8');
    expect(src).toMatch(/ORD_UNPR:\s*req\.type === 'market' \? '0' : String\(roundToTick\(price\)\)/);
    expect(src).toMatch(/export function roundToTick\(price: number\): number \{\n\s*const tick = tickSize\(price\);\n\s*return Math\.round\(price \/ tick\) \* tick;\n\}/);
  });
});
