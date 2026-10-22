'use client';

/**
 * T-066 — `/api/settings/risk-policy` 조회 + 60초 재조회 (DB 스냅샷만 — KIS 시세 호출 없음).
 * 열 때 1회, 이후 60초마다 `cache:'no-store'` 로 다시 읽는다. 탭이 숨겨지면 멈추고, 다시 보이면 바로 읽는다.
 * 첫 조회 실패는 '조회 오류'(재시도 버튼), 재조회 실패는 마지막 값을 유지한 채 표시만 바꾼다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { POLL_INTERVAL_MS } from '@/lib/risk/defaults';
import type { RiskPolicyData } from '@/app/api/settings/risk-policy/route';
import { isStaleVersion } from './policy-state';

export type LoadState = 'loading' | 'ready' | 'error';
export type PollState = 'live' | 'busy' | 'fail';

export interface RiskPolicyFeed {
  data: RiskPolicyData | null;
  load: LoadState;
  loadError: string | null;
  poll: PollState;
  lastCheckAt: number | null;
  nextAt: number | null;
  reload: () => void;
  /** 저장 응답 등 밖에서 받은 최신 data 를 반영 */
  replace: (d: RiskPolicyData) => void;
}

export async function fetchRiskPolicy(): Promise<{ ok: true; data: RiskPolicyData } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/settings/risk-policy', { cache: 'no-store' });
    let body: { ok?: boolean; data?: RiskPolicyData; error?: string } | null = null;
    try { body = await res.json(); } catch { /* 비JSON */ }
    if (!res.ok || !body?.ok || !body.data) {
      return { ok: false, error: `서버 응답 ${res.status}${body?.error ? ` — ${body.error}` : ''}` };
    }
    return { ok: true, data: body.data };
  } catch {
    return { ok: false, error: '네트워크 오류로 요청하지 못했습니다' };
  }
}

export function useRiskPolicyFeed(opts: {
  /** 새 data 를 받을 때마다 호출 (첫 조회 포함) */
  onData?: (d: RiskPolicyData, initial: boolean) => void;
  /** true 인 동안 주기 재조회를 건너뛴다 (저장 중 등) */
  paused?: boolean;
} = {}): RiskPolicyFeed {
  const [data, setData] = useState<RiskPolicyData | null>(null);
  const [load, setLoad] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [poll, setPoll] = useState<PollState>('live');
  const [lastCheckAt, setLastCheckAt] = useState<number | null>(null);
  const [nextAt, setNextAt] = useState<number | null>(null);

  const onDataRef = useRef(opts.onData);
  onDataRef.current = opts.onData;
  const pausedRef = useRef(!!opts.paused);
  pausedRef.current = !!opts.paused;
  const hasDataRef = useRef(false);
  /** 지금까지 받은 정책 version 의 최대값 — 이보다 낮은 응답은 늦게 도착한 옛 응답이다(버전 후퇴 금지) */
  const maxVersionRef = useRef(0);
  const inflight = useRef(false);

  const run = useCallback(async (kind: 'initial' | 'poll') => {
    if (inflight.current) return;
    inflight.current = true;
    if (kind === 'poll') setPoll('busy');
    const r = await fetchRiskPolicy();
    inflight.current = false;
    const now = Date.now();
    setLastCheckAt(now);
    setNextAt(now + POLL_INTERVAL_MS);
    if (r.ok && isStaleVersion(r.data.policy?.version, maxVersionRef.current)) {
      // 저장 응답(replace)으로 더 새 version 을 이미 받았다 — 이 재조회 결과는 버린다
      setPoll('live');
    } else if (r.ok) {
      maxVersionRef.current = Math.max(maxVersionRef.current, r.data.policy?.version ?? 0);
      const initial = !hasDataRef.current;
      hasDataRef.current = true;
      setData(r.data);
      setLoad('ready');
      setLoadError(null);
      setPoll('live');
      onDataRef.current?.(r.data, initial);
    } else if (!hasDataRef.current) {
      setLoad('error');
      setLoadError(r.error);
      setPoll('live');
    } else {
      setPoll('fail');
    }
  }, []);

  useEffect(() => {
    void run('initial');
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) clearInterval(timer);
      timer = setInterval(() => {
        if (pausedRef.current || !hasDataRef.current) return;
        void run('poll');
      }, POLL_INTERVAL_MS);
    };
    const onVis = () => {
      if (document.hidden) {
        if (timer) { clearInterval(timer); timer = null; }
        setNextAt(null);
      } else {
        if (hasDataRef.current && !pausedRef.current) void run('poll');
        start();
      }
    };
    start();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [run]);

  const reload = useCallback(() => {
    if (!hasDataRef.current) { setLoad('loading'); void run('initial'); }
    else void run('poll');
  }, [run]);

  const replace = useCallback((d: RiskPolicyData) => {
    if (isStaleVersion(d.policy?.version, maxVersionRef.current)) return;
    maxVersionRef.current = Math.max(maxVersionRef.current, d.policy?.version ?? 0);
    hasDataRef.current = true;
    setData(d);
    setLoad('ready');
  }, []);

  return { data, load, loadError, poll, lastCheckAt, nextAt, reload, replace };
}
