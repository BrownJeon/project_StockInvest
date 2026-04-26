import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';

/**
 * Credential helper — DB(`system_config.cred_<KEY>`) > .env > '' 우선순위로 조회.
 * 마스킹은 GET API에서만 적용. 실제 호출 시엔 평문 그대로 사용.
 *
 * 캐시 TTL 60초 (cluster worker별 in-memory). POST 직후 invalidateCredentialsCache() 호출.
 */
const CACHE = new Map<string, { value: string; ts: number }>();
const TTL_MS = 60_000;

async function readSystemConfig(key: string): Promise<string | null> {
  try {
    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & { value: string })[]>(
      'SELECT value FROM system_config WHERE `key` = ? LIMIT 1',
      [key],
    );
    if (rows.length === 0) return null;
    const raw = rows[0].value;
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === 'string' ? parsed : String(parsed);
    } catch {
      return raw;
    }
  } catch {
    return null;
  }
}

export async function getCredential(envKey: string): Promise<string> {
  const cacheHit = CACHE.get(envKey);
  if (cacheHit && Date.now() - cacheHit.ts < TTL_MS) return cacheHit.value;

  const dbVal = await readSystemConfig(`cred_${envKey}`);
  const value = (dbVal ?? process.env[envKey] ?? '').toString();
  CACHE.set(envKey, { value, ts: Date.now() });
  return value;
}

/** sync 버전 — 캐시된 값만 반환. 처음엔 .env fallback (DB 미적용 가능성 있음). 동기 path 호환용. */
export function getCredentialSync(envKey: string): string {
  const cacheHit = CACHE.get(envKey);
  if (cacheHit) return cacheHit.value;
  return (process.env[envKey] ?? '').toString();
}

/** POST 직후 호출 — 다음 호출 시 DB 재조회 강제. */
export function invalidateCredentialsCache(envKey?: string): void {
  if (envKey) CACHE.delete(envKey);
  else CACHE.clear();
}

/** UI 표시용 마스킹: 앞 4 + ... + 뒤 4. 짧은 값은 *로 처리. 빈 값은 빈 문자열. */
export function maskCredential(value: string): string {
  if (!value) return '';
  const v = value.toString();
  if (v.length <= 8) return '*'.repeat(v.length);
  return `${v.slice(0, 4)}${'*'.repeat(Math.min(8, v.length - 8))}${v.slice(-4)}`;
}

export interface CredentialState {
  /** 현재 활성 마스킹 값 (DB 또는 env에서 도출) */
  masked: string;
  /** 활성 값이 있는지 (DB 또는 env 어디든) */
  set: boolean;
  /** 출처: 'db' (UI 저장값) 또는 'env' (.env 초기값) 또는 'none' */
  source: 'db' | 'env' | 'none';
  /** UI 표시용 — DB에 저장된 값이 있는지 (등록/수정 버튼 토글에 사용). env만 있으면 false */
  dbSet: boolean;
  /** DB 저장값의 마스킹 (없으면 빈 문자열) */
  dbMasked: string;
}

export async function getCredentialState(envKey: string): Promise<CredentialState> {
  const dbVal = await readSystemConfig(`cred_${envKey}`);
  const envVal = process.env[envKey] ?? '';
  const active = dbVal ?? envVal;
  const source: 'db' | 'env' | 'none' = dbVal ? 'db' : envVal ? 'env' : 'none';
  return {
    masked: maskCredential(active),
    set: !!active,
    source,
    dbSet: !!dbVal,
    dbMasked: dbVal ? maskCredential(dbVal) : '',
  };
}

/** 평문 그대로 system_config 에 저장 (사용자 요구 사항: 평문 저장). */
export async function setCredential(envKey: string, value: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    'INSERT INTO system_config (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
    [`cred_${envKey}`, JSON.stringify(value)],
  );
  invalidateCredentialsCache(envKey);
}

export async function deleteCredentialOverride(envKey: string): Promise<void> {
  const pool = getPool();
  await pool.query('DELETE FROM system_config WHERE `key` = ?', [`cred_${envKey}`]);
  invalidateCredentialsCache(envKey);
}
