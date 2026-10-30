import type { ReactNode } from 'react';
import { cx, ops } from './styles';

/** 키·내용 줄 목록 — 데모 `.lines/.ln`(청산 로직 3줄: 가동·판정·청산). 키 열 64px. 줄 아래 보조 글자는 `LineSub`. */
export function LineList({ lines, busy }: { lines: { k: ReactNode; d: ReactNode }[]; busy?: boolean }) {
  return (
    <div className={ops.lines} aria-busy={busy ? true : undefined}>
      {lines.map((ln, i) => (
        <div key={i} className={ops.ln}>
          <span className={ops.k}>{ln.k}</span>
          <span className={ops.d}>{ln.d}</span>
        </div>
      ))}
    </div>
  );
}

/** 줄 아래 작은 보조 글자(`.m`). */
export function LineSub({ children }: { children?: ReactNode }) {
  return <span className={ops.m}>{children}</span>;
}

/** 로딩 막대(`.skel`) — w = 80 | 50. */
export function SkelBar({ w = 80 }: { w?: 80 | 50 }) {
  return <span className={cx(ops.skel, w === 80 ? ops.w80 : ops.w50)} />;
}
