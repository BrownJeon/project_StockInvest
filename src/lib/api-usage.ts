/**
 * 외부 API 호출 기록 (T-040) — 공용 패키지 `@workspace/api-usage` 를 이 앱에서 쓰는 **유일한 입구**.
 *
 * 외부 API 호출 1번마다 `logs/api-usage-YYYY-MM-DD.jsonl` 에 고정 형식 한 줄
 * (`{ts, api, op, ok, status, ms, err?}`)을 남긴다. TheAdmin 'API' 탭이 이 파일을 읽는다.
 * 설계 정본: `TheAdmin/docs/design/api-usage-log.md` · 패키지: `project/shared/api-usage/README.md`.
 *
 * ## 🔴 절대 조건 — 기록 실패·지연이 본 호출(주문 포함)에 영향 0
 *
 * 패키지도 "던지지 않는다"를 보장하지만, 이 앱은 주문 경로가 지나가므로 **한 겹 더** 막는다.
 *  - 패키지 함수 호출은 전부 `try/catch` 안에서 한다 — 패키지가 (버그·잘못된 배포로) 던져도 삼킨다.
 *  - {@link trackCall} 은 패키지의 `record()` 를 쓰지 않고 **본 호출 `fn` 을 직접 실행**한다.
 *    `fn` 의 반환값·예외는 패키지 코드를 한 번도 거치지 않고 그대로 호출부로 돌아간다
 *    (`record()` 에 맡기면 반환값이 패키지가 만든 새 Promise 로 감싸진다 — README).
 *    패키지는 결과 해석(`interpretResult`·`classifyError`)과 줄 쓰기(`log`)에만 쓴다.
 *  - 기록 함수의 반환값으로 본 흐름을 분기하지 않는다.
 *
 * ## 🔒 줄에 넣지 않는 것
 *
 * 계좌번호·종목·수량·금액·토큰·URL·쿼리·본문·오류 원문. `op` 는 **코드 상수만** 넘긴다
 * (요청값·ID 를 섞지 않는다). 패키지가 고정 키 7개만 골라 줄을 만들지만, 1차 방어는 호출부다.
 *
 * Node 런타임 전용이다(fs). `src/middleware.ts`(Edge)에서 import 하지 않는다.
 */
import * as usage from '@workspace/api-usage';
import type { ApiId, ErrKind, Op, UsageEntry } from '@workspace/api-usage';

export type { ApiId, ErrKind, Op };

/** 단조 시계(ms). 벽시계 보정(NTP)에 흔들리지 않게 `performance.now()` 를 쓴다. */
export function usageClock(): number {
  try {
    return performance.now();
  } catch {
    return Date.now();
  }
}

/** 결과를 이미 아는 곳에서 한 줄. **절대 던지지 않는다.** 반환값 없음 — 분기 근거로 쓰지 말 것. */
export function logUsage(entry: UsageEntry): void {
  try {
    usage.log(entry);
  } catch {
    /* 기록 실패는 본 흐름을 바꾸지 않는다 */
  }
}

/** 예외 → 종류(`timeout`·`network`·`abort`·`http`·`exit`·`other`). 던지지 않는다. */
export function usageErrKind(e: unknown): ErrKind {
  try {
    return usage.classifyError(e).err;
  } catch {
    return 'other';
  }
}

/**
 * 코드 상수 label → op. 예: `'domestic getTicker'` → `'domestic.get-ticker'`,
 * `'search-info(ticker/all)'` → `'search-info.ticker.all'` (패키지 README 의 `opOf` 와 같은 변환).
 *
 * ⚠ label 은 **코드 상수만** 들어온다(`kisFetch` 의 `opts.label`). 요청값에 이 변환을 쓰지 말 것.
 */
export function opOf(label: string): Op {
  try {
    return ((label || 'unlabeled')
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '.')
      .replace(/^\.+|\.+$/g, '')
      .slice(0, 64) || 'unlabeled') as Op;
  } catch {
    return 'unlabeled';
  }
}

export interface TrackOptions<T> {
  /** 성공 판정을 앱이 정한다(예: 409 도 성공). 던지면 자동 판정. */
  ok?: (result: T) => boolean;
  /** 예외 종류를 앱이 정한다(예: 자체 타이머 abort → `timeout`). undefined 면 자동 분류. 던지면 자동 분류. */
  err?: (error: unknown) => ErrKind | undefined;
}

function safeCall<A, R>(f: ((a: A) => R) | undefined, a: A): R | undefined {
  if (typeof f !== 'function') return undefined;
  try {
    return f(a);
  } catch {
    return undefined;
  }
}

/** 결과 → 한 줄. 던지지 않는다. */
function logResult<T>(api: ApiId, op: Op, t0: number, result: T, opts?: TrackOptions<T>): void {
  try {
    const ms = usageClock() - t0;
    // 앱이 준 ok 함수가 던지면 패키지가 없던 것으로 하고 자동 판정한다(README).
    const r = usage.interpretResult(result, typeof opts?.ok === 'function' ? { ok: opts.ok } : undefined);
    if (r.ok) logUsage({ api, op, ok: true, status: r.status, ms });
    else logUsage({ api, op, ok: false, status: r.status, ms, err: r.err });
  } catch {
    /* 기록 실패는 본 흐름을 바꾸지 않는다 */
  }
}

/** 예외 → 한 줄. 던지지 않는다. */
function logFailure<T>(api: ApiId, op: Op, t0: number, e: unknown, opts?: TrackOptions<T>): void {
  try {
    const ms = usageClock() - t0;
    let status = 0;
    let err: ErrKind = 'other';
    try {
      const c = usage.classifyError(e);
      status = c.status;
      err = c.err;
    } catch { /* 자동 분류 실패 — other/0 */ }
    const forced = safeCall(opts?.err, e);
    if (forced) err = forced;
    logUsage({ api, op, ok: false, status, ms, err });
  } catch {
    /* 기록 실패는 본 흐름을 바꾸지 않는다 */
  }
}

/**
 * 외부 호출 `fn` 을 실행하고 한 줄 남긴다. **`fn` 의 반환값·예외를 그대로** 돌려준다.
 *
 * 기록 단위는 `fn` 1회. 재시도 루프가 있으면 루프 **안쪽**의 실제 시도 1번을 감싼다.
 * 결과 자동 해석: fetch `Response`(2xx 면 성공) · `{status}` 객체 · 그 밖(일반 값)은 성공.
 */
export async function trackCall<T>(
  api: ApiId,
  op: Op,
  fn: () => Promise<T>,
  opts?: TrackOptions<T>,
): Promise<T> {
  const t0 = usageClock();
  let result: T;
  try {
    result = await fn();
  } catch (e) {
    logFailure(api, op, t0, e, opts);
    throw e;
  }
  logResult(api, op, t0, result, opts);
  return result;
}

/**
 * 자식 프로세스 기록. spawn 직후에 부른다. **같은 child 를 그대로** 돌려준다
 * (리스너를 더할 뿐 기존 `error`·`close` 처리를 대신하지 않는다).
 * 패키지가 던져도 child 를 그대로 돌려준다.
 */
export function trackChild<C extends usage.ChildLike>(
  api: ApiId,
  op: Op,
  child: C,
  opts?: usage.ChildRecordOptions,
): C {
  try {
    usage.recordChild(api, op, child, opts);
  } catch {
    /* 기록 실패는 본 흐름을 바꾸지 않는다 */
  }
  return child;
}
