/**
 * T-056 — **매도는 한도 계산이 무엇을 보든 `realSubmit` 까지 간다** (불변식 고정, 설계 R4·C1-2).
 *
 * `dry-run.ts` 는 `getEffectiveOrderMax/DailyMax` 를 side 와 무관하게 먼저 부른다(이번 task 에서 그 순서를 바꾸지 않는다 — Q7 제외).
 * 이번 작업은 그 아래 계층에 새 실패 원인(CTRP6504R USD 예수금·환율)을 더한다. 그래서 다음 각각에서 해외·국내 **매도**가
 * 송신까지 도달하는지 실제 `submitOrder`·실제 `order-limits` 로 확인한다(평가액 모듈만 목):
 *   해외 현금 unknown · 환율 실패 · 잔고 전체 실패(직전값 없음) · 평가액 조회 예외 · pct DB 실패.
 * 대조: 같은 조건의 **해외 매수**는 `order_limit` 로 막힌다(Q5 — unknown 이면 해외 신규 매수 차단).
 */
import { getAccountId, getPool } from '@/lib/db';
import type { OrderRequest } from '@/lib/exchanges/types';
import { getMarketTotal } from '@/lib/safety/portfolio-total';
import { submitOrder } from '../dry-run';

jest.mock('@/lib/db', () => ({ getPool: jest.fn(), getAccountId: jest.fn() }));
jest.mock('@/lib/safety/portfolio-total', () => ({ getMarketTotal: jest.fn() }));
jest.mock('@/lib/notify', () => ({ sendAlert: jest.fn() }));

let dbDownForConfig = false;
function setupDb() {
  let id = 5000;
  const query = jest.fn(async (sqlArg: unknown, params: unknown[] = []) => {
    const sql = String(sqlArg);
    if (/INSERT INTO orders/i.test(sql)) return [{ insertId: id++ }];
    if (/INSERT INTO trade_logs/i.test(sql)) return [{}];
    if (/UPDATE orders/i.test(sql)) return [{}];
    if (/SUM\(amount_krw\)/i.test(sql)) return [[{ sum_krw: 0 }]];
    if (/FROM system_config/i.test(sql)) {
      const k = String(params?.[0] ?? '');
      if (k === 'safety_dry_run') return [[{ value: 'false' }]];
      if (k === 'safety_kill_switch') return [[{ value: 'false' }]];
      if (dbDownForConfig && /max_pct/.test(k)) throw new Error('db down');
      if (k === 'safety_order_max_pct') return [[{ value: '5' }]];
      if (k === 'safety_daily_order_max_pct') return [[{ value: '10' }]];
      return [[]];
    }
    if (/FROM orders/i.test(sql)) return [[]];
    if (/portfolio_snapshots/i.test(sql)) return [[]];
    return [[]];
  });
  (getPool as jest.Mock).mockReturnValue({ query });
  (getAccountId as jest.Mock).mockResolvedValue(1);
}

const ovsSell: OrderRequest = { exchange: 'kis', symbol: 'NAS:STK1', side: 'sell', type: 'limit', price: 1_200_000, quantity: 11, amountKRW: 13_200_000, market: 'overseas' };
const domSell: OrderRequest = { exchange: 'kis', symbol: '005930', side: 'sell', type: 'limit', price: 70_000, quantity: 30, amountKRW: 2_100_000, market: 'domestic' };
const ovsBuy: OrderRequest = { ...ovsSell, side: 'buy', quantity: 1, amountKRW: 50_000 };

const origEnv = { ...process.env };
beforeEach(() => {
  jest.clearAllMocks();
  dbDownForConfig = false;
  process.env.DRY_RUN = 'false';
  process.env.KILL_SWITCH = 'false';
  process.env.BLOCKED_SYMBOLS_DOMESTIC = '';
  process.env.BLOCKED_SYMBOLS_OVERSEAS = '';
  setupDb();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { process.env = { ...origEnv }; jest.restoreAllMocks(); });

const conditions: [string, () => void][] = [
  ['해외 현금 unknown', () => (getMarketTotal as jest.Mock).mockResolvedValue({ status: 'unknown', reason: 'usd_cash_unknown', detail: 'x' })],
  ['환율 실패', () => (getMarketTotal as jest.Mock).mockResolvedValue({ status: 'unknown', reason: 'fx_unavailable', detail: 'x' })],
  ['잔고 전체 실패(직전값 없음)', () => (getMarketTotal as jest.Mock).mockResolvedValue({ status: 'unknown', reason: 'balances_failed', detail: 'x' })],
  ['평가액 조회 예외', () => (getMarketTotal as jest.Mock).mockRejectedValue(new Error('KIS down'))],
  ['pct DB 실패', () => { dbDownForConfig = true; (getMarketTotal as jest.Mock).mockResolvedValue({ status: 'ok', krw: 20_000_000 }); }],
];

describe.each(conditions)('🔴 %s', (_name, arrange) => {
  test('해외 매도는 realSubmit 까지 도달한다', async () => {
    arrange();
    const realSubmit = jest.fn().mockResolvedValue({ ok: true, exchangeOrderId: 'X1' });
    const r = await submitOrder(ovsSell, realSubmit);
    expect(realSubmit).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(true);
    expect(r.blockedBy).toBeUndefined();
  });

  test('국내 매도도 realSubmit 까지 도달한다', async () => {
    arrange();
    const realSubmit = jest.fn().mockResolvedValue({ ok: true, exchangeOrderId: 'X2' });
    const r = await submitOrder(domSell, realSubmit);
    expect(realSubmit).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(true);
  });

  test('대조: 해외 매수는 order_limit 로 막힌다 (송신 없음)', async () => {
    arrange();
    const realSubmit = jest.fn();
    const r = await submitOrder(ovsBuy, realSubmit);
    expect(realSubmit).not.toHaveBeenCalled();
    expect(r.blockedBy).toBe('order_limit');
  });
});
