'use client';

/**
 * T-091 M2 — App Link(텔레그램 "앱에서 자세히" 등 https 링크)로 앱이 열리면 WebView 를 그 경로로 옮긴다. **그리는 것이 없다**(null).
 *
 * 루트 레이아웃(`src/app/layout.tsx`)에 **한 번만** 둔다 — 어느 화면에 있든 링크를 받아야 하므로(로그인 딥링크 `AppDeepLink` 는 로그인 화면에만 있다).
 * 판정·이동은 `src/lib/native/appLink.ts` `onAppLink` 가 한다(https·같은 호스트·같은 출처 경로만, 로그인 딥링크와 분리).
 * 앱이 아니면(웹) `onAppLink` 가 아무것도 구독하지 않는다. ⚠ 앱 판별은 화면 이동 전용 — 서버는 믿지 않는다.
 * ⚠ 레이아웃에서 `{children}` **뒤에** 둔다 — 로그인 딥링크 구독(`AppDeepLink`)이 먼저여야 한다. Capacitor 는 붙잡아 둔 `appUrlOpen` 을
 *   첫 구독자 하나에게만 주므로, 이 구독이 먼저면 앱이 떠 있는 동안 온 로그인 콜백을 놓칠 수 있다(appLink.ts 머리 주석 ④, 순서는 시험이 고정).
 */
import { useEffect } from 'react';
import { onAppLink } from '@/lib/native/appLink';

export function AppLinkNavigator() {
  useEffect(() => onAppLink(), []);
  return null;
}
