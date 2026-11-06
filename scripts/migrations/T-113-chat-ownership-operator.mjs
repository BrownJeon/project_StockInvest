#!/usr/bin/env node
/** T-113 operator prototype. NOT REVIEWED OR AUTHORIZED FOR PRODUCTION USE.
 * An ingress/write freeze, drain, verified backup and approval are independent prerequisites.
 * capture/apply are separate processes; apply does not run DDL. Never prints row contents or credentials.
 */
import { constants } from 'node:fs';
import { open, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const sha = (x) => createHash('sha256').update(x).digest('hex');
const json = (x) => JSON.stringify(x);
const fail = (code) => { throw new Error(code); };

async function protectedRead(path) {
  const f = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = await f.stat();
    if (!s.isFile() || (s.mode & 0o077) !== 0 || s.uid !== process.getuid() || s.size > 5_000_000) fail('PROTECTED_FILE_REQUIRED');
    return await f.readFile('utf8');
  } finally { await f.close(); }
}
function ident(s) { if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) fail('IDENTIFIER_INVALID'); return `\`${s}\``; }
function configFrom(raw) {
  const c = JSON.parse(raw);
  if (!c || typeof c !== 'object' || !Number.isSafeInteger(c.ownerId) || c.ownerId < 1 || !c.database || !c.user || !c.password || !c.expectedHost || !Number.isInteger(c.expectedPort) || !Number.isInteger(c.expectedServerId)) fail('CONFIG_INVALID');
  ident(c.database);
  if (typeof c.host !== 'string' || !Number.isInteger(c.port) || typeof c.caPath !== 'string' || !c.caPath.startsWith('/')) fail('TLS_CONFIG_REQUIRED');
  return c;
}
const compare = (a, b, code) => { if (json(a) !== json(b)) fail(code); };
async function queryRows(db, sql, args = []) { const [rows] = await db.query(sql, args); return rows; }
async function identity(db) {
  const rows = await queryRows(db, 'SELECT DATABASE() AS db, @@hostname AS host, @@port AS port, @@server_id AS serverId');
  return { db: rows[0].db, host: rows[0].host, port: Number(rows[0].port), serverId: Number(rows[0].serverId) };
}
function hasDirectTriggerGrant(grants, database, table) {
  return grants.some((line) => {
    const match = /^GRANT ([A-Z ,]+) ON (\*|`[A-Za-z_][A-Za-z0-9_]*`)\.(\*|`[A-Za-z_][A-Za-z0-9_]*`) TO /.exec(line);
    if (!match) return false;
    const privileges = match[1].split(',').map((x) => x.trim());
    const hasTrigger = privileges.includes('TRIGGER') || privileges.includes('ALL PRIVILEGES');
    const scopeDb = match[2] === '*' || match[2] === ident(database);
    const scopeTable = match[3] === '*' || match[3] === ident(table);
    return hasTrigger && scopeDb && scopeTable;
  });
}
async function metadata(db, withOwner) {
  const tables = await queryRows(db, "SELECT TABLE_NAME AS name, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('users','chat_threads','chat_messages') ORDER BY TABLE_NAME");
  if (tables.length !== 3 || tables.some((t) => t.engine !== 'InnoDB')) fail('TABLE_ENGINE_OR_COUNT');
  // Do not infer full visibility from SHOW TRIGGERS succeeding: direct unambiguous
  // TRIGGER grants for both tables are required; role-only grants fail closed.
  const dbRows = await queryRows(db, 'SELECT DATABASE() AS db');
  const grantRows = await queryRows(db, 'SHOW GRANTS FOR CURRENT_USER');
  const grants = grantRows.map((row) => String(Object.values(row)[0]));
  const database = dbRows[0]?.db;
  if (typeof database !== 'string' || !['chat_threads', 'chat_messages'].every((table) => hasDirectTriggerGrant(grants, database, table))) fail('TRIGGER_PRIVILEGES_INSUFFICIENT_OR_AMBIGUOUS');
  const triggers = await queryRows(db, 'SHOW TRIGGERS');
  const chatTriggers = triggers.filter((t) => t.Table === 'chat_threads' || t.Table === 'chat_messages');
  if (chatTriggers.length) fail('CHAT_TRIGGERS_REQUIRE_REVIEW');
  const cols = await queryRows(db, "SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, DATA_TYPE AS dataType, COLUMN_TYPE AS columnType, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS defaultValue, EXTRA AS extra, CHARACTER_SET_NAME AS charset, COLLATION_NAME AS collationName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('chat_threads','chat_messages') ORDER BY TABLE_NAME, ORDINAL_POSITION");
  // SHOW CREATE fails for column-only privilege in the tested MariaDB version.
  // Cross-check every returned name against independently returned DDL; reject unfamiliar syntax.
  for (const table of ['chat_threads', 'chat_messages']) {
    const createRows = await queryRows(db, `SHOW CREATE TABLE ${ident(table)}`);
    const ddl = createRows[0]?.['Create Table'];
    if (typeof ddl !== 'string') fail('CREATE_TABLE_UNAVAILABLE');
    const names = [...ddl.matchAll(/^\s{2}`([A-Za-z_][A-Za-z0-9_]*)`\s/gm)].map((m) => m[1]);
    const visible = cols.filter((c) => c.tableName === table).map((c) => c.columnName);
    compare(names, visible, 'COLUMN_VISIBILITY_MISMATCH');
  }
  const allowedTypes = new Set(['tinyint', 'smallint', 'mediumint', 'int', 'bigint', 'decimal', 'char', 'varchar', 'tinytext', 'text', 'mediumtext', 'longtext', 'enum', 'date', 'datetime', 'timestamp', 'time', 'tinyblob', 'blob', 'mediumblob', 'longblob', 'binary', 'varbinary']);
  if (cols.some((c) => !allowedTypes.has(String(c.dataType).toLowerCase()) || /generated/i.test(String(c.extra)))) fail('UNSUPPORTED_COLUMN_TYPE');
  const owner = cols.filter((c) => c.tableName === 'chat_threads' && c.columnName === 'user_id');
  if (withOwner ? owner.length !== 1 || owner[0].nullable !== 'YES' || !/^int(?:\(\d+\))? unsigned$/i.test(owner[0].columnType) : owner.length !== 0) fail('OWNER_COLUMN_STATE');
  const base = cols.filter((c) => !(c.tableName === 'chat_threads' && c.columnName === 'user_id'));
  const threads = base.filter((c) => c.tableName === 'chat_threads').map((c) => c.columnName);
  const messages = base.filter((c) => c.tableName === 'chat_messages').map((c) => c.columnName);
  if (!threads.includes('id') || !threads.includes('updated_at') || !messages.includes('id') || !messages.includes('thread_id')) fail('REQUIRED_COLUMNS_MISSING');
  return { base, threads, messages };
}
async function snapshot(db, meta, owner, lock) {
  const suffix = lock ? ' FOR UPDATE' : '';
  const users = await queryRows(db, `SELECT id FROM users ORDER BY id${suffix}`);
  if (users.length !== 1 || String(users[0].id) !== String(owner)) fail('OWNER_OR_USER_SET_MISMATCH');
  // Bound result size before retrieving any user content. Repeated scans/locks
  // are still possible; this is not a runtime or lock-duration guarantee.
  for (const [table, cols, maxRows] of [['chat_threads', meta.threads, 5000], ['chat_messages', meta.messages, 10000]]) {
    const lengths = cols.map((col) => `COALESCE(OCTET_LENGTH(CAST(${ident(col)} AS BINARY)),0)`).join('+');
    const sizes = await queryRows(db, `SELECT COUNT(*) AS row_count, COALESCE(SUM(${lengths}),0) AS byte_count FROM ${ident(table)}`);
    const count = Number(sizes[0]?.row_count), bytes = Number(sizes[0]?.byte_count);
    if (!Number.isSafeInteger(count) || !Number.isSafeInteger(bytes) || count < 0 || bytes < 0 || count > maxRows || bytes > 4_000_000) fail('CAPACITY_LIMIT_EXCEEDED');
  }
  // SQL HEX preserves the server-side byte representation without mysql2 JSON parsing.
  // This compares logical SQL representations, not engine physical bytes.
  const fields = (cols, table) => cols.map((col, i) => {
    const type = meta.base.find((c) => c.tableName === table && c.columnName === col)?.dataType;
    const bytes = `HEX(CAST(${ident(col)} AS BINARY)) AS __t113_${i}`;
    return String(type).toLowerCase() === 'enum' ? `${bytes}, (${ident(col)} + 0) AS __t113_e${i}` : bytes;
  }).join(',');
  const threads = await queryRows(db, `SELECT id AS __t113_id, ${fields(meta.threads, 'chat_threads')} FROM chat_threads ORDER BY id${suffix}`);
  const messages = await queryRows(db, `SELECT id AS __t113_id, thread_id AS __t113_thread_id, ${fields(meta.messages, 'chat_messages')} FROM chat_messages ORDER BY id${suffix}`);
  if (!threads.length) fail('NO_TARGET_THREADS');
  const ids = threads.map((x) => String(x.__t113_id));
  if (ids.length > 5000 || ids.some((id) => !/^[1-9][0-9]*$/.test(id))) fail('TARGET_ID_INVALID_OR_TOO_MANY');
  if (new Set(ids).size !== ids.length) fail('DUPLICATE_THREAD_ID');
  const idSet = new Set(ids);
  if (messages.some((x) => !idSet.has(String(x.__t113_thread_id)))) fail('ORPHAN_MESSAGE');
  return { ids, threadCount: threads.length, messageCount: messages.length,
    threadHash: sha(json(threads)), messageHash: sha(json(messages)) };
}
async function main() {
  // The executable remains explicitly disabled pending independent review, QA and cutover controls.
  if (process.env.T113_UNREVIEWED_PROTOTYPE !== 'I_UNDERSTAND_THIS_IS_NOT_APPROVED') fail('PROTOTYPE_DISABLED');
  const [mode, configFile, manifestFile, digest] = process.argv.slice(2);
  if (!['capture', 'apply'].includes(mode) || !configFile || !manifestFile || (mode === 'apply' && !/^[0-9a-f]{64}$/.test(digest || '')) || process.argv.length !== (mode === 'apply' ? 6 : 5)) fail('USAGE');
  const c = configFrom(await protectedRead(configFile));
  let manifest;
  if (mode === 'apply') {
    const raw = await protectedRead(manifestFile);
    if (sha(raw) !== digest) fail('MANIFEST_HASH_MISMATCH');
    manifest = JSON.parse(raw);
    if (manifest.version !== 1 || manifest.ownerId !== c.ownerId) fail('MANIFEST_INVALID');
  }
  const ca = await readFile(c.caPath, 'utf8');
  const mysql = require('mysql2/promise');
  const db = await mysql.createConnection({ host: c.host, port: c.port, user: c.user, password: c.password,
    database: c.database, ssl: { ca, rejectUnauthorized: true }, dateStrings: true, supportBigNumbers: true, bigNumberStrings: true,
    multipleStatements: false, connectTimeout: 10000 });
  let tx = false, commitStarted = false;
  try {
    const actual = await identity(db);
    compare(actual, { db: c.database, host: c.expectedHost, port: c.expectedPort, serverId: c.expectedServerId }, 'SERVER_IDENTITY_MISMATCH');
    if (mode === 'apply') compare(actual, manifest.identity, 'MANIFEST_SERVER_MISMATCH');
    await db.query("SET SESSION time_zone = '+00:00'");
    if (mode === 'capture') {
      await db.query('SET TRANSACTION READ ONLY');
      await db.query('START TRANSACTION WITH CONSISTENT SNAPSHOT'); tx = true;
      const meta = await metadata(db, false);
      const data = await snapshot(db, meta, c.ownerId, false);
      const document = { version: 1, identity: actual, ownerId: c.ownerId, columns: meta.base, data };
      await db.rollback(); tx = false;
      const raw = json(document) + '\n';
      await writeFile(manifestFile, raw, { mode: 0o600, flag: 'wx' });
      console.log(`CAPTURE_OK threads=${data.threadCount} messages=${data.messageCount} sha256=${sha(raw)}`);
    } else {
      await db.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
      await db.beginTransaction(); tx = true;
      const meta = await metadata(db, true);
      compare(meta.base, manifest.columns, 'COLUMN_DRIFT');
      const before = await snapshot(db, meta, c.ownerId, true);
      compare(before, manifest.data, 'DATA_DRIFT');
      const owners = await queryRows(db, 'SELECT id, user_id FROM chat_threads ORDER BY id FOR UPDATE');
      if (owners.some((r) => r.user_id !== null)) fail('NON_NULL_OWNER_FOUND');
      const marks = before.ids.map(() => '?').join(',');
      const [result] = await db.query(`UPDATE chat_threads SET user_id=?, updated_at=updated_at WHERE user_id IS NULL AND id IN (${marks})`, [c.ownerId, ...before.ids]);
      if (result.affectedRows !== before.threadCount) fail('AFFECTED_COUNT_MISMATCH');
      const after = await snapshot(db, meta, c.ownerId, true);
      compare(after, manifest.data, 'POST_UPDATE_DATA_DRIFT');
      const afterOwners = await queryRows(db, 'SELECT id, user_id FROM chat_threads ORDER BY id FOR UPDATE');
      if (afterOwners.length !== before.threadCount || afterOwners.some((r) => String(r.user_id) !== String(c.ownerId))) fail('POST_OWNER_MISMATCH');
      commitStarted = true; await db.commit(); commitStarted = false; tx = false;
      console.log(`APPLY_COMMITTED threads=${after.threadCount} messages=${after.messageCount}`);
    }
  } catch (e) {
    if (commitStarted) console.error('COMMIT_OUTCOME_UNKNOWN_DO_NOT_RETRY');
    else { if (tx) await db.rollback().catch(() => {}); console.error('ABORTED_ROLLBACK_REQUESTED'); }
    throw e;
  } finally { await db.end().catch(() => {}); }
}
export { configFrom, hasDirectTriggerGrant, ident, metadata, protectedRead, snapshot };
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { const code = e instanceof Error && /^[A-Z_]+$/.test(e.message) ? e.message : 'INTERNAL_ERROR_REDACTED'; console.error(code); process.exitCode = 1; });
}
