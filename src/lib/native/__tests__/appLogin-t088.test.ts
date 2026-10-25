/**
 * T-088 — 앱 Google 로그인 WebView 쪽 로직(`appLogin.ts`)과 브리지 확장(`addAppUrlOpenListener`·`getLaunchUrl`).
 * jest 는 node 환경이라 `window`(Capacitor·location·sessionStorage)를 가짜로 꽂았다 뺀다. Web Crypto·btoa 는 Node 내장.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { addAppUrlOpenListener, getLaunchUrl } from '../bridge';
import {
  APP_LOGIN_TTL_MS,
  __resetAppLoginForTest,
  cancelAppLogin,
  completeAppLogin,
  createPkcePair,
  exchangeAppCode,
  onAuthDeepLink,
  openAppLogin,
  prepareAppLogin,
  takeAppLoginVerifier,
} from '../appLogin';

type G = { window?: unknown; fetch?: unknown };
const g = globalThis as unknown as G;
const ORIGINAL_FETCH = g.fetch;

function fakeStorage() {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
  };
}

interface FakeApp {
  listeners: Array<(d: { url?: unknown }) => void>;
  removed: number;
  launch: string | null;
  addListener: jest.Mock;
  getLaunchUrl: jest.Mock;
}
function fakeApp(launch: string | null = null, asyncHandle = true): FakeApp {
  const app: FakeApp = {
    listeners: [],
    removed: 0,
    launch,
    addListener: jest.fn((_ev: string, cb: (d: { url?: unknown }) => void) => {
      app.listeners.push(cb);
      const handle = { remove: async () => { app.removed += 1; app.listeners = app.listeners.filter((l) => l !== cb); } };
      return asyncHandle ? Promise.resolve(handle) : handle;
    }),
    getLaunchUrl: jest.fn(async () => (app.launch === null ? undefined : { url: app.launch })),
  };
  return app;
}

function setWindow(opts: { native?: boolean; app?: FakeApp | null; open?: jest.Mock; storage?: ReturnType<typeof fakeStorage> | null } = {}) {
  const st = opts.storage === undefined ? fakeStorage() : opts.storage;
  g.window = {
    Capacitor: {
      isNativePlatform: () => opts.native ?? true,
      Plugins: { ...(opts.app ? { App: opts.app } : {}), ...(opts.open ? { Browser: { open: opts.open } } : {}) },
    },
    location: { href: 'https://stock.example.com/login', origin: 'https://stock.example.com' },
    ...(st ? { sessionStorage: st } : {}),
  };
  return st;
}
const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => __resetAppLoginForTest());
afterEach(() => {
  delete g.window;
  g.fetch = ORIGINAL_FETCH;
  jest.restoreAllMocks();
});

describe('브리지 — appUrlOpen·getLaunchUrl', () => {
  test('웹(전역 없음·isNativePlatform=false)에서는 아무것도 부르지 않는다', async () => {
    expect(await getLaunchUrl()).toBeNull();
    const off = addAppUrlOpenListener(() => { throw new Error('불리면 안 됨'); });
    off();
    const app = fakeApp('stockinvest://auth/callback?error=failed');
    setWindow({ native: false, app });
    expect(await getLaunchUrl()).toBeNull();
    addAppUrlOpenListener(() => {})();
    expect(app.addListener).not.toHaveBeenCalled();
    expect(app.getLaunchUrl).not.toHaveBeenCalled();
  });

  test('구독·전달·해제(비동기 핸들) — 해제 뒤 이벤트는 넘기지 않는다', async () => {
    const app = fakeApp();
    setWindow({ app });
    const got: string[] = [];
    const off = addAppUrlOpenListener((u) => got.push(u));
    await flush();
    app.listeners[0]({ url: 'stockinvest://auth/callback?code=x' });
    app.listeners[0]({ url: 123 });
    app.listeners[0]({ url: 'a'.repeat(3000) });
    expect(got).toEqual(['stockinvest://auth/callback?code=x']);
    off();
    await flush();
    expect(app.removed).toBe(1);
    off(); // 두 번 불러도 안전
    expect(app.removed).toBe(1);
  });

  test('등록 완료 전에 해제해도 핸들이 오는 즉시 지운다', async () => {
    const app = fakeApp();
    setWindow({ app });
    const cb = jest.fn();
    const off = addAppUrlOpenListener(cb);
    off();
    await flush();
    expect(app.removed).toBe(1);
  });

  test('동기 핸들·addListener 예외·플러그인 없음에도 던지지 않는다', async () => {
    const app = fakeApp(null, false);
    setWindow({ app });
    const off = addAppUrlOpenListener(() => {});
    await flush();
    off();
    await flush();
    expect(app.removed).toBe(1);
    setWindow({ app: { ...fakeApp(), addListener: jest.fn(() => { throw new Error('x'); }) } as unknown as FakeApp });
    expect(() => addAppUrlOpenListener(() => {})()).not.toThrow();
    setWindow({ app: null });
    expect(() => addAppUrlOpenListener(() => {})()).not.toThrow();
    expect(await getLaunchUrl()).toBeNull();
  });

  test('getLaunchUrl — 값·없음·예외', async () => {
    setWindow({ app: fakeApp('stockinvest://auth/callback?error=cancelled') });
    expect(await getLaunchUrl()).toBe('stockinvest://auth/callback?error=cancelled');
    setWindow({ app: fakeApp(null) });
    expect(await getLaunchUrl()).toBeNull();
    setWindow({ app: { ...fakeApp(), getLaunchUrl: jest.fn(async () => { throw new Error('x'); }) } as unknown as FakeApp });
    expect(await getLaunchUrl()).toBeNull();
  });

  test('bridge.ts·appLogin.ts 는 @capacitor/* 를 import 하지 않는다', () => {
    for (const f of ['bridge.ts', 'appLogin.ts']) {
      const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
      expect(src).not.toMatch(/from\s+['"]@capacitor\//);
      expect(src).not.toMatch(/require\(\s*['"]@capacitor\//);
      expect(src).not.toMatch(/import\(\s*['"]@capacitor\//);
    }
  });
});

describe('PKCE 쌍·준비·꺼내기', () => {
  test('createPkcePair — verifier 43자 base64url, challenge = S256(verifier)', async () => {
    const { verifier, challenge } = await createPkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toBe(createHash('sha256').update(verifier, 'ascii').digest('base64url'));
    const other = await createPkcePair();
    expect(other.verifier).not.toBe(verifier);
  });

  test('prepareAppLogin — 웹이면 null, 앱이면 같은 출처 시작 주소(challenge 만 실림, verifier 는 안 실림)', async () => {
    expect(await prepareAppLogin('/settings')).toBeNull();
    const st = setWindow({});
    const href = (await prepareAppLogin('/settings'))!;
    const u = new URL(href);
    expect(u.origin + u.pathname).toBe('https://stock.example.com/api/auth/google');
    expect(u.searchParams.get('platform')).toBe('app');
    expect(u.searchParams.get('next')).toBe('/settings');
    const ch = u.searchParams.get('challenge')!;
    expect(ch).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const saved = JSON.parse(st!.m.get('stockinvest_app_login')!);
    expect(href).not.toContain(saved.verifier);
    expect(createHash('sha256').update(saved.verifier, 'ascii').digest('base64url')).toBe(ch);
  });

  test('next 는 같은 출처 경로만 보관·전송', async () => {
    setWindow({});
    const href = (await prepareAppLogin('//evil.com'))!;
    expect(new URL(href).searchParams.get('next')).toBeNull();
    expect(takeAppLoginVerifier()!.next).toBe('/');
  });

  test('takeAppLoginVerifier — 꺼내면서 지운다(두 번째 null), 메모리가 없어도 sessionStorage 에서 복구', async () => {
    const st = setWindow({});
    await prepareAppLogin('/order');
    const saved = JSON.parse(st!.m.get('stockinvest_app_login')!);
    __resetAppLoginForTest(); // WebView 가 다시 그려져 모듈 메모리가 사라진 상황
    expect(takeAppLoginVerifier()).toEqual({ verifier: saved.verifier, next: '/order' });
    expect(st!.m.has('stockinvest_app_login')).toBe(false);
    expect(takeAppLoginVerifier()).toBeNull();
  });

  test('10분 지나면 null, 시계가 거꾸로 가도 null, 깨진 값은 null', async () => {
    const st = setWindow({});
    await prepareAppLogin('/');
    const at = JSON.parse(st!.m.get('stockinvest_app_login')!).at as number;
    expect(takeAppLoginVerifier(at + APP_LOGIN_TTL_MS + 1)).toBeNull();
    await prepareAppLogin('/');
    expect(takeAppLoginVerifier(at - 10_000)).toBeNull();
    __resetAppLoginForTest();
    st!.m.set('stockinvest_app_login', '{not json');
    expect(takeAppLoginVerifier()).toBeNull();
    st!.m.set('stockinvest_app_login', JSON.stringify({ verifier: 'short', next: '/', at: Date.now() }));
    expect(takeAppLoginVerifier()).toBeNull();
  });

  test('sessionStorage 가 없어도 메모리로 동작, cancelAppLogin 은 지운다', async () => {
    setWindow({ storage: null });
    await prepareAppLogin('/');
    expect(takeAppLoginVerifier()).not.toBeNull();
    await prepareAppLogin('/');
    cancelAppLogin();
    expect(takeAppLoginVerifier()).toBeNull();
  });

  test('openAppLogin — Browser 플러그인으로 https 만 연다', async () => {
    const open = jest.fn(async () => {});
    setWindow({ open });
    expect(await openAppLogin('https://stock.example.com/api/auth/google?platform=app')).toBe(true);
    expect(open).toHaveBeenCalledWith({ url: 'https://stock.example.com/api/auth/google?platform=app' });
    expect(await openAppLogin('http://stock.example.com/x')).toBe(false);
  });
});

describe('교환·마무리', () => {
  const CODE = 'a'.repeat(64);
  const VER = 'V'.repeat(43);

  test('POST JSON·같은 출처·쿼리스트링 없음 → 서버 next', async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({ ok: true, next: '/settings' }) }));
    g.fetch = fetchMock;
    expect(await exchangeAppCode(CODE, VER, '/settings')).toBe('/settings');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/auth/app-exchange');
    expect(url).not.toContain('?');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('same-origin');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ code: CODE, verifier: VER, next: '/settings' });
  });

  test('서버가 외부 주소를 돌려줘도 따르지 않는다(null)', async () => {
    for (const next of ['//evil.com', 'https://evil.com', '/login', 5]) {
      g.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ ok: true, next }) }));
      expect(await exchangeAppCode(CODE, VER, null)).toBeNull();
    }
  });

  test('실패·예외·형식 오류 → null(요청도 안 보냄)', async () => {
    g.fetch = jest.fn(async () => ({ ok: false, json: async () => ({ ok: false }) }));
    expect(await exchangeAppCode(CODE, VER, null)).toBeNull();
    g.fetch = jest.fn(async () => { throw new Error('net'); });
    expect(await exchangeAppCode(CODE, VER, null)).toBeNull();
    const f = jest.fn();
    g.fetch = f;
    expect(await exchangeAppCode('A'.repeat(64), VER, null)).toBeNull();
    expect(await exchangeAppCode(CODE, 'short', null)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  test('completeAppLogin — verifier 없음 / 성공 / 교환 실패, verifier 는 1회용', async () => {
    setWindow({});
    expect(await completeAppLogin(CODE)).toEqual({ ok: false, reason: 'no_verifier' });
    await prepareAppLogin('/order');
    g.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ ok: true, next: '/order' }) }));
    expect(await completeAppLogin(CODE)).toEqual({ ok: true, next: '/order' });
    expect(await completeAppLogin(CODE)).toEqual({ ok: false, reason: 'no_verifier' });
    await prepareAppLogin('/');
    g.fetch = jest.fn(async () => ({ ok: false, json: async () => ({}) }));
    expect(await completeAppLogin(CODE)).toEqual({ ok: false, reason: 'exchange_failed' });
    expect(await completeAppLogin(CODE)).toEqual({ ok: false, reason: 'no_verifier' });
  });
});

describe('딥링크 수신 — onAuthDeepLink', () => {
  const C1 = `stockinvest://auth/callback?code=${'1'.repeat(64)}`;
  const C2 = `stockinvest://auth/callback?code=${'2'.repeat(64)}`;

  test('웹이면 구독하지 않는다', () => {
    const cb = jest.fn();
    onAuthDeepLink(cb)();
    expect(cb).not.toHaveBeenCalled();
  });

  test('appUrlOpen 코드·오류를 넘기고, 로그인 콜백이 아닌 주소는 무시', async () => {
    const app = fakeApp();
    setWindow({ app });
    const got: unknown[] = [];
    const off = onAuthDeepLink((r) => got.push(r));
    await flush();
    app.listeners[0]({ url: C1 });
    app.listeners[0]({ url: 'stockinvest://other/path?code=x' });
    app.listeners[0]({ url: 'https://stock.example.com/' });
    app.listeners[0]({ url: 'stockinvest://auth/callback?error=cancelled' });
    expect(got).toEqual([{ kind: 'code', code: '1'.repeat(64) }, { kind: 'error', error: 'cancelled' }]);
    off();
  });

  test('콜드 스타트 — getLaunchUrl 과 appUrlOpen 이 같은 코드를 줘도 한 번만', async () => {
    const app = fakeApp(C1);
    setWindow({ app });
    const cb = jest.fn();
    onAuthDeepLink(cb);
    await flush();
    app.listeners[0]({ url: C1 });
    await flush();
    expect(cb).toHaveBeenCalledTimes(1);
    app.listeners[0]({ url: C2 });
    expect(cb).toHaveBeenCalledTimes(2);
  });

  test('페이지를 다시 불러와도(getLaunchUrl 이 옛 주소를 계속 줌) 같은 콜드 스타트 주소는 다시 넘기지 않는다', async () => {
    const st = fakeStorage();
    const app = fakeApp(C1);
    setWindow({ app, storage: st });
    const first = jest.fn();
    onAuthDeepLink(first);
    await flush();
    expect(first).toHaveBeenCalledTimes(1);
    // 새 페이지: 모듈 메모리는 사라지고 sessionStorage 는 남는다
    __resetAppLoginForTest();
    setWindow({ app: fakeApp(C1), storage: st });
    const second = jest.fn();
    onAuthDeepLink(second);
    await flush();
    expect(second).not.toHaveBeenCalled();
    // 처리 기록에는 코드 원문이 남지 않는다(지문만)
    expect(st.m.get('stockinvest_app_login_handled')).not.toContain('1'.repeat(16));
  });

  test('같은 페이지에서 오류 딥링크가 두 번 오면 두 번 다 넘긴다(두 번째 취소도 안내)', async () => {
    const app = fakeApp();
    setWindow({ app });
    const cb = jest.fn();
    onAuthDeepLink(cb);
    await flush();
    app.listeners[0]({ url: 'stockinvest://auth/callback?error=cancelled' });
    app.listeners[0]({ url: 'stockinvest://auth/callback?error=cancelled' });
    expect(cb).toHaveBeenCalledTimes(2);
  });

  test('해제 뒤에는 넘기지 않는다', async () => {
    const app = fakeApp();
    setWindow({ app });
    const cb = jest.fn();
    const off = onAuthDeepLink(cb);
    await flush();
    const l = app.listeners[0];
    off();
    l({ url: C2 });
    expect(cb).not.toHaveBeenCalled();
  });
});
