/**
 * T-019 — **부분체결 주문을 완전 체결로 기록하지 않는다.**
 *
 * ## 고정하려는 결함
 *
 * `settledStatus()` 의 `activeReliable && !activeOrderIds.has(eid)` 분기는 **체결 수량을
 * 쳐다보지도 않고** `filled` 를 썼다. 그 명제가 참이려면 "미체결 목록에서 사라지는 유일한
 * 이유가 전량 체결"이어야 하는데 그렇지 않다 — **장 마감 시 브로커가 잔량을 자동 취소**하는
 * 것은 오류가 아니라 정상 동작이다.
 *
 * | 시각 | 사건 | 미체결 목록 | 체결 목록 |
 * |---|---|---|---|
 * | 14:00 | 매도 지정가 10주 접수 | 있음(10주) | 없음 |
 * | 15:10 | 3주 체결 | 있음(잔량 7주) | 있음(3주) |
 * | 15:30 | **장 마감 — 잔량 7주 자동 취소** | **없음** | 있음(3주) |
 *
 * 예전 규칙은 여기서 "10주 완전 체결"을 DB 에 썼다. 그리고 `trade-report` 는
 * `COALESCE(e.quantity, o.quantity)` 로 손익을 내는데 `executions` 가 0행이라 항상
 * 주문 수량으로 떨어진다 → 매도 수익이 10주치로 잡히고 LIFO 재고에서 10주가 빠져
 * **이후 모든 매도의 원가가 오염된다.** 1회성 오차가 아니라 누적 오차다.
 *
 * ## 이 파일이 고정하는 계약
 *
 *  1. 잔량이 살아 있으면 여전히 `partially_filled` (T-018 §부분체결 무회귀)
 *  2. 잔량이 사라졌는데 체결 수량이 모자라면 → **종결(`filled`)하되 실제 수량을
 *     `executions` 에 남긴다.** 상태만 `filled` 로 쓰고 끝내지 않는다
 *  3. 전량 체결은 여전히 그냥 `filled` (정상 판정을 죽이지 않는다)
 *  4. 비교 기준은 `submittedQuantity` — 소수점 주문(T-018 H-4)에서 무회귀
 *  5. 수량을 모르면 기존 동작 유지 + **조용하지 않게** 집계·로그
 *  6. 멱등 — 이미 체결 기록이 있으면 두 번째 행을 만들지 않는다
 *  7. 기록에 실패하면 상태를 `filled` 로 넘기지 않는다 (수량 영구 유실 방지)
 *  8. 매수/매도 알림 키가 분리돼 한쪽이 다른 쪽을 억누르지 않는다
 */
import { getPool } from '@/lib/db';
import { getActiveOrdersDetailed, getCompletedOrders } from '@/lib/exchanges/kis';
import { sendAlertThrottled } from '@/lib/notify/throttle';
import { syncPendingOrders, resetUnreconciledTracker } from '../order-sync';

jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));
jest.mock('@/lib/exchanges/kis', () => ({
  getActiveOrdersDetailed: jest.fn(),
  getCompletedOrders: jest.fn(),
  overseasActiveOrderExchanges: jest.fn(() => ['NAS']),
}));
jest.mock('@/lib/notify/throttle', () => ({
  sendAlertThrottled: jest.fn(() => true),
  resetAlertThrottle: jest.fn(),
}));

interface PendingRow {
  id: number;
  exchange_order_id: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: 'limit' | 'market';
  status: string;
  price: number | null;
  quantity: number | null;
  created_at: Date;
}

/** 유예 기간을 확실히 지난 시각 */
const AGED = new Date('2026-08-01T00:00:00+09:00');

const row = (o: Partial<PendingRow> & { id: number }): PendingRow => ({
  exchange_order_id: `O${String(o.id).padStart(3, '0')}`,
  symbol: '005930',
  side: 'sell',
  type: 'limit',
  status: 'accepted',
  price: 70_000,
  quantity: 10,
  created_at: AGED,
  ...o,
});

interface Captured {
  updates: Array<{ sql: string; params: unknown[] }>;
  execInserts: Array<{ orderId: number; price: number; quantity: number; fee: number; executedAt: Date }>;
  tradeLogs: Array<{ orderId: number | null; event: string; payload: Record<string, unknown> }>;
}

interface PoolOpts {
  /** 이 주문 id 들은 이미 executions 행을 갖고 있는 것으로 응답한다 */
  existingExecutions?: number[];
  /** executions INSERT 를 실패시킨다 (DB 장애 재현) */
  failExecutionInsert?: boolean;
  /** trade_logs INSERT 를 실패시킨다 */
  failAuditInsert?: boolean;
  /** 사후 중복 탐지 SELECT COUNT(*) 가 돌려줄 값 (동시 실행 경합 재현). 기본 1 */
  duplicateCount?: number;
  /** 중복 탐지 SELECT 자체를 실패시킨다 */
  failDuplicateProbe?: boolean;
}

function setupPool(rows: PendingRow[], opts: PoolOpts = {}): Captured {
  const cap: Captured = { updates: [], execInserts: [], tradeLogs: [] };
  const query = jest.fn(async (sqlArg: unknown, paramsArg: unknown[] = []) => {
    const sql = String(sqlArg);
    const params = paramsArg ?? [];
    if (/FROM system_config/i.test(sql)) return [[]];
    if (/SELECT COUNT\(\*\) AS n FROM executions/i.test(sql)) {
      if (opts.failDuplicateProbe) throw new Error('probe down');
      return [[{ n: opts.duplicateCount ?? 1 }]];
    }
    if (/SELECT id FROM executions/i.test(sql)) {
      const id = Number(params[0]);
      return [(opts.existingExecutions ?? []).includes(id) ? [{ id: 1 }] : []];
    }
    if (/INSERT INTO executions/i.test(sql)) {
      if (opts.failExecutionInsert) throw new Error('deadlock');
      cap.execInserts.push({
        orderId: Number(params[0]), price: Number(params[1]),
        quantity: Number(params[2]), fee: 0, executedAt: params[3] as Date,
      });
      return [{ insertId: 1 }];
    }
    if (/INSERT INTO trade_logs/i.test(sql)) {
      if (opts.failAuditInsert) throw new Error('trade_logs down');
      cap.tradeLogs.push({
        orderId: params[0] as number | null,
        event: String(params[1]),
        payload: JSON.parse(String(params[2])) as Record<string, unknown>,
      });
      return [{ insertId: 1 }];
    }
    if (/SELECT[\s\S]*FROM orders/i.test(sql)) return [rows];
    if (/UPDATE orders/i.test(sql)) {
      cap.updates.push({ sql, params });
      // T-071 R-03 — 상태 쓰기가 조건부(CAS)라 affectedRows 로 성공을 판정한다
      return [{ affectedRows: 1 }];
    }
    return [[]];
  });
  (getPool as jest.Mock).mockReturnValue({ query });
  return cap;
}

const bothOk = (orders: { orderId: string; symbol: string }[]) => ({
  orders, ok: ['domestic', 'overseas'], failed: [], complete: true,
});
const allFailed = () => ({
  orders: [], ok: [],
  failed: [{ market: 'domestic', error: 'rate limit' }, { market: 'overseas', error: 'rate limit' }],
  complete: false,
});

const FILL_TS = Date.parse('2026-08-11T15:10:00+09:00');
const completed = (o: { orderId: string; qty: number; price?: number; ts?: number; side?: string }) => ([{
  orderId: o.orderId, side: o.side ?? 'sell',
  price: o.price ?? 70_100, qty: o.qty, ts: o.ts ?? FILL_TS,
}]);

beforeEach(() => {
  jest.clearAllMocks();
  resetUnreconciledTracker();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); });

// ── ① 핵심 회귀 — 장마감 잔량 자동취소 시나리오 ──────────────────────────────

describe('🔴 잔량이 사라졌다고 해서 "전량 체결"이 되지는 않는다', () => {
  test('매도 10주 중 3주 체결 후 잔량 소멸 → filled 로 기록하되 실제 수량 3주를 executions 에 남긴다', async () => {
    const cap = setupPool([row({ id: 100, exchange_order_id: 'PS1', quantity: 10, side: 'sell' })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));        // 잔량 없음
    (getCompletedOrders as jest.Mock).mockResolvedValue(completed({ orderId: 'PS1', qty: 3 }));

    const r = await syncPendingOrders();

    // 상태는 종결돼야 한다 — partially_filled 로 두면 5분마다 영원히 재조회된다
    expect(cap.updates).toHaveLength(1);
    expect(cap.updates[0].sql).toMatch(/status='filled'/);
    expect(cap.updates[0].params).toEqual([100, 'accepted']);   // T-071 R-03 — CAS: 읽은 상태도 함께 넘긴다

    // 🔴 그러나 수량의 진실은 executions 가 들고 있어야 한다
    expect(cap.execInserts).toEqual([
      { orderId: 100, price: 70_100, quantity: 3, fee: 0, executedAt: new Date(FILL_TS) },
    ]);

    expect(r.partialSettlements).toEqual([{
      id: 100, exchangeOrderId: 'PS1', symbol: '005930', market: 'domestic',
      side: 'sell', orderedQty: 10, filledQty: 3, executionRecorded: true, note: undefined,
    }]);
    // 판정에 실패한 것이 아니다 — complete 를 깎지도, 보류로 세지도 않는다
    expect(r.complete).toBe(true);
    expect(r.skipped).toBe(0);
    expect(r.unreconciled).toEqual([]);
  });

  test('🔴 executions 를 쓰기 전에 status 를 filled 로 바꾸지 않는다 (중간 크래시 시 수량 영구 유실)', async () => {
    const order: Array<'exec' | 'status'> = [];
    const query = jest.fn(async (sqlArg: unknown, params: unknown[] = []) => {
      const sql = String(sqlArg);
      if (/FROM system_config/i.test(sql)) return [[]];
      if (/SELECT id FROM executions/i.test(sql)) return [[]];
      if (/INSERT INTO executions/i.test(sql)) { order.push('exec'); return [{ insertId: 1 }]; }
      if (/INSERT INTO trade_logs/i.test(sql)) return [{ insertId: 1 }];
      if (/SELECT[\s\S]*FROM orders/i.test(sql)) {
        return [[row({ id: 101, exchange_order_id: 'PS2', quantity: 10 })]];
      }
      if (/UPDATE orders/i.test(sql)) { order.push('status'); void params; return [{}]; }
      return [[]];
    });
    (getPool as jest.Mock).mockReturnValue({ query });
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue(completed({ orderId: 'PS2', qty: 4 }));

    await syncPendingOrders();
    expect(order).toEqual(['exec', 'status']);
  });

  test('부분체결 종결은 trade_logs 에 감사 기록으로 남는다', async () => {
    const cap = setupPool([row({ id: 102, exchange_order_id: 'PS3', quantity: 10, side: 'sell' })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue(completed({ orderId: 'PS3', qty: 3 }));

    await syncPendingOrders();

    const log = cap.tradeLogs.find(l => l.event === 'partial_fill_settled');
    expect(log).toBeDefined();
    expect(log!.orderId).toBe(102);
    expect(log!.payload).toMatchObject({
      exchangeOrderId: 'PS3', symbol: '005930', market: 'domestic', side: 'sell',
      orderedQty: 10, filledQty: 3, shortfallQty: 7, source: 'order-sync',
    });
  });

  test('grep 가능한 토큰으로 로그에 남는다', async () => {
    setupPool([row({ id: 103, exchange_order_id: 'PS4', quantity: 10 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue(completed({ orderId: 'PS4', qty: 3 }));

    await syncPendingOrders();
    const logged = (console.warn as jest.Mock).mock.calls.flat().join(' ');
    expect(logged).toContain('ORDER_SYNC_PARTIAL_SETTLED');
    expect(logged).toContain('005930#103');
  });

  test('감사 기록이 실패해도 상태 전이는 되돌리지 않고 errors[] 로 드러낸다', async () => {
    const cap = setupPool(
      [row({ id: 104, exchange_order_id: 'PS5', quantity: 10 })],
      { failAuditInsert: true },
    );
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue(completed({ orderId: 'PS5', qty: 3 }));

    const r = await syncPendingOrders();
    expect(cap.updates[0].sql).toMatch(/status='filled'/);
    expect(r.errors.join(' ')).toContain('partial_fill_settled audit 104');
    expect(r.partialSettlements).toHaveLength(1);
  });
});

// ── ② 정상 판정이 죽지 않는다 ────────────────────────────────────────────────

describe('정상 판정 무회귀', () => {
  test('잔량이 미체결 목록에 살아 있으면 여전히 partially_filled (executions 미기록)', async () => {
    const cap = setupPool([row({ id: 110, exchange_order_id: 'LIVE', quantity: 10 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([{ orderId: 'LIVE', symbol: '005930' }]));
    (getCompletedOrders as jest.Mock).mockResolvedValue(completed({ orderId: 'LIVE', qty: 3 }));

    const r = await syncPendingOrders();
    expect(cap.updates[0].sql).toMatch(/status='partially_filled'/);
    expect(cap.execInserts).toEqual([]);
    expect(r.partialSettlements).toEqual([]);
  });

  test('전량 체결 후 목록에서 사라짐 → 그냥 filled, executions 를 만들지 않는다', async () => {
    const cap = setupPool([row({ id: 111, exchange_order_id: 'FULL', quantity: 10 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue(completed({ orderId: 'FULL', qty: 10 }));

    const r = await syncPendingOrders();
    expect(cap.updates[0].sql).toMatch(/status='filled'/);
    expect(cap.execInserts).toEqual([]);
    expect(r.partialSettlements).toEqual([]);
    expect(r.completenessUnverified).toBe(0);
  });

  test('체결 수량이 주문 수량을 넘겨도 부분체결로 오판하지 않는다', async () => {
    const cap = setupPool([row({ id: 112, exchange_order_id: 'OVER', quantity: 10 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue(completed({ orderId: 'OVER', qty: 11 }));

    await syncPendingOrders();
    expect(cap.updates[0].sql).toMatch(/status='filled'/);
    expect(cap.execInserts).toEqual([]);
  });

  test('부동소수 오차만큼의 차이는 부분체결로 보지 않는다 (epsilon)', async () => {
    const cap = setupPool([row({ id: 113, exchange_order_id: 'EPS', quantity: 3 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue(
      completed({ orderId: 'EPS', qty: 3 - 1e-15 }),
    );

    await syncPendingOrders();
    expect(cap.updates[0].sql).toMatch(/status='filled'/);
    expect(cap.execInserts).toEqual([]);
  });

  // T-071 R-15 — 제목 정정: 이 전제는 **국내** market 에만 성립한다(해외 market 은 브로커에서 지정가 →
  // order-sync-overseas-market.test.ts). 행 생성기 기본 심볼이 국내(005930)라 단언은 그대로다.
  test('🔴 국내 market 주문에는 수량 검증을 걸지 않는다 (잔량 확인 수단이 구조적으로 없다)', async () => {
    const cap = setupPool([row({ id: 114, type: 'market', exchange_order_id: 'MKT', quantity: 10 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue(completed({ orderId: 'MKT', qty: 3 }));

    const r = await syncPendingOrders();
    expect(cap.updates[0].sql).toMatch(/status='filled'/);
    expect(cap.execInserts).toEqual([]);          // 체결 진행 중 스냅샷을 영구히 박지 않는다
    expect(r.partialSettlements).toEqual([]);
  });

  test('미체결 목록을 못 믿을 때는 종결시키지 않는다 — partially_filled 유지 (T-018 무회귀)', async () => {
    const cap = setupPool([row({ id: 115, exchange_order_id: 'UNK', quantity: 10 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(allFailed());
    (getCompletedOrders as jest.Mock).mockResolvedValue(completed({ orderId: 'UNK', qty: 3 }));

    const r = await syncPendingOrders();
    expect(cap.updates[0].sql).toMatch(/status='partially_filled'/);
    expect(cap.execInserts).toEqual([]);
    expect(r.partialSettlements).toEqual([]);
  });
});

// ── ③ 소수점 수량 — 비교 기준은 submittedQuantity (T-018 H-4 무회귀) ─────────

describe('소수점 수량 주문에서도 비교 기준은 송신 수량이다', () => {
  test('해외 5.4주(=송신 5주) 중 2주 체결 후 잔량 소멸 → 부분체결 종결', async () => {
    const cap = setupPool([row({
      id: 120, symbol: 'NAS:AAPL', exchange_order_id: 'FQ1', quantity: 5.4, price: 200, side: 'buy',
    })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue(
      completed({ orderId: 'FQ1', qty: 2, price: 201, side: 'buy' }),
    );

    const r = await syncPendingOrders();
    expect(cap.updates[0].sql).toMatch(/status='filled'/);
    expect(r.partialSettlements[0]).toMatchObject({ orderedQty: 5, filledQty: 2 });
    // T-071 R-07 (Leader 결정 1안) — 해외 executions.price 는 브로커 USD 체결가(201)가 아니라
    // orders.price(원화 기준가, 여기선 200)다. 리포트가 이 값을 원화로 읽기 때문이다. USD 원값은 감사 payload 에 남는다.
    expect(cap.execInserts[0]).toMatchObject({ orderId: 120, quantity: 2, price: 200 });
    const log = cap.tradeLogs.find(l => l.event === 'partial_fill_settled');
    expect(log!.payload).toMatchObject({ priceBasis: 'order_price_krw', brokerPriceNative: 201, brokerCurrency: 'USD' });
  });

  test('🔴 해외 1.7주가 1주 전량 체결되면 부분체결로 오판하지 않는다 (T-018 H-4)', async () => {
    const cap = setupPool([row({
      id: 121, symbol: 'NAS:AAPL', exchange_order_id: 'FQ2', quantity: 1.7, price: 200, side: 'buy',
    })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue(
      completed({ orderId: 'FQ2', qty: 1, price: 200, side: 'buy' }),
    );

    const r = await syncPendingOrders();
    expect(cap.updates[0].sql).toMatch(/status='filled'/);
    expect(cap.execInserts).toEqual([]);
    expect(r.partialSettlements).toEqual([]);
  });
});

// ── ④ 수량을 모를 때 — 조용히 넘어가지 않는다 ────────────────────────────────

describe('완결을 수량으로 검증하지 못한 경우', () => {
  test('체결 수량 파싱 실패 → 기존 동작(filled) 유지 + 집계·로그로 드러난다', async () => {
    const cap = setupPool([row({ id: 130, exchange_order_id: 'NQ', quantity: 10 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([
      { orderId: 'NQ', side: 'sell', price: 70_000, qty: Number.NaN, ts: FILL_TS },
    ]);

    const r = await syncPendingOrders();
    expect(cap.updates[0].sql).toMatch(/status='filled'/);
    expect(r.completenessUnverified).toBe(1);
    expect(r.partialSettlements).toEqual([]);
    const logged = (console.warn as jest.Mock).mock.calls.flat().join(' ');
    expect(logged).toContain('ORDER_SYNC_FILL_UNVERIFIED');
    expect(logged).toContain('fill_qty_unknown');
  });

  test('orders.quantity 가 NULL 이면 비교의 오른쪽이 없다 → 유지 + 별도 사유로 집계', async () => {
    const cap = setupPool([row({ id: 131, exchange_order_id: 'NQ2', quantity: null })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue(completed({ orderId: 'NQ2', qty: 3 }));

    const r = await syncPendingOrders();
    expect(cap.updates[0].sql).toMatch(/status='filled'/);
    expect(r.completenessUnverified).toBe(1);
    const logged = (console.warn as jest.Mock).mock.calls.flat().join(' ');
    expect(logged).toContain('ordered_qty_unknown');
  });
});

// ── ⑤ executions 기록의 제약 — 멱등·NOT NULL·실패 처리 ──────────────────────

describe('executions 기록의 제약', () => {
  test('🔴 멱등 — 이미 체결 기록이 있으면 두 번째 행을 만들지 않는다', async () => {
    const cap = setupPool(
      [row({ id: 140, exchange_order_id: 'IDEM', quantity: 10 })],
      { existingExecutions: [140] },
    );
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue(completed({ orderId: 'IDEM', qty: 3 }));

    const r = await syncPendingOrders();
    expect(cap.execInserts).toEqual([]);
    expect(r.partialSettlements[0].executionRecorded).toBe(false);
    expect(r.partialSettlements[0].note).toContain('이미 executions 행이 있어');
  });

  test('체결가를 모르면 주문의 지정가로 폴백한다', async () => {
    const cap = setupPool([row({ id: 141, exchange_order_id: 'NOPRICE', quantity: 10, price: 68_500 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue(
      completed({ orderId: 'NOPRICE', qty: 3, price: 0 }),
    );

    await syncPendingOrders();
    expect(cap.execInserts[0]).toMatchObject({ orderId: 141, quantity: 3, price: 68_500 });
  });

  test('🔴 가격을 전혀 모르면 행을 쓰지 않고 "손익이 여전히 틀리다"를 드러낸다', async () => {
    const cap = setupPool([row({ id: 142, exchange_order_id: 'NOP2', quantity: 10, price: null })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue(
      completed({ orderId: 'NOP2', qty: 3, price: 0 }),
    );

    const r = await syncPendingOrders();
    expect(cap.execInserts).toEqual([]);
    expect(r.partialSettlements[0].executionRecorded).toBe(false);
    const logged = (console.warn as jest.Mock).mock.calls.flat().join(' ');
    expect(logged).toContain('ORDER_SYNC_PARTIAL_UNRECORDED');
  });

  test('체결 시각을 모르면 executed_at 을 현재 시각으로 채운다', async () => {
    const cap = setupPool([row({ id: 143, exchange_order_id: 'NOTS', quantity: 10 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue(completed({ orderId: 'NOTS', qty: 3, ts: 0 }));

    const t0 = Date.parse('2026-08-11T16:00:00+09:00');
    jest.spyOn(Date, 'now').mockReturnValue(t0);
    await syncPendingOrders();
    expect(cap.execInserts[0].executedAt).toBeInstanceOf(Date);
  });

  test('🔴 executions 기록이 실패하면 status 를 filled 로 넘기지 않는다', async () => {
    const cap = setupPool(
      [row({ id: 144, exchange_order_id: 'FAIL', quantity: 10 })],
      { failExecutionInsert: true },
    );
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue(completed({ orderId: 'FAIL', qty: 3 }));

    const r = await syncPendingOrders();
    expect(cap.updates).toHaveLength(0);            // 상태를 안 건드렸다 = 다음 회차에 재시도
    expect(r.synced).toBe(0);
    expect(r.complete).toBe(false);                 // 이번 회차엔 판정하지 못한 것으로 센다
    expect(r.errors.join(' ')).toContain('executions insert failed (order 144)');
  });

  /**
   * §동시성 (reviewer MEDIUM-1) — SELECT-then-INSERT 는 진짜 동시 실행에 대해 원자적이지
   * 않다. `UNIQUE(order_id)` 는 Leader 가 금지했고(장래의 "체결 건별 다행" 설계를 봉쇄),
   * 락 기반 대안은 만드는 위험이 막는 위험보다 크다고 판단했다(order-sync.ts §동시성).
   * 대신 **깨졌을 때 알 수는 있어야 한다** — 그것을 여기서 고정한다.
   */
  test('🔴 경합으로 행이 2개가 되면 사후 탐지해 로그·note 로 드러낸다', async () => {
    const cap = setupPool(
      [row({ id: 146, exchange_order_id: 'RACE', quantity: 10 })],
      { duplicateCount: 2 },
    );
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue(completed({ orderId: 'RACE', qty: 3 }));

    const r = await syncPendingOrders();

    expect(cap.execInserts).toHaveLength(1);              // 우리 쪽 기록은 정상
    expect(r.partialSettlements[0].executionRecorded).toBe(true);
    expect(r.partialSettlements[0].note).toContain('executions 행이 2개다');

    const errLog = (console.error as jest.Mock).mock.calls.flat().join(' ');
    expect(errLog).toContain('ORDER_SYNC_EXEC_DUPLICATE');
    expect(errLog).toContain('order=146');
    // note 가 기록 성공 케이스에서도 로그에 실린다 (탐지기가 조용해지지 않는다)
    const warnLog = (console.warn as jest.Mock).mock.calls.flat().join(' ');
    expect(warnLog).toContain('executions 행이 2개다');
  });

  test('탐지 SELECT 가 실패해도 이미 성공한 기록·상태 전이를 되돌리지 않는다', async () => {
    const cap = setupPool(
      [row({ id: 147, exchange_order_id: 'PROBE', quantity: 10 })],
      { failDuplicateProbe: true },
    );
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue(completed({ orderId: 'PROBE', qty: 3 }));

    const r = await syncPendingOrders();
    expect(cap.updates[0].sql).toMatch(/status='filled'/);
    expect(r.partialSettlements[0]).toMatchObject({ executionRecorded: true, note: undefined });
    expect(r.complete).toBe(true);
  });

  test('정상(행 1개)일 때는 탐지 로그가 나오지 않는다', async () => {
    setupPool([row({ id: 148, exchange_order_id: 'SOLO', quantity: 10 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue(completed({ orderId: 'SOLO', qty: 3 }));

    const r = await syncPendingOrders();
    expect(r.partialSettlements[0].note).toBeUndefined();
    const errLog = (console.error as jest.Mock).mock.calls.flat().join(' ');
    expect(errLog).not.toContain('ORDER_SYNC_EXEC_DUPLICATE');
  });

  test('누적 수량 응답을 여러 행으로 받아도 최대값 행의 가격·시각을 쓴다', async () => {
    const cap = setupPool([row({ id: 145, exchange_order_id: 'CUM', quantity: 10 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    // KIS 국내 tot_ccld_qty 는 누적값 — 합치면 7 이 되어 과대평가된다
    (getCompletedOrders as jest.Mock).mockResolvedValue([
      { orderId: 'CUM', side: 'sell', price: 70_000, qty: 3, ts: FILL_TS },
      { orderId: 'CUM', side: 'sell', price: 70_500, qty: 4, ts: FILL_TS + 60_000 },
    ]);

    const r = await syncPendingOrders();
    expect(r.partialSettlements[0]).toMatchObject({ filledQty: 4, orderedQty: 10 });
    expect(cap.execInserts[0]).toMatchObject({ quantity: 4, price: 70_500 });
    expect(cap.execInserts[0].executedAt).toEqual(new Date(FILL_TS + 60_000));
  });
});

// ── ⑥ 알림 — 정상 이벤트 전제 + 키 분리 ──────────────────────────────────────

describe('알림', () => {
  test('🔴 매수/매도 알림 키가 분리돼 한쪽이 다른 쪽을 억누르지 않는다', async () => {
    setupPool([
      row({ id: 150, exchange_order_id: 'B1', side: 'buy',  quantity: 10 }),
      row({ id: 151, exchange_order_id: 'S1', side: 'sell', quantity: 10 }),
    ]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockImplementation(async () => ([
      { orderId: 'B1', side: 'buy',  price: 70_000, qty: 3, ts: FILL_TS },
      { orderId: 'S1', side: 'sell', price: 70_000, qty: 3, ts: FILL_TS },
    ]));

    await syncPendingOrders();

    const keys = (sendAlertThrottled as jest.Mock).mock.calls.map(c => c[0]);
    expect(keys).toContain('order-sync:partial-settled-buy');
    expect(keys).toContain('order-sync:partial-settled-sell');
    // 기존 T-018 알림 키를 재사용하지 않는다
    expect(keys).not.toContain('order-sync:partial-unconfirmed');
    expect(keys).not.toContain('order-sync:coverage');
  });

  test('매도 알림은 "포지션이 남아 있다"를 말하고, 정상 상황일 수 있음을 전제한다', async () => {
    setupPool([row({ id: 152, exchange_order_id: 'S2', side: 'sell', quantity: 10 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue(completed({ orderId: 'S2', qty: 3 }));

    await syncPendingOrders();

    const call = (sendAlertThrottled as jest.Mock).mock.calls
      .find(c => c[0] === 'order-sync:partial-settled-sell')!;
    expect(call[1]).toBe('warning');            // 정상 이벤트를 critical 로 울리지 않는다
    expect(call[4]).toBe(6 * 60 * 60_000);
    const body = call[3] as string;
    expect(body).toContain('장 마감');
    expect(body).toContain('정상');
    expect(body).toContain('포지션이 남아 있습니다');
    expect(body).toContain('005930#152');
  });

  test('부분체결 종결이 없으면 알림도 로그도 나가지 않는다', async () => {
    setupPool([row({ id: 153, exchange_order_id: 'CLEAN', quantity: 10 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue(completed({ orderId: 'CLEAN', qty: 10 }));

    await syncPendingOrders();
    const keys = (sendAlertThrottled as jest.Mock).mock.calls.map(c => c[0]);
    expect(keys).not.toContain('order-sync:partial-settled-buy');
    expect(keys).not.toContain('order-sync:partial-settled-sell');
    const logged = (console.warn as jest.Mock).mock.calls.flat().join(' ');
    expect(logged).not.toContain('ORDER_SYNC_PARTIAL_SETTLED');
  });
});
