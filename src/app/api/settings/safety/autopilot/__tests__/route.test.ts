import { NextRequest } from 'next/server';
import { SESSION_COOKIE, signSession } from '@/lib/auth/session';
import { GET, PATCH } from '@/app/api/settings/safety/autopilot/route';

const connection = {
  beginTransaction: jest.fn(), query: jest.fn(), execute: jest.fn(), commit: jest.fn(),
  rollback: jest.fn(), release: jest.fn(), destroy: jest.fn(),
};
const pool = { query: jest.fn(), getConnection: jest.fn() };
jest.mock('@/lib/db', () => ({ getPool: () => pool }));

const secret = 'autopilot-test-signing-secret';
let firstMember: string;
let secondMember: string;
const enable = { mode: 'auto', expectedMode: 'assist', expectedDryRun: true, expectedKillSwitch: false };
const settings = (mode = 'assist', dryRun = 'true', killSwitch = 'false') => [
  { key: 'autopilot_mode', value: JSON.stringify(mode) },
  { key: 'safety_dry_run', value: dryRun },
  { key: 'safety_kill_switch', value: killSwitch },
];

function request(token?: string, body?: unknown, site: string | null = 'same-origin') {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (token) headers.set('Cookie', `${SESSION_COOKIE}=${token}`);
  if (site) headers.set('Sec-Fetch-Site', site);
  return new NextRequest('https://stock.example.com/api/settings/safety/autopilot', {
    headers, method: body === undefined ? 'GET' : 'PATCH', body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeAll(async () => {
  firstMember = await signSession(secret, 7);
  secondMember = await signSession(secret, 8);
});
beforeEach(() => {
  jest.replaceProperty(process, 'env', { ...process.env, AUTH_SESSION_SECRET: secret });
  jest.clearAllMocks();
  pool.query.mockResolvedValue([settings()]);
  pool.getConnection.mockResolvedValue(connection);
  connection.query.mockImplementation(async (sql: string) => [sql.includes('FOR UPDATE') ? settings() : []]);
  connection.rollback.mockResolvedValue(undefined);
  jest.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test('rejects missing, forged or expired sessions before reading or writing settings', async () => {
  const expiredSession = await signSession(secret, 7, { nowMs: 1, maxAgeSec: 1 });
  for (const token of [undefined, 'forged', expiredSession]) {
    expect((await GET(request(token))).status).toBe(401);
    expect((await PATCH(request(token, enable))).status).toBe(401);
  }
  expect(pool.query).not.toHaveBeenCalled();
  expect(pool.getConnection).not.toHaveBeenCalled();
});

test.each([undefined, '7'])('allows both signed members to change the mode with legacy operator ID %p', async legacyId => {
  if (legacyId === undefined) delete process.env.AUTOPILOT_OPERATOR_USER_ID;
  else process.env.AUTOPILOT_OPERATOR_USER_ID = legacyId;

  expect(await (await GET(request(firstMember))).json()).toMatchObject({ ok: true, mode: 'assist' });
  expect(await (await GET(request(secondMember))).json()).toMatchObject({ ok: true, mode: 'assist' });
  expect((await PATCH(request(firstMember, enable))).status).toBe(200);

  connection.query.mockResolvedValueOnce([[]]).mockResolvedValueOnce([settings('auto')]);
  expect((await PATCH(request(secondMember, { ...enable, mode: 'assist', expectedMode: 'auto' }))).status).toBe(200);
  expect(connection.execute).toHaveBeenCalledTimes(2);
  expect(connection.commit).toHaveBeenCalledTimes(2);
  expect(console.info).toHaveBeenCalledWith('[settings:autopilot]', { userId: 7, from: 'assist', to: 'auto' });
  expect(console.info).toHaveBeenCalledWith('[settings:autopilot]', { userId: 8, from: 'auto', to: 'assist' });
});

test.each(['same-site', 'cross-site', null])('rejects %p browser metadata before touching the database', async site => {
  expect((await PATCH(request(firstMember, enable, site))).status).toBe(403);
  expect(pool.getConnection).not.toHaveBeenCalled();
});

test.each([
  { ...enable, mode: 'manual' }, { ...enable, expectedDryRun: 'true' },
  { ...enable, safety_dry_run: false }, { mode: 'auto' },
])('rejects an invalid write %p', async body => {
  expect((await PATCH(request(firstMember, body))).status).toBe(400);
  expect(pool.getConnection).not.toHaveBeenCalled();
});

test.each([
  ['assist', 'auto'], ['auto', 'assist'], ['manual', 'assist'],
] as const)('stores only the mode key when %s becomes %s', async (expectedMode, mode) => {
  connection.query.mockResolvedValueOnce([[]]).mockResolvedValueOnce([settings(expectedMode)]);
  const res = await PATCH(request(firstMember, { ...enable, expectedMode, mode }));
  expect(await res.json()).toEqual({ ok: true, mode, dryRun: true, killSwitch: false });
  expect(connection.query).toHaveBeenCalledWith('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  expect(connection.query).toHaveBeenLastCalledWith(expect.stringMatching(/FOR UPDATE$/));
  expect(connection.execute).toHaveBeenCalledTimes(1);
  expect(connection.execute).toHaveBeenCalledWith('UPDATE system_config SET value = ? WHERE `key` = ?', [JSON.stringify(mode), 'autopilot_mode']);
  expect(connection.commit).toHaveBeenCalledTimes(1);
  expect(connection.rollback).not.toHaveBeenCalled();
  expect(connection.release).toHaveBeenCalledTimes(1);
});

test.each([
  [settings('auto'), enable], [settings('assist', 'false'), enable], [settings('assist', 'true', 'true'), enable],
  [settings('manual'), { ...enable, expectedMode: 'manual' }],
])('does not write when the locked snapshot differs or a manual activation is attempted', async (rows, body) => {
  connection.query.mockResolvedValueOnce([[]]).mockResolvedValueOnce([rows]);
  expect((await PATCH(request(firstMember, body))).status).toBe(409);
  expect(connection.execute).not.toHaveBeenCalled();
  expect(connection.commit).not.toHaveBeenCalled();
  expect(connection.rollback).toHaveBeenCalledTimes(1);
  expect(connection.release).toHaveBeenCalledTimes(1);
});

test('a database failure reports an unconfirmed outcome and releases the transaction', async () => {
  connection.commit.mockRejectedValueOnce(new Error('synthetic connection loss'));
  const res = await PATCH(request(firstMember, enable));
  expect(res.status).toBe(503);
  expect(await res.json()).toMatchObject({ ok: false });
  expect(connection.rollback).toHaveBeenCalledTimes(1);
  expect(connection.release).toHaveBeenCalledTimes(1);
});

test('unknown modes are surfaced and legacy safety flags retain the order path semantics', async () => {
  pool.query.mockResolvedValueOnce([settings('unknown', '"OFF"', '"unknown"')]);
  expect(await (await GET(request(firstMember))).json()).toMatchObject({ mode: null, dryRun: false, killSwitch: true });
});
