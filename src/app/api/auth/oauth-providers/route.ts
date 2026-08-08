/**
 * GET /api/auth/oauth-providers — 화면에 노출할 소셜 버튼 목록 (T-009, 2026-08-08).
 *
 * **OAuth 앱을 등록하지 않은 프로바이더는 버튼 자체가 렌더되지 않아야 한다**(목업 확정).
 * 화면이 자체 판단하면 서버의 "설정됨" 기준과 갈라지므로, 서버가 목록을 준다.
 *
 * 자격증명은 물론 "어떤 env 가 비었는지"도 돌려주지 않는다 — 이름 목록만 나간다.
 * 무인증 공개 경로다(로그인 화면이 로그인 전에 호출한다).
 */
import { NextResponse } from 'next/server';
import { enabledProviders } from '@/lib/auth/oauth/config';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    { ok: true, providers: enabledProviders() },
    { headers: { 'cache-control': 'no-store' } },
  );
}
