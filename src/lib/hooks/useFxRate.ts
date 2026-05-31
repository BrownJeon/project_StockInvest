'use client';

import { useState, useEffect } from 'react';

const DEFAULT_FX = 1380;
const TTL_MS = 5 * 60 * 1000; // 5분 캐시

// 모듈 레벨 캐시 — 같은 세션에서 여러 컴포넌트가 공유
let _cachedRate: number | null = null;
let _fetchedAt = 0;

export function useFxRate(): number {
  const [rate, setRate] = useState<number>(() => _cachedRate ?? DEFAULT_FX);

  useEffect(() => {
    if (_cachedRate && Date.now() - _fetchedAt < TTL_MS) {
      setRate(_cachedRate);
      return;
    }
    fetch('/api/fx')
      .then(r => r.json())
      .then((d: { ok: boolean; rate: number }) => {
        if (d.ok && d.rate > 0) {
          _cachedRate = d.rate;
          _fetchedAt = Date.now();
          setRate(d.rate);
        }
      })
      .catch(() => {/* 실패 시 기본값 유지 */});
  }, []);

  return rate;
}
