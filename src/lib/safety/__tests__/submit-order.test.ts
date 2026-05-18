import { getAccountId, getPool } from '@/lib/db';
import type { OrderRequest } from '@/lib/exchanges/types';
import { submitOrder } from '../dry-run';

jest.mock('@/lib/db', () => ({
  getPool: jest.fn(),
  getAccountId: jest.fn(),
}));

jest.mock('@/lib/safety/portfolio-total', () => ({
  getPortfolioTotalKRW: jest.fn().mockResolvedValue(1_000_000),
  getPortfolioTotalByMarketKRW: jest.fn().mockResolvedValue(1_000_000),
  getPortfolioTotalsKRW: jest.fn().mockResolvedValue({ domestic: 1_000_000, overseas: 0, total: 1_000_000 }),
}));

interface CapturedUpdate {
  status?: string;
  blockedBy?: string | null;
  exchangeOrderId?: string | null;
  raw: { sql: string; params: unknown[] };
}
interface CapturedLog {
  orderId: number | null;
  event: string;
  payload: unknown;
}
interface CapturedQuery {
  sql: string;
  params: unknown[];
}

interface Captured {
  queries: CapturedQuery[];
  updates: CapturedUpdate[];
  logs: CapturedLog[];
  lastOrderId: number;
}

interface MockOpts {
  filledAutoOn?: boolean;
  dailySum?: number;
  orderMaxPct?: number;   // DB safety_order_max_pct override (default: 1%)
  dailyMaxPct?: number;   // DB safety_daily_order_max_pct override (default: 5%)
}

function setupMockDB(opts: MockOpts = {}): Captured {
  const captured: Captured = { queries: [], updates: [], logs: [], lastOrderId: 0 };
  let nextId = 1000;

  const query = jest.fn(async (sqlArg: unknown, paramsArg: unknown[] = []) => {
    const sql = String(sqlArg);
    const params = paramsArg ?? [];
    captured.queries.push({ sql, params });

    if (/INSERT INTO orders/i.test(sql)) {
      const id = nextId++;
      captured.lastOrderId = id;
      return [{ insertId: id } as unknown];
    }
    if (/INSERT INTO trade_logs/i.test(sql)) {
      const [orderId, event, payloadJson] = params as [number | null, string, string];
      let payload: unknown = null;
      try { payload = JSON.parse(payloadJson); } catch { payload = payloadJson; }
      captured.logs.push({ orderId, event, payload });
      return [{}];
    }
    if (/FROM orders[\s\S]*status IN \('filled','partially_filled'\)/i.test(sql)) {
      return [opts.filledAutoOn ? [{ 1: 1 }] : []];
    }
    if (/SUM\(amount_krw\)/i.test(sql)) {
      return [[{ sum_krw: opts.dailySum ?? 0 }]];
    }
    // system_config: 한도 DB override — order-limits.ts는 `key` 컬럼으로 WHERE 파라미터 바인딩
    if (/FROM system_config/i.test(sql)) {
      const keyParam = String(params[0] ?? '');
      if (keyParam === 'safety_order_max_pct') return [[{ value: String(opts.orderMaxPct ?? 1) }]];
      if (keyParam === 'safety_daily_order_max_pct') return [[{ value: String(opts.dailyMaxPct ?? 5) }]];
      return [[]]; // 기타 config 키는 미설정
    }
    if (/UPDATE orders/i.test(sql)) {
      const update: CapturedUpdate = { raw: { sql, params } };
      const statusLit = sql.match(/SET\s+status='([^']+)'/);
      if (statusLit) update.status = statusLit[1];
      if (/blocked_by=\?/.test(sql)) update.blockedBy = (params[0] ?? null) as string | null;
      if (/exchange_order_id=\?/.test(sql)) update.exchangeOrderId = (params[0] ?? null) as string | null;
      captured.updates.push(update);
      return [{}];
    }
    throw new Error(`unexpected SQL: ${sql}`);
  });

  (getPool as jest.Mock).mockReturnValue({ query });
  (getAccountId as jest.Mock).mockResolvedValue(1);
  return captured;
}

const baseReq: OrderRequest = {
  exchange: 'coinone',
  symbol: 'KRW-BTC',
  side: 'buy',
  type: 'limit',
  price: 90_000_000,
  quantity: 0.0001, // amountKRW = 9,000
};

describe('submitOrder — 안전장치 회로 end-to-end', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env.DRY_RUN = 'true';
    process.env.KILL_SWITCH = 'false';
    process.env.BLOCKED_SYMBOLS_DOMESTIC = '';
    process.env.BLOCKED_SYMBOLS_OVERSEAS = '';
    process.env.ORDER_MAX_PCT = '1';   // 1,000,000 × 1% = 10,000
    process.env.DAILY_ORDER_MAX_PCT = '5'; // 1,000,000 × 5% = 50,000
    process.env.ASSET_PROFILE_CRYPTO_SKIP_VERIFY = 'false';
  });
  afterEach(() => {
    process.env = { ...origEnv };
    jest.clearAllMocks();
  });

  test('1. DRY_RUN 정상 주문 → status=dry_run + trade_logs 2건 + realSubmit 미호출', async () => {
    const cap = setupMockDB();
    const realSubmit = jest.fn();
    const r = await submitOrder(baseReq, realSubmit as never);

    expect(r.ok).toBe(true);
    expect(r.dryRun).toBe(true);
    expect(r.blockedBy).toBe('dry_run');
    expect(r.orderId).toBe(1000);
    expect(r.clientOrderId).toMatch(/^co-/);
    expect(realSubmit).not.toHaveBeenCalled();
    expect(cap.updates.some((u) => u.status === 'dry_run')).toBe(true);
    const events = cap.logs.map((l) => l.event);
    expect(events).toContain('submit_attempt');
    expect(events).toContain('dry_run');
  });

  test('2. Kill Switch ON → blocked + blocked_by=kill_switch + realSubmit 미호출', async () => {
    process.env.KILL_SWITCH = 'true';
    const cap = setupMockDB();
    const realSubmit = jest.fn();
    const r = await submitOrder(baseReq, realSubmit as never);

    expect(r.ok).toBe(false);
    expect(r.blockedBy).toBe('kill_switch');
    expect(r.error).toBe('KILL_SWITCH_ACTIVE');
    expect(realSubmit).not.toHaveBeenCalled();
    expect(cap.updates).toContainEqual(expect.objectContaining({ status: 'blocked', blockedBy: 'kill_switch' }));
    expect(cap.logs.map((l) => l.event)).toContain('blocked');
  });

  test('3. 블랙리스트 등록 심볼 → blocked + blocked_by=symbol_not_allowed', async () => {
    const cap = setupMockDB();
    process.env.BLOCKED_SYMBOLS_DOMESTIC = 'KRW-XRP';
    const r = await submitOrder({ ...baseReq, symbol: 'KRW-XRP' }, (async () => ({ ok: true })) as never);

    expect(r.ok).toBe(false);
    expect(r.blockedBy).toBe('symbol_not_allowed');
    expect(cap.updates).toContainEqual(expect.objectContaining({ status: 'blocked', blockedBy: 'symbol_not_allowed' }));
  });

  test('4. 1회 한도 초과 → blocked_by=order_limit', async () => {
    const cap = setupMockDB();
    const r = await submitOrder({ ...baseReq, amountKRW: 20_000 }, (async () => ({ ok: true })) as never);

    expect(r.ok).toBe(false);
    expect(r.blockedBy).toBe('order_limit');
    expect(cap.updates).toContainEqual(expect.objectContaining({ blockedBy: 'order_limit' }));
  });

  test('5. 일일 한도 초과 → blocked_by=daily_limit', async () => {
    const cap = setupMockDB({ dailySum: 45_000 });
    const r = await submitOrder(baseReq, (async () => ({ ok: true })) as never);

    expect(r.ok).toBe(false);
    expect(r.blockedBy).toBe('daily_limit');
    expect(cap.updates).toContainEqual(expect.objectContaining({ blockedBy: 'daily_limit' }));
  });

  test('6. 실송신 성공 → status=accepted + exchange_order_id + trade_logs: accepted', async () => {
    process.env.DRY_RUN = 'false';
    const cap = setupMockDB();
    const realSubmit = jest.fn().mockResolvedValue({ ok: true, exchangeOrderId: 'EX-123' });
    const r = await submitOrder(baseReq, realSubmit);

    expect(r.ok).toBe(true);
    expect(realSubmit).toHaveBeenCalledTimes(1);
    expect(cap.updates).toContainEqual(expect.objectContaining({ status: 'accepted', exchangeOrderId: 'EX-123' }));
    expect(cap.logs.map((l) => l.event)).toContain('accepted');
  });

  test('7. 실송신 거부 (ok:false) → status=rejected + trade_logs: rejected', async () => {
    process.env.DRY_RUN = 'false';
    const cap = setupMockDB();
    const realSubmit = jest.fn().mockResolvedValue({ ok: false, error: 'INSUFFICIENT_BALANCE' });
    const r = await submitOrder(baseReq, realSubmit);

    expect(r.ok).toBe(false);
    expect(cap.updates).toContainEqual(expect.objectContaining({ status: 'rejected' }));
    expect(cap.logs.map((l) => l.event)).toContain('rejected');
  });

  test('8. 실송신 예외 → status=failed + error 전파 + trade_logs: error', async () => {
    process.env.DRY_RUN = 'false';
    const cap = setupMockDB();
    const realSubmit = jest.fn().mockRejectedValue(new Error('network down'));
    const r = await submitOrder(baseReq, realSubmit);

    expect(r.ok).toBe(false);
    expect(r.error).toBe('network down');
    expect(cap.updates).toContainEqual(expect.objectContaining({ status: 'failed' }));
    expect(cap.logs.map((l) => l.event)).toContain('error');
  });

  test('9. clientOrderId 옵션 → INSERT orders의 client_order_id 컬럼에 전달 값 사용', async () => {
    const cap = setupMockDB();
    const r = await submitOrder(baseReq, (async () => ({ ok: true })) as never, { clientOrderId: 'custom-id-42' });
    expect(r.clientOrderId).toBe('custom-id-42');
    const insertOrders = cap.queries.find((q) => /INSERT INTO orders/i.test(q.sql));
    expect(insertOrders?.params[1]).toBe('custom-id-42');
  });
});
