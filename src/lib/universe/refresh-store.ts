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
 *
 * ## 🔴 단일 행의 흠이 그 달을 버리게 하지 않는다 (T-145 ⑥ — Reviewer 가 STRICT 실 DB 로 재현한 결함)
 * `cap_ratio DECIMAL(12,6)` 에 `2e7`(→ "Out of range") · `kis_stis CHAR(1)` 에 2자(→ "Data too long")를 넣으면
 * **한 종목 때문에 트랜잭션 전체가 깨지고** 호출부가 그 달을 `failed` 로 영구 종결했다. 그래서 이 모듈은
 *  ① 열 폭(CHAR·DECIMAL)을 **앱이 먼저** 맞춘다 — 넘치는 값은 자르거나 `NULL` 로 두고 **흔적을 남긴다**
 *  ② 같은 run 에 같은 심볼이 두 번 오면 **첫 행만** 넣는다(`uq_cand_symbol` 1062 회피)
 *  ③ 실패를 **일시/영구**로 갈라 돌려준다(`StoreOutcome.retryable`) — 일시는 그 달을 닫지 않는다.
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

/**
 * 🔴 DECIMAL 열에 **들어갈 수 있는 값만** 그대로 두고 그 밖은 `null` 로 바꾼다(T-145 ⑥-1).
 *
 * `intDigits` = 정수부 자릿수(= precision − scale), `scale` = 소수 자릿수. DB 가 저장할 때처럼 **먼저 반올림한 뒤**
 * 자릿수를 본다 — `999999.9999996` 은 DECIMAL(12,6) 에서 `1000000.000000` 으로 반올림돼 **범위를 넘는다**.
 * `Infinity`·`NaN` 도 null 이다(STRICT DB 가 거부한다).
 *
 * 왜 버리지 않고 null 인가: 「값이 없다」와 「값이 이상했다」를 가를 수 있게 호출부가 플래그·로그를 함께 남긴다.
 * 자르거나(clamp) 상한으로 밀어 넣지 않는다 — 이상한 수를 **그럴듯한 수로 바꾸면** 순위가 조용히 틀린다.
 */
function decimalOrNull(v: number | null | undefined, intDigits: number, scale: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const f = 10 ** scale;
  const rounded = Math.round(v * f) / f;
  return Number.isFinite(rounded) && Math.abs(rounded) < 10 ** intDigits ? v : null;
}

/** 후보·자동 목록 열의 폭(`scripts/migrations/T-143-wpa-universe-run.sql`·`T-143-overseas-universe.sql`). */
export const DECIMAL_COLS = {
  /** `candidate.tomv` · `cap_used` · `cap_alt` DECIMAL(28,4) */
  tomv: { intDigits: 24, scale: 4 },
  /** `candidate.shar` DECIMAL(24,2) */
  shar: { intDigits: 22, scale: 2 },
  /** `candidate.last_price` DECIMAL(20,6) */
  lastPrice: { intDigits: 14, scale: 6 },
  /** `candidate.cap_ratio` DECIMAL(12,6) — Reviewer 가 `2e7` 로 깨뜨린 그 열 */
  capRatio: { intDigits: 6, scale: 6 },
  /** `overseas_universe_auto.market_cap` DECIMAL(24,2) */
  marketCap: { intDigits: 22, scale: 2 },
} as const;

function dec(v: number | null | undefined, col: { intDigits: number; scale: number }): number | null {
  return decimalOrNull(v, col.intDigits, col.scale);
}
/** 값이 있었는데 열에 못 들어가 버린 경우 — 로그·플래그의 조건이다. */
function dropped(orig: number | null | undefined, kept: number | null): boolean {
  return orig != null && kept == null;
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

export type StoreOutcome<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'not_migrated' }
  /**
   * `retryable: true` = **일시** 오류다(다음 호출에서 다시 해 볼 만하다). 호출부는 그 달을 닫지 않는다.
   * `false` = **영구** — 같은 입력으로 다시 부르면 같은 결과다. 판정 기준은 `isRetryableDbError` 한 곳이다.
   */
  | { kind: 'error'; error: string; retryable: boolean };

/**
 * MySQL/MariaDB 오류 중 **영구**인 것(errno). 「다시 불러도 같은 결과」인 것만 넣는다 — 값·스키마·권한 문제다.
 * 1146(표 없음)은 호출부가 `not_migrated` 로 먼저 가르므로 여기 닿지 않지만, 분류가 새면 안 되므로 함께 적는다.
 */
const PERMANENT_DB_ERRNOS: ReadonlySet<number> = new Set([
  1044, 1048, 1054, 1062, 1063, 1064, 1136, 1142, 1143, 1146,
  1264, 1265, 1292, 1366, 1406, 1451, 1452, 1690, 3819, 4025,
]);
/** 같은 뜻의 `code` 문자열(드라이버가 errno 를 주지 않는 경로 대비). */
const PERMANENT_DB_CODES: ReadonlySet<string> = new Set([
  'ER_ACCESS_DENIED_ERROR', 'ER_BAD_FIELD_ERROR', 'ER_BAD_NULL_ERROR', 'ER_CHECK_CONSTRAINT_VIOLATED',
  'ER_CONSTRAINT_FAILED', 'ER_DATA_OUT_OF_RANGE', 'ER_DATA_TOO_LONG', 'ER_DBACCESS_DENIED_ERROR',
  'ER_DUP_ENTRY', 'ER_DUP_FIELDNAME', 'ER_NO_REFERENCED_ROW_2', 'ER_NO_SUCH_TABLE', 'ER_PARSE_ERROR',
  'ER_ROW_IS_REFERENCED_2', 'ER_TABLEACCESS_DENIED_ERROR', 'ER_TRUNCATED_WRONG_VALUE',
  'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD', 'ER_WARN_DATA_OUT_OF_RANGE', 'ER_WRONG_VALUE_COUNT_ON_ROW',
  'WARN_DATA_TRUNCATED',
]);

/**
 * 🔴 **「일시」와 「영구」를 가르는 유일한 자리**(T-145 ⑥-4).
 *
 * 기준: **네트워크·연결·잠금·타임아웃·서버 종료는 일시**(값은 멀쩡한데 지금 못 썼다) ·
 * **형식·논리·제약·권한은 영구**(다시 불러도 같다) · **모르면 일시**.
 *
 * 왜 모르면 일시인가 — 비용이 비대칭이다. 영구로 잘못 보면 **그 달 산출이 통째로 날아가고** 다음 창은
 * 한 달 뒤다. 일시로 잘못 보면 창(약 4시간 40분) 안에서 몇 번 더 시도하고 — 외부 호출은 단계마다 제한돼
 * 있으므로 유량 증폭이 아니다 — 창이 끝날 때 **텔레그램 warning 1회**가 미완을 알린다(④-조각).
 */
export function isRetryableDbError(e: unknown): boolean {
  const x = e as { code?: unknown; errno?: unknown } | null;
  if (typeof x?.errno === 'number' && PERMANENT_DB_ERRNOS.has(x.errno)) return false;
  if (typeof x?.code === 'string' && PERMANENT_DB_CODES.has(x.code)) return false;
  return true;   // 모르면 일시
}

function wrap<T>(e: unknown, label: string): StoreOutcome<T> {
  if (isNoSuchTable(e)) return { kind: 'not_migrated' };
  const retryable = isRetryableDbError(e);
  console.error(
    `[universe/refresh-store] ${label} 실패(${retryable ? '일시' : '영구'}): ${errText(e).slice(0, 200)}`,
  );
  return { kind: 'error', error: errText(e), retryable };
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
    // 넣었는데 안 보인다 — 복제 지연·경합 같은 **일시** 상태로 본다(다음 호출이 다시 읽는다)
    if (!again.data) return { kind: 'error', error: 'run 을 만들었는데 다시 읽지 못함', retryable: true };
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
    // 연결을 못 얻은 것은 **일시**다(풀 소진·네트워크) — 그 달을 닫을 이유가 아니다
    return { kind: 'error', error: `connection:${errText(e)}`, retryable: true };
  }
  /**
   * 🔴 같은 run 에 같은 심볼이 두 번 오면 **첫 행만** 넣는다(T-145 ⑥-3). `uq_cand_symbol (run_id, symbol)` 이
   * 둘째 행에서 1062 를 내고, 그 1062 가 트랜잭션을 깨 **그 달이 영구 실패**로 닫혔다.
   * SEC 파일에 같은 티커가 두 거래소로 중복 등재되면(2026-11-01 실측 0건이지만 목록은 매달 바뀐다)
   * `internalSymbolFor('NYS', …)` 가 같은 내부 심볼을 두 번 만든다. 첫 행(= SEC 파일 순서가 앞)을 남기는 것은
   * `ord` 가 run 안에서 불변이어야 하기 때문이다 — 뒤 행을 남기면 커서 기준이 바뀐다.
   * 버린 수는 로그로만 남긴다(값은 남기지 않는다).
   */
  const seenSymbols = new Set<string>();
  const candidates: CandidateInsert[] = [];
  let dupSymbols = 0;
  for (const c of args.candidates) {
    if (seenSymbols.has(c.symbol)) { dupSymbols += 1; continue; }
    seenSymbols.add(c.symbol);
    candidates.push(c);
  }
  if (dupSymbols > 0) {
    console.warn(`[universe/refresh-store] listing 후보에 중복 심볼 ${dupSymbols}건 — 첫 행만 넣는다(uq_cand_symbol)`);
  }
  // T-139 규칙 — 되돌리기까지 실패한 연결은 풀에 돌려주지 않고 버린다(열린 트랜잭션이 남은 연결이 재사용되지 않게)
  let discard = false;
  try {
    await conn.beginTransaction();
    try {
      // 재시작 뒤 같은 run 이 다시 listing 을 돌 수 있다 — 이전 시도의 후보를 비우고 다시 넣는다(멱등)
      await conn.query('DELETE FROM overseas_universe_candidate WHERE run_id = ?', [args.runId]);
      for (let i = 0; i < candidates.length; i += CANDIDATE_INSERT_CHUNK) {
        const chunk = candidates.slice(i, i + CANDIDATE_INSERT_CHUNK);
        const placeholders = chunk.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
        const params: unknown[] = [];
        for (const c of chunk) {
          params.push(
            args.runId, c.ord, clamp(c.symbol, 32), clamp(c.secTicker, 16), c.cik, clamp(c.secName, 200),
            clamp(c.kisSymb, 16), clamp(c.kisEnam, 200),
            // 🔴 CHAR 열도 앱이 먼저 맞춘다(T-145 ⑥-2) — `kis_stis` CHAR(1)·`kis_isdr` CHAR(1)·`kis_etyp` CHAR(3).
            //   마스터 파일의 열 폭이 바뀌거나 공백·여러 글자가 섞여 오면 STRICT DB 가 "Data too long" 으로
            //   **트랜잭션 전체**를 깬다(Reviewer 가 `kis_stis` 에 2자를 넣어 재현). 값 뜻은 1글자 코드다.
            clamp(c.kisStis, 1), clamp(c.kisIsdr, 1), clamp(c.kisEtyp, 3), c.status, clamp(c.exclusion, 32),
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
  return { kind: 'ok', data: { inserted: candidates.length } };
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
    /**
     * 🔴 KIS 원값도 **열 폭을 먼저 맞춘다**(T-145 ⑥-1 과 같은 이유, 호출부가 다르다).
     *
     * 이 UPDATE 는 종목마다 따로 보내고 호출부가 `.catch()` 로 삼키므로 트랜잭션을 깨지는 않는다. 그 대신
     * **그 행이 `pending` 으로 남고 `attempts` 도 늘지 않아** 다음 청크가 같은 종목을 다시 집는다 —
     * 한 종목의 말도 안 되는 값 하나가 창(4시간 40분)을 다 쓰고 그 달을 미완으로 끝낼 수 있다.
     * 그래서 열에 못 들어가는 값은 `null` 로 두고 **진행은 시킨다**(그 종목은 finalize 에서 `tomv_null` 로 빠진다).
     *
     * ⚠ `error` 열에는 적지 않는다 — 그 열이 비어 있는 것이 「KIS 가 답했다」의 표식이고
     * (`readRunKisStatus`) 거기에 값을 넣으면 **멀쩡한 종목에 「KIS 조회 불가」 제안**이 뜬다.
     */
    const tomv = dec(o.tomv, DECIMAL_COLS.tomv);
    const shar = dec(o.shar, DECIMAL_COLS.shar);
    const last = dec(o.last, DECIMAL_COLS.lastPrice);
    const oob = [
      dropped(o.tomv, tomv) ? 'tomv' : null,
      dropped(o.shar, shar) ? 'shar' : null,
      dropped(o.last, last) ? 'last_price' : null,
    ].filter(Boolean);
    if (oob.length > 0) {
      console.warn(
        `[universe/refresh-store] 원값이 열 범위를 넘어 null 로 둔다 run=${args.runId} ord=${o.ord} 열=${oob.join(',')}`,
      );
    }
    await db.query(
      `UPDATE overseas_universe_candidate
          SET status = 'ok', tomv = ?, shar = ?, last_price = ?, curr = ?, etyp_nm = ?, rsym = ?,
              attempts = attempts + 1, error = NULL, fetched_at = ?
        WHERE run_id = ? AND ord = ?`,
      [
        tomv, shar, last, clamp(o.curr, 8), clamp(o.etypNm, 64), clamp(o.rsym, 32),
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
  // 상위 N 이 비는 것은 원천이 깨진 **논리** 상태다 — 다시 불러도 같다(영구)
  if (args.auto.length === 0) {
    return { kind: 'error', error: 'empty_top — 자동 목록을 바꾸지 않는다', retryable: false };
  }
  let conn: TxConnection;
  try {
    conn = args.getConnection
      ? await args.getConnection()
      : ((await getPool().getConnection()) as unknown as TxConnection);
  } catch (e) {
    return { kind: 'error', error: `connection:${errText(e)}`, retryable: true };
  }
  let discard = false;
  const now = kstSql(args.nowMs);
  /**
   * 🔴 판정 수치를 **열 폭에 맞춘 뒤** 쓴다(T-145 ⑥-1). Reviewer 가 STRICT 실 DB 로 재현한 결함이 여기다 —
   * `cap_ratio DECIMAL(12,6)` 에 `2e7` 하나가 들어오면 "Out of range value" 로 **이 트랜잭션 전체**가 깨지고
   * 2,000종목의 산출이 버려졌다. 범위 밖 값은 `null` 로 두고 `cap_flag` 에 `+oob` 를 붙여
   * 「값이 이상했다」를 남긴다(그냥 버리면 왜 null 인지 알 수 없다).
   *
   * `cap_ratio` 가 넘치는 것은 실제로 일어난다 — `basis_mismatch`(기준 주수가 다름)의 비는 상한이 없고
   * `unit_mismatch` 의 `10^6` 밴드는 이미 경계값이다(`cap-rule.ts`).
   * `cap_used`·`cap_alt` 는 `shar × last` 라 **곱이 폭주할 수 있다**(DECIMAL(28,4) = 1e24). 상위 N 은
   * `isImplausibleCap`(2e13 미만)을 지나므로 닿지 않지만, 제외된 행도 같은 트랜잭션에 쓰이므로 함께 맞춘다.
   */
  const verdicts: CandidateVerdict[] = args.verdicts.map((v) => {
    const capUsed = dec(v.capUsed, DECIMAL_COLS.tomv);
    const capAlt = dec(v.capAlt, DECIMAL_COLS.tomv);
    const capRatio = dec(v.capRatio, DECIMAL_COLS.capRatio);
    const oob = dropped(v.capUsed, capUsed) || dropped(v.capAlt, capAlt) || dropped(v.capRatio, capRatio);
    return {
      ...v, capUsed, capAlt, capRatio,
      // VARCHAR(24) 안에 들어간다 — 가장 긴 조합이 `basis_mismatch+oob`(18자)다
      capFlag: oob ? `${v.capFlag ?? 'unverified'}+oob` : v.capFlag,
    };
  });
  const oobRows = verdicts.filter((v) => (v.capFlag ?? '').endsWith('+oob')).length;
  if (oobRows > 0) {
    console.warn(`[universe/refresh-store] 판정 수치가 열 범위를 넘은 후보 ${oobRows}건 — null + cap_flag '+oob' 로 둔다`);
  }
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
      for (const v of verdicts) {
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
      // `market_cap DECIMAL(24,2)` — 상위 N 은 2e13 미만이라 닿지 않지만 같은 규칙을 둔다(한 행이 목록 교체를 깨지 않게)
      for (const a of args.auto) params.push(clamp(a.symbol, 32), a.rankNo, dec(a.marketCap, DECIMAL_COLS.marketCap), now);
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

/**
 * 🔴 이 run 에서 **KIS 가 실제로 답했는가**(종목별) — 제안 규칙 E·D 가 스냅샷 대리값보다 **이것을 먼저** 본다
 * (T-145 ⑧-2). 이 달의 직접 관측이기 때문이다.
 *
 * 판정은 `status` 가 아니라 **`fetched_at`·`error`** 로 한다: `finalizeRun` 이 제외된 후보의 `status` 를
 * `excluded` 로 덮으므로 「스캔은 됐다」는 사실이 `status` 에 남지 않는다.
 *   `fetched_at IS NULL` → 아직 부른 적 없다 → **지도에 넣지 않는다**(모름)
 *   `error IS NULL`      → KIS 가 답했다 → `true`
 *   그 밖                → 조회 실패 → `false`
 * 조회가 실패하면 **빈 맵**이다(모름 — 추측하지 않는다. 호출부가 다른 원천으로 넘어간다).
 */
export async function readRunKisStatus(
  args: { runId: number; db?: Queryable },
): Promise<Map<string, boolean>> {
  const db = args.db ?? pool();
  try {
    const [out] = await db.query<RowDataPacket[]>(
      `SELECT symbol, error FROM overseas_universe_candidate
        WHERE run_id = ? AND fetched_at IS NOT NULL`,
      [args.runId],
    );
    const m = new Map<string, boolean>();
    for (const r of rowsOf<RowDataPacket>(out)) {
      const s = strOf(r.symbol);
      if (s && !m.has(s)) m.set(s, strOf(r.error) == null);
    }
    return m;
  } catch (e) {
    console.warn(`[universe/refresh-store] run 스캔 상태 조회 실패(모름으로 진행): ${errText(e).slice(0, 120)}`);
    return new Map();
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
