'use client';

/**
 * /login — 이메일·비밀번호 로그인 (Phase 0 PIN → T-008 회원제, 2026-08-07).
 * 모바일 우선(412px 기준), 다크 테마. `next` 쿼리는 window.location 에서 읽는다(Suspense 불필요).
 *
 * 실패 문구는 **어느 쪽이 틀렸는지 구분하지 않는다** — 구분해서 알려주면 가입된 이메일을
 * 남에게 알려주는 셈이 된다(서버도 동일한 응답을 준다).
 *
 * T-088 — **웹과 안드로이드 앱(WebView)이 같은 화면**이다(승인 데모 v2): Google 버튼(`OAuthButtons`, `appLogin`) + "또는 이메일로" + 이메일 폼.
 * 앱 차이는 Google 을 누른 뒤의 동작(Chrome 창)과 그 대기·오류 상태뿐이고, 앱 전용 분리 컴포넌트는 없다. `AppDeepLink` 는 앱이 Chrome 창에서
 * 돌아올 때(딥링크) 로그인을 마무리하며 화면 요소는 마무리 중 덮개뿐이다. 오류 안내 상자는 `OAuthErrorNote`(웹·앱 같은 문구),
 * 소셜 전용 계정 오류(`oauth_account`)는 웹·앱 공통 문구(`loginFailureText`). 제목은 그대로 "주식 자동매매". 앱 판별은 표시 전용·수화 뒤.
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AuthShell, authStyles } from '@/components/auth/AuthShell';
import { AppDeepLink } from '@/components/auth/AppDeepLink';
import { OAuthButtons } from '@/components/auth/OAuthButtons';
import { OAuthErrorNote } from '@/components/auth/OAuthErrorNote';
import { SignupRequestLink } from '@/components/auth/SignupRequestLink';
import { loginFailureText } from '@/components/auth/login-failure';
import { isNativeApp } from '@/lib/native/bridge';
import { sanitizeInternalPath } from '@/lib/safe-next-path';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [nextPath, setNextPath] = useState<string | undefined>(undefined);
  const [native, setNative] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 앱에서 소셜 오류 안내가 있으면 이메일 칸 대신 오류 상자에 포커스한다(아래 effect) — 키보드가 올라와 안내를 가리지 않게. 웹은 지금처럼 이메일 칸.
    if (isNativeApp() && new URLSearchParams(window.location.search).get('oauth_error') !== null) return;
    emailRef.current?.focus();
  }, []);

  useEffect(() => { if (native && oauthError !== null) noteRef.current?.focus(); }, [native, oauthError]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setOauthError(params.get('oauth_error'));
    const n = params.get('next');
    setNextPath(sanitizeInternalPath(n) ?? undefined);
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
        // 429·503·oauth_account(웹·앱 공통 문구)·그 밖 — 분기 순서·문구는 login-failure.ts 에 있다.
        setError(loginFailureText({ status: res.status, error: data.error, detail: data.detail, provider: data.provider }));
        setBusy(false);
        return;
      }
      const params = new URLSearchParams(window.location.search);
      const next = params.get('next');
      // open redirect 방지 — 같은 오리진 내부 경로만 허용
      const dest = sanitizeInternalPath(next) ?? '/';
      window.location.replace(dest);
    } catch {
      setError('네트워크 오류 — 다시 시도하세요');
      setBusy(false);
    }
  }

  return (
    <AuthShell title="주식 자동매매" subtitle="계속하려면 로그인하세요">
      {oauthError !== null && <OAuthErrorNote code={oauthError} native={native} noteRef={noteRef} />}

      <OAuthButtons nextPath={nextPath} appLogin />

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

        <div id="login-error" role="alert" style={{ ...authStyles.error, lineHeight: 1.5 }}>{error ?? ' '}</div>

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

      {/* T-088 — 앱이 Chrome 창에서 돌아올 때(딥링크) 로그인을 마무리한다. 웹에서는 아무것도 그리지·구독하지 않는다. */}
      <AppDeepLink nextPath={nextPath} />
    </AuthShell>
  );
}
