import type { ReactNode } from 'react';
import { ops } from './styles';

/** 최근 활동 목록 — 데모 `actSec()`: 시각 열 52px + 제목/부제. 시각은 호출자가 서식(오늘이면 HH:MM, 아니면 MM-DD HH:MM). */
export function ActivityList({ items }: { items: { time: ReactNode; title: ReactNode; sub?: ReactNode }[] }) {
  return (
    <div className={ops.rows}>
      {items.map((it, i) => (
        <div key={i} className={ops.act}>
          <span className={ops.tm}>{it.time}</span>
          <span>{it.title}{it.sub ? <span className={ops.s}>{it.sub}</span> : null}</span>
        </div>
      ))}
    </div>
  );
}
