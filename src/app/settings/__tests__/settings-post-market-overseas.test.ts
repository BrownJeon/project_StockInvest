/**
 * T-101 설정 화면 — 안전장치 (공통) 카드의 '해외 장마감 후 분석' 행.
 *
 * ── 어떻게 시험하는가(소스 변경 없이) ─────────────────────────────────────────────
 * jsdom·@testing-library 가 없다(설치는 범위 밖). 그래서 두 방식을 쓴다.
 *  1) 정적 렌더: `react` 의 `useState` 만 감싸 SettingsPage 가 **맨 앞에서 부르는 useState 6개**
 *     (safety → notifySignal → report → exchanges → strategies → loading) 초기값을 조회 뒤 값으로 바꿔 그린다.
 *  2) 직접 호출: 같은 감싸기로 훅을 렌더 밖에서도 돌게 하고(useEffect 무시·useCallback 그대로·setter 기록),
 *     `SettingsPage()` 가 돌려준 요소 트리에서 이 행의 `onToggle`·저장 버튼 `onClick` 을 찾아 직접 부른다.
 *     그러면 토글 → PATCH 호출, 실패 → 서버 값으로 되돌림, 저장 바 일괄 저장 본문을 실제 코드로 확인할 수 있다.
 * useState 순서가 바뀌면 이 시험은 '불러오는 중'·개수 확인에서 실패한다(조용히 통과하지 않는다).
 */
import * as ReactNS from 'react';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const hookMode: { direct: boolean; queue: unknown[]; setters: jest.Mock[]; stateCalls: number } = {
  direct: false, queue: [], setters: [], stateCalls: 0,
};

jest.mock('react', () => {
  const actual = jest.requireActual('react');
  return {
    ...actual,
    useState: (init: unknown) => {
      if (!hookMode.direct) {
        return hookMode.queue.length > 0 ? [hookMode.queue.shift(), () => {}] : actual.useState(init);
      }
      const value = hookMode.queue.length > 0 ? hookMode.queue.shift() : (typeof init === 'function' ? (init as () => unknown)() : init);
      const setter = jest.fn();
      hookMode.setters.push(setter);
      hookMode.stateCalls += 1;
      return [value, setter];
    },
    useEffect: (...args: unknown[]) => (hookMode.direct ? undefined : actual.useEffect(...args)),
    useCallback: (fn: unknown, deps: unknown) => (hookMode.direct ? fn : actual.useCallback(fn, deps)),
    useRef: (init: unknown) => (hookMode.direct ? { current: init } : actual.useRef(init)),
  };
});
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }), usePathname: () => '/settings' }));

(globalThis as unknown as { React: typeof ReactNS }).React = ReactNS;

import { SettingsPage, PostMarketOverseasRow, revertSafetyState } from '@/app/settings/SettingsPage';

// ─── 공통 ─────────────────────────────────────────────────────────────────────

const LABEL = '해외 장마감 후 분석 (미국 시나리오)';
/** Reviewer F-3 정정 문구(Leader 채택) — 실제 실행 조건(미국 정규장이 열린 날의 다음 날 아침만, 휴장일 다음날 건너뜀)과 같게. 상태별 문장. */
const DESC_BODY = '미국 정규장이 열린 날의 다음 날 아침 08:00(KST)에 미국 종목 시나리오 카드를 만듭니다(미국 휴장일 다음날은 건너뜀). '
  + '주문은 하지 않으며 승인·킬스위치·검증 관문이 그대로 적용됩니다.';
const DESC_OFF = `OFF — 켜면 ${DESC_BODY}`;
const DESC_ON = `ON — ${DESC_BODY}`;

function baseSafety(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    dryRun: false, killSwitch: true,
    exitEngineEnabled: false, exitHardStopEnabled: true, exitSwitchSource: 'config', exitSwitchSummary: '',
    orderMaxPct: 5, dailyOrderMaxPct: 10,
    universeEnabled: false, analystEnabled: true,
    postMarketOverseasEnabled: false,
    blockedSymbols: [], blockedSymbolsOverseas: [],
    volGuardEnabled: false, volGuardWindowMin: 60, volGuardWarnPct: -2, volGuardBlockPct: -4, volGuardPanicPct: -7,
    ...over,
  };
}
const NOTIFY = { autoSubmit: true, pending: true, entry: true, manual: true };
const EXCHANGES = { kis: { configured: true, mock: false, overseasEnabled: true } };

function text(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

type El = { type: unknown; props: Record<string, unknown> & { children?: unknown } };
function walk(node: unknown, visit: (el: El) => void): void {
  if (Array.isArray(node)) { node.forEach(n => walk(n, visit)); return; }
  if (!node || typeof node !== 'object' || !('props' in (node as object))) return;
  const el = node as El;
  visit(el);
  walk(el.props.children, visit);
}
function findAll(tree: unknown, pred: (el: El) => boolean): El[] {
  const out: El[] = [];
  walk(tree, el => { if (pred(el)) out.push(el); });
  return out;
}
const flush = async () => { for (let i = 0; i < 5; i += 1) await new Promise(r => setImmediate(r)); };

// SettingsPage useState 순서 (소스 사실): 0 safety · 1 notifySignal · 2 report · 3 exchanges · 4 strategies · 5 loading
// · 6 saveState · 7 saveError · 8 isDirty · 9 hybridMode · 10 hybridSaving
const S_SAFETY = 0, S_SAVE_STATE = 6, S_SAVE_ERROR = 7, S_DIRTY = 8;
const STATE_COUNT = 11;

function renderPage(safety: Record<string, unknown>): string {
  hookMode.direct = false;
  hookMode.queue = [safety, NOTIFY, null, EXCHANGES, [], false];
  const html = renderToStaticMarkup(h(SettingsPage));
  expect(hookMode.queue).toHaveLength(0);
  return html;
}

function callPage(safety: Record<string, unknown>, isDirty = false): unknown {
  hookMode.direct = true;
  hookMode.setters = [];
  hookMode.stateCalls = 0;
  hookMode.queue = [safety, NOTIFY, null, EXCHANGES, [], false, 'idle', null, isDirty, false, false];
  const tree = SettingsPage();
  expect(hookMode.queue).toHaveLength(0);
  expect(hookMode.stateCalls).toBe(STATE_COUNT);   // useState 순서 전제 확인
  return tree;
}

/** setter 에 넘어온 값(값 또는 updater 함수)을 차례로 적용한 최종 상태. */
function applySetter(setter: jest.Mock, start: unknown): unknown {
  return setter.mock.calls.reduce((acc: unknown, [arg]) => (typeof arg === 'function' ? (arg as (p: unknown) => unknown)(acc) : arg), start);
}

const jsonRes = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

afterEach(() => {
  jest.useRealTimers();
  hookMode.direct = false;
  hookMode.queue = [];
  jest.restoreAllMocks();
});

// ─── 1) 행 단독 렌더 ──────────────────────────────────────────────────────────

describe('PostMarketOverseasRow', () => {
  test('OFF — 라벨·OFF·설명·스위치 aria-checked=false', () => {
    const html = renderToStaticMarkup(h(PostMarketOverseasRow, { enabled: false, onToggle: () => {} }));
    const t = text(html);
    expect(t).toContain(LABEL);
    expect(t).toContain(DESC_OFF);
    expect(t).toContain('켜면');
    expect(t).toContain('다음 날 아침 08:00(KST)');
    expect(t).toContain('주문은 하지 않으며');
    expect(t).not.toContain('매일 08:00');   // 옛 과장 문구(매일)가 남지 않는다
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="false"');
  });

  test('ON — ON 표시·aria-checked=true', () => {
    const html = renderToStaticMarkup(h(PostMarketOverseasRow, { enabled: true, onToggle: () => {} }));
    const t = text(html);
    expect(t).toContain(DESC_ON);
    expect(t).not.toContain('켜면');           // ON 상태에는 '켜면' 이 없다
    expect(t).toContain('다음 날 아침 08:00(KST)');
    expect(t).toContain('주문은 하지 않으며');
    expect(t).not.toContain('매일 08:00');
    expect(html).toContain('aria-checked="true"');
  });

  test('스위치를 누르면 반대 값으로 onToggle 을 부른다', () => {
    for (const enabled of [false, true]) {
      const onToggle = jest.fn();
      const tree = PostMarketOverseasRow({ enabled, onToggle });
      // Toggle 요소(checked·onChange 를 받는 컴포넌트)를 찾아 실제 Toggle 을 그려 onClick 까지 따라간다
      const [toggle] = findAll(tree, el => 'checked' in el.props && typeof el.props.onChange === 'function');
      expect(toggle.props.checked).toBe(enabled);
      const rendered = (toggle.type as (p: unknown) => El)(toggle.props);
      (rendered.props.onClick as () => void)();
      expect(onToggle).toHaveBeenCalledWith(!enabled);
    }
  });
});

// ─── 2) 페이지에 배치된 모습 ────────────────────────────────────────────────

describe('SettingsPage 배치', () => {
  test('안전장치 (공통) 카드 안 — 자동 청산 엔진 뒤, 1회 주문 최대 앞, 한 번만', () => {
    const t = text(renderPage(baseSafety()));
    const header = t.indexOf('안전장치 (공통)');
    const exit = t.indexOf('자동 청산 엔진', header);
    const row = t.indexOf(LABEL);
    const orderMax = t.indexOf('1회 주문 최대');
    const guard = t.indexOf('거래 보호');
    expect(header).toBeGreaterThan(-1);
    expect(exit).toBeGreaterThan(header);
    expect(row).toBeGreaterThan(exit);
    expect(orderMax).toBeGreaterThan(row);
    expect(guard).toBeGreaterThan(orderMax);
    expect(t.split(LABEL)).toHaveLength(2);
  });

  test.each([[true, 'ON'], [false, 'OFF']])('GET 값 %p → 행이 %s 로 표시', (v, onOff) => {
    const t = text(renderPage(baseSafety({ postMarketOverseasEnabled: v })));
    const rowText = t.slice(t.indexOf(LABEL), t.indexOf('1회 주문 최대'));
    expect(rowText).toContain(`${onOff} —`);
    expect(rowText.trim().endsWith(onOff)).toBe(true);
  });

  test('값이 없으면(옛 서버 응답) OFF 로 그린다', () => {
    const s = baseSafety();
    delete s.postMarketOverseasEnabled;
    const t = text(renderPage(s));
    expect(t.slice(t.indexOf(LABEL), t.indexOf('1회 주문 최대'))).toContain('OFF —');
  });
});

// ─── 3) 저장 동작 (실제 SettingsPage 코드 경로) ───────────────────────────────

function rowOf(tree: unknown): El {
  const rows = findAll(tree, el => el.type === PostMarketOverseasRow);
  expect(rows).toHaveLength(1);
  return rows[0];
}

describe('토글 저장 — 같은 카드의 KILL_SWITCH·자동 청산 토글과 같은 autoSave 경로', () => {
  test('켜기 → 화면 즉시 ON, PATCH 본문은 이 필드 하나', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonRes(200, { ok: true }));
    (global as unknown as { fetch: unknown }).fetch = fetchMock;
    const start = baseSafety();
    const tree = callPage(start);
    expect(rowOf(tree).props.enabled).toBe(false);

    (rowOf(tree).props.onToggle as (v: boolean) => void)(true);
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/settings/safety');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ postMarketOverseasEnabled: true });
    const after = applySetter(hookMode.setters[S_SAFETY], start) as Record<string, unknown>;
    expect(after.postMarketOverseasEnabled).toBe(true);
    expect(hookMode.setters[S_SAVE_STATE]).not.toHaveBeenCalledWith('error');
  });

  test('끄기 → PATCH 본문 {postMarketOverseasEnabled:false}', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonRes(200, { ok: true }));
    (global as unknown as { fetch: unknown }).fetch = fetchMock;
    const tree = callPage(baseSafety({ postMarketOverseasEnabled: true }));
    (rowOf(tree).props.onToggle as (v: boolean) => void)(false);
    await flush();
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({ postMarketOverseasEnabled: false });
  });

  test('저장 거부 → 서버 재조회 값으로 되돌리고, 다른 미저장 편집은 보존, 오류 표시', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(jsonRes(400, { ok: false, error: '잘못된 설정 값' }))                       // PATCH
      .mockResolvedValueOnce(jsonRes(200, { ok: true, safety: baseSafety({ postMarketOverseasEnabled: false }) })); // 재조회
    (global as unknown as { fetch: unknown }).fetch = fetchMock;
    const start = baseSafety({ orderMaxPct: 7 });   // 7 = 사용자의 미저장 편집이라고 가정(서버는 5)
    const tree = callPage(start);

    (rowOf(tree).props.onToggle as (v: boolean) => void)(true);
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const final = applySetter(hookMode.setters[S_SAFETY], start) as Record<string, unknown>;
    expect(final.postMarketOverseasEnabled).toBe(false);   // 서버 값
    expect(final.orderMaxPct).toBe(7);                      // 남의 편집은 그대로
    expect(hookMode.setters[S_SAVE_STATE]).toHaveBeenCalledWith('error');
    const msg = String(applySetter(hookMode.setters[S_SAVE_ERROR], null));
    expect(msg).toContain('해외 장마감 후 분석 전환이 저장되지 않았습니다');
    expect(msg).toContain('서버의 실제 상태로 되돌렸습니다');
  });

  test('네트워크 오류 + 재조회 실패 → 직전 값으로 되돌림', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('offline'));
    (global as unknown as { fetch: unknown }).fetch = fetchMock;
    const start = baseSafety({ postMarketOverseasEnabled: true });
    const tree = callPage(start);

    (rowOf(tree).props.onToggle as (v: boolean) => void)(false);
    await flush();

    const final = applySetter(hookMode.setters[S_SAFETY], start) as Record<string, unknown>;
    expect(final.postMarketOverseasEnabled).toBe(true);
    expect(String(applySetter(hookMode.setters[S_SAVE_ERROR], null))).toContain('직전 값으로 되돌렸습니다');
  });

  test('되돌림 헬퍼는 이 키만 되돌린다 (KILL_SWITCH 등과 같은 규칙)', () => {
    const current = baseSafety({ postMarketOverseasEnabled: true, killSwitch: false }) as never;
    const out = revertSafetyState(current, { postMarketOverseasEnabled: false } as never, null) as unknown as Record<string, unknown>;
    expect(out.postMarketOverseasEnabled).toBe(false);
    expect(out.killSwitch).toBe(false);
  });
});

describe('저장 바 일괄 저장은 이 스위치를 보내지 않는다 (자기 토글로만 저장)', () => {
  test('다른 필드는 그대로 보내고 postMarketOverseasEnabled 만 빠진다', async () => {
    // 성공 시 handleSave 가 거는 2초 '저장됨' 해제 타이머가 워커에 남지 않게 가짜 타이머로 돌린다
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    const fetchMock = jest.fn().mockResolvedValue(jsonRes(200, { ok: true }));
    (global as unknown as { fetch: unknown }).fetch = fetchMock;
    const tree = callPage(baseSafety({ postMarketOverseasEnabled: true }), true);

    const saveButtons = findAll(tree, el => el.type === 'button' && typeof el.props.onClick === 'function'
      && text(renderToStaticMarkup(h('span', null, el.props.children as never))).includes('저장'));
    expect(saveButtons.length).toBeGreaterThan(0);
    await (saveButtons[0].props.onClick as () => Promise<void>)();
    await flush();

    const safetyCalls = fetchMock.mock.calls.filter(([u]) => u === '/api/settings/safety');
    expect(safetyCalls).toHaveLength(1);
    const body = JSON.parse(String((safetyCalls[0] as [string, RequestInit])[1].body)) as Record<string, unknown>;
    expect(body).not.toHaveProperty('postMarketOverseasEnabled');
    expect(body).toMatchObject({ killSwitch: true, analystEnabled: true, orderMaxPct: 5, dryRun: false });
    expect(hookMode.setters[S_DIRTY]).toHaveBeenCalledWith(false);
    expect(hookMode.setters[S_SAVE_STATE]).toHaveBeenCalledWith('saved');
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });
});
