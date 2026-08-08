/**
 * POST /api/auth/oauth-complete — 초대코드 확인 후 **처음으로** 계정을 만든다 (T-009 D1=A).
 *
 * body: { inviteCode?: string }
 *
 * ★ 이 라우트가 **"코드가 틀리면 계정이 만들어지지 않는다"의 유일한 보증 지점**이다.
 *   OAuth 콜백은 계정을 만들지 않고 검증된 신원을 서명 쿠키로만 넘긴다. 여기서
 *   `evaluateOAuthCompletion` 이 ok 를 주기 전에는 `createOAuthUser` 를 호출하는 코드 자체가
 *   실행되지 않는다 — 게이트를 우회하는 다른 생성 경로가 없다.
 *
 * 초대코드는 이메일 가입과 **같은 `SIGNUP_INVITE_CODE`** 하나를 쓴다(개인별 코드 아님).
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSessionSecret, signSession } from '@/lib/auth/session';
import { setSessionCookie } from '@/lib/auth/session-cookie';
import { isAuthBodyTooLarge } from '@/lib/auth/request-limits';
import { checkLoginGate, registerLoginFailure, resetLoginGate } from '@/lib/auth/login-gate';
import { OAUTH_PENDING_COOKIE } from '@/lib/auth/oauth/pending';
import { evaluateOAuthCompletion, verifyPendingForCompletion } from '@/lib/auth/oauth/complete-gate';
import { isOAuthSchemaReady } from '@/lib/db';
import {
  createOAuthUser,
  findUserByOAuth,
  isDuplicateEmailError,
  isDuplicateOAuthError,
  maskEmail,
} from '@/lib/auth/users';

export const dynamic = 'force-dynamic';

/** 초대코드 시도 제한 키 — 이메일 가입 게이트와 같은 네임스페이스를 쓴다. */
function gateKey(email: string): string {
  return `signup:${email}`;
}

function clearPending(res: NextResponse): NextResponse {
  res.cookies.set({ name: OAUTH_PENDING_COOKIE, value: '', httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  return res;
}

export async function POST(req: NextRequest) {
  try {
    const secret = getSessionSecret();
    if (!secret) {
      return NextResponse.json(
        { ok: false, error: 'AUTH_SESSION_SECRET 미설정 — 서버 .env 를 확인하고 재시작하세요' },
        { status: 503 },
      );
    }
    if (isAuthBodyTooLarge(req)) {
      return NextResponse.json({ ok: false, error: '요청이 너무 큽니다' }, { status: 413 });
    }

    const body = await req.json().catch(() => ({})) as { inviteCode?: unknown };
    const pendingToken = req.cookies.get(OAUTH_PENDING_COOKIE)?.value ?? null;

    // ── 1단계: 대기 토큰 확인 (초대코드 대조 **전**) ──────────────────────
    // 시도 제한 키가 이 토큰의 이메일이므로, 코드를 대조하기 전에 신원을 먼저 확정해야
    // 잠금 상태에서 코드 대조 자체를 건너뛸 수 있다(대조 소요시간 누출 차단 — 로그인과 동일).
    const pre = verifyPendingForCompletion(pendingToken, secret);
    if (!pre.ok) {
      return NextResponse.json({ ok: false, error: pre.error }, { status: pre.status });
    }

    const gate = checkLoginGate(gateKey(pre.pending.email));
    if (!gate.allowed) {
      return NextResponse.json(
        { ok: false, error: `시도가 많습니다. ${gate.retryAfterSec}초 후 다시 시도하세요` },
        { status: 429, headers: { 'retry-after': String(gate.retryAfterSec) } },
      );
    }

    // ── 2단계: 전체 관문 ────────────────────────────────────────────────
    // 대기 토큰 → 이메일 검증 재확인 → 초대코드를 **한 함수로** 다시 통과시킨다.
    // (1단계와 검사가 겹치지만, 계정을 만드는 경로는 항상 이 완전한 관문 하나만 보게 해서
    //  라우트가 검사 하나를 빠뜨리는 실수를 구조적으로 막는다)
    const gated = evaluateOAuthCompletion({ pendingToken, secret, inviteCode: body.inviteCode });
    if (!gated.ok) {
      if (gated.reason === 'invite') {
        const fail = registerLoginFailure(gateKey(pre.pending.email));
        console.warn(
          `[oauth] 초대코드 불일치 (${maskEmail(pre.pending.email)}) — 누적 ${fail.fails}회, 계정 생성 안 됨`,
        );
      }
      return NextResponse.json({ ok: false, error: gated.error }, { status: gated.status });
    }

    const pending = gated.pending;

    // 스키마가 아직 전환되지 않았으면 원인을 그대로 말한다 (500 "알 수 없는 오류" 금지).
    if (isOAuthSchemaReady() === false) {
      return NextResponse.json(
        { ok: false, error: '서버 스키마 준비가 끝나지 않았습니다. 관리자에게 문의하세요' },
        { status: 503 },
      );
    }

    // 대기 중 다른 탭/기기에서 같은 신원으로 이미 가입됐을 수 있다.
    const already = await findUserByOAuth(pending.provider, pending.providerId);
    let userId: number;
    if (already) {
      userId = already.id;
    } else {
      try {
        userId = await createOAuthUser({
          email: pending.email,
          provider: pending.provider,
          oauthId: pending.providerId,
        });
      } catch (e) {
        if (isDuplicateOAuthError(e)) {
          const raced = await findUserByOAuth(pending.provider, pending.providerId);
          if (!raced) throw e;
          userId = raced.id;
        } else if (isDuplicateEmailError(e)) {
          // 대기 중에 같은 이메일로 이메일 가입이 완료된 경우. 조용히 붙이지 않는다 —
          // 다시 소셜 로그인하면 연결 경로(link_and_login)를 정상적으로 탄다.
          return clearPending(
            NextResponse.json(
              { ok: false, error: '이미 가입된 이메일입니다. 소셜 로그인을 다시 시도해 주세요' },
              { status: 409 },
            ),
          );
        } else {
          throw e;
        }
      }
    }

    resetLoginGate(gateKey(pending.email));
    console.log(
      `[oauth] 신규 회원 가입 id=${userId} (${maskEmail(pending.email)}) provider=${pending.provider} invite=${gated.inviteGate}`,
    );

    const token = await signSession(secret, userId);
    const res = NextResponse.json({ ok: true, next: pending.nextPath });
    setSessionCookie(res, req, token);
    return clearPending(res);
  } catch (e) {
    console.error('[api/auth/oauth-complete]', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ ok: false, error: '가입 처리 중 오류가 발생했습니다' }, { status: 500 });
  }
}
