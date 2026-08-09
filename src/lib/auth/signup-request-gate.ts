/**
 * 가입 요청 폼(`/api/auth/signup-request`) rate limit (T-010, 2026-08-09).
 *
 * 이 엔드포인트는 **인터넷에 열린 무인증 공개 경로**이고, 한 번의 호출이 관리자 메일함에
 * 메일 한 통을 꽂는다. 제한이 없으면 관리자 메일함 도배가 곧바로 가능하다.
 *
 * `login-gate` 와 **같은 상태 머신**(`attempt-gate.ts`)을 쓰되 **저장소는 분리**한다.
 * 같은 Map 을 쓰면 이 공개 폼으로 임의 키를 밀어 넣어 로그인 실패 카운터를 축출할 수 있다
 * (근거: `attempt-gate.ts` 상단 주석).
 *
 * ## 두 축으로 건다 — IP 와 이메일
 *
 * | 축 | 막는 것 | 우회 방법 | 정책 |
 * |---|---|---|---|
 * | IP | 한 사람이 폼을 연타 | IP 를 바꾸거나 헤더 위조 | 5회 무료 → 10분 → 20분 … 6시간 |
 * | 이메일 | 한 주소로 반복 요청 | 주소를 바꿈 | 2회 무료 → 10분 → 20분 … 6시간 |
 *
 * 어느 한쪽도 완전하지 않다. 둘을 겹쳐야 "한 사람이 여러 주소로", "여러 사람이 한 주소로"가
 * 동시에 막힌다. 실패한 발송도 카운트한다 — 이미 SMTP 연결 비용을 치렀기 때문이다.
 *
 * ## ⚠️ IP 키의 신뢰 수준 (login-gate 가 IP 키를 버린 이력과의 관계)
 *
 * `login-gate` 는 IP 키를 **폐기**했다. 헤더를 바꾸면 백오프가 무제한 우회됐기 때문이다.
 * 여기서 IP 를 다시 쓰는 이유는 **막으려는 것이 다르기** 때문이다:
 *   - login-gate 가 지키는 것은 *비밀번호* 다. 우회되면 계정이 털린다 → IP 키로는 부족
 *   - 여기서 지키는 것은 *관리자 메일함* 이다. 우회돼도 유출되는 비밀은 없다
 *     (초대코드는 요청자에게 어떤 경로로도 나가지 않는다)
 * 즉 IP 제한은 **스팸 속도 제한**이지 보안 경계가 아니다. 보안은 "코드가 요청자에게 안 간다"가 진다.
 *
 * 그래도 최대한 신뢰 가능한 값을 쓴다 — nginx vhost 가
 * `proxy_set_header X-Real-IP $remote_addr` 로 **덮어쓰므로**(추가가 아니라 치환)
 * 공개 경로로 들어온 요청의 `x-real-ip` 는 클라이언트가 조작할 수 없다.
 * 다만 pm2 가 `0.0.0.0:3003` 에 직접 바인딩돼 있어 **LAN 에서 포트로 직결하면** 위조 가능하다.
 * 그 경우까지 완전히 막지는 못한다(그리고 그건 이 기능만의 문제가 아니다).
 */
import { createAttemptGate } from '@/lib/auth/attempt-gate';

/** 10분 — 목업의 "10분 뒤 다시 시도해 주세요" 문구와 같은 값이어야 한다. */
export const SIGNUP_REQUEST_BASE_LOCK_MS = 10 * 60_000;
export const SIGNUP_REQUEST_MAX_LOCK_MS = 6 * 60 * 60_000;   // 6시간
/** 잠기지 않은 채 하루 넘게 조용한 항목은 청소 (Map 무한 성장 방지) */
export const SIGNUP_REQUEST_IDLE_TTL_MS = 24 * 60 * 60_000;

/** IP 는 가정·회사에서 공유될 수 있어 이메일보다 여유를 준다. */
export const SIGNUP_REQUEST_IP_FREE = 5;
/** 한 주소로는 사실상 1회면 충분하다. 오타 정정 1회를 감안해 2회. */
export const SIGNUP_REQUEST_EMAIL_FREE = 2;

/**
 * 메모리 상한. 키 하나당 3필드(약 100B 미만)이므로 2000키 × 2게이트 ≈ 수백 KB 수준이다.
 * pm2 `max_memory_restart:512M` 프로세스에서 안전한 규모이고, 초과분은
 * `attempt-gate` 의 축출 정책(해제 시각이 이른 항목부터)이 잘라낸다.
 */
export const SIGNUP_REQUEST_MAX_KEYS = 2_000;

const COMMON = {
  baseLockMs: SIGNUP_REQUEST_BASE_LOCK_MS,
  maxLockMs: SIGNUP_REQUEST_MAX_LOCK_MS,
  idleTtlMs: SIGNUP_REQUEST_IDLE_TTL_MS,
  maxKeys: SIGNUP_REQUEST_MAX_KEYS,
};

/** IP 축 — 저장소가 이메일 축과도, login-gate 와도 완전히 분리돼 있다. */
export const signupRequestIpGate = createAttemptGate({
  ...COMMON,
  freeAttempts: SIGNUP_REQUEST_IP_FREE,
});

/** 이메일 축 */
export const signupRequestEmailGate = createAttemptGate({
  ...COMMON,
  freeAttempts: SIGNUP_REQUEST_EMAIL_FREE,
});

/** 테스트 전용 — 두 축 모두 초기화. */
export function resetSignupRequestGates(): void {
  signupRequestIpGate.resetAll();
  signupRequestEmailGate.resetAll();
}

/** 429 안내 문구용 — 남은 초를 "분" 단위로 올림(최소 1분). */
export function retryAfterMinutes(retryAfterSec: number): number {
  return Math.max(1, Math.ceil(retryAfterSec / 60));
}
