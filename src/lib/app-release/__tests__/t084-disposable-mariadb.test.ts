/**
 * T-084 — **일회용 MariaDB 실증 시험** (평소 jest 실행에서는 건너뛴다).
 *
 * 무엇을 실제 DB 로 확인하나:
 *  A. 마이그레이션(`scripts/migrations/T-084-app-release.sql`) — 적용 전 ER_NO_SUCH_TABLE(→ AppReleaseNotMigratedError) · 2회 적용 멱등 ·
 *     UNIQUE 2개·CHECK 9개 · 열 콜레이션(ascii_bin) · 되돌리기(DROP) → 재적용
 *  B. CHECK — apk_file 경로·대문자 확장자·숨김 이름·공백·NUL·**끝 개행**, sha256 대문자·길이, version_code 0,
 *     version_name 형식(정확히 x.y.z — `1.1`·`1.0.0.0` 거부)·**끝 개행**, size 0, min>code, cert 형식
 *     B4(R4): 숫자 상한 — version_code ≤ 2100000000(앱 MAX_VERSION_CODE)·size_bytes ≤ 2^53-1(앱 안전 정수). 상한값 수락·상한+1 거부·
 *     DB 가 받는 최대 행을 실제 저장 계층(getLatestRelease)도 받아들이는지
 *  전체를 **두 sql_mode 로 반복**한다(R1): 서버 기본 모드, 그리고 세션에 NO_BACKSLASH_ESCAPES 를 더한 모드 — 마이그레이션도 그 세션에서 적용한다.
 *  (운영 sql_mode 를 확인할 수 없어서. 원래 SQL 의 `\\.` 는 NBE 세션에서 백슬래시 두 개로 저장돼 정상 값 '1.0.0' 을 거부했다 — R1 실측.)
 *  값은 `pool.execute`(서버 측 준비문, 바이너리 전송)로 넣는다 — 클라이언트 쪽 문자열 이스케이프(백슬래시)는 NBE 세션에서 값을 바꾸기 때문이다.
 *  C. UNIQUE — version_code 중복, apk_file 중복(대소문자만 다른 이름은 **다른 값** — ascii_bin)
 *  D. 저장 계층 실물 — getLatestRelease(최댓값)·getReleaseByFile·BIGINT 크기 해석, 최신 행 삭제 = 롤백
 *
 * 실행(운영·공용 DB 금지 — 127.0.0.1 에만 묶인 일회용 컨테이너, 끝나면 제거):
 *   docker run -d --rm --name t084-mariadb -p 127.0.0.1:33084:3306 -e MARIADB_ROOT_PASSWORD=t084test -e MARIADB_DATABASE=t084 \
 *     mariadb:10.11 --sql-mode=IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION \
 *     --character-set-server=utf8mb3 --collation-server=utf8mb3_general_ci
 *   T084_TEST_DB_PORT=33084 T084_TEST_DB_PASSWORD=t084test node ./node_modules/jest/bin/jest.js src/lib/app-release/__tests__/t084-disposable-mariadb.test.ts
 *   docker rm -f t084-mariadb
 * 서버 기본 문자셋을 운영 실측(utf8mb3_general_ci, T-074 기록)과 맞춰, 테이블·열 콜레이션 명시가 실제로 먹는지 본다. 값은 전부 합성값이다.
 */
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';

jest.mock('@/lib/db', () => ({ getPool: () => { throw new Error('운영 풀 사용 금지(시험)'); } }));

import { AppReleaseNotMigratedError, getLatestRelease, getReleaseByFile } from '../store';

const PORT = process.env.T084_TEST_DB_PORT;
const maybe = PORT ? describe : describe.skip;
const MIGRATION = path.join(__dirname, '..', '..', '..', '..', 'scripts', 'migrations', 'T-084-app-release.sql');

function statements(sql: string): string[] {
  return sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n').split(';').map((s) => s.trim()).filter(Boolean);
}
function rollbackStatements(sql: string): string[] {
  const tail = sql.slice(sql.indexOf('-- 되돌리기'));
  return tail.split('\n').filter((l) => /^-- DROP /.test(l)).map((l) => l.replace(/^-- /, '').replace(/;\s*$/, ''));
}

const H = (c: string) => c.repeat(64);

describe('마이그레이션 파일 정적 검사(DB 없이)', () => {
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  test('DDL 문장에 백슬래시가 없다(NO_BACKSLASH_ESCAPES 여부와 무관하게 같은 제약)', () => {
    for (const s of statements(sql)) expect(s).not.toContain('\\');
  });
  test('숫자 상한 CHECK 2개가 있다(R4 — 코드 상수와의 일치는 version-paths.test.ts 가 감시)', () => {
    expect(sql).toMatch(/CONSTRAINT chk_app_release_code\s+CHECK \(version_code > 0 AND version_code <= 2100000000\)/);
    expect(sql).toMatch(/CONSTRAINT chk_app_release_size\s+CHECK \(size_bytes > 0 AND size_bytes <= 9007199254740991\)/);
  });
  test('개행 CHECK 2개가 있다', () => {
    expect(sql).toContain('CHECK (INSTR(version_name, CHAR(10)) = 0)');
    expect(sql).toContain('CHECK (INSTR(apk_file, CHAR(10)) = 0)');
  });
});

const MODES: Array<[string, boolean]> = [['서버 기본 sql_mode', false], ['NO_BACKSLASH_ESCAPES 세션', true]];

maybe.each(MODES)('T-084 app_release 일회용 MariaDB — %s', (_label, nbe) => {
  let pool: mysql.Pool;
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  const apply = async () => { for (const s of statements(sql)) await pool.query(s); };
  const ins = (o: Record<string, unknown> = {}) => {
    const v = { version_code: 1, version_name: '1.0.0', apk_file: 'stockinvest-1.0.0.apk', sha256: H('a'), size_bytes: 100, min_supported: 0, notes: null, cert_sha256: null, ...o };
    return pool.execute(
      'INSERT INTO app_release (version_code, version_name, apk_file, sha256, size_bytes, min_supported, notes, cert_sha256) VALUES (?,?,?,?,?,?,?,?)',
      [v.version_code, v.version_name, v.apk_file, v.sha256, v.size_bytes, v.min_supported, v.notes, v.cert_sha256],
    );
  };
  const expectCheck = async (o: Record<string, unknown>) => {
    await expect(ins(o)).rejects.toMatchObject({ errno: 4025 }); // ER_CONSTRAINT_FAILED
  };

  beforeAll(async () => {
    pool = mysql.createPool({ host: '127.0.0.1', port: Number(PORT), user: 'root', password: process.env.T084_TEST_DB_PASSWORD, database: 't084', connectionLimit: 3, timezone: '+09:00' });
    if (nbe) {
      // 풀의 모든 연결에 세션 모드를 건다(연결이 만들어질 때 첫 질의로 큐에 들어간다).
      pool.pool.on('connection', (conn) => { conn.query("SET SESSION sql_mode = CONCAT(@@SESSION.sql_mode, ',NO_BACKSLASH_ESCAPES')"); });
    }
    await pool.query('DROP TABLE IF EXISTS app_release');
  });
  afterAll(async () => { await pool?.end(); });

  test('A0. 세션 sql_mode 가 의도대로다', async () => {
    const [rows] = await pool.query('SELECT @@SESSION.sql_mode AS m') as [Array<{ m: string }>, unknown];
    expect(rows[0].m.split(',').includes('NO_BACKSLASH_ESCAPES')).toBe(nbe);
  });

  test('A1. 적용 전 — 저장 계층이 AppReleaseNotMigratedError', async () => {
    await expect(getLatestRelease(pool)).rejects.toBeInstanceOf(AppReleaseNotMigratedError);
  });

  test('A2. 2회 적용 멱등 · 키·CHECK 개수 · 콜레이션', async () => {
    await apply();
    await apply();
    const [create] = await pool.query('SHOW CREATE TABLE app_release') as [Array<Record<string, string>>, unknown];
    const ddl = create[0]['Create Table'];
    expect((ddl.match(/UNIQUE KEY/g) ?? []).length).toBe(2);
    expect((ddl.match(/CONSTRAINT `chk_/g) ?? []).length).toBe(9);
    // 저장된 CHECK 식에 백슬래시가 없다 — 모드에 따라 달라질 여지가 없다.
    const [checks] = await pool.query(
      "SELECT CONSTRAINT_NAME, CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA='t084' AND TABLE_NAME='app_release'",
    ) as [Array<{ CONSTRAINT_NAME: string; CHECK_CLAUSE: string }>, unknown];
    expect(checks).toHaveLength(9);
    for (const c of checks) expect(c.CHECK_CLAUSE).not.toContain('\\');
    expect(ddl).toMatch(/COLLATE=utf8mb4_general_ci/);
    const [cols] = await pool.query(
      "SELECT COLUMN_NAME, COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='t084' AND TABLE_NAME='app_release' AND COLUMN_NAME IN ('apk_file','sha256','cert_sha256','version_name') ORDER BY COLUMN_NAME",
    ) as [Array<{ COLUMN_NAME: string; COLLATION_NAME: string }>, unknown];
    expect(Object.fromEntries(cols.map((c) => [c.COLUMN_NAME, c.COLLATION_NAME]))).toEqual({
      apk_file: 'ascii_bin', cert_sha256: 'ascii_bin', sha256: 'ascii_bin', version_name: 'utf8mb4_general_ci',
    });
    expect(await getLatestRelease(pool)).toBeNull();
  });

  test('B. CHECK 거부', async () => {
    await expectCheck({ apk_file: '../evil.apk' });
    await expectCheck({ apk_file: 'sub/evil.apk' });
    await expectCheck({ apk_file: '/abs/evil.apk' });
    await expectCheck({ apk_file: 'evil.APK' });
    await expectCheck({ apk_file: '.hidden.apk' });
    await expectCheck({ apk_file: 'has space.apk' });
    await expectCheck({ apk_file: 'evil.apk.exe' });
    await expectCheck({ apk_file: 'evil\\x.apk' });
    await expectCheck({ apk_file: 'x.apk\nmore' });
    await expectCheck({ sha256: H('A') });
    await expectCheck({ sha256: 'g'.repeat(64) });
    await expectCheck({ sha256: 'a'.repeat(63) + ' ' });
    await expectCheck({ version_code: 0 });
    await expectCheck({ version_name: 'v1.0' });
    await expectCheck({ version_name: '1.0.0-beta' });
    // R1 — 구성요소 수는 정확히 3(다운로드 이름 정규식과 같게)
    await expectCheck({ version_name: '1' });
    await expectCheck({ version_name: '1.1' });
    await expectCheck({ version_name: '1.0.0.0' });
    await expectCheck({ version_name: '1x0x0' }); // `.` 가 임의 문자로 풀리지 않는다([.])
    // R1 — PCRE `$` 는 마지막 개행 앞에서도 일치한다: 끝 개행은 별도 CHECK 가 거부해야 한다
    await expectCheck({ apk_file: 's.apk\n' });
    await expectCheck({ apk_file: 'stockinvest-1.0.0.apk\n' });
    await expectCheck({ version_name: '1.0.0\n' });
    await expectCheck({ apk_file: 's.apk\r' });
    await expectCheck({ apk_file: 's.apk\0' });
    await expectCheck({ apk_file: 'sxapk' }); // `.apk` 의 점도 [.]
    await expectCheck({ size_bytes: 0 });
    await expectCheck({ version_code: 2, min_supported: 3 });
    await expectCheck({ cert_sha256: 'AB:CD' });
    await expectCheck({ cert_sha256: H('F') });
    // 짧은 sha(CHAR 64 는 오른쪽 공백 채움 없이 비교 — 정규식 {64} 가 거부)
    await expectCheck({ sha256: 'a'.repeat(10) });
  });

  test('B2. 길이 초과는 strict 모드가 거부', async () => {
    await expect(ins({ notes: 'x'.repeat(501) })).rejects.toMatchObject({ code: 'ER_DATA_TOO_LONG' });
    await expect(ins({ apk_file: `${'x'.repeat(125)}.apk` })).rejects.toBeTruthy();
  });

  test('B3. 정상 값 허용 경계(x.y.z 각 1~4자리·이름 128자) — 넣고 지운다', async () => {
    await ins({ version_code: 9001, version_name: '9999.9999.9999', apk_file: 'stockinvest-9999.9999.9999.apk', sha256: H('9') });
    await ins({ version_code: 9002, version_name: '0.0.1', apk_file: `${'x'.repeat(124)}.apk`, sha256: H('8') });
    await ins({ version_code: 9003, version_name: '10.20.30', apk_file: 'A_b-c.1.apk', sha256: H('7') });
    const [rows] = await pool.query('SELECT COUNT(*) AS n FROM app_release WHERE version_code >= 9001') as [Array<{ n: number }>, unknown];
    expect(Number(rows[0].n)).toBe(3);
    await pool.query('DELETE FROM app_release WHERE version_code >= 9001');
  });

  test('B4. 숫자 상한(R4) — version_code ≤ 2100000000 · size_bytes ≤ 2^53-1, 경계 수락·상한+1 거부', async () => {
    const MAX_CODE = 2_100_000_000;
    const MAX_SIZE = '9007199254740991'; // Number.MAX_SAFE_INTEGER — 문자열로 넘긴다(JS Number 로는 2^53+1 을 정확히 못 쓴다)
    const OVER_SIZE = '9007199254740992'; // 2^53 정확값(BigInt 로 계산해 아래에서 대조)
    expect(BigInt(MAX_SIZE)).toBe(BigInt(Number.MAX_SAFE_INTEGER));
    expect(BigInt(OVER_SIZE)).toBe(BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1));
    try {
      // 상한 초과 거부 — version_code(상한+1·INT UNSIGNED 끝값), min_supported(version_code 가 허용 상한이어도 상한+1 이면 min ≤ code 가 거부)
      await expectCheck({ version_code: MAX_CODE + 1 });
      await expectCheck({ version_code: 4_294_967_295 });
      await expectCheck({ version_code: MAX_CODE + 1, min_supported: MAX_CODE + 1 });
      await expectCheck({ version_code: MAX_CODE, min_supported: MAX_CODE + 1 });
      // size_bytes 상한+1(2^53 정확값) 거부
      await expectCheck({ size_bytes: OVER_SIZE });
      await expectCheck({ version_code: MAX_CODE, size_bytes: OVER_SIZE });
      // 거부된 시도가 행을 남기지 않았다
      const [none] = await pool.query('SELECT COUNT(*) AS n FROM app_release') as [Array<{ n: number }>, unknown];
      expect(Number(none[0].n)).toBe(0);
      // 상한값 수락 — version_code=상한(min 0), min_supported=상한(version_code 도 상한), size_bytes=2^53-1
      await ins({ version_code: MAX_CODE, version_name: '1.0.0', apk_file: 'stockinvest-1.0.0.apk', sha256: H('a'), size_bytes: 100, min_supported: 0 });
      await pool.query('DELETE FROM app_release');
      await ins({ version_code: MAX_CODE, version_name: '1.0.0', apk_file: 'stockinvest-1.0.0.apk', sha256: H('a'), size_bytes: MAX_SIZE, min_supported: MAX_CODE });
      // DB 가 받는 최대 행은 앱 쪽 검증(parseReleaseRow)도 통과해 '최신'이 된다 — DB 상한과 앱 상한이 어긋나지 않는다
      expect(await getLatestRelease(pool)).toMatchObject({ versionCode: MAX_CODE, sizeBytes: Number.MAX_SAFE_INTEGER, minSupported: MAX_CODE });
      await pool.query('DELETE FROM app_release');
      expect(await getLatestRelease(pool)).toBeNull();
    } finally {
      await pool.query('DELETE FROM app_release'); // 단언이 실패해도 뒤 시험(C·D)에 행을 남기지 않는다
    }
  });

  test('C. 정상 행 + UNIQUE', async () => {
    await ins({ cert_sha256: H('c'), notes: '첫 배포' });
    await expect(ins({ apk_file: 'stockinvest-1.0.1.apk' })).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' }); // version_code 중복
    await expect(ins({ version_code: 2 })).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' }); // apk_file 중복
    // ascii_bin — 대소문자만 다른 이름은 다른 값(utf8mb4_general_ci 였다면 중복으로 거부됐을 것)
    await ins({ version_code: 2, version_name: '1.0.1', apk_file: 'StockInvest-1.0.0.apk', sha256: H('b') });
    await pool.query('DELETE FROM app_release WHERE version_code = 2');
  });

  test('D. 저장 계층 실물 — 최신·이름 조회·BIGINT·롤백(최신 행 삭제)', async () => {
    await ins({ version_code: 2, version_name: '1.0.1', apk_file: 'stockinvest-1.0.1.apk', sha256: H('d'), size_bytes: 5_000_000_000, min_supported: 1 });
    const latest = await getLatestRelease(pool);
    expect(latest).toMatchObject({ versionCode: 2, versionName: '1.0.1', apkFile: 'stockinvest-1.0.1.apk', sha256: H('d'), sizeBytes: 5_000_000_000, minSupported: 1, notes: null });
    expect(latest?.createdAt).toBeInstanceOf(Date);
    expect((await getReleaseByFile('stockinvest-1.0.0.apk', pool))?.versionCode).toBe(1);
    expect(await getReleaseByFile('stockinvest-9.9.9.apk', pool)).toBeNull();
    // 이름 조회는 정확 일치(ascii_bin) — 대소문자 다른 이름은 못 찾는다
    expect(await getReleaseByFile('STOCKINVEST-1.0.0.apk', pool)).toBeNull();
    // 롤백 = 최신 행 삭제 → 아래 행이 최신
    await pool.query('DELETE FROM app_release WHERE version_code = 2');
    expect((await getLatestRelease(pool))?.versionCode).toBe(1);
  });

  test('A3. 되돌리기(DROP) → 다시 not_migrated → 재적용', async () => {
    const rb = rollbackStatements(sql);
    expect(rb).toEqual(['DROP TABLE IF EXISTS app_release']);
    for (const s of rb) await pool.query(s);
    await expect(getLatestRelease(pool)).rejects.toBeInstanceOf(AppReleaseNotMigratedError);
    await apply();
    expect(await getLatestRelease(pool)).toBeNull();
  });
});
