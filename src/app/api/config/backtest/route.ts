import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

const KEYS = ['backtest_period_days', 'backtest_fee_pct', 'backtest_slip_pct', 'backtest_incl_inactive'] as const;

export async function GET() {
  try {
    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT `key`, value FROM system_config WHERE `key` IN (?,?,?,?)',
      KEYS,
    );

    const map: Record<string, unknown> = {};
    for (const r of rows) {
      map[r.key] = typeof r.value === 'string' ? JSON.parse(r.value) : r.value;
    }

    return NextResponse.json({
      ok: true,
      config: {
        periodDays:   Number(map['backtest_period_days']   ?? 90),
        feePct:       Number(map['backtest_fee_pct']       ?? 0.09),
        slipPct:      Number(map['backtest_slip_pct']      ?? 0.15),
        inclInactive: Boolean(map['backtest_incl_inactive'] ?? false),
      },
    });
  } catch (e) {
    console.error('[GET /api/config/backtest]', e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;

  const fieldMap: Record<string, string> = {
    periodDays:   'backtest_period_days',
    feePct:       'backtest_fee_pct',
    slipPct:      'backtest_slip_pct',
    inclInactive: 'backtest_incl_inactive',
  };

  try {
    const pool = getPool();
    for (const [bodyKey, dbKey] of Object.entries(fieldMap)) {
      if (body[bodyKey] !== undefined) {
        await pool.query(
          'INSERT INTO system_config (`key`, value) VALUES (?,?) ON DUPLICATE KEY UPDATE value=?',
          [dbKey, JSON.stringify(body[bodyKey]), JSON.stringify(body[bodyKey])],
        );
      }
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[PATCH /api/config/backtest]', e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
