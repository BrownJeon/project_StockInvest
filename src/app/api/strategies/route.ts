import { NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(`
      SELECT s.*,
        COALESCE(sig.count_7d, 0) AS live_signal_count
      FROM strategies s
      LEFT JOIN (
        SELECT strategy_id, COUNT(*) AS count_7d
        FROM signals
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        GROUP BY strategy_id
      ) sig ON sig.strategy_id = s.id
      ORDER BY s.enabled DESC, s.created_at ASC
    `);

    const strategies = rows.map(r => ({
      id:          r.id,
      name:        r.name,
      description: r.description,
      tags:        typeof r.tags === 'string' ? JSON.parse(r.tags) : (r.tags ?? []),
      enabled:     Boolean(r.enabled),
      backtest_interval_h: r.backtest_interval_h,
      last_backtest_at:    r.last_backtest_at ?? null,
      next_backtest_at:    r.next_backtest_at ?? null,
      backtest_running:    Boolean(r.backtest_running),
      last_backtest_result: typeof r.last_backtest_result === 'string'
        ? JSON.parse(r.last_backtest_result) : (r.last_backtest_result ?? null),
      stats: (() => {
        const cache = typeof r.stats_cache === 'string'
          ? JSON.parse(r.stats_cache) : (r.stats_cache ?? {});
        return {
          return7d:    cache.return7d    ?? 0,
          winRate:     cache.winRate     ?? 0,
          signalCount: Number(r.live_signal_count) || cache.signalCount || 0,
        };
      })(),
    }));

    return NextResponse.json({ ok: true, strategies });
  } catch (e) {
    console.error('[GET /api/strategies]', e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
