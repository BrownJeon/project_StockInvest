/**
 * T-179 — **일회용 MariaDB 실증 시험**: 부팅 DB 준비(setupDB)가 보내는 문장과 그 결과 스키마.
 * 평소 jest 실행에서는 DB 부분을 건너뛴다(T179_TEST_DB_PORT 가 없으면 describe.skip).
 *
 * 무엇을 실제 DB 로 확인하나
 *  A. 빈 스키마에서 setupDB → 테이블·컬럼·인덱스가 모두 만들어진다(스냅샷 저장).
 *  B. 두 번째 기동 → 첫 기동 대비 symbol_universe.market 만 늘어난다(T-179 이전부터의 순서 — 보존 확인).
 *  C. 세 번째 기동(=운영 재시작과 같은 상태) → 스키마가 바뀌지 않고,
 *     이미 원하는 상태인 ALTER·CREATE INDEX 는 **한 문장도 보내지 않는다**(T-179 WP-2).
 *  C. 문장 순번(ordinal)·종류·성공/실패 기록 — 운영 boot-diagnostics 의 ordinal 과 같은 방식으로 센다
 *     (setupDB 의 풀 facade 에 대한 query/execute 호출 순서). T179_TRACE_OUT 이 있으면 JSON 으로 남긴다.
 *  D. T179_COMPARE_SCHEMA 가 있으면 그 파일(변경 전 코드로 만든 스냅샷)과 A·B 의 스키마가 같은지 대조한다.
 *
 * 실행(운영·공용 DB 금지 — 127.0.0.1 에만 묶인 일회용 컨테이너, 끝나면 제거):
 *   docker run -d --rm --name t179-mariadb -p 127.0.0.1:33179:3306 -e MARIADB_ROOT_PASSWORD=t179test -e MARIADB_DATABASE=t179 \
 *     mariadb:10.11 --sql-mode=IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION \
 *     --character-set-server=utf8mb3 --collation-server=utf8mb3_general_ci
 *   T179_TEST_DB_PORT=33179 T179_TEST_DB_PASSWORD=t179test node ./node_modules/jest/bin/jest.js src/lib/db/__tests__/setup-ddl-disposable-mariadb.test.ts
 *   docker rm -f t179-mariadb
 * 값은 전부 합성값이다(운영 자료 없음). 서버 기본 문자셋은 운영 실측(utf8mb3_general_ci, T-074 기록)과 맞춘다.
 */
import fs from 'node:fs';
import mysql from 'mysql2/promise';

const PORT = process.env.T179_TEST_DB_PORT;
const PASSWORD = process.env.T179_TEST_DB_PASSWORD ?? '';
const maybe = PORT ? describe : describe.skip;
const DB_NAME = 't179_setup';

interface TraceRecord {
  ordinal: number;
  sqlClass: string;
  sql: string;
  outcome: 'ok' | 'failed';
  error?: string;
}

const trace: TraceRecord[] = [];

// 운영과 같은 방식으로 순번을 센다 — setupDB 가 받은 facade 의 query/execute 호출마다 +1.
jest.mock('@/lib/diagnostics/boot-diagnostics', () => {
  const actual = jest.requireActual('@/lib/diagnostics/boot-diagnostics');
  return {
    ...actual,
    observeSetupPool: (raw: object) => {
      const obs = actual.observeSetupPool(raw);
      let ordinal = 0;
      const facade = new Proxy(obs.pool, {
        get(target: Record<PropertyKey, unknown>, key) {
          const value = Reflect.get(target, key, target);
          if (typeof value !== 'function' || (key !== 'query' && key !== 'execute')) return value;
          return (...args: unknown[]) => {
            const text = typeof args[0] === 'string' ? args[0]
              : (args[0] && typeof args[0] === 'object' && typeof (args[0] as { sql?: unknown }).sql === 'string')
                ? (args[0] as { sql: string }).sql : '';
            const token = typeof args[0] === 'string'
              ? /^\s*(?:SET\s+STATEMENT\s+[\w@=,\s.']*?\s+FOR\s+)?(CREATE|ALTER|SELECT|INSERT|UPDATE|DELETE|SHOW|DROP)\b/i.exec(text)?.[1]?.toUpperCase() ?? 'OTHER'
              : 'OTHER';
            const rec: TraceRecord = { ordinal: ++ordinal, sqlClass: token, sql: text.replace(/\s+/g, ' ').trim().slice(0, 140), outcome: 'ok' };
            trace.push(rec);
            const result = Reflect.apply(value as (...a: unknown[]) => unknown, target, args) as Promise<unknown>;
            return result.then((r) => r, (e: unknown) => {
              rec.outcome = 'failed';
              rec.error = e instanceof Error ? e.message.slice(0, 120) : String(e);
              throw e;
            });
          };
        },
      });
      return { pool: facade, close: obs.close };
    },
  };
});

jest.mock('@/lib/notify', () => ({ sendAlert: jest.fn(async () => undefined) }));

/** 모듈 상태(번들 인스턴스)와 프로세스 전역 상태를 모두 비운다 — "새 프로세스" 흉내. */
async function freshProcessDbModule(): Promise<typeof import('@/lib/db')> {
  const g = globalThis as Record<symbol, unknown>;
  const state = g[Symbol.for('stockinvest.db.state')] as { pool?: mysql.Pool | null } | undefined;
  if (state?.pool) await state.pool.end().catch(() => undefined);
  delete g[Symbol.for('stockinvest.db.state')];
  // isolateModules 를 쓰지 않는다 — setupDB 안의 동적 import(exit-switch 등)가 바깥 레지스트리의
  // 다른 db 모듈 인스턴스를 불러 **두 번째 setupDB** 가 도는 것(=이 task 가 다루는 현상)을 시험이 스스로 만든다.
  jest.resetModules();
  return require('@/lib/db') as typeof import('@/lib/db');
}

async function endModulePool(mod: typeof import('@/lib/db')): Promise<void> {
  await mod.getPool().end().catch(() => undefined);
  delete (globalThis as Record<symbol, unknown>)[Symbol.for('stockinvest.db.state')];
}

async function schemaSnapshot(admin: mysql.Connection): Promise<Record<string, string>> {
  const [tables] = await admin.query<mysql.RowDataPacket[]>(
    'SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME', [DB_NAME],
  );
  const out: Record<string, string> = {};
  for (const t of tables) {
    const name = String(t.TABLE_NAME);
    const [rows] = await admin.query<mysql.RowDataPacket[]>(`SHOW CREATE TABLE \`${DB_NAME}\`.\`${name}\``);
    out[name] = String(rows[0]['Create Table']).replace(/ AUTO_INCREMENT=\d+/, '');
  }
  const [cfg] = await admin.query<mysql.RowDataPacket[]>(`SELECT \`key\` FROM \`${DB_NAME}\`.system_config ORDER BY \`key\``);
  out['@system_config_keys'] = cfg.map((r) => String(r.key)).join(',');
  const [strat] = await admin.query<mysql.RowDataPacket[]>(`SELECT id, enabled, backtest_interval_h FROM \`${DB_NAME}\`.strategies ORDER BY id`);
  out['@strategies'] = JSON.stringify(strat);
  const [hol] = await admin.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) AS n FROM \`${DB_NAME}\`.market_holidays`);
  out['@market_holidays_count'] = String(hol[0].n);
  return out;
}

const DDL = (r: TraceRecord) => r.sqlClass === 'ALTER' || r.sqlClass === 'CREATE' || r.sqlClass === 'DROP';
const conditionalDdl = (r: TraceRecord) => r.sqlClass === 'ALTER' || /^(SET STATEMENT .*? FOR )?CREATE (UNIQUE )?INDEX/i.test(r.sql) || /^SET STATEMENT/i.test(r.sql);

maybe('T-179 setupDB — 일회용 MariaDB', () => {
  let admin: mysql.Connection;
  const runs: Record<string, TraceRecord[]> = {};
  const snapshots: Record<string, Record<string, string>> = {};

  beforeAll(async () => {
    admin = await mysql.createConnection({ host: '127.0.0.1', port: Number(PORT), user: 'root', password: PASSWORD });
    await admin.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``);
    await admin.query(`CREATE DATABASE \`${DB_NAME}\``);
    Object.assign(process.env, {
      DB_HOST: '127.0.0.1', DB_PORT: PORT, DB_USER: 'root', DB_PWD: PASSWORD, DB_NAME,
      SIGNAL_STATUS_ENUM_AUTO_ALTER: 'true',
    });
  });

  afterAll(async () => {
    if (process.env.T179_TRACE_OUT) {
      fs.writeFileSync(process.env.T179_TRACE_OUT, JSON.stringify({ runs, snapshots }, null, 1));
    }
    await admin?.end();
  });

  test('A. 빈 스키마 → setupDB 성공, 테이블 생성', async () => {
    trace.length = 0;
    const db = await freshProcessDbModule();
    await db.ensureSetup();
    expect(db.getSetupFatalError()).toBeNull();
    runs.fresh = [...trace];
    snapshots.fresh = await schemaSnapshot(admin);
    expect(db.isOAuthSchemaReady()).toBe(true); // 풀을 닫으면 전역 상태도 지우므로 그 전에 읽는다
    await endModulePool(db);
    expect(Object.keys(snapshots.fresh).length).toBeGreaterThan(25);
  }, 120_000);

  // 빈 스키마 첫 기동은 symbol_universe.market 을 만들지 못한다 — `ALTER TABLE symbol_universe ADD COLUMN market`
  // 이 `CREATE TABLE IF NOT EXISTS symbol_universe` 보다 앞에 있어서(테이블이 없어 실패·무시) 두 번째 기동에서 붙는다.
  // T-179 이전부터 있던 순서이고 운영은 이미 두 번째 이후 상태다. 이 시험은 그 동작을 **그대로 보존**하는지만 본다.
  test('B. 두 번째 기동 → 첫 기동 대비 symbol_universe.market 만 늘어난다(기존 동작 보존)', async () => {
    trace.length = 0;
    const db = await freshProcessDbModule();
    await db.ensureSetup();
    expect(db.getSetupFatalError()).toBeNull();
    runs.rerun = [...trace];
    snapshots.rerun = await schemaSnapshot(admin);
    expect(db.isOAuthSchemaReady()).toBe(true);
    await endModulePool(db);
    const changed = Object.keys(snapshots.rerun).filter((k) => snapshots.rerun[k] !== snapshots.fresh[k]);
    expect(changed).toEqual(['symbol_universe']);
    expect(snapshots.rerun.symbol_universe).toContain("`market` enum('domestic','overseas') NOT NULL DEFAULT 'domestic'");
    expect(snapshots.fresh.symbol_universe).not.toContain('`market`');
  }, 120_000);

  test('C. 세 번째 기동(=운영 재시작 상태) → 스키마 불변, 이미 원하는 상태인 ALTER·CREATE INDEX 는 보내지 않는다', async () => {
    trace.length = 0;
    const db = await freshProcessDbModule();
    await db.ensureSetup();
    expect(db.getSetupFatalError()).toBeNull();
    runs.steady = [...trace];
    snapshots.steady = await schemaSnapshot(admin);
    expect(db.isOAuthSchemaReady()).toBe(true);
    await endModulePool(db);
    expect(snapshots.steady).toEqual(snapshots.rerun);
    if (!process.env.T179_BASELINE) {
      expect(runs.steady.filter(conditionalDdl).map((r) => r.sql)).toEqual([]);
      expect(runs.steady.filter((r) => DDL(r) && r.outcome === 'failed').map((r) => r.sql)).toEqual([]);
    }
  }, 120_000);

  test('D. 변경 전 코드의 스키마 스냅샷과 같다(T179_COMPARE_SCHEMA 가 있을 때만)', () => {
    const file = process.env.T179_COMPARE_SCHEMA;
    if (!file) return;
    const base = JSON.parse(fs.readFileSync(file, 'utf8')) as { snapshots: Record<string, Record<string, string>> };
    expect(snapshots.fresh).toEqual(base.snapshots.fresh);
    expect(snapshots.rerun).toEqual(base.snapshots.rerun);
    expect(snapshots.steady).toEqual(base.snapshots.steady);
  });
});
