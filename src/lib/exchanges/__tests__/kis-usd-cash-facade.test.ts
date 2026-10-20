/**
 * T-056 — Facade 계약: 현금(USD)을 `Balance[]` 에서 분리한다.
 *
 *  - 보유 조회 성공 + 현금 조회 실패 → `complete=true`(보유는 완결), `cash.USD.state='unknown'` — 현금 실패가 엔진 보유 조회·청산을
 *    함께 멈추지 않는다(T-014 계약 유지).
 *  - 해외 비활성 → `not_queried`.
 *  - `balances` 에는 어떤 경우에도 USD 행이 없다.
 *  - 해외 활성 판정식은 `isOverseasEnabled()` 하나 — 예전 복제 식과 같은 결과.
 */
const domGetBalances = jest.fn();
const ovsGetBalances = jest.fn();
const ovsGetUsdCash = jest.fn();

jest.mock('@/lib/exchanges/kis-domestic', () => ({
  getBalances: (...a: unknown[]) => domGetBalances(...a),
  getTicker: jest.fn(), getCandles: jest.fn(), createOrder: jest.fn(), cancelOrder: jest.fn(),
  fetchMarketCapRanking: jest.fn(), getKisTickers: jest.fn(),
  getActiveOrders: jest.fn(async () => []), getCompletedOrders: jest.fn(),
}));
jest.mock('@/lib/exchanges/kis-overseas', () => ({
  getBalances: (...a: unknown[]) => ovsGetBalances(...a),
  getUsdCash: (...a: unknown[]) => ovsGetUsdCash(...a),
  getTicker: jest.fn(), getCandles: jest.fn(), createOrder: jest.fn(), cancelOrder: jest.fn(),
  getKisOverseasTickers: jest.fn(),
  getActiveOrders: jest.fn(async () => []), getCompletedOrders: jest.fn(),
  activeOrderExchanges: () => ['NAS'],
}));

import { kis, getBalancesDetailed, getActiveOrdersDetailed, isOverseasEnabled } from '@/lib/exchanges/kis';

const DOM = [{ currency: 'KRW', free: 80_138, locked: 0 }, { currency: '005930', free: 30, locked: 0 }];
const OVS = [{ currency: 'NAS:STK1', free: 11, locked: 0 }];
const KNOWN = { usd: 368.51, source: 'CTRP6504R', ustlSllAmtSmtl: 0 };

const orig = process.env.KIS_OVERSEAS_ENABLED;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.KIS_OVERSEAS_ENABLED = 'true';
  jest.spyOn(console, 'error').mockImplementation(() => {});
  domGetBalances.mockResolvedValue(DOM);
  ovsGetBalances.mockResolvedValue(OVS);
  ovsGetUsdCash.mockResolvedValue(KNOWN);
});
afterEach(() => {
  jest.restoreAllMocks();
  if (orig === undefined) delete process.env.KIS_OVERSEAS_ENABLED; else process.env.KIS_OVERSEAS_ENABLED = orig;
});

describe('getBalancesDetailed — cash.USD', () => {
  test('정상 → known, 보유와 같은 호출에서 함께 온다', async () => {
    const r = await getBalancesDetailed();
    expect(r.complete).toBe(true);
    expect(r.cash.USD).toEqual({ state: 'known', ...KNOWN });
    expect(r.overseasEnabled).toBe(true);
    expect(r.balances.map(b => b.currency)).toEqual(['KRW', '005930', 'NAS:STK1']);
  });

  test('🔴 현금만 실패 → complete=true(보유 완결), cash.USD=unknown — 0 으로 바꾸지 않는다', async () => {
    ovsGetUsdCash.mockRejectedValue(new Error('CTRP6504R rt_cd=1'));
    const r = await getBalancesDetailed();
    expect(r.complete).toBe(true);
    expect(r.failed).toEqual([]);
    expect(r.cash.USD).toEqual({ state: 'unknown', error: expect.stringContaining('CTRP6504R') });
    expect(r.balances.some(b => b.currency === 'USD')).toBe(false);
  });

  test('보유 실패와 현금 상태는 독립 — 해외 보유 실패여도 현금은 known 일 수 있다', async () => {
    ovsGetBalances.mockRejectedValue(new Error('EGW00201'));
    const r = await getBalancesDetailed();
    expect(r.complete).toBe(false);
    expect(r.failed.map(f => f.market)).toEqual(['overseas']);
    expect(r.cash.USD.state).toBe('known');
  });

  test('해외 비활성 → not_queried, 어댑터를 부르지 않는다', async () => {
    process.env.KIS_OVERSEAS_ENABLED = 'false';
    const r = await getBalancesDetailed();
    expect(r.cash.USD).toEqual({ state: 'not_queried' });
    expect(r.overseasEnabled).toBe(false);
    expect(ovsGetUsdCash).not.toHaveBeenCalled();
    expect(ovsGetBalances).not.toHaveBeenCalled();
  });

  test('🔴 어댑터가 USD 행을 다시 섞어 보내도 balances 에서 버린다 (현금의 유일한 통로는 cash.USD)', async () => {
    ovsGetBalances.mockResolvedValue([...OVS, { currency: 'USD', free: 999, locked: 0 }]);
    const r = await getBalancesDetailed();
    expect(r.balances.some(b => b.currency === 'USD')).toBe(false);
    await expect(kis.getBalances()).resolves.not.toContainEqual(expect.objectContaining({ currency: 'USD' }));
  });

  test('kis.getBalances() 는 보유 완결 여부만 보고 던진다 — 현금 실패로는 던지지 않는다(엔진·표시 경로 무영향)', async () => {
    ovsGetUsdCash.mockRejectedValue(new Error('down'));
    await expect(kis.getBalances()).resolves.toHaveLength(3);
  });
});

describe('isOverseasEnabled — 판정식 하나 (예전 복제 식과 동치)', () => {
  const legacy = (v: string | undefined) => String(v ?? 'true').toLowerCase() === 'true';
  test.each([[undefined], ['true'], ['TRUE'], ['True'], ['1'], ['yes'], ['false'], [''], [' true']])('%p', (v) => {
    if (v === undefined) delete process.env.KIS_OVERSEAS_ENABLED; else process.env.KIS_OVERSEAS_ENABLED = v;
    expect(isOverseasEnabled()).toBe(legacy(v));
  });

  test('미체결 조회도 같은 판정을 쓴다 (비활성이면 해외 미체결을 부르지 않는다)', async () => {
    process.env.KIS_OVERSEAS_ENABLED = '1';            // 예전 식에서도 꺼짐
    const r = await getActiveOrdersDetailed();
    expect(r.ok).toEqual(['domestic']);
  });
});
