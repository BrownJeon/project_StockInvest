'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/',           label: '대시보드', icon: '🏠', emphasize: false },
  { href: '/favorites',  label: '즐겨찾기', icon: '⭐', emphasize: false },
  { href: '/recommend',  label: '추천',     icon: '💡', emphasize: true  },
  { href: '/analytics',  label: '분석',     icon: '📈', emphasize: false },
  { href: '/settings',   label: '설정',     icon: '⚙️', emphasize: false },
] as const;

/** 하단 탭을 숨길 경로 (로그인·회원가입 등 인증 전 화면) */
const HIDDEN_PATHS = ['/login', '/signup'];

export function BottomTabs() {
  const pathname = usePathname();
  if (HIDDEN_PATHS.includes(pathname)) return null;
  return (
    <nav aria-label="primary navigation" style={styles.nav}>
      {TABS.map((t) => {
        const active = t.href === '/' ? pathname === '/' : pathname.startsWith(t.href);
        const iconSize = t.emphasize ? 26 : 22;
        const transform = t.emphasize ? 'translateY(-2px)' : 'none';
        return (
          <Link key={t.href} href={t.href} style={{ ...styles.btn, color: active ? 'var(--accent)' : 'var(--muted)' }}>
            <span style={{ ...styles.ic, fontSize: iconSize, transform }} aria-hidden>{t.icon}</span>
            <span style={styles.label}>{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

const styles: Record<string, React.CSSProperties> = {
  nav: {
    position: 'fixed', left: 0, right: 0, bottom: 0,
    height: 'calc(var(--nav-h) + var(--safe-bottom))',
    paddingBottom: 'var(--safe-bottom)',
    background: 'var(--bg2)', borderTop: '1px solid var(--border)',
    display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)',
    zIndex: 20,
  },
  btn: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: 2, fontSize: 10, fontWeight: 600, minHeight: 56,
  },
  ic: { fontSize: 22, lineHeight: 1 },
  label: {},
};
