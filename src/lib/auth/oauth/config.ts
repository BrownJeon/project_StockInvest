/**
 * OAuth 설정 — 환경변수 → 활성 프로바이더 (T-009, 2026-08-08).
 *
 * **미설정 프로바이더는 버튼 자체를 렌더하지 않는다**(목업 확정 사항). 그러려면
 * "설정됨"의 판정이 화면·리다이렉트·콜백 세 곳에서 완전히 같아야 한다 — 그 판정을 여기 한 곳에 둔다.
 *
 * 설정됨의 조건은 **3개 모두**다:
 *   - `<PROVIDER>_CLIENT_ID`
 *   - `<PROVIDER>_CLIENT_SECRET`
 *   - `OAUTH_CALLBACK_BASE` (redirect_uri 를 만들 수 없으면 어차피 인증이 성립하지 않는다)
 *
 * 값은 호출 시점에 읽는다 — 모듈 top-level 에서 캡처하면 pm2 `--update-env` 로 값을 넣어도
 * 프로세스가 옛 값을 계속 들고 있게 된다.
 */
import { OAUTH_PROVIDERS, type OAuthProviderName } from '@/lib/auth/oauth/names';
import { sanitizeInternalPath } from '@/lib/safe-next-path';

export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
}

const ENV_PREFIX: Record<OAuthProviderName, string> = {
  google: 'GOOGLE',
  github: 'GITHUB',
};

function readEnv(name: string): string | null {
  const v = process.env[name];
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/**
 * 콜백 베이스 URL. 끝의 `/` 는 제거한다 —
 * `${base}/api/auth/google/callback` 이 `//api/...` 가 되면 제공자 콘솔에 등록한
 * redirect_uri 와 문자열이 어긋나 인증이 통째로 실패한다.
 */
export function getCallbackBase(): string | null {
  const raw = readEnv('OAUTH_CALLBACK_BASE');
  return raw === null ? null : raw.replace(/\/+$/, '');
}

/** 프로바이더 자격증명. 하나라도 비면 null (= 미설정). 값 자체는 어디에도 로그하지 않는다. */
export function getProviderCredentials(provider: OAuthProviderName): OAuthCredentials | null {
  const prefix = ENV_PREFIX[provider];
  const clientId = readEnv(`${prefix}_CLIENT_ID`);
  const clientSecret = readEnv(`${prefix}_CLIENT_SECRET`);
  if (clientId === null || clientSecret === null) return null;
  return { clientId, clientSecret };
}

/** 이 프로바이더로 로그인이 가능한 상태인가. 화면의 버튼 노출 여부와 동일한 판정이다. */
export function isProviderEnabled(provider: OAuthProviderName): boolean {
  return getCallbackBase() !== null && getProviderCredentials(provider) !== null;
}

/** 활성 프로바이더 목록. 하나도 없으면 빈 배열 → 화면에 소셜 영역 자체가 사라진다. */
export function enabledProviders(): OAuthProviderName[] {
  return OAUTH_PROVIDERS.filter(isProviderEnabled);
}

/** 제공자 콘솔에 등록해야 하는 redirect_uri. 리다이렉트·토큰교환 양쪽이 같은 값을 써야 한다. */
export function buildRedirectUri(base: string, provider: OAuthProviderName): string {
  return `${base}/api/auth/${provider}/callback`;
}

/**
 * 로그인 후 돌아갈 내부 경로 검증 (open redirect 방지).
 *
 * 판정은 `src/lib/safe-next-path.ts` 의 `sanitizeInternalPath` 한 곳에서 한다(T-089, 2026-10-25) —
 * 이메일 로그인 화면(`/login`)도 같은 함수를 쓴다. 통과하면 입력을 그대로, 거부되면 `/` 를 돌려준다.
 *
 * 막는 것: `//evil.com`(프로토콜 상대 URL)·`/\`(일부 브라우저가 `//` 로 해석)에 더해,
 * 탭·줄바꿈 같은 **제어문자·백슬래시·줄 구분 문자를 낀 경로**와 해석 결과의 출처가 달라지는 경로.
 * URL 해석기는 탭·줄바꿈을 지우므로 `/<TAB>/evil.com` 이 `//evil.com` 이 되어 외부로 나갔다
 * (옛 검사는 앞 두 글자만 봤다).
 */
export function sanitizeNextPath(raw: unknown): string {
  return sanitizeInternalPath(raw) ?? '/';
}
