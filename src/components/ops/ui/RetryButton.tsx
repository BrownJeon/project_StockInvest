'use client';

import { ops } from './styles';

/** 「다시 시도」 — 데모 `.retry`(44px). 조회 실패 섹션마다. */
export function RetryButton({ onClick, label = '다시 시도' }: { onClick?: () => void; label?: string }) {
  return <button type="button" className={ops.retry} onClick={onClick}>{label}</button>;
}
