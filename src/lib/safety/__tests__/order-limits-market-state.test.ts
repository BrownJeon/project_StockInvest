/**
 * T-056 — 한도 함수는 시장 평가액 **상태**를 직접 받고, **숫자를 돌려주며 절대 던지지 않는다.**
 *
 * 왜 "던지지 않음"이 불변식인가: `submitOrder` 는 매수·매도 구분 없이 `getEffectiveOrderMax/DailyMax` 를 먼저 부른다(결과는
 * 매도면 쓰지 않음). 여기서 던지면 매도가 바깥 catch 로 떨어져 `failed` = 청산 불가. 매도 경로 전체 시험은
 * `submit-order-sell-invariant.test.ts`.
 */
import { getPool } from '@/lib/db';
import { getMarketTotal } from '@/lib/safety/portfolio-total';
import { getEffectiveDailyMax, getEffectiveOrderMax } from '../order-limits';

jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));
jest.mock('@/lib/safety/portfolio-total', () => ({ getMarketTotal: jest.fn() }));

function pct(order = '5', daily = '10') {
  (getPool as jest.Mock).mockReturnValue({
    query: jest.fn(async (_s: unknown, params: unknown[] = []) => {
      const k = String(params[0]);
      if (k === 'safety_order_max_pct') return [[{ value: order }]];
      if (k === 'safety_daily_order_max_pct') return [[{ value: daily }]];
      return [[]];
    }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  pct();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test('ok → 평가액 × pct', async () => {
  (getMarketTotal as jest.Mock).mockResolvedValue({ status: 'ok', krw: 2_000_000 });
  await expect(getEffectiveOrderMax('kis', 'overseas')).resolves.toBe(100_000);
  await expect(getEffectiveDailyMax('kis', 'overseas')).resolves.toBe(200_000);
  expect(getMarketTotal).toHaveBeenCalledWith('overseas');
});

test.each(['usd_cash_unknown', 'fx_unavailable', 'krw_cash_unknown', 'balances_failed'])(
  '🔴 unknown(%s) → 한도 0 (신규 매수 차단) + 사유 로그', async (reason) => {
    (getMarketTotal as jest.Mock).mockResolvedValue({ status: 'unknown', reason, detail: 'x' });
    await expect(getEffectiveOrderMax('kis', 'overseas')).resolves.toBe(0);
    await expect(getEffectiveDailyMax('kis', 'overseas')).resolves.toBe(0);
    expect(String((console.warn as jest.Mock).mock.calls.at(-1)?.[0])).toContain(reason);
  });

test('🔴 평가액 조회가 던져도 한도 함수는 던지지 않고 0', async () => {
  (getMarketTotal as jest.Mock).mockRejectedValue(new Error('boom'));
  await expect(getEffectiveOrderMax('kis', 'overseas')).resolves.toBe(0);
  await expect(getEffectiveDailyMax('kis', 'domestic')).resolves.toBe(0);
});

test('🔴 평가액 조회가 동기적으로 던져도(구현 결함) 0', async () => {
  (getMarketTotal as jest.Mock).mockImplementation(() => { throw new TypeError('not a function'); });
  await expect(getEffectiveOrderMax('kis', 'overseas')).resolves.toBe(0);
});

test.each([[undefined], [null], [{}], [{ status: 'ok', krw: NaN }], [{ status: 'ok', krw: Infinity }], [{ status: 'ok', krw: -5 }]])(
  '상태 값이 이상해도(%p) 던지지 않고 0', async (v) => {
    (getMarketTotal as jest.Mock).mockResolvedValue(v);
    await expect(getEffectiveOrderMax('kis', 'overseas')).resolves.toBe(0);
  });

test('pct DB 조회가 실패해도 0 (기존 fail-safe 유지)', async () => {
  (getPool as jest.Mock).mockReturnValue({ query: jest.fn().mockRejectedValue(new Error('db down')) });
  (getMarketTotal as jest.Mock).mockResolvedValue({ status: 'ok', krw: 2_000_000 });
  await expect(getEffectiveOrderMax('kis', 'overseas')).resolves.toBe(0);
});
