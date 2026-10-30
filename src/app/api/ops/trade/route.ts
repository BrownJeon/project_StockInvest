/**
 * T-108 `GET /api/ops/trade` — 거래 › 운용 현황·보유·주문의 숫자(승인 대기·관측 기록·진입 감시·보유 구간·미체결) (가이드 §4.4).
 *
 * 읽기 전용(SELECT 만), KIS 호출 없음, 캐시 없음. 승인 대기 숫자는 홈과 같은 함수(`countApproval`).
 * 섹션 단위 실패 격리: 한 섹션 실패는 그 섹션만 error, HTTP 200. 예기치 못한 전체 실패만 503.
 */
import { NextResponse } from 'next/server';
import { buildTrade } from '@/lib/ops/metrics/trade';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await buildTrade(Date.now());
    return NextResponse.json({ ok: true, data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[api/ops/trade]', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ ok: false, error: 'trade_unavailable' }, { status: 503 });
  }
}
