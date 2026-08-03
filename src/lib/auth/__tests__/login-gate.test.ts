/**
 * Phase 0 — 로그인 전역 지수 백오프 시도 제한 테스트.
 *
 * 회귀 방어 포인트: IP(x-forwarded-for) 키 기반으로 되돌리면 헤더 스푸핑으로
 * 무제한 브루트포스가 가능해진다. 이 모듈은 **키가 없는 전역 카운터**여야 한다.
 */
import {
  BASE_LOCK_MS,
  FREE_ATTEMPTS,
  MAX_LOCK_MS,
  checkLoginGate,
  lockDurationMs,
  loginGateSnapshot,
  registerLoginFailure,
  resetLoginGate,
} from '../login-gate';

beforeEach(() => resetLoginGate());

describe('lockDurationMs — 지수 백오프', () => {
  test('FREE_ATTEMPTS 이하에서는 잠금 없음', () => {
    for (let i = 0; i <= FREE_ATTEMPTS; i++) {
      expect(lockDurationMs(i)).toBe(0);
    }
  });

  test('초과분마다 2배씩 증가', () => {
    expect(lockDurationMs(FREE_ATTEMPTS + 1)).toBe(BASE_LOCK_MS);       // 1분
    expect(lockDurationMs(FREE_ATTEMPTS + 2)).toBe(BASE_LOCK_MS * 2);   // 2분
    expect(lockDurationMs(FREE_ATTEMPTS + 3)).toBe(BASE_LOCK_MS * 4);   // 4분
    expect(lockDurationMs(FREE_ATTEMPTS + 4)).toBe(BASE_LOCK_MS * 8);   // 8분
  });

  test('상한(MAX_LOCK_MS)을 넘지 않는다', () => {
    expect(lockDurationMs(FREE_ATTEMPTS + 30)).toBe(MAX_LOCK_MS);
    expect(lockDurationMs(9999)).toBe(MAX_LOCK_MS);
  });
});

describe('checkLoginGate / registerLoginFailure', () => {
  test('초기 상태는 허용', () => {
    expect(checkLoginGate()).toEqual({ allowed: true });
  });

  test('FREE_ATTEMPTS 회까지는 실패해도 계속 허용', () => {
    const now = 1_000_000;
    for (let i = 1; i <= FREE_ATTEMPTS; i++) {
      const r = registerLoginFailure(now);
      expect(r.fails).toBe(i);
      expect(r.lockedNow).toBe(false);
      expect(checkLoginGate(now)).toEqual({ allowed: true });
    }
  });

  test('FREE_ATTEMPTS + 1 회째 실패에서 잠금', () => {
    const now = 1_000_000;
    for (let i = 0; i < FREE_ATTEMPTS; i++) registerLoginFailure(now);
    const r = registerLoginFailure(now);
    expect(r.lockedNow).toBe(true);
    expect(r.lockMs).toBe(BASE_LOCK_MS);

    const gate = checkLoginGate(now);
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) expect(gate.retryAfterSec).toBe(BASE_LOCK_MS / 1000);
  });

  test('잠금 시간이 지나면 다시 허용', () => {
    const now = 1_000_000;
    for (let i = 0; i <= FREE_ATTEMPTS; i++) registerLoginFailure(now);
    expect(checkLoginGate(now + BASE_LOCK_MS - 1).allowed).toBe(false);
    expect(checkLoginGate(now + BASE_LOCK_MS).allowed).toBe(true);
  });

  test('잠금 해제 후 또 실패하면 대기 시간이 더 길어진다', () => {
    const now = 1_000_000;
    for (let i = 0; i <= FREE_ATTEMPTS; i++) registerLoginFailure(now);   // fails = 6 → 1분
    const t2 = now + BASE_LOCK_MS;
    const r = registerLoginFailure(t2);                                    // fails = 7 → 2분
    expect(r.fails).toBe(FREE_ATTEMPTS + 2);
    expect(r.lockMs).toBe(BASE_LOCK_MS * 2);
    expect(checkLoginGate(t2 + BASE_LOCK_MS).allowed).toBe(false);
    expect(checkLoginGate(t2 + BASE_LOCK_MS * 2).allowed).toBe(true);
  });

  test('성공(reset) 시 카운터·잠금 모두 초기화', () => {
    const now = 1_000_000;
    for (let i = 0; i <= FREE_ATTEMPTS + 3; i++) registerLoginFailure(now);
    expect(checkLoginGate(now).allowed).toBe(false);

    resetLoginGate();
    expect(loginGateSnapshot()).toEqual({ fails: 0, lockedUntil: 0 });
    expect(checkLoginGate(now)).toEqual({ allowed: true });
  });

  test('카운터는 전역이다 — 호출자를 구분하는 키가 없다', () => {
    // registerLoginFailure/checkLoginGate 는 식별자 인자를 받지 않는다.
    // (IP·헤더 등 클라이언트 조작 가능한 값으로 카운터가 분리되면 우회가 가능해진다)
    expect(registerLoginFailure.length).toBeLessThanOrEqual(1); // now 인자 하나뿐
    expect(checkLoginGate.length).toBeLessThanOrEqual(1);

    const now = 1_000_000;
    for (let i = 0; i <= FREE_ATTEMPTS; i++) registerLoginFailure(now);
    // 어떤 방식으로 호출해도 동일한 전역 잠금이 적용된다
    expect(checkLoginGate(now).allowed).toBe(false);
  });
});
