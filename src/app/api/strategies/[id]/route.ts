import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { id } = params;
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;

  const updates: Record<string, unknown> = {};
  if (typeof body.enabled === 'boolean') updates.enabled = body.enabled ? 1 : 0;
  if (typeof body.backtest_interval_h === 'number') {
    updates.backtest_interval_h = body.backtest_interval_h;
  }
  if (typeof body.description === 'string') updates.description = body.description;
  if (Array.isArray(body.tags)) updates.tags = JSON.stringify(body.tags);

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: false, error: 'no valid fields' }, { status: 400 });
  }

  try {
    const pool = getPool();
    const sets  = Object.keys(updates).map(k => `${k}=?`).join(', ');
    const vals  = [...Object.values(updates), id];
    await pool.query(`UPDATE strategies SET ${sets} WHERE id=?`, vals);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[PATCH /api/strategies/[id]]', e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
