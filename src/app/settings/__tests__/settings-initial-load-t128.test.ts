/**
 * T-128 A1 — 설정 화면 첫 조회(`useEffect` 의 `Promise.all` 3요청)에서 **한 요청이 실패해도** 나머지 결과가 상태에 들어간다.
 *
 * 예전: `/api/settings/strategies` 에만 `.catch` 가 없어, 그 요청이 실패하면 `Promise.all` 전체가 거부됐다 —
 * 안전 값이 상태에 못 들어가 토글이 잠기고(「값을 읽지 못했습니다」) unhandled rejection 이 났다.
 * 지금: 요청마다 `.catch(() => null)` — 전략 목록만 비고 안전 값·하이브리드는 들어간다. 안전 값 자체를 못 읽으면 예전처럼
 * safety 가 비어 토글이 잠긴다(문구·레이아웃 불변 — 그 문구는 `settings-live-trading-t108.test.ts` 가 고정).
 *
 * 방식은 `settings-live-trading-t108.test.ts` 와 같다(jsdom 없음): 직접 호출 모드에서 훅을 감싸 setter 를 기록하고,
 * 이번에는 `useEffect` 콜백을 모아 직접 실행한다. `Promise.all` 은 원래 구현 그대로 부르되(spy) 돌려준 Promise 를 잡아
 * **거부되지 않음**(= 이 체인에서 unhandled rejection 이 생기지 않음)을 본다.
 */
import * as ReactNS from 'react';

const hookMode: { direct: boolean; setters: jest.Mock[]; effects: Array<() => unknown> } = { direct: false, setters: [], effects: [] };

jest.mock('react', () => {
  const actual = jest.requireActual('react');
  return {
    ...actual,
    useState: (init: unknown) => {
      if (!hookMode.direct) return actual.useState(init);
      const setter = jest.fn();
      hookMode.setters.push(setter);
      return [typeof init === 'function' ? (init as () => unknown)() : init, setter];
    },
    useEffect: (fn: () => unknown, deps: unknown) => (hookMode.direct ? void hookMode.effects.push(fn) : actual.useEffect(fn, deps)),
    useCallback: (fn: unknown, deps: unknown) => (hookMode.direct ? fn : actual.useCallback(fn, deps)),
    useRef: (init: unknown) => (hookMode.direct ? { current: init } : actual.useRef(init)),
  };
});
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }), usePathname: () => '/settings' }));

(globalThis as unknown as { React: typeof ReactNS }).React = ReactNS;

import { SettingsPage } from '@/app/settings/SettingsPage';

// SettingsPage useState 순서 (소스 사실 — settings-live-trading-t108.test.ts 와 같다):
// 0 safety · 1 notifySignal · 2 report · 3 exchanges · 4 strategies · 5 loading · 6 saveState · 7 saveError · 8 isDirty · 9 hybridMode · 10 hybridSaving
const S = { safety: 0, notify: 1, report: 2, exchanges: 3, strategies: 4, loading: 5, hybrid: 9 } as const;

const SAFETY = { dryRun: true, killSwitch: false, exitEngineEnabled: true };
const EXCHANGES = { kis: { configured: true, mock: false, overseasEnabled: true } };
const NOTIFY = { autoSubmit: false, pending: true, entry: true, manual: true };
const STRATS = [{ id: 's1', enabled: true, backtestIntervalM: 60, nextBacktestAt: null }];

type Reply = { body: unknown } | 'network' | 'not_json';
function mockFetch(replies: Record<string, Reply>): jest.Mock {
  const f = jest.fn(async (url: string) => {
    const r = replies[url];
    if (r === undefined) throw new Error(`unexpected fetch ${url}`);
    if (r === 'network') throw new TypeError('Failed to fetch');
    return { ok: true, status: 200, json: async () => { if (r === 'not_json') throw new SyntaxError('Unexpected token <'); return r.body; } };
  });
  (globalThis as unknown as { fetch: unknown }).fetch = f;
  return f;
}

const flush = async () => { for (let i = 0; i < 10; i += 1) await new Promise(r => setImmediate(r)); };

/** 첫 렌더를 직접 호출 → 모인 effect 를 실행 → Promise.all 결과 Promise 와 setter 들을 돌려준다. */
async function runInitialLoad(): Promise<{ all: Promise<unknown>; set: (i: number) => jest.Mock }> {
  hookMode.direct = true;
  hookMode.setters = [];
  hookMode.effects = [];
  SettingsPage();
  expect(hookMode.effects).toHaveLength(1);
  const allSpy = jest.spyOn(Promise, 'all');
  hookMode.effects[0]();
  expect(allSpy).toHaveBeenCalledTimes(1);
  const all = allSpy.mock.results[0].value as Promise<unknown>;
  allSpy.mockRestore();
  await flush();
  return { all, set: (i: number) => hookMode.setters[i] };
}

afterEach(() => {
  hookMode.direct = false;
  jest.restoreAllMocks();
});

const ok = (body: unknown): Reply => ({ body });
const okSafety = ok({ ok: true, safety: SAFETY, exchanges: EXCHANGES, notifySignal: NOTIFY, report: null });

describe('T-128 A1 — 첫 조회의 요청별 실패 격리', () => {
  test.each(['network', 'not_json'] as const)('전략 조회가 실패(%s)해도 안전 값·하이브리드는 들어가고 Promise.all 은 거부되지 않는다', async (fail) => {
    const f = mockFetch({ '/api/settings/safety': okSafety, '/api/settings/strategies': fail, '/api/settings/hybrid': ok({ ok: true, enabled: true }) });
    const { all, set } = await runInitialLoad();
    await expect(all).resolves.toHaveLength(3);
    expect(f.mock.calls.map(c => c[0])).toEqual(['/api/settings/safety', '/api/settings/strategies', '/api/settings/hybrid']);
    expect(set(S.safety)).toHaveBeenCalledWith(SAFETY);
    expect(set(S.exchanges)).toHaveBeenCalledWith(EXCHANGES);
    expect(set(S.notify)).toHaveBeenCalledWith(NOTIFY);
    expect(set(S.strategies)).not.toHaveBeenCalled();   // 전략 목록만 비어 있다(초기값 [])
    expect(set(S.hybrid)).toHaveBeenCalledWith(true);
    expect(set(S.loading)).toHaveBeenCalledWith(false);
  });

  test('안전 조회가 실패하면 safety 는 비어 있다(토글 잠김 — 「값을 읽지 못했습니다」 경로 그대로), 나머지는 들어간다', async () => {
    mockFetch({ '/api/settings/safety': 'network', '/api/settings/strategies': ok({ ok: true, strategies: STRATS }), '/api/settings/hybrid': ok({ ok: true, enabled: false }) });
    const { all, set } = await runInitialLoad();
    await expect(all).resolves.toHaveLength(3);
    expect(set(S.safety)).not.toHaveBeenCalled();
    expect(set(S.exchanges)).not.toHaveBeenCalled();
    expect(set(S.strategies)).toHaveBeenCalledWith(STRATS);
    expect(set(S.hybrid)).toHaveBeenCalledWith(false);
    expect(set(S.loading)).toHaveBeenCalledWith(false);
  });

  test('세 요청이 모두 실패해도 거부되지 않고 「불러오는 중」 이 끝난다(값은 아무것도 넣지 않는다)', async () => {
    mockFetch({ '/api/settings/safety': 'network', '/api/settings/strategies': 'network', '/api/settings/hybrid': 'not_json' });
    const { all, set } = await runInitialLoad();
    await expect(all).resolves.toEqual([null, null, null]);
    for (const i of [S.safety, S.notify, S.report, S.exchanges, S.strategies, S.hybrid]) expect(set(i)).not.toHaveBeenCalled();
    expect(set(S.loading)).toHaveBeenCalledWith(false);
  });

  test('모두 성공하면 이전과 같은 값이 들어간다(정상 경로 불변)', async () => {
    mockFetch({ '/api/settings/safety': okSafety, '/api/settings/strategies': ok({ ok: true, strategies: STRATS }), '/api/settings/hybrid': ok({ ok: true, enabled: true }) });
    const { all, set } = await runInitialLoad();
    await expect(all).resolves.toHaveLength(3);
    expect(set(S.safety)).toHaveBeenCalledWith(SAFETY);
    expect(set(S.strategies)).toHaveBeenCalledWith(STRATS);
    expect(set(S.report)).not.toHaveBeenCalled();         // report: null 은 넣지 않는다(기존 `if (safetyData.report)`)
    expect(set(S.hybrid)).toHaveBeenCalledWith(true);
    expect(set(S.loading)).toHaveBeenCalledWith(false);
  });

  test('ok:false 응답은 넣지 않는다(기존 분기 그대로)', async () => {
    mockFetch({ '/api/settings/safety': ok({ ok: false }), '/api/settings/strategies': ok({ ok: false }), '/api/settings/hybrid': ok({ ok: false }) });
    const { all, set } = await runInitialLoad();
    await expect(all).resolves.toHaveLength(3);
    for (const i of [S.safety, S.strategies, S.hybrid]) expect(set(i)).not.toHaveBeenCalled();
    expect(set(S.loading)).toHaveBeenCalledWith(false);
  });
});
