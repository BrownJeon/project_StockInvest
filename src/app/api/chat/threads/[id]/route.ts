import { NextRequest, NextResponse } from 'next/server';
import type { ResultSetHeader } from 'mysql2';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const fields: string[] = [];
  const values: unknown[] = [];

  if (typeof body?.title === 'string' && body.title.trim().length > 0) {
    fields.push('title = ?');
    values.push(body.title.trim().slice(0, 120));
  }
  if (typeof body?.archived === 'boolean') {
    fields.push('archived = ?');
    values.push(body.archived ? 1 : 0);
  }
  if (fields.length === 0) return NextResponse.json({ ok: false, error: 'no fields' }, { status: 400 });

  values.push(id);
  const pool = getPool();
  await pool.query<ResultSetHeader>(
    `UPDATE chat_threads SET ${fields.join(', ')} WHERE id = ?`,
    values,
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 });
  const pool = getPool();
  await pool.query<ResultSetHeader>('DELETE FROM chat_threads WHERE id = ?', [id]);
  return NextResponse.json({ ok: true });
}
