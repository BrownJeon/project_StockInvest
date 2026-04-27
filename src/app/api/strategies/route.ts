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
      // SET 컬럼은 mysql2가 콤마 구분 문자열로 반환 → split. 빈 토큰 제거.
      applicable_styles: typeof r.applicable_styles === 'string'
        ? r.applicable_styles.split(',').filter(Boolean)
        : [],
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

    // 현재 분석가 성향 동봉 — 프런트가 별도 fetch 없이 카드 강조 분기 가능
    const [styleRows] = await pool.query<RowDataPacket[]>(
      "SELECT value FROM system_config WHERE `key` = 'analyst_style' LIMIT 1",
    );
    const rawStyle = styleRows[0]?.value;
    const analystStyle: 'aggressive' | 'neutral' | 'stable' = (() => {
      try {
        const v = typeof rawStyle === 'string' ? JSON.parse(rawStyle) : rawStyle;
        return v === 'aggressive' || v === 'stable' ? v : 'neutral';
      } catch { return 'neutral'; }
    })();

    return NextResponse.json({ ok: true, strategies, analystStyle });
  } catch (e) {
    console.error('[GET /api/strategies]', e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
