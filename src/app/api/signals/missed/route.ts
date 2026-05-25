import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

export interface MissedSignal {
  id: number;
  symbol: string;
  side: string;
  strategyId: string;
  reasoning: string;
  confidence: number | null;
  priceAtSkip: number | null;
  price1hAfter: number | null;
  priceChangePct: number | null;
  createdAt: string;
  source: 'ai_skipped' | 'user_rejected';
}

interface SignalRow extends RowDataPacket {
  id: number;
  symbol: string;
  side: string;
  strategy_id: string;
  reasoning: string | null;
  indicators: string | null;
  price_at_skip: string | null;
  price_1h_after: string | null;
  price_change_pct: string | null;
  created_at: Date;
  status: string;
}

function extractConfidence(indicators: string | null): number | null {
  if (!indicators) return null;
  try {
    const parsed = JSON.parse(indicators) as { ai?: { confidence?: number } };
    return parsed?.ai?.confidence ?? null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const days = Math.min(Number(searchParams.get('days') ?? '7'), 30);

  try {
    const pool = getPool();
    const [rows] = await pool.query<SignalRow[]>(
      `SELECT id, symbol, side, strategy_id, reasoning, indicators,
              price_at_skip, price_1h_after, price_change_pct, created_at, status
       FROM signals
       WHERE status IN ('ai_skipped', 'rejected')
         AND created_at > DATE_SUB(NOW(), INTERVAL ? DAY)
       ORDER BY created_at DESC
       LIMIT 200`,
      [days],
    );

    const data: MissedSignal[] = rows.map(r => ({
      id: r.id,
      symbol: r.symbol,
      side: r.side,
      strategyId: r.strategy_id,
      reasoning: r.reasoning ?? '',
      confidence: extractConfidence(r.indicators),
      priceAtSkip: r.price_at_skip != null ? Number(r.price_at_skip) : null,
      price1hAfter: r.price_1h_after != null ? Number(r.price_1h_after) : null,
      priceChangePct: r.price_change_pct != null ? Number(r.price_change_pct) : null,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      source: (r.status === 'ai_skipped' ? 'ai_skipped' : 'user_rejected') as 'ai_skipped' | 'user_rejected',
    }));

    return NextResponse.json({ ok: true, data, days });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
