'use client';

/**
 * T-066 — 설정 > 안전장치 영역의 '리스크 정책' 요약 행 (승인 데모 v3 구조 A `riskRowA`).
 * 값 변경은 /settings/risk-policy 에서만 한다. 이 행은 저장된 정책으로 손절 합·손절가 아래 종목을 요약해 보인다.
 * 자체 조회(LlmProviderSection 과 같은 방식) — SettingsPage 의 Promise.all·저장 흐름과 섞지 않는다.
 */
import Link from 'next/link';
import { RiskStyles } from '@/components/risk/RiskStyles';
import { DisplayOnlyBadge } from '@/components/risk/StatusText';
import { RiskSummary } from '@/components/risk/RiskSummary';
import { useRiskPolicyFeed } from '@/components/risk/useRiskPolicyFeed';

export function RiskPolicySummaryRow() {
  const feed = useRiskPolicyFeed();
  const data = feed.data;
  const eff = data?.policy
    ? { stopPct: data.policy.stopPct, heatCapPct: data.policy.heatCapPct, stopBasis: data.policy.stopBasis }
    : data?.defaults ?? { stopPct: 3, heatCapPct: 2, stopBasis: 'avg' as const };
  // 서버가 같은 공용 함수(computeRisk)로 저장된 정책 기준 계산한 값을 그대로 쓴다
  const c = data?.computed ?? null;
  return (
    <div className="rp">
      <RiskStyles />
      <Link className="riskrow" href="/settings/risk-policy" aria-labelledby="rp-rr-t rp-sum">
        <div className="top"><b id="rp-rr-t">리스크 정책</b><DisplayOnlyBadge /></div>
        <div className="rk-sum" id="rp-sum">
          <RiskSummary
            state={feed.load}
            c={c}
            eff={eff}
            policySaved={!!data?.policy}
            snapshotAt={data?.snapshot?.at ?? null}
            stale={!!data?.snapshot?.stale}
          />
        </div>
        <div className="go"><span>손절 설정·예상 손절가 보기</span><span className="chev" aria-hidden="true">›</span></div>
      </Link>
    </div>
  );
}
