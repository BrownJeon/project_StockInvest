import { NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface StrategyRow extends RowDataPacket {
  id: string;
  last_backtest_at: string | null;
  last_backtest_result: string | null;
  stats_cache: string | null;
}

interface SignalStat extends RowDataPacket {
  strategy_id: string;
  signal_count: number;
  buy_count: number;
  sell_count: number;
  avg_confidence: number | null;
}

const PERIOD_DAYS: Record<string, number> = { '1d': 1, '7d': 7, '30d': 30 };

export async function GET(req: import('next/server').NextRequest) {
  const period = req.nextUrl.searchParams.get('period') ?? '7d';
  const days = PERIOD_DAYS[period] ?? 7;
  const pool = getPool();

  const [strategies] = await pool.query<StrategyRow[]>(
    'SELECT id, last_backtest_at, last_backtest_result, stats_cache FROM strategies ORDER BY id',
  );

  const [signalStats] = await pool.query<SignalStat[]>(
    `SELECT
       strategy_id,
       COUNT(*) AS signal_count,
       SUM(CASE WHEN side='buy' THEN 1 ELSE 0 END) AS buy_count,
       SUM(CASE WHEN side='sell' THEN 1 ELSE 0 END) AS sell_count,
       AVG(JSON_EXTRACT(indicators, '$.ai.confidence')) AS avg_confidence
     FROM signals
     WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
     GROUP BY strategy_id`,
    [days],
  );

  const statsMap = Object.fromEntries(signalStats.map(s => [s.strategy_id, s]));

  const result = strategies.map(s => {
    const bt = s.last_backtest_result ? (() => {
      try { return JSON.parse(s.last_backtest_result!) as Record<string, unknown>; } catch { return null; }
    })() : null;

    const sig = statsMap[s.id];

    return {
      id: s.id,
      lastBacktestAt: s.last_backtest_at,
      metrics: bt ? {
        totalReturnPct: bt.totalReturnPct as number ?? null,
        sharpe:         bt.sharpe as number ?? null,
        mdd:            bt.mdd as number ?? null,
        winRate:        bt.winRate as number ?? null,
        tradeCount:     bt.tradeCount as number ?? null,
      } : null,
      signals: {
        total:  sig?.signal_count ?? 0,
        buy:    sig?.buy_count ?? 0,
        sell:   sig?.sell_count ?? 0,
        avgAiConfidence: sig?.avg_confidence != null ? Math.round(Number(sig.avg_confidence)) : null,
      },
    };
  });

  return NextResponse.json({ ok: true, strategies: result, period });
}
