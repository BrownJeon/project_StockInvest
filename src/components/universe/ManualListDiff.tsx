'use client';

/**
 * T-143 WP-B — 일괄 교체 대조 목록 (구현 가이드 §2.6.3, 승인 데모 §4 `.diff`).
 *
 * 머리 3칸(넣을 것·뺄 것·그대로) + 줄 목록 + 안내 1줄. **줄 순서는 문제를 먼저**: `bad` → `dup` → `add` → `rm`.
 *
 * 🔴 색만으로 넣기·빼기를 구분하지 않는다 — 기호(`+`·`−`·`!`·`=`)는 `aria-hidden` 이고 **옆 글자**가 뜻을 말한다
 * (「넣기」·「빼기」·「형식 오류」·「중복」). 이 앱의 빨강·파랑은 상승·하락이라 목록 추가에 쓰면 「오른다」로 읽힌다(§9.3).
 *
 * 🔴 **형식 오류가 1건이라도 있으면 저장 버튼이 꺼진다**(§2.6.2 규칙 5) — 일부만 반영되는 상태를 만들지 않는다.
 * 빈 목록은 막지 않되 경고하고 버튼 글자를 바꾼다(규칙 6).
 */
import { cx, ops } from '@/components/ops/ui/styles';
import type { ManualListDiffResult } from '@/lib/universe/parse-manual-list';
import { MANUAL_LIST_MAX } from '@/lib/universe/parse-manual-list';
import {
  DIFF_BAD_NOTE, DIFF_OK_NOTE, DIFF_TOO_MANY_NOTE, bulkSaveLabel, diffEmptyNote, diffHeldNote, type ManualSource,
} from './view';

export interface ManualListDiffProps {
  diff: ManualListDiffResult;
  /** 현재 수동 목록 수 — 「{현재} → {새} 종목」. */
  currentCount: number;
  /** 보유 중인 종목(빼는 줄 꼬리의 「· 보유 2주 — 빼도 분석은 계속」). 모르면 빈 Map. */
  heldQty: ReadonlyMap<string, number | null>;
  /** 「목록을 비우면 남는 수」 — 서버 값. 모르면 null 이고 그 구절을 뺀다. */
  heldOrFavoritesOnlyCount: number | null;
  /** 저장 전이면(`'fallback'`) 메모가 「기본 목록 N종목 대신 내 목록 M종목」으로 바뀐다(부록 B.2.2) */
  manualSource: ManualSource;
  busy: boolean;
  onRecompare: () => void;
  onSave: (buttonId: string) => void;
}

export const DIFF_SAVE_BUTTON_ID = 'uv-bulk-save';

export function ManualListDiff(p: ManualListDiffProps) {
  const { diff, currentCount, heldQty, heldOrFavoritesOnlyCount, manualSource, busy } = p;
  const empty = diff.next.length === 0;
  // 형식 오류와 상한 초과는 **같은 자리**에 사유를 보인다(m-3). 둘 다면 형식 오류를 먼저 고쳐야 하므로 그쪽을 쓴다
  const note = diff.bad.length > 0
    ? { cls: 'alert', role: 'alert' as const, text: DIFF_BAD_NOTE(diff.bad.length) }
    : diff.tooMany
      ? { cls: 'alert', role: 'alert' as const, text: DIFF_TOO_MANY_NOTE(diff.next.length, MANUAL_LIST_MAX) }
      : empty
        ? { cls: 'warn', role: 'alert' as const, text: diffEmptyNote(heldOrFavoritesOnlyCount) }
        : { cls: '', role: undefined, text: DIFF_OK_NOTE(currentCount, diff.next.length, manualSource) };

  return (
    <>
      {/* 대조 결과가 갱신되면 읽기 도구가 그 사실을 읽는다(가이드 §9.2) */}
      <div className="diff" role="status" aria-label="대조 결과">
        <div className="dh">
          <div><span className="k">넣을 것</span><span className="n">{diff.add.length}</span></div>
          <div><span className="k">뺄 것</span><span className="n">{diff.rm.length}</span></div>
          <div><span className="k">그대로</span><span className="n">{diff.same.length}</span></div>
        </div>
        <ul>
          {diff.bad.map((s, i) => (
            <li className="bad" key={`bad-${i}-${s}`}>
              <span className="mk" aria-hidden="true">!</span>
              <span className="sy">{s}<em>형식 오류 — NAS:AAAA 꼴이어야 합니다</em></span>
            </li>
          ))}
          {diff.dup.map((s, i) => (
            <li key={`dup-${i}-${s}`}>
              <span className="mk" aria-hidden="true">=</span>
              <span className="sy">{s}<em>중복 — 1번만 씁니다</em></span>
            </li>
          ))}
          {diff.add.map((s) => (
            <li className="add" key={`add-${s}`}>
              <span className="mk" aria-hidden="true">+</span>
              <span className="sy">{s}<em>넣기</em></span>
            </li>
          ))}
          {diff.rm.map((s) => {
            const held = diffHeldNote(heldQty.get(s) ?? null, heldQty.has(s));
            return (
              <li className="rm" key={`rm-${s}`}>
                <span className="mk" aria-hidden="true">&minus;</span>
                <span className="sy">{s}<em>{held ? `빼기 ${held}` : '빼기'}</em></span>
              </li>
            );
          })}
        </ul>
        <div className={cx('dnote', note.cls || undefined)} role={note.role}>{note.text}</div>
      </div>

      <div className="bar2">
        <button type="button" className={ops.btn} disabled={busy} onClick={p.onRecompare}>다시 대조</button>
        <button
          type="button" id={DIFF_SAVE_BUTTON_ID}
          className={cx(ops.btn, empty ? ops.dz : ops.pri)}
          disabled={diff.blocked || busy}
          onClick={() => p.onSave(DIFF_SAVE_BUTTON_ID)}
        >
          {bulkSaveLabel(diff.next.length)}
        </button>
      </div>
    </>
  );
}
