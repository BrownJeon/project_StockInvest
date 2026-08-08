/**
 * `@workspace/auth-oauth` 타입 선언 (T-009, 2026-08-08).
 *
 * 공유 패키지는 순수 CommonJS JS 이고 `types` 필드가 없다. 이 프로젝트는
 * `allowJs: false` 이므로 선언이 없으면 import 자체가 타입 오류다.
 *
 * ⚠️ **여기 선언한 모듈만 쓴다.** 특히 `adapters/*` 와 `core/state` 는 의도적으로 선언하지 않았다:
 *    두 모듈은 `jsonwebtoken` 을 require 하는데 이 프로젝트에는 설치돼 있지 않고(package-lock
 *    확인), 세션도 JWT 가 아니라 기존 HMAC 쿠키를 쓰기로 확정됐다(T-009 B1·B2).
 *    선언을 두지 않는 것 자체가 "실수로 그 경로를 타지 못하게" 하는 컴파일 타임 가드다.
 */

declare module '@workspace/auth-oauth/providers/google' {
  const provider: import('@/lib/auth/oauth/provider-types').SharedOAuthProvider;
  export = provider;
}

declare module '@workspace/auth-oauth/providers/github' {
  const provider: import('@/lib/auth/oauth/provider-types').SharedOAuthProvider;
  export = provider;
}

declare module '@workspace/auth-oauth/core/exchange' {
  export function postForm(url: string, params: Record<string, string>): Promise<Record<string, unknown>>;
  export function getJson(
    url: string,
    accessToken: string,
    extraHeaders?: Record<string, string>,
  ): Promise<unknown>;
}
