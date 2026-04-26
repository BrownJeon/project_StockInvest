import { NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface VolRow extends RowDataPacket {
  symbol: string;
  atr_pct: string;
  suggested_interval: string;
  sample_count: number;
  refreshed_at: Date;
}

/**
 * GET /api/analytics/adaptive-intervals
 *
 * 종목별 변동성·추천 interval 조회 (universe 갱신 시 자동 채워짐).
 * - high (≥3%): 30m / mid·low (<3%): 1h
 * - 1d 전략은 변동성 무관 그대로 1d 사용
 */
export async function GET() {
  try {
    const pool = getPool();
    const [rows] = await pool.query<VolRow[]>(
      `SELECT symbol, atr_pct, suggested_interval, sample_count, refreshed_at
       FROM symbol_volatility
       ORDER BY atr_pct DESC`,
    );
    return NextResponse.json({
      ok: true,
      symbols: rows.map(r => ({
        symbol: r.symbol,
        atrPct: Number(r.atr_pct),
        suggestedInterval: r.suggested_interval,
        sampleCount: Number(r.sample_count),
        refreshedAt: r.refreshed_at,
      })),
      buckets: {
        high:   rows.filter(r => Number(r.atr_pct) >= 3.0).length,
        mid:    rows.filter(r => { const v = Number(r.atr_pct); return v >= 1.0 && v < 3.0; }).length,
        low:    rows.filter(r => Number(r.atr_pct) < 1.0).length,
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
