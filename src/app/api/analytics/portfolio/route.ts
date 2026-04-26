import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { checkVolatilityGuard } from '@/lib/safety/volatility-guard';

export const dynamic = 'force-dynamic';

const PERIOD_DAYS: Record<string, number> = { '1d': 1, '7d': 7, '30d': 30 };

type SnapRow = RowDataPacket & { ts: string; total_krw: number; positions: string };

async function getFirstSnap(pool: ReturnType<typeof import('@/lib/db')['getPool']>, days: number): Promise<SnapRow | null> {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const [rows] = await pool.query<SnapRow[]>(
    'SELECT ts, total_krw, positions FROM portfolio_snapshots WHERE ts >= ? ORDER BY ts ASC LIMIT 1',
    [cutoff],
  );
  return rows[0] ?? null;
}

export async function GET(req: NextRequest) {
  const period = req.nextUrl.searchParams.get('period') ?? '7d';
  const pool = getPool();

  const [latestRows] = await pool.query<SnapRow[]>(
    'SELECT ts, total_krw, positions FROM portfolio_snapshots ORDER BY ts DESC LIMIT 1',
  );
  const latest = latestRows[0] ?? null;

  const firstOfPeriod = await getFirstSnap(pool, PERIOD_DAYS[period] ?? 7);

  const changePct = (firstOfPeriod && latest && firstOfPeriod.total_krw > 0)
    ? ((latest.total_krw - firstOfPeriod.total_krw) / firstOfPeriod.total_krw) * 100
    : null;

  const periodReturns: Record<string, number | null> = {};
  for (const [p, d] of Object.entries(PERIOD_DAYS)) {
    const first = await getFirstSnap(pool, d);
    periodReturns[p] = (first && latest && first.total_krw > 0)
      ? ((latest.total_krw - first.total_krw) / first.total_krw) * 100
      : null;
  }

  const volGuard = await checkVolatilityGuard();

  const positions = latest ? (() => {
    try { return JSON.parse(latest.positions) as unknown[]; } catch { return []; }
  })() : [];

  return NextResponse.json({
    ok: true,
    latest: latest ? { ts: latest.ts, totalKRW: latest.total_krw, positions } : null,
    changePct,
    period,
    periodReturns,
    volGuard: { ok: volGuard.ok, level: volGuard.level ?? 'ok', changePct: volGuard.changePct },
  });
}
