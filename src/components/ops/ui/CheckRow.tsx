import Link from 'next/link';
import type { ReactNode } from 'react';
import { cx, ops } from './styles';

/**
 * 확인 필요·목록 한 줄 — 데모 `row()`. 56px. `href` 가 있으면 링크(끝에 `›`), 없으면 정적 줄.
 * severity: e 위험(빨강 테두리) · w 주의(주황) · i 정보 · n 중립(테두리만). glyph 는 읽기 도구에 숨긴다(제목이 뜻을 말한다).
 */
export type CheckSeverity = 'e' | 'w' | 'i' | 'n';

export function CheckRow(props: { severity: CheckSeverity; glyph: ReactNode; title: ReactNode; sub?: ReactNode; href?: string; right?: ReactNode }) {
  const { severity, glyph, title, sub, href, right } = props;
  const sev = severity === 'n' ? null : ops[severity];
  const inner = (
    <>
      <span className={cx(ops.ic, sev)} aria-hidden="true">{glyph}</span>
      <span>
        <span className={ops.t}>{title}</span>
        {sub ? <span className={ops.s}>{sub}</span> : null}
      </span>
      <span className={ops.r}>{right ?? (href ? '›' : '')}</span>
    </>
  );
  return href
    ? <Link href={href} className={ops.rowl}>{inner}</Link>
    : <div className={ops.rowl}>{inner}</div>;
}

/** 로딩 줄 2개 — 데모 checkSec 로딩. */
export function SkeletonRows() {
  return (
    <div className={ops.rows} aria-busy="true">
      <div className={ops.rowl}><span className={ops.skel} style={{ width: 22 }} /><span className={cx(ops.skel, ops.w80)} /><span /></div>
      <div className={ops.rowl}><span className={ops.skel} style={{ width: 22 }} /><span className={cx(ops.skel, ops.w50)} /><span /></div>
    </div>
  );
}
