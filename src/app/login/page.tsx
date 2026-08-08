'use client';

/**
 * /login — 이메일·비밀번호 로그인 (Phase 0 PIN → T-008 회원제, 2026-08-07).
 * 모바일 우선(412px 기준), 다크 테마. `next` 쿼리는 window.location 에서 읽는다(Suspense 불필요).
 *
 * 실패 문구는 **어느 쪽이 틀렸는지 구분하지 않는다** — 구분해서 알려주면 가입된 이메일을
 * 남에게 알려주는 셈이 된다(서버도 동일한 응답을 준다).
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AuthShell, authStyles } from '@/components/auth/AuthShell';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => { emailRef.current?.focus(); }, []);

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
      const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; detail?: string };
      if (!res.ok || !data.ok) {
        setPassword('');
        if (res.status === 429) setError(data.detail ?? '시도가 많습니다. 잠시 후 다시 시도하세요');
        else if (res.status === 503) setError(data.detail ?? '서버 인증 설정(AUTH_SESSION_SECRET)이 없습니다');
        else setError('이메일 또는 비밀번호가 올바르지 않습니다');
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

      <p style={{ ...authStyles.hint, textAlign: 'center', marginTop: 4 }}>
        세션은 30일간 유지됩니다. 비밀번호를 잊으면 서버 관리자가 직접 재설정해야 합니다.
      </p>
    </AuthShell>
  );
}
