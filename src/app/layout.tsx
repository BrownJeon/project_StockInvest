import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { BottomTabs } from '@/components/BottomTabs';
import { ToastProvider } from '@/components/ui/Toast';
import { AppUpdateBanner } from '@/components/app/AppUpdateBanner';

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
        </ToastProvider>
      </body>
    </html>
  );
}
