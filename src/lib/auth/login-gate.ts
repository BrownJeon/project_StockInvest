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
 *
 * **메모리 상한**: 키가 임의 문자열이므로 Map 이 무한히 자랄 수 있다(임의 이메일 폭주).
 *  - 쓰기 시점마다 만료·유휴 항목을 청소 (`IDLE_TTL_MS`)
 *  - 그래도 `MAX_KEYS` 를 넘으면 **해제 시각이 가장 이른 항목부터** 버린다.
 *    (오래 잠긴 = 가장 집중 공격받는 계정의 잠금을 마지막까지 지킨다)
 *
 * 이 모듈은 I/O 가 없는 순수 상태 머신이다 — 알림 발송은 호출부(route)가 담당한다.
 */

export const FREE_ATTEMPTS = 5;
export const BASE_LOCK_MS = 60_000;          // 6회째 실패 → 1분
export const MAX_LOCK_MS = 60 * 60_000;      // 상한 1시간

/** 잠기지 않은 채 이 시간 넘게 조용한 항목은 청소 대상 */
export const IDLE_TTL_MS = 2 * 60 * 60_000;  // 2시간
/** 동시에 추적하는 최대 키 수 (메모리 상한) */
export const MAX_KEYS = 5_000;

export interface GateState {
  /** 마지막 성공 이후 누적 실패 횟수 */
  fails: number;
  /** 잠금 해제 시각 (epoch ms). 0 이면 잠금 아님 */
  lockedUntil: number;
  /** 마지막 갱신 시각 (epoch ms) — 유휴 청소용 */
  lastSeen: number;
}

const states = new Map<string, GateState>();

/**
 * 게이트 키 정규화. 로그인·가입 라우트와 **반드시 동일한 정규화**를 써야 한다
 * (`Foo@x.com` 과 `foo@x.com` 이 서로 다른 카운터가 되면 백오프를 우회할 수 있다).
 */
export function gateKey(email: string): string {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

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

/** 만료·유휴 항목 청소 + 상한 초과 시 축출. 쓰기 경로에서만 호출한다. */
function prune(now: number): void {
  for (const [key, st] of states) {
    if (st.lockedUntil > now) continue;              // 잠금 중인 항목은 유지
    if (now - st.lastSeen > IDLE_TTL_MS) states.delete(key);
  }
  if (states.size <= MAX_KEYS) return;

  // 상한 초과 — 해제 시각이 이른(=덜 심각한) 항목부터 버린다.
  const victims = [...states.entries()]
    .sort((a, b) => (a[1].lockedUntil - b[1].lockedUntil) || (a[1].lastSeen - b[1].lastSeen))
    .slice(0, states.size - MAX_KEYS);
  for (const [key] of victims) states.delete(key);
}

/**
 * 로그인 시도 허용 여부. **비밀번호 대조 전에 반드시 먼저 호출**한다.
 * 잠금 중이면 남은 시간을 초 단위로 돌려준다.
 */
export function checkLoginGate(email: string, now: number = Date.now()): GateCheck {
  const st = states.get(gateKey(email));
  if (st && st.lockedUntil > now) {
    return { allowed: false, retryAfterSec: Math.ceil((st.lockedUntil - now) / 1000) };
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

/** 로그인 실패 기록. 임계 초과 시 해당 이메일에 잠금을 건다. */
export function registerLoginFailure(email: string, now: number = Date.now()): FailureResult {
  const key = gateKey(email);
  const st = states.get(key) ?? { fails: 0, lockedUntil: 0, lastSeen: now };
  st.fails += 1;
  st.lastSeen = now;
  const lockMs = lockDurationMs(st.fails);
  if (lockMs > 0) st.lockedUntil = now + lockMs;
  states.set(key, st);
  // 삽입 **후** 청소한다 — 먼저 청소하면 이번에 추가된 항목 때문에 상한을 1 넘긴 채로 끝난다.
  // 방금 갱신한 항목은 lastSeen 이 가장 최신이라 축출 정렬에서 맨 뒤에 놓인다.
  prune(now);
  return { fails: st.fails, lockedNow: lockMs > 0, lockMs };
}

/** 로그인 성공 — 해당 이메일의 카운터·잠금 완전 초기화. */
export function resetLoginGate(email: string): void {
  states.delete(gateKey(email));
}

/** 테스트 전용 — 전체 초기화. */
export function resetAllLoginGates(): void {
  states.clear();
}

/** 진단용 스냅샷 (값 복사본). 추적 중이 아니면 초기 상태를 돌려준다. */
export function loginGateSnapshot(email: string): Readonly<GateState> {
  const st = states.get(gateKey(email));
  return st
    ? { fails: st.fails, lockedUntil: st.lockedUntil, lastSeen: st.lastSeen }
    : { fails: 0, lockedUntil: 0, lastSeen: 0 };
}

/** 진단용 — 현재 추적 중인 키 수 (메모리 상한 검증용). */
export function loginGateSize(): number {
  return states.size;
}
