/**
 * POST /api/auth/login — PIN 로그인 (Phase 0, 2026-08-02).
 *
 * body: { pin: string }
 * 성공 시 HMAC 서명 세션 쿠키(30일)를 내려준다. 서명 키 = AUTH_PIN.
 *
 * 무인증 통과 경로이므로(middleware) 시도 제한을 자체 적용한다.
 * 제한은 **전역 지수 백오프**(`@/lib/auth/login-gate`) — 클라이언트가 조작 가능한
 * `x-forwarded-for` 를 키로 쓰던 이전 구현은 헤더만 바꾸면 우회됐다.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SEC,
  getAuthPin,
  safeEqualStr,
  signSession,
} from '@/lib/auth/session';
import { checkLoginGate, registerLoginFailure, resetLoginGate } from '@/lib/auth/login-gate';
import { sendAlert } from '@/lib/notify';

export const dynamic = 'force-dynamic';

function lockedResponse(retryAfterSec: number): NextResponse {
  return NextResponse.json(
    { ok: false, error: 'too_many_attempts', detail: `${retryAfterSec}초 후 다시 시도하세요` },
    { status: 429, headers: { 'retry-after': String(retryAfterSec) } },
  );
}

export async function POST(req: NextRequest) {
  try {
    const pin = getAuthPin();
    if (!pin) {
      return NextResponse.json(
        { ok: false, error: 'auth_not_configured', detail: 'AUTH_PIN 설정 필요 — 서버 .env에 AUTH_PIN을 지정하고 재시작하세요' },
        { status: 503 },
      );
    }

    // 잠금 중이면 PIN 대조 자체를 하지 않는다 (대조 소요시간으로 정답 근접도가 새는 것을 막는다).
    const gate = checkLoginGate();
    if (!gate.allowed) return lockedResponse(gate.retryAfterSec);

    const body = await req.json().catch(() => ({})) as { pin?: unknown };
    const given = typeof body.pin === 'string' ? body.pin.trim() : '';

    if (!given || !safeEqualStr(given, pin)) {
      const fail = registerLoginFailure();
      if (fail.lockedNow) {
        const mins = Math.max(1, Math.round(fail.lockMs / 60_000));
        console.error(`[auth] PIN 로그인 ${fail.fails}회 연속 실패 — ${mins}분 잠금`);
        sendAlert(
          'warning',
          'PIN 로그인 잠금',
          `연속 실패 ${fail.fails}회로 로그인을 ${mins}분간 잠갔습니다. 본인이 아니라면 AUTH_PIN 교체를 검토하세요.`,
        );
        return lockedResponse(Math.ceil(fail.lockMs / 1000));
      }
      return NextResponse.json({ ok: false, error: 'invalid_pin' }, { status: 401 });
    }

    resetLoginGate();
    const token = await signSession(pin);
    const res = NextResponse.json({ ok: true });
    res.cookies.set({
      name: SESSION_COOKIE,
      value: token,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_SEC,
      // LAN 내 http 접속(http://<nas>:3003)을 지원해야 하므로 https일 때만 Secure 부여
      secure: (req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(':', '')) === 'https',
    });
    return res;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/auth/login]', error);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
