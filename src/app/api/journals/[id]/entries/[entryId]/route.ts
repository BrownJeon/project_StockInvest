import { getPool } from '@/lib/db';
import type { ResultSetHeader } from 'mysql2';

export const dynamic = 'force-dynamic';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const pool = getPool();
  const { id, entryId: entryIdParam } = await params;
  const entryId = Number(entryIdParam);
  const journalId = Number(id);
  try {
    const body = await req.json() as { content?: string; phase?: string };
    const sets: string[] = [];
    const vals: unknown[] = [];

    if (body.content !== undefined) { sets.push('content = ?'); vals.push(body.content.trim()); }
    if (body.phase !== undefined)   { sets.push('phase = ?');   vals.push(body.phase); }

    if (sets.length === 0) return Response.json({ ok: false, error: 'nothing to update' }, { status: 400 });
    vals.push(entryId, journalId);

    await pool.query(
      `UPDATE trade_journal_entries SET ${sets.join(', ')} WHERE id = ? AND journal_id = ?`,
      vals,
    );
    return Response.json({ ok: true });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const pool = getPool();
  const { id, entryId: entryIdParam } = await params;
  const entryId = Number(entryIdParam);
  const journalId = Number(id);
  try {
    const [result] = await pool.query<ResultSetHeader>(
      'DELETE FROM trade_journal_entries WHERE id = ? AND journal_id = ?',
      [entryId, journalId],
    );
    if (result.affectedRows === 0) return Response.json({ ok: false, error: 'not found' }, { status: 404 });
    return Response.json({ ok: true });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
