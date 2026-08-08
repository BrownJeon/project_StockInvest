/**
 * 공유 패키지(`@workspace/auth-oauth`) 프로바이더의 타입 계약 (T-009, 2026-08-08).
 *
 * 공유 패키지는 타입이 없는 CommonJS 다. 그 형태를 여기 한 번만 적어 두고
 * `src/types/workspace-auth-oauth.d.ts` 가 이 타입을 참조한다.
 */

/** 제공자 원본 응답을 통일한 프로필. */
export interface NormalizedOAuthProfile {
  providerId: string;
  email: string;
  name: string;
  avatar: string | null;
  /**
   * 2026-08-08 공유 패키지에 **추가된** 필드 (T-009/D2).
   * 이전 버전 패키지를 쓰는 환경에서는 `undefined` 일 수 있으므로 선택 필드로 둔다 —
   * 소비 지점(`normalizeSharedProfile`)이 `undefined` 를 **false 로 수렴**시켜
   * "모르면 미검증"이라는 fail-closed 방향을 강제한다.
   */
  emailVerified?: boolean;
}

export interface SharedOAuthProvider {
  name: string;
  authUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  emailsUrl?: string;
  scope: string;
  extraAuthParams?: Record<string, string>;
  getProfile(
    accessToken: string,
    tokenData: unknown,
    helpers: { getJson: (url: string, accessToken: string, extraHeaders?: Record<string, string>) => Promise<unknown> },
  ): Promise<unknown>;
  normalizeProfile(raw: unknown): NormalizedOAuthProfile;
}

/** 이 앱이 실제로 쓰는 형태 — `emailVerified` 가 **필수 boolean** 으로 확정된 프로필. */
export interface OAuthProfile {
  providerId: string;
  email: string;
  name: string;
  avatar: string | null;
  emailVerified: boolean;
}
