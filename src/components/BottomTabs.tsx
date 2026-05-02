'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/',          label: '대시보드', icon: '🏠', emphasize: false },
  { href: '/strategy',  label: '전략',     icon: '🎯', emphasize: false },
  { href: '/ai',        label: '채팅',     icon: '🤖', emphasize: true  },
  { href: '/analytics', label: '분석',     icon: '📈', emphasize: false },
  { href: '/settings',  label: '설정',     icon: '⚙️', emphasize: false },
] as const;

export function BottomTabs() {
  const pathname = usePathname();
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
