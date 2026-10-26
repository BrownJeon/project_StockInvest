/**
 * T-091 M2 — App Link 수신 처리(`appLink.ts`)·배치(`AppLinkNavigator` 레이아웃 한 곳)·assetlinks.json 대조.
 * jest 는 node 환경이라 `window`(Capacitor·location·sessionStorage)를 가짜로 꽂았다 뺀다(appLogin-t088.test.ts 와 같은 방식).
 *
 * ① `resolveAppLinkTarget` 판정표 — 같은 호스트 https 의 같은 출처 경로만 이동, 나머지(다른 호스트·http·커스텀 스킴·`//evil`·백슬래시·
 *    공백·인증/API 경로·포트·사용자 정보)는 무시. 이미 그 화면이거나 로그인·가입 흐름 화면이면 무시.
 * ② `onAppLink` — 앱에서만 구독, appUrlOpen 으로 이동, 콜드 스타트 주소는 프로세스당 한 번(판정 전에 기록), 중복 이동 없음, 해제 후 무시.
 * ③ 소스 가드 — `@capacitor/*` import 없음·`window.Capacitor` 직접 접근 없음·로그인 딥링크 처리와 분리·구독자는 레이아웃의 한 곳.
 * ④ assetlinks.json — 구조·패키지명·지문이 build-apk.sh 상수·capacitor.config.ts appId 와 **같은 한 값**(드리프트 방지).
 */
import fs from 'node:fs';
import path from 'node:path';
import { APP_LINK_PATH, APP_LINK_SCHEME, onAppLink, resolveAppLinkTarget } from '../appLink';

const HOST = 'stock.xn--lh0b87pnudm10a4vd.com';
const ORIGIN = `https://${HOST}`;
const ROOT = path.join(__dirname, '..', '..', '..', '..');
const SRC = path.join(ROOT, 'src');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
/** 주석을 벗긴 코드(주석으로 처리한 줄이 가드를 통과하지 않게). */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('① resolveAppLinkTarget — 이동/무시 판정', () => {
  test.each<[string, unknown, string, string | null]>([
    // 이동
    ['루트(슬래시) · 지금 /order', `${ORIGIN}/`, '/order', '/'],
    ['루트(슬래시 없음 — URL 파서가 / 로 정규화) · 지금 /order', ORIGIN, '/order', '/'],
    ['쿼리 포함', `${ORIGIN}/?from=telegram`, '/order', '/?from=telegram'],
    ['조각 포함', `${ORIGIN}/#top`, '/order', '/#top'],
    ['다른 같은 출처 경로', `${ORIGIN}/strategies`, '/', '/strategies'],
    ['대문자 호스트(파서가 소문자로)', `https://STOCK.XN--LH0B87PNUDM10A4VD.COM/`, '/order', '/'],
    ['한글 도메인(파서가 퓨니코드로)', 'https://stock.미라클펭귄.com/', '/order', '/'],
    // 이미 그 화면
    ['이미 루트', `${ORIGIN}/`, '/', null],
    ['이미 같은 쿼리', `${ORIGIN}/?a=1`, '/?a=1', null],
    // 로그인·가입 흐름 화면에서는 이동하지 않음
    ['지금 /login', `${ORIGIN}/`, '/login', null],
    ['지금 /login?next=%2F', `${ORIGIN}/`, '/login?next=%2F', null],
    ['지금 /signup', `${ORIGIN}/`, '/signup', null],
    ['지금 /signup/request', `${ORIGIN}/`, '/signup/request', null],
    ['지금 /oauth/invite', `${ORIGIN}/`, '/oauth/invite', null],
    // 무시 — 출처·스킴
    ['다른 호스트', 'https://evil.example.com/', '/order', null],
    ['비슷한 호스트(접미어)', `https://${HOST}.evil.com/`, '/order', null],
    ['비슷한 호스트(접두어)', `https://evil${HOST}/`, '/order', null],
    ['http', `http://${HOST}/`, '/order', null],
    ['로그인 콜백 커스텀 스킴', 'stockinvest://auth/callback?code=' + 'a'.repeat(64), '/order', null],
    ['다른 커스텀 스킴', 'intent://x#Intent;end', '/order', null],
    ['javascript:', 'javascript:alert(1)', '/order', null],
    ['포트', `https://${HOST}:8443/`, '/order', null],
    ['기본 포트 443 은 파서가 지움 → 같은 출처', `https://${HOST}:443/`, '/order', '/'],
    ['사용자 정보', `https://user:pw@${HOST}/`, '/order', null],
    ['사용자 이름만', `https://user@${HOST}/`, '/order', null],
    // 무시 — 경로 변조(고쳐서 이동하지 않음)
    ['//evil.com 경로', `${ORIGIN}//evil.com`, '/order', null],
    ['/\\evil 경로', `${ORIGIN}/\\evil.com`, '/order', null],
    ['공백 인코딩(파서가 %20 으로 유지 → 같은 출처 경로)', `${ORIGIN}/a%20b`, '/order', '/a%20b'],
    ['점 구간으로 // 만들기', `${ORIGIN}/..//evil.com`, '/order', null],
    ['API 경로', `${ORIGIN}/api/orders`, '/order', null],
    ['로그인 화면으로', `${ORIGIN}/login`, '/order', null],
    ['OAuth 콜백', `${ORIGIN}/api/auth/google/callback?code=x`, '/order', null],
    // 같은 출처의 다른 경로는 sanitize 를 통과하면 이동한다 — Manifest 가 루트 `/` 만 받으므로 실제로는 오지 않는다(범위는 Manifest 가 정한다)
    ['같은 출처 다른 경로(/app/download/…)', `${ORIGIN}/app/download/latest.apk`, '/order', '/app/download/latest.apk'],
    // 무시 — 입력 형식
    ['문자열 아님', 42, '/order', null],
    ['null', null, '/order', null],
    ['빈 문자열', '', '/order', null],
    ['상대 경로', '/order', '/', null],
    ['파싱 불가', 'https://', '/order', null],
    ['너무 김', `${ORIGIN}/?q=${'x'.repeat(2100)}`, '/order', null],
    ['앞뒤 공백(파서가 잘라도 원문 기준은 같은 출처 경로)', ` ${ORIGIN}/ `, '/order', '/'],
  ])('%s', (_name, url, current, want) => {
    expect(resolveAppLinkTarget(url, HOST, current)).toBe(want);
  });

  test('appHost 가 비면 무시', () => {
    expect(resolveAppLinkTarget(`${ORIGIN}/`, '', '/order')).toBeNull();
  });
  test('Manifest 와 같은 스킴·경로 상수', () => {
    expect(APP_LINK_SCHEME).toBe('https');
    expect(APP_LINK_PATH).toBe('/');
  });
});

// ── ② onAppLink ───────────────────────────────────────────────────────────────

type G = { window?: unknown };
const g = globalThis as unknown as G;

function fakeStorage(throws = false) {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => { if (throws) throw new Error('blocked'); return m.has(k) ? m.get(k)! : null; },
    setItem: (k: string, v: string) => { if (throws) throw new Error('blocked'); m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
  };
}

interface FakeApp {
  listeners: Array<(d: { url?: unknown }) => void>;
  launch: string | null;
  addListener: jest.Mock;
  getLaunchUrl: jest.Mock;
}
function fakeApp(launch: string | null = null): FakeApp {
  const app: FakeApp = {
    listeners: [],
    launch,
    addListener: jest.fn((_ev: string, cb: (d: { url?: unknown }) => void) => {
      app.listeners.push(cb);
      return Promise.resolve({ remove: async () => { app.listeners = app.listeners.filter((l) => l !== cb); } });
    }),
    getLaunchUrl: jest.fn(async () => (app.launch === null ? undefined : { url: app.launch })),
  };
  return app;
}
function setWindow(opts: { native?: boolean; app?: FakeApp; path?: string; storage?: ReturnType<typeof fakeStorage> | null } = {}) {
  const st = opts.storage === undefined ? fakeStorage() : opts.storage;
  const u = new URL(opts.path ?? '/order', ORIGIN);
  g.window = {
    Capacitor: { isNativePlatform: () => opts.native ?? true, Plugins: opts.app ? { App: opts.app } : {} },
    location: { host: u.host, pathname: u.pathname, search: u.search, hash: u.hash, href: u.href, origin: u.origin },
    ...(st ? { sessionStorage: st } : {}),
  };
  return st;
}
const flush = () => new Promise((r) => setImmediate(r));
afterEach(() => { delete g.window; });

describe('② onAppLink — 구독·이동', () => {
  test('웹(isNativePlatform=false)에서는 구독하지도 묻지도 않는다', async () => {
    const app = fakeApp(`${ORIGIN}/`);
    setWindow({ native: false, app });
    const nav = jest.fn();
    const off = onAppLink(nav);
    await flush();
    expect(app.addListener).not.toHaveBeenCalled();
    expect(app.getLaunchUrl).not.toHaveBeenCalled();
    expect(nav).not.toHaveBeenCalled();
    off();
  });

  test('앱이 떠 있을 때 appUrlOpen(https 루트) → 루트로 한 번 이동, 같은 링크를 또 눌러도 페이지가 바뀌기 전엔 다시 부르지 않음', async () => {
    const app = fakeApp(null);
    setWindow({ app, path: '/order' });
    const nav = jest.fn();
    onAppLink(nav);
    await flush();
    app.listeners.forEach((l) => l({ url: `${ORIGIN}/` }));
    app.listeners.forEach((l) => l({ url: `${ORIGIN}/` }));
    expect(nav.mock.calls).toEqual([['/']]);
  });

  test('로그인 콜백 딥링크(stockinvest://)·다른 호스트·http 는 무시', async () => {
    const app = fakeApp(null);
    setWindow({ app, path: '/order' });
    const nav = jest.fn();
    onAppLink(nav);
    await flush();
    for (const url of ['stockinvest://auth/callback?code=' + 'b'.repeat(64), 'stockinvest://auth/callback?error=cancelled', 'https://evil.example.com/', `http://${HOST}/`, `${ORIGIN}//evil.com`]) {
      app.listeners.forEach((l) => l({ url }));
    }
    expect(nav).not.toHaveBeenCalled();
  });

  test('로그인 화면에 있으면 루트 링크가 와도 이동하지 않는다(Google 로그인 대기 화면을 지우지 않음)', async () => {
    const app = fakeApp(null);
    setWindow({ app, path: '/login?next=%2F' });
    const nav = jest.fn();
    onAppLink(nav);
    await flush();
    app.listeners.forEach((l) => l({ url: `${ORIGIN}/` }));
    expect(nav).not.toHaveBeenCalled();
  });

  test('콜드 스타트 주소: 처음 한 번만 처리하고(판정 전에 기록) 다시 불러와도 옛 주소로 되돌아가지 않는다', async () => {
    const st = fakeStorage();
    // 1) 콜드 스타트 — Capacitor 가 루트를 띄운 상태라 이동할 것이 없다(이미 루트). 그래도 기록은 남는다.
    setWindow({ app: fakeApp(`${ORIGIN}/`), path: '/', storage: st });
    const nav1 = jest.fn();
    onAppLink(nav1);
    await flush();
    expect(nav1).not.toHaveBeenCalled();
    expect([...st.m.values()]).toEqual([`${ORIGIN}/`]);
    // 2) 사용자가 /order 로 옮겨 페이지를 다시 불러옴 — getLaunchUrl 은 같은 옛 주소를 계속 준다 → 이동하지 않아야 한다.
    setWindow({ app: fakeApp(`${ORIGIN}/`), path: '/order', storage: st });
    const nav2 = jest.fn();
    onAppLink(nav2);
    await flush();
    expect(nav2).not.toHaveBeenCalled();
  });

  test('콜드 스타트 주소가 처음이고 지금 다른 화면이면 한 번 이동', async () => {
    const st = fakeStorage();
    setWindow({ app: fakeApp(`${ORIGIN}/?from=telegram`), path: '/', storage: st });
    const nav = jest.fn();
    onAppLink(nav);
    await flush();
    expect(nav.mock.calls).toEqual([['/?from=telegram']]);
  });

  test('sessionStorage 를 못 쓰면 콜드 스타트 주소는 처리하지 않는다(기록 없이 처리하면 다시 불러올 때마다 반복될 수 있음)', async () => {
    for (const storage of [null, fakeStorage(true)]) {
      setWindow({ app: fakeApp(`${ORIGIN}/?from=telegram`), path: '/', storage });
      const nav = jest.fn();
      onAppLink(nav);
      await flush();
      expect(nav).not.toHaveBeenCalled();
    }
  });

  test('콜드 스타트 주소가 https 가 아니면(로그인 콜백 코드 등) 저장소에 아무것도 쓰지 않고 이동도 없다 — 1회용 코드 원문을 남기지 않는다', async () => {
    for (const launch of [
      'stockinvest://auth/callback?code=' + 'a1'.repeat(32),
      'stockinvest://auth/callback?error=cancelled',
      'intent://x#Intent;end',
      'javascript:alert(1)',
      `http://${HOST}/`,
      'not a url',
    ]) {
      const st = fakeStorage();
      setWindow({ app: fakeApp(launch), path: '/order', storage: st });
      const nav = jest.fn();
      onAppLink(nav);
      await flush();
      expect([launch, [...st.m.entries()]]).toEqual([launch, []]);
      expect(nav).not.toHaveBeenCalled();
    }
  });

  test('같은 주소가 appUrlOpen(붙잡아 둔 콜드 스타트 이벤트)과 getLaunchUrl 로 함께 와도 이동은 한 번', async () => {
    const app = fakeApp(`${ORIGIN}/?from=telegram`);
    setWindow({ app, path: '/' });
    const nav = jest.fn();
    onAppLink(nav);
    app.listeners.forEach((l) => l({ url: `${ORIGIN}/?from=telegram` })); // getLaunchUrl 이 끝나기 전에 도착
    await flush();
    expect(nav.mock.calls).toEqual([['/?from=telegram']]);
  });

  test('해제 뒤에 온 링크는 무시하고 리스너도 지운다', async () => {
    const app = fakeApp(null);
    setWindow({ app, path: '/order' });
    const nav = jest.fn();
    const off = onAppLink(nav);
    await flush();
    const [listener] = app.listeners;
    off();
    await flush();
    listener({ url: `${ORIGIN}/` });
    expect(nav).not.toHaveBeenCalled();
    expect(app.listeners).toHaveLength(0);
  });

  test('navigate 가 던지면 다음 링크를 다시 받을 수 있다(던짐이 밖으로 새지 않음)', async () => {
    const app = fakeApp(null);
    setWindow({ app, path: '/order' });
    const nav = jest.fn().mockImplementationOnce(() => { throw new Error('x'); });
    onAppLink(nav);
    await flush();
    expect(() => app.listeners.forEach((l) => l({ url: `${ORIGIN}/` }))).not.toThrow();
    app.listeners.forEach((l) => l({ url: `${ORIGIN}/` }));
    expect(nav).toHaveBeenCalledTimes(2);
  });

  test('App 플러그인이 없으면 조용히 아무것도 안 한다', async () => {
    setWindow({ path: '/order' });
    const nav = jest.fn();
    const off = onAppLink(nav);
    await flush();
    expect(nav).not.toHaveBeenCalled();
    off();
  });
});

// ── ③ 소스 가드 ──────────────────────────────────────────────────────────────

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'node_modules') walk(p, out); }
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('③ 와이어링 소스 가드', () => {
  const appLinkSrc = read('src/lib/native/appLink.ts');
  const navigatorSrc = read('src/components/app/AppLinkNavigator.tsx');
  const layoutSrc = read('src/app/layout.tsx');
  const appLoginSrc = read('src/lib/native/appLogin.ts');
  const deepLinkSrc = read('src/components/auth/AppDeepLink.tsx');

  test('`@capacitor/*` import 없음·`window.Capacitor` 직접 접근 없음(브리지 경유)', () => {
    for (const s of [appLinkSrc, navigatorSrc]) {
      expect(s).not.toMatch(/from\s+['"]@capacitor\//);
      expect(s).not.toMatch(/require\(\s*['"]@capacitor\//);
      expect(code(s)).not.toMatch(/\bCapacitor\b/);
    }
    expect(code(appLinkSrc)).toContain("from './bridge'");
  });

  test('로그인 딥링크 처리와 분리 — appLink 는 onAuthDeepLink·parseAppDeepLink·appLogin 을 쓰지 않고, 로그인 쪽은 appLink 를 모른다', () => {
    const c = code(appLinkSrc);
    expect(c).not.toMatch(/onAuthDeepLink|parseAppDeepLink|appLogin|completeAppLogin|APP_DEEP_LINK/);
    expect(c).toContain("import { addAppUrlOpenListener, getLaunchUrl, isNativeApp } from './bridge';");
    expect(c).not.toContain('stockinvest_app_login'); // 로그인 쪽 저장소 키를 건드리지 않음
    for (const s of [appLoginSrc, deepLinkSrc]) expect(code(s)).not.toMatch(/appLink|AppLinkNavigator|onAppLink/);
  });

  test('이동 경로는 sanitizeAppNextPath 를 바뀌지 않고 통과해야 한다(고쳐서 이동하지 않음)', () => {
    expect(code(appLinkSrc)).toContain('if (sanitizeAppNextPath(target) !== target) return null;');
  });

  test('구독자는 하나 — `onAppLink(` 호출은 AppLinkNavigator 한 곳, `<AppLinkNavigator` 는 레이아웃 한 곳', () => {
    const files = walk(SRC);
    const callers = files.filter((f) => /\bonAppLink\(/.test(code(fs.readFileSync(f, 'utf8'))) && !f.endsWith(path.join('native', 'appLink.ts')));
    expect(callers.map((f) => path.relative(ROOT, f))).toEqual([path.join('src', 'components', 'app', 'AppLinkNavigator.tsx')]);
    expect(code(navigatorSrc)).toContain('useEffect(() => onAppLink(), []);');
    const mounts = files.filter((f) => /<AppLinkNavigator\b/.test(code(fs.readFileSync(f, 'utf8'))));
    expect(mounts.map((f) => path.relative(ROOT, f))).toEqual([path.join('src', 'app', 'layout.tsx')]);
    expect((code(layoutSrc).match(/<AppLinkNavigator \/>/g) ?? [])).toHaveLength(1);
  });

  test('레이아웃에서 `<AppLinkNavigator />` 는 `{children}` 뒤 — 로그인 딥링크(AppDeepLink) 구독이 먼저(붙잡아 둔 appUrlOpen 은 첫 구독자 하나에게만 간다)', () => {
    const c = code(layoutSrc);
    const children = c.indexOf('{children}');
    const nav = c.indexOf('<AppLinkNavigator />');
    expect(children).toBeGreaterThan(-1);
    expect(nav).toBeGreaterThan(children);
    expect(c.indexOf('{children}', children + 1)).toBe(-1); // {children} 은 한 번
  });

  test('AppLinkNavigator 는 아무것도 그리지 않는다', () => {
    expect(code(navigatorSrc)).toMatch(/return null;\s*\}\s*$/);
  });
});

// ── ④ assetlinks.json ────────────────────────────────────────────────────────

describe('④ public/.well-known/assetlinks.json — build-apk.sh·capacitor.config.ts 와 같은 한 값', () => {
  const raw = read('public/.well-known/assetlinks.json');
  const buildApk = read('scripts/build-apk.sh');
  const capConfig = read('capacitor.config.ts');
  const expectedCert = /^EXPECTED_CERT_SHA256="([0-9A-F:]+)"$/m.exec(buildApk)?.[1];
  const expectedAppId = /^EXPECTED_APP_ID="([^"]+)"$/m.exec(buildApk)?.[1];
  const capAppId = /^\s*appId:\s*'([^']+)'/m.exec(capConfig)?.[1];

  test('JSON 배열에 문장 하나 — relation 은 handle_all_urls 하나, namespace android_app', () => {
    const parsed = JSON.parse(raw) as unknown;
    expect(Array.isArray(parsed)).toBe(true);
    const arr = parsed as Array<Record<string, unknown>>;
    expect(arr).toHaveLength(1);
    expect(Object.keys(arr[0]).sort()).toEqual(['relation', 'target']);
    expect(arr[0].relation).toEqual(['delegate_permission/common.handle_all_urls']);
    const t = arr[0].target as Record<string, unknown>;
    expect(Object.keys(t).sort()).toEqual(['namespace', 'package_name', 'sha256_cert_fingerprints']);
    expect(t.namespace).toBe('android_app');
  });

  test('패키지 이름 = build-apk.sh EXPECTED_APP_ID = capacitor.config.ts appId', () => {
    const t = (JSON.parse(raw) as Array<{ target: { package_name: string } }>)[0].target;
    expect(expectedAppId).toBe('com.miraclepenguin.stockinvest');
    expect(t.package_name).toBe(expectedAppId);
    expect(capAppId).toBe(expectedAppId);
  });

  test('지문은 하나이고 build-apk.sh EXPECTED_CERT_SHA256 과 글자까지 같다(콜론 구분 대문자 32바이트)', () => {
    const t = (JSON.parse(raw) as Array<{ target: { sha256_cert_fingerprints: string[] } }>)[0].target;
    expect(expectedCert).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    expect(t.sha256_cert_fingerprints).toEqual([expectedCert]);
  });

  test('비밀처럼 보이는 값이 없다(공개 정보만)', () => {
    expect(raw).not.toMatch(/password|secret|keystore|BEGIN|token/i);
  });
});
