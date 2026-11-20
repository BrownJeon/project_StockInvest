/**
 * T-179 WP-1 — db 모듈이 **번들마다 따로 평가돼도** 풀 1개·setupDB 1회·fail-closed 공유.
 *
 * 운영 빌드에서 `src/lib/db.ts` 는 instrumentation 레이어(chunks/1835.js)와 라우트 레이어(chunks/5589.js)에
 * 서로 다른 모듈 id 로 두 번 들어간다. 여기서는 `jest.isolateModules` 로 같은 파일을 두 번 평가해 그 상황을 흉내 낸다
 * (두 인스턴스는 모듈 변수를 공유하지 않고 globalThis 만 공유한다 — 운영과 같다).
 */
import { SIGNAL_STATUSES } from '@/lib/signals/statuses';

type Row = Record<string, unknown>;
const mockQueries: string[] = [];
let mockStatusColumnType = '';
const mockCreatePool = jest.fn(() => ({
  query: jest.fn(async (arg: unknown) => {
    const sql = typeof arg === 'string' ? arg : String((arg as { sql?: string })?.sql ?? '');
    mockQueries.push(sql);
    if (/SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA\.COLUMNS/.test(sql)) return [[{ COLUMN_TYPE: mockStatusColumnType } as Row], []];
    return [[], []];
  }),
  execute: jest.fn(async () => [[], []]),
  on: jest.fn(),
  removeListener: jest.fn(),
  end: jest.fn(async () => undefined),
}));

jest.mock('mysql2/promise', () => ({ __esModule: true, default: { createPool: mockCreatePool }, createPool: mockCreatePool }));
jest.mock('@/lib/notify', () => ({ sendAlert: jest.fn(async () => undefined) }));

type DbModule = typeof import('@/lib/db');
const STATE_KEY = Symbol.for('stockinvest.db.state');

function loadBundle(): DbModule {
  let mod: DbModule | undefined;
  jest.isolateModules(() => { mod = require('@/lib/db'); });
  return mod!;
}

beforeEach(() => {
  delete (globalThis as Record<symbol, unknown>)[STATE_KEY];
  mockQueries.length = 0;
  mockCreatePool.mockClear();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'info').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
  delete (globalThis as Record<symbol, unknown>)[STATE_KEY];
});

test('두 번들 인스턴스 — 풀 1개, setupDB 1회(같은 약속), OAuth 상태도 공유', async () => {
  mockStatusColumnType = `enum(${SIGNAL_STATUSES.map((s) => `'${s}'`).join(',')})`;
  const routeBundle = loadBundle();
  const instrumentationBundle = loadBundle();
  expect(routeBundle).not.toBe(instrumentationBundle); // 정말 두 벌이다

  const p1 = routeBundle.getPool();
  const p2 = instrumentationBundle.getPool();
  expect(p2).toBe(p1);
  expect(mockCreatePool).toHaveBeenCalledTimes(1);

  const s1 = routeBundle.ensureSetup();
  const s2 = instrumentationBundle.ensureSetup();
  expect(s2).toBe(s1);
  await s1;

  // setupDB 가 한 번만 돌았다 — 맨 앞의 메타데이터 조회와 strategies 생성이 각각 1회
  expect(mockQueries.filter((q) => /INFORMATION_SCHEMA\.COLUMNS WHERE TABLE_SCHEMA=DATABASE\(\) AND TABLE_NAME IN/.test(q))).toHaveLength(1);
  expect(mockQueries.filter((q) => /CREATE TABLE IF NOT EXISTS strategies/.test(q))).toHaveLength(1);
  expect(routeBundle.getSetupFatalError()).toBeNull();
  expect(instrumentationBundle.getSetupFatalError()).toBeNull();
  // 가짜 DB 는 users.password_hash 가 nullable 이라고 답하지 않는다 → 두 번들 모두 같은 값(false)을 본다
  expect(routeBundle.isOAuthSchemaReady()).toBe(false);
  expect(instrumentationBundle.isOAuthSchemaReady()).toBe(false);
}, 30_000);

test('fail-closed — 한 번들에서 선 스키마 치명 오류가 다른 번들의 getPool() 도 막는다', async () => {
  const prev = process.env.SIGNAL_STATUS_ENUM_AUTO_ALTER;
  process.env.SIGNAL_STATUS_ENUM_AUTO_ALTER = 'false'; // 자동 확장 끔 → ENUM 부족이 그대로 치명 오류
  mockStatusColumnType = "enum('pending')";
  try {
    const routeBundle = loadBundle();
    const instrumentationBundle = loadBundle();
    await expect(routeBundle.ensureSetup()).rejects.toThrow();
    // 다른 번들은 setupDB 를 따로 돌리지 않고 같은 실패를 받는다
    await expect(instrumentationBundle.ensureSetup()).rejects.toThrow();
    expect(mockQueries.filter((q) => /CREATE TABLE IF NOT EXISTS strategies/.test(q))).toHaveLength(1);
    expect(routeBundle.getSetupFatalError()).not.toBeNull();
    expect(instrumentationBundle.getSetupFatalError()).toBe(routeBundle.getSetupFatalError());
    expect(() => routeBundle.getPool()).toThrow();
    expect(() => instrumentationBundle.getPool()).toThrow();
    // 치명 오류 뒤에 처음 불러온 번들(예: 늦게 컴파일된 라우트)도 막힌다
    expect(() => loadBundle().getPool()).toThrow();
  } finally {
    if (prev === undefined) delete process.env.SIGNAL_STATUS_ENUM_AUTO_ALTER;
    else process.env.SIGNAL_STATUS_ENUM_AUTO_ALTER = prev;
  }
}, 30_000);
