/**
 * Preserve newly observed operating collector rows without calling a collector,
 * changing its tables, or promoting unqualified prices into live strategy data.
 *
 * Clock contracts: T-070 fetched_at, T-059 accepted/created/updated_at, and
 * T-116 published/first_seen/last_seen_at are KST DATETIME wall clocks. DATE
 * columns are preserved as dates and never converted into availability clocks.
 */
import { getPool } from '@/lib/db';
import { canonicalJson, jsonSha256, publishDataset, putDataset, putRecord, sha256, utcSql } from './store';
import type { ArchiveQueryable, ArchiveRecord, JsonValue } from './types';

export const OPERATING_CAPTURE_POLICY = 't156-operating-capture-v1';
export const OPERATING_CAPTURE_MAX_ROWS = 1500;
export const OPERATING_CAPTURE_SOURCES = ['daily_bars', 'us_filings', 'ci_raw_item'] as const;
export type OperatingCaptureSource = typeof OPERATING_CAPTURE_SOURCES[number];

export interface OperatingCaptureOptions { cutoff?: string; limit?: number }
export interface OperatingCaptureSourceResult {
  source: OperatingCaptureSource;
  status: 'published' | 'empty' | 'failed';
  datasetId: string | null;
  rowCount: number;
  excludedCount: number;
  unknownAvailabilityCount: number;
  /** Includes reaching a row cap: completeness beyond the cap is unproven. */
  partial: boolean;
  errorCode?: string;
  failureDatasetId?: string;
}
export interface OperatingCaptureResult {
  cutoff: string;
  windowStart: string;
  status: 'complete' | 'partial';
  sources: OperatingCaptureSourceResult[];
}

type Row = Record<string, unknown>;
type Fields = readonly (readonly [string, string])[];
interface SourceSpec {
  source: OperatingCaptureSource;
  recordType: string;
  fields: Fields;
  scope: string;
  guards: string;
  dateFallback: string | null;
  order: string;
  clocks: readonly string[];
}
const date = (column: string): string => `DATE_FORMAT(s.${column},'%Y-%m-%d')`;
const clock = (column: string): string => `DATE_FORMAT(s.${column},'%Y-%m-%d %H:%i:%s.%f')`;
const text = (column: string): string => `CAST(s.\`${column}\` AS CHAR)`;
const raw = (column: string): readonly [string, string] => [column, `s.\`${column}\``];
const decimal = (column: string): readonly [string, string] => [column, text(column)];
const dated = (column: string): readonly [string, string] => [column, date(column)];
const timed = (column: string): readonly [string, string] => [column, clock(column)];
/** Rotate COALESCE fallbacks so GREATEST ignores nulls without inventing a clock. */
const latestClock = (columns: readonly string[]): string => `GREATEST(${columns.map((_, index) =>
  `COALESCE(${[...columns.slice(index), ...columns.slice(0, index)].map(column => `s.${column}`).join(',')})`).join(',')})`;

// All source names, columns and source-side predicates are closed constants.
// No option can select a table, column, condition, or write target.
const SPECS: readonly SourceSpec[] = [
  {
    source: 'daily_bars', recordType: 'operating_daily_bar',
    fields: [raw('market'), raw('symbol'), dated('trade_date'),
      ...['open', 'high', 'low', 'close', 'volume', 'turnover'].map(decimal),
      raw('currency'), raw('adj_mode'), decimal('is_final'), raw('flags'), raw('source'), timed('fetched_at')],
    scope: 's.fetched_at', guards: '', dateFallback: 's.trade_date',
    order: 's.fetched_at DESC,s.trade_date DESC,s.market,s.symbol', clocks: ['fetched_at'],
  },
  {
    source: 'us_filings', recordType: 'operating_sec_filing',
    fields: [raw('accession'), decimal('cik'), raw('form'), raw('items'), dated('report_date'), dated('filed'),
      timed('accepted_at'), raw('primary_doc_url'), decimal('is_earnings_release'), timed('created_at'), timed('updated_at')],
    scope: latestClock(['accepted_at', 'created_at', 'updated_at']),
    guards: 'AND (s.created_at IS NULL OR s.created_at<=?) AND (s.updated_at IS NULL OR s.updated_at<=?)',
    dateFallback: 's.filed', order: 's.updated_at DESC,s.created_at DESC,s.accession',
    clocks: ['accepted_at', 'created_at', 'updated_at'],
  },
  {
    source: 'ci_raw_item', recordType: 'operating_corporate_item',
    fields: [decimal('raw_id'), raw('source_kind'), raw('source_key'), decimal('version'), raw('content_sha256'),
      raw('availability'), timed('published_at'), timed('first_seen_at'), timed('last_seen_at'),
      raw('url'), raw('guid'), raw('feed_host'), raw('publisher'), raw('title'), raw('snippet'), raw('payload_ref'),
      raw('parser_version'), decimal('run_id')],
    scope: latestClock(['published_at', 'first_seen_at', 'last_seen_at']),
    guards: 'AND (s.first_seen_at IS NULL OR s.first_seen_at<=?) AND (s.last_seen_at IS NULL OR s.last_seen_at<=?)',
    dateFallback: null, order: 's.last_seen_at DESC,s.first_seen_at DESC,s.raw_id',
    clocks: ['published_at', 'first_seen_at', 'last_seen_at'],
  },
];

/** Explicit UTC, six-digit precision: lexicographic comparison remains exact. */
function utc(value: string): string {
  utcSql(value);
  const fraction = value.slice(19, -1).replace(/^\./, '');
  return `${value.slice(0, 19)}.${fraction.padEnd(6, '0')}Z`;
}
function shiftUtc(value: string, milliseconds: number): string {
  return new Date(Date.parse(`${value.slice(0, 19)}Z`) + milliseconds).toISOString().slice(0, 19) + value.slice(19);
}
function kstSql(value: string): string { return shiftUtc(value, 9 * 3600_000).slice(0, -1).replace('T', ' '); }
function fromKst(value: JsonValue): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(value)) {
    throw new Error('source_row_invalid');
  }
  return shiftUtc(utc(value.replace(' ', 'T') + 'Z'), -9 * 3600_000);
}
function maxTime(values: readonly (string | null)[]): string | null {
  const known = values.filter((value): value is string => value !== null);
  return known.length === values.length ? known.sort().at(-1)! : null;
}
function latestKnownTime(values: readonly (string | null)[]): string | null {
  return values.filter((value): value is string => value !== null).sort().at(-1) ?? null;
}
function sourceRow(row: Row, spec: SourceSpec): { [key: string]: JsonValue } {
  const result: { [key: string]: JsonValue } = {};
  for (const [name] of spec.fields) {
    const value = row[name];
    // SQL casts all numeric fields to CHAR: do not introduce IEEE-754 loss.
    if (value !== null && typeof value !== 'string') throw new Error('source_row_invalid');
    result[name] = value;
  }
  return result;
}

function versionExpression(spec: SourceSpec): string {
  return `CAST(JSON_ARRAY('${OPERATING_CAPTURE_POLICY}','${spec.source}',${spec.fields.map(([, expression]) => expression).join(',')}) AS CHAR)`;
}
function selectSql(spec: SourceSpec): string {
  const version = versionExpression(spec);
  const scope = `${spec.scope}>=? AND ${spec.scope}<=?`;
  const fallback = spec.dateFallback ? ` OR (${spec.scope} IS NULL AND ${spec.dateFallback}>=? AND ${spec.dateFallback}<=?)` : '';
  return `SELECT ${spec.fields.map(([name, expression]) => `${expression} AS \`${name}\``).join(',')},
    ${version} AS capture_version_json
    FROM ${spec.source} s WHERE ((${scope})${fallback}) ${spec.guards}
    AND NOT EXISTS (
      SELECT 1 FROM t156_record r JOIN t156_dataset d ON d.id=r.dataset_id
      WHERE d.status='published' AND r.record_type='${spec.recordType}'
        AND r.record_key=CONCAT('v1:${spec.source}:',SHA2(${version},256)))
    ORDER BY ${spec.order} LIMIT ?`;
}

function prepareRecord(row: Row, spec: SourceSpec, cutoff: string, windowStart: string): Omit<ArchiveRecord, 'datasetId'> | null {
  const original = sourceRow(row, spec);
  if (typeof row.capture_version_json !== 'string') throw new Error('source_row_invalid');
  let version: unknown;
  try { version = JSON.parse(row.capture_version_json); } catch { throw new Error('source_row_invalid'); }
  const expected: JsonValue = [OPERATING_CAPTURE_POLICY, spec.source, ...spec.fields.map(([field]) => original[field])];
  if (canonicalJson(version as JsonValue) !== canonicalJson(expected)) throw new Error('source_row_invalid');
  const clocks = Object.fromEntries(spec.clocks.map(name => [name, fromKst(original[name])])) as Record<string, string | null>;
  // Also defend the boundary independently of the source-side SQL.
  if (Object.values(clocks).some(value => value !== null && value > cutoff)) return null;
  // The archive tracks newly observed/updated rows. Publication recency is a
  // separate agent-evidence gate and must not discard newly captured old text.
  const scope = latestKnownTime(Object.values(clocks));
  const sessionDate = spec.source === 'daily_bars' ? original.trade_date as string : null;
  const fallbackDate = spec.source === 'daily_bars' ? original.trade_date : spec.source === 'us_filings' ? original.filed : null;
  if (scope !== null ? scope < windowStart || scope > cutoff
    : typeof fallbackDate !== 'string' || fallbackDate < windowStart.slice(0, 10) || fallbackDate > cutoff.slice(0, 10)) return null;
  const availableAt = spec.source === 'daily_bars' ? clocks.fetched_at
    : spec.source === 'us_filings' ? maxTime([clocks.accepted_at, clocks.created_at, clocks.updated_at])
      : original.availability === 'captured' ? maxTime([clocks.published_at, clocks.first_seen_at, clocks.last_seen_at]) : null;
  const priceBasis = spec.source === 'daily_bars' ? original.adj_mode === 'raw' ? 'raw' : 'unknown_adjusted' : null;
  const versionSha256 = sha256(row.capture_version_json);
  return {
    recordType: spec.recordType, recordKey: `v1:${spec.source}:${versionSha256}`, sessionDate,
    symbol: spec.source === 'daily_bars' ? original.symbol as string : null, availableAt,
    payload: {
      schemaVersion: 1, sourceTable: spec.source, sourceRow: original, versionSha256,
      sourceVersionJson: row.capture_version_json, sourceClockZone: 'Asia/Seoul',
      clocksUtc: clocks, availableAt, priceBasis, liveEligible: false,
      bodyCoverage: spec.source === 'daily_bars' ? 'not_applicable'
        : spec.source === 'us_filings' ? 'metadata_only_no_document_body'
          : original.snippet === null ? 'metadata_only_no_article_body' : 'snippet_only_no_article_body',
    },
  };
}

async function verifyRecords(datasetId: string, records: readonly ArchiveRecord[], db: ArchiveQueryable): Promise<void> {
  const [found] = await db.query<Row[]>(
    'SELECT record_key,content_sha256 FROM t156_record WHERE dataset_id=? ORDER BY record_key', [datasetId],
  );
  const hashes = new Map(records.map(record => [record.recordKey, jsonSha256(record.payload)]));
  if (!Array.isArray(found) || found.length !== records.length || new Set(found.map(row => row.record_key)).size !== found.length
    || found.some(row => typeof row.record_key !== 'string' || hashes.get(row.record_key) !== row.content_sha256)) {
    throw new Error('archive_verification_failed');
  }
}

async function recordFailure(source: OperatingCaptureSource, errorCode: string, cutoff: string, startedAt: string, db: ArchiveQueryable): Promise<string> {
  const payload: JsonValue = { policy: OPERATING_CAPTURE_POLICY, source, errorCode, requestedCutoff: cutoff,
    attemptedAt: startedAt, status: 'failed', liveEligible: false };
  const hash = jsonSha256(payload);
  const datasetId = `op-status-${source}-${hash}`;
  const record: ArchiveRecord = { datasetId, recordType: 'operating_capture_status', recordKey: `v1:${source}:${hash}`,
    sessionDate: null, symbol: null, availableAt: startedAt, payload };
  await putDataset({ id: datasetId, kind: 'operating_capture_failure', sourceKey: `operating-db:${source}:v1`,
    contentSha256: hash, metadata: payload, createdAt: startedAt }, db);
  await putRecord(record, db);
  await verifyRecords(datasetId, [record], db);
  await publishDataset(datasetId, { rowCount: 1, liveEligible: false }, db);
  return datasetId;
}

/**
 * limit bounds TOTAL archived source rows (3..1500), divided across the three
 * collectors. A capped source is explicitly partial; subsequent calls skip
 * published versions before applying LIMIT and therefore continue the backlog.
 */
export async function captureOperatingData(options: OperatingCaptureOptions = {}, injectedDb?: ArchiveQueryable): Promise<OperatingCaptureResult> {
  const startedAt = utc(new Date().toISOString());
  const cutoff = utc(options.cutoff ?? startedAt);
  const limit = options.limit ?? OPERATING_CAPTURE_MAX_ROWS;
  if (cutoff > startedAt) throw new Error('invalid_capture_cutoff');
  if (!Number.isInteger(limit) || limit < SPECS.length || limit > OPERATING_CAPTURE_MAX_ROWS) throw new Error('invalid_capture_limit');
  const windowStart = shiftUtc(cutoff, -14 * 86400_000);
  const db = injectedDb ?? getPool() as unknown as ArchiveQueryable;
  const results: OperatingCaptureSourceResult[] = [];
  for (const [index, spec] of SPECS.entries()) {
    const budget = Math.floor(limit / SPECS.length) + (index < limit % SPECS.length ? 1 : 0);
    const summary: OperatingCaptureSourceResult = { source: spec.source, status: 'empty', datasetId: null,
      rowCount: 0, excludedCount: 0, unknownAvailabilityCount: 0, partial: false };
    let phase = 'source_query_failed';
    try {
      const params: unknown[] = [kstSql(windowStart), kstSql(cutoff)];
      if (spec.dateFallback) params.push(windowStart.slice(0, 10), cutoff.slice(0, 10));
      if (spec.guards) params.push(kstSql(cutoff), kstSql(cutoff));
      params.push(budget);
      const [selected] = await db.query<Row[]>(selectSql(spec), params);
      if (!Array.isArray(selected) || selected.length > budget) throw new Error('source_row_invalid');
      phase = 'source_row_invalid';
      const prepared = selected.map(row => prepareRecord(row, spec, cutoff, windowStart)).filter((row): row is Omit<ArchiveRecord, 'datasetId'> => row !== null);
      summary.excludedCount = selected.length - prepared.length;
      summary.unknownAvailabilityCount = prepared.filter(row => row.availableAt === null).length;
      summary.partial = selected.length === budget || summary.excludedCount > 0 || summary.unknownAvailabilityCount > 0;
      if (prepared.length) {
        const batch: JsonValue = { policy: OPERATING_CAPTURE_POLICY, source: spec.source, cutoff, windowStart, budget,
          windowBasis: 'latest_known_source_clock',
          partial: summary.partial, rows: prepared.map(row => ({ key: row.recordKey, sha256: jsonSha256(row.payload) })) };
        const batchHash = jsonSha256(batch);
        const datasetId = `op-v1-${spec.source}-${batchHash}`;
        const records: ArchiveRecord[] = prepared.map(row => ({ ...row, datasetId }));
        phase = 'archive_write_failed';
        await putDataset({ id: datasetId, kind: 'operating_incremental_capture', sourceKey: `operating-db:${spec.source}:v1`,
          contentSha256: batchHash, metadata: { selection: batch, researchOnly: true, liveEligible: false,
            unknownAvailabilityCount: summary.unknownAvailabilityCount, adjustedType: 'unverified_if_adjusted' }, createdAt: startedAt }, db);
        for (const record of records) await putRecord(record, db);
        phase = 'archive_verification_failed';
        await verifyRecords(datasetId, records, db);
        await publishDataset(datasetId, { rowCount: records.length, liveEligible: false }, db);
        summary.status = 'published';
        summary.datasetId = datasetId;
        summary.rowCount = records.length;
      }
    } catch {
      summary.status = 'failed';
      summary.partial = true;
      summary.errorCode = phase;
      try { summary.failureDatasetId = await recordFailure(spec.source, phase, cutoff, startedAt, db); }
      catch { /* The result still exposes the independent failure if archive storage is unavailable. */ }
    }
    results.push(summary);
  }
  return { cutoff, windowStart, status: results.some(result => result.partial) ? 'partial' : 'complete', sources: results };
}
