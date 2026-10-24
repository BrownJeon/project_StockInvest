/**
 * T-074 공용 시트 — 포커스 가두기·Esc·배경 inert 복원·포커스 복귀(순수 도우미, 가짜 DOM) + 대화상자 마크업(정적 렌더).
 * jsdom 이 없는 node 환경이라 DOM 동작은 도우미 함수로 고정하고, 실제 브라우저 흐름은 화면 확인(Playwright) 몫이다.
 */
import * as ReactNS from 'react';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as unknown as { React: typeof ReactNS }).React = ReactNS;

import {
  collectFocusables, focusFirstAvailable, handleSheetKey, initialFocusIds, setBackgroundInert, Sheet, SheetFrame,
  SHEET_CSS, trapTarget, type FocusableLike,
} from '@/components/ui/Sheet';

interface FakeEl extends FocusableLike { id: string; focus: jest.Mock }

function el(id: string, tag = 'BUTTON', o: { type?: string; name?: string; checked?: boolean; disabled?: boolean; hidden?: boolean } = {}): FakeEl {
  return { id, tagName: tag, type: o.type, name: o.name, checked: !!o.checked, disabled: !!o.disabled, offsetParent: o.hidden ? null : {}, focus: jest.fn() };
}
const rootOf = (list: FakeEl[]) => ({ querySelectorAll: () => list });
const ids = (xs: FocusableLike[]) => xs.map((x) => (x as FakeEl).id);

describe('collectFocusables — 탭 순서 후보', () => {
  test('비활성·숨김은 빼고, 라디오 묶음은 선택된 하나만', () => {
    const list = [
      el('close'),
      el('k-dep', 'INPUT', { type: 'radio', name: 'kind' }),
      el('k-wd', 'INPUT', { type: 'radio', name: 'kind', checked: true }),
      el('k-ex', 'INPUT', { type: 'radio', name: 'kind' }),
      el('date', 'INPUT', { type: 'date' }),
      el('off', 'BUTTON', { disabled: true }),
      el('gone', 'INPUT', { type: 'text', hidden: true }),
      el('next'),
    ];
    expect(ids(collectFocusables(rootOf(list)))).toEqual(['close', 'k-wd', 'date', 'next']);
  });
  test('선택된 라디오가 없으면 묶음의 첫 것, 선택된 것이 비활성이면 첫 것', () => {
    expect(ids(collectFocusables(rootOf([el('a', 'INPUT', { type: 'radio', name: 'r' }), el('b', 'INPUT', { type: 'radio', name: 'r' })])))).toEqual(['a']);
    expect(ids(collectFocusables(rootOf([
      el('a', 'INPUT', { type: 'radio', name: 'r' }), el('b', 'INPUT', { type: 'radio', name: 'r', checked: true, disabled: true }),
    ])))).toEqual(['a']);
  });
});

describe('trapTarget — 끝에서 처음으로, 처음에서 끝으로', () => {
  const L = ['a', 'b', 'c'];
  test('Tab: 마지막 → 처음 / 가운데 → 브라우저 기본(null) / 밖(제목 등) → 처음', () => {
    expect(trapTarget(L, 'c', false)).toBe('a');
    expect(trapTarget(L, 'b', false)).toBeNull();
    expect(trapTarget(L, null, false)).toBe('a');
    expect(trapTarget(L, 'zzz', false)).toBe('a');
  });
  test('Shift+Tab: 처음 → 마지막 / 밖 → 마지막 / 가운데 → null', () => {
    expect(trapTarget(L, 'a', true)).toBe('c');
    expect(trapTarget(L, null, true)).toBe('c');
    expect(trapTarget(L, 'b', true)).toBeNull();
  });
  test('후보가 없으면 null', () => {
    expect(trapTarget([], null, false)).toBeNull();
  });
});

describe('handleSheetKey — Esc 닫기(저장 중 제외)·Tab 가두기', () => {
  const ev = (key: string, shiftKey = false) => ({ key, shiftKey, preventDefault: jest.fn() });
  test('Esc → 닫기 + 기본 동작 막기', () => {
    const onClose = jest.fn();
    const e = ev('Escape');
    expect(handleSheetKey(e, { busy: false, onClose, root: null, active: null })).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(e.preventDefault).toHaveBeenCalled();
  });
  test('🔴 저장 중 Esc 는 무시 — 닫지 않는다', () => {
    const onClose = jest.fn();
    const e = ev('Escape');
    expect(handleSheetKey(e, { busy: true, onClose, root: null, active: null })).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });
  test('🔴 Tab 마지막 → 처음, Shift+Tab 처음 → 마지막 (포커스가 시트 밖으로 나가지 않는다)', () => {
    const a = el('a'); const b = el('b'); const c = el('c');
    const root = rootOf([a, b, c]);
    const t1 = ev('Tab');
    expect(handleSheetKey(t1, { busy: false, onClose: jest.fn(), root, active: c })).toBe(true);
    expect(a.focus).toHaveBeenCalled();
    expect(t1.preventDefault).toHaveBeenCalled();
    const t2 = ev('Tab', true);
    expect(handleSheetKey(t2, { busy: false, onClose: jest.fn(), root, active: a })).toBe(true);
    expect(c.focus).toHaveBeenCalled();
  });
  test('가운데에서 Tab 은 브라우저 기본 이동(막지 않음) · 다른 키는 처리 안 함', () => {
    const a = el('a'); const b = el('b'); const c = el('c');
    const t = ev('Tab');
    expect(handleSheetKey(t, { busy: false, onClose: jest.fn(), root: rootOf([a, b, c]), active: b })).toBe(false);
    expect(t.preventDefault).not.toHaveBeenCalled();
    expect(handleSheetKey(ev('Enter'), { busy: false, onClose: jest.fn(), root: rootOf([a]), active: a })).toBe(false);
  });
  test('저장 중에도 Tab 가두기는 동작한다(포커스 이탈 방지)', () => {
    const a = el('a'); const b = el('b');
    expect(handleSheetKey(ev('Tab'), { busy: true, onClose: jest.fn(), root: rootOf([a, b]), active: b })).toBe(true);
    expect(a.focus).toHaveBeenCalled();
  });
});

describe('setBackgroundInert — 배경 막기·원래 값 복원', () => {
  function node(name: string, inert?: boolean, kids: unknown[] = []) {
    return { name, inert, contains: (x: unknown) => x === undefined ? false : kids.includes(x) };
  }
  test('🔴 시트 호스트(와 그 조상)만 빼고 막고, 되돌리면 원래 값 그대로', () => {
    const host = { host: true };
    const app = node('app', false);
    const tabs = node('tabs', true);           // 원래 inert 였던 것
    const toastBox = node('toast');            // inert 속성 없음
    const wrap = node('wrap', false, [host]);  // 호스트를 품은 조상
    const body = { children: [app, tabs, toastBox, wrap] };
    const restore = setBackgroundInert(body, host);
    expect(app.inert).toBe(true);
    expect(tabs.inert).toBe(true);
    expect(toastBox.inert).toBe(true);
    expect(wrap.inert).toBe(false);
    restore();
    expect(app.inert).toBe(false);
    expect(tabs.inert).toBe(true);
    expect(toastBox.inert).toBe(false);
    expect(wrap.inert).toBe(false);
  });
  test('호스트 자신은 건드리지 않는다', () => {
    const host = node('host');
    const restore = setBackgroundInert({ children: [host] }, host);
    expect(host.inert).toBeUndefined();
    restore();
    expect(host.inert).toBeUndefined();
  });
});

describe('focusFirstAvailable — 포커스 복귀(연 버튼 → 사라졌으면 다음 후보)', () => {
  const doc = (m: Record<string, FakeEl>) => ({ getElementById: (id: string) => m[id] ?? null });
  test('🔴 없는·비활성·숨김을 건너뛰고 보이는 첫 요소', () => {
    const ok = el('list-t');
    const m = { off: el('off', 'BUTTON', { disabled: true }), hid: el('hid', 'BUTTON', { hidden: true }), 'list-t': ok, add: el('add') };
    expect(focusFirstAvailable(doc(m), [null, 'trigger-gone', 'off', 'hid', 'list-t', 'add'])).toBe('list-t');
    expect(ok.focus).toHaveBeenCalledTimes(1);
    expect(m.add.focus).not.toHaveBeenCalled();
  });
  test('후보가 모두 없으면 null', () => {
    expect(focusFirstAvailable(doc({}), ['a', undefined])).toBeNull();
  });
  test('initialFocusIds — 제목 / 첫 입력(없으면 제목) / 지정 id(없으면 제목)', () => {
    expect(initialFocusIds('title', 'x')).toEqual(['sh-t']);
    expect(initialFocusIds('first-input', 'sh-bkrw')).toEqual(['sh-bkrw', 'sh-t']);
    expect(initialFocusIds('first-input', null)).toEqual(['sh-t']);
    expect(initialFocusIds('sh-amt', null)).toEqual(['sh-amt', 'sh-t']);
  });
});

describe('대화상자 마크업', () => {
  test('role=dialog · aria-modal · aria-labelledby=제목 · 제목 tabindex -1 · 닫기 버튼', () => {
    const html = renderToStaticMarkup(h(SheetFrame, { title: '기록 확인', onClose: () => {}, footer: h('button', null, '기록하기'), children: h('p', null, '본문') }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="sh-t"');
    expect(html).toMatch(/<h2 id="sh-t" tabindex="-1">기록 확인<\/h2>/);
    expect(html).not.toContain('aria-describedby');
    expect(html).toContain('>닫기</button>');
    expect(html).not.toMatch(/class="sh-x" disabled/);
  });
  test('부제가 있으면 aria-describedby=sh-sub · 저장 중이면 닫기 비활성', () => {
    const html = renderToStaticMarkup(h(SheetFrame, { title: 't', sub: '부제', busy: true, onClose: () => {}, footer: null, children: null, className: 'lg' }));
    expect(html).toContain('aria-describedby="sh-sub"');
    expect(html).toContain('<p id="sh-sub" class="csub">부제</p>');
    expect(html).toMatch(/class="sh-x" disabled=""/);
    expect(html).toContain('class="sheet-root lg"');
  });
  test('서버 렌더에서는 아무것도 그리지 않는다(포털 호스트는 브라우저에서 만든다)', () => {
    expect(renderToStaticMarkup(h(Sheet, { title: 't', onClose: () => {}, footer: null, children: null }))).toBe('');
  });
  test('넓은 화면은 가운데 대화상자(미디어 쿼리 900px), 모바일은 아래 시트', () => {
    expect(SHEET_CSS).toMatch(/\.sheet-root \{ position: fixed; inset: 0;[^}]*align-items: flex-end/);
    expect(SHEET_CSS).toMatch(/@media \(min-width: 900px\) \{\s*\.sheet-root \{ align-items: center;[^}]*\}\s*\.sheet-root \.sheet \{ max-width: 520px;/);
    expect(SHEET_CSS).not.toMatch(/@container/);
  });
});
