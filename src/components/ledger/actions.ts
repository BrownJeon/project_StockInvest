/**
 * T-074 — 쓰기 요청과 응답 판정 (순수 판정 + fetch 래퍼). 시트들이 이 판정 결과로 상태(성공·실패·충돌·중복)를 고른다.
 *
 * 응답 규약은 WP-A `src/lib/ledger/handlers.ts`·`service.ts`(Stage 1 3절 표):
 *  200 `{ ok: true, data, ... }` · 422 validation · 409 duplicate·baseline_version·version·already_voided·not_voided·superseded·
 *  already_handled·not_dismissed·no_baseline · 404 · 400 · 503 not_migrated · 500 server_error(retrySafe) · 401 미인증.
 * 판정은 순수 함수(`classifyWrite`)라 node 시험으로 고정한다.
 */
import type {
  BaselineRequestBody, BaselineView, CancelRequestBody, CorrectRequestBody, DismissRequestBody, EntryRequestBody,
  LedgerErrorBody, LedgerFeed,
} from '@/lib/ledger/types';

/** 저장 요청 응답 대기 상한 — 넘으면 실패로 보고 입력 잠금을 푼다(T-066 리스크 정책 화면과 같은 15초) */
export const SAVE_TIMEOUT_MS = 15_000;

export type WriteOutcome<T> =
  | { kind: 'ok'; body: T }
  /** 409 client_entry_conflict — 같은 clientEntryId 로 이미 다른 내용이 저장됨(Reviewer M1) — 시트를 닫고 목록을 새로 읽는다 */
  | { kind: 'clientConflict'; existingId: number | null; data: LedgerFeed | null; message: string }
  /** 409 duplicate — 살아 있는 같은 (종류·통화·금액·분) 기록 */
  | { kind: 'dup'; existingId: number | null; message: string }
  /** 409 baseline_version — 기록 저장 중 기준이 바뀜(최신 데이터 없음 → 다시 읽어야 함) */
  | { kind: 'baseConflict'; latestVersion: number | null; message: string }
  /** 409 version — 기준 저장 중 기준이 바뀜(최신 데이터 있음) */
  | { kind: 'versionConflict'; latest: BaselineView | null; data: LedgerFeed | null; message: string }
  /** 409 already_voided · not_voided · already_handled · not_dismissed — 다른 기기에서 먼저 처리됨(최신 데이터 있음) */
  | { kind: 'handledElsewhere'; code: string; data: LedgerFeed | null; message: string }
  /** 409 superseded · no_baseline 등, 404 — 다시 시도해도 안 되는 충돌 */
  | { kind: 'conflict'; code: string; data: LedgerFeed | null; message: string }
  /** 422 — 서버 검증(화면 검증과 같은 규칙이라 드물다: 시계 차이·동시 변경) */
  | { kind: 'invalid'; message: string }
  /** 5xx · 401 · 400 · 네트워크 · 시간 초과 */
  | { kind: 'fail'; reason: string };

const HANDLED = new Set(['already_voided', 'not_voided', 'already_handled', 'not_dismissed']);

export function classifyWrite<T>(status: number, body: unknown, timedOut: boolean): WriteOutcome<T> {
  if (timedOut) return { kind: 'fail', reason: `응답이 ${SAVE_TIMEOUT_MS / 1000}초 안에 오지 않아 중단했습니다` };
  if (status === 0) return { kind: 'fail', reason: '네트워크 오류로 요청하지 못했습니다' };
  const b = (body && typeof body === 'object' ? body : null) as (Omit<Partial<LedgerErrorBody>, 'ok'> & { ok?: boolean }) | null;
  if (status >= 200 && status < 300 && b?.ok === true) return { kind: 'ok', body: b as unknown as T };
  const code = typeof b?.code === 'string' ? b.code : '';
  const message = typeof b?.error === 'string' ? b.error : '';
  const data = (b?.data ?? null) as LedgerFeed | null;
  if (status === 409) {
    if (code === 'client_entry_conflict') return { kind: 'clientConflict', existingId: typeof b?.existingId === 'number' ? b.existingId : null, data, message };
    if (code === 'duplicate') return { kind: 'dup', existingId: typeof b?.existingId === 'number' ? b.existingId : null, message };
    if (code === 'baseline_version') return { kind: 'baseConflict', latestVersion: b?.latest?.version ?? null, message };
    if (code === 'version') return { kind: 'versionConflict', latest: b?.latest ?? null, data, message };
    if (HANDLED.has(code)) return { kind: 'handledElsewhere', code, data, message };
    return { kind: 'conflict', code, data, message };
  }
  if (status === 404) return { kind: 'conflict', code: code || 'not_found', data, message: message || '기록을 찾을 수 없습니다' };
  if (status === 422) {
    const fe = b?.fieldErrors ? Object.values(b.fieldErrors).find((x) => x && typeof x.message === 'string') : undefined;
    return { kind: 'invalid', message: fe?.message ?? (message || '입력을 확인해 주세요') };
  }
  return { kind: 'fail', reason: `서버 응답 ${status}` };
}

export interface SendResult {
  status: number;
  body: unknown;
  timedOut: boolean;
}

export async function sendJson(
  method: 'POST' | 'PUT', url: string, payload: unknown, fetchImpl: typeof fetch = fetch, timeoutMs = SAVE_TIMEOUT_MS,
): Promise<SendResult> {
  let status = 0;
  let body: unknown = null;
  let timedOut = false;
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => { timedOut = true; ctrl?.abort(); }, timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method, headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
      body: JSON.stringify(payload ?? {}), signal: ctrl?.signal,
    });
    status = res.status;
    try { body = await res.json(); } catch { /* 비JSON */ }
  } catch {
    status = 0;
  } finally {
    clearTimeout(timer);
  }
  return { status, body, timedOut };
}

export async function write<T>(method: 'POST' | 'PUT', url: string, payload: unknown, fetchImpl?: typeof fetch): Promise<WriteOutcome<T>> {
  const r = await sendJson(method, url, payload, fetchImpl);
  return classifyWrite<T>(r.status, r.body, r.timedOut);
}

// ─── 중복 제출 방지 ───────────────────────────────────────────────────────

/**
 * 한 번에 하나의 저장만 보낸다 — 응답을 기다리는 동안 다시 누르면(두 번 탭·Enter 반복) 요청을 보내지 않고 null.
 * 버튼 비활성(저장 중)과 별개의 2차 방어다(상태 반영 전 같은 틱의 두 번째 클릭). 서버 쪽 3차 방어는 clientEntryId 멱등.
 */
export function createSubmitter() {
  let inFlight = false;
  return {
    get busy() { return inFlight; },
    async run<T>(fn: () => Promise<T>): Promise<T | null> {
      if (inFlight) return null;
      inFlight = true;
      try { return await fn(); } finally { inFlight = false; }
    },
  };
}

// ─── 경로 (Designer 3절 표 + WP-A reopen) ─────────────────────────────────

export const urls = {
  entries: () => '/api/cash-ledger/entries',
  correct: (id: number) => `/api/cash-ledger/entries/${id}/correct`,
  cancel: (id: number) => `/api/cash-ledger/entries/${id}/cancel`,
  restore: (id: number) => `/api/cash-ledger/entries/${id}/restore`,
  baseline: () => '/api/cash-ledger/baseline',
  dismiss: (key: string) => `/api/cash-ledger/candidates/${encodeURIComponent(key)}/dismiss`,
  reopen: (key: string) => `/api/cash-ledger/candidates/${encodeURIComponent(key)}/reopen`,
} as const;

export type { BaselineRequestBody, CancelRequestBody, CorrectRequestBody, DismissRequestBody, EntryRequestBody };
