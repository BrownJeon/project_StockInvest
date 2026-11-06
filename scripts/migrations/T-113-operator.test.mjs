import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configFrom, hasDirectTriggerGrant, ident, metadata, protectedRead, snapshot } from './T-113-chat-ownership-operator.mjs';
const config = { ownerId: 7, database: 'fixture', user: 'test', password: 'fixture-password', expectedHost: 'fixture-host', expectedPort: 3306, expectedServerId: 1, host: 'localhost', port: 3306, caPath: '/tmp/test-ca' };

test('configuration requires TLS and rejects unsafe identifiers', () => {
  assert.equal(configFrom(JSON.stringify(config)).ownerId, 7);
  assert.throws(() => configFrom(JSON.stringify({ ...config, caPath: '' })), /TLS_CONFIG_REQUIRED/);
  assert.throws(() => configFrom(JSON.stringify({ ...config, database: 'db;DROP' })), /IDENTIFIER_INVALID/);
  assert.throws(() => ident('`id`'), /IDENTIFIER_INVALID/);
});
test('secret and manifest reads reject broad permissions and symlinks', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't113-secure-'));
  try {
    const f = join(dir, 'file'), link = join(dir, 'link');
    await writeFile(f, 'fixture', { mode: 0o600 });
    assert.equal(await protectedRead(f), 'fixture');
    await chmod(f, 0o644); await assert.rejects(protectedRead(f), /PROTECTED_FILE_REQUIRED/);
    await chmod(f, 0o600); await symlink(f, link); await assert.rejects(protectedRead(link));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
function dbFor({ users = [{ id: 7 }], threads = [{ __t113_id: '101', __t113_0: '313031', __t113_1: '32303031' }], messages = [{ __t113_id: '201', __t113_thread_id: '101', __t113_0: '323031' }], triggers = [], columns } = {}) {
  return { query: async (sql) => {
    if (sql.startsWith('SELECT TABLE_NAME AS name')) return [[{ name: 'chat_messages', engine: 'InnoDB' }, { name: 'chat_threads', engine: 'InnoDB' }, { name: 'users', engine: 'InnoDB' }]];
    if (sql === 'SELECT DATABASE() AS db') return [[{ db: 'fixture' }]];
    if (sql === 'SHOW GRANTS FOR CURRENT_USER') return [[{ grant: 'GRANT ALL PRIVILEGES ON *.* TO fixture' }]];
    if (sql.startsWith('SELECT COUNT(*) AS row_count')) return [[{ row_count: 1, byte_count: 20 }]];
    if (sql === 'SHOW TRIGGERS') return [triggers];
    if (sql === 'SHOW CREATE TABLE `chat_threads`') return [[{ 'Create Table': 'CREATE TABLE `chat_threads` (\n  `id` bigint,\n  `updated_at` datetime\n)' }]];
    if (sql === 'SHOW CREATE TABLE `chat_messages`') return [[{ 'Create Table': 'CREATE TABLE `chat_messages` (\n  `id` bigint,\n  `thread_id` bigint\n)' }]];
    if (sql.startsWith('SELECT TABLE_NAME AS tableName')) return [columns || [
      { tableName: 'chat_messages', columnName: 'id', dataType: 'bigint' }, { tableName: 'chat_messages', columnName: 'thread_id', dataType: 'bigint' },
      { tableName: 'chat_threads', columnName: 'id', dataType: 'bigint' }, { tableName: 'chat_threads', columnName: 'updated_at', dataType: 'datetime' },
    ]];
    if (sql.startsWith('SELECT id FROM users')) return [users];
    if (sql.includes('FROM chat_threads')) return [threads];
    if (sql.includes('FROM chat_messages')) return [messages];
    throw new Error('unhandled fixture query');
  } };
}
test('capture rejects triggers, owner-column surprises and missing schema', async () => {
  await assert.rejects(metadata(dbFor({ triggers: [{ Table: 'chat_threads' }] }), false), /CHAT_TRIGGERS_REQUIRE_REVIEW/);
  const cols = [{ tableName: 'chat_threads', columnName: 'user_id', nullable: 'YES', columnType: 'int unsigned' }];
  await assert.rejects(metadata(dbFor({ columns: cols }), false), /COLUMN_VISIBILITY_MISMATCH/);
  await assert.rejects(metadata(dbFor({ columns: [] }), false), /COLUMN_VISIBILITY_MISMATCH/);
});
test('snapshot rejects incorrect user and orphan messages and fingerprints all rows', async () => {
  const meta = await metadata(dbFor(), false);
  const a = await snapshot(dbFor(), meta, 7, true);
  const b = await snapshot(dbFor({ messages: [{ __t113_id: '201', __t113_thread_id: '101', __t113_0: '646966666572656e74' }] }), meta, 7, true);
  assert.notEqual(a.messageHash, b.messageHash);
  await assert.rejects(snapshot(dbFor({ users: [{ id: 8 }] }), meta, 7, true), /OWNER_OR_USER_SET_MISMATCH/);
  await assert.rejects(snapshot(dbFor({ users: [{ id: 7 }, { id: 8 }] }), meta, 7, true), /OWNER_OR_USER_SET_MISMATCH/);
  await assert.rejects(snapshot(dbFor({ messages: [{ __t113_id: '201', __t113_thread_id: '999' }] }), meta, 7, true), /ORPHAN_MESSAGE/);
});

test('trigger visibility requires direct grant on each relevant table', () => {
  const grants = ['GRANT SELECT, TRIGGER ON `fixture`.`chat_threads` TO user'];
  assert.equal(hasDirectTriggerGrant(grants, 'fixture', 'chat_threads'), true);
  assert.equal(hasDirectTriggerGrant(grants, 'fixture', 'chat_messages'), false);
  assert.equal(hasDirectTriggerGrant(['GRANT TRIGGER ON `other`.* TO user'], 'fixture', 'chat_threads'), false);
  assert.equal(hasDirectTriggerGrant(['GRANT `trigger_role` TO user'], 'fixture', 'chat_threads'), false);
});
test('oversized content is refused before fetching rows', async () => {
  const base = dbFor();
  const db = { query: async (sql) => sql.startsWith('SELECT COUNT(*) AS row_count') ? [[{row_count: 1, byte_count: 4000001}]] : base.query(sql) };
  const meta = await metadata(base, false);
  await assert.rejects(snapshot(db, meta, 7, true), /CAPACITY_LIMIT_EXCEEDED/);
});
test('upper-case ENUM type still includes its numeric index', async () => {
  const base = dbFor();
  const meta = await metadata(base, false);
  meta.base.find((c) => c.tableName === 'chat_threads' && c.columnName === 'updated_at').dataType = 'ENUM';
  let sawIndex = false;
  const db = { query: async (sql) => {
    if (sql.includes('FROM chat_threads ORDER BY')) sawIndex = sql.includes('(`updated_at` + 0) AS __t113_e1');
    return base.query(sql);
  } };
  await snapshot(db, meta, 7, true);
  assert.equal(sawIndex, true);
});
