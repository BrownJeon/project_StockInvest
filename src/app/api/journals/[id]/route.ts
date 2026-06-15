import { getPool } from '@/lib/db';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const pool = getPool();
  const id = Number(params.id);
  try {
    const [[journal]] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM trade_journals WHERE id = ? LIMIT 1',
      [id],
    );
    if (!journal) return Response.json({ ok: false, error: 'not found' }, { status: 404 });

    const [entries] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM trade_journal_entries WHERE journal_id = ? ORDER BY created_at ASC',
      [id],
    );

    return Response.json({ ok: true, data: { ...journal, entries } });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}

// 상태·가격 업데이트 (watching→active→closed)
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const pool = getPool();
  const id = Number(params.id);
  try {
    const body = await req.json() as {
      status?: 'watching' | 'active' | 'closed';
      entry_price?: number;
      entry_qty?: number;
      exit_price?: number;
      pnl_pct?: number;
    };

    const sets: string[] = [];
    const vals: unknown[] = [];

    if (body.status !== undefined) {
      sets.push('status = ?');
      vals.push(body.status);
      if (body.status === 'closed') { sets.push('closed_at = NOW()'); }
    }
    if (body.entry_price !== undefined) { sets.push('entry_price = ?'); vals.push(body.entry_price); }
    if (body.entry_qty !== undefined)   { sets.push('entry_qty = ?');   vals.push(body.entry_qty); }
    if (body.exit_price !== undefined)  { sets.push('exit_price = ?');  vals.push(body.exit_price); }
    if (body.pnl_pct !== undefined)     { sets.push('pnl_pct = ?');     vals.push(body.pnl_pct); }

    if (sets.length === 0) return Response.json({ ok: false, error: 'nothing to update' }, { status: 400 });
    vals.push(id);

    await pool.query(`UPDATE trade_journals SET ${sets.join(', ')} WHERE id = ?`, vals);
    return Response.json({ ok: true });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const pool = getPool();
  const id = Number(params.id);
  try {
    const [result] = await pool.query<ResultSetHeader>(
      'DELETE FROM trade_journals WHERE id = ?',
      [id],
    );
    if (result.affectedRows === 0) return Response.json({ ok: false, error: 'not found' }, { status: 404 });
    return Response.json({ ok: true });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
