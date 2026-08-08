'use client';

/**
 * 로그인·회원가입 공통 카드 레이아웃 (T-008, 2026-08-07).
 * 목업 기준: 모바일 412px 완결, 터치 타겟 44px 이상, 기존 globals.css 토큰만 사용.
 */
import type { CSSProperties, ReactNode } from 'react';

export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <main style={authStyles.wrap}>
      <div style={authStyles.card}>
        <div style={authStyles.logo} aria-hidden>📈</div>
        <h1 style={authStyles.title}>{title}</h1>
        <p style={authStyles.sub}>{subtitle}</p>
        {children}
      </div>
    </main>
  );
}

export const authStyles: Record<string, CSSProperties> = {
  wrap: {
    // layout.tsx 래퍼가 하단 탭 높이만큼 padding-bottom 을 주므로 그만큼 차감
    minHeight: 'calc(100dvh - var(--nav-h) - var(--safe-bottom))',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 'calc(var(--safe-top) + 20px) 16px calc(var(--safe-bottom) + 24px)',
  },
  card: {
    width: '100%', maxWidth: 380,
    background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 16,
    padding: 22, display: 'flex', flexDirection: 'column',
  },
  logo: { fontSize: 32, lineHeight: 1, textAlign: 'center', marginBottom: 8 },
  title: { fontSize: 19, fontWeight: 700, margin: 0, textAlign: 'center' },
  sub: { fontSize: 13, color: 'var(--muted)', margin: '6px 0 18px', textAlign: 'center' },
  field: { display: 'flex', flexDirection: 'column', marginBottom: 12 },
  label: { fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 6 },
  input: {
    minHeight: 46, borderRadius: 10, border: '1px solid var(--border2)',
    background: 'var(--bg3)', color: 'var(--text)',
    padding: '0 14px', fontSize: 16, width: '100%', outlineColor: 'var(--accent)',
  },
  hint: { fontSize: 11, color: 'var(--muted)', marginTop: 5 },
  error: { minHeight: 18, fontSize: 12, color: 'var(--danger)', margin: '6px 0 4px', wordBreak: 'break-word' },
  submit: {
    minHeight: 48, borderRadius: 10, background: 'var(--accent)', color: '#221a05',
    fontSize: 15, fontWeight: 700, width: '100%', marginTop: 4,
  },
  note: {
    background: 'var(--bg3)', border: '1px solid var(--border2)', borderLeft: '3px solid var(--accent)',
    borderRadius: 8, padding: '11px 12px', fontSize: 12, color: 'var(--muted)',
    lineHeight: 1.55, margin: '14px 0 4px',
  },
  alt: { textAlign: 'center', fontSize: 12.5, color: 'var(--muted)', marginTop: 16, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 },
  altLink: { color: 'var(--accent)', borderBottom: '1px solid var(--accent)', paddingBottom: 1, fontWeight: 600 },
};
