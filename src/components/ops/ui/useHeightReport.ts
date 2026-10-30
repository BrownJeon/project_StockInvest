'use client';

import { useEffect, useRef } from 'react';

/**
 * 요소 높이(px)를 콜백으로 알린다(처음 1회 + 크기가 바뀔 때). 띠(SafetyStrip·MiniStrip) 아래 sticky 세그먼트가
 * `top: var(--strip-h)` 로 붙도록 부모가 CSS 변수를 넣을 때 쓴다. 콜백이 없으면 아무 일도 하지 않는다.
 */
export function useHeightReport<T extends HTMLElement>(onHeightChange?: (px: number) => void) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !onHeightChange) return;
    onHeightChange(el.offsetHeight);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => onHeightChange(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [onHeightChange]);
  return ref;
}
