'use client';

/**
 * /signup — 회원가입 (T-008 Step 1, 사용자 결정 Q1).
 *
 * **이메일·비밀번호만 받는다.** 증권계좌(KIS) 연결은 가입 후 프로필의 "계좌 연결"에서
 * 실검증과 함께 진행한다 — 가입 화면이 KIS 키 4개를 요구하지 않게 하기 위한 분리다.
 *
 * 초대 코드 입력칸은 서버가 `SIGNUP_INVITE_CODE` 를 설정한 경우에만 나타난다
 * (GET /api/auth/signup 의 inviteRequired).
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AuthShell, authStyles } from '@/components/auth/AuthShell';
import { OAuthButtons } from '@/components/auth/OAuthButtons';
import { SignupRequestLink } from '@/components/auth/SignupRequestLink';

export default function SignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [inviteRequired, setInviteRequired] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => { emailRef.current?.focus(); }, []);

  useEffect(() => {
    let alive = true;
    fetch('/api/auth/signup')
      .then((r) => r.json())
      .then((d: { inviteRequired?: boolean }) => { if (alive) setInviteRequired(!!d.inviteRequired); })
      .catch(() => { if (alive) setInviteRequired(false); });
    return () => { alive = false; };
  }, []);

  const canSubmit =
    email.trim().length > 0 &&
    password.length >= 8 &&
    confirm.length > 0 &&
    (!inviteRequired || inviteCode.trim().length > 0) &&
    !busy;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    if (password !== confirm) {
      setError('비밀번호가 서로 다릅니다');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, inviteCode: inviteRequired ? inviteCode : undefined }),
      });
      const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? `가입하지 못했습니다 (HTTP ${res.status})`);
        setBusy(false);
        return;
      }
      // 가입 직후 자동 로그인 상태 — 증권계좌 연결로 바로 안내한다.
      window.location.replace('/profile?welcome=1');
    } catch {
      setError('네트워크 오류 — 다시 시도하세요');
      setBusy(false);
    }
  }

  return (
    <AuthShell title="주식 자동매매" subtitle="이메일로 계정 만들기">
      {/* 로그인 화면과 동일한 버튼. 소셜로 처음 가입할 때도 초대코드 화면을 한 번 거친다. */}
      <OAuthButtons />

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
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            style={authStyles.input}
          />
          <div style={authStyles.hint}>8자 이상</div>
        </div>

        <div style={authStyles.field}>
          <label htmlFor="confirm" style={authStyles.label}>비밀번호 확인</label>
          <input
            id="confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••••"
            style={{
              ...authStyles.input,
              borderColor: confirm.length > 0 && confirm !== password ? 'var(--danger)' : 'var(--border2)',
            }}
          />
        </div>

        {inviteRequired && (
          <div style={authStyles.field}>
            <label htmlFor="invite" style={authStyles.label}>초대 코드</label>
            <input
              id="invite"
              type="text"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder="관리자에게 받은 코드"
              style={authStyles.input}
            />
            <div style={authStyles.hint}>이 서버는 초대 코드를 아는 사람만 가입할 수 있습니다</div>
          </div>
        )}

        <div id="signup-error" role="alert" style={authStyles.error}>{error ?? ' '}</div>

        <button type="submit" disabled={!canSubmit} style={{ ...authStyles.submit, opacity: canSubmit ? 1 : 0.5 }}>
          {busy ? '가입 처리 중…' : '가입하고 시작하기'}
        </button>
      </form>

      {/* 사용자 결정 Q2 — 가입 직후 상태를 오해 없이 알린다.
          "계좌 종류"와 "모의 매매"가 서로 다른 스위치라는 설명은 실제로 계좌 종류를 고르는
          프로필의 KIS 연결 화면에서 다시 한 번, 더 자세히 나온다. */}
      <div style={authStyles.note}>
        가입하면 <b style={{ color: 'var(--text)' }}>실거래여부가 OFF(실거래 차단)인 상태</b>로 시작합니다 — 주문이 실제로 나가지 않습니다.<br />
        증권계좌(한국투자증권 API) 연결은 가입한 뒤 <b style={{ color: 'var(--text)' }}>프로필 → 계좌 연결</b>에서 진행합니다.
      </div>

      <div style={authStyles.alt}>
        <span>이미 계정이 있나요?</span>
        <Link href="/login" style={authStyles.altLink}>로그인</Link>
      </div>

      {/* T-010 — 초대코드가 없는 사람의 탈출구. SMTP 미설정이면 렌더되지 않는다(서버 판정). */}
      <SignupRequestLink />
    </AuthShell>
  );
}
