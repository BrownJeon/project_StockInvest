/** Fixture-only guard: these tests never create a database connection. */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const script = path.resolve(process.cwd(), 'scripts/migrations/T-113-chat-ownership-backfill.mjs');
function call(args: string[], socket?: string) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, ...(socket ? { T113_FIXTURE_SOCKET: socket } : {}) },
    timeout: 10_000,
  });
}
test('refuses invocation without the fixed fixture-only mode', () => {
  const r = call([]);
  expect(r.status).toBe(1);
  expect(r.stderr).toContain('FIXTURE_ONLY');
});
test('rejects arbitrary and production-shaped socket paths before importing mysql', () => {
  for (const socket of ['/run/mysqld/mysqld.sock', '/tmp/not-a-fixture/mysql.sock', '/tmp/t113-own-fixture.abc/mysql.sock']) {
    const r = call(['--fixture-only'], socket);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('FIXTURE_SOCKET_REQUIRED');
  }
});
test('rejects additional arguments rather than accepting a real user or database', () => {
  const r = call(['--fixture-only', '--production']);
  expect(r.status).toBe(1);
  expect(r.stderr).toContain('FIXTURE_ONLY');
});
