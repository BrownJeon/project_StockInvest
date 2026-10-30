/**
 * T-108 C-4 — 승인·거절 결과 표시(가이드 §2.4.3)와 **요청 불변**.
 *
 *  1) 순수 판정: approveResultOf / rejectResultOf — 6종(처리 중은 화면 렌더로) 문구.
 *  2) 요청 불변: 실제 `ScenarioDetail` 의 승인·거절 onClick 을 불러(직접 호출 모드 — jsdom 없음) fetch 인자를 본다.
 *     승인 = `POST /api/signals/custom/confirm` + JSON 본문 키 목록·순서 스냅샷, 거절 = `POST /api/signals/{id}/reject`(본문 없음).
 *  3) 화면: 결과 상자 문구·안내(.gate) — 매수/매도·실거래여부 ON 의 빨간 꼬리.
 * 방식은 `settings-post-market-overseas.test.ts` 와 같다(useState 만 감싸 초기값 주입, 직접 호출 모드에서 effect 무시·setter 기록).
 */
import * as ReactNS from 'react';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const hookMode: { direct: boolean; queue: unknown[]; setters: jest.Mock[] } = { direct: false, queue: [], setters: [] };
jest.mock('react', () => {
  const actual = jest.requireActual('react');
  return {
    ...actual,
    useState: (init: unknown) => {
      if (!hookMode.direct) return hookMode.queue.length > 0 ? [hookMode.queue.shift(), () => {}] : actual.useState(init);
      const value = hookMode.queue.length > 0 ? hookMode.queue.shift() : (typeof init === 'function' ? (init as () => unknown)() : init);
      const setter = jest.fn();
      hookMode.setters.push(setter);
      return [value, setter];
    },
    useEffect: (...args: unknown[]) => (hookMode.direct ? undefined : actual.useEffect(...args)),
    useCallback: (fn: unknown, deps: unknown) => (hookMode.direct ? fn : actual.useCallback(fn, deps)),
    useRef: (init: unknown) => (hookMode.direct ? { current: init } : actual.useRef(init)),
  };
});
const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push, back: jest.fn(), replace: jest.fn() }) }));
jest.mock('@/lib/hooks/useFxRate', () => ({ useFxRate: () => 1400 }));
jest.mock('@/lib/hooks/useSymbolMeta', () => ({
  useSymbolMeta: () => ({ meta: {}, displaySymbol: (s: string) => (s.includes(':') ? s.split(':')[1] : s), marketFlag: () => '🇰🇷' }),
}));
(globalThis as unknown as { React: typeof ReactNS }).React = ReactNS;

import {
  ScenarioDetail, approveResultOf, rejectResultOf, approveGateText, APPROVE_UNKNOWN_TEXT, REJECT_UNKNOWN_TEXT,
} from '@/components/ScenarioDetail';
import { T062_FIXTURE } from '@/components/__tests__/fixtures/t062-signals-fixture';

const DOMESTIC = { ...T062_FIXTURE.find(r => r.id === 103)! };
// ScenarioDetail useState 순서(소스 사실): signal · loading · pageError · submitting · rejecting · splits · sliceInputs ·
// currentPrice · priceLoading · holdingQty · formError · (T-108) result · liveTrading
const S_RESULT = 11;
function queueFor(signal: unknown, over: { result?: unknown; liveTrading?: boolean | null; submitting?: boolean; rejecting?: boolean } = {}): unknown[] {
  return [
    signal, false, null, over.submitting ?? false, over.rejecting ?? false, 1,
    [{ zoneLo: '', zoneHi: '', zoneLoPct: '-2.0', zoneHiPct: '-0.5', qty: '2' }],
    70000, false, 0, null, over.result ?? null, over.liveTrading ?? null,
  ];
}

type El = { type: unknown; props: Record<string, unknown> & { children?: unknown } };
function isEl(n: unknown): n is El { return !!n && typeof n === 'object' && 'props' in (n as object); }
function textOf(n: unknown): string {
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map(textOf).join('');
  return isEl(n) ? textOf(n.props.children) : '';
}
function findButton(tree: unknown, label: RegExp): El {
  const out: El[] = [];
  (function walk(n: unknown) {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!isEl(n)) return;
    if (n.type === 'button' && label.test(textOf(n.props.children))) out.push(n);
    walk(n.props.children);
  })(tree);
  expect(out).toHaveLength(1);
  return out[0];
}
function callDetail(signal: unknown): unknown {
  hookMode.direct = true; hookMode.setters = [];
  hookMode.queue = queueFor(signal);
  const tree = ScenarioDetail({ signalId: (signal as { id: number }).id });
  expect(hookMode.queue).toHaveLength(0);
  return tree;
}
function renderDetail(signal: unknown, over: Parameters<typeof queueFor>[1] = {}): string {
  hookMode.direct = false;
  hookMode.queue = queueFor(signal, over);
  const html = renderToStaticMarkup(h(ScenarioDetail, { signalId: (signal as { id: number }).id }));
  expect(hookMode.queue).toHaveLength(0);
  return html;
}
const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const flush = async () => { for (let i = 0; i < 5; i += 1) await new Promise(r => setImmediate(r)); };
const res = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body });
const lastSet = (i: number) => { const c = hookMode.setters[i].mock.calls; return c[c.length - 1]?.[0]; };

afterEach(() => { hookMode.direct = false; hookMode.queue = []; jest.restoreAllMocks(); push.mockReset(); });

describe('결과 판정 — 문구 (데모 v3 시트 결과 상태)', () => {
  test('성공 — 진입 감시 응답이면 「✓ 진입 감시가 시작됐습니다」, 모르면 공통 「✓ 승인했습니다」', () => {
    expect(approveResultOf(200, { ok: true, status: 'approved_pending_entry' })).toEqual({ kind: 'ok', text: '✓ 진입 감시가 시작됐습니다' });
    expect(approveResultOf(200, { ok: true })).toEqual({ kind: 'ok', text: '✓ 승인했습니다' });
  });
  test('실패(4xx) — 「! 오류: {error} — 승인되지 않았습니다. 목록으로 돌아가 다시 확인하세요.」', () => {
    expect(approveResultOf(400, { ok: false, error: '시그널이 만료되었습니다' }).text)
      .toBe('! 오류: 시그널이 만료되었습니다 — 승인되지 않았습니다. 목록으로 돌아가 다시 확인하세요.');
    expect(approveResultOf(409, { ok: false }).text).toBe('! 오류: 알 수 없는 오류 — 승인되지 않았습니다. 목록으로 돌아가 다시 확인하세요.');
  });
  test.each([[403, 'validation_gate'], [503, 'validation_lookup_error']])('차단(%p %s) — 「⊘ 차단: {error} — 승인되지 않았습니다.」', (st, code) => {
    expect(approveResultOf(st, { ok: false, error: '검증 상태가 아닙니다', errorCode: code })).toEqual({ kind: 'blocked', text: '⊘ 차단: 검증 상태가 아닙니다 — 승인되지 않았습니다.' });
  });
  test('blockedBy 표지도 차단', () => {
    expect(approveResultOf(403, { ok: false, error: '모든거래차단', blockedBy: 'kill_switch' }).kind).toBe('blocked');
  });
  test('5xx(관문 코드 없음)·본문 못 읽음 — 「승인됐는지 알 수 없습니다」(승인되지 않았다고 말하지 않는다)', () => {
    expect(approveResultOf(500, { ok: false, error: 'db' }).text).toBe('! 오류: db — 승인됐는지 알 수 없습니다. 목록을 새로 고쳐 상태를 확인한 뒤 다시 시도하세요.');
    expect(approveResultOf(200, undefined)).toEqual({ kind: 'unknown', text: APPROVE_UNKNOWN_TEXT });
    expect(APPROVE_UNKNOWN_TEXT).toBe('! 오류: 연결이 끊겼습니다 — 승인됐는지 알 수 없습니다. 목록을 새로 고쳐 상태를 확인한 뒤 다시 시도하세요.');
  });
  test('거절 — 성공·실패·알 수 없음', () => {
    expect(rejectResultOf(200, { ok: true })).toEqual({ kind: 'rejected', text: '거절했습니다 — 놓친 기회(사후 추적)에 기록됩니다' });
    expect(rejectResultOf(400, { ok: false, error: 'x' })).toEqual({ kind: 'reject_fail', text: '! 거절하지 못했습니다 — 시그널은 그대로입니다' });
    expect(rejectResultOf(500, { ok: false })).toEqual({ kind: 'reject_unknown', text: REJECT_UNKNOWN_TEXT });
    expect(rejectResultOf(200, undefined).kind).toBe('reject_unknown');
  });
});

describe('요청 불변 — 승인·거절의 URL·메서드·본문', () => {
  test('승인: POST /api/signals/custom/confirm · JSON 본문 키 목록·순서·값', async () => {
    const fetchMock = jest.fn().mockResolvedValue(res(200, { ok: true, status: 'approved_pending_entry' }));
    (global as unknown as { fetch: unknown }).fetch = fetchMock;
    const tree = callDetail(DOMESTIC);
    (findButton(tree, /등록/).props.onClick as () => Promise<void>)();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/signals/custom/confirm');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    const body = JSON.parse(String(init.body));
    expect(Object.keys(body)).toEqual(['market', 'symbol', 'direction', 'currentPrice', 'scenario', 'manualSlices', 'splits', 'sourceSignalId']);
    expect(body).toMatchObject({ market: 'domestic', symbol: '005930', direction: 'buy', currentPrice: 70000, splits: 1, sourceSignalId: 103 });
    expect(body.manualSlices).toEqual([{ zoneLo: 68600, zoneHi: 69700, qty: 2 }]);
    expect(lastSet(S_RESULT)).toEqual({ kind: 'ok', text: '✓ 진입 감시가 시작됐습니다' });
  });
  test('승인 네트워크 오류(fetch throw) → 「알 수 없음」, 이동 안 함', async () => {
    (global as unknown as { fetch: unknown }).fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const tree = callDetail(DOMESTIC);
    (findButton(tree, /등록/).props.onClick as () => Promise<void>)();
    await flush();
    expect(lastSet(S_RESULT)).toEqual({ kind: 'unknown', text: APPROVE_UNKNOWN_TEXT });
    expect(push).not.toHaveBeenCalled();
  });
  test('승인 403 validation_gate → 차단 문구, 이동 예약 없음', async () => {
    (global as unknown as { fetch: unknown }).fetch = jest.fn().mockResolvedValue(res(403, { ok: false, error: '검증 상태가 아닙니다', errorCode: 'validation_gate' }));
    const st = jest.spyOn(global, 'setTimeout');
    const tree = callDetail(DOMESTIC);
    (findButton(tree, /등록/).props.onClick as () => Promise<void>)();
    await flush();
    expect(lastSet(S_RESULT)).toEqual({ kind: 'blocked', text: '⊘ 차단: 검증 상태가 아닙니다 — 승인되지 않았습니다.' });
    expect(st.mock.calls.filter(c => c[1] === 1800)).toHaveLength(0);
  });
  test('거절: POST /api/signals/{id}/reject · 본문 없음 · 성공 문구 · 1.8초 뒤 /recommend 이동 예약', async () => {
    const fetchMock = jest.fn().mockResolvedValue(res(200, { ok: true }));
    (global as unknown as { fetch: unknown }).fetch = fetchMock;
    const st = jest.spyOn(global, 'setTimeout');
    const tree = callDetail(DOMESTIC);
    (findButton(tree, /^거절$/).props.onClick as () => Promise<void>)();
    await flush();
    expect(fetchMock.mock.calls[0]).toEqual(['/api/signals/103/reject', { method: 'POST' }]);
    expect(lastSet(S_RESULT)).toEqual({ kind: 'rejected', text: '거절했습니다 — 놓친 기회(사후 추적)에 기록됩니다' });
    expect(st.mock.calls.filter(c => c[1] === 1800)).toHaveLength(1);
  });
  test('거절 실패(400) → 「시그널은 그대로」, 이동 예약 없음', async () => {
    (global as unknown as { fetch: unknown }).fetch = jest.fn().mockResolvedValue(res(400, { ok: false, error: '이미 처리됨' }));
    const st = jest.spyOn(global, 'setTimeout');
    const tree = callDetail(DOMESTIC);
    (findButton(tree, /^거절$/).props.onClick as () => Promise<void>)();
    await flush();
    expect(lastSet(S_RESULT)).toEqual({ kind: 'reject_fail', text: '! 거절하지 못했습니다 — 시그널은 그대로입니다' });
    expect(st.mock.calls.filter(c => c[1] === 1800)).toHaveLength(0);
    expect(push).not.toHaveBeenCalled();
  });
  test('승인 요청 블록 소스 고정 — fetch 첫 인자·메서드·본문 키 줄이 그대로', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const src: string = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'components', 'ScenarioDetail.tsx'), 'utf8');
    expect(src.match(/fetch\('\/api\/signals\/custom\/confirm', \{\n\s+method: 'POST',\n\s+headers: \{ 'Content-Type': 'application\/json' \},\n\s+body: JSON\.stringify\(\{/g)).toHaveLength(1);
    expect(src).toContain('await fetch(`/api/signals/${signal.id}/reject`, { method: \'POST\' });');
  });
});

describe('화면 — 결과 상자·안내', () => {
  test('결과 상자가 생기면 본문 아래 여백을 늘려 하단 고정 바에 가리지 않게(100 → 160px)', () => {
    expect(renderDetail(DOMESTIC)).toContain('padding-bottom:100px');
    expect(renderDetail(DOMESTIC, { result: { kind: 'fail', text: 'x' } })).toContain('padding-bottom:160px');
    expect(renderDetail(DOMESTIC, { submitting: true })).toContain('padding-bottom:160px');
  });
  test('처리 중: 스피너 + 「처리 중… (다시 누를 수 없음)」, 승인·거절 비활성', () => {
    const html = renderDetail(DOMESTIC, { submitting: true });
    expect(text(html)).toContain('처리 중… (다시 누를 수 없음)');
    expect((html.match(/<button[^>]*disabled=""/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
  test.each([
    [{ kind: 'ok', text: '✓ 진입 감시가 시작됐습니다' }, 'res ok'],
    [{ kind: 'blocked', text: '⊘ 차단: x — 승인되지 않았습니다.' }, 'res e'],
    [{ kind: 'rejected', text: '거절했습니다 — 놓친 기회(사후 추적)에 기록됩니다' }, 'res'],
  ])('결과 %p → 상자(tabindex=-1)', (result, cls) => {
    const html = renderDetail(DOMESTIC, { result });
    expect(text(html)).toContain(result.text);
    expect(html).toContain(`<div tabindex="-1" class="${cls}" style="grid-column:1 / -1;margin:0">${result.text}</div>`);
  });
  test('매수 안내 — 실거래여부 모름/OFF 면 노랑, ON 이면 빨강 + 「실제 주문」', () => {
    const off = renderDetail(DOMESTIC, { liveTrading: false });
    // R-UI ⑦ — 버튼 「✅ 등록」과 어휘를 맞춰 「등록하면」
    expect(text(off)).toContain('등록하면 진입 감시가 시작됩니다 — 이 단계에서는 주문이 나가지 않습니다. 주문은 진입 구간에 닿을 때 안전장치(모든거래차단·한도·실거래여부)를 거쳐 나갑니다.');
    expect(text(off)).not.toContain('승인하면');
    expect(off).not.toContain('gate bad');
    const on = renderDetail(DOMESTIC, { liveTrading: true });
    expect(text(on)).toContain('— 지금 실거래여부 ON = 실제 주문.');
    expect(on).toContain('class="gate bad"');
  });
  test('매도 안내 — 같은 진입 감시 경로, 주문 한도·검증 관문 제외를 사실대로', () => {
    expect(approveGateText('sell', null)).toEqual({
      body: '됩니다 — 이 단계에서는 주문이 나가지 않습니다. 매도 주문은 지정한 구간에 닿을 때 안전장치(모든거래차단·실거래여부)를 거쳐 나갑니다(매도는 주문 한도·검증 관문을 거치지 않음)',
      live: false,
    });
    expect(approveGateText('buy', 'true' as unknown as boolean).live).toBe(false); // true 리터럴만 실거래
  });
});
