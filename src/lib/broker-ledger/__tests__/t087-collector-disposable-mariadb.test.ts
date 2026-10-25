/**
 * T-087 (T-081 WP-D1a) Dev-2 — 수집기·쓰기 계약·커버리지 **일회용 MariaDB 실증 시험** (`T087_TEST_DB_PORT` 가 없으면 skip — 기존 규약).
 *
 * KIS 는 부르지 않는다 — 조회 함수는 합성 픽스처(`helpers/kis-fixtures.ts`, 값 전부 가짜)를 돌려주는 모킹이다. 운영 DB 에 연결하지 않는다.
 * 풀은 운영과 같은 `timezone:'+09:00'`·dateStrings 없음(수집기가 DATETIME 을 DATE_FORMAT 문자열로만 다루는지 확인).
 *
 * 실행(127.0.0.1 에만 묶인 일회용 컨테이너, 로컬 이미지만, 끝나면 제거):
 *   docker run -d --rm --pull=never --name t087-dev2-mariadb -p 127.0.0.1:33400:3306 -e MARIADB_ROOT_PASSWORD=t087test -e MARIADB_DATABASE=t087 \
 *     mariadb:10.11 --sql-mode=IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION \
 *     --character-set-server=utf8mb3 --collation-server=utf8mb3_general_ci
 *   T087_TEST_DB_PORT=33400 T087_TEST_DB_PASSWORD=t087test node node_modules/jest/bin/jest.js src/lib/broker-ledger/__tests__/t087-collector-disposable-mariadb.test.ts
 *   docker rm -f t087-dev2-mariadb
 */
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';
import type { LedgerQueryResult } from '@/lib/exchanges/kis-ledger-query';
import {
  collectBrokerLedger, planJobWindow,
  type AccountFingerprintResult, type CollectResult, type CollectorDeps, type JobReport, type JobWindow, type LedgerFetchers,
} from '../collector';
import {
  CRON_SWITCH_KEY, COLLECTOR_LOCK_NAME, inRowTx, insertRunningRun, isHalted, upsertFill, kstDateTime,
  type SqlConnection, type SqlPool, type UpsertMeta,
} from '../store';
import { isStepCovered, loadCoverage } from '../coverage';
import { normalizeFills, queryRangeForWindow } from '../normalize';
import type { BrokerMarket, BrokerRunKind } from '../types';
import { toHttp } from '@/app/api/cron/broker-fills/wiring';
import {
  domFillRow, domFillSummary, ovsFillRow, domPnlRow, domPnlSummary, ovsPnlRow, ovsPnlSummary, domPosRow, domPosSummary, ovsPosRow, ovsPosSummary3,
} from './helpers/kis-fixtures';

const PORT = process.env.T087_TEST_DB_PORT;
const maybe = PORT ? describe : describe.skip;
const REPO = path.join(__dirname, '..', '..', '..', '..');
const MIGRATION = fs.readFileSync(path.join(REPO, 'scripts', 'migrations', 'T-081-wpd-broker-fills.sql'), 'utf8');
const DB = 't087c';
const DB_EMPTY = 't087c_nomig';

function statements(sql: string): string[] {
  return sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n').split(';').map((s) => s.trim()).filter(Boolean);
}
const ACCOUNTS_DDL = `CREATE TABLE accounts (
  id int(11) NOT NULL AUTO_INCREMENT, exchange varchar(16) NOT NULL, label varchar(64) NOT NULL,
  created_at datetime NOT NULL DEFAULT current_timestamp(), PRIMARY KEY (id), UNIQUE KEY uq_exchange_label (exchange,label)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`;
/** src/lib/db.ts setupDB 의 system_config 정의와 같은 모양 */
const SYSCFG_DDL = `CREATE TABLE system_config (
  \`key\` VARCHAR(64) PRIMARY KEY, value JSON NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

const FP = '0123456789abcdef';      // 합성 지문
const FP_OTHER = 'fedcba9876543210';
const TR: Record<BrokerMarket, Record<BrokerRunKind, string>> = {
  domestic: { fills: 'TTTC0081R', realized_pnl: 'TTTC8708R', position_snapshot: 'TTTC8434R' },
  overseas: { fills: 'TTTS3035R', realized_pnl: 'TTTS3039R', position_snapshot: 'CTRP6504R' },
};
type JobKey = `${BrokerMarket}/${BrokerRunKind}`;
type Q = { from: string; to: string } | null;
type Plan = Partial<Record<JobKey, (q: Q, base: LedgerQueryResult) => Partial<LedgerQueryResult> | 'throw'>>;

const T0 = Date.parse('2026-11-03T07:21:00+09:00');   // 화요일 KST

function rowsFor(k: JobKey): { rows: Record<string, unknown>[]; summaries: unknown[]; lastTrCont: string | null } {
  switch (k) {
    case 'domestic/fills': {
      const rows = [domFillRow({ odno: '0000010001', ord_dt: '20261102' }), domFillRow({ odno: '0000010002', ord_dt: '20261103', sll_buy_dvsn_cd: '01' })];
      return { rows, summaries: [domFillSummary(rows)], lastTrCont: 'E' };
    }
    case 'domestic/realized_pnl': {
      const rows = [domPnlRow({ trad_dt: '20261102' })];
      return { rows, summaries: [domPnlSummary(rows)], lastTrCont: 'D' };
    }
    case 'domestic/position_snapshot': {
      const rows = [domPosRow()];
      return { rows, summaries: [domPosSummary(rows)], lastTrCont: 'D' };
    }
    case 'overseas/fills':
      return { rows: [ovsFillRow({ odno: '0000020001' })], summaries: [], lastTrCont: 'D' };
    case 'overseas/realized_pnl': {
      const rows = [ovsPnlRow({ trad_day: '20261102' })];
      return { rows, summaries: [ovsPnlSummary(rows)], lastTrCont: 'D' };
    }
    case 'overseas/position_snapshot':
      return { rows: [ovsPosRow()], summaries: [ovsPosSummary3('310.500000')], lastTrCont: null };
  }
}

maybe('T-087 Dev-2 수집기 일회용 MariaDB 실증', () => {
  let root: mysql.Pool;
  let pool: mysql.Pool;
  let clock = T0;
  const now = () => clock;
  const fakeSleep = async (ms: number) => { clock += ms; };
  const q = async <T = Record<string, unknown>[]>(sql: string, v: unknown[] = []) => (await pool.query(sql, v as never))[0] as unknown as T;

  /** 조회 함수 모킹 — 호출 기록(calls) + 작업별 덮어쓰기(plan). 결과의 queryFrom/To 는 받은 조회 범위(잔고는 opts.now 의 KST 날짜). */
  function makeFetchers(plan: Plan, calls: string[], fp = FP): LedgerFetchers {
    const one = (market: BrokerMarket, kind: BrokerRunKind) => async (qr: Q, opts: { now?: () => number }): Promise<LedgerQueryResult> => {
      const k = `${market}/${kind}` as JobKey;
      calls.push(k);
      const d = rowsFor(k);
      const today = new Date((opts.now ?? Date.now)() + 9 * 3_600_000).toISOString().slice(0, 10);
      const base: LedgerQueryResult = {
        market, kind, trId: TR[market][kind], queryFrom: qr ? qr.from : today, queryTo: qr ? qr.to : today, outcome: 'ended', error: null,
        rows: d.rows, summaries: d.summaries, pages: 1, kisCalls: 1, lastTrCont: d.lastTrCont, rateLimited: false, accountFingerprint: fp,
      };
      const o = plan[k]?.(qr, base);
      if (o === 'throw') throw new Error('boom');
      return { ...base, ...(o ?? {}) };
    };
    return {
      domestic: { fills: (x, o) => one('domestic', 'fills')(x, o), realizedPnl: (x, o) => one('domestic', 'realized_pnl')(x, o), positions: (o) => one('domestic', 'position_snapshot')(null, o) },
      overseas: { fills: (x, o) => one('overseas', 'fills')(x, o), realizedPnl: (x, o) => one('overseas', 'realized_pnl')(x, o), positions: (o) => one('overseas', 'position_snapshot')(null, o) },
      trId: (m, k) => TR[m][k],
    };
  }

  function makeDeps(o: { plan?: Plan; pre?: AccountFingerprintResult; resultFp?: string; db?: SqlPool; planWindow?: CollectorDeps['planWindow'] } = {}) {
    const calls: string[] = [];
    const logs: string[] = [];
    const deps: CollectorDeps = {
      db: o.db ?? (pool as unknown as SqlPool),
      fetchers: makeFetchers(o.plan ?? {}, calls, o.resultFp ?? FP),
      fingerprint: () => FP,
      accountFingerprint: async () => o.pre ?? { ok: true, fingerprint: FP },
      now, sleep: fakeSleep, random: () => 0.5, log: (l) => logs.push(l),
      ...(o.planWindow ? { planWindow: o.planWindow } : {}),
    };
    return { deps, calls, logs };
  }
  const collect = (d: CollectorDeps, trigger: 'cron' | 'manual' = 'cron', extra: Partial<Parameters<typeof collectBrokerLedger>[1]> = {}) =>
    collectBrokerLedger(d, { trigger, deadlineMs: clock + 75_000, ...extra });
  const jobsOf = (r: CollectResult): JobReport[] => (r.status === 'done' ? r.jobs : []);
  const job = (r: CollectResult, k: JobKey) => jobsOf(r).find((j) => `${j.market}/${j.kind}` === k)!;
  const setSwitch = async (v: string | null, updatedAt?: string) => {
    await q('DELETE FROM system_config WHERE `key` = ?', [CRON_SWITCH_KEY]);
    if (v != null) {
      if (updatedAt) await q('INSERT INTO system_config (`key`, value, updated_at) VALUES (?, ?, ?)', [CRON_SWITCH_KEY, v, updatedAt]);
      else await q('INSERT INTO system_config (`key`, value) VALUES (?, ?)', [CRON_SWITCH_KEY, v]);
    }
  };

  beforeAll(async () => {
    root = mysql.createPool({ host: '127.0.0.1', port: Number(PORT), user: 'root', password: process.env.T087_TEST_DB_PASSWORD, connectionLimit: 2 });
    for (const name of [DB, DB_EMPTY]) {
      await root.query(`DROP DATABASE IF EXISTS ${name}`);
      await root.query(`CREATE DATABASE ${name}`);
    }
    pool = mysql.createPool({ host: '127.0.0.1', port: Number(PORT), user: 'root', password: process.env.T087_TEST_DB_PASSWORD, database: DB, connectionLimit: 12, timezone: '+09:00' });
    await q(ACCOUNTS_DDL);
    await q("INSERT INTO accounts (exchange, label) VALUES ('kis', 'default')");
    await q(SYSCFG_DDL);
    for (const s of statements(MIGRATION)) await pool.query(s);
  });
  afterAll(async () => {
    await pool?.end();
    if (root) { for (const name of [DB, DB_EMPTY]) await root.query(`DROP DATABASE IF EXISTS ${name}`); await root.end(); }
  });
  beforeEach(async () => {
    clock = T0;
    for (const t of ['broker_fill_revisions', 'broker_position_snapshots', 'broker_realized_pnl', 'broker_fills', 'broker_fill_runs']) await q(`DELETE FROM ${t}`);
    await q('DELETE FROM system_config');
    await setSwitch('true');
  });

  test('환경: 운영과 같은 sql_mode · 서버 utf8mb3 · 10.11', async () => {
    const [r] = await q<{ m: string; v: string; c: string }[]>('SELECT @@sql_mode AS m, VERSION() AS v, @@collation_server AS c');
    expect(r.m).toBe('IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION');
    expect(r.c).toBe('utf8mb3_general_ci');
    expect(r.v).toMatch(/^10\.11\./);
  });

  // ───────────────────────────── 정상 경로 ─────────────────────────────
  test('1. 정상 — 6 run 전부 complete, 원장 행·수수료 추정·baseline·positive_check(pending/n/a), 응답에 민감값 없음', async () => {
    const { deps, calls } = makeDeps();
    const r = await collect(deps);
    expect(r.status).toBe('done');
    expect(jobsOf(r).map((j) => `${j.market}/${j.kind}=${j.status}`)).toEqual([
      'domestic/fills=complete', 'domestic/realized_pnl=complete', 'domestic/position_snapshot=complete',
      'overseas/fills=complete', 'overseas/realized_pnl=complete', 'overseas/position_snapshot=complete',
    ]);
    expect(calls).toHaveLength(6);
    const runs = await q<Record<string, unknown>[]>(
      `SELECT market, kind, status, source_tr, positive_check AS pc, sum_check AS sc, last_tr_cont AS tc, pages, kis_calls, rows_inserted AS ins,
              DATE_FORMAT(window_from,'%Y-%m-%d') AS wf, DATE_FORMAT(window_to,'%Y-%m-%d') AS wt, DATE_FORMAT(query_from,'%Y-%m-%d') AS qf,
              DATE_FORMAT(query_to,'%Y-%m-%d') AS qt, trigger_kind AS tk, account_fingerprint AS fp, date_basis AS db, error
         FROM broker_fill_runs ORDER BY id`);
    expect(runs.map((x) => [x.market, x.kind, x.status, x.pc, x.sc, x.tc])).toEqual([
      ['domestic', 'fills', 'complete', 'pending', 'match', 'E'],
      ['domestic', 'realized_pnl', 'complete', 'pending', 'match', 'D'],
      ['domestic', 'position_snapshot', 'complete', 'n/a', 'match', 'D'],
      ['overseas', 'fills', 'complete', 'pending', 'unavailable', 'D'],
      ['overseas', 'realized_pnl', 'complete', 'pending', 'match', 'D'],
      ['overseas', 'position_snapshot', 'complete', 'n/a', 'match', null],   // N-1 빈 헤더
    ]);
    expect(runs[0]).toMatchObject({ wf: '2026-10-27', wt: '2026-11-03', qf: '2026-10-27', qt: '2026-11-03', tk: 'cron', fp: FP, db: 'unknown', error: null });
    expect(runs[3]).toMatchObject({ wf: '2026-10-27', wt: '2026-11-03', qf: '2026-10-26', qt: '2026-11-04' });   // 해외 ±1일
    expect(runs[2]).toMatchObject({ wf: '2026-11-03', wt: '2026-11-03', qf: '2026-11-03', qt: '2026-11-03' });
    const fills = await q<Record<string, unknown>[]>('SELECT market, broker_order_no AS o, currency, fee_kind AS fk, fee_native AS fn, fee_rate_pct AS fr, amount_krw_est AS k, revision, settle_state AS ss FROM broker_fills ORDER BY broker_order_no');
    expect(fills).toEqual([
      { market: 'domestic', o: '0000010001', currency: 'KRW', fk: 'unknown', fn: null, fr: null, k: '50000.00', revision: 1, ss: 'closed' },
      { market: 'domestic', o: '0000010002', currency: 'KRW', fk: 'unknown', fn: null, fr: null, k: '50000.00', revision: 1, ss: 'closed' },
      { market: 'overseas', o: '0000020001', currency: 'USD', fk: 'estimated', fn: '0.759259', fr: '0.25000', k: null, revision: 1, ss: 'closed' },
    ]);
    expect((await q<{ n: number }[]>('SELECT COUNT(*) AS n FROM broker_realized_pnl'))[0].n).toBe(2);
    const snaps = await q<{ market: string; b: number; as_of: string }[]>("SELECT market, is_baseline AS b, DATE_FORMAT(as_of,'%Y-%m-%d') AS as_of FROM broker_position_snapshots ORDER BY market");
    expect(snaps).toEqual([{ market: 'domestic', b: 1, as_of: '2026-11-03' }, { market: 'overseas', b: 1, as_of: '2026-11-03' }]);

    // 응답 JSON — 건수·상태만. 지문·합성 금액·계좌 모양 문자열 없음
    const http = toHttp('cron', r);
    expect(http.status).toBe(200);
    const json = JSON.stringify(http.body);
    for (const s of [FP, '50000', '303.7035', '1234000', '01000000000', '10.0.0.1', 'E0000']) expect(json).not.toContain(s);
    expect(json).not.toMatch(/fingerprint|cano|acnt/i);
  });

  test('2. 재수집 같은 응답 → unchanged(행 수·revision 불변), run 은 새로 6개 · 다음 날 잔고는 baseline 아님', async () => {
    const a = makeDeps();
    await collect(a.deps);
    clock += 60 * 60_000;
    const r2 = await collect(makeDeps().deps);
    expect(jobsOf(r2).every((j) => j.status === 'complete')).toBe(true);
    expect(job(r2, 'domestic/fills')).toMatchObject({ inserted: 0, updated: 0, unchanged: 2 });
    expect((await q<{ n: number; r: number }[]>('SELECT COUNT(*) AS n, MAX(revision) AS r FROM broker_fills'))[0]).toEqual({ n: 3, r: 1 });
    expect((await q<{ n: number }[]>('SELECT COUNT(*) AS n FROM broker_fill_revisions'))[0].n).toBe(0);
    expect((await q<{ n: number }[]>('SELECT COUNT(*) AS n FROM broker_fill_runs'))[0].n).toBe(12);
    // last_seen 전진·first_seen 보존
    const f = (await q<{ fs: string; ls: string }[]>("SELECT DATE_FORMAT(first_seen_at,'%H:%i') AS fs, DATE_FORMAT(last_seen_at,'%H:%i') AS ls FROM broker_fills WHERE broker_order_no='0000010001'"))[0];
    expect(f).toEqual({ fs: '07:21', ls: '08:21' });
    clock = T0 + 24 * 3_600_000;
    await collect(makeDeps().deps);
    const snaps = await q<{ b: number; as_of: string }[]>("SELECT is_baseline AS b, DATE_FORMAT(as_of,'%Y-%m-%d') AS as_of FROM broker_position_snapshots WHERE market='domestic' ORDER BY as_of");
    expect(snaps).toEqual([{ b: 1, as_of: '2026-11-03' }, { b: 0, as_of: '2026-11-04' }]);
  });

  test('3. 변경 재수집(부분체결 진행 3→5→7) → revision 1→2→3, revisions 에 이전 원문·seen_from', async () => {
    const step = (qty: string, rmn: string): Plan => ({ 'domestic/fills': () => {
      const rows = [domFillRow({ odno: '0000030001', ord_dt: '20261103', ord_qty: '9', tot_ccld_qty: qty, tot_ccld_amt: String(Number(qty) * 10000), rmn_qty: rmn })];
      return { rows, summaries: [domFillSummary(rows)] };
    } });
    await collect(makeDeps({ plan: step('3', '6') }).deps, 'cron', { kinds: ['fills'], markets: ['domestic'] });
    clock += 3_600_000;
    const r2 = await collect(makeDeps({ plan: step('5', '4') }).deps, 'cron', { kinds: ['fills'], markets: ['domestic'] });
    expect(job(r2, 'domestic/fills')).toMatchObject({ status: 'complete', updated: 1, inserted: 0 });
    clock += 3_600_000;
    await collect(makeDeps({ plan: step('7', '2') }).deps, 'cron', { kinds: ['fills'], markets: ['domestic'] });
    const cur = (await q<Record<string, unknown>[]>("SELECT revision, filled_qty, settle_state FROM broker_fills WHERE broker_order_no='0000030001'"))[0];
    expect(cur).toEqual({ revision: 3, filled_qty: '7.00000000', settle_state: 'open' });
    const revs = await q<Record<string, unknown>[]>(
      `SELECT revision, filled_qty, DATE_FORMAT(seen_from,'%H:%i') AS sf, DATE_FORMAT(seen_until,'%H:%i') AS su FROM broker_fill_revisions ORDER BY revision`);
    expect(revs).toEqual([
      { revision: 1, filled_qty: '3.00000000', sf: '07:21', su: '07:21' },
      { revision: 2, filled_qty: '5.00000000', sf: '08:21', su: '08:21' },
    ]);
    const runRows = await q<{ u: number }[]>("SELECT rows_updated AS u FROM broker_fill_runs WHERE kind='fills' ORDER BY id");
    expect(runRows.map((x) => x.u)).toEqual([0, 1, 1]);
  });

  test('4. 🔴 낡은 응답 — 수량 감소·closed→open(신호 없음)은 건너뜀(stale), 신호가 있으면 반영', async () => {
    const fillsPlan = (o: Record<string, unknown>): Plan => ({ 'domestic/fills': () => {
      const rows = [domFillRow({ odno: '0000040001', ord_dt: '20261103', ord_qty: '9', ...o })];
      return { rows, summaries: [domFillSummary(rows)] };
    } });
    const D = { kinds: ['fills'] as BrokerRunKind[], markets: ['domestic'] as BrokerMarket[] };
    await collect(makeDeps({ plan: fillsPlan({ tot_ccld_qty: '5', tot_ccld_amt: '50000', rmn_qty: '0' }) }).deps, 'cron', D);   // closed, 5
    clock += 60_000;
    const r1 = await collect(makeDeps({ plan: fillsPlan({ tot_ccld_qty: '3', tot_ccld_amt: '30000', rmn_qty: '0' }) }).deps, 'cron', D);   // 수량 감소
    expect(job(r1, 'domestic/fills')).toMatchObject({ status: 'complete', staleSkipped: 1, updated: 0 });
    expect(job(r1, 'domestic/fills').reasons).toContain('stale');
    expect(job(r1, 'domestic/fills').reasons.join(' ')).not.toContain('0000040001');   // 응답에는 주문번호 없음
    clock += 60_000;
    const r2 = await collect(makeDeps({ plan: fillsPlan({ tot_ccld_qty: '5', tot_ccld_amt: '50000', rmn_qty: '4', ccld_cndt_name: '변경' }) }).deps, 'cron', D);   // closed→open
    expect(job(r2, 'domestic/fills')).toMatchObject({ staleSkipped: 1, updated: 0 });
    let row = (await q<Record<string, unknown>[]>("SELECT revision, filled_qty, settle_state FROM broker_fills WHERE broker_order_no='0000040001'"))[0];
    expect(row).toEqual({ revision: 1, filled_qty: '5.00000000', settle_state: 'closed' });
    const errs = await q<{ e: string | null; s: number }[]>("SELECT error AS e, rows_stale_skipped AS s FROM broker_fill_runs ORDER BY id");
    expect(errs.slice(1).map((x) => x.s)).toEqual([1, 1]);
    expect(errs[1].e).toContain('stale:0000040001');   // run.error 에는 주문번호 메모(설계 §3.2)
    // 취소·정정 신호(cncl_cfrm_qty > 0)가 있으면 감소도 반영
    clock += 60_000;
    const r3 = await collect(makeDeps({ plan: fillsPlan({ tot_ccld_qty: '4', tot_ccld_amt: '40000', rmn_qty: '0', cncl_cfrm_qty: '1' }) }).deps, 'cron', D);
    expect(job(r3, 'domestic/fills')).toMatchObject({ updated: 1, staleSkipped: 0 });
    row = (await q<Record<string, unknown>[]>("SELECT revision, filled_qty, cancelled_qty FROM broker_fills WHERE broker_order_no='0000040001'"))[0];
    expect(row).toEqual({ revision: 2, filled_qty: '4.00000000', cancelled_qty: '1.00000000' });
  });

  test('4c. 🔴 (Dev-1 감사 반영) closed → unknown(잔량 판독 불가)도 신호 없으면 건너뜀 · 가드에 걸렸는데 수량이 늘면 stale_conflict → incomplete', async () => {
    const D = { kinds: ['fills'] as BrokerRunKind[], markets: ['domestic'] as BrokerMarket[] };
    const fp = (o: Record<string, unknown>): Plan => ({ 'domestic/fills': () => {
      const rows = [domFillRow({ odno: '0000043001', ord_dt: '20261103', ord_qty: '9', ...o })];
      return { rows, summaries: [domFillSummary(rows)] };
    } });
    await collect(makeDeps({ plan: fp({ tot_ccld_qty: '5', tot_ccld_amt: '50000', rmn_qty: '0' }) }).deps, 'cron', D);   // closed
    const r1 = await collect(makeDeps({ plan: fp({ tot_ccld_qty: '5', tot_ccld_amt: '50000', rmn_qty: '', ccld_cndt_name: '변경' }) }).deps, 'cron', D);   // unknown
    expect(job(r1, 'domestic/fills')).toMatchObject({ status: 'complete', staleSkipped: 1, updated: 0 });
    expect((await q<{ ss: string; r: number }[]>("SELECT settle_state AS ss, revision AS r FROM broker_fills WHERE broker_order_no='0000043001'"))[0]).toEqual({ ss: 'closed', r: 1 });
    const r2 = await collect(makeDeps({ plan: fp({ tot_ccld_qty: '7', tot_ccld_amt: '70000', rmn_qty: '2' }) }).deps, 'cron', D);   // closed→open + 수량 증가
    expect(job(r2, 'domestic/fills')).toMatchObject({ status: 'incomplete', staleSkipped: 1, updated: 0 });
    expect(job(r2, 'domestic/fills').reasons).toContain('stale_newer_info_discarded');
    const last = (await q<{ e: string; s: number; st: string }[]>('SELECT error AS e, rows_stale_skipped AS s, status AS st FROM broker_fill_runs ORDER BY id DESC LIMIT 1'))[0];
    expect(last).toMatchObject({ s: 1, st: 'incomplete' });
    expect(last.e).toContain('stale_conflict:0000043001');
  });

  test('16b. 🔴 어댑터에 넘기는 페이지 시작 마감 = 시작 + 35초(전체 75초가 아니라) — 한 페이지 최악 50초를 더해도 curl 90초 안', async () => {
    const seen: number[] = [];
    const d = makeDeps();
    const orig = d.deps.fetchers.domestic.fills;
    d.deps.fetchers.domestic.fills = (qq, o) => { seen.push(o.deadlineMs ?? -1); return orig(qq, o); };
    await collect(d.deps, 'cron', { kinds: ['fills'], markets: ['domestic'] });
    expect(seen).toEqual([T0 + 35_000]);
  });

  test('4b. 해외 closed→open 은 정정·취소 신호(rvse_cncl_dvsn 02)가 있을 때만 반영', async () => {
    const O = { kinds: ['fills'] as BrokerRunKind[], markets: ['overseas'] as BrokerMarket[] };
    const p = (o: Record<string, unknown>): Plan => ({ 'overseas/fills': () => ({ rows: [ovsFillRow({ odno: '0000041001', ...o })] }) });
    await collect(makeDeps({ plan: p({}) }).deps, 'cron', O);   // closed(nccs 0)
    const r1 = await collect(makeDeps({ plan: p({ nccs_qty: '2', prcs_stat_name: '접수' }) }).deps, 'cron', O);
    expect(job(r1, 'overseas/fills').staleSkipped).toBe(1);
    const r2 = await collect(makeDeps({ plan: p({ nccs_qty: '2', prcs_stat_name: '정정', rvse_cncl_dvsn: '02' }) }).deps, 'cron', O);
    expect(job(r2, 'overseas/fills').updated).toBe(1);
    expect((await q<{ ss: string }[]>("SELECT settle_state AS ss FROM broker_fills WHERE broker_order_no='0000041001'"))[0].ss).toBe('open');
  });

  test('5. 🔴 fee_* 소유(L-5) — D2 allocated 는 보존, estimated 는 재계산 · D2 파생열 불변', async () => {
    const O = { kinds: ['fills'] as BrokerRunKind[], markets: ['overseas'] as BrokerMarket[] };
    const p = (qty: string, amt: string): Plan => ({ 'overseas/fills': () => ({ rows: [ovsFillRow({ odno: '0000050001', ft_ord_qty: '9', ft_ccld_qty: qty, ft_ccld_amt3: amt, nccs_qty: '0' }), ovsFillRow({ odno: '0000050002', ft_ccld_qty: qty, ft_ccld_amt3: amt })] }) });
    await collect(makeDeps({ plan: p('3', '303.70350') }).deps, 'cron', O);
    // D2 흉내: 0000050001 에 allocated 수수료·환율·연결
    await q("UPDATE broker_fills SET fee_kind='allocated', fee_native='0.500000', fee_rate_pct=NULL, fx_source='kis_period_profit', fx_usdkrw='1400.0000', amount_krw_est='425185.00', app_order_id=77, reconcile_state='linked', derived_for_revision=1 WHERE broker_order_no='0000050001'");
    await collect(makeDeps({ plan: p('5', '506.17250') }).deps, 'cron', O);
    const rows = await q<Record<string, unknown>[]>('SELECT broker_order_no AS o, revision, fee_kind AS fk, fee_native AS fn, fx_source AS fs, fx_usdkrw AS fx, amount_krw_est AS k, app_order_id AS a, reconcile_state AS rs, derived_for_revision AS d, filled_qty AS f FROM broker_fills ORDER BY broker_order_no');
    expect(rows[0]).toEqual({ o: '0000050001', revision: 2, fk: 'allocated', fn: '0.500000', fs: 'kis_period_profit', fx: '1400.0000', k: '425185.00', a: 77, rs: 'linked', d: 1, f: '5.00000000' });
    expect(rows[1]).toMatchObject({ o: '0000050002', revision: 2, fk: 'estimated', fn: '1.265431', d: null });   // 506.1725 × 0.25% = 1.26543125
  });

  test('6. 응답 안 자연키 중복(대소문자만 다른 것 포함) → 그 키는 안 씀, duplicate_keys, incomplete', async () => {
    const plan: Plan = { 'domestic/fills': () => {
      const rows = [domFillRow({ odno: 'AB0001', ord_dt: '20261103' }), domFillRow({ odno: 'ab0001', ord_dt: '20261103' }), domFillRow({ odno: '0000060001', ord_dt: '20261103' })];
      return { rows, summaries: [domFillSummary(rows)] };
    } };
    const r = await collect(makeDeps({ plan }).deps, 'cron', { kinds: ['fills'], markets: ['domestic'] });
    expect(job(r, 'domestic/fills')).toMatchObject({ status: 'incomplete', duplicateKeys: 1, inserted: 1 });
    expect(job(r, 'domestic/fills').reasons).toEqual(expect.arrayContaining(['duplicate_keys', 'duplicate_keys:1']));
    expect((await q<{ o: string }[]>('SELECT broker_order_no AS o FROM broker_fills')).map((x) => x.o)).toEqual(['0000060001']);
    expect((await q<{ d: number; s: string }[]>('SELECT duplicate_keys AS d, status AS s FROM broker_fill_runs'))[0]).toEqual({ d: 1, s: 'incomplete' });
  });

  // ───────────────────────────── complete 판정 ↔ CHECK ─────────────────────────────
  test('7. complete 판정이 CHECK 와 일치 — 연속 TR 빈 헤더·M·합계 불일치·truncated·호출 0 → incomplete, 잔고 빈 헤더 → complete, failed → 행 0', async () => {
    const D = (kind: BrokerRunKind) => ({ kinds: [kind], markets: ['domestic'] as BrokerMarket[] });
    const cases: [Plan, BrokerRunKind, string, string[]][] = [
      [{ 'domestic/fills': () => ({ lastTrCont: null }) }, 'fills', 'incomplete', ['tr_cont_missing']],
      [{ 'domestic/fills': () => ({ lastTrCont: 'M', outcome: 'truncated', error: 'page_limit' }) }, 'fills', 'incomplete', ['page_limit', 'fetch_truncated', 'tr_cont_not_terminal']],
      [{ 'domestic/fills': (_q, b) => ({ summaries: [{ ...(b.summaries[0] as object), tot_ccld_amt: '1' }] }) }, 'fills', 'incomplete', ['sum_check_mismatch']],
      [{ 'domestic/fills': () => ({ pages: 0, kisCalls: 0 }) }, 'fills', 'incomplete', ['no_pages', 'no_kis_calls']],
      [{ 'domestic/position_snapshot': () => ({ lastTrCont: null }) }, 'position_snapshot', 'complete', []],
      [{ 'domestic/fills': () => ({ outcome: 'failed', error: 'rt_cd_1_X', rows: [], summaries: [], pages: 0, kisCalls: 1 }) }, 'fills', 'failed', ['rt_cd_1_X']],
      [{ 'domestic/fills': () => ({ outcome: 'failed', error: 'rate_limited', rateLimited: true, rows: [], pages: 0, kisCalls: 3 }) }, 'fills', 'failed', ['rate_limited']],
    ];
    for (const [plan, kind, want, reasons] of cases) {
      await q('DELETE FROM broker_fills'); await q('DELETE FROM broker_position_snapshots'); await q('DELETE FROM broker_fill_runs');
      const r = await collect(makeDeps({ plan }).deps, 'cron', D(kind));
      const j = job(r, `domestic/${kind}` as JobKey);
      expect([kind, j.status]).toEqual([kind, want]);
      expect(j.reasons).toEqual(expect.arrayContaining(reasons));
      const run = (await q<{ s: string; p: number; k: number }[]>('SELECT status AS s, pages AS p, kis_calls AS k FROM broker_fill_runs'))[0];
      expect(run.s).toBe(want);
      if (want === 'failed') expect((await q<{ n: number }[]>('SELECT COUNT(*) AS n FROM broker_fills'))[0].n).toBe(0);
    }
    // truncated 는 받은 행을 저장한다
    await q('DELETE FROM broker_fills'); await q('DELETE FROM broker_fill_runs');
    await collect(makeDeps({ plan: { 'domestic/fills': () => ({ lastTrCont: 'M', outcome: 'truncated', error: 'page_limit' }) } }).deps, 'cron', D('fills'));
    expect((await q<{ n: number }[]>('SELECT COUNT(*) AS n FROM broker_fills'))[0].n).toBe(2);
  });

  test('7b. 정규화 실패 행 → 그 행만 빠지고 incomplete(사유 코드만, 값 없음)', async () => {
    const plan: Plan = { 'domestic/fills': () => {
      const rows = [domFillRow({ odno: '0000070001', ord_dt: '20261103' }), domFillRow({ odno: '0000070002', ord_dt: '20261103', sll_buy_dvsn_cd: '99' })];
      return { rows, summaries: [domFillSummary(rows)] };
    } };
    const r = await collect(makeDeps({ plan }).deps, 'cron', { kinds: ['fills'], markets: ['domestic'] });
    expect(job(r, 'domestic/fills')).toMatchObject({ status: 'incomplete', normalizeIssues: 1, inserted: 1 });
    expect(job(r, 'domestic/fills').reasons).toEqual(expect.arrayContaining(['normalize_failed', 'normalize:unknown_side:sll_buy_dvsn_cdx1']));
  });

  test('7c. 🔴 DB 가 complete 를 CHECK 로 거부하면(4025) incomplete 로 낮춰 다시 쓴다', async () => {
    const proxy = interceptPool(async (sql, v) => {
      if (/^\s*UPDATE broker_fill_runs\s+SET status = \?/.test(sql) && Array.isArray(v) && v[0] === 'complete') throw Object.assign(new Error('chk'), { errno: 4025 });
    });
    const r = await collect(makeDeps({ db: proxy }).deps, 'cron', { kinds: ['fills'], markets: ['domestic'] });
    expect(job(r, 'domestic/fills')).toMatchObject({ status: 'incomplete' });
    expect(job(r, 'domestic/fills').reasons).toContain('db_check_rejected_complete');
    expect((await q<{ s: string; e: string }[]>('SELECT status AS s, error AS e FROM broker_fill_runs'))[0]).toEqual({ s: 'incomplete', e: 'db_check_rejected_complete' });
  });

  // ───────────────────────────── 교착·재시도 ─────────────────────────────
  test('8. 🔴 동시 2·6 연결 첫 삽입 경합 — 1213 재시도로 전부 수렴(키마다 1행, 오류 0)', async () => {
    const runId = await insertRunningRun(pool as unknown as SqlConnection, {
      accountId: 1, accountFingerprint: FP, market: 'domestic', kind: 'fills', sourceTr: 'TTTC0081R', windowFrom: '2026-11-03', windowTo: '2026-11-03',
      queryFrom: '2026-11-03', queryTo: '2026-11-03', trigger: 'manual', startedAt: '2026-11-03 07:21:00', positiveCheck: 'pending',
    });
    const meta: UpsertMeta = { accountId: 1, accountFingerprint: FP, runId, seenAt: '2026-11-03 07:21:01' };
    const realSleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));
    const stats: Record<number, { inserted: number; unchanged: number; failed: number; retries: number; rounds: number }> = {};
    for (const [n, rounds] of [[2, 25], [6, 15]] as const) {
      const st = { inserted: 0, unchanged: 0, failed: 0, retries: 0, rounds };
      for (let i = 0; i < rounds; i++) {
        const item = normalizeFills({ market: 'domestic', kind: 'fills', trId: 'TTTC0081R', rows: [domFillRow({ odno: `08${n}${String(i).padStart(5, '0')}`, ord_dt: '20261103' })] }).items[0];
        const conns = await Promise.all(Array.from({ length: n }, () => pool.getConnection()));
        const res = await Promise.all(conns.map((c) => inRowTx(c as unknown as SqlConnection, (x) => upsertFill(x, item, meta), { sleep: realSleep, random: Math.random })));
        conns.forEach((c) => c.release());
        for (const x of res) {
          if (!x.ok) { st.failed += 1; continue; }
          st.retries += x.retries;
          if (x.value === 'inserted') st.inserted += 1; else if (x.value === 'unchanged') st.unchanged += 1;
        }
      }
      stats[n] = st;
      expect([n, st.failed]).toEqual([n, 0]);
      expect([n, st.inserted]).toEqual([n, rounds]);
      expect([n, st.unchanged]).toEqual([n, rounds * (n - 1)]);
    }
    const perKey = await q<{ n: number }[]>("SELECT COUNT(*) AS n FROM broker_fills WHERE broker_order_no LIKE '08%' GROUP BY broker_order_no HAVING n > 1");
    expect(perKey).toHaveLength(0);
    console.info(`[t087-dev2] 교착 재시도: 2연결 ${JSON.stringify(stats[2])} · 6연결 ${JSON.stringify(stats[6])}`);
    expect(stats[2].retries + stats[6].retries).toBeGreaterThan(0);   // 실제로 교착이 났고 재시도로 풀렸다
  });

  test('9. 1213 주입 — 1회는 재시도로 성공, 3회 연속이면 그 행만 건너뜀·incomplete·run.error 메모', async () => {
    let left = 1;
    const p1 = interceptPool(async (sql) => {
      if (/FROM broker_fills\s+WHERE account_id/.test(sql) && /FOR UPDATE/.test(sql) && left > 0) { left -= 1; throw Object.assign(new Error('deadlock'), { errno: 1213 }); }
    });
    const r1 = await collect(makeDeps({ db: p1 }).deps, 'cron', { kinds: ['fills'], markets: ['domestic'] });
    expect(job(r1, 'domestic/fills')).toMatchObject({ status: 'complete', inserted: 2, writeFailures: 0 });
    expect(job(r1, 'domestic/fills').reasons).toContain('lock_retried');
    await q('DELETE FROM broker_fills'); await q('DELETE FROM broker_fill_runs');
    let hits = 0;
    const p3 = interceptPool(async (sql, v) => {
      if (/FROM broker_fills\s+WHERE account_id/.test(sql) && /FOR UPDATE/.test(sql) && Array.isArray(v) && v[4] === '0000010001') { hits += 1; throw Object.assign(new Error('deadlock'), { errno: 1213 }); }
    });
    const r3 = await collect(makeDeps({ db: p3 }).deps, 'cron', { kinds: ['fills'], markets: ['domestic'] });
    expect(hits).toBe(3);   // 첫 시도 + 재시도 2
    expect(job(r3, 'domestic/fills')).toMatchObject({ status: 'incomplete', inserted: 1, writeFailures: 1 });
    expect((await q<{ e: string }[]>('SELECT error AS e FROM broker_fill_runs'))[0].e).toContain('write_lock_retry_exhausted_1213:0000010001');
  });

  // ───────────────────────────── 계좌 지문 ─────────────────────────────
  test('10. 🔴 계좌 지문 — 직전 성공 run 과 다르면 전부 failed(account_changed)·KIS 0·쓰기 0, 실패 run 과는 비교하지 않는다', async () => {
    await collect(makeDeps().deps);   // FP 로 성공
    await q('DELETE FROM broker_fills');
    const other = makeDeps({ pre: { ok: true, fingerprint: FP_OTHER } });
    const r = await collect(other.deps);
    expect(other.calls).toEqual([]);
    expect(jobsOf(r).every((j) => j.status === 'failed' && j.reasons.includes('account_changed'))).toBe(true);
    expect(toHttp('cron', r).status).toBe(503);
    expect((await q<{ n: number }[]>('SELECT COUNT(*) AS n FROM broker_fills'))[0].n).toBe(0);
    expect((await q<{ n: number }[]>("SELECT COUNT(*) AS n FROM broker_fill_runs WHERE status='failed' AND error='account_changed' AND account_fingerprint=? AND kis_calls=0", [FP_OTHER]))[0].n).toBe(6);
    // 원래 지문으로 돌아오면 정상(실패 run 의 지문과 비교하지 않음 — L-d ①)
    const back = await collect(makeDeps().deps);
    expect(jobsOf(back).every((j) => j.status === 'complete')).toBe(true);
  });

  test('10b. 조회 결과 지문이 실행 전 지문과 다르면(실행 중 계좌 변경) 그 run 은 failed·쓰기 0', async () => {
    const r = await collect(makeDeps({ resultFp: FP_OTHER }).deps, 'cron', { kinds: ['fills'], markets: ['domestic'] });
    expect(job(r, 'domestic/fills')).toMatchObject({ status: 'failed' });
    expect(job(r, 'domestic/fills').reasons).toContain('account_changed');
    expect((await q<{ n: number }[]>('SELECT COUNT(*) AS n FROM broker_fills'))[0].n).toBe(0);
  });

  test('10c. 🔴 지문 키 없음·계좌 없음 → preflight_failed, run 행 0·KIS 0', async () => {
    for (const error of ['fingerprint_key_missing', 'account_missing']) {
      const d = makeDeps({ pre: { ok: false, error } });
      const r = await collect(d.deps);
      expect(r).toEqual({ status: 'preflight_failed', error, switchEnabled: true });
      expect(d.calls).toEqual([]);
      expect(toHttp('cron', r).status).toBe(503);
    }
    expect((await q<{ n: number }[]>('SELECT COUNT(*) AS n FROM broker_fill_runs'))[0].n).toBe(0);
  });

  test('10d. TR 이 run 에 적은 것과 다르면 failed(source_tr_mismatch)·쓰기 0', async () => {
    const r = await collect(makeDeps({ plan: { 'domestic/fills': () => ({ trId: 'VTTC0081R' }) } }).deps, 'cron', { kinds: ['fills'], markets: ['domestic'] });
    expect(job(r, 'domestic/fills').reasons).toContain('source_tr_mismatch');
    expect((await q<{ n: number }[]>('SELECT COUNT(*) AS n FROM broker_fills'))[0].n).toBe(0);
  });

  // ───────────────────────────── 85일·표 없음·스위치·single-flight·중단 ─────────────────────────────
  test('11. 🔴 국내 체결 85일 밖 창 → KIS 도 run 행도 없이 건너뜀(L-c) · 어댑터가 skipped 를 돌려도 failed 로 닫힘', async () => {
    const old: CollectorDeps['planWindow'] = (m, k, t) => {
      if (m === 'domestic' && k === 'fills') return { windowFrom: '2026-07-01', windowTo: '2026-07-31', queryFrom: '2026-07-01', queryTo: '2026-07-31' };
      return planJobWindow(m, k, t);
    };
    const d = makeDeps({ planWindow: old });
    const r = await collect(d.deps, 'cron', { markets: ['domestic'] });
    expect(job(r, 'domestic/fills')).toMatchObject({ status: 'skipped', runId: null, reasons: ['outside_tr_window'] });
    expect(d.calls).toEqual(['domestic/realized_pnl', 'domestic/position_snapshot']);
    expect((await q<{ n: number }[]>("SELECT COUNT(*) AS n FROM broker_fill_runs WHERE kind='fills'"))[0].n).toBe(0);
    // 85일 경계 = 수용(그 창으로 run 을 쓴다)
    const edge: CollectorDeps['planWindow'] = () => ({ windowFrom: '2026-08-10', windowTo: '2026-08-10', queryFrom: '2026-08-10', queryTo: '2026-08-10' });
    const edgeRows = [domFillRow({ odno: '0000011001', ord_dt: '20260810' })];   // (Codex C2) 행 날짜도 그 창 안이어야 complete
    const r2 = await collect(makeDeps({ planWindow: edge, plan: { 'domestic/fills': (qq) => ({ queryFrom: qq!.from, queryTo: qq!.to, rows: edgeRows, summaries: [domFillSummary(edgeRows)] }) } }).deps, 'manual', { kinds: ['fills'], markets: ['domestic'] });
    expect(job(r2, 'domestic/fills').status).toBe('complete');
    const r3 = await collect(makeDeps({ plan: { 'domestic/fills': () => ({ outcome: 'skipped', error: 'outside_tr_window', rows: [], summaries: [], pages: 0, kisCalls: 0 }) } }).deps, 'manual', { kinds: ['fills'], markets: ['domestic'] });
    expect(job(r3, 'domestic/fills')).toMatchObject({ status: 'failed', reasons: ['outside_tr_window'] });
  });

  test('11b. 일일·주간 창은 1년 내내 85일 안·기준일 이후·CHECK 모양(해외 ±1, 잔고 하루)', () => {
    for (let d = 0; d < 400; d++) {
      const t = Date.parse('2026-10-25T07:21:00+09:00') + d * 86_400_000;
      for (const m of ['domestic', 'overseas'] as BrokerMarket[]) for (const k of ['fills', 'realized_pnl', 'position_snapshot'] as BrokerRunKind[]) {
        const w = planJobWindow(m, k, t) as JobWindow;
        const today = new Date(t + 9 * 3_600_000).toISOString().slice(0, 10);
        expect(w.windowTo).toBe(today);
        expect(w.windowFrom >= '2026-10-25').toBe(true);
        expect(w).toEqual({ ...w, ...queryRangeForWindow(m, k, w.windowFrom, w.windowTo) });
        const span = (Date.parse(w.windowTo) - Date.parse(w.windowFrom)) / 86_400_000;
        expect(span).toBeLessThanOrEqual(k === 'position_snapshot' ? 0 : 35);
      }
    }
    expect(planJobWindow('domestic', 'fills', Date.parse('2026-10-24T07:21:00+09:00'))).toBeNull();
  });

  test('12. 🔴 표 없음(1146) → not_migrated(예외 아님)·라우트 503 · 커버리지는 coverage_gap', async () => {
    const empty = mysql.createPool({ host: '127.0.0.1', port: Number(PORT), user: 'root', password: process.env.T087_TEST_DB_PASSWORD, database: DB_EMPTY, connectionLimit: 2, timezone: '+09:00' });
    try {
      const d = makeDeps({ db: empty as unknown as SqlPool });
      const r = await collect(d.deps, 'manual');
      expect(r).toEqual({ status: 'not_migrated' });
      expect(d.calls).toEqual([]);
      expect(toHttp('manual', r).status).toBe(503);
      expect(await loadCoverage(empty as unknown as SqlPool, 1, 'domestic', 'fills')).toEqual({ status: 'not_migrated' });
      expect(await isStepCovered(empty as unknown as SqlPool, 1, 'domestic', 'fills', '2026-11-03 08:00:00', '2026-11-03 09:00:00')).toBe('coverage_gap');
    } finally { await empty.end(); }
  });

  test('13. 🔴 스위치 — 키 없음·false·문자열 "true"·숫자 1 → cron skipped(KIS 0·run 0), JSON true 만 켜짐 · manual 은 꺼져도 1회', async () => {
    for (const v of [null, 'false', '"true"', '1']) {
      await setSwitch(v);
      const d = makeDeps();
      const r = await collect(d.deps, 'cron');
      expect([v, r]).toEqual([v, { status: 'skipped', reason: 'switch_off', switchEnabled: false }]);
      expect(d.calls).toEqual([]);
    }
    expect((await q<{ n: number }[]>('SELECT COUNT(*) AS n FROM broker_fill_runs'))[0].n).toBe(0);
    await setSwitch(null);
    const m = makeDeps();
    const rm = await collect(m.deps, 'manual');
    expect(rm.status).toBe('done');
    expect(m.calls).toHaveLength(6);
    expect((await q<{ t: string }[]>('SELECT DISTINCT trigger_kind AS t FROM broker_fill_runs')).map((x) => x.t)).toEqual(['manual']);
  });

  test('14. 🔴 single-flight — running 10분 안 → in_progress(KIS 0), 10분 넘은 running → failed(stale_running) 후 진행, 명명 락 점유 → in_progress', async () => {
    const mk = (startedAt: string) => insertRunningRun(pool as unknown as SqlConnection, {
      accountId: 1, accountFingerprint: FP, market: 'domestic', kind: 'fills', sourceTr: 'TTTC0081R', windowFrom: '2026-11-03', windowTo: '2026-11-03',
      queryFrom: '2026-11-03', queryTo: '2026-11-03', trigger: 'cron', startedAt, positiveCheck: 'pending',
    });
    const fresh = await mk(kstDateTime(clock - 5 * 60_000));
    const d1 = makeDeps();
    expect(await collect(d1.deps)).toEqual({ status: 'skipped', reason: 'in_progress', switchEnabled: true });
    expect(d1.calls).toEqual([]);
    await q('DELETE FROM broker_fill_runs WHERE id = ?', [fresh]);
    const stale = await mk(kstDateTime(clock - 15 * 60_000));
    const r2 = await collect(makeDeps().deps);
    expect(r2.status === 'done' && r2.closedStale).toBe(1);
    expect((await q<{ s: string; e: string }[]>('SELECT status AS s, error AS e FROM broker_fill_runs WHERE id = ?', [stale]))[0]).toEqual({ s: 'failed', e: 'stale_running' });
    // 다른 연결이 명명 락을 잡고 있으면 즉시 건너뜀
    const holder = await pool.getConnection();
    try {
      await holder.query('SELECT GET_LOCK(?, 0)', [COLLECTOR_LOCK_NAME]);
      const d3 = makeDeps();
      expect(await collect(d3.deps)).toEqual({ status: 'skipped', reason: 'in_progress', switchEnabled: true });
      expect(d3.calls).toEqual([]);
    } finally { await holder.query('SELECT RELEASE_LOCK(?)', [COLLECTOR_LOCK_NAME]); holder.release(); }
    // 동시 두 실행 → 하나만 돈다
    const a = makeDeps(); const b = makeDeps();
    const [ra, rb] = await Promise.all([collect(a.deps), collect(b.deps)]);
    const st = [ra.status, rb.status].sort();
    expect(st).toEqual(['done', 'skipped']);
  });

  test('15. 🔴 연속 실패 3회 → cron 은 halted(그 작업 KIS 0), manual 은 돈다, 스위치를 다시 켜면(updated_at) 재개', async () => {
    await setSwitch('true', '2026-11-01 00:00:00');
    const failPlan: Plan = { 'domestic/fills': () => ({ outcome: 'failed', error: 'http_500', rows: [], summaries: [], pages: 0, kisCalls: 1 }) };
    for (let i = 0; i < 3; i++) { await collect(makeDeps({ plan: failPlan }).deps, 'cron', { kinds: ['fills'], markets: ['domestic'] }); clock += 60_000; }
    const d = makeDeps();
    const r = await collect(d.deps, 'cron', { markets: ['domestic'] });
    expect(job(r, 'domestic/fills')).toMatchObject({ status: 'halted', runId: null, kisCalls: 0 });
    expect(d.calls).toEqual(['domestic/realized_pnl', 'domestic/position_snapshot']);   // 다른 작업은 계속
    expect(toHttp('cron', r).status).toBe(503);
    expect(d.logs.join('\n')).toMatch(/halted/);
    // 스위치를 끄고 다시 켜면 updated_at 이 실패들보다 뒤 → 재개
    await setSwitch('true', kstDateTime(clock + 1000));
    clock += 2000;
    const d2 = makeDeps();
    const r2 = await collect(d2.deps, 'cron', { kinds: ['fills'], markets: ['domestic'] });
    expect(job(r2, 'domestic/fills').status).toBe('complete');
    // 다시 3회 실패 → halted, manual 은 중단을 무시하고 돌고 성공하면 연속이 끊긴다
    for (let i = 0; i < 3; i++) { await collect(makeDeps({ plan: failPlan }).deps, 'cron', { kinds: ['fills'], markets: ['domestic'] }); clock += 60_000; }
    expect(job(await collect(makeDeps().deps, 'cron', { kinds: ['fills'], markets: ['domestic'] }), 'domestic/fills').status).toBe('halted');
    expect(job(await collect(makeDeps().deps, 'manual', { kinds: ['fills'], markets: ['domestic'] }), 'domestic/fills').status).toBe('complete');
    expect(job(await collect(makeDeps().deps, 'cron', { kinds: ['fills'], markets: ['domestic'] }), 'domestic/fills').status).toBe('complete');
  });

  test('16. 시간 예산 — 페이지 시작 마감(시작+35초)이 지나면 새 작업을 시작하지 않는다(run 행 없음)', async () => {
    const plan: Plan = { 'domestic/fills': () => { clock += 55_000; return {}; } };
    const d = makeDeps({ plan });
    const r = await collect(d.deps, 'cron', { markets: ['domestic'] });
    expect(jobsOf(r).map((j) => j.status)).toEqual(['complete', 'skipped', 'skipped']);
    expect(job(r, 'domestic/realized_pnl').reasons).toEqual(['time_budget']);
    expect(d.calls).toEqual(['domestic/fills']);
  });

  test('17. 조회 함수 예외·기간손익 원문 변경(revision+1, pnl_revised)·잔고 같은 날 재수집', async () => {
    const r = await collect(makeDeps({ plan: { 'domestic/fills': () => 'throw' } }).deps, 'cron', { kinds: ['fills'], markets: ['domestic'] });
    expect(job(r, 'domestic/fills')).toMatchObject({ status: 'failed', reasons: ['fetch_exception'] });
    await collect(makeDeps().deps, 'cron', { kinds: ['realized_pnl', 'position_snapshot'] });
    const pnlPlan: Plan = { 'overseas/realized_pnl': () => { const rows = [ovsPnlRow({ trad_day: '20261102', stck_sll_tlex: '0.8000' })]; return { rows, summaries: [ovsPnlSummary(rows)] }; } };
    const posPlan: Plan = { 'overseas/position_snapshot': () => ({ rows: [ovsPosRow({ cblc_qty13: '4.00000000' })], summaries: [ovsPosSummary3('310.500000')] }) };
    const r2 = await collect(makeDeps({ plan: { ...pnlPlan, ...posPlan } }).deps, 'cron', { kinds: ['realized_pnl', 'position_snapshot'], markets: ['overseas'] });
    expect(job(r2, 'overseas/realized_pnl')).toMatchObject({ status: 'complete', updated: 1 });
    expect(job(r2, 'overseas/realized_pnl').reasons).toContain('pnl_revised');
    expect((await q<{ r: number; f: string }[]>("SELECT revision AS r, fee_native AS f FROM broker_realized_pnl WHERE market='overseas'"))[0]).toEqual({ r: 2, f: '0.800000' });
    expect(job(r2, 'overseas/position_snapshot')).toMatchObject({ status: 'complete', updated: 1 });
    expect((await q<{ qty: string; b: number }[]>("SELECT qty, is_baseline AS b FROM broker_position_snapshots WHERE market='overseas'"))[0]).toEqual({ qty: '4.00000000', b: 1 });
  });

  test('18. 커버리지(DB) — complete 창 effective_to 병합·[prev−1일, cur] 판정 · 같은 날 실행 뒤 시각은 커버되지 않음', async () => {
    await collect(makeDeps().deps, 'cron', { kinds: ['fills'], markets: ['domestic'] });   // 창 10-27~11-03, started 11-03 07:21
    const c = await loadCoverage(pool as unknown as SqlPool, 1, 'domestic', 'fills');
    expect(c).toEqual({ status: 'ok', windows: [{ windowFrom: '2026-10-27', effectiveTo: '2026-11-03 07:21:00', positiveCheck: 'pending' }] });
    const P = pool as unknown as SqlPool;
    expect(await isStepCovered(P, 1, 'domestic', 'fills', '2026-11-02 08:00:00', '2026-11-03 07:00:00')).toBe('covered');
    expect(await isStepCovered(P, 1, 'domestic', 'fills', '2026-11-03 08:00:00', '2026-11-03 09:00:00')).toBe('coverage_gap');   // 실행 뒤
    expect(await isStepCovered(P, 1, 'domestic', 'fills', '2026-10-27 08:00:00', '2026-10-28 08:00:00')).toBe('coverage_gap');   // prev−1일이 창 앞
    expect(await isStepCovered(P, 1, 'overseas', 'fills', '2026-11-02 08:00:00', '2026-11-03 07:00:00')).toBe('coverage_gap');  // 다른 시장
    // 다음 날 실행 → 두 창이 effective_to 로 이어져 11-03 오후도 커버
    clock = T0 + 86_400_000;
    await collect(makeDeps().deps, 'cron', { kinds: ['fills'], markets: ['domestic'] });
    expect(await isStepCovered(P, 1, 'domestic', 'fills', '2026-11-03 08:00:00', '2026-11-03 09:00:00')).toBe('covered');
    // incomplete 창은 커버리지에 들어가지 않는다
    await q("UPDATE broker_fill_runs SET status='incomplete' WHERE kind='fills'");
    expect(await isStepCovered(P, 1, 'domestic', 'fills', '2026-11-02 08:00:00', '2026-11-03 07:00:00')).toBe('coverage_gap');
  });

  // ───────────────────────────── Codex C2 후속 — 행 날짜 범위·호출 상한 ─────────────────────────────
  const F = { kinds: ['fills'] as BrokerRunKind[] };
  const P_ = { kinds: ['realized_pnl'] as BrokerRunKind[] };
  const dom = { markets: ['domestic'] as BrokerMarket[] };
  const ovs = { markets: ['overseas'] as BrokerMarket[] };

  test('24. 🔴 (C2 High) 국내 체결 — 범위 밖 행 1건 → 그 행은 안 쓰고 나머지는 쓴다, run incomplete(row_out_of_range:1), 오류·응답에 날짜·지문·금액 없음', async () => {
    const rows = [domFillRow({ odno: '0000024001', ord_dt: '20261103' }), domFillRow({ odno: '0000024002', ord_dt: '20261020' }), domFillRow({ odno: '0000024003', ord_dt: '20261027' })];
    const r = await collect(makeDeps({ plan: { 'domestic/fills': () => ({ rows, summaries: [domFillSummary(rows)] }) } }).deps, 'cron', { ...F, ...dom });
    expect(jobsOf(r)[0]).toMatchObject({ status: 'incomplete', inserted: 2 });
    expect(jobsOf(r)[0].reasons).toEqual(expect.arrayContaining(['rows_out_of_range', 'row_out_of_range:1']));
    expect((await q<{ o: string }[]>('SELECT broker_order_no AS o FROM broker_fills ORDER BY o')).map((x) => x.o)).toEqual(['0000024001', '0000024003']);
    const run = (await q<{ s: string; e: string }[]>('SELECT status AS s, error AS e FROM broker_fill_runs'))[0];
    expect(run.s).toBe('incomplete');
    expect(run.e).toContain('row_out_of_range:1');
    const json = JSON.stringify(toHttp('cron', r).body);
    for (const t of [run.e, json]) for (const bad of ['2026-10-20', '20261020', FP, '50000', '0000024002']) expect([bad, t.includes(bad)]).toEqual([bad, false]);
  });

  test('25. 🔴 (C2 High) 해외 체결 — 조회 [10-26, 11-04] 의 경계 10-25·11-05 는 통과(complete), 10-24·11-06 은 incomplete·안 씀', async () => {
    const ok = [ovsFillRow({ odno: '0000025001', dmst_ord_dt: '20261025', ord_dt: '20261024' }), ovsFillRow({ odno: '0000025002', dmst_ord_dt: '20261105', ord_dt: '20261104' })];
    const r1 = await collect(makeDeps({ plan: { 'overseas/fills': () => ({ rows: ok }) } }).deps, 'cron', { ...F, ...ovs });
    expect(jobsOf(r1)[0]).toMatchObject({ status: 'complete', inserted: 2 });
    for (const [odno, d] of [['0000025003', '20261024'], ['0000025004', '20261106']]) {
      const rr = await collect(makeDeps({ plan: { 'overseas/fills': () => ({ rows: [ovsFillRow({ odno, dmst_ord_dt: d, ord_dt: d })] }) } }).deps, 'cron', { ...F, ...ovs });
      expect([d, jobsOf(rr)[0].status, jobsOf(rr)[0].inserted]).toEqual([d, 'incomplete', 0]);
    }
    expect((await q<{ n: number }[]>("SELECT COUNT(*) AS n FROM broker_fills WHERE broker_order_no IN ('0000025003','0000025004')"))[0].n).toBe(0);
  });

  test('26. 🔴 (C2 High) 기간손익 — 국내 범위 밖 → incomplete·안 씀 / 해외 경계 통과·그 밖 incomplete', async () => {
    const dRows = [domPnlRow({ trad_dt: '20261102' }), domPnlRow({ trad_dt: '20261001' })];
    const d = await collect(makeDeps({ plan: { 'domestic/realized_pnl': () => ({ rows: dRows, summaries: [domPnlSummary(dRows)] }) } }).deps, 'cron', { ...P_, ...dom });
    expect(jobsOf(d)[0]).toMatchObject({ status: 'incomplete', inserted: 1 });
    expect(jobsOf(d)[0].reasons).toContain('row_out_of_range:1');
    expect((await q<{ t: string }[]>("SELECT DATE_FORMAT(trade_date,'%Y-%m-%d') AS t FROM broker_realized_pnl WHERE market='domestic'")).map((x) => x.t)).toEqual(['2026-11-02']);
    const oOk = [ovsPnlRow({ trad_day: '20261105' })];
    const o1 = await collect(makeDeps({ plan: { 'overseas/realized_pnl': () => ({ rows: oOk, summaries: [ovsPnlSummary(oOk)] }) } }).deps, 'cron', { ...P_, ...ovs });
    expect(jobsOf(o1)[0]).toMatchObject({ status: 'complete', inserted: 1 });
    const oBad = [ovsPnlRow({ trad_day: '20261106', ovrs_pdno: 'XMPB' })];
    const o2 = await collect(makeDeps({ plan: { 'overseas/realized_pnl': () => ({ rows: oBad, summaries: [ovsPnlSummary(oBad)] }) } }).deps, 'cron', { ...P_, ...ovs });
    expect(jobsOf(o2)[0]).toMatchObject({ status: 'incomplete', inserted: 0 });
  });

  test('27. 🔴 (C2 Medium) 호출이 run 당 상한 12 를 넘은 ended 결과 → incomplete(call_cap_exceeded), 받은 행은 저장', async () => {
    const r = await collect(makeDeps({ plan: { 'domestic/fills': () => ({ kisCalls: 13 }) } }).deps, 'cron', { ...F, ...dom });
    expect(jobsOf(r)[0]).toMatchObject({ status: 'incomplete', kisCalls: 13, inserted: 2 });
    expect(jobsOf(r)[0].reasons).toContain('call_cap_exceeded');
    const ok = await collect(makeDeps({ plan: { 'domestic/fills': () => ({ kisCalls: 12 }) } }).deps, 'cron', { ...F, ...dom });
    expect(jobsOf(ok)[0].status).toBe('complete');
  });

  /** 실제 풀을 감싸 쿼리 앞에 끼어드는 대역(오류 주입·SQL 기록용). 풀 쿼리는 hookPool 이 true 일 때만 훅을 거친다. 연결 반환·폐기를 센다. */
  function interceptPool(hook: (sql: string, v: unknown) => Promise<void>, o: { hookPool?: boolean; spy?: { released: number; destroyed: number } } = {}): SqlPool {
    return {
      query: async (s, v) => { if (o.hookPool) await hook(s, v); return pool.query(s, v as never) as unknown as Promise<[unknown, unknown]>; },
      getConnection: async () => {
        const c = await pool.getConnection();
        return {
          query: async (s: string, v?: unknown[]) => { await hook(s, v); return c.query(s, v as never) as unknown as [unknown, unknown]; },
          beginTransaction: () => c.beginTransaction(), commit: () => c.commit(), rollback: () => c.rollback(),
          release: () => { if (o.spy) o.spy.released += 1; c.release(); },
          destroy: () => { if (o.spy) o.spy.destroyed += 1; c.destroy(); },
        } as SqlConnection;
      },
    };
  }

  // ───────────────────────────── 감사 후속(Reviewer-2 M1·L1·L3) ─────────────────────────────
  test('19. 🔴 (M1) 다른 지문 환경의 실패 3건은 운영 크론을 halted 로 만들지 못한다 · 같은 지문의 연속 실패는 그대로 halted', async () => {
    await collect(makeDeps().deps, 'cron');   // 운영 anchor(FP, complete 6)
    for (let i = 0; i < 3; i++) {             // 다른 키 환경(FP_OTHER)이 3번 — 매번 6 run failed(account_changed)
      clock += 60_000;
      const dev = makeDeps({ pre: { ok: true, fingerprint: FP_OTHER }, resultFp: FP_OTHER });
      await collect(dev.deps, 'manual');
      expect(dev.calls).toEqual([]);
    }
    expect((await q<{ n: number }[]>("SELECT COUNT(*) AS n FROM broker_fill_runs WHERE status='failed' AND error='account_changed'"))[0].n).toBe(18);
    expect(await isHalted(pool as unknown as SqlPool, 1, 'domestic', 'fills', null, FP)).toBe(false);
    expect(await isHalted(pool as unknown as SqlPool, 1, 'domestic', 'fills', null, FP_OTHER)).toBe(true);
    clock += 60_000;
    const prod = makeDeps();
    const r = await collect(prod.deps, 'cron');
    expect(jobsOf(r).map((j) => j.status)).toEqual(Array(6).fill('complete'));
    expect(prod.calls).toHaveLength(6);
  });

  test('20. 🔴 (L3) RELEASE_LOCK 이 실패하면 연결을 풀에 돌려주지 않고 폐기한다 → 락이 풀리고 다음 실행이 돈다', async () => {
    const spy = { released: 0, destroyed: 0 };
    const p = interceptPool(async (sql) => { if (/RELEASE_LOCK/.test(sql)) throw Object.assign(new Error('gone'), { errno: 2013 }); }, { spy });
    const r = await collect(makeDeps({ db: p }).deps, 'cron', { kinds: ['fills'], markets: ['domestic'] });
    expect(r.status).toBe('done');
    expect(spy).toEqual({ released: 0, destroyed: 1 });
    let free = 0;
    for (let i = 0; i < 50 && free !== 1; i++) {
      free = Number((await q<{ f: number }[]>('SELECT IS_FREE_LOCK(?) AS f', [COLLECTOR_LOCK_NAME]))[0].f);
      if (free !== 1) await new Promise((res) => setTimeout(res, 20));
    }
    expect(free).toBe(1);
    const spy2 = { released: 0, destroyed: 0 };
    const r2 = await collect(makeDeps({ db: interceptPool(async () => undefined, { spy: spy2 }) }).deps, 'cron', { kinds: ['fills'], markets: ['domestic'] });
    expect(r2.status).toBe('done');
    expect(spy2).toEqual({ released: 1, destroyed: 0 });   // 정상이면 반환
  });

  test('21. (L1 ①) 조회 결과 범위가 계획과 다르면 failed(snapshot_date_mismatch·query_range_mismatch)·쓰기 0·baseline 없음', async () => {
    const snap = await collect(makeDeps({ plan: { 'overseas/position_snapshot': () => ({ queryFrom: '2026-11-02', queryTo: '2026-11-02' }) } }).deps, 'cron', { markets: ['overseas'], kinds: ['position_snapshot'] });
    expect(jobsOf(snap)[0]).toMatchObject({ status: 'failed' });
    expect(jobsOf(snap)[0].reasons).toContain('snapshot_date_mismatch');
    expect((await q<{ n: number }[]>('SELECT COUNT(*) AS n FROM broker_position_snapshots'))[0].n).toBe(0);
    const fills = await collect(makeDeps({ plan: { 'domestic/fills': (qr) => ({ queryFrom: '2026-10-01', queryTo: qr!.to }) } }).deps, 'cron', { markets: ['domestic'], kinds: ['fills'] });
    expect(jobsOf(fills)[0]).toMatchObject({ status: 'failed' });
    expect(jobsOf(fills)[0].reasons).toContain('query_range_mismatch');
    expect((await q<{ n: number }[]>('SELECT COUNT(*) AS n FROM broker_fills'))[0].n).toBe(0);
  });

  test('22. (L1 ②) 행 쓰기 중 전체 예산(75초)이 지나면 남은 행을 쓰지 않고 incomplete(time_budget_writes)', async () => {
    const r = await collect(makeDeps({ plan: { 'domestic/fills': () => { clock += 80_000; return {}; } } }).deps, 'cron', { markets: ['domestic'], kinds: ['fills'] });
    expect(jobsOf(r)[0]).toMatchObject({ status: 'incomplete', inserted: 0, writeFailures: 2 });
    expect(jobsOf(r)[0].reasons).toContain('time_budget_writes');
    expect((await q<{ n: number }[]>('SELECT COUNT(*) AS n FROM broker_fills'))[0].n).toBe(0);
  });

  test('23. 🔴 (L1 ④) SQL 은 전부 바인딩 — 데이터 값(주문번호·지문·심볼·시각)이 SQL 문자열에 없다(stale running 닫기 경로 포함)', async () => {
    await insertRunningRun(pool as unknown as SqlConnection, {
      accountId: 1, accountFingerprint: FP, market: 'domestic', kind: 'fills', sourceTr: 'TTTC0081R', windowFrom: '2026-11-03', windowTo: '2026-11-03',
      queryFrom: '2026-11-03', queryTo: '2026-11-03', trigger: 'cron', startedAt: kstDateTime(clock - 15 * 60_000), positiveCheck: 'pending',
    });
    const log: { sql: string; values: unknown }[] = [];
    const p = interceptPool(async (sql, v) => { log.push({ sql, values: v }); }, { hookPool: true });
    const r = await collect(makeDeps({ db: p }).deps, 'cron');
    expect(r.status === 'done' && r.closedStale).toBe(1);
    const cutoff = kstDateTime(T0 - 10 * 60_000);
    const needles = ['0000010001', '0000010002', '0000020001', FP, 'NAS:XMPL', '900010', cutoff, kstDateTime(T0), '2026-10-27', CRON_SWITCH_KEY, COLLECTOR_LOCK_NAME];
    for (const e of log) for (const n of needles) expect([e.sql.slice(0, 70), n, e.sql.includes(n)]).toEqual([e.sql.slice(0, 70), n, false]);
    // 공회전 아님 — 같은 값이 바인딩에는 들어 있다
    const bound = log.flatMap((e) => (Array.isArray(e.values) ? e.values : []));
    for (const n of ['0000010001', FP, cutoff, CRON_SWITCH_KEY, COLLECTOR_LOCK_NAME]) expect([n, bound.includes(n)]).toEqual([n, true]);
  });
});
