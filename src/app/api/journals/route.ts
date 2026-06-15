import { getPool } from '@/lib/db';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const pool = getPool();
  try {
    const url = new URL(req.url);
    const status = url.searchParams.get('status'); // watching | active | closed | all

    const where = status && status !== 'all' ? 'WHERE j.status = ?' : '';
    const params = status && status !== 'all' ? [status] : [];

    const [rows] = await pool.query<RowDataPacket[]>(`
      SELECT
        j.id, j.symbol, j.name, j.status,
        j.entry_price, j.entry_qty, j.exit_price, j.pnl_pct,
        j.created_at, j.closed_at,
        COUNT(e.id) AS entry_count,
        MAX(e.created_at) AS last_entry_at,
        (SELECT e2.content FROM trade_journal_entries e2
         WHERE e2.journal_id = j.id
         ORDER BY e2.created_at DESC LIMIT 1) AS last_content,
        (SELECT e2.phase FROM trade_journal_entries e2
         WHERE e2.journal_id = j.id
         ORDER BY e2.created_at DESC LIMIT 1) AS last_phase
      FROM trade_journals j
      LEFT JOIN trade_journal_entries e ON e.journal_id = j.id
      ${where}
      GROUP BY j.id
      ORDER BY j.created_at DESC
    `, params);

    return Response.json({ ok: true, data: rows });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const pool = getPool();
  try {
    const body = await req.json() as { symbol: string; name?: string };
    if (!body.symbol) return Response.json({ ok: false, error: 'symbol required' }, { status: 400 });

    // 종목명 자동 조회
    const [metaRows] = await pool.query<RowDataPacket[]>(
      'SELECT name FROM stock_meta WHERE symbol = ? LIMIT 1',
      [body.symbol],
    );
    const name = body.name ?? (metaRows[0]?.name as string) ?? null;

    const [result] = await pool.query<ResultSetHeader>(
      'INSERT INTO trade_journals (symbol, name) VALUES (?, ?)',
      [body.symbol, name],
    );

    return Response.json({ ok: true, id: result.insertId });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
