import { Suspense } from 'react';
import { HomeScreen } from '@/components/home/HomeScreen';
import { ReportLinkRedirect } from '@/components/report/ReportLinkRedirect';

export const dynamic = 'force-dynamic';

/**
 * 홈 `/` — T-108 부터 자동매매 운용현황(`HomeScreen`). 경로는 그대로 둔다(텔레그램 「앱에서 자세히」·App Links `path="/"` 호환).
 * 옛 홈 `components/dashboard/Dashboard.tsx` 는 여기서 import 만 끊었다 — 파일은 남긴다
 * (`TomorrowScenarioTab` export 를 시험 2개가 쓰고, `usd-cash-balance-fence` 가 그 파일을 센다 — 가이드 §5, L-6).
 */
export default function HomePage() {
  return (
    <>
      {/* T-182 — 텔레그램 리포트 버튼(`/?open=report&id=…`) 수신. 쿼리를 읽는 빈 조각만 Suspense 로 감싼다 */}
      <Suspense fallback={null}><ReportLinkRedirect /></Suspense>
      <HomeScreen />
    </>
  );
}
