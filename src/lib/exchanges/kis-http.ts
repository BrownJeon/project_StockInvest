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
 * ## §일시 실패 재시도 (T-132, 옵트인)
 *
 * 위 doctrine 은 "진짜 5xx 는 호출부가 판단한다"였다. 그런데 **판단하지 않는 호출부**가 있었다 —
 * `getBalances`·`getUsdCash` 는 한 번 실패하면 그대로 던져, KIS 게이트웨이가 한 번 깜박일 때마다
 * 포트폴리오 스냅샷이 건너뛰어졌다. 예수금 쪽(`getUsdCash`·국내 KRW 요약)이 실패한 틱에서는 주문
 * 한도가 **0** 이 되기도 했다(= 신규 매수 차단). 보유 조회만 실패한 틱의 한도는 0 이 아니라
 * `portfolio-total.ts` 의 직전 정상값으로 계산된다 — **직전 틱이 `unknown` 판정으로 그 값을 지우지
 * 않았다면**(`portfolio-total.ts` 의 `lastOk` 삭제). 둘을 섞어 적지 않는다(T-132 Reviewer M-2·I-3).
 *
 * 2026-10-31 실측(KIS 측 장애, 09:23~): `EGW00300 Gateway 라우팅 오류`(HTTP 500)와
 * `OPSQ1002 SESSION FULL`(HTTP **200** + `rt_cd:"9"`)이 산발 발생해 KIS 실패율이 0.8% → 12.5%.
 * 같은 URL·TR 이 **1초 뒤에는 성공**했고(10:30:08 실패 / 10:30:09 성공), 실패는 동시호출이 적을 때
 * 일어났다(±1초 2~3건, 성공은 7~9건) — 유량 문제가 아니라 상대 쪽 일시 거절이다.
 *
 * 그래서 {@link KisFetchOptions.transientRetries} 로 **호출부가 명시로 켤 때만** 레이트리밋이
 * 아닌 실패를 백오프 후 재시도한다. 기본값 0 이라 기존 호출부 동작은 그대로다. 레이트리밋 예산과
 * 별도 카운터를 쓰므로 한쪽이 다른 쪽 재시도 횟수를 잡아먹지 않는다.
 *
 * 🔴 **읽기 전용 조회에만 켠다.** 주문 송신(`createOrder`·`cancelOrder`)에 켜면 KIS 가 이미 접수한
 * 주문을 우리가 실패로 보고 다시 보내 **중복 주문**이 될 수 있다. 재시도의 전제는 멱등성이다.
 *
 * ### T-133 — 시세 조회로 확장 (2026-10-31)
 *
 * T-132 배포 뒤 운영 로그에서, 시세(`getTicker`)가 같은 구멍을 그대로 갖고 있는 것이 드러났다 —
 * 두 어댑터의 손으로 만든 재시도 루프가 `res.status` 만 봐서 **HTTP 200 업무실패를 비껴갔고**,
 * 하루 11건의 종목이 `portfolio-total` 에서 총액 밖으로 빠졌다(주문 한도 입력의 과소평가. 방향은
 * 보수적이지만 `portfolio-total.ts:123-130` 이 "원인 모를 과소평가가 남으면 안 된다"고 적어 둔 그것).
 *
 * 그래서 두 `getTicker` 의 **응답 기반 루프를 걷어내고** 이 옵션으로 옮겼다(`transientRetries: 2`).
 * 손으로 만든 루프를 남긴 채 옵션만 켜면 바깥 × 안쪽으로 호출이 곱해져 T-017 의 증폭이 부활한다.
 * 호출 상한은 레이트리밋 예산까지 세야 한다 — `kisFetch` 한 번이 최악 5회(1 + 일시 2 + 레이트리밋 2)
 * 이므로, 어댑터의 1회짜리 바깥 루프까지 합쳐 **국내 최악 10회(종전 9회)·해외 최악 10회(종전 6회)**
 * 다(T-133 Reviewer L-2·L-5 정정 — 처음 적은 "국내 총 3회"·"해외 6회" 는 레이트리밋을 뺀 값이었다).
 * 해외의 **던진 예외(타임아웃·네트워크) 재시도 1회는 어댑터에 남아 있다** — 이 게이트웨이는 던진
 * 예외를 재시도하지 않으므로(아래 `logKisThrown` 뒤 그대로 throw) 지우면 기능 후퇴다.
 *
 * 시세는 잔고와 달리 **틱당 N건 fan-out** 이라 증폭이 더 민감하다. 평상일 상한: 2026-10-31 시세
 * 769건 중 실패 62건 × 최대 2회 = **+16%**. 다만 이것은 평상일 기준이고, **장애가 지속되면 영향받는
 * 종목마다 호출이 3배**가 된다 — 그리고 실제 비용은 호출 수보다 **순차 호출부의 지연**으로 나타난다
 * (소진 1건당 +1.3~1.8초. T-133 Reviewer L-2·L-3).
 *
 * 재시도는 매번 `acquireKisSlot` 으로 **줄을 다시 서므로** 버스트가 아니다.
 *
 * 실제 복구 분포(T-132 배포 직후 운영 로그, 재시도가 붙은 17건): **첫 재시도 복구 11 · 두 번째 복구
 * 2 · 소진 4.** 처음 적었던 "관측된 복구는 전부 2회차" 는 12분 표본의 3건만 보고 쓴 것이라 틀렸다 —
 * 재시도 예산 2 가 실제로 두 번째 회차에서도 쓰인다(Reviewer L-2, 예산을 1 로 줄이지 않은 근거).
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
 *
 * ## §호출 기록 (T-040)
 *
 * 실제 HTTP 시도 1번마다 `api-usage` 한 줄(`api:'kis'`, `op` = `label` 변환)을 남긴다.
 *  - 레이트리밋 재시도도 KIS 에 실제로 간 호출이므로 **시도마다** 한 줄, 실패(`err:'http'`, 실제 상태 — 보통 500).
 *    드물게 HTTP 2xx + 레이트리밋 본문이면 아래 rt_cd 규칙과 같게 `err:'other'`, status 그대로.
 *  - HTTP 2xx 인데 본문 `rt_cd` 가 `'0'` 이 아니면(업무 실패) 실패(`err:'other'`, `status` 200 그대로).
 *    `rt_cd` 값 자체는 남기지 않는다 — 판정은 불리언으로만 반영한다.
 *  - 유량 대기열 초과·대기 시간초과(`KisThrottle*Error`)는 KIS 에 가지 않았으므로 기록하지 않는다.
 *  - 시간은 **토큰을 받은 뒤**부터 잰다(대기열 시간 제외 — 타임아웃과 같은 기준).
 * 기록은 `@/lib/api-usage` 를 거치며 **던지지 않는다** — 반환값·예외·재시도·스로틀 동작은 기록 전과 같다.
 */

import {
  acquireKisSlot, currentKisPriority, DEFAULT_MAX_QUEUE_WAIT_MS, type KisPriority,
} from './kis-throttle';
import { logUsage, opOf, usageClock, usageErrKind } from '@/lib/api-usage';

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
  /**
   * 레이트리밋이 **아닌** 일시 실패(게이트웨이 5xx·업무 실패)를 몇 번 재시도할지. 기본 0 =
   * 기존 동작(호출부가 판단). 상세는 위 §일시 실패 재시도.
   *
   * 🔴 **멱등한 읽기 전용 조회에만 쓴다** — 주문 송신에 켜면 중복 주문이 될 수 있다.
   */
  transientRetries?: number;
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
/**
 * `transientRetries` 상한. 호출부는 전부 2 지만, 누가 큰 값을 넘겨 KIS 장애 중에 한 호출이 수십 번
 * 재시도하는 일을 구조적으로 막는다. 상한을 넘기면 조용히 깎인다. (T-132 Reviewer I-2)
 */
const MAX_TRANSIENT_RETRIES = 5;
/** 백오프 — 인덱스가 재시도 회차. 지터를 더해 여러 호출이 같은 순간에 몰리지 않게 한다. */
const BACKOFF_MS = [400, 1200];
const JITTER_MS  = 200;

function backoffFor(attempt: number): number {
  const base = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
  return base + Math.floor(Math.random() * JITTER_MS);
}

const sleep = (ms: number) => new Promise<void>(r => { const t = setTimeout(r, ms); t.unref?.(); });

/**
 * KIS 업무 결과 코드 `rt_cd`(최상위 키). `'0'` 이 성공. 없으면(`tokenP` 등) `null`.
 * 본문 전체를 JSON 파싱하지 않고 키 하나만 찾는다(대량 응답에서도 비용이 작게). 던지지 않는다.
 */
const RT_CD_PATTERN = /"rt_cd"\s*:\s*"([^"]*)"/;
function rtCdOf(body: string): string | null {
  try {
    const m = RT_CD_PATTERN.exec(body);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * 토큰 계열 오류. HTTP 500 으로 오지만 재시도가 아니라 **재발급**이 답이고, 그것은 호출부가 한다
 * (아래 `isKisTokenError()` → DB 재읽기 → 값이 같을 때만 `invalidateKisToken()` → 1회 재시도).
 * 여기서 먼저 재시도하면 죽은 토큰으로 두 번 더 때린 뒤에야 재발급에 닿는다. (T-132 Reviewer L-3)
 *
 * (T-133) 호출부가 `body.includes('EGW00123')` 를 손으로 적던 때는 `EGW00121` 이 사각지대였다 —
 * 게이트웨이는 재시도를 건너뛰고 호출부는 재발급도 안 했다. 그래서 판정을 함수로 공개했다.
 */
const TOKEN_ERROR_PATTERN = /EGW00121|EGW00123|만료된 token/;

/**
 * 응답 본문이 **토큰 계열 오류**인가. 위 패턴과 **같은 출처**를 호출부에 공개한다.
 *
 * (T-133 QA #2) 어댑터들이 저마다 `body.includes('EGW00123')` 를 손으로 적어, 게이트웨이는
 * `EGW00121` 도 토큰 오류로 보고 재시도를 건너뛰는데 호출부는 그걸 재발급 대상으로 보지 않는
 * **드리프트**가 생겼다. 그 결과 `EGW00121` + 토큰 회전 상황에서 시세가 복구되지 않았다.
 * 새로 토큰 분기를 쓰는 호출부는 이 함수를 쓴다.
 */
export function isKisTokenError(body: string): boolean {
  return TOKEN_ERROR_PATTERN.test(body);
}

/**
 * 레이트리밋이 아닌 **일시 실패**인가. `transientRetries` 를 켠 호출부에만 적용된다.
 *
 * 두 모양을 함께 본다 — 2026-10-31 KIS 장애에서 같은 창에 둘 다 나왔다(T-132):
 *  - HTTP 5xx (`EGW00300 Gateway 라우팅 오류`)
 *  - HTTP 2xx + `rt_cd` 가 `'0'` 이 아님 (`OPSQ1002 SESSION FULL` — rt_cd `"9"`)
 *
 * 업무 실패를 일시로 보는 것이 넓어 보이지만, 이 판정은 **옵트인한 호출부**(잔고·예수금 조회)에만
 * 쓰이고 그 경로의 업무 실패는 평시 0건이다(10-27·29 42건/일, 10-30 40건이 전부
 * `domestic.market-cap-ranking` — 실측). 영구 실패여도 비용은 짧은 재시도 두 번뿐이다.
 *
 * 레이트리밋은 여기서 보지 않는다 — 호출부가 그걸 켜도 레이트리밋은 위 §재시도 증폭 경로가
 * 이미 백오프를 소진했으므로 **두 번 물러서지 않는다.**
 */
export function isTransientKisFailure(status: number, body: string): boolean {
  if (TOKEN_ERROR_PATTERN.test(body)) return false;
  if (status >= 500) return true;
  const rtCd = rtCdOf(body);
  return rtCd !== null && rtCd !== '0';
}

/** 시도 1번의 기록. 던지지 않는다. op 는 코드 상수 label 에서만 만든다. */
function logKisAttempt(label: string, t0: number, res: Response, body: string, rateLimited: boolean): void {
  try {
    const op = opOf(label);
    const ms = usageClock() - t0;
    if (!res.ok) {
      // HTTP 실패(레이트리밋 HTTP 500 포함 — 사용자 결정 2026-10-10: 시도마다 http/실제 상태).
      logUsage({ api: 'kis', op, ok: false, status: res.status, ms, err: 'http' });
      return;
    }
    if (rateLimited) {
      // HTTP 2xx 인데 본문이 레이트리밋 — HTTP 상태는 성공이므로 rt_cd 업무 실패와 같은 규칙(other/200).
      // (KIS 는 실제로 500 으로 주므로 드문 경우다. Leader 결정 2026-10-18, Reviewer L-2)
      logUsage({ api: 'kis', op, ok: false, status: res.status, ms, err: 'other' });
      return;
    }
    const rtCd = rtCdOf(body);
    if (rtCd !== null && rtCd !== '0') {
      // HTTP 200 + 업무 실패(사용자 결정 2026-10-10): 실패로 센다. err 는 전송 계층이 아니므로 'http' 가 아니다.
      logUsage({ api: 'kis', op, ok: false, status: res.status, ms, err: 'other' });
      return;
    }
    logUsage({ api: 'kis', op, ok: true, status: res.status, ms });
  } catch {
    /* 기록 실패는 본 흐름을 바꾸지 않는다 */
  }
}

/** fetch 자체가 던진 시도의 기록. 자체 타이머 abort 는 timeout. 던지지 않는다. */
function logKisThrown(label: string, t0: number, e: unknown, timedOut: boolean): void {
  try {
    logUsage({
      api: 'kis', op: opOf(label), ok: false, status: 0, ms: usageClock() - t0,
      err: timedOut ? 'timeout' : usageErrKind(e),
    });
  } catch {
    /* 기록 실패는 본 흐름을 바꾸지 않는다 */
  }
}

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
  const transientRetries = Math.min(Math.max(0, opts.transientRetries ?? 0), MAX_TRANSIENT_RETRIES);
  const label    = opts.label ?? '';

  /**
   * 🔴 멱등성 울타리 (T-132 Reviewer M-1). `transientRetries` 는 **GET 조회에만** 허용한다.
   *
   * 주문 송신(POST)에 켜지면 KIS 가 이미 접수한 주문을 우리가 실패로 보고 다시 보내 **중복 주문**이
   * 된다. 호출 지점을 세는 정적 시험은 옵션 객체를 변수·스프레드로 넘기면 통과하므로, 여기서 한 번 더
   * 막는다. 요청을 **보내기 전에** 던지므로 실패 방향이 안전하다(주문이 나가지 않는다).
   */
  if (transientRetries > 0) {
    const method = (init.method ?? 'GET').toUpperCase();
    if (method !== 'GET') {
      throw new Error(
        `[kis-http] transientRetries 는 GET 조회에만 허용된다 — method=${method} label=${label || '-'}`,
      );
    }
  }

  let attempt = 0;            // 레이트리밋 재시도 회차
  let transientAttempt = 0;   // 일시 실패 재시도 회차 — 레이트리밋 예산과 따로 센다
  let tries   = 0;            // 실제 HTTP 시도 횟수(진단용)
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

    const t0 = usageClock();   // §호출 기록 — 토큰을 받은 뒤부터 잰다
    let res: Response;
    try {
      res = await fetch(url, ctrl ? { ...init, signal: ctrl.signal } : init);
    } catch (e) {
      logKisThrown(label, t0, e, ctrl?.signal.aborted === true);
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }

    const body = await res.text().catch(() => '');
    const rateLimited = isKisRateLimitBody(body);
    logKisAttempt(label, t0, res, body, rateLimited);
    const replay = replayResponse(res, body);
    tries += 1;
    META.set(replay, { rateLimited, attempts: tries, priority, body });

    if (rateLimited) {
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
      continue;
    }

    // ④ 일시 실패(§일시 실패 재시도) — 켜 둔 호출부만. 소진하면 마지막 응답을 그대로 돌려주므로
    //    호출부의 기존 실패 처리(던지기·경보)는 변하지 않는다.
    if (transientAttempt < transientRetries && isTransientKisFailure(res.status, body)) {
      console.warn(
        `[kis-http] 일시 실패 재시도${label ? ` (${label})` : ''} — `
        + `status=${res.status} ${transientAttempt + 1}/${transientRetries}회차. lane=${priority}`,
      );
      await sleep(backoffFor(transientAttempt));
      transientAttempt += 1;
      continue;
    }

    if (transientAttempt > 0) {
      // (Reviewer L-6) 재시도가 **구해 준** 호출을 사후에 셀 수 있게 한 줄 남긴다. `api-usage` 는
      // 시도마다 한 줄이라 "재시도 덕에 복구된 호출 수"가 어디에도 집계되지 않는다.
      //
      // 성공 판정에 HTTP 상태만 쓰면 안 된다 — 이 장애의 두 번째 모양(`SESSION FULL`)은 **HTTP 200**
      // 이라, 재시도를 다 쓰고 실패한 호출이 "성공" 으로 집계된다(Reviewer N-1).
      const recovered = res.ok && !isTransientKisFailure(res.status, body);
      console.warn(
        `[kis-http] 일시 실패 재시도 ${recovered ? '성공' : '소진'}${label ? ` (${label})` : ''} — `
        + `${tries}회 시도, status=${res.status}. lane=${priority}`,
      );
    }
    return replay;
  }
}
