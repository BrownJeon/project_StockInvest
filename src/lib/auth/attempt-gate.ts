/**
 * 시도 제한 상태 머신 (T-010, 2026-08-09) — `login-gate.ts` 에서 **동작 변경 없이** 추출했다.
 *
 * **왜 추출했나**: T-010 의 `/api/auth/signup-request` 는 인터넷에 열린 **무인증 공개** 엔드포인트라
 * 자체 rate limit 이 필요하다. 그런데 그 제한을 `login-gate` 의 Map 에 (`signup-request:` 같은
 * 접두어로) 얹으면 **로그인 브루트포스 방어가 약해진다**:
 *
 *   login-gate 의 `prune()` 은 상한(MAX_KEYS) 초과 시 `lockedUntil` 이 이른 항목부터 버린다.
 *   잠기지 않은(=실패 1~5회 누적 중인) 계정이 가장 먼저 축출 대상이다. 공개 폼으로 임의의
 *   키를 계속 밀어 넣을 수 있으면, 공격자가 **자기 실패 카운터가 지워질 때까지** Map 을
 *   부풀릴 수 있다 — 5회마다 카운터가 리셋되면 지수 백오프가 사실상 무력해진다.
 *
 * 그래서 "같은 패턴, 다른 저장소"가 필요하다. 코드를 복사하는 대신 팩토리로 만들고
 * `login-gate` 는 이 팩토리의 인스턴스 하나를 감싸는 얇은 래퍼가 됐다 —
 * 공개 API·정책·상수는 전부 그대로다(기존 테스트가 그 보증이다).
 *
 * 정책(파라미터화):
 *  - 연속 시도 `freeAttempts` 회까지는 잠금 없음
 *  - 그 다음부터 잠금. 누적될수록 2배씩 증가 (`baseLockMs` → … → `maxLockMs` 상한)
 *  - 잠금 중이면 남은 시간을 초 단위로 알려준다
 *
 * **메모리 상한**: 키가 임의 문자열이므로 Map 이 무한히 자랄 수 있다.
 *  - 쓰기 시점마다 만료·유휴 항목을 청소 (`idleTtlMs`)
 *  - 그래도 `maxKeys` 를 넘으면 **해제 시각이 가장 이른 항목부터** 버린다
 *    (오래 잠긴 = 가장 집중 공격받는 키의 잠금을 마지막까지 지킨다)
 *
 * 이 모듈은 I/O 가 없는 순수 상태 머신이다 — 알림 발송은 호출부(route)가 담당한다.
 */

export interface GateState {
  /** 마지막 초기화 이후 누적 시도 횟수 */
  fails: number;
  /** 잠금 해제 시각 (epoch ms). 0 이면 잠금 아님 */
  lockedUntil: number;
  /** 마지막 갱신 시각 (epoch ms) — 유휴 청소용 */
  lastSeen: number;
}

export type GateCheck =
  | { allowed: true }
  | { allowed: false; retryAfterSec: number };

export interface FailureResult {
  /** 마지막 초기화 이후 누적 시도 횟수 */
  fails: number;
  /** 이번 시도로 **새로** 잠금이 걸렸는지 (알림 트리거 — 중복 알림 방지용) */
  lockedNow: boolean;
  /** 잠금 시간(ms). 잠기지 않았으면 0 */
  lockMs: number;
}

export interface AttemptGateOptions {
  /** 잠금 없이 허용하는 연속 시도 횟수 */
  freeAttempts: number;
  /** 첫 잠금 시간(ms) */
  baseLockMs: number;
  /** 잠금 시간 상한(ms) */
  maxLockMs: number;
  /** 잠기지 않은 채 이 시간 넘게 조용한 항목은 청소 대상 */
  idleTtlMs: number;
  /** 동시에 추적하는 최대 키 수 (메모리 상한) */
  maxKeys: number;
}

export interface AttemptGate {
  readonly options: Readonly<AttemptGateOptions>;
  /** 시도 횟수에 대한 잠금 시간(ms). `freeAttempts` 이하이면 0. */
  lockDurationMs(fails: number): number;
  /** 시도 허용 여부. **비용이 드는 작업 전에 반드시 먼저 호출**한다. */
  check(key: unknown, now?: number): GateCheck;
  /** 시도 기록. 임계 초과 시 해당 키에 잠금을 건다. */
  register(key: unknown, now?: number): FailureResult;
  /** 해당 키의 카운터·잠금 완전 초기화. */
  reset(key: unknown): void;
  /** 테스트 전용 — 전체 초기화. */
  resetAll(): void;
  /** 진단용 스냅샷 (값 복사본). 추적 중이 아니면 초기 상태를 돌려준다. */
  snapshot(key: unknown): Readonly<GateState>;
  /** 진단용 — 현재 추적 중인 키 수 (메모리 상한 검증용). */
  size(): number;
}

/**
 * 게이트 키 정규화. 호출부(라우트)와 **반드시 동일한 정규화**를 써야 한다
 * (`Foo@x.com` 과 `foo@x.com` 이 서로 다른 카운터가 되면 백오프를 우회할 수 있다).
 */
export function normalizeGateKey(key: unknown): string {
  return typeof key === 'string' ? key.trim().toLowerCase() : '';
}

export function createAttemptGate(options: AttemptGateOptions): AttemptGate {
  const states = new Map<string, GateState>();
  const opts: Readonly<AttemptGateOptions> = Object.freeze({ ...options });

  function lockDurationMs(fails: number): number {
    const over = fails - opts.freeAttempts;
    if (over <= 0) return 0;
    const ms = opts.baseLockMs * 2 ** (over - 1);
    return Math.min(ms, opts.maxLockMs);
  }

  /** 만료·유휴 항목 청소 + 상한 초과 시 축출. 쓰기 경로에서만 호출한다. */
  function prune(now: number): void {
    for (const [key, st] of states) {
      if (st.lockedUntil > now) continue;              // 잠금 중인 항목은 유지
      if (now - st.lastSeen > opts.idleTtlMs) states.delete(key);
    }
    if (states.size <= opts.maxKeys) return;

    // 상한 초과 — 해제 시각이 이른(=덜 심각한) 항목부터 버린다.
    const victims = [...states.entries()]
      .sort((a, b) => (a[1].lockedUntil - b[1].lockedUntil) || (a[1].lastSeen - b[1].lastSeen))
      .slice(0, states.size - opts.maxKeys);
    for (const [key] of victims) states.delete(key);
  }

  return {
    options: opts,
    lockDurationMs,

    check(key: unknown, now: number = Date.now()): GateCheck {
      const st = states.get(normalizeGateKey(key));
      if (st && st.lockedUntil > now) {
        return { allowed: false, retryAfterSec: Math.ceil((st.lockedUntil - now) / 1000) };
      }
      return { allowed: true };
    },

    register(key: unknown, now: number = Date.now()): FailureResult {
      const k = normalizeGateKey(key);
      const st = states.get(k) ?? { fails: 0, lockedUntil: 0, lastSeen: now };
      st.fails += 1;
      st.lastSeen = now;
      const lockMs = lockDurationMs(st.fails);
      if (lockMs > 0) st.lockedUntil = now + lockMs;
      states.set(k, st);
      // 삽입 **후** 청소한다 — 먼저 청소하면 이번에 추가된 항목 때문에 상한을 1 넘긴 채로 끝난다.
      // 방금 갱신한 항목은 lastSeen 이 가장 최신이라 축출 정렬에서 맨 뒤에 놓인다.
      prune(now);
      return { fails: st.fails, lockedNow: lockMs > 0, lockMs };
    },

    reset(key: unknown): void {
      states.delete(normalizeGateKey(key));
    },

    resetAll(): void {
      states.clear();
    },

    snapshot(key: unknown): Readonly<GateState> {
      const st = states.get(normalizeGateKey(key));
      return st
        ? { fails: st.fails, lockedUntil: st.lockedUntil, lastSeen: st.lastSeen }
        : { fails: 0, lockedUntil: 0, lastSeen: 0 };
    },

    size(): number {
      return states.size;
    },
  };
}
