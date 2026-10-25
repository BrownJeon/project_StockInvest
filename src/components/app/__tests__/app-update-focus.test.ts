/**
 * T-084 R2 Low ② — 업데이트 띠를 ✕ 로 닫은 뒤 포커스 대상(h1 → h2 → main → 옮기지 않음).
 *
 * 왜: 닫기 버튼이 사라지면 포커스가 갈 곳이 없어 `body` 로 떨어진다(화면 낭독기·키보드 사용자가 위치를 잃음).
 * 이전 구현은 제목(h1/h2)만 찾아서 제목이 없는 화면에서는 여전히 `body` 로 갔다 — `main` 을 마지막 후보로 둔다.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  DISMISS_FOCUS_ORDER,
  focusAfterDismiss,
  pickDismissFocusTarget,
  type FocusTargetLike,
} from '../app-update-logic';

interface FakeEl extends FocusTargetLike {
  tag: string;
  attrs: Map<string, string>;
  focus: jest.Mock;
}

function el(tag: string, attrs: Record<string, string> = {}): FakeEl {
  const map = new Map(Object.entries(attrs));
  return {
    tag,
    attrs: map,
    hasAttribute: (n) => map.has(n),
    setAttribute: (n, v) => { map.set(n, v); },
    focus: jest.fn(),
  };
}

/** 문서 순서대로 놓인 요소들 위의 가짜 querySelector — 실제 DOM 처럼 쉼표 목록은 **문서 순서**로 첫 일치를 고른다. */
function fakeDoc(els: FakeEl[]) {
  const calls: string[] = [];
  return {
    calls,
    querySelector(selector: string): FakeEl | null {
      calls.push(selector);
      const tags = selector.split(',').map((s) => s.trim());
      return els.find((e) => tags.includes(e.tag)) ?? null;
    },
  };
}

describe('pickDismissFocusTarget — 후보 순서', () => {
  test('순서 상수는 h1 → h2 → main', () => {
    expect([...DISMISS_FOCUS_ORDER]).toEqual(['h1', 'h2', 'main']);
  });

  test('h1 이 있으면 h1(문서에서 h2 가 먼저 나와도)', () => {
    const h2 = el('h2');
    const h1 = el('h1');
    const main = el('main');
    const d = fakeDoc([main, h2, h1]);
    expect(pickDismissFocusTarget((s) => d.querySelector(s))).toBe(h1);
    // 대조: 쉼표 목록 한 번으로 찾던 옛 방식은 문서 순서라 h2 를 고른다.
    expect(d.querySelector('h1, h2')).toBe(h2);
  });

  test('h1 이 없으면 h2', () => {
    const h2 = el('h2');
    const d = fakeDoc([el('main'), h2]);
    expect(pickDismissFocusTarget((s) => d.querySelector(s))).toBe(h2);
  });

  test('제목이 없으면 main', () => {
    const main = el('main');
    const d = fakeDoc([el('div'), main]);
    expect(pickDismissFocusTarget((s) => d.querySelector(s))).toBe(main);
  });

  test('셋 다 없으면 null(옮기지 않음)', () => {
    const d = fakeDoc([el('div'), el('section')]);
    expect(pickDismissFocusTarget((s) => d.querySelector(s))).toBeNull();
    expect(d.calls).toEqual(['h1', 'h2', 'main']);
  });

  test('찾으면 거기서 멈춘다(뒤 후보를 조회하지 않음)', () => {
    const d = fakeDoc([el('h1'), el('main')]);
    pickDismissFocusTarget((s) => d.querySelector(s));
    expect(d.calls).toEqual(['h1']);
  });

  test('query 가 undefined 를 돌려줘도 다음 후보로', () => {
    const main = el('main');
    expect(pickDismissFocusTarget((s) => (s === 'main' ? main : undefined))).toBe(main);
  });
});

describe('focusAfterDismiss — 포커스 이동', () => {
  test('main 으로 옮길 때 tabindex=-1 을 붙이고 preventScroll 로 focus', () => {
    const main = el('main');
    expect(focusAfterDismiss(fakeDoc([main]))).toBe(true);
    expect(main.attrs.get('tabindex')).toBe('-1');
    expect(main.focus).toHaveBeenCalledTimes(1);
    expect(main.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  test('이미 tabindex 가 있으면 바꾸지 않는다', () => {
    const h1 = el('h1', { tabindex: '0' });
    expect(focusAfterDismiss(fakeDoc([h1]))).toBe(true);
    expect(h1.attrs.get('tabindex')).toBe('0');
    expect(h1.focus).toHaveBeenCalledTimes(1);
  });

  test('h1 이 있으면 main 은 건드리지 않는다', () => {
    const h1 = el('h1');
    const main = el('main');
    focusAfterDismiss(fakeDoc([main, h1]));
    expect(h1.focus).toHaveBeenCalledTimes(1);
    expect(main.focus).not.toHaveBeenCalled();
    expect(main.attrs.has('tabindex')).toBe(false);
  });

  test('대상이 없으면 false, 아무것도 focus 하지 않음', () => {
    const div = el('div');
    expect(focusAfterDismiss(fakeDoc([div]))).toBe(false);
    expect(div.focus).not.toHaveBeenCalled();
  });

  test('document 가 없으면(SSR) false', () => {
    expect(focusAfterDismiss(null)).toBe(false);
    expect(focusAfterDismiss(undefined)).toBe(false);
  });
});

describe('AppUpdateBanner 가 이 로직을 쓴다(정적 검사)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'AppUpdateBanner.tsx'), 'utf8');

  test('focusAfterDismiss 를 import 해 호출한다', () => {
    expect(src).toMatch(/import\s*\{[^}]*\bfocusAfterDismiss\b[^}]*\}\s*from '\.\/app-update-logic'/);
    expect(src).toMatch(/focusAfterDismiss\(/);
  });

  test('제목 선택자를 직접 쓰지 않는다(순서는 순수 로직 한 곳에서만 정한다)', () => {
    expect(src).not.toMatch(/querySelector[^(]*\(\s*['"`][^'"`]*\bh[12]\b/);
  });

  test('✕ 핸들러는 기록 저장 → 상태 갱신 → 포커스 이동 순서', () => {
    const i = src.indexOf('onDismiss={() => {');
    expect(i).toBeGreaterThan(-1);
    const body = src.slice(i, src.indexOf('}}', i));
    const w = body.indexOf('dismissStore.write(');
    const s = body.indexOf('setDismiss(');
    const f = body.indexOf('focusFirstHeading()');
    expect(w).toBeGreaterThan(-1);
    expect(s).toBeGreaterThan(w);
    expect(f).toBeGreaterThan(s);
  });
});
