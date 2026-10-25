/**
 * GET /api/auth/[provider]/callback — 소셜 로그인 콜백 (T-009, 2026-08-08).
 *
 * ★ 가이드(§B-5)·`adapters/nextjs.js:109-111` 와 **의도적으로 다르다**:
 *   가이드는 여기서 JWT 를 서명해 `/oauth/callback?token=...` 으로 리다이렉트하고
 *   프론트가 `localStorage` 에 넣는다. 이 앱은 그렇게 하지 않는다.
 *
 *     1. localStorage 토큰은 XSS 로 읽힌다. 현재 세션 쿠키는 HttpOnly 라 읽히지 않는다
 *        — 도입하면 명백한 **보안 후퇴**다 (T-009 B1)
 *     2. 세션 토큰이 URL 쿼리에 실리면 브라우저 히스토리·Referer·nginx 액세스 로그에
 *        30일짜리 자격증명이 남는다. 증권 자격증명을 쥔 앱에서 허용 불가 (T-009 B2)
 *     3. 세션 메커니즘이 둘로 갈리면 middleware 와 모든 API 라우트가 어느 쪽을 믿을지
 *        모호해진다
 *
 *   → **여기서 기존 `signSession` + `setSessionCookie` 를 그대로 호출한다.**
 *     T-008 의 세션 코드는 한 줄도 바뀌지 않았다. URL 에는 아무것도 싣지 않는다.
 *
 * T-088(앱 "주식캐기" Google 로그인): **서명된 state 에 앱 표지(`pl:'app'`)가 있을 때만** 아래 `handleAppCallback` 으로 갈라진다.
 *   앱 흐름의 이 응답을 받는 것은 Chrome 창(Custom Tab)이라 세션 쿠키를 심어도 앱 WebView 로 가지 않는다 → 세션 대신
 *   60초·1회용 코드(PKCE 결속)를 만들고 `stockinvest://auth/callback?code=` 로 302 한다. 코드는 세션 토큰이 아니다(위 B2 와 양립):
 *   교환 라우트에서 verifier 와 짝이 맞을 때 한 번만 세션으로 바뀐다. 앱 흐름은 **기존 계정만** — 신규 가입·초대는 웹에서만
 *   (`signup_requires_web`). state 가 검증되지 않거나 앱 표지가 없으면 아래 웹 경로가 변경 전과 똑같이 처리한다.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSessionSecret, signSession } from '@/lib/auth/session';
import { setSessionCookie } from '@/lib/auth/session-cookie';
import { isInviteRequired } from '@/lib/auth/signup-gate';
import { isOAuthProviderName, type OAuthProviderName } from '@/lib/auth/oauth/names';
import { buildRedirectUri, getCallbackBase, getProviderCredentials } from '@/lib/auth/oauth/config';
import { OAUTH_STATE_COOKIE, verifyOAuthState } from '@/lib/auth/oauth/state';
import { OAUTH_PENDING_COOKIE, OAUTH_PENDING_MAX_AGE_SEC, signPendingSignup } from '@/lib/auth/oauth/pending';
import { fetchOAuthProfile } from '@/lib/auth/oauth/providers';
import { decideOAuthOutcome } from '@/lib/auth/oauth/decide';
import { findUserByEmail, findUserByOAuth, linkOAuthToUser, maskEmail } from '@/lib/auth/users';
import { issueAppAuthCode, isAppAuthCodeNotMigrated } from '@/lib/auth/oauth/app-code';
import { appDeepLinkRedirect } from '@/lib/auth/oauth/app-response';

export const dynamic = 'force-dynamic';

/** 내부 리다이렉트 URL. 공개 canonical 주소(OAUTH_CALLBACK_BASE)를 우선 쓴다. */
function internalUrl(req: NextRequest, path: string): URL {
  const base = getCallbackBase();
  return new URL(path, base ?? req.nextUrl.origin);
}

function isHttps(req: NextRequest): boolean {
  return (req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(':', '')) === 'https';
}

/**
 * 실패는 **고정 코드**로만 알린다.
 * 가이드는 `msg=${e.message}` 로 제공자 원문을 URL 에 실어 보내는데, 그러면 내부 오류 문구가
 * 그대로 화면·로그·Referer 에 흐른다. 상세는 서버 로그에만 남긴다.
 */
function failRedirect(req: NextRequest, code: string, provider?: string): NextResponse {
  const url = internalUrl(req, '/login');
  url.searchParams.set('oauth_error', code);
  if (provider) url.searchParams.set('provider', provider);
  const res = NextResponse.redirect(url);
  res.cookies.delete(OAUTH_STATE_COOKIE);
  return res;
}

/**
 * T-088 — 앱 흐름 콜백(서명된 state 가 이미 검증됐고 앱 표지가 있는 경우만 온다). 모든 결과는 앱 딥링크로 돌려준다.
 * 세션 쿠키는 심지 않는다. 회원 판정(`decideOAuthOutcome`)·계정 연결은 웹과 같은 함수를 쓴다.
 */
async function handleAppCallback(
  req: NextRequest,
  provider: OAuthProviderName,
  challenge: string,
): Promise<NextResponse> {
  // state 를 만드는 시작 라우트가 Google 만 허용하지만, 서명된 state 와 URL 세그먼트가 같은지까지 verifyOAuthState 가 봤다 — 이중 방어.
  if (provider !== 'google') return appDeepLinkRedirect({ error: 'app_login_invalid' });

  const base = getCallbackBase();
  const creds = getProviderCredentials(provider);
  if (base === null || creds === null) return appDeepLinkRedirect({ error: 'not_configured' });

  const sp = req.nextUrl.searchParams;
  const providerError = sp.get('error');
  if (providerError) {
    console.warn(`[oauth] app ${provider} 제공자 오류/취소: ${providerError}`);
    return appDeepLinkRedirect({ error: providerError === 'access_denied' ? 'cancelled' : 'failed' });
  }
  const code = sp.get('code');
  if (!code) return appDeepLinkRedirect({ error: 'failed' });

  let userId: number;
  try {
    const profile = await fetchOAuthProfile({
      provider,
      code,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      redirectUri: buildRedirectUri(base, provider),
    });
    const [byOAuth, byEmail] = await Promise.all([
      findUserByOAuth(provider, profile.providerId),
      findUserByEmail(profile.email),
    ]);
    const outcome = decideOAuthOutcome({ provider, profile, byOAuth, byEmail, inviteRequired: isInviteRequired() });

    if (outcome.kind === 'reject_unverified') {
      console.warn(`[oauth] app ${provider} 미검증 이메일 거부 (${maskEmail(profile.email)})`);
      return appDeepLinkRedirect({ error: 'email_unverified' });
    }
    // 신규 가입(초대 필요·가입 개방 모두)은 앱에서 하지 않는다 — 대기 쿠키도 심지 않는다(Leader 방침 2).
    if (outcome.kind === 'need_invite' || outcome.kind === 'create') {
      console.log(`[oauth] app ${provider} 연결된 계정 없음 — 웹 가입 안내 (${maskEmail(profile.email)})`);
      return appDeepLinkRedirect({ error: 'signup_requires_web' });
    }
    if (outcome.kind === 'link_and_login') {
      const linked = await linkOAuthToUser(outcome.userId, provider, profile.providerId);
      console.log(`[oauth] app ${provider} 기존 계정 연결 user=${outcome.userId} (${maskEmail(profile.email)}) linked=${linked}`);
    } else if (outcome.kind === 'login_without_relink') {
      console.log(`[oauth] app ${provider} 로그인 — 기존 소셜 연결 유지 user=${outcome.userId} (${maskEmail(profile.email)})`);
    }
    userId = outcome.userId;
  } catch (e) {
    console.error(`[oauth] app ${provider} 콜백 실패:`, e instanceof Error ? e.message : String(e));
    return appDeepLinkRedirect({ error: 'failed' });
  }

  try {
    // 딥링크에는 code_r 만 — DB 에는 challenge 로 결속한 sha256 값만 들어간다. 코드 값은 로그에 남기지 않는다.
    const codeR = await issueAppAuthCode(userId, challenge);
    console.log(`[oauth] app ${provider} 1회용 코드 발급 user=${userId}`);
    return appDeepLinkRedirect({ code: codeR });
  } catch (e) {
    if (isAppAuthCodeNotMigrated(e)) {
      console.error('[oauth] app 로그인 불가 — app_auth_code 테이블 없음(scripts/migrations/T-088-app-auth-code.sql 미적용)');
      return appDeepLinkRedirect({ error: 'not_configured' });
    }
    console.error(`[oauth] app ${provider} 코드 발급 실패:`, e instanceof Error ? e.message : String(e));
    return appDeepLinkRedirect({ error: 'failed' });
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider: raw } = await ctx.params;
  if (!isOAuthProviderName(raw)) {
    return NextResponse.json({ ok: false, error: 'unknown_provider' }, { status: 404 });
  }
  const provider: OAuthProviderName = raw;

  const secret = getSessionSecret();
  if (!secret) return failRedirect(req, 'not_configured', provider);

  // T-088: 서명된 state 에 앱 표지가 있으면 앱 흐름으로. 검증 실패·표지 없음은 아래 웹 경로가 변경 전과 똑같이 처리한다
  //   (verifyOAuthState 는 순수 함수라 여기서 한 번 더 불러도 웹 응답이 달라지지 않는다).
  const appState = verifyOAuthState(
    req.nextUrl.searchParams.get('state'),
    req.cookies.get(OAUTH_STATE_COOKIE)?.value ?? null,
    provider,
    secret,
  );
  if (appState.ok && appState.app) return handleAppCallback(req, provider, appState.app.challenge);

  const base = getCallbackBase();
  const creds = getProviderCredentials(provider);
  if (base === null || creds === null) return failRedirect(req, 'not_configured', provider);

  const sp = req.nextUrl.searchParams;

  // 사용자가 동의 화면에서 취소한 경우도 여기로 온다 — 오류가 아니라 취소로 안내한다.
  const providerError = sp.get('error');
  if (providerError) {
    console.warn(`[oauth] ${provider} 제공자 오류/취소: ${providerError}`);
    return failRedirect(req, providerError === 'access_denied' ? 'cancelled' : 'failed', provider);
  }

  const code = sp.get('code');
  if (!code) return failRedirect(req, 'failed', provider);

  const stateCheck = verifyOAuthState(
    sp.get('state'),
    req.cookies.get(OAUTH_STATE_COOKIE)?.value ?? null,
    provider,
    secret,
  );
  if (!stateCheck.ok) {
    console.warn(`[oauth] ${provider} state 검증 실패: ${stateCheck.reason}`);
    return failRedirect(req, 'invalid_state', provider);
  }

  try {
    const profile = await fetchOAuthProfile({
      provider,
      code,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      redirectUri: buildRedirectUri(base, provider),
    });

    const [byOAuth, byEmail] = await Promise.all([
      findUserByOAuth(provider, profile.providerId),
      findUserByEmail(profile.email),
    ]);

    const outcome = decideOAuthOutcome({
      provider,
      profile,
      byOAuth,
      byEmail,
      inviteRequired: isInviteRequired(),
    });

    // ── 미검증 이메일 거부 (T-009 B3 — 계정 탈취 방지의 핵심) ──────────────
    if (outcome.kind === 'reject_unverified') {
      console.warn(
        `[oauth] ${provider} 미검증 이메일 거부 (${maskEmail(profile.email)}) — 기존 계정 연결·신규 생성 모두 차단`,
      );
      return failRedirect(req, 'email_unverified', provider);
    }

    // ── 신규 가입: 계정을 **여기서 만들지 않는다** (초대코드 게이트, D1=A) ──
    if (outcome.kind === 'need_invite') {
      const url = internalUrl(req, '/oauth/invite');
      const res = NextResponse.redirect(url);
      res.cookies.delete(OAUTH_STATE_COOKIE);
      res.cookies.set({
        name: OAUTH_PENDING_COOKIE,
        value: signPendingSignup(secret, provider, profile, stateCheck.nextPath),
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: OAUTH_PENDING_MAX_AGE_SEC,
        secure: isHttps(req),
      });
      console.log(`[oauth] ${provider} 신규 — 초대코드 대기 (${maskEmail(profile.email)})`);
      return res;
    }

    // ── 초대코드 미설정(가입 개방) 상태의 신규 가입 ──────────────────────
    // 이메일 가입과 동일한 규칙이다: 코드가 없으면 입력 화면도 없다.
    // (signup-gate 가 이 상태를 부팅·시도마다 크게 경고한다)
    if (outcome.kind === 'create') {
      const url = internalUrl(req, '/oauth/invite');
      const res = NextResponse.redirect(url);
      res.cookies.delete(OAUTH_STATE_COOKIE);
      res.cookies.set({
        name: OAUTH_PENDING_COOKIE,
        value: signPendingSignup(secret, provider, profile, stateCheck.nextPath),
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: OAUTH_PENDING_MAX_AGE_SEC,
        secure: isHttps(req),
      });
      return res;
    }

    // ── 기존 계정에 연결 ────────────────────────────────────────────────
    if (outcome.kind === 'link_and_login') {
      const linked = await linkOAuthToUser(outcome.userId, provider, profile.providerId);
      console.log(
        `[oauth] ${provider} 기존 계정 연결 user=${outcome.userId} (${maskEmail(profile.email)}) linked=${linked}`,
      );
    } else if (outcome.kind === 'login_without_relink') {
      console.log(
        `[oauth] ${provider} 로그인 — 기존 소셜 연결 유지 user=${outcome.userId} (${maskEmail(profile.email)})`,
      );
    }

    // ── 세션 발급: 기존 HMAC 쿠키 그대로 (JWT·URL 토큰 없음) ─────────────
    const token = await signSession(secret, outcome.userId);
    const res = NextResponse.redirect(internalUrl(req, stateCheck.nextPath));
    res.cookies.delete(OAUTH_STATE_COOKIE);
    setSessionCookie(res, req, token);
    return res;
  } catch (e) {
    // 제공자 원문 오류는 서버 로그에만. 사용자에겐 고정 코드만 준다.
    console.error(`[oauth] ${provider} 콜백 실패:`, e instanceof Error ? e.message : String(e));
    return failRedirect(req, 'failed', provider);
  }
}
