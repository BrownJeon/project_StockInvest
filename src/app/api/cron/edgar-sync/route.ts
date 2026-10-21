/**
 * POST /api/cron/edgar-sync — SEC EDGAR 읽기 전용 수집 (T-059 Part A). cron-runner.sh 가 매일 07:00 KST 에 1회 부른다.
 *
 * ⚠ 이 라우트는 **주문·시그널을 만들지 않는다.** SEC 조회 → symbol_cik_map·us_filings·us_financial_facts·us_earnings_events upsert 뿐.
 *   LLM·KIS 호출도 없다. 본체와 규칙은 `src/lib/data/us-edgar/sync-job.ts`.
 *
 * 응답(모두 200 — cron-runner 는 200 이 아니면 본문 200자를 로그에 남긴다):
 *  - 테이블 미적용: `{ ok:true, skipped:'tables_missing', missing:[…] }` (SEC 호출 0)
 *  - SEC_USER_AGENT 없음: `{ ok:false, skipped:'sec_user_agent_missing' }` (SEC 호출 0, console.error)
 *  - SEC 429/403·쿨다운: `{ ok:false, aborted:'sec_blocked', … }` → **503** 으로 돌려 cron 로그에 본문이 남게 한다.
 *
 * 인증: 다른 cron 라우트와 같은 `checkCronAuth()`(x-cron-secret, fail-closed). 미들웨어도 `/api/cron/*` 를 한 번 더 막는다.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkCronAuth } from '@/lib/cron-auth';
import { getPool } from '@/lib/db';
import { runEdgarSync } from '@/lib/data/us-edgar/sync-job';
import type { Queryable } from '@/lib/data/us-data-db';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const authErr = checkCronAuth(req);
  if (authErr) return authErr;

  console.log('[cron/edgar-sync] start');
  try {
    const result = await runEdgarSync({ db: getPool() as unknown as Queryable });
    return NextResponse.json(result, { status: result.aborted ? 503 : 200 });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[cron/edgar-sync] fatal error:', error);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
