import { getPool } from '@/lib/db';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const pool = getPool();
  try {
    const url = new URL(req.url);
    const symbol = url.searchParams.get('symbol');
    const type = url.searchParams.get('type');
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 200);

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (symbol) { conditions.push('symbol = ?'); params.push(symbol); }
    if (type && type !== 'all') { conditions.push('type = ?'); params.push(type); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit);

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, symbol, type, title, content, price_at, signal_id, created_at, updated_at
       FROM trade_notes ${where} ORDER BY created_at DESC LIMIT ?`,
      params,
    );

    return Response.json({ ok: true, data: rows });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const pool = getPool();
  try {
    const body = await req.json() as {
      symbol: string;
      type?: string;
      title?: string;
      content: string;
      price_at?: number;
      signal_id?: number;
    };

    if (!body.symbol) return Response.json({ ok: false, error: 'symbol required' }, { status: 400 });
    if (!body.content?.trim()) return Response.json({ ok: false, error: 'content required' }, { status: 400 });

    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO trade_notes (symbol, type, title, content, price_at, signal_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        body.symbol,
        body.type ?? 'general',
        body.title ?? null,
        body.content.trim(),
        body.price_at ?? null,
        body.signal_id ?? null,
      ],
    );

    return Response.json({ ok: true, id: result.insertId });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
