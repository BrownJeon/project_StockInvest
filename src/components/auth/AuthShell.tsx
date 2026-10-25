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
  /** 카드 상단 이모지. 기본은 앱 로고(📈). T-010 가입 요청 화면은 목업대로 ✉️ 를 쓴다. */
  logo = '📈',
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  logo?: string;
}) {
  return (
    <main style={authStyles.wrap}>
      <div style={authStyles.card}>
        <div style={authStyles.logo} aria-hidden>{logo}</div>
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
  /** 여러 줄 입력 (T-010 목업 `.inp.ta`) — 세로 리사이즈만 허용해 412px 폭을 깨지 않는다. */
  textarea: {
    minHeight: 84, borderRadius: 10, border: '1px solid var(--border2)',
    background: 'var(--bg3)', color: 'var(--text)',
    padding: '11px 14px', fontSize: 16, width: '100%', outlineColor: 'var(--accent)',
    resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5,
  },
  hint: { fontSize: 11, color: 'var(--muted)', marginTop: 5 },
  /** 성공 화면 블록 (T-010 목업 `.big-ok`) */
  bigResult: { textAlign: 'center', padding: '26px 0 8px' },
  bigResultIcon: { fontSize: 40, lineHeight: 1 },
  bigResultTitle: { fontSize: 17, fontWeight: 700, margin: '10px 0 6px' },
  bigResultBody: { fontSize: 12.5, color: 'var(--muted)', margin: 0, lineHeight: 1.6 },
  error: { minHeight: 18, fontSize: 12, color: 'var(--danger)', margin: '6px 0 4px', wordBreak: 'break-word' },
  submit: {
    minHeight: 48, borderRadius: 10, background: 'var(--accent)', color: '#221a05',
    fontSize: 15, fontWeight: 700, width: '100%', marginTop: 4,
  },
  note: {
    background: 'var(--bg3)', border: '1px solid var(--border2)', borderLeft: '3px solid var(--accent)',
    borderRadius: 8, padding: '11px 12px', fontSize: 12, color: 'var(--muted)',
    lineHeight: 1.55, margin: '14px 0 4px',
    // T-088: 360px 에서 낱말 중간이 끊기지 않게(데모 v2 `.au-note`) — 가입 화면 안내 상자에도 같이 적용되는 표시 개선
    wordBreak: 'keep-all', overflowWrap: 'anywhere',
  },
  /** 경고용 note (T-009 목업 `.note.red`) — 미검증 이메일 거부처럼 반드시 읽혀야 하는 안내. */
  noteDanger: {
    background: '#2a1416', border: '1px solid #4a2226', borderLeft: '3px solid var(--danger)',
    borderRadius: 8, padding: '11px 12px', fontSize: 12, color: 'var(--muted)',
    lineHeight: 1.55, margin: '0 0 16px',
    wordBreak: 'keep-all', overflowWrap: 'anywhere', // T-088: note 와 같은 줄바꿈
  },
  /** 초대코드 화면의 "인증 완료" 칩 (T-009 목업 `.prov`) */
  provider: {
    display: 'flex', alignItems: 'center', gap: 9,
    background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 8,
    padding: '10px 12px', fontSize: 13, marginBottom: 14,
  },
  /** 보조 버튼 (목업 `.btn.ghost`) */
  submitGhost: {
    minHeight: 48, borderRadius: 10, background: 'transparent',
    border: '1px solid var(--border2)', color: 'var(--text)',
    fontSize: 15, fontWeight: 600, width: '100%', marginTop: 4,
  },
  alt: { textAlign: 'center', fontSize: 12.5, color: 'var(--muted)', marginTop: 16, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 },
  altLink: { color: 'var(--accent)', borderBottom: '1px solid var(--accent)', paddingBottom: 1, fontWeight: 600 },
};
