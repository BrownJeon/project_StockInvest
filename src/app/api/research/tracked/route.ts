/**
 * GET /api/research/tracked — 리서치 추적중 심볼 + 각 심볼의 최신 결과 (T-032).
 *
 * 분석 탭 "리서치" 서브탭이 쓰는 유일한 조회 엔드포인트.
 * 아직 한 번도 cron이 돌지 않은 심볼은 결과 없이 목록에만 남아 UI가 "분석 대기중"을 표시한다.
 *
 * T-033 — 항목마다 `recommendation`(매수/매도 "고려")을 함께 내려준다.
 * 🔴 이 추천은 **화면 표시 전용**이다. 자동매매(`createSignal`/`submitOrder`)와 연결돼 있지 않다.
 */
import { getLatestResearchResults } from '@/lib/research/storage';
import { buildResearchRecommendations } from '@/lib/research/recommendation-view';
import { fetchCurrentQuotes } from '@/lib/reports/trade-report';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { tracked, results } = await getLatestResearchResults();
    const bySymbol = new Map(results.map((r) => [r.symbol, r]));

    // 결과가 있고 실패하지 않은 심볼만 추천 대상 — 실패 행에 추천을 붙이면 근거 없는 값이 된다.
    const recommendations = await buildResearchRecommendations(
      results.filter((r) => !r.error),
      fetchCurrentQuotes,
    );

    // 즐겨찾기 정렬 순서를 그대로 유지한다(사용자가 기대하는 순서).
    const data = tracked.map((t) => ({
      symbol: t.symbol,
      name: t.name,
      market: t.market,
      result: bySymbol.get(t.symbol) ?? null,
      recommendation: recommendations.get(t.symbol) ?? null,
    }));

    return Response.json({ ok: true, data });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/research/tracked GET]', error);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
