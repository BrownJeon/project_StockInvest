/** T-156 records retain source decimal strings, nulls and source field names. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type DatasetStatus = 'staged' | 'published' | 'rejected';

export interface ArchiveQueryable {
  query<T = unknown>(sql: string, values?: unknown[]): Promise<[T, unknown]>;
  /** Writers acquire one dedicated connection; pooled query calls cannot hold a transaction. */
  getConnection?(): Promise<ArchiveTransactionConnection>;
}

/** Inject a fresh, exclusively owned connection, never an already active transaction. */
export interface ArchiveTransactionConnection extends ArchiveQueryable {
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release?(): void;
  destroy?(): void;
}

export interface AnalysisDataset {
  id: string;
  kind: string;
  sourceKey: string;
  status: DatasetStatus;
  liveEligible: boolean;
  contentSha256: string | null;
  rowCount: number;
  metadata: JsonValue;
  createdAt: string;
}

export interface ArchiveRecord {
  datasetId: string;
  recordType: string;
  recordKey: string;
  sessionDate: string | null;
  symbol?: string | null;
  /** ISO UTC instant. Null has no proven availability and is never a live input. */
  availableAt: string | null;
  payload: JsonValue;
}

export interface RecordQuery {
  datasetId: string;
  recordType: string;
  cutoff: string;
  fromSession?: string;
  throughSession?: string;
  symbol?: string;
  limit?: number;
  /** false permits published research datasets, but still excludes unknown/future availability. */
  liveOnly?: boolean;
}

export interface PriceBarPayload {
  symbol: string;
  session: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  currency: string;
  priceBasis: 'raw' | 'split_adjusted' | 'total_return' | 'index';
  final: boolean;
  identityStatus: string;
}

export interface PublishedPriceBar extends PriceBarPayload {
  datasetId: string;
  recordKey: string;
  availableAt: string;
}

export interface StoredAnalysisRun {
  runId: string;
  idempotencyKey: string;
  sessionDate: string;
  decisionAt: string;
  policyVersion: string;
  inputSha256: string;
  input: JsonValue;
  plan: JsonValue;
  status: string;
  createdAt: string;
}

export interface StoredJudgment {
  runId: string;
  stage: 'interpretation' | 'observation' | 'condition' | 'priority';
  eventHash: string;
  status: string;
  payload: JsonValue;
}

export interface SignalDraft {
  runId: string;
  symbol: string;
  side: 'buy' | 'sell';
  payload: JsonValue;
  status: 'shadow' | 'blocked';
}

export interface TestArtifact {
  artifactId: string;
  filename: string;
  sha256: string;
  role: string;
  metadata: JsonValue;
}
