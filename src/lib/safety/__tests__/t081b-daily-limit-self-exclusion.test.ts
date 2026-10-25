/**
 * T-081 WP-B (F10) — 일일 한도 **자기 행만 제외** 계약(기본 jest 로 도는 목 시험).
 * 실제 SQL 의미(경합·경계·기존 의미)는 일회용 MariaDB 시험 `t081b-daily-limit-race-disposable-mariadb.test.ts` 가 본다.
 * 여기서는 ① `checkDailyMax` 가 `pending` 을 합산 대상에 두고 자기 id 만 바인딩해 빼는지 ② `submitOrder` 가 INSERT 로 얻은 자기 id 를
 * 넘기는지 ③ 매도는 일일 한도 집계를 하지 않는지를 고정한다.
 */
import { getAccountId, getPool } from '@/lib/db';
import type { OrderRequest } from '@/lib/exchanges/types';
import { checkDailyMax } from '../order-limits';
import { submitOrder } from '../dry-run';

jest.mock('@/lib/db', () => ({ getPool: jest.fn(), getAccountId: jest.fn() }));
jest.mock('@/lib/notify', () => ({ sendAlert: jest.fn() }));
jest.mock('@/lib/safety/portfolio-total', () => ({
  getMarketTotal: jest.fn().mockResolvedValue({ status: 'ok', krw: 1_000_000 }),
}));
jest.mock('../kill-switch', () => ({ isKillSwitchActive: jest.fn().mockResolvedValue(false) }));
jest.mock('../volatility-guard', () => ({ checkVolatilityGuard: jest.fn().mockResolvedValue({ ok: true }) }));
jest.mock('../validation-gate', () => ({
  ...jest.requireActual('../validation-gate'),
  evaluateValidationGate: jest.fn().mockResolvedValue({ allowed: true, kind: 'validated', status: 'backtested' }),
}));

const domesticBuy: OrderRequest = { exchange: 'kis', symbol: '005930', side: 'buy', type: 'limit', price: 1_000, quantity: 5 }; // 5,000원

interface Q { sql: string; params: unknown[] }

function mockDb(opts: { insertId?: number; dailySum?: number } = {}): Q[] {
  const qs: Q[] = [];
  const query = jest.fn(async (sqlArg: unknown, paramsArg: unknown[] = []) => {
    const sql = String(sqlArg);
    const params = paramsArg ?? [];
    qs.push({ sql, params });
    if (/INSERT INTO orders/i.test(sql)) return [{ insertId: opts.insertId ?? 4242 }];
    if (/INSERT INTO trade_logs/i.test(sql)) return [{}];
    if (/SUM\(amount_krw\)/i.test(sql)) return [[{ sum_krw: opts.dailySum ?? 0 }]];
    if (/FROM system_config/i.test(sql)) {
      const k = String(params[0] ?? '');
      if (k === 'safety_order_max_pct') return [[{ value: '10' }]];         // 100,000
      if (k === 'safety_daily_order_max_pct') return [[{ value: '50' }]];   // 500,000
      if (k === 'safety_dry_run') return [[{ value: 'true' }]];
      return [[]];
    }
    if (/UPDATE orders/i.test(sql)) return [{}];
    throw new Error(`unexpected SQL: ${sql}`);
  });
  (getPool as jest.Mock).mockReturnValue({ query });
  (getAccountId as jest.Mock).mockResolvedValue(1);
  return qs;
}
const sumQueries = (qs: Q[]) => qs.filter((q) => /SUM\(amount_krw\)/i.test(q.sql));

describe('T-081 WP-B — checkDailyMax 자기 행만 제외', () => {
  afterEach(() => jest.clearAllMocks());

  test('SQL: pending 은 NOT IN 목록에서 빠지고, 자기 pending 행만 id 바인딩으로 제외한다', async () => {
    const qs = mockDb();
    await expect(checkDailyMax({ ...domesticBuy, amountKRW: 5_000 }, 500_000, 777)).resolves.toEqual({ ok: true });
    const [q] = sumQueries(qs);
    expect(q.sql).toMatch(/status NOT IN \('rejected','failed','blocked','cancelled'\)/);
    expect(q.sql).not.toMatch(/NOT IN \([^)]*'pending'/);
    expect(q.sql).toMatch(/AND NOT \(status = 'pending' AND id = \?\)/);
    expect(q.sql).toMatch(/market = \?/);
    expect(q.sql).toMatch(/side = 'buy'/);
    expect(q.sql).toMatch(/created_at >= \?/);
    expect(q.params).toHaveLength(3);
    expect(q.params[0]).toBeInstanceOf(Date);
    expect(q.params.slice(1)).toEqual(['domestic', 777]);
  });

  test.each([
    ['생략', undefined],
    ['NaN', Number.NaN],
    ['음수', -1],
    ['0', 0],
    ['소수', 1.5],
    ['문자열', '777' as unknown as number],
  ])('selfOrderId %s → 0 바인딩(아무 행도 빼지 않음 = 오늘 pending 전부 합산)', async (_label, id) => {
    const qs = mockDb();
    await checkDailyMax({ ...domesticBuy, amountKRW: 5_000 }, 500_000, id);
    expect(sumQueries(qs)[0].params[2]).toBe(0);
  });

  test('해외 주문은 시장 overseas 로 바인딩된다', async () => {
    const qs = mockDb();
    await checkDailyMax({ exchange: 'kis', symbol: 'NAS:MU', side: 'buy', type: 'limit', amountKRW: 5_000 }, 500_000, 9);
    expect(sumQueries(qs)[0].params.slice(1)).toEqual(['overseas', 9]);
  });

  test('불변: 한도 0 → 집계 없이 거부 / 집계 예외 → 거부(fail-closed)', async () => {
    const qs = mockDb();
    await expect(checkDailyMax({ ...domesticBuy, amountKRW: 5_000 }, 0, 1)).resolves.toMatchObject({ ok: false, reason: 'daily_limit' });
    expect(sumQueries(qs)).toHaveLength(0);
    (getPool as jest.Mock).mockReturnValue({ query: jest.fn().mockRejectedValue(new Error('boom')) });
    jest.spyOn(console, 'error').mockImplementationOnce(() => {});
    await expect(checkDailyMax({ ...domesticBuy, amountKRW: 5_000 }, 500_000, 1)).resolves
      .toEqual({ ok: false, reason: 'daily_limit', detail: 'aggregate query failed' });
  });
});

describe('T-081 WP-B — submitOrder 가 자기 orderId 를 일일 한도에 넘긴다', () => {
  const origEnv = { ...process.env };
  beforeEach(() => { process.env.DRY_RUN = 'true'; });
  afterEach(() => { process.env = { ...origEnv }; jest.clearAllMocks(); });

  test('매수: INSERT insertId(4242) 가 일일 집계의 세 번째 바인딩이고, INSERT 가 집계보다 먼저다', async () => {
    const qs = mockDb({ insertId: 4242 });
    const r = await submitOrder(domesticBuy, jest.fn() as never, { attribution: { kind: 'strategy', strategyId: 's', signalId: null } });
    expect(r).toMatchObject({ ok: true, dryRun: true, orderId: 4242 });
    const sums = sumQueries(qs);
    expect(sums).toHaveLength(1);
    expect(sums[0].params.slice(1)).toEqual(['domestic', 4242]);
    const insertAt = qs.findIndex((q) => /INSERT INTO orders/i.test(q.sql));
    expect(insertAt).toBeGreaterThanOrEqual(0);
    expect(insertAt).toBeLessThan(qs.indexOf(sums[0]));
  });

  test('매수 + 다른 주문 합계로 한도 초과 → blocked(daily_limit), 자기 id 는 그 주문', async () => {
    const qs = mockDb({ insertId: 51, dailySum: 498_000 });
    const r = await submitOrder(domesticBuy, jest.fn() as never, { attribution: { kind: 'strategy', strategyId: 's', signalId: null } });
    expect(r).toMatchObject({ ok: false, orderId: 51, blockedBy: 'daily_limit' });
    expect(sumQueries(qs)[0].params[2]).toBe(51);
  });

  test('매도: 일일 한도 집계를 하지 않는다(청산 불변)', async () => {
    const qs = mockDb();
    const r = await submitOrder({ ...domesticBuy, side: 'sell' }, jest.fn() as never);
    expect(r).toMatchObject({ ok: true, dryRun: true });
    expect(sumQueries(qs)).toHaveLength(0);
  });
});
