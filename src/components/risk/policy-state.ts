/**
 * T-066 리스크 정책 화면 — 편집·저장·재조회 상태 전이 (순수 함수, 화면과 시험이 같은 함수를 쓴다).
 *
 * 원칙
 *  - 정책 version 은 단조 증가한다. **지금 화면이 아는 version 보다 작거나 같은 응답은 무시**한다
 *    (저장 응답으로 v2 가 확정된 뒤 늦게 도착한 v1 재조회가 화면을 되돌리지 않게 — Reviewer M-1).
 *  - 편집 중에 다른 기기의 저장을 발견하면 덮어쓰지 않고 충돌 안내(remote)를, 편집 중이 아니면 조용히 반영한다.
 *  - 저장은 낙관적 반영 → 200 확정 / 409 최신값 + 입력 유지 / 실패 되돌림 + 입력 유지.
 */
import type { RiskPolicyData } from '@/app/api/settings/risk-policy/route';
import {
  checkDraft, describePolicy, dirtyCount, draftFrom,
  type Draft, type SavedPolicy,
} from './draft';
import type { SaveState } from './RiskSettingsForm';

export interface EditState {
  saved: SavedPolicy | null;
  draft: Draft;
  saveState: SaveState;
  saveError: string | null;
  savedAtText: string;
  /** 편집 중 다른 기기에서 저장된 값 (충돌 안내) */
  remote: SavedPolicy | null;
  syncNote: string | null;
}

export const initialEditState = (): EditState => ({
  saved: null, draft: draftFrom(null), saveState: 'idle', saveError: null, savedAtText: '', remote: null, syncNote: null,
});

export function toSaved(p: RiskPolicyData['policy'] | null | undefined): SavedPolicy | null {
  if (!p) return null;
  return { stopPct: p.stopPct, heatCapPct: p.heatCapPct, stopBasis: p.stopBasis, version: p.version, updatedAt: p.updatedAt };
}

/** 사용자가 입력을 건드렸는가 — 정책이 없을 때는 제안값과 다른지로 본다 */
export function edited(d: Draft, saved: SavedPolicy | null): boolean {
  if (saved) return dirtyCount(d, saved) > 0;
  const def = draftFrom(null);
  return d.stopPct !== def.stopPct || d.heatCapPct !== def.heatCapPct || d.stopBasis !== def.stopBasis;
}

/** 재조회 응답(피드)의 정책 version 이 이미 본 최대 version 보다 낮으면 오래된 응답이다 */
export function isStaleVersion(incoming: number | null | undefined, maxSeen: number): boolean {
  return (incoming ?? 0) < maxSeen;
}

/** 조회 결과 반영. 첫 조회는 그대로 받고, 재조회는 새 version 일 때만 편집 여부에 따라 반영·충돌 안내. */
export function applyFeedPolicy(s: EditState, incoming: SavedPolicy | null, initial: boolean): EditState {
  if (initial) return { ...s, saved: incoming, draft: draftFrom(incoming) };
  if (s.saveState === 'saving') return s;
  if (!incoming) return s; // 키가 사라진 경우 — 화면 값을 유지(다음 저장이 409 로 알려 준다)
  const known = Math.max(s.saved?.version ?? 0, s.remote?.version ?? 0);
  if (incoming.version <= known) return s; // 같은 값이거나 늦게 도착한 옛 응답 — 버전 후퇴 금지
  if (edited(s.draft, s.saved)) return { ...s, remote: incoming };
  return {
    ...s,
    saved: incoming,
    draft: draftFrom(incoming),
    remote: null,
    saveState: 'idle',
    saveError: null,
    syncNote: `다른 기기에서 저장한 값을 반영했습니다 — ${describePolicy(incoming, s.saved)} (버전 ${incoming.version}).`,
  };
}

export function changeDraft(s: EditState, patch: Partial<Draft>): EditState {
  return { ...s, draft: { ...s.draft, ...patch }, saveState: s.saveState === 'saved' ? 'idle' : s.saveState };
}

/** 입력 취소 / 409 의 '서버 값 쓰기' — 저장된 값으로 입력을 되돌린다 */
export function cancelEdit(s: EditState): EditState {
  return { ...s, draft: draftFrom(s.saved), saveState: 'idle', saveError: null, remote: null };
}

/** 원격 변경 안내에서 '서버 값 쓰기' */
export function takeServer(s: EditState): EditState {
  if (!s.remote) return s;
  return { ...s, saved: s.remote, draft: draftFrom(s.remote), remote: null, syncNote: null, saveState: 'idle', saveError: null };
}

/** 원격 변경 안내에서 '내 값 유지' — 기준 version 만 최신으로 옮겨 다음 저장이 덮어쓰게 한다 */
export function keepMine(s: EditState): EditState {
  if (!s.remote) return s;
  return {
    ...s, saved: s.remote, remote: null, saveState: 'idle', saveError: null,
    syncNote: `내 입력값을 유지합니다. 저장하면 다른 기기의 값(${describePolicy(s.remote, null)})을 덮어씁니다.`,
  };
}

export interface SaveRequest {
  backup: SavedPolicy | null;
  sent: Draft;
  baseVersion: number;
  values: { stopPct: number; heatCapPct: number; stopBasis: Draft['stopBasis'] };
}

/** 저장 시작 — 보낼 수 없으면 null. 보낼 수 있으면 낙관적으로 반영한 상태와 요청 내용을 돌려준다 */
export function beginSave(s: EditState): { state: EditState; req: SaveRequest } | null {
  if (s.saveState === 'saving') return null;
  const chk = checkDraft(s.draft, s.saved);
  if (chk.errs > 0 || dirtyCount(s.draft, s.saved) === 0) return null;
  const baseVersion = s.saved?.version ?? 0;
  const values = { stopPct: chk.stop.value as number, heatCapPct: chk.cap.value as number, stopBasis: s.draft.stopBasis };
  return {
    req: { backup: s.saved, sent: s.draft, baseVersion, values },
    state: {
      ...s,
      saved: { ...values, version: baseVersion, updatedAt: s.saved?.updatedAt ?? '' },
      saveState: 'saving', saveError: null, remote: null, syncNote: null,
    },
  };
}

export type SaveOutcome =
  | { kind: 'ok'; data: RiskPolicyData }
  | { kind: 'conflict'; data: RiskPolicyData | null }
  | { kind: 'failed'; message: string };

/** HTTP 결과 → 저장 결과 분류 */
export function classifySave(status: number, body: { ok?: boolean; data?: RiskPolicyData; error?: string } | null, timedOut = false): SaveOutcome {
  if (status === 200 && body?.ok && body.data) return { kind: 'ok', data: body.data };
  if (status === 409) return { kind: 'conflict', data: body?.data ?? null };
  if (timedOut) return { kind: 'failed', message: '서버 응답이 없어 기다리기를 멈췄습니다 — 저장됐을 수 있으니 잠시 뒤 화면 값을 확인하세요' };
  if (status === 0) return { kind: 'failed', message: '네트워크 오류로 요청하지 못했습니다' };
  return { kind: 'failed', message: `서버 응답 ${status}${body?.error ? ` — ${body.error}` : ''}` };
}

/** 저장 결과 반영 */
export function finishSave(s: EditState, req: SaveRequest, out: SaveOutcome, nowText: string): EditState {
  if (out.kind === 'ok') {
    const sp = toSaved(out.data.policy);
    return { ...s, saved: sp, draft: draftFrom(sp), saveState: 'saved', saveError: null, savedAtText: nowText };
  }
  if (out.kind === 'conflict') {
    return { ...s, saved: out.data ? toSaved(out.data.policy) : req.backup, draft: req.sent, saveState: 'conflict', saveError: null };
  }
  // 실패 — 저장 전 값으로 되돌리고 입력값은 유지
  return { ...s, saved: req.backup, draft: req.sent, saveState: 'failed', saveError: out.message };
}
