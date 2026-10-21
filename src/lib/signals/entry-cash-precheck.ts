/**
 * T-051 — 진입 감시(`cron/entry-watcher`)의 **가용 현금 사전 점검**.
 *
 * ## 왜 필요한가
 * 카드 금액(예: 10만 원)이 가용 현금(예: 8만 원)보다 크면, 승인된 매수 시그널이 진입 구간에 있는 동안
 * 선점(T-043) → `submitOrder` → 거래소 거부 → 선점 복귀가 **매 분** 반복된다(카드당 하루 최대 약 390회, `orders`/`trade_logs`
 * 행과 KIS 주문 호출 1회씩). 돈이 나가는 위험은 아니고 소음·API 낭비다. 선점 **전에** 현금을 보고 모자라면 이번 틱을 건너뛴다.
 *
 * ## 이 점검의 성격 — 편의 기능이지 안전 관문이 아니다
 * - **주문을 더 막기만 한다.** "충분"이어도 호출부는 기존 경로(`submitOrder` 의 킬스위치·한도·DRY_RUN)를 그대로 탄다.
 * - **모르면 막지 않는다.** 잔고 조회 실패·값 이상·수량/가격 미확정은 `unknown` → 호출부는 기존 동작을 따른다.
 *   잔고 조회가 흔들릴 때 정상 주문을 막으면 이 기능이 사고가 된다.
 *
 * ## 현금 출처
 * `getBalancesDetailed()`(kis 진입점) 의 **국내** KRW 행 `free` = `kis-domestic.getBalances` 의 `prvs_rcdl_excc_amt`
 * (D+2 가수도정산금액, 결제 반영 예수금). 해외 조회가 실패해도 국내가 성공했으면 쓴다(`getBalances()` 는 한쪽만 실패해도 던진다).
 * 미체결 매수 주문이 묶은 금액은 이 값에서 빠지지 않는다 → 그때는 "충분"으로 보고 기존 경로(거래소 거부)로 간다 — 막는 쪽으로 틀리지 않는다.
 * 미수(증거금) 매수를 쓰는 계좌라면 거래소는 현금보다 큰 주문을 받을 수 있으므로 이 점검이 그런 주문을 막는다 — 현재 계좌는
 * 현금 매수 전용이라는 전제다(T-051 이력서에 남은 위험으로 기록).
 */
import { getBalancesDetailed } from '@/lib/exchanges/kis';

/**
 * 예상 비용 여유. 지정가는 어댑터가 호가단위로 **반올림**해 송신하고(최대 반 틱 ≈ 0.125%), 매수 수수료(약 0.015%)가 붙는다.
 * 그 합(≈0.14%)을 덮는 가장 작은 값으로 둔다. 크게 잡으면 거래소가 받아 줄 주문까지 막는다.
 */
export const ENTRY_CASH_BUFFER_RATIO = 0.002;
/** 국내 현금 캐시. entry-watcher 는 분당 1회라 틱마다 최대 1회 조회한다(같은 틱 안의 여러 시그널은 한 번의 조회를 공유). */
export const ENTRY_CASH_CACHE_TTL_MS = 30_000;

export type EntryCashVerdict =
  | { kind: 'sufficient'; requiredKRW: number; availableKRW: number }
  | { kind: 'insufficient'; requiredKRW: number; availableKRW: number; shortfallKRW: number }
  | { kind: 'unknown'; reason: string };

/** 수량 × 가격 × (1 + 여유), 원 단위 올림. 부동소수 꼬리(100000 × 1.002 = 100200.00000000001)는 올림 전에 걷어낸다. 비정상이면 null. */
export function estimateEntryCostKRW(quantity: number, price: number, bufferRatio: number): number | null {
  if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity <= 0) return null;
  if (!Number.isFinite(price) || price <= 0) return null;
  if (!Number.isFinite(bufferRatio) || bufferRatio < 0) return null;
  const raw = quantity * price * (1 + bufferRatio);
  if (!Number.isFinite(raw)) return null;
  return Math.ceil(Math.round(raw * 1e6) / 1e6);
}

/**
 * 송신 수량 추정 — 사이징이 수량을 확정했으면 그것, 아니면(시장가) 어댑터가 하는 파생 그대로
 * `floor(amountKRW / price)` (`kis-domestic.ts` createOrder 의 `quantity` 줄). 가격을 모르면 undefined.
 */
export function effectiveEntryQuantity(args: { quantity: number | undefined; amountKRW: number; price: number | undefined }): number | undefined {
  if (args.quantity !== undefined) return args.quantity;
  const { price, amountKRW } = args;
  if (price == null || !Number.isFinite(price) || price <= 0 || !Number.isFinite(amountKRW)) return undefined;
  return Math.floor(amountKRW / price);
}

/** 순수 판정. 현금이 예상 비용 이상이면 sufficient(같으면 sufficient), 모자라면 insufficient, 판단할 수 없으면 unknown. */
export function judgeEntryCash(args: {
  availableCashKRW: number | null | undefined;
  quantity: number | undefined;
  price: number | undefined;
  bufferRatio?: number;
}): EntryCashVerdict {
  const cash = args.availableCashKRW;
  if (cash == null || !Number.isFinite(cash) || cash < 0) return { kind: 'unknown', reason: `cash=${String(cash)}` };
  if (args.quantity == null || args.price == null) return { kind: 'unknown', reason: 'quantity/price 미확정' };
  const required = estimateEntryCostKRW(args.quantity, args.price, args.bufferRatio ?? ENTRY_CASH_BUFFER_RATIO);
  if (required == null) return { kind: 'unknown', reason: `quantity=${args.quantity} price=${args.price}` };
  if (cash >= required) return { kind: 'sufficient', requiredKRW: required, availableKRW: cash };
  return { kind: 'insufficient', requiredKRW: required, availableKRW: cash, shortfallKRW: required - cash };
}

interface BalancesLike { ok?: unknown; balances?: unknown }

/** 국내 조회가 성공했고 KRW 행이 정상일 때만 그 `free`. 실패한 시장의 빈 잔고를 "현금 0"으로 읽지 않는다. */
export function domesticCashFromBalances(r: BalancesLike | null | undefined): number | null {
  if (!r || !Array.isArray(r.ok) || !r.ok.includes('domestic') || !Array.isArray(r.balances)) return null;
  const krw = (r.balances as Array<{ currency?: unknown; free?: unknown }>).find((b) => b && b.currency === 'KRW');
  if (!krw) return null;
  return parseCashAmount(krw.free);
}

/**
 * T-058 — 해외 USD 예수금. `cash.USD.state === 'known'` 이고 값이 유효할 때만 그 값, 아니면 null + 이유 코드.
 * `unknown`(조회 실패)·`not_queried`(해외 비활성)를 **0 으로 읽지 않는다**(T-056 계약). 이유 코드는 로그용이라 수치를 담지 않는다.
 */
export function overseasUsdCashFromBalances(
  r: { cash?: unknown } | null | undefined,
): { usd: number; reason: null } | { usd: null; reason: 'usd_missing' | 'usd_not_queried' | 'usd_unknown' | 'usd_invalid' } {
  const usd = (r?.cash as { USD?: unknown } | undefined)?.USD as { state?: unknown; usd?: unknown } | undefined;
  if (!usd || typeof usd !== 'object') return { usd: null, reason: 'usd_missing' };
  if (usd.state === 'not_queried') return { usd: null, reason: 'usd_not_queried' };
  if (usd.state !== 'known') return { usd: null, reason: 'usd_unknown' };
  const v = parseCashAmount(usd.usd);
  return v == null ? { usd: null, reason: 'usd_invalid' } : { usd: v, reason: null };
}

/**
 * T-058 — `getBalancesDetailed()` **한 번**에서 읽은 시장별 가용 현금. 각 값은 모르면 null(0 으로 읽지 않는다).
 * 국내 값은 T-051 의 `domesticCashFromBalances` 그대로다. 해외 USD 는 같은 응답의 `cash.USD` 다(KIS 호출을 늘리지 않는다).
 */
export interface AvailableCash {
  domesticKRW: number | null;
  overseasUSD: number | null;
  /** `overseasUSD` 가 null 인 이유 코드. 값이 있으면 null */
  overseasUnknownReason: string | null;
}

function cashFromBalances(r: (BalancesLike & { cash?: unknown }) | null | undefined): AvailableCash {
  const usd = overseasUsdCashFromBalances(r);
  return { domesticKRW: domesticCashFromBalances(r), overseasUSD: usd.usd, overseasUnknownReason: usd.reason };
}

const CASH_READ_FAILED: AvailableCash = { domesticKRW: null, overseasUSD: null, overseasUnknownReason: 'balances_read_failed' };

/**
 * 현금 값의 **원시 타입을 변환 전에** 검증한다(라운드 3, Codex C2). `Number('')`·`Number(null)`·`Number(false)` 는 모두 0 이라
 * 그대로 변환하면 "알 수 없음"이 **확정적인 현금 0원**이 되어 정상 주문을 막고, 그 0 이 TTL 동안 캐시된다 — "모르면 기존 경로" 위반.
 * 유효: 유한한 비음수 숫자, 또는 공백을 걷은 뒤 `^\d+(\.\d+)?$` 인 문자열. 진짜 0(`0`·`'0'`)은 유효한 현금 0원이다.
 * 그 밖(null·undefined·빈/공백 문자열·boolean·객체·`'12abc'`·`'1e3'`·`'0x10'`·`'-1'`·NaN·Infinity·음수)은 null.
 */
function parseCashAmount(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v === 'string') {
    const t = v.trim();
    return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null;
  }
  return null;
}

/**
 * 현금 읽기 시간 상한(T-051 Reviewer R-2). `getBalancesDetailed()` 는 국내만 필요해도 해외 잔고·환율까지 함께 기다리고 통신 구간
 * 타임아웃이 없어, 해외 쪽이 느리면 국내 매수의 **선점 전 구간**이 그만큼 늘어난다(분당 cron 틱 지연). 상한을 넘으면 판단불가(null) →
 * 호출부는 기존 경로. KIS 요청 자체는 취소하지 못한다(어댑터에 취소 수단이 없다) — 기다리지 않을 뿐이다.
 */
export const CASH_READ_TIMEOUT_MS = 8_000;

/**
 * 캐시·진행 중 조회는 **잔고 응답 하나**(국내 KRW + 해외 USD)를 단위로 둔다(T-058). 국내만 읽는 entry-watcher(T-051)와
 * 시그널 생성 게이트(T-058)가 같은 프로세스에서 같은 조회를 공유한다 — KIS 호출이 시장 수만큼 늘지 않는다.
 * 국내 쪽 의미(TTL·공유 마감·늦은 결과 미캐시·실패 캐시)는 T-051 그대로다.
 */
let cache: { at: number; value: AvailableCash } | null = null;
/** 진행 중인 조회와 그 **시작 시각**. 시작 시각이 공유 마감의 기준이다(라운드 3 — 아래 설명). */
let inFlight: { promise: Promise<AvailableCash>; startedAt: number } | null = null;

/** 테스트용 */
export function resetEntryCashCache(): void { cache = null; inFlight = null; }

/** 국내 가용 현금(KRW). 아래 {@link readAvailableCash} 의 국내 값 — 의미는 T-051 그대로다. */
export async function readDomesticAvailableCashKRW(
  now: () => number = Date.now,
  timeoutMs: number = CASH_READ_TIMEOUT_MS,
): Promise<number | null> {
  const r = await readAvailableCash(now, timeoutMs);
  return r ? r.domesticKRW : null;
}

/**
 * 시장별 가용 현금. **던지지 않는다** — 상한 초과는 null, 조회 실패는 모든 값이 null 인 결과(호출부는 기존 동작).
 *
 * - 상한 안에 끝난 조회는 성공·실패 모두 TTL 동안 캐시한다(KIS 장애 중에 시그널마다 조회를 반복하지 않게).
 * - 동시 호출은 진행 중인 조회 하나를 공유한다. 상한을 넘긴 조회도 끝날 때까지는 공유된다 — 걸려 있는 KIS 요청 위에
 *   새 요청을 쌓지 않기 위해서다.
 * - 🔴 **공유 마감**(라운드 3, Codex C2·Reviewer R2-1): 상한은 호출마다가 아니라 **조회 하나에** 건다. 공유자는
 *   `timeoutMs − (지금 − 조회 시작 시각)` 만 기다리고, 남은 시간이 0 이하면 기다리지 않고 바로 null 이다. 호출마다 새 8초를 주면
 *   멈춘 조회에 진입 구간 시그널 N개가 차례로 붙어 선점 전 대기가 N × 8초(20개면 약 160초 — 분당 cron 틱이 겹친다)가 된다.
 *   이제 한 조회에 걸리는 총 대기는 상한 한 번을 넘지 않는다. 조회가 끝나면(성공·실패·늦은 도착) 시작 시각과 함께 정리되고,
 *   다음 호출은 새 조회를 시작해 상한 전체를 다시 쓴다.
 * - **상한을 넘겨 늦게 끝난 조회의 결과는 캐시에 넣지 않는다.** 시작 시각 기준으로 상한을 넘겼으면 버린다 — 이미 판단불가로
 *   넘어간 호출의 늦은 값이 이후 틱에 "방금 읽은 값"처럼 쓰이지 않게. 그 값은 그 순간 아직 기다리던 공유자만 받는다.
 */
export async function readAvailableCash(
  now: () => number = Date.now,
  timeoutMs: number = CASH_READ_TIMEOUT_MS,
): Promise<AvailableCash | null> {
  if (cache && now() - cache.at < ENTRY_CASH_CACHE_TTL_MS) return cache.value;
  if (inFlight) {
    const remaining = timeoutMs - (now() - inFlight.startedAt);
    if (remaining <= 0) return null;                                    // 공유 마감이 지났다 — 기다리지 않는다(판단불가)
    return withTimeout(inFlight.promise, remaining);
  }
  const startedAt = now();
  // 조회 자신의 마감 — 시작한 호출의 상한과 같은 시각에 "늦음"으로 표시된다. 시각 비교 대신 타이머 표시를 쓰는 이유:
  // 시작한 호출이 판단불가(null)로 넘어간 바로 그 순간부터 결과를 버리는 것이 보장된다(경계에서 흔들리지 않는다).
  let late = false;
  const deadline = setTimeout(() => { late = true; }, timeoutMs);
  const p: Promise<AvailableCash> = (async () => {
    let value: AvailableCash = CASH_READ_FAILED;
    try {
      value = cashFromBalances(await getBalancesDetailed());
    } catch (e) {
      console.warn('[entry-cash-precheck] 국내 잔고 조회 실패 — 현금 점검 생략(기존 동작):', e instanceof Error ? e.message : String(e));
    }
    clearTimeout(deadline);
    if (!late) cache = { at: now(), value };
    else console.warn(`[entry-cash-precheck] 잔고 조회가 상한(${timeoutMs}ms)을 넘겨 끝남 — 결과를 캐시하지 않음`);
    return value;
  })().finally(() => { if (inFlight?.promise === p) inFlight = null; });
  inFlight = { promise: p, startedAt };
  return withTimeout(p, timeoutMs);
}

/** `p` 를 최대 `ms` 까지 기다리고, 넘으면 null. 타이머는 항상 정리한다. */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[entry-cash-precheck] 잔고 조회 ${ms}ms 초과 — 현금 점검 생략(기존 동작)`);
      resolve(null);
    }, ms);
  });
  try {
    return await Promise.race([p, limit]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
