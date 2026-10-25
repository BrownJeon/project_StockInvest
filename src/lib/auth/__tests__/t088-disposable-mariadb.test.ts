/**
 * T-088 — **일회용 MariaDB 실증 시험** (평소 jest 실행에서는 정적 검사만 돌고 DB 부분은 건너뛴다).
 *
 * 무엇을 실제 DB 로 확인하나(`scripts/migrations/T-088-app-auth-code.sql` + `src/lib/auth/oauth/app-code.ts` 의 실제 SQL 저장소):
 *  A. 적용 전 → 발급이 ER_NO_SUCH_TABLE(isAppAuthCodeNotMigrated) · 2회 적용 멱등 · UNIQUE 1·CHECK 4 · code 열 ascii_bin · 저장된 CHECK 에 백슬래시 없음
 *  B. CHECK 거부 — code 대문자·63자·비hex·공백, user_id 0, expires_at ≤ created_at, 수명 10분 초과, used_at < created_at
 *  C. UNIQUE — 같은 결속값 두 번
 *  D. 실제 흐름 — 발급 → 교환 성공 → 재사용 실패 · 다른 verifier 실패 · **동시 소각 20건 중 정확히 1건만 성공** · 만료(TTL 1초로 발급 후 1.3초) 실패
 *  E. 청소 — 만료 + 1시간 지난 행만 지운다
 *  F. 되돌리기(DROP) → 재적용
 *  전체를 **두 sql_mode 로 반복**한다: 서버 기본, 그리고 세션에 NO_BACKSLASH_ESCAPES 를 더한 모드(마이그레이션도 그 세션에서 적용).
 *  값은 `pool.execute`(서버 측 준비문)로 넣는다 — 클라이언트 쪽 문자열 이스케이프가 NBE 세션에서 값을 바꾸지 않게.
 *
 * 실행(운영·공용 DB 금지 — 127.0.0.1 에만 묶인 일회용 컨테이너, 끝나면 제거):
 *   docker run -d --rm --name t088-mariadb -p 127.0.0.1:33088:3306 -e MARIADB_ROOT_PASSWORD=t088test -e MARIADB_DATABASE=t088 \
 *     mariadb:10.11 --sql-mode=IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION \
 *     --character-set-server=utf8mb3 --collation-server=utf8mb3_general_ci
 *   T088_TEST_DB_PORT=33088 T088_TEST_DB_PASSWORD=t088test node ./node_modules/jest/bin/jest.js src/lib/auth/__tests__/t088-disposable-mariadb.test.ts
 *   docker rm -f t088-mariadb
 * 서버 기본 문자셋은 운영 실측(utf8mb3_general_ci, T-074 기록)과 맞춘다. 값은 전부 합성값이다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import mysql from 'mysql2/promise';

jest.mock('@/lib/db', () => ({ getPool: () => { throw new Error('운영 풀 사용 금지(시험)'); } }));

import {
  APP_AUTH_CODE_SQL,
  bindAppAuthCode,
  consumeAppAuthCode,
  createSqlAppAuthCodeStore,
  isAppAuthCodeNotMigrated,
  issueAppAuthCode,
} from '@/lib/auth/oauth/app-code';
import { pkceChallengeOf } from '@/lib/auth/oauth/pkce';

const PORT = process.env.T088_TEST_DB_PORT;
const maybe = PORT ? describe : describe.skip;
const MIGRATION = path.join(__dirname, '..', '..', '..', '..', 'scripts', 'migrations', 'T-088-app-auth-code.sql');

function statements(sql: string): string[] {
  return sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n').split(';').map((s) => s.trim()).filter(Boolean);
}
function rollbackStatements(sql: string): string[] {
  const tail = sql.slice(sql.indexOf('-- 되돌리기'));
  return tail.split('\n').filter((l) => /^-- DROP /.test(l)).map((l) => l.replace(/^-- /, '').replace(/;\s*$/, ''));
}
function pkce(seed: string) {
  const verifier = createHash('sha256').update(seed).digest('base64url');
  return { verifier, challenge: pkceChallengeOf(verifier) };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('마이그레이션 파일 정적 검사(DB 없이)', () => {
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  test('DDL 문장에 백슬래시가 없다(NO_BACKSLASH_ESCAPES 여부와 무관하게 같은 제약)', () => {
    for (const s of statements(sql)) expect(s).not.toContain('\\');
  });
  test('가산 전용 — CREATE TABLE IF NOT EXISTS 하나와 세션 설정뿐(ALTER·DROP·INSERT·UPDATE·DELETE 문장 없음)', () => {
    const st = statements(sql);
    expect(st).toHaveLength(2);
    expect(st[0]).toBe('SET SESSION lock_wait_timeout = 5');
    expect(st[1].startsWith('CREATE TABLE IF NOT EXISTS app_auth_code (')).toBe(true);
    for (const s of st) expect(s).not.toMatch(/\b(ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE|RENAME)\b/i);
  });
  test('user_id 는 users.id 와 같은 INT UNSIGNED, code 는 ascii_bin CHAR(64), TTL 상한 CHECK 가 있다', () => {
    expect(sql).toMatch(/user_id\s+INT UNSIGNED NOT NULL/);
    expect(sql).toMatch(/code\s+CHAR\(64\)\s+CHARACTER SET ascii COLLATE ascii_bin NOT NULL/);
    expect(sql).toContain('CHECK (expires_at > created_at AND expires_at <= created_at + INTERVAL 10 MINUTE)');
    expect(sql).toContain("CHECK (code REGEXP '^[0-9a-f]{64}$')");
  });
  test('되돌리기 문장은 DROP TABLE IF EXISTS app_auth_code 하나(주석으로만)', () => {
    expect(rollbackStatements(sql)).toEqual(['DROP TABLE IF EXISTS app_auth_code']);
  });
  test('앱 코드의 SQL 은 이 테이블의 열 이름만 쓴다', () => {
    for (const q of Object.values(APP_AUTH_CODE_SQL)) {
      expect(q).toContain('app_auth_code');
      for (const col of q.match(/\b(code|user_id|expires_at|used_at|created_at)\b/g) ?? []) expect(sql).toContain(col);
    }
  });
});

const MODES: Array<[string, boolean]> = [['서버 기본 sql_mode', false], ['NO_BACKSLASH_ESCAPES 세션', true]];

maybe.each(MODES)('T-088 app_auth_code 일회용 MariaDB — %s', (_label, nbe) => {
  let pool: mysql.Pool;
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  const apply = async () => { for (const s of statements(sql)) await pool.query(s); };
  const H = (c: string) => c.repeat(64);
  /** 원시 INSERT — CHECK 시험용. created_at·expires_at 은 SQL 식으로 준다. */
  const rawIns = (code: string, userId: number, createdExpr: string, expiresExpr: string, usedExpr = 'NULL') =>
    pool.execute(`INSERT INTO app_auth_code (code, user_id, created_at, expires_at, used_at) VALUES (?, ?, ${createdExpr}, ${expiresExpr}, ${usedExpr})`, [code, userId]);
  const expectCheck = async (p: Promise<unknown>) => {
    await expect(p).rejects.toMatchObject({ errno: 4025 }); // ER_CONSTRAINT_FAILED
  };

  beforeAll(async () => {
    pool = mysql.createPool({ host: '127.0.0.1', port: Number(PORT), user: 'root', password: process.env.T088_TEST_DB_PASSWORD, database: 't088', connectionLimit: 8, timezone: '+09:00' });
    if (nbe) {
      pool.pool.on('connection', (conn) => { conn.query("SET SESSION sql_mode = CONCAT(@@SESSION.sql_mode, ',NO_BACKSLASH_ESCAPES')"); });
    }
    await pool.query('DROP TABLE IF EXISTS app_auth_code');
  });
  afterAll(async () => { await pool?.end(); });

  test('A0. 세션 sql_mode 가 의도대로다', async () => {
    const [rows] = await pool.query('SELECT @@SESSION.sql_mode AS m') as [Array<{ m: string }>, unknown];
    expect(rows[0].m.split(',').includes('NO_BACKSLASH_ESCAPES')).toBe(nbe);
    expect(rows[0].m.split(',').includes('STRICT_TRANS_TABLES')).toBe(true);
  });

  test('A1. 적용 전 — 발급이 테이블 미적용 오류(isAppAuthCodeNotMigrated)', async () => {
    const store = createSqlAppAuthCodeStore(pool);
    const err = await issueAppAuthCode(1, pkce('a1').challenge, store).catch((e: unknown) => e);
    expect(isAppAuthCodeNotMigrated(err)).toBe(true);
  });

  test('A2. 2회 적용 멱등 · 키·CHECK 개수 · 콜레이션 · 저장된 CHECK 에 백슬래시 없음', async () => {
    await apply();
    const [c1] = await pool.query('SHOW CREATE TABLE app_auth_code') as [Array<Record<string, string>>, unknown];
    await apply();
    const [c2] = await pool.query('SHOW CREATE TABLE app_auth_code') as [Array<Record<string, string>>, unknown];
    const ddl = c2[0]['Create Table'];
    expect(ddl).toBe(c1[0]['Create Table']);
    expect((ddl.match(/UNIQUE KEY/g) ?? []).length).toBe(1);
    expect(ddl).toContain('KEY `idx_app_auth_code_expires`');
    expect((ddl.match(/CONSTRAINT `chk_/g) ?? []).length).toBe(4);
    expect(ddl).toMatch(/COLLATE=utf8mb4_general_ci/);
    const [checks] = await pool.query(
      "SELECT CONSTRAINT_NAME, CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA='t088' AND TABLE_NAME='app_auth_code' ORDER BY CONSTRAINT_NAME",
    ) as [Array<{ CONSTRAINT_NAME: string; CHECK_CLAUSE: string }>, unknown];
    expect(checks.map((c) => c.CONSTRAINT_NAME)).toEqual(['chk_app_auth_code_code', 'chk_app_auth_code_ttl', 'chk_app_auth_code_used', 'chk_app_auth_code_user']);
    for (const c of checks) expect(c.CHECK_CLAUSE).not.toContain('\\');
    const [cols] = await pool.query(
      "SELECT COLUMN_NAME, COLLATION_NAME, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='t088' AND TABLE_NAME='app_auth_code' AND COLUMN_NAME IN ('code','user_id') ORDER BY COLUMN_NAME",
    ) as [Array<{ COLUMN_NAME: string; COLLATION_NAME: string | null; COLUMN_TYPE: string }>, unknown];
    expect(cols).toEqual([
      { COLUMN_NAME: 'code', COLLATION_NAME: 'ascii_bin', COLUMN_TYPE: 'char(64)' },
      { COLUMN_NAME: 'user_id', COLLATION_NAME: null, COLUMN_TYPE: 'int(10) unsigned' },
    ]);
  });

  test('B. CHECK 거부', async () => {
    const now = 'NOW(3)';
    const plus60 = 'NOW(3) + INTERVAL 60 SECOND';
    await expectCheck(rawIns(H('A'), 1, now, plus60));
    await expectCheck(rawIns(H('g'), 1, now, plus60));
    await expectCheck(rawIns('a'.repeat(63) + ' ', 1, now, plus60));
    await expectCheck(rawIns('a'.repeat(63), 1, now, plus60));
    await expectCheck(rawIns(H('a'), 0, now, plus60));
    await expectCheck(rawIns(H('a'), 1, now, now));
    await expectCheck(rawIns(H('a'), 1, now, 'NOW(3) - INTERVAL 1 SECOND'));
    await expectCheck(rawIns(H('a'), 1, now, 'NOW(3) + INTERVAL 601 SECOND'));
    await expectCheck(rawIns(H('a'), 1, now, plus60, 'NOW(3) - INTERVAL 1 SECOND'));
    // 64 hex + 끝 개행(65자): CHAR(64) 는 끝의 공백류를 경고·오류 없이 잘라 저장한다(T-084 R2 관찰과 같음) — 저장되는 값은 정상 형식 64 hex 뿐이라
    // 무해하다(앱은 sha256 hex 만 넣고, 조회는 결속값 정확 일치). 저장값이 형식을 벗어나지 않음을 고정한다.
    await rawIns(H('a') + '\n', 1, now, plus60);
    const [nl] = await pool.query('SELECT code, CHAR_LENGTH(code) AS len FROM app_auth_code') as [Array<{ code: string; len: number }>, unknown];
    expect(nl).toEqual([{ code: H('a'), len: 64 }]);
    await pool.query('DELETE FROM app_auth_code');
    // 경계: 정확히 10분은 허용
    await rawIns(H('b'), 1, now, 'NOW(3) + INTERVAL 600 SECOND');
    const [n] = await pool.query('SELECT COUNT(*) AS n FROM app_auth_code') as [Array<{ n: number }>, unknown];
    expect(Number(n[0].n)).toBe(1);
    await pool.query('DELETE FROM app_auth_code');
  });

  test('C. UNIQUE — 같은 결속값 두 번', async () => {
    const store = createSqlAppAuthCodeStore(pool);
    await store.create({ code: H('c'), userId: 1, ttlSec: 60 });
    await expect(store.create({ code: H('c'), userId: 2, ttlSec: 60 })).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
    await pool.query('DELETE FROM app_auth_code');
  });

  test('D1. 발급 → 교환 성공 → 재사용 실패 · 다른 verifier 실패 · DB 에는 결속값만', async () => {
    const store = createSqlAppAuthCodeStore(pool);
    const me = pkce(`d1-${nbe}`);
    const thief = pkce(`thief-${nbe}`);
    const codeR = await issueAppAuthCode(42, me.challenge, store);
    const [rows] = await pool.query('SELECT code, user_id, used_at, TIMESTAMPDIFF(MICROSECOND, created_at, expires_at) AS ttl_us FROM app_auth_code') as [Array<{ code: string; user_id: number; used_at: Date | null; ttl_us: number }>, unknown];
    expect(rows).toHaveLength(1);
    expect(rows[0].code).toBe(bindAppAuthCode(codeR, me.challenge));
    expect(rows[0].code).not.toBe(codeR);
    expect(Number(rows[0].ttl_us)).toBe(60_000_000);
    expect(rows[0].used_at).toBeNull();
    expect(await consumeAppAuthCode(codeR, thief.verifier, store)).toBeNull();
    expect(await consumeAppAuthCode(codeR, me.verifier, store)).toBe(42);
    expect(await consumeAppAuthCode(codeR, me.verifier, store)).toBeNull();
    const [after] = await pool.query('SELECT used_at FROM app_auth_code') as [Array<{ used_at: Date | null }>, unknown];
    expect(after[0].used_at).not.toBeNull();
    await pool.query('DELETE FROM app_auth_code');
  });

  test('D2. 동시 소각 — 같은 코드로 20건을 한꺼번에 보내도 정확히 1건만 성공', async () => {
    const store = createSqlAppAuthCodeStore(pool);
    const me = pkce(`d2-${nbe}`);
    const codeR = await issueAppAuthCode(7, me.challenge, store);
    const results = await Promise.all(Array.from({ length: 20 }, () => consumeAppAuthCode(codeR, me.verifier, store)));
    expect(results.filter((r) => r === 7)).toHaveLength(1);
    expect(results.filter((r) => r === null)).toHaveLength(19);
    // 저장소 수준에서도: 이미 소각된 행에 대한 burn 은 0
    expect(await store.burn(bindAppAuthCode(codeR, me.challenge))).toBe(0);
    await pool.query('DELETE FROM app_auth_code');
  });

  test('D3. 만료 — TTL 1초로 넣고 1.3초 뒤 교환 실패, 만료 전 교환은 성공', async () => {
    const store = createSqlAppAuthCodeStore(pool);
    const a = pkce(`d3a-${nbe}`);
    const b = pkce(`d3b-${nbe}`);
    // 앱 코드와 같은 INSERT 문장을 TTL 1초로 직접 실행(앱 상수 60초는 D1 이 확인)
    const ca = 'a'.repeat(64);
    const cb = 'b'.repeat(64);
    await pool.execute(APP_AUTH_CODE_SQL.insert, [bindAppAuthCode(ca, a.challenge), 1, 1]);
    await pool.execute(APP_AUTH_CODE_SQL.insert, [bindAppAuthCode(cb, b.challenge), 1, 1]);
    expect(await consumeAppAuthCode(ca, a.verifier, store)).toBe(1);
    await sleep(1300);
    expect(await consumeAppAuthCode(cb, b.verifier, store)).toBeNull();
    await pool.query('DELETE FROM app_auth_code');
  });

  test('E. 청소 — 만료 + 1시간 지난 행만 지운다', async () => {
    const store = createSqlAppAuthCodeStore(pool);
    await rawIns(H('1'), 1, 'NOW(3) - INTERVAL 2 HOUR', 'NOW(3) - INTERVAL 2 HOUR + INTERVAL 60 SECOND');
    await rawIns(H('2'), 1, 'NOW(3) - INTERVAL 30 MINUTE', 'NOW(3) - INTERVAL 30 MINUTE + INTERVAL 60 SECOND');
    await rawIns(H('3'), 1, 'NOW(3)', 'NOW(3) + INTERVAL 60 SECOND');
    await store.prune(3600);
    const [rows] = await pool.query('SELECT code FROM app_auth_code ORDER BY code') as [Array<{ code: string }>, unknown];
    expect(rows.map((r) => r.code)).toEqual([H('2'), H('3')]);
    await pool.query('DELETE FROM app_auth_code');
  });

  test('F. 되돌리기(DROP) → 재적용', async () => {
    for (const s of rollbackStatements(sql)) await pool.query(s);
    const [t] = await pool.query("SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA='t088' AND TABLE_NAME='app_auth_code'") as [Array<{ n: number }>, unknown];
    expect(Number(t[0].n)).toBe(0);
    await apply();
    const [t2] = await pool.query("SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA='t088' AND TABLE_NAME='app_auth_code'") as [Array<{ n: number }>, unknown];
    expect(Number(t2[0].n)).toBe(1);
    await pool.query('DROP TABLE IF EXISTS app_auth_code');
  });
});
