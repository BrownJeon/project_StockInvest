/**
 * POST /api/auth/logout — 세션 쿠키 제거 (Phase 0, 2026-08-02).
 * 무인증 통과 경로 — 만료·위조 쿠키 상태에서도 정리할 수 있어야 한다.
 */
import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set({ name: SESSION_COOKIE, value: '', httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  return res;
}
