import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { checkVolatilityGuard, getVolatilityConfig } from '@/lib/safety/volatility-guard';

export const dynamic = 'force-dynamic';

const PERIOD_HOURS: Record<string, number> = {
  '6h': 6, '24h': 24, '7d': 168, '30d': 720,
};

type SnapRow = RowDataPacket & { ts: string; total_krw: number; positions: string; source: string };

interface Position {
  currency: string;
  qty?: number;
  price?: number;
  value_krw?: number;
}

function computeLevel(
  changePct: number,
  cfg: { warnPct: number; blockPct: number; panicPct: number },
): string {
  if (changePct <= cfg.panicPct) return 'panic';
  if (changePct <= cfg.blockPct) return 'block';
  if (changePct <= cfg.warnPct)  return 'warn';
  return 'ok';
}

function parsePositions(raw: string): Position[] {
  try { return JSON.parse(raw) as Position[]; } catch { return []; }
}

export async function GET(req: NextRequest) {
  const period = req.nextUrl.searchParams.get('period') ?? '24h';
  const hours  = PERIOD_HOURS[period] ?? 24;
  const pool   = getPool();

  const [volGuard, cfg] = await Promise.all([
    checkVolatilityGuard(),
    getVolatilityConfig(),
  ]);

  // windowMin 분 만큼 추가로 가져와야 rolling baseline 계산 가능
  const extraMs = (cfg.windowMin + 60) * 60_000;
  const cutoff  = new Date(Date.now() - hours * 3_600_000 - extraMs);

  const [rows] = await pool.query<SnapRow[]>(
    'SELECT ts, total_krw, positions, source FROM portfolio_snapshots WHERE ts >= ? ORDER BY ts ASC',
    [cutoff],
  );

  const allSnaps = rows.map(r => ({
    ts:         new Date(r.ts),
    totalKRW:   Number(r.total_krw),
    positions:  parsePositions(r.positions),
    source:     r.source,
  }));

  const periodStart = new Date(Date.now() - hours * 3_600_000);
  const windowMs    = cfg.windowMin * 60_000;

  const enriched = allSnaps
    .filter(s => s.ts >= periodStart)
    .map(snap => {
      const baselineCutoff = new Date(snap.ts.getTime() - windowMs);
      // windowMin 이전 중 가장 가까운 스냅샷
      const baseline = allSnaps
        .filter(s => s.ts <= snap.ts && s.ts >= baselineCutoff)
        .at(0);

      let level      = 'ok';
      let changePct: number | null = null;
      if (baseline && baseline.totalKRW > 0) {
        changePct = ((snap.totalKRW - baseline.totalKRW) / baseline.totalKRW) * 100;
        level     = computeLevel(changePct, cfg);
      }

      const prices:       Record<string, number> = {};
      const compositions: Record<string, number> = {};
      for (const p of snap.positions) {
        if (p.currency && p.price != null)     prices[p.currency]       = p.price;
        if (p.currency && p.value_krw != null && snap.totalKRW > 0)
          compositions[p.currency] = (p.value_krw / snap.totalKRW) * 100;
      }

      return {
        ts:           snap.ts.toISOString(),
        totalKRW:     snap.totalKRW,
        source:       snap.source,
        prices,
        compositions,
        level,
        changePct,
      };
    });

  const latest = allSnaps.at(-1) ?? null;

  const coinSet = new Set<string>();
  for (const s of enriched) Object.keys(s.prices).forEach(c => { if (c !== 'KRW') coinSet.add(c); });

  return NextResponse.json({
    ok: true,
    period,
    snapshots: enriched,
    current: {
      totalKRW:  latest?.totalKRW ?? 0,
      ts:        latest?.ts.toISOString() ?? null,
      changePct: volGuard.changePct ?? null,
      level:     volGuard.level ?? 'ok',
      config:    cfg,
    },
    coins: [...coinSet],
  });
}
