/**
 * T-108 `GET /api/ops/funnel?market=domestic|overseas` — 거래 › 운영 기록 「장중 룰 평가 깔때기」(시장별 세션일 기준) (가이드 §4.5).
 *
 * `market` 이 없거나 그 밖 값이면 defaultMarket(마지막 run 틱이 더 최근인 시장)으로 채우고 응답 `market` 에 실제 시장을 넣는다.
 * 기존 `/api/dashboard/eval-funnel`(KST 자정 기준)은 그대로 둔다. 읽기 전용, 캐시 없음.
 */
import { NextRequest, NextResponse } from 'next/server';
import { buildFunnel, parseMarketParam } from '@/lib/ops/metrics/funnel';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const data = await buildFunnel(parseMarketParam(req.nextUrl.searchParams.get('market')), Date.now());
    return NextResponse.json({ ok: true, data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[api/ops/funnel]', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ ok: false, error: 'funnel_unavailable' }, { status: 503 });
  }
}
