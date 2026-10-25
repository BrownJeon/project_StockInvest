/**
 * 로그인 후 이동 경로(`next`) 검사 — 서버(`sanitizeNextPath`)와 화면(`/login`)이 같은 판정을 쓴다 (T-089, 2026-10-25).
 *
 * ★ 이 파일은 **의존성이 없어야 한다.** 서버 코드와 클라이언트 화면 양쪽에서 가져다 쓰므로
 *    다른 모듈·환경변수·별칭 경로를 참조하지 않는다(시험이 소스 텍스트로 고정한다).
 *
 * 왜 `startsWith('/') && !startsWith('//')` 로는 모자란가:
 *   URL 해석기는 입력에서 탭(U+0009)·줄바꿈(U+000A)·캐리지리턴(U+000D)을 **지운다**.
 *   `/<TAB>/evil.com` 은 `//` 로 시작하지 않아 옛 검사를 통과하지만, 해석기가 탭을 지우면 `//evil.com`
 *   (프로토콜 상대 URL)이 되어 로그인을 마친 사용자가 외부 사이트로 이동한다.
 *   그래서 제어문자 전체·백슬래시·줄 구분 문자를 막고, 마지막에 **해석 결과의 출처**까지 확인한다.
 *
 * 통과하면 입력 문자열을 **그대로** 돌려준다 — 정규화·치환은 하지 않는다(쿼리·해시·인코딩이 바뀌면 안 된다).
 * 거부하면 `null` — 대체값(`/` 등)은 호출하는 쪽이 정한다.
 */

/** 검사 시 상대 경로를 붙여 해석해 볼 가짜 출처. `.invalid` 는 예약된 TLD 라 실제 도메인과 겹치지 않는다. */
const PROBE_ORIGIN = 'http://x.invalid';

/** 경로 최대 길이. 쿠키(state 토큰)에 실리는 값이라 무한정 허용하지 않는다. */
export const MAX_NEXT_PATH_LENGTH = 2048;

/**
 * 상대 경로로 쓰면 위험하거나 모호해지는 문자인가.
 *  - U+0000–U+001F(탭·LF·CR 포함)·U+007F : URL 해석기가 지우거나 무시한다 → `//` 를 만드는 핵심 우회 문자
 *  - `\` : 일부 해석기가 `/` 로 취급한다
 *  - U+2028·U+2029 : 줄 구분 문자 — 일부 환경이 줄바꿈으로 취급한다
 */
function isForbiddenChar(code: number): boolean {
  return code <= 0x1f || code === 0x7f || code === 0x5c || code === 0x2028 || code === 0x2029;
}

/**
 * 같은 출처의 내부 경로면 입력을 그대로, 아니면 `null`.
 *
 * 통과 조건(전부 만족해야 한다):
 *  1. 문자열이고 길이 2048 이하
 *  2. 첫 글자가 `/`
 *  3. 두 번째 글자가 `/` 도 `\` 도 아니다 (프로토콜 상대·역슬래시)
 *  4. 제어문자·DEL·백슬래시·U+2028/2029 가 어느 위치에도 없다
 *  5. 가짜 출처 기준으로 해석한 결과의 출처가 그대로다 (해석기가 다르게 읽어도 같은 출처만 허용)
 */
export function sanitizeInternalPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  if (raw.length === 0 || raw.length > MAX_NEXT_PATH_LENGTH) return null;
  if (raw.charAt(0) !== '/') return null;

  const second = raw.charAt(1);
  if (second === '/' || second === '\\') return null;

  for (let i = 0; i < raw.length; i += 1) {
    if (isForbiddenChar(raw.charCodeAt(i))) return null;
  }

  try {
    if (new URL(raw, PROBE_ORIGIN).origin !== PROBE_ORIGIN) return null;
  } catch {
    return null;
  }

  return raw;
}
