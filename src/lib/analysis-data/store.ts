/**
 * T-156 archive access. No DDL, order, notification or strategy-validation writes.
 * Source rows/artifacts are immutable; staged datasets require an explicit publish.
 */
import { createHash } from 'node:crypto';
import { getPool } from '@/lib/db';
import type {
  AnalysisDataset, ArchiveQueryable, ArchiveRecord, ArchiveTransactionConnection, DatasetStatus, JsonValue,
  PriceBarPayload, PublishedPriceBar, RecordQuery, SignalDraft, StoredAnalysisRun,
  StoredJudgment, TestArtifact,
} from './types';

export const BLOB_PART_BYTES = 512 * 1024;
const SHA_RE = /^[0-9a-f]{64}$/;
const ASCII_KEY_RE = /^[\x21-\x7e]+$/;
const UTC_RE = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?Z$/;
type Row = Record<string, unknown>;

export class ArchiveConflictError extends Error {
  constructor() { super('t156_archive_immutable_conflict'); this.name = 'ArchiveConflictError'; }
}
export class ArchiveIntegrityError extends Error {
  constructor() { super('t156_archive_integrity_failed'); this.name = 'ArchiveIntegrityError'; }
}
export class ArchiveTransactionRequiredError extends Error {
  constructor() { super('t156_archive_transaction_required'); this.name = 'ArchiveTransactionRequiredError'; }
}

function db(q?: ArchiveQueryable): ArchiveQueryable {
  return q ?? getPool() as unknown as ArchiveQueryable;
}

function canTransact(q: ArchiveQueryable): q is ArchiveTransactionConnection {
  const c = q as Partial<ArchiveTransactionConnection>;
  return typeof c.beginTransaction === 'function' && typeof c.commit === 'function' && typeof c.rollback === 'function';
}

/**
 * Publication and record writes share the same parent-row lock. The count and
 * eligibility check cannot race an insert admitted while the dataset was staged.
 * A caller-provided connection must be fresh and exclusive for this operation.
 */
async function withDatasetLock<T>(
  id: string, q: ArchiveQueryable | undefined,
  work: (connection: ArchiveTransactionConnection, state: DatasetStatus) => Promise<T>,
): Promise<T> {
  const executor = db(q);
  const owned = typeof executor.getConnection === 'function';
  const connection = owned ? await executor.getConnection!() : executor;
  if (!canTransact(connection) || (owned && (typeof connection.release !== 'function' || typeof connection.destroy !== 'function'))) {
    if (owned && canTransact(connection)) connection.destroy?.();
    throw new ArchiveTransactionRequiredError();
  }
  let began = false;
  let destroyed = false;
  const discard = (): void => {
    destroyed = true;
    try { connection.destroy?.(); } catch { /* Never release an uncertain connection, including a failed destroy. */ }
  };
  try {
    // START TRANSACTION would implicitly commit an injected caller's transaction.
    // Refuse such a connection instead of changing work owned by that caller.
    const [session] = await connection.query<Row[]>('SELECT @@in_transaction AS active_transaction');
    if (Number(rows(session)[0]?.active_transaction) !== 0) throw new ArchiveTransactionRequiredError();
    await connection.beginTransaction();
    began = true;
    const [found] = await connection.query<Row[]>('SELECT status FROM t156_dataset WHERE id=? FOR UPDATE', [id]);
    const state = rows(found)[0]?.status;
    if (state !== 'staged' && state !== 'published') throw new ArchiveConflictError();
    const result = await work(connection, state);
    await connection.commit();
    began = false;
    return result;
  } catch (error) {
    try {
      if (began) await connection.rollback();
      else if (owned) discard();
    } catch {
      // An uncertain transaction must never be returned to the shared pool.
      discard();
    }
    throw error;
  } finally {
    if (owned && !destroyed) connection.release!();
  }
}
function key(value: string, max = 96): string {
  if (!value || value.length > max || !ASCII_KEY_RE.test(value)) throw new Error('invalid_archive_key');
  return value;
}
function sha(value: string): string {
  if (!SHA_RE.test(value)) throw new Error('invalid_archive_sha256');
  return value;
}
function day(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new Error('invalid_archive_session');
  }
  return value;
}
/** All archive DATETIME values are UTC wall-clock strings, independent of pool TZ. */
export function utcSql(value: string): string {
  if (!UTC_RE.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('invalid_archive_utc');
  const datePart = value.slice(0, 10);
  day(datePart);
  return value.slice(0, -1).replace('T', ' ');
}
function utcIso(value: unknown): string {
  if (typeof value !== 'string') throw new ArchiveIntegrityError();
  const iso = value.replace(' ', 'T') + (value.endsWith('Z') ? '' : 'Z');
  utcSql(iso);
  return iso;
}
function boundedLimit(value = 100, max = 20_000): number {
  if (!Number.isInteger(value) || value < 1 || value > max) throw new Error('invalid_archive_limit');
  return value;
}
function canonical(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: { [key: string]: JsonValue } = {};
    for (const name of Object.keys(value).sort()) {
      Object.defineProperty(out, name, { value: canonical((value as Row)[name]), enumerable: true });
    }
    return out;
  }
  throw new Error('invalid_archive_json');
}
export function canonicalJson(value: JsonValue): string { return JSON.stringify(canonical(value)); }
export function sha256(bytes: Buffer | string): string { return createHash('sha256').update(bytes).digest('hex'); }
export function jsonSha256(value: JsonValue): string { return sha256(canonicalJson(value)); }
function json(value: unknown): JsonValue {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  return canonical(parsed);
}
function sameJson(a: unknown, b: JsonValue): boolean { return canonicalJson(json(a)) === canonicalJson(b); }
function rows(result: unknown): Row[] {
  if (!Array.isArray(result)) throw new ArchiveIntegrityError();
  return result as Row[];
}
function dataset(r: Row): AnalysisDataset {
  return {
    id: String(r.id), kind: String(r.kind), sourceKey: String(r.source_key),
    status: r.status as DatasetStatus, liveEligible: Number(r.live_eligible) === 1,
    contentSha256: r.content_sha256 == null ? null : String(r.content_sha256),
    rowCount: Number(r.row_count), metadata: json(r.metadata_json), createdAt: utcIso(r.created_at_utc),
  };
}

export async function putDataset(
  input: Omit<AnalysisDataset, 'createdAt' | 'status' | 'liveEligible' | 'rowCount' | 'contentSha256'> & {
    createdAt?: string; contentSha256?: string | null;
  }, q?: ArchiveQueryable,
): Promise<void> {
  key(input.id); key(input.kind, 64);
  if (!input.sourceKey || input.sourceKey.length > 190) throw new Error('invalid_archive_source');
  const sourceSha = input.contentSha256 == null ? null : sha(input.contentSha256);
  const p = db(q);
  await p.query(
    `INSERT INTO t156_dataset (id,kind,source_key,status,live_eligible,content_sha256,row_count,metadata_json,created_at)
     VALUES (?,?,?,'staged',FALSE,?,0,?,?) ON DUPLICATE KEY UPDATE id=id`,
    [input.id, input.kind, input.sourceKey, sourceSha, canonicalJson(input.metadata), utcSql(input.createdAt ?? new Date().toISOString())],
  );
  const [found] = await p.query<Row[]>('SELECT kind,source_key,content_sha256,metadata_json FROM t156_dataset WHERE id=?', [input.id]);
  const r = rows(found)[0];
  if (!r || r.kind !== input.kind || r.source_key !== input.sourceKey || r.content_sha256 !== sourceSha || !sameJson(r.metadata_json, input.metadata)) {
    throw new ArchiveConflictError();
  }
}

/** Publication is explicit and verifies record count. Live eligibility remains opt-in. */
export async function publishDataset(
  id: string, verification: { rowCount: number; liveEligible?: boolean }, q?: ArchiveQueryable,
): Promise<void> {
  key(id);
  if (!Number.isSafeInteger(verification.rowCount) || verification.rowCount < 0) throw new Error('invalid_archive_count');
  if (verification.liveEligible && verification.rowCount === 0) throw new ArchiveIntegrityError();
  await withDatasetLock(id, q, async p => {
    const [found] = await p.query<Row[]>(
      `SELECT COUNT(*) AS n,SUM(available_at IS NULL) AS unknown_n FROM t156_record WHERE dataset_id=?`, [id],
    );
    const r = rows(found)[0];
    if (!r || Number(r.n) !== verification.rowCount || (verification.liveEligible && Number(r.unknown_n) > 0)) throw new ArchiveIntegrityError();
    await p.query(
      `UPDATE t156_dataset SET status='published',row_count=?,live_eligible=? WHERE id=? AND status IN ('staged','published')`,
      [verification.rowCount, verification.liveEligible === true, id],
    );
    const [published] = await p.query<Row[]>('SELECT status,row_count,live_eligible FROM t156_dataset WHERE id=?', [id]);
    const d = rows(published)[0];
    if (!d || d.status !== 'published' || Number(d.row_count) !== verification.rowCount || (Number(d.live_eligible) === 1) !== (verification.liveEligible === true)) {
      throw new ArchiveIntegrityError();
    }
  });
}

/** Revoke readers without deleting original rows or linked test history. */
export async function withdrawDataset(id: string, q?: ArchiveQueryable): Promise<void> {
  await db(q).query(`UPDATE t156_dataset SET status='rejected',live_eligible=FALSE WHERE id=?`, [key(id)]);
}

export async function putRecord(input: ArchiveRecord, q?: ArchiveQueryable): Promise<void> {
  key(input.datasetId); key(input.recordType, 64); key(input.recordKey, 190);
  const date = input.sessionDate === null ? null : day(input.sessionDate);
  const available = input.availableAt === null ? null : utcSql(input.availableAt);
  const symbol = input.symbol == null ? null : key(input.symbol, 32);
  const payloadHash = jsonSha256(input.payload);
  await withDatasetLock(input.datasetId, q, async (p, state) => {
    // Published rows may be verified idempotently, but can never gain new records.
    if (state === 'staged') {
      await p.query(
        `INSERT INTO t156_record (dataset_id,record_type,record_key,session_date,symbol,available_at,payload_json,content_sha256)
         VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE record_key=record_key`,
        [input.datasetId, input.recordType, input.recordKey, date, symbol, available, canonicalJson(input.payload), payloadHash],
      );
    }
    const [found] = await p.query<Row[]>(
      `SELECT DATE_FORMAT(session_date,'%Y-%m-%d') AS session_date,symbol,DATE_FORMAT(available_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS available_at_utc,payload_json
       FROM t156_record WHERE dataset_id=? AND record_type=? AND record_key=?`,
      [input.datasetId, input.recordType, input.recordKey],
    );
    const r = rows(found)[0];
    const rDate = r?.session_date;
    const rAvailable = r?.available_at_utc == null ? null : Date.parse(String(r.available_at_utc));
    if (!r || rDate !== date || (r.symbol ?? null) !== symbol || rAvailable !== (input.availableAt == null ? null : Date.parse(input.availableAt)) || !sameJson(r.payload_json, input.payload)) {
      throw new ArchiveConflictError();
    }
  });
}

/** No automatic fallback to newer datasets, unknown availability or research rows. */
export async function readPublishedRecords(input: RecordQuery, q?: ArchiveQueryable): Promise<ArchiveRecord[]> {
  key(input.datasetId); key(input.recordType, 64);
  const params: unknown[] = [input.datasetId, input.recordType, utcSql(input.cutoff)];
  const clauses = ["d.status='published'", 'r.dataset_id=?', 'r.record_type=?', 'r.available_at IS NOT NULL', 'r.available_at<=?'];
  if (input.liveOnly !== false) clauses.push('d.live_eligible=TRUE');
  if (input.fromSession) { clauses.push('r.session_date>=?'); params.push(day(input.fromSession)); }
  if (input.throughSession) { clauses.push('r.session_date<=?'); params.push(day(input.throughSession)); }
  if (input.symbol) { clauses.push('r.symbol=?'); params.push(key(input.symbol, 32)); }
  params.push(boundedLimit(input.limit));
  const [found] = await db(q).query<Row[]>(
    `SELECT r.dataset_id,r.record_type,r.record_key,DATE_FORMAT(r.session_date,'%Y-%m-%d') AS session_date,r.symbol,
      DATE_FORMAT(r.available_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS available_at_utc,r.payload_json
     FROM t156_record r JOIN t156_dataset d ON d.id=r.dataset_id
     WHERE ${clauses.join(' AND ')} ORDER BY r.session_date,r.record_key LIMIT ?`, params,
  );
  return rows(found).map(r => ({
    datasetId: String(r.dataset_id), recordType: String(r.record_type), recordKey: String(r.record_key),
    sessionDate: r.session_date == null ? null : String(r.session_date), symbol: r.symbol == null ? null : String(r.symbol),
    availableAt: utcIso(r.available_at_utc), payload: json(r.payload_json),
  }));
}

function pricePayload(value: JsonValue): PriceBarPayload {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new ArchiveIntegrityError();
  const r = value as Row;
  const decimal = /^\d+(?:\.\d+)?$/;
  for (const field of ['open', 'high', 'low', 'close', 'volume']) {
    if (typeof r[field] !== 'string' || !decimal.test(r[field] as string)) throw new ArchiveIntegrityError();
  }
  const [open, high, low, close, volume] = ['open', 'high', 'low', 'close', 'volume'].map(f => Number(r[f]));
  if (![open, high, low, close, volume].every(Number.isFinite) || Math.min(open, high, low, close) <= 0 ||
      low > Math.min(open, close) || high < Math.max(open, close) || low > high ||
      typeof r.symbol !== 'string' || typeof r.session !== 'string' ||
      typeof r.currency !== 'string' || typeof r.identityStatus !== 'string' || typeof r.final !== 'boolean' ||
      !['raw', 'split_adjusted', 'total_return', 'index'].includes(String(r.priceBasis))) throw new ArchiveIntegrityError();
  key(r.symbol, 32); day(r.session);
  return r as unknown as PriceBarPayload;
}

/** Typed normalized prices are a separate record_type from lossless source rows. */
export async function readPublishedPriceBars(input: Omit<RecordQuery, 'recordType'>, q?: ArchiveQueryable): Promise<PublishedPriceBar[]> {
  const result = await readPublishedRecords({ ...input, recordType: 'price_bar' }, q);
  return result.map(r => {
    const p = pricePayload(r.payload);
    if (!r.availableAt || p.session !== r.sessionDate || p.symbol !== r.symbol) throw new ArchiveIntegrityError();
    return { ...p, datasetId: r.datasetId, recordKey: r.recordKey, availableAt: r.availableAt };
  });
}

export async function listDatasets(input: { status?: DatasetStatus; limit?: number } = {}, q?: ArchiveQueryable): Promise<AnalysisDataset[]> {
  if (input.status && !['staged', 'published', 'rejected'].includes(input.status)) throw new Error('invalid_dataset_status');
  const params: unknown[] = input.status ? [input.status] : [];
  params.push(boundedLimit(input.limit, 1000));
  const [found] = await db(q).query<Row[]>(
    `SELECT id,kind,source_key,status,live_eligible,content_sha256,row_count,metadata_json,
      DATE_FORMAT(created_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS created_at_utc
     FROM t156_dataset ${input.status ? 'WHERE status=?' : ''} ORDER BY created_at DESC,id LIMIT ?`, params,
  );
  return rows(found).map(dataset);
}

/** Resumable content-addressed binary storage. Incomplete blobs fail readback. */
export async function putBlob(bytes: Buffer, encoding = 'binary', q?: ArchiveQueryable): Promise<string> {
  key(encoding, 32);
  const p = db(q); const hash = sha256(bytes); const partCount = Math.ceil(bytes.length / BLOB_PART_BYTES);
  await p.query(
    'INSERT INTO t156_blob (sha256,byte_length,part_count,encoding) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE sha256=sha256',
    [hash, bytes.length, partCount, encoding],
  );
  const [headers] = await p.query<Row[]>('SELECT byte_length,part_count,encoding FROM t156_blob WHERE sha256=?', [hash]);
  const header = rows(headers)[0];
  // Encoding is descriptive, but must not silently change for the same immutable object.
  if (!header || Number(header.byte_length) !== bytes.length || Number(header.part_count) !== partCount || header.encoding !== encoding) throw new ArchiveConflictError();
  for (let index = 0; index < partCount; index++) {
    const part = bytes.subarray(index * BLOB_PART_BYTES, (index + 1) * BLOB_PART_BYTES);
    const partHash = sha256(part);
    await p.query(
      'INSERT INTO t156_blob_part (sha256,part_no,part_sha256,bytes) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE part_no=part_no',
      [hash, index, partHash, part],
    );
    const [storedParts] = await p.query<Row[]>(
      'SELECT part_sha256,bytes FROM t156_blob_part WHERE sha256=? AND part_no=?', [hash, index],
    );
    const stored = rows(storedParts)[0];
    if (!stored || stored.part_sha256 !== partHash || !Buffer.isBuffer(stored.bytes) || sha256(stored.bytes) !== partHash) throw new ArchiveIntegrityError();
  }
  return hash;
}

export async function readBlob(hash: string, q?: ArchiveQueryable): Promise<Buffer> {
  sha(hash); const p = db(q);
  const [headers] = await p.query<Row[]>('SELECT byte_length,part_count,encoding FROM t156_blob WHERE sha256=?', [hash]);
  const header = rows(headers)[0];
  if (!header) throw new ArchiveIntegrityError();
  const [found] = await p.query<Row[]>('SELECT part_no,part_sha256,bytes FROM t156_blob_part WHERE sha256=? ORDER BY part_no', [hash]);
  const parts = rows(found);
  if (parts.length !== Number(header.part_count)) throw new ArchiveIntegrityError();
  const buffers = parts.map((r, i) => {
    if (Number(r.part_no) !== i || !Buffer.isBuffer(r.bytes) || sha256(r.bytes) !== r.part_sha256) throw new ArchiveIntegrityError();
    return r.bytes;
  });
  const bytes = Buffer.concat(buffers);
  if (bytes.length !== Number(header.byte_length) || sha256(bytes) !== hash) throw new ArchiveIntegrityError();
  return bytes;
}

export async function putTestArtifact(input: TestArtifact, bytes: Buffer, q?: ArchiveQueryable): Promise<void> {
  key(input.artifactId); sha(input.sha256); key(input.role, 64);
  if (!input.filename || input.filename.length > 512 || sha256(bytes) !== input.sha256) throw new ArchiveIntegrityError();
  const p = db(q);
  await putBlob(bytes, 'binary', p);
  await p.query(
    `INSERT INTO t156_test_artifact (artifact_id,filename,sha256,role,metadata_json) VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE artifact_id=artifact_id`,
    [input.artifactId, input.filename, input.sha256, input.role, canonicalJson(input.metadata)],
  );
  const [found] = await p.query<Row[]>('SELECT filename,sha256,role,metadata_json FROM t156_test_artifact WHERE artifact_id=?', [input.artifactId]);
  const r = rows(found)[0];
  if (!r || r.filename !== input.filename || r.sha256 !== input.sha256 || r.role !== input.role || !sameJson(r.metadata_json, input.metadata)) throw new ArchiveConflictError();
}

export async function listTestArtifacts(limit = 100, q?: ArchiveQueryable): Promise<TestArtifact[]> {
  const [found] = await db(q).query<Row[]>(
    'SELECT artifact_id,filename,sha256,role,metadata_json FROM t156_test_artifact ORDER BY artifact_id LIMIT ?',
    [boundedLimit(limit, 1000)],
  );
  return rows(found).map(r => ({
    artifactId: String(r.artifact_id), filename: String(r.filename), sha256: String(r.sha256), role: String(r.role), metadata: json(r.metadata_json),
  }));
}

export async function saveAnalysisRun(input: Omit<StoredAnalysisRun, 'createdAt'> & { createdAt?: string }, q?: ArchiveQueryable): Promise<string> {
  key(input.runId); key(input.idempotencyKey, 190); day(input.sessionDate); key(input.policyVersion); key(input.status, 32);
  if (sha(input.inputSha256) !== jsonSha256(input.input)) throw new ArchiveIntegrityError();
  const p = db(q);
  await p.query(
    `INSERT INTO t156_analysis_run (run_id,idempotency_key,session_date,decision_at,policy_version,input_sha256,input_json,plan_json,status,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE run_id=run_id`,
    [input.runId, input.idempotencyKey, input.sessionDate, utcSql(input.decisionAt), input.policyVersion, input.inputSha256,
      canonicalJson(input.input), canonicalJson(input.plan), input.status, utcSql(input.createdAt ?? new Date().toISOString())],
  );
  const [found] = await p.query<Row[]>(
    `SELECT run_id,policy_version,input_sha256,plan_json,status,DATE_FORMAT(session_date,'%Y-%m-%d') AS session_date,
      DATE_FORMAT(decision_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS decision_at_utc
     FROM t156_analysis_run WHERE idempotency_key=?`, [input.idempotencyKey],
  );
  const r = rows(found)[0];
  if (!r || r.policy_version !== input.policyVersion || r.input_sha256 !== input.inputSha256 || r.session_date !== input.sessionDate ||
      Date.parse(String(r.decision_at_utc)) !== Date.parse(input.decisionAt) || r.status !== input.status || !sameJson(r.plan_json, input.plan)) throw new ArchiveConflictError();
  return String(r.run_id);
}

export async function putJudgment(input: StoredJudgment, q?: ArchiveQueryable): Promise<void> {
  key(input.runId); key(input.stage, 32); sha(input.eventHash); key(input.status, 32);
  const p = db(q);
  await p.query(
    `INSERT INTO t156_judgment (run_id,stage,event_hash,status,payload_json) VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE event_hash=event_hash`,
    [input.runId, input.stage, input.eventHash, input.status, canonicalJson(input.payload)],
  );
  const found = await getJudgment(input.runId, input.stage, input.eventHash, p);
  if (!found || found.status !== input.status || canonicalJson(found.payload) !== canonicalJson(input.payload)) throw new ArchiveConflictError();
}

export async function getJudgment(runId: string, stage: StoredJudgment['stage'], eventHash: string, q?: ArchiveQueryable): Promise<StoredJudgment | null> {
  const [found] = await db(q).query<Row[]>(
    'SELECT run_id,stage,event_hash,status,payload_json FROM t156_judgment WHERE run_id=? AND stage=? AND event_hash=?',
    [key(runId), key(stage, 32), sha(eventHash)],
  );
  const r = rows(found)[0];
  return r ? { runId: String(r.run_id), stage: r.stage as StoredJudgment['stage'], eventHash: String(r.event_hash), status: String(r.status), payload: json(r.payload_json) } : null;
}

/** Exact event hash only; caller includes cutoff, policy, model and source IDs in hash. */
export async function findJudgment(stage: StoredJudgment['stage'], eventHash: string, q?: ArchiveQueryable): Promise<StoredJudgment | null> {
  const [found] = await db(q).query<Row[]>(
    'SELECT run_id,stage,event_hash,status,payload_json FROM t156_judgment WHERE stage=? AND event_hash=? ORDER BY run_id LIMIT 1',
    [key(stage, 32), sha(eventHash)],
  );
  const r = rows(found)[0];
  return r ? { runId: String(r.run_id), stage: r.stage as StoredJudgment['stage'], eventHash: String(r.event_hash), status: String(r.status), payload: json(r.payload_json) } : null;
}

/** A draft has no approval, notification, signal or order side effect. */
export async function putSignalDraft(input: SignalDraft, q?: ArchiveQueryable): Promise<void> {
  key(input.runId); key(input.symbol, 32);
  if (!['buy', 'sell'].includes(input.side) || !['shadow', 'blocked'].includes(input.status)) throw new Error('invalid_archive_draft');
  const p = db(q);
  await p.query(
    `INSERT INTO t156_signal_draft (run_id,symbol,side,payload_json,status) VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE symbol=symbol`,
    [input.runId, input.symbol, input.side, canonicalJson(input.payload), input.status],
  );
  const [found] = await p.query<Row[]>('SELECT payload_json,status FROM t156_signal_draft WHERE run_id=? AND symbol=? AND side=?', [input.runId, input.symbol, input.side]);
  const r = rows(found)[0];
  if (!r || r.status !== input.status || !sameJson(r.payload_json, input.payload)) throw new ArchiveConflictError();
}

/** Deliberately excludes input_json/plan_json: those may contain private account values. */
export async function listAnalysisRunSummaries(limit = 100, q?: ArchiveQueryable): Promise<JsonValue[]> {
  const [found] = await db(q).query<Row[]>(
    `SELECT run_id,DATE_FORMAT(session_date,'%Y-%m-%d') AS session_date,policy_version,status,
      DATE_FORMAT(created_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS created_at
     FROM t156_analysis_run ORDER BY created_at DESC,run_id LIMIT ?`, [boundedLimit(limit, 1000)],
  );
  return rows(found).map(r => canonical({ ...r }));
}
