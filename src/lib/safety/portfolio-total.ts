/**
 * 포트폴리오 평가액 (KRW 환산) 조회.
 *
 * 시장별 분리 합산:
 *  - domestic: KRW 예수금 + 국내 종목(currency에 ':' 미포함) 평가금액
 *  - overseas: USD 예수금(× FX) + 해외 종목(currency 'EXCHG:SYMBOL' 형식) 평가금액(해외 시세는 이미 KRW 환산)
 *
 * 정책 (2026-04-27): 1회/일일 주문 한도 pct는 **해당 시장 평가액 × pct**로 산정.
 * 시장 합산 의미가 모호한 단순 합계는 부차적 용도(전체 portfolio summary 등)로만 노출.
 *
 * 짧은 in-memory 캐시(60초)로 중복 호출 방지. balances + tickers fetch는 단일 패스.
 *
 * ## T-056 — 시장별 **상태**를 돌려준다 (숫자 0 으로 "모름"을 부호화하지 않는다)
 *
 * 예전에는 모든 실패가 숫자 0 이었다: USD 예수금 조회 실패 → USD 누락, fx 실패 → `catch {}` 로 USD 누락, 잔고 실패 → 0/0/0.
 * 그리고 `total === 0 && cache` 이면 **나이 상한 없는 직전 캐시**를 돌려줬다. 그래서 "해외를 0 으로 만들어 막는다"는 설계가
 * 국내도 0 인 계좌에서는 직전 양수 한도를 되살렸다(Codex C1-2). 이제:
 *  - `ok`      : 그 시장의 평가액을 안다.
 *  - `unknown` : 모른다. 사유: `usd_cash_unknown`(USD 예수금 확인 불가) · `fx_unavailable`(USD 환산 불가) ·
 *                `krw_cash_unknown`(국내 예수금 요약 없음, Q3) · `balances_failed`(보유 조회 실패).
 *  - **`usd_cash_unknown`·`fx_unavailable`·`krw_cash_unknown` 에서는 캐시 폴백을 하지 않는다.** 한도 함수는 0(신규 매수 차단)을 낸다.
 *  - `balances_failed` 의 직전 정상값 폴백은 **기존 동작 그대로** 둔다(이번 범위 밖 — 설계 R5, 나이 상한 없음).
 *    단, 더 새로운 조회가 그 시장을 `unknown` 으로 판정했다면 그 시장의 직전 정상값은 지운다(낡은 값이 되살아나지 않게).
 */
import { kis, getBalancesDetailed } from '@/lib/exchanges/kis';
import { usdToKrw } from '@/lib/exchanges/fx';
import type { Market } from '@/lib/exchanges/kis-symbols';

export type MarketUnknownReason = 'usd_cash_unknown' | 'fx_unavailable' | 'krw_cash_unknown' | 'balances_failed';

export type MarketTotal =
  | { status: 'ok'; krw: number }
  | { status: 'unknown'; reason: MarketUnknownReason; detail: string };

export interface MarketTotals {
  domestic: MarketTotal;
  overseas: MarketTotal;
}

type FetchOutcome =
  | { kind: 'ok'; totals: MarketTotals }
  | { kind: 'balances_failed'; detail: string };

interface Cache { totals: MarketTotals; fetchedAt: number }
const TTL_MS = 60_000;
let cache: Cache | null = null;
/** `balances_failed` 일 때만 쓰는 시장별 직전 정상값 (기존 캐시 폴백 동작의 보존). */
const lastOk: { domestic?: number; overseas?: number } = {};

/**
 * 🔁 **in-flight 중복 제거** (T-017).
 *
 * 이 함수 1회 = KIS 잔고 2~3건 + 보유 종목 수만큼의 시세. 그런데 캐시가 비어 있는 순간
 * **여러 호출부가 동시에 들어온다**:
 *  - `/api/health` 는 무인증이며 `getEffectiveOrderMax(domestic/overseas)` +
 *    `getEffectiveDailyMax(domestic/overseas)` **4개를 `Promise.all` 로** 부른다.
 *    넷 다 여기로 수렴하므로 콜드 캐시 한 번에 잔고·시세 팬아웃이 **4배**로 터졌다.
 *  - `submitOrder` 도 한도 2건을 `Promise.all` 로 부른다(같은 구조).
 *
 * TTL 캐시는 "이미 끝난 조회"만 막고 "지금 진행 중인 조회"는 못 막는다. 진행 중인 Promise 를
 * 공유해 **동시 호출 N건을 KIS 왕복 1회로** 합친다. 이미 `kis-auth.ts` 의 `refreshInFlight`
 * 가 토큰 재발급에 쓰던 것과 같은 패턴이다.
 *
 * ⚠️ 결과는 공유하되 **실패도 공유한다.** `fetchTotals` 는 던지지 않는다.
 */
let inFlight: Promise<FetchOutcome> | null = null;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function fetchTotals(): Promise<FetchOutcome> {
  try {
    const r = await getBalancesDetailed();
    // T-012: 보유 조회가 한 시장이라도 실패하면 총액을 계산하지 않는다(기존과 같다 — 예전엔 kis.getBalances() 가 던졌다).
    if (!r.complete) {
      return { kind: 'balances_failed', detail: `잔고 부분 실패 — ${r.failed.map(f => `${f.market}(${f.error})`).join(', ')}` };
    }

    let domesticKRW = 0;
    let overseasHoldingsKRW = 0;
    let krwSeen = false;

    // 해외 상태를 먼저 정한다 — 모르면 해외 종목 시세를 부르지 않는다(쓰지 않을 값에 KIS 호출을 쓰지 않는다).
    let overseas: MarketTotal | null = null;
    let usdCashKRW = 0;
    if (r.overseasEnabled) {
      const c = r.cash.USD;
      if (c.state !== 'known') {
        overseas = {
          status: 'unknown', reason: 'usd_cash_unknown',
          detail: c.state === 'unknown' ? c.error : '해외 활성인데 USD 예수금을 조회하지 않음',
        };
      } else if (c.usd > 0) {
        try {
          const v = Number(await usdToKrw(c.usd));
          if (!Number.isFinite(v) || v < 0) throw new Error(`환산값 이상 ${v}`);
          usdCashKRW = v;
        } catch (e) {
          overseas = { status: 'unknown', reason: 'fx_unavailable', detail: `USD ${c.usd} 환산 실패: ${errMsg(e)}` };
        }
      }
    }

    for (const b of r.balances) {
      if (b.currency === 'USD') continue;   // 방어 — Facade 가 이미 걸러 낸다
      const qty = Number(b.free) + Number(b.locked);
      if (b.currency === 'KRW') {
        krwSeen = true;
        if (qty > 0) domesticKRW += qty;
        continue;
      }
      if (qty <= 0) continue;
      const isOverseas = b.currency.includes(':');
      if (isOverseas && overseas) continue;   // 해외를 이미 모름으로 판정 — 시세 조회 생략
      // 종목 보유분: 현재가 × qty 평가 (해외는 ticker.price가 이미 KRW 환산됨)
      try {
        const ticker = await kis.getTicker(b.currency);
        const price = Number(ticker.price);
        if (Number.isFinite(price) && price > 0) {
          const amount = price * qty;
          if (isOverseas) overseasHoldingsKRW += amount;
          else            domesticKRW += amount;
        }
      } catch (e) {
        /**
         * 한 종목 실패는 종전대로 무시한다(그 종목이 총액에서 빠진다 — 한도를 *줄이는* 방향).
         * 다만 T-017 이후 **스로틀 대기열 초과·레이트리밋도 이 경로로 들어올 수 있으므로**
         * 조용히 넘기지 않는다 — 이 총액은 주문 한도(pct)의 입력이라, 원인 모를 과소평가가 남으면 안 된다.
         */
        console.warn(`[portfolio-total] ${b.currency} 시세 조회 실패 — 이 종목은 총액에서 제외:`, errMsg(e));
      }
    }

    const domestic: MarketTotal = krwSeen
      ? { status: 'ok', krw: domesticKRW }
      : { status: 'unknown', reason: 'krw_cash_unknown', detail: '국내 잔고에 KRW 예수금 요약 없음' };
    if (!overseas) overseas = { status: 'ok', krw: overseasHoldingsKRW + usdCashKRW };
    // 해외 비활성(not_queried)은 해외 보유도 조회하지 않으므로 ok 0 — 예전과 같은 값(해외 한도 0 = 해외 매수 차단).

    return { kind: 'ok', totals: { domestic, overseas } };
  } catch (e) {
    // getBalancesDetailed 는 시장별 실패를 잡지만, 예기치 못한 예외도 총액을 지어내지 않는다.
    console.error('[portfolio-total] 잔고 조회 실패 — 평가액 산출 포기:', errMsg(e));
    return { kind: 'balances_failed', detail: errMsg(e) };
  }
}

/** 진행 중인 조회가 있으면 그것을 공유하고, 없으면 새로 시작한다. */
function fetchTotalsDeduped(): Promise<FetchOutcome> {
  if (inFlight) return inFlight;
  inFlight = fetchTotals().finally(() => { inFlight = null; });
  return inFlight;
}

function fallbackFor(m: Market, detail: string): MarketTotal {
  const v = lastOk[m];
  return v != null ? { status: 'ok', krw: v } : { status: 'unknown', reason: 'balances_failed', detail };
}

/**
 * 시장별 평가액 **상태**. 60초 캐시 + in-flight 중복 제거. 던지지 않는다.
 */
export async function getPortfolioTotalsKRW(forceFresh = false): Promise<MarketTotals> {
  if (!forceFresh && cache && Date.now() - cache.fetchedAt < TTL_MS) return cache.totals;
  // forceFresh 여도 **동시** 호출끼리는 합친다 — "지금 막 시작한 조회"보다 더 신선한 값은 없다.
  const f = await fetchTotalsDeduped();
  if (f.kind === 'balances_failed') {
    console.error('[portfolio-total] 잔고 조회 실패 — 시장별 직전 정상값 또는 unknown:', f.detail);
    // TTL 캐시는 갱신하지 않는다(다음 호출이 다시 조회한다 — 기존과 같다).
    return { domestic: fallbackFor('domestic', f.detail), overseas: fallbackFor('overseas', f.detail) };
  }
  for (const m of ['domestic', 'overseas'] as const) {
    const t = f.totals[m];
    if (t.status === 'ok') lastOk[m] = t.krw;
    else delete lastOk[m];       // 더 새로운 판정이 "모름" — 낡은 정상값이 balances_failed 폴백으로 되살아나지 않게
  }
  cache = { totals: f.totals, fetchedAt: Date.now() };
  return f.totals;
}

/** 시장별 평가액 상태. pct 기반 한도 계산용 — `unknown` 이면 호출자는 한도 0 으로 처리해야 한다. */
export async function getMarketTotal(market: Market, forceFresh = false): Promise<MarketTotal> {
  const t = await getPortfolioTotalsKRW(forceFresh);
  return market === 'overseas' ? t.overseas : t.domestic;
}

/** 두 시장 합계 상태 (표시용 — 거래 리포트). 한 시장이라도 모르면 합계도 모른다. */
export async function getPortfolioTotalState(forceFresh = false): Promise<MarketTotal> {
  const t = await getPortfolioTotalsKRW(forceFresh);
  if (t.domestic.status !== 'ok') return t.domestic;
  if (t.overseas.status !== 'ok') return t.overseas;
  return { status: 'ok', krw: t.domestic.krw + t.overseas.krw };
}

/** 테스트/진단용 캐시 무효화 */
export function clearPortfolioTotalCache(): void {
  cache = null;
  inFlight = null;
  delete lastOk.domestic;
  delete lastOk.overseas;
}

/** 진단·테스트용 — 지금 조회가 진행 중인가. */
export function isPortfolioTotalFetchInFlight(): boolean {
  return inFlight !== null;
}
