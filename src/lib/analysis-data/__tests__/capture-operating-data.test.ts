import { captureOperatingData, OPERATING_CAPTURE_POLICY, type OperatingCaptureSource } from '../capture-operating-data';
import { jsonSha256, sha256 } from '../store';
import type { ArchiveQueryable } from '../types';
import { validateEvidence } from '../../strategy/m40/advisory';

jest.mock('@/lib/db', () => ({ getPool: jest.fn(() => { throw new Error('unexpected_real_database'); }) }));

type Row = Record<string, unknown>;
type Dataset = Row & { status: string; row_count: number; live_eligible: boolean };
type RecordRow = Row & { dataset_id: string; record_type: string; record_key: string };

/** Stateful SQL fake exercises the real named immutable-store APIs. */
class CaptureDb implements ArchiveQueryable {
  sourceRows: Record<OperatingCaptureSource, Row[]> = { daily_bars: [], us_filings: [], ci_raw_item: [] };
  datasets = new Map<string, Dataset>();
  records = new Map<string, RecordRow>();
  calls: { sql: string; values: unknown[] }[] = [];
  failSources = new Set<OperatingCaptureSource>();
  corruptVerification = false;
  verifiedIds = new Set<string>();
  inTransaction = false;
  private beforeTransaction: { datasets: Map<string, Dataset>; records: Map<string, RecordRow> } | null = null;
  async beginTransaction(): Promise<void> {
    if (this.inTransaction) throw new Error('nested_fake_transaction');
    this.beforeTransaction = { datasets: new Map([...this.datasets].map(([key, row]) => [key, { ...row }])),
      records: new Map([...this.records].map(([key, row]) => [key, { ...row }])) };
    this.inTransaction = true;
  }
  async commit(): Promise<void> { this.inTransaction = false; this.beforeTransaction = null; }
  async rollback(): Promise<void> {
    if (this.beforeTransaction) { this.datasets = this.beforeTransaction.datasets; this.records = this.beforeTransaction.records; }
    this.inTransaction = false;
    this.beforeTransaction = null;
  }
  async query<T = unknown>(sql: string, values: unknown[] = []): Promise<[T, unknown]> {
    this.calls.push({ sql, values });
    const [a, b, c, d, e, f, g, h] = values;
    let result: unknown;
    const source = /FROM (daily_bars|us_filings|ci_raw_item) s/.exec(sql)?.[1] as OperatingCaptureSource | undefined;
    if (sql === 'SELECT @@in_transaction AS active_transaction') {
      result = [{ active_transaction: this.inTransaction ? 1 : 0 }];
    } else if (sql === 'SELECT status FROM t156_dataset WHERE id=? FOR UPDATE') {
      if (!this.inTransaction) throw new Error('dataset_lock_without_transaction');
      result = this.datasets.has(String(a)) ? [{ status: this.datasets.get(String(a))!.status }] : [];
    } else if (source) {
      if (this.failSources.has(source)) throw new Error('database failed password=never_store_this');
      // Match the source query's published-version anti-join before LIMIT.
      result = this.sourceRows[source].filter(row => {
        const key = `v1:${source}:${sha256(String(row.capture_version_json))}`;
        return ![...this.records.values()].some(record => record.record_key === key
          && this.datasets.get(record.dataset_id)?.status === 'published');
      }).slice(0, Number(values.at(-1)));
    } else if (sql.startsWith('INSERT INTO t156_dataset')) {
      if (!this.datasets.has(String(a))) this.datasets.set(String(a), {
        id: a, kind: b, source_key: c, content_sha256: d, metadata_json: e, created_at: f,
        status: 'staged', row_count: 0, live_eligible: false,
      });
      result = {};
    } else if (sql.startsWith('SELECT kind,source_key')) {
      result = this.datasets.has(String(a)) ? [this.datasets.get(String(a))] : [];
    } else if (sql.startsWith('INSERT INTO t156_record')) {
      const key = `${a}:${b}:${c}`;
      if (!this.records.has(key) && this.datasets.get(String(a))?.status === 'staged') {
        this.records.set(key, { dataset_id: String(a), record_type: String(b), record_key: String(c),
          session_date: d, symbol: e, available_at_utc: f === null ? null : String(f).replace(' ', 'T') + 'Z',
          payload_json: g, content_sha256: h });
      }
      result = {};
    } else if (sql.startsWith('SELECT DATE_FORMAT(session_date')) {
      const row = this.records.get(`${a}:${b}:${c}`); result = row ? [row] : [];
    } else if (sql.startsWith('SELECT record_key,content_sha256')) {
      const found = [...this.records.values()].filter(row => row.dataset_id === a);
      this.verifiedIds.add(String(a));
      result = found.map(row => ({ record_key: row.record_key,
        content_sha256: this.corruptVerification && String(a).startsWith('op-v1-') ? '0'.repeat(64) : row.content_sha256 }));
    } else if (sql.startsWith('SELECT COUNT(*) AS n')) {
      const found = [...this.records.values()].filter(row => row.dataset_id === a);
      result = [{ n: found.length, unknown_n: found.filter(row => row.available_at_utc === null).length }];
    } else if (sql.startsWith('UPDATE t156_dataset SET status=')) {
      if (!this.verifiedIds.has(String(c))) throw new Error('publication_before_checksum_verification');
      const row = this.datasets.get(String(c));
      if (row && ['staged', 'published'].includes(row.status)) Object.assign(row, { status: 'published', row_count: Number(a), live_eligible: Boolean(b) });
      result = {};
    } else if (sql.startsWith('SELECT status,row_count,live_eligible')) {
      result = this.datasets.has(String(a)) ? [this.datasets.get(String(a))] : [];
    } else { throw new Error(`unapproved_fake_sql:${sql.slice(0, 60)}`); }
    return [result as T, undefined];
  }
  sourceRecords(source: OperatingCaptureSource): RecordRow[] {
    return [...this.records.values()].filter(record => record.record_key.startsWith(`v1:${source}:`)
      && record.record_type !== 'operating_capture_status');
  }
  payload(record: RecordRow): Record<string, any> { return JSON.parse(String(record.payload_json)); }
}

function version(source: OperatingCaptureSource, row: Row, order: string[]): Row {
  return { ...row, capture_version_json: JSON.stringify([OPERATING_CAPTURE_POLICY, source, ...order.map(name => row[name])]) };
}
function daily(overrides: Row = {}): Row {
  const row: Row = { market: 'US', symbol: 'NAS:AAPL', trade_date: '2026-11-06', open: '123.0000', high: '125.0000', low: '122.0000',
    close: '124.1234', volume: '9007199254740993', turnover: null, currency: 'USD', adj_mode: 'adjusted',
    is_final: '1', flags: null, source: 'kis_dailyprice', fetched_at: '2026-11-07 06:30:00.000000', ...overrides };
  return version('daily_bars', row, ['market', 'symbol', 'trade_date', 'open', 'high', 'low', 'close', 'volume', 'turnover',
    'currency', 'adj_mode', 'is_final', 'flags', 'source', 'fetched_at']);
}
function filing(overrides: Row = {}): Row {
  const row: Row = { accession: '0000320193-26-000001', cik: '320193', form: '8-K', items: '2.02', report_date: '2026-11-05', filed: '2026-11-06',
    accepted_at: '2026-11-07 05:00:00.000000', primary_doc_url: 'https://www.sec.gov/Archives/example.htm',
    is_earnings_release: '1', created_at: '2026-11-07 05:01:00.000000', updated_at: '2026-11-07 05:02:00.000000', ...overrides };
  return version('us_filings', row, ['accession', 'cik', 'form', 'items', 'report_date', 'filed', 'accepted_at', 'primary_doc_url',
    'is_earnings_release', 'created_at', 'updated_at']);
}
function item(overrides: Row = {}): Row {
  const row: Row = { raw_id: '9007199254740995', source_kind: 'rss', source_key: 'a'.repeat(64), version: '1', content_sha256: 'c'.repeat(64),
    availability: 'captured', published_at: '2026-11-07 06:00:00.000000', first_seen_at: '2026-11-07 06:01:00.000000',
    last_seen_at: '2026-11-07 06:10:00.000000', url: 'https://example.com/article', guid: 'guid-original', feed_host: 'example.com',
    publisher: null, title: 'Original title', snippet: null, payload_ref: null, parser_version: 'rss-v1', run_id: null, ...overrides };
  return version('ci_raw_item', row, ['raw_id', 'source_kind', 'source_key', 'version', 'content_sha256', 'availability', 'published_at',
    'first_seen_at', 'last_seen_at', 'url', 'guid', 'feed_host', 'publisher', 'title', 'snippet', 'payload_ref', 'parser_version', 'run_id']);
}
const cutoff = '2026-11-08T00:00:00Z';

beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-11-08T01:00:00Z')); });
afterEach(() => { jest.useRealTimers(); });

describe('operating collector incremental research capture', () => {
  test('preserves precise source decimals, raw price mode, KST clocks and source identity without live promotion', async () => {
    const db = new CaptureDb();
    db.sourceRows.daily_bars = [daily(), daily({ symbol: 'NYS:IBM', adj_mode: 'raw', is_final: '0', flags: 'zero_volume' })];
    db.sourceRows.us_filings = [filing()];
    db.sourceRows.ci_raw_item = [item()];
    const result = await captureOperatingData({ cutoff }, db);
    expect(result.status).toBe('complete');
    expect(result.sources.map(source => source.rowCount)).toEqual([2, 1, 1]);
    const prices = db.sourceRecords('daily_bars').map(record => db.payload(record));
    expect(prices[0].sourceRow).toMatchObject({ close: '124.1234', volume: '9007199254740993', fetched_at: '2026-11-07 06:30:00.000000', adj_mode: 'adjusted' });
    expect(prices[0]).toMatchObject({ priceBasis: 'unknown_adjusted', availableAt: '2026-11-06T21:30:00.000000Z' });
    expect(prices[1]).toMatchObject({ priceBasis: 'raw', sourceRow: { adj_mode: 'raw', is_final: '0', flags: 'zero_volume' } });
    const sec = db.payload(db.sourceRecords('us_filings')[0]);
    expect(sec).toMatchObject({ availableAt: '2026-11-06T20:02:00.000000Z', bodyCoverage: 'metadata_only_no_document_body',
      clocksUtc: { accepted_at: '2026-11-06T20:00:00.000000Z', created_at: '2026-11-06T20:01:00.000000Z' } });
    const news = db.payload(db.sourceRecords('ci_raw_item')[0]);
    expect(news).toMatchObject({ availableAt: '2026-11-06T21:10:00.000000Z', sourceRow: { guid: 'guid-original', first_seen_at: '2026-11-07 06:01:00.000000' } });
    expect([...db.datasets.values()].every(dataset => dataset.status === 'published' && dataset.live_eligible === false)).toBe(true);
    for (const record of db.records.values()) expect(record.content_sha256).toBe(jsonSha256(db.payload(record)));
  });

  test('repeated capture skips published versions before LIMIT and appends changed versions without overwriting', async () => {
    const db = new CaptureDb();
    db.sourceRows.daily_bars = [daily()];
    await captureOperatingData({ cutoff }, db);
    const original = [...db.records.values()].map(record => JSON.stringify(record));
    const replay = await captureOperatingData({ cutoff }, db);
    expect(replay.sources.every(source => source.status === 'empty')).toBe(true);
    db.sourceRows.daily_bars = [daily({ close: '124.9999' })];
    await captureOperatingData({ cutoff }, db);
    expect(db.sourceRecords('daily_bars')).toHaveLength(2);
    expect([...db.records.values()].slice(0, original.length).map(record => JSON.stringify(record))).toEqual(original);
    expect(new Set(db.sourceRecords('daily_bars').map(record => record.record_key)).size).toBe(2);
  });

  test('ASCII binary key comparison preserves the UTF-8 source version hash and deduplicates non-ASCII news', async () => {
    const db = new CaptureDb();
    const unicode = item({ title: '분기 실적 🧾', snippet: '매출 변화：＋３％' });
    const sourceVersion = String(unicode.capture_version_json);
    const expectedKey = `v1:ci_raw_item:${sha256(sourceVersion)}`;
    expect(sha256(sourceVersion)).not.toBe(sha256(Buffer.from(sourceVersion, 'ascii')));
    db.sourceRows.daily_bars = [daily()];
    db.sourceRows.us_filings = [filing()];
    db.sourceRows.ci_raw_item = [unicode];
    const result = await captureOperatingData({ cutoff }, db);
    expect(result.sources.map(source => source.status)).toEqual(['published', 'published', 'published']);
    const archived = db.sourceRecords('ci_raw_item')[0];
    expect(archived.record_key).toBe(expectedKey);
    expect(db.payload(archived)).toMatchObject({ sourceVersionJson: sourceVersion,
      sourceRow: { title: '분기 실적 🧾', snippet: '매출 변화：＋３％' } });
    const reads = db.calls.filter(call => /FROM (daily_bars|us_filings|ci_raw_item) s/.test(call.sql));
    expect(reads).toHaveLength(3);
    expect(reads.every(call => call.sql.includes('r.record_key=CONVERT(CONCAT('))).toBe(true);
    expect(reads.every(call => call.sql.includes(',256)) USING ascii) COLLATE ascii_bin)'))).toBe(true);
    const replay = await captureOperatingData({ cutoff }, db);
    expect(replay.sources.every(source => source.status === 'empty')).toBe(true);
    expect(db.sourceRecords('ci_raw_item')).toHaveLength(1);
  });

  test('new last-seen observations retain the first-seen proof and both immutable versions', async () => {
    const db = new CaptureDb(); db.sourceRows.ci_raw_item = [item()];
    await captureOperatingData({ cutoff }, db);
    db.sourceRows.ci_raw_item = [item({ last_seen_at: '2026-11-07 07:00:00.000000' })];
    await captureOperatingData({ cutoff }, db);
    expect(db.sourceRecords('ci_raw_item')).toHaveLength(2);
    expect(db.sourceRecords('ci_raw_item').map(record => db.payload(record).sourceRow.first_seen_at))
      .toEqual(['2026-11-07 06:01:00.000000', '2026-11-07 06:01:00.000000']);
  });

  test('missing collection/publication/first-seen clocks stay null and never become DATE midnights', async () => {
    const db = new CaptureDb();
    db.sourceRows.daily_bars = [daily({ fetched_at: null })];
    db.sourceRows.us_filings = [filing({ accepted_at: null })];
    db.sourceRows.ci_raw_item = [item({ first_seen_at: null })];
    const result = await captureOperatingData({ cutoff }, db);
    expect(result.status).toBe('partial');
    expect(result.sources.map(source => source.unknownAvailabilityCount)).toEqual([1, 1, 1]);
    expect([...db.records.values()].every(record => record.available_at_utc === null)).toBe(true);
    expect(db.payload(db.sourceRecords('daily_bars')[0]).clocksUtc.fetched_at).toBeNull();
    expect(db.payload(db.sourceRecords('us_filings')[0]).sourceRow.filed).toBe('2026-11-06');
  });

  test('historical/reconstructed item classifications are retained without claiming contemporary availability', async () => {
    const db = new CaptureDb();
    db.sourceRows.ci_raw_item = [item({ availability: 'historical_import', snippet: 'Permitted excerpt', payload_ref: 'external-ref' })];
    await captureOperatingData({ cutoff }, db);
    const record = db.sourceRecords('ci_raw_item')[0];
    expect(record.available_at_utc).toBeNull();
    expect(db.payload(record)).toMatchObject({ bodyCoverage: 'snippet_only_no_article_body',
      sourceRow: { availability: 'historical_import', snippet: 'Permitted excerpt', payload_ref: 'external-ref' } });
  });

  test('enforces the inclusive fourteen-day boundary and exact cutoff, including microseconds', async () => {
    const db = new CaptureDb();
    db.sourceRows.daily_bars = [daily({ symbol: 'NAS:EDGE', fetched_at: '2026-10-25 09:00:00.123456' }),
      daily({ symbol: 'NAS:OLD', fetched_at: '2026-10-25 09:00:00.123455' }),
      daily({ symbol: 'NAS:NOW', fetched_at: '2026-11-08 09:00:00.123456' }),
      daily({ symbol: 'NAS:FUTURE', fetched_at: '2026-11-08 09:00:00.123457' })];
    const result = await captureOperatingData({ cutoff: '2026-11-08T00:00:00.123456Z' }, db);
    expect(db.sourceRecords('daily_bars').map(record => record.symbol)).toEqual(['NAS:EDGE', 'NAS:NOW']);
    expect(result.sources[0].excludedCount).toBe(2);
    expect(result.windowStart).toBe('2026-10-25T00:00:00.123456Z');
  });

  test('newly observed 2020 news is archived while the separate fourteen-day evidence gate rejects it', async () => {
    const db = new CaptureDb();
    db.sourceRows.ci_raw_item = [item({ published_at: '2020-01-02 09:00:00.000000' })];
    const result = await captureOperatingData({ cutoff }, db);
    expect(result.sources[2]).toMatchObject({ status: 'published', rowCount: 1, excludedCount: 0, partial: false });
    const payload = db.payload(db.sourceRecords('ci_raw_item')[0]);
    expect(payload).toMatchObject({ sourceRow: { published_at: '2020-01-02 09:00:00.000000' },
      clocksUtc: { published_at: '2020-01-02T00:00:00.000000Z', first_seen_at: '2026-11-06T21:01:00.000000Z' },
      availableAt: '2026-11-06T21:10:00.000000Z' });
    expect(validateEvidence([{ id: 'old-news', kind: 'news', availableAt: payload.availableAt,
      publishedAt: payload.clocksUtc.published_at, observedAt: payload.clocksUtc.first_seen_at,
      sourceUrl: payload.sourceRow.url, content: payload.sourceRow.title }], cutoff))
      .toBe('evidence_outside_14_day_window');
  });

  test('old SEC acceptance with a recent metadata update is archived without changing publication time', async () => {
    const db = new CaptureDb();
    db.sourceRows.us_filings = [filing({ accepted_at: '2020-01-02 09:00:00.000000',
      created_at: '2020-01-02 09:01:00.000000', updated_at: '2026-11-07 05:02:00.000000', filed: '2020-01-02' })];
    const result = await captureOperatingData({ cutoff }, db);
    expect(result.sources[1]).toMatchObject({ status: 'published', rowCount: 1, excludedCount: 0 });
    expect(db.payload(db.sourceRecords('us_filings')[0])).toMatchObject({ availableAt: '2026-11-06T20:02:00.000000Z',
      clocksUtc: { accepted_at: '2020-01-02T00:00:00.000000Z', created_at: '2020-01-02T00:01:00.000000Z' },
      sourceRow: { accepted_at: '2020-01-02 09:00:00.000000', filed: '2020-01-02' } });
  });

  test('a recent known observation survives missing clocks without inventing availability', async () => {
    const db = new CaptureDb();
    db.sourceRows.us_filings = [filing({ accepted_at: null, created_at: '2020-01-02 09:00:00.000000' })];
    db.sourceRows.ci_raw_item = [item({ published_at: '2020-01-02 09:00:00.000000', last_seen_at: null })];
    const result = await captureOperatingData({ cutoff }, db);
    expect(result.sources.slice(1).map(source => source.rowCount)).toEqual([1, 1]);
    expect(result.sources.slice(1).map(source => source.unknownAvailabilityCount)).toEqual([1, 1]);
    expect(db.sourceRecords('us_filings')[0].available_at_utc).toBeNull();
    expect(db.sourceRecords('ci_raw_item')[0].available_at_utc).toBeNull();
    const queries = db.calls.filter(call => /FROM (us_filings|ci_raw_item) s/.test(call.sql));
    expect(queries.every(call => call.sql.includes('GREATEST(COALESCE('))).toBe(true);
  });

  test('future publication or acceptance is excluded even when observation clocks are recent', async () => {
    const db = new CaptureDb();
    db.sourceRows.us_filings = [filing({ accepted_at: '2026-11-09 09:00:00.000000' })];
    db.sourceRows.ci_raw_item = [item({ published_at: '2026-11-09 09:00:00.000000' })];
    const result = await captureOperatingData({ cutoff }, db);
    expect(result.sources.slice(1).map(source => source.excludedCount)).toEqual([1, 1]);
    expect(db.sourceRecords('us_filings')).toHaveLength(0);
    expect(db.sourceRecords('ci_raw_item')).toHaveLength(0);
  });

  test('splits the total budget, flags capped captures and advances the remaining backlog on the next call', async () => {
    const db = new CaptureDb();
    db.sourceRows.daily_bars = [daily({ symbol: 'NAS:AAA' }), daily({ symbol: 'NAS:BBB' }), daily({ symbol: 'NAS:CCC' })];
    const first = await captureOperatingData({ cutoff, limit: 6 }, db);
    expect(first.sources[0]).toMatchObject({ rowCount: 2, partial: true });
    const second = await captureOperatingData({ cutoff, limit: 6 }, db);
    expect(second.sources[0]).toMatchObject({ rowCount: 1, partial: false });
    expect(db.sourceRecords('daily_bars')).toHaveLength(3);
    const sourceQueries = db.calls.filter(call => /FROM (daily_bars|us_filings|ci_raw_item) s/.test(call.sql));
    expect(sourceQueries.every(call => call.values.at(-1) === 2)).toBe(true);
    expect(sourceQueries.every(call => call.sql.indexOf('NOT EXISTS') < call.sql.indexOf('LIMIT ?'))).toBe(true);
  });

  test('source query failure is independently archived with fixed codes while other collectors succeed', async () => {
    const db = new CaptureDb();
    db.failSources.add('us_filings'); db.sourceRows.daily_bars = [daily()]; db.sourceRows.ci_raw_item = [item()];
    const result = await captureOperatingData({ cutoff }, db);
    expect(result.sources.map(source => source.status)).toEqual(['published', 'failed', 'published']);
    expect(result.sources[1]).toMatchObject({ errorCode: 'source_query_failed', partial: true, failureDatasetId: expect.any(String) });
    const failure = [...db.records.values()].find(record => record.record_type === 'operating_capture_status')!;
    expect(db.payload(failure)).toMatchObject({ requestedCutoff: '2026-11-08T00:00:00.000000Z', attemptedAt: '2026-11-08T01:00:00.000000Z' });
    expect(failure.available_at_utc).toBe('2026-11-08T01:00:00.000000Z');
    expect(JSON.stringify([...db.records.values()])).not.toContain('never_store_this');
  });

  test('checksum failure leaves source dataset staged and records an independent failure without publishing it', async () => {
    const db = new CaptureDb(); db.corruptVerification = true; db.sourceRows.daily_bars = [daily()];
    const result = await captureOperatingData({ cutoff }, db);
    expect(result.sources[0]).toMatchObject({ status: 'failed', errorCode: 'archive_verification_failed' });
    const sourceDataset = [...db.datasets.values()].find(dataset => dataset.kind === 'operating_incremental_capture')!;
    expect(sourceDataset).toMatchObject({ status: 'staged', live_eligible: false, row_count: 0 });
    expect(db.sourceRecords('daily_bars')).toHaveLength(1);
  });

  test('a mismatched row-version proof fails that source before any source-row publication', async () => {
    const db = new CaptureDb(); const forged = daily(); forged.close = '999.0000'; db.sourceRows.daily_bars = [forged];
    const result = await captureOperatingData({ cutoff }, db);
    expect(result.sources[0]).toMatchObject({ status: 'failed', errorCode: 'source_row_invalid' });
    expect(db.sourceRecords('daily_bars')).toHaveLength(0);
  });

  test('SQL uses only fixed collectors and archive writes; all clocks and limits are bound', async () => {
    const db = new CaptureDb(); await captureOperatingData({ cutoff, limit: 1499 }, db);
    const sourceQueries = db.calls.filter(call => /FROM (daily_bars|us_filings|ci_raw_item) s/.test(call.sql));
    expect(sourceQueries.map(call => call.values.at(-1))).toEqual([500, 500, 499]);
    expect(sourceQueries[0].values.slice(0, 2)).toEqual(['2026-10-25 09:00:00.000000', '2026-11-08 09:00:00.000000']);
    expect(sourceQueries.every(call => !call.sql.includes(cutoff))).toBe(true);
    expect(db.calls.every(call => !/\b(orders|signals|position_state|system_config|trade_logs)\b/i.test(call.sql))).toBe(true);
    const populated = new CaptureDb(); populated.sourceRows.daily_bars = [daily()]; await captureOperatingData({ cutoff }, populated);
    const writes = populated.calls.filter(call => /^(INSERT|UPDATE)/.test(call.sql));
    expect(writes.every(call => /^(INSERT INTO|UPDATE) t156_(dataset|record)\b/.test(call.sql))).toBe(true);
  });

  test.each([0, 1, 2, 1501, 2.5])('rejects unsupported total row budget %s before database access', async limit => {
    const db = new CaptureDb(); await expect(captureOperatingData({ cutoff, limit }, db)).rejects.toThrow('invalid_capture_limit');
    expect(db.calls).toHaveLength(0);
  });

  test.each(['2026-11-09T00:00:00Z', '2026-11-08T00:00:00', '2026-02-30T00:00:00Z'])('rejects invalid/future cutoff %s', async invalid => {
    const db = new CaptureDb(); await expect(captureOperatingData({ cutoff: invalid }, db)).rejects.toThrow();
    expect(db.calls).toHaveLength(0);
  });
});
