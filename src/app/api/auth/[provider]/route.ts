/**
 * GET /api/auth/[provider] — 소셜 로그인 시작 (T-009, 2026-08-08).
 *
 * 제공자 인가 화면으로 302. 그 전에 CSRF state 를 만들어
 *   - 쿼리 `state` 로 제공자에게 보내고
 *   - nonce 를 HttpOnly 쿠키에 심는다
 * 콜백에서 둘이 일치할 때만 통과시킨다(로그인 CSRF 방지).
 *
 * ⚠️ 이 동적 라우트는 기존 정적 라우트(`/api/auth/login` · `signup` · `logout`)와 같은
 *    레벨에 있다. Next.js App Router 는 **정적 세그먼트를 동적보다 우선**하므로 기존
 *    경로는 그대로 동작한다. 그래도 라우팅 우선순위 하나에 인증 동작을 걸지 않으려고,
 *    아래에서 프로바이더 이름을 화이트리스트로 다시 검사한다(목록 밖은 전부 404).
 *
 * T-088: `platform=app`(앱 "주식캐기" 의 Chrome 창 로그인)이면 아래 `startAppLogin` 으로 갈라진다 — **정확히 `app` 일 때만**.
 *   앱 흐름은 Google 만, PKCE `challenge`(43자 base64url) 필수, state 에 `pl:'app'`·`ch` 를 서명해 싣는다. 형식이 틀리면 앱 딥링크로
 *   `app_login_invalid` 를 돌려준다(Chrome 창에 JSON 을 남기지 않는다). 그 밖의 요청(파라미터 없음·다른 값)은 아래 웹 경로 그대로다.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSessionSecret } from '@/lib/auth/session';
import { isOAuthProviderName, type OAuthProviderName } from '@/lib/auth/oauth/names';
import { buildRedirectUri, getCallbackBase, getProviderCredentials, sanitizeNextPath } from '@/lib/auth/oauth/config';
import { OAUTH_STATE_COOKIE, OAUTH_STATE_MAX_AGE_SEC, createAppOAuthState, createOAuthState } from '@/lib/auth/oauth/state';
import { buildAuthorizeUrl } from '@/lib/auth/oauth/providers';
import { isPkceChallenge } from '@/lib/auth/oauth/pkce';
import { sanitizeAppNextPath } from '@/lib/auth/oauth/app-flow';
import { appDeepLinkRedirect } from '@/lib/auth/oauth/app-response';

export const dynamic = 'force-dynamic';

/**
 * T-088 — 앱 로그인 시작. 웹 경로와 같은 state 쿠키·인가 주소를 쓰되 state 에 앱 표지와 challenge 를 서명해 싣는다.
 * 실패는 전부 앱 딥링크 오류로 돌려준다 — 이 응답을 받는 것은 Chrome 창(Custom Tab)이고, 딥링크가 앱을 다시 앞으로 부른다.
 */
function startAppLogin(req: NextRequest, provider: OAuthProviderName): NextResponse {
  const sp = req.nextUrl.searchParams;
  // 앱 로그인은 Google 만(Leader 방침 1) — GitHub 등은 웹에서만.
  if (provider !== 'google') return appDeepLinkRedirect({ error: 'app_login_invalid' });
  const challenge = sp.get('challenge');
  if (!isPkceChallenge(challenge)) return appDeepLinkRedirect({ error: 'app_login_invalid' });

  const secret = getSessionSecret();
  const base = getCallbackBase();
  const creds = getProviderCredentials(provider);
  if (!secret || base === null || creds === null) return appDeepLinkRedirect({ error: 'not_configured' });

  // 앱 흐름의 착지 경로는 교환 응답이 다시 정한다(교환 본문의 next 를 sanitizeAppNextPath). 여기서는 state 에 같은 규칙의 값만 남긴다.
  const { state, nonce } = createAppOAuthState(secret, provider, sanitizeAppNextPath(sp.get('next')), challenge);

  const res = NextResponse.redirect(
    buildAuthorizeUrl({ provider, clientId: creds.clientId, redirectUri: buildRedirectUri(base, provider), state }),
  );
  // 웹 경로(아래 GET)와 같은 속성 — 제공자에서 돌아오는 최상위 이동에 실려야 하므로 lax.
  res.cookies.set({
    name: OAUTH_STATE_COOKIE,
    value: nonce,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: OAUTH_STATE_MAX_AGE_SEC,
    secure: (req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(':', '')) === 'https',
  });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;

  if (!isOAuthProviderName(provider)) {
    return NextResponse.json({ ok: false, error: 'unknown_provider' }, { status: 404 });
  }

  // T-088: 앱 흐름은 여기서 갈라진다(정확히 platform=app 일 때만). 아래는 변경 전 웹 경로 그대로.
  if (req.nextUrl.searchParams.get('platform') === 'app') return startAppLogin(req, provider);

  const secret = getSessionSecret();
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: 'auth_not_configured', detail: 'AUTH_SESSION_SECRET 설정 필요' },
      { status: 503 },
    );
  }

  // 가이드 §G 와 동일한 동작 — 자격증명 미설정이면 503.
  // (화면은 애초에 버튼을 렌더하지 않으므로 정상 사용자는 여기 도달하지 않는다)
  const base = getCallbackBase();
  const creds = getProviderCredentials(provider);
  if (base === null || creds === null) {
    return NextResponse.json(
      { ok: false, error: 'provider_not_configured', detail: `${provider} OAuth 가 설정되지 않았습니다` },
      { status: 503 },
    );
  }

  const nextPath = sanitizeNextPath(req.nextUrl.searchParams.get('next'));
  const { state, nonce } = createOAuthState(secret, provider, nextPath);

  const res = NextResponse.redirect(
    buildAuthorizeUrl({
      provider,
      clientId: creds.clientId,
      redirectUri: buildRedirectUri(base, provider),
      state,
    }),
  );
  res.cookies.set({
    name: OAUTH_STATE_COOKIE,
    value: nonce,
    httpOnly: true,
    // 제공자 도메인에서 **되돌아오는** 최상위 네비게이션에 쿠키가 실려야 한다.
    // `strict` 면 그 요청에 쿠키가 붙지 않아 정상 로그인이 전부 실패한다.
    sameSite: 'lax',
    path: '/',
    maxAge: OAUTH_STATE_MAX_AGE_SEC,
    secure: (req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(':', '')) === 'https',
  });
  return res;
}
