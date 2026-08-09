/**
 * 메일 헤더·본문 안전화 (T-010, 2026-08-09).
 *
 * ## 왜 필요한가 — 이메일 헤더 인젝션
 *
 * SMTP 헤더는 CRLF 로 구분된다. 사용자 입력이 헤더에 그대로 들어가면
 * `홍길동\r\nBcc: attacker@evil.com` 같은 값으로 **헤더를 새로 만들어** 수신자를 추가하거나
 * 본문을 조작할 수 있다. 이 기능의 메일에는 **초대코드**가 들어 있으므로, 헤더 인젝션은 곧
 * 코드 유출이다 — T-010 의 핵심 보안 불변식이 여기서 깨질 수 있다.
 *
 * ## 방어 원칙 (강한 것부터)
 *
 *  1. **요청자 입력은 원칙적으로 본문에만 넣는다.** 요청자 이메일·하실 말씀은 헤더에 절대
 *     넣지 않는다. 특히 `Reply-To: <요청자 주소>` 는 편해 보이지만 **쓰지 않는다** —
 *     검증되지 않은 주소를 헤더에 넣는 순간 인젝션 표면이 생기고, 관리자가 그 주소를
 *     "확인된 신원"으로 오인할 여지도 생긴다.
 *  2. 제목에는 이름만 들어간다(목업 확정 `[주식자동매매] 가입 요청 — 홍길동`).
 *     `sanitizeHeaderText` 로 **제어문자를 전부 제거**하고 길이를 자른다.
 *     nodemailer 도 자체 인코딩을 하지만 그것에 의존하지 않는다 — 우리 쪽에서 먼저 끊는다.
 *  3. 수신자 주소는 env 에서만 오고, 그마저도 `isSafeHeaderAddress` 로 다시 검사한다.
 *     (env 오타·붙여넣기 사고로 개행이 섞여 들어오는 경우까지 fail-closed 로 막는다)
 *  4. HTML 본문에 들어가는 모든 요청자 입력은 `escapeHtml` 로 이스케이프한다.
 */

/**
 * 헤더에 넣어도 안전한 형태로 정규화한다.
 *  - 제어문자(CR/LF/TAB/NUL 등 U+0000~U+001F, U+007F)를 **제거**한다(치환이 아니라 삭제)
 *  - 유니코드 줄바꿈(U+2028/U+2029)도 제거
 *  - 연속 공백은 하나로 접고 양끝을 다듬는다
 *  - `maxLen` 자로 자른다 (헤더 폴딩·표시 안정성)
 *
 * @returns 정규화 결과. 남는 게 없으면 빈 문자열(호출부가 대체 문구를 넣는다).
 */
export function sanitizeHeaderText(raw: unknown, maxLen: number): string {
  if (typeof raw !== 'string') return '';
  return raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F\u2028\u2029]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

/**
 * 헤더에 넣어도 안전한 **주소**인가. 수신자·발신자에만 쓴다.
 *
 * 형식 검사는 `isValidEmail`(users.ts)보다 엄격하다 — 주소는 헤더에 그대로 나가므로
 * 공백·쉼표·꺾쇠·따옴표·제어문자가 하나라도 있으면 거부한다(주소 목록 구분자로 해석될 수 있다).
 */
export function isSafeHeaderAddress(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  const v = raw.trim();
  if (v.length === 0 || v.length > 254) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F\u2028\u2029\s,;<>"'\\()[\]]/.test(v)) return false;
  return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(v);
}

/** HTML 본문 삽입용 이스케이프. 요청자 입력은 **예외 없이** 이걸 통과한 뒤에 들어간다. */
export function escapeHtml(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
