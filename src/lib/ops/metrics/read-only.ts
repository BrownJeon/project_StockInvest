/**
 * T-108 운용 지표 — **읽기 전용 쿼리 래퍼** (가이드 §4.0).
 *
 * 홈·거래·분석 화면이 60초(안전 띠 30초)마다 다시 읽는 라우트들이 이 래퍼 하나로만 DB 를 본다.
 *
 * ## 지키는 것
 *  - **SELECT 만**: 문장이 `SELECT`(또는 `WITH`)로 시작하지 않거나 `;` 가 들어 있거나, 잠금·파일·변수 쓰기 절
 *    (`FOR UPDATE`·`LOCK IN SHARE MODE`·`FOR SHARE`·`GET_LOCK(`·`INTO OUTFILE/DUMPFILE/@`) 이 있으면 보내기 전에 거부한다(`not_select`).
 *    소스 단위 강제는 `__tests__/ops-read-only-fence.test.ts`(A-3)가 따로 한다 — 이것은 실행 시점의 두 번째 줄.
 *  - **쿼리마다 상한 2.5초**: 서버 쪽 `SET STATEMENT max_statement_time=… FOR SELECT …`(MariaDB 10.1+, 그 문장에만 적용 — 세션 값을
 *    바꾸지 않는다)로 NAS DB 에서 오래 붙잡힌 SELECT 를 서버가 끊게 하고, 클라이언트 쪽 `withDeadline` 으로 응답 대기도 끊는다.
 *    서버가 끊지 않으면 버려진 쿼리가 풀(연결 10개)을 점유한 채 쌓인다 — 60초 재조회 화면이라 그 누적을 막는 것이 목적이다.
 *  - **요청 전체 예산**(기본 3.8초): 라우트 목표 < 4초. 예산이 남지 않으면 쿼리를 보내지 않고 `timeout` 으로 실패시킨다.
 *  - **동시 실행 상한 — 요청 몫 4 → 전역 4(또는 안전 판독 예약 레인 2)**: 화면 탭이 여러 개 열려 홈·거래·분석이 동시에 재조회해도
 *    ops 쿼리가 풀 연결 10개를 독점해 주문 경로(같은 풀)를 기다리게 하지 않고, 안전 띠는 홈 뒤에 줄 서지 않는다(아래 Gate 주석).
 *    모든 대기에는 요청 잔여 예산이 기한으로 걸리고, 넘으면 대기열에서 빠져 timeout 이다(끊긴 요청의 대기가 쌓이지 않는다).
 *    (안전 상태 판독기 `isDryRun`·`isKillSwitchActive`·`readExitEngineSwitch`·`getStyleConfig`·`getEvalFunnelSummary` 는 이 래퍼 밖 — 각 1~6 쿼리)
 *  - **실패 분류**: 1146(테이블 없음 — DDL 적용 전) = `not_migrated`, 1969(max_statement_time 초과)·상한 = `timeout`, 그 밖 = `db_error`.
 *    호출자는 `OpsQueryError.code` 로 「준비 중」·「조회 실패」를 가른다. 0 으로 바꾸지 않는다.
 *  - **섹션 실패 격리**: `section()` 이 한 섹션의 예외를 `{ state:'error', error:code }` 로 바꾼다 — 나머지 섹션·HTTP 200 은 그대로.
 *
 * 캐시 없음(v1, 가이드 §4.0). 쓰기·외부 호출 없음.
 */
import { getPool } from '@/lib/db';
import { isNoSuchTable, withDeadline } from '@/lib/strategy/records/safe-text';
import type { Section } from './types';

export const OPS_QUERY_DEADLINE_MS = 2500;
export const OPS_REQUEST_BUDGET_MS = 3800;
export const OPS_QUERY_CONCURRENCY = 4;
/** 프로세스 전체 ops 쿼리 동시 실행 상한 — 풀 connectionLimit 10 의 절반 미만 */
export const OPS_GLOBAL_CONCURRENCY = 4;

export type OpsErrorCode = 'timeout' | 'not_migrated' | 'db_error' | 'not_select';

export class OpsQueryError extends Error {
  constructor(readonly code: OpsErrorCode, message: string, readonly errno: number | null = null) {
    super(message);
    this.name = 'OpsQueryError';
  }
}

/** mysql2 Pool 과 시험 대역이 모두 만족하는 최소 인터페이스. */
export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<[unknown, unknown]>;
}

export interface OpsReader {
  /** SELECT 1문장 → 행 배열. 실패는 OpsQueryError 로 던진다. */
  rows<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** 이 요청의 기준 시각(epoch ms) — 모든 「오늘」·「지금」 계산이 같은 시각을 쓴다. */
  readonly nowMs: number;
  /** 같은 요청 안에서 같은 읽기(예: position_state·스타일)를 한 번만 — 키별로 첫 Promise 를 재사용한다(실패도 공유). */
  memo<T>(key: string, fn: () => Promise<T>): Promise<T>;
}

export interface ReaderOptions {
  pool?: Queryable;
  nowMs?: number;
  deadlineMs?: number;
  budgetMs?: number;
  concurrency?: number;
  /** 경과 측정용 시계(시험 주입). 기본 Date.now */
  clock?: () => number;
  /** 프로세스 전체 관문(시험 주입·안전 레인). 기본 모듈 싱글턴 OPS_GLOBAL_GATE */
  gate?: Gate;
  /** 이 reader 가 보낼 수 있는 SQL 문장(정확 일치). 지정하면 밖의 문장은 보내기 전에 거부 — 안전 레인 전용 reader 가 쓴다. */
  allowedSql?: readonly string[];
}

/**
 * 기한 있는 세마포어(FIFO).
 *  - **기한**: 대기자는 기한이 지나면 대기열에서 빠지고 `timeout` 으로 끝난다 — 화면이 요청을 끊은 뒤에도 대기 Promise 가 쌓이지 않는다
 *    (Codex C2 ②). 기한 타이머는 unref.
 *  - 해제 함수는 여러 번 불려도 한 번만 동작한다. 슬롯이 풀리면 대기열 맨 앞에게 바로 넘긴다(레이스 없음).
 *
 * 쓰는 곳은 세 겹이다(createReader):
 *  1. **요청 몫**(요청마다 하나, 상한 4) — 한 요청이 한 번에 전역 대기열에 넣는 질의 수를 4 로 묶는다. 홈이 질의 45개를 전역 FIFO 에
 *     한꺼번에 쏟아 뒤에 온 다른 요청을 굶기지 않게(Reviewer R-DATA — 새 관문 Major). 요청 몫을 **먼저** 잡은 질의만 전역 대기열에 들어간다.
 *  2. **전역 관문**(프로세스 전체, 상한 4) — 홈·거래·분석 질의가 풀 연결 10개를 독점하지 않게.
 *  3. **안전 판독 예약 레인**(상한 2, 전역 관문과 별개) — 안전 상태(`safety-state.ts`)의 질의만. 홈이 전역 관문을 채우고 있어도
 *     30초마다 도는 안전 띠가 그 뒤에 줄 서지 않는다. 이 레인의 reader 는 허용된 SQL 상수 밖의 문장을 거부한다.
 */
export interface Gate {
  /** 허가되면 해제 함수를 돌려준다. 기한(ms, 지금부터)이 지나면 OpsQueryError('timeout'). */
  acquire(waitMs: number): Promise<() => void>;
  readonly active: number;
  /** 대기 중인 수(시험·진단용) */
  readonly waiting: number;
}
export function createGate(limit: number): Gate {
  let active = 0;
  interface Waiter { grant: (release: () => void) => void; timer: ReturnType<typeof setTimeout> | null }
  const queue: Waiter[] = [];
  const take = (): (() => void) => {
    active++;
    let done = false;
    return () => {
      if (done) return;
      done = true;
      active--;
      pump();
    };
  };
  function pump(): void {
    while (queue.length > 0 && active < limit) {
      const w = queue.shift()!;
      if (w.timer) clearTimeout(w.timer);
      w.grant(take());
    }
  }
  return {
    get active() { return active; },
    get waiting() { return queue.length; },
    acquire(waitMs: number): Promise<() => void> {
      if (active < limit && queue.length === 0) return Promise.resolve(take());
      if (!(waitMs > 0)) return Promise.reject(new OpsQueryError('timeout', 'request budget exhausted (gate)'));
      return new Promise<() => void>((resolve, reject) => {
        const w: Waiter = { grant: resolve, timer: null };
        w.timer = setTimeout(() => {
          const i = queue.indexOf(w);
          if (i >= 0) {
            queue.splice(i, 1);
            reject(new OpsQueryError('timeout', `gate wait exceeded ${Math.round(waitMs)}ms`));
          }
        }, Math.ceil(waitMs));
        (w.timer as unknown as { unref?: () => void }).unref?.();
        queue.push(w);
        pump();
      });
    },
  };
}
/** 프로세스 전체 관문 — 홈·거래·분석 ops 요청이 공유한다. */
export const OPS_GLOBAL_GATE: Gate = createGate(OPS_GLOBAL_CONCURRENCY);
/** 안전 판독 예약 레인 상한 — 전역 관문과 별개(합계 풀 사용 ≤ 4 + 2 < 10). */
export const OPS_SAFETY_LANE_CONCURRENCY = 2;
/** 안전 판독 예약 레인 — **`safety-state.ts` 만** 쓴다(울타리 시험이 고정). */
export const OPS_SAFETY_GATE: Gate = createGate(OPS_SAFETY_LANE_CONCURRENCY);

const SELECT_ONLY = /^\s*(SELECT|WITH)\b/i;
/** SELECT 여도 잠그거나 쓰는 절 — 대소문자 무시. */
const LOCKING_OR_WRITING = /\bFOR\s+(UPDATE|SHARE)\b|\bLOCK\s+IN\s+SHARE\s+MODE\b|\bGET_LOCK\s*\(|\bINTO\s+(OUTFILE|DUMPFILE|@)|\bINTO\s+@/i;

/** SELECT 1문장만 통과(잠금·파일·변수 쓰기 절 금지). 위반이면 던진다(보내지 않는다). */
export function assertSelectOnly(sql: string): void {
  if (!SELECT_ONLY.test(sql) || sql.includes(';') || LOCKING_OR_WRITING.test(sql)) {
    throw new OpsQueryError('not_select', `ops reader 는 잠금 없는 SELECT 1문장만 보낸다: ${sql.slice(0, 40)}`);
  }
}

function errnoOf(e: unknown): number | null {
  const n = (e as { errno?: unknown } | null)?.errno;
  return typeof n === 'number' ? n : null;
}

/** DB 오류 → 분류 코드. 1969 = ER_STATEMENT_TIMEOUT(max_statement_time 초과). */
export function classifyDbError(e: unknown): OpsQueryError {
  if (e instanceof OpsQueryError) return e;
  if (isNoSuchTable(e)) return new OpsQueryError('not_migrated', 'table missing (1146)', 1146);
  const errno = errnoOf(e);
  if (errno === 1969) return new OpsQueryError('timeout', 'max_statement_time exceeded', errno);
  const msg = e instanceof Error ? e.message : String(e);
  return new OpsQueryError('db_error', msg.slice(0, 200), errno);
}

/** 서버 쪽 상한 접두. 초 단위 소수 2자리(최소 0.1초). */
export function withStatementTimeout(sql: string, ms: number): string {
  const sec = Math.max(0.1, ms / 1000).toFixed(2);
  return `SET STATEMENT max_statement_time=${sec} FOR ${sql.trim()}`;
}

export function createReader(opts: ReaderOptions = {}): OpsReader {
  const clock = opts.clock ?? Date.now;
  const startedAt = clock();
  const deadlineMs = opts.deadlineMs ?? OPS_QUERY_DEADLINE_MS;
  const budgetMs = opts.budgetMs ?? OPS_REQUEST_BUDGET_MS;
  const local = createGate(Math.max(1, opts.concurrency ?? OPS_QUERY_CONCURRENCY));
  const gate = opts.gate ?? OPS_GLOBAL_GATE;
  const allowed = opts.allowedSql ? new Set(opts.allowedSql) : null;
  const nowMs = opts.nowMs ?? Date.now();
  let pool: Queryable | null = opts.pool ?? null;

  async function rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    assertSelectOnly(sql);
    if (allowed && !allowed.has(sql)) throw new OpsQueryError('not_select', `이 reader(전용 레인)는 허용된 SQL 만 보낸다: ${sql.slice(0, 40)}`);
    // 요청 몫 → 전역(또는 안전 레인) 순서. 두 대기 모두 요청 잔여 예산이 기한 — 넘으면 대기열에서 빠지고 timeout(보내지 않는다).
    const left = () => budgetMs - (clock() - startedAt) - 50;
    const releaseLocal = await local.acquire(left());
    let releaseGate: () => void;
    try {
      releaseGate = await gate.acquire(left());
    } catch (e) {
      releaseLocal();
      throw e;
    }
    const release = () => { releaseGate(); releaseLocal(); };
    try {
      const remaining = budgetMs - (clock() - startedAt);
      const ms = Math.min(deadlineMs, remaining);
      if (!(ms > 50)) throw new OpsQueryError('timeout', 'request budget exhausted');
      if (!pool) {
        try { pool = getPool() as unknown as Queryable; } catch (e) { throw classifyDbError(e); }
      }
      let res: [unknown, unknown] | undefined;
      try {
        res = await withDeadline(pool.query(withStatementTimeout(sql, ms), params), ms + 100);
      } catch (e) {
        throw classifyDbError(e);
      }
      if (res === undefined) throw new OpsQueryError('timeout', `query exceeded ${ms}ms`);
      const out = res[0];
      return Array.isArray(out) ? (out as T[]) : [];
    } finally {
      release();
    }
  }

  const memoMap = new Map<string, Promise<unknown>>();
  function memo<T>(key: string, fn: () => Promise<T>): Promise<T> {
    let p = memoMap.get(key) as Promise<T> | undefined;
    if (!p) { p = fn(); memoMap.set(key, p); }
    return p;
  }

  return { rows, nowMs, memo };
}

/** 예외 → 짧은 분류어. */
export function errorCodeOf(e: unknown): string {
  if (e instanceof OpsQueryError) return e.code;
  return 'internal_error';
}

/**
 * 섹션 1개를 실행해 `Section<T>` 로. 던지지 않는다 — 실패는 그 섹션만 error.
 * 로그는 분류어·라벨만(값·종목을 남기지 않는다).
 */
export async function section<T>(label: string, fn: () => Promise<T>): Promise<Section<T>> {
  try {
    return { state: 'ok', data: await fn() };
  } catch (e) {
    const code = errorCodeOf(e);
    console.warn(`[ops/metrics] ${label} 섹션 실패: ${code}${e instanceof Error && code === 'internal_error' ? ` (${e.message.slice(0, 120)})` : ''}`);
    return { state: 'error', error: code };
  }
}

/** 숫자 열 읽기 — mysql2 가 DECIMAL·SUM 을 문자열로 줄 수 있다. 숫자가 아니면 null(0 으로 바꾸지 않는다). */
export function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v.trim());
  return null;
}

/** COUNT·SUM 결과 — 행이 있으면 정수, 없으면(NULL) 0. **집계 결과에만** 쓴다(값이 없는 지표에 쓰지 않는다). */
export function count(v: unknown): number {
  const n = num(v);
  return n == null ? 0 : Math.trunc(n);
}

/** JSON 텍스트 열 → 객체. 해석 불가면 null. */
export function parseJsonObject(v: unknown): Record<string, unknown> | null {
  if (v == null) return null;
  if (typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v !== 'string') return null;
  try {
    const o = JSON.parse(v);
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
