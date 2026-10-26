/**
 * T-091 — 옛 앱 버전 게이트(승인 데모 v1 **대안 B** `mockups/T-091-app-version-gate-v1.html` · task 진행 기록 "B 구현 규격").
 * ① 필요 최소 build 표·`appMeetsBuild` 경계값 · ② Google 자리 상태표(데모 D 표 — 웹·목록 빈 값·읽는 중·build 1/2/3/모름·가입 화면) ·
 * ③ 마크업(비활성 Google 버튼·띠 — 문구 글자 고정) · ④ [업데이트] → `openDownload('/app/download/latest.apk')` ·
 * ⑤ 버전 읽기(옛 앱 1.0.0 의 getInfo 모양 → 게이트) · 로그인 전 서버 조회 없음 · ⑥ 화면 조립 소스 가드(띠 위치·전역 띠와 겹침 없음·포커스 현행 유지).
 * jest 는 node 환경이라 effect 는 돌지 않는다 — 상태 판단은 순수 함수로, 그리기는 View 로, 클릭은 요소 트리의 onClick 을 직접 불러 시험한다.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ReactNS from 'react';
import { createElement as h, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as unknown as { React: typeof ReactNS }).React = ReactNS;

import { APP_FEATURE_MIN_BUILD, appMeetsBuild, appMeetsFeature, type AppFeature } from '@/lib/app-release/feature-gate';
import { LATEST_DOWNLOAD_NAME } from '@/lib/app-release/paths';
import { getAppVersion } from '@/lib/native/bridge';
import {
  GOOGLE_GATED_SUFFIX,
  INITIAL_APP_LOGIN,
  OAuthButtonsView,
  deriveGoogleSlot,
  gatedAppVersion,
  googleLoginGate,
  visibleProviders,
  type GoogleGate,
  type GoogleSlot,
  type GoogleSlotInput,
} from '@/components/auth/OAuthButtons';
import {
  APP_LATEST_DOWNLOAD_PATH,
  APP_UPDATE_BAND_ID,
  APP_UPDATE_REQUIRED_COPY,
  AppUpdateRequiredBand,
  openLatestDownload,
} from '@/components/auth/AppUpdateRequiredBand';
import { DOWNLOAD_PATH_PREFIX, safeDownloadPath } from '@/components/app/app-update-logic';
import { createAppUpdateStore, type AppUpdateDeps } from '@/components/app/useAppUpdate';
import { HIDDEN_PATHS } from '@/components/BottomTabs';

const SRC = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const noStyle = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, '');
const textOf = (html: string) => noStyle(html).replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#x27;/g, "'");
const noop = () => {};

type G = { window?: unknown };
const g = globalThis as unknown as G;
afterEach(() => { delete g.window; });

// ─────────────────────────────────────────────────────────────────────────────
describe('① 필요 최소 build 표 · appMeetsBuild', () => {
  test('표 — Google 로그인은 build 2(1.0.1)부터, 한 곳에서 관리', () => {
    expect(APP_FEATURE_MIN_BUILD).toEqual({ googleLogin: 2 });
    expect(Object.isFrozen(APP_FEATURE_MIN_BUILD)).toBe(true);
  });

  test.each([
    // [설명, native, build, 기대]
    ['앱 아님(웹) → true', false, 1, true],
    ['앱 · build 모름(null) → true', true, null, true],
    ['앱 · build 1 → false', true, 1, false],
    ['앱 · build 2 → true', true, 2, true],
    ['앱 · build 3 → true', true, 3, true],
  ] as Array<[string, boolean, number | null, boolean]>)('%s', (_d, native, build, want) => {
    expect(appMeetsBuild(native, build, APP_FEATURE_MIN_BUILD.googleLogin)).toBe(want);
    expect(appMeetsFeature(native, build, 'googleLogin')).toBe(want);
  });

  test('표에 없는 기능 키는 막지 않는다(타입은 표의 키만 받는다 — 런타임에 모르는 키가 와도 true)', () => {
    // 타입 밖 값은 캐스트로만 넣을 수 있다 — 오타는 컴파일 오류(AppFeature = keyof typeof APP_FEATURE_MIN_BUILD)
    expect(appMeetsFeature(true, 1, 'appLinks' as AppFeature)).toBe(true);
    expect(appMeetsFeature(true, 1, 'toString' as AppFeature)).toBe(true); // Object.prototype 이름도 표 항목으로 보지 않는다
    expect(appMeetsFeature(true, 1, '' as AppFeature)).toBe(true);
    const keys: AppFeature[] = ['googleLogin'];
    expect(Object.keys(APP_FEATURE_MIN_BUILD)).toEqual(keys);
  });

  test.each([[undefined], [null], [0], [-1], [1.5], ['x'], [Number.NaN], [3_000_000_000]])('잘못된 최소 build(%p)는 막지 않는다', (min) => {
    expect(appMeetsBuild(true, 1, min)).toBe(true);
  });

  test('숫자 문자열 최소 build("2")는 version.ts 규칙(parseVersionCode)대로 정수 2 로 읽는다', () => {
    expect(appMeetsBuild(true, 1, '2')).toBe(false);
    expect(appMeetsBuild(true, 2, '2')).toBe(true);
  });

  test('잘못된 설치 build(0·음수·소수·범위 밖)는 모름으로 — 막지 않는다', () => {
    for (const b of [0, -1, 1.5, Number.NaN, 3_000_000_000]) expect(appMeetsBuild(true, b, 2)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('② Google 자리 상태표 (데모 D 표 — B 판) — 컴포넌트와 같은 조립 함수 deriveGoogleSlot', () => {
  type App = GoogleSlotInput['app'];
  // 스토어 스냅샷 모양: 판별 전 / 읽는 중 / 읽음(값 있음·모름)
  const BEFORE: App = { detected: false, currentLoaded: false, current: null };
  const READING: App = { detected: true, currentLoaded: false, current: null };
  const WEB: App = { detected: true, currentLoaded: true, current: null }; // 웹은 판별 즉시 currentLoaded=true·current=null
  const UNKNOWN: App = { detected: true, currentLoaded: true, current: null }; // 앱인데 App 플러그인 없음·값 이상
  const build = (b: number, version = `1.0.${b - 1}`): App => ({ detected: true, currentLoaded: true, current: { version, build: b } });
  const slotOf = (list: unknown, native: boolean, appLogin: boolean, app: App) =>
    deriveGoogleSlot({ providers: list === null ? null : visibleProviders(list), native, appLogin, app });

  test.each([
    // [상황, 목록, native, appLogin, 스토어, 기대 자리, 기대 띠 버전]
    ['웹 브라우저(판별 전) → 버튼', ['google'], false, true, BEFORE, 'button', null],
    ['웹 브라우저(판별 뒤) → 버튼', ['google'], false, true, WEB, 'button', null],
    ['웹 브라우저(가입 화면) → 버튼', ['google'], false, false, WEB, 'button', null],
    ['서버 Google 설정 없음 + 앱 build 1 → 없음(띠도 없음)', [], true, true, build(1), 'none', null],
    ['목록 받기 전 + 앱 build 1 → 없음', null, true, true, build(1), 'none', null],
    ['앱 · 판별 전 → 없음', ['google'], true, true, BEFORE, 'none', null],
    ['앱 · 버전 읽는 중 → 없음', ['google'], true, true, READING, 'none', null],
    ['앱 · build 2 → 버튼', ['google'], true, true, build(2), 'button', null],
    ['앱 · build 3 → 버튼', ['google'], true, true, build(3), 'button', null],
    ['앱 · build 1 → 비활성 버튼 + 띠(v1.0.0)', ['google'], true, true, build(1), 'gated', '1.0.0'],
    ['앱 · 버전을 읽지 못함(null) → 버튼(막지 않음)', ['google'], true, true, UNKNOWN, 'button', null],
    ['앱 /signup(appLogin 아님) · build 1 → 없음(지금처럼)', ['google'], true, false, build(1), 'none', null],
  ] as Array<[string, unknown, boolean, boolean, App, GoogleSlot, string | null]>)(
    '%s',
    (_d, list, native, appLogin, app, slot, bandVersion) => {
      expect(slotOf(list, native, appLogin, app)).toEqual({ slot, bandVersion });
    },
  );

  test('googleLoginGate — 웹은 버전을 읽지 않아도 open, 앱은 읽기 전 reading', () => {
    const cases: Array<[boolean, boolean, number | null, GoogleGate]> = [
      [false, false, null, 'open'], [false, true, 1, 'open'],
      [true, false, null, 'reading'], [true, false, 1, 'reading'],
      [true, true, null, 'open'], [true, true, 1, 'gated'], [true, true, 2, 'open'],
    ];
    for (const [native, ready, build, want] of cases) expect(googleLoginGate(native, ready, build)).toBe(want);
  });

  test('gatedAppVersion — 버전 이름이 없으면 띠를 그리지 않는다(빈 v 표기 방지)', () => {
    expect(gatedAppVersion(true, 'gated', '')).toBeNull();
    expect(gatedAppVersion(true, 'gated', null)).toBeNull();
    expect(gatedAppVersion(true, 'gated', undefined)).toBeNull();
    expect(gatedAppVersion(true, 'open', '1.0.0')).toBeNull();
    expect(gatedAppVersion(false, 'gated', '1.0.0')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('③ 마크업 — 비활성 Google 버튼 · 띠 (데모 B, 문구 글자 고정)', () => {
  const view = (gated?: boolean) =>
    noStyle(renderToStaticMarkup(h(OAuthButtonsView, { state: INITIAL_APP_LOGIN, onStart: noop, onReopen: noop, onCancel: noop, gated })));
  const googleButton = (html: string) => html.match(/<button[^>]*>[\s\S]*?<\/button>/)?.[0] ?? '';

  test('기본(웹·새 앱·버전 모름) — 활성 Google 버튼, "(업데이트 후)"·aria-describedby 없음, 구분선 있음', () => {
    for (const html of [view(), view(false)]) {
      const btn = googleButton(html);
      expect(btn).not.toMatch(/disabled/);
      expect(btn).not.toContain('aria-describedby');
      expect(textOf(btn)).toBe('Google로 계속하기');
      expect(textOf(html)).toContain('또는 이메일로');
    }
  });

  test('옛 앱(gated) — 같은 자리에 비활성 버튼 + aria-describedby=띠 id + 라벨 "(업데이트 후)", 구분선 그대로', () => {
    const html = view(true);
    const btn = googleButton(html);
    expect(btn).toMatch(/\sdisabled=""/);
    expect(btn).toContain(`aria-describedby="${APP_UPDATE_BAND_ID}"`);
    expect(textOf(btn)).toBe('Google로 계속하기 (업데이트 후)');
    expect(GOOGLE_GATED_SUFFIX).toBe('(업데이트 후)');
    expect(textOf(html)).toContain('또는 이메일로');
    expect(html.match(/<button/g)).toHaveLength(1); // 안내 상자(권고 A)·설치 방법 펼치기 같은 다른 요소는 없다
  });

  test('띠 — role="status" · id · 필수 업데이트 띠와 같은 클래스(.aub.forced) · 문구 · [업데이트] 버튼', () => {
    const raw = renderToStaticMarkup(h(AppUpdateRequiredBand, { version: '1.0.0', onUpdate: noop }));
    expect(raw).toContain('<style'); // BannerStyles — 기존 띠 CSS 그대로
    const html = noStyle(raw);
    expect(html).toMatch(new RegExp(`^<div class="aub forced" id="${APP_UPDATE_BAND_ID}" role="status">`));
    expect(html).toContain('<span class="bar" aria-hidden="true"></span>');
    expect(html).toContain('<span aria-hidden="true">⚠ </span>');
    expect(textOf(html)).toBe('⚠ 앱 업데이트가 필요합니다이 버전(v1.0.0)에서는 Google 로그인을 쓸 수 없습니다.업데이트');
    expect(html).toMatch(/<button type="button" class="get">업데이트<\/button><\/div>$/);
  });

  test('문구 상수 — 제목은 기존 필수 업데이트 띠 제목과 같은 글자', () => {
    expect(APP_UPDATE_REQUIRED_COPY.title).toBe('앱 업데이트가 필요합니다');
    expect(APP_UPDATE_REQUIRED_COPY.body('1.0.0')).toBe('이 버전(v1.0.0)에서는 Google 로그인을 쓸 수 없습니다.');
    expect(APP_UPDATE_REQUIRED_COPY.action).toBe('업데이트');
    expect(read('components/app/AppUpdateBanner.tsx')).toContain(`</span>${APP_UPDATE_REQUIRED_COPY.title}</span>`);
    expect(APP_UPDATE_BAND_ID).toBe('app-update-required-band');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('④ [업데이트] → openDownload(/app/download/latest.apk)', () => {
  function setWindow(opts: { native?: boolean; open?: unknown }) {
    g.window = {
      Capacitor: {
        isNativePlatform: () => opts.native ?? true,
        Plugins: opts.open === undefined ? {} : { Browser: { open: opts.open } },
      },
      location: { href: 'https://stock.example.com/login', origin: 'https://stock.example.com' },
    };
  }
  const loc = () => (g.window as { location: { href: string } }).location;

  test('경로 상수 = 공개 /app/download/ + 서버의 latest 이름 · 업데이트 띠와 같은 검증을 통과(새 라우트 없음)', () => {
    expect(APP_LATEST_DOWNLOAD_PATH).toBe('/app/download/latest.apk');
    expect(APP_LATEST_DOWNLOAD_PATH).toBe(`${DOWNLOAD_PATH_PREFIX}${LATEST_DOWNLOAD_NAME}`);
    expect(safeDownloadPath(APP_LATEST_DOWNLOAD_PATH, 'https://stock.example.com')).toBe(APP_LATEST_DOWNLOAD_PATH);
  });

  test('앱 + Browser 플러그인: Chrome 창(Custom Tab)으로 latest.apk', async () => {
    const open = jest.fn(async () => {});
    setWindow({ open });
    await openLatestDownload();
    expect(open).toHaveBeenCalledWith({ url: 'https://stock.example.com/app/download/latest.apk' });
    expect(loc().href).toBe('https://stock.example.com/login'); // 폴백 이동 없음
  });

  test('Browser 플러그인 없음·열기 실패: 같은 화면 이동 폴백(업데이트 띠와 같음)', async () => {
    setWindow({});
    await openLatestDownload();
    expect(loc().href).toBe('/app/download/latest.apk');
    setWindow({ open: jest.fn(async () => { throw new Error('x'); }) });
    await openLatestDownload();
    expect(loc().href).toBe('/app/download/latest.apk');
  });

  test('띠의 기본 [업데이트] 동작 = openLatestDownload (요소 트리의 onClick 을 직접 누른다)', async () => {
    const open = jest.fn(async () => {});
    setWindow({ open });
    const el = AppUpdateRequiredBand({ version: '1.0.0' }) as ReactElement<{ children: ReactNode }>;
    const kids = ReactNS.Children.toArray(el.props.children).filter(isValidElement) as Array<ReactElement<{ onClick?: () => void }>>;
    const btn = kids.find((k) => k.type === 'button');
    expect(btn).toBeDefined();
    btn!.props.onClick!();
    await new Promise((r) => setImmediate(r));
    expect(open).toHaveBeenCalledWith({ url: 'https://stock.example.com/app/download/latest.apk' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('⑤ 설치 버전 읽기 · 로그인 전 서버 조회 없음', () => {
  test('옛 앱 1.0.0 의 getInfo 모양({version:"1.0.0", build:"1"} — build 는 문자열) → build 1 → 게이트', async () => {
    g.window = { Capacitor: { isNativePlatform: () => true, Plugins: { App: { getInfo: async () => ({ version: '1.0.0', build: '1' }) } } } };
    const v = await getAppVersion();
    expect(v).toEqual({ version: '1.0.0', build: 1 });
    expect(googleLoginGate(true, true, v!.build)).toBe('gated');
    expect(gatedAppVersion(true, 'gated', v!.version)).toBe('1.0.0');
  });

  test('1.0.1({build:"2"}) → 지금 그대로 · App 플러그인 없음 → 모름 → 지금 그대로', async () => {
    g.window = { Capacitor: { isNativePlatform: () => true, Plugins: { App: { getInfo: async () => ({ version: '1.0.1', build: '2' }) } } } };
    expect(googleLoginGate(true, true, (await getAppVersion())?.build ?? null)).toBe('open');
    g.window = { Capacitor: { isNativePlatform: () => true, Plugins: {} } };
    expect(await getAppVersion()).toBeNull();
    expect(googleLoginGate(true, true, null)).toBe('open');
  });

  function deps(native: boolean) {
    const d: AppUpdateDeps = {
      isNative: () => native,
      getVersion: jest.fn(async () => ({ version: '1.0.0', build: 1 })),
      fetchVersion: jest.fn(async () => ({ status: 200, body: { ok: true, latest: null } })),
      now: () => 0,
    };
    return d;
  }

  test('로그인 화면이 쓰는 detect() 는 설치 버전만 읽고 GET /api/app/version(로그인 필요)은 부르지 않는다', async () => {
    const d = deps(true);
    const s = createAppUpdateStore(d);
    s.detect();
    expect(s.getSnapshot()).toMatchObject({ detected: true, native: true, currentLoaded: false }); // 읽는 중 → Google 자리 비움
    await new Promise((r) => setImmediate(r));
    expect(s.getSnapshot()).toMatchObject({ currentLoaded: true, current: { version: '1.0.0', build: 1 }, load: 'idle' });
    expect(d.getVersion).toHaveBeenCalledTimes(1);
    expect(d.fetchVersion).not.toHaveBeenCalled();
  });

  test('웹: detect() 는 설치 버전을 읽지도 않는다', () => {
    const d = deps(false);
    const s = createAppUpdateStore(d);
    s.detect();
    expect(s.getSnapshot()).toMatchObject({ detected: true, native: false, currentLoaded: true, current: null });
    expect(d.getVersion).not.toHaveBeenCalled();
    expect(d.fetchVersion).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('⑥ 화면 조립 소스 가드', () => {
  const page = read('app/login/page.tsx');
  const buttons = read('components/auth/OAuthButtons.tsx');
  const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\/\/[^\n'"`]*$/gm, '');

  test('띠는 AuthShell 카드 **위**(문서 흐름 맨 위)에, 게이트 버전이 있을 때만', () => {
    const band = page.indexOf('{appGateVersion !== null && <AppUpdateRequiredBand version={appGateVersion} />}');
    expect(band).toBeGreaterThan(0);
    expect(band).toBeLessThan(page.indexOf('<AuthShell title="주식 자동매매"'));
    expect(page).toContain('const [appGateVersion, setAppGateVersion] = useState<string | null>(null);');
    expect(page).toContain('<OAuthButtons nextPath={nextPath} appLogin onAppGate={setAppGateVersion} />');
    expect(page.match(/<AppUpdateRequiredBand/g)).toHaveLength(1);
  });

  test('첫 포커스는 현행 유지(D2 — 이메일 칸, 앱의 oauth_error 만 예외)', () => {
    expect(page).toContain("if (isNativeApp() && new URLSearchParams(window.location.search).get('oauth_error') !== null) return;\n    emailRef.current?.focus();\n  }, []);");
    expect(code(page)).not.toMatch(/appGateVersion[^\n]*focus|focus[^\n]*appGateVersion/);
  });

  test('로그인 화면 쪽 코드는 서버 버전 조회(ensureLoaded · /api/app/version)를 하지 않는다', () => {
    for (const rel of ['app/login/page.tsx', 'components/auth/OAuthButtons.tsx', 'components/auth/AppUpdateRequiredBand.tsx']) {
      const src = code(read(rel));
      expect(src).not.toMatch(/ensureLoaded|refresh\(|\/api\/app\/version|installResumeRefetch/);
    }
    expect(buttons).toContain('useEffect(() => { appUpdateStore.detect(); }, []);');
  });

  test('OAuthButtons: 기존 그리기 조건 뒤에 "자리가 none 이면 그리지 않음"(버전 읽는 중 포함)', () => {
    const a = buttons.indexOf('if (!isOAuthVisible(providers, native, appLogin)) return null;');
    const b = buttons.indexOf("if (slot === 'none') return null;");
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(buttons).toContain("gated={slot === 'gated'}");
  });

  test('OAuthButtons 조립: 상태표 시험과 같은 deriveGoogleSlot 에 컴포넌트의 실제 값을 넘기고, 띠 버전을 effect 로 로그인 화면에 알린다', () => {
    const body = buttons.slice(buttons.indexOf('export function OAuthButtons('), buttons.indexOf('export const oauthStyles'));
    expect(body).toContain('const app = useAppUpdateState();');
    expect(body).toContain('const { slot, bandVersion } = deriveGoogleSlot({ providers, native, appLogin, app });');
    // 이 effect 한 줄이 빠지거나 deps 에서 bandVersion 이 빠지면 옛 앱에 설명 없는 비활성 버튼만 남는다(Reviewer 변이 M07·M22)
    expect(body).toContain('useEffect(() => { onAppGate?.(bandVersion); }, [onAppGate, bandVersion]);');
    expect(body.match(/onAppGate\?\.\(/g)).toHaveLength(1);
    expect(body.match(/deriveGoogleSlot\(/g)).toHaveLength(1);
    // 컴포넌트 안에서 게이트를 따로 조립하지 않는다(시험과 갈라지지 않게)
    expect(body).not.toMatch(/googleLoginGate\(|gatedAppVersion\(/);
  });

  test('deriveGoogleSlot 조립 본문: 버전 읽기 완료 = detected && currentLoaded · build 모름은 null 그대로 · 띠는 visible 과 gate 로', () => {
    const fn = buttons.slice(buttons.indexOf('export function deriveGoogleSlot('), buttons.indexOf('// ── 앱에서만 생기는 상태'));
    expect(fn).toContain('const visible = isOAuthVisible(providers, native, appLogin);');
    expect(fn).toContain('const gate = googleLoginGate(native, app.detected && app.currentLoaded, app.current?.build ?? null);');
    expect(fn).toContain('return { slot, bandVersion: gatedAppVersion(visible, gate, app.current?.version) };');
  });

  test('전역 업데이트 띠(AppUpdateBanner)는 로그인 화면에서 그리지도 조회하지도 않는다 — 두 띠가 함께 뜨지 않음', () => {
    expect(HIDDEN_PATHS).toContain('/login');
    const banner = read('components/app/AppUpdateBanner.tsx');
    expect(banner).toContain('const hiddenPath = pathname !== null && HIDDEN_PATHS.includes(pathname);');
    expect(banner).toContain('if (!s.native || hiddenPath) return;'); // 조회(ensureLoaded) 전 가드
    expect(banner).toContain('if (!s.detected || !s.native || hiddenPath || !s.currentLoaded) return null;');
  });

  test('새 파일은 @capacitor/* · node:path 를 쓰는 app-release/paths 를 import 하지 않는다(웹 번들)', () => {
    for (const rel of ['lib/app-release/feature-gate.ts', 'components/auth/AppUpdateRequiredBand.tsx', 'components/auth/OAuthButtons.tsx']) {
      const src = read(rel);
      expect(src).not.toMatch(/from ['"]@capacitor\//);
      expect(src).not.toMatch(/(from|import\(|require\()\s*['"][^'"]*app-release\/paths['"]/);
      expect(src).not.toMatch(/from ['"](node:)?(fs|path)['"]/);
    }
  });

  test('앱 WebView 가 /api/auth/google 로 가는 새 경로가 없다(옛 앱 폴백 포함)', () => {
    expect(code(read('components/auth/AppUpdateRequiredBand.tsx'))).not.toMatch(/\/api\/auth\//);
    expect(code(read('lib/app-release/feature-gate.ts'))).not.toMatch(/\/api\/auth\//);
  });
});
