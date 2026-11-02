/**
 * T-130 WP1 — 설정 화면 터치 영역·키보드 (데모 v1 승인: D1-A 값 행 전체 탭 · D2-A 스위치 button · D9-A 확인 시트 없음).
 *
 * 무엇을 고정하나
 *  (a) 스위치 14개(수는 `SWITCH_LABELS.length` 로 센다): `<button type="button" role="switch">` 이고 이름(aria-label) = 행 제목. Space·Enter 는 **브라우저가** 포커스된 button 의
 *      click 으로 바꿔 주는 기본 동작이다. 여기(jsdom 없음)서는 그 전제 — 네이티브 button · `disabled` 속성 없음(포커스 유지) · tabIndex 없음 ·
 *      키 처리기는 **Enter 길게 누름(반복)만** 기본 동작을 취소(Reviewer F2) — 와 click 경로(onClick)를 본다. 실제 키 입력은 QA 가 브라우저에서 확인한다.
 *      잠김(aria-disabled)·disabled 이면 click 이 아무것도 바꾸지 않는다. 스위치 행은 행 전체를 누르게 하지 않는다.
 *  (b) 값 행 7개: 행 전체가 버튼 → 누르면 입력칸(44px) 열림 → Enter 확정 → 저장 바 「변경 사항 있음 [저장]」. Esc 취소 · 바깥 누르기 확정 ·
 *      포커스 복귀 · 뒤늦은 blur 가 두 번 확정하지 않음 · 받아들이는 값 범위(예전 그대로).
 *  (c) 안전 값 못 읽음 → 세 안전 스위치 잠김 유지  (d) 안전 스위치 저장 실패 → 서버 값으로 되돌림(새 button 의 click 경로로).
 *  + 44px 이상이 **인라인 스타일로 선언됐는지**. 실제 크기는 jsdom 이 없어 여기서 못 잰다 — 360·412px 실측은 QA 몫(가이드 9장 ①).
 *
 * 방식(jsdom·testing-library 없음 — 설치는 범위 밖): `react` 훅을 감싼 작은 하네스.
 *  - SSR(renderToStaticMarkup): SettingsPage 의 useState 11개만 큐 값으로 채우고, 자식은 실제 훅으로 그린다(다른 설정 시험과 같은 방식).
 *  - 직접 호출: 컴포넌트 함수를 부르고 훅 상태를 「파이버」(배열)에 보관한다. setter 가 그 배열을 고치고, 다시 부르면 다음 렌더다.
 *    렌더 뒤 `ref` 를 가짜 노드({ focus })에 붙이고 effect 를 돌린다(React 커밋 순서 흉내). 운영 API 는 부르지 않는다(fetch 모킹).
 */
import * as ReactNS from 'react';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

type Fiber = { slots: unknown[]; refs?: Set<{ current: unknown }> };
const H: { fiber: Fiber | null; i: number; effects: Array<() => unknown>; queue: unknown[] } = {
  fiber: null, i: 0, effects: [], queue: [],
};

jest.mock('react', () => {
  const actual = jest.requireActual('react');
  return {
    ...actual,
    useState: (init: unknown) => {
      const f = H.fiber;
      if (!f) return H.queue.length > 0 ? [H.queue.shift(), () => {}] : actual.useState(init);
      const i = H.i++;
      const slots = f.slots;
      if (!(i in slots)) slots[i] = typeof init === 'function' ? (init as () => unknown)() : init;
      const set = (v: unknown) => { slots[i] = typeof v === 'function' ? (v as (p: unknown) => unknown)(slots[i]) : v; };
      return [slots[i], set];
    },
    useRef: (init: unknown) => {
      const f = H.fiber;
      if (!f) return actual.useRef(init);
      const i = H.i++;
      if (!(i in f.slots)) f.slots[i] = { current: init };
      return f.slots[i];
    },
    useEffect: (fn: () => unknown, deps?: unknown[]) => {
      const f = H.fiber;
      if (!f) return actual.useEffect(fn, deps);
      const i = H.i++;
      const prev = f.slots[i] as unknown[] | undefined;
      const changed = prev === undefined || !deps || deps.some((d, k) => !Object.is(d, prev[k]));
      f.slots[i] = deps ?? [];
      if (changed) H.effects.push(fn);
      return undefined;
    },
    useCallback: (fn: unknown, deps: unknown) => (H.fiber ? fn : actual.useCallback(fn, deps)),
  };
});
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }), usePathname: () => '/settings' }));

(globalThis as unknown as { React: typeof ReactNS }).React = ReactNS;

import { SettingsPage, PostMarketOverseasRow } from '@/app/settings/SettingsPage';
import { LIVE_TRADING_LABEL } from '@/lib/safety/live-trading';

// ─── 하네스 ─────────────────────────────────────────────────────────────────

type El = { type: unknown; ref?: unknown; props: Record<string, unknown> & { children?: unknown } };
type FakeNode = { focus: jest.Mock };
const isEl = (n: unknown): n is El => !!n && typeof n === 'object' && 'props' in (n as object);
const typeName = (el: El): unknown => (typeof el.type === 'function' ? (el.type as { name?: string }).name : el.type);
function walk(n: unknown, visit: (el: El, ancestors: El[]) => void, ancestors: El[] = []): void {
  if (Array.isArray(n)) { n.forEach(x => walk(x, visit, ancestors)); return; }
  if (!isEl(n)) return;
  visit(n, ancestors);
  walk(n.props.children, visit, [...ancestors, n]);
}
function findAll(tree: unknown, pred: (el: El) => boolean): El[] {
  const out: El[] = [];
  walk(tree, el => { if (pred(el)) out.push(el); });
  return out;
}
function one(tree: unknown, pred: (el: El) => boolean): El {
  const found = findAll(tree, pred);
  expect(found).toHaveLength(1);
  return found[0];
}
const nodes = new WeakMap<object, FakeNode>();
function nodeOf(ref: unknown): FakeNode {
  const r = ref as object;
  let n = nodes.get(r);
  if (!n) { n = { focus: jest.fn() }; nodes.set(r, n); }
  return n;
}

/** 컴포넌트를 한 번 렌더(뿌리의 함수 컴포넌트는 풀어서 호스트 요소까지) → ref 붙이기 → effect 실행. */
function render(fiber: Fiber, comp: unknown, props: Record<string, unknown>, opts: { effects?: boolean } = {}): El {
  H.fiber = fiber; H.i = 0; H.effects = [];
  let el: unknown;
  try {
    el = (comp as (p: unknown) => unknown)(props);
    while (isEl(el) && typeof el.type === 'function') el = (el.type as (p: unknown) => unknown)(el.props);
  } finally {
    H.fiber = null;
  }
  const effects = H.effects; H.effects = [];
  const now = new Set<{ current: unknown }>();
  walk(el, e => {
    const r = e.ref as { current: unknown } | null | undefined;
    if (r && typeof r === 'object' && 'current' in r) { now.add(r); r.current = nodeOf(r); }
  });
  for (const r of fiber.refs ?? []) if (!now.has(r)) r.current = null;
  fiber.refs = now;
  if (opts.effects !== false) effects.forEach(f => f());
  return el as El;
}

// ─── 고정값 ─────────────────────────────────────────────────────────────────

function baseSafety(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    dryRun: true, killSwitch: false,
    exitEngineEnabled: true, exitHardStopEnabled: true, exitSwitchSource: 'config', exitSwitchSummary: '',
    orderMaxPct: 0, dailyOrderMaxPct: 10,
    universeEnabled: false, analystEnabled: true,
    postMarketOverseasEnabled: false,
    blockedSymbols: ['000001'], blockedSymbolsOverseas: ['NAS:TEST'],
    volGuardEnabled: false, volGuardWindowMin: 60, volGuardWarnPct: -2, volGuardBlockPct: -4, volGuardPanicPct: -7,
    ...over,
  };
}
const NOTIFY = { autoSubmit: true, pending: false, entry: true, manual: true, universe: true };
const EXCHANGES = { kis: { configured: true, mock: false, overseasEnabled: true } };
const REPORT = { enabled: true, channel: 'telegram', mode: 'rolling', intervalMin: 60, anchorKst: null, lastSentAt: null };
const STRATS = [{ id: 's1', enabled: true, backtestIntervalM: 5, nextBacktestAt: null }];

type PageOpts = { safety?: Record<string, unknown> | null; report?: unknown; strategies?: unknown[]; dirty?: boolean };
// SettingsPage useState 순서(소스 사실 — 다른 설정 시험과 같다): 0 safety · 1 notifySignal · 2 report · 3 exchanges · 4 strategies
// · 5 loading · 6 saveState · 7 saveError · 8 isDirty · 9 hybridMode · 10 hybridSaving — 그다음 11 = 첫 조회 useEffect. T-130 은 훅을 더하지 않았다.
const P = { safety: 0, saveState: 6, saveError: 7, dirty: 8 } as const;
function pageValues(o: PageOpts): unknown[] {
  return [
    o.safety === undefined ? baseSafety() : o.safety, NOTIFY, o.report === undefined ? REPORT : o.report, EXCHANGES,
    o.strategies ?? STRATS, false, 'idle', null, o.dirty ?? false, false, false,
  ];
}
function pageFiber(o: PageOpts = {}): Fiber { return { slots: pageValues(o) }; }
function renderPage(f: Fiber): El {
  const tree = render(f, SettingsPage, {}, { effects: false });   // 첫 조회 effect 는 돌리지 않는다(fetch 없음)
  expect(f.slots).toHaveLength(12);                                // 훅 순서 전제 확인 — 바뀌면 여기서 멈춘다
  return tree;
}
function ssr(o: PageOpts = {}): string {
  H.queue = pageValues(o);
  const html = renderToStaticMarkup(h(SettingsPage));
  expect(H.queue).toHaveLength(0);
  return html;
}
function text(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}
/** 버튼 안에 버튼·입력칸·선택칸·링크가 들어간 곳(중첩 상호작용 — 금지). */
function nestedInteractive(html: string): string[] {
  const out: string[] = [];
  let depth = 0;
  for (const m of html.matchAll(/<(\/?)(button|input|select|a)\b[^>]*>/g)) {
    const closing = m[1] === '/';
    if (m[2] === 'button') {
      if (closing) depth -= 1;
      else { if (depth > 0) out.push(m[0]); depth += 1; }
    } else if (!closing && depth > 0) out.push(m[0]);
  }
  return out;
}

const SWITCH_LABELS = [
  '승인 후 진입 감시 (하이브리드)', LIVE_TRADING_LABEL, '모든거래차단', '자동 청산 엔진', '해외 장마감 후 분석 (미국 시나리오)',
  '변동폭 가드 활성화', '동적 종목 선별 (Universe)', '분석가 (Analyst)',
  '자동 제출 알람', '승인 요청 알람', '진입 감시 발동 알람', '수동 시나리오 등록 알람',
  // (T-143 WP-A) 해외 분석 대상 변경 알림 — 알람 4개 뒤·리포트 앞. 아래 수치 단언은 이 배열 길이를 쓴다
  '해외 분석 대상 변경 알림',
  '리포트 수신 활성화',
];
const SAFETY_SWITCHES = [LIVE_TRADING_LABEL, '모든거래차단', '자동 청산 엔진'];
const VALUE_ROWS = ['1회 주문 최대 (%)', '일일 누적 최대 (%)', '비교 윈도우', '경고 임계치', '차단 임계치', '패닉 임계치', '평가 주기'];

const flush = async () => { for (let i = 0; i < 10; i += 1) await new Promise(r => setImmediate(r)); };
const jsonRes = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
function mockFetch(f: jest.Mock): jest.Mock { (globalThis as unknown as { fetch: unknown }).fetch = f; return f; }
/** 가짜 keydown 이벤트 — `preventDefault` 호출 여부를 본다(jsdom 없음 — 실제 keydown→keypress 순서는 QA 가 브라우저에서 확인). */
type KeyEv = { key: string; repeat: boolean; preventDefault: jest.Mock };
const keyEv = (key: string, repeat = false): KeyEv => ({ key, repeat, preventDefault: jest.fn() });

/** 페이지 트리의 Toggle 요소(행 제목으로) — PostMarketOverseasRow 안의 것은 그 행을 풀어서 찾는다. */
function toggleEl(tree: unknown, label: string): El {
  const direct = findAll(tree, el => typeName(el) === 'Toggle' && el.props.label === label);
  if (direct.length) { expect(direct).toHaveLength(1); return direct[0]; }
  const pmo = one(tree, el => el.type === PostMarketOverseasRow);
  return one((pmo.type as (p: unknown) => unknown)(pmo.props), el => typeName(el) === 'Toggle' && el.props.label === label);
}
/** Toggle 요소를 그려 실제 button 을 얻는다(Toggle 은 훅이 없다). */
function switchButton(toggle: El): El { return (toggle.type as (p: unknown) => El)(toggle.props); }
function valueRowEl(tree: unknown, title: string): El {
  return one(tree, el => ['LimitInput', 'MinutesInput', 'PctInput'].includes(String(typeName(el))) && el.props.title === title);
}

afterEach(() => {
  H.fiber = null;
  H.queue = [];
  jest.restoreAllMocks();
});

// ─── (a) 스위치 ─────────────────────────────────────────────────────────────

describe('(a) 스위치 전부 — button role=switch, 이름 = 행 제목, 키보드로 닿음 (D2-A)', () => {
  test('SSR: 스위치 전부가 <button type="button" role="switch">, aria-label 순서 = 행 제목, div 스위치·tabindex·disabled 속성 없음', () => {
    const html = ssr();
    const tags = html.match(/<[a-z]+ [^>]*role="switch"[^>]*>/g) ?? [];
    expect(tags).toHaveLength(SWITCH_LABELS.length);
    for (const t of tags) {
      expect(t.startsWith('<button type="button" role="switch" aria-checked="')).toBe(true);
      expect(t).not.toMatch(/tabindex|\sdisabled=""/);
    }
    expect(html).not.toContain('<div role="switch"');
    expect(tags.map(t => /aria-label="([^"]+)"/.exec(t)?.[1])).toEqual(SWITCH_LABELS);
    const t = text(html);
    for (const l of SWITCH_LABELS) expect(t).toContain(l);   // 이름이 화면 글자와 같다
  });

  test('스위치 button: 누르는 영역 44×44(-10px 여백으로 행 높이 그대로), 안쪽 그림 44×24·손잡이 20×20 그대로', () => {
    const html = ssr();
    const tags = html.match(/<button type="button" role="switch"[^>]*style="([^"]*)"><span style="([^"]*)"><span style="([^"]*)">/g) ?? [];
    expect(tags).toHaveLength(SWITCH_LABELS.length);
    for (const tag of tags) {
      const [, outer, pic, knob] = /style="([^"]*)"><span style="([^"]*)"><span style="([^"]*)">/.exec(tag)!;
      expect(outer).toContain('width:44px;height:44px;margin:-10px 0');
      expect(outer).toContain('display:inline-flex');
      expect(outer).not.toMatch(/outline:\s*none/);              // 브라우저 기본 포커스 링을 지우지 않는다
      expect(pic).toContain('width:44px;height:24px;border-radius:12px');
      expect(knob).toContain('width:20px;height:20px');
    }
  });

  test.each(SWITCH_LABELS)('%s — click(= Space·Enter 의 기본 동작)이 onChange(!checked), 첫 Enter·Space 는 막지 않고 Enter 반복만 막는다(F2)', (label) => {
    const tree = renderPage(pageFiber());
    const toggle = toggleEl(tree, label);
    const spy = jest.fn();
    for (const checked of [false, true]) {
      const btn = switchButton({ ...toggle, props: { ...toggle.props, checked, onChange: spy, disabled: false } });
      expect(btn.type).toBe('button');
      expect(btn.props.type).toBe('button');
      expect(btn.props.role).toBe('switch');
      expect(btn.props['aria-checked']).toBe(checked);
      expect(btn.props['aria-label']).toBe(label);
      for (const k of ['disabled', 'tabIndex', 'onKeyUp', 'onKeyPress']) expect(btn.props[k]).toBeUndefined();
      // 키 처리기는 하나(keydown)뿐이고 전환을 하지 않는다 — 전환은 onClick 한 경로. 기본 동작 취소는 Enter 반복일 때만.
      expect(typeof btn.props.onKeyDown).toBe('function');
      spy.mockClear();
      const prevented: Record<string, boolean> = {};
      for (const [key, repeat] of [['Enter', false], [' ', false], [' ', true], ['Tab', false], ['Tab', true], ['Enter', true]] as const) {
        const ev = keyEv(key, repeat);
        (btn.props.onKeyDown as (e: KeyEv) => void)(ev);
        prevented[`${key === ' ' ? 'Space' : key}${repeat ? '(반복)' : ''}`] = ev.preventDefault.mock.calls.length > 0;
      }
      expect(prevented).toEqual({ Enter: false, Space: false, 'Space(반복)': false, Tab: false, 'Tab(반복)': false, 'Enter(반복)': true });
      expect(spy).not.toHaveBeenCalled();
      (btn.props.onClick as () => void)();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(!checked);
    }
  });

  test('disabled 스위치: aria-disabled=true · disabled 속성 없음(포커스·읽기 유지) · click 이 onChange 를 부르지 않음', () => {
    const tree = renderPage(pageFiber());
    const spy = jest.fn();
    const btn = switchButton({ ...toggleEl(tree, '모든거래차단'), props: { ...toggleEl(tree, '모든거래차단').props, disabled: true, onChange: spy } });
    expect(btn.props['aria-disabled']).toBe(true);
    expect(btn.props.disabled).toBeUndefined();
    expect((btn.props.style as Record<string, unknown>).cursor).toBe('not-allowed');
    (btn.props.onClick as () => void)();
    (btn.props.onClick as () => void)();
    expect(spy).not.toHaveBeenCalled();
  });

  test('스위치 행 전체 탭 없음 — 어떤 Toggle 의 조상에도 onClick 이 없고, 버튼 안에 버튼·입력칸이 없다', () => {
    const tree = renderPage(pageFiber());
    let seen = 0;
    walk(tree, (el, ancestors) => {
      if (typeName(el) !== 'Toggle') return;
      seen += 1;
      expect(ancestors.filter(a => typeof a.props.onClick === 'function')).toHaveLength(0);
    });
    const pmo = one(tree, el => el.type === PostMarketOverseasRow);
    walk((pmo.type as (p: unknown) => unknown)(pmo.props), (el, ancestors) => {
      if (typeName(el) !== 'Toggle') return;
      seen += 1;
      expect(ancestors.filter(a => typeof a.props.onClick === 'function')).toHaveLength(0);
    });
    expect(seen).toBe(SWITCH_LABELS.length);
    expect(nestedInteractive(ssr())).toEqual([]);
    expect(nestedInteractive(ssr({ dirty: true }))).toEqual([]);
  });

  test('D9-A — 확인 시트 없음: 실거래여부 OFF→ON 클릭은 지금처럼 곧바로 PATCH {dryRun:false} 1회, 대화상자 없음', async () => {
    const fetchMock = mockFetch(jest.fn().mockResolvedValue(jsonRes(200, { ok: true })));
    const page = pageFiber({ safety: baseSafety({ dryRun: true }) });
    const tree = renderPage(page);
    (switchButton(toggleEl(tree, LIVE_TRADING_LABEL)).props.onClick as () => void)();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/settings/safety');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ dryRun: false });
    expect((page.slots[P.safety] as Record<string, unknown>).dryRun).toBe(false);
    expect(ssr()).not.toMatch(/role="dialog"|role="alertdialog"/);
  });
});

// ─── (b) 값 행 ──────────────────────────────────────────────────────────────

describe('(b) 값 행 7개 — 행 전체가 버튼, 입력칸 44px, 저장 방식 그대로 (D1-A)', () => {
  test('SSR: 값 행 버튼 7개(제목·현재 값·바꾸기 이름), 높이 56px 이상 선언, 보이는 글자·색·「›」 그대로', () => {
    const html = ssr();
    const rows = [...html.matchAll(/<button type="button" aria-label="([^"]+), 현재 ([^"]+), 바꾸기" style="([^"]*)">(.*?)<\/button>/g)];
    expect(rows.map(r => r[1])).toEqual(VALUE_ROWS);
    expect(rows.map(r => r[2])).toEqual(['미적용', '10%', '60분', '-2%', '-4%', '-7%', '5분']);
    for (const r of rows) {
      expect(r[3]).toContain('display:flex');
      expect(r[3]).toContain('width:100%;min-height:56px');
      expect(r[3]).toContain('text-align:left');
    }
    const t = text(html);
    expect(t).toContain('1회 주문 최대 (%) 포트폴리오 평가총액 × pct%. 0 = 무제한 미적용 ›');
    expect(t).toContain('일일 누적 최대 (%) 포트폴리오 평가총액 × pct%. 오늘 0시~자정 누적 상한. 0 = 무제한 10% ›');
    expect(t).toContain('비교 윈도우 이 시간 내 변동률 기준 (분) 60분 ›');
    expect(t).toContain('경고 임계치 로그만 기록 (주문 차단 없음) -2% ›');
    expect(t).toContain('차단 임계치 신규 주문 차단 + Slack 경고 -4% ›');
    expect(t).toContain('패닉 임계치 패닉 청산 권고 + Slack 긴급 알림 -7% ›');
    expect(t).toContain('평가 주기 모든 전략에 동일 적용 5분 ›');
    // 값 글자 색: 한도·분 = 강조색, 임계치 = 하락색 (예전 그대로)
    const colors = rows.map(r => /<span aria-hidden="true" style="[^"]*color:([^;"]+)/.exec(r[4])?.[1]);
    expect(colors).toEqual(['var(--accent)', 'var(--accent)', 'var(--accent)', 'var(--down)', 'var(--down)', 'var(--down)', 'var(--accent)']);
  });

  test('행 모양은 예전 행 그대로 — 여백 14px 16px(평가 주기 12px 16px), 패닉만 아래 줄 없음, 가드 OFF 면 4행 흐림(.4)·ON 이면 흐림 없음', () => {
    const styles = (html: string) => Object.fromEntries(
      [...html.matchAll(/<button type="button" aria-label="([^"]+), 현재 [^"]+, 바꾸기" style="([^"]*)">/g)].map(m => [m[1], m[2]]),
    );
    const off = styles(ssr({ safety: baseSafety({ volGuardEnabled: false }) }));
    for (const k of VALUE_ROWS) {
      expect(off[k]).toContain(k === '평가 주기' ? 'padding:12px 16px' : 'padding:14px 16px');
      if (k === '패닉 임계치') expect(off[k]).not.toContain('border-bottom');
      else expect(off[k]).toContain('border-bottom:1px solid var(--border)');
      const dimmed = ['비교 윈도우', '경고 임계치', '차단 임계치', '패닉 임계치'].includes(k);
      if (dimmed) expect(off[k]).toContain('opacity:0.4'); else expect(off[k]).not.toContain('opacity');
    }
    const on = styles(ssr({ safety: baseSafety({ volGuardEnabled: true }) }));
    for (const k of VALUE_ROWS) expect(on[k]).not.toContain('opacity');
    // 전략이 없으면 평가 주기 행이 없다(예전 그대로)
    expect(Object.keys(styles(ssr({ strategies: [] })))).toEqual(VALUE_ROWS.filter(k => k !== '평가 주기'));
  });

  test('행 클릭 → 같은 자리가 div 행 + 입력칸(44px·aria-label=제목·autoFocus) → Enter 확정 → 상태 반영 + 저장 바 「변경 사항 있음 [저장]」 → 포커스 행으로', () => {
    const page = pageFiber({ safety: baseSafety({ orderMaxPct: 0 }) });
    let tree = renderPage(page);
    expect(findAll(tree, el => el.type === 'span' && el.props.children === '변경 사항 있음')).toHaveLength(0);   // 저장 바 없음
    const om = valueRowEl(tree, '1회 주문 최대 (%)');
    const row: Fiber = { slots: [] };
    let ui = render(row, om.type, om.props);
    expect(ui.type).toBe('button');
    expect(ui.props['aria-label']).toBe('1회 주문 최대 (%), 현재 미적용, 바꾸기');
    const rowNode = nodeOf(ui.ref);

    (ui.props.onClick as () => void)();
    ui = render(row, om.type, om.props);
    expect(ui.type).toBe('div');
    expect(findAll(ui, el => el.type === 'button')).toHaveLength(0);
    let input = one(ui, el => el.type === 'input');
    expect(input.props.autoFocus).toBe(true);
    expect(input.props['aria-label']).toBe('1회 주문 최대 (%)');
    expect(input.props.value).toBe('0');
    expect(input.props.inputMode).toBe('decimal');
    expect(input.props.style).toMatchObject({ minHeight: 44, width: 96 });
    expect((ui.props.style as Record<string, unknown>).minHeight).toBe(56);
    expect(rowNode.focus).not.toHaveBeenCalled();

    (input.props.onChange as (e: unknown) => void)({ target: { value: '7' } });
    ui = render(row, om.type, om.props);
    input = one(ui, el => el.type === 'input');
    expect(input.props.value).toBe('7');
    const enter = keyEv('Enter');
    (input.props.onKeyDown as (e: KeyEv) => void)(enter);
    expect(enter.preventDefault).toHaveBeenCalledTimes(1);   // F1 — keypress 가 행 버튼으로 새지 않게

    // 저장은 하지 않는다 — 상태(safety)와 isDirty 만 바뀐다
    expect((page.slots[P.safety] as Record<string, unknown>).orderMaxPct).toBe(7);
    expect(page.slots[P.dirty]).toBe(true);
    ui = render(row, om.type, om.props);
    expect(ui.type).toBe('button');
    expect(rowNode.focus).toHaveBeenCalledTimes(1);
    expect(rowNode.focus).toHaveBeenCalledWith({ preventScroll: true });

    tree = renderPage(page);
    one(tree, el => el.type === 'span' && el.props.children === '변경 사항 있음');
    const save = one(tree, el => el.type === 'button' && el.props.children === '저장');
    expect((save.props.style as Record<string, unknown>).minHeight).toBe(44);
    expect(valueRowEl(tree, '1회 주문 최대 (%)').props.value).toBe(7);
  });

  /** 값 행 하나를 열고 글자를 넣은 뒤 `finish` 로 닫는다 → onChange 호출·행 포커스 호출을 돌려준다. */
  function editRow(title: string, typed: string, finish: (input: El) => void): { calls: unknown[][]; spy: jest.Mock; focus: jest.Mock; lastInput: El } {
    const tree = renderPage(pageFiber({ safety: baseSafety({ volGuardEnabled: true }) }));
    const el = valueRowEl(tree, title);
    const spy = jest.fn();
    const props = { ...el.props, onChange: spy };
    const row: Fiber = { slots: [] };
    let ui = render(row, el.type, props);
    const focus = nodeOf(ui.ref).focus;
    (ui.props.onClick as () => void)();
    ui = render(row, el.type, props);
    (one(ui, e => e.type === 'input').props.onChange as (e: unknown) => void)({ target: { value: typed } });
    ui = render(row, el.type, props);
    const lastInput = one(ui, e => e.type === 'input');
    finish(lastInput);
    ui = render(row, el.type, props);
    expect(ui.type).toBe('button');   // 어느 쪽으로 닫아도 행 버튼으로 돌아온다
    return { calls: spy.mock.calls, spy, focus, lastInput };
  }

  test('Esc = 취소(값 그대로) + 포커스 행으로 · 그 뒤 늦게 오는 blur 도 확정하지 않는다', () => {
    const r = editRow('패닉 임계치', '-3', inp => (inp.props.onKeyDown as (e: unknown) => void)(keyEv('Escape')));
    expect(r.calls).toEqual([]);
    expect(r.focus).toHaveBeenCalledWith({ preventScroll: true });
    (r.lastInput.props.onBlur as (e: unknown) => void)({ relatedTarget: null });   // 입력칸이 빠질 때 브라우저가 보내는 blur
    expect(r.calls).toEqual([]);
  });

  test('Enter 확정 뒤 늦게 오는 blur 가 두 번 확정하지 않는다', () => {
    const r = editRow('패닉 임계치', '-3', inp => (inp.props.onKeyDown as (e: unknown) => void)(keyEv('Enter')));
    expect(r.calls).toEqual([[-3]]);
    (r.lastInput.props.onBlur as (e: unknown) => void)({ relatedTarget: null });
    expect(r.calls).toEqual([[-3]]);
  });

  test('F1 — Enter keydown 은 확정(onChange)보다 먼저 기본 동작을 취소한다 · 포커스는 그대로 행 버튼으로(승인 동작)', () => {
    // 취소하지 않으면: close → 렌더·effect 로 포커스가 행 버튼에 간 뒤, 아직 안 나간 Enter keypress 가 그 버튼의 click 이 되어
    // 편집 칸이 곧바로 다시 열린다(Reviewer 가 Chromium + React 18.3.1 createRoot 에서 재현). 실제 키 순서는 QA 가 브라우저에서 본다.
    let ev: KeyEv | null = null;
    const r = editRow('패닉 임계치', '-3', inp => { ev = keyEv('Enter'); (inp.props.onKeyDown as (e: KeyEv) => void)(ev); });
    const enter = ev as unknown as KeyEv;
    expect(enter.preventDefault).toHaveBeenCalledTimes(1);
    expect(enter.preventDefault.mock.invocationCallOrder[0]).toBeLessThan(r.spy.mock.invocationCallOrder[0]);
    expect(r.calls).toEqual([[-3]]);
    expect(r.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  test('F1 — 입력·이동 키(숫자·`-`·`.`·Backspace·방향키·Tab)와 Esc 는 기본 동작을 취소하지 않는다(입력·Tab 이동 그대로)', () => {
    const r = editRow('패닉 임계치', '-3', inp => {
      const down = inp.props.onKeyDown as (e: KeyEv) => void;
      for (const k of ['1', '-', '.', 'Backspace', 'ArrowLeft', 'Tab']) {
        const ev = keyEv(k);
        down(ev);
        expect(ev.preventDefault).not.toHaveBeenCalled();
      }
      const esc = keyEv('Escape');
      down(esc);
      expect(esc.preventDefault).not.toHaveBeenCalled();
    });
    expect(r.calls).toEqual([]);   // Tab keydown 자체는 확정하지 않는다 — Tab 은 포커스 이동 → blur 확정(아래 바깥 누르기 시험)
  });

  test('바깥 누르기(blur) = 확정 — 포커스가 다른 컨트롤로 갔으면 빼앗지 않고, 아무 데도 안 갔으면 행으로 돌린다', () => {
    const toOther = editRow('경고 임계치', '-5', inp => (inp.props.onBlur as (e: unknown) => void)({ relatedTarget: { tagName: 'INPUT' } }));
    expect(toOther.calls).toEqual([[-5]]);
    expect(toOther.focus).not.toHaveBeenCalled();
    const toNothing = editRow('경고 임계치', '-6', inp => (inp.props.onBlur as (e: unknown) => void)({ relatedTarget: null }));
    expect(toNothing.calls).toEqual([[-6]]);
    expect(toNothing.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  test.each([
    // [행, 입력, 받아들인 값(null = 거부 — 값 그대로)]  — 예전 검증 범위 그대로
    ['패닉 임계치', '-3', -3], ['패닉 임계치', '0', 0], ['패닉 임계치', '-100', -100],
    ['패닉 임계치', '3', null], ['패닉 임계치', '-101', null], ['패닉 임계치', 'abc', null],
    ['비교 윈도우', '1', 1], ['비교 윈도우', '10080', 10080], ['비교 윈도우', '0', null], ['비교 윈도우', '10081', null], ['비교 윈도우', 'x', null],
    ['평가 주기', '15', 15], ['평가 주기', '0', null],
    ['1회 주문 최대 (%)', '1,000', 1000], ['1회 주문 최대 (%)', '0', 0], ['1회 주문 최대 (%)', '-1', null], ['1회 주문 최대 (%)', 'x', null],
  ] as const)('%s 에 %p 입력 + Enter → %p', (title, typed, accepted) => {
    const ev = keyEv('Enter');
    const r = editRow(title, typed, inp => (inp.props.onKeyDown as (e: KeyEv) => void)(ev));
    expect(r.calls).toEqual(accepted === null ? [] : [[accepted]]);
    expect(ev.preventDefault).toHaveBeenCalledTimes(1);   // 값을 거부해도 편집 칸은 닫히므로 keypress 를 똑같이 막는다
  });

  test('inputMode — 한도·분 행은 decimal, 임계치(음수) 행은 지정하지 않는다(안드로이드 숫자 자판에 `-` 가 없을 수 있음)', () => {
    const modes: Record<string, unknown> = {};
    for (const title of VALUE_ROWS) {
      editRow(title, '1', inp => { modes[title] = inp.props.inputMode; (inp.props.onKeyDown as (e: unknown) => void)(keyEv('Escape')); });
    }
    expect(modes).toEqual({
      '1회 주문 최대 (%)': 'decimal', '일일 누적 최대 (%)': 'decimal', '비교 윈도우': 'decimal',
      '경고 임계치': undefined, '차단 임계치': undefined, '패닉 임계치': undefined, '평가 주기': 'decimal',
    });
  });

  test('평가 주기 확정은 예전처럼 모든 전략에 같은 값 + isDirty (저장은 [저장] 에서)', () => {
    const page = pageFiber({ strategies: [{ ...STRATS[0] }, { id: 's2', enabled: false, backtestIntervalM: 5, nextBacktestAt: null }] });
    const tree = renderPage(page);
    const fetchMock = mockFetch(jest.fn());
    (valueRowEl(tree, '평가 주기').props.onChange as (v: number) => void)(30);
    expect((page.slots[4] as Array<{ backtestIntervalM: number }>).map(s => s.backtestIntervalM)).toEqual([30, 30]);
    expect(page.slots[P.dirty]).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─── (c) 잠김 ───────────────────────────────────────────────────────────────

describe('(c) 안전 값을 못 읽음 → 세 안전 스위치 잠김 유지', () => {
  test('SSR safety=null: aria-disabled 는 실거래여부·모든거래차단·자동 청산 엔진 3개만, 나머지 11개는 잠기지 않는다', () => {
    const tags = ssr({ safety: null }).match(/<button type="button" role="switch"[^>]*>/g) ?? [];
    expect(tags).toHaveLength(SWITCH_LABELS.length);
    const locked = tags.filter(t => t.includes('aria-disabled="true"')).map(t => /aria-label="([^"]+)"/.exec(t)?.[1]);
    expect(locked).toEqual(SAFETY_SWITCHES);
  });

  test.each(SAFETY_SWITCHES)('safety=null → %s: button click 도, 행의 onChange 직접 호출도 PATCH·상태 변경 없음(이중 확인)', async (label) => {
    const fetchMock = mockFetch(jest.fn().mockResolvedValue(jsonRes(200, { ok: true })));
    const page = pageFiber({ safety: null });
    const tree = renderPage(page);
    const toggle = toggleEl(tree, label);
    expect(toggle.props.disabled).toBe(true);
    const btn = switchButton(toggle);
    expect(btn.props['aria-disabled']).toBe(true);
    (btn.props.onClick as () => void)();
    (toggle.props.onChange as (v: boolean) => void)(true);    // 잠금을 지나쳐 들어와도 `if (!safety) return`
    (toggle.props.onChange as (v: boolean) => void)(false);
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(page.slots[P.safety]).toBeNull();
    expect(page.slots[P.saveState]).toBe('idle');
  });
});

// ─── (d) 저장 실패 → 되돌림 ──────────────────────────────────────────────────

describe('(d) 안전 스위치 저장 실패 → 서버 값으로 되돌림 (새 button 의 click 경로)', () => {
  test.each([
    // [행 제목, 시작 safety, PATCH 본문, 되돌린 뒤 키·값]
    [LIVE_TRADING_LABEL, { dryRun: true }, { dryRun: false }, ['dryRun', true]],
    ['모든거래차단', { killSwitch: true }, { killSwitch: false }, ['killSwitch', true]],
    ['자동 청산 엔진', { exitEngineEnabled: true }, { exitEngineEnabled: false }, ['exitEngineEnabled', true]],
  ] as const)('%s: PATCH 거부(503) → 재조회 값으로 되돌림, 오류 문구 그대로', async (label, start, body, [key, back]) => {
    const fetchMock = mockFetch(jest.fn()
      .mockResolvedValueOnce(jsonRes(503, { ok: false, error: '일시 오류' }))
      .mockResolvedValueOnce(jsonRes(200, { ok: true, safety: baseSafety(start) })));
    const page = pageFiber({ safety: baseSafety({ ...start, orderMaxPct: 3 }) });   // 3 = 다른 미저장 편집이라고 가정
    const tree = renderPage(page);
    (switchButton(toggleEl(tree, label)).props.onClick as () => void)();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [u1, i1] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(u1).toBe('/api/settings/safety');
    expect(i1.method).toBe('PATCH');
    expect(JSON.parse(String(i1.body))).toEqual(body);
    expect((fetchMock.mock.calls[1] as [string, RequestInit])[1].method ?? 'GET').toBe('GET');
    const final = page.slots[P.safety] as Record<string, unknown>;
    expect(final[key]).toBe(back);
    expect(final.orderMaxPct).toBe(3);                       // 다른 미저장 편집은 그대로
    expect(page.slots[P.saveState]).toBe('error');
    const msg = String(page.slots[P.saveError]);
    expect(msg).toContain(`${label} 전환이 저장되지 않았습니다`);
    expect(msg).toContain(`${label} 값은 서버의 실제 상태로 되돌렸습니다 (다른 미저장 편집은 그대로 둡니다).`);
  });

  test('재조회까지 실패하면 직전 값으로 되돌린다(예전 그대로)', async () => {
    mockFetch(jest.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const page = pageFiber({ safety: baseSafety({ killSwitch: false }) });
    const tree = renderPage(page);
    (switchButton(toggleEl(tree, '모든거래차단')).props.onClick as () => void)();
    await flush();
    expect((page.slots[P.safety] as Record<string, unknown>).killSwitch).toBe(false);
    expect(page.slots[P.saveState]).toBe('error');
    expect(String(page.slots[P.saveError])).toContain('모든거래차단 값을 직전 값으로 되돌렸습니다');
  });
});

// ─── 44px 선언 (인라인 스타일) ────────────────────────────────────────────────

describe('44px 이상 선언 — 선택칸·발송 방식·검색칸·칩 ×·[저장] (실측은 QA)', () => {
  test('정기 거래 리포트: 선택칸 2개(주기 방식) min-height 44·padding 0 10px·aria-label, 그 행 여백 6px 16px', () => {
    const html = ssr();
    for (const name of ['수신 채널', '발송 간격']) {
      const tag = new RegExp(`<select aria-label="${name}"[^>]*style="([^"]*)"`).exec(html);
      expect(tag).not.toBeNull();
      expect(tag![1]).toContain('min-height:44px;padding:0 10px');
    }
    expect(html.match(/<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 16px[^"]*"><div style="font-size:14px">(수신 채널|발송 방식|발송 간격)<\/div>/g)).toHaveLength(3);
    // 고정 방식이면 발송 간격 선택칸이 없다(예전 그대로)
    const fixed = ssr({ report: { ...REPORT, mode: 'fixed', anchorKst: '08:00' } });
    expect(fixed).toContain('<select aria-label="수신 채널"');
    expect(fixed).not.toContain('<select aria-label="발송 간격"');
  });

  test('발송 방식 버튼 2개: aria-pressed, min-height 44·min-width 52, 선택 글자색 #000', () => {
    const html = ssr();
    const btns = [...html.matchAll(/<button aria-pressed="(true|false)" style="([^"]*)">(주기|고정)<\/button>/g)];
    expect(btns.map(b => [b[3], b[1]])).toEqual([['주기', 'true'], ['고정', 'false']]);
    for (const b of btns) expect(b[2]).toContain('min-height:44px;min-width:52px');
    expect(btns[0][2]).toContain('color:#000');
    expect(btns[1][2]).toContain('color:var(--text)');
    expect(html).toContain('<div role="group" aria-label="발송 방식"');
  });

  test('거래 차단 종목: 검색칸 2개 min-height 44·font 14·aria-label, 칩 높이 36·× 44×44·aria-label 「{종목} 빼기」', () => {
    const html = ssr();
    for (const name of ['국내 거래 차단 종목 검색', '해외 거래 차단 종목 검색']) {
      const tag = new RegExp(`<input aria-label="${name}"[^>]*style="([^"]*)"`).exec(html);
      expect(tag).not.toBeNull();
      expect(tag![1]).toContain('width:100%;min-height:44px;font-size:14px');
    }
    const xs = [...html.matchAll(/<button aria-label="([^"]+) 빼기" style="([^"]*)">×<\/button>/g)];
    expect(xs.map(x => x[1])).toEqual(['000001', 'TEST']);
    for (const x of xs) expect(x[2]).toContain('width:44px;height:44px;margin:-4px 0;display:inline-flex');
    expect(html.match(/min-height:36px;padding:0 0 0 10px/g)).toHaveLength(2);
  });

  test('저장 바 [저장] min-height 44 (값을 고친 뒤에만 보임 — 예전 그대로)', () => {
    expect(ssr()).not.toContain('변경 사항 있음');
    const html = ssr({ dirty: true });
    expect(text(html)).toContain('변경 사항 있음 저장');
    expect(html).toMatch(/<button style="flex-shrink:0;min-height:44px;[^"]*">저장<\/button>/);
  });

  test('승인 데모 v1 문구 2줄(5번·10a) — 모든거래차단 OFF 부제, 자동 청산 엔진 ON 부제', () => {
    const t = text(ssr({ safety: baseSafety({ killSwitch: false, exitEngineEnabled: true, exitHardStopEnabled: true }) }));
    expect(t).toContain('모든거래차단 OFF — 이 스위치로는 막지 않음');
    expect(t).toContain('ON — 손실한도 손절·장마감 전 손절·트레일링 스탑·목표 익절 자동 매도 동작 중');
    expect(t).not.toMatch(/OFF — 차단 안 함|트레일링·익절/);
  });
});
