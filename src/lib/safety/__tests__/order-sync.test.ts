import { getPool } from '@/lib/db';
import { getActiveOrders, getCompletedOrders } from '@/lib/exchanges/kis';
import { syncPendingOrders } from '../order-sync';

jest.mock('@/lib/db', () => ({
  getPool: jest.fn(),
}));

jest.mock('@/lib/exchanges/kis', () => ({
  getActiveOrders: jest.fn(),
  getCompletedOrders: jest.fn(),
}));

interface PendingRow {
  id: number;
  exchange_order_id: string;
  symbol: string;
  type: 'limit' | 'market';
  created_at: Date;
}

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

describe('syncPendingOrders', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('active에 있음 → 변경 없음 (limit 미체결)', async () => {
    const rows: PendingRow[] = [{
      id: 1, exchange_order_id: 'O001', symbol: '005930', type: 'limit',
      created_at: new Date(),
    }];
    const { updates } = setupPool(rows);
    (getActiveOrders as jest.Mock).mockResolvedValue([{ orderId: 'O001', symbol: '005930' }]);
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);

    const r = await syncPendingOrders();
    expect(r.synced).toBe(0);
    expect(updates).toHaveLength(0);
  });

  test('completed에 있음 → filled로 마킹', async () => {
    const rows: PendingRow[] = [{
      id: 2, exchange_order_id: 'O002', symbol: '005930', type: 'limit',
      created_at: new Date(),
    }];
    const { updates } = setupPool(rows);
    (getActiveOrders as jest.Mock).mockResolvedValue([]);
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
      created_at: new Date(),
    }];
    const { updates } = setupPool(rows);
    // completed에 다른 주문은 있지만 O003은 없음 — stub 가드 우회
    (getActiveOrders as jest.Mock).mockResolvedValue([{ orderId: 'OTHER', symbol: '005930' }]);
    (getCompletedOrders as jest.Mock).mockResolvedValue([
      { orderId: 'OTHER2', side: 'buy', price: 1000, qty: 1, ts: Date.now() },
    ]);

    const r = await syncPendingOrders();
    expect(r.synced).toBe(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toMatch(/SET status='cancelled'/);
    expect(updates[0].params).toEqual([3]);
  });

  test('market 주문은 active 없어도 cancelled 마킹 안 함 (체결 대기)', async () => {
    const rows: PendingRow[] = [{
      id: 4, exchange_order_id: 'O004', symbol: '005930', type: 'market',
      created_at: new Date(),
    }];
    const { updates } = setupPool(rows);
    (getActiveOrders as jest.Mock).mockResolvedValue([{ orderId: 'OTHER', symbol: '005930' }]);
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);

    const r = await syncPendingOrders();
    expect(r.synced).toBe(0);
    expect(updates).toHaveLength(0);
  });
});
