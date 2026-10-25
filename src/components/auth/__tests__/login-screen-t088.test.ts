/**
 * T-088 — 승인 데모 v2(mockups/T-088-app-login-v2.html) 기준 웹·앱 공용 로그인 화면.
 * ① 앱 상태 전이표(`appLoginReducer`, DOM·타이머 없이) · ② 상태별 마크업(`OAuthButtonsView`) · ③ 오류 상자(`OAuthErrorNote`) ·
 * ④ 딥링크 마무리(`AppDeepLink` 순수 도우미·덮개·배경 막기) · ⑤ 브리지 확장(`addBrowserFinishedListener`·`closeExternalBrowser`) ·
 * ⑥ 신호 모듈 · ⑦ 소스 가드(앱에서 WebView 안 이동 금지·next 검사 두 줄 불변·구독자 1개).
 * jest 는 node 환경이라 `window` 는 가짜를 꽂았다 뺀다(appLogin-t088.test.ts 와 같은 방식).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ReactNS from 'react';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as unknown as { React: typeof ReactNS }).React = ReactNS;

import {
  APP_LOGIN_COPY,
  CLOSED_GRACE_MS,
  INITIAL_APP_LOGIN,
  OAuthButtonsView,
  appLoginReducer,
  isOAuthVisible,
  pickStartMode,
  visibleProviders,
  waitingExpiryMs,
  type AppLoginEvent,
  type AppLoginNotice,
  type AppLoginPhase,
  type AppLoginState,
} from '@/components/auth/OAuthButtons';
import { OAUTH_ERROR_TEXT, OAuthErrorNote, SIGNUP_REQUIRES_WEB_COPY, oauthErrorText } from '@/components/auth/OAuthErrorNote';
import { APP_DEEP_LINK_COPY, AppDeepLink, AppLoginCover, finishDestination, loginErrorHref, lockBackground } from '@/components/auth/AppDeepLink';
import { addBrowserFinishedListener, closeExternalBrowser } from '@/lib/native/bridge';
import { APP_LOGIN_TTL_MS } from '@/lib/native/appLogin';
import { __resetAppLoginSignalForTest, notifyAppLoginLink, subscribeAppLoginLink } from '@/lib/native/appLoginSignal';

const SRC = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const noStyle = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, '');
const textOf = (html: string) => noStyle(html).replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#x27;/g, "'");
const noop = () => {};

const S = (phase: AppLoginPhase, notice: AppLoginNotice | null = null): AppLoginState => ({ phase, notice });
const view = (state: AppLoginState) => noStyle(renderToStaticMarkup(h(OAuthButtonsView, { state, onStart: noop, onReopen: noop, onCancel: noop })));

// ─────────────────────────────────────────────────────────────────────────────
describe('① 앱 상태 전이표 (데모 C 표)', () => {
  const PHASES: AppLoginPhase[] = ['idle', 'opening', 'waiting', 'exchanging'];
  const EVENTS: AppLoginEvent[] = [
    { type: 'CLICK' }, { type: 'OPENED' }, { type: 'OPEN_FAILED' }, { type: 'REOPEN' }, { type: 'LINK_CODE' },
    { type: 'LINK_ERROR' }, { type: 'CANCEL' }, { type: 'WINDOW_CLOSED' }, { type: 'EXPIRED' },
  ];

  test.each([
    // [지금, 사건, 다음]
    [S('idle'), 'CLICK', S('opening')],
    [S('idle', 'closed'), 'CLICK', S('opening')], // 안내 줄은 다시 누르면 사라진다
    [S('opening'), 'OPENED', S('waiting')],
    [S('opening'), 'OPEN_FAILED', S('idle', 'openFailed')],
    [S('waiting'), 'REOPEN', S('opening')],
    [S('waiting'), 'LINK_CODE', S('exchanging')],
    [S('waiting'), 'CANCEL', S('idle', 'cancelled')],
    [S('waiting'), 'WINDOW_CLOSED', S('idle', 'closed')],
    [S('waiting'), 'EXPIRED', S('idle', 'expired')],
    [S('idle'), 'LINK_CODE', S('exchanging')], // 앱 콜드 스타트 — 대기 없이 바로 마무리 중
    [S('idle', 'expired'), 'LINK_CODE', S('exchanging')],
    [S('opening'), 'LINK_CODE', S('exchanging')],
  ] as Array<[AppLoginState, AppLoginEvent['type'], AppLoginState]>)('%j + %s → %j', (from, type, to) => {
    expect(appLoginReducer(from, { type } as AppLoginEvent)).toEqual(to);
  });

  test('오류 딥링크는 대기 카드를 그대로 둔다(곧 /login 으로 이동 — 같은 객체)', () => {
    const w = S('waiting');
    expect(appLoginReducer(w, { type: 'LINK_ERROR' })).toBe(w);
  });

  test('마무리 중(exchanging)은 어떤 사건도 받지 않는다 — 화면이 이동할 때까지 유지(두 번 누를 곳이 없다)', () => {
    const x = S('exchanging');
    for (const e of EVENTS) expect(appLoginReducer(x, e)).toBe(x);
  });

  test('표에 없는 (상태, 사건) 조합은 같은 객체를 돌려준다 — 다시 그리지 않는다', () => {
    const defined = new Set([
      'idle:CLICK', 'opening:OPENED', 'opening:OPEN_FAILED', 'waiting:REOPEN', 'waiting:CANCEL', 'waiting:WINDOW_CLOSED', 'waiting:EXPIRED',
      'idle:LINK_CODE', 'opening:LINK_CODE', 'waiting:LINK_CODE',
    ]);
    for (const phase of PHASES.filter((p) => p !== 'exchanging')) {
      for (const e of EVENTS) {
        if (defined.has(`${phase}:${e.type}`)) continue;
        const s = S(phase, phase === 'idle' ? 'closed' : null);
        expect(appLoginReducer(s, e)).toBe(s);
      }
    }
  });

  test('시작 상태 = 기본(웹은 이 상태에서 한 번도 벗어나지 않는다)', () => {
    expect(INITIAL_APP_LOGIN).toEqual({ phase: 'idle', notice: null });
  });

  test('10분은 로그인 시작 시각부터 — 다시 열기로 대기에 들어와도 새로 세지 않는다', () => {
    expect(APP_LOGIN_TTL_MS).toBe(10 * 60 * 1000);
    expect(waitingExpiryMs(1_000, 1_000)).toBe(APP_LOGIN_TTL_MS);
    expect(waitingExpiryMs(1_000, 1_000 + 4 * 60 * 1000)).toBe(6 * 60 * 1000);
    expect(waitingExpiryMs(1_000, 1_000 + APP_LOGIN_TTL_MS)).toBe(0);
    expect(waitingExpiryMs(1_000, 1_000 + APP_LOGIN_TTL_MS + 5_000)).toBe(0);
    // 시작 시각을 모르거나(0) 시계가 거꾸로 가면 가장 긴 값(10분) — 즉시 풀지 않는다
    expect(waitingExpiryMs(0, 999_999)).toBe(APP_LOGIN_TTL_MS);
    expect(waitingExpiryMs(5_000, 1_000)).toBe(APP_LOGIN_TTL_MS);
    expect(waitingExpiryMs(Number.NaN, 1_000)).toBe(APP_LOGIN_TTL_MS);
  });

  test('창 닫힘 뒤 딥링크를 기다리는 시간 = 1.5초(D4 A)', () => {
    expect(CLOSED_GRACE_MS).toBe(1500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('② 문구 (데모 COPY — 합니다체, 글자까지 고정)', () => {
  test('APP_LOGIN_COPY', () => {
    expect(APP_LOGIN_COPY).toEqual({
      opening: 'Chrome 창을 여는 중…',
      waitTitle: 'Chrome 창에서 로그인하는 중입니다',
      waitBody: 'Google 로그인을 마치면 이 앱으로 자동으로 돌아옵니다.',
      waitHint: '창을 닫았다면 아래에서 다시 열 수 있습니다. 10분 안에 마치지 못하면 처음부터 다시 눌러야 합니다.',
      reopen: 'Chrome 창 다시 열기',
      cancel: '취소',
      closed: '로그인 창이 닫혔습니다. 다시 눌러 주세요.',
      expired: '로그인 요청 시간(10분)이 지났습니다. 다시 눌러 주세요.',
      cancelled: '소셜 로그인을 취소했습니다.',
      openFailed: 'Chrome 창을 열지 못했습니다. 잠시 후 다시 눌러 주세요.',
      exchanging: '로그인 마무리 중…',
    });
  });
  test('[취소] 안내는 웹의 기존 cancelled 오류 문구와 같은 글자', () => {
    expect(APP_LOGIN_COPY.cancelled).toBe(OAUTH_ERROR_TEXT.cancelled);
  });
  test('거짓 안심·값 노출 문구 없음', () => {
    const all = JSON.stringify(APP_LOGIN_COPY) + JSON.stringify(OAUTH_ERROR_TEXT) + JSON.stringify(SIGNUP_REQUIRES_WEB_COPY) + JSON.stringify(APP_DEEP_LINK_COPY);
    expect(all).not.toMatch(/안전하게|안심|보호됩니다|토큰|세션 값/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('② Google 버튼 + 상태 영역 마크업 (OAuthButtonsView — 웹·앱 같은 컴포넌트)', () => {
  test('기본(웹의 모든 순간·앱의 처음): Google 버튼 1개 · 비어 있는 안내 영역 · 구분선, 앱 요소 0개', () => {
    const html = view(INITIAL_APP_LOGIN);
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain('type="button"');
    expect(html).not.toContain('disabled');
    expect(html).not.toContain('aria-busy');
    expect(textOf(html)).toContain('Google로 계속하기');
    expect(html).toContain('<div role="status" aria-live="polite"></div>');
    expect(html).toContain('또는 이메일로');
    // 버튼 → 안내 영역 → 구분선 순서(안내는 Google 버튼 바로 아래)
    expect(html.indexOf('<button')).toBeLessThan(html.indexOf('role="status"'));
    expect(html.indexOf('role="status"')).toBeLessThan(html.indexOf('또는 이메일로'));
    for (const appOnly of ['oal-wait', 'oal-line', 'oal-cover', 'oal-spin', 'data-app-login', 'Chrome', 'GitHub']) {
      expect(html).not.toContain(appOnly);
    }
  });

  test('목업 수치 그대로: 48px · radius 9 · gap 10 · 14.5px 600 · 흰 바탕 Google 버튼 · 아이콘 aria-hidden', () => {
    const html = view(INITIAL_APP_LOGIN);
    expect(html).toContain('min-height:48px');
    expect(html).toContain('border-radius:9px');
    expect(html).toContain('gap:10px');
    expect(html).toContain('font-size:14.5px');
    expect(html).toContain('font-weight:600');
    expect(html).toContain('background:#fff');
    expect(html).toContain('color:#1f1f1f');
    expect(html).toContain('border-color:#dadce0');
    expect(html).toContain('aria-hidden="true" focusable="false"');
    expect(html).toContain('margin:20px 0 16px'); // 구분선 간격
  });

  test('여는 중: 버튼 잠김 + aria-busy + 회전 표시와 "Chrome 창을 여는 중…"(안내 영역 안), 카드 없음', () => {
    const html = view(S('opening'));
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-busy="true"');
    expect(html).toMatch(/<div role="status" aria-live="polite"><p class="oal-line"><span class="oal-spin" aria-hidden="true"><\/span><span>Chrome 창을 여는 중…<\/span><\/p><\/div>/);
    expect(html).not.toContain('oal-wait');
  });

  test('대기: 버튼 잠김 · 안내 영역에는 숨김 문장만 · 카드는 안내 영역 밖(버튼이 live 안에 들어가지 않는다)', () => {
    const html = view(S('waiting'));
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('aria-busy');
    expect(html).toContain('<div role="status" aria-live="polite"><span class="oal-sr">Chrome 창에서 로그인하는 중입니다</span></div>');
    const live = html.slice(html.indexOf('<div role="status"'), html.indexOf('</div>', html.indexOf('<div role="status"')) + 6);
    expect(live).not.toContain('<button');
    // 카드: 제목(tabindex=-1)·본문·힌트·[Chrome 창 다시 열기]·[취소]
    expect(html).toContain('<div class="oal-wait" data-app-login="waiting">');
    expect(html).toContain('<p class="oal-hd" tabindex="-1"><span class="oal-spin" aria-hidden="true"></span><span>Chrome 창에서 로그인하는 중입니다</span></p>');
    expect(html).toContain('<p class="oal-bd">Google 로그인을 마치면 이 앱으로 자동으로 돌아옵니다.</p>');
    expect(html).toContain('<p class="oal-sm">창을 닫았다면 아래에서 다시 열 수 있습니다. 10분 안에 마치지 못하면 처음부터 다시 눌러야 합니다.</p>');
    expect(html).toContain('<button type="button" class="oal-reopen">Chrome 창 다시 열기</button>');
    expect(html).toContain('<button type="button" class="oal-cancel">취소</button>');
    expect(html.match(/<button/g)).toHaveLength(3); // Google(잠김) + 다시 열기 + 취소
    // 카드는 안내 영역 뒤·구분선 앞
    expect(html.indexOf('role="status"')).toBeLessThan(html.indexOf('oal-wait'));
    expect(html.indexOf('oal-wait')).toBeLessThan(html.indexOf('또는 이메일로'));
  });

  test.each([
    ['closed', 'i', '로그인 창이 닫혔습니다. 다시 눌러 주세요.'],
    ['expired', '!', '로그인 요청 시간(10분)이 지났습니다. 다시 눌러 주세요.'],
    ['cancelled', 'i', '소셜 로그인을 취소했습니다.'],
    ['openFailed', '!', 'Chrome 창을 열지 못했습니다. 잠시 후 다시 눌러 주세요.'],
  ] as Array<[AppLoginNotice, string, string]>)('안내 줄 %s — 기호(%s)+글자(색만으로 구분하지 않음) · 버튼은 다시 눌림', (notice, icon, text) => {
    const html = view(S('idle', notice));
    expect(html).toContain(`<div role="status" aria-live="polite"><p class="oal-line"><span class="oal-ic" aria-hidden="true">${icon}</span><span>${text}</span></p></div>`);
    expect(html).not.toContain('disabled');
    expect(html).not.toContain('oal-wait');
    expect(html.match(/<button/g)).toHaveLength(1);
  });

  test('마무리 중: 버튼 잠김 · 안내 영역에 숨김 문장 · 카드 없음', () => {
    const html = view(S('exchanging'));
    expect(html).toContain('disabled=""');
    expect(html).toContain('<div role="status" aria-live="polite"><span class="oal-sr">로그인 마무리 중…</span></div>');
    expect(html).not.toContain('oal-wait');
  });

  test('이메일 폼은 어느 상태에서도 잠그지 않는다 — 이 컴포넌트는 폼·가입 링크를 그리지도 막지도 않는다', () => {
    for (const st of [S('opening'), S('waiting'), S('exchanging'), S('idle', 'closed')]) {
      const html = view(st);
      expect(html).not.toContain('<form');
      expect(html).not.toContain('<input');
      expect(html).not.toMatch(/inert/);
    }
  });

  test('CSS: 움직임 줄이기에서는 회전 정지 · 새 색·새 토큰 없음(전부 기존 토큰) · 핵심 치수', () => {
    const css = renderToStaticMarkup(h(OAuthButtonsView, { state: INITIAL_APP_LOGIN, onStart: noop, onReopen: noop, onCancel: noop }));
    expect(css).toContain('@media (prefers-reduced-motion: reduce) { .oal-spin { animation: none;');
    expect(css).toContain('.oal-reopen { margin-top: 12px; min-height: 48px;');
    expect(css).toContain('.oal-cancel { margin-top: 4px; min-height: 44px;');
    expect(css).toContain('animation: ti-spin .8s linear infinite'); // globals.css 의 기존 키프레임
    const styleBody = css.match(/<style[^>]*>([\s\S]*?)<\/style>/)![1];
    const colors = styleBody.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(colors).toEqual([]); // hex 색 없음 — var(--…) 토큰만
    expect(styleBody.match(/--[a-z0-9-]+/g)!.every((t) => ['--text', '--muted', '--border2', '--accent', '--bg2', '--bg3', '--bg4'].includes(t))).toBe(true);
  });

  test('visibleProviders·isOAuthVisible — 로딩 전·빈 목록·앱의 가입 화면은 그리지 않는다(D1 A)', () => {
    expect(visibleProviders(['google'])).toEqual(['google']);
    expect(visibleProviders(['github'])).toEqual([]);
    expect(isOAuthVisible(null, false, false)).toBe(false);
    expect(isOAuthVisible([], false, false)).toBe(false);
    expect(isOAuthVisible([], true, true)).toBe(false);
    // 웹: 로그인·가입 화면 모두 보임
    expect(isOAuthVisible(['google'], false, true)).toBe(true);
    expect(isOAuthVisible(['google'], false, false)).toBe(true);
    // 앱: 로그인 화면(appLogin)만 보임, 가입 화면은 숨김
    expect(isOAuthVisible(['google'], true, true)).toBe(true);
    expect(isOAuthVisible(['google'], true, false)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('③ 오류 상자 (데모 D 표)', () => {
  const note = (code: string, native = false) => noStyle(renderToStaticMarkup(h(OAuthErrorNote, { code, native })));

  test('모든 상자는 role=alert · tabindex=-1 · 간격 0 0 16px · 줄바꿈 keep-all', () => {
    for (const code of ['app_code_invalid', 'app_verifier_lost', 'signup_requires_web', 'email_unverified', 'failed', 'cancelled', 'invalid_state', 'not_configured', 'zzz']) {
      const html = note(code);
      expect(html).toContain('role="alert"');
      expect(html).toContain('tabindex="-1"');
      expect(html).toContain('margin:0 0 16px');
      expect(html).toContain('word-break:keep-all');
      expect(html).toContain('overflow-wrap:anywhere');
    }
  });

  test.each([
    ['app_code_invalid', '로그인을 마무리하지 못했습니다. 아래 Google로 계속하기를 다시 눌러 주세요.'],
    ['app_verifier_lost', '앱이 다시 시작됐거나 시간이 오래 지나 로그인을 이어 갈 수 없습니다. 아래 Google로 계속하기를 다시 눌러 주세요.'],
    ['failed', '소셜 로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.'],
    ['cancelled', '소셜 로그인을 취소했습니다.'],
    ['invalid_state', '로그인 요청이 만료되었거나 올바르지 않습니다. 다시 시도해 주세요.'],
    ['not_configured', '서버에 소셜 로그인 설정이 없습니다. 관리자에게 문의하세요.'],
  ])('%s 문구', (code, text) => {
    expect(textOf(note(code))).toBe(text);
    expect(note(code)).not.toContain('<button');
    expect(note(code)).not.toContain('<b');
  });

  test('모르는 코드·상속 키(constructor·__proto__)는 failed 문구, 임의 문자열을 화면에 싣지 않는다', () => {
    expect(oauthErrorText('zzz')).toBe(OAUTH_ERROR_TEXT.failed);
    expect(oauthErrorText('constructor')).toBe(OAUTH_ERROR_TEXT.failed);
    expect(oauthErrorText('__proto__')).toBe(OAUTH_ERROR_TEXT.failed);
    expect(textOf(note('<script>alert(1)</script>'))).toBe(OAUTH_ERROR_TEXT.failed);
  });

  test('email_unverified — 빨강 막대 상자, 웹·앱 같은 문구, "Google/GitHub" 아님', () => {
    const html = note('email_unverified');
    expect(html).toContain('background:#2a1416');
    expect(html).toContain('border-left:3px solid var(--danger)');
    expect(html).toContain('<b style="color:#fca5a5">이 소셜 계정의 이메일이 확인되지 않았습니다.</b>');
    expect(textOf(html)).toBe('이 소셜 계정의 이메일이 확인되지 않았습니다.Google에서 이메일 인증을 마친 뒤 다시 시도해 주세요. 기존 계정에 잘못 연결되는 것을 막기 위한 조치입니다.');
    expect(html).not.toContain('GitHub');
    expect(note('email_unverified', true)).toBe(html); // 웹·앱 같은 글자
  });

  test('signup_requires_web — note 상자(빨강 아님) · 굵은 첫 줄 · 앱일 때만 [Chrome에서 가입 화면 열기](44px)', () => {
    const app = note('signup_requires_web', true);
    expect(app).toContain('border-left:3px solid var(--accent)');
    expect(app).not.toContain('#2a1416');
    expect(app).toContain('<b style="color:var(--text)">이 Google 계정으로 가입된 계정이 없습니다.</b>');
    expect(textOf(app)).toContain('앱에서는 새로 가입할 수 없습니다 — 휴대폰이나 PC 의 브라우저에서 먼저 가입(초대코드 필요)한 뒤 앱에서 로그인해 주세요. 다른 이메일로 가입했다면 그 이메일로 아래에서 로그인하세요.');
    expect(app).toContain('>Chrome에서 가입 화면 열기</button>');
    expect(app.match(/<button/g)).toHaveLength(1);
    expect(app).toContain('min-height:44px');
    expect(app).toContain('type="button"');
    // 웹에서는 눌러도 열 곳이 없으므로 버튼 없음(문구만)
    const web = note('signup_requires_web', false);
    expect(web).not.toContain('<button');
    expect(textOf(web)).toContain('이 Google 계정으로 가입된 계정이 없습니다.');
  });

  test('[가입 화면 열기]는 Chrome 창(openExternal)으로 /signup 만 연다 — 앱 안 이동·다른 주소 없음', () => {
    const src = read('components/auth/OAuthErrorNote.tsx');
    expect(src).toContain("openExternal('/signup')");
    expect(src).not.toMatch(/window\.location/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('④ AppDeepLink — 딥링크 마무리', () => {
  test('SSR·웹 첫 렌더: 아무것도 그리지 않는다(수화 불일치 없음)', () => {
    expect(renderToStaticMarkup(h(AppDeepLink, {}))).toBe('');
    expect(renderToStaticMarkup(h(AppDeepLink, { nextPath: '/orders' }))).toBe('');
  });

  test('덮개: role=status·aria-busy·tabindex=-1 · "로그인 마무리 중…" + "잠시만 기다려 주세요." · 전체 화면 고정', () => {
    const html = noStyle(renderToStaticMarkup(h(AppLoginCover, {})));
    expect(html).toContain('class="oal-cover"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('<span class="oal-cover-spin" aria-hidden="true"></span>로그인 마무리 중…');
    expect(html).toContain('<span class="oal-cover-s">잠시만 기다려 주세요.</span>');
    expect(html).not.toContain('<button'); // 두 번 누를 곳이 없다
    // 스타일은 알림 영역(role=status) 밖 — 읽기 장치가 CSS 글자를 알림으로 읽지 않는다
    const raw = renderToStaticMarkup(h(AppLoginCover, {}));
    const status = raw.slice(raw.indexOf('<div class="oal-cover"'));
    expect(status).not.toContain('<style');
    expect(raw.indexOf('<style')).toBeLessThan(raw.indexOf('<div class="oal-cover"'));
    const css = renderToStaticMarkup(h(AppLoginCover, {}));
    expect(css).toContain('.oal-cover { position: fixed; inset: 0; z-index: 100;');
    expect(css).toContain('.oal-cover-spin { display: inline-block; flex: none; width: 24px; height: 24px;');
    expect(css).toContain('@media (prefers-reduced-motion: reduce) { .oal-cover-spin { animation: none;');
  });

  describe('loginErrorHref', () => {
    test('고정 코드 → /login?oauth_error=… (착지 경로가 기본이면 next 없음)', () => {
      expect(loginErrorHref('app_code_invalid', undefined)).toBe('/login?oauth_error=app_code_invalid');
      expect(loginErrorHref('signup_requires_web', null)).toBe('/login?oauth_error=signup_requires_web');
      expect(loginErrorHref('failed', '/')).toBe('/login?oauth_error=failed');
    });
    test('같은 출처 착지 경로는 이어 붙인다', () => {
      expect(loginErrorHref('app_verifier_lost', '/orders?tab=1')).toBe('/login?oauth_error=app_verifier_lost&next=%2Forders%3Ftab%3D1');
    });
    test('외부 주소·우회 형태·인증 흐름 경로는 버린다(오픈 리다이렉트 방지)', () => {
      for (const bad of ['//evil.com', '/\t/evil.com', '/..//evil.com', 'https://evil.com', '/login', '/api/auth/google', '/oauth/invite', '/signup', 'javascript:alert(1)', '/a\\b']) {
        expect(loginErrorHref('failed', bad)).toBe('/login?oauth_error=failed');
      }
    });
  });

  describe('finishDestination', () => {
    test('성공 → 서버가 돌려준 착지 경로 그대로', () => {
      expect(finishDestination({ ok: true, next: '/orders' }, '/x')).toBe('/orders');
      expect(finishDestination({ ok: true, next: '/' }, undefined)).toBe('/');
    });
    test('verifier 없음 → app_verifier_lost(서버에 묻지 않은 결과)', () => {
      expect(finishDestination({ ok: false, reason: 'no_verifier' }, undefined)).toBe('/login?oauth_error=app_verifier_lost');
    });
    test('교환 실패 → app_code_invalid, 처음 가려던 경로는 유지', () => {
      expect(finishDestination({ ok: false, reason: 'exchange_failed' }, undefined)).toBe('/login?oauth_error=app_code_invalid');
      expect(finishDestination({ ok: false, reason: 'exchange_failed' }, '/orders')).toBe('/login?oauth_error=app_code_invalid&next=%2Forders');
    });
  });

  describe('lockBackground — 덮개 동안 본문을 막는다', () => {
    interface FakeEl {
      name: string;
      inert?: boolean;
      attrs: Map<string, string>;
      kids: unknown[];
      contains: (o: unknown) => boolean;
      getAttribute: (n: string) => string | null;
      setAttribute: (n: string, v: string) => void;
      removeAttribute: (n: string) => void;
    }
    const el = (name: string, init: { inert?: boolean; hidden?: string } = {}, kids: unknown[] = []): FakeEl => {
      const attrs = new Map<string, string>();
      if (init.hidden !== undefined) attrs.set('aria-hidden', init.hidden);
      const e: FakeEl = {
        name, inert: init.inert, attrs, kids,
        contains: (o) => o === e || kids.includes(o),
        getAttribute: (n) => (attrs.has(n) ? attrs.get(n)! : null),
        setAttribute: (n, v) => { attrs.set(n, v); },
        removeAttribute: (n) => { attrs.delete(n); },
      };
      return e;
    };

    test('덮개(host)를 뺀 body 자식 전부에 inert + aria-hidden, 되돌리면 원래 값 복원', () => {
      const host = el('cover');
      const page = el('page');
      const tabs = el('tabs', { inert: true, hidden: 'false' });
      const wrap = el('wrap', {}, [host]); // host 를 품은 요소는 건드리지 않는다
      const body = { children: [page, tabs, wrap, host] };
      const restore = lockBackground(body, host);
      expect(page.inert).toBe(true);
      expect(page.getAttribute('aria-hidden')).toBe('true');
      expect(tabs.inert).toBe(true);
      expect(tabs.getAttribute('aria-hidden')).toBe('true');
      expect(wrap.inert).toBeUndefined();
      expect(wrap.getAttribute('aria-hidden')).toBeNull();
      expect(host.inert).toBeUndefined();
      expect(host.getAttribute('aria-hidden')).toBeNull();
      restore();
      expect(page.inert).toBe(false);
      expect(page.getAttribute('aria-hidden')).toBeNull();
      expect(tabs.inert).toBe(true); // 원래 inert 였던 것
      expect(tabs.getAttribute('aria-hidden')).toBe('false'); // 원래 값 복원
    });
  });

  test('수신 → 신호 → 교환 → 이동 연결(소스): 구독자는 이 컴포넌트 하나, 값은 콘솔·state 에 싣지 않는다', () => {
    const src = read('components/auth/AppDeepLink.tsx');
    expect(src.match(/onAuthDeepLink\(/g)).toHaveLength(1);
    expect(src).toContain('notifyAppLoginLink(link.kind)');
    expect(src).toContain('completeAppLogin(link.code)');
    expect(src).toContain('window.location.replace(finishDestination(result, nextRef.current))');
    expect(src).toContain("window.location.replace(loginErrorHref(link.error, pending?.next ?? nextRef.current))");
    expect(src).not.toMatch(/console\./);
    expect(src).not.toMatch(/useState<[^>]*(code|verifier)/i);
    // 이미 마무리·이동 중이면 두 번째 딥링크는 무시(한 번만 처리)
    expect(src).toContain('if (finishingRef.current) return;');
  });

  test('onAuthDeepLink 를 부르는 곳은 소스 전체에서 AppDeepLink 하나뿐이다(중복 기록이 모듈 전역이라 구독자가 둘이면 가로챈다)', () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) { if (ent.name !== '__tests__' && ent.name !== 'node_modules') walk(p); continue; }
        if (!/\.(ts|tsx)$/.test(ent.name)) continue;
        if (/\bonAuthDeepLink\(/.test(fs.readFileSync(p, 'utf8')) && !p.endsWith(path.join('lib', 'native', 'appLogin.ts'))) hits.push(path.relative(SRC, p));
      }
    };
    walk(SRC);
    expect(hits).toEqual([path.join('components', 'auth', 'AppDeepLink.tsx')]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('⑤ 브리지 확장 — browserFinished 구독·창 닫기', () => {
  type G = { window?: unknown };
  const g = globalThis as unknown as G;
  const flush = () => new Promise((r) => setImmediate(r));

  interface FakeBrowser {
    handlers: Array<() => void>;
    removed: number;
    addListener: jest.Mock;
    close: jest.Mock;
    open: jest.Mock;
  }
  function fakeBrowser(asyncHandle = true): FakeBrowser {
    const b: FakeBrowser = {
      handlers: [],
      removed: 0,
      addListener: jest.fn((_ev: string, cb: () => void) => {
        b.handlers.push(cb);
        const handle = { remove: async () => { b.removed += 1; b.handlers = b.handlers.filter((x) => x !== cb); } };
        return asyncHandle ? Promise.resolve(handle) : handle;
      }),
      close: jest.fn(async function close(this: unknown) { (b as unknown as { thisArg: unknown }).thisArg = this; }),
      open: jest.fn(async () => {}),
    };
    return b;
  }
  function setWindow(opts: { native?: boolean; browser?: unknown }) {
    g.window = {
      Capacitor: {
        isNativePlatform: () => opts.native ?? true,
        Plugins: opts.browser === undefined ? {} : { Browser: opts.browser },
      },
      location: { href: 'https://stock.example.com/login' },
    };
  }
  afterEach(() => { delete g.window; });

  test('웹(전역 없음·isNativePlatform=false)에서는 아무것도 부르지 않는다', async () => {
    expect(addBrowserFinishedListener(() => { throw new Error('불리면 안 됨'); })).toEqual(expect.any(Function));
    expect(await closeExternalBrowser()).toBe(false);
    const b = fakeBrowser();
    setWindow({ native: false, browser: b });
    addBrowserFinishedListener(() => {})();
    expect(await closeExternalBrowser()).toBe(false);
    expect(b.addListener).not.toHaveBeenCalled();
    expect(b.close).not.toHaveBeenCalled();
  });

  test('앱: browserFinished 를 넘기고, 해제 뒤 이벤트는 넘기지 않으며 핸들을 지운다', async () => {
    const b = fakeBrowser();
    setWindow({ browser: b });
    const got: number[] = [];
    const off = addBrowserFinishedListener(() => { got.push(1); });
    expect(b.addListener).toHaveBeenCalledWith('browserFinished', expect.any(Function));
    await flush();
    b.handlers[0]();
    expect(got).toEqual([1]);
    off();
    off(); // 두 번 불러도 안전
    await flush();
    expect(b.removed).toBe(1);
    expect(b.handlers).toHaveLength(0);
  });

  test('등록이 끝나기 전에 해제해도, 핸들이 오는 즉시 지운다 · 해제 뒤에 온 이벤트는 무시', async () => {
    const b = fakeBrowser();
    setWindow({ browser: b });
    const got: number[] = [];
    const off = addBrowserFinishedListener(() => { got.push(1); });
    off();
    b.handlers[0]?.(); // 등록 직후 해제된 구독에 이벤트가 와도
    expect(got).toEqual([]);
    await flush();
    expect(b.removed).toBe(1);
  });

  test('동기 핸들·플러그인 없음·addListener 예외에도 던지지 않는다', async () => {
    setWindow({ browser: fakeBrowser(false) });
    const off1 = addBrowserFinishedListener(() => {});
    await flush();
    expect(() => off1()).not.toThrow();
    setWindow({});
    expect(() => addBrowserFinishedListener(() => {})()).not.toThrow();
    setWindow({ browser: { addListener: () => { throw new Error('boom'); } } });
    expect(() => addBrowserFinishedListener(() => {})()).not.toThrow();
    setWindow({ browser: { addListener: () => Promise.reject(new Error('boom')) } });
    expect(() => addBrowserFinishedListener(() => {})()).not.toThrow();
    await flush(); // 거부된 Promise 가 처리되지 않은 거부로 새지 않는다
  });

  test('closeExternalBrowser — 메서드로 호출(this 유지)·성공 true, 플러그인·메서드 없음·거부는 false', async () => {
    const b = fakeBrowser();
    setWindow({ browser: b });
    expect(await closeExternalBrowser()).toBe(true);
    expect(b.close).toHaveBeenCalledTimes(1);
    expect((b as unknown as { thisArg: unknown }).thisArg).toBe(b);
    setWindow({});
    expect(await closeExternalBrowser()).toBe(false);
    setWindow({ browser: { open: async () => {} } });
    expect(await closeExternalBrowser()).toBe(false);
    setWindow({ browser: { close: async () => { throw new Error('no-op'); } } });
    expect(await closeExternalBrowser()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('⑥ 딥링크 신호(appLoginSignal)', () => {
  beforeEach(() => __resetAppLoginSignalForTest());

  test('구독자에게 종류만 전한다 · 해제하면 더 오지 않는다', () => {
    const got: string[] = [];
    const off = subscribeAppLoginLink((k) => got.push(k));
    notifyAppLoginLink('code');
    notifyAppLoginLink('error');
    off();
    notifyAppLoginLink('code');
    expect(got).toEqual(['code', 'error']);
  });
  test('구독자 하나가 던져도 나머지에게 전한다', () => {
    const got: string[] = [];
    subscribeAppLoginLink(() => { throw new Error('boom'); });
    subscribeAppLoginLink((k) => got.push(k));
    expect(() => notifyAppLoginLink('code')).not.toThrow();
    expect(got).toEqual(['code']);
  });
  test('값(코드·verifier)을 싣지 않는다 — 신호 모듈은 종류 문자열만 안다', () => {
    const src = read('lib/native/appLoginSignal.ts');
    expect(src).not.toMatch(/^import /m); // 다른 모듈(교환·verifier 보관)을 끌어오지 않는다
    expect(src).toContain("export type AppLoginLinkKind = 'code' | 'error';");
    expect(src).not.toMatch(/console\./);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('⑦ 소스 가드', () => {
  const buttons = read('components/auth/OAuthButtons.tsx');

  test('앱 시작 경로(startApp·reopen)는 WebView 안으로 이동하지 않는다 — Google disallowed_useragent 폴백 금지', () => {
    const startApp = buttons.slice(buttons.indexOf('const startApp = useCallback'), buttons.indexOf('const cancel = useCallback'));
    expect(startApp.length).toBeGreaterThan(200);
    expect(startApp).not.toMatch(/window\.location|location\.(href|assign|replace)|\/api\/auth\//);
    expect(startApp).toContain('prepareAppLogin(nextPath ?? null)');
    expect(startApp).toContain('openAppLogin(href)');
    expect(startApp).toContain("dispatch({ type: 'OPEN_FAILED' })"); // 못 열면 안내 한 줄 — 대체 이동 없음
  });

  test('웹 클릭은 지금처럼 같은 창에서 /api/auth/google(+next) 로 이동', () => {
    expect(buttons).toContain("const qs = nextPath ? `?next=${encodeURIComponent(nextPath)}` : '';");
    expect(buttons).toContain('window.location.href = `/api/auth/google${qs}`;');
    // F2(R-U): 시작 방식은 마운트 때 저장한 `native` 상태가 아니라 **클릭 시점의 isNativeApp()** 로 고른다(그 상태는 그리기 전용)
    expect(buttons).toContain("onStart={() => { if (pickStartMode(isNativeApp()) === 'app') void startApp(); else startWeb(); }}");
    expect(buttons).not.toMatch(/onStart=\{[^}]*\bnative\b/);
    expect(buttons).toContain('if (!isOAuthVisible(providers, native, appLogin)) return null;'); // native 상태는 그리기에만
  });

  test('F2: pickStartMode — 앱이면 Chrome 창(app), 웹이면 같은 창 이동(web). 브리지가 마운트 뒤에 생겨도 클릭 시점 값이 이긴다', () => {
    expect(pickStartMode(true)).toBe('app');
    expect(pickStartMode(false)).toBe('web');
    // 클릭 시점 평가를 흉내: 마운트 때는 브리지 없음(false), 클릭 때는 브리지가 생김(true)
    let bridge = false;
    const mountedNative = bridge; // 마운트 때 저장한 그리기 전용 상태
    bridge = true; // 늦게 주입된 브리지
    expect(pickStartMode(mountedNative)).toBe('web'); // 옛 방식(마운트 상태) = WebView 가 /api/auth/google 로 이동하는 결함 경로
    expect(pickStartMode(bridge)).toBe('app'); // 새 방식(클릭 시점 isNativeApp())
  });

  test('no-console 가드(R-U M11): 앱 로그인 경로의 비시험 코드에 console 호출이 없다 — 코드·verifier·세션 값이 로그에 새지 않게', () => {
    for (const rel of [
      'lib/native/appLogin.ts', 'lib/native/bridge.ts', 'lib/native/appLoginSignal.ts',
      'components/auth/AppDeepLink.tsx', 'components/auth/OAuthButtons.tsx', 'components/auth/OAuthErrorNote.tsx',
    ]) {
      // 주석은 빼고 코드만 본다(블록 주석 · 줄 주석 · 줄 끝 주석)
      const code = read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
      expect(`${rel}: ${/\bconsole\s*\./.test(code)}`).toBe(`${rel}: false`);
    }
  });

  test('GitHub 버튼·아이콘·ORDER 는 없다 · 로그를 남기지 않는다 · 값을 state 로 들지 않는다', () => {
    expect(buttons).not.toMatch(/GithubIcon|const BUTTONS|const ORDER|'github'/);
    expect(buttons).not.toContain('GitHub로 계속하기');
    expect(buttons).not.toMatch(/console\./);
    expect(buttons).not.toMatch(/useState<[^>]*(code|verifier)/i);
    expect(fs.existsSync(path.join(SRC, 'components/auth/AppLoginArea.tsx'))).toBe(false);
  });

  test('로그인 페이지의 next 검사 두 줄은 이 task 에서 한 글자도 바꾸지 않았다(별도 task 의 대상)', () => {
    const page = read('app/login/page.tsx');
    expect(page).toContain("setNextPath(n && n.startsWith('/') && !n.startsWith('//') ? n : undefined);");
    expect(page).toContain("const dest = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';");
  });

  test('앱 판별은 마운트 뒤 effect 에서만 · 오류 상자 포커스는 앱에서만(웹은 이메일 칸 자동 포커스 그대로)', () => {
    const page = read('app/login/page.tsx');
    expect(page).toContain('setNative(isNativeApp());');
    expect(page).toContain("if (isNativeApp() && new URLSearchParams(window.location.search).get('oauth_error') !== null) return;");
    expect(page).toContain('emailRef.current?.focus();');
    expect(page).toContain('useEffect(() => { if (native && oauthError !== null) noteRef.current?.focus(); }, [native, oauthError]);');
  });

  test('가입 화면은 코드 변경 없이 기본값(appLogin 없음) — 앱에서는 Google 버튼 숨김 유지(D1 A)', () => {
    const signup = read('app/signup/page.tsx');
    expect(signup).toContain('<OAuthButtons />');
    expect(signup).not.toContain('appLogin');
  });

  test('로그인 오류 줄 간격 보정은 로그인 페이지 안에서만(공용 authStyles.error 는 그대로)', () => {
    expect(read('app/login/page.tsx')).toContain('style={{ ...authStyles.error, lineHeight: 1.5 }}');
    expect(read('components/auth/AuthShell.tsx')).toMatch(/error: \{ minHeight: 18, fontSize: 12, color: 'var\(--danger\)', margin: '6px 0 4px', wordBreak: 'break-word' \},/);
  });

  test('AuthShell note·noteDanger 에 360px 줄바꿈 보정, note 간격 기본값(14px 0 4px)은 가입 화면용으로 유지', () => {
    const shell = read('components/auth/AuthShell.tsx');
    expect(shell).toMatch(/lineHeight: 1\.55, margin: '14px 0 4px',\s*\n\s*\/\/[^\n]*\n\s*wordBreak: 'keep-all', overflowWrap: 'anywhere',/);
    expect(shell).toMatch(/lineHeight: 1\.55, margin: '0 0 16px',\s*\n\s*wordBreak: 'keep-all', overflowWrap: 'anywhere',/);
  });
});
