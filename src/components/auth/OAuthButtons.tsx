'use client';

/**
 * 소셜(Google) 로그인 버튼 — 웹·앱 **같은 컴포넌트** (T-009 → T-088, 승인 데모 v2 `mockups/T-088-app-login-v2.html`).
 *
 * **OAuth 앱을 등록하지 않은 프로바이더는 버튼이 렌더되지 않는다.** 목록은 서버가 준다
 * (`GET /api/auth/oauth-providers`) — 화면이 자체 판단하면 서버의 "설정됨" 기준과 갈라진다.
 * 하나도 없으면 구분선까지 통째로 사라져 기존 이메일 폼만 남는다. 목록을 받기 전에도 아무것도 그리지 않는다(깜빡임 없음).
 *
 * T-088 — 웹과 앱이 **같은 버튼·같은 구분선·같은 문구**를 쓴다. GitHub 버튼은 뺐다(운영 목록은 이미 `["google"]` 뿐이었다 — 보이는 모습 그대로).
 * 앱이 다른 것은 두 가지뿐이다.
 *   ① 클릭 동작 — 웹: 같은 창에서 `/api/auth/google` 로 이동. 앱: PKCE 준비 → **Chrome 창(Custom Tab)** 열기
 *      (Google 이 WebView 안 로그인을 `disallowed_useragent` 로 막으므로 **WebView 안 이동 폴백은 없다** — 열지 못하면 안내 한 줄).
 *   ② 앱에서만 생기는 상태 — 여는 중 · 대기 카드 · 창 닫힘 · 10분 지남 · 취소 · 열기 실패. 모두 Google 버튼 **바로 아래** 한 자리.
 *      (마무리 중 덮개와 딥링크 수신·교환은 `AppDeepLink` 가 맡는다 — 이 컴포넌트는 "링크가 왔다"는 신호만 받는다.)
 * 앱 판별(`isNativeApp`)은 마운트 뒤 effect 에서만 본다 — 서버 렌더·첫 렌더는 웹과 같다(수화 불일치 없음). ⚠ 판별은 화면 표시·클릭 동작 전용이며
 * 서버의 앱 판정은 서명된 state 안의 `platform=app` 뿐이다(서버 권한 판단에 쓰지 않는다).
 *
 * `appLogin` — 앱에서 이 버튼을 보일 화면인가(기본 false). 로그인 화면만 켠다. 앱의 가입 화면(`/signup`)은 기본값 그대로 **앱에서는 아무것도 그리지 않는다**
 * (T-084 와 같음 — 결정 D1 A: 앱 Google 로그인은 기존 계정만 들어오므로 가입 화면에 두면 새 사람에게는 막다른 길이다).
 *
 * 목업 수치 그대로: 높이 48 / radius 9 / gap 10 / 14.5px 600.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import { addBrowserFinishedListener, closeExternalBrowser, isNativeApp } from '@/lib/native/bridge';
import { APP_LOGIN_TTL_MS, cancelAppLogin, openAppLogin, prepareAppLogin } from '@/lib/native/appLogin';
import { subscribeAppLoginLink } from '@/lib/native/appLoginSignal';

type ProviderName = 'google';

const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" width={19} height={19} aria-hidden focusable="false" style={{ flex: '0 0 auto' }}>
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.76c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
    <path fill="#FBBC05" d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84z" />
    <path fill="#EA4335" d="M12 4.75c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.46 14.97.5 12 .5A11 11 0 0 0 2.18 7.05l3.66 2.84c.87-2.6 3.3-4.14 6.16-4.14z" />
  </svg>
);

const GOOGLE_BUTTON_STYLE: CSSProperties = { background: '#fff', color: '#1f1f1f', borderColor: '#dadce0' };

/** 서버 목록 → 그릴 버튼. Google 만(그 밖은 무시) — 빈 배열이면 버튼도 구분선도 그리지 않는다. */
export function visibleProviders(list: unknown): ProviderName[] {
  const arr = Array.isArray(list) ? list : [];
  return arr.includes('google') ? ['google'] : [];
}

export type StartMode = 'app' | 'web';

/**
 * Google 버튼을 **누른 순간**의 시작 방식 — 앱이면 Chrome 창(Custom Tab), 웹이면 같은 창 이동.
 * 호출부는 마운트 때 저장해 둔 `native` 상태가 아니라 클릭 시점의 `isNativeApp()` 를 넘긴다(그 상태는 그리기 전용):
 * 브리지(`window.Capacitor`)가 마운트 뒤에 주입되는 환경에서 앱 WebView 가 웹 경로로 가면 `/api/auth/google` 로 이동해
 * Google `disallowed_useragent` 화면에 갇히기 때문이다(T-088 R-U F2). ⚠ 화면 표시·클릭 동작 전용 — 서버 권한 판단에 쓰지 않는다.
 */
export function pickStartMode(nativeNow: boolean): StartMode {
  return nativeNow ? 'app' : 'web';
}

/** 그릴지 여부 — 목록 로딩 전(null)·빈 목록은 안 그림, 앱의 `appLogin` 아닌 화면(가입)도 안 그림. */
export function isOAuthVisible(providers: readonly ProviderName[] | null, native: boolean, appLogin: boolean): boolean {
  if (providers === null || providers.length === 0) return false;
  return !(native && !appLogin);
}

// ── 앱에서만 생기는 상태 (데모 C 절 전이표) ─────────────────────────────────────────

/** 문구(합니다체) — 데모 `COPY`. 시험이 글자까지 고정한다. */
export const APP_LOGIN_COPY = {
  opening: 'Chrome 창을 여는 중…',
  waitTitle: 'Chrome 창에서 로그인하는 중입니다',
  waitBody: 'Google 로그인을 마치면 이 앱으로 자동으로 돌아옵니다.',
  waitHint: '창을 닫았다면 아래에서 다시 열 수 있습니다. 10분 안에 마치지 못하면 처음부터 다시 눌러야 합니다.',
  reopen: 'Chrome 창 다시 열기',
  cancel: '취소',
  closed: '로그인 창이 닫혔습니다. 다시 눌러 주세요.',
  expired: '로그인 요청 시간(10분)이 지났습니다. 다시 눌러 주세요.',
  /** 웹의 기존 `cancelled` 오류 문구와 같은 글자(앱에서 취소 문구가 두 가지가 되지 않게) */
  cancelled: '소셜 로그인을 취소했습니다.',
  openFailed: 'Chrome 창을 열지 못했습니다. 잠시 후 다시 눌러 주세요.',
  exchanging: '로그인 마무리 중…',
} as const;

/** 창 닫힘 신호 뒤 딥링크를 기다리는 시간 — 로그인을 마친 직후에도 창이 닫히므로 이 안에 결과가 오면 무시한다(D4 A). */
export const CLOSED_GRACE_MS = 1500;

export type AppLoginPhase = 'idle' | 'opening' | 'waiting' | 'exchanging';
export type AppLoginNotice = 'closed' | 'expired' | 'cancelled' | 'openFailed';
export interface AppLoginState {
  phase: AppLoginPhase;
  notice: AppLoginNotice | null;
}
export type AppLoginEvent =
  | { type: 'CLICK' }
  | { type: 'OPENED' }
  | { type: 'OPEN_FAILED' }
  | { type: 'REOPEN' }
  | { type: 'LINK_CODE' }
  | { type: 'LINK_ERROR' }
  | { type: 'CANCEL' }
  | { type: 'WINDOW_CLOSED' }
  | { type: 'EXPIRED' };

export const INITIAL_APP_LOGIN: AppLoginState = { phase: 'idle', notice: null };

/**
 * 순수 전이 — DOM·타이머 없이 시험한다. 해당 없는 사건은 **같은 객체**를 돌려준다(다시 그리지 않음).
 * `exchanging`(마무리 중)은 화면이 이동할 때까지 끝나지 않는다 — 어떤 사건도 받지 않는다(두 번 누를 곳이 없다).
 */
export function appLoginReducer(s: AppLoginState, e: AppLoginEvent): AppLoginState {
  if (s.phase === 'exchanging') return s;
  switch (e.type) {
    case 'CLICK':
      return s.phase === 'idle' ? { phase: 'opening', notice: null } : s;
    case 'OPENED':
      return s.phase === 'opening' ? { phase: 'waiting', notice: null } : s;
    case 'OPEN_FAILED':
      return s.phase === 'opening' ? { phase: 'idle', notice: 'openFailed' } : s;
    case 'REOPEN':
      return s.phase === 'waiting' ? { phase: 'opening', notice: null } : s;
    // 로그인 성공 딥링크 — 대기 중이든 앱이 꺼져 있다 켜졌든(콜드 스타트, idle) 바로 마무리 중.
    case 'LINK_CODE':
      return { phase: 'exchanging', notice: null };
    // 오류 딥링크 — 곧 /login?oauth_error=… 로 이동해 화면이 새로 그려진다. 그 사이 대기 카드는 그대로 둔다.
    case 'LINK_ERROR':
      return s;
    case 'CANCEL':
      return s.phase === 'waiting' ? { phase: 'idle', notice: 'cancelled' } : s;
    case 'WINDOW_CLOSED':
      return s.phase === 'waiting' ? { phase: 'idle', notice: 'closed' } : s;
    case 'EXPIRED':
      return s.phase === 'waiting' ? { phase: 'idle', notice: 'expired' } : s;
    default:
      return s;
  }
}

/**
 * 대기가 남은 시간(ms) — 10분은 **로그인을 시작한 시각**부터다(서버 state 유효시간·앱 검증값 보관 시간과 같다).
 * [Chrome 창 다시 열기]로 대기에 다시 들어와도 같은 주소·같은 검증값이므로 10분을 새로 세지 않는다.
 */
export function waitingExpiryMs(startedAt: number, now: number): number {
  if (!Number.isFinite(startedAt) || startedAt <= 0 || now < startedAt) return APP_LOGIN_TTL_MS;
  return Math.max(0, APP_LOGIN_TTL_MS - (now - startedAt));
}

const NOTICE_ICON: Record<AppLoginNotice, string> = { closed: 'i', expired: '!', cancelled: 'i', openFailed: '!' };

/** 앱 상태 영역 CSS — 데모 v2 `.al-*`·`.spin` 을 `.oal-*` 로 옮겼다(전역 클래스와 섞이지 않게). 색은 globals.css 토큰만 쓴다. */
export const APP_LOGIN_CSS = `
.oal-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.oal-line { display: flex; align-items: flex-start; gap: 8px; font-size: 12.5px; color: var(--muted); line-height: 1.5; margin: 10px 0 0; word-break: keep-all; overflow-wrap: anywhere; }
.oal-ic { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; margin-top: 1px; border: 1.5px solid currentColor; border-radius: 50%; font-size: 11px; font-weight: 700; color: var(--text); line-height: 1; }
.oal-spin { display: inline-block; flex: none; width: 16px; height: 16px; border: 2px solid var(--border2); border-top-color: var(--accent); border-radius: 50%; animation: ti-spin .8s linear infinite; }
.oal-line .oal-spin { margin-top: 1px; }
@media (prefers-reduced-motion: reduce) { .oal-spin { animation: none; border-top-color: var(--border2); } }
.oal-wait { margin-top: 10px; background: var(--bg3); border: 1px solid var(--border2); border-radius: 12px; padding: 14px; }
.oal-hd { display: flex; align-items: center; gap: 8px; min-width: 0; margin: 0; font-size: 15px; font-weight: 600; color: var(--text); line-height: 1.4; }
.oal-hd span:last-child { min-width: 0; overflow-wrap: anywhere; }
.oal-hd[tabindex="-1"]:focus { outline: none; }
.oal-hd[tabindex="-1"]:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
.oal-bd { margin: 6px 0 0; font-size: 13px; color: var(--muted); line-height: 1.55; word-break: keep-all; overflow-wrap: anywhere; }
.oal-sm { margin: 6px 0 0; font-size: 12px; color: var(--muted); line-height: 1.55; word-break: keep-all; overflow-wrap: anywhere; }
.oal-reopen { margin-top: 12px; min-height: 48px; width: 100%; border-radius: 10px; border: 1px solid var(--border2); background: var(--bg2); color: var(--text); font-size: 15px; font-weight: 600; display: flex; align-items: center; justify-content: center; }
.oal-cancel { margin-top: 4px; min-height: 44px; width: 100%; border-radius: 10px; color: var(--muted); font-size: 13px; font-weight: 600; }
.oal-reopen:focus-visible, .oal-cancel:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
@media (hover: hover) {
  .oal-reopen:hover { background: var(--bg4); }
  .oal-cancel:hover { color: var(--text); }
}
`;

export interface OAuthButtonsViewProps {
  state: AppLoginState;
  onStart: () => void;
  onReopen: () => void;
  onCancel: () => void;
  googleRef?: RefObject<HTMLButtonElement>;
  titleRef?: RefObject<HTMLParagraphElement>;
}

/**
 * 그리기 전용(상태·동작은 바깥에서 받는다) — 웹은 늘 `INITIAL_APP_LOGIN`(기본) 이라 앱 요소가 하나도 나오지 않는다.
 * 안내 영역(`role="status"`)은 **항상 그린다**(웹은 빈 채) — 읽기 장치가 글자가 바뀌는 걸 알려면 먼저 있어야 한다. 비면 높이 0 이다.
 * 대기 카드는 이 영역 **밖**이다(버튼이 안내 영역에 들어가 통째로 읽히지 않게).
 */
export function OAuthButtonsView({ state, onStart, onReopen, onCancel, googleRef, titleRef }: OAuthButtonsViewProps) {
  const { phase, notice } = state;
  const locked = phase === 'opening' || phase === 'waiting' || phase === 'exchanging';
  let live: ReactNode = null;
  if (phase === 'opening') {
    live = (
      <p className="oal-line">
        <span className="oal-spin" aria-hidden />
        <span>{APP_LOGIN_COPY.opening}</span>
      </p>
    );
  } else if (phase === 'waiting') {
    live = <span className="oal-sr">{APP_LOGIN_COPY.waitTitle}</span>;
  } else if (phase === 'exchanging') {
    live = <span className="oal-sr">{APP_LOGIN_COPY.exchanging}</span>;
  } else if (notice !== null) {
    live = (
      <p className="oal-line">
        <span className="oal-ic" aria-hidden>{NOTICE_ICON[notice]}</span>
        <span>{APP_LOGIN_COPY[notice]}</span>
      </p>
    );
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: APP_LOGIN_CSS }} />
      <div style={oauthStyles.list}>
        <button
          ref={googleRef}
          type="button"
          onClick={onStart}
          disabled={locked}
          aria-busy={phase === 'opening' ? true : undefined}
          style={{ ...oauthStyles.button, ...GOOGLE_BUTTON_STYLE, ...(locked ? oauthStyles.buttonLocked : null) }}
        >
          <GoogleIcon />
          Google로 계속하기
        </button>
      </div>
      <div role="status" aria-live="polite">{live}</div>
      {phase === 'waiting' && (
        <div className="oal-wait" data-app-login="waiting">
          <p className="oal-hd" tabIndex={-1} ref={titleRef}>
            <span className="oal-spin" aria-hidden />
            <span>{APP_LOGIN_COPY.waitTitle}</span>
          </p>
          <p className="oal-bd">{APP_LOGIN_COPY.waitBody}</p>
          <p className="oal-sm">{APP_LOGIN_COPY.waitHint}</p>
          <button type="button" className="oal-reopen" onClick={onReopen}>{APP_LOGIN_COPY.reopen}</button>
          <button type="button" className="oal-cancel" onClick={onCancel}>{APP_LOGIN_COPY.cancel}</button>
        </div>
      )}
      <div style={oauthStyles.divider} aria-hidden>
        <span style={oauthStyles.dividerLine} />
        <span>또는 이메일로</span>
        <span style={oauthStyles.dividerLine} />
      </div>
    </>
  );
}

export function OAuthButtons({ nextPath, appLogin = false }: { nextPath?: string; appLogin?: boolean }) {
  const [providers, setProviders] = useState<ProviderName[] | null>(null);
  const [native, setNative] = useState(false);
  const [state, dispatch] = useReducer(appLoginReducer, INITIAL_APP_LOGIN);
  const aliveRef = useRef(true);
  const startingRef = useRef(false); // 연타 방지 — 상태가 다시 그려지기 전의 두 번째 탭
  const hrefRef = useRef<string | null>(null); // 이번 로그인의 Chrome 창 주소(다시 열기에 같은 주소를 쓴다)
  const startedAtRef = useRef(0);
  const googleRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLParagraphElement>(null);
  const prevPhaseRef = useRef<AppLoginPhase>('idle');

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  // 앱 판별은 마운트 뒤에만(첫 렌더는 웹과 같다) + 서버 목록 조회(웹·앱 같음).
  // 앱의 가입 화면(appLogin 아님)은 T-084 처럼 조회 없이 빈 목록 — 아무것도 그리지 않는다.
  useEffect(() => {
    let alive = true;
    const nat = isNativeApp();
    setNative(nat);
    if (nat && !appLogin) {
      setProviders([]);
      return () => { alive = false; };
    }
    fetch('/api/auth/oauth-providers')
      .then((r) => r.json())
      .then((d: { providers?: unknown }) => {
        if (!alive) return;
        setProviders(visibleProviders(d.providers));
      })
      .catch(() => { if (alive) setProviders([]); });
    return () => { alive = false; };
  }, [appLogin]);

  // `AppDeepLink` 가 딥링크를 받으면 알려 준다 — 대기 카드를 풀고(성공) Chrome 창 닫기를 시도한다.
  useEffect(
    () => subscribeAppLoginLink((kind) => {
      dispatch({ type: kind === 'code' ? 'LINK_CODE' : 'LINK_ERROR' });
      if (kind === 'code') void closeExternalBrowser();
    }),
    [],
  );

  // 대기 중: ① 로그인 시작 후 10분이 지나면 풀기 ② Chrome 창이 닫혔는데 1.5초 안에 딥링크가 안 오면 풀기(D4 A).
  // 대기를 벗어나면(딥링크 수신·취소·다시 열기) 두 타이머와 닫힘 구독을 모두 거둔다.
  useEffect(() => {
    if (state.phase !== 'waiting') return undefined;
    let closeTimer: ReturnType<typeof setTimeout> | null = null;
    const expiryTimer = setTimeout(() => {
      cancelAppLogin(); // 10분 지난 검증값은 어차피 못 쓴다
      dispatch({ type: 'EXPIRED' });
    }, waitingExpiryMs(startedAtRef.current, Date.now()));
    const stopListening = addBrowserFinishedListener(() => {
      if (closeTimer !== null) return;
      closeTimer = setTimeout(() => {
        closeTimer = null;
        dispatch({ type: 'WINDOW_CLOSED' });
      }, CLOSED_GRACE_MS);
    });
    return () => {
      clearTimeout(expiryTimer);
      if (closeTimer !== null) clearTimeout(closeTimer);
      stopListening();
    };
  }, [state.phase]);

  // 포커스: 대기 진입 → 카드 제목, 대기·여는 중에서 기본으로 돌아옴 → Google 버튼. (처음 그릴 때는 건드리지 않는다 — 이메일 칸 자동 포커스)
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = state.phase;
    if (state.phase === 'waiting' && prev !== 'waiting') titleRef.current?.focus();
    else if (state.phase === 'idle' && prev !== 'idle') googleRef.current?.focus();
  }, [state.phase]);

  const startWeb = useCallback(() => {
    const qs = nextPath ? `?next=${encodeURIComponent(nextPath)}` : '';
    window.location.href = `/api/auth/google${qs}`;
  }, [nextPath]);

  /** 앱: PKCE 준비 → Chrome 창 열기. **WebView 안 이동 폴백 없음**(Google `disallowed_useragent`). */
  const startApp = useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    dispatch({ type: 'CLICK' });
    try {
      const href = await prepareAppLogin(nextPath ?? null);
      if (!aliveRef.current) return;
      if (href === null) {
        dispatch({ type: 'OPEN_FAILED' });
        return;
      }
      hrefRef.current = href;
      startedAtRef.current = Date.now();
      const ok = await openAppLogin(href);
      if (!aliveRef.current) return;
      if (ok) {
        dispatch({ type: 'OPENED' });
      } else {
        cancelAppLogin(); // 창이 안 열렸으니 이번 검증값은 쓸 데가 없다
        dispatch({ type: 'OPEN_FAILED' });
      }
    } finally {
      startingRef.current = false;
    }
  }, [nextPath]);

  /** [Chrome 창 다시 열기] — 같은 주소·같은 검증값. 못 열어도 검증값은 남긴다(먼저 열린 창에서 마칠 수도 있다). */
  const reopen = useCallback(async () => {
    if (startingRef.current) return;
    const href = hrefRef.current;
    startingRef.current = true;
    dispatch({ type: 'REOPEN' });
    try {
      const ok = href !== null && (await openAppLogin(href));
      if (!aliveRef.current) return;
      dispatch({ type: ok ? 'OPENED' : 'OPEN_FAILED' });
    } finally {
      startingRef.current = false;
    }
  }, []);

  /** [취소] — 검증값을 지우고 대기를 풀고 Chrome 창 닫기를 시도한다. */
  const cancel = useCallback(() => {
    cancelAppLogin();
    dispatch({ type: 'CANCEL' });
    void closeExternalBrowser();
  }, []);

  // 로딩 중에도, 하나도 없을 때도, 앱의 가입 화면에서도 아무것도 그리지 않는다 —
  // 빈 버튼이나 자리표시자가 잠깐 보이면 "눌러도 안 되는 버튼"으로 오해된다.
  if (!isOAuthVisible(providers, native, appLogin)) return null;

  return (
    <OAuthButtonsView
      state={state}
      onStart={() => { if (pickStartMode(isNativeApp()) === 'app') void startApp(); else startWeb(); }}
      onReopen={() => { void reopen(); }}
      onCancel={cancel}
      googleRef={googleRef}
      titleRef={titleRef}
    />
  );
}

export const oauthStyles: Record<string, CSSProperties> = {
  list: { display: 'flex', flexDirection: 'column', gap: 10 },
  button: {
    minHeight: 48, borderRadius: 9, border: '1px solid var(--border2)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
    fontSize: 14.5, fontWeight: 600, width: '100%', cursor: 'pointer',
  },
  /** 대기·여는 중·마무리 중에는 잠긴다(같은 일을 하는 버튼이 둘이 되지 않게 — 데모 C) */
  buttonLocked: { opacity: 0.7, cursor: 'not-allowed' },
  divider: {
    display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0 16px',
    color: 'var(--muted)', fontSize: 11.5,
  },
  dividerLine: { flex: 1, height: 1, background: 'var(--border2)' },
};
