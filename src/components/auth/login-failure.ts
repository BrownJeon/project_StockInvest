/**
 * 로그인 실패 응답 → 사용자 문구 (순수 함수 — /login 페이지에서 분리, T-084).
 *
 * 분기 순서·문구는 T-084 전 `src/app/login/page.tsx` 와 같다. T-084 가 더한 것은 하나다:
 * **앱(WebView) + `oauth_account`** 이면 서버 문구("아래 Google로 계속하기를 눌러…")가 버튼 없는 막다른 문구가 되므로
 * 앱용 문구로 바꿔 보인다(승인 데모 v1 D · 사용자 결정 D7 A — 서버·API 변경 없음).
 * 실패 문구는 어느 쪽이 틀렸는지 구분하지 않는다(가입 이메일 노출 방지) — 이 원칙은 그대로다.
 * ⚠ `native` 는 표시 전용 판별이다.
 */
export interface LoginFailure {
  status: number;
  error?: string;
  detail?: string;
  provider?: string | null;
}

export const GENERIC_LOGIN_FAILURE = '이메일 또는 비밀번호가 올바르지 않습니다';

/** 앱에서 소셜 전용 계정으로 로그인을 시도했을 때(데모 D 의 "앱 문구"). */
export function appOauthAccountText(provider: string | null | undefined): string {
  const label = provider === 'github' ? 'GitHub' : 'Google';
  return `${label}로 가입된 계정입니다. 앱에서는 ${label} 로그인을 지원하지 않습니다 — 휴대폰이나 PC 의 브라우저에서 로그인해 주세요.`;
}

export function loginFailureText(f: LoginFailure, native: boolean): string {
  if (f.status === 429) return f.detail ?? '시도가 많습니다. 잠시 후 다시 시도하세요';
  if (f.status === 503) return f.detail ?? '서버 인증 설정(AUTH_SESSION_SECRET)이 없습니다';
  // OAuth 전용 계정 — 비밀번호가 없으므로 어느 쪽으로 로그인해야 하는지 알려준다.
  // 이 문구가 없으면 사용자는 비밀번호를 계속 틀리다 계정이 잠긴다.
  if (f.error === 'oauth_account' && native) return appOauthAccountText(f.provider);
  if (f.error === 'oauth_account' && f.detail) return f.detail;
  return GENERIC_LOGIN_FAILURE;
}
