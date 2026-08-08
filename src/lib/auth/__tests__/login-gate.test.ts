/**
 * 로그인 시도 제한 테스트 (Phase 0 전역 카운터 → T-008 이메일별).
 *
 * 회귀 방어 포인트 3가지:
 *  1. IP(x-forwarded-for) 키로 되돌리면 헤더 스푸핑으로 무제한 브루트포스가 가능해진다
 *  2. 전역 카운터 1개로 되돌리면 한 회원의 실패가 전원을 잠근다 (상호 DoS)
 *  3. 키 정규화(lowercase+trim)를 빠뜨리면 대소문자만 바꿔 백오프를 우회할 수 있다
 */
import {
  BASE_LOCK_MS,
  FREE_ATTEMPTS,
  IDLE_TTL_MS,
  MAX_KEYS,
  MAX_LOCK_MS,
  checkLoginGate,
  gateKey,
  lockDurationMs,
  loginGateSize,
  loginGateSnapshot,
  registerLoginFailure,
  resetAllLoginGates,
  resetLoginGate,
} from '../login-gate';

const A = 'alice@example.com';
const B = 'bob@example.com';

beforeEach(() => resetAllLoginGates());

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
    expect(checkLoginGate(A)).toEqual({ allowed: true });
  });

  test('FREE_ATTEMPTS 회까지는 실패해도 계속 허용', () => {
    const now = 1_000_000;
    for (let i = 1; i <= FREE_ATTEMPTS; i++) {
      const r = registerLoginFailure(A, now);
      expect(r.fails).toBe(i);
      expect(r.lockedNow).toBe(false);
      expect(checkLoginGate(A, now)).toEqual({ allowed: true });
    }
  });

  test('FREE_ATTEMPTS + 1 회째 실패에서 잠금', () => {
    const now = 1_000_000;
    for (let i = 0; i < FREE_ATTEMPTS; i++) registerLoginFailure(A, now);
    const r = registerLoginFailure(A, now);
    expect(r.lockedNow).toBe(true);
    expect(r.lockMs).toBe(BASE_LOCK_MS);

    const gate = checkLoginGate(A, now);
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) expect(gate.retryAfterSec).toBe(BASE_LOCK_MS / 1000);
  });

  test('잠금 시간이 지나면 다시 허용', () => {
    const now = 1_000_000;
    for (let i = 0; i <= FREE_ATTEMPTS; i++) registerLoginFailure(A, now);
    expect(checkLoginGate(A, now + BASE_LOCK_MS - 1).allowed).toBe(false);
    expect(checkLoginGate(A, now + BASE_LOCK_MS).allowed).toBe(true);
  });

  test('잠금 해제 후 또 실패하면 대기 시간이 더 길어진다', () => {
    const now = 1_000_000;
    for (let i = 0; i <= FREE_ATTEMPTS; i++) registerLoginFailure(A, now);   // fails = 6 → 1분
    const t2 = now + BASE_LOCK_MS;
    const r = registerLoginFailure(A, t2);                                    // fails = 7 → 2분
    expect(r.fails).toBe(FREE_ATTEMPTS + 2);
    expect(r.lockMs).toBe(BASE_LOCK_MS * 2);
    expect(checkLoginGate(A, t2 + BASE_LOCK_MS).allowed).toBe(false);
    expect(checkLoginGate(A, t2 + BASE_LOCK_MS * 2).allowed).toBe(true);
  });

  test('성공(reset) 시 해당 이메일 카운터·잠금 모두 초기화', () => {
    const now = 1_000_000;
    for (let i = 0; i <= FREE_ATTEMPTS + 3; i++) registerLoginFailure(A, now);
    expect(checkLoginGate(A, now).allowed).toBe(false);

    resetLoginGate(A);
    expect(loginGateSnapshot(A).fails).toBe(0);
    expect(loginGateSnapshot(A).lockedUntil).toBe(0);
    expect(checkLoginGate(A, now)).toEqual({ allowed: true });
  });
});

describe('이메일별 격리 (T-008 핵심)', () => {
  test('A 가 잠겨도 B 는 영향받지 않는다', () => {
    const now = 1_000_000;
    for (let i = 0; i <= FREE_ATTEMPTS; i++) registerLoginFailure(A, now);
    expect(checkLoginGate(A, now).allowed).toBe(false);
    expect(checkLoginGate(B, now).allowed).toBe(true);
    expect(loginGateSnapshot(B).fails).toBe(0);
  });

  test('A 성공(reset)이 B 의 실패 이력을 지우지 않는다', () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) registerLoginFailure(B, now);
    resetLoginGate(A);
    expect(loginGateSnapshot(B).fails).toBe(3);
  });

  test('대소문자·공백만 다른 이메일은 같은 카운터를 쓴다 (우회 차단)', () => {
    const now = 1_000_000;
    for (let i = 0; i <= FREE_ATTEMPTS; i++) registerLoginFailure('  Alice@Example.COM ', now);
    expect(checkLoginGate(A, now).allowed).toBe(false);
    expect(checkLoginGate('ALICE@EXAMPLE.COM', now).allowed).toBe(false);
    expect(gateKey('  Alice@Example.COM ')).toBe(A);
  });
});

describe('메모리 상한', () => {
  test('잠기지 않은 유휴 항목은 청소된다', () => {
    const now = 1_000_000;
    registerLoginFailure('idle@example.com', now);
    expect(loginGateSize()).toBe(1);
    // 유휴 TTL 이 지난 뒤 다른 키에 쓰기가 일어나면 청소된다
    registerLoginFailure(B, now + IDLE_TTL_MS + 1);
    expect(loginGateSnapshot('idle@example.com').fails).toBe(0);
    expect(loginGateSize()).toBe(1);
  });

  test('잠금 중인 항목은 청소되지 않는다', () => {
    const now = 1_000_000;
    for (let i = 0; i <= FREE_ATTEMPTS + 20; i++) registerLoginFailure(A, now);   // 최대 잠금(1시간)
    // 잠금 유지 구간에서 다른 키 쓰기(=prune 유발)가 일어나도 A 의 잠금은 살아 있어야 한다
    registerLoginFailure(B, now + MAX_LOCK_MS / 2);
    expect(checkLoginGate(A, now + MAX_LOCK_MS / 2).allowed).toBe(false);
    expect(loginGateSnapshot(A).fails).toBeGreaterThan(FREE_ATTEMPTS);
  });

  test('MAX_KEYS 를 넘어도 Map 이 무한히 자라지 않는다', () => {
    const now = 1_000_000;
    for (let i = 0; i < MAX_KEYS + 200; i++) registerLoginFailure(`u${i}@example.com`, now);
    expect(loginGateSize()).toBeLessThanOrEqual(MAX_KEYS);
  });

  test('상한 축출 시 가장 오래 잠긴 항목이 마지막까지 남는다', () => {
    const now = 1_000_000;
    // 집중 공격받는 계정 — 최대 잠금
    for (let i = 0; i <= FREE_ATTEMPTS + 20; i++) registerLoginFailure(A, now);
    // 임의 이메일 폭주로 상한을 넘긴다
    for (let i = 0; i < MAX_KEYS + 200; i++) registerLoginFailure(`flood${i}@example.com`, now);
    expect(checkLoginGate(A, now).allowed).toBe(false);
  });
});
