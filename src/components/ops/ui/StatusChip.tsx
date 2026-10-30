import type { ReactNode } from 'react';
import { cx, ops } from './styles';

/**
 * 상태 칩 — 데모 `st()`·C 절. **글자 + 테두리 모양**(실선·점선·점)을 같이 바꾼다 — 색만으로 구분하지 않는다.
 * 문구는 `format.ts` 의 `CHIP` 을 쓴다(「✓ 확인된 0」 「◌ 미수집」 「! 조회 실패 · {code}」 …).
 */
export type ChipKind = 'zero' | 'unknown' | 'error' | 'stale' | 'partial' | 'blocked' | 'off' | 'prep';

export function StatusChip({ kind, children }: { kind: ChipKind; children: ReactNode }) {
  return <span className={cx(ops.st, ops[kind])}>{children}</span>;
}
