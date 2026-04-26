import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

const DB_KEY = 'watch_symbols';
// 기본 워치리스트 — 삼성전자 / SK하이닉스
const DEFAULTS = ['005930', '000660'];

export async function GET() {
  try {
    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & { value: string })[]>(
      'SELECT value FROM system_config WHERE `key` = ? LIMIT 1',
      [DB_KEY],
    );
    if (rows.length > 0) {
      const parsed = JSON.parse(rows[0].value);
      if (Array.isArray(parsed)) return NextResponse.json({ ok: true, symbols: parsed });
    }
  } catch { /* fall through to defaults */ }
  return NextResponse.json({ ok: true, symbols: DEFAULTS });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json() as { symbols?: unknown };
  if (!Array.isArray(body.symbols)) {
    return NextResponse.json({ ok: false, error: 'symbols must be array' }, { status: 400 });
  }
  const symbols = (body.symbols as unknown[]).filter((s): s is string => typeof s === 'string');
  const pool = getPool();
  await pool.query(
    'INSERT INTO system_config (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
    [DB_KEY, JSON.stringify(symbols)],
  );
  return NextResponse.json({ ok: true });
}
