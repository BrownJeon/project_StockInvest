import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface SymbolRow extends RowDataPacket {
  symbol:         string;
  signal_count:   number;
  avg_confidence: number | null;
  exec_count:     number;
  skip_count:     number;
  last_at:        string;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const sinceMs = Number(searchParams.get('since') ?? Date.now() - 3_600_000);
  const untilMs = Number(searchParams.get('until') ?? Date.now());

  const since = new Date(sinceMs);
  const until = new Date(untilMs);
  const pool  = getPool();

  const [rows] = await pool.query<SymbolRow[]>(
    `SELECT
       symbol,
       COUNT(*) AS signal_count,
       AVG(CAST(JSON_UNQUOTE(JSON_EXTRACT(indicators, '$.ai.confidence')) AS DECIMAL(5,2))) AS avg_confidence,
       SUM(CASE WHEN status = 'auto_submitted' THEN 1 ELSE 0 END) AS exec_count,
       SUM(CASE WHEN status = 'ai_skipped'     THEN 1 ELSE 0 END) AS skip_count,
       MAX(created_at) AS last_at
     FROM signals
     WHERE created_at >= ? AND created_at < ?
     GROUP BY symbol
     ORDER BY signal_count DESC, avg_confidence DESC
     LIMIT 3`,
    [since, until],
  );

  return NextResponse.json({
    ok: true,
    since: since.toISOString(),
    until: until.toISOString(),
    symbols: rows.map(r => ({
      symbol:        r.symbol,
      signalCount:   Number(r.signal_count),
      avgConfidence: r.avg_confidence != null ? Math.round(Number(r.avg_confidence)) : null,
      execCount:     Number(r.exec_count),
      skipCount:     Number(r.skip_count),
      lastAt:        r.last_at,
    })),
  });
}
