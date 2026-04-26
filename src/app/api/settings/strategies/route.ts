import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface StrategyRow extends RowDataPacket {
  id: string;
  enabled: number;
  backtest_interval_h: number;
  next_backtest_at: Date | null;
}

export async function GET() {
  const pool = getPool();
  const [[rows], [cfgRows]] = await Promise.all([
    pool.query<StrategyRow[]>('SELECT id, enabled, backtest_interval_h, next_backtest_at FROM strategies ORDER BY id'),
    pool.query<RowDataPacket[]>("SELECT value FROM system_config WHERE `key` = 'analyst_style' LIMIT 1"),
  ]);
  const rawStyle = (cfgRows[0] as RowDataPacket | undefined)?.value;
  const analystStyle = rawStyle != null ? (typeof rawStyle === 'string' ? JSON.parse(rawStyle) : rawStyle) : 'neutral';
  return NextResponse.json({
    ok: true,
    analystStyle,
    strategies: (rows as StrategyRow[]).map(r => ({
      id: r.id,
      enabled: r.enabled === 1,
      backtestIntervalM: Math.round(r.backtest_interval_h * 60),
      nextBacktestAt: r.next_backtest_at?.toISOString() ?? null,
    })),
  });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json() as { id?: string; backtestIntervalM?: number; enabled?: boolean; analystStyle?: string };
  const pool = getPool();

  // analyst_style 단독 업데이트 허용
  if (body.analystStyle !== undefined) {
    const allowed = ['aggressive', 'neutral', 'stable'];
    if (!allowed.includes(body.analystStyle)) {
      return NextResponse.json({ ok: false, error: 'analystStyle must be aggressive|neutral|stable' }, { status: 400 });
    }
    await pool.query(
      "INSERT INTO system_config (`key`, value) VALUES ('analyst_style', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
      [JSON.stringify(body.analystStyle)],
    );
    if (!body.id) return NextResponse.json({ ok: true });
  }

  if (!body.id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 });

  if (body.backtestIntervalM !== undefined) {
    const m = Number(body.backtestIntervalM);
    if (isNaN(m) || m < 1 || m > 10080) {
      return NextResponse.json({ ok: false, error: 'backtestIntervalM must be 1–10080' }, { status: 400 });
    }
    if (body.id === 'all') {
      await pool.query('UPDATE strategies SET backtest_interval_h = ?', [m / 60]);
    } else {
      await pool.query('UPDATE strategies SET backtest_interval_h = ? WHERE id = ?', [m / 60, body.id]);
    }
  }

  if (body.enabled !== undefined) {
    await pool.query('UPDATE strategies SET enabled = ? WHERE id = ?', [body.enabled ? 1 : 0, body.id]);
  }

  return NextResponse.json({ ok: true });
}
