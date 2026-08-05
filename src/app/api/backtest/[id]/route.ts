import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = Number((await params).id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 });
  }
  try {
    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, strategy_id, symbol, interval_str, period_days,
              fee_pct, slip_pct, initial_krw, status, result, error,
              started_at, finished_at
       FROM backtests WHERE id=? LIMIT 1`,
      [id],
    );
    const row = rows[0];
    if (!row) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });

    if (row.result && typeof row.result === 'string') {
      row.result = JSON.parse(row.result);
    }
    return NextResponse.json({ ok: true, backtest: row });
  } catch (e) {
    console.error('[GET /api/backtest/[id]]', e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
