'use client';

import type { ReactNode } from 'react';
import { cx, ops } from './styles';

/**
 * 세그먼트(하위 탭) — 데모 `subnav()`·`.seg2`. `role="group"` + 각 버튼 `aria-pressed`, 44px.
 * `sticky` 면 데모 `.subnav`(띠 아래 붙음 — `top: var(--strip-h)`; 띠 높이는 `SafetyStrip onHeightChange` 로 재서 부모가 CSS 변수로 넣는다).
 * URL 동기화(`router.replace('?tab=…')`)는 부모가 onChange 에서 한다.
 */
export function SegmentControl<Id extends string>(props: {
  label: string; items: readonly { id: Id; text: ReactNode }[]; value: Id; onChange: (id: Id) => void; sticky?: boolean;
  /** 버튼 id = `${idPrefix}-${item.id}` — 대화상자를 닫은 뒤 포커스를 돌려줄 대상(`Sheet returnFocusIds`)으로 쓴다 */
  idPrefix?: string;
}) {
  const { label, items, value, onChange, sticky, idPrefix } = props;
  const group = (
    <div className={ops.seg2} role="group" aria-label={label}>
      {items.map((it) => (
        <button key={it.id} id={idPrefix ? `${idPrefix}-${it.id}` : undefined} type="button" aria-pressed={it.id === value} onClick={() => onChange(it.id)}>
          {it.text}
        </button>
      ))}
    </div>
  );
  return sticky ? <div className={cx(ops.subnav)}>{group}</div> : group;
}
