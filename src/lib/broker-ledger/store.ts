/**
 * T-087 (T-081 WP-D1a) — 브로커 원장 **DB 접근**(수집기 전용). DB 연결은 호출자(라우트)가 주입한다 — 이 모듈은 `@/lib/db`·`@/lib/safety` 를
 * import 하지 않는다(정적 시험 `static-invariants.test.ts`). 일회용 MariaDB 시험은 같은 함수를 시험용 풀로 부른다.
 *
 * 설계 정본: `docs/design/2026-10-25-wpd-broker-fills-design.md` v3.1 §3.2(쓰기 계약)·§3.4(완전성)·§3.7(single-flight·중단).
 * DDL: `scripts/migrations/T-081-wpd-broker-fills.sql`(생성열 `effective_to` 는 쓰지 않는다).
 *
 * ## 쓰기 계약(§3.2 — 행마다 트랜잭션)
 *  BEGIN → `SELECT … FOR UPDATE`(자연키) →
 *   - 없음                         → INSERT                                   (inserted)
 *   - 있음·raw_hash 같음            → last_seen_at·last_run_id 만               (unchanged — 세지 않는다)
 *   - 있음·다름·단조 가드 위반       → 쓰지 않음                                  (stale — ① 체결수량 감소 ② closed→open, 둘 다 취소·정정 신호 없을 때)
 *   - 있음·다름                    → revisions INSERT → 원문열·수집기 파생열 UPDATE, fee_* 는 현재 fee_kind 가 unknown/estimated 일 때만,
 *                                     revision+1, **raw_hash 는 SET 목록의 마지막**                 (updated)
 *  → COMMIT. 1213(교착)·1205(락 대기 초과)는 ROLLBACK → 지터 10~50ms → 같은 행 최대 2회 재시도, 그 뒤에도 실패면 그 행만 건너뛴다(writeFailure).
 *  건수는 위 분기 결과로 센다(`affectedRows` 는 쓰지 않는다 — 삽입·동일·갱신을 구분할 수 없다).
 *
 * ## 민감정보
 *  계좌번호·키는 이 모듈에 들어오지 않는다(지문 16 hex 만). 오류 문자열에는 errno·사유 코드·(설계가 허용한) 브로커 주문번호만 넣는다.
 */
import type {
  BrokerMarket, BrokerRunKind, NormalizedFill, NormalizedPositionSnapshot, NormalizedRealizedPnl, PositiveCheck, RunStatus, SumCheck,
} from './types';
import { parseDec } from './decimal';

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 주입 인터페이스 — mysql2 Pool·PoolConnection 이 그대로 만족한다(시험 대역도)
// ─────────────────────────────────────────────────────────────────────────────────────────────

export interface SqlQueryable {
  query(sql: string, values?: unknown[]): Promise<[unknown, unknown]>;
}
export interface SqlConnection extends SqlQueryable {
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
  /** 연결 폐기(mysql2 PoolConnection.destroy). 명명 락을 풀지 못했을 때 그 연결을 풀에 돌려주지 않으려고 쓴다. */
  destroy?(): void;
}
export interface SqlPool extends SqlQueryable {
  getConnection(): Promise<SqlConnection>;
}

export const BROKER = 'kis' as const;
export const LEDGER_TABLES = ['broker_fill_runs', 'broker_fills', 'broker_fill_revisions', 'broker_realized_pnl', 'broker_position_snapshots'] as const;

/** 재시도 대상 errno — 1213 ER_LOCK_DEADLOCK · 1205 ER_LOCK_WAIT_TIMEOUT(설계 §3.2 ③ M-A). */
export const RETRYABLE_ERRNOS: readonly number[] = [1213, 1205];
/** 재시도 횟수(첫 시도 제외). 설계: 최대 2회. */
export const ROW_TX_MAX_RETRIES = 2;
/** 지터 범위(ms) — 10~50. */
export const ROW_TX_JITTER_MIN_MS = 10;
export const ROW_TX_JITTER_MAX_MS = 50;

type DbErr = { errno?: number; code?: string; sqlMessage?: string; message?: string } | null | undefined;

export function errnoOf(e: unknown): number | null {
  const n = (e as DbErr)?.errno;
  return typeof n === 'number' ? n : null;
}

export function isRetryableLockError(e: unknown): boolean {
  const n = errnoOf(e);
  return n != null && RETRYABLE_ERRNOS.includes(n);
}

/** 원장 테이블 없음(마이그레이션 전) — 1146 이면서 메시지에 `broker_` 표 이름이 있을 때만(다른 표가 없으면 장애 → 위로 던진다 · ledger/store.ts 의 isNoTable 과 같은 원칙). */
export function isLedgerTableMissing(e: unknown): boolean {
  const o = e as DbErr;
  if (!(o?.code === 'ER_NO_SUCH_TABLE' || o?.errno === 1146)) return false;
  const m = String(o?.sqlMessage ?? o?.message ?? '');
  return LEDGER_TABLES.some((t) => m.includes(t));
}

/** 오류 → 짧은 코드(errno 또는 code). 메시지 원문(값이 들어 있을 수 있다)은 넣지 않는다. */
export function errCode(e: unknown): string {
  const n = errnoOf(e);
  if (n != null) return `db_${n}`;
  const c = (e as DbErr)?.code;
  if (typeof c === 'string' && /^[A-Z_0-9]{1,40}$/.test(c)) return c.toLowerCase();
  return 'internal_error';
}

async function rows<T>(q: SqlQueryable, sql: string, values: unknown[] = []): Promise<T[]> {
  const [r] = await q.query(sql, values);
  return (Array.isArray(r) ? r : []) as T[];
}
async function exec(q: SqlQueryable, sql: string, values: unknown[] = []): Promise<{ insertId: number; affectedRows: number }> {
  const [r] = await q.query(sql, values);
  const h = (r ?? {}) as { insertId?: number; affectedRows?: number };
  return { insertId: Number(h.insertId ?? 0), affectedRows: Number(h.affectedRows ?? 0) };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 시각 — DB DATETIME 은 KST 벽시계 문자열로 주고받는다(풀의 timezone·dateStrings 설정에 기대지 않는다)
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** epoch ms → KST `YYYY-MM-DD HH:MM:SS`(초 미만 버림). */
export function kstDateTime(ms: number): string {
  return new Date(Math.floor(ms / 1000) * 1000 + 9 * 3_600_000).toISOString().slice(0, 19).replace('T', ' ');
}
/** DB 에서 읽는 DATETIME 은 항상 `DATE_FORMAT(…)` 문자열로 받는다. */
const DT = (col: string) => `DATE_FORMAT(${col}, '%Y-%m-%d %H:%i:%s')`;

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 준비 점검 · 스위치 · single-flight · 중단 판정
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** 다섯 표가 다 있는가. 없으면 `false`(1146 + broker_ 표 이름일 때만), 그 밖의 오류는 던진다. 행은 읽지 않는다(LIMIT 0). */
export async function ledgerTablesPresent(q: SqlQueryable): Promise<boolean> {
  try {
    for (const t of LEDGER_TABLES) await q.query(`SELECT 1 FROM ${t} LIMIT 0`);
    return true;
  } catch (e) {
    if (isLedgerTableMissing(e)) return false;
    throw e;
  }
}

export const CRON_SWITCH_KEY = 'broker_fills_cron_enabled';

export interface CronSwitchState {
  /** JSON `true` 일 때만 켜짐. 키 없음·false·그 밖의 값·읽기 오류 = 꺼짐(fail-closed, 기본 꺼짐). */
  enabled: boolean;
  /** 스위치가 마지막으로 바뀐 시각(KST 문자열). 연속 실패 중단(halted)은 이 시각 이후의 run 만 센다 — 끄고 다시 켜면 재개된다. */
  updatedAt: string | null;
  readError: boolean;
}

export async function readCronSwitch(q: SqlQueryable): Promise<CronSwitchState> {
  try {
    const r = await rows<{ value: unknown; updated_at_s: string | null }>(
      q, `SELECT value, ${DT('updated_at')} AS updated_at_s FROM system_config WHERE \`key\` = ? LIMIT 1`, [CRON_SWITCH_KEY]);
    if (r.length === 0) return { enabled: false, updatedAt: null, readError: false };
    let v: unknown = r[0].value;
    if (typeof v === 'string') {
      try { v = JSON.parse(v); } catch { v = undefined; }
    } else if (Buffer.isBuffer(v)) {
      try { v = JSON.parse(v.toString('utf8')); } catch { v = undefined; }
    }
    return { enabled: v === true, updatedAt: r[0].updated_at_s ?? null, readError: false };
  } catch {
    return { enabled: false, updatedAt: null, readError: true };
  }
}

/** 프로세스 간 single-flight 명명 락(대기 0초). 1 = 획득, 0/null = 다른 연결이 잡고 있음·오류. 연결을 놓으면 자동으로 풀린다. */
export const COLLECTOR_LOCK_NAME = 'stockinvest:broker-fills-collector';
export async function tryCollectorLock(conn: SqlQueryable): Promise<boolean> {
  const r = await rows<{ got: unknown }>(conn, 'SELECT GET_LOCK(?, 0) AS got', [COLLECTOR_LOCK_NAME]);
  return Number(r[0]?.got) === 1;
}
/** 명명 락 해제. 1(내가 잡고 있던 락을 풀었음)이 아니면 false — 호출자는 그 연결을 폐기한다(락을 잡은 채 풀에 돌아가지 않게). */
export async function releaseCollectorLock(conn: SqlQueryable): Promise<boolean> {
  const r = await rows<{ rel: unknown }>(conn, 'SELECT RELEASE_LOCK(?) AS rel', [COLLECTOR_LOCK_NAME]);
  return Number(r[0]?.rel) === 1;
}

/** 설계 §3.7 — 진행 중 run 이 이 시간 안에 시작됐으면 이번 실행을 건너뛴다. 그보다 오래된 running 은 `failed(stale_running)` 로 닫는다. */
export const SINGLE_FLIGHT_STALE_MS = 10 * 60_000;

export interface RunningCheck { fresh: number; closedStale: number }

export async function checkAndCloseRunning(q: SqlQueryable, accountId: number, nowMs: number): Promise<RunningCheck> {
  const cutoff = kstDateTime(nowMs - SINGLE_FLIGHT_STALE_MS);
  const r = await rows<{ id: number; fresh: number | string }>(
    q, 'SELECT id, (started_at >= ?) AS fresh FROM broker_fill_runs WHERE account_id = ? AND status = \'running\'', [cutoff, accountId]);
  const fresh = r.filter((x) => Number(x.fresh) === 1).length;
  if (fresh > 0) return { fresh, closedStale: 0 };
  let closedStale = 0;
  const now = kstDateTime(nowMs);
  for (const x of r) {
    const res = await exec(q,
      "UPDATE broker_fill_runs SET status = 'failed', finished_at = GREATEST(?, started_at), error = 'stale_running' WHERE id = ? AND status = 'running'",
      [now, x.id]);
    closedStale += res.affectedRows > 0 ? 1 : 0;
  }
  return { fresh: 0, closedStale };
}

/** 같은 account_id 의 **직전 성공(complete/incomplete)** run 지문(설계 L-d ① — 실패 run 과 비교하지 않는다). 없으면 null. */
export async function lastSuccessfulFingerprint(q: SqlQueryable, accountId: number): Promise<string | null> {
  const r = await rows<{ fp: string }>(
    q, "SELECT account_fingerprint AS fp FROM broker_fill_runs WHERE account_id = ? AND status IN ('complete','incomplete') ORDER BY id DESC LIMIT 1",
    [accountId]);
  return r.length ? String(r[0].fp) : null;
}

/** 설계 §3.7 — 같은 (시장·종류)에서 연속 이 횟수만큼 failed 면 자동 실행을 멈춘다(`halted`). */
export const HALT_AFTER_CONSECUTIVE_FAILURES = 3;

/**
 * 같은 (계좌·시장·종류)의 최근 끝난 run 이 연속 {@link HALT_AFTER_CONSECUTIVE_FAILURES}회 failed 인가.
 * `since`(스위치 마지막 변경 시각)가 있으면 그 뒤의 run 만 센다 — 사람이 스위치를 끄고 다시 켜면 재개된다. 수동 실행이 성공해도 연속이 끊긴다.
 * 🔴 (감사 M1) **지금 지문과 같은 run 만** 센다 — 다른 키를 가진 환경(개발 서버 등)이 같은 DB 에 남긴 `failed(account_changed)` 3건이
 *    운영 크론을 halted 로 만들지 못하게 한다. 같은 지문 환경의 연속 실패 3회 → halted 는 그대로다.
 */
export async function isHalted(
  q: SqlQueryable, accountId: number, market: BrokerMarket, kind: BrokerRunKind, since: string | null, accountFingerprint: string,
): Promise<boolean> {
  const r = await rows<{ status: string }>(
    q,
    `SELECT status FROM broker_fill_runs WHERE account_id = ? AND account_fingerprint = ? AND market = ? AND kind = ? AND status <> 'running'${since ? ' AND started_at >= ?' : ''}
      ORDER BY id DESC LIMIT ${HALT_AFTER_CONSECUTIVE_FAILURES}`,
    since ? [accountId, accountFingerprint, market, kind, since] : [accountId, accountFingerprint, market, kind]);
  return r.length === HALT_AFTER_CONSECUTIVE_FAILURES && r.every((x) => x.status === 'failed');
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// run 라이프사이클
// ─────────────────────────────────────────────────────────────────────────────────────────────

export interface NewRun {
  accountId: number;
  accountFingerprint: string;
  market: BrokerMarket;
  kind: BrokerRunKind;
  sourceTr: string;
  windowFrom: string;
  windowTo: string;
  queryFrom: string;
  queryTo: string;
  trigger: 'cron' | 'manual';
  startedAt: string;
  positiveCheck: Extract<PositiveCheck, 'pending' | 'n/a'>;
}

/** `running` 행 INSERT → id. date_basis 는 unknown(첫 라이브 확정 전, M5). effective_to 는 생성열이라 쓰지 않는다. */
export async function insertRunningRun(q: SqlQueryable, r: NewRun): Promise<number> {
  const res = await exec(q,
    `INSERT INTO broker_fill_runs
       (account_id, account_fingerprint, broker, market, kind, source_tr, window_from, window_to, query_from, query_to, date_basis,
        trigger_kind, started_at, status, sum_check, positive_check)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unknown', ?, ?, 'running', 'pending', ?)`,
    [r.accountId, r.accountFingerprint, BROKER, r.market, r.kind, r.sourceTr, r.windowFrom, r.windowTo, r.queryFrom, r.queryTo,
      r.trigger, r.startedAt, r.positiveCheck]);
  return res.insertId;
}

/** 실행 전에 이미 실패가 정해진 run(계좌 지문 변경 등) — 바로 failed 로 INSERT. KIS 호출 0. */
export async function insertFailedRun(q: SqlQueryable, r: NewRun, error: string): Promise<number> {
  const res = await exec(q,
    `INSERT INTO broker_fill_runs
       (account_id, account_fingerprint, broker, market, kind, source_tr, window_from, window_to, query_from, query_to, date_basis,
        trigger_kind, started_at, finished_at, status, sum_check, positive_check, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unknown', ?, ?, ?, 'failed', 'pending', ?, ?)`,
    [r.accountId, r.accountFingerprint, BROKER, r.market, r.kind, r.sourceTr, r.windowFrom, r.windowTo, r.queryFrom, r.queryTo,
      r.trigger, r.startedAt, r.startedAt, r.positiveCheck, error]);
  return res.insertId;
}

export interface RunFinish {
  status: Exclude<RunStatus, 'running'>;
  finishedAt: string;
  lastTrCont: string | null;
  sumCheck: SumCheck;
  pages: number;
  kisCalls: number;
  rowsSeen: number;
  rowsInserted: number;
  rowsUpdated: number;
  rowsStaleSkipped: number;
  duplicateKeys: number;
  error: string | null;
}

/** running → 최종 상태. finished_at 은 started_at 보다 이르지 않게(시계 역행 대비 GREATEST). 1행을 바꾸지 못하면 false. */
export async function finishRun(q: SqlQueryable, runId: number, f: RunFinish): Promise<boolean> {
  const res = await exec(q,
    `UPDATE broker_fill_runs
        SET status = ?, finished_at = GREATEST(?, started_at), last_tr_cont = ?, sum_check = ?, pages = ?, kis_calls = ?,
            rows_seen = ?, rows_inserted = ?, rows_updated = ?, rows_stale_skipped = ?, duplicate_keys = ?, error = ?
      WHERE id = ? AND status = 'running'`,
    [f.status, f.finishedAt, f.lastTrCont, f.sumCheck, f.pages, f.kisCalls, f.rowsSeen, f.rowsInserted, f.rowsUpdated, f.rowsStaleSkipped,
      f.duplicateKeys, f.error, runId]);
  return res.affectedRows === 1;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 행 단위 트랜잭션 + 교착 재시도
// ─────────────────────────────────────────────────────────────────────────────────────────────

export interface RetryDeps {
  sleep: (ms: number) => Promise<void>;
  /** [0, 1) 난수(시험용 주입). */
  random: () => number;
}

export type RowTxResult<T> = { ok: true; value: T; retries: number } | { ok: false; error: string; retries: number };

/** 한 행의 쓰기를 트랜잭션으로 감싸고 1213/1205 만 재시도한다. 그 밖의 오류·재시도 소진은 `{ok:false}`(그 행만 건너뛴다 — 던지지 않는다). */
export async function inRowTx<T>(conn: SqlConnection, fn: (c: SqlConnection) => Promise<T>, deps: RetryDeps): Promise<RowTxResult<T>> {
  let retries = 0;
  for (;;) {
    let began = false;
    try {
      await conn.beginTransaction();
      began = true;
      const value = await fn(conn);
      await conn.commit();
      return { ok: true, value, retries };
    } catch (e) {
      if (began) { try { await conn.rollback(); } catch { /* 연결 오류면 다음 쿼리가 드러낸다 */ } }
      if (isRetryableLockError(e) && retries < ROW_TX_MAX_RETRIES) {
        retries += 1;
        const span = ROW_TX_JITTER_MAX_MS - ROW_TX_JITTER_MIN_MS;
        await deps.sleep(ROW_TX_JITTER_MIN_MS + Math.floor(Math.min(Math.max(deps.random(), 0), 0.999999) * (span + 1)));
        continue;
      }
      return { ok: false, error: isRetryableLockError(e) ? `lock_retry_exhausted_${errnoOf(e)}` : errCode(e), retries };
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// broker_fills upsert
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** `stale` = 낡은 응답이라 건너뜀 · `stale_conflict` = 가드에 걸렸지만 체결수량은 **늘었다**(DB 보다 새 정보를 버렸다 — run 은 incomplete). */
export type UpsertOutcome = 'inserted' | 'updated' | 'unchanged' | 'stale' | 'stale_conflict';

export interface UpsertMeta {
  accountId: number;
  accountFingerprint: string;
  runId: number;
  /** 이 행을 본 시각(KST 문자열). */
  seenAt: string;
}

/** 원문열 + 수집기 파생열 `settle_state`(UPDATE 때 교체). `amount_krw_est` 는 KRW 행에서만 따로 다룬다. D2 파생열은 이 목록에 없다(L-5). */
export const FILL_REPLACE_COLS = [
  'local_order_date', 'orig_order_no', 'order_time', 'symbol', 'broker_symbol', 'exchange_code', 'side', 'currency',
  'order_qty', 'filled_qty', 'remaining_qty', 'cancelled_qty', 'rejected_qty', 'avg_fill_price', 'fill_amount',
  'order_type_code', 'revise_cancel_code', 'broker_status_name', 'reject_reason', 'fractional_hint', 'settle_state',
  'source_tr', 'raw_json',
] as const;

/** 수집기가 **절대** SET 하지 않는 D2 파생열(설계 §3.2 ⑤). 시험이 UPDATE 문에 이 열이 없음을 확인한다. */
export const D2_DERIVED_COLS = ['tax_native', 'fx_usdkrw', 'fx_source', 'app_order_id', 'reconcile_state', 'derived_for_revision'] as const;

interface CurrentFill {
  id: number;
  revision: number;
  raw_hash: string;
  raw_json: unknown;
  filled_qty: string;
  avg_fill_price: string;
  settle_state: string;
  fee_kind: string;
  first_seen_s: string;
  last_seen_s: string;
}

function jsonText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (Buffer.isBuffer(v)) return v.toString('utf8');
  return JSON.stringify(v);
}

/**
 * 단조 가드(설계 L-4·§3.2) — 취소·정정 신호가 **없는데**
 *  ① 체결수량이 줄었거나 ② closed 행이 closed 가 아닌 상태(open **또는 unknown**)로 바뀌면 덮어쓰지 않는다.
 *  ②에 unknown 을 넣은 이유(Dev-1 감사 반영): 정규화의 settle_state 는 잔량만 보고 정한다 — 잔량을 못 읽은 응답(unknown)이 이미 닫힌 행을
 *  "모름"으로 되돌리면 정보가 줄어든다. closed→open 은 설계대로 신호가 있을 때만.
 * 결과: 'ok'(써도 됨) / 'stale'(낡은 응답 — 건너뜀) / 'conflict'(②에 걸렸는데 체결수량은 **늘었다** — 새 정보를 버린 것이라 run 을 incomplete 로).
 * 수량을 읽을 수 없으면(있을 수 없는 일) 'stale'(덮어쓰지 않는 쪽 — fail-closed).
 */
export function fillUpdateGuard(cur: { filled_qty: string; settle_state: string }, next: NormalizedFill): 'ok' | 'stale' | 'conflict' {
  if (next.cancelOrReviseSignal) return 'ok';
  const a = parseDec(cur.filled_qty);
  const b = parseDec(next.row.filled_qty);
  if (a == null || b == null) return 'stale';
  if (b < a) return 'stale';
  if (cur.settle_state === 'closed' && next.row.settle_state !== 'closed') return b > a ? 'conflict' : 'stale';
  return 'ok';
}

/** {@link fillUpdateGuard} 가 'ok' 가 아니면 true. */
export function isStaleFillUpdate(cur: { filled_qty: string; settle_state: string }, next: NormalizedFill): boolean {
  return fillUpdateGuard(cur, next) !== 'ok';
}

export async function upsertFill(conn: SqlConnection, item: NormalizedFill, m: UpsertMeta): Promise<UpsertOutcome> {
  const r = item.row;
  const cur = (await rows<CurrentFill>(conn,
    `SELECT id, revision, raw_hash, raw_json, filled_qty, avg_fill_price, settle_state, fee_kind,
            ${DT('first_seen_at')} AS first_seen_s, ${DT('last_seen_at')} AS last_seen_s
       FROM broker_fills
      WHERE account_id = ? AND broker = ? AND market = ? AND order_date = ? AND broker_order_no = ?
      FOR UPDATE`,
    [m.accountId, BROKER, r.market, r.order_date, r.broker_order_no]))[0];

  if (!cur) {
    const fee = item.feeEstimate;
    const cols: [string, unknown][] = [
      ['account_id', m.accountId], ['account_fingerprint', m.accountFingerprint], ['broker', BROKER], ['market', r.market],
      ['order_date', r.order_date], ['broker_order_no', r.broker_order_no],
      ...FILL_REPLACE_COLS.map((c) => [c, r[c]] as [string, unknown]),
      ['amount_krw_est', r.currency === 'KRW' ? r.amount_krw_est : null],
      ['fee_kind', fee ? fee.fee_kind : 'unknown'], ['fee_native', fee ? fee.fee_native : null], ['fee_rate_pct', fee ? fee.fee_rate_pct : null],
      ['first_seen_at', m.seenAt], ['last_seen_at', m.seenAt], ['first_run_id', m.runId], ['last_run_id', m.runId],
      ['raw_hash', r.raw_hash],
    ];
    await conn.query(`INSERT INTO broker_fills (${cols.map(([c]) => c).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map(([, v]) => v));
    return 'inserted';
  }

  if (cur.raw_hash === r.raw_hash) {
    await conn.query('UPDATE broker_fills SET last_seen_at = ?, last_run_id = ? WHERE id = ?', [m.seenAt, m.runId, cur.id]);
    return 'unchanged';
  }

  const guard = fillUpdateGuard(cur, item);
  if (guard === 'stale') return 'stale';
  if (guard === 'conflict') return 'stale_conflict';

  // 교체되는 이전 원문 → revisions. seen_from = 그 revision 이 처음 보인 시각(1 이면 first_seen_at, 그 뒤면 그 revision 을 만든 run 의 시작 시각)
  let seenFrom = cur.first_seen_s;
  if (cur.revision > 1) {
    const p = await rows<{ s: string }>(conn,
      `SELECT ${DT('r.started_at')} AS s FROM broker_fill_revisions v JOIN broker_fill_runs r ON r.id = v.run_id WHERE v.fill_id = ? AND v.revision = ? LIMIT 1`,
      [cur.id, cur.revision - 1]);
    if (p[0]?.s) seenFrom = p[0].s;
  }
  await conn.query(
    `INSERT INTO broker_fill_revisions (fill_id, revision, raw_hash, raw_json, filled_qty, avg_fill_price, seen_from, seen_until, run_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [cur.id, cur.revision, cur.raw_hash, jsonText(cur.raw_json), cur.filled_qty, cur.avg_fill_price, seenFrom, cur.last_seen_s, m.runId]);

  await conn.query(...buildFillUpdate(cur, item, m));
  return 'updated';
}

/**
 * 내용이 바뀐 체결 행의 UPDATE 문(순수 — 시험이 열 목록·순서를 직접 본다).
 *  - 원문열·`settle_state` 교체, KRW 행만 `amount_krw_est`(USD 행은 D2 소유 — 환율), `fee_*` 는 현재 fee_kind 가 unknown/estimated 일 때만(L-5),
 *    D2 파생열({@link D2_DERIVED_COLS})은 넣지 않는다.
 *  - 🔴 `raw_hash` 는 SET 목록의 **마지막**(설계 §3.2 ④). 이 구현은 SELECT … FOR UPDATE 뒤 별도 UPDATE 라 순서가 결과를 바꾸지는 않지만,
 *    단일문 ON DUPLICATE KEY UPDATE 로 바꾸는 순간 "해시만 전진·변경 유실"이 되므로 규약으로 고정한다(시험).
 */
export function buildFillUpdate(cur: { id: number; fee_kind: string }, item: NormalizedFill, m: UpsertMeta): [string, unknown[]] {
  const r = item.row;
  const assign: string[] = [];
  const vals: unknown[] = [];
  const set = (c: string, v: unknown) => { assign.push(`${c} = ?`); vals.push(v); };
  for (const c of FILL_REPLACE_COLS) set(c, r[c]);
  if (r.currency === 'KRW') set('amount_krw_est', r.amount_krw_est);
  if (cur.fee_kind === 'unknown' || cur.fee_kind === 'estimated') {
    const fee = item.feeEstimate;
    set('fee_kind', fee ? fee.fee_kind : 'unknown');
    set('fee_native', fee ? fee.fee_native : null);
    set('fee_rate_pct', fee ? fee.fee_rate_pct : null);
  }
  assign.push('revision = revision + 1');
  set('last_seen_at', m.seenAt);
  set('last_run_id', m.runId);
  set('raw_hash', r.raw_hash);   // 🔴 마지막
  return [`UPDATE broker_fills SET ${assign.join(', ')} WHERE id = ?`, [...vals, cur.id]];
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// broker_realized_pnl upsert — revisions 표 없음(DDL). 원문이 바뀌면 revision+1 하고 run.error 로 드러낸다
// ─────────────────────────────────────────────────────────────────────────────────────────────

export const PNL_REPLACE_COLS = [
  'broker_symbol', 'exchange_code', 'currency', 'sell_qty', 'buy_qty', 'sell_amount_native', 'buy_amount_native', 'avg_sell_price',
  'avg_buy_price', 'realized_pnl_native', 'fee_native', 'tax_native', 'loan_interest_native', 'pnl_rate_pct', 'fx_usdkrw', 'fx_first_notice',
  'source_tr', 'raw_json',
] as const;

export async function upsertRealizedPnl(conn: SqlConnection, item: NormalizedRealizedPnl, m: UpsertMeta): Promise<UpsertOutcome> {
  const r = item.row;
  const cur = (await rows<{ id: number; raw_hash: string }>(conn,
    `SELECT id, raw_hash FROM broker_realized_pnl
      WHERE account_id = ? AND broker = ? AND market = ? AND trade_date = ? AND grain = ? AND symbol = ? FOR UPDATE`,
    [m.accountId, BROKER, r.market, r.trade_date, r.grain, r.symbol]))[0];
  if (!cur) {
    const cols: [string, unknown][] = [
      ['account_id', m.accountId], ['account_fingerprint', m.accountFingerprint], ['broker', BROKER], ['market', r.market],
      ['trade_date', r.trade_date], ['grain', r.grain], ['symbol', r.symbol],
      ...PNL_REPLACE_COLS.map((c) => [c, r[c]] as [string, unknown]),
      ['first_seen_at', m.seenAt], ['last_seen_at', m.seenAt], ['first_run_id', m.runId], ['last_run_id', m.runId],
      ['raw_hash', r.raw_hash],
    ];
    await conn.query(`INSERT INTO broker_realized_pnl (${cols.map(([c]) => c).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map(([, v]) => v));
    return 'inserted';
  }
  if (cur.raw_hash === r.raw_hash) {
    await conn.query('UPDATE broker_realized_pnl SET last_seen_at = ?, last_run_id = ? WHERE id = ?', [m.seenAt, m.runId, cur.id]);
    return 'unchanged';
  }
  const assign: string[] = [];
  const vals: unknown[] = [];
  for (const c of PNL_REPLACE_COLS) { assign.push(`${c} = ?`); vals.push(r[c]); }
  assign.push('revision = revision + 1', 'last_seen_at = ?', 'last_run_id = ?', 'raw_hash = ?');   // raw_hash 마지막
  vals.push(m.seenAt, m.runId, r.raw_hash);
  await conn.query(`UPDATE broker_realized_pnl SET ${assign.join(', ')} WHERE id = ?`, [...vals, cur.id]);
  return 'updated';
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// broker_position_snapshots upsert — 같은 날 두 번 돌면(수동+크론) 같은 키. 값이 바뀌었으면 최신 조회로 교체
// ─────────────────────────────────────────────────────────────────────────────────────────────

export const SNAPSHOT_REPLACE_COLS = [
  'broker_symbol', 'exchange_code', 'currency', 'qty', 'avg_price_native', 'purchase_amount_native', 'source_tr', 'raw_json',
] as const;

export async function upsertPositionSnapshot(conn: SqlConnection, item: NormalizedPositionSnapshot, m: UpsertMeta): Promise<UpsertOutcome> {
  const r = item.row;
  const cur = (await rows<{ id: number; raw_hash: string }>(conn,
    'SELECT id, raw_hash FROM broker_position_snapshots WHERE account_id = ? AND broker = ? AND market = ? AND as_of = ? AND symbol = ? FOR UPDATE',
    [m.accountId, BROKER, r.market, r.as_of, r.symbol]))[0];
  if (!cur) {
    const cols: [string, unknown][] = [
      ['account_id', m.accountId], ['account_fingerprint', m.accountFingerprint], ['broker', BROKER], ['market', r.market],
      ['as_of', r.as_of], ['is_baseline', 0], ['symbol', r.symbol],
      ...SNAPSHOT_REPLACE_COLS.map((c) => [c, r[c]] as [string, unknown]),
      ['cost_includes_fee', r.cost_includes_fee], ['captured_at', m.seenAt], ['run_id', m.runId],
      ['raw_hash', r.raw_hash],
    ];
    await conn.query(`INSERT INTO broker_position_snapshots (${cols.map(([c]) => c).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map(([, v]) => v));
    return 'inserted';
  }
  if (cur.raw_hash === r.raw_hash) return 'unchanged';   // 같은 날 같은 값 — 처음 잡은 시각을 남긴다
  const sets: [string, unknown][] = [...SNAPSHOT_REPLACE_COLS.map((c) => [c, r[c]] as [string, unknown]), ['captured_at', m.seenAt], ['run_id', m.runId], ['raw_hash', r.raw_hash]];
  await conn.query(`UPDATE broker_position_snapshots SET ${sets.map(([c]) => `${c} = ?`).join(', ')} WHERE id = ?`, [...sets.map(([, v]) => v), cur.id]);
  return 'updated';
}

/**
 * baseline 표시(설계 §4.3 — D1a 는 기록만). 규칙: (계좌·시장)의 **첫 complete 잔고 run 의 조회일** 행이 baseline 이다.
 * 이 run 이 complete 이고 그보다 이른 날의 complete 잔고 run 이 없으면 그날(as_of) 행 전부를 is_baseline=1 로 둔다. 같은 날 다시 돌아도 같은 규칙.
 * 보유 0 이라 행이 없어도 baseline 날은 runs 로 정해진다(D2 는 runs 에서 baseline 날을 읽는다). 바꾼 행 수를 돌려준다.
 */
export async function markBaselineIfFirst(q: SqlQueryable, accountId: number, market: BrokerMarket, asOf: string): Promise<number> {
  const prior = await rows<{ one: number }>(q,
    "SELECT 1 AS one FROM broker_fill_runs WHERE account_id = ? AND market = ? AND kind = 'position_snapshot' AND status = 'complete' AND window_from < ? LIMIT 1",
    [accountId, market, asOf]);
  if (prior.length > 0) return 0;
  const res = await exec(q,
    'UPDATE broker_position_snapshots SET is_baseline = 1 WHERE account_id = ? AND broker = ? AND market = ? AND as_of = ? AND is_baseline = 0',
    [accountId, BROKER, market, asOf]);
  return res.affectedRows;
}
