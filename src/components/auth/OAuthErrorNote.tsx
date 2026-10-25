'use client';

/**
 * /login 맨 위 소셜 로그인 오류 안내 상자 (T-009 → T-088, 승인 데모 v2 D 절). 웹·앱이 **같은 상자·같은 문구**다.
 *
 * 콜백(웹)·딥링크(앱)가 실패하면 `/login?oauth_error=<고정 코드>` 로 다시 띄운다 — 제공자 원문 오류는 주소에 싣지 않는다(내부 오류 문구 노출 방지).
 * 모르는 코드는 `failed` 문구로 떨어진다. 다시 시도하는 행동은 바로 아래 [Google로 계속하기] 하나다.
 *
 *  · `email_unverified`  — 빨강 막대 상자(반드시 읽혀야 하는 안내). "Google/GitHub" → "Google"(GitHub 는 화면에서 뺐다).
 *  · `signup_requires_web` (앱에서만 생김) — Google 인증은 됐지만 연결된 기존 계정이 없다. 앱에서는 신규 가입을 못 하므로 안내 + (앱일 때만)
 *    [Chrome에서 가입 화면 열기](결정 D2 A — Chrome 창으로 `/signup` 을 연다, 열지 못하면 아무것도 하지 않는다).
 *  · `app_code_invalid`·`app_verifier_lost` (앱에서만 생김) — 1회용 코드 교환 실패 / 앱이 다시 시작돼 검증값을 잃음.
 *
 * 상자는 `role="alert"` + `tabIndex={-1}` — 앱에서 오류가 있으면 페이지가 상자로 포커스를 옮긴다(이메일 칸에 두면 키보드가 올라와 안내를 가린다).
 * 간격은 로그인 화면용 `0 0 16px`(note 의 기본 `14px 0 4px` 는 /signup 용으로 둔다).
 */
import type { CSSProperties, RefObject } from 'react';
import { authStyles } from '@/components/auth/AuthShell';
import { openExternal } from '@/lib/native/bridge';

export const OAUTH_ERROR_TEXT: Record<string, string> = {
  cancelled: '소셜 로그인을 취소했습니다.',
  invalid_state: '로그인 요청이 만료되었거나 올바르지 않습니다. 다시 시도해 주세요.',
  not_configured: '서버에 소셜 로그인 설정이 없습니다. 관리자에게 문의하세요.',
  failed: '소셜 로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.',
  // T-088 — 앱 로그인에서만 생기는 코드
  app_code_invalid: '로그인을 마무리하지 못했습니다. 아래 Google로 계속하기를 다시 눌러 주세요.',
  app_verifier_lost: '앱이 다시 시작됐거나 시간이 오래 지나 로그인을 이어 갈 수 없습니다. 아래 Google로 계속하기를 다시 눌러 주세요.',
};

export const SIGNUP_REQUIRES_WEB_COPY = {
  title: '이 Google 계정으로 가입된 계정이 없습니다.',
  body: '앱에서는 새로 가입할 수 없습니다 — 휴대폰이나 PC 의 브라우저에서 먼저 가입(초대코드 필요)한 뒤 앱에서 로그인해 주세요. 다른 이메일로 가입했다면 그 이메일로 아래에서 로그인하세요.',
  openSignup: 'Chrome에서 가입 화면 열기',
} as const;

/** 코드 → 일반 안내 문구. 목록에 없는(또는 `constructor` 같은 상속 키) 코드는 `failed` 문구. */
export function oauthErrorText(code: string): string {
  return Object.prototype.hasOwnProperty.call(OAUTH_ERROR_TEXT, code) ? OAUTH_ERROR_TEXT[code] : OAUTH_ERROR_TEXT.failed;
}

const LOGIN_MARGIN: CSSProperties = { margin: '0 0 16px' };

/** 데모 `.al-ghost` — 44px 글자 버튼. */
const ghostButton: CSSProperties = {
  minHeight: 44, width: '100%', borderRadius: 8, border: '1px solid var(--border2)',
  background: 'var(--bg2)', color: 'var(--text)', fontSize: 13, fontWeight: 600,
  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
};

export function OAuthErrorNote({
  code,
  native,
  noteRef,
}: {
  code: string;
  /** 앱 판별(표시 전용) — [Chrome에서 가입 화면 열기] 를 앱에서만 보인다(웹에서는 눌러도 열 곳이 없다). */
  native: boolean;
  noteRef?: RefObject<HTMLDivElement>;
}) {
  if (code === 'email_unverified') {
    // 이메일 검증이 안 된 소셜 계정 — 기존 계정에 잘못 붙는 것을 막은 경우. 일반 실패와 시각적으로 확실히 구분한다(목업 3번 red note).
    return (
      <div ref={noteRef} role="alert" tabIndex={-1} style={{ ...authStyles.noteDanger, ...LOGIN_MARGIN }}>
        <b style={{ color: '#fca5a5' }}>이 소셜 계정의 이메일이 확인되지 않았습니다.</b><br />
        Google에서 이메일 인증을 마친 뒤 다시 시도해 주세요.
        기존 계정에 잘못 연결되는 것을 막기 위한 조치입니다.
      </div>
    );
  }
  if (code === 'signup_requires_web') {
    return (
      <div ref={noteRef} role="alert" tabIndex={-1} style={{ ...authStyles.note, ...LOGIN_MARGIN }}>
        <b style={{ color: 'var(--text)' }}>{SIGNUP_REQUIRES_WEB_COPY.title}</b><br />
        {SIGNUP_REQUIRES_WEB_COPY.body}
        {native && (
          <div style={{ marginTop: 10 }}>
            <button type="button" style={ghostButton} onClick={() => { void openExternal('/signup'); }}>
              {SIGNUP_REQUIRES_WEB_COPY.openSignup}
            </button>
          </div>
        )}
      </div>
    );
  }
  return (
    <div ref={noteRef} role="alert" tabIndex={-1} style={{ ...authStyles.note, ...LOGIN_MARGIN }}>
      {oauthErrorText(code)}
    </div>
  );
}
