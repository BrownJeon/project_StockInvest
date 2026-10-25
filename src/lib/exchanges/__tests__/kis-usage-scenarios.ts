/**
 * T-040 — `kisFetch` 호출 기록 시험의 **공용 시나리오**(시험 파일 아님 — `*.test.ts` 가 아니라 jest 가 직접 돌리지 않는다).
 *
 * 같은 시나리오를 세 조건에서 돌려 **관찰 가능한 결과가 한 글자도 다르지 않음**을 고정한다.
 *   1. 기록이 정상으로 쌓이는 디렉터리            (`kis-http-usage.test.ts`)
 *   2. 쓸 수 없는 `API_USAGE_LOG_DIR`              (`kis-http-usage.test.ts`)
 *   3. 기록 패키지의 모든 함수가 던지는 경우        (`kis-usage-isolation.test.ts`, jest.mock 스위치)
 *
 * 결과 = 반환 Response 의 상태·본문·레이트리밋 판정·시도 횟수, 또는 던진 예외(같은 객체인지까지), 그리고 fetch 호출 수.
 * 외부 HTTP 는 부르지 않는다 — 전역 fetch 를 시나리오마다 갈아 끼운다.
 */
import {
  kisFetch, isKisRateLimited, kisAttempts, kisBodyText, type KisFetchOptions,
} from '../kis-http';
import { acquireKisSlot, __resetKisThrottleForTest, __LANE_CAPACITY } from '../kis-throttle';

export const RATE_LIMIT_BODY =
  '{"rt_cd":"1","msg1":"초당 거래건수를 초과하였습니다.","msg_cd":"EGW00201","message":"EGW00201"}';
/** rt_cd 가 없는 레이트리밋 본문 — HTTP 200 분기를 rt_cd 규칙과 독립으로 시험하려고(rt_cd 가 있으면 그 규칙이 먼저 잡아 분기가 가려진다). */
export const RATE_LIMIT_BODY_NO_RTCD = '{"msg_cd":"EGW00201","message":"EGW00201"}';

/** 기록 줄에 절대 나오면 안 되는 값 — 아래 시나리오의 URL·헤더·본문에 일부러 심어 둔다. */
export const FORBIDDEN_FRAGMENTS = [
  'https:', 'kis.example', 'uapi', 'inquire-price', 'FID_INPUT_ISCD', 'Bearer', 'SECRET', '005930', '12345678', 'CANO', '70000', 'APBK', '주문',
  'access_token', 'EGW', 'msg1', 'ECONNREFUSED', 'fetch failed', 'aborted',
];

const URL = 'https://kis.example/uapi/domestic-stock/v1/quotations/inquire-price?FID_INPUT_ISCD=005930&CANO=12345678';
const INIT: RequestInit = {
  method: 'POST',
  headers: { Authorization: 'Bearer SECRET-TOKEN-xyz', appkey: 'SECRET-APPKEY' },
  body: JSON.stringify({ CANO: '12345678', PDNO: '005930', ORD_QTY: '3', ORD_UNPR: '70000' }),
};

type Step = { status: number; body: string } | { throws: () => unknown } | { waitAbort: true };

export interface Scenario {
  name: string;
  label: string;
  steps: Step[];
  opts?: Partial<KisFetchOptions>;
  /** 유량 대기열을 미리 채워 둔다(대기열 초과) */
  fillQueue?: boolean;
  /** 기록이 쌓이는 조건에서 기대하는 줄(ts·ms 제외) */
  expectLines: Array<{ op: string; ok: boolean; status: number; err?: string }>;
}

export const SCENARIOS: Scenario[] = [
  {
    name: 'success',
    label: 'domestic getTicker',
    steps: [{ status: 200, body: '{"rt_cd":"0","msg1":"정상처리","output":{"stck_prpr":"70000"}}' }],
    expectLines: [{ op: 'domestic.get-ticker', ok: true, status: 200 }],
  },
  {
    name: 'rt-cd-business-failure',
    label: 'domestic createOrder',
    steps: [{ status: 200, body: '{"rt_cd":"1","msg_cd":"APBK0013","msg1":"주문가능금액을 초과 했습니다"}' }],
    expectLines: [{ op: 'domestic.create-order', ok: false, status: 200, err: 'other' }],
  },
  {
    name: 'rate-limit-then-ok',
    label: 'overseas getTicker',
    opts: { rateLimitRetries: 1 },
    steps: [{ status: 500, body: RATE_LIMIT_BODY }, { status: 200, body: '{"rt_cd":"0","output":{}}' }],
    expectLines: [
      { op: 'overseas.get-ticker', ok: false, status: 500, err: 'http' },
      { op: 'overseas.get-ticker', ok: true, status: 200 },
    ],
  },
  {
    name: 'rate-limit-exhausted',
    label: 'domestic getBalances',
    opts: { rateLimitRetries: 1 },
    steps: [{ status: 500, body: RATE_LIMIT_BODY }, { status: 500, body: RATE_LIMIT_BODY }],
    expectLines: [
      { op: 'domestic.get-balances', ok: false, status: 500, err: 'http' },
      { op: 'domestic.get-balances', ok: false, status: 500, err: 'http' },
    ],
  },
  {
    // Reviewer L-2 / Leader 결정: HTTP 200 + 레이트리밋 본문 → other/200(rt_cd 규칙과 같게). 재시도 동작은 그대로(500 일 때와 같은 백오프 재시도).
    name: 'rate-limit-http200',
    label: 'overseas getBalances',
    opts: { rateLimitRetries: 1 },
    steps: [{ status: 200, body: RATE_LIMIT_BODY_NO_RTCD }, { status: 200, body: RATE_LIMIT_BODY_NO_RTCD }],
    expectLines: [
      { op: 'overseas.get-balances', ok: false, status: 200, err: 'other' },
      { op: 'overseas.get-balances', ok: false, status: 200, err: 'other' },
    ],
  },
  {
    name: 'server-5xx-no-retry',
    label: 'domestic getDailyCandles',
    steps: [{ status: 502, body: '<html>bad gateway 005930</html>' }],
    expectLines: [{ op: 'domestic.get-daily-candles', ok: false, status: 502, err: 'http' }],
  },
  {
    name: 'token-without-rt-cd',
    label: 'tokenP',
    steps: [{ status: 200, body: '{"access_token":"SECRET-TOKEN-abc","expires_in":86400}' }],
    expectLines: [{ op: 'token-p', ok: true, status: 200 }],
  },
  {
    name: 'network-throw',
    label: 'search-info(ticker/all)',
    steps: [{ throws: () => new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:443'), { code: 'ECONNREFUSED' }) }) }],
    expectLines: [{ op: 'search-info.ticker.all', ok: false, status: 0, err: 'network' }],
  },
  {
    name: 'own-timeout-abort',
    label: 'overseas createOrder',
    opts: { timeoutMs: 30 },
    steps: [{ waitAbort: true }],
    expectLines: [{ op: 'overseas.create-order', ok: false, status: 0, err: 'timeout' }],
  },
  {
    name: 'throttle-queue-full',
    label: 'domestic getMinuteCandles',
    opts: { priority: 'bulk' },
    fillQueue: true,
    steps: [],
    expectLines: [],   // KIS 에 가지 않았으므로 기록하지 않는다
  },
];

export type Outcome =
  | { kind: 'response'; status: number; ok: boolean; text: string; bodyText: string | null; rateLimited: boolean; attempts: number; fetchCalls: number }
  | { kind: 'throw'; name: string; message: string; sameObject: boolean; fetchCalls: number };

/** 시나리오 하나를 실행하고 관찰 가능한 결과를 돌려준다. 전역 fetch 는 끝나면 원래대로 돌려 둔다. */
export async function runScenario(s: Scenario): Promise<Outcome> {
  const original = global.fetch;
  let calls = 0;
  let thrown: unknown;
  const fake = async (_url: unknown, init?: RequestInit): Promise<Response> => {
    const step = s.steps[Math.min(calls, s.steps.length - 1)];
    calls += 1;
    if ('throws' in step) {
      thrown = step.throws();
      throw thrown;
    }
    if ('waitAbort' in step) {
      return new Promise<Response>((_res, rej) => {
        const sig = init?.signal;
        sig?.addEventListener('abort', () => {
          thrown = sig.reason ?? new DOMException('This operation was aborted', 'AbortError');
          rej(thrown);
        });
      });
    }
    return new Response(step.body, { status: step.status, headers: { 'content-type': 'application/json' } });
  };
  (global as unknown as { fetch: unknown }).fetch = fake;
  __resetKisThrottleForTest(s.fillQueue ? 0.2 : 1000);
  if (s.fillQueue) {
    Array.from({ length: __LANE_CAPACITY.bulk }, () => acquireKisSlot('bulk').catch(() => {}));
  }
  try {
    const res = await kisFetch(URL, INIT, { ...s.opts, label: s.label });
    const text = await res.text();
    return {
      kind: 'response', status: res.status, ok: res.ok, text, bodyText: kisBodyText(res),
      rateLimited: isKisRateLimited(res), attempts: kisAttempts(res), fetchCalls: calls,
    };
  } catch (e) {
    const err = e as { name?: string; message?: string };
    return {
      kind: 'throw', name: String(err?.name), message: String(err?.message),
      sameObject: thrown === undefined ? true : e === thrown, fetchCalls: calls,
    };
  } finally {
    (global as unknown as { fetch: unknown }).fetch = original;
    __resetKisThrottleForTest();
  }
}

/** 모든 시나리오 실행 결과(이름 → 결과). */
export async function runAll(): Promise<Record<string, Outcome>> {
  const out: Record<string, Outcome> = {};
  for (const s of SCENARIOS) out[s.name] = await runScenario(s);
  return out;
}

/**
 * 기록 유무와 무관하게 **같아야 하는** 결과. 세 조건 모두 이 값과 같아야 한다
 * (기록이 끼기 전 동작 = 기존 kis-http.test.ts 가 고정한 동작과 같은 값).
 */
export const EXPECTED_OUTCOMES: Record<string, Outcome> = {
  'success': {
    kind: 'response', status: 200, ok: true,
    text: '{"rt_cd":"0","msg1":"정상처리","output":{"stck_prpr":"70000"}}',
    bodyText: '{"rt_cd":"0","msg1":"정상처리","output":{"stck_prpr":"70000"}}',
    rateLimited: false, attempts: 1, fetchCalls: 1,
  },
  'rt-cd-business-failure': {
    kind: 'response', status: 200, ok: true,
    text: '{"rt_cd":"1","msg_cd":"APBK0013","msg1":"주문가능금액을 초과 했습니다"}',
    bodyText: '{"rt_cd":"1","msg_cd":"APBK0013","msg1":"주문가능금액을 초과 했습니다"}',
    rateLimited: false, attempts: 1, fetchCalls: 1,
  },
  'rate-limit-then-ok': {
    kind: 'response', status: 200, ok: true, text: '{"rt_cd":"0","output":{}}', bodyText: '{"rt_cd":"0","output":{}}',
    rateLimited: false, attempts: 2, fetchCalls: 2,
  },
  'rate-limit-exhausted': {
    kind: 'response', status: 500, ok: false, text: RATE_LIMIT_BODY, bodyText: RATE_LIMIT_BODY,
    rateLimited: true, attempts: 2, fetchCalls: 2,
  },
  'rate-limit-http200': {
    kind: 'response', status: 200, ok: true, text: RATE_LIMIT_BODY_NO_RTCD, bodyText: RATE_LIMIT_BODY_NO_RTCD,
    rateLimited: true, attempts: 2, fetchCalls: 2,
  },
  'server-5xx-no-retry': {
    kind: 'response', status: 502, ok: false, text: '<html>bad gateway 005930</html>', bodyText: '<html>bad gateway 005930</html>',
    rateLimited: false, attempts: 1, fetchCalls: 1,
  },
  'token-without-rt-cd': {
    kind: 'response', status: 200, ok: true,
    text: '{"access_token":"SECRET-TOKEN-abc","expires_in":86400}',
    bodyText: '{"access_token":"SECRET-TOKEN-abc","expires_in":86400}',
    rateLimited: false, attempts: 1, fetchCalls: 1,
  },
  'network-throw': { kind: 'throw', name: 'TypeError', message: 'fetch failed', sameObject: true, fetchCalls: 1 },
  'own-timeout-abort': { kind: 'throw', name: 'AbortError', message: 'This operation was aborted', sameObject: true, fetchCalls: 1 },
  'throttle-queue-full': {
    kind: 'throw', name: 'KisThrottleQueueFullError', message: expect.any(String) as unknown as string,
    sameObject: true, fetchCalls: 0,
  },
};

/**
 * 현재 문자열 label 28종(2026-10-18 HEAD 21종 + 2026-10-25 HEAD 에서 늘어난 `overseas priceDetail`(T-059) + T-087 브로커 원장 읽기 전용 조회 6종
 * `domestic|overseas ledger{DailyFills,PeriodProfit,Positions}` — `grep -oE "label: '[^']+'" src`). 새 label 이 생기면 여기에 더한다.
 */
export const KIS_LABELS = [
  'domestic cancelOrder', 'domestic createOrder', 'domestic getActiveOrders', 'domestic getBalances',
  'domestic getCompletedOrders', 'domestic getDailyCandles', 'domestic getMinuteCandles', 'domestic getTicker',
  'domestic marketCapRanking', 'overseas cancelOrder', 'overseas createOrder', 'overseas getActiveOrders',
  'overseas getBalances', 'overseas getCompletedOrders', 'overseas getDailyCandles', 'overseas getTicker',
  'overseas priceDetail', 'overseas usdCash', 'search-info(lookup)', 'search-info(search)', 'search-info(ticker/all)', 'tokenP',
  // T-087 — 브로커 원장 수집(조회 TR 만, priority 'bulk')
  'domestic ledgerDailyFills', 'domestic ledgerPeriodProfit', 'domestic ledgerPositions',
  'overseas ledgerDailyFills', 'overseas ledgerPeriodProfit', 'overseas ledgerPositions',
];
