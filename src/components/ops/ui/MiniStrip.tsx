'use client';

import Link from 'next/link';
import { MINI_BADGE, stageClassOf, type SafetyStateView, type StripStageClass } from '../safety-view';
import { cx, ops } from './styles';
import { useHeightReport } from './useHeightReport';

/**
 * 짧은 머리 띠 — 데모 `miniStrip()` 729~735행(분석 화면 머리. 설정 화면은 v1 생략 — 가이드 §2.6·L-7).
 * 제목 + 단계 배지. 배지를 누르면 홈(`/`)으로 — 자세한 안전 상태는 홈 띠에 있다.
 * 로딩 중에는 배지 대신 스피너 + 「확인 중…」(데모에 로딩 그림 없음 — 띠 로딩 문구를 줄여 씀).
 * `onHeightChange`: 띠 높이(px) — 아래 sticky 세그먼트의 `--strip-h` 용(SafetyStrip 과 같음).
 */
export function MiniStrip({ title, state, onHeightChange }: { title: string; state: SafetyStateView; onHeightChange?: (px: number) => void }) {
  const ref = useHeightReport<HTMLDivElement>(onHeightChange);
  let badge: JSX.Element;
  if (state.kind === 'loading') {
    badge = (
      <span className={ops.stage} aria-busy="true">
        <span className={ops.spin} aria-hidden="true" />확인 중…
      </span>
    );
  } else {
    const cls: StripStageClass = state.kind === 'ok' ? stageClassOf(state.dto.stage) : 'err';
    const text = MINI_BADGE[cls];
    badge = (
      <Link href="/" className={cx(ops.stage, ops[cls])} aria-label={`안전 상태 ${text} — 홈에서 자세히`}>
        <span className={ops.dot} aria-hidden="true" />{text}
      </Link>
    );
  }
  return (
    <div ref={ref} className={ops.strip}>
      <div className={ops['strip-h']}>
        <span className={cx(ops['strip-sum'], ops['strip-title'])}>{title}</span>
        {badge}
      </div>
    </div>
  );
}
