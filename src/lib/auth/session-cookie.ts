/**
 * 세션 쿠키 발급 공통 헬퍼 (T-008, 2026-08-07).
 * 로그인·회원가입 두 경로가 **정확히 같은 쿠키 속성**을 쓰도록 한 곳에 모은다.
 */
import type { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE, SESSION_MAX_AGE_SEC } from '@/lib/auth/session';

export function setSessionCookie(res: NextResponse, req: NextRequest, token: string): void {
  res.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SEC,
    // LAN 내 http 접속(http://<nas>:3003)도 지원해야 하므로 https 일 때만 Secure 를 붙인다.
    secure: (req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(':', '')) === 'https',
  });
}
