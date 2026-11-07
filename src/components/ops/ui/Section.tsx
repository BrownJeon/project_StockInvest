import type { ReactNode } from 'react';
import { ops } from './styles';

/**
 * 화면 영역 1개 — 데모 `sec()`: `<section aria-labelledby>` + 머리(제목 · small · 오른쪽 링크) + 본문 + foot.
 * 본문 안쪽 여백이 필요하면 `SectionBody`(`.sec-b`)로 감싼다(목록·표·칸 격자는 가장자리까지 붙는다).
 */
export function Section(props: { id: string; title: ReactNode; small?: ReactNode; link?: ReactNode; foot?: ReactNode; children?: ReactNode; busy?: boolean; focusHeading?: boolean }) {
  const { id, title, small, link, foot, children, busy, focusHeading } = props;
  return (
    <section className={ops.sec} aria-labelledby={id} aria-busy={busy ? true : undefined}>
      <div className={ops['sec-h']}>
        <h2 id={id} tabIndex={focusHeading ? -1 : undefined}>{title}{small ? <small>{small}</small> : null}</h2>
        {link ?? null}
      </div>
      {children}
      {foot ? <div className={ops['sec-foot']}>{foot}</div> : null}
    </section>
  );
}

/** 섹션 본문 여백(`.sec-b`). */
export function SectionBody({ children }: { children?: ReactNode }) {
  return <div className={ops['sec-b']}>{children}</div>;
}

/** 빈 상태 한 줄(`.empty`) — 예: 「**지금 확인할 것 없음** — …」. */
export function EmptyNote({ children }: { children?: ReactNode }) {
  return <div className={ops.empty}>{children}</div>;
}

/** 행 목록 틀(`.rows`) — `CheckRow`·`ActivityList` 줄을 담는다. */
export function Rows({ children, busy }: { children?: ReactNode; busy?: boolean }) {
  return <div className={ops.rows} aria-busy={busy ? true : undefined}>{children}</div>;
}
