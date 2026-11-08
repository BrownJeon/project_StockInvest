/**
 * POST /api/cron/post-market-analysis
 *
 * 장 마감 후 실행 — 당일 일봉 데이터 + 뉴스 분석 → 익일 시나리오 시그널 사전 등록.
 *
 * 실행 시점 (외부 cron 또는 pm2 ecosystem에서 호출):
 *   국내 분석: KST 16:00 (UTC 07:00) — 15:30 마감 후 30분 대기
 *   해외 분석: KST 08:00 (`scripts/cron-runner.sh`) — 미국 16:00 ET 마감 후 반영. 스위치
 *             `post_market_overseas_enabled` 가 켜져 있지 않으면(키 없음 = 꺼짐) 아무것도 하지 않고 200 (T-062).
 *
 * 응답 코드 (T-062 S-2·S-3 — **해외만**, 국내 응답은 그대로 항상 200):
 *   해외 결과 `ok:false`(`status` = ai_fail·ai_parse_fail → 502, insert_fail → 500, data_unknown → 503) 는 비-200 으로 답한다.
 *   data_unknown = 휴장 표·환율·실적 일정을 일시적으로 모름, 또는 일봉 조회가 전부 실패(KIS 장애) — 재시도 가능.
 *   in_progress = 같은 해외 세션 분석이 이 프로세스에서 이미 실행 중(single-flight) → 503, 재시도 가능. 스위치 꺼짐·새 세션 없음 등 정상 건너뜀은 200.
 *   "분석 실패"를 "추천 0건"과 구분하고, cron-runner 가 그날 제한적으로 재시도할 수 있게 하기 위해서다.
 *
 * ?market=domestic|overseas (기본: domestic)
 */
import { NextRequest, NextResponse, after } from 'next/server';
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
    if (market === 'overseas' && result.ok === false) {
      const code = result.status === 'insert_fail' ? 500
        : result.status === 'data_unknown' || result.status === 'in_progress' ? 503
        : 502;
      return NextResponse.json({ ...result, ok: false }, { status: code });
    }
    // T-156 shadow/archive companion is scheduled after the response for an actual overseas analysis.
    // Its failure never changes legacy protection, results, retry status or order settings.
    if (market === 'overseas' && !result.skipped) {
      let m40 = { status: 'scheduled', executionMode: 'shadow' };
      try {
        after(async () => {
          try {
            const { observeM40Daily } = await import('@/lib/strategy/m40/observer');
            await observeM40Daily();
          } catch { /* Companion failure cannot change the already-sent legacy response. */ }
        });
      } catch { m40 = { status: 'archive_unavailable', executionMode: 'shadow' }; }
      return NextResponse.json({ ok: true, ...result, m40 });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[cron/post-market-analysis] fatal error:', e);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
