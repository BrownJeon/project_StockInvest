import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ArchiveConflictError, ArchiveIntegrityError, ArchiveTransactionRequiredError, BLOB_PART_BYTES, canonicalJson,
  jsonSha256, publishDataset, putBlob, putDataset, putRecord, putSignalDraft, putTestArtifact,
  readBlob, readPublishedRecords, saveAnalysisRun, sha256, utcSql,
} from '../store';
import type { ArchiveQueryable, ArchiveTransactionConnection, JsonValue } from '../types';

jest.mock('@/lib/db', () => ({ getPool: jest.fn(() => { throw new Error('unexpected_real_database'); }) }));

/** Binary fake supports only the archive tables, never production trading tables. */
class BinaryArchive implements ArchiveQueryable {
  headers = new Map<string, { byte_length: number; part_count: number; encoding: string }>();
  parts = new Map<string, { part_no: number; part_sha256: string; bytes: Buffer }>();
  artifacts = new Map<string, { filename: unknown; sha256: unknown; role: unknown; metadata_json: unknown }>();
  async query<T = unknown>(sql: string, values: unknown[] = []): Promise<[T, unknown]> {
    const [a, b, c, d, e] = values; let result: unknown;
    if (sql.startsWith('INSERT INTO t156_blob (')) {
      if (!this.headers.has(String(a))) this.headers.set(String(a), { byte_length: Number(b), part_count: Number(c), encoding: String(d) });
      result = {};
    } else if (sql.startsWith('SELECT byte_length')) {
      const r = this.headers.get(String(a)); result = r ? [r] : [];
    } else if (sql.startsWith('INSERT INTO t156_blob_part')) {
      const id = `${a}:${b}`;
      if (!this.parts.has(id)) this.parts.set(id, { part_no: Number(b), part_sha256: String(c), bytes: Buffer.from(d as Buffer) });
      result = {};
    } else if (sql.startsWith('SELECT part_sha256')) {
      const r = this.parts.get(`${a}:${b}`); result = r ? [r] : [];
    } else if (sql.startsWith('SELECT part_no')) {
      result = [...this.parts].filter(([id]) => id.startsWith(`${a}:`)).map(([, r]) => r).sort((x, y) => x.part_no - y.part_no);
    } else if (sql.includes('INSERT INTO t156_test_artifact')) {
      if (!this.artifacts.has(String(a))) this.artifacts.set(String(a), { filename: b, sha256: c, role: d, metadata_json: e });
      result = {};
    } else if (sql.startsWith('SELECT filename,sha256')) {
      const r = this.artifacts.get(String(a)); result = r ? [r] : [];
    } else { throw new Error('unsupported_fake_query'); }
    return [result as T, undefined];
  }
}

function queueQuery(results: unknown[]): {
  q: ArchiveTransactionConnection; calls: { sql: string; values: unknown[] }[]; transactions: string[];
} {
  const calls: { sql: string; values: unknown[] }[] = [];
  const transactions: string[] = [];
  const q: ArchiveTransactionConnection = {
    async beginTransaction() { transactions.push('begin'); },
    async commit() { transactions.push('commit'); },
    async rollback() { transactions.push('rollback'); },
    release() { transactions.push('release'); },
    destroy() { transactions.push('destroy'); },
    async query<T>(sql: string, values: unknown[] = []): Promise<[T, unknown]> {
      if (sql === 'SELECT @@in_transaction AS active_transaction') return [[{ active_transaction: 0 }] as unknown as T, undefined];
      calls.push({ sql, values });
      if (!results.length) throw new Error('unexpected_query');
      return [results.shift() as T, undefined];
    },
  };
  return { q, calls, transactions };
}

describe('T-156 immutable archive', () => {
  test('preserves binary originals across packet-sized parts, resumes and detects changed bytes', async () => {
    const q = new BinaryArchive();
    const bytes = randomBytes(BLOB_PART_BYTES * 2 + 179);
    const hash = await putBlob(bytes, 'binary', q);
    expect(q.headers.get(hash)?.part_count).toBe(3);
    expect([...q.parts.values()].every(p => p.bytes.length <= BLOB_PART_BYTES)).toBe(true);
    expect((await readBlob(hash, q)).equals(bytes)).toBe(true);
    q.parts.delete(`${hash}:1`);
    await expect(readBlob(hash, q)).rejects.toBeInstanceOf(ArchiveIntegrityError);
    expect(await putBlob(bytes, 'binary', q)).toBe(hash);
    expect(sha256(await readBlob(hash, q))).toBe(hash);
    q.parts.get(`${hash}:1`)!.bytes[0] ^= 1;
    await expect(readBlob(hash, q)).rejects.toBeInstanceOf(ArchiveIntegrityError);
    await expect(putBlob(bytes, 'binary', q)).rejects.toBeInstanceOf(ArchiveIntegrityError);
  });

  test('stores exact artifact bytes and refuses an ID assigned to different originals', async () => {
    const q = new BinaryArchive();
    const bytes = Buffer.from('{"fee_pct":0.15,"initial_usd":"100000.0000","net_return":-0.012}\n');
    const artifact = { artifactId: 'study-15bp', filename: 'source.json', sha256: sha256(bytes), role: 'simulation_result', metadata: { feeBasisPoints: 15, currency: 'USD' } };
    await putTestArtifact(artifact, bytes, q);
    await putTestArtifact(artifact, bytes, q);
    expect((await readBlob(artifact.sha256, q)).equals(bytes)).toBe(true);
    const other = Buffer.from(bytes.toString().replace('0.15', '0.25'));
    await expect(putTestArtifact({ ...artifact, sha256: sha256(other) }, other, q)).rejects.toBeInstanceOf(ArchiveConflictError);
    expect(q.artifacts.get('study-15bp')?.sha256).toBe(artifact.sha256);
  });

  test('record decimals remain strings and a duplicate cannot replace a source row', async () => {
    const record = { datasetId: 'raw-1', recordType: 'backfill_stock_bar', recordKey: 'AAPL:1990-01-02', sessionDate: '1990-01-02', symbol: 'AAPL', availableAt: null, payload: { close: '1.000000000000000001', published_at: null } };
    const { q, calls, transactions } = queueQuery([[{ status: 'staged' }], {}, [{ session_date: '1990-01-02', symbol: 'AAPL', available_at_utc: null, payload_json: JSON.stringify(record.payload) }]]);
    await putRecord(record, q);
    expect(JSON.parse(String(calls[1].values[6])).close).toBe('1.000000000000000001');
    expect(calls[0].sql).toContain('FOR UPDATE');
    expect(transactions).toEqual(['begin', 'commit']);
    const conflict = queueQuery([[{ status: 'staged' }], {}, [{ session_date: '1990-01-02', symbol: 'AAPL', available_at_utc: null, payload_json: '{"close":"2.00"}' }]]);
    await expect(putRecord(record, conflict.q)).rejects.toBeInstanceOf(ArchiveConflictError);
    expect(conflict.transactions).toEqual(['begin', 'rollback']);
  });

  test('publication and record writes require a dedicated transactional executor', async () => {
    const query = jest.fn();
    const plain = { query } as ArchiveQueryable;
    await expect(publishDataset('raw-1', { rowCount: 1 }, plain)).rejects.toBeInstanceOf(ArchiveTransactionRequiredError);
    await expect(putRecord({ datasetId: 'raw-1', recordType: 'event', recordKey: '1', sessionDate: null, availableAt: null, payload: {} }, plain))
      .rejects.toBeInstanceOf(ArchiveTransactionRequiredError);
    expect(query).not.toHaveBeenCalled();
    const active = queueQuery([]);
    active.q.query = async <T>() => [[{ active_transaction: 1 }] as unknown as T, undefined];
    await expect(publishDataset('raw-1', { rowCount: 1 }, active.q)).rejects.toBeInstanceOf(ArchiveTransactionRequiredError);
    expect(active.transactions).toEqual([]);
  });

  test('publication holds the parent lock through count, eligibility check and commit', async () => {
    const tx = queueQuery([[{ status: 'staged' }], [{ n: 1, unknown_n: 0 }], {}, [{ status: 'published', row_count: 1, live_eligible: 1 }]]);
    const getConnection = jest.fn(async () => tx.q);
    const poolQuery = jest.fn(() => { throw new Error('pooled_query_forbidden'); });
    await publishDataset('raw-1', { rowCount: 1, liveEligible: true }, { query: poolQuery, getConnection });
    expect(tx.calls[0].sql).toContain('WHERE id=? FOR UPDATE');
    expect(tx.calls[1].sql).toContain('COUNT(*)');
    expect(tx.calls[2].sql).toContain("SET status='published'");
    expect(tx.transactions).toEqual(['begin', 'commit', 'release']);
    expect(getConnection).toHaveBeenCalledTimes(1);
    expect(poolQuery).not.toHaveBeenCalled();
  });

  test('an unknown-availability record aborts publication and rolls back before any update', async () => {
    const tx = queueQuery([[{ status: 'staged' }], [{ n: 2, unknown_n: 1 }]]);
    await expect(publishDataset('raw-1', { rowCount: 2, liveEligible: true }, tx.q)).rejects.toBeInstanceOf(ArchiveIntegrityError);
    expect(tx.transactions).toEqual(['begin', 'rollback']);
    expect(tx.calls.every(c => !c.sql.startsWith('UPDATE'))).toBe(true);
  });

  test('published datasets permit exact replays but refuse new rows without attempting inserts', async () => {
    const record = { datasetId: 'raw-1', recordType: 'event', recordKey: '1', sessionDate: null, availableAt: null, payload: { value: '1.00' } };
    const replay = queueQuery([[{ status: 'published' }], [{ session_date: null, symbol: null, available_at_utc: null, payload_json: '{"value":"1.00"}' }]]);
    await putRecord(record, replay.q);
    expect(replay.transactions).toEqual(['begin', 'commit']);
    expect(replay.calls.every(c => !c.sql.startsWith('INSERT'))).toBe(true);
    const absent = queueQuery([[{ status: 'published' }], []]);
    await expect(putRecord(record, absent.q)).rejects.toBeInstanceOf(ArchiveConflictError);
    expect(absent.transactions).toEqual(['begin', 'rollback']);
    expect(absent.calls.every(c => !c.sql.startsWith('INSERT'))).toBe(true);
  });

  test('rollback failure destroys an acquired connection instead of returning an active transaction to its pool', async () => {
    const tx = queueQuery([[{ status: 'staged' }], [{ n: 2, unknown_n: 1 }]]);
    tx.q.rollback = async () => { tx.transactions.push('rollback'); throw new Error('rollback_failed'); };
    const pool = { query: jest.fn(), getConnection: async () => tx.q } as ArchiveQueryable;
    await expect(publishDataset('raw-1', { rowCount: 2, liveEligible: true }, pool)).rejects.toBeInstanceOf(ArchiveIntegrityError);
    expect(tx.transactions).toEqual(['begin', 'rollback', 'destroy']);
  });

  test('operational reads bind a cutoff and cannot select unknown, staged or research-only rows', async () => {
    const { q, calls } = queueQuery([[]]);
    expect(await readPublishedRecords({ datasetId: 'split-1', recordType: 'price_bar', cutoff: '2026-11-06T21:01:00Z', symbol: 'AAPL', throughSession: '2026-11-06', limit: 201 }, q)).toEqual([]);
    expect(calls[0].sql).toContain("d.status='published'");
    expect(calls[0].sql).toContain('d.live_eligible=TRUE');
    expect(calls[0].sql).toContain('r.available_at IS NOT NULL');
    expect(calls[0].sql).toContain('r.available_at<=?');
    expect(calls[0].values).toEqual(['split-1', 'price_bar', '2026-11-06 21:01:00', '2026-11-06', 'AAPL', 201]);
  });

  test('replayed analysis retains the first run ID and creation time but rejects altered plans', async () => {
    const input: JsonValue = { account: { settledCashUsd: '100000.00' }, session: '2026-11-06' };
    const run = { runId: 'new-generated-id', idempotencyKey: 'm40:2026-11-06:input1', sessionDate: '2026-11-06', decisionAt: '2026-11-06T21:01:00Z', policyVersion: 'm40-v1', inputSha256: jsonSha256(input), input, plan: { candidates: ['AAPL'] }, status: 'draft', createdAt: '2026-11-08T00:00:00Z' };
    const existing = { run_id: 'first-id', policy_version: run.policyVersion, input_sha256: run.inputSha256, plan_json: JSON.stringify(run.plan), status: run.status, session_date: run.sessionDate, decision_at_utc: run.decisionAt };
    const { q, calls } = queueQuery([{}, [existing]]);
    expect(await saveAnalysisRun(run, q)).toBe('first-id');
    expect(calls[0].sql).toContain('ON DUPLICATE KEY UPDATE run_id=run_id');
    const changed = queueQuery([{}, [existing]]);
    await expect(saveAnalysisRun({ ...run, plan: { candidates: ['MSFT'] } }, changed.q)).rejects.toBeInstanceOf(ArchiveConflictError);
  });

  test('draft storage accepts shadow/blocked only and never promotes a draft to an order', async () => {
    const { q, calls } = queueQuery([{}, [{ status: 'shadow', payload_json: '{"quantity":5}' }]]);
    await putSignalDraft({ runId: 'run-1', symbol: 'AAPL', side: 'buy', payload: { quantity: 5 }, status: 'shadow' }, q);
    expect(calls.every(c => c.sql.includes('t156_signal_draft'))).toBe(true);
    await expect(putSignalDraft({ runId: 'run-1', symbol: 'AAPL', side: 'buy', payload: {}, status: 'approved' as 'shadow' }, q)).rejects.toThrow('invalid_archive_draft');
  });

  test('hashes are deterministic, UTC is explicit and hostile JSON keys are preserved as data', () => {
    expect(jsonSha256({ b: '1.00', a: 2 })).toBe(jsonSha256({ a: 2, b: '1.00' }));
    expect(jsonSha256({ a: 1 })).not.toBe(jsonSha256({ a: '1' }));
    expect(canonicalJson(JSON.parse('{"__proto__":{"admin":true},"a":1}'))).toBe('{"__proto__":{"admin":true},"a":1}');
    expect(({} as { admin?: boolean }).admin).toBeUndefined();
    expect(utcSql('2026-11-06T21:00:00.123456Z')).toBe('2026-11-06 21:00:00.123456');
    expect(() => utcSql('2026-11-06T21:00:00+09:00')).toThrow();
    expect(() => utcSql('2026-11-06T24:00:00Z')).toThrow();
    expect(() => utcSql('2026-02-30T21:00:00Z')).toThrow();
    expect(() => canonicalJson({ x: NaN })).toThrow();
  });
});

function gate(): { promise: Promise<void>; open(): void } {
  let resolve!: () => void;
  return { promise: new Promise<void>(r => { resolve = r; }), open: () => resolve() };
}

/**
 * Optional real InnoDB regression. It only accepts a fresh fixture on loopback;
 * the production environment variables DB_* are never read by this suite.
 * Root creates/disposes the isolated MariaDB instance and database explicitly.
 */
const realDatabase = process.env.T156_TEST_DB_ISOLATED === '1' ? describe : describe.skip;
realDatabase('T-156 real MariaDB publication concurrency', () => {
  let pool: import('mysql2/promise').Pool;
  const ids: string[] = [];
  const q = (): ArchiveQueryable => pool as unknown as ArchiveQueryable;

  beforeAll(async () => {
    const database = process.env.T156_TEST_DB_NAME ?? '';
    const port = Number(process.env.T156_TEST_DB_PORT);
    if (!/^t156_store_test_[a-z0-9_]+$/.test(database) || !Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new Error('explicit_isolated_fixture_required');
    }
    const mysql = await import('mysql2/promise');
    pool = mysql.createPool({
      host: '127.0.0.1', port, database, user: 'root', password: process.env.T156_TEST_DB_PASSWORD,
      connectionLimit: 5, connectTimeout: 3000, dateStrings: true, multipleStatements: false,
    });
    const [target] = await pool.query<import('mysql2/promise').RowDataPacket[]>('SELECT DATABASE() AS db');
    if (target[0]?.db !== database) throw new Error('isolated_fixture_target_mismatch');
    const ddl = readFileSync(join(process.cwd(), 'scripts/migrations/T-156-analysis-archive.sql'), 'utf8');
    for (const statement of ddl.split(/;\s*(?:\n|$)/).filter(s => s.trim())) await pool.query(statement);
  });

  afterAll(async () => {
    if (!pool) return;
    for (const id of ids) {
      await pool.query('DELETE FROM t156_record WHERE dataset_id=?', [id]);
      await pool.query('DELETE FROM t156_dataset WHERE id=?', [id]);
    }
    await pool.end();
  });

  async function seed(): Promise<string> {
    const id = 'store-race-' + randomUUID(); ids.push(id);
    await putDataset({ id, kind: 'fixture', sourceKey: 'isolated-store-regression', metadata: {} }, q());
    await putRecord({ datasetId: id, recordType: 'event', recordKey: 'initial', sessionDate: null,
      availableAt: '2026-11-06T21:00:00Z', payload: { source: 'known' } }, q());
    return id;
  }

  /** Intercept a dedicated connection without moving a query onto the pool. */
  function gatedPool(
    predicate: (sql: string) => boolean, reached: ReturnType<typeof gate>, resume: ReturnType<typeof gate>,
    attempting?: { reached: ReturnType<typeof gate>; threadId?: number },
  ): ArchiveQueryable {
    let used = false;
    return {
      query: async <T>(sql: string, values?: unknown[]) => await pool.query(sql, values) as unknown as [T, unknown],
      getConnection: async () => {
        const connection = await pool.getConnection();
        return {
          beginTransaction: () => connection.beginTransaction(), commit: () => connection.commit(), rollback: () => connection.rollback(),
          release: () => connection.release(), destroy: () => connection.destroy(),
          async query<T>(sql: string, values?: unknown[]): Promise<[T, unknown]> {
            if (attempting && sql.includes('FOR UPDATE')) {
              attempting.threadId = connection.threadId;
              attempting.reached.open();
            }
            const result = await connection.query(sql, values);
            if (!used && predicate(sql)) { used = true; reached.open(); await resume.promise; }
            return result as unknown as [T, unknown];
          },
        };
      },
    };
  }

  async function confirmLockWait(attempt: { reached: ReturnType<typeof gate>; threadId?: number }): Promise<void> {
    await attempt.reached.promise;
    const deadline = Date.now() + 3000;
    do {
      const [found] = await pool.query<import('mysql2/promise').RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM information_schema.INNODB_LOCK_WAITS w
         JOIN information_schema.INNODB_TRX t ON t.trx_id=w.requesting_trx_id WHERE t.trx_mysql_thread_id=?`,
        [attempt.threadId],
      );
      if (Number(found[0]?.n) > 0) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    } while (Date.now() < deadline);
    throw new Error('expected_real_innodb_row_lock_wait');
  }

  test('an insert starting after the publisher count cannot enter the published dataset', async () => {
    const id = await seed();
    const counted = gate(), finishPublication = gate();
    const publication = publishDataset(id, { rowCount: 1, liveEligible: true }, gatedPool(sql => sql.includes('COUNT(*)'), counted, finishPublication));
    await counted.promise;
    const writerAttempt: { reached: ReturnType<typeof gate>; threadId?: number } = { reached: gate() };
    const unused = gate(); unused.open();
    const insertion = putRecord({ datasetId: id, recordType: 'event', recordKey: 'late-unknown', sessionDate: null,
      availableAt: null, payload: { source: 'unknown' } }, gatedPool(() => false, unused, unused, writerAttempt)).then(() => null, error => error);
    try { await confirmLockWait(writerAttempt); }
    finally { finishPublication.open(); }
    await publication;
    expect(await insertion).toBeInstanceOf(ArchiveConflictError);
    const [records] = await pool.query<import('mysql2/promise').RowDataPacket[]>('SELECT COUNT(*) AS n,SUM(available_at IS NULL) AS unknown_n FROM t156_record WHERE dataset_id=?', [id]);
    const [state] = await pool.query<import('mysql2/promise').RowDataPacket[]>('SELECT status,row_count,live_eligible FROM t156_dataset WHERE id=?', [id]);
    expect(Number(records[0].n)).toBe(1);
    expect(Number(records[0].unknown_n)).toBe(0);
    expect(state[0].status).toBe('published');
    expect(Number(state[0].row_count)).toBe(1);
    expect(Number(state[0].live_eligible)).toBe(1);
  }, 15_000);

  test('publication waits for an admitted writer and sees its unknown availability', async () => {
    const id = await seed();
    const locked = gate(), finishInsert = gate();
    const insertion = putRecord({ datasetId: id, recordType: 'event', recordKey: 'admitted-unknown', sessionDate: null,
      availableAt: null, payload: { source: 'unknown' } }, gatedPool(sql => sql.includes('FOR UPDATE'), locked, finishInsert));
    await locked.promise;
    const publisherAttempt: { reached: ReturnType<typeof gate>; threadId?: number } = { reached: gate() };
    const unused = gate(); unused.open();
    const publication = publishDataset(id, { rowCount: 2, liveEligible: true }, gatedPool(() => false, unused, unused, publisherAttempt)).then(() => null, error => error);
    try { await confirmLockWait(publisherAttempt); }
    finally { finishInsert.open(); }
    await insertion;
    expect(await publication).toBeInstanceOf(ArchiveIntegrityError);
    const [records] = await pool.query<import('mysql2/promise').RowDataPacket[]>('SELECT COUNT(*) AS n,SUM(available_at IS NULL) AS unknown_n FROM t156_record WHERE dataset_id=?', [id]);
    const [state] = await pool.query<import('mysql2/promise').RowDataPacket[]>('SELECT status,live_eligible FROM t156_dataset WHERE id=?', [id]);
    expect(Number(records[0].n)).toBe(2);
    expect(Number(records[0].unknown_n)).toBe(1);
    expect(state[0].status).toBe('staged');
    expect(Number(state[0].live_eligible)).toBe(0);
  }, 15_000);
});
