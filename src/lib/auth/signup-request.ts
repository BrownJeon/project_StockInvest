/**
 * 가입 요청 폼 입력 검증 + 클라이언트 IP 추출 (T-010, 2026-08-09).
 *
 * 순수 함수만 둔다 — 라우트가 얇아지고 검증 규칙을 단위 테스트로 고정할 수 있다.
 */
import { isValidEmail, normalizeEmail } from '@/lib/auth/users';

/** 이름 상한. 넘으면 조용히 자르지 않고 **거부**한다 — 잘린 이름은 관리자를 오도한다. */
export const NAME_MAX = 60;
/** 하실 말씀 상한. 8KB 본문 상한(`request-limits.ts`) 안에 여유 있게 들어간다. */
export const MESSAGE_MAX = 1_000;

export interface SignupRequestInput {
  /** 정규화된(lowercase+trim) 요청자 이메일 — **검증되지 않은 주소** */
  email: string;
  name: string;
  /** 선택 항목. 미입력이면 빈 문자열 */
  message: string;
}

export type SignupRequestParse =
  | { ok: true; value: SignupRequestInput }
  | { ok: false; error: string };

/**
 * 요청 본문 검증 (사용자 확정 Q1: 이메일·이름 필수, 하실 말씀 선택).
 *
 * 이메일 형식은 로그인·가입과 **같은 판정**(`isValidEmail`)을 쓴다. 여기만 느슨하면
 * 관리자 메일 본문에 이상한 값이 들어가고, 여기만 엄격하면 정상 주소가 요청 자체를 못 한다.
 */
export function parseSignupRequest(body: unknown): SignupRequestParse {
  const b = (typeof body === 'object' && body !== null ? body : {}) as {
    email?: unknown; name?: unknown; message?: unknown;
  };

  const email = normalizeEmail(b.email);
  if (email.length === 0) return { ok: false, error: '이메일을 입력하세요' };
  if (!isValidEmail(email)) return { ok: false, error: '올바른 이메일 주소를 입력하세요' };

  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (name.length === 0) return { ok: false, error: '이름 또는 호칭을 입력하세요' };
  if (name.length > NAME_MAX) return { ok: false, error: `이름은 ${NAME_MAX}자 이내로 입력하세요` };

  const rawMessage = typeof b.message === 'string' ? b.message : '';
  if (rawMessage.length > MESSAGE_MAX) {
    return { ok: false, error: `하실 말씀은 ${MESSAGE_MAX}자 이내로 입력하세요` };
  }

  return { ok: true, value: { email, name, message: rawMessage.trim() } };
}

/** 헤더가 없어 IP 를 특정할 수 없을 때 쓰는 공용 버킷 키. */
export const UNKNOWN_IP_KEY = 'unknown';

/**
 * rate limit 용 클라이언트 IP 키.
 *
 * nginx vhost 는 다음 두 헤더를 세팅한다:
 *   proxy_set_header X-Real-IP       $remote_addr;              ← **치환**(클라이언트 위조 불가)
 *   proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; ← **추가**(앞부분은 클라이언트 값)
 *
 * 그래서 우선순위는 `x-real-ip` → `x-forwarded-for` 의 **마지막** 항목이다.
 * XFF 의 *첫* 항목을 쓰는 흔한 구현은 공격자가 마음대로 채울 수 있어 제한이 무력해진다.
 *
 * 둘 다 없으면(= 리버스 프록시를 거치지 않고 `:3003` 에 직결) 전부 하나의 `unknown` 버킷으로
 * 모은다. 그 경로는 어차피 LAN 내부뿐이고, 한 버킷에 모아두면 헤더 없는 폭주가 서로를
 * 빠르게 잠근다(개별 버킷을 주면 무제한이 된다).
 */
export function clientIpKey(headers: Headers): string {
  const realIp = headers.get('x-real-ip');
  if (typeof realIp === 'string' && realIp.trim().length > 0) return realIp.trim();

  const xff = headers.get('x-forwarded-for');
  if (typeof xff === 'string') {
    const parts = xff.split(',').map((p) => p.trim()).filter((p) => p.length > 0);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return UNKNOWN_IP_KEY;
}

/** 현재 초대코드 (env). 미설정이면 null — 메일이 "가입 개방 상태" 경고를 대신 싣는다. */
export function currentInviteCode(): string | null {
  const v = process.env.SIGNUP_INVITE_CODE;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}
