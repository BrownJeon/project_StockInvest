'use client';

/**
 * T-143 WP-B — `GET /api/settings/overseas-universe` 조회 상태 (본 화면·일괄 교체·설정 요약 행 공용).
 *
 * T-074 `useLedgerFeed` 와 같은 방식이다:
 *  - **조회는 1회 — 주기 재조회 없음**(승인 데모 §5 로딩 주석: 「조회는 60초 재조회 없이 1회입니다」).
 *  - `reload()` : 로딩을 보이고 다시 읽는다(오류 화면의 「다시 시도」).
 *  - `refresh()`: 화면을 유지한 채 조용히 다시 읽는다(409 가 최신 값을 싣지 않았을 때).
 *  - `patch()`  : 쓰기 응답의 최신 값으로 **부분 교체**(제안 1건 + 머리 숫자). 그보다 먼저 출발한 조회 응답은 버린다.
 *  - 조회 실패의 `code` 를 `loadCode` 로 남긴다 — 마이그레이션 전 503 `not_migrated` 는 고장이 아니라 「준비 중」이다.
 *
 * 401(세션 만료)은 기존 화면 관습대로 `loadCode='unauthorized'` 로 남기고 화면이 로그인 안내를 그린다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Proposal, UniverseScreenDTO, UniverseSummary } from '@/lib/universe/types';

export type LoadState = 'loading' | 'ready' | 'error';

export const UNIVERSE_API = '/api/settings/overseas-universe';

export interface UniverseFeedState {
  data: UniverseScreenDTO | null;
  load: LoadState;
  loadError: string | null;
  loadCode: string | null;
  reload: () => void;
  refresh: () => void;
  /** 제안 1건·요약을 서버 응답으로 갈아 끼운다(전체 재조회 없이 — 가이드 §4.2). */
  patch: (next: { proposal?: Proposal; summary?: UniverseSummary }) => void;
}

/** 조회 실패 문구 — 「서버 응답 503 — …」(T-066·T-074 와 같은 모양). */
export function loadErrorText(status: number, error: string | null | undefined): string {
  return `서버 응답 ${status}${error ? ` — ${error}` : ''}`;
}

/** 마이그레이션 전(표 없음) 응답인가 — 상태 503 + code 'not_migrated' 둘 다 맞아야 한다. */
export function isNotMigrated(status: number, code: unknown): boolean {
  return status === 503 && code === 'not_migrated';
}

export type FetchResult =
  | { ok: true; data: UniverseScreenDTO }
  | { ok: false; error: string; code: string | null };

export async function fetchUniverseFeed(fetchImpl: typeof fetch = fetch): Promise<FetchResult> {
  try {
    const res = await fetchImpl(UNIVERSE_API, { cache: 'no-store' });
    let body: { ok?: boolean; data?: UniverseScreenDTO; error?: string; code?: unknown } | null = null;
    try { body = await res.json(); } catch { /* 비JSON */ }
    if (!res.ok || !body?.ok || !body.data) {
      const raw = typeof body?.code === 'string' ? body.code : null;
      const code = isNotMigrated(res.status, raw) ? 'not_migrated'
        : res.status === 401 ? 'unauthorized'
          : raw === 'not_migrated' ? null : raw;
      return { ok: false, error: loadErrorText(res.status, body?.error), code };
    }
    return { ok: true, data: body.data };
  } catch {
    return { ok: false, error: '네트워크 오류로 요청하지 못했습니다', code: null };
  }
}

export function useUniverseFeed(): UniverseFeedState {
  const [data, setData] = useState<UniverseScreenDTO | null>(null);
  const [load, setLoad] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadCode, setLoadCode] = useState<string | null>(null);
  /** 조회·교체마다 늘린다 — 응답이 도착했을 때 자기 번호가 최신이 아니면 버린다(늦게 온 옛 응답이 덮어쓰지 않게). */
  const epoch = useRef(0);
  const hasData = useRef(false);

  const run = useCallback(async (showLoading: boolean) => {
    const my = ++epoch.current;
    if (showLoading) { setLoad('loading'); setLoadError(null); setLoadCode(null); }
    const r = await fetchUniverseFeed();
    if (my !== epoch.current) return;
    if (r.ok) {
      hasData.current = true;
      setData(r.data);
      setLoad('ready');
      setLoadError(null);
      setLoadCode(null);
    } else if (showLoading || !hasData.current) {
      setLoad('error');
      setLoadError(r.error);
      setLoadCode(r.code);
    }
    // 조용한 재조회 실패는 화면을 그대로 둔다
  }, []);

  useEffect(() => { void run(true); }, [run]);

  const reload = useCallback(() => { void run(true); }, [run]);
  const refresh = useCallback(() => { void run(false); }, [run]);

  const patch = useCallback((next: { proposal?: Proposal; summary?: UniverseSummary }) => {
    epoch.current++;
    setData((cur) => {
      if (!cur) return cur;
      const proposals = next.proposal && cur.proposals.state === 'ok'
        ? {
          state: 'ok' as const,
          data: cur.proposals.data.map((x) => (x.id === next.proposal!.id ? next.proposal! : x)),
        }
        : cur.proposals;
      const summary = next.summary ? { state: 'ok' as const, data: next.summary } : cur.summary;
      return { ...cur, proposals, summary };
    });
  }, []);

  return { data, load, loadError, loadCode, reload, refresh, patch };
}
