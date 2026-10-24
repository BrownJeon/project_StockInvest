/**
 * T-074 자금 이동 원장 — 저장 계층 (서버 전용).
 *
 * 쓰는 곳은 **딱 세 군데**뿐이다:
 *   1. `cash_flow_ledger` — INSERT(새 기록·정정의 새 행), UPDATE 는 `deleted_at·deleted_by_user_id·delete_reason`(취소·정정·복구)과
 *      `anchor_*·fx_rate_used·fx_source·krw_equiv`(스냅샷 매칭 파생값)만. **금액·종류·통화·시각·메모·멱등키·supersedes_id 는 UPDATE 하지 않는다**
 *      (추가 전용 — Analyst Q2 원칙 ②). DELETE 없음.
 *   2. `system_config.cash_ledger_baseline` — 손익 기준(version·history·낙관적 잠금, T-066 policy-store 패턴).
 *   3. `system_config.cash_ledger_candidate_marks` — 기록 안 된 입출금 후보의 '입출금 아님' 표시.
 * `orders`·`executions`·`position_state`·`portfolio_snapshots`·`signals`·`holdings` 에는 쓰지 않는다(스냅샷은 읽기 전용).
 * KIS·외부 호출 없음. DB 오류는 던진다 — 호출부(handlers.ts)가 4xx/5xx 로 바꾼다.
 *
 * 숫자: mysql2 는 DECIMAL 을 **문자열**로 돌려준다(풀에 decimalNumbers 설정 없음 — T-063 에서 겪은 문제). `dec()` 가 형식을 엄격히 검사해
 * 숫자로 바꾸고, 형식이 이상하면 0 으로 삼키지 않고 던진다(돈 값이 조용히 0 이 되지 않게). 쓸 때는 원화 = 정수 문자열, 달러 = 소수 2자리 문자열로 보낸다.
 * 시각: 읽은 DATETIME(Date) 은 +9h 로 KST 벽시계, 쓸 때는 KST 벽시계 문자열을 그대로 바인딩한다(kst.ts).
 */
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import type { AnchorStatus, BaselineHistoryEntry, Currency, EntryKind } from './types';
import {
  BASELINE_HISTORY_LIMIT, BASELINE_KEY, CANDIDATE_MARKS_KEY, isUsd, LEDGER_ACCOUNT_ID, MARKS_LIMIT, MARKS_LOG_LIMIT,
} from './rules';
import { dbDatetimeToWallMs, formatKstWall } from './kst';
import { toCents } from './compute';
import type { NormalizedEntry } from './validate';
import type { AnchorResult } from './match';
import type { CandidateMark } from './candidates';
import type { SnapshotRowLike } from './snapshots';

/** mysql2 Pool·PoolConnection 공통으로 쓰는 최소 모양 */
export interface Queryable {
  query(sql: string, values?: unknown[]): Promise<[unknown, unknown]>;
}
interface TxConnection extends Queryable {
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
}

function pool(): Queryable {
  return getPool() as unknown as Queryable;
}

async function rows<T = RowDataPacket>(q: Queryable, sql: string, values: unknown[] = []): Promise<T[]> {
  const [r] = await q.query(sql, values);
  return (Array.isArray(r) ? r : []) as T[];
}

async function exec(q: Queryable, sql: string, values: unknown[] = []): Promise<ResultSetHeader> {
  const [r] = await q.query(sql, values);
  return (r ?? { affectedRows: 0, insertId: 0 }) as ResultSetHeader;
}

/** 저장된 값의 형식 오류(돈·시각) — 0 으로 삼키지 않고 던진다 */
export class LedgerDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerDataError';
  }
}

function dec(v: unknown, what: string): number | null {
  if (v == null) return null;
  if (typeof v === 'number') {
    if (Number.isFinite(v)) return v;
  } else if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) {
    return Number(v.trim());
  }
  throw new LedgerDataError(`cash_flow_ledger.${what} 값 형식 오류`);
}

function reqDec(v: unknown, what: string): number {
  const n = dec(v, what);
  if (n == null) throw new LedgerDataError(`cash_flow_ledger.${what} 값 없음`);
  return n;
}

function intOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isSafeInteger(n) ? n : null;
}

function wall(v: unknown, what: string): number | null {
  if (v == null) return null;
  const t = dbDatetimeToWallMs(v);
  if (t == null) throw new LedgerDataError(`cash_flow_ledger.${what} 시각 형식 오류`);
  return t;
}

/** 원화 = 정수 문자열, 달러 = 소수 2자리 문자열 (DECIMAL 바인딩) */
export function amountText(currency: Currency, v: number): string {
  return isUsd(currency) ? (toCents(v) / 100).toFixed(2) : String(Math.round(v));
}

export function isDupKey(e: unknown): boolean {
  const o = e as { code?: string; errno?: number } | null;
  return o?.code === 'ER_DUP_ENTRY' || o?.errno === 1062;
}

/** ER_DUP_ENTRY 가 어느 UNIQUE 에서 났는가 (MariaDB 메시지 "… for key 'uq_cfl_live_dup'") */
export function dupKeyOf(e: unknown): 'client' | 'live' | 'supersedes' | 'other' | null {
  if (!isDupKey(e)) return null;
  const m = String((e as { message?: string; sqlMessage?: string }).sqlMessage ?? (e as Error).message ?? '');
  if (m.includes('uq_cfl_client_entry')) return 'client';
  if (m.includes('uq_cfl_live_dup')) return 'live';
  if (m.includes('uq_cfl_supersedes')) return 'supersedes';
  return 'other';
}

/**
 * 원장 테이블 없음(마이그레이션 전) — 1146 이면서 메시지에 `cash_flow_ledger` 가 있을 때만 (Reviewer L8).
 * 다른 표(`portfolio_snapshots`·`system_config`·`accounts`)가 없으면 마이그레이션 전이 아니라 장애이므로 여기서 거르지 않는다(→ 500).
 */
export function isNoTable(e: unknown): boolean {
  const o = e as { code?: string; errno?: number; message?: string; sqlMessage?: string } | null;
  if (!(o?.code === 'ER_NO_SUCH_TABLE' || o?.errno === 1146)) return false;
  return String(o?.sqlMessage ?? o?.message ?? '').includes('cash_flow_ledger');
}

// ─── cash_flow_ledger ─────────────────────────────────────────────────────

/**
 * 원장 표가 있는지만 확인한다(행은 읽지 않음 — LIMIT 0). 없으면 MariaDB 1146 이 그대로 던져져 handlers 가 503 `not_migrated` 로 바꾼다.
 * 원장 표 밖(system_config)에 먼저 쓰는 기준 저장이 마이그레이션 전에 키만 남기고 503 을 내던 것을 막으려고 쓰기 전에 부른다(QA D-2).
 */
export async function assertLedgerTable(q: Queryable = pool()): Promise<void> {
  await rows(q, 'SELECT 1 FROM cash_flow_ledger LIMIT 0');
}

export interface StoredEntry {
  id: number;
  clientEntryId: string;
  kind: EntryKind;
  occurredAtMs: number;
  currency: Currency;
  amount: number;
  counterCurrency: Currency | null;
  counterAmount: number | null;
  fxRateUsed: number | null;
  fxSource: 'snapshot' | 'user' | null;
  krwEquiv: number | null;
  anchorSnapshotId: number | null;
  anchorSnapshotTsMs: number | null;
  anchorStatus: AnchorStatus;
  anchorDetail: string | null;
  memo: string | null;
  source: 'user' | 'import';
  supersedesId: number | null;
  createdAtMs: number;
  createdByUserId: number | null;
  deletedAtMs: number | null;
  deletedByUserId: number | null;
  deleteReason: string | null;
}

const COLS = [
  'id', 'client_entry_id', 'kind', 'occurred_at', 'currency', 'amount', 'counter_currency', 'counter_amount',
  'fx_rate_used', 'fx_source', 'krw_equiv', 'anchor_snapshot_id', 'anchor_snapshot_ts', 'anchor_status', 'anchor_detail',
  'memo', 'source', 'supersedes_id', 'created_at', 'created_by_user_id', 'deleted_at', 'deleted_by_user_id', 'delete_reason',
].join(', ');

const KINDS: readonly string[] = ['deposit', 'withdrawal', 'exchange'];
const CCYS: readonly string[] = ['KRW', 'USD'];
const STATUSES: readonly string[] = ['pending', 'matched', 'unmatched'];

function ccy(v: unknown, what: string): Currency {
  if (typeof v === 'string' && CCYS.includes(v)) return v as Currency;
  throw new LedgerDataError(`cash_flow_ledger.${what} 값 오류`);
}

export function parseLedgerRow(r: Record<string, unknown>): StoredEntry {
  const id = intOrNull(r.id);
  if (id == null) throw new LedgerDataError('cash_flow_ledger.id 값 오류');
  if (typeof r.kind !== 'string' || !KINDS.includes(r.kind)) throw new LedgerDataError('cash_flow_ledger.kind 값 오류');
  const status = typeof r.anchor_status === 'string' && STATUSES.includes(r.anchor_status) ? (r.anchor_status as AnchorStatus) : null;
  if (!status) throw new LedgerDataError('cash_flow_ledger.anchor_status 값 오류');
  return {
    id,
    clientEntryId: String(r.client_entry_id ?? ''),
    kind: r.kind as EntryKind,
    occurredAtMs: wall(r.occurred_at, 'occurred_at') as number,
    currency: ccy(r.currency, 'currency'),
    amount: reqDec(r.amount, 'amount'),
    counterCurrency: r.counter_currency == null ? null : ccy(r.counter_currency, 'counter_currency'),
    counterAmount: dec(r.counter_amount, 'counter_amount'),
    fxRateUsed: dec(r.fx_rate_used, 'fx_rate_used'),
    fxSource: r.fx_source === 'snapshot' || r.fx_source === 'user' ? r.fx_source : null,
    krwEquiv: dec(r.krw_equiv, 'krw_equiv'),
    anchorSnapshotId: intOrNull(r.anchor_snapshot_id),
    anchorSnapshotTsMs: wall(r.anchor_snapshot_ts, 'anchor_snapshot_ts'),
    anchorStatus: status,
    anchorDetail: r.anchor_detail == null ? null : String(r.anchor_detail),
    memo: r.memo == null ? null : String(r.memo),
    source: r.source === 'import' ? 'import' : 'user',
    supersedesId: intOrNull(r.supersedes_id),
    createdAtMs: wall(r.created_at, 'created_at') ?? 0,
    createdByUserId: intOrNull(r.created_by_user_id),
    deletedAtMs: wall(r.deleted_at, 'deleted_at'),
    deletedByUserId: intOrNull(r.deleted_by_user_id),
    deleteReason: r.delete_reason == null ? null : String(r.delete_reason),
  };
}

export async function readEntries(q: Queryable = pool()): Promise<StoredEntry[]> {
  const r = await rows<Record<string, unknown>>(
    q, `SELECT ${COLS} FROM cash_flow_ledger WHERE account_id = ? ORDER BY occurred_at ASC, id ASC`, [LEDGER_ACCOUNT_ID],
  );
  return r.map(parseLedgerRow);
}

export async function findEntry(id: number, q: Queryable = pool(), lock = false): Promise<StoredEntry | null> {
  const r = await rows<Record<string, unknown>>(
    q, `SELECT ${COLS} FROM cash_flow_ledger WHERE id = ? AND account_id = ? LIMIT 1${lock ? ' FOR UPDATE' : ''}`, [id, LEDGER_ACCOUNT_ID],
  );
  return r[0] ? parseLedgerRow(r[0]) : null;
}

export async function findByClientEntryId(clientEntryId: string, q: Queryable = pool()): Promise<StoredEntry | null> {
  const r = await rows<Record<string, unknown>>(
    q, `SELECT ${COLS} FROM cash_flow_ledger WHERE client_entry_id = ? LIMIT 1`, [clientEntryId],
  );
  return r[0] ? parseLedgerRow(r[0]) : null;
}

/** 살아 있는 같은 (종류·통화·금액·분) 기록 id — uq_cfl_live_dup 위반 뒤 409 duplicate{existingId} 용 */
export async function findLiveDuplicate(n: NormalizedEntry, q: Queryable = pool()): Promise<number | null> {
  const r = await rows<{ id: unknown }>(
    q,
    'SELECT id FROM cash_flow_ledger WHERE account_id = ? AND kind = ? AND currency = ? AND amount = ? AND occurred_at = ? AND deleted_at IS NULL LIMIT 1',
    [LEDGER_ACCOUNT_ID, n.kind, n.currency, amountText(n.currency, n.amount), `${n.occurredAt}:00`],
  );
  return r[0] ? intOrNull(r[0].id) : null;
}

export interface InsertMeta {
  clientEntryId: string;
  userId: number | null;
  /** KST 'YYYY-MM-DD HH:mm:ss' */
  nowWall: string;
  supersedesId: number | null;
}

/** 새 기록 INSERT → id. 중복 키(ER_DUP_ENTRY)는 그대로 던진다(dupKeyOf 로 구분) */
export async function insertEntryRow(n: NormalizedEntry, meta: InsertMeta, q: Queryable = pool()): Promise<number> {
  const res = await exec(
    q,
    `INSERT INTO cash_flow_ledger
       (account_id, client_entry_id, kind, occurred_at, currency, amount, counter_currency, counter_amount, memo, source, supersedes_id, created_at, created_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'user', ?, ?, ?)`,
    [
      LEDGER_ACCOUNT_ID, meta.clientEntryId, n.kind, `${n.occurredAt}:00`, n.currency, amountText(n.currency, n.amount),
      n.counterCurrency, n.counterCurrency && n.counterAmount != null ? amountText(n.counterCurrency, n.counterAmount) : null,
      n.memo, meta.supersedesId, meta.nowWall, meta.userId,
    ],
  );
  const id = intOrNull(res.insertId);
  if (id == null || id <= 0) throw new LedgerDataError('cash_flow_ledger INSERT id 없음');
  return id;
}

/** 취소 — 조건부 UPDATE(살아 있는 행만). 영향 행 수를 돌려준다(0 = 이미 취소·정정됐거나 없음) */
export async function voidEntryRow(
  id: number, reason: string, userId: number | null, nowWall: string, q: Queryable = pool(),
): Promise<number> {
  const res = await exec(
    q,
    'UPDATE cash_flow_ledger SET deleted_at = ?, deleted_by_user_id = ?, delete_reason = ? WHERE id = ? AND account_id = ? AND deleted_at IS NULL',
    [nowWall, userId, reason, id, LEDGER_ACCOUNT_ID],
  );
  return res.affectedRows ?? 0;
}

/**
 * 지연 매칭 결과 저장 — 조건부 UPDATE(살아 있고, 읽었을 때의 상태·앵커가 그대로인 행만). 다른 요청이 먼저 바꿨으면 0행(무시).
 * 이 UPDATE 가 바꾸는 열은 anchor_*·fx_rate_used·fx_source·krw_equiv 뿐이다.
 */
export async function updateAnchor(
  id: number,
  old: { status: AnchorStatus; snapshotId: number | null },
  next: AnchorResult,
  q: Queryable = pool(),
): Promise<number> {
  const res = await exec(
    q,
    `UPDATE cash_flow_ledger
        SET anchor_status = ?, anchor_snapshot_id = ?, anchor_snapshot_ts = ?, anchor_detail = ?, fx_rate_used = ?, fx_source = ?, krw_equiv = ?
      WHERE id = ? AND account_id = ? AND deleted_at IS NULL AND anchor_status = ? AND anchor_snapshot_id <=> ?`,
    [
      next.status, next.snapshotId, next.snapshotTs, next.detail,
      next.fxRateUsed == null ? null : next.fxRateUsed.toFixed(4), next.fxSource,
      next.krwEquiv == null ? null : String(Math.round(next.krwEquiv)),
      id, LEDGER_ACCOUNT_ID, old.status, old.snapshotId,
    ],
  );
  return res.affectedRows ?? 0;
}

async function withTx<T>(fn: (c: TxConnection) => Promise<T>): Promise<T> {
  const c = (await (getPool() as unknown as { getConnection(): Promise<TxConnection> }).getConnection());
  let open = false;
  try {
    await c.beginTransaction();
    open = true;
    const out = await fn(c);
    return out;
  } catch (e) {
    if (open) { try { await c.rollback(); } catch { /* 연결 오류면 풀이 정리한다 */ } }
    throw e;
  } finally {
    c.release();
  }
}

/** 트랜잭션 안에서 결과를 정하고 commit/rollback 을 함께 결정한다 */
class TxAbort<T> {
  constructor(readonly value: T) {}
}

export type CorrectTxResult =
  | { kind: 'ok'; newId: number }
  | { kind: 'not_found' }
  | { kind: 'already_voided' }
  | { kind: 'dup_live' }
  | { kind: 'dup_client' };

/**
 * 정정 — 한 트랜잭션: 원래 행 잠금(FOR UPDATE) → 살아 있으면 조건부 UPDATE 로 소프트 삭제 → 새 행 INSERT(supersedes_id).
 * 원래 행을 먼저 지우므로 같은 (종류·통화·금액·분)으로 메모만 고치는 정정도 uq_cfl_live_dup 에 걸리지 않는다.
 */
export async function correctEntryTx(
  id: number, n: NormalizedEntry, meta: Omit<InsertMeta, 'supersedesId'> & { reason: string },
): Promise<CorrectTxResult> {
  try {
    return await withTx(async (c) => {
      const orig = await findEntry(id, c, true);
      if (!orig) throw new TxAbort<CorrectTxResult>({ kind: 'not_found' });
      if (orig.deletedAtMs != null) throw new TxAbort<CorrectTxResult>({ kind: 'already_voided' });
      const n1 = await voidEntryRow(id, meta.reason, meta.userId, meta.nowWall, c);
      if (n1 !== 1) throw new TxAbort<CorrectTxResult>({ kind: 'already_voided' });
      let newId: number;
      try {
        newId = await insertEntryRow(n, { ...meta, supersedesId: id }, c);
      } catch (e) {
        const d = dupKeyOf(e);
        if (d === 'client') throw new TxAbort<CorrectTxResult>({ kind: 'dup_client' });
        if (d === 'live') throw new TxAbort<CorrectTxResult>({ kind: 'dup_live' });
        if (d === 'supersedes') throw new TxAbort<CorrectTxResult>({ kind: 'already_voided' });
        throw e;
      }
      await c.commit();
      return { kind: 'ok', newId } as CorrectTxResult;
    });
  } catch (e) {
    if (e instanceof TxAbort) return e.value as CorrectTxResult;
    throw e;
  }
}

export type RestoreTxResult =
  | { kind: 'ok' }
  | { kind: 'not_found' }
  | { kind: 'not_voided' }
  | { kind: 'superseded'; by: number }
  | { kind: 'dup_live' };

/**
 * 복구 — 한 트랜잭션: 행 잠금 → 취소된 행인지 → 정정으로 대체된 행이 아닌지(잠금 읽기, 동시 정정 커밋을 본다) → 조건부 UPDATE.
 * 반영 상태는 pending 으로 되돌려 다음 조회가 다시 맞춘다(그 사이 다른 기록이 같은 변화를 잡았을 수 있다).
 * 취소 사유·취소한 사람 열은 '마지막 취소 기록'으로 남겨 둔다(살아 있는 행에서는 읽지 않는다).
 */
export async function restoreEntryTx(id: number): Promise<RestoreTxResult> {
  try {
    return await withTx(async (c) => {
      const row = await findEntry(id, c, true);
      if (!row) throw new TxAbort<RestoreTxResult>({ kind: 'not_found' });
      if (row.deletedAtMs == null) throw new TxAbort<RestoreTxResult>({ kind: 'not_voided' });
      const sup = await rows<{ id: unknown }>(
        c, 'SELECT id FROM cash_flow_ledger WHERE supersedes_id = ? LIMIT 1 LOCK IN SHARE MODE', [id],
      );
      if (sup[0]) throw new TxAbort<RestoreTxResult>({ kind: 'superseded', by: intOrNull(sup[0].id) ?? 0 });
      let res: ResultSetHeader;
      try {
        res = await exec(
          c,
          `UPDATE cash_flow_ledger
              SET deleted_at = NULL, anchor_status = 'pending', anchor_snapshot_id = NULL, anchor_snapshot_ts = NULL, anchor_detail = NULL,
                  fx_rate_used = NULL, fx_source = NULL, krw_equiv = NULL
            WHERE id = ? AND account_id = ? AND deleted_at IS NOT NULL`,
          [id, LEDGER_ACCOUNT_ID],
        );
      } catch (e) {
        if (dupKeyOf(e) === 'live') throw new TxAbort<RestoreTxResult>({ kind: 'dup_live' });
        throw e;
      }
      if ((res.affectedRows ?? 0) !== 1) throw new TxAbort<RestoreTxResult>({ kind: 'not_voided' });
      await c.commit();
      return { kind: 'ok' } as RestoreTxResult;
    });
  } catch (e) {
    if (e instanceof TxAbort) return e.value as RestoreTxResult;
    throw e;
  }
}

// ─── system_config: 손익 기준 ──────────────────────────────────────────────

export interface StoredBaseline {
  version: number;
  /** KST 'YYYY-MM-DD HH:mm:ss' */
  updatedAt: string;
  /** 기준 스냅샷 ts (KST) */
  baselineAt: string;
  snapshotId: number;
  snapshot: { totalKrw: number; krwCash: number; usdCash: number | null; fx: number | null };
  confirmed: { krwCash: number | null; usdCash: number | null; at: string | null; note: string | null };
  baselineTotalKrw: number;
  history: BaselineHistoryEntry[];
}

export type BaselineRead =
  | { status: 'absent' }
  | { status: 'ok'; doc: StoredBaseline }
  | { status: 'invalid'; detail: string };

export const BASELINE_RECOVERY_HINT = '복구: system_config 의 cash_ledger_baseline 키를 삭제한 뒤 입출금 기록 화면에서 기준을 다시 정하세요';

function finiteOrNull(v: unknown): number | null | undefined {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
}

export function parseBaselineDoc(raw: unknown): BaselineRead {
  let v: unknown = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return { status: 'invalid', detail: 'JSON 이 아님' }; }
  }
  if (!v || typeof v !== 'object') return { status: 'invalid', detail: '객체가 아님' };
  const o = v as Record<string, unknown>;
  const version = Number(o.version);
  if (!Number.isInteger(version) || version < 1) return { status: 'invalid', detail: 'version 없음' };
  const snapshotId = Number(o.snapshotId);
  if (!Number.isSafeInteger(snapshotId) || snapshotId < 1) return { status: 'invalid', detail: 'snapshotId 없음' };
  if (typeof o.baselineAt !== 'string' || dbDatetimeToWallMs(o.baselineAt) == null) return { status: 'invalid', detail: 'baselineAt 형식 오류' };
  const s = (o.snapshot ?? {}) as Record<string, unknown>;
  const c = (o.confirmed ?? {}) as Record<string, unknown>;
  const totalKrw = finiteOrNull(s.totalKrw);
  const krwCash = finiteOrNull(s.krwCash);
  const usdCash = finiteOrNull(s.usdCash);
  const fx = finiteOrNull(s.fx);
  const cKrw = finiteOrNull(c.krwCash);
  const cUsd = finiteOrNull(c.usdCash);
  const bt = finiteOrNull(o.baselineTotalKrw);
  if (totalKrw == null || krwCash == null || usdCash === undefined || fx === undefined || cKrw === undefined || cUsd === undefined || bt == null) {
    return { status: 'invalid', detail: '숫자 값 오류' };
  }
  const history = Array.isArray(o.history)
    ? (o.history as unknown[]).filter((h): h is BaselineHistoryEntry => !!h && typeof h === 'object').slice(-BASELINE_HISTORY_LIMIT)
    : [];
  return {
    status: 'ok',
    doc: {
      version, updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : '',
      baselineAt: (o.baselineAt as string).slice(0, 19), snapshotId,
      snapshot: { totalKrw, krwCash, usdCash, fx },
      confirmed: {
        krwCash: cKrw, usdCash: cUsd,
        at: typeof c.at === 'string' ? c.at : null,
        note: typeof c.note === 'string' ? c.note : null,
      },
      baselineTotalKrw: bt, history,
    },
  };
}

async function readKey(key: string, q: Queryable): Promise<unknown | undefined> {
  const r = await rows<{ value: unknown }>(q, 'SELECT value FROM system_config WHERE `key` = ? LIMIT 1', [key]);
  return r.length === 0 ? undefined : r[0].value;
}

export async function readBaseline(q: Queryable = pool()): Promise<BaselineRead> {
  const v = await readKey(BASELINE_KEY, q);
  return v === undefined ? { status: 'absent' } : parseBaselineDoc(v);
}

export type BaselineSaveResult =
  | { ok: true; doc: StoredBaseline }
  | { ok: false; conflict: true; latest: StoredBaseline | null };

/**
 * 기준 저장(낙관적 동시성, T-066 saveRiskPolicy 와 같은 모양).
 * - 없음 + baseVersion 0 → INSERT (중복 키면 다른 기기가 먼저 → 충돌)
 * - 있음 → baseVersion 이 현재 version 과 같을 때만 조건부 UPDATE (영향 0행 → 충돌)
 * - 저장값이 손상돼 있으면 덮어쓰지 않고 던진다.
 */
export async function saveBaseline(
  next: Omit<StoredBaseline, 'version' | 'updatedAt' | 'history'>,
  baseVersion: number,
  nowWall: string,
  q: Queryable = pool(),
): Promise<BaselineSaveResult> {
  const current = await readBaseline(q);
  if (current.status === 'invalid') {
    throw new LedgerDataError(`저장된 cash_ledger_baseline 값이 손상돼 덮어쓰지 않았습니다 (${current.detail}) — ${BASELINE_RECOVERY_HINT}`);
  }
  const hist = (version: number): BaselineHistoryEntry => ({
    version, at: nowWall, baselineAt: next.baselineAt, snapshotId: next.snapshotId,
    confirmed: { krwCash: next.confirmed.krwCash, usdCash: next.confirmed.usdCash }, baselineTotalKrw: next.baselineTotalKrw,
  });
  if (current.status === 'absent') {
    if (baseVersion !== 0) return { ok: false, conflict: true, latest: null };
    const doc: StoredBaseline = { version: 1, updatedAt: nowWall, ...next, history: [hist(1)] };
    try {
      await exec(q, 'INSERT INTO system_config (`key`, value) VALUES (?, ?)', [BASELINE_KEY, JSON.stringify(doc)]);
    } catch (e) {
      if (!isDupKey(e)) throw e;
      const latest = await readBaseline(q);
      return { ok: false, conflict: true, latest: latest.status === 'ok' ? latest.doc : null };
    }
    return { ok: true, doc };
  }
  const cur = current.doc;
  if (baseVersion !== cur.version) return { ok: false, conflict: true, latest: cur };
  const version = cur.version + 1;
  const doc: StoredBaseline = {
    version, updatedAt: nowWall, ...next, history: [...cur.history, hist(version)].slice(-BASELINE_HISTORY_LIMIT),
  };
  const res = await exec(
    q,
    "UPDATE system_config SET value = ? WHERE `key` = ? AND CAST(JSON_EXTRACT(value, '$.version') AS UNSIGNED) = ?",
    [JSON.stringify(doc), BASELINE_KEY, baseVersion],
  );
  if ((res.affectedRows ?? 0) === 0) {
    const latest = await readBaseline(q);
    return { ok: false, conflict: true, latest: latest.status === 'ok' ? latest.doc : null };
  }
  return { ok: true, doc };
}

// ─── system_config: 후보 '입출금 아님' 표시 ────────────────────────────────

export interface MarkLogEntry {
  key: string;
  action: 'dismiss' | 'reopen';
  reason: string | null;
  at: string;
  byUserId: number | null;
}

export interface StoredMarks {
  version: number;
  updatedAt: string;
  marks: Record<string, CandidateMark>;
  log: MarkLogEntry[];
}

export type MarksRead = { status: 'absent' } | { status: 'ok'; doc: StoredMarks } | { status: 'invalid'; detail: string };

export function parseMarksDoc(raw: unknown): MarksRead {
  let v: unknown = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return { status: 'invalid', detail: 'JSON 이 아님' }; }
  }
  if (!v || typeof v !== 'object') return { status: 'invalid', detail: '객체가 아님' };
  const o = v as Record<string, unknown>;
  const version = Number(o.version);
  if (!Number.isInteger(version) || version < 1) return { status: 'invalid', detail: 'version 없음' };
  const marks: Record<string, CandidateMark> = {};
  const src = o.marks && typeof o.marks === 'object' ? (o.marks as Record<string, unknown>) : {};
  for (const [k, m] of Object.entries(src)) {
    const mm = m as Record<string, unknown> | null;
    if (!mm || mm.state !== 'dismissed' || typeof mm.reason !== 'string' || typeof mm.at !== 'string') continue;
    marks[k] = { state: 'dismissed', reason: mm.reason, at: mm.at, byUserId: intOrNull(mm.byUserId) };
  }
  const log = Array.isArray(o.log) ? (o.log as MarkLogEntry[]).filter((x) => !!x && typeof x === 'object').slice(-MARKS_LOG_LIMIT) : [];
  return { status: 'ok', doc: { version, updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : '', marks, log } };
}

export async function readMarks(q: Queryable = pool()): Promise<MarksRead> {
  const v = await readKey(CANDIDATE_MARKS_KEY, q);
  return v === undefined ? { status: 'absent' } : parseMarksDoc(v);
}

export type MarkMutation<R> = { write: true; result: R } | { write: false; result: R };

/**
 * 표시 문서를 바꾼다(낙관적 잠금 + 최대 3회 재시도). mutate 는 최신 문서 사본을 받아 바꿀지 결정한다.
 * 손상된 문서는 덮어쓰지 않고 던진다.
 */
export async function updateMarks<R>(
  mutate: (doc: StoredMarks) => MarkMutation<R>,
  nowWall: string,
  q: Queryable = pool(),
): Promise<R> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await readMarks(q);
    if (cur.status === 'invalid') {
      throw new LedgerDataError(`저장된 cash_ledger_candidate_marks 값이 손상돼 덮어쓰지 않았습니다 (${cur.detail})`);
    }
    const base: StoredMarks = cur.status === 'ok'
      ? JSON.parse(JSON.stringify(cur.doc)) as StoredMarks
      : { version: 0, updatedAt: '', marks: {}, log: [] };
    const m = mutate(base);
    if (!m.write) return m.result;
    // 오래된 표시부터 정리(상한)
    const keys = Object.keys(base.marks);
    if (keys.length > MARKS_LIMIT) {
      keys.sort((a, b) => (base.marks[a].at < base.marks[b].at ? -1 : 1));
      for (const k of keys.slice(0, keys.length - MARKS_LIMIT)) delete base.marks[k];
    }
    const doc: StoredMarks = { ...base, version: base.version + 1, updatedAt: nowWall, log: base.log.slice(-MARKS_LOG_LIMIT) };
    if (cur.status === 'absent') {
      try {
        await exec(q, 'INSERT INTO system_config (`key`, value) VALUES (?, ?)', [CANDIDATE_MARKS_KEY, JSON.stringify(doc)]);
        return m.result;
      } catch (e) {
        if (!isDupKey(e)) throw e;
        continue;
      }
    }
    const res = await exec(
      q,
      "UPDATE system_config SET value = ? WHERE `key` = ? AND CAST(JSON_EXTRACT(value, '$.version') AS UNSIGNED) = ?",
      [JSON.stringify(doc), CANDIDATE_MARKS_KEY, base.version],
    );
    if ((res.affectedRows ?? 0) === 1) return m.result;
  }
  throw new Error('후보 표시를 저장하지 못했습니다(동시 변경 경합) — 잠시 뒤 다시 시도하세요');
}

// ─── portfolio_snapshots (읽기 전용) ───────────────────────────────────────

const SNAP_COLS = 'id, ts, total_krw, positions';

export async function readLatestSnapshot(q: Queryable = pool()): Promise<SnapshotRowLike | null> {
  const r = await rows<SnapshotRowLike>(q, `SELECT ${SNAP_COLS} FROM portfolio_snapshots ORDER BY ts DESC, id DESC LIMIT 1`);
  return r[0] ?? null;
}

export async function readSnapshotById(id: number, q: Queryable = pool()): Promise<SnapshotRowLike | null> {
  const r = await rows<SnapshotRowLike>(q, `SELECT ${SNAP_COLS} FROM portfolio_snapshots WHERE id = ? LIMIT 1`, [id]);
  return r[0] ?? null;
}

/**
 * 매칭·후보 탐지용 연속 스냅샷: fromWall 이후 최신 쪽 maxRows 행 + 그 바로 앞 1행(첫 단계의 prev).
 * maxRows 를 넘으면 오래된 쪽을 버리고 truncated=true (그때는 앞 1행을 붙이지 않는다 — 이어지지 않으므로).
 */
export async function readSnapshotSeries(
  fromWall: string, maxRows: number, q: Queryable = pool(),
): Promise<{ rows: SnapshotRowLike[]; truncated: boolean }> {
  const recent = await rows<SnapshotRowLike>(
    q, `SELECT ${SNAP_COLS} FROM portfolio_snapshots WHERE ts >= ? ORDER BY ts DESC, id DESC LIMIT ?`, [fromWall, maxRows + 1],
  );
  const truncated = recent.length > maxRows;
  const kept = recent.slice(0, maxRows).reverse();
  if (truncated) return { rows: kept, truncated };
  const before = await rows<SnapshotRowLike>(
    q, `SELECT ${SNAP_COLS} FROM portfolio_snapshots WHERE ts < ? ORDER BY ts DESC, id DESC LIMIT 1`, [fromWall],
  );
  return { rows: [...before, ...kept], truncated };
}

/** 기준 정하기 선택지용(어제 0시 이후, 많아야 수십 행) */
export async function readSnapshotsSince(fromWall: string, q: Queryable = pool()): Promise<SnapshotRowLike[]> {
  return rows<SnapshotRowLike>(
    q, `SELECT ${SNAP_COLS} FROM portfolio_snapshots WHERE ts >= ? ORDER BY ts ASC, id ASC LIMIT 500`, [fromWall],
  );
}

/** 지금(Date) → KST 'YYYY-MM-DD HH:mm:ss' */
export function nowWallString(now: Date): string {
  return formatKstWall(now.getTime() + 9 * 3_600_000);
}
