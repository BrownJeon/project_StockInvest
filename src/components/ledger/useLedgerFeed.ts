'use client';

/**
 * T-074 — `GET /api/cash-ledger` 조회 상태 (입출금 기록 화면·설정 요약 행 공용).
 *
 * Designer 구현 가이드 4절: 서버 상태는 GET 결과 하나(`feed`)이고, 쓰기 성공 응답의 `data` 로 통째로 교체한다
 * (반영 상태·앵커가 서버에서 정해지므로 낙관적 반영은 하지 않는다). 주기 재조회는 하지 않는다(데모·가이드에 없음 — 조회는 지연 매칭 저장을 동반).
 *  - `reload()`  : 로딩 상태를 보이고 다시 읽는다(오류 화면의 '다시 시도').
 *  - `refresh()` : 화면을 유지한 채 조용히 다시 읽는다(충돌 409 가 최신 데이터를 싣지 않았을 때).
 *  - `replace()` : 쓰기 응답의 최신 데이터로 교체. 그보다 먼저 출발한 조회 응답은 버린다(늦게 도착한 옛 응답이 덮어쓰지 않게).
 * 조회 실패의 응답 `code` 를 `loadCode` 로 남긴다 — 마이그레이션 전 503 `not_migrated` 는 고장이 아니라 '준비 중'으로 보인다
 * (designer 구현 점검 P1-2). 다른 원인의 503(예: 인증 설정 없음)은 코드가 달라 일반 조회 오류로 남는다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LedgerFeed } from '@/lib/ledger/types';

export type LoadState = 'loading' | 'ready' | 'error';

export interface LedgerFeedState {
  data: LedgerFeed | null;
  load: LoadState;
  loadError: string | null;
  /** 조회 실패 응답의 code (예: 'not_migrated') — 없으면 null */
  loadCode: string | null;
  reload: () => void;
  refresh: () => void;
  replace: (d: LedgerFeed) => void;
}

export const LEDGER_API = '/api/cash-ledger';

/** 조회 실패 문구 — "서버 응답 503 — …" (T-066 리스크 정책 화면과 같은 모양) */
export function loadErrorText(status: number, error: string | null | undefined): string {
  return `서버 응답 ${status}${error ? ` — ${error}` : ''}`;
}

/** 마이그레이션 전(테이블 없음) 응답인가 — 상태 503 + code 'not_migrated' 둘 다 맞아야 한다 */
export function isNotMigrated(status: number, code: unknown): boolean {
  return status === 503 && code === 'not_migrated';
}

export async function fetchLedgerFeed(fetchImpl: typeof fetch = fetch): Promise<{ ok: true; data: LedgerFeed } | { ok: false; error: string; code: string | null }> {
  try {
    const res = await fetchImpl(LEDGER_API, { cache: 'no-store' });
    let body: { ok?: boolean; data?: LedgerFeed; error?: string; code?: unknown } | null = null;
    try { body = await res.json(); } catch { /* 비JSON */ }
    if (!res.ok || !body?.ok || !body.data) {
      const raw = typeof body?.code === 'string' ? body.code : null;
      const code = isNotMigrated(res.status, raw) ? 'not_migrated' : raw === 'not_migrated' ? null : raw;
      return { ok: false, error: loadErrorText(res.status, body?.error), code };
    }
    return { ok: true, data: body.data };
  } catch {
    return { ok: false, error: '네트워크 오류로 요청하지 못했습니다', code: null };
  }
}

export function useLedgerFeed(): LedgerFeedState {
  const [data, setData] = useState<LedgerFeed | null>(null);
  const [load, setLoad] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadCode, setLoadCode] = useState<string | null>(null);
  /** 조회·교체마다 늘린다 — 응답이 도착했을 때 자기 번호가 최신이 아니면 버린다 */
  const epoch = useRef(0);
  const hasData = useRef(false);

  const run = useCallback(async (showLoading: boolean) => {
    const my = ++epoch.current;
    if (showLoading) { setLoad('loading'); setLoadError(null); setLoadCode(null); }
    const r = await fetchLedgerFeed();
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
  const replace = useCallback((d: LedgerFeed) => {
    epoch.current++;
    hasData.current = true;
    setData(d);
    setLoad('ready');
    setLoadError(null);
    setLoadCode(null);
  }, []);

  return { data, load, loadError, loadCode, reload, refresh, replace };
}
