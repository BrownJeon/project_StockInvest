import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { isAnalystEnabled } from '@/lib/signals/router';
import { createSignal } from '@/lib/signals/service';
import { getMarketFromSymbol } from '@/lib/exchanges/kis-symbols';
import { isDomesticOpen, isOverseasOpen } from '@/lib/strategy/market-hours';

export const dynamic = 'force-dynamic';

interface CreateBody {
  strategyId?: string;
  symbol: string;
  side: 'buy' | 'sell';
  orderType: 'limit' | 'market';
  price?: number;
  quantity?: number;
  amountKRW: number;
  reasoning?: string;
  indicators?: unknown;
  expiresAt?: string;
}

export async function POST(req: Request) {
  try {
    if (!(await isAnalystEnabled())) {
      return Response.json({ ok: false, error: 'ANALYST_ENABLED=false' }, { status: 403 });
    }
    const body = (await req.json()) as CreateBody;
    if (!body.symbol || !body.side || !body.orderType || !body.amountKRW) {
      return Response.json(
        { ok: false, error: 'symbol/side/orderType/amountKRW required' },
        { status: 400 },
      );
    }
    // 시장별 개장 가드 — 폐장 시 시그널 생성 차단
    const symMarket = getMarketFromSymbol(body.symbol);
    const open = symMarket === 'overseas' ? await isOverseasOpen() : await isDomesticOpen();
    if (!open) {
      return Response.json(
        { ok: false, error: `${symMarket}_market_closed` },
        { status: 409 },
      );
    }
    const result = await createSignal({
      strategyId: body.strategyId,
      symbol: body.symbol,
      side: body.side,
      orderType: body.orderType,
      price: body.price,
      quantity: body.quantity,
      amountKRW: body.amountKRW,
      reasoning: body.reasoning,
      indicators: body.indicators,
      expiresAt: body.expiresAt,
    });
    return Response.json({ ok: result.ok, data: result }, { status: result.ok ? 200 : 400 });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/signals POST]', error);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '50'), 1), 1000);
    const symbol = url.searchParams.get('symbol');
    const status = url.searchParams.get('status');
    const since  = url.searchParams.get('since'); // ISO datetime or epoch ms
    const consumedOrderId = url.searchParams.get('consumedOrderId');

    const scenarioSource = url.searchParams.get('scenarioSource');

    const where: string[] = [];
    const params: unknown[] = [];
    if (symbol) { where.push('symbol = ?'); params.push(symbol); }
    if (consumedOrderId) { where.push('consumed_order_id = ?'); params.push(Number(consumedOrderId)); }
    if (scenarioSource) { where.push('scenario_source = ?'); params.push(scenarioSource); }
    if (since) {
      const d = new Date(isNaN(Number(since)) ? since : Number(since));
      if (!isNaN(d.getTime())) { where.push('created_at >= ?'); params.push(d); }
    }
    if (status) {
      const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
      if (statuses.length === 1) {
        where.push('status = ?'); params.push(statuses[0]);
      } else if (statuses.length > 1) {
        where.push(`status IN (${statuses.map(() => '?').join(',')})`);
        params.push(...statuses);
      }
      // 만료 시각이 지난 시그널은 cron 처리 여부와 무관하게 제외
      where.push('(expires_at IS NULL OR expires_at >= NOW())');
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, strategy_id, symbol, side, order_type, price, quantity, amount_krw,
              reasoning, indicators, status, expires_at, valid_from, scenario_source,
              consumed_order_id, created_at, updated_at
       FROM signals
       ${whereSql}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      [...params, limit],
    );
    return Response.json({ ok: true, data: rows });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/signals GET]', error);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
