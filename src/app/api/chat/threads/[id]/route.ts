import { NextRequest, NextResponse } from 'next/server';
import type { ResultSetHeader } from 'mysql2';
import { getPool } from '@/lib/db';
import { parseThreadId, requireChatUser } from '@/lib/chat/ownership';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireChatUser(req);
  if (!auth.ok) return auth.res;
  const id = parseThreadId((await params).id);
  if (id === null) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 });

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

  values.push(id, auth.userId);
  const pool = getPool();
  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE chat_threads SET ${fields.join(', ')} WHERE id = ? AND user_id = ? AND EXISTS (SELECT 1 FROM users u WHERE u.id = chat_threads.user_id)`,
    values,
  );
  if (result.affectedRows === 0) return NextResponse.json({ ok: false, error: 'thread not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireChatUser(req);
  if (!auth.ok) return auth.res;
  const id = parseThreadId((await params).id);
  if (id === null) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 });
  const pool = getPool();
  const [result] = await pool.query<ResultSetHeader>('DELETE FROM chat_threads WHERE id = ? AND user_id = ? AND EXISTS (SELECT 1 FROM users u WHERE u.id = chat_threads.user_id)', [id, auth.userId]);
  if (result.affectedRows === 0) return NextResponse.json({ ok: false, error: 'thread not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
