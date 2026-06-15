import { getPool } from '@/lib/db';
import { kis } from '@/lib/exchanges/kis';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export const dynamic = 'force-dynamic';

export async function GET() {
  const pool = getPool();
  try {
    const [rows] = await pool.query<RowDataPacket[]>(`
      SELECT
        f.id, f.symbol, f.name, f.memo, f.sort_order, f.added_at,
        fu.pbr, fu.per, fu.eps, fu.market_cap_bn, fu.dividend_yield, fu.roe,
        fu.key_factors, fu.ai_summary, fu.data_source, fu.updated_at AS fundamentals_updated_at
      FROM stock_favorites f
      LEFT JOIN stock_fundamentals fu ON fu.symbol = f.symbol
      ORDER BY f.sort_order ASC, f.added_at DESC
    `);

    // 실시간 가격 조회 (병렬)
    const withPrices = await Promise.all(
      rows.map(async (row) => {
        try {
          const ticker = await kis.getTicker(row.symbol as string);
          const changeRate = ticker.open24h && ticker.open24h > 0
            ? ((ticker.price - ticker.open24h) / ticker.open24h) * 100
            : null;
          return {
            ...row,
            price: ticker.price,
            changeRate,
            volume: ticker.volume24h ?? null,
          };
        } catch {
          return { ...row, price: null, changeRate: null, volume: null };
        }
      }),
    );

    return Response.json({ ok: true, data: withPrices });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/favorites GET]', error);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const pool = getPool();
  try {
    const body = await req.json();
    const { symbol, memo } = body as { symbol: string; memo?: string };
    if (!symbol) return Response.json({ ok: false, error: 'symbol required' }, { status: 400 });

    // 종목명 조회 (stock_meta 캐시 우선)
    const [metaRows] = await pool.query<RowDataPacket[]>(
      'SELECT name FROM stock_meta WHERE symbol = ? LIMIT 1',
      [symbol],
    );
    const name = (metaRows[0]?.name as string) ?? null;

    await pool.query(
      'INSERT INTO stock_favorites (symbol, name, memo) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE memo = VALUES(memo)',
      [symbol, name, memo ?? null],
    );

    return Response.json({ ok: true });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/favorites POST]', error);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const pool = getPool();
  try {
    const url = new URL(req.url);
    const symbol = url.searchParams.get('symbol');
    if (!symbol) return Response.json({ ok: false, error: 'symbol required' }, { status: 400 });

    const [result] = await pool.query<ResultSetHeader>(
      'DELETE FROM stock_favorites WHERE symbol = ?',
      [symbol],
    );
    if (result.affectedRows === 0) {
      return Response.json({ ok: false, error: 'not found' }, { status: 404 });
    }
    return Response.json({ ok: true });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/favorites DELETE]', error);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
