'use client';

/**
 * T-182 — 홈 `/` 가 `?open=report&id=<숫자>` 를 받으면 `/report?id=<숫자>` 로 옮긴다(그리는 것 없음).
 *
 * 텔레그램 버튼 링크는 앱 App Link 가 받는 사이트 루트(`/`) + 쿼리다 — 네이티브(`AndroidManifest.xml`·`appLink.ts`)는
 * 바꾸지 않는다. 판정은 `reportRedirectTarget()` 한 곳: `open=report` 이고 id 가 양의 정수일 때만 이동하고,
 * 그 밖의 값은 무시한다(임의 경로로 보내는 열린 리다이렉트를 만들지 않는다). `router.replace` 라 뒤로 가기에 남지 않는다.
 */
import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { reportRedirectTarget } from '@/lib/reports/trade-report-view';

export function ReportLinkRedirect() {
  const router = useRouter();
  const params = useSearchParams();
  const target = reportRedirectTarget(params);
  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);
  return null;
}
