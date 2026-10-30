/**
 * T-108 `GET /api/ops/analysis?part=today|verify|data` — 분석 탭 세 칸의 숫자 (가이드 §4.6).
 *
 * part 별로 따로 부른다. part 가 없거나 그 밖 값이면 400 `invalid_part`. 읽기 전용, KIS·FX 외부 호출 없음, 캐시 없음.
 * 사후 성과 「초과수익 중앙값」은 v1 에서 만들지 않는다(L-3) — 각 행 medianExcessPct.state='prep'.
 */
import { NextRequest, NextResponse } from 'next/server';
import { buildAnalysis, parsePart } from '@/lib/ops/metrics/analysis';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const part = parsePart(req.nextUrl.searchParams.get('part'));
  if (!part) return NextResponse.json({ ok: false, error: 'invalid_part' }, { status: 400 });
  try {
    const data = await buildAnalysis(part, Date.now());
    return NextResponse.json({ ok: true, data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[api/ops/analysis]', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ ok: false, error: 'analysis_unavailable' }, { status: 503 });
  }
}
