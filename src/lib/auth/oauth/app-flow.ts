/**
 * T-088 — 앱(주식캐기) Google 로그인 흐름의 **순수 상수·형식** 모듈. 의존성 0 — 서버 라우트와 WebView 쪽(`src/lib/native/appLogin.ts`)이
 * 같은 규칙을 보도록 여기 한 곳에 둔다(`node:crypto`·`mysql2`·`window` 를 쓰지 않는다).
 *
 * 흐름(설계 T-088 ①~⑤):
 *   WebView [Google로 계속하기] → PKCE 쌍 생성 → Custom Tab 으로 `/api/auth/google?platform=app&challenge=<43자>&next=…`
 *   → Google → 콜백이 세션 대신 60초·1회용 코드 → `stockinvest://auth/callback?code=<64 hex>` (또는 `?error=<코드>`)
 *   → 앱 WebView 가 코드+verifier 를 `POST /api/auth/app-exchange`(JSON) → 세션 쿠키.
 */

/** 앱 딥링크 스킴·호스트·경로 — `android/app/src/main/AndroidManifest.xml` intent-filter 와 같아야 한다(app-flow.test 가 대조). */
export const APP_DEEP_LINK_SCHEME = 'stockinvest';
export const APP_DEEP_LINK_HOST = 'auth';
export const APP_DEEP_LINK_PATH = '/callback';
export const APP_DEEP_LINK_BASE = `${APP_DEEP_LINK_SCHEME}://${APP_DEEP_LINK_HOST}${APP_DEEP_LINK_PATH}`;

/** 교환 라우트 — 미들웨어 공개 목록에 **정확 일치로 1개** 들어간다. */
export const APP_EXCHANGE_PATH = '/api/auth/app-exchange';

/** 딥링크 코드(`code_r`) 형식 — 32바이트 랜덤의 소문자 hex 64자. */
export const APP_CODE_PATTERN = /^[0-9a-f]{64}$/;

/**
 * 콜백이 앱으로 돌려주는 오류 코드(딥링크 `?error=`). **고정 목록만** 싣는다 — 제공자 원문 오류는 서버 로그에만.
 * 웹 `/login?oauth_error=` 코드와 같은 이름을 쓰고, 앱에만 있는 것은 `signup_requires_web`·`app_login_invalid` 두 개다.
 */
export const APP_LOGIN_ERRORS = [
  'cancelled',           // 사용자가 Google 동의 화면에서 취소
  'failed',              // 제공자 통신·기타 실패
  'invalid_state',       // state 검증 실패 — ⚠ 서버는 아직 이 코드를 딥링크로 보내지 않는다(앱 state 의 만료·쿠키 유실도 웹 invalid_state 로 감 — T-088 후속 후보). 앱 화면은 받을 준비만 해 둠
  'email_unverified',    // Google 이 이메일을 검증하지 않음
  'not_configured',      // 서버 OAuth 미설정·앱 로그인 테이블 미적용
  'signup_requires_web', // 연결된 계정이 없음 — 가입은 웹에서만(Leader 방침 2)
  'app_login_invalid',   // 앱 시작 요청 형식 오류(challenge 없음·Google 외 제공자)
] as const;
export type AppLoginError = (typeof APP_LOGIN_ERRORS)[number];

export function isAppLoginError(v: unknown): v is AppLoginError {
  return typeof v === 'string' && (APP_LOGIN_ERRORS as readonly string[]).includes(v);
}

/** 교환 실패 응답의 유일한 오류 코드(모든 실패가 이것 하나로 수렴한다). */
export const APP_CODE_INVALID = 'app_code_invalid';

/** 앱 로그인 후 착지 경로의 기본값. */
export const APP_DEFAULT_NEXT = '/';

const SENTINEL_ORIGIN = 'http://sentinel.invalid';

/**
 * 앱 로그인 후 돌아갈 **같은 출처 경로**만 남긴다(오픈 리다이렉트 방지 — 웹의 `sanitizeNextPath` 보다 엄격하다).
 *
 * 문자열 접두어 검사만으로는 막지 못하는 변형이 있다: 브라우저는 URL 안의 탭·개행을 지우므로 `/<TAB>/evil.com` 은 `//evil.com`
 * (프로토콜 상대 주소)이 되고, `/..//evil.com` 은 정규화 뒤 `//evil.com` 이 된다. 그래서
 *  ① 제어문자·공백·백슬래시가 하나라도 있으면 거부(제거가 아니라 거부)
 *  ② 가짜 출처 기준으로 URL 파서에 넣어 출처가 그대로인지 확인
 *  ③ 파서가 정규화한 결과가 `/` 로 시작하고 `//` 로 시작하지 않는지 확인
 *  ④ 인증 흐름·API 경로(`/login`·`/signup`·`/oauth/…`·`/api/…`)는 착지 대상이 아니다 — 기본값으로
 * 반환값은 언제나 `/` 로 시작하고 `//` 로 시작하지 않는 문자열이다.
 */
export function sanitizeAppNextPath(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 512) return APP_DEFAULT_NEXT;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0020\u007f-\u00a0\\\u2028\u2029]/.test(raw)) return APP_DEFAULT_NEXT;
  if (!raw.startsWith('/') || raw.startsWith('//')) return APP_DEFAULT_NEXT;
  let u: URL;
  try {
    u = new URL(raw, SENTINEL_ORIGIN);
  } catch {
    return APP_DEFAULT_NEXT;
  }
  if (u.origin !== SENTINEL_ORIGIN) return APP_DEFAULT_NEXT;
  const out = `${u.pathname}${u.search}${u.hash}`;
  if (!out.startsWith('/') || out.startsWith('//')) return APP_DEFAULT_NEXT;
  const p = u.pathname;
  if (
    p === '/login' || p.startsWith('/login/') ||
    p === '/signup' || p.startsWith('/signup/') ||
    p === '/oauth' || p.startsWith('/oauth/') ||
    p === '/api' || p.startsWith('/api/')
  ) {
    return APP_DEFAULT_NEXT;
  }
  return out;
}

/**
 * 콜백이 돌려줄 딥링크. 값은 형식이 고정된 것만 받는다(코드 64 hex, 오류는 고정 목록) — 형식 밖이면 던진다(호출부 버그).
 * 문자열 조립이 아니라 고정 접두어 + 검증된 값이라, 스킴 문법을 URL 파서에 기대지 않는다.
 */
export function buildAppCallbackDeepLink(p: { code: string } | { error: AppLoginError }): string {
  if ('code' in p) {
    if (!APP_CODE_PATTERN.test(p.code)) throw new Error('buildAppCallbackDeepLink: 코드 형식 오류');
    return `${APP_DEEP_LINK_BASE}?code=${p.code}`;
  }
  if (!isAppLoginError(p.error)) throw new Error('buildAppCallbackDeepLink: 알 수 없는 오류 코드');
  return `${APP_DEEP_LINK_BASE}?error=${p.error}`;
}

export type ParsedAppDeepLink =
  | { kind: 'code'; code: string }
  | { kind: 'error'; error: AppLoginError }
  | null;

/**
 * 앱이 받은 딥링크 → 로그인 결과. **로그인 콜백 주소가 아니면 null**(앞으로 생길 다른 딥링크는 무시한다).
 * 스킴·호스트·경로가 정확히 `stockinvest://auth/callback` 일 때만, 쿼리는 `code`(64 hex) 또는 `error`(고정 목록) 하나만 본다.
 * 형식 밖의 오류 코드는 `failed` 로 수렴한다(화면에 임의 문자열을 싣지 않는다).
 */
export function parseAppDeepLink(rawUrl: unknown): ParsedAppDeepLink {
  if (typeof rawUrl !== 'string' || rawUrl.length > 1024) return null;
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (u.protocol !== `${APP_DEEP_LINK_SCHEME}:` || u.host !== APP_DEEP_LINK_HOST || u.pathname !== APP_DEEP_LINK_PATH) return null;
  if (u.username || u.password || u.port) return null;
  const code = u.searchParams.get('code');
  const error = u.searchParams.get('error');
  if (code !== null && error === null) {
    return APP_CODE_PATTERN.test(code) ? { kind: 'code', code } : { kind: 'error', error: 'failed' };
  }
  if (error !== null && code === null) {
    return { kind: 'error', error: isAppLoginError(error) ? error : 'failed' };
  }
  return { kind: 'error', error: 'failed' };
}
