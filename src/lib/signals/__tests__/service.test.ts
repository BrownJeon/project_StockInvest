import { getAccountId, getPool } from '@/lib/db';
import { approveSignal, createSignal, rejectSignal } from '../service';

jest.mock('@/lib/db', () => ({
  getPool: jest.fn(),
  getAccountId: jest.fn(),
}));

interface Captured {
  queries: Array<{ sql: string; params: unknown[] }>;
  signalInserts: Array<{ id: number; status: string; amount: number }>;
  signalUpdates: Array<{ id: number; consumedOrderId?: number; status?: string }>;
  orderInserts: number[];
  orderUpdates: Array<{ id: number; status?: string }>;
  tradeLogs: Array<{ orderId: number | null; event: string }>;
}

interface MockOpts {
  signalRow?: {
    id: number;
    status: string;
    symbol: string;
    side: 'buy' | 'sell';
    order_type: 'limit' | 'market';
    price: string | null;
    quantity: string | null;
    amount_krw: string;
    strategy_id: string | null;
  };
  dailySum?: number;
}

function setupMockDB(opts: MockOpts = {}): Captured {
  const cap: Captured = {
    queries: [],
    signalInserts: [],
    signalUpdates: [],
    orderInserts: [],
    orderUpdates: [],
    tradeLogs: [],
  };
  let nextOrderId = 2000;
  let nextSignalId = 3000;

  const query = jest.fn(async (sqlArg: unknown, paramsArg: unknown[] = []) => {
    const sql = String(sqlArg);
    const params = paramsArg ?? [];
    cap.queries.push({ sql, params });

    if (/INSERT INTO signals/i.test(sql)) {
      const id = nextSignalId++;
      const status = String(params[9]);
      const amount = Number(params[6]);
      cap.signalInserts.push({ id, status, amount });
      return [{ insertId: id }];
    }
    if (/UPDATE signals SET consumed_order_id=\?/i.test(sql)) {
      cap.signalUpdates.push({ id: Number(params[1]), consumedOrderId: Number(params[0]) });
      return [{}];
    }
    if (/UPDATE signals SET status='approved'/i.test(sql)) {
      cap.signalUpdates.push({ id: Number(params[1]), status: 'approved', consumedOrderId: params[0] as number });
      return [{}];
    }
    if (/UPDATE signals SET status='rejected'/i.test(sql)) {
      cap.signalUpdates.push({ id: Number(params[0]), status: 'rejected' });
      return [{}];
    }
    if (/SELECT[\s\S]*FROM signals WHERE id=\?/i.test(sql)) {
      const row = opts.signalRow ?? {
        id: Number(params[0]),
        status: 'pending',
        symbol: 'KRW-BTC',
        side: 'buy',
        order_type: 'limit',
        price: '90000000',
        quantity: '0.0001',
        amount_krw: '9000',
        strategy_id: 'test',
      };
      return [row ? [row] : []];
    }
    if (/INSERT INTO orders/i.test(sql)) {
      const id = nextOrderId++;
      cap.orderInserts.push(id);
      return [{ insertId: id }];
    }
    if (/INSERT INTO trade_logs/i.test(sql)) {
      cap.tradeLogs.push({ orderId: params[0] as number | null, event: String(params[1]) });
      return [{}];
    }
    if (/FROM orders[\s\S]*status IN \('filled','partially_filled'\)/i.test(sql)) {
      return [[]];
    }
    if (/SUM\(amount_krw\)/i.test(sql)) {
      return [[{ sum_krw: opts.dailySum ?? 0 }]];
    }
    if (/UPDATE orders/i.test(sql)) {
      const m = sql.match(/SET\s+status='([^']+)'/);
      cap.orderUpdates.push({ id: Number(params[params.length - 1]), status: m?.[1] });
      return [{}];
    }
    if (/FROM system_config WHERE `key` = \?/i.test(sql)) {
      // analyst_style / safety_limit_chase_disabled / safety_dry_run 등 — 기본 미설정
      return [[]];
    }
    throw new Error(`unexpected SQL: ${sql}`);
  });

  (getPool as jest.Mock).mockReturnValue({ query });
  (getAccountId as jest.Mock).mockResolvedValue(1);
  return cap;
}

describe('signals/service', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env.DRY_RUN = 'true';
    process.env.KILL_SWITCH = 'false';
    process.env.BLOCKED_SYMBOLS_DOMESTIC = '';
    process.env.BLOCKED_SYMBOLS_OVERSEAS = '';
    process.env.ORDER_MAX_KRW = '10000';
    process.env.DAILY_ORDER_MAX_KRW = '50000';
    process.env.SIGNAL_AUTO_SUBMIT_MAX_KRW = '5000';
    process.env.SIGNAL_DEFAULT_TTL_MIN = '30';
    process.env.ASSET_PROFILE_CRYPTO_SKIP_VERIFY = 'false';
  });
  afterEach(() => {
    process.env = { ...origEnv };
    jest.clearAllMocks();
  });

  test('createSignal ANALYST_ENABLED=true → auto_submitted + submitOrder 호출 + consumed_order_id 업데이트', async () => {
    process.env.ANALYST_ENABLED = 'true';
    const cap = setupMockDB();
    const r = await createSignal({
      symbol: 'KRW-BTC',
      side: 'buy',
      orderType: 'limit',
      price: 90_000_000,
      quantity: 0.000_033,
      amountKRW: 3_000,
    });
    expect(r.ok).toBe(true);
    expect(r.autoSubmitted).toBe(true);
    expect(r.orderId).toBeDefined();
    expect(cap.signalInserts[0].status).toBe('auto_submitted');
    expect(cap.orderInserts).toHaveLength(1);
    expect(cap.signalUpdates.some((u) => u.consumedOrderId === r.orderId)).toBe(true);
  });

  test('createSignal ANALYST_ENABLED=false → pending (수동 검토 대기, 주문 미생성)', async () => {
    process.env.ANALYST_ENABLED = 'false';
    const cap = setupMockDB();
    const r = await createSignal({
      symbol: 'KRW-BTC',
      side: 'buy',
      orderType: 'limit',
      price: 90_000_000,
      quantity: 0.000_1,
      amountKRW: 9_000,
    });
    expect(r.ok).toBe(true);
    expect(r.autoSubmitted).toBe(false);
    expect(r.orderId).toBeUndefined();
    expect(cap.signalInserts[0].status).toBe('pending');
    expect(cap.orderInserts).toHaveLength(0);
  });

  test('createSignal ANALYST_ENABLED=true 일반 금액 → auto_submitted', async () => {
    process.env.ANALYST_ENABLED = 'true';
    const cap = setupMockDB();
    const r = await createSignal({
      symbol: 'KRW-BTC',
      side: 'buy',
      orderType: 'limit',
      price: 90_000_000,
      quantity: 0.000_1,
      amountKRW: 9_000,
    });
    expect(r.ok).toBe(true);
    expect(r.autoSubmitted).toBe(true);
    expect(cap.signalInserts[0].status).toBe('auto_submitted');
  });

  test('createSignal 블랙리스트 등록 심볼 → ok:false + INSERT 없음', async () => {
    process.env.BLOCKED_SYMBOLS_DOMESTIC = '005930';
    const cap = setupMockDB();
    const r = await createSignal({
      symbol: '005930',
      side: 'buy',
      orderType: 'limit',
      amountKRW: 3_000,
    });
    expect(r.ok).toBe(false);
    expect(cap.signalInserts).toHaveLength(0);
  });

  test('approveSignal 정상 → orders INSERT + status=approved', async () => {
    const cap = setupMockDB({
      signalRow: {
        id: 1234,
        status: 'pending',
        symbol: 'KRW-BTC',
        side: 'buy',
        order_type: 'limit',
        price: '90000000',
        quantity: '0.0001',
        amount_krw: '9000',
        strategy_id: 'test',
      },
    });
    const r = await approveSignal(1234);
    expect(r.ok).toBe(true);
    expect(cap.orderInserts).toHaveLength(1);
    expect(cap.signalUpdates.some((u) => u.status === 'approved')).toBe(true);
  });

  test('approveSignal pending이 아니면 거부', async () => {
    setupMockDB({
      signalRow: {
        id: 1234,
        status: 'approved',
        symbol: 'KRW-BTC',
        side: 'buy',
        order_type: 'limit',
        price: '90000000',
        quantity: '0.0001',
        amount_krw: '9000',
        strategy_id: 'test',
      },
    });
    const r = await approveSignal(1234);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/invalid_status/);
  });

  test('rejectSignal pending → status=rejected + trade_logs에 signal_rejected 기록', async () => {
    const cap = setupMockDB({
      signalRow: {
        id: 7777,
        status: 'pending',
        symbol: 'KRW-BTC',
        side: 'sell',
        order_type: 'limit',
        price: '90000000',
        quantity: '0.0001',
        amount_krw: '9000',
        strategy_id: 'test',
      },
    });
    const r = await rejectSignal(7777);
    expect(r.ok).toBe(true);
    expect(cap.signalUpdates.some((u) => u.status === 'rejected' && u.id === 7777)).toBe(true);
    expect(cap.tradeLogs.some((l) => l.event === 'signal_rejected')).toBe(true);
  });

  // Phase M — limit 호가 추격 (체결률 ↑)
  test('createSignal buy limit → chase 가격 적용 (limitChasePct=0.005)', async () => {
    process.env.ANALYST_ENABLED = 'true';
    const cap = setupMockDB();
    await createSignal({
      symbol: '005930', side: 'buy', orderType: 'limit',
      price: 100_000, amountKRW: 3_000,
    });
    // INSERT INTO orders 의 price (params[6]) 가 100_000 * 1.005 = 100_500
    const orderInsert = cap.queries.find((q) => /INSERT INTO orders/i.test(q.sql));
    expect(orderInsert).toBeDefined();
    expect(Number(orderInsert!.params[6])).toBeCloseTo(100_500, 0);
  });

  test('createSignal sell limit → chase 가격 하향 적용', async () => {
    process.env.ANALYST_ENABLED = 'true';
    const cap = setupMockDB();
    await createSignal({
      symbol: '005930', side: 'sell', orderType: 'limit',
      price: 100_000, amountKRW: 3_000,
    });
    const orderInsert = cap.queries.find((q) => /INSERT INTO orders/i.test(q.sql));
    expect(orderInsert).toBeDefined();
    // 100_000 * 0.995 = 99_500
    expect(Number(orderInsert!.params[6])).toBeCloseTo(99_500, 0);
  });

  test('createSignal market 주문 → chase 미적용 (price null)', async () => {
    process.env.ANALYST_ENABLED = 'true';
    const cap = setupMockDB();
    await createSignal({
      symbol: '005930', side: 'buy', orderType: 'market',
      price: undefined, amountKRW: 3_000,
    });
    const orderInsert = cap.queries.find((q) => /INSERT INTO orders/i.test(q.sql));
    expect(orderInsert).toBeDefined();
    expect(orderInsert!.params[6]).toBeNull();
  });
});
