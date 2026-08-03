import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { checkCronAuth } from '@/lib/cron-auth';
import { updateRsRatings } from '@/lib/strategy/rs-rating';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * RS Rating 갱신 cron.
 *
 * Phase 0 (2026-08-02):
 *  - 유일하게 누락돼 있던 checkCronAuth 추가 (middleware 의 x-cron-secret 검증과 이중 방어).
 *  - scripts/cron-runner.sh 는 모든 cron 을 **POST** 로 호출하는데 GET 핸들러만 있어
 *    실제로는 405 로 실패하고 있었다 → POST 핸들러 추가.
 */
async function handle(req: NextRequest) {
  const authErr = checkCronAuth(req);
  if (authErr) return authErr;

  const url = new URL(req.url);
  const market = (url.searchParams.get('market') ?? 'domestic') as 'domestic' | 'overseas';

  console.log(`[cron/rs-update] start market=${market}`);
  try {
    const updated = await updateRsRatings(market);
    console.log(`[cron/rs-update] done updated=${updated}`);
    return NextResponse.json({ ok: true, updated, market });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[cron/rs-update] error', error);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
