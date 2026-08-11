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
  /**
   * service.ts 의 "동일 심볼+방향 활성 시그널 중복 방지" 조회 결과.
   * 지정하면 해당 symbol/side 요청에 대해 기존 pending 시그널이 있는 것으로 응답한다.
   */
  activeDuplicate?: { id: number; symbol: string; side: 'buy' | 'sell' };
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
    // 동일 심볼+방향 활성 시그널 중복 방지 조회 (auto_submit 이 아닌 경로에서만 발생).
    // 기본값은 "중복 없음" — activeDuplicate 를 지정한 케이스만 기존 시그널을 반환한다.
    // 상태 목록은 코드 상수(AWAITING_APPROVAL_STATUSES)에서 생성되므로 SQL 리터럴로 매칭하지 않는다.
    if (/SELECT id FROM signals[\s\S]*WHERE symbol = \? AND side = \?/i.test(sql)) {
      const [sym, side] = params as [string, string];
      const dup = opts.activeDuplicate;
      return [dup && dup.symbol === sym && dup.side === side ? [{ id: dup.id }] : []];
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

  // ⚠️ auto 는 `AUTOPILOT_MODE` 를 **명시적으로** 지정했을 때만 도달한다 (T-006 reviewer HIGH).
  //    구 ANALYST_ENABLED=true 만으로는 더 이상 auto 가 되지 않는다 — assist 상한.
  test('createSignal AUTOPILOT_MODE=auto → auto_submitted + submitOrder 호출 + consumed_order_id 업데이트', async () => {
    process.env.ANALYST_ENABLED = 'true';
    process.env.AUTOPILOT_MODE = 'auto';
    const cap = setupMockDB();
    const r = await createSignal({
      symbol: 'KRW-BTC',
      side: 'buy',
      orderType: 'limit',
      // T-020 — 주식은 정수 주식 수로만 거래된다. 원래 이 fixture 는 소수 수량
      // (0.000033)이었는데 그건 자매 프로젝트(암호화폐)의 관례이고, 이제 사이징이
      // 1주 미만을 주문 불성립으로 거부하므로 주식 현실에 맞는 값으로 바꾼다.
      price: 1_000,
      quantity: 3,
      amountKRW: 3_000,
    });
    expect(r.ok).toBe(true);
    expect(r.autoSubmitted).toBe(true);
    expect(r.orderId).toBeDefined();
    expect(cap.signalInserts[0].status).toBe('auto_submitted');
    expect(cap.orderInserts).toHaveLength(1);
    expect(cap.signalUpdates.some((u) => u.consumedOrderId === r.orderId)).toBe(true);
  });

  test('createSignal 엔진 on + assist → awaiting_approval (사람 승인 대기, 주문 미생성)', async () => {
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
    expect(cap.signalInserts[0].status).toBe('awaiting_approval');
    expect(cap.orderInserts).toHaveLength(0);
  });

  test('createSignal — 동일 심볼+방향 활성 시그널 존재 시 중복 생성 차단', async () => {
    process.env.ANALYST_ENABLED = 'false';
    const cap = setupMockDB({ activeDuplicate: { id: 777, symbol: 'KRW-BTC', side: 'buy' } });
    const r = await createSignal({
      symbol: 'KRW-BTC',
      side: 'buy',
      orderType: 'limit',
      price: 90_000_000,
      quantity: 0.000_1,
      amountKRW: 9_000,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('duplicate_active_signal');
    expect(r.signalId).toBe(777);
    expect(cap.signalInserts).toHaveLength(0);
    expect(cap.orderInserts).toHaveLength(0);
  });

  test('createSignal — 방향이 다르면 중복으로 보지 않는다', async () => {
    process.env.ANALYST_ENABLED = 'false';
    const cap = setupMockDB({ activeDuplicate: { id: 777, symbol: 'KRW-BTC', side: 'sell' } });
    const r = await createSignal({
      symbol: 'KRW-BTC',
      side: 'buy',
      orderType: 'limit',
      price: 90_000_000,
      quantity: 0.000_1,
      amountKRW: 9_000,
    });
    expect(r.ok).toBe(true);
    expect(cap.signalInserts).toHaveLength(1);
  });

  // T-003 §4-1 — auto 모드에서 SIGNAL_AUTO_SUBMIT_MAX_KRW(5,000) 초과분은 assist 로 격하된다.
  test('createSignal auto 모드 + 자동제출 한도 초과 → awaiting_approval 격하 (주문 미생성)', async () => {
    process.env.ANALYST_ENABLED = 'true';
    process.env.AUTOPILOT_MODE = 'auto';
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
    expect(cap.signalInserts[0].status).toBe('awaiting_approval');
    expect(cap.orderInserts).toHaveLength(0);
  });

  // T-003 §4-1 — hard_stop 청산은 모드와 무관하게 즉시 자동 제출된다 (손실 확대 방지).
  test('createSignal assist 모드 + hard_stop 청산 → auto_submitted + 주문 생성', async () => {
    process.env.ANALYST_ENABLED = 'false';   // assist
    const cap = setupMockDB();
    const r = await createSignal({
      symbol: 'KRW-BTC',
      side: 'sell',
      orderType: 'market',
      amountKRW: 3_000,
      indicators: { exit_kind: 'hard_stop' },
    });
    expect(r.ok).toBe(true);
    expect(r.autoSubmitted).toBe(true);
    expect(cap.signalInserts[0].status).toBe('auto_submitted');
    expect(cap.orderInserts).toHaveLength(1);
  });

  // T-003 §4-1 — manual 모드는 관측 기록만 남기고 주문 경로가 없다.
  test('createSignal manual 모드 → detected (주문 미생성)', async () => {
    process.env.AUTOPILOT_MODE = 'manual';
    process.env.ANALYST_ENABLED = 'true';
    const cap = setupMockDB();
    const r = await createSignal({
      symbol: 'KRW-BTC',
      side: 'buy',
      orderType: 'limit',
      price: 90_000_000,
      amountKRW: 3_000,
    });
    expect(r.ok).toBe(true);
    expect(r.autoSubmitted).toBe(false);
    expect(cap.signalInserts[0].status).toBe('detected');
    expect(cap.orderInserts).toHaveLength(0);
  });

  // 🚨 회귀 — 구 스위치만으로는 자동 주문이 나가지 않는다.
  test('createSignal ANALYST_ENABLED=true 만으로는 자동 제출되지 않는다 (assist 상한)', async () => {
    process.env.ANALYST_ENABLED = 'true';
    delete process.env.AUTOPILOT_MODE;
    const cap = setupMockDB();
    const r = await createSignal({
      symbol: 'KRW-BTC',
      side: 'buy',
      orderType: 'limit',
      price: 90_000_000,
      amountKRW: 3_000,
    });
    expect(r.ok).toBe(true);
    expect(r.autoSubmitted).toBe(false);
    expect(cap.signalInserts[0].status).toBe('awaiting_approval');
    expect(cap.orderInserts).toHaveLength(0);
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
        // T-020 — 소수 수량 fixture(0.0001)는 이제 "1주 미만 = 주문 불성립"으로 거부된다.
        price: '9000',
        quantity: '1',
        amount_krw: '9000',
        strategy_id: 'test',
      },
    });
    const r = await approveSignal(1234);
    expect(r.ok).toBe(true);
    expect(cap.orderInserts).toHaveLength(1);
    expect(cap.signalUpdates.some((u) => u.status === 'approved')).toBe(true);
  });

  test('approveSignal 신규 awaiting_approval 도 승인 가능', async () => {
    const cap = setupMockDB({
      signalRow: {
        id: 4321,
        status: 'awaiting_approval',
        symbol: 'KRW-BTC',
        side: 'buy',
        order_type: 'limit',
        price: '9000',
        quantity: '1',
        amount_krw: '9000',
        strategy_id: 'test',
      },
    });
    const r = await approveSignal(4321);
    expect(r.ok).toBe(true);
    expect(cap.orderInserts).toHaveLength(1);
  });

  test('approveSignal 승인 대기 상태가 아니면 거부', async () => {
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
    process.env.AUTOPILOT_MODE = 'auto';   // 주문 생성 경로를 타려면 명시적 auto 가 필요하다
    const cap = setupMockDB();
    await createSignal({
      symbol: '005930', side: 'buy', orderType: 'limit',
      // T-020 — 원래 price=100,000 / amount=3,000 이라 사이징이 0.03주였다. 이제 그건
      // 주문 불성립으로 스킵되므로(주식은 1주 단위) 최소 1주가 성립하는 값으로 바꾼다.
      // 이 테스트의 의도(호가 추격이 가격에 적용되는가)는 그대로다.
      price: 1_000, amountKRW: 3_000,
    });
    // INSERT INTO orders 의 price (params[6]) 가 1_000 * 1.005 = 1_005
    const orderInsert = cap.queries.find((q) => /INSERT INTO orders/i.test(q.sql));
    expect(orderInsert).toBeDefined();
    expect(Number(orderInsert!.params[6])).toBeCloseTo(1_005, 0);
    // 수량은 floor(3000 / 1005) = 2주 — 소수가 아니다
    expect(Number(orderInsert!.params[7])).toBe(2);
  });

  test('createSignal sell limit → chase 가격 하향 적용', async () => {
    process.env.ANALYST_ENABLED = 'true';
    process.env.AUTOPILOT_MODE = 'auto';   // 주문 생성 경로를 타려면 명시적 auto 가 필요하다
    const cap = setupMockDB();
    await createSignal({
      symbol: '005930', side: 'sell', orderType: 'limit',
      price: 1_000, amountKRW: 3_000,
    });
    const orderInsert = cap.queries.find((q) => /INSERT INTO orders/i.test(q.sql));
    expect(orderInsert).toBeDefined();
    // 1_000 * 0.995 = 995
    expect(Number(orderInsert!.params[6])).toBeCloseTo(995, 0);
    expect(Number(orderInsert!.params[7])).toBe(3);   // floor(3000 / 995)
  });

  test('createSignal market 주문 → chase 미적용 (price null)', async () => {
    process.env.ANALYST_ENABLED = 'true';
    process.env.AUTOPILOT_MODE = 'auto';   // 주문 생성 경로를 타려면 명시적 auto 가 필요하다
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
