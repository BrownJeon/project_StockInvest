/**
 * 전역 인증 미들웨어 — Phase 0 (2026-08-02).
 *
 * 배경: 71개 API 라우트 중 61개가 무인증이었고 `0.0.0.0` 바인딩이라
 *       LAN 상의 누구나 `PATCH /api/settings/safety`로 DRY_RUN을 원격 해제할 수 있었다.
 *
 * 실행 환경: **Edge Runtime**. `node:crypto`·`mysql2` 등 Node 전용 모듈 import 금지.
 *            서명 검증은 Web Crypto 기반 `@/lib/auth/session`만 사용하고, 상태는 환경변수만 읽는다.
 *
 * 규칙:
 *  1) 무인증 통과   : /api/health, /login, /signup, /api/auth/*(login·signup·logout), /_next/*, 정적 자산
 *  2) /api/cron/*   : `x-cron-secret` 헤더 == `CRON_SECRET` (미설정 시 전면 거부 — fail-closed)
 *                     라우트 내부 checkCronAuth 는 그대로 유지 (이중 방어)
 *  3) 그 외 전부    : HMAC 서명 세션 쿠키 검증. 실패 시 API는 401 JSON, 페이지는 /login 리다이렉트
 *  4) AUTH_SESSION_SECRET 미설정 : 보호 라우트 전부 503 (fail-closed). health/login/signup 은 예외.
 *
 * T-008(2026-08-07): 세션 서명 키가 `AUTH_PIN` → `AUTH_SESSION_SECRET` 으로 바뀌었고
 * 회원가입 경로(`/signup`, `/api/auth/signup`)가 공개 경로에 추가됐다.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE, getSessionSecret, verifySession } from '@/lib/auth/session';
import { OAUTH_PUBLIC_PATHS } from '@/lib/auth/oauth/names';

/**
 * 인증 없이 통과시키는 정확 경로.
 *
 * T-009: 소셜 로그인 경로가 추가됐다. 전부 **로그인 전** 상태에서 호출되므로 공개여야 한다.
 *   - `/api/auth/{google,github}` · `.../callback` : 리다이렉트 진입점과 제공자 콜백
 *   - `/api/auth/oauth-providers`                  : 노출할 버튼 목록 (로그인 화면이 호출)
 *   - `/api/auth/oauth-pending` · `oauth-complete`  : 초대코드 화면과 그 제출
 *   - `/oauth/invite`                              : 초대코드 화면 자체
 * `/api/auth/` 를 prefix 로 통째로 열지 않는다 — 앞으로 추가될 인증 라우트가 실수로
 * 함께 열리는 것을 막기 위해 경로를 하나씩 명시한다.
 *
 * T-010: 가입 요청 경로가 추가됐다. 초대코드가 **없는** 외부인이 쓰는 화면이므로 공개여야 한다.
 *   - `/signup/request`             : 가입 요청 폼
 *   - `/api/auth/signup-request`    : 폼 제출(POST) + 기능 활성 여부 조회(GET)
 */
const PUBLIC_EXACT = new Set<string>([
  '/api/health',
  '/login',
  '/signup',
  '/signup/request',
  '/api/auth/login',
  '/api/auth/signup',
  '/api/auth/signup-request',
  '/api/auth/logout',
  ...OAUTH_PUBLIC_PATHS,
  '/api/auth/oauth-providers',
  '/api/auth/oauth-pending',
  '/api/auth/oauth-complete',
  '/oauth/invite',
  '/favicon.ico',
  '/robots.txt',
  '/manifest.json',
  '/manifest.webmanifest',
  '/apple-touch-icon.png',
]);

/** 인증 없이 통과시키는 경로 prefix (정적 자산) */
const PUBLIC_PREFIX = [
  '/_next/',
  '/__nextjs',   // dev overlay
  '/static/',
];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIX.some((p) => pathname.startsWith(p));
}

function jsonError(status: number, error: string, detail?: string): NextResponse {
  return NextResponse.json({ ok: false, error, ...(detail ? { detail } : {}) }, { status });
}

/** AUTH_SESSION_SECRET 미설정 안내 (페이지용 최소 HTML) */
function authNotConfiguredPage(): NextResponse {
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>설정 필요</title></head>
<body style="margin:0;background:#0f1115;color:#e6e8ee;font-family:ui-sans-serif,system-ui,-apple-system,'Noto Sans KR',sans-serif">
<div style="max-width:412px;margin:0 auto;padding:24px 16px">
<h1 style="font-size:18px;margin:0 0 12px">AUTH_SESSION_SECRET 설정 필요</h1>
<p style="font-size:14px;line-height:1.6;color:#8b93a7;margin:0">
서버 <code>.env</code> 에 <code>AUTH_SESSION_SECRET</code> 을 설정한 뒤 앱을 재시작하세요.
설정 전까지 모든 보호 라우트는 차단됩니다 (fail-closed).
</p></div></body></html>`;
  return new NextResponse(html, {
    status: 503,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // 1) 무인증 통과
  if (isPublicPath(pathname)) return NextResponse.next();

  const isApi = pathname.startsWith('/api/');

  // 2) cron — 헤더 시크릿만으로 통과 (세션 불필요). fail-closed.
  if (pathname.startsWith('/api/cron/')) {
    const secret = process.env.CRON_SECRET;
    const given = req.headers.get('x-cron-secret');
    if (!secret || !given || given !== secret) {
      return jsonError(401, 'unauthorized', 'x-cron-secret required');
    }
    return NextResponse.next();
  }

  // 4) AUTH_SESSION_SECRET 미설정 → 전면 차단
  const secret = getSessionSecret();
  if (!secret) {
    return isApi
      ? jsonError(503, 'auth_not_configured', 'AUTH_SESSION_SECRET 설정 필요 — 서버 .env에 지정하고 재시작하세요')
      : authNotConfiguredPage();
  }

  // 3) 세션 쿠키 검증
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const result = await verifySession(token, secret);
  if (result.ok) return NextResponse.next();

  if (isApi) {
    return jsonError(401, 'unauthorized', `session ${result.reason}`);
  }
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  url.searchParams.set('next', `${pathname}${search}`);
  const res = NextResponse.redirect(url);
  // 만료·위조 쿠키는 즉시 제거해 리다이렉트 루프를 방지
  if (token) res.cookies.delete(SESSION_COOKIE);
  return res;
}

export const config = {
  // 정적 자산·이미지 최적화 경로는 미들웨어 자체를 태우지 않는다 (성능).
  // 나머지 판정은 위 isPublicPath 에서 처리.
  matcher: ['/((?!_next/static|_next/image).*)'],
};
