import { getPool } from '@/lib/db';
import { kis } from '@/lib/exchanges/kis';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { AWAITING_APPROVAL_STATUSES, sqlStatusList } from '@/lib/signals/statuses';

export const dynamic = 'force-dynamic';

export async function GET() {
  const pool = getPool();
  try {
    const [rows] = await pool.query<RowDataPacket[]>(`
      SELECT
        f.id, f.symbol, f.name, f.memo, f.sort_order, f.added_at,
        COALESCE(m.market, 'domestic') AS market,
        fu.pbr, fu.per, fu.eps, fu.market_cap_bn, fu.dividend_yield, fu.roe,
        fu.key_factors, fu.ai_summary, fu.data_source, fu.updated_at AS fundamentals_updated_at
      FROM stock_favorites f
      LEFT JOIN stock_meta m ON m.symbol = f.symbol
      LEFT JOIN stock_fundamentals fu ON fu.symbol = f.symbol
      ORDER BY f.sort_order ASC, f.added_at DESC
    `);

    // 활성 시그널 조회 (심볼별 최신 1건)
    const symbols = rows.map(r => r.symbol as string);
    const signalMap = new Map<string, { id: number; side: string; status: string; created_at: string }>();
    if (symbols.length > 0) {
      try {
        const [sigRows] = await pool.query<RowDataPacket[]>(
          `SELECT symbol, id, side, status, created_at
           FROM signals
           WHERE symbol IN (?)
             AND status IN (${sqlStatusList([...AWAITING_APPROVAL_STATUSES, 'detected', 'approved', 'approved_pending_entry'])})
             AND (expires_at IS NULL OR expires_at > NOW())
           ORDER BY created_at DESC`,
          [symbols],
        );
        for (const s of sigRows) {
          if (!signalMap.has(s.symbol as string)) {
            signalMap.set(s.symbol as string, {
              id: s.id as number,
              side: s.side as string,
              status: s.status as string,
              created_at: s.created_at as string,
            });
          }
        }
      } catch { /* 시그널 조회 실패 시 무시 */ }
    }

    // 실시간 가격 조회 (병렬)
    const withPrices = await Promise.all(
      rows.map(async (row) => {
        try {
          const ticker = await kis.getTicker(row.symbol as string);
          const changeRate = ticker.open24h != null && ticker.open24h > 0
            ? ((ticker.price - ticker.open24h) / ticker.open24h) * 100
            : null;
          return {
            ...row,
            price: ticker.price,
            priceUsd: ticker.priceUsd ?? null,
            changeRate,
            volume: ticker.volume24h ?? null,
            latestSignal: signalMap.get(row.symbol as string) ?? null,
          };
        } catch {
          return {
            ...row,
            price: null,
            priceUsd: null,
            changeRate: null,
            volume: null,
            priceError: true,
            latestSignal: signalMap.get(row.symbol as string) ?? null,
          };
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
