'use client';

/**
 * T-108 분석 3분류 패널 공용 조각 — 지표 상태(MetricState) → 상태 칩, 조회 실패 본문.
 * 「0」은 조회 성공 + 0(`zero`)일 때만, 값이 없으면 `—` + 사유 칩(가이드 §2.1). 칩 문구는 `format.ts` CHIP 한 곳.
 */
import type { ReactNode } from 'react';
import type { Metric, MetricState } from '@/lib/ops/metrics/types';
import { CHIP, fmtKstTime } from '@/components/ops/format';
import { RetryButton, SectionBody, StatusChip, ops } from '@/components/ops/ui';
import { blockedChipText, errorChipText } from '@/components/ops/reason-copy';

/** 분석 패널 조회 주소 — part 별로 따로 읽는다(서버 봉투 `{ ok, data }`). */
export function analysisUrl(part: 'today' | 'verify' | 'data'): string {
  return `/api/ops/analysis?part=${part}`;
}
export const ANALYSIS_POLL_MS = 60_000;

/**
 * `showCode` — 분석 › 데이터 상태에서만 켠다(T-130 D4-A): 한국어 칩 뒤에 작은 영문 원인 코드(`<code>`)를 붙인다.
 * 홈·거래·분석(오늘 분석·검증·성과)은 한국어만 — 영문 코드를 보이지 않는다.
 */
export function stateChip(
  m: Pick<Metric<unknown>, 'state' | 'asOf'> & { reason?: string },
  o: { nowMs: number; partial?: string; prep?: string; zero?: string; available?: ReactNode; showCode?: boolean } ,
): ReactNode {
  const s: MetricState = m.state;
  if (s === 'available') return o.available ?? null;
  if (s === 'zero') return <StatusChip kind="zero">{o.zero ?? CHIP.zero}</StatusChip>;
  if (s === 'unknown') return <StatusChip kind="unknown">{CHIP.unknown}</StatusChip>;
  if (s === 'error') return <ErrorStateChip code={m.reason} showCode={o.showCode} />;
  if (s === 'stale') return <StatusChip kind="stale">{CHIP.stale(fmtKstTime(m.asOf, o.nowMs))}</StatusChip>;
  if (s === 'partial') return <StatusChip kind="partial">{o.partial ?? '부분'}</StatusChip>;
  if (s === 'blocked') {
    // 차단은 막은 장치와 함께(`⊘ 차단 · 검증 관문`), 엔진 꺼짐은 차단이 아니라 꺼짐 — 사전 blockedChipText (T-130 5번)
    const b = blockedChipText(m.reason);
    return <StatusChip kind={b.kind}>{b.text}</StatusChip>;
  }
  if (s === 'off_hours') return <StatusChip kind="off">장외</StatusChip>;
  return <StatusChip kind="prep">{o.prep ?? '준비 중'}</StatusChip>;
}

/** 조회 실패 칩 — 한국어 칩(사전 `errorChipText`), `showCode` 일 때만 뒤에 원인 코드 원문을 작게 붙인다. */
function ErrorStateChip({ code, showCode }: { code: string | null | undefined; showCode?: boolean }) {
  const e = errorChipText(code, { showCode });          // 사유가 없으면 「원인 모름」 — 코드를 지어내지 않는다(code=null)
  return (
    <StatusChip kind="error">
      {e.text}
      {e.code ? <code className={ops.stCode}>{e.code}</code> : null}
    </StatusChip>
  );
}

/** 값이 있는(숫자로 써도 되는) 상태인가 — available·zero·stale·partial 만. */
export function hasValue<T>(m: Metric<T> | null | undefined): m is Metric<T> & { value: T } {
  return !!m && m.value != null && (m.state === 'available' || m.state === 'zero' || m.state === 'stale' || m.state === 'partial');
}

/** 섹션 전체 조회 실패 — 「! 조회 실패 · {원인 말}」 + [다시 시도]. 비어 있는 것이 아니다. `showCode` 는 데이터 상태 패널만(D4-A). */
export function FailBody({ code, onRetry, showCode }: { code: string; onRetry?: () => void; showCode?: boolean }) {
  return (
    <SectionBody>
      <ErrorStateChip code={code} showCode={showCode} />
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
