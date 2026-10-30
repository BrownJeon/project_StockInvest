'use client';

/**
 * /oauth/invite — 첫 소셜 로그인의 초대코드 확인 (T-009 D1=A, 2026-08-08).
 * 목업 b6f4f54a 2번 화면 기준.
 *
 * **이 화면을 통과하기 전에는 계정이 없다.** OAuth 인증에 성공해도 코드가 틀리면
 * 아무것도 만들어지지 않는다(서버 `POST /api/auth/oauth-complete` 가 유일한 생성 지점).
 *
 * 기존 계정에 소셜을 연결하는 경우에는 이 화면이 나오지 않는다 — 이미 가입된 사람이다.
 *
 * 인증 정보는 HttpOnly 쿠키라 이 화면이 직접 읽을 수 없다. 표시용 요약만
 * `GET /api/auth/oauth-pending` 으로 받아온다.
 */
import { useEffect, useRef, useState } from 'react';
import { AuthShell, authStyles } from '@/components/auth/AuthShell';

interface Pending {
  provider: 'google' | 'github';
  providerLabel: string;
  email: string;
  inviteRequired: boolean;
}

const PROVIDER_ICON: Record<Pending['provider'], JSX.Element> = {
  google: (
    <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden focusable="false" style={{ flex: '0 0 auto' }}>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.76c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84z" />
      <path fill="#EA4335" d="M12 4.75c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.46 14.97.5 12 .5A11 11 0 0 0 2.18 7.05l3.66 2.84c.87-2.6 3.3-4.14 6.16-4.14z" />
    </svg>
  ),
  github: (
    <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden focusable="false" style={{ flex: '0 0 auto', color: 'var(--text)' }}>
      <path fill="currentColor" d="M12 .5a12 12 0 0 0-3.79 23.4c.6.1.82-.26.82-.58v-2.2c-3.34.72-4.04-1.4-4.04-1.4-.55-1.4-1.34-1.77-1.34-1.77-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.8 1.3 3.49 1 .1-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.11-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6.01 0c2.29-1.55 3.3-1.23 3.3-1.23.65 1.66.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.62-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.69.83.58A12 12 0 0 0 12 .5z" />
    </svg>
  ),
};

export default function OAuthInvitePage() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/auth/oauth-pending')
      .then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) as { ok?: boolean } & Partial<Pending> }))
      .then(({ status, body }) => {
        if (!alive) return;
        if (status !== 200 || !body.ok) {
          setLoadError('인증 정보가 없거나 만료되었습니다. 소셜 로그인을 다시 시도해 주세요.');
          return;
        }
        setPending(body as Pending);
      })
      .catch(() => { if (alive) setLoadError('네트워크 오류 — 다시 시도하세요'); });
    return () => { alive = false; };
  }, []);

  useEffect(() => { if (pending?.inviteRequired) codeRef.current?.focus(); }, [pending]);

  const canSubmit = pending !== null && (!pending.inviteRequired || inviteCode.trim().length > 0) && !busy;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !pending) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/oauth-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteCode: pending.inviteRequired ? inviteCode : undefined }),
      });
      const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; next?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? `가입하지 못했습니다 (HTTP ${res.status})`);
        setBusy(false);
        return;
      }
      // 가입 직후 자동 로그인 상태 — 증권계좌 연결로 바로 안내한다(이메일 가입과 동일).
      window.location.replace(data.next && data.next !== '/' ? data.next : '/profile?welcome=1');
    } catch {
      setError('네트워크 오류 — 다시 시도하세요');
      setBusy(false);
    }
  }

  if (loadError !== null) {
    return (
      <AuthShell title="주식 자동매매" subtitle="다시 시도해 주세요">
        <div role="alert" style={authStyles.noteDanger}>{loadError}</div>
        <button type="button" onClick={() => window.location.replace('/login')} style={authStyles.submitGhost}>
          로그인으로 돌아가기
        </button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="초대코드 입력" subtitle="가입을 마치려면 초대코드가 필요합니다">
      {pending && (
        <div style={authStyles.provider}>
          {PROVIDER_ICON[pending.provider]}
          <div>
            {pending.providerLabel} 인증 완료
            <div style={{ color: 'var(--muted)', fontSize: 11.5, wordBreak: 'break-all' }}>{pending.email}</div>
          </div>
        </div>
      )}

      <form onSubmit={onSubmit}>
        {pending?.inviteRequired && (
          <div style={authStyles.field}>
            <label htmlFor="invite" style={authStyles.label}>초대코드</label>
            <input
              id="invite"
              ref={codeRef}
              type="text"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder="초대코드를 입력하세요"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'invite-error' : undefined}
              style={{
                ...authStyles.input,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                letterSpacing: '0.06em',
                borderColor: error ? 'var(--danger)' : 'var(--border2)',
              }}
            />
            <div style={authStyles.hint}>이메일 가입에 쓰는 코드와 <b>같은 코드</b>입니다</div>
          </div>
        )}

        <div id="invite-error" role="alert" style={authStyles.error}>{error ?? ' '}</div>

        <button type="submit" disabled={!canSubmit} style={{ ...authStyles.submit, opacity: canSubmit ? 1 : 0.5 }}>
          {busy ? '가입 처리 중…' : '가입 완료'}
        </button>
      </form>

      <div style={authStyles.alt}>
        <a href="/login" style={authStyles.altLink}>취소하고 로그인으로 돌아가기</a>
      </div>

      <div style={{ ...authStyles.note, borderLeftColor: 'var(--ok, #22c55e)' }}>
        이 화면은 <b style={{ color: 'var(--text)' }}>처음 한 번만</b> 나옵니다.
        다음부터는 소셜 버튼만 누르면 바로 들어옵니다.
      </div>
      <div style={authStyles.note}>
        가입하면 <b style={{ color: 'var(--text)' }}>실거래여부가 OFF(실거래 차단)인 상태</b>로 시작합니다 — 주문이 실제로 나가지 않습니다.
      </div>
    </AuthShell>
  );
}
