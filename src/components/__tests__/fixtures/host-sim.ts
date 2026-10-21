/**
 * T-062 WP-U Reviewer R-5 — 시험의 호스트(시간대·로케일) 의존 제거.
 *
 * 왜 `process.env.TZ = 'UTC'` 가 아닌가: jest 의 node 환경은 시험 파일마다 `process` 를 샌드박스 사본으로
 * 주므로, 시험 안에서 `process.env.TZ` 를 바꿔도 V8 의 실제 시간대는 바뀌지 않는다(2026-10-21 격리 사본 실측:
 * 대입 뒤에도 `getTimezoneOffset()` = -540, 기본 timeZone = Asia/Seoul). `jest.config.js` 는 이번 범위 밖이다.
 *
 * 대신 **"KST·ko-KR 이 아닌 호스트" 를 흉내 낸다**(`beforeAll`/`afterAll` 로 이 파일 안에서만):
 *  - Date 의 로컬 시각 getter(getHours·getDay·…)를 UTC getter 로 → 로컬 시각에 기대는 구현은 KST 와 어긋나 실패.
 *  - Date#toLocale*String 에 timeZone 이 없으면 'UTC', 로케일이 없으면 'de-DE' 를 넣는다.
 *  - Number#toLocaleString 에 로케일이 없으면 'de-DE'(쉼표 대신 마침표 "100.000") → 'ko-KR' 을 빠뜨린 서식은 실패.
 * 구현이 `@/lib/time` 의 +9h 고정 변환과 'ko-KR' 명시 서식만 쓰면 결과는 호스트와 무관하게 같다.
 */

type Restore = () => void;

export function installForeignHostSimulation(): Restore {
  const restores: Restore[] = [];
  const D = Date.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;

  const local2utc: Array<[string, string]> = [
    ['getFullYear', 'getUTCFullYear'], ['getMonth', 'getUTCMonth'], ['getDate', 'getUTCDate'],
    ['getDay', 'getUTCDay'], ['getHours', 'getUTCHours'], ['getMinutes', 'getUTCMinutes'],
    ['getSeconds', 'getUTCSeconds'],
  ];
  for (const [local, utc] of local2utc) {
    const orig = D[local];
    const utcFn = D[utc];
    D[local] = function (this: Date) { return utcFn.call(this); };
    restores.push(() => { D[local] = orig; });
  }
  const origOffset = D.getTimezoneOffset;
  D.getTimezoneOffset = () => 0;
  restores.push(() => { D.getTimezoneOffset = origOffset; });

  for (const name of ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString']) {
    const orig = D[name];
    D[name] = function (this: Date, locales?: unknown, options?: Record<string, unknown>) {
      return orig.call(this, locales ?? 'de-DE', { timeZone: 'UTC', ...(options ?? {}) });
    };
    restores.push(() => { D[name] = orig; });
  }

  const N = Number.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
  const origNum = N.toLocaleString;
  N.toLocaleString = function (this: number, locales?: unknown, options?: unknown) {
    return origNum.call(this, locales ?? 'de-DE', options);
  };
  restores.push(() => { N.toLocaleString = origNum; });

  return () => { for (const r of restores.reverse()) r(); };
}

/** 이 파일의 시험 전체에 흉내를 건다. 반드시 describe 밖(파일 최상위)에서 한 번 호출. */
export function useForeignHost(): void {
  let restore: Restore | null = null;
  beforeAll(() => { restore = installForeignHostSimulation(); });
  afterAll(() => { restore?.(); restore = null; });
}
