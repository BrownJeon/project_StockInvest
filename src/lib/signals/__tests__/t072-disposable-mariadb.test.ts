/**
 * T-072 — **일회용 MariaDB 실증 시험** (평소 jest 실행에서는 건너뛴다).
 *
 * 무엇을 실제 DB 로 확인하나:
 *  A. 마이그레이션(`scripts/migrations/T-072-validation-gate.sql`) — 2회 적용 멱등 · 기존 행 unvalidated · 시드 INSERT IGNORE 호환 ·
 *     STRICT 에서 ENUM 밖 값 거부 · `UNIQUE(signal_id)` 중복 거부 · 롤백(주석의 DROP) 후 재적용
 *  B. 관문 — 마이그레이션 전 `ER_BAD_FIELD_ERROR` → lookup_error(차단) / 매도는 조회 0 / 강등이 다음 호출에 반영
 *  C. 가상 체결 — 멱등(중복 1062 만 무시 — WP-2b 에서 `INSERT IGNORE` 제거), STRICT 데이터 오류는 잘라 넣지 않음, 감사 행
 *     (skipped·gate·price_at_skip)이 실제 signals 스키마에 들어간다. WP-2b: G2 카드(skipped + 가상 체결, 중복이면 가상 체결 없음)·
 *     G5 조건부 종결 UPDATE 의미
 *  D. 🔴 F-16 — `claimCooldown` 선점(inserted → active → 만료 후 reclaimed, 동시 10회 중 1회만 선점)과
 *     **`ON DUPLICATE KEY UPDATE` 로는 선점을 판단할 수 없다**(mysql2 기본 FOUND_ROWS: "삽입"과 "변경 없음"이 둘 다 affectedRows 1)
 *
 * 실행(운영·공용 DB 금지 — 127.0.0.1 에만 묶인 일회용 컨테이너, 끝나면 제거):
 *   docker run -d --rm --name t072-mariadb -p 127.0.0.1:33072:3306 -e MARIADB_ROOT_PASSWORD=t072test -e MARIADB_DATABASE=t072 \
 *     mariadb:<버전> --sql-mode=IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION
 *   T072_TEST_DB_PORT=33072 T072_TEST_DB_PASSWORD=t072test npx jest src/lib/signals/__tests__/t072-disposable-mariadb.test.ts
 *   docker rm -f t072-mariadb
 * sql_mode 는 운영(10.11.11) 실측값과 같다. 테이블 DDL 은 운영 `SHOW CREATE TABLE` 실측(10-23)을 옮겼다.
 */
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';

let mockPool: mysql.Pool | null = null;
jest.mock('@/lib/db', () => ({ getPool: () => { if (!mockPool) throw new Error('no pool'); return mockPool; } }));
jest.mock('@/lib/exchanges/kis', () => ({ kis: {}, getBalancesDetailed: jest.fn() }));
jest.mock('@/lib/exchanges/fx', () => ({ getUsdKrwRate: jest.fn(async () => { throw new Error('external fx must not be called'); }) }));
// WP-2b — post-market 카드 INSERT(G2)를 실제 DB 로 보려고 엔진 모듈을 불러온다. 외부 호출 모듈은 목(이 시험은 INSERT 함수만 쓴다).
jest.mock('@/lib/exchanges/kis-domestic', () => ({ getCandles: jest.fn() }));
jest.mock('@/lib/llm/provider', () => ({ runLlm: jest.fn() }));
jest.mock('@/lib/rag/retrieval', () => ({ retrieveRagContext: jest.fn() }));
jest.mock('@/lib/rag/format', () => ({ formatRagSection: jest.fn() }));
jest.mock('@/lib/strategy/universe', () => ({ getAlwaysIncludeSymbols: jest.fn(), getUniverseSnapshot: jest.fn() }));

import { evaluateValidationGate } from '@/lib/safety/validation-gate';
import { claimCooldown, setCooldown } from '@/lib/strategy/cooldowns';
import { insertScenarioCardIfAbsent } from '@/lib/strategy/post-market-engine';
import { insertPaperFill, insertValidationAuditSignal, type PaperFillOrigin } from '../paper-fill';

const PORT = process.env.T072_TEST_DB_PORT;
const maybe = PORT ? describe : describe.skip;

const MIGRATION = path.join(__dirname, '..', '..', '..', '..', 'scripts', 'migrations', 'T-072-validation-gate.sql');

/** `--` 주석을 지우고 `;` 로 나눈다(이 파일의 문자열 리터럴에는 `--`·`;` 가 없다) */
function statements(sql: string): string[] {
  return sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n').split(';').map((s) => s.trim()).filter(Boolean);
}
/** 맨 아래 "되돌리기" 주석 블록의 SQL */
function rollbackStatements(sql: string): string[] {
  const tail = sql.slice(sql.indexOf('-- 되돌리기'));
  return tail.split('\n').filter((l) => /^-- (ALTER|DROP) /.test(l)).map((l) => l.replace(/^-- /, '').replace(/;\s*$/, ''));
}

const DDL = [
  // 운영 SHOW CREATE TABLE (2026-10-23) — AUTO_INCREMENT 값만 뺐다
  `CREATE TABLE strategies (
    id varchar(64) NOT NULL, name varchar(64) NOT NULL, description varchar(255) NOT NULL DEFAULT '',
    tags longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(tags)),
    applicable_styles set('aggressive','neutral','stable') NOT NULL DEFAULT 'aggressive,neutral,stable',
    enabled tinyint(1) NOT NULL DEFAULT 0, backtest_interval_h float NOT NULL DEFAULT 6,
    last_backtest_at datetime DEFAULT NULL, next_backtest_at datetime DEFAULT NULL, backtest_running tinyint(1) NOT NULL DEFAULT 0,
    last_backtest_result longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(last_backtest_result)),
    stats_cache longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(stats_cache)),
    created_at datetime NOT NULL DEFAULT current_timestamp(), updated_at datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
    PRIMARY KEY (id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,
  `CREATE TABLE cooldowns (
    id bigint(20) unsigned NOT NULL AUTO_INCREMENT, scope enum('entry','rebuy','exit') NOT NULL, symbol varchar(32) NOT NULL,
    strategy_id varchar(64) NOT NULL DEFAULT '', side varchar(8) NOT NULL DEFAULT '', exit_kind varchar(24) NOT NULL DEFAULT '',
    \`until\` datetime NOT NULL, reason varchar(64) DEFAULT NULL,
    created_at datetime NOT NULL DEFAULT current_timestamp(), updated_at datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
    PRIMARY KEY (id), UNIQUE KEY uq_cooldown (scope,symbol,strategy_id,side,exit_kind),
    KEY idx_cooldown_lookup (scope,symbol,\`until\`), KEY idx_cooldown_until (\`until\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,
  `CREATE TABLE signals (
    id bigint(20) NOT NULL AUTO_INCREMENT, strategy_id varchar(64) DEFAULT NULL, symbol varchar(32) NOT NULL,
    side enum('buy','sell') NOT NULL, order_type enum('limit','market') NOT NULL,
    price decimal(36,8) DEFAULT NULL, quantity decimal(36,18) DEFAULT NULL, amount_krw decimal(18,2) NOT NULL, reasoning text DEFAULT NULL,
    indicators longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(indicators)),
    status enum('pending','approved','rejected','auto_submitted','expired','superseded','ai_skipped','approved_pending_entry','executing','pending_approval','detected','awaiting_approval','skipped') NOT NULL DEFAULT 'pending',
    expires_at datetime DEFAULT NULL, valid_from datetime DEFAULT NULL, consumed_order_id bigint(20) DEFAULT NULL,
    created_at datetime NOT NULL DEFAULT current_timestamp(), updated_at datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
    price_at_skip decimal(36,8) DEFAULT NULL, price_1h_after decimal(36,8) DEFAULT NULL, price_change_pct decimal(10,4) DEFAULT NULL,
    market enum('domestic','overseas') NOT NULL DEFAULT 'domestic', price_4h_after decimal(36,8) DEFAULT NULL, price_change_pct_4h decimal(10,4) DEFAULT NULL,
    price_24h_after decimal(36,8) DEFAULT NULL, price_change_pct_24h decimal(10,4) DEFAULT NULL, scenario_source varchar(32) DEFAULT NULL,
    PRIMARY KEY (id), UNIQUE KEY uq_signals_scenario_card (symbol,side,valid_from,scenario_source)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,
  `CREATE TABLE fx_rates (pair varchar(8) NOT NULL, rate decimal(10,4) NOT NULL, fetched_at datetime NOT NULL, PRIMARY KEY (pair))
    ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,
];

/** db.ts 시드와 같은 모양 — 열 목록을 명시한 INSERT IGNORE (validation_status 를 모른다) */
const seed = (id: string) => mockPool!.query(
  'INSERT IGNORE INTO strategies (id, name, description, tags, enabled, backtest_interval_h) VALUES (?, ?, ?, ?, 0, 6)', [id, id, '', '[]'],
);

maybe('T-072 일회용 MariaDB 실증', () => {
  const migration = fs.readFileSync(MIGRATION, 'utf8');
  const apply = async () => { for (const s of statements(migration)) await mockPool!.query(s); };

  beforeAll(async () => {
    // mysql2 기본 플래그 그대로(운영 db.ts 의 createPool 과 같다 — flags 미지정 = FOUND_ROWS 포함)
    mockPool = mysql.createPool({
      host: '127.0.0.1', port: Number(PORT), user: 'root', password: process.env.T072_TEST_DB_PASSWORD, database: process.env.T072_TEST_DB_NAME ?? 't072',
      connectionLimit: 10, timezone: '+09:00',
    });
    for (const t of ['paper_fills', 'signals', 'cooldowns', 'strategies', 'fx_rates']) await mockPool.query(`DROP TABLE IF EXISTS ${t}`);
    for (const d of DDL) await mockPool.query(d);
    for (const id of ['rsi-oversold-v1', 'ma-cross-v1', 'oversold-bounce-daily-v1']) await seed(id);
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterAll(async () => { await mockPool?.end(); mockPool = null; });

  test('환경: 운영과 같은 STRICT sql_mode', async () => {
    const [[row]] = await mockPool!.query<mysql.RowDataPacket[]>('SELECT @@sql_mode AS m, VERSION() AS v');
    expect(String(row.m)).toContain('STRICT_TRANS_TABLES');
    console.info(`[t072-db] ${row.v} · ${row.m}`);
  });

  test('B-1. 마이그레이션 전: 매수 → 실제 ER_BAD_FIELD_ERROR → lookup_error(차단) / 매도 → 조회 없이 허용', async () => {
    const v = await evaluateValidationGate({ side: 'buy', strategyId: 'rsi-oversold-v1' });
    expect(v).toMatchObject({ allowed: false, reason: 'lookup_error' });
    expect((v as { detail?: string }).detail).toContain('ER_BAD_FIELD_ERROR');
    await expect(evaluateValidationGate({ side: 'sell', strategyId: 'rsi-oversold-v1' })).resolves.toEqual({ allowed: true, kind: 'not_applicable' });
  });

  test('C-0. 마이그레이션 전: 가상 체결 INSERT 는 테이블 없음 → 던지지 않는다', async () => {
    await expect(insertPaperFill({
      signalId: 1, strategyId: 'x', gateReason: 'lookup_error', origin: 'engine', symbol: '005930', orderType: 'limit',
      limitPriceKrw: 1000, quantity: 1, amountKrw: 1000, fillModel: 'signal_limit_immediate',
    })).resolves.toMatchObject({ inserted: false, id: null });
  });

  test('A-1. 적용 → 기존 행 전부 unvalidated, 컬럼 정의', async () => {
    await apply();
    const [rows] = await mockPool!.query<mysql.RowDataPacket[]>('SELECT id, validation_status FROM strategies ORDER BY id');
    expect(rows.map((r) => r.validation_status)).toEqual(['unvalidated', 'unvalidated', 'unvalidated']);
    const [cols] = await mockPool!.query<mysql.RowDataPacket[]>("SHOW COLUMNS FROM strategies LIKE 'validation_%'");
    const st = cols.find((c) => c.Field === 'validation_status')!;
    expect(st.Type).toBe("enum('unvalidated','backtested','paper_validated')");
    expect(st.Null).toBe('NO');
    expect(st.Default).toBe('unvalidated');
    expect(cols.map((c) => c.Field)).toEqual(['validation_status', 'validation_changed_at', 'validation_evidence']);
  });

  test('A-2. 🔴 두 번째 적용도 오류 없음(멱등) — 컬럼·인덱스 중복 없음', async () => {
    await expect(apply()).resolves.toBeUndefined();
    const [cols] = await mockPool!.query<mysql.RowDataPacket[]>("SHOW COLUMNS FROM strategies LIKE 'validation_%'");
    expect(cols).toHaveLength(3);
    const [idx] = await mockPool!.query<mysql.RowDataPacket[]>("SHOW INDEX FROM paper_fills WHERE Key_name = 'uq_paper_fills_signal'");
    expect(idx).toHaveLength(1);
    expect(idx[0].Non_unique).toBe(0);
  });

  test('A-3. 시드 INSERT IGNORE(열 목록 명시, 구 코드) 호환 → 새 행도 unvalidated', async () => {
    await seed('inside-bar-v1');
    const [[r]] = await mockPool!.query<mysql.RowDataPacket[]>("SELECT validation_status FROM strategies WHERE id='inside-bar-v1'");
    expect(r.validation_status).toBe('unvalidated');
  });

  test('A-4. STRICT 에서 ENUM 밖 값은 거부된다(이상값은 DB 가 1차로 막는다)', async () => {
    await expect(mockPool!.query("UPDATE strategies SET validation_status='validated' WHERE id='ma-cross-v1'")).rejects.toMatchObject({ code: 'WARN_DATA_TRUNCATED' });
  });

  test('B-2. 관문: unvalidated 차단 → (사용자 승인 SQL) backtested → 허용 → 강등 → 다음 호출 즉시 차단, 미등록·null 차단', async () => {
    expect(await evaluateValidationGate({ side: 'buy', strategyId: 'rsi-oversold-v1' })).toMatchObject({ allowed: false, reason: 'unvalidated' });
    await mockPool!.query("UPDATE strategies SET validation_status='backtested', validation_changed_at=NOW(), validation_evidence='test' WHERE id='rsi-oversold-v1'");
    expect(await evaluateValidationGate({ side: 'buy', strategyId: 'rsi-oversold-v1' })).toMatchObject({ allowed: true, status: 'backtested' });
    await mockPool!.query("UPDATE strategies SET validation_status='unvalidated' WHERE id='rsi-oversold-v1'");
    expect((await evaluateValidationGate({ side: 'buy', strategyId: 'rsi-oversold-v1' })).allowed).toBe(false);
    expect(await evaluateValidationGate({ side: 'buy', strategyId: 'oversold-bounce-v1' })).toMatchObject({ reason: 'unregistered' });
    expect(await evaluateValidationGate({ side: 'buy', strategyId: null })).toMatchObject({ reason: 'null_strategy' });
  });

  test('C-1. 🔴 가상 체결 멱등: 같은 signal_id 두 번 → 1행 · 두 번째 inserted=false·duplicate / 직접 INSERT 는 ER_DUP_ENTRY', async () => {
    await mockPool!.query("REPLACE INTO fx_rates (pair, rate, fetched_at) VALUES ('USD_KRW', 1324.63, NOW())");
    const p = {
      signalId: 4242, strategyId: 'rsi-oversold-v1', gateReason: 'unvalidated' as const, origin: 'engine' as const, symbol: 'NAS:MU',
      orderType: 'limit' as const, limitPriceKrw: 280_000, quantity: 3, amountKrw: 1_000_000, fillModel: 'signal_limit_immediate' as const,
      validUntil: new Date(Date.now() + 30 * 60_000),
    };
    const a = await insertPaperFill(p);
    expect(a.inserted).toBe(true);
    expect(a.id).toBeGreaterThan(0);
    await expect(insertPaperFill({ ...p, amountKrw: 1 })).resolves.toEqual({ inserted: false, id: null, duplicate: true });
    const [rows] = await mockPool!.query<mysql.RowDataPacket[]>('SELECT * FROM paper_fills WHERE signal_id = 4242');
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].amount_krw)).toBe(1_000_000);
    expect(rows[0]).toMatchObject({ currency: 'USD', market: 'overseas', fill_model: 'signal_limit_immediate', origin: 'engine' });
    expect(Number(rows[0].limit_price)).toBe(211);          // 280,000 / 1324.63 = 211.38 → $1 단위 반올림(어댑터와 같다)
    expect(Number(rows[0].fx_usdkrw)).toBeCloseTo(1324.63, 4);
    expect(Number(rows[0].fee_rate_pct)).toBe(0.25);
    await expect(mockPool!.query(
      "INSERT INTO paper_fills (signal_id, gate_reason, origin, market, symbol, order_type, currency, amount_krw, fee_rate_pct, fill_model, signal_created_at) VALUES (4242,'unvalidated','engine','overseas','NAS:MU','limit','USD',1,0.25,'signal_limit_immediate',NOW())",
    )).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
  });

  test('C-3. 🔴 WP-2b — 중복이 아닌 STRICT 데이터 오류(origin 17자 > varchar(16))는 잘라 넣지 않고 기록 실패로 돌려준다 (IGNORE 였다면 잘려 들어갔다)', async () => {
    const p = {
      signalId: 4343, strategyId: 'rsi-oversold-v1', gateReason: 'unvalidated' as const, origin: 'x'.repeat(17) as PaperFillOrigin,
      symbol: '005930', orderType: 'limit' as const, limitPriceKrw: 70_000, quantity: 1, amountKrw: 70_000, fillModel: 'signal_limit_immediate' as const,
    };
    const r = await insertPaperFill(p);
    expect(r).toMatchObject({ inserted: false, id: null, error: expect.stringContaining('Data too long') });
    expect(r.duplicate).toBeUndefined();
    const [none] = await mockPool!.query<mysql.RowDataPacket[]>('SELECT COUNT(*) AS n FROM paper_fills WHERE signal_id = 4343');
    expect(Number(none[0].n)).toBe(0);
    // 대조(위험의 실증): 같은 값을 INSERT IGNORE 로 넣으면 STRICT 인데도 경고로 낮아져 **잘린 값으로 들어간다**
    const [ig] = await mockPool!.query<mysql.ResultSetHeader>(
      "INSERT IGNORE INTO paper_fills (signal_id, gate_reason, origin, market, symbol, order_type, currency, amount_krw, fee_rate_pct, fill_model, signal_created_at) VALUES (4343,'unvalidated',?,'domestic','005930','limit','KRW',1,0.014,'signal_limit_immediate',NOW())",
      ['x'.repeat(17)]);
    expect(ig.affectedRows).toBe(1);
    expect(ig.warningStatus).toBeGreaterThan(0);
    const [[row]] = await mockPool!.query<mysql.RowDataPacket[]>('SELECT origin FROM paper_fills WHERE signal_id = 4343');
    expect(String(row.origin)).toHaveLength(16);
  });

  test('C-4. 🔴 WP-2b G2 — 실제 signals 스키마: 미등록 전략 카드 → status=skipped + 관문 표지, 그 카드 id 로 가상 체결 1행 / 같은 카드 다시 → duplicate·가상 체결 그대로 1행', async () => {
    const row = {
      strategyId: 'eod-high-close-v1', symbol: '005380', price: 93500, reasoning: 'r',
      indicatorsJson: JSON.stringify({ ai: { scenario: { entry: { trigger: 'price_zone', price_zone: '93000~94000' }, exit: { target_pct: 3.5, stop_pct: 1.8 } } } }),
      expiresAt: '2030-01-07 15:30:00', validFrom: '2030-01-07 09:00:00', zoneLo: 93000, zoneHi: 94000, chasedPriceKrw: 93967.5,
    };
    await expect(insertScenarioCardIfAbsent(mockPool!, row)).resolves.toBe('blocked');
    const [[card]] = await mockPool!.query<mysql.RowDataPacket[]>(
      "SELECT id, status, strategy_id, JSON_UNQUOTE(JSON_EXTRACT(indicators, '$.gate')) AS gate, JSON_UNQUOTE(JSON_EXTRACT(indicators, '$.ai.scenario.exit.stop_pct')) AS stop, DATE_FORMAT(valid_from, '%Y-%m-%d %H:%i:%s') AS vf FROM signals WHERE symbol='005380' AND scenario_source='post-market'");
    expect(card).toMatchObject({ status: 'skipped', strategy_id: 'eod-high-close-v1', gate: 'validation_gate', stop: '1.8', vf: '2030-01-07 09:00:00' });
    const [fills] = await mockPool!.query<mysql.RowDataPacket[]>(
      "SELECT signal_id, origin, fill_model, gate_reason, quantity, zone_lo, zone_hi, DATE_FORMAT(valid_from, '%Y-%m-%d %H:%i:%s') AS vf, DATE_FORMAT(valid_until, '%Y-%m-%d %H:%i:%s') AS vu FROM paper_fills WHERE signal_id = ?", [card.id]);
    expect(fills).toHaveLength(1);
    expect(fills[0]).toMatchObject({ origin: 'post_market', fill_model: 'zone_touch_pending', gate_reason: 'unregistered', vf: '2030-01-07 09:00:00', vu: '2030-01-07 15:30:00' });
    expect([Number(fills[0].quantity), Number(fills[0].zone_lo), Number(fills[0].zone_hi)]).toEqual([1, 93000, 94000]);
    // 같은 키(종목·방향·valid_from·출처)로 다시 → NOT EXISTS 0행 → duplicate, 가상 체결 추가 없음
    await expect(insertScenarioCardIfAbsent(mockPool!, row)).resolves.toBe('duplicate');
    const [[cnt]] = await mockPool!.query<mysql.RowDataPacket[]>("SELECT (SELECT COUNT(*) FROM signals WHERE symbol='005380') AS s, (SELECT COUNT(*) FROM paper_fills WHERE signal_id = ?) AS p", [card.id]);
    expect([Number(cnt.s), Number(cnt.p)]).toEqual([1, 1]);
    // 대조: 같은 날 다른 종목·검증된 전략은 pending, 가상 체결 없음
    await mockPool!.query("UPDATE strategies SET validation_status='backtested' WHERE id='inside-bar-v1'");
    await expect(insertScenarioCardIfAbsent(mockPool!, { ...row, strategyId: 'inside-bar-v1', symbol: '055550' })).resolves.toBe('created');
    const [[ok]] = await mockPool!.query<mysql.RowDataPacket[]>("SELECT id, status FROM signals WHERE symbol='055550'");
    expect(ok.status).toBe('pending');
    const [[pc]] = await mockPool!.query<mysql.RowDataPacket[]>('SELECT COUNT(*) AS n FROM paper_fills WHERE signal_id = ?', [ok.id]);
    expect(Number(pc.n)).toBe(0);
    await mockPool!.query("UPDATE strategies SET validation_status='unvalidated' WHERE id='inside-bar-v1'");
  });

  test('C-5. WP-2b G5 — 조건부 종결 UPDATE: approved_pending_entry 만 superseded, 이미 executing 인 행은 0행(덮지 않음)', async () => {
    const ins = async (status: string) => {
      const [r] = await mockPool!.query<mysql.ResultSetHeader>(
        "INSERT INTO signals (strategy_id, symbol, side, order_type, price, amount_krw, status, market, scenario_source) VALUES (NULL, '000270', 'buy', 'limit', 100000, 300000, ?, 'domestic', 'user')", [status]);
      return r.insertId;
    };
    const SQL = "UPDATE signals SET status='superseded', updated_at=NOW() WHERE id=? AND status='approved_pending_entry'";
    const a = await ins('approved_pending_entry');
    const b = await ins('executing');
    const [ra] = await mockPool!.query<mysql.ResultSetHeader>(SQL, [a]);
    const [rb] = await mockPool!.query<mysql.ResultSetHeader>(SQL, [b]);
    expect([ra.affectedRows, rb.affectedRows]).toEqual([1, 0]);
    const [rows] = await mockPool!.query<mysql.RowDataPacket[]>('SELECT id, status FROM signals WHERE id IN (?, ?) ORDER BY id', [a, b]);
    expect(rows.map((r) => r.status)).toEqual(['superseded', 'executing']);
  });

  test('C-2. 감사 행이 실제 signals 스키마에 skipped·gate·price_at_skip 으로 들어간다', async () => {
    const id = await insertValidationAuditSignal({
      strategyId: 'rsi-oversold-v1', symbol: '005930', orderType: 'limit', price: 70_000, quantity: undefined, amountKrw: 300_000,
      reasoning: 'RSI', indicators: { rsi14: 31 }, expiresAt: new Date(Date.now() + 30 * 60_000), gateReason: 'unvalidated', gateStatus: 'unvalidated', origin: 'engine',
    });
    expect(id).toBeGreaterThan(0);
    const [[r]] = await mockPool!.query<mysql.RowDataPacket[]>(
      "SELECT status, side, price, price_at_skip, market, JSON_UNQUOTE(JSON_EXTRACT(indicators, '$.gate')) AS gate FROM signals WHERE id = ?", [id]);
    expect(r).toMatchObject({ status: 'skipped', side: 'buy', market: 'domestic', gate: 'validation_gate' });
    expect(Number(r.price)).toBe(70_000);
    expect(Number(r.price_at_skip)).toBe(70_000);
  });

  test('D-1. 🔴 claimCooldown: inserted → active → (만료) reclaimed', async () => {
    const key = { scope: 'entry' as const, symbol: 'NAS:MU', strategyId: 'rsi-oversold-v1', side: 'buy' as const };
    await expect(claimCooldown(key, 120, 'validation_gate')).resolves.toEqual({ claimed: true, outcome: 'inserted' });
    await expect(claimCooldown(key, 120, 'validation_gate')).resolves.toEqual({ claimed: false, outcome: 'active' });
    await mockPool!.query("UPDATE cooldowns SET `until` = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE symbol = 'NAS:MU'");
    await expect(claimCooldown(key, 120, 'validation_gate')).resolves.toEqual({ claimed: true, outcome: 'reclaimed' });
    const [[r]] = await mockPool!.query<mysql.RowDataPacket[]>("SELECT TIMESTAMPDIFF(MINUTE, NOW(), `until`) AS m, reason FROM cooldowns WHERE symbol='NAS:MU'");
    expect(Number(r.m)).toBeGreaterThanOrEqual(119);
    expect(r.reason).toBe('validation_gate');
  });

  test('D-2. 🔴 동시 10회 선점 → 정확히 1회만 claimed (새 키 · 만료 키 둘 다)', async () => {
    const fresh = { scope: 'entry' as const, symbol: '000660', strategyId: 'rsi-oversold-v1', side: 'buy' as const };
    const a = await Promise.all(Array.from({ length: 10 }, () => claimCooldown(fresh, 120, 'validation_gate')));
    expect(a.filter((x) => x.claimed)).toHaveLength(1);
    expect(a.filter((x) => x.outcome === 'error')).toHaveLength(0);
    await mockPool!.query("UPDATE cooldowns SET `until` = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE symbol = '000660'");
    const b = await Promise.all(Array.from({ length: 10 }, () => claimCooldown(fresh, 120, 'validation_gate')));
    expect(b.filter((x) => x.claimed)).toHaveLength(1);
    expect(b.filter((x) => x.outcome === 'reclaimed')).toHaveLength(1);
  });

  test('D-3. 🔴 ON DUPLICATE KEY UPDATE 는 선점을 알려주지 못한다 — 기본 FOUND_ROWS 에서 "삽입"과 "변경 없음"이 둘 다 1', async () => {
    const odku = (sym: string, ttl: number) => mockPool!.query<mysql.ResultSetHeader>(
      `INSERT INTO cooldowns (scope, symbol, strategy_id, side, exit_kind, \`until\`, reason)
       VALUES ('entry', ?, 's', 'buy', '', DATE_ADD(NOW(), INTERVAL ? MINUTE), 'r')
       ON DUPLICATE KEY UPDATE \`until\` = GREATEST(VALUES(\`until\`), \`until\`), reason = VALUES(reason)`, [sym, ttl]);
    const [inserted] = await odku('ODKU1', 240);               // 새 행
    const [unchanged] = await odku('ODKU1', 120);              // 이미 더 긴 쿨다운 → GREATEST 로 값 그대로(변경 없음)
    expect(inserted.affectedRows).toBe(1);
    expect(unchanged.affectedRows).toBe(1);                    // ← 구분 불가: 둘 다 1
    const [changed] = await odku('ODKU1', 480);                // 실제로 늘어난 갱신은 2
    expect(changed.affectedRows).toBe(2);
    // setCooldown(현행)도 마찬가지로 true 만 돌려준다 — "내가 처음 걸었는가"를 알 수 없다
    await expect(setCooldown({ scope: 'entry', symbol: 'ODKU2', strategyId: 's', side: 'buy' }, 120)).resolves.toBe(true);
    await expect(setCooldown({ scope: 'entry', symbol: 'ODKU2', strategyId: 's', side: 'buy' }, 120)).resolves.toBe(true);
    // 대조: FOUND_ROWS 를 끈 연결에서는 변경 없음 = 0 — 위 모호함은 mysql2 기본 플래그 때문이다
    const conn = await mysql.createConnection({
      host: '127.0.0.1', port: Number(PORT), user: 'root', password: process.env.T072_TEST_DB_PASSWORD, database: process.env.T072_TEST_DB_NAME ?? 't072',
      flags: ['-FOUND_ROWS'],
    });
    try {
      const [r] = await conn.query<mysql.ResultSetHeader>(
        `INSERT INTO cooldowns (scope, symbol, strategy_id, side, exit_kind, \`until\`, reason)
         VALUES ('entry', 'ODKU1', 's', 'buy', '', DATE_ADD(NOW(), INTERVAL 1 MINUTE), 'r')
         ON DUPLICATE KEY UPDATE \`until\` = GREATEST(VALUES(\`until\`), \`until\`), reason = VALUES(reason)`);
      expect(r.affectedRows).toBe(0);
    } finally { await conn.end(); }
  });

  test('A-5. 롤백(주석의 DROP) → 컬럼·테이블 제거, 두 번 실행해도 오류 없음, 재적용 가능', async () => {
    const rb = rollbackStatements(migration);
    expect(rb).toHaveLength(2);
    for (let i = 0; i < 2; i++) for (const s of rb) await mockPool!.query(s);
    const [cols] = await mockPool!.query<mysql.RowDataPacket[]>("SHOW COLUMNS FROM strategies LIKE 'validation_%'");
    expect(cols).toHaveLength(0);
    const [t] = await mockPool!.query<mysql.RowDataPacket[]>("SHOW TABLES LIKE 'paper_fills'");
    expect(t).toHaveLength(0);
    await apply();
    const [rows] = await mockPool!.query<mysql.RowDataPacket[]>('SELECT DISTINCT validation_status AS s FROM strategies');
    expect(rows.map((r) => r.s)).toEqual(['unvalidated']);
  });
});
