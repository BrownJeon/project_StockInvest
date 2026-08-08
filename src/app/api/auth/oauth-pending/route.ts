/**
 * GET /api/auth/oauth-pending — 초대코드 화면의 표시용 요약 (T-009, 2026-08-08).
 *
 * 대기 토큰 쿠키는 HttpOnly 라 화면 JS 가 읽을 수 없다(그래야 XSS 로 새지 않는다).
 * 화면이 "Google 인증 완료 / brownjeon@gmail.com" 을 보여주려면 서버가 요약을 줘야 한다.
 *
 * 돌려주는 값은 **표시에 필요한 것뿐**이다 — providerId·서명 토큰은 나가지 않는다.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSessionSecret } from '@/lib/auth/session';
import { isInviteRequired } from '@/lib/auth/signup-gate';
import { OAUTH_PENDING_COOKIE, verifyPendingSignup } from '@/lib/auth/oauth/pending';
import { OAUTH_PROVIDER_LABEL } from '@/lib/auth/oauth/names';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const secret = getSessionSecret();
  const result = verifyPendingSignup(req.cookies.get(OAUTH_PENDING_COOKIE)?.value, secret);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: 'no_pending', detail: '인증 정보가 없거나 만료되었습니다' },
      { status: 404, headers: { 'cache-control': 'no-store' } },
    );
  }
  return NextResponse.json(
    {
      ok: true,
      provider: result.pending.provider,
      providerLabel: OAUTH_PROVIDER_LABEL[result.pending.provider],
      email: result.pending.email,
      inviteRequired: isInviteRequired(),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
