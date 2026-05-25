import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { BottomTabs } from '@/components/BottomTabs';
import { ToastProvider } from '@/components/ui/Toast';

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
            {children}
          </div>
          <BottomTabs />
        </ToastProvider>
      </body>
    </html>
  );
}
