/**
 * T-091 — 앱 기능별 필요 최소 build 표 + 판단 (순수 함수, I/O 없음 — 웹 번들에 들어간다).
 *
 * 앱은 운영 웹을 띄우는 셸이라 **웹은 즉시 배포되고 APK 는 사용자가 설치할 때 바뀐다.** 네이티브 설정에 기대는 화면을
 * 웹에 먼저 내면 옛 앱에도 보이지만 동작하지 않는다(T-088: 옛 앱 1.0.0 이 Google 버튼을 보았으나 딥링크 수신 설정이 없어 무응답).
 * 그래서 네이티브에 기대는 기능은 **이 표에 한 줄**을 더하고, 화면은 `appMeetsFeature()` 로 그 기능을 보일지 정한다.
 *
 * 비교는 `version.ts` 와 같이 versionCode 정수로만 한다. **모르는 값으로는 막지 않는다**(기존 원칙 "업데이트를 강제하지 않는다"):
 * 앱이 아님(웹) · 설치 build 를 못 읽음 · 표에 없는 기능 · 표 값이 잘못됨 → 모두 true.
 *
 * ⚠ 여기서 내리는 판단은 **화면 표시용**이다. 서버 권한 판단에 쓰지 않는다(`window.Capacitor` 와 build 는 누구나 흉내 낸다).
 */
import { compareVersionCode, parseVersionCode } from './version';

/**
 * 기능 → 그 기능이 동작하는 최소 versionCode(`android/app/build.gradle` 의 `stockVersionCode`).
 *  - googleLogin: 2 — 앱 Google 로그인(T-088)은 딥링크 `stockinvest://auth/callback` 수신 설정이 든 1.0.1(versionCode 2)부터.
 */
export const APP_FEATURE_MIN_BUILD = Object.freeze({ googleLogin: 2 } as const);

/** 표의 키 유니온 — 표에 한 줄을 더하면 따라 늘고, 호출부의 오타는 컴파일 오류가 된다. */
export type AppFeature = keyof typeof APP_FEATURE_MIN_BUILD;

/**
 * 설치된 앱 build 가 최소 build 를 채우는가. `native` 가 false(웹)이거나 build·minBuild 를 모르면(형식이 다르면) true — 막지 않는다.
 * build 가 minBuild 보다 낮을 때만 false.
 */
export function appMeetsBuild(native: boolean, build: number | null, minBuild: unknown): boolean {
  if (!native) return true;
  const current = parseVersionCode(build);
  const min = parseVersionCode(minBuild);
  if (current === null || min === null) return true;
  return compareVersionCode(current, min) >= 0;
}

/** 기능 이름으로 판단. 타입은 표의 키만 받지만, 런타임에 표에 없는 이름이 와도 막지 않는다(true). */
export function appMeetsFeature(native: boolean, build: number | null, feature: AppFeature): boolean {
  const min = Object.prototype.hasOwnProperty.call(APP_FEATURE_MIN_BUILD, feature)
    ? APP_FEATURE_MIN_BUILD[feature]
    : null;
  return appMeetsBuild(native, build, min);
}
