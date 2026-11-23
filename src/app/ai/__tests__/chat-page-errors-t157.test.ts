/**
 * T-157 — 비서(ChatPage) 오류 처리.
 *  ① 401 → `/login?next=%2Fai` 로 이동(오류 띠 없음)
 *  ② 비JSON·5xx·`ok:true` 아님·네트워크 오류 → 조용히 멈추지 않고 기존 오류 띠
 *  ③ 메시지 조회 404 → 선택 해제·메시지 비움·목록 재조회·안내(이전 대화 메시지를 남기지 않음), 늦게 온 이전 대화 응답은 버림
 *  ④ 삭제는 응답 `ok:true` 뒤에만 목록에서 제거, 실패하면 목록 그대로 + 오류(대화 목록 안에도 보임)
 *  ⑤ 정상 흐름(목록·메시지·정제 요청)은 그대로
 *  ⑥ 대화를 바꾼 뒤 늦게 도착한 송신·확정 응답은 전환한 대화 화면을 덮지 않는다 (QA 결함 #1 회귀)
 *  ⑦ 같은 대화 안에서 조회가 겹치면 늦게 끝난 옛 조회가 최신 화면을 덮지 않는다 (Codex C2 지적 1 회귀)
 *  ⑧ 비활성 대화의 재조회(어차피 버려질 것)가 활성 대화의 진행 중 조회를 무효화하지 않는다 (라운드 5 회귀)
 *  ⑨ 「+ 새 대화」 중에 끼어든 재조회가 빈 화면에 옛 대화 메시지를 붓지 않는다 (대화 ID 가드 자체의 회귀망)
 *  ⑩ 로드 effect 의 `stale` 가드 — 보류된 최초 조회가 「+ 새 대화」 뒤 빈 화면을 채우지 않는다 (REV7b)
 *  ⑪ `handleThreadGone` 은 **보고 있던** 대화일 때만 선택을 해제한다 — 남의 대화 404 가 내 화면을 비우지 않는다 (REV7c)
 *
 * 방식(jsdom·testing-library 없음 — settings-touch-keyboard-t130 과 같은 하네스): `react` 훅을 감싸 ChatPage 함수를 직접 부르고,
 * 상태는 배열(slots)에 둔다. 자식 컴포넌트는 그리지 않고 요소 props 로 확인·조작한다. fetch 는 모킹 — 운영 API 를 부르지 않는다.
 */
import * as ReactNS from 'react';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

type EffSlot = { deps: unknown[] | undefined; cleanup?: () => void };
type Fiber = { slots: unknown[] };
const H: { fiber: Fiber | null; i: number; effects: Array<{ i: number; fn: () => unknown }> } = { fiber: null, i: 0, effects: [] };

jest.mock('react', () => {
  const actual = jest.requireActual('react');
  return {
    ...actual,
    useState: (init: unknown) => {
      const f = H.fiber;
      if (!f) return actual.useState(init);
      const i = H.i++;
      if (!(i in f.slots)) f.slots[i] = typeof init === 'function' ? (init as () => unknown)() : init;
      const set = (v: unknown) => { f.slots[i] = typeof v === 'function' ? (v as (p: unknown) => unknown)(f.slots[i]) : v; };
      return [f.slots[i], set];
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
      const prev = f.slots[i] as EffSlot | undefined;
      const changed = prev === undefined || !deps || !prev.deps || deps.some((d, k) => !Object.is(d, prev.deps![k]));
      if (prev === undefined) f.slots[i] = { deps } as EffSlot;
      if (changed) H.effects.push({ i, fn });
      (f.slots[i] as EffSlot).deps = deps;
      return undefined;
    },
    useCallback: (fn: unknown, deps: unknown) => (H.fiber ? fn : actual.useCallback(fn, deps)),
    useMemo: (fn: () => unknown, deps: unknown) => (H.fiber ? fn() : actual.useMemo(fn, deps)),
  };
});

(globalThis as unknown as { React: typeof ReactNS }).React = ReactNS;

import {
  CHAT_LOGIN_PATH, THREAD_GONE_MESSAGE, ChatPage, ThreadListOverlay, chatFetch, readChatResponse,
  // T-161 — 초안 검토 카드의 대화 소속(ⓑ)·전송 뒤 재조회 실패 문구
  DRAFT_THREAD_GONE_MESSAGE, SENT_NOTICE_PREFIX, SENT_RELOAD_FAILED_PREFIX, SENT_TO_OTHER_THREAD_MESSAGE,
  sentReloadFailedMessage,
} from '@/app/ai/ChatPage';

// ─── fetch · window 모킹 ────────────────────────────────────────────────────
const HTML = Symbol('html');
type Spec = { status: number; body: unknown } | Promise<{ status: number; body: unknown }>;
let routes: Record<string, Spec | Spec[]> = {};
const calls: string[] = [];
const resp = (status: number, body: unknown) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => {
    if (body === HTML) throw new SyntaxError('Unexpected token < in JSON at position 0');
    return body;
  },
});
const fetchMock = jest.fn(async (url: string, init?: { method?: string }) => {
  const key = `${init?.method ?? 'GET'} ${url}`;
  calls.push(key);
  const r = routes[key];
  if (r === undefined) throw new TypeError(`no route ${key}`);
  const spec = Array.isArray(r) ? (r.length > 1 ? r.shift()! : r[0]) : r;
  const s = await spec;
  return resp(s.status, s.body);
});
const replace = jest.fn();
const confirmMock = jest.fn(() => true);
const G = globalThis as unknown as Record<string, unknown>;
G.fetch = fetchMock;
G.window = { location: { replace } };
G.confirm = confirmMock;

const T = (id: number, title = `대화${id}`) => ({ id, title, symbol: null, updatedAt: '2026-11-06T00:00:00Z', messageCount: 1, archived: false });
const M = (id: number, content: string) => ({ id, role: 'user', content, createdAt: '2026-11-06T00:00:00Z' });
const MODELS = { ok: true, provider: 'claude', models: [{ id: 'sonnet', label: 'Sonnet' }], fixed: false, default: 'sonnet' };

beforeEach(() => {
  routes = {};
  calls.length = 0;
  fetchMock.mockClear();
  replace.mockClear();
  confirmMock.mockClear();
  confirmMock.mockImplementation(() => true);
});

// ─── 하네스 ─────────────────────────────────────────────────────────────────
type El = { type: unknown; props: Record<string, any> & { children?: unknown } };
const isEl = (n: unknown): n is El => !!n && typeof n === 'object' && 'props' in (n as object);
const typeName = (el: El) => (typeof el.type === 'function' ? (el.type as { name?: string }).name : el.type);
function findAll(n: unknown, pred: (el: El) => boolean, out: El[] = []): El[] {
  if (Array.isArray(n)) { n.forEach((x) => findAll(x, pred, out)); return out; }
  if (!isEl(n)) return out;
  if (pred(n)) out.push(n);
  findAll(n.props.children, pred, out);
  return out;
}
const flush = async () => { for (let k = 0; k < 4; k++) await new Promise((r) => setImmediate(r)); };

function mount() {
  const fiber: Fiber = { slots: [] };
  let tree: unknown = null;
  const render = () => {
    H.fiber = fiber; H.i = 0; H.effects = [];
    try { tree = ChatPage(); } finally { H.fiber = null; }
    const effs = H.effects; H.effects = [];
    for (const e of effs) {
      const slot = fiber.slots[e.i] as EffSlot;
      slot.cleanup?.();
      const c = e.fn();
      slot.cleanup = typeof c === 'function' ? (c as () => void) : undefined;
    }
    return tree;
  };
  /** 렌더 → 대기를 몇 번 — effect 는 deps 가 바뀔 때만 다시 돈다. */
  const settle = async () => { for (let k = 0; k < 4; k++) { render(); await flush(); } return render(); };
  const errorBars = () => findAll(render(), (el) => typeName(el) === 'ChatErrorBar').map((el) => el.props.message as string);
  const messages = () => findAll(render(), (el) => typeName(el) === 'MessageItem').map((el) => el.props.message.content as string);
  const overlay = async () => {
    let o = findAll(render(), (el) => el.type === ThreadListOverlay)[0];
    if (!o) {
      findAll(render(), (el) => el.type === 'button' && el.props['aria-label'] === '대화 목록')[0].props.onClick();
      o = findAll(await settle(), (el) => el.type === ThreadListOverlay)[0];
    }
    return o.props;
  };
  return { render, settle, errorBars, messages, overlay };
}

// ─── ① ② 응답 분류 ─────────────────────────────────────────────────────────
describe('readChatResponse — 401 · 404 · 오류 · 정상', () => {
  test('401 은 본문과 관계없이 unauthorized', async () => {
    expect(await readChatResponse(resp(401, { ok: false, error: 'unauthorized' }), '응답 실패')).toEqual({ kind: 'unauthorized' });
    expect(await readChatResponse(resp(401, HTML), '응답 실패')).toEqual({ kind: 'unauthorized' });
  });
  test('404 → not_found (서버 error 우선, 비JSON 이면 기본 문구)', async () => {
    expect(await readChatResponse(resp(404, { ok: false, error: 'thread not found' }), '메시지 조회 실패')).toEqual({ kind: 'not_found', error: 'thread not found' });
    expect(await readChatResponse(resp(404, HTML), '메시지 조회 실패')).toEqual({ kind: 'not_found', error: '메시지 조회 실패 (HTTP 404)' });
  });
  test('5xx·비JSON·ok:true 아님 → error (던지지 않음)', async () => {
    expect(await readChatResponse(resp(500, HTML), '응답 실패')).toEqual({ kind: 'error', error: '응답 실패 (HTTP 500)' });
    expect(await readChatResponse(resp(502, { ok: false }), '응답 실패')).toEqual({ kind: 'error', error: '응답 실패 (HTTP 502)' });
    expect(await readChatResponse(resp(503, { ok: false, error: 'unsafe identifier' }), '응답 실패')).toEqual({ kind: 'error', error: 'unsafe identifier' });
    expect(await readChatResponse(resp(200, HTML), '삭제 실패')).toEqual({ kind: 'error', error: '삭제 실패 (HTTP 200)' });
    expect(await readChatResponse(resp(200, { ok: false, error: 'content required' }), '정제 실패')).toEqual({ kind: 'error', error: 'content required' });
    expect(await readChatResponse(resp(200, null), '응답 실패')).toEqual({ kind: 'error', error: '응답 실패 (HTTP 200)' });
  });
  test('200 + ok:true → ok(본문 그대로)', async () => {
    expect(await readChatResponse(resp(200, { ok: true, id: 3 }), '스레드 생성 실패')).toEqual({ kind: 'ok', body: { ok: true, id: 3 } });
  });
});

describe('chatFetch — 401 이면 로그인 이동, 네트워크 오류는 error', () => {
  test('로그인 주소는 /login?next=%2Fai', () => {
    expect(CHAT_LOGIN_PATH).toBe('/login?next=%2Fai');
    expect(decodeURIComponent(CHAT_LOGIN_PATH.split('next=')[1])).toBe('/ai');
  });
  test('401 → window.location.replace(로그인)', async () => {
    routes['GET /api/chat/threads'] = { status: 401, body: { ok: false, error: 'unauthorized' } };
    expect(await chatFetch('/api/chat/threads', '대화 목록 조회 실패')).toEqual({ kind: 'unauthorized' });
    expect(replace).toHaveBeenCalledWith('/login?next=%2Fai');
  });
  test('fetch 가 던지면 error(String(e)) — 이동 없음', async () => {
    const r = await chatFetch('/api/없음', '응답 실패');
    expect(r).toEqual({ kind: 'error', error: 'TypeError: no route GET /api/없음' });
    expect(replace).not.toHaveBeenCalled();
  });
});

// ─── 화면 ──────────────────────────────────────────────────────────────────
describe('ChatPage — 처음 불러오기', () => {
  test('정상: 대화 목록·모델 정보, 오류 띠 없음', async () => {
    routes['GET /api/chat/threads'] = { status: 200, body: { ok: true, threads: [T(1), T(2)] } };
    routes['GET /api/chat/models'] = { status: 200, body: MODELS };
    const p = mount();
    await p.settle();
    expect(p.errorBars()).toEqual([]);
    expect((await p.overlay()).threads.map((t: { id: number }) => t.id)).toEqual([1, 2]);
    expect(replace).not.toHaveBeenCalled();
  });
  test('① 401 → 로그인 화면으로 이동, 오류 띠 없음', async () => {
    routes['GET /api/chat/threads'] = { status: 401, body: { ok: false, error: 'unauthorized' } };
    routes['GET /api/chat/models'] = { status: 401, body: { ok: false, error: 'unauthorized' } };
    const p = mount();
    await p.settle();
    expect(replace).toHaveBeenCalledWith('/login?next=%2Fai');
    expect(p.errorBars()).toEqual([]);
  });
  test('② 목록 500(HTML) → 오류 띠 「대화 목록 조회 실패 (HTTP 500)」 — 조용히 멈추지 않는다', async () => {
    routes['GET /api/chat/threads'] = { status: 500, body: HTML };
    routes['GET /api/chat/models'] = { status: 200, body: MODELS };
    const p = mount();
    await p.settle();
    expect(p.errorBars()).toEqual(['대화 목록 조회 실패 (HTTP 500)']);
  });
});

describe('ChatPage — ③ 메시지 조회', () => {
  const base = () => {
    routes['GET /api/chat/threads'] = [{ status: 200, body: { ok: true, threads: [T(7), T(8)] } }, { status: 200, body: { ok: true, threads: [T(7)] } }];
    routes['GET /api/chat/models'] = { status: 200, body: MODELS };
    routes['GET /api/chat/threads/7/messages'] = { status: 200, body: { ok: true, messages: [M(1, '첫 대화 질문'), M(2, '첫 대화 답')] } };
  };
  test('정상: 고른 대화의 메시지를 보인다', async () => {
    base();
    const p = mount();
    await p.settle();
    (await p.overlay()).onSelect(7);
    await p.settle();
    expect(p.messages()).toEqual(['첫 대화 질문', '첫 대화 답']);
    expect(p.errorBars()).toEqual([]);
  });
  test('404 → 선택 해제 · 이전 대화 메시지 비움 · 목록 재조회 · 안내', async () => {
    base();
    routes['GET /api/chat/threads/8/messages'] = { status: 404, body: { ok: false, error: 'thread not found' } };
    const p = mount();
    await p.settle();
    (await p.overlay()).onSelect(7);
    await p.settle();
    expect(p.messages()).toHaveLength(2);
    (await p.overlay()).onSelect(8);
    await p.settle();
    expect(p.messages()).toEqual([]);
    expect(p.errorBars()).toEqual([THREAD_GONE_MESSAGE]);
    expect(calls.filter((c) => c === 'GET /api/chat/threads')).toHaveLength(2);
    const o = await p.overlay();
    expect(o.activeId).toBeNull();
    expect(o.threads.map((t: { id: number }) => t.id)).toEqual([7]);
    expect(o.error).toBe(THREAD_GONE_MESSAGE);
  });
  test('5xx → 이전 대화 메시지를 남기지 않고 오류 띠(선택은 유지)', async () => {
    base();
    routes['GET /api/chat/threads/8/messages'] = { status: 502, body: HTML };
    const p = mount();
    await p.settle();
    (await p.overlay()).onSelect(7);
    await p.settle();
    (await p.overlay()).onSelect(8);
    await p.settle();
    expect(p.messages()).toEqual([]);
    expect(p.errorBars()).toEqual(['메시지 조회 실패 (HTTP 502)']);
    expect((await p.overlay()).activeId).toBe(8);
  });
  test('늦게 온 이전 대화 응답은 버린다', async () => {
    base();
    let release!: (v: { status: number; body: unknown }) => void;
    routes['GET /api/chat/threads/7/messages'] = new Promise((r) => { release = r; });
    routes['GET /api/chat/threads/8/messages'] = { status: 200, body: { ok: true, messages: [M(9, '두 번째 대화')] } };
    const p = mount();
    await p.settle();
    (await p.overlay()).onSelect(7);
    await p.settle();
    (await p.overlay()).onSelect(8);
    await p.settle();
    release({ status: 200, body: { ok: true, messages: [M(1, '첫 대화 질문')] } });
    await p.settle();
    expect(p.messages()).toEqual(['두 번째 대화']);
  });
});

describe('ChatPage — ④ 삭제는 ok:true 뒤에만 목록에서 뺀다', () => {
  const base = () => {
    routes['GET /api/chat/threads'] = { status: 200, body: { ok: true, threads: [T(1), T(2)] } };
    routes['GET /api/chat/models'] = { status: 200, body: MODELS };
    routes['GET /api/chat/threads/1/messages'] = { status: 200, body: { ok: true, messages: [M(1, '질문')] } };
  };
  const ids = async (p: ReturnType<typeof mount>) => (await p.overlay()).threads.map((t: { id: number }) => t.id);

  test('ok:true → 목록에서 제거, 보고 있던 대화면 선택 해제·메시지 비움', async () => {
    base();
    routes['DELETE /api/chat/threads/1'] = { status: 200, body: { ok: true } };
    const p = mount();
    await p.settle();
    (await p.overlay()).onSelect(1);
    await p.settle();
    expect(p.messages()).toEqual(['질문']);
    await (await p.overlay()).onDelete(1);
    await p.settle();
    expect(await ids(p)).toEqual([2]);
    expect((await p.overlay()).activeId).toBeNull();
    expect(p.messages()).toEqual([]);
    expect((await p.overlay()).error).toBeNull();
  });
  test.each([
    ['500 JSON', { status: 500, body: { ok: false, error: 'db down' } }, 'db down'],
    ['502 HTML', { status: 502, body: HTML }, '삭제 실패 (HTTP 502)'],
    ['200 비JSON', { status: 200, body: HTML }, '삭제 실패 (HTTP 200)'],
    ['200 ok:false', { status: 200, body: { ok: false } }, '삭제 실패 (HTTP 200)'],
  ])('실패(%s) → 목록 그대로 · 대화 목록 안에 오류 띠', async (_n, spec, msg) => {
    base();
    routes['DELETE /api/chat/threads/1'] = spec as Spec;
    const p = mount();
    await p.settle();
    await (await p.overlay()).onDelete(1);
    await p.settle();
    expect(await ids(p)).toEqual([1, 2]);
    expect((await p.overlay()).error).toBe(msg);
    expect(p.errorBars()).toEqual([]); // 목록이 열려 있으면 바깥 띠는 숨김(목록 안 띠 하나)
  });
  test('네트워크 오류 → 목록 그대로 · 오류', async () => {
    base();
    const p = mount();
    await p.settle();
    await (await p.overlay()).onDelete(2); // DELETE 경로 없음 → fetch 가 던진다
    await p.settle();
    expect(await ids(p)).toEqual([1, 2]);
    expect((await p.overlay()).error).toBe('TypeError: no route DELETE /api/chat/threads/2');
  });
  test('404 → 목록 재조회 · 안내(서버에 없는 대화)', async () => {
    base();
    routes['GET /api/chat/threads'] = [{ status: 200, body: { ok: true, threads: [T(1), T(2)] } }, { status: 200, body: { ok: true, threads: [T(2)] } }];
    routes['DELETE /api/chat/threads/1'] = { status: 404, body: { ok: false, error: 'thread not found' } };
    const p = mount();
    await p.settle();
    await (await p.overlay()).onDelete(1);
    await p.settle();
    expect(await ids(p)).toEqual([2]);
    expect((await p.overlay()).error).toBe(THREAD_GONE_MESSAGE);
  });
  test('401 → 로그인 이동, 목록 그대로', async () => {
    base();
    routes['DELETE /api/chat/threads/1'] = { status: 401, body: { ok: false, error: 'unauthorized' } };
    const p = mount();
    await p.settle();
    await (await p.overlay()).onDelete(1);
    await p.settle();
    expect(replace).toHaveBeenCalledWith('/login?next=%2Fai');
    expect(await ids(p)).toEqual([1, 2]);
  });
  test('확인 대화상자에서 취소하면 요청하지 않는다', async () => {
    base();
    confirmMock.mockImplementation(() => false);
    const p = mount();
    await p.settle();
    await (await p.overlay()).onDelete(1);
    expect(calls.some((c) => c.startsWith('DELETE'))).toBe(false);
  });
});

describe('ChatPage — ⑤ 보내기(정제 단계) 흐름', () => {
  const base = () => {
    routes['GET /api/chat/threads'] = { status: 200, body: { ok: true, threads: [] } };
    routes['GET /api/chat/models'] = { status: 200, body: MODELS };
  };
  const composer = (p: ReturnType<typeof mount>) => findAll(p.render(), (el) => typeName(el) === 'Composer')[0]?.props;
  const review = (p: ReturnType<typeof mount>) => findAll(p.render(), (el) => typeName(el) === 'DraftReview')[0]?.props;

  test('정상: 새 대화 만들기 → 정제 요청 → 검토 단계', async () => {
    base();
    routes['POST /api/chat/threads'] = { status: 200, body: { ok: true, id: 5 } };
    routes['GET /api/chat/threads/5/messages'] = { status: 200, body: { ok: true, messages: [] } };
    routes['POST /api/chat/threads/5/draft'] = { status: 200, body: { ok: true, draftPrompt: '정제됨', attachedContext: [], draftProvider: 'claude', draftModel: 'sonnet', draftLatencyMs: 10 } };
    const p = mount();
    await p.settle();
    composer(p).onInputChange('삼성전자 어때?');
    await p.settle();
    await composer(p).onSend();
    await p.settle();
    expect(review(p)?.prompt).toBe('정제됨');
    expect(p.errorBars()).toEqual([]);
  });
  test('대화 만들기 401 → 로그인 이동, 정제 요청 없음', async () => {
    base();
    routes['POST /api/chat/threads'] = { status: 401, body: { ok: false, error: 'unauthorized' } };
    const p = mount();
    await p.settle();
    composer(p).onInputChange('질문');
    await p.settle();
    await composer(p).onSend();
    await p.settle();
    expect(replace).toHaveBeenCalledWith('/login?next=%2Fai');
    expect(calls.some((c) => c.endsWith('/draft'))).toBe(false);
    expect(p.errorBars()).toEqual([]);
  });
  test('대화 만들기 500(HTML) → 「스레드 생성 실패」', async () => {
    base();
    routes['POST /api/chat/threads'] = { status: 500, body: HTML };
    const p = mount();
    await p.settle();
    composer(p).onInputChange('질문');
    await p.settle();
    await composer(p).onSend();
    await p.settle();
    expect(p.errorBars()).toEqual(['스레드 생성 실패']);
    expect(composer(p).disabled).toBe(false);
  });
  test('정제 500(HTML) → 오류 띠 · 입력 단계로 돌아온다', async () => {
    base();
    routes['POST /api/chat/threads'] = { status: 200, body: { ok: true, id: 5 } };
    routes['GET /api/chat/threads/5/messages'] = { status: 200, body: { ok: true, messages: [] } };
    routes['POST /api/chat/threads/5/draft'] = { status: 500, body: HTML };
    const p = mount();
    await p.settle();
    composer(p).onInputChange('질문');
    await p.settle();
    await composer(p).onSend();
    await p.settle();
    expect(p.errorBars()).toEqual(['정제 실패 (HTTP 500)']);
    expect(composer(p).disabled).toBe(false);
    expect(composer(p).input).toBe('질문');
  });
});

// ─── ⑥ 대화 전환 뒤 늦게 도착한 송신·확정 응답 (QA 결함 #1 회귀) ──────────────
describe('ChatPage — ⑥ 늦게 도착한 송신·확정 응답은 전환한 대화 화면을 덮지 않는다', () => {
  const composer = (p: ReturnType<typeof mount>) => findAll(p.render(), (el) => typeName(el) === 'Composer')[0]?.props;
  const review = (p: ReturnType<typeof mount>) => findAll(p.render(), (el) => typeName(el) === 'DraftReview')[0]?.props;
  /** 대화 7 = 보내던 대화(메시지 조회 1회차 = 처음 로드, 2회차 = 전송 뒤 재조회), 대화 8 = 옮겨 갈 대화. */
  const base = () => {
    routes['GET /api/chat/threads'] = { status: 200, body: { ok: true, threads: [T(7), T(8)] } };
    routes['GET /api/chat/models'] = { status: 200, body: MODELS };
    routes['GET /api/chat/threads/7/messages'] = [
      { status: 200, body: { ok: true, messages: [M(1, '첫 질문')] } },
      { status: 200, body: { ok: true, messages: [M(1, '첫 질문'), M(2, '직진 질문'), M(3, '직진 답')] } },
    ];
    routes['GET /api/chat/threads/8/messages'] = { status: 200, body: { ok: true, messages: [M(9, 'B 질문')] } };
  };
  /** 보류용 — 응답을 테스트가 원할 때 돌려준다(전송 지연 모의). */
  const pending = () => { let release!: (v: { status: number; body: unknown }) => void; const q = new Promise<{ status: number; body: unknown }>((r) => { release = r; }); return { q, release }; };
  const reloads = () => calls.filter((c) => c === 'GET /api/chat/threads/7/messages').length;

  test('직진(skipDraft) 송신 — 대화 8 로 옮긴 뒤 도착한 응답이 메시지를 바꾸지 않는다', async () => {
    base();
    const sent = pending();
    routes['POST /api/chat/threads/7/messages'] = sent.q;
    const p = mount();
    await p.settle();
    composer(p).onToggleSkipDraft();                 // 직진 모드
    (await p.overlay()).onSelect(7);
    await p.settle();
    composer(p).onInputChange('직진 질문');
    await p.settle();
    const sending = composer(p).onSend();            // 응답 보류 — 기다리지 않는다
    await p.settle();
    expect(p.messages()).toEqual(['첫 질문']);
    (await p.overlay()).onSelect(8);                 // 대화 8 선택
    await p.settle();
    expect(p.messages()).toEqual(['B 질문']);
    sent.release({ status: 200, body: { ok: true } }); // 보류 응답 도착
    await sending;
    await p.settle();
    expect(reloads()).toBe(2);                       // 재조회는 실제로 했다 — 결과만 버렸다
    expect(p.messages()).toEqual(['B 질문']);        // 전환한 대화 화면 그대로
    expect(p.errorBars()).toEqual([]);
    expect((await p.overlay()).activeId).toBe(8);
  });

  test('확정 전송(2단계) — 대화 8 로 옮긴 뒤 도착한 응답이 메시지를 바꾸지 않는다', async () => {
    base();
    routes['POST /api/chat/threads/7/draft'] = { status: 200, body: { ok: true, draftPrompt: '정제됨', attachedContext: [], draftProvider: 'claude', draftModel: 'sonnet', draftLatencyMs: 10 } };
    const sent = pending();
    routes['POST /api/chat/threads/7/messages'] = sent.q;
    const p = mount();
    await p.settle();
    (await p.overlay()).onSelect(7);
    await p.settle();
    composer(p).onInputChange('확정 질문');
    await p.settle();
    await composer(p).onSend();                      // 정제 → 검토 단계
    await p.settle();
    expect(review(p)?.prompt).toBe('정제됨');
    const sending = review(p).onConfirm();            // 확정 전송 — 응답 보류
    await p.settle();
    (await p.overlay()).onSelect(8);
    await p.settle();
    expect(p.messages()).toEqual(['B 질문']);
    sent.release({ status: 200, body: { ok: true } });
    await sending;
    await p.settle();
    expect(reloads()).toBe(2);
    expect(p.messages()).toEqual(['B 질문']);
    // T-161 — 확정 전송은 **초안을 만든 대화(7)** 로 가므로, 8 을 보는 중이면 어디에 저장했는지 알린다(ⓑ).
    // T-157 에서도 전송은 클릭 시점의 대화(7)로 갔다(이 시험은 `POST …/7/messages` 만 모의한다) —
    // 달라진 것은 「어디에 저장했는지 알린다」뿐이라 그때는 띠가 없었다.
    // 이 단언이 away 를 **응답이 온 뒤**에 판정하는 것을 지키는 유일한 시험이다(Reviewer 질문 1).
    expect(p.errorBars()).toEqual([SENT_TO_OTHER_THREAD_MESSAGE('대화7')]);
    expect((await p.overlay()).activeId).toBe(8);
  });

  test('같은 대화에 머물면 재조회 결과를 반영하고 보낸 글을 입력칸에서 지운다', async () => {
    base();
    routes['POST /api/chat/threads/7/messages'] = { status: 200, body: { ok: true } };
    const p = mount();
    await p.settle();
    composer(p).onToggleSkipDraft();
    (await p.overlay()).onSelect(7);
    await p.settle();
    composer(p).onInputChange('직진 질문');
    await p.settle();
    await composer(p).onSend();
    await p.settle();
    expect(p.messages()).toEqual(['첫 질문', '직진 질문', '직진 답']);
    expect(composer(p).input).toBe('');
    expect(p.errorBars()).toEqual([]);
  });

  test('전송 중 입력칸 내용이 달라지면 그 내용은 지우지 않는다(보낸 글만 지운다)', async () => {
    // 실 UI 는 전송 중 입력칸을 막지만(Composer disabled), 가드가 그 UI 상태에 기대지 않는다는 것을 고정한다.
    base();
    const sent = pending();
    routes['POST /api/chat/threads/7/messages'] = sent.q;
    const p = mount();
    await p.settle();
    composer(p).onToggleSkipDraft();
    (await p.overlay()).onSelect(7);
    await p.settle();
    composer(p).onInputChange('직진 질문');
    await p.settle();
    const sending = composer(p).onSend();
    await p.settle();
    composer(p).onInputChange('다음에 쓸 글');
    await p.settle();
    sent.release({ status: 200, body: { ok: true } });
    await sending;
    await p.settle();
    expect(p.messages()).toEqual(['첫 질문', '직진 질문', '직진 답']);  // 같은 대화라 반영
    expect(composer(p).input).toBe('다음에 쓸 글');
  });
});

describe('ThreadListOverlay — 오류 띠(기존 모양)', () => {
  test('error 가 있으면 목록 안에 role=alert 띠, 없으면 없음', () => {
    const props = { threads: [T(1)], activeId: null, onSelect: () => {}, onDelete: () => {}, onClose: () => {}, onNew: () => {} };
    const withErr = renderToStaticMarkup(h(ThreadListOverlay, { ...props, error: 'db down', onDismissError: () => {} }));
    expect(withErr).toContain('<div role="alert" style="padding:8px;background:rgba(239,68,68,.15);color:var(--down);font-size:12px;text-align:center">db down');
    expect(renderToStaticMarkup(h(ThreadListOverlay, props))).not.toContain('role="alert"');
  });
});

// ─── ⑦ 같은 대화 안의 조회 순서 역전 (Codex C2 지적 1 회귀) ────────────────────
/**
 * 최초 메시지 조회(L1)가 보류된 동안 **같은 대화에서** 전송과 재조회(L2)가 먼저 끝나면, 뒤늦게 온 L1 이
 * 방금 받은 메시지를 지우거나(실패) 오래된 스냅샷으로 되돌린다(성공). `activeIdRef` 가드는 대화 **ID** 를
 * 비교하므로 ID 가 같은 이 경합을 통과한다 — 그래서 요청 **순번**(`msgSeqRef`)이 따로 필요하다.
 * 도달 가능한 이유: 메시지 조회는 `stage` 를 바꾸지 않고 Composer 비활성 조건은 `stage !== 'idle'` 하나뿐이라
 * **조회 중에도 전송할 수 있다**(아래 첫 두 시험이 보류 중 `onSend()` 로 그 사실을 함께 고정한다).
 * 「조회 실패 → `setMessages([])` + 오류 띠」 분기는 T-157 이 더한 것이라 이 회귀도 T-157 소관이다.
 */
describe('ChatPage — ⑦ 같은 대화의 늦게 끝난 옛 조회가 최신 메시지를 덮지 않는다', () => {
  const composer = (p: ReturnType<typeof mount>) => findAll(p.render(), (el) => typeName(el) === 'Composer')[0]?.props;
  const pending = () => { let release!: (v: { status: number; body: unknown }) => void; const q = new Promise<{ status: number; body: unknown }>((r) => { release = r; }); return { q, release }; };
  const gets = () => calls.filter((c) => c === 'GET /api/chat/threads/7/messages').length;
  const AFTER_SEND = ['첫 질문', '새 질문', '새 답'];

  /** L1 = 보류되는 최초 조회, L2 = 전송 뒤 재조회(전송 결과가 담긴 최신 스냅샷). */
  const base = (l1: Promise<{ status: number; body: unknown }>) => {
    routes['GET /api/chat/threads'] = { status: 200, body: { ok: true, threads: [T(7)] } };
    routes['GET /api/chat/models'] = { status: 200, body: MODELS };
    routes['POST /api/chat/threads/7/messages'] = { status: 200, body: { ok: true } };
    routes['GET /api/chat/threads/7/messages'] = [
      l1,
      { status: 200, body: { ok: true, messages: [M(1, '첫 질문'), M(2, '새 질문'), M(3, '새 답')] } },
    ];
  };

  /** 최초 조회를 보류시킨 채 직진 전송까지 끝낸 상태를 만든다. */
  const sendWhileLoading = async (l1: Promise<{ status: number; body: unknown }>) => {
    base(l1);
    const p = mount();
    await p.settle();
    composer(p).onToggleSkipDraft();                  // 직진 모드 — 정제 단계 없이 바로 본 응답
    (await p.overlay()).onSelect(7);                  // L1 시작 — 보류된다
    await p.settle();
    expect(p.messages()).toEqual([]);                 // L1 이 아직 안 끝났다
    expect(composer(p).disabled).toBe(false);         // 조회 중에도 전송할 수 있다(도달 가능 근거)
    composer(p).onInputChange('새 질문');
    await p.settle();
    await composer(p).onSend();                       // POST → L2 재조회까지 완료
    await p.settle();
    expect(p.messages()).toEqual(AFTER_SEND);         // 최신 결과가 화면에 있다
    expect(gets()).toBe(2);                           // L1·L2 둘 다 실제로 보냈다
    return p;
  };

  test('뒤늦게 온 L1 이 502 로 끝나도 메시지가 지워지지 않고 가짜 오류 띠가 뜨지 않는다', async () => {
    const l1 = pending();
    const p = await sendWhileLoading(l1.q);
    l1.release({ status: 502, body: HTML });           // 보류됐던 최초 조회가 실패로 끝난다
    await p.settle();
    expect(p.messages()).toEqual(AFTER_SEND);
    expect(p.errorBars()).toEqual([]);
    expect(gets()).toBe(2);                            // 추가 조회 없음 — 결과만 버렸다
  });

  test('뒤늦게 온 L1 이 200 + 오래된 스냅샷이어도 화면이 되돌아가지 않는다', async () => {
    const l1 = pending();
    const p = await sendWhileLoading(l1.q);
    l1.release({ status: 200, body: { ok: true, messages: [M(1, '첫 질문')] } }); // 전송 전 스냅샷
    await p.settle();
    expect(p.messages()).toEqual(AFTER_SEND);
    expect(p.errorBars()).toEqual([]);
  });

  test('겹치지 않은 단독 조회 실패는 **여전히** 메시지를 비우고 오류 띠를 띄운다(가드가 정당한 오류를 삼키지 않는다)', async () => {
    routes['GET /api/chat/threads'] = { status: 200, body: { ok: true, threads: [T(7)] } };
    routes['GET /api/chat/models'] = { status: 200, body: MODELS };
    routes['GET /api/chat/threads/7/messages'] = { status: 502, body: HTML };
    const p = mount();
    await p.settle();
    (await p.overlay()).onSelect(7);
    await p.settle();
    expect(p.messages()).toEqual([]);
    expect(p.errorBars()).toEqual(['메시지 조회 실패 (HTTP 502)']);
  });

  /**
   * 반대 방향 — 늦게 끝나는 쪽이 **재조회**(`reloadMessages`)이고 최신은 로드 effect 인 경우.
   * 대화를 떠났다 돌아오면 `activeIdRef` 가 다시 같은 ID 라 ID 가드를 통과한다. 순번 가드가 없으면
   * 보류됐던 재조회의 오래된 스냅샷이 방금 읽은 최신 메시지를 덮는다. (앞 세 시험은 로드 effect 쪽
   * 가드만 보므로, `reloadMessages` 쪽 가드는 이 시험이 지킨다.)
   */
  test('떠났다 돌아온 뒤 도착한 옛 재조회가 다시 읽은 최신 메시지를 덮지 않는다', async () => {
    const l2 = pending();
    routes['GET /api/chat/threads'] = { status: 200, body: { ok: true, threads: [T(7), T(8)] } };
    routes['GET /api/chat/models'] = { status: 200, body: MODELS };
    routes['POST /api/chat/threads/7/messages'] = { status: 200, body: { ok: true } };
    routes['GET /api/chat/threads/8/messages'] = { status: 200, body: { ok: true, messages: [M(9, 'B 질문')] } };
    routes['GET /api/chat/threads/7/messages'] = [
      { status: 200, body: { ok: true, messages: [M(1, '첫 질문')] } },                       // L1a 최초 로드
      l2.q,                                                                                   // L2 전송 뒤 재조회 — 보류
      { status: 200, body: { ok: true, messages: [M(1, '첫 질문'), M(2, '새 질문'), M(3, '새 답')] } }, // L1b 돌아와서 다시 읽기(최신)
    ];
    const p = mount();
    await p.settle();
    composer(p).onToggleSkipDraft();
    (await p.overlay()).onSelect(7);
    await p.settle();
    expect(p.messages()).toEqual(['첫 질문']);
    composer(p).onInputChange('새 질문');
    await p.settle();
    const sending = composer(p).onSend();             // POST 성공 → L2 재조회가 보류된다(기다리지 않는다)
    await p.settle();
    (await p.overlay()).onSelect(8);                  // 대화 8 로
    await p.settle();
    expect(p.messages()).toEqual(['B 질문']);
    (await p.overlay()).onSelect(7);                  // 다시 7 로 — L1b 가 최신 결과를 읽는다
    await p.settle();
    expect(p.messages()).toEqual(AFTER_SEND);
    l2.release({ status: 200, body: { ok: true, messages: [M(1, '첫 질문')] } }); // 보류됐던 옛 재조회가 이제 끝난다
    await sending;
    await p.settle();
    expect(p.messages()).toEqual(AFTER_SEND);         // ID 는 같지만 순번이 낡아 버려진다
    expect(p.errorBars()).toEqual([]);
  });
});

// ─── ⑧ 비활성 대화의 재조회가 활성 대화의 조회를 무효화하지 않는다 (라운드 5 회귀) ───
/**
 * ⑦ 의 순번 가드를 **대화와 무관한 전역 카운터**로 두면, 어차피 버려질 비활성 대화의 재조회가 시작할 때
 * 순번을 올려 **활성 대화의 진행 중 조회까지** 순번 불일치로 버리게 만든다. 그러면 재조회는 ID 가드로,
 * 활성 조회는 순번 가드로 각각 버려져 **아무도 화면을 쓰지 않고** 옛 대화의 메시지가 남는다(오류 띠도 없다).
 * 그래서 순번은 **활성 대화의 조회에만** 매긴다(`seq = activeIdRef.current === tid ? ++… : -1`).
 * 두 시험은 같은 상황에서 **끝나는 순서만** 다르다 — 대조(E8 먼저)는 가드가 있든 없든 통과해야 한다(과차단 확인용).
 */
describe('ChatPage — ⑧ 버려질 재조회가 현재 대화의 진행 중 조회를 무효화하지 않는다', () => {
  const composer = (p: ReturnType<typeof mount>) => findAll(p.render(), (el) => typeName(el) === 'Composer')[0]?.props;
  const pending = () => { let release!: (v: { status: number; body: unknown }) => void; const q = new Promise<{ status: number; body: unknown }>((r) => { release = r; }); return { q, release }; };
  const gets7 = () => calls.filter((c) => c === 'GET /api/chat/threads/7/messages').length;

  /**
   * 대화 7 에서 직진 전송(POST 보류) → 대기 중 대화 8 선택(조회 E8 보류) → 끝나는 순서를 인자로 정한다.
   *  - `POST_FIRST`: E8 이 진행 중일 때 7번 POST 가 끝나 재조회 R7 이 시작·종료한다(회귀 재현 순서).
   *  - `E8_FIRST`  : E8 이 먼저 끝난다(대조 — 평범한 순서).
   */
  const scenario = async (order: 'POST_FIRST' | 'E8_FIRST') => {
    routes['GET /api/chat/threads'] = { status: 200, body: { ok: true, threads: [T(7), T(8)] } };
    routes['GET /api/chat/models'] = { status: 200, body: MODELS };
    routes['GET /api/chat/threads/7/messages'] = [
      { status: 200, body: { ok: true, messages: [M(1, '첫 질문')] } },                                 // E7 최초 로드
      { status: 200, body: { ok: true, messages: [M(1, '첫 질문'), M(2, '새 질문'), M(3, '새 답')] } },  // R7 전송 뒤 재조회
    ];
    const e8 = pending();
    const post = pending();
    routes['GET /api/chat/threads/8/messages'] = e8.q;
    routes['POST /api/chat/threads/7/messages'] = post.q;
    const p = mount();
    await p.settle();
    composer(p).onToggleSkipDraft();
    (await p.overlay()).onSelect(7);
    await p.settle();
    expect(p.messages()).toEqual(['첫 질문']);
    composer(p).onInputChange('새 질문');
    await p.settle();
    const sending = composer(p).onSend();              // 7번 전송 — POST 보류(LLM 대기)
    await p.settle();
    (await p.overlay()).onSelect(8);                   // 대기 중 대화 8 선택 → E8 시작, 보류
    await p.settle();
    if (order === 'POST_FIRST') {
      post.release({ status: 200, body: { ok: true } });
      await sending;                                   // R7 시작·종료 — 여기서 순번을 올리면 안 된다
      await p.settle();
      e8.release({ status: 200, body: { ok: true, messages: [M(9, 'B 질문')] } });
    } else {
      e8.release({ status: 200, body: { ok: true, messages: [M(9, 'B 질문')] } });
      await p.settle();
      post.release({ status: 200, body: { ok: true } });
      await sending;
    }
    await p.settle();
    return { p, activeId: (await p.overlay()).activeId as number | null };
  };

  test('E8 진행 중에 7번 재조회가 끼어도 8번 결과가 화면에 들어온다(재현 순서)', async () => {
    const { p, activeId } = await scenario('POST_FIRST');
    expect(activeId).toBe(8);
    expect(p.messages()).toEqual(['B 질문']);          // 7번의 전송 전 내용이 남으면 회귀
    expect(p.errorBars()).toEqual([]);
    expect(gets7()).toBe(2);                           // 재조회는 실제로 했다 — 결과만 버렸다(⑥ 과 같은 보장)
  });

  test('대조: E8 이 먼저 끝나는 평범한 순서도 정상(가드가 과차단하지 않는다)', async () => {
    const { p, activeId } = await scenario('E8_FIRST');
    expect(activeId).toBe(8);
    expect(p.messages()).toEqual(['B 질문']);
    expect(p.errorBars()).toEqual([]);
    expect(gets7()).toBe(2);
  });
});

// ─── ⑨ 대화 ID 가드 자체의 회귀망 (순번으로는 걸리지 않는 경로) ─────────────
/**
 * ⑦⑧ 은 **순번** 가드를, 이 묶음은 **대화 ID** 가드(`activeIdRef.current !== tid` — QA 결함 #1 수정의 본체)를
 * 지킨다. 그 가드만 제거하면 ⑦⑧ 을 포함한 38건이 전부 통과해 수정 근거가 무검증으로 남았다(QA 실측).
 *
 * 순번으로는 걸리지 않고 **ID 로만** 걸리는 상태를 만드는 지점은 「+ 새 대화」다. 로드 effect 는
 * `if (activeThreadId == null) { setMessages([]); return; }` 로 **순번을 올리기 전에** 빠져나가므로,
 * `handleNewThread` 가 `activeIdRef.current` 를 null 로 바꿔도 **카운터는 그대로**다. 따라서 진행 중인
 * 재조회는 `msgSeqRef.current === seq`(순번 통과)이면서 `activeIdRef.current(null) !== tid`(ID 차단)가 된다.
 * ID 가드가 없으면 빈 새 대화 화면에 **옛 대화의 메시지가 부어지고**, 사용자는 그 본문을 믿고 쓴 글을
 * 새로 만들어질 대화에 저장하게 된다(QA 결함 #1 과 같은 계열).
 */
describe('ChatPage — ⑨ 「+ 새 대화」 중 도착한 재조회가 빈 화면을 옛 대화로 채우지 않는다', () => {
  const composer = (p: ReturnType<typeof mount>) => findAll(p.render(), (el) => typeName(el) === 'Composer')[0]?.props;
  const pending = () => { let release!: (v: { status: number; body: unknown }) => void; const q = new Promise<{ status: number; body: unknown }>((r) => { release = r; }); return { q, release }; };
  const gets7 = () => calls.filter((c) => c === 'GET /api/chat/threads/7/messages').length;
  const OLD7 = ['첫 질문', '새 질문', '새 답'];

  /** 대화 7 에 전송 → 재조회(R7)를 보류한 상태에서 「+ 새 대화」를 누른다. */
  const newThreadWhileReloading = async () => {
    routes['GET /api/chat/threads'] = { status: 200, body: { ok: true, threads: [T(7)] } };
    routes['GET /api/chat/models'] = { status: 200, body: MODELS };
    routes['POST /api/chat/threads/7/messages'] = { status: 200, body: { ok: true } };
    const r7 = pending();
    routes['GET /api/chat/threads/7/messages'] = [
      { status: 200, body: { ok: true, messages: [M(1, '첫 질문')] } },   // E7 최초 로드 — 순번 1
      r7.q,                                                              // R7 전송 뒤 재조회 — 순번 2, 보류
    ];
    const p = mount();
    await p.settle();
    composer(p).onToggleSkipDraft();
    (await p.overlay()).onSelect(7);
    await p.settle();
    expect(p.messages()).toEqual(['첫 질문']);
    composer(p).onInputChange('새 질문');
    await p.settle();
    const sending = composer(p).onSend();        // POST 는 바로 끝나고 R7(재조회)이 보류된다
    await p.settle();
    expect(gets7()).toBe(2);                     // R7 이 실제로 시작됐다(= 순번 2 를 이미 받았다)
    (await p.overlay()).onNew();                 // 「+ 새 대화」 — activeIdRef 는 null 이 되지만 순번은 그대로
    await p.settle();
    expect(p.messages()).toEqual([]);            // 빈 새 대화 화면
    return { p, r7, sending };
  };

  test('재조회가 200 으로 끝나도 옛 대화 메시지가 빈 화면에 들어오지 않는다', async () => {
    const { p, r7, sending } = await newThreadWhileReloading();
    r7.release({ status: 200, body: { ok: true, messages: OLD7.map((c, i) => M(i + 1, c)) } });
    await sending;
    await p.settle();
    expect(p.messages()).toEqual([]);                  // 옛 대화 내용이 부어지면 ID 가드 회귀
    expect(p.messages()).not.toEqual(OLD7);
    expect((await p.overlay()).activeId).toBeNull();   // 선택은 「새 대화」 그대로
    expect(p.errorBars()).toEqual([]);
  });

  test('재조회가 500 으로 끝나도 빈 새 대화 화면에 오류 띠를 띄우지 않는다', async () => {
    const { p, r7, sending } = await newThreadWhileReloading();
    r7.release({ status: 500, body: HTML });
    await sending;
    await p.settle();
    expect(p.messages()).toEqual([]);
    expect(p.errorBars()).toEqual([]);                 // 떠난 대화의 실패를 새 화면에 알리지 않는다
    expect((await p.overlay()).activeId).toBeNull();
  });
});

// ─── ⑩⑪ 나머지 두 가드의 회귀망 (Reviewer 라운드 7 — 단독 제거로 드러난 공백) ───
/**
 * ⑨ 가 메운 **대화 ID 가드** 말고도, 「활성 대화가 null 이 되는 전이」를 막는 가드가 둘 더 무검증이었다.
 * 그 전이는 `setActiveThreadId(null)` 세 곳(`handleThreadGone`·`handleNewThread`·`handleDeleteThread`)이
 * **공유**한다 — 로드 effect 가 `activeThreadId == null` 에서 **순번을 올리기 전에** 빠져나가므로 순번 가드가
 * 닿지 않는 틈이다(비-null 로 바꾸는 `ensureThread`·`onSelect` 는 effect 가 순번을 올려 순번이 막는다).
 *  - ⑩ 로드 effect 의 `if (stale) return;` — 대화 **전환**은 새 effect 가 순번을 올려 순번이 대신 막지만,
 *    「+ 새 대화」는 순번이 안 올라가 **`stale` 만** 막는다. 그래서 전환 시험으로는 이 가드가 드러나지 않는다.
 *  - ⑪ `handleThreadGone` 의 `if (activeIdRef.current === tid)` — 이 조건이 없으면 **보고 있지도 않은** 대화의
 *    404 가 내 선택과 메시지를 날린다. `handleThreadGone` 은 T-157 이 만든 함수라 그 가드의 시험도 T-157 몫이다.
 */
describe('ChatPage — ⑩ 로드 effect 의 stale 가드 (REV7b)', () => {
  const pending = () => { let release!: (v: { status: number; body: unknown }) => void; const q = new Promise<{ status: number; body: unknown }>((r) => { release = r; }); return { q, release }; };
  const btn = (p: ReturnType<typeof mount>, label: string) => findAll(p.render(), (el) => el.type === 'button' && el.props['aria-label'] === label)[0];

  test('최초 조회 보류 중 「+ 새 대화」 → 늦게 온 최초 조회가 빈 화면을 채우지 않는다', async () => {
    routes['GET /api/chat/threads'] = { status: 200, body: { ok: true, threads: [T(7)] } };
    routes['GET /api/chat/models'] = { status: 200, body: MODELS };
    const e7 = pending();
    routes['GET /api/chat/threads/7/messages'] = e7.q;
    const p = mount();
    await p.settle();
    (await p.overlay()).onSelect(7);
    await p.settle();
    expect(calls.filter((c) => c === 'GET /api/chat/threads/7/messages')).toHaveLength(1); // 최초 조회는 실제로 떠났다
    expect(p.messages()).toEqual([]);
    btn(p, '새 대화').props.onClick();            // 헤더의 + 버튼(= handleNewThread) — 순번은 올라가지 않는다
    await p.settle();
    expect(p.messages()).toEqual([]);
    e7.release({ status: 200, body: { ok: true, messages: [M(1, '옛 대화 질문')] } });
    await p.settle();
    expect(p.messages()).toEqual([]);              // 옛 대화 질문이 들어오면 stale 가드 회귀
    expect(p.messages()).not.toContain('옛 대화 질문');
    expect(p.errorBars()).toEqual([]);
  });
});

describe('ChatPage — ⑪ handleThreadGone 은 보고 있던 대화일 때만 선택을 해제한다 (REV7c)', () => {
  test('보고 있는 대화(7)가 아닌 대화(8)의 삭제가 404 여도 7번 선택·메시지가 유지된다', async () => {
    routes['GET /api/chat/threads'] = { status: 200, body: { ok: true, threads: [T(7), T(8)] } };
    routes['GET /api/chat/models'] = { status: 200, body: MODELS };
    routes['GET /api/chat/threads/7/messages'] = { status: 200, body: { ok: true, messages: [M(1, '첫 질문')] } };
    routes['DELETE /api/chat/threads/8'] = { status: 404, body: { ok: false, error: 'thread not found' } };
    const p = mount();
    await p.settle();
    (await p.overlay()).onSelect(7);
    await p.settle();
    expect(p.messages()).toEqual(['첫 질문']);
    await (await p.overlay()).onDelete(8);         // 남의 대화 삭제 → 404 → handleThreadGone(8)
    await p.settle();
    expect((await p.overlay()).activeId).toBe(7);  // 내 선택은 그대로
    expect(p.messages()).toEqual(['첫 질문']);     // 내 메시지도 그대로
    // 안내 띠는 대화와 무관하게 뜨는 것이 현재 설계다(없어진 대화를 알려 주고 목록을 다시 읽는다).
    // 목록이 열린 동안 바깥 ChatErrorBar 는 숨고 오버레이 안 띠로 보인다(기존 ④ 와 같은 단언 방식).
    expect((await p.overlay()).error).toBe(THREAD_GONE_MESSAGE);
    expect(p.errorBars()).toEqual([]);
    expect(calls.filter((c) => c === 'GET /api/chat/threads').length).toBeGreaterThanOrEqual(2); // 목록 재조회
  });
});

// ─── ⑫ T-161 초안 검토 카드의 대화 소속(ⓑ) · 전송 뒤 재조회 실패 문구 ──────────
/**
 * T-157 까지 `handleConfirmDraft` 는 **클릭 시점의 `activeThreadId`** 로 보냈다. 초안은 자기가 어느 대화의
 * 이력으로 만들어졌는지를 기억하지 않아, 검토 카드가 열린 채 활성 대화가 바뀌면 ① 남의 대화에 저장되거나
 * (「7번 질문이 8번에 들어간다」) ② 활성 대화가 없어져 **버튼이 무반응**이 됐다. 사용자 결정 ⓑ 는
 * 「확인을 원래 보낸 대화로 보낸다」이므로, 초안이 자기 대화(`draftThreadIdRef`)를 들고 다니게 하고
 * 보고 있는 대화가 아니면 **어디에 저장했는지 알린다**. 보낼 대화가 사라진 때만 초안을 버린다.
 *
 * 2 는 전송 뒤 재조회 실패(POST 200 · GET 실패)를 「메시지 조회 실패」가 아니라 「전송 완료 — 화면 갱신만
 * 실패」로 말하게 한 것이다 — 실패로 읽히면 사용자가 같은 글을 다시 보낸다(T-157 QA 신규 Low).
 */
describe('ChatPage — ⑫ 초안은 자기 대화로 전송된다 (T-161)', () => {
  const composer = (p: ReturnType<typeof mount>) => findAll(p.render(), (el) => typeName(el) === 'Composer')[0]?.props;
  const review = (p: ReturnType<typeof mount>) => findAll(p.render(), (el) => typeName(el) === 'DraftReview')[0]?.props;
  const reviewEl = (p: ReturnType<typeof mount>) =>
    findAll(p.render(), (el) => typeName(el) === 'DraftReview')[0] as unknown as ReactNS.ReactElement;
  const pending = () => { let release!: (v: { status: number; body: unknown }) => void; const q = new Promise<{ status: number; body: unknown }>((r) => { release = r; }); return { q, release }; };
  /** 그 요청에 실제로 실린 본문 — 「어느 대화로」는 URL, 「어떤 글이」는 본문으로만 확인된다. */
  const sentBody = (key: string): Record<string, unknown> => {
    const call = fetchMock.mock.calls.find((c) => `${c[1]?.method ?? 'GET'} ${c[0]}` === key) as
      [string, { method?: string; body?: string }] | undefined;
    return JSON.parse(call?.[1]?.body ?? '{}');
  };
  const DRAFT = { ok: true, draftPrompt: '정제됨', attachedContext: [], draftProvider: 'claude', draftModel: 'sonnet', draftLatencyMs: 10 };
  const RELOAD_FAILED = `${SENT_RELOAD_FAILED_PREFIX} (HTTP 500). 대화를 다시 열면 답변이 보입니다.`;

  /** 대화 7 = 초안을 만드는 곳(메시지 1회차 = 처음 로드, 2회차 = 전송 뒤), 대화 8 = 옮겨 갈 곳. */
  const base = () => {
    routes['GET /api/chat/threads'] = { status: 200, body: { ok: true, threads: [T(7), T(8)] } };
    routes['GET /api/chat/models'] = { status: 200, body: MODELS };
    routes['GET /api/chat/threads/7/messages'] = [
      { status: 200, body: { ok: true, messages: [M(1, '첫 질문')] } },
      { status: 200, body: { ok: true, messages: [M(1, '첫 질문'), M(2, '7번 질문'), M(3, '7번 답')] } },
    ];
    routes['GET /api/chat/threads/8/messages'] = { status: 200, body: { ok: true, messages: [M(9, 'B 질문')] } };
    routes['POST /api/chat/threads/7/draft'] = { status: 200, body: DRAFT };
    routes['POST /api/chat/threads/7/messages'] = { status: 200, body: { ok: true } };
  };
  /** 대화 7 에서 검토 단계까지 — 초안이 7 에 속한 상태를 만든다. */
  const toReview = async () => {
    const p = mount();
    await p.settle();
    (await p.overlay()).onSelect(7);
    await p.settle();
    composer(p).onInputChange('7번 질문');
    await p.settle();
    await composer(p).onSend();
    await p.settle();
    expect(review(p)?.prompt).toBe('정제됨');
    return p;
  };

  test('1. 다른 대화(8)를 보는 중 확정 → 7 로 전송하고 어디에 저장했는지 알린다', async () => {
    base();
    const p = await toReview();
    (await p.overlay()).onSelect(8);                   // 검토 카드를 띄운 채 대화 8 로 옮긴다
    await p.settle();
    expect(p.messages()).toEqual(['B 질문']);
    await review(p).onConfirm();
    await p.settle();
    expect(calls).toContain('POST /api/chat/threads/7/messages');
    expect(calls).not.toContain('POST /api/chat/threads/8/messages');   // 남의 대화에 저장되면 회귀
    expect(sentBody('POST /api/chat/threads/7/messages').content).toBe('7번 질문');
    expect(p.messages()).toEqual(['B 질문']);          // 보고 있는 8 번 화면은 그대로
    expect(p.errorBars()).toEqual([SENT_TO_OTHER_THREAD_MESSAGE('대화7')]);
    expect(review(p)).toBeUndefined();                 // 성공·실패 모두 카드는 닫힌다(기존 동작)
  });

  test('2. 검토 중 「+ 새 대화」 → 확정은 7 로 간다(버튼이 무반응이 되지 않는다)', async () => {
    base();
    const p = await toReview();
    (await p.overlay()).onNew();
    await p.settle();
    expect(review(p)?.prompt).toBe('정제됨');           // 초안은 살아 있다
    expect(review(p)?.awayTitle).toBe('대화7');
    await review(p).onConfirm();
    await p.settle();
    expect(calls.filter((c) => c === 'POST /api/chat/threads/7/messages')).toHaveLength(1);
    expect(calls).not.toContain('POST /api/chat/threads');              // 새 대화를 만들지 않는다
    expect(p.errorBars()).toEqual([SENT_TO_OTHER_THREAD_MESSAGE('대화7')]);
  });

  test('3. 다른 대화(8)의 404 로 선택이 해제돼도 초안은 살아 있고 확정은 7 로 간다', async () => {
    base();
    routes['GET /api/chat/threads/8/messages'] = { status: 404, body: { ok: false, error: 'thread not found' } };
    const p = await toReview();
    (await p.overlay()).onSelect(8);
    await p.settle();
    expect(p.errorBars()).toEqual([THREAD_GONE_MESSAGE]);               // 초안의 대화가 아니라 기존 안내
    expect(review(p)?.prompt).toBe('정제됨');                            // 초안은 버리지 않는다
    await review(p).onConfirm();
    await p.settle();
    expect(calls).toContain('POST /api/chat/threads/7/messages');
    expect(sentBody('POST /api/chat/threads/7/messages').content).toBe('7번 질문');
    expect(p.errorBars()).toEqual([SENT_TO_OTHER_THREAD_MESSAGE('대화7')]);
  });

  test('4. 확정했는데 그 대화가 404 → 카드를 닫고 보낼 대화가 사라졌다고 알린다', async () => {
    base();
    routes['POST /api/chat/threads/7/messages'] = { status: 404, body: { ok: false, error: 'thread not found' } };
    const p = await toReview();
    await review(p).onConfirm();
    await p.settle();
    expect(review(p)).toBeUndefined();
    expect(p.errorBars()).toEqual([DRAFT_THREAD_GONE_MESSAGE]);
    expect(composer(p).disabled).toBe(false);          // 입력 단계로 돌아온다
    expect(composer(p).input).toBe('7번 질문');         // 쓴 글은 남는다(다시 보낼 수 있게)
  });

  test('5. 검토 중인 대화를 목록에서 지우면 카드를 닫고 같은 안내를 한다', async () => {
    base();
    routes['DELETE /api/chat/threads/7'] = { status: 200, body: { ok: true } };
    const p = await toReview();
    await (await p.overlay()).onDelete(7);
    await p.settle();
    expect(review(p)).toBeUndefined();
    expect((await p.overlay()).error).toBe(DRAFT_THREAD_GONE_MESSAGE);  // 목록이 열려 있어 목록 안 띠로 보인다
    expect(p.errorBars()).toEqual([]);
    expect(calls).not.toContain('POST /api/chat/threads/7/messages');
  });

  test('6. 정제가 도는 중 대화를 바꿔도 확정은 정제를 요청한 대화(7)로 간다', async () => {
    base();
    const draft = pending();
    routes['POST /api/chat/threads/7/draft'] = draft.q;
    const p = mount();
    await p.settle();
    (await p.overlay()).onSelect(7);
    await p.settle();
    composer(p).onInputChange('7번 질문');
    await p.settle();
    const drafting = composer(p).onSend();             // 정제 요청 — 보류
    await p.settle();
    (await p.overlay()).onSelect(8);                   // 정제 중 대화 8 로 옮긴다
    await p.settle();
    draft.release({ status: 200, body: DRAFT });
    await drafting;
    await p.settle();
    expect(review(p)?.awayTitle).toBe('대화7');
    await review(p).onConfirm();
    await p.settle();
    expect(calls).toContain('POST /api/chat/threads/7/messages');
    expect(calls).not.toContain('POST /api/chat/threads/8/messages');
    expect(sentBody('POST /api/chat/threads/7/messages').content).toBe('7번 질문');
  });

  test('7. 같은 대화에서 확정하면 안내 띠가 뜨지 않는다(away 오탐)', async () => {
    base();
    const p = await toReview();
    expect(review(p)?.awayTitle).toBeNull();
    await review(p).onConfirm();
    await p.settle();
    expect(p.messages()).toEqual(['첫 질문', '7번 질문', '7번 답']);
    expect(p.errorBars()).toEqual([]);
    expect(composer(p).input).toBe('');
  });

  test('8. 직진 전송 200 + 재조회 500 → 「전송 완료 — 화면 갱신만 실패했습니다」', async () => {
    base();
    routes['GET /api/chat/threads/7/messages'] = [
      { status: 200, body: { ok: true, messages: [M(1, '첫 질문')] } },
      { status: 500, body: HTML },
    ];
    const p = mount();
    await p.settle();
    composer(p).onToggleSkipDraft();                   // 직진 모드
    (await p.overlay()).onSelect(7);
    await p.settle();
    composer(p).onInputChange('7번 질문');
    await p.settle();
    await composer(p).onSend();
    await p.settle();
    expect(p.errorBars()).toEqual([RELOAD_FAILED]);
    expect(p.messages()).toEqual(['첫 질문']);          // 전송은 됐고 화면만 못 갱신했다
  });

  test('9. 확정 전송 200 + 재조회 500 → 같은 문구(전송 성공을 먼저 말한다)', async () => {
    base();
    routes['GET /api/chat/threads/7/messages'] = [
      { status: 200, body: { ok: true, messages: [M(1, '첫 질문')] } },
      { status: 500, body: HTML },
    ];
    const p = await toReview();
    await review(p).onConfirm();
    await p.settle();
    expect(p.errorBars()).toEqual([RELOAD_FAILED]);
    expect(p.errorBars()[0].startsWith(SENT_NOTICE_PREFIX)).toBe(true);
  });

  test('10. 대화 전환 로드 500 은 기존 문구 그대로(전송 뒤 재조회가 아니다)', async () => {
    base();
    routes['GET /api/chat/threads/8/messages'] = { status: 500, body: HTML };
    const p = mount();
    await p.settle();
    (await p.overlay()).onSelect(8);
    await p.settle();
    expect(p.errorBars()).toEqual(['메시지 조회 실패 (HTTP 500)']);
    expect(p.errorBars()[0].startsWith(SENT_NOTICE_PREFIX)).toBe(false);
  });

  test('11. 안내 띠는 role=status·호박색·「안내 닫기」, 오류 띠는 role=alert·빨강·「오류 닫기」', () => {
    const props = { threads: [T(7)], activeId: null, onSelect: () => {}, onDelete: () => {}, onClose: () => {}, onNew: () => {} };
    const bar = (error: string) => renderToStaticMarkup(h(ThreadListOverlay, { ...props, error, onDismissError: () => {} }));
    const notice = bar(SENT_TO_OTHER_THREAD_MESSAGE('대화7'));
    expect(notice).toContain('<div role="status" style="padding:8px;background:rgba(245,158,11,.15);color:var(--accent);font-size:12px;text-align:center">');
    expect(notice).not.toContain('role="alert"');
    // 성공 안내를 「오류 닫기」로 읽히게 두지 않는다(Reviewer 질문 5 — 이 단언이 없으면 되돌려도 잡히지 않는다).
    expect(notice).toContain('aria-label="안내 닫기"');
    expect(notice).not.toContain('aria-label="오류 닫기"');
    expect(bar(RELOAD_FAILED)).toContain('role="status"');              // 재조회 실패 안내도 같은 접두
    expect(bar(RELOAD_FAILED)).toContain('aria-label="안내 닫기"');
    const err = bar(THREAD_GONE_MESSAGE);
    expect(err).toContain('<div role="alert" style="padding:8px;background:rgba(239,68,68,.15);color:var(--down);font-size:12px;text-align:center">');
    expect(err).not.toContain('role="status"');
    expect(err).toContain('aria-label="오류 닫기"');                     // 기존 오류 경로의 레이블은 그대로다
    expect(err).not.toContain('aria-label="안내 닫기"');
    expect(bar(DRAFT_THREAD_GONE_MESSAGE)).toContain('role="alert"');   // 보낼 대화 소멸은 실제 전송 실패다
  });

  test('12. 검토 카드 머리글: 다른 대화를 볼 때만 「제목」 대화로 전송합니다 한 줄', async () => {
    base();
    const p = await toReview();
    expect(review(p)?.awayTitle).toBeNull();
    expect(renderToStaticMarkup(reviewEl(p))).not.toContain('대화로 전송합니다');
    (await p.overlay()).onSelect(8);
    await p.settle();
    expect(review(p)?.awayTitle).toBe('대화7');
    const html = renderToStaticMarkup(reviewEl(p));
    expect(html).toContain('「대화7」');
    expect(html).toContain('대화로 전송합니다');
    expect(html).toContain('aria-hidden="true"');                       // ↩ 는 장식이라 읽지 않는다
  });

  // ── 이 task 가 스스로 내건 가드의 회귀망 (T-161 Reviewer M-1 — 변이 R1~R5 가 전부 살아남던 구멍) ──
  // 아래 6건은 「현재 동작이 맞다」를 보는 게 아니라, **그 동작을 만드는 가드를 지우면 깨지는지**를 고정한다.
  // 각 시험 끝에 어떤 변이를 죽이는지 적는다(R1~R5·M8 — Reviewer 가 실측한 생존 변이 번호).

  test('13. 재조회 실패 문구는 서버가 자기 오류 문구를 줘도 「전송 완료」 접두를 잃지 않는다 [R1]', async () => {
    // 접두를 잃으면 띠가 빨강·role=alert 로 바뀌어 **전송이 실패한 것처럼** 읽힌다 — 목표 2 와 정면 충돌.
    // 신규 8·9 는 비JSON 500(= chatFetch 의 기본 문구 경로)만 써서 이 분기를 지나지 않았다.
    base();
    routes['GET /api/chat/threads/7/messages'] = [
      { status: 200, body: { ok: true, messages: [M(1, '첫 질문')] } },
      { status: 500, body: { ok: false, error: 'DB down' } },           // 서버가 준 error 가 기본 문구를 이긴다
    ];
    const p = await toReview();
    await review(p).onConfirm();
    await p.settle();
    expect(p.errorBars()).toEqual([`${SENT_RELOAD_FAILED_PREFIX} — DB down. 대화를 다시 열면 답변이 보입니다.`]);
    expect(p.errorBars()[0].startsWith(SENT_NOTICE_PREFIX)).toBe(true);
  });

  test('14. 확정 200 뒤 재조회가 404 → 「전송하지 못했습니다」가 아니라 기존 404 안내 하나 [R2·L-1]', async () => {
    // 전송(POST)은 이미 ok 로 끝났다 — 그 뒤 대화가 사라져도 「보낼 대화가 삭제돼 전송하지 못했습니다」는
    // 거짓이다(Reviewer L-1). 동시에 away 안내가 그 404 안내를 덮지도 않아야 한다(`draftAlive` 가드).
    base();
    routes['GET /api/chat/threads/7/messages'] = [
      { status: 200, body: { ok: true, messages: [M(1, '첫 질문')] } },
      { status: 404, body: { ok: false, error: 'thread not found' } },
    ];
    const p = await toReview();
    await review(p).onConfirm();
    await p.settle();
    expect(p.errorBars()).toEqual([THREAD_GONE_MESSAGE]);               // 띠는 하나, 문구는 기존 것
    expect(p.errorBars()[0]).not.toContain('전송하지 못했습니다');
    expect(p.errorBars()[0]).not.toBe(SENT_TO_OTHER_THREAD_MESSAGE('대화7'));
    expect(review(p)).toBeUndefined();                                  // 초안은 그대로 버린다
    expect(composer(p).disabled).toBe(false);
  });

  test('15. 확정 전송을 마친 뒤 그 대화를 지워도 초안 안내가 뜨지 않는다 [R5]', async () => {
    // 확정 `finally` 의 `clearDraft()` 가 ref 를 비우지 않으면, 소비된 초안이 남아 이후 그 대화의
    // 삭제·404 때 「검토 중이던 초안도 닫혔습니다」가 엉뚱하게 뜬다(낡은 tid 회귀).
    base();
    routes['DELETE /api/chat/threads/7'] = { status: 200, body: { ok: true } };
    const p = await toReview();
    await review(p).onConfirm();
    await p.settle();
    expect(p.errorBars()).toEqual([]);                                  // 같은 대화 전송 — 안내 없음
    await (await p.overlay()).onDelete(7);
    await p.settle();
    expect((await p.overlay()).error).toBeNull();                       // 지울 초안이 없으니 아무 안내도 없다
  });

  test('16. 검토를 취소한 뒤 그 대화를 지워도 초안 안내가 뜨지 않는다 [R4]', async () => {
    // `clearDraft` 가 ref 를 비우는 것이 취소 경로의 유일한 보장이다(상태만 비우면 ref 가 남는다).
    base();
    routes['DELETE /api/chat/threads/7'] = { status: 200, body: { ok: true } };
    const p = await toReview();
    review(p).onCancel();
    await p.settle();
    expect(review(p)).toBeUndefined();
    await (await p.overlay()).onDelete(7);
    await p.settle();
    expect((await p.overlay()).error).toBeNull();
  });

  test('17. 확정 전송이 도는 중 그 대화를 지워도 전송 중 상태가 풀리지 않는다 [R3]', async () => {
    // `discardDraft` 가 stage 를 무조건 `idle` 로 만들면 전송이 끝나지 않았는데 입력칸이 열려
    // 같은 글을 다시 보낼 수 있게 된다. `review` 일 때만 `idle` 로 돌리는 것이 그 가드다.
    base();
    const sent = pending();
    routes['POST /api/chat/threads/7/messages'] = sent.q;
    routes['DELETE /api/chat/threads/7'] = { status: 200, body: { ok: true } };
    const p = await toReview();
    const sending = review(p).onConfirm();                              // 전송 보류 — stage 'generating'
    await p.settle();
    expect(composer(p).disabled).toBe(true);
    await (await p.overlay()).onDelete(7);                              // 전송 중 그 대화를 지운다
    await p.settle();
    expect(composer(p).disabled).toBe(true);                            // 아직 전송 중이다
    sent.release({ status: 200, body: { ok: true } });
    await sending;
    await p.settle();
    expect(composer(p).disabled).toBe(false);                           // 전송이 끝나면 풀린다
  });

  test('18. 확정 전송은 초안을 만든 그 글을 보낸다 — 입력칸이 그 사이 달라져도 [M8]', async () => {
    // 실 UI 는 검토 중 Composer 를 렌더하지 않지만(그래서 두 값이 갈라질 수 없다), 본문 선택이 그 UI
    // 조건에 기대지 않는다는 것을 고정한다 — 기존 「전송 중 입력칸 내용이 달라지면」 시험과 같은 방식.
    base();
    const p = mount();
    await p.settle();
    (await p.overlay()).onSelect(7);
    await p.settle();
    const onInputChange = composer(p).onInputChange as (s: string) => void;  // 검토 **이전에** 잡아 둔 핸들
    onInputChange('7번 질문');
    await p.settle();
    await composer(p).onSend();
    await p.settle();
    expect(review(p)?.prompt).toBe('정제됨');
    onInputChange('다른 글');                                            // 검토 중에 입력칸만 바꾼다
    await p.settle();
    await review(p).onConfirm();
    await p.settle();
    expect(sentBody('POST /api/chat/threads/7/messages').content).toBe('7번 질문');
  });
});

// ─── ⑬ 승인 문구 고정 (T-161 N-2) ──────────────────────────────────────────
// 데모 v1(`mockups/T-161-draft-review-ownership-v1.html`)의 「띠 문구 3종 — 각 2안과 권고」와 「결정 1-A
// 머리글 한 줄」을 사용자가 2026-11-07 「권고안으로 승인」 했다. 그런데 ⑫ 의 문구 단언은 **대부분**
// `SENT_*`·`DRAFT_*` 상수를 가져다 써서 비교하므로, 문구 1·2 와 문구 3 **앞부분**을 다시 쓰면 상수와
// 단언이 함께 바뀌어 그대로 통과한다(문구 3 의 뒤 문장과 머리글 글자는 ⑫-8·9·12·13 이 리터럴로 이미
// 고정하고 있다 — 접두만 바꾼 변이가 ⑬ 만 깨고 뒤 문장을 바꾼 변이는 ⑫-8·9·13 도 깨는 것이 그 증거).
// 그래서 아래는 상수를 쓰지 않고 데모에 적힌 글자를 그대로 적는다. **이 중복이 이 시험의 전부다**:
// 「DRY 하게」 상수 import 로 바꾸면 아무것도 지키지 않는다. 문구를 바꿀 때는 데모를 다시 승인받고 이
// 줄도 같이 고친다 — 그 수정이 승인 없는 문구 변경을 눈에 보이게 만든다.
describe('ChatPage — ⑬ 띠·머리글 문구는 승인 데모 v1 글자 그대로다 (T-161 N-2)', () => {
  /** 데모의 합성 예시 제목. 같은 값을 써서 데모 HTML 과 글자 단위로 대조할 수 있게 한다. */
  const DEMO_TITLE = '반도체 섹터 전망';
  const DRAFT = { ok: true, draftPrompt: '정제됨', attachedContext: [], draftProvider: 'claude', draftModel: 'sonnet', draftLatencyMs: 10 };
  const prop = (p: ReturnType<typeof mount>, name: string) => findAll(p.render(), (el) => typeName(el) === name)[0];
  /** 마크업에서 글자만 뽑아 한 칸으로 이은다 — 태그·주석은 지우고 빈 조각은 버린다. */
  const textOf = (html: string) =>
    html.replace(/<[^>]*>/g, '\u0000').split('\u0000').map((s) => s.trim()).filter(Boolean).join(' ');
  /**
   * 띠가 **렌더한** 글자. `errorBars()` 는 요소의 props 만 읽으므로 본문에서 접두를 떼는 변이
   * (`{message.replace(SENT_NOTICE_PREFIX, '')}`)가 살아남는다 — 마지막 한 칸을 여기서 막는다.
   * 끝의 닫기 `×` 는 글자가 아니라 버튼이라 뗀다.
   */
  const renderedBar = (p: ReturnType<typeof mount>) =>
    textOf(renderToStaticMarkup(prop(p, 'ChatErrorBar') as unknown as ReactNS.ReactElement)).replace(/\s*×$/, '');

  /** ⑫ 의 `toReview` 와 같은 흐름 — 대화 7 의 제목만 데모 예시 값이고, 전송 뒤 재조회 응답을 바꿀 수 있다. */
  const toReview = async (reloadAfterSend?: Spec) => {
    routes['GET /api/chat/threads'] = { status: 200, body: { ok: true, threads: [T(7, DEMO_TITLE), T(8)] } };
    routes['GET /api/chat/models'] = { status: 200, body: MODELS };
    routes['GET /api/chat/threads/7/messages'] = [
      { status: 200, body: { ok: true, messages: [M(1, '첫 질문')] } },
      reloadAfterSend ?? { status: 200, body: { ok: true, messages: [M(1, '첫 질문'), M(2, '7번 질문')] } },
    ];
    routes['GET /api/chat/threads/8/messages'] = { status: 200, body: { ok: true, messages: [M(9, 'B 질문')] } };
    routes['POST /api/chat/threads/7/draft'] = { status: 200, body: DRAFT };
    routes['POST /api/chat/threads/7/messages'] = { status: 200, body: { ok: true } };
    const p = mount();
    await p.settle();
    (await p.overlay()).onSelect(7);
    await p.settle();
    prop(p, 'Composer').props.onInputChange('7번 질문');
    await p.settle();
    await prop(p, 'Composer').props.onSend();
    await p.settle();
    expect(prop(p, 'DraftReview')?.props.prompt).toBe('정제됨');
    return p;
  };

  test('1. 문구 1 — 다른 대화로 전송 성공 (데모 「문구 1 · 2안 권고」)', () => {
    expect(SENT_TO_OTHER_THREAD_MESSAGE(DEMO_TITLE)).toBe(
      '전송 완료 — 「반도체 섹터 전망」 대화에 저장했습니다. 보려면 그 대화를 여세요.',
    );
    // 접두 자체도 승인 문구다 — 띠의 색·`role` 을 이 글자로 가르므로(ChatErrorBar) 바뀌면 뜻이 흔들린다.
    expect(SENT_NOTICE_PREFIX).toBe('전송 완료 — ');
  });

  test('2. 문구 2 — 보낼 대화가 없어졌다 (데모 「문구 2 · 2안 권고」)', () => {
    // 이 글자를 **어느 경로에서** 띠에 올리는지는 ⑫-4(확정 404)·⑫-5(검토 중 삭제)가 지킨다.
    expect(DRAFT_THREAD_GONE_MESSAGE).toBe(
      '보낼 대화가 삭제돼 전송하지 못했습니다. 검토 중이던 초안도 닫혔습니다 — 질문을 다시 입력해 주세요.',
    );
  });

  test('3. 문구 3 — 전송은 됐고 화면 갱신만 실패 (데모 「문구 3 · 2안 권고」)', () => {
    expect(SENT_RELOAD_FAILED_PREFIX).toBe('전송 완료 — 화면 갱신만 실패했습니다');
    // 데모에 적힌 완성형. `(HTTP 500)` 은 `chatFetch` 가, 뒤 문장은 `sentReloadFailedMessage` 가 붙인다.
    expect(sentReloadFailedMessage('전송 완료 — 화면 갱신만 실패했습니다 (HTTP 500)')).toBe(
      '전송 완료 — 화면 갱신만 실패했습니다 (HTTP 500). 대화를 다시 열면 답변이 보입니다.',
    );
  });

  test('4. 실제 전송 경로가 문구 1 을 띠에 그대로 올린다', async () => {
    // 1~3 은 상수·함수를 본다. 이 건과 5 는 **사용자가 보는 띠**의 글자 — 조립 과정에서 다른 문구가
    // 끼어들거나 제목이 다른 꼴로 들어가지 않는지 — 를 ⑫ 와 같은 흐름으로 확인한다.
    const p = await toReview();
    (await p.overlay()).onSelect(8);
    await p.settle();
    await prop(p, 'DraftReview').props.onConfirm();
    await p.settle();
    expect(p.errorBars()).toEqual(['전송 완료 — 「반도체 섹터 전망」 대화에 저장했습니다. 보려면 그 대화를 여세요.']);
    expect(renderedBar(p)).toBe('전송 완료 — 「반도체 섹터 전망」 대화에 저장했습니다. 보려면 그 대화를 여세요.');
  });

  test('5. 실제 전송 경로가 문구 3 을 띠에 그대로 올린다 (HTTP 코드 포함)', async () => {
    const p = await toReview({ status: 500, body: HTML });
    await prop(p, 'DraftReview').props.onConfirm();
    await p.settle();
    expect(p.errorBars()).toEqual(['전송 완료 — 화면 갱신만 실패했습니다 (HTTP 500). 대화를 다시 열면 답변이 보입니다.']);
    expect(renderedBar(p)).toBe('전송 완료 — 화면 갱신만 실패했습니다 (HTTP 500). 대화를 다시 열면 답변이 보입니다.');
  });

  test('6. 머리글 한 줄은 승인된 그 한 줄 그대로다 (순서·덧붙임까지)', async () => {
    // ⑫-12 는 `toContain` 두 건이라 두 조각의 **순서를 바꿔도**, 앞뒤에 글자를 **덧붙여도** 통과한다.
    // 여기서는 `↩` 를 품은 **가장 안쪽** div 하나만 떼어 글자를 통째로 비교한다(↩ 는 `aria-hidden` 장식).
    const p = await toReview();
    (await p.overlay()).onSelect(8);
    await p.settle();
    const html = renderToStaticMarkup(prop(p, 'DraftReview') as unknown as ReactNS.ReactElement);
    const row = html.match(/<div[^>]*>(?:(?!<div)[\s\S])*?aria-hidden="true">↩[\s\S]*?<\/div>/)?.[0] ?? '';
    expect(textOf(row)).toBe('↩ 「반도체 섹터 전망」 대화로 전송합니다');
  });
});

test('채팅 연결 유지 응답을 풀어 정상·소유권 오류·로그인 요구 상태를 복원한다', async () => {
  const { CHAT_HEARTBEAT_HEADER } = await import('@/lib/chat/response-heartbeat');
  const wrap = (status: number, body: object) => new Response('\n'+JSON.stringify({status,body}), {
    headers: { [CHAT_HEARTBEAT_HEADER]: '1', 'Content-Type': 'application/json' },
  });
  await expect(readChatResponse(wrap(200,{ok:true}), '응답 실패')).resolves.toMatchObject({kind:'ok'});
  await expect(readChatResponse(wrap(404,{ok:false,error:'thread not found'}), '응답 실패')).resolves.toEqual({
    kind:'not_found', error:'thread not found',
  });
  await expect(readChatResponse(wrap(401,{ok:false}), '응답 실패')).resolves.toEqual({kind:'unauthorized'});
});
