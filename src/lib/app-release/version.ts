/**
 * T-084 — 앱 배포본 버전 판단 (순수 함수, I/O 없음).
 *
 * 비교는 **versionCode 정수로만** 한다. versionName 문자열 비교는 `1.10.0 < 1.9.0` 류 오판을 낳는다(TheKaiwa task-003f 교훈).
 * 앱이 보낸 값·DB 값 모두 형식이 맞지 않으면 "모름(null)" 으로 다루고, 모르는 값으로는 업데이트를 강제하지 않는다.
 */

/** versionCode 상한 — 안드로이드 versionCode 최댓값(2100000000)과 DB INT UNSIGNED 안쪽. */
export const MAX_VERSION_CODE = 2_100_000_000;

/**
 * 사람이 읽는 버전 이름 형식 — **정확히 3 구성요소 `x.y.z`(각 1~4자리 숫자)**. 이 저장소의 유일한 출처다.
 * 같은 규칙을 쓰는 곳: 다운로드 이름(`paths.ts` VERSIONED_DOWNLOAD_RE — 이 값으로 만든다)·앱 브리지(`native/bridge.ts` — import)·
 * DB CHECK `chk_app_release_name`(SQL)·`scripts/build-apk.sh`(bash) — 뒤의 둘은 언어가 달라 문자열로 복제돼 있으니 함께 바꾼다.
 * (1~4 구성요소를 받던 R1 이전 규칙은 `1.1` 같은 이름이 DB·--publish 는 통과하고 버전 이름 URL 은 404 가 되는 불일치를 낳았다.)
 */
export const VERSION_NAME_PATTERN = '[0-9]{1,4}[.][0-9]{1,4}[.][0-9]{1,4}';
export const VERSION_NAME_RE = new RegExp(`^${VERSION_NAME_PATTERN}$`);

/** 숫자·숫자 문자열 → 양의 정수 versionCode. 형식이 다르거나 범위 밖이면 null. */
export function parseVersionCode(raw: unknown): number | null {
  let n: number;
  if (typeof raw === 'number') {
    n = raw;
  } else if (typeof raw === 'string') {
    const t = raw.trim();
    if (!/^\d{1,10}$/.test(t)) return null;
    n = Number(t);
  } else {
    return null;
  }
  if (!Number.isSafeInteger(n) || n < 1 || n > MAX_VERSION_CODE) return null;
  return n;
}

/** versionCode 비교. 음수 = a 가 낮다, 0 = 같다, 양수 = a 가 높다. */
export function compareVersionCode(a: number, b: number): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

/** 새 배포본이 있는가 — 현재 앱 코드가 최신보다 낮을 때만. 현재 값을 모르면 false. */
export function isUpdateAvailable(current: number | null, latest: number | null): boolean {
  if (current === null || latest === null) return false;
  return compareVersionCode(current, latest) < 0;
}

/** 필수 업데이트인가 — `current < min_supported`. 현재 값을 모르거나 min_supported 가 0(미지정)이면 false. */
export function isUpdateRequired(current: number | null, minSupported: number | null): boolean {
  if (current === null || minSupported === null || minSupported <= 0) return false;
  return compareVersionCode(current, minSupported) < 0;
}
