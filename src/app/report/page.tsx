import { Suspense } from 'react';
import { ReportScreen } from '@/components/report/ReportScreen';

export const dynamic = 'force-dynamic';

/**
 * T-182 거래 리포트 전문 화면 — 텔레그램 「👉 앱에서 자세히 보기」 버튼으로 들어온다(탭 밖 상세 화면, 하단 탭은 활성 없음).
 * `?id=<숫자>` 가 없으면 최신 회차. `useSearchParams()` 때문에 Suspense 로 감싼다.
 */
export default function ReportPage() {
  return (
    <Suspense fallback={null}>
      <ReportScreen />
    </Suspense>
  );
}
