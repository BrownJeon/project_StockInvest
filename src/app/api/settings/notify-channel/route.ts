import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

export type NotifyChannel = 'none' | 'telegram' | 'slack' | 'both';
const VALID: NotifyChannel[] = ['none', 'telegram', 'slack', 'both'];

async function readChannel(): Promise<NotifyChannel> {
  try {
    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & { value: string })[]>(
      "SELECT value FROM system_config WHERE `key` = 'notify_channel' LIMIT 1",
    );
    if (rows.length > 0) {
      try {
        const parsed = JSON.parse(rows[0].value);
        if (typeof parsed === 'string' && (VALID as string[]).includes(parsed)) {
          return parsed as NotifyChannel;
        }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return 'none';
}

export async function GET() {
  const channel = await readChannel();
  return NextResponse.json({ ok: true, channel });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { channel?: NotifyChannel };
    const ch = body.channel;
    if (!ch || !(VALID as string[]).includes(ch)) {
      return NextResponse.json({ ok: false, error: `channel must be one of ${VALID.join('|')}` }, { status: 400 });
    }
    const pool = getPool();
    await pool.query(
      'INSERT INTO system_config (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
      ['notify_channel', JSON.stringify(ch)],
    );
    return NextResponse.json({ ok: true, channel: ch });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/settings/notify-channel POST]', error);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
