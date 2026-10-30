/**
 * T-084 — 승인 데모 v1(mockups/T-084-app-shell-v1.html) 기준 상태별 마크업 고정.
 * B 업데이트 띠(AppUpdateBannerView) · C 설정 › 앱 섹션(AppSectionView + deriveSectionModel) · 배치(layout·SettingsPage) ·
 * D 로그인 앱 분기(OAuthButtons 목록·loginFailureText). 숫자는 데모 합성값.
 *
 * T-088 — D 절은 승인 데모 v2(mockups/T-088-app-login-v2.html)로 바뀌었다: 웹·앱 같은 로그인 화면(Google + 이메일), 앱 전용 `oauth_account` 문구 삭제,
 * 설정 › 앱 설치 3단계 ③ 문구(앱에서 Google 로그인이 된다). 로그인 화면의 상태별 마크업·전이표는 `components/auth/__tests__/login-screen-t088.test.ts`.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ReactNS from 'react';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as unknown as { React: typeof ReactNS }).React = ReactNS;
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }), usePathname: () => '/settings' }));

import { AppUpdateBanner, AppUpdateBannerView, APP_SECTION_HREF } from '@/components/app/AppUpdateBanner';
import { AppSection, AppSectionView, deriveSectionModel, type SectionModel } from '@/app/settings/AppSection';
import { INITIAL_STATE, type AppUpdateState } from '@/components/app/useAppUpdate';
import { AppIcon } from '@/components/app/AppStyles';
import { OAuthButtons, visibleProviders } from '@/components/auth/OAuthButtons';
import { GENERIC_LOGIN_FAILURE, GOOGLE_ACCOUNT_TEXT, loginFailureText } from '@/components/auth/login-failure';
import { HIDDEN_PATHS } from '@/components/BottomTabs';

const SRC = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const textOf = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const noStyle = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, '');

const SHA = '3f9a1c7e' + 'b'.repeat(56);
const LATEST = { versionCode: 2, versionName: '1.0.1', sizeBytes: 9_800_000, sha256: SHA, notes: '키보드가 주문 수량 입력창을 가리던 문제 수정\n연결 실패 화면 문구 정리', minSupported: 1, downloadUrl: '/app/download/latest.apk' };
const ORIGIN = 'https://stock.xn--lh0b87pnudm10a4vd.com';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; SM-S936N) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36';
const PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130';
const CHECKED = Date.UTC(2026, 9, 25, 8, 20);

const st = (p: Partial<AppUpdateState>): AppUpdateState => ({ ...INITIAL_STATE, detected: true, currentLoaded: true, load: 'ready', checkedAt: CHECKED, ...p });
const web = (p: Partial<AppUpdateState>, ua = ANDROID) => deriveSectionModel(st({ native: false, ...p }), { origin: ORIGIN, userAgent: ua });
const app = (p: Partial<AppUpdateState>) => deriveSectionModel(st({ native: true, current: { version: '1.0.0', build: 1 }, ...p }), { origin: ORIGIN, userAgent: ANDROID });
const sec = (m: SectionModel) => noStyle(renderToStaticMarkup(h(AppSectionView, { model: m })));

describe('B. 업데이트 띠 (데모 band())', () => {
  const view = (kind: 'rec' | 'forced' | null, canDownload = true) =>
    noStyle(renderToStaticMarkup(h(AppUpdateBannerView, { kind, latestName: '1.0.1', currentName: '1.0.0', canDownload })));

  test('새 버전 — role=status · 글자 버튼 · [받기] · ✕(aria-label "오늘은 그만 보기")', () => {
    const html = view('rec');
    expect(html.startsWith('<div class="aub" role="status"><span class="bar" aria-hidden="true"></span>')).toBe(true);
    expect(html).toContain('<button type="button" class="txt"><span class="t num">주식캐기 v1.0.1</span><span class="ss">새 버전이 나왔습니다 · 눌러서 설치 방법 보기</span></button>');
    expect(html).toContain('<button type="button" class="get">받기</button>');
    expect(html).toContain('<button type="button" class="x" aria-label="오늘은 그만 보기"><svg');
  });
  test('다운로드 주소가 안전하지 않으면 [받기] 없음(글자·✕ 는 남음)', () => {
    const html = view('rec', false);
    expect(html).not.toContain('class="get"');
    expect(html).toContain('class="txt"');
    expect(html).toContain('aria-label="오늘은 그만 보기"');
  });
  test('필수 — 빨강 톤 클래스 + ⚠ + 글자, 닫기 없음, role=status', () => {
    const html = view('forced');
    expect(html).toContain('<div class="aub forced" role="status">');
    expect(html).toContain('<span class="t"><span aria-hidden="true">⚠ </span>앱 업데이트가 필요합니다</span>');
    expect(textOf(html)).toContain('이 버전(v1.0.0)은 더 이상 지원하지 않습니다. 화면은 계속 쓸 수 있지만 앱 기능 일부가 멈출 수 있습니다.');
    expect(html).toContain('<button type="button" class="get">업데이트</button>');
    expect(html).not.toContain('class="x"');
    expect(html).not.toContain('role="alert"');
  });
  test('없음 → 렌더 없음 · 실제 컴포넌트는 SSR(판별 전)에서 렌더 없음(웹 기본)', () => {
    expect(view(null)).toBe('');
    expect(renderToStaticMarkup(h(AppUpdateBanner))).toBe('');
  });
  test('띠 글자·[업데이트] 이동 목표 = 설정 › 앱 섹션', () => {
    expect(APP_SECTION_HREF).toBe('/settings#app');
  });
  test('띠 CSS: 흐름 안(고정·덮기 없음) · 안전영역 위쪽 여백 · 버튼 44px', () => {
    const css = renderToStaticMarkup(h(AppUpdateBannerView, { kind: 'rec', latestName: '1', currentName: '1', canDownload: true }));
    expect(css).toContain('padding: var(--safe-top) 4px 0 16px');
    expect(css).not.toMatch(/position:\s*(fixed|sticky|absolute)/);
    expect(css).toContain('.aub .get { flex: none; min-height: 44px;');
    expect(css).toContain('.aub .x { flex: none; width: 44px; height: 44px;');
  });
  test('인증 전 화면(HIDDEN_PATHS)을 BottomTabs 와 같은 목록으로 쓴다', () => {
    expect(HIDDEN_PATHS).toEqual(['/login', '/signup', '/signup/request', '/oauth/invite']);
    expect(read('components/app/AppUpdateBanner.tsx')).toContain("import { HIDDEN_PATHS } from '@/components/BottomTabs';");
  });
});

describe('C. 설정 › 앱 — 모델', () => {
  test('판별 전(SSR) = 웹 로딩', () => {
    expect(deriveSectionModel(INITIAL_STATE, { origin: '', userAgent: '' })).toEqual({ view: 'web', state: 'loading' });
  });
  test('웹: 로딩 · 오류 · 테이블 없음/등록 없음 = 올라온 앱 없음 · 정상', () => {
    expect(web({ load: 'loading', result: null })).toEqual({ view: 'web', state: 'loading' });
    expect(web({ result: { kind: 'error' } })).toEqual({ view: 'web', state: 'error' });
    expect(web({ result: { kind: 'not_migrated' } })).toEqual({ view: 'web', state: 'empty' });
    expect(web({ result: { kind: 'ok', latest: null } })).toEqual({ view: 'web', state: 'empty' });
    expect(web({ result: { kind: 'ok', latest: LATEST } })).toEqual({ view: 'web', state: 'ok', latest: LATEST, downloadPath: '/app/download/latest.apk', nonAndroid: false });
    expect(web({ result: { kind: 'ok', latest: LATEST } }, PC)).toMatchObject({ nonAndroid: true });
    expect(web({ result: { kind: 'ok', latest: { ...LATEST, downloadUrl: 'https://evil.example/x.apk' } } })).toMatchObject({ downloadPath: null });
  });
  test('앱: 설치 버전 읽기 전·조회 전 = 확인 중 · 새 버전 · 필수 · 최신 · 실패 · 등록 없음 · 모름', () => {
    expect(app({ currentLoaded: false, current: null })).toMatchObject({ view: 'app', state: 'loading' });
    expect(app({ load: 'loading', result: null })).toMatchObject({ view: 'app', state: 'loading' });
    expect(app({ result: { kind: 'ok', latest: LATEST } })).toMatchObject({ state: 'available', downloadPath: '/app/download/latest.apk', refreshing: false });
    expect(app({ result: { kind: 'ok', latest: { ...LATEST, minSupported: 2 } } })).toMatchObject({ state: 'required' });
    expect(app({ current: { version: '1.0.1', build: 2 }, result: { kind: 'ok', latest: LATEST } })).toMatchObject({ state: 'latest' });
    expect(app({ result: { kind: 'error' } })).toMatchObject({ state: 'error', latest: null });
    expect(app({ result: { kind: 'not_migrated' } })).toMatchObject({ state: 'none' });
    expect(app({ current: null, result: { kind: 'ok', latest: LATEST } })).toMatchObject({ state: 'unknown' });
    expect(app({ load: 'loading', result: { kind: 'ok', latest: LATEST } })).toMatchObject({ state: 'available', refreshing: true });
  });
});

describe('C. 설정 › 앱 — 마크업 (데모 webCard·appCard)', () => {
  test('머리글 id="app" (띠의 이동 목표) · "앱 (안드로이드)"', () => {
    expect(sec(web({ result: { kind: 'ok', latest: LATEST } }))).toContain('<div class="aps"><div class="sec-h" id="app">앱 (안드로이드)</div><div class="card apc">');
  });
  test('웹 로딩 · 오류(role=alert + 다시 시도) · 올라온 앱 없음', () => {
    expect(sec(web({ load: 'loading', result: null }))).toContain('<div class="ldg" role="status"><span class="spin" aria-hidden="true"></span>앱 정보를 불러오는 중…</div>');
    const err = sec(web({ result: { kind: 'error' } }));
    expect(err).toContain('<span class="st warn" role="alert"><span aria-hidden="true">!</span>앱 정보를 불러오지 못했습니다</span>');
    expect(err).toContain('>다시 시도</button>');
    const empty = textOf(sec(web({ result: { kind: 'ok', latest: null } })));
    expect(empty).toContain('—아직 올라온 앱이 없습니다첫 배포가 끝나면 이곳에 내려받기 버튼이 생깁니다.');
  });
  test('웹 정상: 이름·부제 · 최신 버전·크기 · 확인값 8자 · [APK 내려받기] 링크 · 3단계 · 파일 확인(전체 64자)', () => {
    const html = sec(web({ result: { kind: 'ok', latest: LATEST } }));
    const t = textOf(html);
    expect(t).toContain('주식캐기안드로이드 앱 · 주식 자동매매를 휴대폰 홈 화면에서');
    expect(html).toContain('<div class="meta"><span>최신 <b class="num">v1.0.1</b></span><span class="num">9.8MB</span></div>');
    expect(html).toContain('<div class="hash">파일 확인값(sha256) 앞 8자 <code>3f9a1c7e</code></div>');
    expect(html).toContain('<a class="btn-pri" href="/app/download/latest.apk" aria-describedby="ap-steps">APK 내려받기</a>');
    expect(html).toContain('<ol class="steps" id="ap-steps" aria-label="설치 순서">');
    expect(t).toContain('내려받기Chrome 이 "유해할 수 있는 파일입니다"라고 물으면 다운로드를 누릅니다.');
    expect(t).toContain('설치 허용받은 파일을 열고, "출처를 알 수 없는 앱 설치"를 물으면 Chrome 을 허용합니다(처음 한 번만).');
    // T-088(데모 v2 G 절): 앱에서 Google 로그인이 되므로 "지원하지 않습니다" 문구는 거짓이 됐다 — 고친 문구로 고정
    expect(t).toContain('설치 후 로그인홈 화면의 주식캐기를 열고 Google 또는 이메일·비밀번호로 로그인합니다. Google 로그인은 Chrome 창이 잠깐 열렸다가 앱으로 돌아옵니다.');
    expect(t).not.toContain('지원하지 않습니다');
    expect(t).not.toContain('GitHub');
    expect(html).toContain('<summary>받은 파일이 맞는지 확인하려면</summary>');
    expect(html).toContain('파일 이름 <code>stockinvest-1.0.1.apk</code>');
    expect(html).toContain(`<code class="full">${SHA}</code>`);
    expect(t).not.toContain('안드로이드 휴대폰이 아닙니다');
  });
  test('웹: 안드로이드가 아닌 기기 안내 1줄 · 안전하지 않은 주소면 버튼 숨김', () => {
    expect(textOf(sec(web({ result: { kind: 'ok', latest: LATEST } }, PC)))).toContain('이 기기는 안드로이드 휴대폰이 아닙니다. 휴대폰 Chrome 에서 설정 › 앱을 열어 내려받으세요.');
    const bad = sec(web({ result: { kind: 'ok', latest: { ...LATEST, downloadUrl: '//evil.example/a.apk' } } }));
    expect(bad).not.toContain('APK 내려받기');
    expect(bad).not.toContain('evil');
  });
  test('앱 새 버전: 설치·최신 줄 + ◆ 새 버전 · [업데이트 받기 (크기)] · 바뀐 점 · 마지막 확인 [다시 확인] · 설치 방법', () => {
    const html = sec(app({ result: { kind: 'ok', latest: LATEST } }));
    const t = textOf(html);
    expect(t).toContain('주식캐기 v1.0.0이 휴대폰에 설치된 앱');
    expect(html).toContain('<span class="l">설치된 버전</span><span class="v num">v1.0.0 <span class="muted" style="font-weight:400">(1)</span></span>');
    expect(t).toContain('최신 버전v1.0.1 ◆새 버전');
    expect(html).toContain('<button type="button" class="btn-pri">업데이트 받기 <span class="num" style="font-weight:600">(9.8MB)</span></button>');
    expect(html).toContain('<ul class="notes"><li>키보드가 주문 수량 입력창을 가리던 문제 수정</li><li>연결 실패 화면 문구 정리</li></ul>');
    expect(t).toContain('마지막 확인 10월 25일 17:20다시 확인');
    expect(html).toContain('<summary>업데이트 설치 방법</summary>');
    expect(html).not.toContain('nt red');
  });
  test('앱 필수: ⚠ 업데이트 필요 + 빨강 안내(role=note)', () => {
    const html = sec(app({ result: { kind: 'ok', latest: { ...LATEST, minSupported: 2 } } }));
    expect(html).toContain('<span class="st bad"><span aria-hidden="true">⚠</span>업데이트 필요</span>');
    expect(html).toContain('<div class="nt red" role="note"><b>⚠ 이 버전은 더 이상 지원하지 않습니다.</b>');
    expect(html).toContain('업데이트 받기');
  });
  test('앱 최신: ✓ 최신 · 업데이트 버튼·설치 방법 없음', () => {
    const html = sec(app({ current: { version: '1.0.1', build: 2 }, result: { kind: 'ok', latest: LATEST } }));
    expect(html).toContain('<span class="st ok"><span aria-hidden="true">✓</span>최신</span>');
    expect(html).not.toContain('업데이트 받기');
    expect(html).not.toContain('업데이트 설치 방법');
  });
  test('앱 확인 실패: ! 확인 실패 + 안내 문장 · 설치 버전은 표시', () => {
    const t = textOf(sec(app({ result: { kind: 'error' } })));
    expect(t).toContain('최신 버전— !확인 실패');
    expect(t).toContain('최신 버전을 확인하지 못했습니다. 설치된 앱은 그대로 쓸 수 있습니다.');
    expect(t).toContain('설치된 버전v1.0.0 (1)');
  });
  test('앱 확인 중 · 다시 확인 중(버튼 잠김)', () => {
    expect(sec(app({ load: 'loading', result: null }))).toContain('최신 버전을 확인하는 중…');
    expect(sec(app({ load: 'loading', result: { kind: 'ok', latest: LATEST } }))).toContain('<button type="button" class="btn-ghost" disabled="">확인 중…</button>');
  });
  test('상태는 기호+글자(색만으로 구분하지 않음)', () => {
    const states = [
      sec(app({ result: { kind: 'ok', latest: LATEST } })),
      sec(app({ result: { kind: 'ok', latest: { ...LATEST, minSupported: 2 } } })),
      sec(app({ current: { version: '1.0.1', build: 2 }, result: { kind: 'ok', latest: LATEST } })),
      sec(app({ result: { kind: 'error' } })),
    ].map(textOf);
    expect(states[0]).toContain('◆새 버전');
    expect(states[1]).toContain('⚠업데이트 필요');
    expect(states[2]).toContain('✓최신');
    expect(states[3]).toContain('!확인 실패');
  });
  test('실제 컴포넌트 SSR = 웹 로딩(판별 전) — 수화 불일치 없음', () => {
    const html = noStyle(renderToStaticMarkup(h(AppSection)));
    expect(html).toContain('id="app"');
    expect(html).toContain('앱 정보를 불러오는 중…');
  });
  test('아이콘 자리(ICON-SLOT) = 확정 아이콘 ②(AppIcon) — 곡괭이 시안 경로 없음 · 자리표시자 없음', () => {
    const src = read('components/app/AppStyles.tsx') + read('app/settings/AppSection.tsx');
    expect(src).toContain('ICON-SLOT');
    expect(src).not.toContain('rotate(-38');
    expect(src).not.toContain('AppIconPlaceholder');
    expect(read('app/settings/AppSection.tsx').match(/<AppIcon \/>/g)).toHaveLength(1);
  });
  test('AppIcon 도형 = 연결 실패 화면 로고(public/app-shell/index.html)와 같은 요소·순서 · 44px · 둥근 사각 · id 없음(여러 번 그려도 충돌 없음)', () => {
    // 요소를 "태그 + 정렬된 속성" 문자열로 정규화해 비교(React 는 strokeWidth → stroke-width, 닫는 태그를 따로 쓴다).
    const shapes = (svg: string) =>
      [...svg.matchAll(/<(rect|path|polygon|circle)\b([^>]*?)\/?>/g)].map(
        (m) => m[1] + ' ' + [...m[2].matchAll(/([a-z-]+)="([^"]*)"/g)].map((a) => `${a[1]}=${a[2]}`).sort().join(' '),
      );
    const shell = fs.readFileSync(path.join(SRC, '../public/app-shell/index.html'), 'utf8');
    const logo = shell.match(/<svg class="logo"[^>]*>([\s\S]*?)<\/svg>/)![0];
    const html = renderToStaticMarkup(h(AppIcon));
    expect(shapes(html)).toEqual(shapes(logo));
    expect(shapes(html)).toHaveLength(12); // 배경 3 + 전경 9(광맥·캔들 6·금덩이·결 선)
    expect(html).toContain('viewBox="18 18 72 72"');
    expect(logo).toContain('viewBox="18 18 72 72"');
    expect(html).toMatch(/width="44" height="44"/);
    expect(html).toContain('border-radius:22.222%');
    expect(html).toContain('overflow:hidden');
    expect(html).toContain('aria-hidden="true"');
    const twice = renderToStaticMarkup(h('div', null, h(AppIcon), h(AppIcon)));
    expect(twice).not.toMatch(/\sid="/);
    expect(twice).not.toMatch(/url\(#/);
  });
});

describe('배치 — 띠는 레이아웃 흐름 안 맨 위, 앱 섹션은 설정 맨 아래 안내 상자 바로 위', () => {
  test('layout: {children} 바로 앞에 <AppUpdateBanner /> 한 번', () => {
    const src = read('app/layout.tsx');
    expect(src.match(/<AppUpdateBanner \/>/g)).toHaveLength(1);
    expect(src.indexOf('<AppUpdateBanner />')).toBeLessThan(src.indexOf('{children}'));
    expect(src.indexOf("paddingBottom: 'calc(var(--nav-h) + var(--safe-bottom))'")).toBeLessThan(src.indexOf('<AppUpdateBanner />'));
  });
  test('SettingsPage: 정기 거래 리포트 뒤 · 안내 상자 앞에 한 번, 조회·저장 흐름과 무관', () => {
    const src = read('app/settings/SettingsPage.tsx');
    const at = src.indexOf('<AppSection />');
    expect(src.match(/<AppSection \/>/g)).toHaveLength(1);
    expect(at).toBeGreaterThan(src.indexOf('<SectionHeader title="정기 거래 리포트" />'));
    // T-108 §2.6 용어 정정(실거래 여부 → 실거래여부, KILL_SWITCH → 모든거래차단) — 안내 상자 기준 문구만 갱신
    expect(src.indexOf('실거래여부 / 모든거래차단 / 주문 한도는 DB에 저장되어')).toBeGreaterThan(-1);
    expect(at).toBeLessThan(src.indexOf('실거래여부 / 모든거래차단 / 주문 한도는 DB에 저장되어'));
    const effect = src.slice(src.indexOf('Promise.all(['), src.indexOf(']).then(([safetyData'));
    expect(effect).not.toMatch(/app\/version|AppSection/);
    const save = src.slice(src.indexOf('const handleSave'), src.indexOf('if (loading) return'));
    expect(save).not.toMatch(/app\/version|AppSection/);
  });
});

describe('D. 로그인 — 웹·앱 같은 화면 (T-088 데모 v2)', () => {
  test('OAuth 버튼: Google 만(GitHub·모르는 값 무시) · 목록이 없거나 비면 아무것도 그리지 않는다', () => {
    expect(visibleProviders(['google', 'github'])).toEqual(['google']);
    expect(visibleProviders(['github', 'google'])).toEqual(['google']);
    expect(visibleProviders(['github', 'x'])).toEqual([]);
    expect(visibleProviders(undefined)).toEqual([]);
    expect(visibleProviders('google')).toEqual([]);
    // 실제 컴포넌트 SSR(목록을 받기 전·판별 전) = 웹과 같다 — 렌더 없음(수화 불일치 없음)
    expect(renderToStaticMarkup(h(OAuthButtons, {}))).toBe('');
    expect(renderToStaticMarkup(h(OAuthButtons, { appLogin: true }))).toBe('');
  });
  test('OAuthButtons: 판별은 마운트 뒤 effect 에서만 · 앱의 가입 화면(appLogin 아님)은 조회 없이 빈 목록', () => {
    const src = read('components/auth/OAuthButtons.tsx');
    const eff = src.slice(src.indexOf('// 앱 판별은 마운트 뒤에만'));
    expect(eff.indexOf('const nat = isNativeApp();')).toBeGreaterThan(0);
    expect(eff.indexOf('if (nat && !appLogin)')).toBeGreaterThan(eff.indexOf('const nat = isNativeApp();'));
    expect(eff.indexOf('if (nat && !appLogin)')).toBeLessThan(eff.indexOf("fetch('/api/auth/oauth-providers')"));
    // 렌더 본문(훅 바깥)에서 직접 isNativeApp() 를 부르지 않는다 — 첫 렌더는 웹과 같다.
    // 부르는 곳은 정확히 둘: 마운트 effect 의 `const nat = isNativeApp();`(그리기 전용 상태) · 클릭 핸들러 안의 `pickStartMode(isNativeApp())`(F2, 클릭 시점 재평가).
    const render = src.slice(src.indexOf('export function OAuthButtons('), src.indexOf('export const oauthStyles'));
    expect(render.match(/isNativeApp\(\)/g)).toHaveLength(2);
    const rest = render
      .replace('const nat = isNativeApp();', '')
      .replace("onStart={() => { if (pickStartMode(isNativeApp()) === 'app')", '');
    expect(rest).not.toMatch(/isNativeApp\(\)/);
  });
  test('웹: 기존 분기·문구 그대로(oauth_account 의 "아래"만 D5 A 로 "위의")', () => {
    expect(loginFailureText({ status: 429, detail: '잠시 후' })).toBe('잠시 후');
    expect(loginFailureText({ status: 429 })).toBe('시도가 많습니다. 잠시 후 다시 시도하세요');
    expect(loginFailureText({ status: 503 })).toBe('서버 인증 설정(AUTH_SESSION_SECRET)이 없습니다');
    const detail = 'Google로 가입된 계정입니다. 아래 Google로 계속하기를 눌러 로그인하세요.';
    expect(loginFailureText({ status: 401, error: 'oauth_account', detail, provider: 'google' }))
      .toBe('Google로 가입된 계정입니다. 위의 Google로 계속하기를 눌러 로그인하세요.');
    expect(GOOGLE_ACCOUNT_TEXT).toBe('Google로 가입된 계정입니다. 위의 Google로 계속하기를 눌러 로그인하세요.');
    expect(loginFailureText({ status: 401, error: 'oauth_account' })).toBe(GENERIC_LOGIN_FAILURE);
    expect(loginFailureText({ status: 401, error: 'invalid' })).toBe('이메일 또는 비밀번호가 올바르지 않습니다');
  });
  test('앱 + oauth_account: 웹과 같은 문구 — T-084 의 앱 전용 문구("앱에서는 … 지원하지 않습니다")는 없다', () => {
    // 주석(고친 이력 설명)은 빼고 코드만 본다
    const src = read('components/auth/login-failure.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toContain('appOauthAccountText');
    expect(src).not.toContain('지원하지 않습니다');
    expect(src).not.toMatch(/native/);
    // 시그니처에 앱 판별 인자가 없다 — 웹·앱이 같은 함수·같은 결과
    expect(loginFailureText.length).toBe(1);
    // Google 이 아닌 제공자는 서버 문구 그대로(운영에는 없음)
    expect(loginFailureText({ status: 401, error: 'oauth_account', detail: '서버 문구', provider: 'github' })).toBe('서버 문구');
  });
  test('로그인 페이지: 제목 그대로 · 같은 OAuthButtons(appLogin) · AppDeepLink · 오류 상자 · 앱 전용 분리 컴포넌트 없음', () => {
    const src = read('app/login/page.tsx');
    expect(src).toContain('<AuthShell title="주식 자동매매" subtitle="계속하려면 로그인하세요">');
    // T-091: 옛 앱 게이트 알림(onAppGate)만 더해졌다 — 같은 컴포넌트·같은 appLogin
    expect(src).toContain('<OAuthButtons nextPath={nextPath} appLogin onAppGate={setAppGateVersion} />');
    expect(src).toContain('<AppDeepLink nextPath={nextPath} />');
    expect(src).toContain('<OAuthErrorNote code={oauthError} native={native} noteRef={noteRef} />');
    expect(src).toContain('provider: data.provider }));');
    expect(src).not.toMatch(/loginFailureText\([^)]*native/);
    expect(src).toContain('const [native, setNative] = useState(false);');
    expect(src).toContain('setNative(isNativeApp());');
    expect(fs.existsSync(path.join(SRC, 'components/auth/AppLoginArea.tsx'))).toBe(false);
  });
});

describe('웹 번들은 @capacitor/* 를 import 하지 않는다 (window.Capacitor 전역만)', () => {
  test.each([
    'components/app/AppUpdateBanner.tsx', 'components/app/useAppUpdate.ts', 'components/app/app-update-logic.ts', 'components/app/AppStyles.tsx',
    'app/settings/AppSection.tsx', 'components/auth/OAuthButtons.tsx', 'components/auth/login-failure.ts', 'app/login/page.tsx', 'app/layout.tsx',
    // T-088
    'components/auth/AppDeepLink.tsx', 'components/auth/OAuthErrorNote.tsx', 'lib/native/appLoginSignal.ts',
  ])('%s', (rel) => {
    expect(read(rel)).not.toMatch(/from ['"]@capacitor\//);
    expect(read(rel)).not.toMatch(/require\(['"]@capacitor\//);
  });
  test('클라이언트 로직은 node:path 를 쓰는 app-release/paths 를 import 하지 않는다', () => {
    for (const rel of ['components/app/app-update-logic.ts', 'components/app/useAppUpdate.ts', 'components/app/AppUpdateBanner.tsx', 'app/settings/AppSection.tsx']) {
      expect(read(rel)).not.toMatch(/(from|import\(|require\()\s*['"][^'"]*app-release\/paths['"]/);
    }
  });
});
