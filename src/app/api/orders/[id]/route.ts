import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { kis } from '@/lib/exchanges/kis';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = Number((await params).id);
    if (!Number.isFinite(id)) return Response.json({ ok: false, error: 'invalid id' }, { status: 400 });

    const pool = getPool();
    const [orders] = await pool.query<RowDataPacket[]>('SELECT * FROM orders WHERE id=? LIMIT 1', [id]);
    const order = orders[0];
    if (!order) return Response.json({ ok: false, error: 'not found' }, { status: 404 });

    const [executions] = await pool.query<RowDataPacket[]>(
      'SELECT id, price, quantity, fee, executed_at FROM executions WHERE order_id=? ORDER BY executed_at ASC',
      [id],
    );
    const [logs] = await pool.query<RowDataPacket[]>(
      'SELECT id, event, payload, occurred_at FROM trade_logs WHERE order_id=? ORDER BY occurred_at ASC',
      [id],
    );

    return Response.json({ ok: true, data: { order, executions, logs } });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/orders GET :id]', error);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = Number((await params).id);
    if (!Number.isFinite(id)) return Response.json({ ok: false, error: 'invalid id' }, { status: 400 });

    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT id, exchange_order_id, symbol, status FROM orders WHERE id=? LIMIT 1',
      [id],
    );
    const order = rows[0];
    if (!order) return Response.json({ ok: false, error: 'not found' }, { status: 404 });
    if (!order.exchange_order_id) {
      return Response.json({ ok: false, error: 'no exchange_order_id (likely dry_run or blocked)' }, { status: 400 });
    }
    if (['cancelled', 'filled', 'rejected', 'failed'].includes(String(order.status))) {
      return Response.json({ ok: false, error: `cannot cancel order in status ${order.status}` }, { status: 400 });
    }

    const result = await kis.cancelOrder({
      exchangeOrderId: String(order.exchange_order_id),
      symbol: String(order.symbol),
    });

    if (result.ok) {
      await pool.query(`UPDATE orders SET status='cancelled' WHERE id=?`, [id]);
      await pool.query(
        `INSERT INTO trade_logs (order_id, event, payload) VALUES (?, 'cancelled', ?)`,
        [id, JSON.stringify(result)],
      );
    } else {
      await pool.query(
        `INSERT INTO trade_logs (order_id, event, payload) VALUES (?, 'cancel_failed', ?)`,
        [id, JSON.stringify(result)],
      );
    }
    return Response.json({ ok: result.ok, data: result });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/orders DELETE]', error);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
