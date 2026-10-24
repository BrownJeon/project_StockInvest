/**
 * T-074 — **일회용 MariaDB 실증 시험** (평소 jest 실행에서는 건너뛴다).
 *
 * 무엇을 실제 DB 로 확인하나:
 *  A. 마이그레이션(`scripts/migrations/T-074-cash-flow-ledger.sql`) — 적용 전 ER_NO_SUCH_TABLE · 2회 적용 멱등 · 인덱스·CHECK·FK 개수 · 콜레이션 ·
 *     되돌리기(주석의 DROP·DELETE) 2회 → 재적용
 *  B. CHECK — 금액 0·통화·원 소수·초 단위·환전 counter NULL·입출금 counter 있음·같은 통화 환전 거부 /
 *     🔴 Analyst 초안의 chk_cfl_exch 는 환전 counter NULL 을 **통과시킨다**(NULL = UNKNOWN 은 CHECK 를 통과) — 수정 근거
 *  C. UNIQUE·FK — live 생성열 중복(살아 있는 행만) · 소프트 삭제 뒤 같은 행 다시 · 복구 시 중복 · 멱등키 · 한 번만 정정 · FK 2개
 *  D. 저장 계층 실물 — DECIMAL 문자열 → 숫자, DATETIME(Date) → KST 벽시계, 중복 키 구분(dupKeyOf)
 *  E. 조건부 UPDATE·트랜잭션 경합 — 취소 동시 5회 중 1회 · 정정 동시 5회 중 1회 · 복구 동시 5회 중 1회 · 낡은 매칭 0행 · 정정된 기록 복구 거부
 *  F. system_config — 기준 낙관적 잠금(동시 5회 중 1회) · 후보 표시 동시 3건 모두 저장(재시도)
 *  G. 전체 흐름(service) — 합성 스냅샷으로 손익 +705,000원 · 지연 매칭 저장 · 두 번째 조회 UPDATE 0 · 후보 기록 뒤 +5,000원
 *
 * 실행(운영·공용 DB 금지 — 127.0.0.1 에만 묶인 일회용 컨테이너, 끝나면 제거):
 *   docker run -d --rm --name t074-mariadb -p 127.0.0.1:33074:3306 -e MARIADB_ROOT_PASSWORD=t074test -e MARIADB_DATABASE=t074 \
 *     mariadb:11 --sql-mode=IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION
 *   T074_TEST_DB_PORT=33074 T074_TEST_DB_PASSWORD=t074test npx jest src/lib/ledger/__tests__/t074-disposable-mariadb.test.ts
 *   docker rm -f t074-mariadb
 * sql_mode 는 운영(10.11.11) 실측값과 같다. 기존 테이블 DDL 은 운영 `SHOW CREATE TABLE` 실측(10-23, 읽기 전용)에서 AUTO_INCREMENT 값만 뺐다.
 * 값은 전부 합성값이다(실제 계좌 값 아님).
 */
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';

let mockPool: unknown = null;
jest.mock('@/lib/db', () => ({ getPool: () => { if (!mockPool) throw new Error('no pool'); return mockPool; } }));

import * as store from '../store';
import * as svc from '../service';
import { demoSnapshotRows } from './helpers/fixtures';
import type { NormalizedEntry } from '../validate';

const PORT = process.env.T074_TEST_DB_PORT;
const maybe = PORT ? describe : describe.skip;
const MIGRATION = path.join(__dirname, '..', '..', '..', '..', 'scripts', 'migrations', 'T-074-cash-flow-ledger.sql');

function statements(sql: string): string[] {
  return sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n').split(';').map((s) => s.trim()).filter(Boolean);
}
function rollbackStatements(sql: string): string[] {
  const tail = sql.slice(sql.indexOf('-- 되돌리기'));
  return tail.split('\n').filter((l) => /^-- (DROP|DELETE) /.test(l)).map((l) => l.replace(/^-- /, '').replace(/;\s*$/, ''));
}

const DDL = [
  `CREATE TABLE accounts (
    id int(11) NOT NULL AUTO_INCREMENT, exchange varchar(16) NOT NULL, label varchar(64) NOT NULL,
    created_at datetime NOT NULL DEFAULT current_timestamp(), PRIMARY KEY (id), UNIQUE KEY uq_exchange_label (exchange,label)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,
  `CREATE TABLE users (
    id int(10) unsigned NOT NULL AUTO_INCREMENT, email varchar(255) NOT NULL, password_hash varchar(255) DEFAULT NULL,
    kis_app_key_enc text DEFAULT NULL, kis_app_secret_enc text DEFAULT NULL, kis_account_no_enc text DEFAULT NULL,
    kis_account_product varchar(4) NOT NULL DEFAULT '01', kis_mock tinyint(1) NOT NULL DEFAULT 0, kis_connected_at datetime DEFAULT NULL,
    kis_access_token text DEFAULT NULL, kis_access_token_expires_at datetime DEFAULT NULL, email_verified tinyint(1) NOT NULL DEFAULT 0,
    created_at datetime NOT NULL DEFAULT current_timestamp(), updated_at datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
    oauth_provider varchar(50) DEFAULT NULL, oauth_id varchar(255) DEFAULT NULL,
    PRIMARY KEY (id), UNIQUE KEY uq_users_email (email), UNIQUE KEY uq_users_oauth (oauth_provider,oauth_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,
  `CREATE TABLE system_config (
    \`key\` varchar(64) NOT NULL,
    value longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(value)),
    updated_at datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(), PRIMARY KEY (\`key\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,
  `CREATE TABLE portfolio_snapshots (
    id bigint(20) NOT NULL AUTO_INCREMENT, ts datetime NOT NULL, total_krw bigint(20) NOT NULL,
    positions longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(positions)),
    source varchar(20) NOT NULL DEFAULT 'hourly', PRIMARY KEY (id), KEY idx_ts (ts DESC)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,
];

/** 쓰기 SQL 을 세는 얇은 대리(실제 풀 그대로 실행) */
const sqlLog: string[] = [];
function proxied(real: mysql.Pool) {
  const wrapQ = (q: (s: string, v?: unknown[]) => Promise<unknown>) => (s: string, v?: unknown[]) => { sqlLog.push(s.replace(/\s+/g, ' ').trim()); return q(s, v); };
  return {
    query: wrapQ((s, v) => real.query(s, v as never)),
    getConnection: async () => {
      const c = await real.getConnection();
      return {
        query: wrapQ((s, v) => c.query(s, v as never)),
        beginTransaction: () => c.beginTransaction(), commit: () => c.commit(), rollback: () => c.rollback(), release: () => c.release(),
      };
    },
  };
}
const writes = () => sqlLog.filter((s) => /^(INSERT|UPDATE|DELETE|REPLACE)/i.test(s));

const KST = (s: string) => new Date(`${s.replace(' ', 'T')}+09:00`);
const NOW = KST('2026-09-15 09:55');
const NOW_WALL = '2026-09-15 09:55:00';
const n = (p: Partial<NormalizedEntry>): NormalizedEntry => ({
  kind: 'deposit', occurredAt: '2026-09-03 10:00', occurredAtMs: 0, currency: 'KRW', amount: 1_000_000, counterCurrency: null, counterAmount: null, memo: null, ...p,
});
let cidN = 0;
const cid = () => `t074-db-${String(++cidN).padStart(4, '0')}`;

maybe('T-074 일회용 MariaDB 실증', () => {
  let real: mysql.Pool;
  const migration = fs.readFileSync(MIGRATION, 'utf8');
  const apply = async () => { for (const s of statements(migration)) await real.query(s); };
  const raw = (sql: string, v: unknown[] = []) => real.query<mysql.RowDataPacket[]>(sql, v as never).then(([r]) => r);
  const errOf = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as { errno?: number; code?: string; sqlMessage?: string }; } };
  const insRaw = (cols: Record<string, unknown>) => {
    const keys = Object.keys(cols);
    return real.query(`INSERT INTO cash_flow_ledger (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, Object.values(cols) as never);
  };

  beforeAll(async () => {
    real = mysql.createPool({
      host: '127.0.0.1', port: Number(PORT), user: 'root', password: process.env.T074_TEST_DB_PASSWORD, database: process.env.T074_TEST_DB_NAME ?? 't074',
      connectionLimit: 10, timezone: '+09:00',   // 운영 db.ts createPool 과 같은 설정(decimalNumbers 없음 → DECIMAL 은 문자열)
    });
    mockPool = proxied(real);
    for (const t of ['cash_flow_ledger', 'draft_chk', 'portfolio_snapshots', 'system_config', 'users', 'accounts']) await real.query(`DROP TABLE IF EXISTS ${t}`);
    for (const d of DDL) await real.query(d);
    await real.query("INSERT INTO accounts (exchange, label) VALUES ('kis', 'default')");
    await real.query("INSERT INTO users (email) VALUES ('t074@example.invalid')");
    for (const s of demoSnapshotRows()) {
      await real.query('INSERT INTO portfolio_snapshots (id, ts, total_krw, positions) VALUES (?, ?, ?, ?)', [s.id, s.ts, s.total_krw, s.positions] as never);
    }
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterAll(async () => { await real?.end(); mockPool = null; });

  test('환경: 운영과 같은 STRICT sql_mode', async () => {
    const [row] = await raw('SELECT @@sql_mode AS m, VERSION() AS v');
    expect(String(row.m)).toContain('STRICT_TRANS_TABLES');
    console.info(`[t074-db] ${row.v} · ${row.m}`);
  });

  test('A-1. 마이그레이션 전: 원장 읽기 → 실제 ER_NO_SUCH_TABLE → isNoTable(라우트는 503 not_migrated)', async () => {
    const e = await errOf(store.readEntries());
    expect(store.isNoTable(e)).toBe(true);
    expect(store.isNoTable(await errOf(svc.getFeed(NOW)))).toBe(true);
    // QA D-2: 실제 MariaDB 에서도 표 확인(LIMIT 0)이 1146 을 내고, 기준 저장은 system_config 에 아무것도 쓰지 않는다
    expect(store.isNoTable(await errOf(store.assertLedgerTable()))).toBe(true);
    const w0 = writes().length;
    expect(store.isNoTable(await errOf(svc.putBaseline({ snapshotId: 100, confirmed: { krwCash: '1200000' }, baseVersion: 0 }, NOW)))).toBe(true);
    expect(writes().length).toBe(w0);
    expect(Number((await raw("SELECT COUNT(*) AS n FROM system_config WHERE `key` = 'cash_ledger_baseline'"))[0].n)).toBe(0);
  });

  test('A-2. 🔴 2회 적용 멱등 · 인덱스 6(PRIMARY 포함) · UNIQUE 3 · CHECK 5 · FK 2 · 콜레이션 utf8mb4_general_ci', async () => {
    await apply();
    await expect(apply()).resolves.toBeUndefined();
    const idx = await raw("SELECT INDEX_NAME AS k, MIN(NON_UNIQUE) AS nu FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cash_flow_ledger' GROUP BY INDEX_NAME ORDER BY INDEX_NAME");
    expect(idx.map((r) => [r.k, Number(r.nu)])).toEqual([
      ['idx_cfl_account_time', 1], ['idx_cfl_anchor', 1], ['PRIMARY', 0], ['uq_cfl_client_entry', 0], ['uq_cfl_live_dup', 0], ['uq_cfl_supersedes', 0],
    ]);
    const chk = await raw("SELECT CONSTRAINT_NAME AS c FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'cash_flow_ledger' ORDER BY CONSTRAINT_NAME");
    expect(chk.map((r) => r.c)).toEqual(['chk_cfl_amount', 'chk_cfl_ccy', 'chk_cfl_exch', 'chk_cfl_krw_int', 'chk_cfl_minute']);
    const fk = await raw("SELECT CONSTRAINT_NAME AS c, REFERENCED_TABLE_NAME AS t FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'cash_flow_ledger' ORDER BY CONSTRAINT_NAME");
    expect(fk.map((r) => [r.c, r.t])).toEqual([['fk_cfl_account', 'accounts'], ['fk_cfl_super', 'cash_flow_ledger']]);
    const [t] = await raw("SELECT TABLE_COLLATION AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cash_flow_ledger'");
    expect(t.c).toBe('utf8mb4_general_ci');
    const [u] = await raw("SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cash_flow_ledger' AND COLUMN_NAME = 'created_by_user_id'");
    const [uu] = await raw("SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'id'");
    expect(u.t).toBe(uu.t);   // int(10) unsigned — users.id 와 같은 타입
  });

  const base = { client_entry_id: 'chk-base-01', kind: 'deposit', occurred_at: '2026-09-03 10:00:00', currency: 'KRW', amount: '1000' };
  test.each([
    ['금액 0', { amount: '0' }, 'chk_cfl_amount'],
    ['통화 EUR', { currency: 'EUR' }, 'chk_cfl_ccy'],
    ['원화 소수', { amount: '1000.50' }, 'chk_cfl_krw_int'],
    ['초 단위', { occurred_at: '2026-09-03 10:00:30' }, 'chk_cfl_minute'],
    ['환전 counter NULL', { kind: 'exchange' }, 'chk_cfl_exch'],
    ['환전 같은 통화', { kind: 'exchange', counter_currency: 'KRW', counter_amount: '1' }, 'chk_cfl_exch'],
    ['환전 받은 원화 소수', { kind: 'exchange', currency: 'USD', amount: '10', counter_currency: 'KRW', counter_amount: '12500.5' }, 'chk_cfl_exch'],
    ['입출금 counter 있음', { counter_currency: 'USD', counter_amount: '1' }, 'chk_cfl_exch'],
  ])('B. CHECK %s → 4025 %s', async (_n, over, name) => {
    const e = await errOf(insRaw({ ...base, ...over }));
    expect(e?.errno).toBe(4025);
    expect(e?.sqlMessage).toContain(name);
  });

  test('B-0. 🔴 Analyst 초안의 chk_cfl_exch 는 환전 counter NULL 을 통과시킨다(NULL = UNKNOWN) → 수정본은 거부', async () => {
    await real.query(`CREATE TABLE draft_chk (id INT PRIMARY KEY AUTO_INCREMENT, kind ENUM('deposit','withdrawal','exchange') NOT NULL, currency CHAR(3) NOT NULL,
      counter_currency CHAR(3) NULL, counter_amount DECIMAL(18,2) NULL,
      CONSTRAINT chk_cfl_exch CHECK ((kind = 'exchange' AND counter_currency IN ('KRW','USD') AND counter_currency <> currency AND counter_amount > 0)
        OR (kind <> 'exchange' AND counter_currency IS NULL AND counter_amount IS NULL)))`);
    await real.query("INSERT INTO draft_chk (kind, currency, counter_currency, counter_amount) VALUES ('exchange', 'KRW', NULL, NULL)");
    const [c] = await raw('SELECT COUNT(*) AS n FROM draft_chk');
    expect(Number(c.n)).toBe(1);
    expect((await errOf(insRaw({ ...base, kind: 'exchange' })))?.errno).toBe(4025);
    await real.query('DROP TABLE draft_chk');
  });

  test('B-1. STRICT 에서 ENUM 밖 값 거부 · 정상 행은 들어간다', async () => {
    expect((await errOf(insRaw({ ...base, kind: 'dividend' })))?.code).toBe('WARN_DATA_TRUNCATED');
    await insRaw({ ...base });
    await insRaw({ ...base, client_entry_id: 'chk-base-02', kind: 'exchange', counter_currency: 'USD', counter_amount: '0.80' });
    const [c] = await raw("SELECT COUNT(*) AS n FROM cash_flow_ledger WHERE client_entry_id LIKE 'chk-base-%'");
    expect(Number(c.n)).toBe(2);
  });

  test('C-1. 🔴 live 생성열 UNIQUE: 살아 있는 같은 (계좌·종류·통화·금액·분) 거부 → 소프트 삭제 뒤 다시 가능 → 복구 시 거부', async () => {
    const e = await errOf(insRaw({ ...base, client_entry_id: 'chk-base-03' }));
    expect(e?.errno).toBe(1062);
    expect(store.dupKeyOf(e)).toBe('live');
    await real.query("UPDATE cash_flow_ledger SET deleted_at = '2026-09-03 10:30:00' WHERE client_entry_id = 'chk-base-01'");
    await insRaw({ ...base, client_entry_id: 'chk-base-03' });
    await insRaw({ ...base, client_entry_id: 'chk-base-04', amount: '1000.00', deleted_at: '2026-09-03 10:40:00' });   // 삭제 행끼리는 NULL → 충돌 없음
    const r = await errOf(real.query("UPDATE cash_flow_ledger SET deleted_at = NULL WHERE client_entry_id = 'chk-base-01'"));
    expect(store.dupKeyOf(r)).toBe('live');
    const [lv] = await raw("SELECT live FROM cash_flow_ledger WHERE client_entry_id = 'chk-base-04'");
    expect(lv.live).toBeNull();
  });

  test('C-2. 멱등키 UNIQUE · 한 번만 정정(uq_cfl_supersedes) · FK(계좌·정정 대상)', async () => {
    expect(store.dupKeyOf(await errOf(insRaw({ ...base, amount: '7', client_entry_id: 'chk-base-03' })))).toBe('client');
    const [[orig]] = await real.query<mysql.RowDataPacket[]>("SELECT id FROM cash_flow_ledger WHERE client_entry_id = 'chk-base-03'");
    await insRaw({ ...base, amount: '8', client_entry_id: 'chk-sup-01', supersedes_id: orig.id });
    expect(store.dupKeyOf(await errOf(insRaw({ ...base, amount: '9', client_entry_id: 'chk-sup-02', supersedes_id: orig.id })))).toBe('supersedes');
    expect((await errOf(insRaw({ ...base, amount: '10', client_entry_id: 'chk-fk-01', account_id: 999 })))?.errno).toBe(1452);
    expect((await errOf(insRaw({ ...base, amount: '11', client_entry_id: 'chk-fk-02', supersedes_id: 99_999_999 })))?.errno).toBe(1452);
    await real.query('DELETE FROM cash_flow_ledger ORDER BY id DESC');   // 자기 참조 FK — 정정한 행(자식)부터   // 시험 데이터 정리(이 컨테이너 안에서만)
  });

  test('D-1. 저장 계층 실물: INSERT → 읽기(DECIMAL 문자열 → 숫자 · DATETIME Date → KST 벽시계) · 달러 2자리', async () => {
    const id1 = await store.insertEntryRow(n({ amount: 2_000_000, memo: '😀 합성' }), { clientEntryId: cid(), userId: 1, nowWall: NOW_WALL, supersedesId: null });
    const id2 = await store.insertEntryRow(n({ currency: 'USD', amount: 118.6, occurredAt: '2026-09-12 21:30' }), { clientEntryId: cid(), userId: 1, nowWall: NOW_WALL, supersedesId: null });
    const [r2] = await raw('SELECT amount, occurred_at FROM cash_flow_ledger WHERE id = ?', [id2]);
    expect(typeof r2.amount).toBe('string');            // mysql2 기본: DECIMAL 은 문자열
    expect(r2.amount).toBe('118.60');
    expect(r2.occurred_at).toBeInstanceOf(Date);         // timezone '+09:00' 풀 → 순간
    const all = await store.readEntries();
    const e1 = all.find((e) => e.id === id1)!;
    const e2 = all.find((e) => e.id === id2)!;
    expect([e1.amount, e1.memo, e1.anchorStatus, e1.createdByUserId]).toEqual([2_000_000, '😀 합성', 'pending', 1]);
    expect(e2.amount).toBe(118.6);
    const view = svc.toEntryView(e2, undefined, new Map(), null);
    expect([view.occurredAt, view.createdAt]).toEqual(['2026-09-12 21:30', NOW_WALL]);
    const [fmt] = await raw("SELECT DATE_FORMAT(occurred_at, '%Y-%m-%d %H:%i:%s') AS o, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS c FROM cash_flow_ledger WHERE id = ?", [id2]);
    expect([fmt.o, fmt.c]).toEqual(['2026-09-12 21:30:00', NOW_WALL]);   // DB 에 KST 벽시계 그대로
  });

  test('E-1. 🔴 취소 동시 5회 → 정확히 1회만 영향 1행', async () => {
    const id = await store.insertEntryRow(n({ amount: 31_000 }), { clientEntryId: cid(), userId: 1, nowWall: NOW_WALL, supersedesId: null });
    const r = await Promise.all(Array.from({ length: 5 }, (_, i) => store.voidEntryRow(id, `동시 ${i}`, 1, NOW_WALL)));
    expect(r.reduce((a, b) => a + b, 0)).toBe(1);
  });

  test('E-2. 🔴 정정 동시 5회(키 다름) → ok 1 · already_voided 4 · 새 행 1', async () => {
    const id = await store.insertEntryRow(n({ amount: 32_000 }), { clientEntryId: cid(), userId: 1, nowWall: NOW_WALL, supersedesId: null });
    const r = await Promise.all(Array.from({ length: 5 }, (_, i) => store.correctEntryTx(id, n({ amount: 32_100 + i }), { clientEntryId: cid(), userId: 1, nowWall: NOW_WALL, reason: '정정' })));
    expect(r.filter((x) => x.kind === 'ok')).toHaveLength(1);
    expect(r.filter((x) => x.kind === 'already_voided')).toHaveLength(4);
    const [c] = await raw('SELECT COUNT(*) AS n FROM cash_flow_ledger WHERE supersedes_id = ?', [id]);
    expect(Number(c.n)).toBe(1);
    // 정정된 기록은 복구 거부
    const sup = await store.restoreEntryTx(id);
    expect(sup.kind).toBe('superseded');
  });

  test('E-3. 정정: 같은 (종류·금액·분)으로 메모만 바꿔도 된다(원래 행을 먼저 지운다) · 다른 살아 있는 행과 겹치면 dup_live 롤백', async () => {
    const id = await store.insertEntryRow(n({ amount: 33_000, memo: '처음' }), { clientEntryId: cid(), userId: 1, nowWall: NOW_WALL, supersedesId: null });
    const ok = await store.correctEntryTx(id, n({ amount: 33_000, memo: '고침' }), { clientEntryId: cid(), userId: 1, nowWall: NOW_WALL, reason: '정정' });
    expect(ok.kind).toBe('ok');
    const other = await store.insertEntryRow(n({ amount: 34_000 }), { clientEntryId: cid(), userId: 1, nowWall: NOW_WALL, supersedesId: null });
    const dup = await store.correctEntryTx(other, n({ amount: 33_000 }), { clientEntryId: cid(), userId: 1, nowWall: NOW_WALL, reason: '정정' });
    expect(dup.kind).toBe('dup_live');
    const [o] = await raw('SELECT deleted_at FROM cash_flow_ledger WHERE id = ?', [other]);
    expect(o.deleted_at).toBeNull();   // 롤백됨
  });

  test('E-4. 🔴 복구 동시 5회 → ok 1 · not_voided 4 / 낡은 매칭 UPDATE 는 0행', async () => {
    const id = await store.insertEntryRow(n({ amount: 35_000 }), { clientEntryId: cid(), userId: 1, nowWall: NOW_WALL, supersedesId: null });
    await store.voidEntryRow(id, '실수', 1, NOW_WALL);
    const r = await Promise.all(Array.from({ length: 5 }, () => store.restoreEntryTx(id)));
    expect(r.filter((x) => x.kind === 'ok')).toHaveLength(1);
    expect(r.filter((x) => x.kind === 'not_voided')).toHaveLength(4);
    const next = { status: 'matched' as const, snapshotId: 102, snapshotTs: '2026-09-03 10:40:00', detail: 'x', fxRateUsed: null, fxSource: null, krwEquiv: 35_000, suggest: null };
    expect(await store.updateAnchor(id, { status: 'unmatched', snapshotId: null }, next)).toBe(0);   // 저장 상태와 다름
    expect(await store.updateAnchor(id, { status: 'pending', snapshotId: null }, next)).toBe(1);
    expect(await store.updateAnchor(id, { status: 'pending', snapshotId: null }, next)).toBe(0);     // 이미 바뀜
    const [row] = await raw("SELECT anchor_status, anchor_snapshot_id, DATE_FORMAT(anchor_snapshot_ts, '%Y-%m-%d %H:%i:%s') AS ts, krw_equiv FROM cash_flow_ledger WHERE id = ?", [id]);
    expect([row.anchor_status, Number(row.anchor_snapshot_id), row.ts, row.krw_equiv]).toEqual(['matched', 102, '2026-09-03 10:40:00', '35000.00']);
    await real.query('DELETE FROM cash_flow_ledger ORDER BY id DESC');   // 자기 참조 FK — 정정한 행(자식)부터
  });

  test('F-1. 🔴 기준 낙관적 잠금(실제 JSON_EXTRACT): 첫 저장 → 버전 1 · 동시 5회(baseVersion 1) 중 1회만', async () => {
    const next = { baselineAt: '2026-09-01 07:10:00', snapshotId: 100, snapshot: { totalKrw: 16_060_000, krwCash: 1_200_000, usdCash: 1500, fx: 1240 }, confirmed: { krwCash: null, usdCash: null, at: null, note: null }, baselineTotalKrw: 16_060_000 };
    expect((await store.saveBaseline(next, 0, NOW_WALL)).ok).toBe(true);
    expect((await store.saveBaseline(next, 0, NOW_WALL)).ok).toBe(false);
    const r = await Promise.all(Array.from({ length: 5 }, () => store.saveBaseline(next, 1, NOW_WALL)));
    expect(r.filter((x) => x.ok)).toHaveLength(1);
    const b = await store.readBaseline();
    expect(b.status === 'ok' && b.doc.version).toBe(2);
    await real.query("DELETE FROM system_config WHERE `key` = 'cash_ledger_baseline'");
  });

  test('F-2. 후보 표시 동시 3건(다른 키) → 재시도로 3건 모두 저장', async () => {
    const keys = ['201-KRW', '202-KRW', '203-USD'];
    await Promise.all(keys.map((k) => store.updateMarks((doc) => {
      doc.marks[k] = { state: 'dismissed', reason: '합성', at: NOW_WALL, byUserId: 1 };
      doc.log.push({ key: k, action: 'dismiss', reason: '합성', at: NOW_WALL, byUserId: 1 });
      return { write: true, result: k };
    }, NOW_WALL)));
    const m = await store.readMarks();
    expect(m.status === 'ok' && Object.keys(m.doc.marks).sort()).toEqual(keys);
    await real.query("DELETE FROM system_config WHERE `key` = 'cash_ledger_candidate_marks'");
  });

  test('G. 전체 흐름(service, 실제 DB): 손익 +705,000원 · 지연 매칭 저장 · 다음 조회 UPDATE 0 · 후보 기록 뒤 +5,000원', async () => {
    const put = await svc.putBaseline({ snapshotId: 100, confirmed: { krwCash: '1200000', usdCash: '1500' }, baseVersion: 0 }, NOW);
    expect(put.status).toBe(200);
    const add = (b: Record<string, unknown>) => svc.createEntry({ clientEntryId: cid(), baseVersion: 1, ...b }, 1, NOW);
    expect((await add({ kind: 'deposit', currency: 'KRW', amount: '1,000,000', occurredAt: '2026-09-03 10:00' })).status).toBe(200);
    expect((await add({ kind: 'exchange', currency: 'KRW', amount: '1260000', counterCurrency: 'USD', counterAmount: '1000', occurredAt: '2026-09-05 13:00' })).status).toBe(200);
    const w = await add({ kind: 'withdrawal', currency: 'KRW', amount: '3000000', occurredAt: '2026-09-10 14:00' });
    const wid = (w.body.entry as { id: number }).id;
    expect((await add({ kind: 'deposit', currency: 'USD', amount: '200', occurredAt: '2026-09-12 21:30' })).status).toBe(200);
    const cor = await svc.correctEntry(String(wid), { clientEntryId: cid(), baseVersion: 1, kind: 'withdrawal', currency: 'KRW', amount: '300000', occurredAt: '2026-09-10 14:00' }, 1, NOW);
    expect(cor.status).toBe(200);
    const pend = await add({ kind: 'deposit', currency: 'KRW', amount: '500000', occurredAt: '2026-09-15 09:50' });
    const feed = (pend.body as { data: { summary: Record<string, unknown>; candidates: { key: string }[] } }).data;
    expect(feed.summary).toMatchObject({ b0: 16_060_000, v: 17_715_000, net: 950_000, P: 705_000, pending: { count: 1, krw: 500_000 }, unmatched: 0 });
    expect(feed.candidates.map((c) => c.key)).toEqual(['109-KRW']);
    const rows = await raw("SELECT kind, amount, anchor_status, anchor_snapshot_id, fx_rate_used, krw_equiv, deleted_at IS NOT NULL AS voided FROM cash_flow_ledger ORDER BY id");
    expect(rows.map((r) => [r.kind, r.amount, r.anchor_status, r.anchor_snapshot_id == null ? null : Number(r.anchor_snapshot_id), r.fx_rate_used, r.krw_equiv, Number(r.voided)])).toEqual([
      ['deposit', '1000000.00', 'matched', 102, null, '1000000.00', 0],
      ['exchange', '1260000.00', 'matched', 104, '1256.2000', null, 0],
      ['withdrawal', '3000000.00', 'unmatched', null, null, '3000000.00', 1],
      ['deposit', '200.00', 'matched', 107, '1250.0000', '250000.00', 0],
      ['withdrawal', '300000.00', 'matched', 105, null, '300000.00', 0],
      ['deposit', '500000.00', 'pending', null, null, null, 0],
    ]);
    sqlLog.length = 0;
    const again = await svc.getFeed(NOW);
    expect((again.body as { data: { summary: { P: number } } }).data.summary.P).toBe(705_000);
    expect(writes()).toEqual([]);
    const rec = await add({ kind: 'deposit', currency: 'KRW', amount: '700000', occurredAt: '2026-09-14 22:20', fromCandidateKey: '109-KRW' });
    expect(rec.body).toMatchObject({ candidateResolved: true, data: { summary: { P: 5_000 } } });
    // 쓰기는 원장·기준 키뿐이었다
    for (const s of writes()) expect(s).toMatch(/^(INSERT INTO|UPDATE) (cash_flow_ledger|system_config)\b/);
  });

  test('A-3. 되돌리기(주석의 DROP·DELETE) 2회 → 테이블·키 제거, 재적용 가능', async () => {
    const rb = rollbackStatements(migration);
    expect(rb).toHaveLength(2);
    for (let i = 0; i < 2; i++) for (const s of rb) await real.query(s);
    expect(await raw("SHOW TABLES LIKE 'cash_flow_ledger'")).toHaveLength(0);
    expect(await raw("SELECT `key` FROM system_config WHERE `key` LIKE 'cash_ledger_%'")).toHaveLength(0);
    await apply();
    expect(await raw("SHOW TABLES LIKE 'cash_flow_ledger'")).toHaveLength(1);
  });
});
