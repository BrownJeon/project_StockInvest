'use client';

/**
 * /login — 이메일·비밀번호 로그인 (Phase 0 PIN → T-008 회원제, 2026-08-07).
 * 모바일 우선(412px 기준), 다크 테마. `next` 쿼리는 window.location 에서 읽는다(Suspense 불필요).
 *
 * 실패 문구는 **어느 쪽이 틀렸는지 구분하지 않는다** — 구분해서 알려주면 가입된 이메일을
 * 남에게 알려주는 셈이 된다(서버도 동일한 응답을 준다).
 *
 * T-084 — 안드로이드 앱(WebView)에서는 `OAuthButtons` 가 아무것도 그리지 않고, 소셜 전용 계정 오류(`oauth_account`)는
 * 앱용 문구로 바꿔 보인다(`loginFailureText`). 제목은 그대로 "주식 자동매매"(D6 A). 앱 판별은 표시 전용·수화 뒤.
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AuthShell, authStyles } from '@/components/auth/AuthShell';
import { OAuthButtons } from '@/components/auth/OAuthButtons';
import { SignupRequestLink } from '@/components/auth/SignupRequestLink';
import { loginFailureText } from '@/components/auth/login-failure';
import { isNativeApp } from '@/lib/native/bridge';

/**
 * 콜백이 실패했을 때 붙여 보내는 고정 코드 → 사용자 문구.
 * 콜백은 제공자 원문 오류를 URL 에 싣지 않는다(내부 오류 문구 노출 방지) — 코드만 온다.
 */
const OAUTH_ERROR_TEXT: Record<string, string> = {
  cancelled: '소셜 로그인을 취소했습니다.',
  invalid_state: '로그인 요청이 만료되었거나 올바르지 않습니다. 다시 시도해 주세요.',
  not_configured: '서버에 소셜 로그인 설정이 없습니다. 관리자에게 문의하세요.',
  failed: '소셜 로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.',
};

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [nextPath, setNextPath] = useState<string | undefined>(undefined);
  const [native, setNative] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => { emailRef.current?.focus(); }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setOauthError(params.get('oauth_error'));
    const n = params.get('next');
    setNextPath(n && n.startsWith('/') && !n.startsWith('//') ? n : undefined);
    setNative(isNativeApp());
  }, []);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; detail?: string; provider?: string | null };
      if (!res.ok || !data.ok) {
        setPassword('');
        // 429·503·oauth_account(앱이면 앱용 문구)·그 밖 — 분기 순서·문구는 login-failure.ts 에 그대로 옮겼다.
        setError(loginFailureText({ status: res.status, error: data.error, detail: data.detail, provider: data.provider }, native));
        setBusy(false);
        return;
      }
      const params = new URLSearchParams(window.location.search);
      const next = params.get('next');
      // open redirect 방지 — 같은 오리진 내부 경로만 허용
      const dest = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
      window.location.replace(dest);
    } catch {
      setError('네트워크 오류 — 다시 시도하세요');
      setBusy(false);
    }
  }

  return (
    <AuthShell title="주식 자동매매" subtitle="계속하려면 로그인하세요">
      {/* 이메일 검증이 안 된 소셜 계정 — 기존 계정에 잘못 붙는 것을 막은 경우.
          일반 실패와 시각적으로 확실히 구분한다(목업 3번 red note). */}
      {oauthError === 'email_unverified' && (
        <div role="alert" style={authStyles.noteDanger}>
          <b style={{ color: '#fca5a5' }}>이 소셜 계정의 이메일이 확인되지 않았습니다.</b><br />
          Google/GitHub에서 이메일 인증을 마친 뒤 다시 시도해 주세요.
          기존 계정에 잘못 연결되는 것을 막기 위한 조치입니다.
        </div>
      )}
      {oauthError !== null && oauthError !== 'email_unverified' && (
        <div role="alert" style={authStyles.note}>
          {OAUTH_ERROR_TEXT[oauthError] ?? OAUTH_ERROR_TEXT.failed}
        </div>
      )}

      <OAuthButtons nextPath={nextPath} />

      <form onSubmit={onSubmit}>
        <div style={authStyles.field}>
          <label htmlFor="email" style={authStyles.label}>이메일</label>
          <input
            id="email"
            ref={emailRef}
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            style={authStyles.input}
          />
        </div>

        <div style={authStyles.field}>
          <label htmlFor="password" style={authStyles.label}>비밀번호</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'login-error' : undefined}
            style={{ ...authStyles.input, borderColor: error ? 'var(--danger)' : 'var(--border2)' }}
          />
        </div>

        <div id="login-error" role="alert" style={authStyles.error}>{error ?? ' '}</div>

        <button type="submit" disabled={!canSubmit} style={{ ...authStyles.submit, opacity: canSubmit ? 1 : 0.5 }}>
          {busy ? '확인 중…' : '로그인'}
        </button>
      </form>

      <div style={authStyles.alt}>
        <span>처음이신가요?</span>
        <Link href="/signup" style={authStyles.altLink}>회원가입</Link>
      </div>

      {/* T-010 — SMTP 미설정이면 렌더되지 않는다(서버 판정). */}
      <SignupRequestLink />

      <p style={{ ...authStyles.hint, textAlign: 'center', marginTop: 4 }}>
        세션은 30일간 유지됩니다. 비밀번호를 잊으면 서버 관리자가 직접 재설정해야 합니다.
      </p>
    </AuthShell>
  );
}
