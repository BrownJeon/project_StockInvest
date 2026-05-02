import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { getActiveOrders, getCompletedOrders } from '@/lib/exchanges/kis';

interface PendingOrder extends RowDataPacket {
  id: number;
  exchange_order_id: string | null;
  symbol: string;
  type: string;
  created_at: Date;
}

/**
 * DB에서 accepted/pending/partially_filled 상태 주문을 조회해
 * KIS API와 대조 후 filled/cancelled로 업데이트한다.
 *
 * 2026-04-28: KIS 국내·해외 어댑터의 getActiveOrders/getCompletedOrders 정상 구현됨.
 * Phase I 완료 — 이전 stub 가드 제거하고 정상 sync 동작.
 */
export async function syncPendingOrders(): Promise<{ synced: number; errors: string[] }> {
  const pool = getPool();
  const [rows] = await pool.query<PendingOrder[]>(
    `SELECT id, exchange_order_id, symbol, type, created_at
     FROM orders
     WHERE status IN ('pending','accepted','partially_filled')
       AND exchange_order_id IS NOT NULL`,
  );

  if (rows.length === 0) return { synced: 0, errors: [] };

  let synced = 0;
  const errors: string[] = [];

  // 미체결 주문 목록 (limit/stop_limit만 여기 있음)
  let activeOrderIds: Set<string>;
  try {
    const active = await getActiveOrders();
    activeOrderIds = new Set(active.map(o => o.orderId));
  } catch (e) {
    return { synced: 0, errors: [`active_orders fetch failed: ${e}`] };
  }

  // 심볼별로 묶어서 completed_orders 조회
  const bySymbol = new Map<string, PendingOrder[]>();
  for (const row of rows) {
    const sym = row.symbol;
    if (!bySymbol.has(sym)) bySymbol.set(sym, []);
    bySymbol.get(sym)!.push(row);
  }

  for (const [symbol, orders] of bySymbol) {
    // 가장 오래된 주문 기준으로 from_ts 계산 (1분 여유)
    const fromTs = Math.min(...orders.map(o => new Date(o.created_at).getTime())) - 60_000;
    const toTs = Date.now() + 5_000;

    let completedOrderIds: Set<string>;
    try {
      const completed = await getCompletedOrders(symbol, fromTs, toTs, 100);
      completedOrderIds = new Set(completed.map(o => o.orderId));
    } catch (e) {
      errors.push(`completed_orders ${symbol}: ${e}`);
      completedOrderIds = new Set();
    }

    for (const order of orders) {
      const eid = order.exchange_order_id!;
      try {
        if (completedOrderIds.has(eid)) {
          // 체결 완료
          await pool.query(`UPDATE orders SET status='filled' WHERE id=?`, [order.id]);
          synced++;
        } else if (order.type !== 'market' && !activeOrderIds.has(eid)) {
          // 미체결 목록에도 없고 체결 목록에도 없으면 취소됨
          await pool.query(`UPDATE orders SET status='cancelled' WHERE id=?`, [order.id]);
          synced++;
        } else if (order.type === 'market') {
          // market 주문은 active_orders에 나타나지 않으므로 completed에 없으면 잠시 대기
          // (보통 즉시 체결되므로 다음 sync 주기에 completed에 나타남)
        }
      } catch (e) {
        errors.push(`order ${order.id}: ${e}`);
      }
    }
  }

  return { synced, errors };
}
