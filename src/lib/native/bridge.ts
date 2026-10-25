/**
 * T-084 — Capacitor 런타임 브리지. 웹 코드가 네이티브 기능을 만지는 **유일한 경로**(TheKaiwa `modules/infra/native/bridge.ts` 패턴).
 *
 * `@capacitor/*` 를 import 하지 않는다 — 런타임이 WebView 에 주입하는 `window.Capacitor` 전역만 본다.
 *   ① 앱은 `server.url` 로 운영 웹을 그대로 로드한다 → 같은 번들이 PC·모바일 브라우저에도 나간다. 네이티브 모듈을 import 하면 웹 사용자도 받는다.
 *   ② 플러그인이 빠진 APK·구버전 APK 에서도 화면이 죽지 않아야 한다. 전역이 없으면 "없는 대로" 동작한다.
 * 그래서 모든 함수는 **브리지가 없거나 예외가 나면 조용히 아무 일도 하지 않는다**(null/false 반환, 던지지 않음).
 *
 * ⚠ 이 모듈의 판단은 **화면 표시용**이다(예: 앱에서 OAuth 버튼 숨김·업데이트 띠). 서버 권한 판단에 쓰지 않는다 —
 *   `window.Capacitor` 는 누구나 브라우저 콘솔에서 만들 수 있다.
 */

// 버전 이름 형식은 한 곳(version.ts — 순수 상수, Node 모듈 import 없음)에서 가져온다.
import { MAX_VERSION_CODE, VERSION_NAME_RE } from '@/lib/app-release/version';

/** Capacitor 리스너 핸들(v7 은 Promise 로 준다). */
interface PluginListenerHandle {
  remove?: () => Promise<void> | void;
}

interface AppPlugin {
  /** `version` = versionName, `build` = versionCode(문자열). */
  getInfo?: () => Promise<{ version?: unknown; build?: unknown } | null | undefined>;
  /** T-088: 딥링크로 앱이 (이미 떠 있는 상태에서) 열릴 때 `appUrlOpen` 이 온다. */
  addListener?: (
    event: 'appUrlOpen',
    cb: (data: { url?: unknown } | null | undefined) => void,
  ) => Promise<PluginListenerHandle> | PluginListenerHandle | undefined;
  /** T-088: 앱을 **처음 띄운** 주소(콜드 스타트 딥링크). 아이콘으로 띄웠으면 없음. */
  getLaunchUrl?: () => Promise<{ url?: unknown } | null | undefined>;
}

interface BrowserPlugin {
  open?: (options: { url: string }) => Promise<void>;
  /** T-088: 열어 둔 Chrome 창(Custom Tab)을 닫는다 — 문서상 Web·iOS 전용이라 안드로이드에서는 효과가 없을 수 있다([추측] 실기기 확인 필요). */
  close?: () => Promise<void>;
  /** T-088: Chrome 창이 닫혔을 때(사용자가 닫거나 앱으로 돌아올 때) `browserFinished` 가 온다. 안드로이드·iOS. */
  addListener?: (
    event: 'browserFinished',
    cb: () => void,
  ) => Promise<PluginListenerHandle> | PluginListenerHandle | undefined;
}

interface CapacitorBridge {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: {
    App?: AppPlugin;
    Browser?: BrowserPlugin;
  };
}

/** `window.Capacitor` 또는 null. SSR(window 없음)에서는 null. */
export function getBridge(): CapacitorBridge | null {
  if (typeof window === 'undefined') return null;
  try {
    const cap = (window as unknown as { Capacitor?: unknown }).Capacitor;
    return cap && typeof cap === 'object' ? (cap as CapacitorBridge) : null;
  } catch {
    return null;
  }
}

/** 안드로이드 앱(WebView) 안에서 실행 중인가. 웹·SSR·예외는 false. */
export function isNativeApp(): boolean {
  try {
    return getBridge()?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

/**
 * 설치된 앱 버전 — `{ version: versionName, build: versionCode(정수) }`. 앱이 아니거나 App 플러그인이 없거나 값 형식이 다르면 null.
 * 업데이트 비교는 `build`(정수)로만 한다(`src/lib/app-release/version.ts`).
 */
export async function getAppVersion(): Promise<{ version: string; build: number } | null> {
  if (!isNativeApp()) return null;
  try {
    const getInfo = getBridge()?.Plugins?.App?.getInfo;
    if (typeof getInfo !== 'function') return null;
    const info = await getInfo();
    const rawBuild = typeof info?.build === 'string' || typeof info?.build === 'number' ? String(info.build).trim() : '';
    const build = /^\d{1,10}$/.test(rawBuild) ? Number(rawBuild) : NaN;
    const version = typeof info?.version === 'string' && VERSION_NAME_RE.test(info.version) ? info.version : null;
    if (!Number.isSafeInteger(build) || build < 1 || build > MAX_VERSION_CODE || version === null) return null;
    return { version, build };
  } catch {
    return null;
  }
}

/**
 * 시스템 Custom Tab 으로 연다(APK 내려받기 등). 상대 경로는 현재 출처 기준으로 푼다. **https 만** 연다.
 * 앱이 아니거나 Browser 플러그인이 없거나 실패하면 false — 호출부가 일반 링크 이동으로 폴백한다.
 */
export async function openExternal(url: string): Promise<boolean> {
  if (!isNativeApp()) return false;
  try {
    const open = getBridge()?.Plugins?.Browser?.open;
    if (typeof open !== 'function') return false;
    const base = typeof window !== 'undefined' && window.location ? window.location.href : undefined;
    const u = new URL(url, base);
    if (u.protocol !== 'https:' || u.username || u.password) return false;
    await open({ url: u.toString() });
    return true;
  } catch {
    return false;
  }
}

/** 딥링크 주소 길이 상한 — 로그인 콜백은 100자 안팎이다. 지나치게 긴 값은 받지 않는다. */
const MAX_APP_URL_LENGTH = 2048;

function toAppUrl(raw: unknown): string | null {
  return typeof raw === 'string' && raw.length > 0 && raw.length <= MAX_APP_URL_LENGTH ? raw : null;
}

/**
 * T-088 — `appUrlOpen`(앱이 떠 있을 때 딥링크로 다시 앞에 올 때) 구독. 돌려준 함수로 해제한다.
 * 앱이 아니거나 App 플러그인·`addListener` 가 없거나 등록이 실패하면 아무것도 하지 않는 해제 함수를 돌려준다(던지지 않는다).
 * 해제가 등록 완료(Promise)보다 먼저 불려도 등록이 끝나는 즉시 지운다. 해제 뒤에 온 이벤트는 handler 로 넘기지 않는다.
 * ⚠ 주소의 의미 판단(로그인 콜백인지)은 호출부 몫이다 — 여기는 문자열만 넘긴다. 서버 권한 판단에 쓰지 않는다.
 */
export function addAppUrlOpenListener(handler: (url: string) => void): () => void {
  if (!isNativeApp()) return () => {};
  let disposed = false;
  let handle: PluginListenerHandle | null = null;
  const removeHandle = (h: PluginListenerHandle | null | undefined) => {
    try {
      void Promise.resolve(h?.remove?.()).catch(() => {});
    } catch {
      // 해제 실패는 무시 — 이미 disposed 라 handler 는 더 불리지 않는다
    }
  };
  try {
    const app = getBridge()?.Plugins?.App;
    if (!app || typeof app.addListener !== 'function') return () => {};
    const result = app.addListener('appUrlOpen', (data) => {
      if (disposed) return;
      const url = toAppUrl(data?.url);
      if (url !== null) handler(url);
    });
    void Promise.resolve(result)
      .then((h) => {
        if (disposed) removeHandle(h);
        else handle = h ?? null;
      })
      .catch(() => {});
  } catch {
    return () => {};
  }
  return () => {
    if (disposed) return;
    disposed = true;
    removeHandle(handle);
    handle = null;
  };
}

/**
 * T-088 — 앱을 처음 띄운 주소(콜드 스타트 딥링크). 앱이 아니거나 플러그인·값이 없거나 실패하면 null.
 * ⚠ 같은 프로세스 동안 **계속 같은 값**을 돌려준다(새 딥링크로 바뀌지 않는다) — 호출부가 이미 처리한 주소인지 기억해야 한다
 *   (`src/lib/native/appLogin.ts` 의 `onAuthDeepLink` 가 처리한 주소를 기록한다).
 */
export async function getLaunchUrl(): Promise<string | null> {
  if (!isNativeApp()) return null;
  try {
    const app = getBridge()?.Plugins?.App;
    if (!app || typeof app.getLaunchUrl !== 'function') return null;
    const r = await app.getLaunchUrl(); // 메서드 호출 — this 바인딩에 기대는 플러그인 구현에서도 안전
    return toAppUrl(r?.url);
  } catch {
    return null;
  }
}

/**
 * T-088 — Chrome 창(Custom Tab)이 **닫혔다**는 신호(`browserFinished`) 구독. 돌려준 함수로 해제한다.
 * 사용자가 창을 닫았을 때뿐 아니라 로그인을 마치고 딥링크로 앱이 앞에 올 때도 오므로, 호출부는 "닫힘 신호 뒤 잠깐 딥링크를 기다린다"
 * (대기 카드 — 데모 v2 D4)로 구분한다. 앱이 아니거나 Browser 플러그인·`addListener` 가 없거나 등록이 실패하면 아무것도 하지 않는 해제 함수를
 * 돌려준다(던지지 않는다 — 이 신호가 없는 기기는 [취소]·10분 만료가 탈출구다). 해제가 등록 완료(Promise)보다 먼저 불려도 등록이 끝나는 즉시 지운다.
 */
export function addBrowserFinishedListener(handler: () => void): () => void {
  if (!isNativeApp()) return () => {};
  let disposed = false;
  let handle: PluginListenerHandle | null = null;
  const removeHandle = (h: PluginListenerHandle | null | undefined) => {
    try {
      void Promise.resolve(h?.remove?.()).catch(() => {});
    } catch {
      // 해제 실패는 무시 — 이미 disposed 라 handler 는 더 불리지 않는다
    }
  };
  try {
    const browser = getBridge()?.Plugins?.Browser;
    if (!browser || typeof browser.addListener !== 'function') return () => {};
    const result = browser.addListener('browserFinished', () => {
      if (!disposed) handler();
    });
    void Promise.resolve(result)
      .then((h) => {
        if (disposed) removeHandle(h);
        else handle = h ?? null;
      })
      .catch(() => {});
  } catch {
    return () => {};
  }
  return () => {
    if (disposed) return;
    disposed = true;
    removeHandle(handle);
    handle = null;
  };
}

/**
 * T-088 — 열어 둔 Chrome 창(Custom Tab) 닫기 **시도**([취소]·딥링크 수신 직후). 앱이 아니거나 플러그인·메서드가 없거나 실패하면 false(던지지 않는다).
 * ⚠ `@capacitor/browser` 문서는 `close()` 를 Web·iOS 전용이라 적었다(7.0.5 안드로이드 소스에는 구현이 있다). 안 닫혀도 화면은 정상 —
 *   딥링크 수신 때는 앱이 앞에 오면서 창이 뒤로 밀리고, [취소]는 대기 상태만 푼다.
 */
export async function closeExternalBrowser(): Promise<boolean> {
  if (!isNativeApp()) return false;
  try {
    const browser = getBridge()?.Plugins?.Browser;
    if (!browser || typeof browser.close !== 'function') return false;
    await browser.close(); // 메서드 호출 — this 바인딩에 기대는 구현에서도 안전
    return true;
  } catch {
    return false;
  }
}
