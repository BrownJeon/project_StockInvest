/**
 * KIS HTTP 단일 관문 (T-017).
 *
 * **KIS 로 나가는 모든 요청은 이 함수 하나를 지난다.** 어댑터(`kis-domestic`/`kis-overseas`),
 * 토큰 발급(`kis-auth`), 그리고 어댑터를 우회해 직접 KIS 를 부르던 라우트 3곳
 * (`/api/ticker/all`, `/api/symbols/lookup`, `/api/symbols/search`)까지 전부 여기로 모았다.
 * 호출 지점 16곳을 각각 손보는 대신 **길목을 하나 만들고 전원을 통과시키는** 방식이다.
 *
 * 하는 일은 셋뿐이다.
 *  1. {@link acquireKisSlot} 으로 유량 토큰을 받는다 (우선순위·유한 대기열은 `kis-throttle`).
 *  2. 타임아웃 타이머를 **토큰을 받은 뒤에** 건다 (아래 §타임아웃).
 *  3. 레이트리밋 응답(`EGW00201`/`EGW00215`)을 식별해 **즉시 재시도하지 않고** 백오프 후
 *     대기열에 다시 넣는다 (아래 §재시도 증폭).
 *
 * ## §재시도 증폭 — 이 작업이 고친 두 번째 결함
 *
 * KIS 레이트리밋은 **HTTP 500 + 본문 `msg_cd:"EGW00201"`** 로 온다. 그런데 기존
 * `kis-domestic.getTicker` 는 `res.status === 500` 이면 300ms 뒤 무조건 재시도했다. 즉
 * **레이트리밋을 맞을 때마다 곧바로 한 번 더 때려서** 과부하를 스스로 키우고 있었다.
 *
 * 여기서는 둘을 구분한다:
 *  - **레이트리밋** → 이 모듈이 백오프(400ms·1200ms + 지터) 후 **토큰을 새로 받아** 재시도한다.
 *    호출부는 {@link isKisRateLimited} 로 이를 식별해 자기 재시도 루프를 **건너뛴다**
 *    (이미 여기서 물러섰다 — 위에서 또 때리면 증폭이 부활한다).
 *  - **진짜 5xx** → 이 모듈은 재시도하지 않는다. 기존 호출부 재시도 로직이 그대로 동작한다.
 *
 * ## §타임아웃 — 대기 시간이 타임아웃을 잡아먹지 않게
 *
 * 타이머를 요청 **직전**(토큰 획득 후)에 걸어야 한다. 대기열에 서기 전에 걸면 "5초 타임아웃"이
 * 실제로는 "대기 + 통신 합쳐 5초"가 돼, 스로틀이 만든 대기가 곧바로 새로운 실패 모드가 된다.
 * 그래서 `timeoutMs` 는 이 모듈이 **토큰 획득 이후에** 적용한다.
 *
 * 단, 그 설계는 "기다리는 동안에는 아무 타임아웃도 없다"를 뜻하기도 한다. 그래서 **대기 자체에
 * 별도 데드라인**(`maxWaitMs`, 기본 30초)이 걸려 있다 — 이것이 없으면 요청 하나가 영원히
 * 기다리면서 `cron-runner.sh` 의 직렬 루프 전체를 조용히 멈춘다. 두 타이머는 구간이 다르다:
 * `maxWaitMs` = 줄 서는 구간, `timeoutMs` = 통신 구간.
 *
 * 기본값은 **무제한(기존 동작 보존)** 이다. 기존에 타임아웃이 있던 호출부만 같은 값을 명시로
 * 넘긴다 — 없던 곳에 타임아웃을 새로 도입하면 이번 변경의 범위를 넘는 회귀가 생긴다.
 *
 * ## 본문 재생(replay)
 *
 * 레이트리밋 판정은 본문을 봐야 하는데 `Response.text()` 는 스트림을 소비한다. 그래서 본문을
 * 한 번 읽고 **같은 상태·헤더로 새 `Response` 를 만들어** 돌려준다. 호출부는 `res.ok`,
 * `res.status`, `res.json()`, `res.text()` 를 종전과 똑같이 쓰면 된다.
 *
 * 반환된 `Response` 도 표준 스펙대로 **본문은 한 번만** 읽을 수 있다. 이미 읽은 뒤 원문이 다시
 * 필요하면 {@link kisBodyText} 로 얻는다 (진단 로그·에러 메시지용).
 */

import {
  acquireKisSlot, currentKisPriority, DEFAULT_MAX_QUEUE_WAIT_MS, type KisPriority,
} from './kis-throttle';

export interface KisFetchOptions {
  /** 미지정 시 {@link currentKisPriority} — 즉 `withKisPriority` 컨텍스트를 따른다. */
  priority?: KisPriority;
  /** 토큰 획득 **이후**부터 재는 타임아웃. 미지정 시 무제한(기존 동작). */
  timeoutMs?: number;
  /** 레이트리밋 시 재시도 횟수. 기본 2 (총 3회 시도). 0 이면 재시도 없음. */
  rateLimitRetries?: number;
  /**
   * 유량 토큰을 기다리는 최대 시간. 기본 {@link DEFAULT_MAX_QUEUE_WAIT_MS}(30초).
   * 초과 시 `KisThrottleTimeoutError`. **무한 대기를 허용하지 않는 것이 요점**이므로
   * 끄려면(0) 반드시 그 이유가 있어야 한다.
   */
  maxWaitMs?: number;
  /** 로그 식별용 라벨 (예: `getTicker`). */
  label?: string;
}

interface KisResponseMeta {
  rateLimited: boolean;
  attempts:    number;
  priority:    KisPriority;
  /** 이미 읽어 둔 원문. 본문을 소비한 뒤에도 진단에 쓸 수 있게 보관한다. */
  body:        string;
}

/**
 * 응답 부가정보. `Response` 에 필드를 심으면 타입이 더러워지므로 WeakMap 으로 옆에 둔다.
 * (응답 객체가 GC 되면 함께 사라진다.)
 */
const META = new WeakMap<Response, KisResponseMeta>();

/** KIS 레이트리밋 응답 본문 패턴. `EGW00133`(토큰 1분당 1회)은 **의도적으로 제외** — 성격이 다르다. */
const RATE_LIMIT_PATTERN = /EGW00201|EGW00215|초당\s*거래건수/;

/** 레이트리밋 판정 — 본문 문자열 기준. HTTP 상태는 보지 않는다(KIS 는 500 으로 준다). */
export function isKisRateLimitBody(body: string): boolean {
  return RATE_LIMIT_PATTERN.test(body);
}

/**
 * 이 응답이 KIS 레이트리밋인가.
 *
 * 호출부는 이 값이 `true` 면 **자기 재시도 루프를 돌리지 않아야 한다.** `kisFetch` 가 이미
 * 백오프 재시도를 소진했고, 그 위에서 또 즉시 재시도하면 과부하가 증폭된다.
 */
export function isKisRateLimited(res: Response): boolean {
  return META.get(res)?.rateLimited === true;
}

/** 진단용 — 이 응답을 얻기까지 몇 번 시도했는가. */
export function kisAttempts(res: Response): number {
  return META.get(res)?.attempts ?? 1;
}

/**
 * 이미 읽어 둔 응답 본문 원문. `res.json()`/`res.text()` 로 본문을 소비한 **뒤에도** 쓸 수 있다.
 * (`kisFetch` 를 거치지 않은 응답이면 `null`.)
 */
export function kisBodyText(res: Response): string | null {
  return META.get(res)?.body ?? null;
}

const DEFAULT_RATE_LIMIT_RETRIES = 2;
/** 백오프 — 인덱스가 재시도 회차. 지터를 더해 여러 호출이 같은 순간에 몰리지 않게 한다. */
const BACKOFF_MS = [400, 1200];
const JITTER_MS  = 200;

function backoffFor(attempt: number): number {
  const base = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
  return base + Math.floor(Math.random() * JITTER_MS);
}

const sleep = (ms: number) => new Promise<void>(r => { const t = setTimeout(r, ms); t.unref?.(); });

/** 본문을 가질 수 없는 상태코드 — `new Response(body, {status})` 가 던진다. */
const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);

/** 읽어 버린 본문으로 동등한 `Response` 를 다시 만든다. */
function replayResponse(res: Response, body: string): Response {
  const headers = new Headers(res.headers);
  // 본문을 평문 문자열로 다시 실으므로 원본의 인코딩·길이 헤더는 더 이상 유효하지 않다.
  headers.delete('content-encoding');
  headers.delete('content-length');
  const status = res.status >= 200 && res.status <= 599 ? res.status : 500;
  try {
    return new Response(NULL_BODY_STATUS.has(status) ? null : body, {
      status,
      statusText: res.statusText,
      headers,
    });
  } catch {
    // statusText/headers 가 비정상인 극단적 경우 — 상태코드만 보존한다.
    return new Response(NULL_BODY_STATUS.has(status) ? null : body, { status });
  }
}

/**
 * KIS 로 가는 단 하나의 HTTP 진입점.
 *
 * 반환된 `Response` 는 원본이 아니라 **재생본**이다. 이 모듈이 레이트리밋 판정을 위해 원본
 * 본문을 이미 소비했기 때문에, 재생본이 없으면 호출부의 `res.json()` 이
 * "Body has already been read" 로 실패한다. 재생본도 표준 `Response` 이므로 본문은 한 번만
 * 읽을 수 있고, 그 뒤 원문이 필요하면 {@link kisBodyText} 를 쓴다.
 */
export async function kisFetch(
  url: string,
  init: RequestInit = {},
  opts: KisFetchOptions = {},
): Promise<Response> {
  const priority = opts.priority ?? currentKisPriority();
  const retries  = opts.rateLimitRetries ?? DEFAULT_RATE_LIMIT_RETRIES;
  const label    = opts.label ?? '';

  let attempt = 0;
  for (;;) {
    // ① 유량 토큰. 두 가지로 실패할 수 있고 **둘 다 던진다**(빈 결과로 퇴화하지 않는다):
    //    - 대기열이 가득 참        → KisThrottleQueueFullError (즉시)
    //    - 제한 시간 내 차례 없음  → KisThrottleTimeoutError   (대기 후)
    await acquireKisSlot(priority, { maxWaitMs: opts.maxWaitMs ?? DEFAULT_MAX_QUEUE_WAIT_MS });

    // ② 타임아웃은 **토큰을 받은 뒤에** 건다 (§타임아웃).
    let ctrl: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (opts.timeoutMs != null && opts.timeoutMs > 0) {
      ctrl = new AbortController();
      timer = setTimeout(() => ctrl!.abort(), opts.timeoutMs);
      timer.unref?.();
    }

    let res: Response;
    try {
      res = await fetch(url, ctrl ? { ...init, signal: ctrl.signal } : init);
    } finally {
      if (timer) clearTimeout(timer);
    }

    const body = await res.text().catch(() => '');
    const rateLimited = isKisRateLimitBody(body);
    const replay = replayResponse(res, body);
    META.set(replay, { rateLimited, attempts: attempt + 1, priority, body });

    if (!rateLimited) return replay;

    // ③ 레이트리밋 — 즉시 재시도하지 않는다. 물러섰다가 **토큰을 새로 받아** 다시 줄을 선다.
    if (attempt >= retries) {
      console.warn(
        `[kis-http] 레이트리밋 재시도 소진${label ? ` (${label})` : ''} — `
        + `${attempt + 1}회 시도 후 포기. lane=${priority}`,
      );
      return replay;
    }
    await sleep(backoffFor(attempt));
    attempt += 1;
  }
}
