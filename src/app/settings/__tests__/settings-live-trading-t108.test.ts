/**
 * T-108 §2.6 설정 화면 — **문구와 이름·방향 표시만** 바뀌고 저장 동작은 그대로임을 고정한다(L-4).
 *
 *  - 「실거래여부」(ON = 실거래 가능) 토글: 화면 방향은 내부 dryRun 과 반대지만 **PATCH 본문 키·값은 이전과 같다**
 *    (ON → `{ dryRun: false }`, OFF → `{ dryRun: true }`). 방향 변환은 `src/lib/safety/live-trading.ts` 한 곳.
 *  - 「모든거래차단」 토글: PATCH 본문 `{ killSwitch: v }` 그대로.
 *  - 손실한도 손절 상태는 청산 엔진 설명에 표시 · 자동매매 자금 2행은 이동 전용(조회·저장 없음).
 *
 * 방식은 `settings-post-market-overseas.test.ts` 와 같다(jsdom 없음): useState 만 감싸 조회 뒤 값을 넣고,
 * 직접 호출 모드에서 `SettingsPage()` 가 돌려준 요소 트리의 토글 `onChange` 를 불러 실제 autoSave 경로를 탄다.
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

import { SettingsPage } from '@/app/settings/SettingsPage';

function baseSafety(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    dryRun: true, killSwitch: false,
    exitEngineEnabled: true, exitHardStopEnabled: false, exitSwitchSource: 'config', exitSwitchSummary: '',
    orderMaxPct: 5, dailyOrderMaxPct: 10,
    universeEnabled: false, analystEnabled: true,
    postMarketOverseasEnabled: false,
    blockedSymbols: [], blockedSymbolsOverseas: [],
    volGuardEnabled: false, volGuardWindowMin: 60, volGuardWarnPct: -2, volGuardBlockPct: -4, volGuardPanicPct: -7,
    ...over,
  };
}
const NOTIFY = { autoSubmit: true, pending: true, entry: true, manual: true, universe: true };
const EXCHANGES = { kis: { configured: true, mock: false, overseasEnabled: true } };
// SettingsPage useState 순서 (소스 사실): 0 safety · 1 notifySignal · 2 report · 3 exchanges · 4 strategies · 5 loading
// · 6 saveState · 7 saveError · 8 isDirty · 9 hybridMode · 10 hybridSaving — T-108 은 useState 를 더하지 않았다
const S_SAFETY = 0, S_SAVE_STATE = 6, S_SAVE_ERROR = 7;
const STATE_COUNT = 11;

function text(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}
function renderPage(safety: Record<string, unknown> | null): string {
  hookMode.direct = false;
  hookMode.queue = [safety, NOTIFY, null, EXCHANGES, [], false];
  const html = renderToStaticMarkup(h(SettingsPage));
  expect(hookMode.queue).toHaveLength(0);
  return html;
}
function callPage(safety: Record<string, unknown>): unknown {
  hookMode.direct = true;
  hookMode.setters = [];
  hookMode.stateCalls = 0;
  hookMode.queue = [safety, NOTIFY, null, EXCHANGES, [], false, 'idle', null, false, false, false];
  const tree = SettingsPage();
  expect(hookMode.queue).toHaveLength(0);
  expect(hookMode.stateCalls).toBe(STATE_COUNT);
  return tree;
}

type El = { type: unknown; props: Record<string, unknown> & { children?: unknown } };
function isEl(n: unknown): n is El { return !!n && typeof n === 'object' && 'props' in (n as object); }
function isToggle(el: El): boolean {
  return typeof el.type === 'function' && (el.type as { name?: string }).name === 'Toggle';
}
/** 라벨 문자열과 토글 정확히 1개를 함께 품은 가장 작은 요소(= 그 설정 행)의 토글. */
function toggleOfRow(tree: unknown, label: string): El {
  const found: El[] = [];
  function visit(n: unknown): { label: boolean; toggles: El[] } {
    if (typeof n === 'string') return { label: n === label, toggles: [] };
    if (Array.isArray(n)) {
      return n.map(visit).reduce((a, b) => ({ label: a.label || b.label, toggles: [...a.toggles, ...b.toggles] }), { label: false, toggles: [] as El[] });
    }
    if (!isEl(n)) return { label: false, toggles: [] };
    const inner = visit(n.props.children);
    const res = { label: inner.label, toggles: isToggle(n) ? [n, ...inner.toggles] : inner.toggles };
    if (res.label && res.toggles.length === 1 && !found.some(f => res.toggles.includes(f))) found.push(res.toggles[0]);
    return res;
  }
  visit(tree);
  expect(found).toHaveLength(1);
  return found[0];
}
function applySetter(setter: jest.Mock, start: unknown): unknown {
  return setter.mock.calls.reduce((acc: unknown, [arg]) => (typeof arg === 'function' ? (arg as (p: unknown) => unknown)(acc) : arg), start);
}
const flush = async () => { for (let i = 0; i < 5; i += 1) await new Promise(r => setImmediate(r)); };
const jsonRes = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

afterEach(() => {
  hookMode.direct = false;
  hookMode.queue = [];
  jest.restoreAllMocks();
});

describe('문구 — 이름과 방향 표시', () => {
  test('관찰(dryRun=true·kill=false): 실거래여부 OFF · 모든거래차단 OFF · 둘째 줄 설명', () => {
    const t = text(renderPage(baseSafety()));
    expect(t).toContain('실거래여부 OFF — 실거래 차단(기록만) ON 이면 주문이 거래소로 나가고, OFF 이면 기록만 남깁니다 OFF');
    // T-130 5번 「차단」 규칙(데모 v1 승인) — 스위치 OFF 부제 「차단 안 함」 → 「이 스위치로는 막지 않음」
    expect(t).toContain('모든거래차단 OFF — 이 스위치로는 막지 않음 ON 이면 매수·매도·청산 모두 송신하지 않습니다 OFF');
    expect(t).not.toContain('실거래여부가 ON 입니다');
    expect(t).not.toMatch(/DRY_RUN|KILL_SWITCH|실거래 여부|하드 ?손절|EOD ?손절|장마감 손실 차단/);
  });
  test('실거래(dryRun=false): 실거래여부 ON — 실거래 가능(실제 주문) + 경고 상자', () => {
    const t = text(renderPage(baseSafety({ dryRun: false })));
    expect(t).toContain('실거래여부 ON — 실거래 가능(실제 주문)');
    expect(t).toContain('⚠ 실거래여부가 ON 입니다.');
  });
  test('모든거래차단 ON 문구', () => {
    expect(text(renderPage(baseSafety({ killSwitch: true })))).toContain('모든거래차단 ON — 모든 주문 차단');
  });
  test('dryRun 값이 이상하면(문자열) 실거래 아님으로 그린다 — fail-closed', () => {
    const t = text(renderPage(baseSafety({ dryRun: 'false' })));
    expect(t).toContain('실거래여부 OFF — 실거래 차단(기록만)');
    expect(t).not.toContain('실거래여부가 ON 입니다');
  });
  test('안전 값을 못 읽었으면(safety 없음) OFF·ON 어느 쪽도 단정하지 않는다 — 「값을 읽지 못했습니다」, 값 칸 「—」, 「실거래 ON」 경고 없음 (R-UI ①)', () => {
    const t = text(renderPage(null));
    expect(t).toContain('실거래여부 값을 읽지 못했습니다 — 지금 상태를 알 수 없습니다 ON 이면 주문이 거래소로 나가고, OFF 이면 기록만 남깁니다 —');
    expect(t).toContain('모든거래차단 값을 읽지 못했습니다 — 지금 상태를 알 수 없습니다 ON 이면 매수·매도·청산 모두 송신하지 않습니다 —');
    expect(t).toContain('자동 청산 엔진 값을 읽지 못했습니다 — 지금 상태를 알 수 없습니다 —');
    expect(t).not.toMatch(/OFF — 실거래 차단|OFF — 이 스위치로는 막지 않음|OFF — 차단 안 함|OFF — 자동 손절/);
    expect(t).not.toContain('실거래여부가 ON 입니다');
  });
  test('청산 엔진에 하위 손절 OFF를 표시하고 별도의 손실한도 손절 행을 그리지 않는다', () => {
    const html = renderPage(baseSafety());
    const t = text(html);
    // T-130 10a(D8-A) — 청산 이름 「트레일링 스탑」·「목표 익절」
    expect(t).toContain('ON — 손실한도 손절·장마감 전 손절·트레일링 스탑·목표 익절 시그널 판단 중 (손실한도 손절만 개별 OFF)');
    expect(html).not.toContain('>손실한도 손절</div>');
    const enabled = renderPage(baseSafety({ exitHardStopEnabled: true }));
    expect(enabled).not.toContain('>손실한도 손절</div>');
    expect(text(enabled)).not.toContain('손실한도 손절만 개별 OFF');
  });
  test('자동승인모드 행은 자동 청산 엔진 다음에 있고 서버 값을 읽기 전에는 토글을 그리지 않는다', () => {
    const html = renderPage(baseSafety());
    const engine = html.indexOf('>자동 청산 엔진</div>');
    const mode = html.indexOf('>자동승인모드</div>');
    expect(engine).toBeGreaterThan(-1);
    expect(mode).toBeGreaterThan(engine);
    expect(html.indexOf('해외 장마감 후 분석 (미국 시나리오)')).toBeGreaterThan(mode);
    expect(html).not.toContain('aria-label="자동승인모드"');
  });
  test('자동매매 자금 — 운용액 배정(누를 곳 없음) · 손익 기준(→ /settings/cash-ledger), 안전장치 카드 아래·거래 보호 앞', () => {
    const html = renderPage(baseSafety());
    const t = text(html);
    const safe = t.indexOf('안전장치 (공통)');
    const money = t.indexOf('자동매매 자금');
    const guard = t.indexOf('거래 보호');
    expect(money).toBeGreaterThan(safe);
    expect(guard).toBeGreaterThan(money);
    expect(t).toContain('운용액 배정 — 미설정 자동매매에 쓸 금액을 직접 정합니다(D4). 입력 화면은 다음 범위');
    expect(t).toContain('손익 기준 — 실거래 전환일 첫 스냅샷 자산 기록의 「기준 정하기」를 재사용(D5) · 관찰 기간엔 홈 손익 미표시');
    const seg = html.slice(html.indexOf('자동매매 자금'), html.indexOf('거래 보호'));
    expect(seg.match(/href="\/settings\/cash-ledger"/g)).toHaveLength(1);
    expect(seg).not.toMatch(/<button|onclick/i);
  });
  test('맨 아래 안내 상자 문구', () => {
    expect(text(renderPage(baseSafety()))).toContain('실거래여부 / 모든거래차단 / 주문 한도는 DB에 저장되어 서버 재시작 없이 즉시 반영됩니다.');
  });
});

describe('저장 — PATCH 본문 키·값은 이전과 같다', () => {
  test.each([
    // [시작 dryRun, 토글 새 값(실거래여부), 기대 PATCH 본문]
    [true, true, { dryRun: false }],    // OFF → ON = 실거래 가능 = dryRun:false
    [false, false, { dryRun: true }],   // ON → OFF = 실거래 차단 = dryRun:true
  ])('dryRun=%p 에서 실거래여부 토글 → %p : PATCH %p', async (startDry, next, body) => {
    const fetchMock = jest.fn().mockResolvedValue(jsonRes(200, { ok: true }));
    (global as unknown as { fetch: unknown }).fetch = fetchMock;
    const start = baseSafety({ dryRun: startDry });
    const tree = callPage(start);
    const toggle = toggleOfRow(tree, '실거래여부');
    expect(toggle.props.checked).toBe(!startDry);
    (toggle.props.onChange as (v: boolean) => void)(next as boolean);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/settings/safety');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual(body);
    const after = applySetter(hookMode.setters[S_SAFETY], start) as Record<string, unknown>;
    expect(after.dryRun).toBe((body as { dryRun: boolean }).dryRun);
  });

  test.each([[false, true], [true, false]])('모든거래차단 %p → %p : PATCH {killSwitch}', async (startKill, next) => {
    const fetchMock = jest.fn().mockResolvedValue(jsonRes(200, { ok: true }));
    (global as unknown as { fetch: unknown }).fetch = fetchMock;
    const tree = callPage(baseSafety({ killSwitch: startKill }));
    const toggle = toggleOfRow(tree, '모든거래차단');
    expect(toggle.props.checked).toBe(startKill);
    expect(toggle.props.danger).toBe(true);
    (toggle.props.onChange as (v: boolean) => void)(next);
    await flush();
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({ killSwitch: next });
  });

  test('저장 거부 → 서버 값으로 되돌림, 오류 문구는 새 이름(실거래여부)', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(jsonRes(400, { ok: false, error: '거부' }))
      .mockResolvedValueOnce(jsonRes(200, { ok: true, safety: baseSafety({ dryRun: true }) }));
    (global as unknown as { fetch: unknown }).fetch = fetchMock;
    const start = baseSafety({ dryRun: true });
    const tree = callPage(start);
    (toggleOfRow(tree, '실거래여부').props.onChange as (v: boolean) => void)(true);
    await flush();
    const final = applySetter(hookMode.setters[S_SAFETY], start) as Record<string, unknown>;
    expect(final.dryRun).toBe(true);
    expect(hookMode.setters[S_SAVE_STATE]).toHaveBeenCalledWith('error');
    const msg = String(applySetter(hookMode.setters[S_SAVE_ERROR], null));
    expect(msg).toContain('실거래여부 전환이 저장되지 않았습니다');
    expect(msg).toContain('실거래여부 값은 서버의 실제 상태로 되돌렸습니다');
    expect(msg).not.toMatch(/DRY_RUN/);
  });
});

describe('안전 값을 못 읽은 동안 — 안전 토글 3개 잠금 · [다시 읽기] (Codex C2 high, Leader 승인)', () => {
  const LABELS = ['실거래여부', '모든거래차단', '자동 청산 엔진'] as const;
  test.each(LABELS)('safety=null → %s 토글 disabled, onChange 를 불러도 PATCH 없음', async (label) => {
    const fetchMock = jest.fn().mockResolvedValue(jsonRes(200, { ok: true }));
    (global as unknown as { fetch: unknown }).fetch = fetchMock;
    hookMode.direct = true; hookMode.setters = []; hookMode.stateCalls = 0;
    hookMode.queue = [null, NOTIFY, null, EXCHANGES, [], false, 'idle', null, false, false, false];
    const tree = SettingsPage();
    expect(hookMode.stateCalls).toBe(STATE_COUNT);
    const toggle = toggleOfRow(tree, label);
    expect(toggle.props.disabled).toBe(true);
    (toggle.props.onChange as (v: boolean) => void)(true);
    (toggle.props.onChange as (v: boolean) => void)(false);
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(hookMode.setters[S_SAFETY]).not.toHaveBeenCalled();
    // 스위치 자체도 잠겼다 — 실제 클릭 처리(onClick)가 onChange 를 부르지 않는다
    const spy = jest.fn();
    const inner = (toggle.type as (p: Record<string, unknown>) => El)({ ...toggle.props, onChange: spy });
    (inner.props.onClick as () => void)();
    expect(spy).not.toHaveBeenCalled();
    // 대조: 같은 스위치를 잠금 없이 그리면 onChange 를 부른다
    const open = (toggle.type as (p: Record<string, unknown>) => El)({ ...toggle.props, disabled: false, onChange: spy });
    (open.props.onClick as () => void)();
    expect(spy).toHaveBeenCalledTimes(1);
  });
  test('safety=null 렌더 — 세 스위치 aria-disabled, 잠금 안내 + 「다시 읽기」 버튼(44px)', () => {
    const html = renderPage(null);
    expect(html.match(/role="switch" aria-checked="(true|false)" aria-disabled="true"/g)).toHaveLength(3);
    // T-130 D2-A — 스위치 겉은 button(누르는 영역 44×44, 잠기면 not-allowed), 흐림(.45)은 안쪽 그림 span 에
    expect(html.match(/aria-disabled="true" aria-label="[^"]+" style="[^"]*cursor:not-allowed[^"]*"><span style="[^"]*opacity:0.45/g)).toHaveLength(3);
    // R-UI-N4 — 실제로 잠그는 3개를 이름으로(해외 장마감 후 분석 토글은 잠그지 않는다)
    expect(text(html)).toContain('안전 값을 읽지 못해 세 안전 토글(실거래여부·모든거래차단·자동 청산 엔진)을 잠갔습니다 — 다시 읽은 뒤에 바꿀 수 있습니다 다시 읽기');
    expect(html).toMatch(/<button type="button" style="[^"]*min-height:44px[^"]*">다시 읽기<\/button>/);
  });
  test('정상 상태 — 안전 토글은 잠기지 않고(aria-disabled 없음) 잠금 안내도 없다', () => {
    const html = renderPage(baseSafety());
    expect(html).not.toContain('aria-disabled');
    expect(html).not.toContain('다시 읽기');
    const tree = callPage(baseSafety());
    for (const l of LABELS) expect(toggleOfRow(tree, l).props.disabled).toBe(false);
  });
  test('[다시 읽기] — GET /api/settings/safety 1회, 성공하면 safety 를 채운다 · 실패하면 그대로(잠긴 채)', async () => {
    const server = baseSafety({ dryRun: true });
    const ok = jest.fn().mockResolvedValue(jsonRes(200, { ok: true, safety: server, exchanges: EXCHANGES, notifySignal: NOTIFY }));
    (global as unknown as { fetch: unknown }).fetch = ok;
    hookMode.direct = true; hookMode.setters = []; hookMode.stateCalls = 0;
    hookMode.queue = [null, NOTIFY, null, EXCHANGES, [], false, 'idle', null, false, false, false];
    let tree = SettingsPage();
    const btn = (function find(n: unknown): El | null {
      if (Array.isArray(n)) { for (const x of n) { const f = find(x); if (f) return f; } return null; }
      if (!isEl(n)) return null;
      if (n.type === 'button' && n.props.children === '다시 읽기') return n;
      return find(n.props.children);
    })(tree);
    expect(btn).not.toBeNull();
    (btn!.props.onClick as () => void)();
    await flush();
    expect(ok).toHaveBeenCalledTimes(1);
    expect((ok.mock.calls[0] as [string, RequestInit])[0]).toBe('/api/settings/safety');
    expect((ok.mock.calls[0] as [string, RequestInit])[1].method ?? 'GET').toBe('GET');
    expect(hookMode.setters[S_SAFETY]).toHaveBeenCalledWith(server);

    const bad = jest.fn().mockRejectedValue(new TypeError('x'));
    (global as unknown as { fetch: unknown }).fetch = bad;
    hookMode.setters = []; hookMode.stateCalls = 0;
    hookMode.queue = [null, NOTIFY, null, EXCHANGES, [], false, 'idle', null, false, false, false];
    tree = SettingsPage();
    void tree;
    // 같은 버튼을 다시 찾아 누른다
    const btn2 = (function find(n: unknown): El | null {
      if (Array.isArray(n)) { for (const x of n) { const f = find(x); if (f) return f; } return null; }
      if (!isEl(n)) return null;
      if (n.type === 'button' && n.props.children === '다시 읽기') return n;
      return find(n.props.children);
    })(tree);
    (btn2!.props.onClick as () => void)();
    await flush();
    expect(bad).toHaveBeenCalledTimes(1);
    expect(hookMode.setters[S_SAFETY]).not.toHaveBeenCalled();
  });
});

describe('내 계정(ProfilePage) — 「모의 매매」를 「실거래여부」 이름·방향으로 (R-UI 용어)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const SRC: string = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'profile', 'ProfilePage.tsx'), 'utf8');
  test('토글 표시·저장 모두 live-trading.ts 두 함수로 — 저장 값(form.dryRun)의 뜻은 그대로', () => {
    expect(SRC).toContain('checked={liveTradingFromDryRun(form.dryRun)}');
    expect(SRC).toContain('onChange={(v) => setForm({ ...form, dryRun: dryRunFromLiveTrading(v) })}');
    expect(SRC).not.toMatch(/label="모의 매매"/);
  });
  test('설명 상자 — 가입 시 실거래여부 「꺼짐(OFF)」으로 시작(기본 dryRun=true). 이름만 바꾸고 「켜짐」을 남기면 부호가 뒤집힌다 (R-UI-N1)', () => {
    expect(SRC).toContain('가입 시 <b style={S.strong}>꺼짐(OFF)</b>으로 시작합니다.');
    expect(SRC).not.toMatch(/가입 시 <b style=\{S\.strong\}>켜짐<\/b>/);
  });
});
