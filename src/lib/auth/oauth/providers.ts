/**
 * 공유 패키지 프로바이더 어댑터 (T-009, 2026-08-08).
 *
 * 공유 패키지에서 **가져오는 것은 `providers/*` 와 `core/exchange` 뿐**이다.
 * `adapters/nextjs` 는 쓰지 않는다 — 그 콜백이 JWT 를 서명해 `?token=` 쿼리로
 * 리다이렉트하는데(T-009 B1·B2), 이 앱은 이미 HttpOnly HMAC 쿠키 세션을 쓰고
 * localStorage 토큰은 XSS 로 읽히는 명백한 보안 후퇴이기 때문이다.
 * (부수 효과로 `jsonwebtoken` 의존성도 필요 없어진다 — 이 프로젝트엔 설치돼 있지 않다.)
 */
import googleProvider from '@workspace/auth-oauth/providers/google';
import githubProvider from '@workspace/auth-oauth/providers/github';
import { getJson, postForm } from '@workspace/auth-oauth/core/exchange';
import type { OAuthProviderName } from '@/lib/auth/oauth/names';
import type { OAuthProfile, SharedOAuthProvider } from '@/lib/auth/oauth/provider-types';
import { trackCall, type ApiId } from '@/lib/api-usage';

/** T-040 호출 기록용 API id — 제공자 이름(코드 상수)에서만 고른다. */
const USAGE_API: Record<OAuthProviderName, ApiId> = { google: 'google-oauth', github: 'github-oauth' };

const SHARED: Record<OAuthProviderName, SharedOAuthProvider> = {
  google: googleProvider,
  github: githubProvider,
};

export function getSharedProvider(provider: OAuthProviderName): SharedOAuthProvider {
  return SHARED[provider];
}

/**
 * 공유 패키지의 정규화 결과 → 이 앱이 쓰는 확정 형태.
 *
 * `emailVerified` 는 **`=== true` 일 때만 true** 다. 필드가 없거나(구버전 패키지),
 * 문자열 `"false"` 같은 값이 와도 전부 false 로 떨어진다 — 이 값 하나로 "기존 계정에
 * 연결할지"가 갈리므로 모르는 상태는 미검증으로 취급한다(fail-closed).
 */
export function normalizeSharedProfile(provider: OAuthProviderName, raw: unknown): OAuthProfile {
  const p = getSharedProvider(provider).normalizeProfile(raw);
  const email = typeof p.email === 'string' ? p.email.trim().toLowerCase() : '';
  if (email.length === 0) throw new Error(`${provider}: 프로필에 이메일이 없습니다`);
  const providerId = typeof p.providerId === 'string' ? p.providerId : String(p.providerId ?? '');
  if (providerId.length === 0) throw new Error(`${provider}: 프로필에 providerId 가 없습니다`);

  return {
    providerId,
    email,
    name: typeof p.name === 'string' && p.name.length > 0 ? p.name : email,
    avatar: typeof p.avatar === 'string' && p.avatar.length > 0 ? p.avatar : null,
    emailVerified: p.emailVerified === true,
  };
}

/** 인가 코드 → 프로필. 실패는 그대로 throw 하고 호출부(콜백 라우트)가 일반 오류로 수렴시킨다. */
export async function fetchOAuthProfile(args: {
  provider: OAuthProviderName;
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<OAuthProfile> {
  const shared = getSharedProvider(args.provider);
  const api = USAGE_API[args.provider];
  // T-040 호출 기록 — 코드·토큰·프로필은 남기지 않는다. 공용 패키지 함수는 HTTP 실패를 던지므로
  // 성공 판정은 예외 여부로만 한다(ok 를 true 로 고정). 단, 반환 객체에 정수 `status`(100..599)
  // 필드가 있으면 그 숫자는 status 로 남는다(패키지 해석 규칙) — Google·GitHub 응답엔 그런 필드가 없다.
  const tokenData = await trackCall(api, 'token.exchange', () => postForm(shared.tokenUrl, {
    client_id: args.clientId,
    client_secret: args.clientSecret,
    code: args.code,
    redirect_uri: args.redirectUri,
    grant_type: 'authorization_code',
  }), { ok: () => true });
  const accessToken = tokenData?.access_token;
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new Error('토큰 응답에 access_token 이 없습니다');
  }
  const rawProfile = await trackCall(api, 'profile.get',
    () => shared.getProfile(accessToken, tokenData, { getJson }), { ok: () => true });
  return normalizeSharedProfile(args.provider, rawProfile);
}

/** 제공자 인가 화면 URL. */
export function buildAuthorizeUrl(args: {
  provider: OAuthProviderName;
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const shared = getSharedProvider(args.provider);
  const url = new URL(shared.authUrl);
  url.searchParams.set('client_id', args.clientId);
  url.searchParams.set('redirect_uri', args.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', shared.scope);
  url.searchParams.set('state', args.state);
  for (const [k, v] of Object.entries(shared.extraAuthParams ?? {})) url.searchParams.set(k, v);
  return url.toString();
}
