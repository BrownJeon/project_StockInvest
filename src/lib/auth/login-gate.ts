/**
 * 로그인 시도 제한 — **전역(프로세스 단위) 지수 백오프** (Phase 0, 2026-08-02).
 *
 * 이전 구현은 `x-forwarded-for` 를 키로 IP별 카운터를 뒀는데, PM2 가 리버스 프록시 없이
 * `0.0.0.0:3003` 에 직접 바인딩하므로 이 헤더는 **공격자가 임의로 조작 가능**했다.
 * 헤더만 매번 바꾸면 제한이 사실상 무제한 우회돼 PIN 브루트포스가 가능했다.
 *
 * 사용자가 1인이므로 IP 별로 나눌 실익이 없다 → 전역 카운터 하나로 단순화한다.
 *
 * 정책:
 *  - 연속 실패 FREE_ATTEMPTS(5)회까지는 잠금 없음
 *  - 6회째부터 잠금. 잠금 시간은 실패가 누적될수록 2배씩 증가 (1m → 2m → 4m … 최대 1h)
 *  - 잠금 중에는 **PIN 대조 자체를 수행하지 않는다** (타이밍 정보 노출 방지)
 *  - 로그인 성공 시 카운터 완전 초기화
 *  - 프로세스 재시작 시 초기화되는 한계는 수용 (1인 홈서버)
 *
 * 이 모듈은 I/O 가 없는 순수 상태 머신이다 — 알림 발송은 호출부(route)가 담당한다.
 */

export const FREE_ATTEMPTS = 5;
export const BASE_LOCK_MS = 60_000;          // 6회째 실패 → 1분
export const MAX_LOCK_MS = 60 * 60_000;      // 상한 1시간

interface GateState {
  /** 마지막 성공 이후 누적 실패 횟수 */
  fails: number;
  /** 잠금 해제 시각 (epoch ms). 0 이면 잠금 아님 */
  lockedUntil: number;
}

const state: GateState = { fails: 0, lockedUntil: 0 };

/** 실패 횟수에 대한 잠금 시간(ms). FREE_ATTEMPTS 이하이면 0. */
export function lockDurationMs(fails: number): number {
  const over = fails - FREE_ATTEMPTS;
  if (over <= 0) return 0;
  const ms = BASE_LOCK_MS * 2 ** (over - 1);
  return Math.min(ms, MAX_LOCK_MS);
}

export type GateCheck =
  | { allowed: true }
  | { allowed: false; retryAfterSec: number };

/**
 * 로그인 시도 허용 여부. **PIN 대조 전에 반드시 먼저 호출**한다.
 * 잠금 중이면 남은 시간을 초 단위로 돌려준다.
 */
export function checkLoginGate(now: number = Date.now()): GateCheck {
  if (state.lockedUntil > now) {
    return { allowed: false, retryAfterSec: Math.ceil((state.lockedUntil - now) / 1000) };
  }
  return { allowed: true };
}

export interface FailureResult {
  /** 마지막 성공 이후 누적 실패 횟수 */
  fails: number;
  /** 이번 실패로 **새로** 잠금이 걸렸는지 (알림 발송 트리거 — 중복 알림 방지용) */
  lockedNow: boolean;
  /** 잠금 시간(ms). 잠기지 않았으면 0 */
  lockMs: number;
}

/** 로그인 실패 기록. 임계 초과 시 잠금을 건다. */
export function registerLoginFailure(now: number = Date.now()): FailureResult {
  state.fails += 1;
  const lockMs = lockDurationMs(state.fails);
  if (lockMs > 0) {
    state.lockedUntil = now + lockMs;
    return { fails: state.fails, lockedNow: true, lockMs };
  }
  return { fails: state.fails, lockedNow: false, lockMs: 0 };
}

/** 로그인 성공 — 카운터·잠금 완전 초기화. */
export function resetLoginGate(): void {
  state.fails = 0;
  state.lockedUntil = 0;
}

/** 진단용 스냅샷 (값 복사본). */
export function loginGateSnapshot(): Readonly<GateState> {
  return { fails: state.fails, lockedUntil: state.lockedUntil };
}
