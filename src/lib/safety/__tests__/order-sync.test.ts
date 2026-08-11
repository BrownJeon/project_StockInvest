import { getPool } from '@/lib/db';
import { getActiveOrdersDetailed, getCompletedOrders } from '@/lib/exchanges/kis';
import { syncPendingOrders, resetUnreconciledTracker } from '../order-sync';

jest.mock('@/lib/db', () => ({
  getPool: jest.fn(),
}));

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
  type: 'limit' | 'market';
  status: string;
  quantity: number | null;
  created_at: Date;
}

/** 유예 기간(기본 120초)을 이미 지난 주문 — 취소 판정 대상이 되려면 필요하다 */
const AGED = () => new Date(Date.now() - 10 * 60_000);

function setupPool(rows: PendingRow[]) {
  const updates: Array<{ sql: string; params: unknown[] }> = [];
  const query = jest.fn(async (sqlArg: unknown, paramsArg: unknown[] = []) => {
    const sql = String(sqlArg);
    const params = paramsArg ?? [];
    if (/SELECT[\s\S]*FROM orders/i.test(sql)) {
      return [rows];
    }
    if (/UPDATE orders/i.test(sql)) {
      updates.push({ sql, params });
      return [{}];
    }
    return [[]];
  });
  (getPool as jest.Mock).mockReturnValue({ query });
  return { updates };
}

/** 양 시장 모두 조회 성공 — 부재 추론을 해도 되는 상태 */
const activeOk = (orders: { orderId: string; symbol: string }[]) => ({
  orders, ok: ['domestic', 'overseas'], failed: [], complete: true,
});

describe('syncPendingOrders', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetUnreconciledTracker();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { jest.restoreAllMocks(); });

  test('active에 있음 → 변경 없음 (limit 미체결)', async () => {
    const rows: PendingRow[] = [{
      id: 1, exchange_order_id: 'O001', symbol: '005930', type: 'limit',
      status: 'accepted', quantity: 1, created_at: AGED(),
    }];
    const { updates } = setupPool(rows);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(activeOk([{ orderId: 'O001', symbol: '005930' }]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);

    const r = await syncPendingOrders();
    expect(r.synced).toBe(0);
    expect(updates).toHaveLength(0);
    // 변경이 없는 것과 판정하지 못한 것은 다르다 — 이건 정상 판정된 결과다.
    expect(r.complete).toBe(true);
    expect(r.skipped).toBe(0);
  });

  test('completed에 있음 → filled로 마킹', async () => {
    const rows: PendingRow[] = [{
      id: 2, exchange_order_id: 'O002', symbol: '005930', type: 'limit',
      status: 'accepted', quantity: 1, created_at: AGED(),
    }];
    const { updates } = setupPool(rows);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(activeOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([
      { orderId: 'O002', side: 'buy', price: 75000, qty: 1, ts: Date.now() },
    ]);

    const r = await syncPendingOrders();
    expect(r.synced).toBe(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toMatch(/SET status='filled'/);
    expect(updates[0].params).toEqual([2]);
  });

  test('active·completed 모두 없음 + limit → cancelled 마킹', async () => {
    const rows: PendingRow[] = [{
      id: 3, exchange_order_id: 'O003', symbol: '005930', type: 'limit',
      status: 'accepted', quantity: 1, created_at: AGED(),
    }];
    const { updates } = setupPool(rows);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(activeOk([{ orderId: 'OTHER', symbol: '005930' }]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([
      { orderId: 'OTHER2', side: 'buy', price: 1000, qty: 1, ts: Date.now() },
    ]);

    const r = await syncPendingOrders();
    expect(r.synced).toBe(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toMatch(/SET status='cancelled'/);
    expect(updates[0].params).toEqual([3]);
    expect(r.complete).toBe(true);
  });

  test('market 주문은 active 없어도 cancelled 마킹 안 함 (체결 대기)', async () => {
    const rows: PendingRow[] = [{
      id: 4, exchange_order_id: 'O004', symbol: '005930', type: 'market',
      status: 'accepted', quantity: 1, created_at: AGED(),
    }];
    const { updates } = setupPool(rows);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(activeOk([{ orderId: 'OTHER', symbol: '005930' }]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);

    const r = await syncPendingOrders();
    expect(r.synced).toBe(0);
    expect(updates).toHaveLength(0);
    // 조회가 성공했으므로 "아직 체결 전"은 **판정된** 상태다 — 보류가 아니다.
    expect(r.complete).toBe(true);
    expect(r.skipped).toBe(0);
  });

  test('미결 주문이 없으면 KIS를 조회하지 않고 "할 일 없음"을 반환', async () => {
    setupPool([]);
    const r = await syncPendingOrders();
    expect(getActiveOrdersDetailed).not.toHaveBeenCalled();
    expect(r).toMatchObject({ synced: 0, skipped: 0, complete: true, staleCount: 0 });
    expect(r.unreconciled).toEqual([]);
  });
});
