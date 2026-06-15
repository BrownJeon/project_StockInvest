import { getPool } from '@/lib/db';
import type { ResultSetHeader } from 'mysql2';

export const dynamic = 'force-dynamic';

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const pool = getPool();
  const id = Number(params.id);
  if (!id) return Response.json({ ok: false, error: 'invalid id' }, { status: 400 });

  try {
    const body = await req.json() as { type?: string; title?: string; content?: string };
    const sets: string[] = [];
    const vals: unknown[] = [];

    if (body.type !== undefined) { sets.push('type = ?'); vals.push(body.type); }
    if (body.title !== undefined) { sets.push('title = ?'); vals.push(body.title); }
    if (body.content !== undefined) { sets.push('content = ?'); vals.push(body.content.trim()); }

    if (sets.length === 0) return Response.json({ ok: false, error: 'nothing to update' }, { status: 400 });
    vals.push(id);

    await pool.query(`UPDATE trade_notes SET ${sets.join(', ')} WHERE id = ?`, vals);
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
  if (!id) return Response.json({ ok: false, error: 'invalid id' }, { status: 400 });

  try {
    const [result] = await pool.query<ResultSetHeader>('DELETE FROM trade_notes WHERE id = ?', [id]);
    if (result.affectedRows === 0) return Response.json({ ok: false, error: 'not found' }, { status: 404 });
    return Response.json({ ok: true });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
