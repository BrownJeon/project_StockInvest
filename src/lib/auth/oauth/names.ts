/**
 * OAuth 프로바이더 이름 — **의존성 0** 모듈 (T-009, 2026-08-08).
 *
 * `src/middleware.ts` 는 Edge Runtime 이라 `node:crypto`·`mysql2` 를 import 할 수 없다.
 * 미들웨어와 서버 라우트가 같은 목록을 보게 하려면 목록만 든 파일이 따로 있어야 한다
 * (config.ts 는 process.env 만 읽지만, 앞으로 Node 전용 코드가 붙어도 미들웨어가 깨지지
 *  않도록 경계를 여기서 미리 끊어 둔다).
 */

export const OAUTH_PROVIDERS = ['google', 'github'] as const;

export type OAuthProviderName = (typeof OAUTH_PROVIDERS)[number];

export function isOAuthProviderName(v: unknown): v is OAuthProviderName {
  return typeof v === 'string' && (OAUTH_PROVIDERS as readonly string[]).includes(v);
}

/** 화면·안내 문구에 쓰는 표기 (예: "Google 로 가입된 계정입니다"). */
export const OAUTH_PROVIDER_LABEL: Record<OAuthProviderName, string> = {
  google: 'Google',
  github: 'GitHub',
};

/**
 * 미들웨어가 무인증으로 통과시켜야 하는 OAuth 경로.
 * 리다이렉트 진입점과 콜백은 **로그인 전** 상태에서 호출되므로 공개여야 한다.
 * `/api/auth/` 전체를 prefix 로 열지 않는 이유: 앞으로 추가되는 인증 라우트가
 * 실수로 함께 열리는 것을 막기 위해 경로를 하나씩 명시한다.
 */
export const OAUTH_PUBLIC_PATHS: readonly string[] = OAUTH_PROVIDERS.flatMap((p) => [
  `/api/auth/${p}`,
  `/api/auth/${p}/callback`,
]);
