/**
 * 요청 → 로그인 회원 id (T-008 Step 1, 2026-08-07).
 *
 * middleware 가 이미 세션을 검증하지만, **라우트도 스스로 검증한다**:
 *   - middleware matcher 가 바뀌거나 예외 경로가 늘어나도 라우트가 무방비가 되지 않는다 (이중 방어)
 *   - 회원 id 는 payload 에서 직접 꺼내야 한다 — 헤더로 전달받으면 위조 가능한 입력이 된다
 *
 * 세션 서명 키(`AUTH_SESSION_SECRET`)가 없으면 통과시키지 않는다 (fail-closed).
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE, getSessionSecret, verifySession } from '@/lib/auth/session';

export type CurrentUser =
  | { ok: true; userId: number }
  | { ok: false; res: NextResponse };

export async function requireUserId(req: NextRequest): Promise<CurrentUser> {
  const secret = getSessionSecret();
  if (!secret) {
    return {
      ok: false,
      res: NextResponse.json(
        { ok: false, error: 'auth_not_configured', detail: 'AUTH_SESSION_SECRET 설정 필요 — 서버 .env 를 확인하세요' },
        { status: 503 },
      ),
    };
  }
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const result = await verifySession(token, secret);
  if (!result.ok) {
    return {
      ok: false,
      res: NextResponse.json({ ok: false, error: 'unauthorized', detail: `session ${result.reason}` }, { status: 401 }),
    };
  }
  return { ok: true, userId: result.payload.sub };
}
