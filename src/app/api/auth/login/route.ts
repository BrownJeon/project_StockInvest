/**
 * POST /api/auth/login — 이메일·비밀번호 로그인 (Phase 0 PIN → T-008 회원제, 2026-08-07).
 *
 * body: { email: string, password: string }
 * 성공 시 HMAC 서명 세션 쿠키(30일). 서명 키 = `AUTH_SESSION_SECRET`, payload.sub = 회원 id.
 *
 * 무인증 통과 경로이므로(middleware) 시도 제한을 자체 적용한다 —
 * **이메일별** 지수 백오프(`@/lib/auth/login-gate`).
 *
 * 🔒 이메일 열거 방지 3종:
 *   1) 실패 사유를 구분하지 않는다 — 미가입/비밀번호 오류 모두 "이메일 또는 비밀번호"
 *   2) 미가입 이메일에도 더미 해시로 **동일한 scrypt 비용**을 치른다 (응답 시간 차이 제거)
 *   3) 알림에 실이메일을 넣지 않는다 (마스킹)
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSessionSecret, signSession } from '@/lib/auth/session';
import { setSessionCookie } from '@/lib/auth/session-cookie';
import { DUMMY_PASSWORD_HASH, exceedsPasswordLengthCap, verifyPassword } from '@/lib/auth/password';
import { isAuthBodyTooLarge } from '@/lib/auth/request-limits';
import { findUserByEmail, maskEmail, normalizeEmail } from '@/lib/auth/users';
import { checkLoginGate, registerLoginFailure, resetLoginGate } from '@/lib/auth/login-gate';
import { sendAlert } from '@/lib/notify';

export const dynamic = 'force-dynamic';

/** 어떤 실패든 동일한 응답 — 어느 쪽이 틀렸는지 알려주지 않는다. */
const GENERIC_FAIL = { ok: false as const, error: 'invalid_credentials', detail: '이메일 또는 비밀번호가 올바르지 않습니다' };

function lockedResponse(retryAfterSec: number): NextResponse {
  return NextResponse.json(
    { ok: false, error: 'too_many_attempts', detail: `${retryAfterSec}초 후 다시 시도하세요` },
    { status: 429, headers: { 'retry-after': String(retryAfterSec) } },
  );
}

export async function POST(req: NextRequest) {
  try {
    const secret = getSessionSecret();
    if (!secret) {
      return NextResponse.json(
        { ok: false, error: 'auth_not_configured', detail: 'AUTH_SESSION_SECRET 설정 필요 — 서버 .env에 지정하고 재시작하세요' },
        { status: 503 },
      );
    }

    // 파싱 전에 본문 크기를 본다 — 거대한 본문은 읽는 순간 메모리에 통째로 올라온다.
    if (isAuthBodyTooLarge(req)) {
      return NextResponse.json({ ok: false, error: 'payload_too_large', detail: '요청이 너무 큽니다' }, { status: 413 });
    }

    const body = await req.json().catch(() => ({})) as { email?: unknown; password?: unknown };
    const email = normalizeEmail(body.email);
    const password = typeof body.password === 'string' ? body.password : '';

    // 잠금 중이면 비밀번호 대조 자체를 하지 않는다 (대조 소요시간 누출 차단).
    const gate = checkLoginGate(email);
    if (!gate.allowed) return lockedResponse(gate.retryAfterSec);

    // scrypt 로 넘기기 **전에** 길이 상한을 적용한다 (reviewer HIGH — KDF 자원고갈).
    //   - 최소 길이는 여기서 강제하지 않는다: 정책이 바뀌어도 기존 회원은 로그인할 수 있어야 한다
    //   - 상한 초과는 계정 존재 여부와 **무관하게** 동일한 GENERIC_FAIL 로 떨어진다.
    //     응답이 빨라지는 것은 공격자 자신의 입력 길이 때문이지 계정 유무 때문이 아니므로
    //     이메일 열거 방어는 그대로 유지된다.
    if (exceedsPasswordLengthCap(password)) {
      registerLoginFailure(email);
      return NextResponse.json(GENERIC_FAIL, { status: 401 });
    }

    const user = email.length > 0 ? await findUserByEmail(email) : null;

    // 미가입이어도 동일한 KDF 비용을 치른다 — 응답 시간으로 가입 여부가 새지 않게.
    const passwordOk = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);

    if (!user || !passwordOk) {
      const fail = registerLoginFailure(email);
      if (fail.lockedNow) {
        const mins = Math.max(1, Math.round(fail.lockMs / 60_000));
        console.error(`[auth] 로그인 ${fail.fails}회 연속 실패 (${maskEmail(email) || 'unknown'}) — ${mins}분 잠금`);
        sendAlert(
          'warning',
          '로그인 잠금',
          `계정 ${maskEmail(email) || '(빈 이메일)'} 의 연속 실패 ${fail.fails}회로 ${mins}분간 잠갔습니다. ` +
          `본인이 아니라면 해당 회원의 비밀번호 변경을 검토하세요.`,
        );
        return lockedResponse(Math.ceil(fail.lockMs / 1000));
      }
      return NextResponse.json(GENERIC_FAIL, { status: 401 });
    }

    resetLoginGate(email);
    const token = await signSession(secret, user.id);
    const res = NextResponse.json({ ok: true });
    setSessionCookie(res, req, token);
    return res;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/auth/login]', error);
    return NextResponse.json({ ok: false, error: '로그인 처리 중 오류가 발생했습니다' }, { status: 500 });
  }
}
