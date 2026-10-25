/**
 * Capacitor 설정 — 안드로이드 앱 "주식캐기" (T-084, docs/mobile-app-procedure.md §3·§7 M1).
 *
 * ── **앱은 껍데기고 내용물은 서버에 있다** ─────────────────────────────────
 * `server.url` 이 운영 도메인을 가리키므로 WebView 가 **항상 최신 웹**을 로드한다.
 * 그래서 **화면·API·매매 로직의 배포 = 웹 배포**이고, 화면을 고쳤다고 APK 를 다시 만들 필요가 없다.
 * `webDir`(`public/app-shell`) 의 `index.html` 은 `server.errorPath` 로 지정해 **운영 웹을 불러오지 못했을 때만**
 * 보이는 연결 실패 화면으로 쓴다(Capacitor 7 `BridgeWebViewClient` 가 메인 프레임 오류 때 APK 안 assets 에서 로드한다).
 * 연결 실패 화면은 승인 데모 v1(A)대로 구현돼 있다(`public/app-shell/index.html`, 외부 자원 0·인라인만).
 * **이 파일을 바꾸는 것은 네이티브 변경이다** — APK 재빌드 + `versionCode` 증가(android/app/build.gradle).
 *
 * ── 웹 빌드와의 관계(D-2 루트 배치) ──────────────────────────────────────
 * 이 파일은 저장소 루트에 있지만 `tsconfig.json` 의 `exclude` 에 들어 있어 웹 `tsc`·`next build` 가 검사하지 않는다 —
 * `@capacitor/cli` 가 설치되지 않은 미러·세션에서도 웹 빌드가 깨지지 않게(T-084 R1). Capacitor CLI 는 자기 방식으로 이 파일을 읽는다
 * (`scripts/build-apk.sh` 의 작업 디렉터리). `@capacitor/cli` 는 **타입만** import 한다(devDependency, 런타임 코드 없음).
 * 웹 코드(`src/**`)는 `@capacitor/*` 를 import 하지 않는다(앱 감지는 `window.Capacitor`).
 * (주석만 바꾸는 것은 네이티브 변경이 아니다 — `cap sync` 가 만드는 capacitor.config.json 내용이 같다.)
 *
 * ── `androidScheme: 'https'` 인 이유 ──────────────────────────────────────
 * 기본값(`http`)이면 WebView 출처가 `http://localhost` 가 되어 **쿠키의 `Secure` 속성과 어긋난다.**
 * 이 앱의 세션(`si_session`)은 HttpOnly + Secure 쿠키라, 스킴이 https 가 아니면 로그인 상태가 유지되지 않는다.
 *
 * ── 탐색 제한 ─────────────────────────────────────────────────────────────
 * `allowNavigation` 을 **두지 않는다.** 그러면 WebView 안에 남는 것은 `server.url` 과 같은 스킴·호스트뿐이고,
 * 다른 호스트로 가는 링크·`target=_blank`·302 는 Capacitor `Bridge.launchIntent` 가 시스템 브라우저로 넘긴다.
 * 플러그인 브리지와 주입 스크립트도 `server.url` origin 문서의 **메인 프레임**에만 허용된다 — 외부 문서가
 * `window.Capacitor` 로 플러그인을 부를 길이 없다. 호스트를 여기에 더하면 그 호스트도 플러그인을 부를 수 있게 된다.
 *
 * ── 서명·디버깅 ───────────────────────────────────────────────────────────
 * Play 스토어에 올리지 않고 **StockInvest 전용 release 키스토어**로 서명한 APK 를 사이드로드한다(절차서 D-5 —
 * TheKaiwa 의 디버그 키 재사용과 다른 점. 실매매 앱이라 공개 기본 비밀번호의 키로 서명하지 않는다).
 * release 는 `debuggable=false` 이고 WebView 원격 디버깅도 끈다(`webContentsDebuggingEnabled:false`) —
 * 사이드로드 APK 라도 chrome://inspect 로 쿠키·화면을 읽을 수 없게.
 */
import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  // 기술 식별자 — 첫 APK 배포 후에는 바꾸지 않는다(바꾸면 다른 앱이 되어 덮어쓰기 설치가 안 된다).
  appId: 'com.miraclepenguin.stockinvest',
  // 사용자에게 보이는 이름(2026-10-25 사용자 결정).
  appName: '주식캐기',
  webDir: 'public/app-shell',
  // release 빌드에서 플러그인 호출 내용이 logcat 에 남지 않게 한다.
  loggingBehavior: 'none',
  server: {
    // 퓨니코드로 적는다 — 한글 도메인(`stock.미라클펭귄.com`)을 그대로 두면 플랫폼마다
    // 정규화가 달라 WebView 가 못 열거나 "앱 내부 주소" 판정이 어긋난다.
    url: 'https://stock.xn--lh0b87pnudm10a4vd.com',
    androidScheme: 'https',
    // 운영 서버는 정식 인증서를 쓴다 — 평문 트래픽을 허용할 이유가 없다.
    cleartext: false,
    errorPath: 'index.html',
  },
  android: {
    // Android 15(targetSdk 35) edge-to-edge 강제로 WebView 가 상태바·내비게이션바 밑까지 그려지는데, 이 WebView 는
    // CSS `env(safe-area-inset-*)` 를 0 으로 준다 → 'auto' 가 API 35+ 에서 시스템 바·컷아웃만큼 네이티브 margin 을 준다
    // (워크스페이스 docs/app-conversion-guide.md §1-3).
    // ⚠ MainActivity.fitAboveKeyboard 가 이 'auto'(+ styles.xml opt-out 없음·adjustResize)에 의존해 Capacitor 의
    // margin 리스너를 교체한다 — 바꾸면 거기도 같이 고친다.
    adjustMarginsForEdgeToEdge: 'auto',
    webContentsDebuggingEnabled: false,
    allowMixedContent: false,
  },
}

export default config
