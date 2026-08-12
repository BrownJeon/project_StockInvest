import { getPool } from '@/lib/db';
import {
  STRUCTURAL_MS, getStaleTracking, recordFirstStale, markEscalated, clearResolved,
  listStaleTracking,
} from '../order-sync-escalation';

jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));

function mockPool() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const rows: Record<string, unknown>[] = [];
  const query = jest.fn(async (sqlArg: unknown, paramsArg: unknown[] = []) => {
    calls.push({ sql: String(sqlArg), params: paramsArg ?? [] });
    if (/^SELECT/i.test(String(sqlArg))) return [rows];
    return [{}];
  });
  (getPool as jest.Mock).mockReturnValue({ query });
  return { calls, rows };
}

describe('order-sync-escalation', () => {
  beforeEach(() => jest.clearAllMocks());

  test('STRUCTURAL_MS는 2시간이다', () => {
    expect(STRUCTURAL_MS).toBe(2 * 60 * 60_000);
  });

  test('getStaleTracking: 빈 배열이면 쿼리 없이 빈 Map 반환', async () => {
    const { calls } = mockPool();
    const result = await getStaleTracking([]);
    expect(result.size).toBe(0);
    expect(calls).toHaveLength(0);
  });

  test('getStaleTracking: 행을 Map으로 변환한다', async () => {
    const { rows } = mockPool();
    rows.push({
      order_id: 42, symbol: '005930',
      first_stale_at: new Date('2026-08-12T00:00:00Z'),
      escalated_at: null,
    });
    const result = await getStaleTracking([42]);
    expect(result.get(42)).toEqual({
      orderId: 42, symbol: '005930',
      firstStaleAt: new Date('2026-08-12T00:00:00Z').getTime(),
      escalatedAt: null,
    });
  });

  test('recordFirstStale: INSERT IGNORE로 쓴다', async () => {
    const { calls } = mockPool();
    await recordFirstStale(7, '000660', 1_700_000_000_000);
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toMatch(/INSERT IGNORE INTO order_sync_stale_tracking/i);
    expect(calls[0].params).toEqual([7, '000660', new Date(1_700_000_000_000)]);
  });

  test('markEscalated: escalated_at을 UPDATE한다', async () => {
    const { calls } = mockPool();
    await markEscalated(7, 1_700_000_100_000);
    expect(calls[0].sql).toMatch(/UPDATE order_sync_stale_tracking SET escalated_at/i);
    expect(calls[0].params).toEqual([new Date(1_700_000_100_000), 7]);
  });

  test('clearResolved: 남은 id가 있으면 NOT IN으로 나머지를 지운다', async () => {
    const { calls } = mockPool();
    await clearResolved([1, 2]);
    expect(calls[0].sql).toMatch(/DELETE FROM order_sync_stale_tracking WHERE order_id NOT IN/i);
    expect(calls[0].params).toEqual([[1, 2]]);
  });

  test('clearResolved: 빈 배열이면 전체 삭제한다', async () => {
    const { calls } = mockPool();
    await clearResolved([]);
    expect(calls[0].sql).toMatch(/^DELETE FROM order_sync_stale_tracking\s*$/i);
  });

  test('listStaleTracking: 전체 조회 결과를 반환한다', async () => {
    const { rows } = mockPool();
    rows.push({
      order_id: 1, symbol: '005930',
      first_stale_at: new Date('2026-08-12T00:00:00Z'), escalated_at: null,
    });
    const result = await listStaleTracking();
    expect(result).toHaveLength(1);
    expect(result[0].orderId).toBe(1);
  });
});
