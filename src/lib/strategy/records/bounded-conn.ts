/**
 * T-135 — 기록기 쓰기 경로의 풀 연결 점유 상한(공용). T-126 R1 이 `exit-judgment.ts`(326~430행)에 만든 연결 수명주기를, 문장이 여러 개인
 * 기록기(`judgment-recorder.ts` — INSERT 2문장, `job-run-log.ts` — 묶음 upsert + 값 오류 시 한 줄씩 재시도)가 같이 쓰도록 옮긴 것이다.
 *
 * ## 왜
 * 기록기의 자체 상한(`withDeadline`)은 **호출자의 기다림만** 끊는다. DB 쪽에서 문장이 멈추면(표 잠금·메타데이터 잠금·디스크 정지 …) 그 문장을
 * 보낸 풀 연결은 응답이 올 때까지 풀로 돌아오지 않는다. 풀(`db.ts` connectionLimit 10·queueLimit 0)은 주문 승인·`submitOrder`·UI 와 공유이고
 * 운영 `lock_wait_timeout` GLOBAL 은 86400초라 하루까지 묶일 수 있다. `job_run_log` 는 러너가 틱마다(약 분당 1회) 보내므로 표가 한 번 잠기면
 * 분마다 한 개씩 풀이 줄어든다. mysql2 쿼리 옵션 `timeout` 은 처방이 아니다(T-126 재현: 연결이 돌아오지 않는다).
 *
 * ## 규칙 (T-126 Reviewer R1·R3·R4 그대로)
 * - 기록 1회는 풀 연결을 **하나**만 받는다 — 첫 문장을 보낼 때 받고(문장이 없으면 받지 않는다), 그 기록의 쓰기 문장은 전부 그 연결로 보낸다.
 * - 연결은 **한 번만** 끝낸다: 상한 전에 본문이 끝났으면 release(그 연결에서 문장 오류가 한 번이라도 났으면 destroy — 상태를 믿지 않는다),
 *   상한·예외(`abort`)면 잡고 있던 연결을 **그 자리에서** destroy(풀에서 뺀다 — 슬롯이 돌아오고 서버는 끊긴 연결의 대기 문장을 거둔다).
 * - 상한이 **연결을 기다리는 중에** 오면, 나중에 받은 연결로는 아무 문장도 보내지 않고 바로 release 한다(늦은 기록 없음).
 * - 상한 뒤에는 새 문장을 보내지 않는다. 상한 뒤에 끝난 문장의 결과·오류는 {@link BoundedConnLateError} 로 바꿔 던진다 — 본문은 이것을 보면
 *   경고를 더하지 않고 끝낸다(바깥이 이미 timeout 으로 답하고 경고했다 — "늦게 끝난 본문이 경고를 한 줄 더 남기지 않는다", T-126 과 같다).
 * - 상한 전의 문장 오류는 **그대로** 던진다 — 호출자의 기존 분기(1146 테이블 없음·값 오류 한 줄씩 재시도·db_error)가 예전처럼 돈다.
 *   연결을 받지 못한 오류도 그대로 던진다(예전 `pool.query` 가 같은 상황에서 던지던 오류다).
 * - `finish()`·`abort()` 는 절대 던지지 않는다. release 가 던지면 대신 destroy, destroy 가 던지면 흡수(이미 닫힘).
 *
 * ## 쓰는 법
 *   const r = await withBoundedConn(MS, async (bc) => {
 *     …                                         // 스위치 읽기 등 — 이 연결과 무관(풀 query 그대로)
 *     const db = bc.use(getPool());             // getPool() 은 예전과 같은 자리에서 부른다(던지면 예전과 같은 경로로 흡수)
 *     await db.query(sql, params);              // 문장마다 — 첫 문장에서 연결을 받는다
 *   });
 *   if (r === undefined) { … timeout … }        // withBoundedConn 이 이미 연결을 풀에서 뺐다
 *
 * ## 범위 밖 (그대로 둔다)
 * - 스위치 읽기(`record-switch.ts` — 자체 2초 상한, 풀 query), 판단 기록기의 카드 id 조회(`lookupCardIds` — 읽기 SELECT 이고, 그 실패가
 *   쓰기 연결을 오염시키면 "조회가 실패해도 판단 기록은 signal_id NULL 로 남긴다" 규칙이 깨지므로 쓰기 연결과 묶지 않는다).
 * - `exit-judgment.ts`(T-126 자체 구현) — 이 헬퍼로 합치는 정리는 별도 후속.
 */
import { withDeadline } from './safe-text';

/** 풀에서 받은 연결 — mysql2 `PoolConnection` 에서 쓰는 부분만(시험의 목 연결도 이 모양이면 된다). */
export interface BoundedConnection {
  query(sql: string, values?: unknown): Promise<unknown>;
  release(): void;
  destroy(): void;
}

/** 연결을 내주는 풀 — mysql2 `Pool` 에서 쓰는 부분만. */
export interface BoundedPool {
  getConnection(): Promise<BoundedConnection>;
}

/** 본문이 문장을 보내는 창구(받은 연결 하나로 보낸다). */
export interface BoundedQueryable {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

/** 상한 뒤라서 문장을 보내지 않았거나 그 결과를 버렸다는 표시. 본문은 이것을 보면 경고 없이 끝낸다(바깥이 이미 답했다). */
export class BoundedConnLateError extends Error {
  constructor() {
    super('bounded_conn_late');
    this.name = 'BoundedConnLateError';
  }
}

export function isBoundedConnLate(e: unknown): boolean {
  return e instanceof BoundedConnLateError;
}

/** 본문에 건네는 쪽 — 풀을 받아 창구를 연다. */
export interface BoundedConnUse {
  /** 풀을 받아 둔다(연결은 첫 문장 때 받는다). 기록 1회에 한 번 — 두 번째 호출의 풀은 무시한다(연결은 하나). */
  use(pool: BoundedPool): BoundedQueryable;
  /** 상한(abort) 이후인가. */
  readonly late: boolean;
}

/** 기록 1회의 연결 상태 — {@link withBoundedConn} 이 끝내기(finish·abort)를 맡는다. */
export interface BoundedConn extends BoundedConnUse {
  /** 상한 전에 본문이 끝났다 — 문장 오류가 있었으면 destroy, 없었으면 release. 연결을 받지 않았으면 아무것도 안 한다. 한 번만·던지지 않음. */
  finish(): void;
  /** 상한·예외 — 잡고 있는 연결을 destroy 하고, 받는 중이면 도착하는 대로 release 하게 표시한다. 한 번만·던지지 않음. */
  abort(): void;
}

export function createBoundedConn(): BoundedConn {
  let late = false;                                  // abort 이후
  let closed = false;                                // finish 또는 abort 이후 — 늦게 도착한 연결은 쓰지 않고 돌려준다
  let pool: BoundedPool | null = null;
  let conn: BoundedConnection | null = null;         // 받아서 아직 끝내지 않은 연결 — 끝내는 순간 null(두 번 끝내지 않는다)
  let acquiring: Promise<BoundedConnection> | null = null;
  let errored = false;                               // 상한 전에 이 연결에서 문장 오류가 났는가 → 끝낼 때 destroy

  /** 받은 연결을 끝낸다 — 한 번만(끝내기 전에 conn 을 비운다), 절대 던지지 않는다. */
  const end = (how: 'release' | 'destroy'): void => {
    const c = conn;
    if (!c) return;
    conn = null;
    if (how === 'release') {
      try { c.release(); } catch { try { c.destroy(); } catch { /* 흡수 */ } }
    } else {
      try { c.destroy(); } catch { /* 이미 닫힘 — 흡수 */ }
    }
  };

  /** 연결을 한 번만 받는다(같은 기록의 문장들이 같은 약속을 기다린다). */
  const acquire = (): Promise<BoundedConnection> => {
    if (!acquiring) {
      let p: Promise<BoundedConnection>;
      try {
        if (!pool) throw new Error('bounded_conn_no_pool');
        p = Promise.resolve(pool.getConnection());
      } catch (e) {
        p = Promise.reject(e);
      }
      acquiring = p.then((c) => {
        if (closed) {
          // 상한(또는 끝냄) 뒤에야 받은 연결 — 아무 문장도 보내지 않고 바로 돌려준다(풀이 바빠 늦게 받은 경우). conn 에 두지 않는다.
          try { c.release(); } catch { try { c.destroy(); } catch { /* 흡수 */ } }
          throw new BoundedConnLateError();
        }
        conn = c;
        return c;
      });
    }
    return acquiring;
  };

  const query = async (sql: string, params?: unknown[]): Promise<unknown> => {
    if (late) throw new BoundedConnLateError();      // 상한 뒤 — 새 문장을 보내지 않는다
    if (closed) throw new Error('bounded_conn_closed');
    let c: BoundedConnection;
    try {
      c = await acquire();
    } catch (e) {
      if (late || isBoundedConnLate(e)) throw new BoundedConnLateError();
      throw e;                                       // 연결을 받지 못함 — 예전 풀 query 가 던지던 그 오류(호출자 분기 그대로)
    }
    if (late) throw new BoundedConnLateError();      // 받은 직후 상한 — abort 가 이미 이 연결을 닫았다
    try {
      const r = await c.query(sql, params);
      if (late) throw new BoundedConnLateError();    // 상한 뒤에 끝난 문장 — 결과를 쓰지 않는다
      return r;
    } catch (e) {
      if (late) throw new BoundedConnLateError();    // 상한에 연결이 닫혀 실패한 것 포함 — 경고 없이 끝내게
      errored = true;
      throw e;
    }
  };

  return {
    get late() { return late; },
    use(p: BoundedPool): BoundedQueryable {
      if (!pool) pool = p;
      return { query };
    },
    finish(): void {
      if (closed) return;
      closed = true;
      end(errored ? 'destroy' : 'release');
    },
    abort(): void {
      if (late) return;
      late = true;
      closed = true;
      end('destroy');                                // 받는 중이면 conn 이 아직 없다 — 도착하면 acquire 가 release 한다
    },
  };
}

/**
 * `body` 를 `ms` 상한으로 돌린다 — `withDeadline` 과 같은 계약(시간 안에 끝나면 그 값, 넘으면 undefined, 시간 안의 거부는 그대로 던짐)에
 * 연결 끝내기를 더한 것: 시간 안에 끝나면 finish(release/destroy), 넘거나 던지면 abort(잡고 있던 연결 destroy · 받는 중이면 도착 시 release).
 * `body` 는 시작 즉시 동기로 돈다(예전 `withDeadline(work(), ms)` 와 같은 순서).
 */
export async function withBoundedConn<T>(ms: number, body: (bc: BoundedConnUse) => Promise<T>): Promise<T | undefined> {
  const bc = createBoundedConn();
  let r: T | undefined;
  try {
    r = await withDeadline(body(bc), ms);
  } catch (e) {
    bc.abort();
    throw e;
  }
  if (r === undefined) bc.abort();                   // 🔴 기다림만 끊지 않는다 — 매달린 연결을 풀에서 뺀다(T-126 R1)
  else bc.finish();
  return r;
}
