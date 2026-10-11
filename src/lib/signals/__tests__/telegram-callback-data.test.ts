/**
 * T-042 — 버튼 `callback_data` 코덱: 형식·서명·금액 결속·키 파생.
 */
import {
  CALLBACK_PREFIX,
  deriveApprovalKey,
  encodeCallbackData,
  parseCallbackData,
  verifyCallbackData,
} from '../telegram-callback-data';

const SECRET = 'a-session-secret-that-is-long-enough-1234567890';
const KEY = deriveApprovalKey(SECRET)!;

describe('deriveApprovalKey', () => {
  test('충분히 긴 비밀에서만 키를 만든다 (fail-closed)', () => {
    expect(KEY).toBeInstanceOf(Buffer);
    expect(deriveApprovalKey(undefined)).toBeNull();
    expect(deriveApprovalKey(null)).toBeNull();
    expect(deriveApprovalKey('')).toBeNull();
    expect(deriveApprovalKey('   short   ')).toBeNull();
    expect(deriveApprovalKey('x'.repeat(15))).toBeNull();
    expect(deriveApprovalKey('x'.repeat(16))).toBeInstanceOf(Buffer);
  });

  test('🔴 세션 비밀 자체가 키가 아니다 — 용도별로 파생된다', () => {
    expect(KEY.equals(Buffer.from(SECRET))).toBe(false);
    expect(deriveApprovalKey(SECRET)!.equals(KEY)).toBe(true);               // 결정적
    expect(deriveApprovalKey(SECRET + 'x')!.equals(KEY)).toBe(false);        // 비밀이 다르면 키도 다르다
  });
});

describe('encode / parse', () => {
  test('왕복: 동작·ID·서명이 그대로 돌아온다', () => {
    for (const action of ['a', 'r', 't'] as const) {
      const data = encodeCallbackData(KEY, action, 17546, 1_121_925);
      expect(data.startsWith(`${CALLBACK_PREFIX}:${action}:17546:`)).toBe(true);
      expect(parseCallbackData(data)).toMatchObject({ action, signalId: 17546 });
    }
  });

  test('🔴 텔레그램 callback_data 한도(64바이트)를 넘지 않는다 — 가장 큰 ID 에서도', () => {
    expect(Buffer.byteLength(encodeCallbackData(KEY, 'a', 999_999_999_999, 1_000_000_000))).toBeLessThanOrEqual(64);
    expect(Buffer.byteLength(encodeCallbackData(KEY, 'a', 1, 1))).toBeLessThanOrEqual(64);
  });

  test('범위 밖·비정수 ID 는 만들지 않는다', () => {
    for (const bad of [-1, 1.5, NaN, Infinity, 1e13]) {
      expect(() => encodeCallbackData(KEY, 'a', bad, 1)).toThrow();
    }
  });

  test('🔴 우리 형식이 아닌 값은 전부 null — 다른 프로젝트의 콜백을 건드리지 않는다', () => {
    const good = encodeCallbackData(KEY, 'a', 5, 100);
    const bad: unknown[] = [
      undefined, null, 42, {}, '', 'hello', 'si2:a:5:' + good.split(':')[3], 'x' + good,
      good + 'x', good.slice(0, -1), good.replace(':a:', ':x:'), good.replace(':5:', ':-5:'), good.replace(':5:', ':5.5:'),
      good.replace(':5:', ':1234567890123:'), good.toUpperCase(), ` ${good}`, 'tradinginvest:approve:5',
    ];
    for (const b of bad) expect(parseCallbackData(b)).toBeNull();
  });
});

describe('verifyCallbackData — 서명은 지금 금액에 묶인다', () => {
  test('같은 금액이면 통과', () => {
    const p = parseCallbackData(encodeCallbackData(KEY, 'a', 9, 700_000))!;
    expect(verifyCallbackData(KEY, p, 700_000)).toBe(true);
  });

  test('🔴 금액이 달라지면(시그널이 바뀌면) 실패', () => {
    const p = parseCallbackData(encodeCallbackData(KEY, 'a', 9, 700_000))!;
    expect(verifyCallbackData(KEY, p, 700_001)).toBe(false);
    expect(verifyCallbackData(KEY, p, 0)).toBe(false);
  });

  test('🔴 동작을 바꿔치기하면 실패 (승인 서명으로 거절을, 거절 서명으로 승인을 못 한다)', () => {
    const approve = parseCallbackData(encodeCallbackData(KEY, 'a', 9, 100))!;
    const reject = parseCallbackData(encodeCallbackData(KEY, 'r', 9, 100))!;
    expect(verifyCallbackData(KEY, { ...approve, action: 'r' }, 100)).toBe(false);
    expect(verifyCallbackData(KEY, { ...reject, action: 'a' }, 100)).toBe(false);
  });

  test('🔴 다른 시그널 ID 에 재사용하면 실패', () => {
    const p = parseCallbackData(encodeCallbackData(KEY, 'a', 9, 100))!;
    expect(verifyCallbackData(KEY, { ...p, signalId: 10 }, 100)).toBe(false);
  });

  test('🔴 다른 키(= 서명 비밀을 모르는 쪽)가 만든 값은 실패', () => {
    const other = deriveApprovalKey('another-secret-another-secret-123456')!;
    const p = parseCallbackData(encodeCallbackData(other, 'a', 9, 100))!;
    expect(verifyCallbackData(KEY, p, 100)).toBe(false);
  });

  test('임의의 16hex 를 찍어도 통과하지 못한다', () => {
    const p = parseCallbackData(encodeCallbackData(KEY, 'a', 9, 100))!;
    for (const sig of ['0000000000000000', 'ffffffffffffffff', 'abcdef0123456789']) {
      expect(verifyCallbackData(KEY, { ...p, sig }, 100)).toBe(false);
    }
  });

  test('자가 점검(t)은 ID 0·금액 0 에 묶인다', () => {
    const p = parseCallbackData(encodeCallbackData(KEY, 't', 0, 0))!;
    expect(verifyCallbackData(KEY, p, 0)).toBe(true);
    expect(verifyCallbackData(KEY, p, 1)).toBe(false);
  });

  test('금액이 NaN·Infinity 여도 예외 없이 0 으로 취급된다 (검증이 죽지 않는다)', () => {
    const p = parseCallbackData(encodeCallbackData(KEY, 'a', 9, NaN))!;
    expect(() => verifyCallbackData(KEY, p, NaN)).not.toThrow();
    expect(verifyCallbackData(KEY, p, 0)).toBe(true);     // NaN → 0 으로 정규화됨 (서명과 검증이 같은 규칙)
  });
});
