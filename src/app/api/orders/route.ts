import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { kis } from '@/lib/exchanges/kis';
import { getMarketFromSymbol } from '@/lib/exchanges/kis-symbols';
import type { OrderRequest } from '@/lib/exchanges/types';
import { submitOrder } from '@/lib/safety/dry-run';
import { sizeOrderQuantity } from '@/lib/signals/service';

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

    // 클라이언트가 보낸 quantity를 그대로 신뢰하지 않는다 — 소수점이 들어오면 T-020이
    // entry-watcher/service.ts 두 엔진 경로에서 없앤 문제(소수점 주문 → KIS가 조용히 축소집행
    // 하거나 절삭돼 0주가 되는 문제)가 이 수동 주문 경로로 재현될 수 있었다. 같은 정수화
    // 로직(sizeOrderQuantity)을 여기서도 통과시켜 API 스스로를 방어한다.
    const market = getMarketFromSymbol(body.symbol);
    const sized = sizeOrderQuantity({
      market,
      orderType: body.type,
      requestedQuantity: body.quantity,
      amountKRW: body.amountKRW ?? 0,
      price: body.price,
    });

    const orderReq: OrderRequest = {
      exchange: 'kis',
      symbol: body.symbol,
      side: body.side,
      type: body.type,
      price: body.price,
      quantity: sized.quantity ?? body.quantity,
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
