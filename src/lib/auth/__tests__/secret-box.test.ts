/**
 * KIS 자격증명 AES-256-GCM 암복호화 왕복 테스트 (T-008 §테스트 전략 단계 1).
 */
import { randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret, isEncryptionConfigured } from '../secret-box';

const ORIG = process.env.CREDENTIALS_ENCRYPTION_KEY;
const KEY_A = randomBytes(32).toString('base64');
const KEY_B = randomBytes(32).toString('base64');

beforeEach(() => { process.env.CREDENTIALS_ENCRYPTION_KEY = KEY_A; });
afterAll(() => {
  if (ORIG === undefined) delete process.env.CREDENTIALS_ENCRYPTION_KEY;
  else process.env.CREDENTIALS_ENCRYPTION_KEY = ORIG;
});

describe('encryptSecret / decryptSecret', () => {
  test('왕복', () => {
    const plain = 'PS4xAbCdEfGh-app-key-0123456789';
    expect(decryptSecret(encryptSecret(plain))).toBe(plain);
  });

  test('한글·긴 문자열도 왕복', () => {
    const plain = '한국투자증권-비밀키-'.repeat(20);
    expect(decryptSecret(encryptSecret(plain))).toBe(plain);
  });

  test('포맷은 gcm1.<iv>.<tag>.<ct> 이고 평문이 그대로 담기지 않는다', () => {
    const plain = 'super-secret-value';
    const blob = encryptSecret(plain);
    const parts = blob.split('.');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('gcm1');
    expect(blob).not.toContain(plain);
  });

  test('같은 평문도 IV 가 달라 암호문이 매번 다르다', () => {
    const a = encryptSecret('same');
    const b = encryptSecret('same');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe('same');
    expect(decryptSecret(b)).toBe('same');
  });

  test('암호문 변조는 인증 태그에서 거부된다', () => {
    const blob = encryptSecret('tamper-me-please');
    const parts = blob.split('.');
    const ct = Buffer.from(parts[3], 'base64');
    ct[0] ^= 0xff;
    parts[3] = ct.toString('base64');
    expect(() => decryptSecret(parts.join('.'))).toThrow();
  });

  test('다른 키로는 복호화되지 않는다 (키 분실 = 재입력 필요)', () => {
    const blob = encryptSecret('key-rotation-test');
    process.env.CREDENTIALS_ENCRYPTION_KEY = KEY_B;
    expect(() => decryptSecret(blob)).toThrow();
  });

  test('포맷 오류는 예외', () => {
    for (const bad of ['', 'garbage', 'gcm1.a.b', 'v1.a.b.c', 'gcm1.a.b.c.d']) {
      expect(() => decryptSecret(bad)).toThrow();
    }
  });
});

describe('키 검증', () => {
  test('미설정이면 사용 불가로 보고하고 암호화도 실패', () => {
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    expect(isEncryptionConfigured()).toBe(false);
    expect(() => encryptSecret('x')).toThrow(/CREDENTIALS_ENCRYPTION_KEY/);
  });

  test('32바이트가 아니면 거부', () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(16).toString('base64');
    expect(isEncryptionConfigured()).toBe(false);
    expect(() => encryptSecret('x')).toThrow(/32바이트/);
  });

  test('정상 키면 사용 가능', () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = KEY_A;
    expect(isEncryptionConfigured()).toBe(true);
  });

  test('예외 메시지에 키 값이 담기지 않는다', () => {
    const key = randomBytes(16).toString('base64');
    process.env.CREDENTIALS_ENCRYPTION_KEY = key;
    try {
      encryptSecret('x');
      throw new Error('should have thrown');
    } catch (e) {
      expect(String((e as Error).message)).not.toContain(key);
    }
  });
});
