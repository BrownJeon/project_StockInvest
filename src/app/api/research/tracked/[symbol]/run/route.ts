/**
 * POST /api/research/tracked/[symbol]/run — 추적중 종목 1개를 지금 바로 재분석 (T-032 후속).
 *
 * cron(runResearchCycle)이 하는 일(buildResearchReport → upsertResearchResult)을 심볼 1개에
 * 대해 즉시 실행한다. 다음 장마감까지 기다리지 않고 "리서치분석" 탭에서 바로 갱신하고 싶다는
 * 사용자 요청으로 추가됨. 같은 날 재실행하면 오늘자 행을 덮어쓴다 — storage.ts 설계상 원래
 * 허용된 동작("수동 재트리거 허용")이라 별도 처리가 필요 없다.
 *
 * 즐겨찾기에서 추적(research_enabled=1)이 꺼져 있으면 404 — 목록에 나오지도 않는 심볼을
 * 임의로 처리하게 두지 않는다. 인증은 다른 사용자 API와 동일하게 미들웨어 기본 세션 보호를
 * 쓴다(cron-secret 아님 — 이 경로는 사람이 로그인해서 누르는 버튼이다).
 * LLM·주문·시그널 경로는 이 파일 어디에도 없다.
 *
 * cron 경로(run-cycle.ts)와 동일하게 심볼 1개당 `SYMBOL_TIMEOUT_MS`(8초) 상한을 건다 — 이게
 * 없으면 Yahoo 두 호스트가 각각 최대 8초씩(개별 fetch 타임아웃) 실패할 때 최대 16초까지 걸릴
 * 수 있고, 브라우저의 "지금 분석" 버튼이 그만큼 오래 "분석 중..."으로 멈춰 있어 사용자에게는
 * 마치 아무 반응이 없는 것처럼 보인다.
 */
import { NextRequest } from 'next/server';
import { buildResearchReport } from '@/lib/research/research-report';
import { listTrackedSymbols, upsertResearchResult } from '@/lib/research/storage';
import { withTimeout, SYMBOL_TIMEOUT_MS, PER_FETCH_TIMEOUT_MS } from '@/lib/research/run-cycle';

export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const { symbol: rawSymbol } = await params;
  const symbol = decodeURIComponent(rawSymbol ?? '').trim();
  if (!symbol) {
    return Response.json({ ok: false, error: 'symbol required' }, { status: 400 });
  }

  try {
    const tracked = await listTrackedSymbols();
    const match = tracked.find((t) => t.symbol === symbol);
    if (!match) {
      return Response.json({ ok: false, error: 'not tracked' }, { status: 404 });
    }

    const report = await withTimeout(
      buildResearchReport(symbol, { history: { timeoutMs: PER_FETCH_TIMEOUT_MS } }),
      SYMBOL_TIMEOUT_MS,
      symbol,
    );
    await upsertResearchResult(report);
    console.log('[api/research/tracked/[symbol]/run] done', { symbol, eventCount: report.eventCount });

    return Response.json({
      ok: true,
      data: {
        symbol: report.symbol,
        name: match.name,
        market: report.market,
        result: { ...report, createdAt: new Date().toISOString() },
      },
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/research/tracked/[symbol]/run POST]', error);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
