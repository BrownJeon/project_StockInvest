/**
 * 가입 게이트 — 초대 코드 (T-008, 2026-08-07).
 *
 * **왜 필요한가**: 승인된 설계문서는 "관리자 승인제 가입"을 범위 밖으로 두면서 그 근거로
 * "KIS 키 실검증이 사실상의 가입 제한 역할"(문서 line 28)을 들었다. 사용자 결정 Q1 으로
 * KIS 입력이 가입 화면에서 빠지면서 **그 제한이 사라졌다.** 이 앱은 nginx vhost
 * (stock.미라클펭귄.com)로 인터넷에 열려 있고 basic-auth·IP 허용목록이 없다.
 * 초대 코드가 그 자리를 대신한다.
 *
 * 동작:
 *   - `SIGNUP_INVITE_CODE` 설정됨  → 가입 시 코드 필수. 불일치면 거부.
 *   - `SIGNUP_INVITE_CODE` 미설정 → **가입 개방**. 대신 부팅/시도마다 경고를 크게 남긴다.
 *
 * 설정 되돌리기가 코드 수정 없이 env 만으로 되는 형태다 — 키를 지우면 즉시 개방된다.
 *
 * 비교는 `crypto.timingSafeEqual`. 길이 정보까지 감추려고 양쪽을 SHA-256 으로 고정 길이화한
 * 뒤 비교한다 (원문을 그대로 비교하면 길이가 다를 때 즉시 false 라 길이가 샌다).
 */
import { createHash, timingSafeEqual } from 'node:crypto';

/** 초대 코드 설정 여부 (값은 노출하지 않는다). */
export function isInviteRequired(): boolean {
  const v = process.env.SIGNUP_INVITE_CODE;
  return typeof v === 'string' && v.trim().length > 0;
}

/** 길이 정보까지 감춘 상수시간 문자열 비교. */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}

export type InviteCheck =
  | { ok: true; gate: 'invite_required' | 'open' }
  | { ok: false; error: string };

let openWarningLogged = false;

/**
 * 초대 코드 미설정 상태를 **한 번은 크게** 알린다 (프로세스당 1회).
 * 조용히 열려 있는 것이 이 설계에서 가장 나쁜 상태다.
 */
export function warnIfSignupOpen(): void {
  if (openWarningLogged || isInviteRequired()) return;
  openWarningLogged = true;
  console.warn(
    '\n' +
    '████████████████████████████████████████████████████████████████\n' +
    '█ [auth] 경고 — SIGNUP_INVITE_CODE 미설정: 회원가입이 개방돼 있습니다. █\n' +
    '████████████████████████████████████████████████████████████████\n' +
    '이 앱은 인터넷에 공개된 vhost(stock.미라클펭귄.com)로 서비스됩니다.\n' +
    '누구나 계정을 만들 수 있는 상태입니다. 서버 .env 에 SIGNUP_INVITE_CODE 를 설정하고\n' +
    '재시작하면 초대 코드를 아는 사람만 가입할 수 있습니다.\n',
  );
}

/** 테스트 전용 — 1회성 경고 플래그 초기화. */
export function resetSignupGateWarning(): void {
  openWarningLogged = false;
}

/**
 * 가입 시도의 초대 코드 검사.
 * 미설정 상태면 통과시키되 **시도마다** 경고 로그를 남긴다(입력값은 로그하지 않는다).
 */
export function checkSignupInvite(given: unknown): InviteCheck {
  const expected = process.env.SIGNUP_INVITE_CODE;
  if (typeof expected !== 'string' || expected.trim().length === 0) {
    console.warn('[auth] 회원가입 개방 상태에서 가입 시도 — SIGNUP_INVITE_CODE 미설정');
    return { ok: true, gate: 'open' };
  }
  const code = typeof given === 'string' ? given.trim() : '';
  if (code.length === 0) return { ok: false, error: '초대 코드를 입력하세요' };
  if (!timingSafeEqualStr(code, expected.trim())) {
    return { ok: false, error: '초대 코드가 올바르지 않습니다' };
  }
  return { ok: true, gate: 'invite_required' };
}

// 모듈이 처음 로드되는 시점(= 가입 경로가 처음 사용되는 서버 부팅 직후)에 1회 경고한다.
// 테스트 환경에서는 출력 노이즈를 만들지 않는다.
if (process.env.NODE_ENV !== 'test') warnIfSignupOpen();
