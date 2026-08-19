/**
 * GET /api/research/rally-cycles?symbol=NAS:MU — 온디맨드 미리보기 (T-032, 선택 기능).
 *
 * cron을 기다리지 않고 심볼 1개를 즉석 계산한다. **DB에 저장하지 않는다** —
 * 수동 스모크 테스트/검증용이며, 정식 결과는 cron이 쓴 `research_rally_results` 뿐이다.
 * (저장까지 하면 사용자가 임의 시점에 run_date 행을 덮어써 cron 결과와 뒤섞인다.)
 */
import { NextRequest } from 'next/server';
import { buildResearchReport } from '@/lib/research/research-report';
import { normalizeResearchSymbol } from '@/lib/research/data/symbol-validation';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get('symbol') ?? '').trim();
  if (!symbol) {
    return Response.json({ ok: false, error: 'symbol required' }, { status: 400 });
  }

  const norm = normalizeResearchSymbol(symbol);
  if (!norm.ok) {
    return Response.json(
      { ok: false, error: `unsupported symbol for research (${norm.reason})` },
      { status: 400 },
    );
  }

  try {
    const report = await buildResearchReport(norm.symbol);
    if (report.error) {
      return Response.json({ ok: false, error: report.error }, { status: 502 });
    }
    return Response.json({ ok: true, data: report, persisted: false });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/research/rally-cycles GET]', error);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
