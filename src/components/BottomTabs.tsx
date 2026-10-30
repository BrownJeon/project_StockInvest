'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NavIcon, type NavIconName } from '@/components/nav/NavIcons';

/**
 * 하단 탭 — T-108 승인 데모 v3(`mockups/T-108-menu-home-v3.html`) 「하단 5탭」 + 가이드 §1.1.
 *
 * T-113(비서 대화 소유권) 배포 전이라 **4칸**(홈·거래·분석·설정)이다. 비서(brain)는 배열에 두지 않는다 —
 * T-113 때 4번째(설정 앞)에 끼운다. 가운데 강조(emphasize) 개념은 없앴다.
 * 활성 규칙은 `matches` 한 곳에만 둔다(시험 B-1 이 경로별로 대조).
 */
interface TabDef {
  href: string;
  label: string;
  icon: NavIconName;
  matches: (pathname: string) => boolean;
}

export const TABS: readonly TabDef[] = [
  { href: '/', label: '홈', icon: 'stone', matches: (p) => p === '/' },
  {
    href: '/recommend', label: '거래', icon: 'handshake',
    matches: (p) => p.startsWith('/recommend') || p.startsWith('/strategy') || p === '/order',
  },
  {
    href: '/analytics', label: '분석', icon: 'scan-search',
    matches: (p) => p.startsWith('/analytics') || p.startsWith('/favorites'),
  },
  {
    href: '/settings', label: '설정', icon: 'settings',
    matches: (p) => p.startsWith('/settings') || p.startsWith('/profile'),
  },
];

/** 현재 경로에서 활성인 탭의 href — 없으면 null(`/ai`·`/markets` 등은 활성 탭 없음). 첫 일치 하나만. */
export function activeTabHref(pathname: string): string | null {
  return TABS.find((t) => t.matches(pathname))?.href ?? null;
}

/**
 * 하단 탭을 숨길 경로 (로그인·회원가입 등 인증 전 화면).
 *
 * 인증 전 화면에서 탭이 보이면 눌러도 전부 /login 으로 튕긴다 — 막다른 길이다.
 *
 * ⚠️ 정확히 일치하는 경로만 숨긴다. 새 인증 전 화면을 추가하면 **여기에도 등록**해야 한다.
 *    (T-010 에서 `/signup/request` 와, 누락돼 있던 `/oauth/invite`(T-009)를 함께 등록했다.)
 *    T-084: 앱 업데이트 띠(`components/app/AppUpdateBanner.tsx`)도 이 목록을 그대로 써서 인증 전 화면에서 숨는다.
 */
export const HIDDEN_PATHS = ['/login', '/signup', '/signup/request', '/oauth/invite'];

/**
 * 데모 236~242행(`.bn`) + 280행(데스크톱 복원)을 옮겼다. 루트 클래스 `.bn` 범위로 가둔다(T-084 `AppStyles` 방식 —
 * 이 파일은 `app-shell-render`·`app-version-gate-t091` 시험이 import 하므로 CSS Module 을 쓰지 않는다).
 * - 데모의 `position:absolute`(폰 틀 안) → 앱은 `position:fixed`. 높이·safe-area 는 기존 값 그대로.
 * - 활성 탭 위 2px 막대는 `::before` 대신 `<span class="bar" aria-hidden>` 로 그린다(가이드 §1.1 허용).
 * - 데모의 `@container app (min-width: 900px)` → `@media (min-width: 900px)`.
 * - 라벨 11px(지금까지 10px — 11px 미만 금지 규칙, 데모 E 절 7).
 */
export const BOTTOM_TABS_CSS = `
.bn { position: fixed; left: 0; right: 0; bottom: 0; height: calc(var(--nav-h) + var(--safe-bottom)); padding-bottom: var(--safe-bottom); background: var(--bg2); border-top: 1px solid var(--border); display: grid; grid-template-columns: repeat(4, 1fr); z-index: 20; }
.bn a { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; min-height: 56px; color: var(--muted); font-size: 11px; font-weight: 600; line-height: 1.2; }
.bn a svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.bn a[aria-current="page"] { color: var(--accent); }
.bn .bar { position: absolute; top: 0; left: 30%; right: 30%; height: 2px; background: var(--accent); border-radius: 0 0 2px 2px; }
.bn a:focus-visible { outline: 2px solid var(--text); outline-offset: -2px; border-radius: 4px; }
@media (min-width: 900px) {
  .bn { left: 50%; right: auto; width: 720px; transform: translateX(-50%); border: 1px solid var(--border); border-bottom: 0; border-radius: 14px 14px 0 0; }
}
`;

export function BottomTabs() {
  const pathname = usePathname() ?? '';
  if (HIDDEN_PATHS.includes(pathname)) return null;
  const active = activeTabHref(pathname);
  return (
    <nav className="bn" aria-label="주 메뉴">
      <style>{BOTTOM_TABS_CSS}</style>
      {TABS.map((t) => {
        const cur = t.href === active;
        return (
          <Link key={t.href} href={t.href} aria-current={cur ? 'page' : undefined}>
            {cur && <span className="bar" aria-hidden="true" />}
            <NavIcon name={t.icon} />
            <span>{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
