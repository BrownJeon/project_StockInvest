/**
 * T-108 `GET /api/ops/home` — 홈 화면 한 번에(확인 필요·운용현황·청산 로직·오늘의 분석·최근 활동) (가이드 §4.3).
 *
 * 읽기 전용(SELECT 만 — `lib/ops/metrics/read-only.ts`), KIS·FX 외부 호출 없음, 캐시 없음(홈 60초 재조회).
 * 섹션 단위 실패 격리: 한 섹션 실패는 그 섹션만 `{ state:'error' }` 이고 HTTP 200. 예기치 못한 전체 실패만 503.
 */
import { NextResponse } from 'next/server';
import { buildHome } from '@/lib/ops/metrics/home';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await buildHome(Date.now());
    return NextResponse.json({ ok: true, data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[api/ops/home]', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ ok: false, error: 'home_unavailable' }, { status: 503 });
  }
}
