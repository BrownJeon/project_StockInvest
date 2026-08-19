/**
 * POST /api/cron/research-cycle-overseas
 *
 * 해외장 마감 후(KST 07:00) 리서치 추적 종목의 급등·급락 사이클 패턴을 재계산한다 (T-032).
 * 미국 16:00 ET 마감 → KST 06:00 이므로 데이터 반영 대기 후 07:00 에 실행한다.
 *
 * ⚠ 이 라우트는 **주문을 내지 않는다.** 조회(Yahoo 일봉) → 통계 계산 → 결과 테이블 upsert 뿐이고,
 *   `submitOrder()`·`createSignal()`·전략 엔진 어느 것도 호출하지 않는다. LLM 호출도 없다.
 *
 * 인증: 기존 cron 라우트와 동일하게 `checkCronAuth()`(x-cron-secret, fail-closed).
 *       미들웨어에서도 `/api/cron/*` 를 같은 시크릿으로 한 번 더 막는다(이중 방어).
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkCronAuth } from '@/lib/cron-auth';
import { runResearchCycle } from '@/lib/research/run-cycle';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const authErr = checkCronAuth(req);
  if (authErr) return authErr;

  console.log('[cron/research-cycle-overseas] start');
  try {
    const result = await runResearchCycle('overseas');
    console.log('[cron/research-cycle-overseas] done', {
      total: result.total, succeeded: result.succeeded, failed: result.failed,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[cron/research-cycle-overseas] fatal error:', e);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
