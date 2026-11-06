#!/usr/bin/env node
/**
 * T-113 isolated fixture prototype ONLY. This is NOT an operational migration.
 * No URL, host, database name, owner or target IDs can be supplied by callers.
 * A private throwaway MariaDB with the synthetic schema and exact fixed data
 * below is required. It never reads .env, real credentials or app config.
 *
 * The production cutover's ingress freeze, queue drain, backup, ID manifest,
 * privilege policy and recovery have not been established. These guards are
 * fixture hygiene, not proof that any connection is safe for production.
 */
import { createRequire } from 'node:module';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url);

const FIXTURE_DB = 't113_fixture_demo';
const OWNER = 7;
const EXPECTED = [
  { id: '101', user_id: null, title: 'fixture-one', archived: 0, message_count: 1, updated_at: '2001-01-01 00:00:00' },
  { id: '102', user_id: null, title: 'fixture-two', archived: 1, message_count: 1, updated_at: '2001-01-02 00:00:00' },
];
const EXPECTED_MESSAGES = [
  { id: '201', thread_id: '101', role: 'user', content: 'fixture-message-one', created_at: '2001-02-01 00:00:00' },
  { id: '202', thread_id: '102', role: 'assistant', content: 'fixture-message-two', created_at: '2001-02-02 00:00:00' },
];
const canonical = (rows) => JSON.stringify(rows);
function requireEqual(actual, expected, label) {
  if (canonical(actual) !== canonical(expected)) throw new Error(`FIXTURE_MISMATCH:${label}`);
}
async function fixtureSocket() {
  const socket = process.env.T113_FIXTURE_SOCKET || '';
  if (!/^\/tmp\/t113-own-fixture\.[A-Za-z0-9]{8}\/mysql\.sock$/.test(socket)) throw new Error('FIXTURE_SOCKET_REQUIRED');
  const parent = path.dirname(socket);
  if (await realpath(parent) !== parent) throw new Error('FIXTURE_SOCKET_REALPATH');
  if (!(await lstat(socket)).isSocket()) throw new Error('FIXTURE_SOCKET_INVALID');
  return socket;
}
async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== '--fixture-only') throw new Error('FIXTURE_ONLY');
  const socketPath = await fixtureSocket();
  // Credentials and target are fixed fixture values; production config is never read.
  const mysql = require('mysql2/promise');
  const db = await mysql.createConnection({ socketPath, user: 'root', password: '', database: FIXTURE_DB,
    dateStrings: true, supportBigNumbers: true, bigNumberStrings: true, multipleStatements: false });
  let transaction = false, committing = false;
  try {
    const [identity] = await db.query('SELECT DATABASE() AS db, @@hostname AS host, @@skip_networking AS offline');
    if (identity[0].db !== FIXTURE_DB || identity[0].host !== 't113-fixture-node' || Number(identity[0].offline) !== 1) throw new Error('FIXTURE_SERVER_MISMATCH');
    // Exact synthetic data match is mandatory; count-only matching is not enough.
    await db.beginTransaction(); transaction = true;
    const [users] = await db.query('SELECT id FROM users ORDER BY id FOR UPDATE');
    requireEqual(users.map((u) => Number(u.id)), [OWNER], 'users');
    const [threads] = await db.query('SELECT id, user_id, title, archived, message_count, updated_at FROM chat_threads ORDER BY id FOR UPDATE');
    requireEqual(threads, EXPECTED, 'threads');
    const [messages] = await db.query('SELECT id, thread_id, role, content, created_at FROM chat_messages ORDER BY id FOR UPDATE');
    requireEqual(messages, EXPECTED_MESSAGES, 'messages');
    const [result] = await db.query('UPDATE chat_threads SET user_id = ?, updated_at = updated_at WHERE user_id IS NULL AND id IN (?, ?)', [OWNER, '101', '102']);
    if (result.affectedRows !== 2) throw new Error('FIXTURE_AFFECTED_COUNT');
    const [after] = await db.query('SELECT id, user_id, title, archived, message_count, updated_at FROM chat_threads ORDER BY id FOR UPDATE');
    requireEqual(after, EXPECTED.map((x) => ({ ...x, user_id: OWNER })), 'threads-after');
    const [afterMessages] = await db.query('SELECT id, thread_id, role, content, created_at FROM chat_messages ORDER BY id FOR UPDATE');
    requireEqual(afterMessages, EXPECTED_MESSAGES, 'messages-after');
    committing = true; await db.commit(); committing = false; transaction = false;
    console.log('fixture-only: synthetic transaction and preservation checks passed');
  } catch (err) {
    if (committing) { console.error('FIXTURE_COMMIT_OUTCOME_UNKNOWN: do not retry'); process.exitCode = 1; }
    else { if (transaction) await db.rollback().catch(() => {}); console.error('FIXTURE_ABORTED:', err instanceof Error ? err.message : 'unknown'); process.exitCode = 1; }
  } finally { await db.end().catch(() => {}); }
}
main().catch((err) => { console.error('FIXTURE_ABORTED:', err instanceof Error ? err.message : 'unknown'); process.exitCode = 1; });
