'use client';

/**
 * /login — PIN 로그인 (Phase 0, 2026-08-02).
 * 모바일 우선(412px 기준), 다크 테마. 최소 구성 — PIN 입력 + 제출만.
 * `next` 쿼리는 useSearchParams 대신 window.location에서 읽는다 (Suspense 경계 불필요).
 */
import { useEffect, useRef, useState } from 'react';

export default function LoginPage() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || pin.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; detail?: string };
      if (!res.ok || !data.ok) {
        setPin('');
        inputRef.current?.focus();
        if (res.status === 429) setError(data.detail ?? '시도 횟수 초과 — 잠시 후 다시 시도하세요');
        else if (res.status === 503) setError(data.detail ?? '서버에 AUTH_PIN이 설정되지 않았습니다');
        else setError('PIN이 올바르지 않습니다');
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
      return;
    }
    setBusy(false);
  }

  return (
    <main style={styles.wrap}>
      <form style={styles.card} onSubmit={onSubmit}>
        <div style={styles.logo} aria-hidden>📈</div>
        <h1 style={styles.title}>주식 자동매매</h1>
        <p style={styles.sub}>계속하려면 PIN을 입력하세요</p>

        <label htmlFor="pin" style={styles.label}>PIN</label>
        <input
          id="pin"
          ref={inputRef}
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="••••••"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'pin-error' : undefined}
          style={{ ...styles.input, borderColor: error ? 'var(--danger)' : 'var(--border2)' }}
        />

        <div id="pin-error" role="alert" style={styles.error}>{error ?? ' '}</div>

        <button
          type="submit"
          disabled={busy || pin.length === 0}
          style={{ ...styles.submit, opacity: busy || pin.length === 0 ? 0.5 : 1 }}
        >
          {busy ? '확인 중…' : '로그인'}
        </button>

        <p style={styles.hint}>세션은 30일간 유지됩니다.</p>
      </form>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    // layout.tsx 래퍼가 하단 탭 높이만큼 padding-bottom을 주므로 그만큼 차감해 세로 스크롤 제거
    minHeight: 'calc(100dvh - var(--nav-h) - var(--safe-bottom))',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: `calc(var(--safe-top) + 24px) 16px calc(var(--safe-bottom) + 24px)`,
  },
  card: {
    width: '100%', maxWidth: 380,
    background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 16,
    padding: 24, display: 'flex', flexDirection: 'column',
  },
  logo: { fontSize: 34, lineHeight: 1, textAlign: 'center', marginBottom: 10 },
  title: { fontSize: 18, fontWeight: 700, margin: 0, textAlign: 'center' },
  sub: { fontSize: 13, color: 'var(--muted)', margin: '6px 0 22px', textAlign: 'center' },
  label: { fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 6 },
  input: {
    height: 48, borderRadius: 10, border: '1px solid var(--border2)',
    background: 'var(--bg3)', color: 'var(--text)',
    padding: '0 14px', fontSize: 16, letterSpacing: 4,
    fontVariantNumeric: 'tabular-nums', width: '100%', outlineColor: 'var(--accent)',
  },
  error: { minHeight: 18, fontSize: 12, color: 'var(--danger)', margin: '8px 0 4px' },
  submit: {
    height: 48, borderRadius: 10, background: 'var(--accent)', color: '#1a1400',
    fontSize: 15, fontWeight: 700, width: '100%',
  },
  hint: { fontSize: 11, color: 'var(--muted)', textAlign: 'center', margin: '14px 0 0' },
};
