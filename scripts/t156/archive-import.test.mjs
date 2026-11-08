import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { importDump } from './archive-import.mjs';

const hash = 'a'.repeat(64);
const datasetId = 't156-research-db-20261108';
const descriptor = (table, rows, checksum = '42') => ({ table, rows, checksum });
const create = table => `CREATE TABLE \`${table}\` (id INT PRIMARY KEY, payload TEXT);`;
const insert = (table, id, payload = 'original') => `INSERT INTO \`${table}\` VALUES (${id},'${payload}');`;

/** Transactional database contract fixture; DDL is forbidden inside a batch. */
class FixtureDb {
  constructor(existing = {}) {
    this.existing = existing;
    this.status = 'staged'; this.foreignKeys = 1; this.active = false;
    this.events = []; this.committed = []; this.pending = []; this.groups = [];
    this.insertAttempts = 0; this.failAt = null; this.rejectAfterCommit = false;
  }
  async beginTransaction() {
    assert.equal(this.active, false); this.active = true; this.pending = [];
    this.events.push({ kind: 'begin' });
  }
  async commit() {
    assert.equal(this.active, true);
    this.events.push({ kind: 'commit', rows: this.pending.length });
    this.committed.push(...this.pending); this.groups.push([...this.pending]);
    this.pending = []; this.active = false;
    if (this.rejectAfterCommit) this.status = 'rejected';
  }
  async rollback() {
    assert.equal(this.active, true); this.events.push({ kind: 'rollback', rows: this.pending.length });
    this.pending = []; this.active = false;
  }
  async query(sql, values = []) {
    if (sql.startsWith('SELECT content_sha256,status')) {
      this.events.push({ kind: sql.endsWith('FOR UPDATE') ? 'lock' : 'ownership' });
      assert.equal(values[0], datasetId);
      return [[{ content_sha256: hash, status: this.status }], undefined];
    }
    if (sql.includes('FROM information_schema.TABLES')) {
      return [Object.keys(this.existing).map(t => ({ table_name: 't156_research_' + t })), undefined];
    }
    const table = sql.match(/`t156_research_([a-z0-9_]+)`/)?.[1];
    if (sql.startsWith('SELECT COUNT(*)')) return [[{ n: this.existing[table].rows }], undefined];
    if (sql.startsWith('CHECKSUM TABLE')) return [[{ Checksum: this.existing[table].checksum }], undefined];
    if (sql === 'SELECT @@foreign_key_checks AS fk_checks') return [[{ fk_checks: this.foreignKeys }], undefined];
    if (/^SET FOREIGN_KEY_CHECKS=[01]$/.test(sql)) {
      this.foreignKeys = Number(sql.at(-1));
      this.events.push({ kind: 'fk', value: this.foreignKeys });
      return [{}, undefined];
    }
    if (sql.startsWith('CREATE TABLE')) {
      assert.equal(this.active, false, 'DDL must follow an explicit commit');
      this.events.push({ kind: 'ddl', table }); return [{}, undefined];
    }
    if (sql.startsWith('INSERT IGNORE INTO')) {
      assert.equal(this.active, true, 'source rows must not autocommit');
      this.events.push({ kind: 'insert', table });
      if (++this.insertAttempts === this.failAt) throw new Error('fixture_insert_failed');
      this.pending.push(sql); return [{}, undefined];
    }
    if (sql.startsWith('SET ')) {
      this.events.push({ kind: 'set' }); return [{}, undefined];
    }
    throw new Error('unexpected_fixture_query');
  }
}

async function fixture(source, tables, run) {
  const dir = await mkdtemp(join(tmpdir(), 't156-import-test-'));
  const dumpPath = join(dir, 'input.sql.gz');
  await writeFile(dumpPath, gzipSync(source.join('\n') + '\n'));
  try { return await run({ manifest: { dumpSha256: hash, tables }, dumpPath, datasetId, dumpSha: hash }); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

test('bounds transaction groups and commits before DDL while preserving literal source text', async () => {
  const body = 'source_table REFERENCES `a` CONSTRAINT `a`';
  const db = new FixtureDb();
  const result = await fixture(
    [create('a'), insert('a', 1, body), insert('a', 2), insert('a', 3), create('b'), insert('b', 1)],
    [descriptor('a', 3), descriptor('b', 1)],
    options => importDump(db, { ...options, maxBatchStatements: 2, maxBatchBytes: 1024 }),
  );
  assert.deepEqual(db.groups.map(g => g.length), [2, 1, 1]);
  assert(db.groups.every(g => g.length <= 2 && g.reduce((n, s) => n + Buffer.byteLength(s), 0) <= 1024));
  assert.equal(db.committed[0], insert('a', 1, body).replace(/^INSERT INTO `a`/, 'INSERT IGNORE INTO `t156_research_a`'));
  const ddlB = db.events.findIndex(e => e.kind === 'ddl' && e.table === 'b');
  assert.equal(db.events[ddlB - 2].kind, 'commit');
  assert.equal(db.events[ddlB - 1].kind, 'ownership');
  assert.equal(db.active, false); assert.equal(db.foreignKeys, 1);
  assert.equal(result.committedBatches, 3); assert.equal(result.insertedStatements, 4);
});

test('SQL byte budget flushes a group before the next insert would exceed it', async () => {
  const db = new FixtureDb();
  await fixture([create('a'), ...[1, 2, 3, 4].map(n => insert('a', n))], [descriptor('a', 4)],
    options => importDump(db, { ...options, maxBatchBytes: 130 }));
  assert.deepEqual(db.groups.map(g => g.length), [2, 2]);
  assert(db.groups.every(g => g.reduce((n, s) => n + Buffer.byteLength(s), 0) <= 130));
});

test('a failed batch rolls back its rows, retains earlier commits and restores foreign keys', async () => {
  const db = new FixtureDb(); db.failAt = 4;
  await assert.rejects(fixture([create('a'), ...[1, 2, 3, 4, 5].map(n => insert('a', n))], [descriptor('a', 5)],
    options => importDump(db, { ...options, maxBatchStatements: 2 })), /fixture_insert_failed/);
  assert.equal(db.committed.length, 2); assert.equal(db.pending.length, 0);
  assert(db.events.some(e => e.kind === 'rollback' && e.rows === 1));
  assert.equal(db.active, false); assert.equal(db.foreignKeys, 1);
});

test('resume skips a completed table only when both count and checksum match', async () => {
  const db = new FixtureDb({ a: { rows: 2, checksum: '42' }, b: { rows: 1, checksum: '42' }, c: { rows: 2, checksum: '43' } });
  const source = ['a', 'b', 'c'].flatMap(t => [create(t), insert(t, 1), insert(t, 2)]);
  const result = await fixture(source, ['a', 'b', 'c'].map(t => descriptor(t, 2)), options => importDump(db, options));
  assert.deepEqual(result.skippedTables, ['a']); assert.equal(result.skippedInsertStatements, 2);
  assert.equal(db.events.filter(e => e.kind === 'insert' && e.table === 'a').length, 0);
  assert.equal(db.events.filter(e => e.kind === 'insert' && e.table === 'b').length, 2);
  assert.equal(db.events.filter(e => e.kind === 'insert' && e.table === 'c').length, 2);
});

test('null checksums and a changed immutable dump hash cannot authorize a resume skip', async () => {
  const db = new FixtureDb({ a: { rows: 1, checksum: null } });
  await assert.rejects(fixture([create('a'), insert('a', 1)], [descriptor('a', 1)], options => importDump(db, options)), /invalid_target_checksum/);
  assert.equal(db.insertAttempts, 0); assert.equal(db.foreignKeys, 1);
  const fresh = new FixtureDb();
  await assert.rejects(fixture([create('a')], [descriptor('a', 0)], options => importDump(fresh, { ...options, dumpSha: 'b'.repeat(64) })), /invalid_import_configuration/);
  assert.equal(fresh.events.length, 0);
});

test('withdrawal between batches stops further source writes without republishing', async () => {
  const db = new FixtureDb(); db.rejectAfterCommit = true;
  await assert.rejects(fixture([create('a'), ...[1, 2, 3].map(n => insert('a', n))], [descriptor('a', 3)],
    options => importDump(db, { ...options, maxBatchStatements: 2 })), /dataset_already_published_or_conflict/);
  assert.equal(db.committed.length, 2); assert.equal(db.insertAttempts, 2);
  assert.equal(db.status, 'rejected'); assert.equal(db.foreignKeys, 1); assert.equal(db.active, false);
  assert(db.events.some(e => e.kind === 'rollback'));
});

test('a single oversized original is isolated before and after its own transaction', async () => {
  const db = new FixtureDb(); const logs = [];
  const large = 'PRIVATE-FIXTURE-TEXT-' + 'x'.repeat(512);
  const result = await fixture([create('a'), insert('a', 1), insert('a', 2, large), insert('a', 3)], [descriptor('a', 3)],
    options => importDump(db, { ...options, maxBatchBytes: 130, onProgress: event => logs.push(event) }));
  assert.deepEqual(db.groups.map(g => g.length), [1, 1, 1]);
  assert.equal(result.oversizedStatements, 1);
  assert.equal(logs.filter(e => e.event === 'single_oversized_insert').length, 1);
  assert.equal(JSON.stringify(logs).includes('PRIVATE-FIXTURE-TEXT'), false);
  assert(db.committed[1].includes(large));
});
