'use client';

import { useEffect, useState } from 'react';
import { formatSymbolShort } from '@/lib/symbols';

/**
 * `/api/ticker/all`의 stock_meta 캐시를 한 번 가져와
 * `displaySymbol(sym)` 헬퍼와 `marketFlag(sym)`을 반환.
 *
 * - 표시: `종목명 (코드)` 또는 코드 폴백 (KRW/USD 그대로)
 * - 국기: 국내 🇰🇷, 해외 🇺🇸, 현금 빈 문자
 * - 컴포넌트 마운트 후 1회 fetch — 이후 prop 변동에도 캐시 재사용
 */
export function useSymbolMeta() {
  const [meta, setMeta] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    fetch('/api/ticker/all')
      .then(r => r.json())
      .then(j => {
        if (alive && j.ok && j.meta) setMeta(j.meta as Record<string, string>);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const displaySymbol = (sym: string): string => {
    if (!sym) return '';
    if (sym === 'KRW' || sym === 'USD') return sym;
    const name = meta[sym];
    const short = formatSymbolShort(sym);
    if (name && name !== sym && name !== short) return `${name} (${short})`;
    return short;
  };

  const marketFlag = (sym: string): string => {
    if (!sym || sym === 'KRW' || sym === 'USD') return '';
    return sym.includes(':') ? '🇺🇸' : '🇰🇷';
  };

  return { meta, displaySymbol, marketFlag };
}
