import { NextRequest, NextResponse } from 'next/server';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { kis, getKisTickers } from '@/lib/exchanges/kis';
import { STRATEGY_REGISTRY } from '@/lib/strategy/rules';
import { runBacktest } from '@/lib/strategy/backtest';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const strategyId = url.searchParams.get('strategy_id');
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 20), 100);

    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, strategy_id, symbol, interval_str, period_days,
              fee_pct, slip_pct, initial_krw, status,
              JSON_EXTRACT(result, '$.metrics') AS metrics,
              error, started_at, finished_at
       FROM backtests
       ${strategyId ? 'WHERE strategy_id = ?' : ''}
       ORDER BY started_at DESC LIMIT ?`,
      strategyId ? [strategyId, limit] : [limit],
    );
    return NextResponse.json({ ok: true, backtests: rows });
  } catch (e) {
    console.error('[GET /api/backtest]', e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const strategyId = String(body.strategy_id ?? '');
  const symbol     = String(body.symbol ?? '');
  const periodDays = Number(body.period_days ?? 90);
  const feePct     = Number(body.fee_pct ?? 0.09);   // §3 교정: 왕복 0.18%의 편도
  const slipPct    = Number(body.slip_pct ?? 0.15);  // §3 교정: 대형주 지정가 슬리피지
  const initialKRW = Number(body.initial_krw ?? 1_000_000);

  if (!strategyId) return NextResponse.json({ ok: false, error: 'strategy_id required' }, { status: 400 });

  const meta = STRATEGY_REGISTRY[strategyId];
  if (!meta) return NextResponse.json({ ok: false, error: `unknown strategy: ${strategyId}` }, { status: 400 });

  const allTickers = await getKisTickers(['005930','000660','207940','005380','068270','055550','000270','003670','035420','035720']);
  const top40 = allTickers
    .sort((a, b) => (b.quoteVolume24h ?? 0) - (a.quoteVolume24h ?? 0))
    .slice(0, 40)
    .map(t => t.symbol);

  const targetSymbol = symbol || top40[0];
  if (!targetSymbol) {
    return NextResponse.json({ ok: false, error: 'no tradable symbol available' }, { status: 400 });
  }
  if (symbol && !top40.includes(symbol)) {
    return NextResponse.json({ ok: false, error: `symbol not in top-40 tradable list` }, { status: 400 });
  }

  const pool = getPool();
  const [ins] = await pool.query<ResultSetHeader>(
    `INSERT INTO backtests (strategy_id, symbol, interval_str, period_days, fee_pct, slip_pct, initial_krw)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [strategyId, targetSymbol, meta.interval, periodDays, feePct, slipPct, initialKRW],
  );
  const backtestId = ins.insertId;

  // Run asynchronously — respond immediately with ID
  runBacktestAsync(backtestId, strategyId, targetSymbol, meta.interval, periodDays, feePct, slipPct, initialKRW);

  return NextResponse.json({ ok: true, backtestId }, { status: 202 });
}

async function runBacktestAsync(
  backtestId: number,
  strategyId: string,
  symbol: string,
  interval: string,
  periodDays: number,
  feePct: number,
  slipPct: number,
  initialKRW: number,
) {
  const pool = getPool();
  try {
    const meta = STRATEGY_REGISTRY[strategyId];
    // 1h candle = 24/day, 30m = 48/day, 1d = 1/day
    const candlesPerDay = interval === '1d' ? 1 : interval === '30m' ? 48 : 24;
    const count = Math.min(periodDays * candlesPerDay + 10, 500);

    const candles = await kis.getCandles(symbol, interval, count);
    const result = runBacktest(candles, meta.fn, { feePct, slipPct, initialKRW, strategyId, symbol });

    await pool.query(
      `UPDATE backtests SET status='done', result=?, finished_at=NOW() WHERE id=?`,
      [JSON.stringify(result), backtestId],
    );

    // Sync metrics back to strategies table
    await pool.query(
      `UPDATE strategies SET last_backtest_result=?, last_backtest_at=NOW() WHERE id=?`,
      [JSON.stringify({
        sharpe: result.metrics.sharpe,
        mdd: result.metrics.mdd,
        winRate: result.metrics.winRate,
        period: result.metrics.period,
      }), strategyId],
    );
  } catch (e) {
    await pool.query(
      `UPDATE backtests SET status='failed', error=?, finished_at=NOW() WHERE id=?`,
      [String(e), backtestId],
    );
    console.error('[backtest async]', backtestId, e);
  }
}
