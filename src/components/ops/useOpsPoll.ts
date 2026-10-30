'use client';

/**
 * T-108 운용 화면 재조회 훅 — 홈(60초)·안전 상태 띠(30초)·거래·분석 패널이 같이 쓴다.
 *
 * 규칙(가이드 §2.3·§2.2):
 *  - 주기 재조회 + 화면이 다시 보일 때(`visibilitychange`) 즉시 재조회 + `refresh()`([다시 시도]).
 *    화면이 숨어 있는 동안의 주기 틱은 건너뛴다(보일 때 한 번 읽으므로).
 *  - 실패 처리 두 갈래:
 *      keepLastOnError=true (지표 — 기본값): 성공한 적이 있으면 마지막 값을 **오래됨(stale)** 으로 남긴다.
 *      keepLastOnError=false (안전 상태 띠): 실패하면 마지막 값을 버리고 **error** — 안전 표시는 오래된 값을 보여 주지 않는다.
 *    첫 응답부터 실패면 둘 다 error.
 *  - 오류 코드(칩 「! 조회 실패 · {code}」): 401 → `unauthorized` · fetch 예외 → `network` · HTTP 오류 → `http_{status}` ·
 *    봉투 `{ ok:false }` → `api_error` · JSON 아님 → `bad_json`.
 *  - 요청은 한 번에 하나(진행 중이면 겹쳐 보내지 않음), 언마운트 때 취소. 캐시 없음(`cache: no-store`).
 *
 * 상태 전이는 순수 함수 `applyOutcome`·응답 해석은 `readEnvelope` 로 떼어 jsdom 없이 시험한다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type PollStatus = 'loading' | 'ok' | 'stale' | 'error';

export interface PollState<T> {
  status: PollStatus;
  /** 마지막으로 성공한 응답의 data (stale 이면 그 값, error 면 null) */
  data: T | null;
  /** 마지막 성공 시각(ms) — 「오래됨 · 기준 {시각}」·「마지막 확인 {HH:MM}」 */
  lastOkAt: number | null;
  /** 마지막 실패 코드 — ok 면 null */
  error: string | null;
}

export type FetchOutcome<T> = { ok: true; data: T } | { ok: false; code: string };

export const INITIAL_POLL: PollState<never> = { status: 'loading', data: null, lastOkAt: null, error: null };

/** 응답 1회를 상태에 반영한다(순수). */
export function applyOutcome<T>(prev: PollState<T>, outcome: FetchOutcome<T>, nowMs: number, keepLastOnError: boolean): PollState<T> {
  if (outcome.ok) return { status: 'ok', data: outcome.data, lastOkAt: nowMs, error: null };
  if (keepLastOnError && prev.data != null) return { status: 'stale', data: prev.data, lastOkAt: prev.lastOkAt, error: outcome.code };
  return { status: 'error', data: null, lastOkAt: prev.lastOkAt, error: outcome.code };
}

/** HTTP 상태 + 본문(JSON 해석 결과)을 표준 봉투 `{ ok, data } / { ok:false, error }` 로 읽는다(순수). */
export function readEnvelope<T>(status: number, body: unknown): FetchOutcome<T> {
  if (status === 401) return { ok: false, code: 'unauthorized' };
  if (status < 200 || status >= 300) return { ok: false, code: `http_${status}` };
  if (body === undefined) return { ok: false, code: 'bad_json' };
  const b = body as { ok?: unknown; data?: unknown } | null;
  if (!b || b.ok !== true || !('data' in b)) return { ok: false, code: 'api_error' };
  return { ok: true, data: b.data as T };
}

/** 한 번 읽기 — 네트워크 예외는 `network`, 취소는 null(상태를 바꾸지 않음). */
export async function fetchOps<T>(url: string, signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<FetchOutcome<T> | null> {
  let res: Response;
  try {
    res = await fetchImpl(url, { cache: 'no-store', credentials: 'same-origin', signal });
  } catch (e) {
    if (signal?.aborted || (e as { name?: string } | null)?.name === 'AbortError') return null;
    return { ok: false, code: 'network' };
  }
  let body: unknown;
  try { body = await res.json(); } catch { body = undefined; }
  if (signal?.aborted) return null;
  return readEnvelope<T>(res.status, body);
}

/** 요청 시간 상한 — 넘으면 끊고 `timeout` 실패로 본다(멈춘 요청 때문에 [다시 시도]가 아무 일도 안 하는 일을 막는다 — R-UI ⑤). */
export const OPS_FETCH_TIMEOUT_MS = 10_000;

/**
 * 시간 상한이 있는 한 번 읽기. 상한을 넘으면 요청을 끊고 `{ ok:false, code:'timeout' }`.
 * 바깥 signal(언마운트·새 요청이 앞 요청을 버림)로 끊기면 null(상태를 바꾸지 않음).
 */
export async function fetchOpsWithTimeout<T>(url: string, opts: { timeoutMs?: number; signal?: AbortSignal; fetchImpl?: typeof fetch } = {}): Promise<FetchOutcome<T> | null> {
  const { timeoutMs = OPS_FETCH_TIMEOUT_MS, signal, fetchImpl = fetch } = opts;
  if (signal?.aborted) return null;
  const ac = new AbortController();
  let timedOut = false;
  const onOuterAbort = () => ac.abort();
  signal?.addEventListener('abort', onOuterAbort);
  const timer = setTimeout(() => { timedOut = true; ac.abort(); }, timeoutMs);
  try {
    const outcome = await fetchOps<T>(url, ac.signal, fetchImpl);
    if (timedOut) return { ok: false, code: 'timeout' };
    if (signal?.aborted) return null;
    return outcome;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onOuterAbort);
  }
}

export interface OpsPollOptions {
  /** 재조회 주기(ms). 홈 60_000 · 안전 상태 띠 30_000. 0 이면 주기 재조회 없음 */
  intervalMs?: number;
  /** 실패 때 마지막 값을 오래됨으로 남길지 — 안전 상태 띠는 false */
  keepLastOnError?: boolean;
  /** 요청 시간 상한(ms) — 기본 10초 */
  timeoutMs?: number;
}

export function useOpsPoll<T>(url: string | null, opts: OpsPollOptions = {}): PollState<T> & { refresh: () => void } {
  const { intervalMs = 60_000, keepLastOnError = true, timeoutMs = OPS_FETCH_TIMEOUT_MS } = opts;
  const [state, setState] = useState<PollState<T>>(INITIAL_POLL as PollState<T>);
  const inflight = useRef(false);
  const ctrl = useRef<AbortController | null>(null);
  /** 요청 번호 — 더 새 요청이 시작됐거나 언마운트되면 옛 응답을 버린다 */
  const seq = useRef(0);
  const keepRef = useRef(keepLastOnError);
  keepRef.current = keepLastOnError;

  // force = [다시 시도]: 진행 중인 요청이 있어도 버리고 새로 보낸다. 주기·화면 복귀 재조회는 겹치지 않게 건너뛴다.
  const load = useCallback(async (force = false) => {
    if (!url) return;
    if (inflight.current && !force) return;
    ctrl.current?.abort();
    const id = ++seq.current;
    const ac = new AbortController();
    ctrl.current = ac;
    inflight.current = true;
    try {
      const outcome = await fetchOpsWithTimeout<T>(url, { timeoutMs, signal: ac.signal });
      if (outcome && id === seq.current) setState((prev) => applyOutcome(prev, outcome, Date.now(), keepRef.current));
    } finally {
      if (id === seq.current) { inflight.current = false; ctrl.current = null; }
    }
  }, [url, timeoutMs]);

  useEffect(() => {
    if (!url) return;
    void load();
    const onVisible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVisible);
    const timer = intervalMs > 0
      ? setInterval(() => { if (document.visibilityState !== 'hidden') void load(); }, intervalMs)
      : null;
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      if (timer) clearInterval(timer);
      seq.current++;
      ctrl.current?.abort();
      ctrl.current = null;
      inflight.current = false;
    };
  }, [url, intervalMs, load]);

  return { ...state, refresh: () => { void load(true); } };
}
