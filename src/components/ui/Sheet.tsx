'use client';

/**
 * 공용 시트(대화상자) — T-074 승인 데모 v1(`mockups/T-074-cash-flow-ledger-v1.html`)의 `openSheet`·`closeSheet`·`sheetShell`·
 * 포커스 가두기를 옮겼다. 앱에 대화상자 기본 부품이 없고 삭제 확인은 `window.confirm` 뿐이라 새로 둔다(Designer 구현 가이드 5절).
 *
 * 요구(가이드 5절):
 *  - `role=dialog` · `aria-modal` · `aria-labelledby`(제목 `sh-t`) · 부제가 있으면 `aria-describedby`(`sh-sub`)
 *  - 열 때 첫 입력 포커스(없으면 제목) — `initialFocus` 로 바꿀 수 있다(데모: 기록 폼은 금액 칸, 기준 시트는 제목)
 *  - Tab 가두기 — 라디오 묶음은 선택된 하나만 탭 순서에 넣는다(브라우저 기본 동작과 같음, 데모 `focusables`)
 *  - Esc 닫기(저장 중 제외) · 배경 `inert` + 스크롤 잠금 · 닫을 때 연 버튼으로 포커스 복귀(사라졌으면 다음 후보 — 목록 제목 등)
 *  - 모바일은 아래에서 올라오는 시트, 900px 이상은 가운데 대화상자(최대 520px) — 데모의 프레임 판정(`.sheet-root.d`)을 미디어 쿼리로 바꿨다
 *
 * DOM 을 직접 다루는 부분(포커스 목록·Tab 이동·배경 inert·포커스 복귀)은 아래 순수 함수로 빼서 node 시험에서 가짜 DOM 으로 검증한다.
 */
import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// ─── 순수 도우미 (가짜 DOM 으로 시험) ──────────────────────────────────────

/** 포커스 후보 요소에 필요한 최소 모양 */
export interface FocusableLike {
  tagName: string;
  type?: string;
  name?: string;
  checked?: boolean;
  disabled?: boolean;
  /** null 이면 화면에 그려지지 않은 요소(display:none 조상 등) */
  offsetParent: unknown;
  focus: () => void;
}

export interface QueryRootLike {
  querySelectorAll: (sel: string) => ArrayLike<FocusableLike>;
}

export const FOCUSABLE_SELECTOR = 'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])';

/** 탭 순서에 들어가는 요소 — 비활성·숨김 제외, 라디오 묶음은 선택된 것 하나(없으면 첫 것) */
export function collectFocusables(root: QueryRootLike): FocusableLike[] {
  const all = Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR));
  const seen = new Set<string>();
  const out: FocusableLike[] = [];
  for (const x of all) {
    if (x.disabled || x.offsetParent === null) continue;
    if (x.tagName === 'INPUT' && x.type === 'radio' && x.name) {
      if (seen.has(x.name)) continue;
      seen.add(x.name);
      const group = all.filter((r) => r.tagName === 'INPUT' && r.type === 'radio' && r.name === x.name);
      const checked = group.find((r) => r.checked && !r.disabled && r.offsetParent !== null);
      out.push(checked ?? x);
      continue;
    }
    out.push(x);
  }
  return out;
}

/** Tab/Shift+Tab 을 시트 안에서 돌린다 — 끝에서 처음으로, 처음에서 끝으로. 가둘 필요가 없으면 null(브라우저 기본 이동) */
export function trapTarget<T>(list: readonly T[], active: T | null, shift: boolean): T | null {
  if (list.length === 0) return null;
  const i = active == null ? -1 : list.indexOf(active);
  if (shift && i <= 0) return list[list.length - 1];
  if (!shift && (i === -1 || i === list.length - 1)) return list[0];
  return null;
}

export interface InertableLike {
  inert?: boolean;
  contains: (other: unknown) => boolean;
}

/** body 의 다른 자식(앱 화면·하단 탭·토스트 등)을 `inert` 로 막는다. 되돌리는 함수를 돌려준다(원래 값 복원) */
export function setBackgroundInert(body: { children: ArrayLike<InertableLike> }, host: unknown): () => void {
  const changed: { el: InertableLike; prev: boolean }[] = [];
  for (const el of Array.from(body.children)) {
    if (el === host || el.contains(host)) continue;
    changed.push({ el, prev: !!el.inert });
    el.inert = true;
  }
  return () => {
    for (const c of changed) c.el.inert = c.prev;
  };
}

export interface DocLike {
  getElementById: (id: string) => (FocusableLike & { getAttribute?: (n: string) => string | null }) | null;
}

/** 후보 id 를 차례로 보고 처음으로 보이는(활성) 요소에 포커스한다. 포커스한 id 를 돌려준다 */
export function focusFirstAvailable(doc: DocLike, ids: readonly (string | null | undefined)[]): string | null {
  for (const id of ids) {
    if (!id) continue;
    const el = doc.getElementById(id);
    if (!el || el.disabled || el.offsetParent === null) continue;
    el.focus();
    return id;
  }
  return null;
}

/** 열 때 포커스할 곳 — 'title' 이면 제목, 'first-input' 이면 첫 글자 입력 칸(없으면 제목), 그 밖은 그 id(없으면 제목) */
export function initialFocusIds(initial: string, firstInputId: string | null): string[] {
  if (initial === 'title') return [SHEET_TITLE_ID];
  if (initial === 'first-input') return [firstInputId, SHEET_TITLE_ID].filter((x): x is string => !!x);
  return [initial, SHEET_TITLE_ID];
}

export interface SheetKeyContext {
  busy: boolean;
  onClose: () => void;
  root: QueryRootLike | null;
  active: FocusableLike | null;
}

/** keydown 처리 — Esc 닫기(저장 중이면 무시), Tab 가두기. 처리했으면 true */
export function handleSheetKey(
  ev: { key: string; shiftKey: boolean; preventDefault: () => void },
  ctx: SheetKeyContext,
): boolean {
  if (ev.key === 'Escape') {
    if (ctx.busy) return false;
    ev.preventDefault();
    ctx.onClose();
    return true;
  }
  if (ev.key !== 'Tab' || !ctx.root) return false;
  const target = trapTarget(collectFocusables(ctx.root), ctx.active, ev.shiftKey);
  if (!target) return false;
  ev.preventDefault();
  target.focus();
  return true;
}

// ─── 컴포넌트 ─────────────────────────────────────────────────────────────

export const SHEET_TITLE_ID = 'sh-t';
export const SHEET_SUB_ID = 'sh-sub';

/** 시트 틀 CSS — 데모의 `.sheet-root`·`.sheet`·`.sh-*` 그대로. 데모의 `.sheet-root.d`(넓은 화면)는 미디어 쿼리로 바꿨다 */
export const SHEET_CSS = `
.sheet-root { position: fixed; inset: 0; z-index: 50; background: rgba(0,0,0,.62); display: flex; align-items: flex-end; justify-content: center; }
.sheet-root .sheet { width: 100%; max-width: 412px; max-height: 92vh; display: flex; flex-direction: column; background: var(--bg2); border: 1px solid var(--border2); border-bottom: 0; border-radius: 14px 14px 0 0; box-shadow: 0 -8px 24px rgba(0,0,0,.5); }
.sheet-root .sh-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 6px 6px 16px; border-bottom: 1px solid var(--border); }
.sheet-root .sh-head h2 { margin: 0; font-size: 16px; outline: none; }
.sheet-root .sh-x { min-height: 44px; min-width: 56px; border-radius: 8px; font-size: 13px; font-weight: 600; color: var(--muted); }
.sheet-root .sh-body { overflow-y: auto; padding: 12px 16px 16px; display: flex; flex-direction: column; gap: 14px; overscroll-behavior: contain; }
.sheet-root .sh-foot { display: flex; flex-direction: column; gap: 6px; padding: 10px 16px calc(10px + var(--safe-bottom)); border-top: 1px solid var(--border); }
.sheet-root .sh-why { font-size: 12px; color: var(--muted); line-height: 1.5; min-height: 0; }
.sheet-root .sh-why:empty { display: none; }
.sheet-root :focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
.sheet-root button:disabled { cursor: not-allowed; }
@media (hover: hover) { .sheet-root .sh-x:hover:not(:disabled) { filter: brightness(1.12); } }
@media (min-width: 900px) {
  .sheet-root { align-items: center; padding: 16px; }
  .sheet-root .sheet { max-width: 520px; border-radius: 14px; border-bottom: 1px solid var(--border2); max-height: 88vh; }
}
`;

export interface SheetProps {
  /** 제목(h2#sh-t) */
  title: ReactNode;
  /** 부제(p#sh-sub — 있으면 aria-describedby) */
  sub?: ReactNode;
  /** 닫기 요청(닫기 버튼·Esc). busy 면 부르지 않는다 */
  onClose: () => void;
  /** 저장 중 — 닫기 버튼 비활성·Esc 무시 */
  busy?: boolean;
  children: ReactNode;
  footer: ReactNode;
  /** 루트에 덧붙일 클래스(내용 스타일 범위 — 예: 'lg') */
  className?: string;
  /** 'first-input'(기본) · 'title' · 요소 id */
  initialFocus?: string;
  /** seq 가 바뀔 때마다 그 id 로 포커스를 옮긴다(없거나 비활성이면 제목) — 단계 전환·저장 결과 뒤 */
  focusRequest?: { id: string; seq: number } | null;
  /** 닫힐 때 포커스할 후보 id(앞에서부터, 보이는 첫 요소). 닫히는 순간 부른다 — 그때의 화면 기준 */
  returnFocusIds?: () => readonly (string | null | undefined)[];
  /** 닫힌 뒤(배경 inert 해제·포커스 복귀 다음) 부른다 — 토스트 등 */
  onAfterClose?: () => void;
}

export function Sheet(p: SheetProps) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const live = useRef(p);
  live.current = p;

  useEffect(() => {
    const el = document.createElement('div');
    el.setAttribute('data-sheet-host', '');
    document.body.appendChild(el);
    setHost(el);
    return () => { el.remove(); };
  }, []);

  useEffect(() => {
    if (!host) return;
    const restoreInert = setBackgroundInert(document.body as unknown as { children: ArrayLike<InertableLike> }, host);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const root = rootRef.current;
    const firstInput = root?.querySelector<HTMLElement>('input:not([type="radio"]):not([type="checkbox"]):not([disabled]), textarea:not([disabled]), select:not([disabled])');
    focusFirstAvailable(document as unknown as DocLike, initialFocusIds(live.current.initialFocus ?? 'first-input', firstInput?.id || null));

    const onKey = (ev: KeyboardEvent) => {
      handleSheetKey(ev, {
        busy: !!live.current.busy,
        onClose: () => live.current.onClose(),
        root: rootRef.current as unknown as QueryRootLike | null,
        active: document.activeElement as unknown as FocusableLike | null,
      });
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      restoreInert();
      document.body.style.overflow = prevOverflow;
      const ids = live.current.returnFocusIds?.() ?? [];
      focusFirstAvailable(document as unknown as DocLike, ids);
      live.current.onAfterClose?.();
    };
  }, [host]);

  const seq = p.focusRequest?.seq;
  useEffect(() => {
    if (!host || !live.current.focusRequest) return;
    focusFirstAvailable(document as unknown as DocLike, [live.current.focusRequest.id, SHEET_TITLE_ID]);
  }, [host, seq]);

  if (!host) return null;
  return createPortal(
    <SheetFrame
      title={p.title} sub={p.sub} busy={p.busy} className={p.className} footer={p.footer} rootRef={rootRef}
      onClose={() => { if (!live.current.busy) live.current.onClose(); }}
    >{p.children}</SheetFrame>,
    host,
  );
}

/** 시트 마크업(포털·효과 없음) — 정적 렌더 시험이 role·aria 속성을 이것으로 확인한다 */
export function SheetFrame(p: Pick<SheetProps, 'title' | 'sub' | 'busy' | 'children' | 'footer' | 'className' | 'onClose'> & {
  rootRef?: MutableRefObject<HTMLDivElement | null>;
}) {
  return (
    <div className={`sheet-root${p.className ? ` ${p.className}` : ''}`} ref={p.rootRef}>
      <style dangerouslySetInnerHTML={{ __html: SHEET_CSS }} />
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={SHEET_TITLE_ID} aria-describedby={p.sub ? SHEET_SUB_ID : undefined}>
        <div className="sh-head">
          <h2 id={SHEET_TITLE_ID} tabIndex={-1}>{p.title}</h2>
          <button type="button" className="sh-x" onClick={p.onClose} disabled={!!p.busy}>닫기</button>
        </div>
        <div className="sh-body">
          {p.sub ? <p id={SHEET_SUB_ID} className="csub">{p.sub}</p> : null}
          {p.children}
        </div>
        <div className="sh-foot">{p.footer}</div>
      </div>
    </div>
  );
}
