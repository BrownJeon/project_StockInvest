/**
 * 비밀번호 해싱 — Node 내장 `crypto.scrypt` 전용 (T-008, 2026-08-07).
 *
 * **신규 npm 의존성 금지**: 이 프로젝트는 SWC 네이티브 바이너리가 공유 마운트에서 깨진
 * 전례가 있어 네이티브 바인딩 패키지(bcrypt·argon2)를 의도적으로 회피한다.
 * scrypt 는 OWASP 가 인정하는 KDF 이고 Node 표준 라이브러리에 있다.
 *
 * 저장 포맷: `scrypt$<saltHex>$<hashHex>`  (설계문서 §인증 계층 지정 포맷)
 *   - salt 16바이트 랜덤, 파생키 64바이트
 *   - 파라미터(N/r/p)는 포맷에 담기지 않는다 — 아래 상수가 유일한 진실이다.
 *     (파라미터를 바꾸려면 전 회원 재설정이 필요하므로 바꾸지 않는다)
 *
 * 검증은 `crypto.timingSafeEqual` — 앞자리부터 비교하는 `===` 는 비교 소요시간으로
 * "몇 바이트까지 맞았는지"가 새어나간다.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';

/** scrypt 작업인자. 메모리 = 128·N·r ≈ 16MB (maxmem 여유 있게 64MB 지정) */
export const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

const SALT_BYTES = 16;
const KEY_BYTES = 64;
const ALGO_TAG = 'scrypt';

/** 비밀번호 최소 길이 (설계문서 §가입 검증) */
export const MIN_PASSWORD_LENGTH = 8;
/**
 * 최대 길이 — scrypt 는 입력 길이에 비례해 비용이 늘지는 않지만, 수 MB짜리 문자열을
 * 그대로 KDF 에 넣게 두면 메모리·전송 비용만 커진다. 상한을 둬 거부한다.
 */
export const MAX_PASSWORD_LENGTH = 200;

function scrypt(password: string, salt: Buffer, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, SCRYPT_PARAMS, (err, derived) => {
      if (err) reject(err);
      else resolve(derived as Buffer);
    });
  });
}

/**
 * 길이 상한 초과 여부만 본다 (로그인 경로 전용).
 *
 * 로그인은 **최소 길이를 강제하면 안 된다** — 정책이 바뀌어도 기존 회원은 로그인할 수 있어야 한다.
 * 반면 상한은 반드시 필요하다: 로그인은 무인증 공개 경로라 여기서만 캡이 빠지면
 * 공격자가 임의 길이 입력으로 scrypt(16MB/회)를 무제한 유발할 수 있다
 * (가입·비밀번호 변경은 `validatePassword` 가 이미 막고 있었다 — T-008 reviewer HIGH).
 */
export function exceedsPasswordLengthCap(password: string): boolean {
  return typeof password !== 'string' || password.length > MAX_PASSWORD_LENGTH;
}

/** 비밀번호 정책 검사. 실패 시 사용자에게 그대로 보여줄 한국어 사유를 돌려준다. */
export function validatePassword(raw: unknown): { ok: true; password: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') return { ok: false, error: '비밀번호를 입력하세요' };
  if (raw.length < MIN_PASSWORD_LENGTH) return { ok: false, error: `비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다` };
  if (raw.length > MAX_PASSWORD_LENGTH) return { ok: false, error: `비밀번호는 ${MAX_PASSWORD_LENGTH}자 이하여야 합니다` };
  return { ok: true, password: raw };
}

/** 비밀번호 → `scrypt$<saltHex>$<hashHex>` */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(password, salt, KEY_BYTES);
  return `${ALGO_TAG}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/**
 * 저장된 해시와 대조. 포맷 오류·알고리즘 불일치는 **false** (throw 하지 않는다 —
 * 로그인 라우트가 예외 유무로 계정 존재 여부를 흘리지 않게 하기 위함).
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = typeof stored === 'string' ? stored.split('$') : [];
  if (parts.length !== 3 || parts[0] !== ALGO_TAG) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[1], 'hex');
    expected = Buffer.from(parts[2], 'hex');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let derived: Buffer;
  try {
    derived = await scrypt(password, salt, expected.length);
  } catch {
    return false;
  }
  // 길이는 expected.length 로 맞춰 파생했으므로 항상 동일 — timingSafeEqual 전제 충족
  return timingSafeEqual(derived, expected);
}

/**
 * 미가입 이메일에도 **동일한 scrypt 비용**을 치르게 하는 더미 해시 (이메일 열거 방지).
 *
 * 로그인 라우트는 계정을 못 찾았을 때 곧바로 401 을 주지 않고 이 값으로 verifyPassword 를
 * 한 번 돌린다. 그렇지 않으면 "가입된 이메일은 응답이 100ms 느리다"는 관측만으로
 * 회원 목록을 열거할 수 있다.
 *
 * 값 자체는 비밀이 아니다 — 어떤 비밀번호로도 통과하지 않는 고정 바이트열이다.
 */
export const DUMMY_PASSWORD_HASH = `${ALGO_TAG}$${'ab'.repeat(SALT_BYTES)}$${'cd'.repeat(KEY_BYTES)}`;
