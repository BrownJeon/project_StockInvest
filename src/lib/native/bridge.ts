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

interface AppPlugin {
  /** `version` = versionName, `build` = versionCode(문자열). */
  getInfo?: () => Promise<{ version?: unknown; build?: unknown } | null | undefined>;
}

interface BrowserPlugin {
  open?: (options: { url: string }) => Promise<void>;
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
