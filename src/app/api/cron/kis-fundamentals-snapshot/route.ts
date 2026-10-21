/**
 * POST /api/cron/kis-fundamentals-snapshot — KIS 해외 현재가상세(HHDFS76200200) 원값 스냅샷 (T-059 Part A).
 * cron-runner.sh 가 매일 08:00 KST 대에 1회 부른다(미국장 마감 뒤·국내장 개장 전).
 *
 * ⚠ 이 라우트는 **주문·시그널을 만들지 않는다.** 읽기 전용 GET → us_fundamentals_snapshot upsert 뿐. 본체는
 *   `src/lib/data/kis-fundamentals-snapshot.ts`.
 *
 * 응답: 테이블 미적용이면 `{ ok:true, skipped:'tables_missing' }`(KIS 호출 0). 유량 대기 실패로 중단하면 503.
 * 인증: `checkCronAuth()`(x-cron-secret, fail-closed).
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkCronAuth } from '@/lib/cron-auth';
import { getPool } from '@/lib/db';
import { runKisFundamentalsSnapshot } from '@/lib/data/kis-fundamentals-snapshot';
import type { Queryable } from '@/lib/data/us-data-db';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const authErr = checkCronAuth(req);
  if (authErr) return authErr;

  console.log('[cron/kis-fundamentals-snapshot] start');
  try {
    const result = await runKisFundamentalsSnapshot({ db: getPool() as unknown as Queryable });
    return NextResponse.json(result, { status: result.aborted ? 503 : 200 });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[cron/kis-fundamentals-snapshot] fatal error:', error);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
