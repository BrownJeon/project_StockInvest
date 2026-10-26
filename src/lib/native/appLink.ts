/**
 * T-091 M2 — 안드로이드 App Link(https) 수신 → WebView 이동. **화면 요소 없음**(로직만, `AppLinkNavigator` 가 한 번 구독).
 *
 * 텔레그램 승인 요청의 "앱에서 자세히" 버튼(`system_config.app_public_url` = 사이트 루트)이 검증된 App Link 로 이 앱을 열면,
 *   · 앱이 떠 있었으면 `appUrlOpen`(singleTask 화면이 새 intent 를 받음) — WebView 는 스스로 이동하지 않으므로 여기서 옮긴다.
 *   · 앱이 꺼져 있었으면 Capacitor 가 늘 `server.url`(루트)을 먼저 띄운다 — 콜드 스타트 주소(`getLaunchUrl`)는 보정용으로 한 번만 본다.
 * Manifest 가 받는 범위는 루트 `/` 한 경로뿐이지만(AndroidManifest.xml), 이 모듈은 받은 주소를 다시 검사한다 —
 * **https + 지금 문서와 같은 호스트 + 같은 출처 경로(`sanitizeAppNextPath` 를 바꾸지 않고 통과)** 일 때만 이동하고, 그 밖은 무시한다
 * (기본 경로로 고쳐서 이동하지 않는다 — 오픈 리다이렉트·엉뚱한 이동 방지).
 *
 * 로그인 딥링크(`stockinvest://auth/callback`, `appLogin.ts` `onAuthDeepLink` — 구독자 하나 원칙)와는 **섞지 않는다**:
 *   ① 이 모듈은 https 만 보고 커스텀 스킴은 무시한다(로그인 콜백은 `parseAppDeepLink` 가 https 를 무시 — 서로 반대).
 *   ② `onAuthDeepLink` 를 쓰지 않고 브리지의 `addAppUrlOpenListener`·`getLaunchUrl` 을 직접 쓴다 — 로그인 쪽 중복 기록(모듈 전역)을 건드리지 않는다.
 *   ③ 처리 기록도 따로(sessionStorage 키 `stockinvest_app_link_launch_handled` — https 콜드 스타트 주소만 쓴다. 커스텀 스킴 주소는 쓰지 않는다).
 *   ④ ⚠ **구독 순서에 기댄다**: Capacitor 는 구독자가 없을 때 온 `appUrlOpen`(콜드 스타트 intent 포함 — `BridgeActivity.load()` 가
 *     `onNewIntent(getIntent())` 를 부른다)을 붙잡아 두었다가 **첫 구독자 하나**에게만 준다. 이 모듈이 먼저 구독하면 붙잡혀 있던 로그인 콜백을
 *     https 가 아니라며 버린다 — 콜드 스타트 콜백은 로그인 쪽이 `getLaunchUrl` 로 다시 받지만, 앱이 떠 있는 동안 `onNewIntent` 로 와서 붙잡혀
 *     있던 콜백에는 그 보정이 없다. 그래서 `AppLinkNavigator` 는 레이아웃에서 `{children}` **뒤에** 둔다(같은 커밋의 passive effect 는 트리
 *     순서라 로그인 화면의 `AppDeepLink` 가 먼저 구독한다 — 로그인 페이지에 Suspense 경계 없음). appLink-t091.test.ts 가 소스 순서를 고정한다.
 * 로그인·가입 흐름 화면(`/login`·`/signup`·`/oauth/…`)에 있을 때는 이동하지 않는다 — 로그인 전이면 루트가 어차피 로그인 화면으로
 * 되돌아오고, Google 로그인 대기 중(Chrome 창이 떠 있음)이라면 그 화면을 지우지 않게.
 *
 * ⚠ `@capacitor/*` 를 import 하지 않는다(브리지 `window.Capacitor` 만 — `./bridge`). ⚠ 앱 판별·받은 주소는 화면 이동에만 쓴다 —
 *   서버 권한 판단에 쓰지 않는다(이동한 화면은 평소처럼 미들웨어가 세션을 검사한다).
 */
import { addAppUrlOpenListener, getLaunchUrl, isNativeApp } from './bridge';
import { sanitizeAppNextPath } from '@/lib/auth/oauth/app-flow';

/** Manifest App Link intent-filter 의 스킴·경로 — `AndroidManifest.xml` 과 같아야 한다(manifest-deeplink-t088.test.ts 가 대조). 호스트는 `capacitor.config.ts` server.url 의 호스트. */
export const APP_LINK_SCHEME = 'https';
export const APP_LINK_PATH = '/';

const LAUNCH_HANDLED_KEY = 'stockinvest_app_link_launch_handled';
const URL_MAX = 2048;

/** 로그인·가입 흐름 화면 — 여기 있을 때는 App Link 로 이동하지 않는다. */
function isAuthFlowPath(pathname: string): boolean {
  return (
    pathname === '/login' || pathname.startsWith('/login/') ||
    pathname === '/signup' || pathname.startsWith('/signup/') ||
    pathname === '/oauth' || pathname.startsWith('/oauth/')
  );
}

/**
 * 받은 App Link 주소 → 이동할 같은 출처 경로(`/…`), 또는 무시(null). 순수 함수.
 * @param rawUrl      받은 주소(문자열이 아니면 무시)
 * @param appHost     지금 문서의 호스트(`location.host` — 앱에서는 `server.url` 의 호스트, 퓨니코드)
 * @param currentPath 지금 문서의 `pathname + search + hash`
 * 이동 조건(전부): https · 사용자 정보·포트 없음 · 호스트 = appHost · 경로(+쿼리·조각)가 `sanitizeAppNextPath` 를 **바뀌지 않고** 통과 ·
 * 지금 경로와 다름 · 지금 화면이 로그인·가입 흐름이 아님.
 */
export function resolveAppLinkTarget(rawUrl: unknown, appHost: string, currentPath: string): string | null {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0 || rawUrl.length > URL_MAX) return null;
  if (typeof appHost !== 'string' || appHost.length === 0) return null;
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (u.protocol !== `${APP_LINK_SCHEME}:` || u.username || u.password || u.port) return null;
  if (u.host !== appHost.toLowerCase()) return null;
  const target = `${u.pathname}${u.search}${u.hash}`;
  if (sanitizeAppNextPath(target) !== target) return null; // 고쳐야 하는 경로는 이동하지 않는다(기본값으로 바꿔 이동하지 않음)
  const current = typeof currentPath === 'string' ? currentPath : '';
  if (target === current) return null; // 이미 그 화면
  let currentPathname = '';
  try {
    currentPathname = new URL(current || '/', 'http://sentinel.invalid').pathname;
  } catch {
    return null;
  }
  if (isAuthFlowPath(currentPathname)) return null;
  return target;
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.sessionStorage ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

/**
 * 콜드 스타트 주소를 이번 앱 프로세스에서 처음 보는가 — 처음이면 기록하고 true. `getLaunchUrl()` 은 같은 프로세스 동안
 * 계속 같은 값을 주므로(Capacitor `Bridge.intentUri` 는 생성 때 한 번 정해진다) 페이지를 다시 불러올 때마다 옛 주소로 되돌리지 않게 **한 번만** 처리한다.
 * 기록할 수 없으면(sessionStorage 막힘) false — 기록 없이 처리하면 다시 불러올 때마다 이동이 반복될 수 있어 아예 처리하지 않는다.
 */
function claimLaunchUrl(url: string): boolean {
  const st = storage();
  if (!st) return false;
  try {
    if (st.getItem(LAUNCH_HANDLED_KEY) === url) return false;
    st.setItem(LAUNCH_HANDLED_KEY, url);
    return st.getItem(LAUNCH_HANDLED_KEY) === url;
  } catch {
    return false;
  }
}

function currentLocation(): { host: string; path: string } | null {
  try {
    const l = window.location;
    return { host: l.host, path: `${l.pathname}${l.search}${l.hash}` };
  } catch {
    return null;
  }
}

/**
 * App Link 구독 — 이동할 경로가 정해지면 `navigate(경로)` 를 부른다(기본: `location.assign`). 돌려준 함수로 해제한다.
 * 앱이 아니면 아무것도 하지 않는다. **구독자는 `AppLinkNavigator` 하나뿐**(레이아웃에 한 번 — appLink-t091.test.ts 가 고정).
 * 같은 주소가 `appUrlOpen`(콜드 스타트 때 Capacitor 가 붙잡아 둔 이벤트 포함)과 `getLaunchUrl` 로 함께 와도 이동은 한 번이다
 * (지금 경로와 같으면 무시 + 이 구독 안에서 이동을 한 번 시작하면 페이지가 바뀔 때까지 더 부르지 않음).
 */
export function onAppLink(navigate: (path: string) => void = (p) => window.location.assign(p)): () => void {
  if (!isNativeApp()) return () => {};
  let disposed = false;
  let navigating = false;
  const consider = (url: string, source: 'open' | 'launch') => {
    if (disposed || navigating) return;
    if (source === 'launch') {
      // https 가 아닌 콜드 스타트 주소(로그인 콜백 `stockinvest://auth/callback?code=…` 등)는 이 모듈이 처리하지 않는다 — 저장소에
      // 쓰지 않고 버린다(1회용 로그인 코드 원문을 남기지 않는다 — appLogin.ts `fingerprint()` 와 같은 원칙).
      if (!/^https:\/\//i.test(url)) return;
      // https 콜드 스타트 주소는 판정 **전에** 먼저 기록한다 — 처음 볼 때 이동하지 않았더라도(이미 루트였음) 나중에 페이지를 다시 불러올 때
      // 같은 옛 주소로 되돌아가지 않게.
      if (!claimLaunchUrl(url)) return;
    }
    const loc = currentLocation();
    if (!loc) return;
    const target = resolveAppLinkTarget(url, loc.host, loc.path);
    if (target === null) return;
    navigating = true;
    try {
      navigate(target);
    } catch {
      navigating = false;
    }
  };
  const unsubscribe = addAppUrlOpenListener((url) => consider(url, 'open'));
  void getLaunchUrl().then((url) => {
    if (url !== null) consider(url, 'launch');
  });
  return () => {
    disposed = true;
    unsubscribe();
  };
}
