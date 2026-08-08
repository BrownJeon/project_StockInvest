/**
 * 회원가입 — 이메일 + 비밀번호 (+ 초대 코드) (T-008 Step 1, 2026-08-07).
 *
 * 사용자 결정 Q1: **가입 화면은 이메일·비밀번호만 받는다.** KIS 키 연결은 로그인 후
 * 프로필의 "계좌 연결" 흐름에서 실검증과 함께 처리한다.
 *
 * 그 결정의 부작용을 메우는 장치가 `SIGNUP_INVITE_CODE` 다 — 설계문서는 "KIS 키 실검증이
 * 사실상의 가입 제한"이라는 이유로 관리자 승인제를 범위 밖으로 뒀는데(문서 line 28),
 * KIS 를 가입에서 빼면서 그 제한이 사라졌다. 이 앱은 인터넷에 열린 vhost 다.
 *   - 코드 설정됨   → 일치해야 가입
 *   - 코드 미설정   → 가입 개방 + 부팅·시도마다 경고 로그
 *
 * GET  : { ok, inviteRequired } — 가입 화면이 초대 코드 입력칸 표시 여부를 정하는 데 쓴다.
 * POST : { email, password, inviteCode? } → 성공 시 세션 쿠키 발급(자동 로그인)
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSessionSecret, signSession } from '@/lib/auth/session';
import { setSessionCookie } from '@/lib/auth/session-cookie';
import { checkSignupInvite, isInviteRequired, warnIfSignupOpen } from '@/lib/auth/signup-gate';
import { hashPassword, validatePassword } from '@/lib/auth/password';
import {
  createUser,
  isDuplicateEmailError,
  isValidEmail,
  maskEmail,
  normalizeEmail,
} from '@/lib/auth/users';
import { checkLoginGate, registerLoginFailure, resetLoginGate } from '@/lib/auth/login-gate';
import { isAuthBodyTooLarge } from '@/lib/auth/request-limits';

export const dynamic = 'force-dynamic';

/** 초대 코드 시도 제한 키 — 로그인 게이트와 분리한다(가입 실패가 로그인을 잠그면 안 된다). */
function signupGateKey(email: string): string {
  return `signup:${email}`;
}

export async function GET() {
  warnIfSignupOpen();
  return NextResponse.json({ ok: true, inviteRequired: isInviteRequired() });
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

    // 로그인과 동일 — 파싱 전에 본문 크기를 본다 (무인증 공개 경로).
    if (isAuthBodyTooLarge(req)) {
      return NextResponse.json({ ok: false, error: '요청이 너무 큽니다' }, { status: 413 });
    }

    const body = await req.json().catch(() => ({})) as {
      email?: unknown; password?: unknown; inviteCode?: unknown;
    };
    const email = normalizeEmail(body.email);

    // 초대 코드 시도도 백오프를 받는다 (이메일별). 잠금 중엔 코드 대조 자체를 하지 않는다.
    const gate = checkLoginGate(signupGateKey(email));
    if (!gate.allowed) {
      return NextResponse.json(
        { ok: false, error: `시도가 많습니다. ${gate.retryAfterSec}초 후 다시 시도하세요` },
        { status: 429, headers: { 'retry-after': String(gate.retryAfterSec) } },
      );
    }

    // 1) 초대 코드 — 가장 먼저 본다.
    //    이메일 중복 응답(409)은 "그 주소가 가입돼 있다"를 알려주므로, 초대 코드를 통과한
    //    사람만 그 정보를 볼 수 있게 순서를 고정한다.
    const invite = checkSignupInvite(body.inviteCode);
    if (!invite.ok) {
      const fail = registerLoginFailure(signupGateKey(email));
      console.warn(`[auth] 회원가입 초대 코드 불일치 (${maskEmail(email) || 'unknown'}) — 누적 ${fail.fails}회`);
      return NextResponse.json({ ok: false, error: invite.error }, { status: 403 });
    }

    // 2) 입력 검증
    if (!isValidEmail(email)) {
      return NextResponse.json({ ok: false, error: '올바른 이메일 주소를 입력하세요' }, { status: 400 });
    }
    const pw = validatePassword(body.password);
    if (!pw.ok) {
      return NextResponse.json({ ok: false, error: pw.error }, { status: 400 });
    }

    // 3) 생성 — 중복은 UNIQUE 제약이 최종 판정자다(사전 SELECT 와 INSERT 사이의 경쟁 방지)
    const passwordHash = await hashPassword(pw.password);
    let userId: number;
    try {
      userId = await createUser(email, passwordHash);
    } catch (e) {
      if (isDuplicateEmailError(e)) {
        return NextResponse.json(
          { ok: false, error: '이미 가입된 이메일입니다. 로그인하거나 다른 주소를 사용하세요' },
          { status: 409 },
        );
      }
      throw e;
    }

    resetLoginGate(signupGateKey(email));
    console.log(`[auth] 신규 회원 가입 id=${userId} (${maskEmail(email)}) invite=${invite.gate}`);

    // 4) 자동 로그인
    const token = await signSession(secret, userId);
    const res = NextResponse.json({ ok: true });
    setSessionCookie(res, req, token);
    return res;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/auth/signup]', error);
    return NextResponse.json({ ok: false, error: '가입 처리 중 오류가 발생했습니다' }, { status: 500 });
  }
}
