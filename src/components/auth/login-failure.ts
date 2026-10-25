/**
 * 로그인 실패 응답 → 사용자 문구 (순수 함수 — /login 페이지에서 분리, T-084).
 *
 * 분기 순서·문구는 T-084 전 `src/app/login/page.tsx` 와 같다. T-088 에서 두 가지가 바뀌었다(승인 데모 v2 E 절 · 사용자 결정 D5 A):
 *  ① T-084 가 만든 **앱 전용 문구**(`appOauthAccountText` — "앱에서는 Google 로그인을 지원하지 않습니다")는 없앴다. 앱에도 같은
 *     Google 버튼이 생겨 그 문구가 거짓이 됐고, 그래서 웹·앱 구분(`native` 인자)도 필요 없다.
 *  ② `oauth_account`(소셜로 가입된 계정) 문구의 "아래"를 "위의"로 고쳤다 — 오류 줄은 비밀번호 칸 아래에 있고 Google 버튼은 카드 위쪽에 있어서
 *     서버 문구 "아래 Google로 계속하기"는 실제로는 위쪽 버튼을 가리킨다. 서버 응답(`login/route.ts`)은 바꾸지 않고 화면이 문구를 조립한다.
 * 실패 문구는 어느 쪽이 틀렸는지 구분하지 않는다(가입 이메일 노출 방지) — 이 원칙은 그대로다.
 */
export interface LoginFailure {
  status: number;
  error?: string;
  detail?: string;
  provider?: string | null;
}

export const GENERIC_LOGIN_FAILURE = '이메일 또는 비밀번호가 올바르지 않습니다';

/** Google 로 가입된 계정이 이메일·비밀번호로 로그인을 시도했을 때(데모 E 절, D5 A) — 위쪽 Google 버튼을 가리킨다. */
export const GOOGLE_ACCOUNT_TEXT = 'Google로 가입된 계정입니다. 위의 Google로 계속하기를 눌러 로그인하세요.';

export function loginFailureText(f: LoginFailure): string {
  if (f.status === 429) return f.detail ?? '시도가 많습니다. 잠시 후 다시 시도하세요';
  if (f.status === 503) return f.detail ?? '서버 인증 설정(AUTH_SESSION_SECRET)이 없습니다';
  // OAuth 전용 계정 — 비밀번호가 없으므로 어느 쪽으로 로그인해야 하는지 알려준다.
  // 이 문구가 없으면 사용자는 비밀번호를 계속 틀리다 계정이 잠긴다.
  if (f.error === 'oauth_account' && f.provider === 'google') return GOOGLE_ACCOUNT_TEXT;
  // Google 이 아닌 제공자(운영에는 없다 — 화면에서 GitHub 버튼을 뺐다)는 서버 문구 그대로.
  if (f.error === 'oauth_account' && f.detail) return f.detail;
  return GENERIC_LOGIN_FAILURE;
}
