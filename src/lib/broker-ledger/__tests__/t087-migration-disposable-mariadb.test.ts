/**
 * T-087 (T-081 WP-D1a) — **일회용 MariaDB 실증 시험** (평소 jest 실행에서는 건너뛴다 — `T087_TEST_DB_PORT` 가 없으면 skip).
 *
 * 무엇을 실제 DB 로 확인하나:
 *  A. 마이그레이션(`scripts/migrations/T-081-wpd-broker-fills.sql`) — 적용 전 1146 · 2회 적용 멱등(2회차 경고 "이미 있음" 5건) · 테이블 5개·콜레이션·
 *     bin 열 · CHECK 42개(테이블별 12·13·3·7·7 — JSON 열 자동 CHECK 4개 포함) · FK·UNIQUE · 생성열 effective_to 두 경우 · 부모 먼저 DROP → 1451 ·
 *     되돌리기(주석의 DROP 5줄) 2회 → 테이블 0 · 재적용 → 42개 · 본문이 초안(docs/design/drafts/…sql.draft)과 같다
 *  B. CHECK 동작 대표 사례 — complete 조건(tr_cont 분기 N-1·합계·호출·페이지)·짝(kind/market↔TR)·85일 경계·positive_check·날짜 0000·통화 bin·
 *     수수료 짝·세금 매도 전용·환율 none·파생 표지·자연키 중복·FK
 *  C. 계약 — Dev-1 정규화 출력(`normalize.ts`)이 DDL 에 그대로 들어가고 DECIMAL·DATE·TIME 문자열이 왕복 보존된다
 *
 * 실행(운영·공용 DB 금지 — 127.0.0.1 에만 묶인 일회용 컨테이너, 로컬 이미지만, 끝나면 제거):
 *   docker run -d --rm --name t087-dev1-mariadb -p 127.0.0.1:33287:3306 -e MARIADB_ROOT_PASSWORD=t087test -e MARIADB_DATABASE=t087 \
 *     mariadb:10.11 --sql-mode=IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION \
 *     --character-set-server=utf8mb3 --collation-server=utf8mb3_general_ci
 *   T087_TEST_DB_PORT=33287 T087_TEST_DB_PASSWORD=t087test node node_modules/jest/bin/jest.js src/lib/broker-ledger/__tests__/t087-migration-disposable-mariadb.test.ts
 *   docker rm -f t087-dev1-mariadb
 * sql_mode·서버 문자셋은 운영(10.11.11) 실측값과 같다. `accounts` 는 FK 대상 스탠드인(운영 SHOW CREATE TABLE 실측 형태, T-074 시험과 같다). 값은 전부 합성.
 */
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { normalizeFills, normalizeRealizedPnl, normalizePositionSnapshot } from '../normalize';
import { domFillRow, ovsFillRow, domPnlRow, ovsPnlRow, domPosRow, ovsPosRow } from './helpers/kis-fixtures';

const PORT = process.env.T087_TEST_DB_PORT;
const maybe = PORT ? describe : describe.skip;
const REPO = path.join(__dirname, '..', '..', '..', '..');
const MIGRATION = path.join(REPO, 'scripts', 'migrations', 'T-081-wpd-broker-fills.sql');
const DRAFT = path.join(REPO, 'docs', 'design', 'drafts', 'T-081-wpd-broker-fills.sql.draft');
const TABLES = ['broker_fill_runs', 'broker_fills', 'broker_fill_revisions', 'broker_realized_pnl', 'broker_position_snapshots'];

function statements(sql: string): string[] {
  return sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n').split(';').map((s) => s.trim()).filter(Boolean);
}
function rollbackStatements(sql: string): string[] {
  const tail = sql.slice(sql.indexOf('-- 되돌리기'));
  return tail.split('\n').filter((l) => /^-- DROP /.test(l)).map((l) => l.replace(/^-- /, '').replace(/;\s*$/, ''));
}

const ACCOUNTS_DDL = `CREATE TABLE accounts (
  id int(11) NOT NULL AUTO_INCREMENT, exchange varchar(16) NOT NULL, label varchar(64) NOT NULL,
  created_at datetime NOT NULL DEFAULT current_timestamp(), PRIMARY KEY (id), UNIQUE KEY uq_exchange_label (exchange,label)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`;

const FP = '0123456789abcdef';
type Err = { errno?: number; code?: string; sqlMessage?: string } | null;

// A-0 은 순수 파일 비교라 DB 환경변수와 무관하게 **항상** 돈다(Reviewer L3) — 승격본 DDL 본문이 초안과 같다는 상시 보증.
describe('T-087 마이그레이션 파일 정적 보증(DB 불필요)', () => {
  test('A-0. 마이그레이션 DDL 본문(SET 이후)이 초안과 같다 — 승격 때 의미를 바꾸지 않았다', () => {
    const migration = fs.readFileSync(MIGRATION, 'utf8');
    const body = (s: string) => {
      const i = s.indexOf('SET SESSION lock_wait_timeout');
      expect(i).toBeGreaterThan(0);
      return s.slice(i);
    };
    expect(body(migration)).toBe(body(fs.readFileSync(DRAFT, 'utf8')));
    expect(statements(migration)).toHaveLength(6);   // SET + CREATE 5
    expect(rollbackStatements(migration)).toHaveLength(5);
  });
});

maybe('T-087 마이그레이션 일회용 MariaDB 실증', () => {
  let pool: mysql.Pool;
  let conn: mysql.PoolConnection;
  const migration = fs.readFileSync(MIGRATION, 'utf8');
  const q = <T = mysql.RowDataPacket[]>(sql: string, v: unknown[] = []) => conn.query(sql, v as never).then(([r]) => r as unknown as T);
  const errOf = async (p: Promise<unknown>): Promise<Err> => { try { await p; return null; } catch (e) { return e as Err; } };
  const apply = async () => {
    let warn1050 = 0;
    for (const s of statements(migration)) {
      await conn.query(s);
      const w = await q<{ Code: number }[]>('SHOW WARNINGS');
      warn1050 += w.filter((x) => Number(x.Code) === 1050).length;
    }
    return warn1050;
  };
  const tableCount = async () => (await q<{ n: number }[]>(
    "SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'broker\\_%'"))[0].n;
  const checkCounts = async () => Object.fromEntries((await q<{ t: string; n: number }[]>(
    "SELECT TABLE_NAME AS t, COUNT(*) AS n FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'broker\\_%' GROUP BY TABLE_NAME"))
    .map((r) => [r.t, Number(r.n)]));

  const RUN_DEFAULT: Record<string, unknown> = {
    account_id: 1, account_fingerprint: FP, broker: 'kis', market: 'domestic', kind: 'fills', source_tr: 'TTTC0081R',
    window_from: '2026-11-03', window_to: '2026-11-05', query_from: '2026-11-03', query_to: '2026-11-05', date_basis: 'unknown',
    trigger_kind: 'cron', started_at: '2026-11-05 07:21:00', finished_at: '2026-11-05 07:21:05', status: 'complete',
    last_tr_cont: 'E', sum_check: 'match', positive_check: 'pending', pages: 1, kis_calls: 1,
  };
  const insRun = async (o: Record<string, unknown> = {}) => {
    const row = { ...RUN_DEFAULT, ...o };
    for (const k of Object.keys(row)) if (row[k] === undefined) delete row[k];
    const keys = Object.keys(row);
    const [r] = await conn.query(`INSERT INTO broker_fill_runs (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, Object.values(row) as never);
    return (r as mysql.ResultSetHeader).insertId;
  };
  const insInto = async (table: string, row: Record<string, unknown>) => {
    const keys = Object.keys(row);
    const [r] = await conn.query(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, Object.values(row) as never);
    return (r as mysql.ResultSetHeader).insertId;
  };

  beforeAll(async () => {
    pool = mysql.createPool({
      host: '127.0.0.1', port: Number(PORT), user: 'root', password: process.env.T087_TEST_DB_PASSWORD, database: process.env.T087_TEST_DB_NAME ?? 't087',
      connectionLimit: 2, timezone: '+09:00', dateStrings: true,
    });
    conn = await pool.getConnection();
    for (const t of [...TABLES].reverse()) await conn.query(`DROP TABLE IF EXISTS ${t}`);
    await conn.query('DROP TABLE IF EXISTS accounts');
    await conn.query(ACCOUNTS_DDL);
    await conn.query("INSERT INTO accounts (exchange, label) VALUES ('kis', 'default')");
  });
  afterAll(async () => { conn?.release(); await pool?.end(); });

  test('환경: 운영과 같은 STRICT sql_mode · 서버 utf8mb3 · 10.11', async () => {
    const [row] = await q<{ m: string; v: string; c: string }[]>('SELECT @@sql_mode AS m, VERSION() AS v, @@collation_server AS c');
    expect(row.m).toContain('STRICT_TRANS_TABLES');
    expect(row.m).not.toContain('NO_ZERO_DATE');
    expect(row.c).toBe('utf8mb3_general_ci');
    expect(row.v).toMatch(/^10\.11\./);
    console.info(`[t087-db] ${row.v} · ${row.m} · ${row.c}`);
  });

  test('A-1. 적용 전: 1146', async () => {
    expect((await errOf(q('SELECT 1 FROM broker_fill_runs LIMIT 1')))?.errno).toBe(1146);
  });

  test('A-2. 2회 적용 멱등 — 1회차 경고 0, 2회차 "이미 있음"(1050) 5건, 오류 0', async () => {
    expect(await apply()).toBe(0);
    expect(await apply()).toBe(5);
    expect(await tableCount()).toBe(5);
  });

  test('A-3. 테이블 콜레이션 utf8mb4_general_ci · currency·last_tr_cont 는 utf8mb4_bin · broker_order_no 는 테이블 기본', async () => {
    const t = await q<{ n: string; c: string }[]>("SELECT TABLE_NAME AS n, TABLE_COLLATION AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'broker\\_%'");
    expect(t.map((r) => r.c)).toEqual(Array(5).fill('utf8mb4_general_ci'));
    const cols = await q<{ t: string; c: string; k: string | null }[]>(
      "SELECT TABLE_NAME AS t, COLUMN_NAME AS c, COLLATION_NAME AS k FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME IN ('currency','last_tr_cont','broker_order_no')");
    for (const r of cols) expect(r.k).toBe(r.c === 'broker_order_no' ? 'utf8mb4_general_ci' : 'utf8mb4_bin');
    expect(cols.length).toBe(5);   // currency 3 + last_tr_cont 1 + broker_order_no 1
  });

  test('A-4. CHECK 42개(runs 12 · fills 13 · revisions 3 · pnl 7 · snapshots 7 — JSON 열 자동 CHECK 4 포함) · FK 11(runs 1·fills 3·revisions 2·pnl 3·snapshots 2) · UNIQUE 4(자연키 3 + revisions)', async () => {
    expect(await checkCounts()).toEqual({ broker_fill_runs: 12, broker_fills: 13, broker_fill_revisions: 3, broker_realized_pnl: 7, broker_position_snapshots: 7 });
    expect(Object.values(await checkCounts()).reduce((a, b) => a + b, 0)).toBe(42);
    const fk = await q<{ n: number }[]>("SELECT COUNT(*) AS n FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'broker\\_%'");
    expect(Number(fk[0].n)).toBe(11);
    const uq = await q<{ k: string }[]>("SELECT DISTINCT INDEX_NAME AS k FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND NON_UNIQUE = 0 AND INDEX_NAME <> 'PRIMARY' AND TABLE_NAME LIKE 'broker\\_%' ORDER BY k");
    expect(uq.map((r) => r.k).sort()).toEqual(['uq_bf_natural', 'uq_bfrv_fill_rev', 'uq_bps_natural', 'uq_brp_natural']);
  });

  test('A-5. 생성열 effective_to — 실행이 창 뒤면 window_to 24:00, 창 안이면 started_at · 명시 값은 거부', async () => {
    const a = await insRun({ window_from: '2026-11-01', window_to: '2026-11-03', query_from: '2026-11-01', query_to: '2026-11-03' });
    const b = await insRun({ started_at: '2026-11-05 07:21:00' });
    const rows = await q<{ id: number; e: string }[]>('SELECT id, effective_to AS e FROM broker_fill_runs WHERE id IN (?, ?) ORDER BY id', [a, b]);
    expect(rows.map((r) => r.e)).toEqual(['2026-11-04 00:00:00', '2026-11-05 07:21:00']);
    expect(await errOf(insRun({ effective_to: '2026-11-09 00:00:00' } as Record<string, unknown>))).not.toBeNull();
  });

  describe('B. CHECK 동작(대표 사례)', () => {
    const REJ = 4025;   // ER_CONSTRAINT_FAILED
    const rej = async (o: Record<string, unknown>) => (await errOf(insRun(o)))?.errno;
    const ok = async (o: Record<string, unknown>) => expect(await errOf(insRun(o))).toBeNull();

    test('complete — 연속 TR 은 last_tr_cont D/E 명시 필수(NULL·M·F·소문자 거부)', async () => {
      await ok({});
      await ok({ last_tr_cont: 'D' });
      for (const v of [null, 'M', 'F', 'd', 'e']) expect(await rej({ last_tr_cont: v })).toBe(REJ);
      await ok({ status: 'incomplete', last_tr_cont: 'M', sum_check: 'mismatch' });
    });

    test('complete — 잔고 스냅샷(N-1)은 빈 헤더(NULL)·D/E 허용, M 거부, 합계 대조 mismatch 거부', async () => {
      const snap = { market: 'overseas', kind: 'position_snapshot', source_tr: 'CTRP6504R', window_from: '2026-11-05', window_to: '2026-11-05',
        query_from: '2026-11-05', query_to: '2026-11-05', positive_check: 'n/a' };
      await ok({ ...snap, last_tr_cont: null });
      await ok({ ...snap, last_tr_cont: 'D' });
      await ok({ ...snap, market: 'domestic', source_tr: 'TTTC8434R', last_tr_cont: null });
      expect(await rej({ ...snap, last_tr_cont: 'M' })).toBe(REJ);
      expect(await rej({ ...snap, last_tr_cont: null, sum_check: 'mismatch' })).toBe(REJ);
      expect(await rej({ ...snap, window_from: '2026-11-04', query_from: '2026-11-04' })).toBe(REJ);   // 하루 창만
      expect(await rej({ ...snap, positive_check: 'pending' })).toBe(REJ);
    });

    test('complete — pages·kis_calls ≥ 1, duplicate_keys 0, sum_check match/unavailable(해외 체결만)', async () => {
      expect(await rej({ pages: 0 })).toBe(REJ);
      expect(await rej({ kis_calls: 0 })).toBe(REJ);
      expect(await rej({ duplicate_keys: 1 })).toBe(REJ);
      expect(await rej({ sum_check: 'unavailable' })).toBe(REJ);   // 국내 체결
      await ok({ market: 'overseas', source_tr: 'TTTS3035R', sum_check: 'unavailable', query_from: '2026-11-02', query_to: '2026-11-06', last_tr_cont: 'D' });
      expect(await rej({ market: 'overseas', kind: 'realized_pnl', source_tr: 'TTTS3039R', sum_check: 'unavailable', last_tr_cont: 'D' })).toBe(REJ);
      await ok({ status: 'failed', pages: 0, kis_calls: 0, sum_check: 'pending', last_tr_cont: null });
    });

    test('짝 CHECK — kind↔TR, market↔TR (모의 V 접두 허용)', async () => {
      expect(await rej({ source_tr: 'TTTC8708R' })).toBe(REJ);
      expect(await rej({ market: 'overseas', query_from: '2026-11-02', query_to: '2026-11-06' })).toBe(REJ);
      await ok({ source_tr: 'VTTC0081R' });
      await ok({ kind: 'realized_pnl', source_tr: 'TTTC8708R' });
    });

    test('85일 경계(L-3) — query_from = DATE(started_at)−85 수용, −86 거부(failed 행도)', async () => {
      await ok({ window_from: '2026-08-12', query_from: '2026-08-12' });
      expect(await rej({ window_from: '2026-08-11', query_from: '2026-08-11' })).toBe(REJ);
      expect(await rej({ window_from: '2026-08-11', query_from: '2026-08-11', status: 'failed', pages: 0, kis_calls: 0, last_tr_cont: null, sum_check: 'pending' })).toBe(REJ);
    });

    test('positive_check / finished / 창 범위 / 날짜 0000', async () => {
      expect(await rej({ status: 'incomplete', positive_check: 'confirmed' })).toBe(REJ);
      await ok({ positive_check: 'confirmed' });
      expect(await rej({ positive_check: 'n/a' })).toBe(REJ);
      expect(await rej({ finished_at: '2026-11-05 07:20:59' })).toBe(REJ);
      expect(await rej({ status: 'running', finished_at: '2026-11-05 07:21:05' })).toBe(REJ);
      await ok({ status: 'running', finished_at: null, last_tr_cont: null, sum_check: 'pending' });
      expect(await rej({ window_from: '2026-11-06' })).toBe(REJ);
      expect(await rej({ query_from: '2026-11-04' })).toBe(REJ);   // query ⊇ window
      expect(await rej({ window_from: '0000-00-00', query_from: '0000-00-00' })).toBe(REJ);
      expect(await rej({ account_fingerprint: '0123456789abcde' })).toBe(REJ);
    });

    test('broker_fills — 통화 bin · 수수료 짝 · 세금 매도 전용 · 환율 none · 파생 표지 · 자연키 1062 · FK 1452', async () => {
      const run = await insRun();
      const base = normalizeFills({ market: 'domestic', kind: 'fills', trId: 'TTTC0081R', rows: [domFillRow({ odno: '0000077777' })] }).items[0].row;
      const meta = { account_id: 1, account_fingerprint: FP, first_seen_at: '2026-11-05 07:21:01', last_seen_at: '2026-11-05 07:21:01', first_run_id: run, last_run_id: run };
      const fill = (o: Record<string, unknown> = {}) => insInto('broker_fills', { ...base, ...meta, ...o });
      expect(await errOf(fill())).toBeNull();
      expect((await errOf(fill()))?.errno).toBe(1062);
      expect((await errOf(fill({ broker_order_no: '0000077778', currency: 'krw' })))?.errno).toBe(REJ);
      expect((await errOf(fill({ broker_order_no: '0000077779', order_date: '0000-00-00' })))?.errno).toBe(REJ);
      expect((await errOf(fill({ broker_order_no: '0000077780', fee_kind: 'estimated', fee_native: '1.000000' })))?.errno).toBe(REJ);
      expect((await errOf(fill({ broker_order_no: '0000077781', tax_native: '1.000000', derived_for_revision: 1 })))?.errno).toBe(REJ);   // 매수 행 세금
      expect((await errOf(fill({ broker_order_no: '0000077782', fx_usdkrw: '1400.0000' })))?.errno).toBe(REJ);   // fx_source none
      expect((await errOf(fill({ broker_order_no: '0000077783', fee_kind: 'allocated', fee_native: '1.000000' })))?.errno).toBe(REJ);   // D2 값인데 표지 없음
      expect((await errOf(fill({ broker_order_no: '0000077784', derived_for_revision: 2 })))?.errno).toBe(REJ);   // > revision
      expect((await errOf(fill({ broker_order_no: '0000077785', filled_qty: '-1' })))?.errno).toBe(REJ);
      expect((await errOf(fill({ broker_order_no: '0000077786', first_run_id: 999999 })))?.errno).toBe(1452);
      // 대소문자만 다른 주문번호는 general_ci 에서 같은 키 — normalize 의 키 접기가 맞서는 근거
      expect(await errOf(fill({ broker_order_no: 'AB0001' }))).toBeNull();
      expect((await errOf(fill({ broker_order_no: 'ab0001' })))?.errno).toBe(1062);
    });

    test('broker_realized_pnl — day 는 symbol "" 강제, "" 끼리도 UNIQUE 로 막힌다 · broker_position_snapshots — 음수 수량 거부', async () => {
      const run = await insRun({ kind: 'realized_pnl', source_tr: 'TTTC8708R' });
      const p = normalizeRealizedPnl({ market: 'domestic', kind: 'realized_pnl', trId: 'TTTC8708R', rows: [domPnlRow({ trad_dt: '20261020' })] }).items[0].row;
      const meta = { account_id: 1, account_fingerprint: FP, first_seen_at: '2026-11-05 07:21:01', last_seen_at: '2026-11-05 07:21:01', first_run_id: run, last_run_id: run };
      expect(await errOf(insInto('broker_realized_pnl', { ...p, ...meta }))).toBeNull();
      expect((await errOf(insInto('broker_realized_pnl', { ...p, ...meta })))?.errno).toBe(1062);
      expect((await errOf(insInto('broker_realized_pnl', { ...p, ...meta, trade_date: '2026-10-21', symbol: 'X' })))?.errno).toBe(REJ);
      const srun = await insRun({ kind: 'position_snapshot', source_tr: 'TTTC8434R', window_from: '2026-11-05', query_from: '2026-11-05', positive_check: 'n/a' });
      const s = normalizePositionSnapshot({ market: 'domestic', kind: 'position_snapshot', trId: 'TTTC8434R', rows: [domPosRow()] }, '2026-11-05').items[0].row;
      const smeta = { account_id: 1, account_fingerprint: FP, captured_at: '2026-11-05 07:21:02', run_id: srun };
      expect(await errOf(insInto('broker_position_snapshots', { ...s, ...smeta, qty: '-1.00000000' })))
        .toMatchObject({ errno: REJ });
    });
  });

  test('C. 계약 — 정규화 출력이 DDL 에 그대로 들어가고 DECIMAL·DATE·TIME 문자열이 왕복 보존된다', async () => {
    const runD = await insRun({ window_from: '2026-11-03', query_from: '2026-11-03' });
    const runO = await insRun({ market: 'overseas', source_tr: 'TTTS3035R', sum_check: 'unavailable', query_from: '2026-11-02', query_to: '2026-11-06', last_tr_cont: 'D' });
    const fills = [
      ...normalizeFills({ market: 'domestic', kind: 'fills', trId: 'TTTC0081R', rows: [domFillRow({ odno: '0000088881', rmn_qty: '' }), domFillRow({ odno: '0000088882', tot_ccld_qty: '0', avg_prvs: '', tot_ccld_amt: '', rmn_qty: '5' })] }).items.map((x) => [x, runD] as const),
      ...normalizeFills({ market: 'overseas', kind: 'fills', trId: 'TTTS3035R', rows: [ovsFillRow({ odno: '0000088883', ft_ccld_qty: '0.12500000', ft_ord_qty: '0.125', ft_ccld_amt3: '12.65431', splt_buy_attr_name: '소수점' })] }).items.map((x) => [x, runO] as const),
    ];
    expect(fills).toHaveLength(3);
    for (const [it, run] of fills) {
      const fee = it.feeEstimate ?? {};
      await insInto('broker_fills', {
        ...it.row, ...fee, account_id: 1, account_fingerprint: FP,
        first_seen_at: '2026-11-05 07:21:01', last_seen_at: '2026-11-05 07:21:01', first_run_id: run, last_run_id: run,
      });
    }
    const got = await q<Record<string, unknown>[]>("SELECT * FROM broker_fills WHERE broker_order_no LIKE '00000888%' ORDER BY broker_order_no");
    expect(got).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      const want = fills[i][0].row;
      for (const k of Object.keys(want) as (keyof typeof want)[]) {
        if (k === 'raw_json') { expect(JSON.parse(String(got[i][k]))).toEqual(JSON.parse(want.raw_json)); continue; }
        expect([k, got[i][k] == null ? null : String(got[i][k])]).toEqual([k, want[k]]);
      }
    }
    expect(got[0]).toMatchObject({ settle_state: 'unknown', fee_kind: 'unknown', fee_native: null, amount_krw_est: '50000.00', revision: 1, derived_for_revision: null });
    expect(got[1]).toMatchObject({ filled_qty: '0.00000000', settle_state: 'open' });
    expect(got[2]).toMatchObject({ currency: 'USD', fee_kind: 'estimated', fee_rate_pct: '0.25000', fee_native: '0.031636', amount_krw_est: null, fx_source: 'none', fractional_hint: '소수점', fill_amount: '12.6543' });

    const runP = await insRun({ market: 'overseas', kind: 'realized_pnl', source_tr: 'TTTS3039R', query_from: '2026-11-02', query_to: '2026-11-06', last_tr_cont: 'D' });
    for (const it of normalizeRealizedPnl({ market: 'overseas', kind: 'realized_pnl', trId: 'TTTS3039R', rows: [ovsPnlRow(), ovsPnlRow({ ovrs_pdno: 'XMPB', ovrs_excg_cd: 'NYSE' })] }).items) {
      await insInto('broker_realized_pnl', { ...it.row, account_id: 1, account_fingerprint: FP, first_seen_at: '2026-11-05 07:21:01', last_seen_at: '2026-11-05 07:21:01', first_run_id: runP, last_run_id: runP });
    }
    const pnl = await q<Record<string, unknown>[]>("SELECT symbol, realized_pnl_native AS r, fx_usdkrw AS fx, grain FROM broker_realized_pnl WHERE market = 'overseas' ORDER BY symbol");
    expect(pnl).toEqual([
      { symbol: 'NAS:XMPL', r: '-7.4460', fx: '1400.0000', grain: 'day_symbol' },
      { symbol: 'NYS:XMPB', r: '-7.4460', fx: '1400.0000', grain: 'day_symbol' },
    ]);

    const runS = await insRun({ market: 'overseas', kind: 'position_snapshot', source_tr: 'CTRP6504R', window_from: '2026-11-05', query_from: '2026-11-05', query_to: '2026-11-05', window_to: '2026-11-05', positive_check: 'n/a', last_tr_cont: null });
    for (const it of normalizePositionSnapshot({ market: 'overseas', kind: 'position_snapshot', trId: 'CTRP6504R', rows: [ovsPosRow()] }, '2026-11-05').items) {
      await insInto('broker_position_snapshots', { ...it.row, account_id: 1, account_fingerprint: FP, captured_at: '2026-11-05 07:21:02', run_id: runS });
    }
    const snap = await q<Record<string, unknown>[]>("SELECT symbol, qty, avg_price_native AS a, as_of, cost_includes_fee AS c FROM broker_position_snapshots WHERE market = 'overseas'");
    expect(snap).toEqual([{ symbol: 'NAS:XMPL', qty: '3.00000000', a: '101.23450000', as_of: '2026-11-05', c: 'unknown' }]);
  });

  test('A-6. 부모 먼저 DROP → 1451(FK), 테이블은 남는다', async () => {
    expect((await errOf(q('DROP TABLE broker_fill_runs')))?.errno).toBe(1451);
    expect(await tableCount()).toBe(5);
  });

  test('A-7. 되돌리기(주석의 DROP 5줄) 2회 오류 0 → 테이블 0 · A-8. 재적용 → CHECK 42 · accounts 는 그대로', async () => {
    const rb = rollbackStatements(migration);
    expect(rb).toEqual(['DROP TABLE IF EXISTS broker_fill_revisions', 'DROP TABLE IF EXISTS broker_position_snapshots', 'DROP TABLE IF EXISTS broker_realized_pnl',
      'DROP TABLE IF EXISTS broker_fills', 'DROP TABLE IF EXISTS broker_fill_runs']);
    for (let i = 0; i < 2; i++) for (const s of rb) await conn.query(s);
    expect(await tableCount()).toBe(0);
    expect(await apply()).toBe(0);
    expect(Object.values(await checkCounts()).reduce((a, b) => a + b, 0)).toBe(42);
    expect((await q<{ n: number }[]>('SELECT COUNT(*) AS n FROM accounts'))[0].n).toBe(1);
  });
});
