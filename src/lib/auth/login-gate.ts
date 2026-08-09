/**
 * 로그인 시도 제한 — **이메일별 지수 백오프** (Phase 0 2026-08-02 → T-008 2026-08-07).
 *
 * 연혁:
 *  1. IP(`x-forwarded-for`) 키 → PM2 가 리버스 프록시 없이 직접 바인딩해 헤더를 공격자가
 *     조작할 수 있었다. 헤더만 바꾸면 제한이 무제한 우회됐다 → 폐기.
 *  2. 전역 카운터 1개 → 1인 PIN 시절에는 맞았지만, 회원이 여럿이면 **한 명의 실패가 전원을
 *     잠근다**(DoS). 남이 내 계정을 잠글 수도 있다.
 *  3. (현재) **정규화한 이메일(lowercase+trim)별 카운터.** 클라이언트가 임의로 만들어낼 수 있는
 *     값이라는 점은 IP 와 같지만, 결정적 차이가 있다 — 키를 바꾸면 **공격 대상 계정도 바뀐다.**
 *     특정 계정의 비밀번호를 맞히려면 그 이메일 키를 계속 써야 하므로 백오프를 피할 수 없다.
 *
 * 정책 (변경 없음):
 *  - 연속 실패 FREE_ATTEMPTS(5)회까지는 잠금 없음
 *  - 6회째부터 잠금. 실패가 누적될수록 2배씩 증가 (1m → 2m → 4m … 최대 1h)
 *  - 잠금 중에는 **비밀번호 대조 자체를 수행하지 않는다** (타이밍 정보 노출 방지)
 *  - 로그인 성공 시 해당 이메일 카운터 완전 초기화
 *  - 프로세스 재시작 시 초기화되는 한계는 수용 (소규모 홈서버)
 *  - 메모리 상한: IDLE_TTL_MS 유휴 청소 + MAX_KEYS 초과 시 해제 시각이 이른 항목부터 축출
 *
 * T-010(2026-08-09): 상태 머신 자체는 `attempt-gate.ts` 로 추출됐다(**정책·공개 API·동작 동일**).
 * 이 모듈은 그 팩토리의 인스턴스 하나를 감싸는 얇은 래퍼다. 추출 이유는 공개 무인증
 * 엔드포인트(`/api/auth/signup-request`)가 **자기 저장소**를 갖게 하기 위함이다 —
 * 같은 Map 을 공유하면 공개 폼으로 키를 밀어 넣어 로그인 실패 카운터를 축출할 수 있다.
 * 자세한 근거는 `attempt-gate.ts` 상단 주석 참고.
 *
 * 이 모듈은 I/O 가 없는 순수 상태 머신이다 — 알림 발송은 호출부(route)가 담당한다.
 */
import { createAttemptGate, normalizeGateKey } from '@/lib/auth/attempt-gate';
import type { FailureResult, GateCheck, GateState } from '@/lib/auth/attempt-gate';

export type { FailureResult, GateCheck, GateState };

export const FREE_ATTEMPTS = 5;
export const BASE_LOCK_MS = 60_000;          // 6회째 실패 → 1분
export const MAX_LOCK_MS = 60 * 60_000;      // 상한 1시간

/** 잠기지 않은 채 이 시간 넘게 조용한 항목은 청소 대상 */
export const IDLE_TTL_MS = 2 * 60 * 60_000;  // 2시간
/** 동시에 추적하는 최대 키 수 (메모리 상한) */
export const MAX_KEYS = 5_000;

const gate = createAttemptGate({
  freeAttempts: FREE_ATTEMPTS,
  baseLockMs: BASE_LOCK_MS,
  maxLockMs: MAX_LOCK_MS,
  idleTtlMs: IDLE_TTL_MS,
  maxKeys: MAX_KEYS,
});

/**
 * 게이트 키 정규화. 로그인·가입 라우트와 **반드시 동일한 정규화**를 써야 한다
 * (`Foo@x.com` 과 `foo@x.com` 이 서로 다른 카운터가 되면 백오프를 우회할 수 있다).
 */
export function gateKey(email: string): string {
  return normalizeGateKey(email);
}

/** 실패 횟수에 대한 잠금 시간(ms). FREE_ATTEMPTS 이하이면 0. */
export function lockDurationMs(fails: number): number {
  return gate.lockDurationMs(fails);
}

/**
 * 로그인 시도 허용 여부. **비밀번호 대조 전에 반드시 먼저 호출**한다.
 * 잠금 중이면 남은 시간을 초 단위로 돌려준다.
 */
export function checkLoginGate(email: string, now: number = Date.now()): GateCheck {
  return gate.check(email, now);
}

/** 로그인 실패 기록. 임계 초과 시 해당 이메일에 잠금을 건다. */
export function registerLoginFailure(email: string, now: number = Date.now()): FailureResult {
  return gate.register(email, now);
}

/** 로그인 성공 — 해당 이메일의 카운터·잠금 완전 초기화. */
export function resetLoginGate(email: string): void {
  gate.reset(email);
}

/** 테스트 전용 — 전체 초기화. */
export function resetAllLoginGates(): void {
  gate.resetAll();
}

/** 진단용 스냅샷 (값 복사본). 추적 중이 아니면 초기 상태를 돌려준다. */
export function loginGateSnapshot(email: string): Readonly<GateState> {
  return gate.snapshot(email);
}

/** 진단용 — 현재 추적 중인 키 수 (메모리 상한 검증용). */
export function loginGateSize(): number {
  return gate.size();
}
