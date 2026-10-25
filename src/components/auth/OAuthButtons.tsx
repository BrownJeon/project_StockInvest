'use client';

/**
 * 소셜 로그인 버튼 (T-009, 2026-08-08) — 목업 b6f4f54a 기준.
 *
 * **OAuth 앱을 등록하지 않은 프로바이더는 버튼이 렌더되지 않는다.** 목록은 서버가 준다
 * (`GET /api/auth/oauth-providers`) — 화면이 자체 판단하면 서버의 "설정됨" 기준과 갈라진다.
 * 하나도 없으면 구분선까지 통째로 사라져 기존 이메일 폼만 남는다.
 *
 * 목업 수치 그대로: 높이 48 / radius 9 / gap 10 / 14.5px 600.
 *
 * T-084 — **안드로이드 앱(WebView) 안에서는 아무것도 그리지 않는다**(구분선 포함, 승인 데모 v1 D). 앱은 이메일·비밀번호 로그인만 지원한다.
 * 판별은 목록 조회 전에 끝나므로(이 컴포넌트는 목록을 받기 전까지 원래 아무것도 그리지 않는다) 앱에서 버튼이 잠깐 보였다 사라지지 않는다.
 * 앱에서는 목록 조회도 하지 않는다. ⚠ 판별은 화면 표시 전용 — 서버의 OAuth 경로·권한 판단은 그대로다.
 */
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { isNativeApp } from '@/lib/native/bridge';

type ProviderName = 'google' | 'github';

const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" width={19} height={19} aria-hidden focusable="false" style={{ flex: '0 0 auto' }}>
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.76c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
    <path fill="#FBBC05" d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84z" />
    <path fill="#EA4335" d="M12 4.75c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.46 14.97.5 12 .5A11 11 0 0 0 2.18 7.05l3.66 2.84c.87-2.6 3.3-4.14 6.16-4.14z" />
  </svg>
);

const GithubIcon = () => (
  <svg viewBox="0 0 24 24" width={19} height={19} aria-hidden focusable="false" style={{ flex: '0 0 auto' }}>
    <path fill="currentColor" d="M12 .5a12 12 0 0 0-3.79 23.4c.6.1.82-.26.82-.58v-2.2c-3.34.72-4.04-1.4-4.04-1.4-.55-1.4-1.34-1.77-1.34-1.77-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.8 1.3 3.49 1 .1-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.11-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6.01 0c2.29-1.55 3.3-1.23 3.3-1.23.65 1.66.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.62-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.69.83.58A12 12 0 0 0 12 .5z" />
  </svg>
);

const BUTTONS: Record<ProviderName, { label: string; icon: () => JSX.Element; style: CSSProperties }> = {
  google: {
    label: 'Google로 계속하기',
    icon: GoogleIcon,
    style: { background: '#fff', color: '#1f1f1f', borderColor: '#dadce0' },
  },
  github: {
    label: 'GitHub로 계속하기',
    icon: GithubIcon,
    style: { background: '#1b1f26', color: '#e6e8ee', borderColor: '#3a4150' },
  },
};

const ORDER: ProviderName[] = ['google', 'github'];

/** 서버 목록 → 그릴 버튼(순서 고정). 앱이면 빈 목록(구분선까지 안 그림). */
export function visibleProviders(list: unknown, native: boolean): ProviderName[] {
  if (native) return [];
  const arr = Array.isArray(list) ? list : [];
  return ORDER.filter((p) => arr.includes(p));
}

export function OAuthButtons({ nextPath }: { nextPath?: string }) {
  const [providers, setProviders] = useState<ProviderName[] | null>(null);

  useEffect(() => {
    let alive = true;
    // T-084: 앱이면 조회하지 않고 빈 목록 — 렌더 없음.
    if (isNativeApp()) {
      setProviders([]);
      return () => { alive = false; };
    }
    fetch('/api/auth/oauth-providers')
      .then((r) => r.json())
      .then((d: { providers?: unknown }) => {
        if (!alive) return;
        setProviders(visibleProviders(d.providers, false));
      })
      .catch(() => { if (alive) setProviders([]); });
    return () => { alive = false; };
  }, []);

  // 로딩 중에도, 하나도 없을 때도 아무것도 그리지 않는다 —
  // 빈 버튼이나 자리표시자가 잠깐 보이면 "눌러도 안 되는 버튼"으로 오해된다.
  if (providers === null || providers.length === 0) return null;

  function start(provider: ProviderName) {
    const qs = nextPath ? `?next=${encodeURIComponent(nextPath)}` : '';
    window.location.href = `/api/auth/${provider}${qs}`;
  }

  return (
    <>
      <div style={oauthStyles.list}>
        {providers.map((p) => {
          const b = BUTTONS[p];
          const Icon = b.icon;
          return (
            <button
              key={p}
              type="button"
              onClick={() => start(p)}
              style={{ ...oauthStyles.button, ...b.style }}
            >
              <Icon />
              {b.label}
            </button>
          );
        })}
      </div>
      <div style={oauthStyles.divider} aria-hidden>
        <span style={oauthStyles.dividerLine} />
        <span>또는 이메일로</span>
        <span style={oauthStyles.dividerLine} />
      </div>
    </>
  );
}

export const oauthStyles: Record<string, CSSProperties> = {
  list: { display: 'flex', flexDirection: 'column', gap: 10 },
  button: {
    minHeight: 48, borderRadius: 9, border: '1px solid var(--border2)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
    fontSize: 14.5, fontWeight: 600, width: '100%', cursor: 'pointer',
  },
  divider: {
    display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0 16px',
    color: 'var(--muted)', fontSize: 11.5,
  },
  dividerLine: { flex: 1, height: 1, background: 'var(--border2)' },
};
