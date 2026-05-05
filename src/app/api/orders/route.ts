import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { kis } from '@/lib/exchanges/kis';
import type { OrderRequest } from '@/lib/exchanges/types';
import { submitOrder } from '@/lib/safety/dry-run';

export const dynamic = 'force-dynamic';

interface CreateBody {
  symbol: string;
  side: 'buy' | 'sell';
  type: 'limit' | 'market';
  price?: number;
  quantity?: number;
  amountKRW?: number;
  clientOrderId?: string;
  source?: 'manual' | 'signal' | 'auto';
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as CreateBody;

    if (!body.symbol || !body.side || !body.type) {
      return Response.json({ ok: false, error: 'symbol/side/type required' }, { status: 400 });
    }

    const orderReq: OrderRequest = {
      exchange: 'kis',
      symbol: body.symbol,
      side: body.side,
      type: body.type,
      price: body.price,
      quantity: body.quantity,
      amountKRW: body.amountKRW,
      clientOrderId: body.clientOrderId,
    };

    const result = await submitOrder(orderReq, kis.createOrder, {
      assetClass: 'stock',
      source: body.source ?? 'manual',
      clientOrderId: body.clientOrderId,
    });

    return Response.json({ ok: result.ok, data: result }, { status: result.ok ? 200 : 400 });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/orders POST]', error);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '50'), 1), 200);
    const symbol = url.searchParams.get('symbol');
    const status = url.searchParams.get('status');

    const where: string[] = [];
    const params: unknown[] = [];
    if (symbol) { where.push('symbol = ?'); params.push(symbol); }
    if (status) { where.push('status = ?'); params.push(status); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, account_id, client_order_id, exchange_order_id, asset_class,
              symbol, side, type, price, quantity, amount_krw,
              status, blocked_by, source, market, created_at, updated_at
       FROM orders
       ${whereSql}
       ORDER BY created_at DESC
       LIMIT ?`,
      [...params, limit],
    );
    return Response.json({ ok: true, data: rows });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/orders GET]', error);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
