/**
 * T-108 하단 탭 아이콘 — lucide-react 1.24.0 (ISC) 원본 경로.
 *
 * 승인 데모 `mockups/T-108-menu-home-v3.html` 529~534행의 SVG 도형을 그대로 옮겼다(직접 그린 도형 없음).
 * 아이콘 선택 근거: `docs/design/2026-10-27-navigation-icon-decisions.md` (홈 stone · 거래 handshake · 분석 scan-search · 설정 settings).
 * 비서(brain)는 T-113 배포 전이라 이번에 두지 않는다(가이드 §1.1).
 * `lucide-react` 의존성은 추가하지 않는다(가이드 §0.3) — 경로만 인라인.
 *
 * 도형 수: stone 3 · handshake 5 · scan-search 6 · settings 2 (B-1 시험이 센다).
 * ISC License — Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT).
 * All other copyright (c) for Lucide are held by Lucide Contributors 2022.
 */

export type NavIconName = 'stone' | 'handshake' | 'scan-search' | 'settings';

/** 렌더할 때 만든다(모듈 로드 시점 JSX 없음 — jest 고전 런타임은 React 가 전역에 놓인 뒤에만 JSX 를 평가할 수 있다). */
const SHAPES: Record<NavIconName, () => JSX.Element> = {
  stone: () => (
    <>
      <path d="M11.264 2.205A4 4 0 0 0 6.42 4.211l-4 8a4 4 0 0 0 1.359 5.117l6 4a4 4 0 0 0 4.438 0l6-4a4 4 0 0 0 1.576-4.592l-2-6a4 4 0 0 0-2.53-2.53z" />
      <path d="M11.99 22 14 12l7.822 3.184" />
      <path d="M14 12 8.47 2.302" />
    </>
  ),
  handshake: () => (
    <>
      <path d="m11 17 2 2a1 1 0 1 0 3-3" />
      <path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4" />
      <path d="m21 3 1 11h-2" />
      <path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3" />
      <path d="M3 4h8" />
    </>
  ),
  'scan-search': () => (
    <>
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <circle cx="12" cy="12" r="3" />
      <path d="m16 16-1.9-1.9" />
    </>
  ),
  settings: () => (
    <>
      <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
};

/** 22px · 선 2 · 둥근 끝 — 색은 글자색(`currentColor`)을 따른다(활성 = --accent, 비활성 = --muted). 장식용(aria-hidden). */
export function NavIcon({ name, size = 22 }: { name: NavIconName; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {SHAPES[name]()}
    </svg>
  );
}
