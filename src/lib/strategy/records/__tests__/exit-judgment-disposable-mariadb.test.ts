/**
 * T-126 — 청산 판단 기록 **일회용 MariaDB 실증 시험** (평소 jest 실행에서는 정적 검사만 돌고 DB 부분은 건너뛴다 — `T126_DB_PORT` 가 있을 때만).
 *
 * 단위 시험(목 풀)은 SQL 문장 자체를 검증하지 못한다 — 열 이름 오타·ENUM·DECIMAL·CHECK·utf8mb4 문제가 있으면 기록기는 실패를 삼키므로
 * 운영에서 **조용히 아무것도 남지 않는다.** 그래서 실제 MariaDB 10.11 에 `scripts/migrations/T-126-exit-judgment.sql` 을 적용하고
 * 기록기가 만드는 문장(`buildExitJudgmentRow` → `buildExitJudgmentInsert`)을 그대로 넣어 본다.
 *
 *  A. (두 sql_mode — 서버 기본 strict 의 `query` 경로 / 세션에 NO_BACKSLASH_ESCAPES 를 더한 `execute` 준비문 경로)
 *     A1 2회 적용 멱등(2차 = Note 1050) · 테이블 1개 utf8mb4 · CHECK 2개 · 인덱스 = PK + 설계 D2 의 둘(UNIQUE 없음)
 *     A2 정상 행·경계값 multi-row(결론 5종·청산 종류 5종·DECIMAL 반올림/아주 작은 값/음수/0·수량 잡음·signal_id 최대·32자 종목·40자 run_id·
 *        48자 코드·이모지 48 코드포인트 엔진 릴리스) → 읽은 값이 넣은 값과 같다
 *     A3 같은 run_id·symbol 두 행 허용(분 단위 run_id 충돌 — UNIQUE 를 걸지 않은 이유)
 *     A4 ENUM·CHECK·길이·범위 위반(앱을 거치지 않은 값)은 strict 에서 거부 — errno 로 판별, 한 행만 틀려도 multi-row 문장 전체가 0행
 *     A5 앱이 자른 값은 들어가고(코드포인트 절단), 자르지 않은 값은 1406 으로 거부된다(절단이 필요한 이유)
 *  B. 끝에서 끝(서버 기본, 실물 기록기·스위치): 테이블 없음 → no_table · 스위치 키 없음 → disabled 0행 · 켬 → written · 'false' → disabled
 *  C. 🔴 (Reviewer R1) 실 풀 10개(운영 `db.ts` 와 같은 connectionLimit·queueLimit 0)·실 `LOCK TABLES`:
 *     C1 정상 30틱 — 매번 연결이 풀로 돌아온다(바쁜 연결 0) · C2 표를 잠근 채 12틱 동시 × 2회 — 전부 4초 timeout, 매번 바쁜 연결 0,
 *     무관한 `SELECT 1` 이 3초 안에 통과, 서버에 남은 INSERT·잠금 해제 뒤 늦게 써진 행 수를 관찰값으로 남긴다 · C3 오류 경로(테이블 없음)도 바쁜 연결 0
 *
 * 실행(운영·공용 DB 금지 — 127.0.0.1 에만 묶인 일회용 컨테이너, 끝나면 제거. 비밀번호·포트는 그때그때 임의로, 환경변수로만):
 *   T126_DB_PASSWORD="$(head -c 24 /dev/urandom | base64 | tr -dc A-Za-z0-9 | head -c 24)"; export T126_DB_PASSWORD
 *   T126_DB_PORT=$((33200 + RANDOM % 100)); export T126_DB_PORT
 *   docker run -d --rm --pull=never --name t126-dev-db -p 127.0.0.1:$T126_DB_PORT:3306 -e MARIADB_ROOT_PASSWORD="$T126_DB_PASSWORD" \
 *     -e MARIADB_DATABASE=t126impl mariadb:10.11 \
 *     --sql-mode=IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION \
 *     --character-set-server=utf8mb3 --collation-server=utf8mb3_general_ci
 *   npx jest src/lib/strategy/records/__tests__/exit-judgment-disposable-mariadb.test.ts
 *   docker rm -fv t126-dev-db
 * 값은 전부 합성값이다.
 */
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';

let mockPool: mysql.Pool | null = null;
jest.mock('@/lib/db', () => ({ getPool: () => { if (!mockPool) throw new Error('운영 풀 사용 금지(시험)'); return mockPool; } }));

import {
  EXIT_JUDGMENT_COLUMNS,
  EXIT_JUDGMENT_RECORD_TIMEOUT_MS,
  buildExitJudgmentInsert,
  buildExitJudgmentRow,
  recordExitJudgments,
  resetExitJudgmentForTest,
  type ExitJudgmentContext,
  type ExitJudgmentRow,
} from '../exit-judgment';
import { resetRecordSwitchCacheForTest } from '../record-switch';
import { isCheckViolation, isNoSuchTable, truncateCodePoints } from '../safe-text';

const PORT = process.env.T126_DB_PORT;
const DBNAME = process.env.T126_DB_NAME ?? 't126impl';
const maybe = PORT ? describe : describe.skip;
const MIGRATION = path.join(__dirname, '..', '..', '..', '..', '..', 'scripts', 'migrations', 'T-126-exit-judgment.sql');
const SQL = fs.readFileSync(MIGRATION, 'utf8');

function statements(sql: string): string[] {
  return sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n').split(';').map((s) => s.trim()).filter(Boolean);
}
function rollbackStatements(sql: string): string[] {
  return sql.split('\n').filter((l) => /^-- DROP TABLE /.test(l)).map((l) => l.replace(/^-- /, '').replace(/;\s*$/, ''));
}

describe('마이그레이션 파일 정적 검사(DB 없이)', () => {
  test('문장 2개 = SET SESSION lock_wait_timeout = 5 + CREATE TABLE IF NOT EXISTS exit_judgment — 가산 전용(다른 DDL·DML 없음)', () => {
    const st = statements(SQL);
    expect(st).toHaveLength(2);
    expect(st[0]).toBe('SET SESSION lock_wait_timeout = 5');
    expect(st[1].startsWith('CREATE TABLE IF NOT EXISTS exit_judgment (')).toBe(true);
    for (const s of st) expect(s).not.toMatch(/\b(ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE|RENAME|GRANT|REPLACE)\b/i);
  });
  test('🔴 (run_id, symbol) UNIQUE 없음 — 분 단위 run_id 가 겹치면 두 번째 틱 기록이 문장째 실패하므로', () => {
    expect(statements(SQL)[1]).not.toMatch(/\bUNIQUE\b/i);
  });
  test('외래키 없음 · 백슬래시 없음(NO_BACKSLASH_ESCAPES 여부와 무관)', () => {
    expect(statements(SQL)[1]).not.toMatch(/\b(FOREIGN|REFERENCES)\b/i);
    expect(SQL).not.toContain('\\');
  });
  test('되돌리기는 주석의 DROP 1줄뿐', () => {
    expect(rollbackStatements(SQL)).toEqual(['DROP TABLE IF EXISTS exit_judgment']);
  });
  test('앱 INSERT 열은 모두 DDL 에 있다 · 가상 주문(DRY_RUN) 열은 없다', () => {
    for (const c of EXIT_JUDGMENT_COLUMNS) expect(SQL).toMatch(new RegExp(`\\n  ${c}\\s`));
    expect(statements(SQL)[1]).not.toMatch(/\bdry_run\b/i);
  });
});

// ── 합성 행 ──────────────────────────────────────────────────────────────────
const T = Date.parse('2026-10-30T23:45:07+09:00');   // ET 10-30
const STYLE = { eodLossCutPct: 1.5, hardStopPct: 1.5, targetProfitPct: 2.5 };
const ctx = (market: 'domestic' | 'overseas', runId = `${market}-202610302345`): ExitJudgmentContext => ({
  market, runId, exitSwitch: { enabled: true, hardStopEnabled: false, source: 'config' }, style: STYLE,
});
const ST = { entryPrice: 100_000, peakPrice: 104_000, scenarioExit: null };
function sampleRows(): ExitJudgmentRow[] {
  const b = (...a: Parameters<typeof buildExitJudgmentRow>) => { const r = buildExitJudgmentRow(...a); if (!r) throw new Error('row'); return r; };
  return [
    b(ctx('overseas'), 'fired', 'signal_created', { symbol: 'NAS:MU', entry: { qty: 0.1 + 0.2, avgPrice: 100_000 }, ticker: { price: 98_123.456789123 }, state: ST, exitSig: { exitKind: 'hard_stop' }, signalId: Number.MAX_SAFE_INTEGER }, T),
    b(ctx('domestic'), 'skip_policy', 'exit_hard_stop_disabled', { symbol: '005930', entry: { qty: 999_999_999_999_999, avgPrice: 70_000 }, ticker: { price: 69_000 }, state: { entryPrice: 70_000, peakPrice: 70_000, scenarioExit: null }, exitSig: { exitKind: 'hard_stop' } }, T),
    b(ctx('domestic'), 'skip_cooldown', 'cooldown_exit', { symbol: '000660', entry: { qty: 1, avgPrice: 100 }, ticker: { price: 30 }, state: { entryPrice: 100, peakPrice: 100, scenarioExit: null }, exitSig: { exitKind: 'eod_loss_cut' } }, T),   // pnl −70(하한 경계)
    b(ctx('domestic'), 'no_fire', 'exit_no_fire', { symbol: '035720', entry: { qty: 2, avgPrice: 100 }, ticker: { price: 300 }, state: { entryPrice: 100, peakPrice: 300, scenarioExit: null } }, T),   // pnl +200(상한 경계)
    b(ctx('overseas'), 'error', 'exit_price_invalid', { symbol: 'NYS:' + 'X'.repeat(28), entry: { qty: 5, avgPrice: 0.0000001 }, ticker: { price: -5 } }, T),   // 32자·아주 작은 값·음수
    b(ctx('overseas'), 'error', 'exit_ticker_error', { symbol: 'AMS:ZERO', entry: { qty: 5, avgPrice: 0 } }, T),
    b(ctx('overseas'), 'skip_policy', 'quantity_below_min', { symbol: 'NAS:SC', entry: { qty: 1, avgPrice: 100 }, ticker: { price: 103 }, state: { entryPrice: 100, peakPrice: 110, scenarioExit: { targetLo: 3, targetHi: 9, stopLo: 2, stopHi: 6 } }, exitSig: { exitKind: 'target_profit' } }, T),
    b(ctx('overseas'), 'error', 'exit_create_failed', { symbol: 'NAS:TR', entry: { qty: 1, avgPrice: 100 }, ticker: { price: 104 }, state: { entryPrice: 100, peakPrice: 106, scenarioExit: null }, exitSig: { exitKind: 'trailing_stop' } }, T),
    b(ctx('domestic', 'x'.repeat(40)), 'error', 'x'.repeat(48), { symbol: '005380' }, T),
  ];
}

type Conn = mysql.Connection;
const MODES: Array<[string, boolean]> = [['서버 기본 sql_mode(앱 경로 query)', false], ['NO_BACKSLASH_ESCAPES 세션(execute)', true]];
const ERR = (e: unknown) => (e as { errno?: number }).errno;

for (const [modeName, nbe] of MODES) {
  maybe(`[${modeName}] T-126 exit_judgment DDL·삽입`, () => {
    let c: Conn;
    const exec = (sql: string, params: unknown[] = []) => (nbe ? c.execute(sql, params as never) : c.query(sql, params));
    beforeAll(async () => {
      c = await mysql.createConnection({
        host: '127.0.0.1', port: Number(PORT), user: 'root', password: process.env.T126_DB_PASSWORD, database: DBNAME, timezone: '+09:00', multipleStatements: true,
      });
      if (nbe) await c.query("SET SESSION sql_mode = CONCAT(@@SESSION.sql_mode, ',NO_BACKSLASH_ESCAPES')");
      await c.query('DROP TABLE IF EXISTS exit_judgment');
    });
    afterAll(async () => { await c?.end(); });

    test('A0. 세션 sql_mode — strict 포함, NBE 여부', async () => {
      const [r] = await c.query('SELECT @@SESSION.sql_mode AS m') as [Array<{ m: string }>, unknown];
      const m = r[0].m.split(',');
      expect(m).toContain('STRICT_TRANS_TABLES');
      expect(m.includes('NO_BACKSLASH_ESCAPES')).toBe(nbe);
    });

    test('A1. 2회 적용 멱등 — 1차 경고 0, 2차 Note 1050 · utf8mb4 · CHECK 2 · 인덱스 = PK + 2(UNIQUE 없음)', async () => {
      await c.query(SQL);
      const [w1] = await c.query('SHOW WARNINGS') as [unknown[], unknown];
      expect(w1).toHaveLength(0);
      await c.query(SQL);
      const [w2] = await c.query('SHOW WARNINGS') as [Array<{ Level: string; Code: number }>, unknown];
      expect(w2.map((w) => [w.Level, w.Code])).toEqual([['Note', 1050]]);
      const [t] = await c.query("SELECT TABLE_COLLATION AS co FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exit_judgment'") as [Array<{ co: string }>, unknown];
      expect(t).toHaveLength(1);
      expect(t[0].co.startsWith('utf8mb4')).toBe(true);
      const [ck] = await c.query("SELECT CONSTRAINT_NAME AS n FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'exit_judgment' ORDER BY 1") as [Array<{ n: string }>, unknown];
      expect(ck.map((x) => x.n)).toEqual(['chk_xj_code', 'chk_xj_pnl']);
      const [ix] = await c.query("SELECT INDEX_NAME AS n, NON_UNIQUE AS nu, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exit_judgment' GROUP BY INDEX_NAME, NON_UNIQUE ORDER BY 1") as [Array<{ n: string; nu: number; cols: string }>, unknown];
      expect(ix.map((x) => [x.n, Number(x.nu), x.cols])).toEqual([
        ['idx_evaluated_market', 1, 'evaluated_at,market'],
        ['idx_symbol_evaluated', 1, 'symbol,evaluated_at'],
        ['PRIMARY', 0, 'judgment_id'],
      ]);
    });

    test('🔴 A2. 앱이 만든 정상·경계 행 multi-row 1문장 — 읽은 값 = 넣은 값', async () => {
      await exec('DELETE FROM exit_judgment');
      const rows = sampleRows();
      const release = truncateCodePoints('🚀'.repeat(60), 48);
      const q = buildExitJudgmentInsert(rows, release);
      await exec(q.sql, q.params);
      const [w] = await c.query('SHOW WARNINGS') as [unknown[], unknown];
      expect(w).toEqual([]);   // 잘림·반올림 경고 0 — 앱이 열에 맞춰 넣었다
      const [got] = await c.query(`SELECT run_id, DATE_FORMAT(evaluated_at,'%Y-%m-%d %H:%i:%s') AS ev, DATE_FORMAT(session_date_kst,'%Y-%m-%d') AS dk,
             DATE_FORMAT(session_date_et,'%Y-%m-%d') AS de, market, symbol, CAST(position_qty AS CHAR) AS qty, CAST(entry_price AS CHAR) AS entry,
             CAST(peak_price AS CHAR) AS peak, CAST(price AS CHAR) AS price, currency, CAST(pnl_pct AS CHAR) AS pnl, trigger_kind,
             CAST(threshold_pct AS CHAR) AS th, decision, decision_code, exit_engine_enabled AS ee, exit_hard_stop_enabled AS hs,
             CAST(signal_id AS CHAR) AS sid, engine_release AS rel, CHAR_LENGTH(engine_release) AS rl
        FROM exit_judgment ORDER BY judgment_id`) as [Array<Record<string, unknown>>, unknown];
      expect(got).toHaveLength(rows.length);
      expect(got[0]).toEqual({
        run_id: 'overseas-202610302345', ev: '2026-10-30 23:45:07', dk: '2026-10-30', de: '2026-10-30', market: 'overseas', symbol: 'NAS:MU',
        qty: '0.300000000000000000', entry: '100000.00000000', peak: '104000.00000000', price: '98123.45678912', currency: 'KRW', pnl: '-1.8765',
        trigger_kind: 'hard_stop', th: '-1.5000', decision: 'fired', decision_code: 'signal_created', ee: 1, hs: 0,
        sid: '9007199254740991', rel: release, rl: 48,
      });
      expect(got[1]).toMatchObject({ market: 'domestic', de: null, qty: '999999999999999.000000000000000000', pnl: '-1.4286', th: '-1.5000', decision: 'skip_policy' });
      expect(got[2]).toMatchObject({ pnl: '-70.0000', trigger_kind: 'eod_loss_cut', th: '-1.5000', decision: 'skip_cooldown' });
      expect(got[3]).toMatchObject({ pnl: '200.0000', trigger_kind: 'none', th: null, decision: 'no_fire' });
      expect(got[4]).toMatchObject({ symbol: 'NYS:' + 'X'.repeat(28), entry: '0.00000010', price: '-5.00000000', currency: null, pnl: null });
      expect(got[5]).toMatchObject({ entry: '0.00000000', price: null, currency: null });
      expect(got[6]).toMatchObject({ trigger_kind: 'target_profit', th: null, decision_code: 'quantity_below_min' });   // 시나리오 포지션 — 임계 NULL
      expect(got[7]).toMatchObject({ trigger_kind: 'trailing_stop', th: null });
      expect(got[8]).toMatchObject({ run_id: 'x'.repeat(40), decision_code: 'x'.repeat(48), currency: 'KRW' });
    });

    test('A3. 같은 run_id·symbol 두 행 허용(같은 분 두 틱)', async () => {
      await exec('DELETE FROM exit_judgment');
      const [r] = sampleRows();
      const q = buildExitJudgmentInsert([r, { ...r, evaluated_at: '2026-10-30 23:45:59' }], null);
      await exec(q.sql, q.params);
      const [n] = await c.query("SELECT COUNT(*) AS n, COUNT(DISTINCT evaluated_at) AS d FROM exit_judgment WHERE run_id = 'overseas-202610302345' AND symbol = 'NAS:MU'") as [Array<{ n: number; d: number }>, unknown];
      expect([Number(n[0].n), Number(n[0].d)]).toEqual([2, 2]);
    });

    test.each([
      ['decision ENUM 밖', { decision: 'maybe' }, 1265],
      ['trigger_kind ENUM 밖', { trigger_kind: 'moon' }, 1265],
      ['market ENUM 밖', { market: 'crypto' }, 1265],
      ['decision_code 빈 문자열(CHECK)', { decision_code: '' }, 4025],
      ['pnl_pct < −100(CHECK)', { pnl_pct: -100.0001 }, 4025],
      ['pnl_pct 열 범위 밖', { pnl_pct: 1_000_000 }, 1264],
      ['symbol 33자', { symbol: 'S'.repeat(33) }, 1406],
      ['run_id 41자', { run_id: 'r'.repeat(41) }, 1406],
      ['decision_code 49자', { decision_code: 'c'.repeat(49) }, 1406],
      ['decision NULL', { decision: null }, 1048],
      ['evaluated_at 형식 밖', { evaluated_at: '2026-13-40 25:00:00' }, 1292],
    ] as const)('A4. 앱을 거치지 않은 값 — %s %j → errno %p, multi-row 문장 전체 0행', async (_n, patch, errno) => {
      await exec('DELETE FROM exit_judgment');
      const [good] = sampleRows();
      const bad = { ...good, ...patch } as unknown as ExitJudgmentRow;
      const q = buildExitJudgmentInsert([good, bad, good], null);
      let caught: unknown;
      try { await exec(q.sql, q.params); } catch (e) { caught = e; }
      expect(ERR(caught)).toBe(errno);
      if (errno === 4025) expect(isCheckViolation(caught)).toBe(true);
      const [n] = await c.query('SELECT COUNT(*) AS n FROM exit_judgment') as [Array<{ n: number }>, unknown];
      expect(Number(n[0].n)).toBe(0);
    });

    test('A5. 앱이 자른 값은 들어가고(이모지 48 코드포인트), 자르지 않은 49 코드포인트는 1406', async () => {
      await exec('DELETE FROM exit_judgment');
      const [r] = sampleRows();
      const ok = buildExitJudgmentInsert([r], truncateCodePoints('😀'.repeat(100), 48));
      await exec(ok.sql, ok.params);
      let caught: unknown;
      try { const q = buildExitJudgmentInsert([r], '😀'.repeat(49)); await exec(q.sql, q.params); } catch (e) { caught = e; }
      expect(ERR(caught)).toBe(1406);
      const [x] = await c.query('SELECT CHAR_LENGTH(engine_release) AS l FROM exit_judgment') as [Array<{ l: number }>, unknown];
      expect(x.map((v) => Number(v.l))).toEqual([48]);
    });
  });
}

maybe('B. 끝에서 끝 — 실물 기록기·스위치(서버 기본)', () => {
  beforeAll(async () => {
    mockPool = mysql.createPool({ host: '127.0.0.1', port: Number(PORT), user: 'root', password: process.env.T126_DB_PASSWORD, database: DBNAME, timezone: '+09:00', connectionLimit: 4 });
    await mockPool.query('CREATE TABLE IF NOT EXISTS system_config (`key` VARCHAR(64) PRIMARY KEY, value JSON NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
    await mockPool.query('DELETE FROM system_config');
    await mockPool.query('DROP TABLE IF EXISTS exit_judgment');
  });
  afterAll(async () => { await mockPool?.end(); mockPool = null; });
  beforeEach(() => {
    resetRecordSwitchCacheForTest();
    resetExitJudgmentForTest();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { jest.restoreAllMocks(); });

  test('B1. 테이블 없음(DDL 적용 전) → no_table(1146), 던지지 않는다', async () => {
    await mockPool!.query("INSERT INTO system_config (`key`, value) VALUES ('exit_judgment_record_enabled', 'true')");
    await expect(recordExitJudgments(sampleRows(), 0, 'overseas')).resolves.toMatchObject({ status: 'no_table' });
    let caught: unknown;
    try { await mockPool!.query('SELECT 1 FROM exit_judgment'); } catch (e) { caught = e; }
    expect(isNoSuchTable(caught)).toBe(true);
    await mockPool!.query('DELETE FROM system_config');
  });

  test('B2. 적용 → 스위치 키 없음 = disabled 0행 → 켬 = written(9행) → false = disabled', async () => {
    const conn = await mockPool!.getConnection();
    try { for (const s of statements(SQL)) await conn.query(s); } finally { conn.release(); }
    await expect(recordExitJudgments(sampleRows(), 0, 'overseas')).resolves.toEqual({ status: 'disabled' });
    await mockPool!.query("INSERT INTO system_config (`key`, value) VALUES ('exit_judgment_record_enabled', 'true')");
    resetRecordSwitchCacheForTest();
    await expect(recordExitJudgments(sampleRows(), 0, 'overseas')).resolves.toEqual({ status: 'written', rows: 9, dropped: 0 });
    await mockPool!.query("UPDATE system_config SET value = 'false' WHERE `key` = 'exit_judgment_record_enabled'");
    resetRecordSwitchCacheForTest();
    await expect(recordExitJudgments(sampleRows(), 0, 'overseas')).resolves.toEqual({ status: 'disabled' });
    const [n] = await mockPool!.query('SELECT COUNT(*) AS n FROM exit_judgment') as [Array<{ n: number }>, unknown];
    expect(Number(n[0].n)).toBe(9);
  });
});

maybe('C. 🔴 R1 — 표가 잠겨도 풀이 바닥나지 않는다(실물 기록기·실 풀 10개·실 잠금)', () => {
  let pool: mysql.Pool;
  let locker: mysql.Connection;    // LOCK TABLES 를 잡는 세션(풀 밖) — 마이그레이션도 여기서(SET SESSION lock_wait_timeout=5 가 풀 연결에 남지 않게)
  let monitor: mysql.Connection;   // PROCESSLIST 관찰용(풀 밖)
  const opts = () => ({ host: '127.0.0.1', port: Number(PORT), user: 'root', password: process.env.T126_DB_PASSWORD, database: DBNAME, timezone: '+09:00' });
  type CorePool = { _allConnections: { length: number }; _freeConnections: { length: number } };
  const core = () => (pool as unknown as { pool: CorePool }).pool;
  const busy = () => core()._allConnections.length - core()._freeConnections.length;
  const tick = (n: number) => sampleRows().slice(0, n);
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
  const insertWaiters = async () => {
    const [r] = await monitor.query("SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST WHERE INFO LIKE 'INSERT INTO exit_judgment%'") as [Array<{ n: number }>, unknown];
    return Number(r[0].n);
  };
  const rowCount = async (c: mysql.Connection) => {
    const [r] = await c.query('SELECT COUNT(*) AS n FROM exit_judgment') as [Array<{ n: number }>, unknown];
    return Number(r[0].n);
  };
  const note = (m: string) => { process.stdout.write(`[T-126 R1 관찰] ${m}\n`); };

  beforeAll(async () => {
    pool = mysql.createPool({ ...opts(), connectionLimit: 10, waitForConnections: true, queueLimit: 0 });
    mockPool = pool;
    locker = await mysql.createConnection(opts());
    monitor = await mysql.createConnection(opts());
    await locker.query('CREATE TABLE IF NOT EXISTS system_config (`key` VARCHAR(64) PRIMARY KEY, value JSON NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
    await locker.query('DELETE FROM system_config');
    await locker.query("INSERT INTO system_config (`key`, value) VALUES ('exit_judgment_record_enabled', 'true')");
    for (const st of statements(SQL)) await locker.query(st);
    await locker.query('DELETE FROM exit_judgment');
  });
  afterAll(async () => {
    try { await locker?.query('UNLOCK TABLES'); } catch { /* 흡수 */ }
    await locker?.end();
    await monitor?.end();
    await pool?.end();
    mockPool = null;
  });
  beforeEach(() => {
    resetRecordSwitchCacheForTest();
    resetExitJudgmentForTest();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { jest.restoreAllMocks(); });

  test('C1. 정상 30틱 — 매번 연결이 풀로 돌아온다(바쁜 연결 0, 연결 수 ≤ 10), 60행 저장', async () => {
    for (let i = 0; i < 30; i++) {
      await expect(recordExitJudgments(tick(2), 0, 'domestic')).resolves.toEqual({ status: 'written', rows: 2, dropped: 0 });
      expect(busy()).toBe(0);
    }
    expect(core()._allConnections.length).toBeLessThanOrEqual(10);
    expect(await rowCount(monitor)).toBe(60);
  }, 30_000);

  test('🔴 C2. 표를 잠근 채 12틱 동시 × 2회(24틱) — 전부 4초 timeout, 매번 바쁜 연결 0, 무관한 SELECT 1 이 3초 안에 통과', async () => {
    const before = await rowCount(monitor);
    await locker.query('LOCK TABLES exit_judgment WRITE');
    for (let round = 0; round < 2; round++) {
      const t0 = Date.now();
      const res = await Promise.all(Array.from({ length: 12 }, () => recordExitJudgments(tick(1), 0, 'domestic')));
      const ms = Date.now() - t0;
      expect(res.map((r) => r.status)).toEqual(Array(12).fill('timeout'));
      expect(ms).toBeLessThan(EXIT_JUDGMENT_RECORD_TIMEOUT_MS + 1500);
      // 상한에서 매달린 연결을 버렸고, 상한 뒤에 받은 연결(풀 10 < 12)은 쓰지 않고 돌려준다 → 바쁜 연결 0
      expect(await until(() => busy() === 0, 2000)).toBe(true);
      const q0 = Date.now();
      const sel = await within(pool.query('SELECT 1 AS ok'), 3000);
      expect(sel).not.toBe('late');
      note(`round ${round + 1}: 12틱 ${ms}ms 에 전부 timeout · 풀 all=${core()._allConnections.length} free=${core()._freeConnections.length} busy=${busy()} · 무관한 SELECT 1 ${Date.now() - q0}ms · 서버에 남은 INSERT ${await insertWaiters()}개`);
    }
    await locker.query('UNLOCK TABLES');
    expect(await until(async () => (await insertWaiters()) === 0, 5000)).toBe(true);
    const late = (await rowCount(monitor)) - before;
    note(`잠금 해제 뒤: 서버 INSERT 대기 0개 · 늦게 써진 행 ${late}개(시도 24행, 기록기는 모두 timeout 으로 보고 — 재시도 없음)`);
    expect(late).toBeGreaterThanOrEqual(0);
    expect(late).toBeLessThanOrEqual(24);
    // 잠금이 풀리면 다시 정상 기록, 누수 0
    resetRecordSwitchCacheForTest();
    await expect(recordExitJudgments(tick(1), 0, 'domestic')).resolves.toMatchObject({ status: 'written' });
    expect(busy()).toBe(0);
  }, 60_000);

  test('C3. 오류 경로(테이블 없음 1146) 5틱 — 연결을 버리고(destroy) 바쁜 연결 0, 표를 되돌리면 다시 기록', async () => {
    await locker.query('RENAME TABLE exit_judgment TO exit_judgment_t126bak');
    try {
      for (let i = 0; i < 5; i++) {
        await expect(recordExitJudgments(tick(1), 0, 'domestic')).resolves.toMatchObject({ status: 'no_table' });
        expect(busy()).toBe(0);
      }
    } finally {
      await locker.query('RENAME TABLE exit_judgment_t126bak TO exit_judgment');
    }
    await expect(recordExitJudgments(tick(1), 0, 'domestic')).resolves.toMatchObject({ status: 'written' });
    expect(busy()).toBe(0);
  }, 30_000);
});
