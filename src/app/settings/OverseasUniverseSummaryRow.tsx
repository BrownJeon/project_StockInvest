'use client';

/**
 * T-143 WP-B — 설정 › 전략 설정의 「해외 분석 대상」 요약 행 (승인 데모 v1 §0 오른쪽 칸, 구현 가이드 §2.1).
 *
 * 누르면 `/settings/overseas-universe`. **56px 행이고 행 전체가 누르는 영역**(T-130 에서 교정된 규칙), 끝에 `›`.
 *
 * **자체 조회**다 — `RiskPolicySummaryRow`·`CashLedgerSummaryRow` 와 같은 방식으로, `SettingsPage` 의 `Promise.all`
 * 묶음 조회와 **저장 바(`isDirty`) 흐름에 섞지 않는다**(설정 저장 버튼이 이 값을 함께 저장하는 것처럼 보이면 안 된다).
 * 주기 재조회 없음(본 화면과 같다).
 *
 * 값이 null 인 조각은 **그 구절을 뺀다** — 0 으로 채우지 않는다(T-108 §2.3.2 규칙).
 */
import type { ReactNode } from 'react';
import Link from 'next/link';
import { StatusChip, cx } from '@/components/ops/ui';
import { SkelBar } from '@/components/ops/ui/LineList';
import { UniverseStyles } from '@/components/universe/UniverseStyles';
import { useUniverseFeed } from '@/components/universe/useUniverseFeed';
import { NOT_READY_TEXT, summaryRowSub } from '@/components/universe/view';

export function OverseasUniverseSummaryRow() {
  const feed = useUniverseFeed();
  const d = feed.data;
  const summary = d?.summary.state === 'ok' ? d.summary.data : null;
  const open = d?.proposals.state === 'ok' ? d.proposals.data.filter((p) => p.state === 'open').length : null;

  const notMigrated = feed.load === 'error' && feed.loadCode === 'not_migrated';

  let sub: ReactNode;
  if (feed.load === 'loading') sub = <SkelBar w={80} />;
  else if (notMigrated) sub = <StatusChip kind="prep">◌ {NOT_READY_TEXT}</StatusChip>;
  else if (feed.load === 'error' || !summary) sub = '불러오지 못했습니다 — 눌러서 다시 확인';
  else sub = summaryRowSub(summary);

  return (
    <div className="uv">
      <UniverseStyles />
      <Link className="uv-row" href="/settings/overseas-universe" aria-labelledby="uv-row-t uv-row-s">
        <span className={cx('ic', open != null && open > 0 ? 'w' : undefined)} aria-hidden="true">
          {open != null && open > 0 ? String(open) : 'U'}
        </span>
        <span>
          <span className="t" id="uv-row-t">
            해외 분석 대상
            {open != null && open > 0 ? <span className="chip manual">변경 제안 {open}</span> : null}
          </span>
          <span className="s" id="uv-row-s">{sub}</span>
        </span>
        <span className="r" aria-hidden="true">›</span>
      </Link>
    </div>
  );
}
