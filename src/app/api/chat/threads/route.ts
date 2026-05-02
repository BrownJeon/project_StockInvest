import { NextRequest, NextResponse } from 'next/server';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const archived = req.nextUrl.searchParams.get('archived') === '1';
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, title, symbol, created_at, updated_at, message_count, archived
     FROM chat_threads
     WHERE archived = ?
     ORDER BY updated_at DESC LIMIT 200`,
    [archived ? 1 : 0],
  );
  return NextResponse.json({
    ok: true,
    threads: rows.map(r => ({
      id:           Number(r.id),
      title:        r.title as string,
      symbol:       r.symbol ?? null,
      createdAt:    r.created_at,
      updatedAt:    r.updated_at,
      messageCount: Number(r.message_count),
      archived:     Boolean(r.archived),
    })),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const title = typeof body?.title === 'string' && body.title.trim().length > 0 ? body.title.trim().slice(0, 120) : '새 대화';
  const symbol = typeof body?.symbol === 'string' ? body.symbol.slice(0, 32) : null;
  const pool = getPool();
  const [res] = await pool.query<ResultSetHeader>(
    'INSERT INTO chat_threads (title, symbol) VALUES (?, ?)',
    [title, symbol],
  );
  return NextResponse.json({ ok: true, id: res.insertId });
}
