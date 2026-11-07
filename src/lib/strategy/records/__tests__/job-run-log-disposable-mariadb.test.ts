/**
 * T-112 — **일회용 MariaDB 실증 시험** (평소 jest 실행에서는 정적 검사만 돌고 DB 부분은 건너뛴다 — `T112_IMPL_DB_PORT` 가 있을 때만).
 *
 * 무엇을 실제 DB 로 확인하나(`scripts/migrations/T-112-run-judgment-record.sql` + `job-run-log.ts` 가 만드는 SQL 그대로):
 *  A. 2회 적용 멱등 · 3테이블 utf8mb4 · CHECK 10개(+json_valid)
 *  B. 🔴 F1 b′ ODKU 6단계(실패 → 재전송 → 성공 → 재전송 → 늦은 실패 줄 → 3차) = attempt 1,1,2,2,2,3, 늦은 줄 무시, started_at 유지
 *     · ended_at NULL 행 회복(성공 재시도가 덮는다) · NULL 위 NULL 재전송은 가짜 시각을 쓰지 않는다
 *     · 변이 2종(IFNULL 제거 · ended_at 대입을 맨 앞으로)이 이 판정에 **잡힌다**(시험 감도 확인)
 *  C. 롤업(U2): 배치가 여러 번 와도 runs·failed 가산 · maxMs 최대 · 상태 ok/partial/failed · 같은 정시 슬롯의 실패 행(runner_hook)과
 *     롤업 행(runner_rollup)이 UNIQUE 충돌 없이 공존 · (T-127) C3 이미 있는 행에 failed 배치를 더해 failed 가 되는 ODKU 경로(`>=` 변이 감도 포함)
 *  D. 🔴 F3 클램프: 앱이 자른 값(이모지 128 코드포인트)은 strict 에서 저장 · 자르지 않은 129자는 1406 으로 거부(클램프가 필요한 이유)
 *  E. 🔴 F6 errno: CHECK 위반 = 4025(mysql2 code 는 엉뚱한 문자열) · 테이블 없음 = 1146
 *  F. recordSpoolBatch 끝에서 끝: 스위치 켜짐 → 저장 · 재전송 → 실행 행 불변(롤업 runs 는 두 배 — 알려진 한계, 초안 §5.2) · 스위치 키 없음 → 0행 ·
 *     테이블 없음 → skipped_no_table
 *  G. 🔴 (T-135) 실 풀 10개(운영 `db.ts` 와 같은 connectionLimit 10·queueLimit 0)·실 `LOCK TABLES job_run_log WRITE`, 처리 상한 JRL_DEADLINE_MS(2.5초) 그대로:
 *     G1 정상 30배치 — 매번 연결이 풀로 돌아온다(바쁜 연결 0, 배치마다 연결 하나·release) · G2 표를 잠근 채 12배치 동시 × 2회 — 전부 failed(timeout),
 *     매번 바쁜 연결 0, 무관한 `SELECT 1` 이 3초 안에 통과, 잠금을 쥔 채로 서버의 대기 upsert 가 사라지고, 잠금 해제 뒤 늦게 써진 행 0 ·
 *     G3 오류 경로(테이블 없음)도 바쁜 연결 0·연결은 destroy
 *  A·B·C 는 **두 sql_mode** 로 반복한다: 서버 기본(앱 경로 그대로 `query`), 세션에 NO_BACKSLASH_ESCAPES 를 더한 모드(값은 `execute` 준비문 —
 *  클라이언트 쪽 문자열 이스케이프가 NBE 세션에서 값을 바꾸지 않게, T-088 과 같은 방식). D·E·F 는 서버 기본에서만(앱 경로).
 *
 * 실행(운영·공용 DB 금지 — 127.0.0.1 에만 묶인 일회용 컨테이너, 끝나면 제거. 비밀번호는 환경변수로만):
 *   T112_IMPL_DB_PASSWORD="$(head -c 24 /dev/urandom | base64 | tr -dc A-Za-z0-9 | head -c 24)"; export T112_IMPL_DB_PASSWORD
 *   docker run -d --rm --pull=never --name t112-impl-a -p 127.0.0.1:33113:3306 -e MARIADB_ROOT_PASSWORD="$T112_IMPL_DB_PASSWORD" \
 *     -e MARIADB_DATABASE=t112impl mariadb:10.11 \
 *     --sql-mode=IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION \
 *     --character-set-server=utf8mb3 --collation-server=utf8mb3_general_ci
 *   T112_IMPL_DB_PORT=33113 npx jest src/lib/strategy/records/__tests__/job-run-log-disposable-mariadb.test.ts
 *   docker rm -fv t112-impl-a
 * 값은 전부 합성값이다.
 */
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';

// (T-135) 기록기는 upsert 를 풀에서 받은 연결 하나로 보낸다 — 목 풀도 getConnection 을 준다(G 는 실 mysql2 풀).
let mockPool: { query: (sql: string, params?: unknown[]) => Promise<unknown>; getConnection: () => Promise<unknown> } | mysql.Pool | null = null;
jest.mock('@/lib/db', () => ({
  getPool: () => { if (!mockPool) throw new Error('운영 풀 사용 금지(시험)'); return mockPool; },
}));

import {
  JRL_DEADLINE_MS,
  ROLLUP_ODKU,
  RUN_ODKU,
  buildRows,
  buildUpsert,
  recordSpoolBatch,
  resetJobRunLogWarningsForTest,
  runRow,
  type JobRunRow,
  type SpoolLine,
  parseSpoolLine,
} from '../job-run-log';
import { resetRecordSwitchCacheForTest } from '../record-switch';
import { isCheckViolation, isNoSuchTable, isRowDataError } from '../safe-text';

const PORT = process.env.T112_IMPL_DB_PORT;
const DBNAME = process.env.T112_IMPL_DB_NAME ?? 't112impl';
const maybe = PORT ? describe : describe.skip;
const MIGRATION = path.join(__dirname, '..', '..', '..', '..', '..', 'scripts', 'migrations', 'T-112-run-judgment-record.sql');
const SQL = fs.readFileSync(MIGRATION, 'utf8');

function statements(sql: string): string[] {
  return sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n').split(';').map((s) => s.trim()).filter(Boolean);
}
function rollbackStatements(sql: string): string[] {
  return sql.split('\n').filter((l) => /^-- DROP TABLE /.test(l)).map((l) => l.replace(/^-- /, '').replace(/;\s*$/, ''));
}

const kst = (s: string) => Date.parse(`${s.replace(' ', 'T')}+09:00`);
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
function line(label: string, http: number, start: string, durMs: number, body?: unknown): string {
  const t0 = kst(start);
  return ['v1', label, `/api/cron/${label}`, String(http).padStart(3, '0'), String(t0), String(t0 + durMs),
    body === undefined ? '' : b64(JSON.stringify(body))].join('\t');
}

describe('마이그레이션 파일 정적 검사(DB 없이)', () => {
  test('문장 4개 = SET SESSION lock_wait_timeout = 5 + CREATE TABLE IF NOT EXISTS 3개 (F9), 다른 문장 없음', () => {
    const st = statements(SQL);
    expect(st).toHaveLength(4);
    expect(st[0]).toBe('SET SESSION lock_wait_timeout = 5');
    expect(st[1].startsWith('CREATE TABLE IF NOT EXISTS job_run_log (')).toBe(true);
    expect(st[2].startsWith('CREATE TABLE IF NOT EXISTS judgment_run (')).toBe(true);
    expect(st[3].startsWith('CREATE TABLE IF NOT EXISTS judgment_candidate (')).toBe(true);
    for (const s of st) expect(s).not.toMatch(/\b(ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE|RENAME|GRANT)\b/i);
  });
  test('백슬래시 없음(NO_BACKSLASH_ESCAPES 여부와 무관하게 같은 제약)', () => {
    expect(SQL).not.toContain('\\');
  });
  test('되돌리기는 주석의 DROP 3줄뿐', () => {
    expect(rollbackStatements(SQL)).toEqual(['DROP TABLE IF EXISTS job_run_log', 'DROP TABLE IF EXISTS judgment_candidate', 'DROP TABLE IF EXISTS judgment_run']);
  });
  test('앱 SQL 의 열 이름은 모두 DDL 에 있다', () => {
    for (const c of ['job_id', 'run_kind', 'market', 'target', 'scheduled_slot_at', 'started_at', 'ended_at', 'status', 'attempt',
      'http_code', 'counts_json', 'error_code', 'degraded_reason', 'session_date_kst', 'session_date_et', 'recorder']) {
      expect(SQL).toMatch(new RegExp(`\\n  ${c}\\s`));
    }
  });
});

const MODES: Array<[string, boolean]> = [['서버 기본 sql_mode(앱 경로 query)', false], ['NO_BACKSLASH_ESCAPES 세션(execute)', true]];

type Conn = mysql.Connection;
async function rowsOf(c: Conn, where = '1=1', params: unknown[] = []) {
  const [r] = await c.query(
    `SELECT job_id, recorder, status, attempt, http_code, error_code, degraded_reason, CAST(counts_json AS CHAR) AS counts,
            DATE_FORMAT(scheduled_slot_at,'%Y-%m-%d %H:%i:%s') AS slot, DATE_FORMAT(started_at,'%Y-%m-%d %H:%i:%s') AS st,
            DATE_FORMAT(ended_at,'%Y-%m-%d %H:%i:%s') AS en, DATE_FORMAT(session_date_kst,'%Y-%m-%d') AS dk,
            DATE_FORMAT(session_date_et,'%Y-%m-%d') AS de, run_id
       FROM job_run_log WHERE ${where} ORDER BY run_id`, params);
  return r as Array<Record<string, unknown>>;
}

for (const [modeName, nbe] of MODES) {
  maybe(`[${modeName}] DDL·b′·롤업`, () => {
    let c: Conn;
    const exec = (sql: string, params: unknown[]) => (nbe ? c.execute(sql, params as never) : c.query(sql, params));
    const upsert = (rows: JobRunRow[], odku: string) => { const q = buildUpsert(rows, odku); return exec(q.sql, q.params); };
    const runRowsOf = (...ls: string[]) => buildRows(ls).runRows;

    beforeAll(async () => {
      c = await mysql.createConnection({
        host: '127.0.0.1', port: Number(PORT), user: 'root', password: process.env.T112_IMPL_DB_PASSWORD, database: DBNAME,
        timezone: '+09:00', multipleStatements: true,
      });
      if (nbe) await c.query("SET SESSION sql_mode = CONCAT(@@SESSION.sql_mode, ',NO_BACKSLASH_ESCAPES')");
      await c.query('DROP TABLE IF EXISTS job_run_log, judgment_run, judgment_candidate');
    });
    afterAll(async () => { await c?.end(); });

    test('A0. 세션 sql_mode 가 의도대로(strict 포함, NBE 여부)', async () => {
      const [r] = await c.query('SELECT @@SESSION.sql_mode AS m') as [Array<{ m: string }>, unknown];
      const m = r[0].m.split(',');
      expect(m).toContain('STRICT_TRANS_TABLES');
      expect(m.includes('NO_BACKSLASH_ESCAPES')).toBe(nbe);
    });
    test('A1. 마이그레이션 2회 적용(멱등) — 3테이블, utf8mb4, 이름 붙은 CHECK 10개', async () => {
      await c.query(SQL);
      const [w] = await c.query('SHOW WARNINGS') as [unknown[], unknown];
      expect(w).toHaveLength(0);
      await c.query(SQL); // 2차 — Note 1050 ×3
      const [t] = await c.query("SELECT TABLE_NAME AS t, TABLE_COLLATION AS co FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('job_run_log','judgment_run','judgment_candidate') ORDER BY 1") as [Array<{ t: string; co: string }>, unknown];
      expect(t.map((x) => x.t)).toEqual(['job_run_log', 'judgment_candidate', 'judgment_run']);
      for (const x of t) expect(x.co.startsWith('utf8mb4')).toBe(true);
      const [ck] = await c.query("SELECT COUNT(*) AS n FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME LIKE 'chk%'") as [Array<{ n: number }>, unknown];
      expect(Number(ck[0].n)).toBe(10);
    });

    // b′ 6단계 — 같은 슬롯(08:00) 해외 분석 재시도
    const L1 = line('post-market-overseas', 503, '2026-10-30 08:00:05', 60_000, { ok: false, status: 'data_unknown', skipped: 'holidays_unknown' });
    const L2 = line('post-market-overseas', 200, '2026-10-30 08:10:05', 55_000, { ok: true, status: 'ok', symbolsEvaluated: 55, candidatesFound: 9, signalsCreated: 2 });
    const L3 = line('post-market-overseas', 502, '2026-10-30 08:20:05', 30_000, { ok: false, status: 'ai_fail' });
    async function sixSteps(odku: string) {
      await exec("DELETE FROM job_run_log WHERE job_id = 'post-market-overseas'", []);
      const seen: Array<[number, string]> = [];
      for (const l of [L1, L1, L2, L2, L1, L3]) {
        await upsert(runRowsOf(l), odku);
        const [r] = await rowsOf(c, "job_id = 'post-market-overseas'");
        seen.push([Number(r.attempt), String(r.status)]);
      }
      const [last] = await rowsOf(c, "job_id = 'post-market-overseas'");
      return { seen, last };
    }

    test('🔴 B1. b′ 6단계 = attempt 1,1,2,2,2,3 · 늦은 실패 줄 무시 · started_at 첫 시도 유지 · 성공 뒤 오류 분류어 지움', async () => {
      const { seen, last } = await sixSteps(RUN_ODKU);
      expect(seen).toEqual([[1, 'failed'], [1, 'failed'], [2, 'ok'], [2, 'ok'], [2, 'ok'], [3, 'failed']]);
      expect(last).toMatchObject({ slot: '2026-10-30 08:00:00', st: '2026-10-30 08:00:05', en: '2026-10-30 08:20:35', http_code: 502, error_code: 'HTTP=502:ai_fail', dk: '2026-10-30', de: '2026-10-29' });
      const rows = await rowsOf(c, "job_id = 'post-market-overseas'");
      expect(rows).toHaveLength(1);
    });
    test('B1b. 2단계(성공) 직후 상태 — error_code·degraded_reason NULL, counts 갱신', async () => {
      await exec("DELETE FROM job_run_log WHERE job_id = 'post-market-overseas'", []);
      await upsert(runRowsOf(L1), RUN_ODKU);
      const [a] = await rowsOf(c, "job_id = 'post-market-overseas'");
      expect(a).toMatchObject({ error_code: 'HTTP=503:data_unknown', degraded_reason: 'holidays_unknown', http_code: 503 });
      await upsert(runRowsOf(L2), RUN_ODKU);
      const [b] = await rowsOf(c, "job_id = 'post-market-overseas'");
      expect(b).toMatchObject({ status: 'ok', http_code: 200, error_code: null, degraded_reason: null, attempt: 2 });
      expect(JSON.parse(String(b.counts))).toEqual({ evaluated: 55, candidates: 9, created: 2, lastOkStartMs: kst('2026-10-30 08:10:05') });
    });
    test('🔴 B2. 변이가 잡힌다 — IFNULL 제거 / ended_at 대입을 맨 앞으로', async () => {
      const noIfnull = RUN_ODKU.split("IFNULL(ended_at, '1000-01-01 00:00:00')").join('ended_at');
      const parts = RUN_ODKU.replace(/^ON DUPLICATE KEY UPDATE /, '').split(/, (?=[a-z_]+ = )/);
      const endedFirst = `ON DUPLICATE KEY UPDATE ${[parts[parts.length - 1], ...parts.slice(0, -1)].join(', ')}`;
      expect((await sixSteps(endedFirst)).seen).not.toEqual([[1, 'failed'], [1, 'failed'], [2, 'ok'], [2, 'ok'], [2, 'ok'], [3, 'failed']]);
      // IFNULL 제거는 ended_at NULL 행에서만 드러난다(B3 의 회복 판정)
      await exec("DELETE FROM job_run_log WHERE job_id = 'post-market-overseas'", []);
      const nullRow = { ...runRowsOf(L1)[0], ended_at: null as unknown as string };
      await upsert([nullRow], noIfnull);
      await upsert(runRowsOf(L2), noIfnull);
      const [r] = await rowsOf(c, "job_id = 'post-market-overseas'");
      expect([r.attempt, r.status, r.en]).toEqual([1, 'failed', null]); // 변이: 영원히 고착(F1 결함 재현)
    });
    test('🔴 B3. ended_at NULL 행은 성공 재시도가 회복시킨다 · NULL 위 NULL 재전송은 가짜 시각을 쓰지 않는다', async () => {
      await exec("DELETE FROM job_run_log WHERE job_id = 'post-market-overseas'", []);
      const nullRow = { ...runRowsOf(L1)[0], ended_at: null as unknown as string };
      await upsert([nullRow], RUN_ODKU);
      await upsert([nullRow], RUN_ODKU);
      const [a] = await rowsOf(c, "job_id = 'post-market-overseas'");
      expect([a.attempt, a.status, a.en]).toEqual([1, 'failed', null]);
      await upsert(runRowsOf(L2), RUN_ODKU);
      const [b] = await rowsOf(c, "job_id = 'post-market-overseas'");
      expect([b.attempt, b.status, b.en, b.st]).toEqual([2, 'ok', '2026-10-30 08:11:00', '2026-10-30 08:00:05']);
    });

    test('🔴 C1. 롤업 — 배치 3번 가산(runs·failed·maxMs), 상태 partial, started 최소·ended 최대', async () => {
      await exec("DELETE FROM job_run_log WHERE job_id = 'entry-watcher'", []);
      const batches = [
        [line('entry-watcher', 200, '2026-10-30 10:00:01', 100), line('entry-watcher', 500, '2026-10-30 10:01:02', 900, { ok: false })],
        [line('entry-watcher', 200, '2026-10-30 10:02:03', 300), line('entry-watcher', 200, '2026-10-30 10:03:04', 50)],
        [line('entry-watcher', 0, '2026-10-30 10:04:05', 1200), line('entry-watcher', 0, '2026-10-30 10:05:06', 10), line('entry-watcher', 0, '2026-10-30 10:06:07', 10)],
      ];
      for (const b of batches) {
        const built = buildRows(b);
        if (built.runRows.length) await upsert(built.runRows, RUN_ODKU);
        await upsert(built.rollupRows, ROLLUP_ODKU);
      }
      const roll = await rowsOf(c, "job_id = 'entry-watcher' AND recorder = 'runner_rollup'");
      expect(roll).toHaveLength(1);
      expect(JSON.parse(String(roll[0].counts))).toEqual({ runs: 7, failed: 4, maxMs: 1200 });
      expect(roll[0]).toMatchObject({ status: 'partial', slot: '2026-10-30 10:00:00', st: '2026-10-30 10:00:01', en: '2026-10-30 10:06:07', http_code: null, attempt: 1 });
      const fails = await rowsOf(c, "job_id = 'entry-watcher' AND recorder = 'runner_hook'");
      expect(fails.map((r) => r.slot)).toEqual(['2026-10-30 10:01:00', '2026-10-30 10:04:00', '2026-10-30 10:05:00', '2026-10-30 10:06:00']);
    });
    test('C2. 롤업 상태 — 모두 실패 → failed, 모두 정상 → ok · 정시 실패 행과 롤업 행 공존(UNIQUE 충돌 없음)', async () => {
      await exec("DELETE FROM job_run_log WHERE job_id = 'stop-alert'", []);
      const b1 = buildRows([line('stop-alert', 0, '2026-10-30 11:00:00', 20_000), line('stop-alert', 0, '2026-10-30 11:01:20', 20_000)]);
      await upsert(b1.runRows, RUN_ODKU);
      await upsert(b1.rollupRows, ROLLUP_ODKU);
      const b2 = buildRows([line('stop-alert', 200, '2026-10-30 12:00:00', 5), line('stop-alert', 200, '2026-10-30 12:01:00', 6)]);
      await upsert(b2.rollupRows, ROLLUP_ODKU);
      const at11 = await rowsOf(c, "job_id = 'stop-alert' AND scheduled_slot_at = '2026-10-30 11:00:00'");
      expect(at11.map((r) => [r.recorder, r.status]).sort()).toEqual([['runner_hook', 'failed'], ['runner_rollup', 'failed']]);
      const [r12] = await rowsOf(c, "job_id = 'stop-alert' AND recorder = 'runner_rollup' AND scheduled_slot_at = '2026-10-30 12:00:00'");
      expect(r12.status).toBe('ok');
      // 정상 배치가 뒤에 와서 failed 0 이 아니게 되면 partial
      const b3 = buildRows([line('stop-alert', 200, '2026-10-30 11:02:40', 5)]);
      await upsert(b3.rollupRows, ROLLUP_ODKU);
      const [r11] = await rowsOf(c, "job_id = 'stop-alert' AND recorder = 'runner_rollup' AND scheduled_slot_at = '2026-10-30 11:00:00'");
      expect([r11.status, JSON.parse(String(r11.counts))]).toEqual(['partial', { runs: 3, failed: 2, maxMs: 20_000 }]);
    });
    // (T-127, T-112 Reviewer Minor-1) 이미 있는 롤업 행에 failed 배치를 더해 failed 가 되는 **ODKU 경로**. C2 의 "모두 실패 → failed" 는 첫 INSERT
    //   (JS rollupRow 계산)에서 나와 ROLLUP_ODKU 의 `>=` 를 밟지 않는다 — `>` 로 바꾼 변이가 73건 시험을 모두 통과했다.
    async function failedOnFailed(odku: string) {
      await exec("DELETE FROM job_run_log WHERE job_id = 'holding-checker'", []);
      await upsert(buildRows([line('holding-checker', 0, '2026-10-30 13:00:00', 100), line('holding-checker', 500, '2026-10-30 13:01:00', 70, { ok: false })]).rollupRows, odku);
      await upsert(buildRows([line('holding-checker', 0, '2026-10-30 13:02:00', 90)]).rollupRows, odku);
      const [r] = await rowsOf(c, "job_id = 'holding-checker' AND recorder = 'runner_rollup'");
      return [r.status, JSON.parse(String(r.counts))];
    }
    test('🔴 C3. 롤업 ODKU failed 전이 — failed 2건 행 + failed 배치 1건 → failed(runs 3·failed 3) · `>=`→`>` 변이는 partial 로 잡힌다', async () => {
      expect(await failedOnFailed(ROLLUP_ODKU)).toEqual(['failed', { runs: 3, failed: 3, maxMs: 100 }]);
      expect(ROLLUP_ODKU.split(' >= ')).toHaveLength(2);
      expect((await failedOnFailed(ROLLUP_ODKU.replace(' >= ', ' > ')))[0]).toBe('partial');
    });
  });
}

maybe('[서버 기본] 클램프·errno·recordSpoolBatch 끝에서 끝', () => {
  let c: Conn;
  beforeAll(async () => {
    c = await mysql.createConnection({
      host: '127.0.0.1', port: Number(PORT), user: 'root', password: process.env.T112_IMPL_DB_PASSWORD, database: DBNAME,
      timezone: '+09:00', multipleStatements: true,
    });
    await c.query('DROP TABLE IF EXISTS job_run_log, judgment_run, judgment_candidate');
    await c.query(SQL);
    await c.query('CREATE TABLE IF NOT EXISTS system_config (`key` VARCHAR(100) NOT NULL PRIMARY KEY, value TEXT NULL) DEFAULT CHARSET=utf8mb4');
    mockPool = {
      query: (sql: string, params?: unknown[]) => c.query(sql, params),
      // (T-135) 이 블록은 연결 하나(c)로 돈다 — release·destroy 는 아무것도 하지 않는다(c 는 다음 시험이 계속 쓴다). 실 풀 동작은 G.
      getConnection: async () => ({ query: (sql: string, params?: unknown) => c.query(sql, params as unknown[]), release: () => {}, destroy: () => {} }),
    };
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterAll(async () => { mockPool = null; await c?.end(); jest.restoreAllMocks(); });
  beforeEach(() => { resetRecordSwitchCacheForTest(); resetJobRunLogWarningsForTest(); });

  const P = (l: string) => parseSpoolLine(l) as SpoolLine;

  test('🔴 D1. 앱이 자른 값(이모지 128 코드포인트·error 64)은 strict 에서 저장된다', async () => {
    const r = runRow(P(line('edgar-sync', 200, '2026-10-30 07:00:00', 1)), {
      status: 'degraded', errorCode: 'e'.repeat(100), degradedReason: '\u{1F600}'.repeat(300), counts: null,
    });
    const q = buildUpsert([r], RUN_ODKU);
    await c.query(q.sql, q.params);
    const [row] = await rowsOf(c, "job_id = 'edgar-sync'");
    expect(Array.from(String(row.degraded_reason))).toHaveLength(128);
    expect(String(row.error_code)).toHaveLength(64);
  });
  test('🔴 D2. 자르지 않은 129자는 1406 으로 거부 — 한 값이 문장 전체를 실패시킨다(클램프가 필요한 이유)', async () => {
    const ok = runRow(P(line('research-cycle-overseas', 200, '2026-10-30 07:00:00', 1)));
    const bad: JobRunRow = { ...runRow(P(line('broker-fills', 200, '2026-10-30 07:20:00', 1))), degraded_reason: '\u{1F600}'.repeat(129) };
    const q = buildUpsert([ok, bad], RUN_ODKU);
    let err: unknown;
    try { await c.query(q.sql, q.params); } catch (e) { err = e; }
    expect((err as { errno?: number }).errno).toBe(1406);
    expect(isRowDataError(err)).toBe(true);
    expect(await rowsOf(c, "job_id = 'research-cycle-overseas'")).toHaveLength(0);
  });
  test('🔴 E1. CHECK 위반 = errno 4025(code 문자열은 판별에 쓰지 않는다) · 테이블 없음 = 1146', async () => {
    let e1: unknown;
    try {
      await c.query("INSERT INTO job_run_log (job_id, run_kind, market, status, session_date_kst, recorder) VALUES ('x','other','common','ok','2026-10-30','runner_hook')");
    } catch (e) { e1 = e; }
    expect(isCheckViolation(e1)).toBe(true);
    expect((e1 as { code?: string }).code).not.toBe('ER_CHECK_CONSTRAINT_VIOLATED'); // mysql2 의 번호표 차이(F6) — 그래서 errno 로만
    let e2: unknown;
    try { await c.query('SELECT 1 FROM job_run_log_nope'); } catch (e) { e2 = e; }
    expect(isNoSuchTable(e2)).toBe(true);
  });

  const TEXT = [
    line('edgar-sync', 200, '2026-10-30 07:00:05', 4000, { ok: true, partial: true, remaining: 2 }),
    line('post-market-overseas', 503, '2026-10-30 08:00:05', 60_000, { ok: false, status: 'data_unknown', skipped: 'fx_unknown' }),
    line('entry-watcher', 200, '2026-10-30 08:00:01', 100),
    line('entry-watcher', 500, '2026-10-30 08:01:01', 200, { ok: false }),
    line('holdings-premarket', 200, '2026-10-30 21:01:00', 3000, { ok: true }),
    'garbage',
  ].join('\n');

  test('F1. 스위치 키 없음 → skipped_disabled, 0행', async () => {
    await c.query('DELETE FROM job_run_log');
    await c.query("DELETE FROM system_config WHERE `key` = 'job_run_log_enabled'");
    await expect(recordSpoolBatch(TEXT)).resolves.toMatchObject({ status: 'skipped_disabled' });
    expect(await rowsOf(c)).toHaveLength(0);
  });
  test('🔴 F2. 스위치 켜짐 → 저장(실행 4 + 롤업 1, 형식 오류 1 버림), 슬롯·세션 날짜·분류', async () => {
    await c.query("INSERT INTO system_config (`key`, value) VALUES ('job_run_log_enabled', 'true')");
    await expect(recordSpoolBatch(TEXT)).resolves.toMatchObject({ status: 'ok', runRows: 4, rollupRows: 1, rejected: 1, rowErrors: 0 });
    const rows = await rowsOf(c);
    const by = Object.fromEntries(rows.map((r) => [`${r.job_id}/${r.recorder}/${r.slot}`, r]));
    expect(by['edgar-sync/runner_hook/2026-10-30 07:00:00']).toMatchObject({ status: 'partial', degraded_reason: 'remaining=2', de: '2026-10-29' });
    expect(by['post-market-overseas/runner_hook/2026-10-30 08:00:00']).toMatchObject({ status: 'failed', error_code: 'HTTP=503:data_unknown', degraded_reason: 'fx_unknown' });
    expect(by['entry-watcher/runner_hook/2026-10-30 08:01:00']).toMatchObject({ status: 'failed', error_code: 'HTTP=500' });
    expect(by['entry-watcher/runner_rollup/2026-10-30 08:00:00']).toMatchObject({ status: 'partial', de: null });
    expect(by['holdings-premarket/runner_hook/2026-10-30 21:00:00']).toMatchObject({ status: 'ok', de: '2026-10-30', dk: '2026-10-30' });
    expect(rows).toHaveLength(5);
  });
  test('F3. 같은 본문 재전송 → 실행 행 불변(attempt 1) · 롤업 runs 는 두 배(알려진 한계 — 초안 §5.2)', async () => {
    await expect(recordSpoolBatch(TEXT)).resolves.toMatchObject({ status: 'ok' });
    const rows = await rowsOf(c);
    expect(rows).toHaveLength(5);
    for (const r of rows.filter((x) => x.recorder === 'runner_hook')) expect(r.attempt).toBe(1);
    const [roll] = rows.filter((x) => x.recorder === 'runner_rollup');
    expect(JSON.parse(String(roll.counts))).toEqual({ runs: 4, failed: 2, maxMs: 200 });
  });
  test('🔴 F4. 테이블 없음 → skipped_no_table(던지지 않음)', async () => {
    await c.query('DROP TABLE job_run_log');
    await expect(recordSpoolBatch(TEXT)).resolves.toMatchObject({ status: 'skipped_no_table' });
    await c.query(SQL); // 재적용(되돌리기 → 재적용)
    expect(await rowsOf(c)).toHaveLength(0);
  });
});

maybe('G. 🔴 (T-135) 표가 잠겨도 upsert 가 풀 연결을 붙잡지 않는다(실물 기록기·실 풀 10개·실 잠금)', () => {
  let pool: mysql.Pool;
  let locker: mysql.Connection;    // LOCK TABLES 를 쥐는 세션(풀 밖) — 마이그레이션도 여기서
  let monitor: mysql.Connection;   // PROCESSLIST·행 수 관찰(풀 밖)
  const opts = () => ({
    host: '127.0.0.1', port: Number(PORT), user: 'root', password: process.env.T112_IMPL_DB_PASSWORD, database: DBNAME, timezone: '+09:00',
  });
  type CorePool = { _allConnections: { length: number }; _freeConnections: { length: number } };
  const core = () => (pool as unknown as { pool: CorePool }).pool;
  const busy = () => core()._allConnections.length - core()._freeConnections.length;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  async function until(cond: () => boolean | Promise<boolean>, ms: number): Promise<boolean> {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await cond()) return true; await sleep(50); }
    return cond();
  }
  async function within<T>(p: Promise<T>, ms: number): Promise<T | 'late'> {
    let t: ReturnType<typeof setTimeout> | undefined;
    const r = await Promise.race([p, new Promise<'late'>((res) => { t = setTimeout(() => res('late'), ms); })]);
    clearTimeout(t);
    return r;
  }
  /** 받은 연결(획득 1회)마다 release·destroy 횟수 */
  // (T-139) 기록 스위치 읽기(`record-switch.ts`)도 풀에서 **자기** 연결을 받는다 — 연결마다 처음 보낸 문장으로 갈라, 스위치 SELECT 로 시작한
  //   연결은 swEndStats 로 따로 세고 endStats 는 예전처럼 기록(upsert) 쪽 연결(문장 없이 끝난 늦은 연결 포함)만 센다.
  type EndRec = { r: number; d: number; first: string | null };
  const ends = new Map<object, EndRec>();
  function instrument(p: mysql.Pool): void {
    const real = p.getConnection.bind(p);
    (p as unknown as { getConnection: () => Promise<mysql.PoolConnection> }).getConnection = async () => {
      const c = await real();
      const e: EndRec = { r: 0, d: 0, first: null };
      ends.set(c, e);
      const rel = c.release.bind(c);
      const des = c.destroy.bind(c);
      const q = (c.query as unknown as (...a: unknown[]) => unknown).bind(c);
      c.release = () => { e.r++; rel(); };
      c.destroy = () => { e.d++; des(); };
      (c as unknown as { query: (...a: unknown[]) => unknown }).query = (...a: unknown[]) => { if (e.first === null) e.first = String(a[0]); return q(...a); };
      return c;
    };
  }
  const isSwitchConn = (e: EndRec) => e.first !== null && e.first.startsWith('SELECT value FROM system_config');
  const statsOf = (v: EndRec[]) => ({
    conns: v.length, releases: v.reduce((a, e) => a + e.r, 0), destroys: v.reduce((a, e) => a + e.d, 0),
    multi: v.filter((e) => e.r + e.d > 1).length, never: v.filter((e) => e.r + e.d === 0).length,
  });
  const endStats = () => statsOf([...ends.values()].filter((e) => !isSwitchConn(e)));
  const swEndStats = () => statsOf([...ends.values()].filter(isSwitchConn));
  const waiters = async () => {
    const [r] = await monitor.query("SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST WHERE INFO LIKE 'INSERT INTO job_run_log%'") as [Array<{ n: number }>, unknown];
    return Number(r[0].n);
  };
  const rowCount = async () => {
    const [r] = await monitor.query('SELECT COUNT(*) AS n FROM job_run_log') as [Array<{ n: number }>, unknown];
    return Number(r[0].n);
  };
  /** 배치 k — 하루 1회 잡의 서로 다른 날(k)이라 늦게 써지면 반드시 새 행이 생긴다(멱등 ODKU 에 묻히지 않게) + 매 분 잡 1줄(롤업 문장도 보내게) */
  const batch = (k: number) => [
    line('edgar-sync', 200, `2026-0${1 + Math.floor(k / 28)}-${String(1 + (k % 28)).padStart(2, '0')} 07:00:01`, 1000, { ok: true }),
    line('entry-watcher', 200, `2026-0${1 + Math.floor(k / 28)}-${String(1 + (k % 28)).padStart(2, '0')} 10:00:01`, 100),
  ].join('\n');
  const note = (m: string) => { process.stdout.write(`[T-135 G 관찰] ${m}\n`); };
  let seq = 0;

  beforeAll(async () => {
    pool = mysql.createPool({ ...opts(), connectionLimit: 10, waitForConnections: true, queueLimit: 0 });
    instrument(pool);
    mockPool = pool;
    locker = await mysql.createConnection({ ...opts(), multipleStatements: true });
    monitor = await mysql.createConnection(opts());
    await locker.query(SQL);   // CREATE TABLE IF NOT EXISTS — 이미 있으면 그대로
    await locker.query('CREATE TABLE IF NOT EXISTS system_config (`key` VARCHAR(100) NOT NULL PRIMARY KEY, value TEXT NULL) DEFAULT CHARSET=utf8mb4');
    await locker.query("INSERT INTO system_config (`key`, value) VALUES ('job_run_log_enabled', 'true') ON DUPLICATE KEY UPDATE value = 'true'");
    await locker.query('DELETE FROM job_run_log');
  });
  afterAll(async () => {
    try { await locker?.query('UNLOCK TABLES'); } catch { /* 흡수 */ }
    await locker?.end();
    await monitor?.end();
    await pool?.end();
    mockPool = null;
  });
  beforeEach(() => {
    ends.clear();
    resetRecordSwitchCacheForTest();
    resetJobRunLogWarningsForTest();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { jest.restoreAllMocks(); });

  test('G1. 정상 30배치 — 매번 연결이 풀로 돌아온다(바쁜 연결 0), 배치마다 연결 하나(실행 행·롤업 2문장)·release', async () => {
    const r0 = await rowCount();
    for (let i = 0; i < 30; i++) {
      await expect(recordSpoolBatch(batch(seq++))).resolves.toMatchObject({ status: 'ok', runRows: 1, rollupRows: 1 });
      expect(busy()).toBe(0);
    }
    expect(endStats()).toEqual({ conns: 30, releases: 30, destroys: 0, multi: 0, never: 0 });
    expect(swEndStats()).toEqual({ conns: 1, releases: 1, destroys: 0, multi: 0, never: 0 });   // (T-139) 스위치는 30초 캐시 — 첫 기록에서 1번, 자기 연결 release
    expect((await rowCount()) - r0).toBe(60);
  }, 60_000);

  test('🔴 G2. 표를 잠근 채 12배치 동시 × 2회(24배치) — 전부 failed(timeout), 매번 바쁜 연결 0·무관한 SELECT 1 통과, 대기 upsert 소멸, 늦은 행 0', async () => {
    const before = await rowCount();
    await locker.query('LOCK TABLES job_run_log WRITE');
    try {
      for (let round = 0; round < 2; round++) {
        const t0 = Date.now();
        const res = await Promise.all(Array.from({ length: 12 }, () => recordSpoolBatch(batch(seq++))));
        const ms = Date.now() - t0;
        expect(res.map((r) => `${r.status}/${r.reason}`)).toEqual(Array(12).fill('failed/timeout'));
        expect(ms).toBeLessThan(JRL_DEADLINE_MS + 1500);
        expect(await until(() => busy() === 0, 2000)).toBe(true);
        const q0 = Date.now();
        const sel = await within(pool.query('SELECT 1 AS ok'), 3000);
        expect(sel).not.toBe('late');
        const selMs = Date.now() - q0;
        const w0 = await waiters();
        const gone = await until(async () => (await waiters()) === 0, 10_000);   // 잠금은 쥔 채 — 끊긴 연결의 대기 upsert 를 서버가 거둔다
        note(`round ${round + 1}: 12배치 ${ms}ms 에 전부 timeout · 풀 all=${core()._allConnections.length} free=${core()._freeConnections.length} busy=${busy()} · 무관한 SELECT 1 ${selMs}ms · 서버 대기 upsert 직후 ${w0}개 → ${gone ? '0개(소멸)' : `${await waiters()}개 남음`}`);
        expect(gone).toBe(true);
      }
    } finally {
      await locker.query('UNLOCK TABLES');
    }
    await sleep(1500);
    const late = (await rowCount()) - before;
    note(`잠금 해제 뒤 늦게 써진 행 ${late}개(시도 24배치 — 배치마다 새 행 2개가 될 값) · 연결 ${JSON.stringify(endStats())}`);
    expect(late).toBe(0);
    expect(await until(() => endStats().never === 0, 3000)).toBe(true);
    expect(endStats().multi).toBe(0);
    resetRecordSwitchCacheForTest();
    await expect(recordSpoolBatch(batch(seq++))).resolves.toMatchObject({ status: 'ok' });
    expect(busy()).toBe(0);
  }, 90_000);

  test('G3. 오류 경로(테이블 없음 1146) 5배치 — 연결은 destroy·바쁜 연결 0, 표를 되돌리면 다시 기록', async () => {
    await locker.query('RENAME TABLE job_run_log TO job_run_log_t135bak');
    try {
      for (let i = 0; i < 5; i++) {
        await expect(recordSpoolBatch(batch(seq++))).resolves.toMatchObject({ status: 'skipped_no_table' });
        expect(busy()).toBe(0);
      }
    } finally {
      await locker.query('RENAME TABLE job_run_log_t135bak TO job_run_log');
    }
    expect(endStats()).toEqual({ conns: 5, releases: 0, destroys: 5, multi: 0, never: 0 });
    expect(swEndStats()).toEqual({ conns: 1, releases: 1, destroys: 0, multi: 0, never: 0 });   // (T-139) 스위치 연결은 표 없음과 무관하게 release
    await expect(recordSpoolBatch(batch(seq++))).resolves.toMatchObject({ status: 'ok' });
    expect(busy()).toBe(0);
  }, 30_000);
});
