/**
 * 회원 저장소 — `users` / `user_settings` (T-008 Step 1, 2026-08-07).
 *
 * 스키마는 `src/lib/db.ts` 의 부팅 idempotent DDL 이 유일한 출처다 (운영 DB 수동 DDL 금지).
 *
 * ⚠️ 이 단계에서 매매 엔진은 여전히 전역 `.env` 계좌로 동작한다. 여기 저장되는
 *    KIS 자격증명·`user_settings` 는 **아직 어떤 실행 경로에도 배선되지 않았다**(Step 2·4).
 *    화면 문구가 이 사실을 감추지 않도록 API 응답에 `engineWired: false` 를 함께 싣는다.
 */
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getPool } from '@/lib/db';

// ─── 이메일 정규화 ───────────────────────────────────────────────────────────

/** 로그인·가입·시도제한이 모두 같은 키를 쓰도록 하나의 정규화 함수를 공유한다. */
export function normalizeEmail(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

/**
 * 실용 수준의 이메일 형식 검사. RFC 완전 준수를 목표로 하지 않는다
 * (완전한 정규식은 오히려 정상 주소를 막는 사례가 많다).
 */
export function isValidEmail(email: string): boolean {
  if (email.length === 0 || email.length > 255) return false;
  if (/\s/.test(email)) return false;
  return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(email);
}

/** 알림·로그용 마스킹 — 회원 이메일 전체를 알림 채널에 남기지 않는다. */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at);
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}${'*'.repeat(Math.max(1, local.length - head.length))}${domain}`;
}

// ─── 회원별 안전장치 설정 ────────────────────────────────────────────────────

export const USER_SETTING_KEYS = ['dry_run', 'kill_switch', 'order_max_pct', 'daily_order_max_pct'] as const;
export type UserSettingKey = (typeof USER_SETTING_KEYS)[number];

export interface UserSettings {
  dryRun: boolean;
  killSwitch: boolean;
  orderMaxPct: number;
  dailyOrderMaxPct: number;
}

/**
 * 가입 시 시드하는 기본값 (설계문서 §user_settings).
 * `dry_run=true` — 이 프로젝트의 "DRY_RUN → 소액 실매매 → 자동화" 단계적 도입 원칙을
 * 회원별로도 그대로 적용한다. 회원이 명시적으로 끄기 전엔 실주문이 나가지 않는다.
 */
export const DEFAULT_USER_SETTINGS: UserSettings = {
  dryRun: true,
  killSwitch: false,
  orderMaxPct: 5,
  dailyOrderMaxPct: 10,
};

const SETTING_FIELD_BY_KEY: Record<UserSettingKey, keyof UserSettings> = {
  dry_run: 'dryRun',
  kill_switch: 'killSwitch',
  order_max_pct: 'orderMaxPct',
  daily_order_max_pct: 'dailyOrderMaxPct',
};

export const SETTING_KEY_BY_FIELD: Record<keyof UserSettings, UserSettingKey> = {
  dryRun: 'dry_run',
  killSwitch: 'kill_switch',
  orderMaxPct: 'order_max_pct',
  dailyOrderMaxPct: 'daily_order_max_pct',
};

/** 시드 시 INSERT 할 (key, value) 쌍. value 는 system_config 과 동일한 JSON 문자열 규약. */
export function defaultSettingRows(): [UserSettingKey, string][] {
  return USER_SETTING_KEYS.map((key) => {
    const field = SETTING_FIELD_BY_KEY[key];
    return [key, JSON.stringify(DEFAULT_USER_SETTINGS[field])] as [UserSettingKey, string];
  });
}

/**
 * user_settings 행 → UserSettings (순수 함수 — 테스트 대상).
 *
 * fail-safe: 값이 없거나 파싱 불가면
 *   - dry_run    → true  (모의 매매 = 주문 미송신 쪽이 안전)
 *   - kill_switch→ false (엔진 미배선 단계이므로 표시용 기본값)
 *   - 한도 pct   → 0     (order-limits.ts 의 "미설정 = 거부" 원칙과 동일 방향)
 * 가입 시 4개 키를 모두 시드하므로 정상 경로에서는 결손이 발생하지 않는다.
 */
export function parseUserSettings(rows: { key: string; value: string }[]): {
  settings: UserSettings;
  missingKeys: UserSettingKey[];
} {
  const found = new Map<string, unknown>();
  for (const r of rows) {
    try {
      found.set(r.key, JSON.parse(r.value));
    } catch {
      /* 손상된 값은 결손으로 취급 */
    }
  }
  const missingKeys: UserSettingKey[] = [];
  const settings: UserSettings = { dryRun: true, killSwitch: false, orderMaxPct: 0, dailyOrderMaxPct: 0 };

  for (const key of USER_SETTING_KEYS) {
    const field = SETTING_FIELD_BY_KEY[key];
    const raw = found.get(key);
    if (raw === undefined || raw === null) {
      missingKeys.push(key);
      continue;
    }
    if (field === 'dryRun' || field === 'killSwitch') {
      if (typeof raw !== 'boolean') { missingKeys.push(key); continue; }
      settings[field] = raw;
    } else {
      // 불리언·객체를 Number() 로 강제 변환하면 true→1 처럼 조용히 말이 되는 값이 나온다.
      // 숫자이거나 숫자 문자열일 때만 받아들이고, 나머지는 결손으로 보고해 복구시킨다.
      const n = typeof raw === 'number' ? raw
        : typeof raw === 'string' && raw.trim().length > 0 ? Number(raw)
        : NaN;
      if (!Number.isFinite(n)) { missingKeys.push(key); continue; }
      settings[field] = n;
    }
  }
  return { settings, missingKeys };
}

/** 한도 %(0~100) 검증. UI·API 공통. */
export function validatePct(raw: unknown): { ok: true; value: number } | { ok: false; error: string } {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return { ok: false, error: '숫자를 입력하세요' };
  if (n < 0 || n > 100) return { ok: false, error: '0 이상 100 이하로 입력하세요' };
  return { ok: true, value: n };
}

// ─── users 테이블 ────────────────────────────────────────────────────────────

export interface UserRecord {
  id: number;
  email: string;
  passwordHash: string;
  kisAppKeyEnc: string | null;
  kisAppSecretEnc: string | null;
  kisAccountNoEnc: string | null;
  kisAccountProduct: string;
  kisMock: boolean;
  kisConnectedAt: Date | null;
  createdAt: Date | null;
}

interface UserRow extends RowDataPacket {
  id: number;
  email: string;
  password_hash: string;
  kis_app_key_enc: string | null;
  kis_app_secret_enc: string | null;
  kis_account_no_enc: string | null;
  kis_account_product: string;
  kis_mock: number;
  kis_connected_at: Date | null;
  created_at: Date | null;
}

const USER_COLUMNS =
  'id, email, password_hash, kis_app_key_enc, kis_app_secret_enc, kis_account_no_enc, ' +
  'kis_account_product, kis_mock, kis_connected_at, created_at';

function toRecord(row: UserRow): UserRecord {
  return {
    id: Number(row.id),
    email: String(row.email),
    passwordHash: String(row.password_hash),
    kisAppKeyEnc: row.kis_app_key_enc,
    kisAppSecretEnc: row.kis_app_secret_enc,
    kisAccountNoEnc: row.kis_account_no_enc,
    kisAccountProduct: String(row.kis_account_product ?? '01'),
    kisMock: Number(row.kis_mock) === 1,
    kisConnectedAt: row.kis_connected_at,
    createdAt: row.created_at,
  };
}

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const [rows] = await getPool().query<UserRow[]>(
    `SELECT ${USER_COLUMNS} FROM users WHERE email = ? LIMIT 1`,
    [email],
  );
  return rows.length > 0 ? toRecord(rows[0]) : null;
}

export async function findUserById(id: number): Promise<UserRecord | null> {
  const [rows] = await getPool().query<UserRow[]>(
    `SELECT ${USER_COLUMNS} FROM users WHERE id = ? LIMIT 1`,
    [id],
  );
  return rows.length > 0 ? toRecord(rows[0]) : null;
}

/** 이메일 중복(UNIQUE 위반) 판정. */
export function isDuplicateEmailError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'ER_DUP_ENTRY';
}

/**
 * 회원 생성 + `user_settings` 4개 키 시드를 **하나의 트랜잭션**으로 처리한다.
 * 설계문서 §user_settings: "미시드 상태를 절대 만들지 않는다".
 * 중간 실패로 설정 없는 회원이 생기면 이후 한도 조회가 0(거부)으로 떨어진다.
 */
export async function createUser(email: string, passwordHash: string): Promise<number> {
  const conn: PoolConnection = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const [res] = await conn.query<ResultSetHeader>(
      'INSERT INTO users (email, password_hash) VALUES (?, ?)',
      [email, passwordHash],
    );
    const userId = Number(res.insertId);
    for (const [key, value] of defaultSettingRows()) {
      await conn.query(
        'INSERT INTO user_settings (user_id, `key`, value) VALUES (?, ?, ?)',
        [userId, key, value],
      );
    }
    await conn.commit();
    return userId;
  } catch (e) {
    await conn.rollback().catch(() => { /* 롤백 실패는 원 예외를 가리지 않는다 */ });
    throw e;
  } finally {
    conn.release();
  }
}

export async function updatePasswordHash(userId: number, passwordHash: string): Promise<void> {
  await getPool().query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, userId]);
}

export interface KisCredentialUpdate {
  appKeyEnc: string;
  appSecretEnc: string;
  accountNoEnc: string;
  accountProduct: string;
  mock: boolean;
  accessToken: string | null;
  accessTokenExpiresAt: Date | null;
}

/**
 * KIS 자격증명 저장. **호출 전에 실제 토큰 발급 검증을 통과한 값만** 넘긴다
 * (검증 우회 경로를 만들지 않기 위해 이 함수는 검증을 신뢰하고 저장만 한다).
 * 인자는 전부 **암호문**이다 — 평문을 받지 않는다.
 */
export async function saveKisCredentials(userId: number, u: KisCredentialUpdate): Promise<void> {
  await getPool().query(
    `UPDATE users
        SET kis_app_key_enc = ?, kis_app_secret_enc = ?, kis_account_no_enc = ?,
            kis_account_product = ?, kis_mock = ?, kis_connected_at = NOW(),
            kis_access_token = ?, kis_access_token_expires_at = ?
      WHERE id = ?`,
    [
      u.appKeyEnc, u.appSecretEnc, u.accountNoEnc,
      u.accountProduct, u.mock ? 1 : 0,
      u.accessToken, u.accessTokenExpiresAt,
      userId,
    ],
  );
}

// ─── user_settings ───────────────────────────────────────────────────────────

interface SettingRow extends RowDataPacket {
  key: string;
  value: string;
}

/**
 * 회원 설정 조회. 결손 키가 있으면 기본값으로 **자동 시드 후 재조회**한다.
 *
 * 복구 SQL 은 `INSERT ... ON DUPLICATE KEY UPDATE value = VALUES(value)` 다.
 * 겉보기와 달리 사용자 값을 덮어쓰지 않는다 — 이 UPSERT 는 `parseUserSettings` 가
 * **결손(행 없음) 또는 파싱 불가(손상)** 로 판정한 키에 대해서만 실행되기 때문이다.
 * 정상적으로 읽힌 값은 애초에 루프에 들어오지 않는다.
 * (행이 없으면 INSERT, 행은 있는데 값이 손상됐으면 UPDATE 로 복구 — INSERT IGNORE 로는
 *  후자를 고칠 수 없어서 ON DUPLICATE KEY UPDATE 를 쓴다.)
 */
export async function getUserSettings(userId: number): Promise<UserSettings> {
  const pool = getPool();
  const [rows] = await pool.query<SettingRow[]>(
    'SELECT `key`, value FROM user_settings WHERE user_id = ?',
    [userId],
  );
  const parsed = parseUserSettings(rows.map((r) => ({ key: String(r.key), value: String(r.value) })));
  if (parsed.missingKeys.length === 0) return parsed.settings;

  for (const [key, value] of defaultSettingRows()) {
    // 결손(행 없음) 또는 파싱 불가(손상)로 판정된 키만 복구한다.
    // 정상적으로 읽힌 사용자 값은 이 루프에 들어오지 않으므로 덮어쓰기가 아니다.
    if (!parsed.missingKeys.includes(key)) continue;
    await pool.query(
      'INSERT INTO user_settings (user_id, `key`, value) VALUES (?, ?, ?) ' +
      'ON DUPLICATE KEY UPDATE value = VALUES(value)',
      [userId, key, value],
    );
  }
  const [again] = await pool.query<SettingRow[]>(
    'SELECT `key`, value FROM user_settings WHERE user_id = ?',
    [userId],
  );
  return parseUserSettings(again.map((r) => ({ key: String(r.key), value: String(r.value) }))).settings;
}

/** 회원 설정 부분 저장. 전달된 필드만 UPSERT 한다. */
export async function saveUserSettings(userId: number, patch: Partial<UserSettings>): Promise<void> {
  const pool = getPool();
  for (const [field, value] of Object.entries(patch) as [keyof UserSettings, unknown][]) {
    const key = SETTING_KEY_BY_FIELD[field];
    if (!key || value === undefined) continue;
    await pool.query(
      'INSERT INTO user_settings (user_id, `key`, value) VALUES (?, ?, ?) ' +
      'ON DUPLICATE KEY UPDATE value = VALUES(value)',
      [userId, key, JSON.stringify(value)],
    );
  }
}
