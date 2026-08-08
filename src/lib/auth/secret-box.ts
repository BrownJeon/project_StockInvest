/**
 * KIS 자격증명 암호화 — AES-256-GCM (T-008, 2026-08-07).
 *
 * 키: env `CREDENTIALS_ENCRYPTION_KEY` (32바이트, base64).
 * ⚠️ 이 키를 분실하면 저장된 전 회원 KIS 키는 **복호화 불가** — 전원 재입력이 필요하다
 *    (설계문서 §열린 리스크). 키 로테이션 절차는 범위 밖.
 *
 * 저장 포맷: `gcm1.<ivB64>.<tagB64>.<ciphertextB64>`
 *   - IV 12바이트 랜덤 (GCM 표준 길이, 매 암호화마다 새로 생성)
 *   - 인증 태그 16바이트 — 변조된 암호문은 복호화 단계에서 예외로 거부된다
 *
 * 이 모듈은 **평문을 절대 로그에 남기지 않는다.** 예외 메시지에도 평문·키를 넣지 않는다.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const FORMAT_TAG = 'gcm1';
const IV_BYTES = 12;
const KEY_BYTES = 32;

/** 키 미설정·형식 오류 시 던지는 오류. 값은 절대 담지 않는다. */
export class EncryptionKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncryptionKeyError';
  }
}

function readKey(): Buffer {
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new EncryptionKeyError('CREDENTIALS_ENCRYPTION_KEY 미설정 — 서버 .env 에 32바이트 base64 키를 설정하고 재시작하세요');
  }
  let key: Buffer;
  try {
    key = Buffer.from(raw.trim(), 'base64');
  } catch {
    throw new EncryptionKeyError('CREDENTIALS_ENCRYPTION_KEY 형식 오류 — base64 로 디코딩되지 않습니다');
  }
  if (key.length !== KEY_BYTES) {
    throw new EncryptionKeyError(`CREDENTIALS_ENCRYPTION_KEY 길이 오류 — 디코딩 결과가 ${KEY_BYTES}바이트여야 합니다`);
  }
  return key;
}

/** 키가 사용 가능한 상태인지 (값은 노출하지 않는다). 라우트의 사전 점검용. */
export function isEncryptionConfigured(): boolean {
  try {
    readKey();
    return true;
  } catch {
    return false;
  }
}

/** 평문 → `gcm1.<iv>.<tag>.<ct>` */
export function encryptSecret(plain: string): string {
  const key = readKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [FORMAT_TAG, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join('.');
}

/**
 * `gcm1.<iv>.<tag>.<ct>` → 평문.
 * 포맷 오류·태그 불일치(변조·키 교체)는 예외. 호출부는 예외 메시지를 사용자에게
 * 그대로 노출하지 말고 "저장된 키를 읽을 수 없습니다 — 다시 입력하세요"로 안내한다.
 */
export function decryptSecret(blob: string): string {
  const key = readKey();
  const parts = typeof blob === 'string' ? blob.split('.') : [];
  if (parts.length !== 4 || parts[0] !== FORMAT_TAG) {
    throw new Error('암호문 포맷 오류');
  }
  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const ct = Buffer.from(parts[3], 'base64');
  if (iv.length !== IV_BYTES) throw new Error('암호문 포맷 오류');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
