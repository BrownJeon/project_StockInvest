/**
 * T-143 WP-A — 월간 산출 저장소. **DB 만 읽고 쓴다**(KIS·SEC·외부 호출 0건, 주문·시그널 0건).
 *
 * 정본: `docs/design/2026-11-01-t143-wpa-nyse50-spec.md` §3·§7.
 *
 * 쓰는 표는 네 개다 — 신규 `overseas_universe_run`·`overseas_universe_candidate`(WP-A 소유),
 * 그리고 WP-B 소유의 `overseas_universe_auto`(현재 목록을 **한 트랜잭션에서 통째로** 교체) ·
 * `overseas_universe_proposal`(INSERT IGNORE 만 — 상태 전이는 화면이 한다).
 * `orders`·`signals`·`position_state` 에 쓰지 않고 `src/lib/safety/**` 를 import 하지 않는다.
 *
 * 마이그레이션 적용 전에는 errno 1146 을 받아 `not_migrated` 로 돌려준다(라우트가 `tables_missing` 으로 끝낸다).
 */
import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '@/lib/db';
import {
  isDupEntry, isNoSuchTable, kstSql, type Queryable, type TxConnection,
} from './store';
import type { ProposalDraft } from './proposal-rules';

function pool(): Queryable {
  return getPool() as unknown as Queryable;
}
function rowsOf<T>(out: unknown): T[] {
  return Array.isArray(out) ? (out as T[]) : [];
}
function intOf(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : null;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Math.trunc(Number(v.trim()));
  return null;
}
function numOf(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}
function strOf(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}
function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
/** VARCHAR 열에 넣기 전에 코드포인트 단위로 자른다(비 strict DB 에서 조용히 잘리지 않게 앱이 먼저 자른다). */
function clamp(s: string | null, max: number): string | null {
  if (s == null) return null;
  const cp = [...s];
  return cp.length <= max ? s : cp.slice(0, max).join('');
}

export type RunPhase = 'listing' | 'scan' | 'retry' | 'finalize' | 'complete' | 'failed' | 'expired';
/** 더 부를 필요가 없는 단계. */
export const TERMINAL_PHASES: readonly RunPhase[] = ['complete', 'failed', 'expired'];
export function isTerminalPhase(p: RunPhase): boolean {
  return TERMINAL_PHASES.includes(p);
}

export interface RunRow {
  runId: number;
  runKey: string;
  phase: RunPhase;
  topN: number;
  cursorPos: number;
  secSha256: string | null;
  lastError: string | null;
  notifiedAt: string | null;
}

export type StoreOutcome<T> = { kind: 'ok'; data: T } | { kind: 'not_migrated' } | { kind: 'error'; error: string };

function wrap<T>(e: unknown, label: string): StoreOutcome<T> {
  if (isNoSuchTable(e)) return { kind: 'not_migrated' };
  console.error(`[universe/refresh-store] ${label} 실패: ${errText(e).slice(0, 200)}`);
  return { kind: 'error', error: errText(e) };
}

const RUN_SELECT = `SELECT run_id, run_key, phase, top_n, cursor_pos, sec_sha256, last_error, notified_at
                      FROM overseas_universe_run WHERE run_key = ? LIMIT 1`;

function toRunRow(r: RowDataPacket): RunRow {
  return {
    runId: intOf(r.run_id) ?? 0,
    runKey: String(r.run_key ?? ''),
    phase: (strOf(r.phase) ?? 'failed') as RunPhase,
    topN: intOf(r.top_n) ?? 0,
    cursorPos: intOf(r.cursor_pos) ?? 0,
    secSha256: strOf(r.sec_sha256),
    lastError: strOf(r.last_error),
    notifiedAt: strOf(r.notified_at),
  };
}

/** 이달 run 을 읽는다. 없으면 `null`. */
export async function readRun(runKey: string, db: Queryable = pool()): Promise<StoreOutcome<RunRow | null>> {
  try {
    const [out] = await db.query<RowDataPacket[]>(RUN_SELECT, [runKey]);
    const r = rowsOf<RowDataPacket>(out)[0];
    return { kind: 'ok', data: r ? toRunRow(r) : null };
  } catch (e) {
    return wrap(e, 'run 조회');
  }
}

/**
 * 이달 run 을 만든다 — `run_key` UNIQUE 라 두 호출이 겹치면 둘째가 1062 로 실패하고 **그때 다시 읽어** 돌려준다
 * (잠금 없이 「월 1건」이 성립한다. 러너는 직렬이지만 수동 호출이 겹칠 수 있다).
 */
export async function createRun(
  args: { runKey: string; topN: number; nowMs: number; db?: Queryable },
): Promise<StoreOutcome<RunRow>> {
  const db = args.db ?? pool();
  const now = kstSql(args.nowMs);
  try {
    try {
      await db.query(
        `INSERT INTO overseas_universe_run (run_key, phase, top_n, cursor_pos, started_at, updated_at)
         VALUES (?, 'listing', ?, 0, ?, ?)`,
        [args.runKey, args.topN, now, now],
      );
    } catch (e) {
      if (!isDupEntry(e)) throw e;
    }
    const again = await readRun(args.runKey, db);
    if (again.kind !== 'ok') return again;
    if (!again.data) return { kind: 'error', error: 'run 을 만들었는데 다시 읽지 못함' };
    return { kind: 'ok', data: again.data };
  } catch (e) {
    return wrap(e, 'run 생성');
  }
}

/** `listing` 이 만든 후보 1행. */
export interface CandidateInsert {
  ord: number;
  symbol: string;
  secTicker: string;
  cik: number;
  secName: string | null;
  kisSymb: string | null;
  /** 마스터 영문명 — ADR 표지의 **실제 출처**(SEC `name` 에는 없다). 보고용이고 제외 근거가 아니다. */
  kisEnam: string | null;
  kisStis: string | null;
  kisIsdr: string | null;
  kisEtyp: string | null;
  status: 'pending' | 'excluded';
  exclusion: string | null;
}

const CANDIDATE_COLS = '(run_id, ord, symbol, sec_ticker, cik, sec_name, kis_symb, kis_enam, kis_stis, kis_isdr, kis_etyp, status, exclusion)';
/** 한 INSERT 에 담는 행 수 — 2,763행을 한 문장으로 보내면 `max_allowed_packet` 에 가까워진다. */
export const CANDIDATE_INSERT_CHUNK = 400;

/**
 * 후보를 한 트랜잭션으로 넣고 run 을 `scan` 으로 옮긴다. **전부 아니면 전무** —
 * 반쪽 후보 표로 스캔을 시작하면 상위 N 이 조용히 틀린다(빠진 종목이 「후보 아님」과 구별되지 않는다).
 */
export async function saveListing(args: {
  runId: number;
  candidates: readonly CandidateInsert[];
  sec: { fetchedAtMs: number; sha256: string; rows: number };
  master: { fetchedAtMs: number; sha256: string; rows: number };
  countsJson: string;
  nowMs: number;
  getConnection?: () => Promise<TxConnection>;
}): Promise<StoreOutcome<{ inserted: number }>> {
  let conn: TxConnection;
  try {
    conn = args.getConnection
      ? await args.getConnection()
      : ((await getPool().getConnection()) as unknown as TxConnection);
  } catch (e) {
    return { kind: 'error', error: `connection:${errText(e)}` };
  }
  // T-139 규칙 — 되돌리기까지 실패한 연결은 풀에 돌려주지 않고 버린다(열린 트랜잭션이 남은 연결이 재사용되지 않게)
  let discard = false;
  try {
    await conn.beginTransaction();
    try {
      // 재시작 뒤 같은 run 이 다시 listing 을 돌 수 있다 — 이전 시도의 후보를 비우고 다시 넣는다(멱등)
      await conn.query('DELETE FROM overseas_universe_candidate WHERE run_id = ?', [args.runId]);
      for (let i = 0; i < args.candidates.length; i += CANDIDATE_INSERT_CHUNK) {
        const chunk = args.candidates.slice(i, i + CANDIDATE_INSERT_CHUNK);
        const placeholders = chunk.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
        const params: unknown[] = [];
        for (const c of chunk) {
          params.push(
            args.runId, c.ord, clamp(c.symbol, 32), clamp(c.secTicker, 16), c.cik, clamp(c.secName, 200),
            clamp(c.kisSymb, 16), clamp(c.kisEnam, 200), c.kisStis, c.kisIsdr, c.kisEtyp, c.status, clamp(c.exclusion, 32),
          );
        }
        await conn.query(`INSERT INTO overseas_universe_candidate ${CANDIDATE_COLS} VALUES ${placeholders}`, params);
      }
      await conn.query(
        `UPDATE overseas_universe_run
            SET phase = 'scan', cursor_pos = 0, sec_fetched_at = ?, sec_sha256 = ?, sec_rows = ?,
                master_fetched_at = ?, master_sha256 = ?, master_rows = ?, counts_json = ?, updated_at = ?
          WHERE run_id = ?`,
        [
          kstSql(args.sec.fetchedAtMs), args.sec.sha256, args.sec.rows,
          kstSql(args.master.fetchedAtMs), args.master.sha256, args.master.rows,
          args.countsJson, kstSql(args.nowMs), args.runId,
        ],
      );
      await conn.commit();
    } catch (e) {
      await conn.rollback().catch(() => { discard = true; });
      throw e;
    }
  } catch (e) {
    discard = true;
    return wrap(e, 'listing 저장');
  } finally {
    if (discard) conn.destroy(); else conn.release();
  }
  return { kind: 'ok', data: { inserted: args.candidates.length } };
}

export interface PendingCandidate {
  ord: number;
  symbol: string;
  kisSymb: string | null;
  attempts: number;
}

/**
 * 스캔 대상 — `pending` 을 `ord` 순으로. `cursor_pos` 를 WHERE 에 쓰지 않고 **상태로** 고른다:
 * 커서는 「어디까지 왔나」의 표시이고, 중간에 유량 실패로 남은 종목은 다음 청크가 다시 집어야 한다.
 */
export async function readPendingCandidates(
  args: { runId: number; limit: number; db?: Queryable },
): Promise<StoreOutcome<PendingCandidate[]>> {
  const db = args.db ?? pool();
  try {
    const [out] = await db.query<RowDataPacket[]>(
      `SELECT ord, symbol, kis_symb, attempts FROM overseas_universe_candidate
        WHERE run_id = ? AND status = 'pending' ORDER BY ord ASC LIMIT ?`,
      [args.runId, Math.max(1, Math.trunc(args.limit))],
    );
    return {
      kind: 'ok',
      data: rowsOf<RowDataPacket>(out).map((r) => ({
        ord: intOf(r.ord) ?? 0,
        symbol: String(r.symbol ?? ''),
        kisSymb: strOf(r.kis_symb),
        attempts: intOf(r.attempts) ?? 0,
      })),
    };
  } catch (e) {
    return wrap(e, '스캔 대상 조회');
  }
}

/** `retry` 단계 대상 — 한 번만 더 본다(`attempts < 2`). */
export async function readRetryCandidates(
  args: { runId: number; limit: number; db?: Queryable },
): Promise<StoreOutcome<PendingCandidate[]>> {
  const db = args.db ?? pool();
  try {
    const [out] = await db.query<RowDataPacket[]>(
      `SELECT ord, symbol, kis_symb, attempts FROM overseas_universe_candidate
        WHERE run_id = ? AND status = 'kis_error' AND attempts < 2 ORDER BY ord ASC LIMIT ?`,
      [args.runId, Math.max(1, Math.trunc(args.limit))],
    );
    return {
      kind: 'ok',
      data: rowsOf<RowDataPacket>(out).map((r) => ({
        ord: intOf(r.ord) ?? 0,
        symbol: String(r.symbol ?? ''),
        kisSymb: strOf(r.kis_symb),
        attempts: intOf(r.attempts) ?? 0,
      })),
    };
  } catch (e) {
    return wrap(e, '재시도 대상 조회');
  }
}

/** 한 종목의 스캔 결과. 원값만 담는다(해석은 `finalize` 가 한다). */
export type ScanOutcome =
  | {
    ord: number; status: 'ok';
    tomv: number | null; shar: number | null; last: number | null;
    curr: string | null; etypNm: string | null; rsym: string | null;
  }
  | { ord: number; status: 'kis_missing' | 'kis_error'; error: string };

/** 결과를 종목마다 반영한다(한 종목의 실패가 다른 종목을 막지 않게 문장을 따로 보낸다). */
export async function applyScanOutcome(
  args: { runId: number; outcome: ScanOutcome; nowMs: number; db?: Queryable },
): Promise<void> {
  const db = args.db ?? pool();
  const o = args.outcome;
  if (o.status === 'ok') {
    await db.query(
      `UPDATE overseas_universe_candidate
          SET status = 'ok', tomv = ?, shar = ?, last_price = ?, curr = ?, etyp_nm = ?, rsym = ?,
              attempts = attempts + 1, error = NULL, fetched_at = ?
        WHERE run_id = ? AND ord = ?`,
      [
        o.tomv, o.shar, o.last, clamp(o.curr, 8), clamp(o.etypNm, 64), clamp(o.rsym, 32),
        kstSql(args.nowMs), args.runId, o.ord,
      ],
    );
    return;
  }
  await db.query(
    `UPDATE overseas_universe_candidate
        SET status = ?, attempts = attempts + 1, error = ?, fetched_at = ?
      WHERE run_id = ? AND ord = ?`,
    [o.status, clamp(o.error, 160), kstSql(args.nowMs), args.runId, o.ord],
  );
}

/** 커서·단계 전진. 커서는 진행 표시라 **뒤로 가지 않는다**(GREATEST). */
export async function advanceRun(
  args: { runId: number; phase?: RunPhase; cursorPos?: number; nowMs: number; db?: Queryable },
): Promise<void> {
  const db = args.db ?? pool();
  const sets: string[] = ['updated_at = ?'];
  const params: unknown[] = [kstSql(args.nowMs)];
  if (args.phase) { sets.push('phase = ?'); params.push(args.phase); }
  if (args.cursorPos != null) { sets.push('cursor_pos = GREATEST(cursor_pos, ?)'); params.push(Math.max(0, Math.trunc(args.cursorPos))); }
  params.push(args.runId);
  await db.query(`UPDATE overseas_universe_run SET ${sets.join(', ')} WHERE run_id = ?`, params);
}

/** run 을 실패·만료로 닫는다. 자동 목록은 **건드리지 않는다**(마지막 성공 목록이 남는다). */
export async function closeRun(
  args: { runId: number; phase: 'failed' | 'expired'; error: string; nowMs: number; db?: Queryable },
): Promise<void> {
  const db = args.db ?? pool();
  await db.query(
    `UPDATE overseas_universe_run SET phase = ?, last_error = ?, finished_at = ?, updated_at = ? WHERE run_id = ?`,
    [args.phase, clamp(args.error, 255), kstSql(args.nowMs), kstSql(args.nowMs), args.runId],
  );
}

/**
 * **직전 달** run 의 단계 — 없으면 `null`. 「지난 달 산출이 완료되지 않았다」를 **매 호출** 판정하는 데 쓴다.
 *
 * 🔴 왜 「닫은 수」가 아니라 이것인가(Reviewer r2 ②): `expireOldRuns` 가 돌려주는 수는 **단 한 호출**에서만
 * 0보다 크고, 창 안 모든 호출이 같은 슬롯으로 모여 `RUN_ODKU` 가 마지막 호출 상태로 **덮어쓴다** →
 * 그 신호는 슬롯 최종값에서 사라진다. 이 질의는 **조건을 되풀이**하므로 마지막 호출에도 같은 값이 남는다.
 */
export async function readPrevMonthRunPhase(
  args: { runKey: string; db?: Queryable },
): Promise<StoreOutcome<RunPhase | null>> {
  const db = args.db ?? pool();
  try {
    const [out] = await db.query<RowDataPacket[]>(
      'SELECT phase FROM overseas_universe_run WHERE run_key = ? LIMIT 1',
      [prevRunKey(args.runKey)],
    );
    const r = rowsOf<RowDataPacket>(out)[0];
    return { kind: 'ok', data: r ? ((strOf(r.phase) ?? 'failed') as RunPhase) : null };
  } catch (e) {
    return wrap(e, '직전 달 run 조회');
  }
}

/** `'2026-12'` → `'2026-11'`. 형식이 아니면 그대로 돌려준다(질의가 0행이 된다). */
export function prevRunKey(runKey: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(runKey);
  if (!m) return runKey;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  return mo <= 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`;
}

/** 끝나지 않은 지난 달 run 들을 `expired` 로 닫는다(다음 달 창이 열릴 때). 닫은 수를 돌려준다. */
export async function expireOldRuns(
  args: { runKey: string; nowMs: number; db?: Queryable },
): Promise<StoreOutcome<number>> {
  const db = args.db ?? pool();
  try {
    const [res] = await db.query(
      `UPDATE overseas_universe_run
          SET phase = 'expired', last_error = 'window_passed', finished_at = ?, updated_at = ?
        WHERE run_key < ? AND phase NOT IN ('complete', 'failed', 'expired')`,
      [kstSql(args.nowMs), kstSql(args.nowMs), args.runKey],
    );
    return { kind: 'ok', data: (res as { affectedRows?: number } | null)?.affectedRows ?? 0 };
  } catch (e) {
    return wrap(e, '지난 run 만료');
  }
}

export interface FinalizeRow {
  ord: number;
  symbol: string;
  cik: number;
  /** SEC 회사명 — 참고용. ⚠ **ADR 표지가 없다**(실측 적중 0) → 이름 신호는 `kisEnam` 으로 본다. */
  secName: string | null;
  /** 마스터 영문명 — 외국 발행사 이름 표지의 **실제 출처**(high-1 보고용, 제외 근거 아님). */
  kisEnam: string | null;
  curr: string | null;
  etypNm: string | null;
  tomv: number | null;
  shar: number | null;
  last: number | null;
  isDr: boolean;
}

/** `finalize` 입력 — 스캔이 성공한 후보만(제외분은 이미 사유가 적혀 있다). */
export async function readFinalizeRows(
  args: { runId: number; db?: Queryable },
): Promise<StoreOutcome<FinalizeRow[]>> {
  const db = args.db ?? pool();
  try {
    const [out] = await db.query<RowDataPacket[]>(
      `SELECT ord, symbol, cik, sec_name, kis_enam, curr, etyp_nm, tomv, shar, last_price, kis_isdr
         FROM overseas_universe_candidate WHERE run_id = ? AND status = 'ok' ORDER BY ord ASC`,
      [args.runId],
    );
    return {
      kind: 'ok',
      data: rowsOf<RowDataPacket>(out).map((r) => ({
        ord: intOf(r.ord) ?? 0,
        symbol: String(r.symbol ?? ''),
        cik: intOf(r.cik) ?? 0,
        secName: strOf(r.sec_name),
        kisEnam: strOf(r.kis_enam),
        curr: strOf(r.curr),
        etypNm: strOf(r.etyp_nm),
        tomv: numOf(r.tomv),
        shar: numOf(r.shar),
        last: numOf(r.last_price),
        isDr: strOf(r.kis_isdr) === 'Y',
      })),
    };
  } catch (e) {
    return wrap(e, 'finalize 대상 조회');
  }
}

/** 직전 **complete** run 의 상위 N 심볼(없으면 빈 배열 = 1회차). */
export async function readPrevTopSymbols(
  args: { runId: number; db?: Queryable },
): Promise<StoreOutcome<string[]>> {
  const db = args.db ?? pool();
  try {
    const [runOut] = await db.query<RowDataPacket[]>(
      `SELECT run_id FROM overseas_universe_run
        WHERE phase = 'complete' AND run_id < ? ORDER BY run_id DESC LIMIT 1`,
      [args.runId],
    );
    const prev = intOf(rowsOf<RowDataPacket>(runOut)[0]?.run_id);
    if (prev == null) return { kind: 'ok', data: [] };
    const [out] = await db.query<RowDataPacket[]>(
      `SELECT symbol FROM overseas_universe_candidate
        WHERE run_id = ? AND rank_no IS NOT NULL ORDER BY rank_no ASC`,
      [prev],
    );
    return { kind: 'ok', data: rowsOf<RowDataPacket>(out).map((r) => String(r.symbol ?? '')).filter(Boolean) };
  } catch (e) {
    return wrap(e, '직전 목록 조회');
  }
}

/** 판정 결과를 후보 행에 되쓸 입력. */
export interface CandidateVerdict {
  ord: number;
  capUsed: number | null;
  capAlt: number | null;
  capSource: string | null;
  capRatio: number | null;
  capFlag: string | null;
  exclusion: string | null;
  rankNo: number | null;
}

/** 상위 N 1행 — `overseas_universe_auto` 에 들어간다. */
export interface AutoRow {
  symbol: string;
  rankNo: number;
  marketCap: number | null;
}

/**
 * 산출을 확정한다 — **한 트랜잭션**이다.
 *
 * 🔴 `overseas_universe_auto` 를 비우고 다시 채우는 사이에 분석·화면이 읽으면 **반쪽 목록**을 본다.
 * 그래서 DELETE + INSERT 를 한 트랜잭션에 묶는다. `computed_at` 은 N행 모두 **같은 값**이다
 * (WP-B `buildSummary` 가 MAX 를 「산출 시각」으로 쓴다 — 행마다 다르면 그 시각이 뜻을 잃는다).
 *
 * 상위 N 이 비어 있으면 **자동 목록을 건드리지 않고** 던진다 — 호출부가 `failed` 로 닫는다
 * (50을 못 채우는 상태는 원천이 깨진 것이고, 그때 기존 목록을 지우면 분석 대상이 조용히 줄어든다).
 */
export async function finalizeRun(args: {
  runId: number;
  verdicts: readonly CandidateVerdict[];
  auto: readonly AutoRow[];
  countsJson: string;
  added: readonly string[];
  removed: readonly string[];
  nowMs: number;
  getConnection?: () => Promise<TxConnection>;
}): Promise<StoreOutcome<{ autoRows: number }>> {
  if (args.auto.length === 0) return { kind: 'error', error: 'empty_top — 자동 목록을 바꾸지 않는다' };
  let conn: TxConnection;
  try {
    conn = args.getConnection
      ? await args.getConnection()
      : ((await getPool().getConnection()) as unknown as TxConnection);
  } catch (e) {
    return { kind: 'error', error: `connection:${errText(e)}` };
  }
  let discard = false;
  const now = kstSql(args.nowMs);
  try {
    await conn.beginTransaction();
    try {
      /**
       * 판정 되쓰기 — **후보 1건에 UPDATE 1문장**이다(2026-11-01 실측 기준 약 2,000문장).
       *
       * 왜 묶지 않았나: 묶으려면 `INSERT … ON DUPLICATE KEY UPDATE` 로 보내야 하고 그러면 NOT NULL 열
       * (`symbol`·`sec_ticker`·`cik`)을 **다시 실어야** 한다 — 판정만 쓰는 자리에 원본 값을 다시 보내면
       * 그 값이 틀렸을 때 **후보 표를 덮어쓴다**. 한 문장씩 쓰면 `WHERE run_id = ? AND ord = ?` 로
       * 판정 열만 건드린다. 대가는 왕복 수이고, `finalize` 는 호출 1회(예산 100초) 안에서 한 번만 돈다.
       * 이 단계가 예산을 넘기면 그때 묶는다(`sec_ticker` 를 함께 읽어 와야 한다).
       *
       * `exclusion = COALESCE(exclusion, ?)` — listing 때 이미 붙은 사유를 덮지 않는다.
       * `status = IF(? IS NULL, status, 'excluded')` — 제외 사유가 있을 때만 상태를 바꾼다(상위 N 은 `ok` 로 남는다).
       */
      for (const v of args.verdicts) {
        await conn.query(
          `UPDATE overseas_universe_candidate
              SET cap_used = ?, cap_alt = ?, cap_source = ?, cap_ratio = ?, cap_flag = ?,
                  exclusion = COALESCE(exclusion, ?), status = IF(? IS NULL, status, 'excluded'), rank_no = ?
            WHERE run_id = ? AND ord = ?`,
          [
            v.capUsed, v.capAlt, clamp(v.capSource, 16), v.capRatio, clamp(v.capFlag, 24),
            clamp(v.exclusion, 32), clamp(v.exclusion, 32), v.rankNo, args.runId, v.ord,
          ],
        );
      }
      await conn.query('DELETE FROM overseas_universe_auto');
      const placeholders = args.auto.map(() => '(?,?,?,?)').join(',');
      const params: unknown[] = [];
      for (const a of args.auto) params.push(clamp(a.symbol, 32), a.rankNo, a.marketCap, now);
      await conn.query(
        `INSERT INTO overseas_universe_auto (symbol, rank_no, market_cap, computed_at) VALUES ${placeholders}`,
        params,
      );
      await conn.query(
        `UPDATE overseas_universe_run
            SET phase = 'complete', counts_json = ?, added_symbols = ?, removed_symbols = ?,
                finished_at = ?, updated_at = ?, last_error = NULL
          WHERE run_id = ?`,
        [args.countsJson, JSON.stringify(args.added), JSON.stringify(args.removed), now, now, args.runId],
      );
      await conn.commit();
    } catch (e) {
      await conn.rollback().catch(() => { discard = true; });
      throw e;
    }
  } catch (e) {
    discard = true;
    return wrap(e, 'finalize');
  } finally {
    if (discard) conn.destroy(); else conn.release();
  }
  return { kind: 'ok', data: { autoRows: args.auto.length } };
}

/**
 * 변경 제안을 넣는다 — **`INSERT IGNORE`**. 같은 지문(`basis_fingerprint` UNIQUE)이 이미 있으면
 * 어떤 상태든(`done`·`ignored` 포함) 다시 만들지 않는다. 멱등이다.
 * 넣은 행의 id 와 수를 돌려준다(알림 대상).
 */
export async function insertProposals(args: {
  drafts: readonly ProposalDraft[];
  collectedAtMs: number | null;
  nowMs: number;
  db?: Queryable;
}): Promise<StoreOutcome<{ inserted: { id: number; symbol: string; kind: string; nextSymbol: string | null }[] }>> {
  const db = args.db ?? pool();
  const inserted: { id: number; symbol: string; kind: string; nextSymbol: string | null }[] = [];
  try {
    for (const d of args.drafts) {
      const [res] = await db.query(
        `INSERT IGNORE INTO overseas_universe_proposal
           (symbol, kind, basis_text, basis_source, basis_fingerprint, collected_at, recommendation,
            action_type, next_symbol, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
        [
          clamp(d.symbol, 32), clamp(d.kind, 32), clamp(d.basisText, 255), d.basisSource,
          clamp(d.basisFingerprint, 190), args.collectedAtMs == null ? null : kstSql(args.collectedAtMs),
          clamp(d.recommendation, 255), d.actionType, clamp(d.nextSymbol, 32),
          kstSql(args.nowMs), kstSql(args.nowMs),
        ],
      );
      const r = res as { affectedRows?: number; insertId?: number } | null;
      if ((r?.affectedRows ?? 0) > 0 && r?.insertId) {
        inserted.push({ id: r.insertId, symbol: d.symbol, kind: d.kind, nextSymbol: d.nextSymbol });
      }
    }
    return { kind: 'ok', data: { inserted } };
  } catch (e) {
    return wrap(e, '제안 생성');
  }
}

/** 알림을 보낸 뒤에만 부른다 — 같은 제안이 두 번 알리지 않게. */
export async function markProposalsNotified(
  args: { ids: readonly number[]; nowMs: number; db?: Queryable },
): Promise<void> {
  if (args.ids.length === 0) return;
  const db = args.db ?? pool();
  await db.query(
    `UPDATE overseas_universe_proposal SET notified_at = ?
      WHERE proposal_id IN (${args.ids.map(() => '?').join(',')}) AND notified_at IS NULL`,
    [kstSql(args.nowMs), ...args.ids],
  );
}

/** run 의 자동 목록 변동 알림 시각. */
export async function markRunNotified(
  args: { runId: number; nowMs: number; db?: Queryable },
): Promise<void> {
  const db = args.db ?? pool();
  await db.query(
    'UPDATE overseas_universe_run SET notified_at = ? WHERE run_id = ? AND notified_at IS NULL',
    [kstSql(args.nowMs), args.runId],
  );
}

/** 진행 집계 — 응답의 `progress`. */
export interface ScanProgress {
  pending: number; ok: number; excluded: number; kisMissing: number; kisError: number; total: number;
}

export async function readProgress(
  args: { runId: number; db?: Queryable },
): Promise<StoreOutcome<ScanProgress>> {
  const db = args.db ?? pool();
  try {
    const [out] = await db.query<RowDataPacket[]>(
      `SELECT status, COUNT(*) AS n FROM overseas_universe_candidate WHERE run_id = ? GROUP BY status`,
      [args.runId],
    );
    const by: Record<string, number> = {};
    for (const r of rowsOf<RowDataPacket>(out)) by[String(r.status ?? '')] = intOf(r.n) ?? 0;
    const p: ScanProgress = {
      pending: by.pending ?? 0, ok: by.ok ?? 0, excluded: by.excluded ?? 0,
      kisMissing: by.kis_missing ?? 0, kisError: by.kis_error ?? 0, total: 0,
    };
    p.total = p.pending + p.ok + p.excluded + p.kisMissing + p.kisError;
    return { kind: 'ok', data: p };
  } catch (e) {
    return wrap(e, '진행 집계 조회');
  }
}

/**
 * 수동 목록 종목의 KIS 조회 상태 — 제안 규칙 E·D 의 입력.
 * **최근 3일 안에 `us_fundamentals_snapshot` 행이 있으면 정상**, 표가 없거나 조회가 실패하면 **모름(null)** 이다
 * (모름을 「실패」로 보면 멀쩡한 종목을 빼라고 제안한다).
 */
export async function readRecentSnapshotSymbols(
  args: { days: number; db?: Queryable },
): Promise<Set<string> | null> {
  const db = args.db ?? pool();
  try {
    const [out] = await db.query<RowDataPacket[]>(
      `SELECT DISTINCT symbol FROM us_fundamentals_snapshot WHERE snapshot_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`,
      [Math.max(1, Math.trunc(args.days))],
    );
    return new Set(rowsOf<RowDataPacket>(out).map((r) => String(r.symbol ?? '')).filter(Boolean));
  } catch (e) {
    console.warn(`[universe/refresh-store] 최근 스냅샷 조회 실패(모름으로 진행): ${errText(e).slice(0, 120)}`);
    return null;
  }
}

/** 내부 심볼 → CIK(`symbol_cik_map`). 조회 실패는 빈 맵(제안 규칙 C 를 만들지 않는다 — 추측하지 않는다). */
export async function readSymbolCikMap(db: Queryable = pool()): Promise<Map<string, number>> {
  try {
    const [out] = await db.query<RowDataPacket[]>('SELECT symbol, cik FROM symbol_cik_map');
    const m = new Map<string, number>();
    for (const r of rowsOf<RowDataPacket>(out)) {
      const s = strOf(r.symbol);
      const c = intOf(r.cik);
      if (s && c != null) m.set(s, c);
    }
    return m;
  } catch (e) {
    console.warn(`[universe/refresh-store] CIK 매핑 조회 실패(코드 변경 제안 생략): ${errText(e).slice(0, 120)}`);
    return new Map();
  }
}
