import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { BottomTabs } from '@/components/BottomTabs';
import { ToastProvider } from '@/components/ui/Toast';
import { AppUpdateBanner } from '@/components/app/AppUpdateBanner';
import { AppLinkNavigator } from '@/components/app/AppLinkNavigator';

export const metadata: Metadata = {
  title: '주식 자동매매',
  description: '국내·해외 주식 자동 분석·매매·수익화 웹앱 (KIS 기반)',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0f1115',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <ToastProvider>
          <div style={{ minHeight: '100dvh', paddingBottom: 'calc(var(--nav-h) + var(--safe-bottom))' }}>
            {/* T-084 앱 업데이트 띠 — 문서 흐름 안 맨 위(화면을 덮지 않음). 앱 + 인증 뒤 화면에서만, 웹은 렌더·요청 없음 */}
            <AppUpdateBanner />
            {children}
          </div>
          <BottomTabs />
          {/* T-091 M2 App Link 수신 → WebView 이동. 그리는 것 없음, 앱에서만 구독(웹은 아무 일도 안 함). 레이아웃에 한 번만 둔다 */}
          {/* {children} 뒤에 둔다 — 로그인 딥링크 구독(AppDeepLink)이 먼저여야 한다(Capacitor 는 붙잡아 둔 appUrlOpen 을 첫 구독자 하나에게만 준다) */}
          <AppLinkNavigator />
        </ToastProvider>
      </body>
    </html>
  );
}
