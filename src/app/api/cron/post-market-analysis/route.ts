/**
 * POST /api/cron/post-market-analysis
 *
 * 장 마감 후 실행 — 당일 일봉 데이터 + 뉴스 분석 → 익일 시나리오 시그널 사전 등록.
 *
 * 실행 시점 (외부 cron 또는 pm2 ecosystem에서 호출):
 *   국내 분석: KST 16:00 (UTC 07:00) — 15:30 마감 후 30분 대기
 *   해외 분석: KST 07:00 (UTC 22:00 전날) — 미국 16:00 ET 마감 후 반영
 *
 * ?market=domestic|overseas (기본: domestic)
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkCronAuth } from '@/lib/cron-auth';
import { runPostMarketAnalysis } from '@/lib/strategy/post-market-engine';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const authErr = checkCronAuth(req);
  if (authErr) return authErr;

  const market = (req.nextUrl.searchParams.get('market') ?? 'domestic') as 'domestic' | 'overseas';
  if (market !== 'domestic' && market !== 'overseas') {
    return NextResponse.json({ ok: false, error: 'market must be domestic or overseas' }, { status: 400 });
  }

  console.log(`[cron/post-market-analysis] start market=${market}`);

  try {
    const result = await runPostMarketAnalysis(market);
    console.log(`[cron/post-market-analysis] done`, result);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[cron/post-market-analysis] fatal error:', e);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
