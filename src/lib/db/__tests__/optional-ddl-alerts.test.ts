/**
 * T-179 Reviewer Medium-1 — 선택 DDL(`optionalDdl`)의 실패를 사람이 알 수 있게 했는지.
 *
 *  - 잠금 대기 초과(errno 1205) → 문장 이름이 든 로그 + setupDB 끝에 알림 **1건**(여러 문장이어도 묶음, 간격 제한)
 *  - 「이미 있음」(1060 중복 컬럼·1061 중복 인덱스) → 알림·경고 없음(원래대로 조용히)
 *  - 메타데이터(INFORMATION_SCHEMA) 조회 실패로 「모름」 → 한 줄 로그, DDL 은 지금처럼 보낸다
 *
 * 가짜 풀은 process-state.test.ts 와 같은 방식이다(메타데이터 조회는 빈 결과 = 「전부 없음」으로 확인됨).
 * 다른 부팅 경로(OAuth 스키마 등)도 가짜 DB 에서는 알림을 보내므로, 알림은 제목으로 걸러 센다.
 */
import { SIGNAL_STATUSES } from '@/lib/signals/statuses';

type Row = Record<string, unknown>;
type Hook = (sql: string) => void;
const mockQueries: string[] = [];
let mockHook: Hook = () => undefined;
const mockStatusColumnType = `enum(${SIGNAL_STATUSES.map((s) => `'${s}'`).join(',')})`;
const mockCreatePool = jest.fn(() => ({
  query: jest.fn(async (arg: unknown) => {
    const sql = typeof arg === 'string' ? arg : String((arg as { sql?: string })?.sql ?? '');
    mockQueries.push(sql);
    mockHook(sql);
    if (/SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA\.COLUMNS/.test(sql)) return [[{ COLUMN_TYPE: mockStatusColumnType } as Row], []];
    return [[], []];
  }),
  execute: jest.fn(async () => [[], []]),
  on: jest.fn(),
  removeListener: jest.fn(),
  end: jest.fn(async () => undefined),
}));
const mockSendAlert = jest.fn(async (..._args: unknown[]) => undefined);

jest.mock('mysql2/promise', () => ({ __esModule: true, default: { createPool: mockCreatePool }, createPool: mockCreatePool }));
jest.mock('@/lib/notify', () => ({ sendAlert: (...args: unknown[]) => mockSendAlert(...args) }));

type DbModule = typeof import('@/lib/db');
const STATE_KEY = Symbol.for('stockinvest.db.state');
const ALERT_TITLE = '부팅 DDL 잠금 대기 초과';

function loadDb(): DbModule {
  let mod: DbModule | undefined;
  jest.isolateModules(() => { mod = require('@/lib/db'); });
  return mod!;
}

function sqlError(errno: number, code: string): Error {
  return Object.assign(new Error(code), { errno, code });
}

/** notifyCritical 은 동적 import 뒤에 보낸다 — 마이크로태스크·매크로태스크를 몇 번 흘려보낸다. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
}

function ddlAlerts(): unknown[][] {
  return mockSendAlert.mock.calls.filter((c) => typeof c[1] === 'string' && (c[1] as string).includes(ALERT_TITLE));
}

function logged(spy: jest.SpyInstance, needle: string): string[] {
  return spy.mock.calls.map((c) => String(c[0])).filter((m) => m.includes(needle));
}

let warnSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;

beforeEach(() => {
  delete (globalThis as Record<symbol, unknown>)[STATE_KEY];
  mockQueries.length = 0;
  mockHook = () => undefined;
  mockCreatePool.mockClear();
  mockSendAlert.mockClear();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'info').mockImplementation(() => undefined);
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
  delete (globalThis as Record<symbol, unknown>)[STATE_KEY];
});

test('잠금 대기 초과(1205) — 문장 이름 로그 + 알림 1건(두 문장을 묶음), 부팅은 계속된다', async () => {
  mockHook = (sql) => {
    if (!sql.startsWith('SET STATEMENT lock_wait_timeout=5 FOR')) return;
    if (/ADD COLUMN tier\b/.test(sql) || /CREATE INDEX idx_universe_tier\b/.test(sql)) {
      throw sqlError(1205, 'ER_LOCK_WAIT_TIMEOUT');
    }
  };
  const db = loadDb();
  db.getPool();
  await db.ensureSetup();           // 선택 DDL 실패는 부팅을 막지 않는다(변경 전과 같다)
  await settle();

  expect(db.getSetupFatalError()).toBeNull();
  expect(logged(errorSpy, '잠금 대기 초과 (symbol_universe.tier,')).toHaveLength(1);
  expect(logged(errorSpy, '잠금 대기 초과 (symbol_universe.idx_universe_tier,')).toHaveLength(1);

  const alerts = ddlAlerts();
  expect(alerts).toHaveLength(1);
  expect(alerts[0][0]).toBe('critical');
  const body = String(alerts[0][2]);
  expect(body).toContain('symbol_universe.tier');
  expect(body).toContain('symbol_universe.idx_universe_tier');
  // 본문에는 이름만 — SQL 문장·접속 정보가 섞이지 않는다
  expect(body).not.toMatch(/ALTER TABLE|CREATE INDEX|DB_PWD|password/i);
  // 뒤 문장들은 계속 보냈다(잠금 초과 하나로 setupDB 가 멈추지 않는다)
  expect(mockQueries.some((q) => /ADD COLUMN IF NOT EXISTS scenario_exit/.test(q))).toBe(true);
}, 30_000);

test('잠금 대기 초과 알림 간격 제한 — 같은 프로세스에서 setupDB 가 다시 돌아도 알림은 1건, 로그는 남는다', async () => {
  mockHook = (sql) => {
    if (sql.startsWith('SET STATEMENT lock_wait_timeout=5 FOR') && /ADD COLUMN tier\b/.test(sql)) {
      throw sqlError(1205, 'ER_LOCK_WAIT_TIMEOUT');
    }
  };
  const db = loadDb();
  db.getPool();
  await db.ensureSetup();
  await settle();
  expect(ddlAlerts()).toHaveLength(1);

  // 같은 프로세스에서 setupDB 를 한 번 더 돌린다(전역 상태의 약속만 비운다)
  const state = (globalThis as Record<symbol, { setupPromise: unknown }>)[STATE_KEY];
  state.setupPromise = null;
  await db.ensureSetup();
  await settle();

  expect(ddlAlerts()).toHaveLength(1);
  expect(logged(errorSpy, '잠금 대기 초과 (symbol_universe.tier,')).toHaveLength(2);
  expect(logged(errorSpy, '알림은 생략합니다: symbol_universe.tier')).toHaveLength(1);
}, 30_000);

test('「이미 있음」(1060·1061) — 알림·경고 없이 조용히 넘긴다', async () => {
  mockHook = (sql) => {
    if (!sql.startsWith('SET STATEMENT lock_wait_timeout=5 FOR')) return;
    if (/ADD COLUMN tier\b/.test(sql)) throw sqlError(1060, 'ER_DUP_FIELDNAME');
    if (/CREATE INDEX idx_universe_tier\b/.test(sql)) throw sqlError(1061, 'ER_DUP_KEYNAME');
  };
  const db = loadDb();
  db.getPool();
  await db.ensureSetup();
  await settle();

  expect(ddlAlerts()).toHaveLength(0);
  expect(logged(warnSpy, 'symbol_universe.tier')).toHaveLength(0);
  expect(logged(warnSpy, 'symbol_universe.idx_universe_tier')).toHaveLength(0);
  expect(logged(errorSpy, '잠금 대기 초과')).toHaveLength(0);
}, 30_000);

test('메타데이터 조회 실패 → 「모름」 한 줄 로그, 선택 DDL 은 확인 없이 보낸다(알림 없음)', async () => {
  mockHook = (sql) => {
    if (/FROM INFORMATION_SCHEMA\.COLUMNS WHERE TABLE_SCHEMA=DATABASE\(\) AND TABLE_NAME IN/.test(sql)) {
      throw new Error('boom');
    }
  };
  const db = loadDb();
  db.getPool();
  await db.ensureSetup();
  await settle();

  const lines = logged(warnSpy, '부팅 메타데이터 조회 실패');
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain('컬럼=모름');
  expect(lines[0]).toContain('인덱스=확인');
  expect(lines[0]).not.toContain('boom');        // 원 오류 문구(값)는 싣지 않는다
  expect(mockQueries.some((q) => q.startsWith('SET STATEMENT lock_wait_timeout=5 FOR') && /ADD COLUMN tier\b/.test(q))).toBe(true);
  expect(ddlAlerts()).toHaveLength(0);
}, 30_000);

test('메타데이터 조회 성공 → 「모름」 로그 없음', async () => {
  const db = loadDb();
  db.getPool();
  await db.ensureSetup();
  await settle();
  expect(logged(warnSpy, '부팅 메타데이터 조회 실패')).toHaveLength(0);
  expect(ddlAlerts()).toHaveLength(0);
}, 30_000);
