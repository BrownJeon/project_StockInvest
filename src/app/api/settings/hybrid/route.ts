import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & { value: string })[]>(
      'SELECT value FROM system_config WHERE `key` = ? LIMIT 1',
      ['hybrid_mode_enabled'],
    );
    const enabled = rows.length > 0
      ? JSON.parse(rows[0].value) === true
      : String(process.env.HYBRID_MODE_ENABLED ?? 'false').toLowerCase() === 'true';

    return NextResponse.json({ ok: true, enabled });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/settings/hybrid GET]', error);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json() as { enabled?: unknown };
    if (typeof body.enabled !== 'boolean') {
      return NextResponse.json(
        { ok: false, error: 'body.enabled must be boolean' },
        { status: 400 },
      );
    }

    const pool = getPool();
    await pool.query(
      'INSERT INTO system_config (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
      ['hybrid_mode_enabled', JSON.stringify(body.enabled)],
    );

    return NextResponse.json({ ok: true, enabled: body.enabled });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/settings/hybrid PATCH]', error);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
