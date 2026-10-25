/**
 * T-084 — `app_release` 테이블 조회 (읽기 전용).
 *
 * 앱은 이 테이블에 쓰지 않는다. 행은 deployer 가 사람 승인 후 INSERT 하고, 롤백은 최신 행 삭제다
 * (`scripts/migrations/T-084-app-release.sql` 머리 주석).
 * 테이블이 없으면(마이그레이션 전, MariaDB 1146 + 메시지에 app_release) `AppReleaseNotMigratedError` 를 던진다.
 * 다른 오류는 그대로 던진다(호출부가 500/404 로 바꾼다).
 * 읽은 행은 형식을 다시 검사한다 — DB CHECK 가 있어도, 형식이 어긋난 행은 '없는 것' 으로 친다(서버 로그만).
 */
import { getPool } from '@/lib/db';
import { isSafeApkFileName } from './paths';
import { MAX_VERSION_CODE, VERSION_NAME_RE, parseVersionCode } from './version';

export interface AppReleaseRow {
  versionCode: number;
  versionName: string;
  apkFile: string;
  sha256: string;
  sizeBytes: number;
  minSupported: number;
  notes: string | null;
  createdAt: Date | null;
}

/** 조회에 필요한 최소 모양(mysql2 Pool 또는 시험용 가짜). */
export interface Queryable {
  query(sql: string, values?: unknown[]): Promise<unknown>;
}

export class AppReleaseNotMigratedError extends Error {
  constructor() {
    super('app_release table missing');
    this.name = 'AppReleaseNotMigratedError';
  }
}

/** 1146 이면서 메시지에 `app_release` 가 있을 때만 — 다른 표가 없으면 마이그레이션 전이 아니라 장애다. */
export function isNoAppReleaseTable(e: unknown): boolean {
  const o = e as { code?: string; errno?: number; message?: string; sqlMessage?: string } | null;
  if (!(o?.code === 'ER_NO_SUCH_TABLE' || o?.errno === 1146)) return false;
  return String(o?.sqlMessage ?? o?.message ?? '').includes('app_release');
}

const SHA256_RE = /^[0-9a-f]{64}$/;

function toNonNegInt(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
  if (typeof raw === 'bigint') return raw >= BigInt(0) && raw <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(raw) : null;
  if (typeof raw === 'string' && /^\d{1,16}$/.test(raw)) {
    const n = Number(raw);
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

/** DB 행 → AppReleaseRow. 형식이 하나라도 어긋나면 null. 순수 함수. */
export function parseReleaseRow(raw: unknown): AppReleaseRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const versionCode = parseVersionCode(r.version_code);
  const versionName = typeof r.version_name === 'string' && VERSION_NAME_RE.test(r.version_name) ? r.version_name : null;
  const apkFile = isSafeApkFileName(r.apk_file) ? r.apk_file : null;
  const sha256 = typeof r.sha256 === 'string' && SHA256_RE.test(r.sha256) ? r.sha256 : null;
  const sizeBytes = toNonNegInt(r.size_bytes);
  const minSupported = toNonNegInt(r.min_supported);
  if (versionCode === null || versionName === null || apkFile === null || sha256 === null) return null;
  if (sizeBytes === null || sizeBytes <= 0) return null;
  if (minSupported === null || minSupported > MAX_VERSION_CODE || minSupported > versionCode) return null;
  const notes = typeof r.notes === 'string' ? r.notes.slice(0, 500) : null;
  const createdAt = r.created_at instanceof Date && !Number.isNaN(r.created_at.getTime()) ? r.created_at : null;
  return { versionCode, versionName, apkFile, sha256, sizeBytes, minSupported, notes, createdAt };
}

const COLUMNS = 'version_code, version_name, apk_file, sha256, size_bytes, min_supported, notes, created_at';

async function selectOne(q: Queryable, sql: string, values: unknown[]): Promise<AppReleaseRow | null> {
  let res: unknown;
  try {
    res = await q.query(sql, values);
  } catch (e) {
    if (isNoAppReleaseTable(e)) throw new AppReleaseNotMigratedError();
    throw e;
  }
  const rows = Array.isArray(res) ? res[0] : null;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const row = parseReleaseRow(rows[0]);
  if (!row) {
    const code = (rows[0] as Record<string, unknown> | undefined)?.version_code;
    console.error(`[app-release] 형식이 어긋난 행 무시 version_code=${String(code).slice(0, 12)}`);
  }
  return row;
}

/** 최신 배포본(version_code 최댓값). 행이 없으면 null. */
export async function getLatestRelease(q: Queryable = getPool()): Promise<AppReleaseRow | null> {
  return selectOne(q, `SELECT ${COLUMNS} FROM app_release ORDER BY version_code DESC LIMIT 1`, []);
}

/** 파일 이름이 정확히 같은 배포본. 이름이 규칙 밖이면 조회하지 않고 null. */
export async function getReleaseByFile(apkFile: string, q: Queryable = getPool()): Promise<AppReleaseRow | null> {
  if (!isSafeApkFileName(apkFile)) return null;
  return selectOne(q, `SELECT ${COLUMNS} FROM app_release WHERE apk_file = ? LIMIT 1`, [apkFile]);
}
