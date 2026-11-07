/**
 * T-108 B-1 — 하단 탭 5칸(가이드 §1.1 · 승인 데모 v3 「하단 5탭」). 비서(brain, /ai)는 T-157 에서 4번째에 더했다.
 * 링크 순서·라벨·href · 비서 활성 · 「보류」 표지 없음 · 활성 규칙 · aria-current 1개 · 라벨 11px · SVG 도형 수 · HIDDEN_PATHS 불변.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ReactNS from 'react';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as unknown as { React: typeof ReactNS }).React = ReactNS;
let mockPath = '/';
jest.mock('next/navigation', () => ({ usePathname: () => mockPath, useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));

import { BottomTabs, BOTTOM_TABS_CSS, HIDDEN_PATHS, TABS, activeTabHref } from '@/components/BottomTabs';
import { NavIcon } from '@/components/nav/NavIcons';

const SRC = path.resolve(__dirname, '../..');
const render = (p: string) => { mockPath = p; return renderToStaticMarkup(h(BottomTabs)); };
const noStyle = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, '');
const links = (html: string) => [...noStyle(html).matchAll(/<a ([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({
  attrs: m[1],
  href: /href="([^"]*)"/.exec(m[1])?.[1],
  current: /aria-current="page"/.test(m[1]),
  label: m[2].replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ''),
  inner: m[2],
}));

describe('B-1 하단 탭 — 구성', () => {
  test('링크 5개: 홈 / · 거래 /recommend · 분석 /analytics · 비서 /ai · 설정 /settings (순서 고정)', () => {
    const l = links(render('/'));
    expect(l.map((x) => [x.label, x.href])).toEqual([['홈', '/'], ['거래', '/recommend'], ['분석', '/analytics'], ['비서', '/ai'], ['설정', '/settings']]);
    expect(TABS.map((t) => t.icon)).toEqual(['stone', 'handshake', 'scan-search', 'brain', 'settings']);
  });
  test('비서(/ai·brain)는 4번째 · 5칸 그리드 · 데모의 「보류」 표지는 옮기지 않는다', () => {
    const html = render('/');
    expect(TABS).toHaveLength(5);
    expect(TABS[3]).toMatchObject({ href: '/ai', label: '비서', icon: 'brain' });
    expect(html).not.toContain('보류');
    expect(html).not.toContain('class="hold"');
    expect(BOTTOM_TABS_CSS).toContain('grid-template-columns: repeat(5, 1fr)');
    expect(BOTTOM_TABS_CSS).not.toContain('repeat(4, 1fr)');
  });
  test('옛 탭(대시보드·즐겨찾기·추천)·이모지·가운데 강조 없음', () => {
    const html = render('/');
    for (const old of ['대시보드', '즐겨찾기', '추천', '🏠', '⭐', '💡', '📈', '⚙️', 'emphasize', 'translateY(-2px)']) expect(html).not.toContain(old);
  });
  test('nav aria-label="주 메뉴" · 아이콘은 장식(aria-hidden)', () => {
    const html = render('/');
    expect(html.startsWith('<nav class="bn" aria-label="주 메뉴"><style>')).toBe(true);
    expect(noStyle(html).match(/<svg /g)).toHaveLength(5);
    expect(noStyle(html).match(/<svg [^>]*aria-hidden="true"/g)).toHaveLength(5);
  });
});

describe('B-1 하단 탭 — 활성 규칙 (aria-current 는 활성 링크 하나에만)', () => {
  const cases: [string, string | null][] = [
    ['/', '/'],
    ['/recommend', '/recommend'], ['/recommend/123', '/recommend'], ['/recommend/build', '/recommend'],
    ['/strategy', '/recommend'], ['/strategy/abc', '/recommend'], ['/order', '/recommend'],
    ['/analytics', '/analytics'], ['/favorites', '/analytics'], ['/favorites/005930', '/analytics'],
    ['/settings', '/settings'], ['/settings/cash-ledger', '/settings'], ['/profile', '/settings'],
    ['/ai', '/ai'], ['/ai/', '/ai'],
    ['/markets', null], ['/orders', null],
  ];
  test.each(cases)('%s → %s', (p, want) => {
    expect(activeTabHref(p)).toBe(want);
    const l = links(render(p));
    const cur = l.filter((x) => x.current);
    if (want === null) expect(cur).toHaveLength(0);
    else { expect(cur).toHaveLength(1); expect(cur[0].href).toBe(want); }
  });
  test('활성 탭에만 위 2px 막대(span.bar aria-hidden) — 색 외 모양 단서', () => {
    const l = links(render('/analytics'));
    expect(l.filter((x) => x.inner.includes('<span class="bar" aria-hidden="true"></span>')).map((x) => x.href)).toEqual(['/analytics']);
    const a = links(render('/ai'));
    expect(a.filter((x) => x.inner.includes('<span class="bar" aria-hidden="true"></span>')).map((x) => x.href)).toEqual(['/ai']);
    expect(BOTTOM_TABS_CSS).toContain('.bn .bar { position: absolute; top: 0; left: 30%; right: 30%; height: 2px; background: var(--accent);');
    expect(BOTTOM_TABS_CSS).toContain('.bn a[aria-current="page"] { color: var(--accent); }');
  });
});

describe('B-1 하단 탭 — 스타일 (데모 236~242·280행)', () => {
  test('라벨 11px(10px 아님) · 600 · 비활성 --muted · 터치 56px', () => {
    expect(BOTTOM_TABS_CSS).toContain('min-height: 56px; color: var(--muted); font-size: 11px; font-weight: 600;');
    expect(BOTTOM_TABS_CSS).not.toMatch(/font-size:\s*(10|9|8)px/);
  });
  test('fixed · 높이 nav-h + safe-bottom 그대로 · ≥900px 가운데 720px 둥근 위 모서리', () => {
    expect(BOTTOM_TABS_CSS).toContain('position: fixed; left: 0; right: 0; bottom: 0; height: calc(var(--nav-h) + var(--safe-bottom)); padding-bottom: var(--safe-bottom);');
    expect(BOTTOM_TABS_CSS).toMatch(/@media \(min-width: 900px\) \{\s*\.bn \{ left: 50%; right: auto; width: 720px; transform: translateX\(-50%\); border: 1px solid var\(--border\); border-bottom: 0; border-radius: 14px 14px 0 0; \}/);
  });
  test('아이콘 22px · 선 2 · 둥근 끝 · currentColor · viewBox 24', () => {
    const svg = renderToStaticMarkup(h(NavIcon, { name: 'stone' }));
    expect(svg).toMatch(/^<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">/);
  });
});

/**
 * T-157 — **렌더 결과**의 `<style>` 내용을 본다.
 *
 * 위 「스타일」 묶음은 `BOTTOM_TABS_CSS` **상수 문자열**만 대조하므로, 상수는 맞는데 주입 방식이 틀려
 * 렌더 결과가 달라지는 경우를 잡지 못한다(그래서 33건이 전부 통과한 채 주입 방식이 어긋나 있었다).
 *
 * `<style>{CSS}</style>`(children)로 넣으면 **렌더러에 따라** `"` → `&quot;` 로 이스케이프되고,
 * `<style>` 안에서는 브라우저가 엔티티를 풀지 않아 `[aria-current=&quot;page&quot;]` 라는 무효
 * 선택자가 된다. 이스케이프하는 것은 이 시험이 쓰는 `react-dom` 18.3.1 이고, **Next 15.5.27 이
 * 번들한 서버 렌더러는 이스케이프하지 않는다** — 그래서 운영 화면의 활성 탭 색은 깨지지 않았다
 * (배포본 prerender HTML 실측). 아래 렌더 단언 4건은 「상수 == 렌더된 style 텍스트」 계약을
 * 고정하는 것이고, children 으로 되돌리는 변이를 잡는 힘은 시험 렌더러의 이스케이프에 기대고 있다.
 * 렌더러와 무관하게 주입 방식을 고정하는 것은 맨 끝 소스 대조 시험 하나다.
 */
describe('B-1 하단 탭 — 렌더된 <style> 이 CSS 를 그대로 담는다 (T-157 QA 결함 #2 회귀)', () => {
  const styleText = (html: string) => {
    const m = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)];
    expect(m).toHaveLength(1);
    return m[0][1];
  };

  test('렌더된 style 내용이 BOTTOM_TABS_CSS 와 글자 하나까지 같다', () => {
    expect(styleText(render('/'))).toBe(BOTTOM_TABS_CSS);
  });

  test('활성 탭 색 규칙이 이스케이프되지 않은 채 들어간다(`&quot;` 가 아니다)', () => {
    for (const p of ['/', '/ai', '/analytics']) {
      const css = styleText(render(p));
      expect(css).toContain('.bn a[aria-current="page"] { color: var(--accent); }');
      expect(css).not.toContain('aria-current=&quot;page&quot;');
    }
  });

  test('style 내용에 HTML 엔티티가 없다 — CSS 에 `>` 등이 새로 들어와도 같은 결함을 막는다', () => {
    const css = styleText(render('/ai'));
    for (const ent of ['&quot;', '&amp;', '&lt;', '&gt;', '&#x27;', '&#39;']) expect(css).not.toContain(ent);
  });

  test('`/ai` 활성 상태의 렌더 HTML 전체에 `&quot;` 가 없다', () => {
    expect(render('/ai')).not.toContain('&quot;');
  });

  test('주입 방식은 dangerouslySetInnerHTML(저장소 다른 7곳과 같음) — 렌더러와 무관하게 소스로 고정한다', () => {
    const src = fs.readFileSync(path.join(SRC, 'components/BottomTabs.tsx'), 'utf8');
    expect(src).toContain('<style dangerouslySetInnerHTML={{ __html: BOTTOM_TABS_CSS }} />');
    expect(src).not.toContain('<style>{BOTTOM_TABS_CSS}</style>');
  });
});

describe('B-1 아이콘 — lucide-react 1.24.0 원본 경로(데모 529~534행)', () => {
  const count = (name: 'stone' | 'handshake' | 'scan-search' | 'brain' | 'settings') => {
    const svg = renderToStaticMarkup(h(NavIcon, { name }));
    return (svg.match(/<(path|circle) /g) ?? []).length;
  };
  test('도형 수 stone 3 · handshake 5 · scan-search 6 · brain 8 · settings 2', () => {
    expect([count('stone'), count('handshake'), count('scan-search'), count('brain'), count('settings')]).toEqual([3, 5, 6, 8, 2]);
  });
  test('경로 문자열이 승인 데모와 같다(stone·handshake·scan-search·brain·settings)', () => {
    const demo = fs.readFileSync(path.resolve(SRC, '../mockups/T-108-menu-home-v3.html'), 'utf8');
    const demoShapes = (key: string) => {
      const m = new RegExp(`\\n\\s+${key}: '<svg[^>]*>([\\s\\S]*?)</svg>'`).exec(demo);
      if (!m) throw new Error(`데모에서 ${key} 를 찾지 못함`);
      return [...m[1].matchAll(/<(path|circle) ([^>]*?)\/>/g)].map((x) => x[2].trim());
    };
    const ours = (name: 'stone' | 'handshake' | 'scan-search' | 'brain' | 'settings') =>
      [...renderToStaticMarkup(h(NavIcon, { name })).matchAll(/<(path|circle) ([^>]*?)\/?>(?:<\/\1>)?/g)].map((x) => x[2].trim());
    expect(ours('stone')).toEqual(demoShapes('home'));
    expect(ours('handshake')).toEqual(demoShapes('trade'));
    expect(ours('scan-search')).toEqual(demoShapes('ana'));
    expect(ours('brain')).toEqual(demoShapes('ai'));
    expect(demoShapes('ai')).toHaveLength(8);
    expect(ours('settings')).toEqual(demoShapes('set'));
  });
  test('lucide-react 의존성을 추가하지 않았다 · 출처 주석', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(SRC, '../package.json'), 'utf8'));
    expect({ ...pkg.dependencies, ...pkg.devDependencies }).not.toHaveProperty('lucide-react');
    expect(fs.readFileSync(path.join(SRC, 'components/nav/NavIcons.tsx'), 'utf8')).toContain('lucide-react 1.24.0 (ISC) 원본 경로');
  });
});

describe('B-1 HIDDEN_PATHS — 값·export 불변(app-shell-render.test.ts 동일성 검사)', () => {
  test('값 그대로', () => {
    expect(HIDDEN_PATHS).toEqual(['/login', '/signup', '/signup/request', '/oauth/invite']);
  });
  test.each(HIDDEN_PATHS)('%s 에서는 렌더 없음', (p) => {
    expect(render(p)).toBe('');
  });
});
