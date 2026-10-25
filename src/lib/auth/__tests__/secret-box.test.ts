/**
 * KIS 자격증명 AES-256-GCM 암복호화 왕복 테스트 (T-008 §테스트 전략 단계 1).
 */
import { createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret, fingerprintSecret, isEncryptionConfigured } from '../secret-box';

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

// ── T-087 (T-081 WP-D1a) 계좌 지문 — 서버 비밀 HMAC(HKDF 파생 키). 계좌 값은 전부 합성 ──
describe('fingerprintSecret (T-087)', () => {
  const ID = '00000000-01';   // 합성 계좌 식별 문자열
  /** 독립 재계산 — 설계 §2.3: HKDF-SHA256(key, salt 없음, info 'broker-ledger/account-fp', 32B) → HMAC-SHA256 → 앞 16 hex */
  const expected = (b64: string, input: string) => {
    const k = Buffer.from(hkdfSync('sha256', Buffer.from(b64, 'base64'), Buffer.alloc(0), 'broker-ledger/account-fp', 32));
    return createHmac('sha256', k).update(input, 'utf8').digest('hex').slice(0, 16);
  };

  test('형식: 16자리 소문자 hex', () => {
    expect(fingerprintSecret(ID)).toMatch(/^[0-9a-f]{16}$/);
  });

  test('결정적 — 같은 키·같은 입력이면 같은 값, 독립 재계산과 일치(라벨·길이 고정)', () => {
    expect(fingerprintSecret(ID)).toBe(fingerprintSecret(ID));
    expect(fingerprintSecret(ID)).toBe(expected(KEY_A, ID));
    const fixed = Buffer.alloc(32, 7).toString('base64');
    process.env.CREDENTIALS_ENCRYPTION_KEY = fixed;
    expect(fingerprintSecret(ID)).toBe(expected(fixed, ID));
  });

  test('키가 다르면 다른 값 · 입력이 다르면 다른 값', () => {
    const a = fingerprintSecret(ID);
    expect(fingerprintSecret('00000001-01')).not.toBe(a);
    expect(fingerprintSecret('00000000-22')).not.toBe(a);
    process.env.CREDENTIALS_ENCRYPTION_KEY = KEY_B;
    expect(fingerprintSecret(ID)).not.toBe(a);
  });

  test('솔트 없는 sha256 앞 16자와 다르다(HMAC — 키 없이 역산 불가, M-D)', () => {
    const { createHash } = jest.requireActual('node:crypto') as typeof import('node:crypto');
    expect(fingerprintSecret(ID)).not.toBe(createHash('sha256').update(ID).digest('hex').slice(0, 16));
  });

  test('파생 키를 쓴다 — 원 키로 바로 HMAC 한 값과 다르다(용도 분리)', () => {
    const raw = createHmac('sha256', Buffer.from(KEY_A, 'base64')).update(ID).digest('hex').slice(0, 16);
    expect(fingerprintSecret(ID)).not.toBe(raw);
  });

  test('🔴 키 없음·길이 오류 → null(fail-closed), 던지지 않는다', () => {
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    expect(fingerprintSecret(ID)).toBeNull();
    process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(16).toString('base64');
    expect(fingerprintSecret(ID)).toBeNull();
    process.env.CREDENTIALS_ENCRYPTION_KEY = '   ';
    expect(fingerprintSecret(ID)).toBeNull();
  });

  test('빈 입력·문자열 아님 → TypeError, 메시지에 입력·키 없음', () => {
    expect(() => fingerprintSecret('')).toThrow(TypeError);
    expect(() => fingerprintSecret(undefined as unknown as string)).toThrow(TypeError);
    try { fingerprintSecret(''); } catch (e) { expect(String((e as Error).message)).not.toContain(KEY_A); }
  });

  test('기존 함수 동작 불변 — 지문 계산 뒤에도 암복호화 왕복·키 판정 그대로', () => {
    fingerprintSecret(ID);
    expect(decryptSecret(encryptSecret('still-works'))).toBe('still-works');
    expect(isEncryptionConfigured()).toBe(true);
  });
});
