/**
 * GET /api/research/tracked — 리서치 추적중 심볼 + 각 심볼의 최신 결과 (T-032).
 *
 * 분석 탭 "리서치" 서브탭이 쓰는 유일한 조회 엔드포인트.
 * 아직 한 번도 cron이 돌지 않은 심볼은 결과 없이 목록에만 남아 UI가 "분석 대기중"을 표시한다.
 */
import { getLatestResearchResults } from '@/lib/research/storage';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { tracked, results } = await getLatestResearchResults();
    const bySymbol = new Map(results.map((r) => [r.symbol, r]));

    // 즐겨찾기 정렬 순서를 그대로 유지한다(사용자가 기대하는 순서).
    const data = tracked.map((t) => ({
      symbol: t.symbol,
      name: t.name,
      market: t.market,
      result: bySymbol.get(t.symbol) ?? null,
    }));

    return Response.json({ ok: true, data });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/research/tracked GET]', error);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
