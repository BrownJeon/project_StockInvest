import { NextRequest, NextResponse } from 'next/server';
import { getEvalFunnelSummary } from '@/lib/strategy/eval-funnel-query';
import type { FunnelMarket } from '@/lib/strategy/eval-funnel-labels';
import { kstTodayStart } from '@/lib/time';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const marketParam = req.nextUrl.searchParams.get('market');
  const market: FunnelMarket = marketParam === 'overseas' ? 'overseas' : 'domestic';

  try {
    const rangeStart = kstTodayStart();
    const rangeEnd = new Date();
    const summary = await getEvalFunnelSummary(market, rangeStart, rangeEnd);
    return NextResponse.json({ ok: true, data: summary });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/dashboard/eval-funnel]', error);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
