'use client';

/**
 * T-108 분석 3분류 패널 공용 조각 — 지표 상태(MetricState) → 상태 칩, 조회 실패 본문.
 * 「0」은 조회 성공 + 0(`zero`)일 때만, 값이 없으면 `—` + 사유 칩(가이드 §2.1). 칩 문구는 `format.ts` CHIP 한 곳.
 */
import type { ReactNode } from 'react';
import type { Metric, MetricState } from '@/lib/ops/metrics/types';
import { CHIP, fmtKstTime } from '@/components/ops/format';
import { RetryButton, SectionBody, StatusChip } from '@/components/ops/ui';

/** 분석 패널 조회 주소 — part 별로 따로 읽는다(서버 봉투 `{ ok, data }`). */
export function analysisUrl(part: 'today' | 'verify' | 'data'): string {
  return `/api/ops/analysis?part=${part}`;
}
export const ANALYSIS_POLL_MS = 60_000;

export function stateChip(
  m: Pick<Metric<unknown>, 'state' | 'asOf'> & { reason?: string },
  o: { nowMs: number; partial?: string; prep?: string; zero?: string; available?: ReactNode } ,
): ReactNode {
  const s: MetricState = m.state;
  if (s === 'available') return o.available ?? null;
  if (s === 'zero') return <StatusChip kind="zero">{o.zero ?? CHIP.zero}</StatusChip>;
  if (s === 'unknown') return <StatusChip kind="unknown">{CHIP.unknown}</StatusChip>;
  if (s === 'error') return <StatusChip kind="error">{CHIP.error(m.reason ?? 'error')}</StatusChip>;
  if (s === 'stale') return <StatusChip kind="stale">{CHIP.stale(fmtKstTime(m.asOf, o.nowMs))}</StatusChip>;
  if (s === 'partial') return <StatusChip kind="partial">{o.partial ?? '부분'}</StatusChip>;
  if (s === 'blocked') return <StatusChip kind="blocked">⊘ 차단</StatusChip>;
  if (s === 'off_hours') return <StatusChip kind="off">장외</StatusChip>;
  return <StatusChip kind="prep">{o.prep ?? '준비 중'}</StatusChip>;
}

/** 값이 있는(숫자로 써도 되는) 상태인가 — available·zero·stale·partial 만. */
export function hasValue<T>(m: Metric<T> | null | undefined): m is Metric<T> & { value: T } {
  return !!m && m.value != null && (m.state === 'available' || m.state === 'zero' || m.state === 'stale' || m.state === 'partial');
}

/** 섹션 전체 조회 실패 — 「! 조회 실패 · {code}」 + [다시 시도]. 비어 있는 것이 아니다. */
export function FailBody({ code, onRetry }: { code: string; onRetry?: () => void }) {
  return (
    <SectionBody>
      <StatusChip kind="error">{CHIP.error(code)}</StatusChip>
      {onRetry ? <div style={{ marginTop: 8 }}><RetryButton onClick={onRetry} /></div> : null}
    </SectionBody>
  );
}

/** 로딩 막대 2줄(데모 stateBody 로딩). */
export function LoadingBody() {
  return (
    <SectionBody>
      <div aria-busy="true" style={{ display: 'grid', gap: 6 }}>
        <span style={{ display: 'block', height: 14, width: '80%', borderRadius: 4, background: 'var(--bg3)' }} />
        <span style={{ display: 'block', height: 14, width: '50%', borderRadius: 4, background: 'var(--bg3)' }} />
      </div>
    </SectionBody>
  );
}
