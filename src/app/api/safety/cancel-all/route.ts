import { NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { kis } from '@/lib/exchanges/kis';

// POST /api/safety/cancel-all
// Cancels all pending/accepted orders. Acts as emergency liquidation trigger.
export async function POST() {
  const pool = getPool();

  interface ActiveRow extends RowDataPacket {
    id: number; exchange_order_id: string; symbol: string; side: string;
  }
  const [rows] = await pool.query<ActiveRow[]>(
    `SELECT id, exchange_order_id, symbol, side
     FROM orders
     WHERE status IN ('pending', 'accepted') AND exchange_order_id IS NOT NULL`,
  );

  const results: { id: number; ok: boolean; error?: string }[] = [];

  for (const row of rows) {
    try {
      await kis.cancelOrder({ symbol: row.symbol, exchangeOrderId: row.exchange_order_id });
      await pool.query(
        `UPDATE orders SET status='cancelled', updated_at=NOW() WHERE id=?`,
        [row.id],
      );
      await pool.query(
        `INSERT INTO trade_logs (order_id, event, payload, occurred_at)
         VALUES (?, 'cancelled', JSON_OBJECT('reason','emergency_cancel_all'), NOW())`,
        [row.id],
      );
      results.push({ id: row.id, ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await pool.query(
        `INSERT INTO trade_logs (order_id, event, payload, occurred_at)
         VALUES (?, 'cancel_failed', JSON_OBJECT('reason','emergency_cancel_all','error',?), NOW())`,
        [row.id, msg],
      );
      results.push({ id: row.id, ok: false, error: msg });
    }
  }

  const cancelled = results.filter(r => r.ok).length;
  const failed    = results.filter(r => !r.ok).length;

  return NextResponse.json({ ok: true, cancelled, failed, results });
}
