/** Public metadata/snippets from immutable operating captures, for shadow context only. */
import { createHash } from 'node:crypto';
import { getPool } from '@/lib/db';
import type { ArchiveQueryable } from '@/lib/analysis-data/types';
import type { M40Evidence } from './advisory';

const MAX_EVIDENCE = 6;
const MAX_ITEM_CHARACTERS = 12_000;
const MAX_TOTAL_CHARACTERS = 64_000;
const MAX_SCANNED_VERSIONS = 256;
const UTC = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?Z$/;
type ObjectRow = Record<string, unknown>;
interface StoredRow extends ObjectRow {
  record_type: string;
  record_key: string;
  available_at: string | null;
  payload_json: unknown;
  dataset_status: string;
  dataset_kind: string;
}

function object(value: unknown): ObjectRow | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectRow : null;
}
function utc(value: unknown): string | null {
  if (typeof value !== 'string' || !UTC.test(value) || !Number.isFinite(Date.parse(value))) return null;
  const day = value.slice(0, 10);
  if (new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) return null;
  return `${value.slice(0, 19)}.${value.slice(19, -1).replace(/^\./, '').padEnd(6, '0')}Z`;
}
function shift(value: string, milliseconds: number): string {
  return new Date(Date.parse(`${value.slice(0, 19)}Z`) + milliseconds).toISOString().slice(0, 19) + value.slice(19);
}
function sourceClock(source: ObjectRow, clocks: ObjectRow, name: string): string | null {
  const original = source[name];
  if (typeof original !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(original)) return null;
  const native = utc(original.replace(' ', 'T') + 'Z');
  const normalized = utc(clocks[name]);
  return native && normalized && shift(native, -9 * 3600_000) === normalized ? normalized : null;
}
function url(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048 || /\s/.test(value)) return null;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    parsed.hash = '';
    return parsed.href;
  } catch { return null; }
}
function field(value: unknown, limit: number): string | null {
  return typeof value === 'string' && value.trim() && value.length <= limit ? value : null;
}
function excerpt(content: string, budget: number): string {
  if (content.length <= budget) return content;
  const suffix = '\n[Context excerpt truncated; remainder omitted.]';
  return content.slice(0, Math.max(0, budget - suffix.length)) + suffix;
}
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

function parse(row: StoredRow, cutoff: string, start: string): M40Evidence | null {
  if (row.dataset_status !== 'published' || row.dataset_kind !== 'operating_incremental_capture') return null;
  let parsed: unknown;
  try { parsed = typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) : row.payload_json; }
  catch { return null; }
  const payload = object(parsed);
  const source = object(payload?.sourceRow), clocks = object(payload?.clocksUtc);
  if (!payload || !source || !clocks || payload.schemaVersion !== 1 || payload.sourceClockZone !== 'Asia/Seoul'
    || payload.liveEligible !== false
    || typeof payload.versionSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(payload.versionSha256)) return null;
  const sec = row.record_type === 'operating_sec_filing';
  if (sec ? payload.sourceTable !== 'us_filings'
    : row.record_type !== 'operating_corporate_item' || payload.sourceTable !== 'ci_raw_item') return null;
  if (!sec && (source.availability !== 'captured' || !['rss', 'sec_filing', 'sec_exhibit'].includes(String(source.source_kind)))) return null;
  const publishedAt = sourceClock(source, clocks, sec ? 'accepted_at' : 'published_at');
  const observedAt = sourceClock(source, clocks, sec ? 'created_at' : 'first_seen_at');
  const updatedAt = sourceClock(source, clocks, sec ? 'updated_at' : 'last_seen_at');
  const recordAvailable = utc(row.available_at), payloadAvailable = utc(payload.availableAt);
  if (!publishedAt || !observedAt || !updatedAt || !recordAvailable || !payloadAvailable
    || recordAvailable !== payloadAvailable || publishedAt < start || publishedAt > cutoff) return null;
  const sourceAvailable = [publishedAt, observedAt, updatedAt].sort().at(-1)!;
  if (sourceAvailable > recordAvailable || recordAvailable > cutoff) return null;
  const sourceUrl = url(source[sec ? 'primary_doc_url' : 'url']);
  const identifier = field(source[sec ? 'accession' : 'raw_id'], 80);
  if (!sourceUrl || !identifier) return null;
  let content: string;
  let storedSnippet: string | null = null;
  if (sec) {
    const form = field(source.form, 32), cik = field(source.cik, 24);
    if (!form || !cik || !/^\d+$/.test(cik)) return null;
    content = '[Operating archive; research-only shadow context; SEC metadata only; filing body unavailable. '
      + 'CIK-to-symbol mapping unavailable. Material-event classification is not asserted.]\n'
      + `Form: ${form}\nAccession: ${identifier}\nCIK: ${cik}\nItems: ${field(source.items, 128) ?? '(not supplied)'}\n`;
  } else {
    const title = field(source.title, 400);
    if (!title) return null;
    storedSnippet = field(source.snippet, 128_000);
    content = '[Operating archive; research-only shadow context; news metadata'
      + (storedSnippet ? ' and stored snippet only; full article body unavailable. ' : ' only; article body unavailable. ')
      + 'Symbol mapping unavailable. Material-event classification is not asserted.]\n'
      + `Title: ${title}\n`;
  }
  content += `Original publication/acceptance UTC: ${publishedAt}\nFirst observed UTC: ${observedAt}\n`
    + `Latest row observation/update UTC: ${updatedAt}\nAvailable UTC: ${recordAvailable}`;
  if (!sec) content += storedSnippet ? `\nStored snippet: ${storedSnippet}` : '\nStored snippet: unavailable';
  const idHash = createHash('sha256').update(JSON.stringify([
    row.record_type, identifier, source.content_sha256 ?? null, payload.versionSha256, recordAvailable, sourceUrl,
  ])).digest('hex');
  return { id: `operating:${sec ? 'sec' : 'item'}:${idHash}`,
    kind: sec || ['sec_filing', 'sec_exhibit'].includes(String(source.source_kind)) ? 'sec' : 'news',
    publishedAt, observedAt, availableAt: recordAvailable, sourceUrl, content: excerpt(content, MAX_ITEM_CHARACTERS) };
}

/**
 * Query only published generic archive rows. Dates of source publication and
 * local observation stay distinct; an old article newly archived is not new news.
 * No source-row internals, credentials, URLs with userinfo, or inferred symbols
 * enter model context. The caller must pass the frozen analysis decisionTime.
 */
export async function readOperatingM40Evidence(cutoff: string, db: ArchiveQueryable = getPool()): Promise<M40Evidence[]> {
  const through = utc(cutoff);
  if (!through) throw new Error('invalid_cutoff');
  const start = shift(through, -14 * 86400_000);
  const publication = `JSON_UNQUOTE(JSON_EXTRACT(r.payload_json,CASE WHEN r.record_type='operating_sec_filing'
    THEN '$.clocksUtc.accepted_at' ELSE '$.clocksUtc.published_at' END))`;
  const [rows] = await db.query<StoredRow[]>(
    `SELECT r.record_type,r.record_key,DATE_FORMAT(r.available_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS available_at,
      r.payload_json,d.status AS dataset_status,d.kind AS dataset_kind
     FROM t156_record r JOIN t156_dataset d ON d.id=r.dataset_id
     WHERE d.status='published' AND d.kind='operating_incremental_capture'
      AND r.record_type IN ('operating_sec_filing','operating_corporate_item')
      AND r.available_at IS NOT NULL AND r.available_at<=?
      AND ${publication}>=? AND ${publication}<=?
     ORDER BY r.available_at DESC,r.record_key,r.dataset_id LIMIT ?`,
    [through.slice(0, -1).replace('T', ' '), start, through, MAX_SCANNED_VERSIONS],
  );
  const eligible: M40Evidence[] = [];
  for (const row of rows) {
    try { const evidence = parse(row, through, start); if (evidence) eligible.push(evidence); }
    catch { /* A malformed optional source cannot discard other eligible sources. */ }
  }
  eligible.sort((a, b) => compare(b.availableAt, a.availableAt) || compare(b.publishedAt, a.publishedAt)
    || compare(a.sourceUrl, b.sourceUrl) || compare(a.id, b.id));
  const seen = new Set<string>(), result: M40Evidence[] = [];
  let characters = 0;
  for (const evidence of eligible) {
    if (seen.has(evidence.sourceUrl)) continue;
    seen.add(evidence.sourceUrl);
    const content = excerpt(evidence.content, Math.min(MAX_ITEM_CHARACTERS, MAX_TOTAL_CHARACTERS - characters));
    result.push({ ...evidence, content });
    characters += content.length;
    if (result.length === MAX_EVIDENCE || characters >= MAX_TOTAL_CHARACTERS) break;
  }
  return result;
}
