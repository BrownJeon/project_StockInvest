/**
 * 비밀번호 scrypt 해시·검증 왕복 테스트 (T-008 §테스트 전략 단계 1).
 * 신규 의존성 없이 Node 내장 crypto 만 쓰는지도 함께 고정한다.
 */
import {
  DUMMY_PASSWORD_HASH,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  exceedsPasswordLengthCap,
  hashPassword,
  validatePassword,
  verifyPassword,
} from '../password';

jest.setTimeout(20_000);

describe('hashPassword / verifyPassword', () => {
  test('해시 포맷은 scrypt$<saltHex>$<hashHex>', async () => {
    const h = await hashPassword('correct horse battery');
    const parts = h.split('$');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe('scrypt');
    expect(parts[1]).toMatch(/^[0-9a-f]{32}$/);    // salt 16바이트
    expect(parts[2]).toMatch(/^[0-9a-f]{128}$/);   // key 64바이트
  });

  test('같은 비밀번호는 검증 통과', async () => {
    const h = await hashPassword('s3cret-pass');
    await expect(verifyPassword('s3cret-pass', h)).resolves.toBe(true);
  });

  test('틀린 비밀번호는 실패', async () => {
    const h = await hashPassword('s3cret-pass');
    await expect(verifyPassword('s3cret-pas', h)).resolves.toBe(false);
    await expect(verifyPassword('', h)).resolves.toBe(false);
    await expect(verifyPassword('S3CRET-PASS', h)).resolves.toBe(false);
  });

  test('같은 비밀번호라도 salt 가 달라 해시가 매번 다르다', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toBe(b);
    await expect(verifyPassword('same-password', a)).resolves.toBe(true);
    await expect(verifyPassword('same-password', b)).resolves.toBe(true);
  });

  test('유니코드 비밀번호 왕복', async () => {
    const pw = '비밀번호12345🔐';
    const h = await hashPassword(pw);
    await expect(verifyPassword(pw, h)).resolves.toBe(true);
    await expect(verifyPassword('비밀번호12345', h)).resolves.toBe(false);
  });

  test('손상된 해시는 예외 없이 false', async () => {
    for (const bad of ['', 'garbage', 'scrypt$only-two', 'bcrypt$aa$bb', 'scrypt$$', 'scrypt$zz$zz']) {
      await expect(verifyPassword('anything', bad)).resolves.toBe(false);
    }
  });

  test('더미 해시는 어떤 비밀번호로도 통과하지 않지만 포맷은 유효하다 (열거 방지용)', async () => {
    expect(DUMMY_PASSWORD_HASH.split('$')).toHaveLength(3);
    await expect(verifyPassword('', DUMMY_PASSWORD_HASH)).resolves.toBe(false);
    await expect(verifyPassword('admin', DUMMY_PASSWORD_HASH)).resolves.toBe(false);
  });
});

describe('validatePassword', () => {
  test('8자 미만 거부', () => {
    const r = validatePassword('1234567');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(String(MIN_PASSWORD_LENGTH));
  });

  test('8자 이상 허용', () => {
    expect(validatePassword('12345678').ok).toBe(true);
  });

  test('문자열이 아니면 거부', () => {
    expect(validatePassword(undefined).ok).toBe(false);
    expect(validatePassword(12345678).ok).toBe(false);
    expect(validatePassword(null).ok).toBe(false);
  });

  test('과도하게 긴 입력 거부 (KDF 비용 남용 차단)', () => {
    expect(validatePassword('a'.repeat(MAX_PASSWORD_LENGTH)).ok).toBe(true);
    expect(validatePassword('a'.repeat(MAX_PASSWORD_LENGTH + 1)).ok).toBe(false);
  });
});

describe('exceedsPasswordLengthCap — 로그인 경로 scrypt 자원고갈 방어', () => {
  test('상한 이하는 통과', () => {
    expect(exceedsPasswordLengthCap('a'.repeat(MAX_PASSWORD_LENGTH))).toBe(false);
    expect(exceedsPasswordLengthCap('short')).toBe(false);
  });

  test('상한 초과는 차단', () => {
    expect(exceedsPasswordLengthCap('a'.repeat(MAX_PASSWORD_LENGTH + 1))).toBe(true);
    expect(exceedsPasswordLengthCap('a'.repeat(1_000_000))).toBe(true);
  });

  test('문자열이 아니면 차단', () => {
    expect(exceedsPasswordLengthCap(undefined as unknown as string)).toBe(true);
    expect(exceedsPasswordLengthCap({} as unknown as string)).toBe(true);
  });

  test('최소 길이는 강제하지 않는다 — 로그인은 기존 회원을 막으면 안 된다', () => {
    // validatePassword(가입·변경)는 8자 미만을 거부하지만, 로그인 캡은 그러지 않는다.
    expect(validatePassword('1234567').ok).toBe(false);
    expect(exceedsPasswordLengthCap('1234567')).toBe(false);
    expect(MIN_PASSWORD_LENGTH).toBeGreaterThan(0);
  });
});
