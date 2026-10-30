/**
 * T-108 — **일회용 MariaDB 실증 시험** (평소 jest 에서는 건너뛴다 — `T108_OPS_DB_PORT` 가 있을 때만).
 *
 * 무엇을 실제 DB 로 확인하나: ops 지표 계층이 보내는 SELECT 가 **MariaDB 10.11 + 운영과 같은 sql_mode**
 * (STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION — NBE 없음)에서 문법 오류 없이 돌고
 * (`SET STATEMENT max_statement_time … FOR SELECT`, `JSON_VALUE`, `IN (?)` 배열 전개, KST 벽시계 바인딩), 합성 데이터에서 기대한 숫자·상태를 내는가.
 * 실행 경로는 라우트와 같다 — `buildHome`·`buildTrade`·`buildFunnel`·`buildAnalysis`·`readSafetyState` 가 `getPool()`(이 시험의 일회용 풀)로 읽는다.
 * 표 DDL: 실행·판단 기록 3표는 `scripts/migrations/T-112-run-judgment-record.sql` 그대로, 나머지는 운영 `SHOW CREATE TABLE` 의 열·인덱스를 옮겼다
 * (외래키·일부 CHECK 생략). 표 이름 일부는 조각으로 만든다 — 격리 시험들이 src 전체 문자열을 본다.
 *
 * 실행(운영·공용 DB 금지 — 127.0.0.1 에만 묶인 일회용 컨테이너, 끝나면 제거. 비밀번호는 환경변수로만):
 *   T108_OPS_DB_PASSWORD="$(head -c 24 /dev/urandom | base64 | tr -dc A-Za-z0-9 | head -c 24)"; export T108_OPS_DB_PASSWORD
 *   docker run -d --rm --pull=never --name t108-ops-a -p 127.0.0.1:33118:3306 -e TZ=Asia/Seoul -e MARIADB_ROOT_PASSWORD="$T108_OPS_DB_PASSWORD" \
 *     -e MARIADB_DATABASE=t108ops mariadb:10.11 \
 *     --sql-mode=STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION --default-time-zone=+09:00
 *   T108_OPS_DB_PORT=33118 node ./node_modules/jest/bin/jest.js src/lib/ops/metrics/__tests__/ops-disposable-mariadb.test.ts
 *   docker rm -fv t108-ops-a
 * 값은 전부 합성값이다.
 */
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';

let mockPool: mysql.Pool | null = null;
jest.mock('@/lib/db', () => ({
  getPool: () => { if (!mockPool) throw new Error('운영 풀 사용 금지(시험)'); return mockPool; },
  ping: async () => !!mockPool,
}));
jest.mock('@/lib/notify', () => ({ sendAlert: jest.fn() }));

import { buildAnalysis } from '../analysis';
import { buildFunnel } from '../funnel';
import { buildHome } from '../home';
import { readSafetyState } from '../safety-state';
import { buildTrade } from '../trade';
import { resetRecordSwitchCacheForTest } from '@/lib/strategy/records/record-switch';
import { kst } from './fake-reader';

const PORT = process.env.T108_OPS_DB_PORT;
const maybe = PORT ? describe : describe.skip;
const MIGRATION = path.join(__dirname, '..', '..', '..', '..', '..', 'scripts', 'migrations', 'T-112-run-judgment-record.sql');
const BARS = ['daily', 'bars'].join('_');
const J = 'judg' + 'ment';

const DDL = [
  `CREATE TABLE market_holidays (market enum('domestic','overseas') NOT NULL, holiday_date date NOT NULL, name varchar(64) DEFAULT NULL, half_day tinyint(1) NOT NULL DEFAULT 0, PRIMARY KEY (market, holiday_date))`,
  `CREATE TABLE strategies (id varchar(64) NOT NULL PRIMARY KEY, name varchar(64) NOT NULL, enabled tinyint(1) NOT NULL DEFAULT 0, validation_status enum('unvalidated','backtested','paper_validated') NOT NULL DEFAULT 'unvalidated')`,
  'CREATE TABLE system_config (`key` varchar(64) NOT NULL PRIMARY KEY, value longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(value)), updated_at datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp())',
  `CREATE TABLE signals (id bigint(20) NOT NULL AUTO_INCREMENT PRIMARY KEY, strategy_id varchar(64) DEFAULT NULL, symbol varchar(32) NOT NULL, side enum('buy','sell') NOT NULL,
     order_type enum('limit','market') NOT NULL, price decimal(36,8) DEFAULT NULL, quantity decimal(36,18) DEFAULT NULL, amount_krw decimal(18,2) NOT NULL, reasoning text DEFAULT NULL,
     indicators longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(indicators)),
     status enum('pending','approved','rejected','auto_submitted','expired','superseded','ai_skipped','approved_pending_entry','executing','pending_approval','detected','awaiting_approval','skipped') NOT NULL DEFAULT 'pending',
     expires_at datetime DEFAULT NULL, valid_from datetime DEFAULT NULL, consumed_order_id bigint(20) DEFAULT NULL, created_at datetime NOT NULL DEFAULT current_timestamp(),
     updated_at datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(), market enum('domestic','overseas') NOT NULL DEFAULT 'domestic', scenario_source varchar(32) DEFAULT NULL,
     KEY idx_signals_status (status, created_at DESC), KEY idx_signals_consumed (consumed_order_id), KEY idx_signals_market (market, created_at DESC), KEY idx_signals_valid_from (valid_from, status))`,
  `CREATE TABLE orders (id bigint(20) NOT NULL AUTO_INCREMENT PRIMARY KEY, account_id int(11) NOT NULL DEFAULT 1, client_order_id varchar(64) NOT NULL, symbol varchar(32) NOT NULL, side enum('buy','sell') NOT NULL,
     type enum('limit','market') NOT NULL, price decimal(36,8) DEFAULT NULL, quantity decimal(36,18) DEFAULT NULL, amount_krw decimal(18,2) DEFAULT NULL,
     status enum('pending','accepted','partially_filled','filled','cancelled','rejected','failed','dry_run','blocked') NOT NULL DEFAULT 'pending', blocked_by varchar(32) DEFAULT NULL,
     source enum('manual','signal','auto') NOT NULL DEFAULT 'manual', created_at datetime NOT NULL DEFAULT current_timestamp(), updated_at datetime NOT NULL DEFAULT current_timestamp(),
     market enum('domestic','overseas') NOT NULL DEFAULT 'domestic', UNIQUE KEY uq_client_order_id (client_order_id), KEY idx_orders_market (market, created_at DESC))`,
  `CREATE TABLE executions (id bigint(20) NOT NULL AUTO_INCREMENT PRIMARY KEY, order_id bigint(20) NOT NULL, price decimal(36,8) NOT NULL, quantity decimal(36,18) NOT NULL, fee decimal(36,8) NOT NULL DEFAULT 0,
     executed_at datetime NOT NULL DEFAULT current_timestamp(), KEY idx_order (order_id, executed_at DESC))`,
  `CREATE TABLE eval_funnel (id bigint(20) unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY, run_id varchar(40) NOT NULL, ts datetime NOT NULL DEFAULT current_timestamp(), market enum('domestic','overseas') NOT NULL,
     symbol varchar(32) DEFAULT NULL, strategy_id varchar(64) DEFAULT NULL, side enum('buy','sell') DEFAULT NULL, stage tinyint(3) unsigned NOT NULL, gate varchar(48) NOT NULL,
     verdict enum('pass','skip','error') NOT NULL, reason varchar(64) DEFAULT NULL, detail longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(detail)),
     KEY idx_ef_run (run_id), KEY idx_ef_ts (ts), KEY idx_ef_gate (gate, ts), KEY idx_ef_market (market, ts, stage))`,
  `CREATE TABLE position_state (symbol varchar(32) NOT NULL, market enum('domestic','overseas') NOT NULL, entry_price decimal(36,8) NOT NULL, peak_price decimal(36,8) NOT NULL, qty decimal(36,18) DEFAULT NULL,
     first_seen_at datetime NOT NULL DEFAULT current_timestamp(), updated_at datetime NOT NULL DEFAULT current_timestamp(), scenario_exit longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(scenario_exit)),
     holding_deadline datetime DEFAULT NULL, PRIMARY KEY (symbol, market))`,
  `CREATE TABLE portfolio_snapshots (id bigint(20) NOT NULL AUTO_INCREMENT PRIMARY KEY, ts datetime NOT NULL, total_krw bigint(20) NOT NULL,
     positions longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(positions)), source varchar(20) NOT NULL DEFAULT 'hourly', KEY idx_ts (ts DESC))`,
  `CREATE TABLE fx_rates (pair varchar(8) NOT NULL PRIMARY KEY, rate decimal(10,4) NOT NULL, fetched_at datetime NOT NULL)`,
  `CREATE TABLE ${BARS} (market varchar(8) NOT NULL, symbol varchar(32) NOT NULL, trade_date date NOT NULL, close decimal(18,4) NOT NULL, volume bigint(20) NOT NULL, currency char(3) NOT NULL,
     adj_mode varchar(12) NOT NULL, is_final tinyint(1) NOT NULL DEFAULT 1, source varchar(32) NOT NULL, fetched_at datetime NOT NULL, PRIMARY KEY (market, symbol, trade_date), KEY idx_date (trade_date))`,
  `CREATE TABLE stock_favorites (id bigint(20) NOT NULL AUTO_INCREMENT PRIMARY KEY, symbol varchar(32) NOT NULL UNIQUE, research_enabled tinyint(1) NOT NULL DEFAULT 0)`,
  `CREATE TABLE broker_fill_runs (id bigint(20) NOT NULL AUTO_INCREMENT PRIMARY KEY, market enum('domestic','overseas') NOT NULL, started_at datetime NOT NULL,
     status enum('running','complete','incomplete','failed') NOT NULL DEFAULT 'running')`,
  `CREATE TABLE paper_fills (id bigint(20) NOT NULL AUTO_INCREMENT PRIMARY KEY, signal_id bigint(20) NOT NULL UNIQUE)`,
];

function statements(sql: string): string[] {
  return sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n').split(';').map((s) => s.trim()).filter(Boolean);
}

/** 국내 장중 5분 틱(09:05~15:25, 77개) 의 run 행 + 그 틱의 손실한도 손절 OFF 스킵 행. */
function domesticTicks(date: string): unknown[][] {
  const rows: unknown[][] = [];
  for (let m = 9 * 60 + 5; m <= 15 * 60 + 25; m += 5) {
    const ts = `${date} ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`;
    rows.push([`r-${date}-${m}`, ts, 'domestic', null, null, null, 0, 'run', 'pass', null, '{}']);
    rows.push([`r-${date}-${m}`, ts, 'domestic', '000001', null, 'sell', 25, 'exit_hard_stop_disabled', 'skip', null, '{"exitKind":"hard_stop"}']);
  }
  return rows;
}

maybe('T-108 ops 지표 — 일회용 MariaDB 10.11', () => {
  const NOW = kst('2026-10-30 22:00');

  beforeAll(async () => {
    const admin = await mysql.createConnection({ host: '127.0.0.1', port: Number(PORT), user: 'root', password: process.env.T108_OPS_DB_PASSWORD, database: 't108ops', multipleStatements: false });
    for (const t of ['market_holidays', 'strategies', 'system_config', 'signals', 'orders', 'executions', 'eval_funnel', 'position_state', 'portfolio_snapshots', 'fx_rates', BARS,
      'stock_favorites', 'broker_fill_runs', 'paper_fills', 'job_run_log', `${J}_candidate`, `${J}_run`]) await admin.query(`DROP TABLE IF EXISTS ${t}`);
    for (const d of DDL) await admin.query(d);
    for (const s of statements(fs.readFileSync(MIGRATION, 'utf8'))) await admin.query(s);

    const ins = (sql: string, rows: unknown[][]) => (rows.length ? admin.query(sql, [rows]) : Promise.resolve());
    await ins('INSERT INTO market_holidays (market, holiday_date) VALUES ?', [['domestic', '2026-10-09'], ['overseas', '2026-11-26']]);
    await ins('INSERT INTO strategies (id, name, enabled, validation_status) VALUES ?',
      Array.from({ length: 16 }, (_, i) => [`s${i}`, `s${i}`, i < 3 ? 1 : 0, 'unvalidated']));
    await ins('INSERT INTO system_config (`key`, value, updated_at) VALUES ?', [
      ['safety_dry_run', 'true', '2026-10-01 00:00:00'], ['safety_kill_switch', 'false', '2026-10-30 09:08:00'],
      ['exit_engine_enabled', 'true', '2026-10-30 09:08:00'], ['exit_hard_stop_enabled', 'false', '2026-10-01 00:00:00'],
      ['notify_signal_auto_submit', 'false', '2026-05-11 00:00:00'], ['job_run_log_enabled', 'true', '2026-10-30 21:05:27'],
      ['style_default_trailingActivatePct', '3.5', '2026-05-11 00:00:00'], ['style_default_trailingDrawdownPct', '1.2', '2026-05-11 00:00:00'],
      ['news_zero_streak:fetch:domestic', '{"streak":2,"lastDate":"2026-10-30","lastCount":0,"lastOkDate":"2026-10-28"}', '2026-10-30 06:00:00'],
      ['news_zero_streak:fetch:overseas', '{"streak":0,"lastDate":"2026-10-30","lastCount":12,"lastOkDate":"2026-10-30"}', '2026-10-30 06:00:00'],
    ]);
    await ins('INSERT INTO orders (id, client_order_id, symbol, side, type, status, blocked_by, source, created_at, market) VALUES ?', [
      [1, 'c1', '000001', 'sell', 'market', 'dry_run', null, 'auto', '2026-10-30 15:26:51', 'domestic'],
      [2, 'c2', 'NAS:AAPL', 'buy', 'limit', 'rejected', 'kis_rejected', 'signal', '2026-10-30 21:30:00', 'overseas'],   // ET 10-30 08:30 = 해외 「오늘」
      [3, 'c3', 'NAS:MSFT', 'buy', 'limit', 'rejected', 'kis_rejected', 'signal', '2026-10-30 04:00:00', 'overseas'],   // ET 10-29 — 해외 「오늘」 아님
      [4, 'c4', '000005', 'buy', 'limit', 'blocked', 'daily_limit', 'signal', '2026-10-30 10:30:00', 'domestic'],    // 안전장치 차단(한도)
      [5, 'c5', '000006', 'buy', 'limit', 'blocked', 'kill_switch', 'signal', '2026-10-30 10:31:00', 'domestic'],    // 모든거래차단 — 차단 줄에서 뺀다
    ]);
    await ins('INSERT INTO signals (id, strategy_id, symbol, side, order_type, amount_krw, indicators, status, expires_at, valid_from, consumed_order_id, created_at, market, scenario_source) VALUES ?', [
      [1, 'ai-post-market', '000002', 'buy', 'limit', 100000, '{"ai":{"confidence":72},"gate":"validation_gate"}', 'skipped', '2026-10-31 15:30:00', '2026-10-31 09:00:00', null, '2026-10-30 16:05:00', 'domestic', 'post-market'],
      [2, 'exit-engine-v1', '000001', 'sell', 'market', 980, '{"exit_kind":"eod_loss_cut"}', 'auto_submitted', null, null, 1, '2026-10-30 15:26:49', 'domestic', null],
      [3, 'ma-cross', 'NAS:AAPL', 'buy', 'limit', 100000, '{}', 'pending', '2026-10-31 05:00:00', null, null, '2026-10-30 21:00:00', 'overseas', null],
      [4, 'ma-cross', '000003', 'buy', 'limit', 100000, '{}', 'detected', '2026-10-31 09:00:00', null, null, '2026-10-30 10:00:00', 'domestic', null],
      [5, 'rsi-oversold-v1', '000004', 'buy', 'limit', 100000, '{"gate":"validation_gate"}', 'skipped', null, null, null, '2026-10-30 10:05:00', 'domestic', null],
      [6, 'exit-engine-v1', '000001', 'sell', 'market', 980, '{"exit_kind":"target_profit"}', 'expired', '2026-10-30 12:00:00', null, null, '2026-10-30 11:00:00', 'domestic', null],
    ]);
    await ins('INSERT INTO eval_funnel (run_id, ts, market, symbol, strategy_id, side, stage, gate, verdict, reason, detail) VALUES ?', [
      ...domesticTicks('2026-10-29'), ...domesticTicks('2026-10-30'),
      ['o-1', '2026-10-30 04:00:00', 'overseas', null, null, null, 0, 'run', 'pass', null, '{}'],   // ET 10-29 세션 — 해외 「오늘」(ET 10-30) 아님
      ['o-1', '2026-10-30 04:00:00', 'overseas', 'NAS:AAPL', null, 'sell', 24, 'exit_no_fire', 'pass', null, '{"pnlPct":0.5}'],
    ]);
    await ins('INSERT INTO job_run_log (job_id, run_kind, market, target, scheduled_slot_at, started_at, ended_at, status, http_code, counts_json, session_date_kst, session_date_et, recorder) VALUES ?', [
      ['post-market-domestic', 'analysis', 'domestic', 'llm', '2026-10-30 16:00:00', '2026-10-30 16:00:03', '2026-10-30 16:04:00', 'ok', 200, '{"evaluated":44,"candidates":5,"created":1,"blocked":1}', '2026-10-30', null, 'runner_hook'],
      ['daily-bars', 'ingest', 'common', 'kis', '2026-10-24 07:40:00', '2026-10-24 07:40:10', '2026-10-24 07:41:00', 'ok', 200, null, '2026-10-24', null, 'runner_hook'],
    ]);
    await ins('INSERT INTO position_state (symbol, market, entry_price, peak_price, qty) VALUES ?', [['000001', 'domestic', 100, 100, 10], ['NAS:AAPL', 'overseas', 100, 104, 1]]);
    await ins('INSERT INTO portfolio_snapshots (ts, total_krw, positions) VALUES ?', [
      ['2026-10-30 21:00:00', 1000000, JSON.stringify([
        { currency: 'KRW', qty: 500000, price: 1, value_krw: 500000 }, { currency: 'USD', qty: 300, price: 1380, value_krw: 414000 },
        { currency: '000001', qty: 10, price: 98, value_krw: 980 }, { currency: 'NAS:AAPL', qty: 1, price: 103, value_krw: 103 },
      ])],
    ]);
    await ins('INSERT INTO fx_rates (pair, rate, fetched_at) VALUES ?', [['USD_KRW', 1380, '2026-10-30 21:55:00']]);
    await ins(`INSERT INTO ${BARS} (market, symbol, trade_date, close, volume, currency, adj_mode, is_final, source, fetched_at) VALUES ?`, [
      ['KR', '000002', '2026-10-29', 1, 1, 'KRW', 'raw', 1, 't', '2026-10-30 07:40:00'],
      ['KR', '000002', '2026-10-30', 1, 1, 'KRW', 'raw', 0, 't', '2026-10-30 15:40:00'],   // 확정 아님 — 세지 않는다
      ['US', 'NAS:AAPL', '2026-10-29', 1, 1, 'USD', 'raw', 1, 't', '2026-10-30 07:40:00'],
    ]);
    await ins('INSERT INTO stock_favorites (symbol, research_enabled) VALUES ?', [['000001', 1], ['000002', 1], ['000003', 0]]);
    await ins('INSERT INTO broker_fill_runs (market, started_at, status) VALUES ?', [['domestic', '2026-10-30 07:20:00', 'complete']]);
    await ins('INSERT INTO paper_fills (signal_id) VALUES ?', [[1]]);
    await admin.end();

    mockPool = mysql.createPool({ host: '127.0.0.1', port: Number(PORT), user: 'root', password: process.env.T108_OPS_DB_PASSWORD, database: 't108ops', timezone: '+09:00', connectionLimit: 5 });
    resetRecordSwitchCacheForTest();
  });

  afterAll(async () => { await mockPool?.end(); mockPool = null; });

  it('sql_mode 가 운영과 같다(NBE 없음)', async () => {
    const [rows] = await mockPool!.query('SELECT @@SESSION.sql_mode AS m');
    const m = String((rows as { m: string }[])[0].m);
    expect(m).toContain('STRICT_TRANS_TABLES');
    expect(m).not.toContain('NO_BACKSLASH_ESCAPES');
  });

  it('안전 상태 — 같은 판독기', async () => {
    const s = await readSafetyState(NOW);
    expect(s).toMatchObject({
      stage: 'observe', liveTrading: false, killSwitch: false, notifyAutoSubmit: false, errors: [],
      exitEngine: { enabled: true, hardStopEnabled: false, source: 'config' },
      strategies: { total: 16, enabled: 3, validated: 0, validatedEnabled: 0 },
      killSwitchSince: '2026-10-30T09:08:00+09:00',
    });
  });

  it('홈 — 모든 섹션 ok, 숫자·상태가 합성 데이터와 맞다', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const h = await buildHome(NOW);
    const errs = warn.mock.calls.map((c) => String(c[0])).filter((x) => x.includes('[ops/metrics]'));
    warn.mockRestore();
    expect(errs).toEqual([]);
    expect(h.stage).toBe('observe');
    for (const k of ['checks', 'counts', 'analysis', 'exit', 'activity'] as const) expect(h[k]).toMatchObject({ state: 'ok' });
    expect(h.observe?.state).toBe('ok');

    if (h.counts.state !== 'ok') throw new Error();
    expect(h.counts.data.approval).toEqual({ domestic: 0, overseas: 1 });
    expect(h.counts.data.rejectedToday).toBe(1);   // ET 10-29 의 거부는 해외 「오늘」이 아니다

    if (h.analysis.state !== 'ok') throw new Error();
    expect(h.analysis.data.domestic).toMatchObject({
      session: { sessionDate: '2026-10-30', tz: 'KST' }, runStatus: 'ok',
      evaluated: { state: 'available', value: 44 }, ruleCandidates: { state: 'available', value: 5 },
      signalsCreated: { state: 'available', value: 1 }, signalsBlocked: { state: 'available', value: 1 }, signalsPending: { state: 'zero', value: 0 },
      aiBuy: { state: 'prep', reason: 'record_off' },
    });
    expect(h.analysis.data.overseas.evaluated).toMatchObject({ state: 'unknown', reason: 'no_record' });
    expect(h.analysis.data.domestic.nextRunAt).toBe('2026-11-02T16:00:00+09:00');

    if (h.exit.state !== 'ok') throw new Error();
    expect(h.exit.data.lastEval.domestic).toMatchObject({ state: 'available', value: { at: '2026-10-30T15:25:00+09:00', runsToday: 77, sessionOpen: false } });
    expect(h.exit.data.lastEval.overseas.state).toBe('off_hours');   // ET 10-30 에는 아직 run 없음(04:00 KST 행은 ET 10-29)
    expect(h.exit.data.judgments.domestic).toMatchObject({ value: { hardStopOffHit: 1, hardStopOffDays: 2, hardStopOffTicks: 77, noFire: 0 } });
    expect(h.exit.data.judgments.overseas.state).toBe('off_hours');
    expect(h.exit.data.proposals).toMatchObject({ state: 'available', value: { total: 2, virtual: 1, expired: 1, firstKind: 'eod_loss_cut', blockedByKill: 0, submittedLive: 0 } });
    expect(h.exit.data.nextOverseasOpenKst).toBe('2026-10-30T22:30:00+09:00');
    expect(h.exit.data.nextOverseasOpenChange).toEqual({ sessionDate: '2026-11-02', openKst: '2026-11-02T23:30:00+09:00' });

    if (h.checks.state !== 'ok') throw new Error();
    // 일봉은 국내·해외 모두 10-29 가 「있어야 할 날짜」(10-30 봉은 10-31 07:40 수집) → 신선. 이상은 뉴스 국내(0건 2일 연속) 1건.
    expect(h.checks.data.map((c) => c.kind)).toEqual(['awaiting_approval', 'order_rejected', 'order_blocked', 'hard_stop_off_hit', 'virtual_exit', 'data_anomaly', 'analysis_unknown']);
    expect(h.checks.data.find((c) => c.kind === 'order_blocked')).toMatchObject({ count: 1, params: { symbol: '000005', reason: 'daily_limit' } });
    expect(h.checkCoverage).toEqual({ approval: true, orders: true, anomalies: false, exitConditions: true, safety: true });
    expect(h.anomalies.state).toBe('ok');
    expect(h.checks.data.find((c) => c.kind === 'analysis_unknown')?.market).toBe('overseas');

    if (h.observe?.state !== 'ok') throw new Error();
    const a4 = h.observe.data.anomalies;
    expect(a4.state).toBe('partial');   // 해외 실행 기록이 아직 없다
    expect(a4.value?.items).toEqual([expect.objectContaining({ source: 'news_domestic', state: 'partial', streak: 2, label: '뉴스 국내' })]);
    const pm = h.observe.data.postmortem;
    expect(pm).toMatchObject({ value: { total: 1, done: 0, tracking: 1, lastBarDate: { domestic: '2026-10-29', overseas: '2026-10-29' } } });

    if (h.activity.state !== 'ok') throw new Error();
    // 최신순 4건: 해외 거부 21:30 · 국내 분석 16:00 · 가상 청산 15:26 · 차단 주문 10:31 (10:05 장중 차단 요약은 잘림)
    expect(h.activity.data.map((x) => x.kind)).toEqual(['order', 'analysis', 'order', 'order']);
    expect(h.activity.data[3]).toMatchObject({ title: '주문 차단 — 000006 매수', sub: '모든거래차단 · 송신 안 됨' });
    expect(h.activity.data[2]).toMatchObject({ title: '가상 청산 기록 — 000001 매도', sub: '장마감 전 손절 · 주문 송신 없음' });
  });

  it('거래 — 보유 구간·관측 기록·주문 전 차단', async () => {
    const t = await buildTrade(NOW);
    for (const k of ['counts', 'executing', 'blockedPostMarket', 'holdings', 'openOrders'] as const) expect(t[k]).toMatchObject({ state: 'ok' });
    if (t.counts.state !== 'ok' || t.holdings.state !== 'ok' || t.blockedPostMarket.state !== 'ok') throw new Error();
    expect(t.counts.data).toMatchObject({ approval: { domestic: 0, overseas: 1 }, detected: 1, preOrderBlockedToday: 2 });
    expect(t.holdings.data).toMatchObject({ accountCount: 2, autoCount: 0, trailing: { activatePct: 3.5, drawdownPct: 1.2, source: 'override' }, thresholds: { hardStopPct: 1.5, source: 'default' } });
    const byS = Object.fromEntries(t.holdings.data.rows.map((r) => [r.symbol, r]));
    expect(byS['000001']).toMatchObject({ zone: 'hard_stop', pnlPct: -2, detail: { thresholdPct: -1.5 } });
    expect(byS['NAS:AAPL'].zone).toBe('not_evaluated');   // 22:00 KST = 미국 장 전
    expect(t.blockedPostMarket.data).toEqual([expect.objectContaining({ symbol: '000002', confidence: 72, session: { market: 'domestic', sessionDate: '2026-10-30', tz: 'KST' } })]);
  });

  it('깔때기 — 기본 시장·세션일·요약', async () => {
    const f = await buildFunnel(null, NOW);
    expect(f.defaultMarket).toBe('domestic');
    expect(f.market).toBe('domestic');
    expect(f.sessions.overseas.session.sessionDate).toBe('2026-10-29');   // 마지막 run 의 ET 날짜
    expect(f.summary.state).toBe('ok');
    if (f.summary.state === 'ok') expect(f.summary.data.runs).toBe(77);
    const o = await buildFunnel('overseas', NOW);
    expect(o.summary.state).toBe('ok');
  });

  it('분석 3칸 — 섹션 전부 ok', async () => {
    const today = await buildAnalysis('today', NOW);
    const verify = await buildAnalysis('verify', NOW);
    const data = await buildAnalysis('data', NOW);
    if (today.part !== 'today' || verify.part !== 'verify' || data.part !== 'data') throw new Error();
    expect(today.runs.state).toBe('ok');
    expect(today.candidates).toMatchObject({ state: 'ok', data: { rows: [expect.objectContaining({ symbol: '000002', origin: 'signal', confidence: 72, signalStatus: 'skipped' })], skipRows: { state: 'prep' } } });
    expect(today.researchCount).toMatchObject({ state: 'available', value: 2 });
    expect(verify.postmortem.state).toBe('ok');
    expect(verify.exit.state).toBe('ok');
    if (verify.exit.state === 'ok') {
      expect(verify.exit.data.coverage.domestic).toMatchObject({ value: { positions: 1, evaluated: 1 } });
      expect(verify.exit.data.zones).toMatchObject({ value: { hardStop: 1, notEvaluated: 1 } });
      expect(verify.exit.data.gap).toMatchObject({ state: 'prep', value: { expectedSlots: 78, runs: 77 } });
    }
    expect(verify.paperFills).toMatchObject({ state: 'available', value: 1 });
    expect(data.sources.state).toBe('ok');
    expect(data.uptime).toMatchObject({ state: 'ok' });
    // 첫 기록 10-24 > 창 시작 10-23 → 아직 주 단위 비율 없음, 기록 7일째
    if (data.uptime.state === 'ok') expect(data.uptime.data[0]).toMatchObject({ group: 'analysis', state: 'prep', reason: 'under_7_days', days: 7 });
  });
});
