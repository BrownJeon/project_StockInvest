/**
 * POST /api/cron/kis-fundamentals-snapshot — KIS 해외 현재가상세(HHDFS76200200) 원값 스냅샷 (T-059 Part A).
 * cron-runner.sh 가 매일 **08:30~08:55 KST 창의 매 틱**에 부른다(미국장 마감 뒤·국내장 개장 전 — T-145 ⑨).
 *
 * ⚠ 이 라우트는 **주문·시그널을 만들지 않는다.** 읽기 전용 GET → us_fundamentals_snapshot upsert 뿐. 본체는
 *   `src/lib/data/kis-fundamentals-snapshot.ts`.
 *
 * 응답: 테이블 미적용이면 `{ ok:true, skipped:'tables_missing' }`(KIS 호출 0). 유량 대기 실패로 중단하면 **503**.
 *
 * 🔴 **마감 종료는 503 이 아니다**(T-145 ⑨-1). 한 호출은 90초 마감 안에서만 처리하고 끊으며, 그때는
 * `{ ok:true, stopped:'budget', complete:false, partial:true, remaining:N }` + **200** 이다 — 남은 일은 다음 호출이
 * DB(`us_fundamentals_snapshot` 의 오늘 행)로 이어받는다. 여기서 503 을 주면 `job_run_log` 가 `failed` 가 되어
 * 「끊고 이어받는 정상 동작」이 매일 실패로 기록된다. 아래 분기는 **`result.aborted` 일 때만** 503 이므로
 * 그 구분이 코드에 이미 있다 — `stopped` 를 `aborted` 에 합치지 말 것.
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
