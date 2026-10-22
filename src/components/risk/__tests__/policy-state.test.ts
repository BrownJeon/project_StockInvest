/**
 * T-066 리스크 정책 화면 상태 전이 — 순수 함수(policy-state.ts) 단위 시험 (Reviewer M-1·L-5).
 * 화면 시험은 정적 렌더라 전이를 실행하지 못하므로, 판정을 순수 함수로 빼서 여기서 실행한다.
 */
import type { RiskPolicyData } from '@/app/api/settings/risk-policy/route';
import {
  applyFeedPolicy, beginSave, cancelEdit, changeDraft, classifySave, finishSave,
  initialEditState, isStaleVersion, keepMine, takeServer, toSaved, type EditState,
} from '@/components/risk/policy-state';
import { dirtyCount, draftFrom, type SavedPolicy } from '@/components/risk/draft';

const P = (version: number, over: Partial<SavedPolicy> = {}): SavedPolicy => ({
  stopPct: 3, heatCapPct: 2, stopBasis: 'avg', version, updatedAt: `2026-10-22T0${version % 10}:00:00.000Z`, ...over,
});
/** 저장·조회 응답 data 의 최소 형태 (전이 판정은 policy 만 본다) */
const D = (p: SavedPolicy | null) => ({ policy: p ? { ...p, history: [] } : null } as unknown as RiskPolicyData);

const loaded = (p: SavedPolicy | null): EditState => applyFeedPolicy(initialEditState(), p, true);

describe('조회 반영 (applyFeedPolicy)', () => {
  test('첫 조회는 그대로 받는다 (정책 없음 포함)', () => {
    expect(loaded(P(1))).toMatchObject({ saved: P(1), draft: draftFrom(P(1)), saveState: 'idle' });
    expect(loaded(null)).toMatchObject({ saved: null, draft: { stopPct: '3', heatCapPct: '2', stopBasis: 'avg' } });
  });

  test('저장 응답으로 v2 가 확정된 뒤 늦게 도착한 v1 재조회는 무시한다 (버전 후퇴 금지)', () => {
    let s = loaded(P(1));
    s = changeDraft(s, { stopPct: '2' });
    const started = beginSave(s)!;
    s = finishSave(started.state, started.req, { kind: 'ok', data: D(P(2, { stopPct: 2 })) }, '13:30');
    expect(s).toMatchObject({ saved: { version: 2, stopPct: 2 }, saveState: 'saved' });
    const after = applyFeedPolicy(s, P(1), false);
    expect(after).toBe(s); // 아무것도 바뀌지 않음
    expect(isStaleVersion(1, 2)).toBe(true);
    expect(isStaleVersion(2, 2)).toBe(false);
    expect(isStaleVersion(undefined, 1)).toBe(true);
  });

  test('같은 version 재조회는 무시', () => {
    const s = loaded(P(3));
    expect(applyFeedPolicy(s, P(3), false)).toBe(s);
  });

  test('편집 중 원격 변경 → 덮어쓰지 않고 충돌 안내(remote)', () => {
    const s = changeDraft(loaded(P(1)), { stopPct: '4' });
    const r = applyFeedPolicy(s, P(2, { stopPct: 2.5 }), false);
    expect(r.remote).toMatchObject({ version: 2, stopPct: 2.5 });
    expect(r.saved).toMatchObject({ version: 1 });
    expect(r.draft.stopPct).toBe('4');
    // 같은 원격 값이 다시 와도 그대로
    expect(applyFeedPolicy(r, P(2, { stopPct: 2.5 }), false)).toBe(r);
  });

  test('편집 중이 아니면 조용히 반영 + 안내', () => {
    const r = applyFeedPolicy(loaded(P(1)), P(2, { stopPct: 2.5 }), false);
    expect(r).toMatchObject({ saved: { version: 2, stopPct: 2.5 }, draft: { stopPct: '2.5' }, remote: null, saveState: 'idle' });
    expect(r.syncNote).toBe('다른 기기에서 저장한 값을 반영했습니다 — 손절폭 2.5% (버전 2).');
  });

  test('정책이 없던 화면에서 제안값을 건드리지 않았으면 다른 기기의 첫 저장을 반영', () => {
    const r = applyFeedPolicy(loaded(null), P(1, { stopPct: 2 }), false);
    expect(r.saved).toMatchObject({ version: 1, stopPct: 2 });
  });

  test('저장 중에는 재조회를 반영하지 않는다', () => {
    const started = beginSave(changeDraft(loaded(P(1)), { stopPct: '2' }))!;
    expect(applyFeedPolicy(started.state, P(5), false)).toBe(started.state);
  });

  test('정책 키가 사라진 응답(null)은 화면 값을 유지', () => {
    const s = loaded(P(4));
    expect(applyFeedPolicy(s, null, false)).toBe(s);
  });
});

describe('저장 (beginSave → finishSave)', () => {
  test('낙관적 반영: 저장 중 상태·입력값으로 saved 갱신·기준 version 유지', () => {
    const started = beginSave(changeDraft(loaded(P(7)), { stopPct: '1.5', stopBasis: 'peak' }))!;
    expect(started.req).toMatchObject({ baseVersion: 7, values: { stopPct: 1.5, heatCapPct: 2, stopBasis: 'peak' } });
    expect(started.state).toMatchObject({ saveState: 'saving', saved: { stopPct: 1.5, stopBasis: 'peak', version: 7 } });
  });

  test('처음 저장은 baseVersion 0', () => {
    const started = beginSave(loaded(null))!;
    expect(started.req.baseVersion).toBe(0);
    expect(started.req.backup).toBeNull();
  });

  test('보낼 수 없는 경우: 입력 오류 · 변경 없음 · 반올림하면 같은 값(3.001) · 저장 중', () => {
    expect(beginSave(changeDraft(loaded(P(1)), { stopPct: '25' }))).toBeNull();
    expect(beginSave(loaded(P(1)))).toBeNull();
    const same = changeDraft(loaded(P(1)), { stopPct: '3.001' });
    expect(dirtyCount(same.draft, same.saved)).toBe(0);
    expect(beginSave(same)).toBeNull();
    const started = beginSave(changeDraft(loaded(P(1)), { stopPct: '2' }))!;
    expect(beginSave(started.state)).toBeNull();
  });

  test('200 → 서버 확정값으로 갱신', () => {
    const started = beginSave(changeDraft(loaded(P(1)), { stopPct: '2' }))!;
    const s = finishSave(started.state, started.req, classifySave(200, { ok: true, data: D(P(2, { stopPct: 2 })) }), '13:30');
    expect(s).toMatchObject({ saved: { version: 2, stopPct: 2 }, draft: { stopPct: '2' }, saveState: 'saved', savedAtText: '13:30' });
    expect(dirtyCount(s.draft, s.saved)).toBe(0);
  });

  test('실패 → 저장 전 값으로 되돌리고 입력값은 유지', () => {
    const started = beginSave(changeDraft(loaded(P(1)), { stopPct: '2' }))!;
    const s = finishSave(started.state, started.req, classifySave(500, { ok: false, error: 'boom' }), '13:30');
    expect(s).toMatchObject({ saved: P(1), draft: { stopPct: '2' }, saveState: 'failed', saveError: '서버 응답 500 — boom' });
    expect(dirtyCount(s.draft, s.saved)).toBe(1); // 다시 시도할 수 있다
  });

  test('409 → 최신 저장값을 받고 입력은 유지, 서버 값 쓰기로 정리', () => {
    const started = beginSave(changeDraft(loaded(P(1)), { stopPct: '4' }))!;
    let s = finishSave(started.state, started.req, classifySave(409, { ok: false, data: D(P(2, { stopPct: 2.5 })) }), '13:30');
    expect(s).toMatchObject({ saved: { version: 2, stopPct: 2.5 }, draft: { stopPct: '4' }, saveState: 'conflict' });
    // '내 값으로 저장' 은 새 기준 version 으로 다시 보낸다
    expect(beginSave(s)!.req.baseVersion).toBe(2);
    s = cancelEdit(s);
    expect(s).toMatchObject({ draft: { stopPct: '2.5' }, saveState: 'idle' });
  });

  test('409 인데 본문이 없으면 저장 전 값 유지', () => {
    const started = beginSave(changeDraft(loaded(P(1)), { stopPct: '4' }))!;
    const s = finishSave(started.state, started.req, classifySave(409, null), '13:30');
    expect(s).toMatchObject({ saved: P(1), saveState: 'conflict' });
  });
});

describe('원격 변경 안내의 선택 (L-5a — 실패 막대 정리)', () => {
  function failedWithRemote(): EditState {
    const started = beginSave(changeDraft(loaded(P(1)), { stopPct: '4' }))!;
    const failed = finishSave(started.state, started.req, classifySave(0, null), '13:30');
    return applyFeedPolicy(failed, P(2, { stopPct: 2.5 }), false);
  }

  test('서버 값 쓰기 → 원격 값 채택, 실패 상태 해제', () => {
    const s = takeServer(failedWithRemote());
    expect(s).toMatchObject({ saved: { version: 2 }, draft: { stopPct: '2.5' }, remote: null, saveState: 'idle', saveError: null });
  });

  test('내 값 유지 → 기준만 최신으로, 입력 유지, 실패 상태 해제', () => {
    const s = keepMine(failedWithRemote());
    expect(s).toMatchObject({ saved: { version: 2 }, draft: { stopPct: '4' }, remote: null, saveState: 'idle', saveError: null });
    expect(s.syncNote).toContain('덮어씁니다');
    expect(beginSave(s)!.req.baseVersion).toBe(2);
  });

  test('remote 가 없으면 아무것도 안 함', () => {
    const s = loaded(P(1));
    expect(takeServer(s)).toBe(s);
    expect(keepMine(s)).toBe(s);
  });
});

describe('저장 결과 분류 (classifySave)', () => {
  test.each([
    [200, { ok: true, data: D(P(2)) }, false, 'ok'],
    [200, { ok: false }, false, 'failed'],
    [409, { ok: false }, false, 'conflict'],
    [400, { ok: false, error: 'stopPct: 범위' }, false, 'failed'],
    [0, null, false, 'failed'],
    [0, null, true, 'failed'],
  ])('HTTP %p → %p', (status, body, timedOut, kind) => {
    expect(classifySave(status as number, body as never, timedOut as boolean).kind).toBe(kind);
  });

  test('타임아웃·네트워크 오류 문구', () => {
    expect(classifySave(0, null, true)).toEqual({ kind: 'failed', message: expect.stringContaining('서버 응답이 없어 기다리기를 멈췄습니다') });
    expect(classifySave(0, null)).toEqual({ kind: 'failed', message: '네트워크 오류로 요청하지 못했습니다' });
  });

  test('toSaved', () => {
    expect(toSaved(null)).toBeNull();
    expect(toSaved(D(P(3)).policy)).toEqual(P(3));
  });
});
