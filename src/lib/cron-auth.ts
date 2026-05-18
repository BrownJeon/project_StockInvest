import { NextRequest, NextResponse } from 'next/server';

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * Fail-closed: CRON_SECRET 미설정 시에도 모든 요청 거부.
 * 인가되면 undefined, 미인가면 401 Response 반환.
 */
export function checkCronAuth(req: NextRequest): NextResponse | undefined {
  const auth = req.headers.get('x-cron-secret');
  if (!CRON_SECRET || auth !== CRON_SECRET) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  return undefined;
}
