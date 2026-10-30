import Link from 'next/link';
import type { ReactNode } from 'react';
import { ops } from './styles';

/** 섹션 머리 오른쪽 이동 링크 — 데모 `lnk()`: 44px, 끝에 ` ›`. 이동만 한다(위험 CTA 아님). */
export function SectionLink({ href, children, ariaLabel }: { href: string; children: ReactNode; ariaLabel?: string }) {
  return (
    <Link href={href} className={ops.lnk} aria-label={ariaLabel}>
      {children} ›
    </Link>
  );
}
