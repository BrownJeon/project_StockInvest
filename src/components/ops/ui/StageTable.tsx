import type { ReactNode } from 'react';
import { cx, ops } from './styles';

/**
 * 단계 × 국내·해외 두 열 표 — 데모 `anaTable()`(홈 「오늘의 분석·판단」·분석 › 오늘 분석).
 * 머리 칸은 `{ text, small }`(예: 국내 / 「10-30 · 16:00 실행」). caption 은 표 아래(caption-side: bottom).
 * dim = 오래됨(값 회색).
 */
export interface StageHead { text: ReactNode; small?: ReactNode }

export function StageTable(props: { caption?: ReactNode; head: readonly [ReactNode, StageHead?, StageHead?]; rows: { label: ReactNode; cells: ReactNode[] }[]; dim?: boolean }) {
  const { caption, head, rows, dim } = props;
  const cols = head.slice(1) as (StageHead | undefined)[];
  return (
    <table className={ops.mt}>
      {caption ? <caption>{caption}</caption> : null}
      <thead>
        <tr>
          <th scope="col">{head[0]}</th>
          {cols.map((c, i) => c ? <th key={i} scope="col">{c.text}{c.small ? <small>{c.small}</small> : null}</th> : null)}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <th scope="row">{r.label}</th>
            {r.cells.map((c, j) => <td key={j} className={cx(dim && ops.dim) || undefined}>{c}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
