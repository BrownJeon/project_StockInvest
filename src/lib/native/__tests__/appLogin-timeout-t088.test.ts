/**
 * T-088 R-U F1 — 교환 요청 제한 시간. 교환 `fetch`(또는 응답 본문 읽기)가 멈추면 "로그인 마무리 중" 덮개(본문 inert)가 영영 안 걷혔다.
 * 지금은 약 15초(`APP_EXCHANGE_TIMEOUT_MS`) 뒤 다른 실패와 같은 null(→ `exchange_failed` → 오류 상자 `app_code_invalid`)로 끝나야 하고,
 * 타이머는 어떤 경로로 끝나든 해제돼야 하며, 정상 응답·요청 모양은 그대로여야 한다. jest fake timers 로 시간을 돌린다(실제 15초를 기다리지 않는다).
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  APP_EXCHANGE_TIMEOUT_MS,
  __resetAppLoginForTest,
  completeAppLogin,
  exchangeAppCode,
  prepareAppLogin,
} from '../appLogin';

type G = { window?: unknown; fetch?: unknown; AbortController?: unknown };
const g = globalThis as unknown as G;
const ORIGINAL_FETCH = g.fetch;
const ORIGINAL_ABORT = g.AbortController;

const CODE = 'a'.repeat(64);
const VER = 'V'.repeat(43);
const NEVER = () => new Promise<never>(() => {});

function setWindow() {
  const m = new Map<string, string>();
  g.window = {
    Capacitor: { isNativePlatform: () => true, Plugins: {} },
    location: { href: 'https://stock.example.com/login', origin: 'https://stock.example.com' },
    sessionStorage: {
      getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
      setItem: (k: string, v: string) => { m.set(k, String(v)); },
      removeItem: (k: string) => { m.delete(k); },
    },
  };
}

/** 대기 중인 Promise 가 아직 안 끝났는지 보려고 결과를 기록해 둔다. */
function track<T>(p: Promise<T>) {
  const s: { done: boolean; value?: T } = { done: false };
  void p.then((v) => { s.done = true; s.value = v; });
  return s;
}

beforeEach(() => {
  __resetAppLoginForTest();
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
});
afterEach(() => {
  jest.useRealTimers();
  delete g.window;
  g.fetch = ORIGINAL_FETCH;
  g.AbortController = ORIGINAL_ABORT;
  jest.restoreAllMocks();
});

describe('F1 — 교환 요청 제한 시간', () => {
  test('상수 = 15초', () => {
    expect(APP_EXCHANGE_TIMEOUT_MS).toBe(15_000);
  });

  test('영원히 대기하는 fetch(신호도 무시) — 15초 직전까지는 대기, 15초에 null(= 실패 경로)', async () => {
    g.fetch = jest.fn(NEVER);
    const t = track(exchangeAppCode(CODE, VER, null));
    await jest.advanceTimersByTimeAsync(APP_EXCHANGE_TIMEOUT_MS - 1);
    expect(t.done).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(t.done).toBe(true);
    expect(t.value).toBeNull();
    expect(jest.getTimerCount()).toBe(0); // 타이머 해제
  });

  test('시간 초과 때 요청을 끊는다 — AbortController 신호가 abort 되고, 신호를 따르는 fetch 는 중단 오류로 끝난다', async () => {
    let seen: AbortSignal | undefined;
    g.fetch = jest.fn((_url: string, init: RequestInit) => {
      seen = init.signal as AbortSignal;
      return new Promise((_resolve, reject) => {
        seen!.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    });
    const t = track(exchangeAppCode(CODE, VER, '/orders'));
    await jest.advanceTimersByTimeAsync(0);
    expect(seen).toBeDefined();
    expect(seen!.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(APP_EXCHANGE_TIMEOUT_MS);
    expect(seen!.aborted).toBe(true);
    expect(t.done).toBe(true);
    expect(t.value).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });

  test('헤더는 왔는데 본문 읽기가 멈춰도 15초에 끝난다(본문 읽는 시간까지 제한)', async () => {
    g.fetch = jest.fn(async () => ({ ok: true, json: NEVER }));
    const t = track(exchangeAppCode(CODE, VER, null));
    await jest.advanceTimersByTimeAsync(APP_EXCHANGE_TIMEOUT_MS - 1);
    expect(t.done).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(t.done).toBe(true);
    expect(t.value).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });

  test('정상으로 빨리 온 응답은 영향이 없다 — 값 그대로 · 타이머 해제 · 늦게 켜지는 중단 신호 없음', async () => {
    let seen: AbortSignal | undefined;
    g.fetch = jest.fn(async (_url: string, init: RequestInit) => {
      seen = init.signal as AbortSignal;
      return { ok: true, json: async () => ({ ok: true, next: '/orders' }) };
    });
    expect(await exchangeAppCode(CODE, VER, '/orders')).toBe('/orders');
    expect(jest.getTimerCount()).toBe(0); // finally 에서 해제 — 남은 타이머 없음
    await jest.advanceTimersByTimeAsync(APP_EXCHANGE_TIMEOUT_MS * 2);
    expect(seen!.aborted).toBe(false); // 이미 끝난 요청을 나중에 끊지 않는다
  });

  test.each([
    ['서버 거절(!ok)', () => jest.fn(async () => ({ ok: false, json: async () => ({}) }))],
    ['네트워크 오류(throw)', () => jest.fn(async () => { throw new Error('net'); })],
    ['본문 깨짐', () => jest.fn(async () => ({ ok: true, json: async () => { throw new Error('bad json'); } }))],
    ['서버가 외부 주소를 돌려줌', () => jest.fn(async () => ({ ok: true, json: async () => ({ ok: true, next: '//evil.com' }) }))],
  ])('실패 경로(%s)도 null 이고 타이머가 남지 않는다', async (_name, make) => {
    g.fetch = make();
    expect(await exchangeAppCode(CODE, VER, null)).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });

  test('형식 오류는 요청도 타이머도 만들지 않는다', async () => {
    const f = jest.fn(NEVER);
    g.fetch = f;
    expect(await exchangeAppCode('A'.repeat(64), VER, null)).toBeNull();
    expect(await exchangeAppCode(CODE, 'short', null)).toBeNull();
    expect(f).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  test('요청 모양 불변 — POST · same-origin · JSON · 본문 키 code/verifier/next · 쿼리 없음 (신호는 추가로 실릴 뿐)', async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({ ok: true, next: '/settings' }) }));
    g.fetch = fetchMock;
    expect(await exchangeAppCode(CODE, VER, '/settings')).toBe('/settings');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/auth/app-exchange');
    expect(url).not.toContain('?');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('same-origin');
    expect(init.cache).toBe('no-store');
    expect(init.redirect).toBe('error');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(Object.keys(JSON.parse(init.body as string)).sort()).toEqual(['code', 'next', 'verifier']);
    expect(Object.keys(init).sort()).toEqual(['body', 'cache', 'credentials', 'headers', 'method', 'redirect', 'signal']);
    // next 가 없으면 본문에도 없다
    await exchangeAppCode(CODE, VER, null);
    const init2 = (fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1];
    expect(Object.keys(JSON.parse(init2.body as string)).sort()).toEqual(['code', 'verifier']);
  });

  test('AbortController 가 없는 환경에서도 15초에 끝난다(신호 없이 요청, 경합만으로)', async () => {
    g.AbortController = undefined;
    const fetchMock = jest.fn(NEVER);
    g.fetch = fetchMock;
    const t = track(exchangeAppCode(CODE, VER, null));
    await jest.advanceTimersByTimeAsync(0);
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect('signal' in init).toBe(false);
    await jest.advanceTimersByTimeAsync(APP_EXCHANGE_TIMEOUT_MS);
    expect(t.done).toBe(true);
    expect(t.value).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });

  test('중단된 뒤 늦게 도착한 성공 응답이 있어도 결과는 바뀌지 않고, 처리되지 않은 거부도 없다', async () => {
    let release: (v: unknown) => void = () => {};
    g.fetch = jest.fn(() => new Promise((resolve) => { release = resolve; }));
    const t = track(exchangeAppCode(CODE, VER, null));
    await jest.advanceTimersByTimeAsync(APP_EXCHANGE_TIMEOUT_MS);
    expect(t.value).toBeNull();
    release({ ok: true, json: async () => ({ ok: true, next: '/x' }) }); // 20초 뒤 도착
    await jest.advanceTimersByTimeAsync(5_000);
    expect(t.value).toBeNull();
  });

  test('completeAppLogin — 시간 초과는 exchange_failed(오류 상자 app_code_invalid 경로), verifier 는 소모된다', async () => {
    setWindow();
    await prepareAppLogin('/orders');
    g.fetch = jest.fn(NEVER);
    const t = track(completeAppLogin(CODE));
    await jest.advanceTimersByTimeAsync(APP_EXCHANGE_TIMEOUT_MS);
    expect(t.done).toBe(true);
    expect(t.value).toEqual({ ok: false, reason: 'exchange_failed' });
    expect(jest.getTimerCount()).toBe(0);
    // verifier 는 1회용 — 다시 시도해도 서버에 가지 않는다
    const f = jest.fn(NEVER);
    g.fetch = f;
    expect(await completeAppLogin(CODE)).toEqual({ ok: false, reason: 'no_verifier' });
    expect(f).not.toHaveBeenCalled();
  });

  test('소스 가드: AbortSignal.timeout 단독 의존 금지(구형 WebView) · 타이머는 finally 에서 해제 · 요청 쿼리스트링 없음', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../appLogin.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toContain('AbortSignal.timeout');
    expect(code).toMatch(/finally \{\s*if \(timer !== undefined\) clearTimeout\(timer\);\s*\}/);
    expect(code).toContain('Promise.race([requestExchange(');
    expect(code).toContain('new AbortController()');
  });
});
