/**
 * KIS 어댑터 Facade — 심볼 prefix(`NAS:AAPL`)로 국내/해외 어댑터에 라우팅.
 *
 * 호출처는 기존과 동일하게 `import { kis }` 사용. 분기는 Facade 내부에서.
 * - getBalances는 두 시장의 잔고를 합쳐 반환 (currency 필드로 KRW/종목코드/`NAS:TICKER` 구분)
 * - createOrder/cancelOrder는 req.symbol/req.market로 라우팅
 */
import * as dom from './kis-domestic';
import * as ovs from './kis-overseas';
import { getMarketFromSymbol, type Market } from './kis-symbols';
import type { ExchangeClient, Ticker, Candle, Balance, OrderRequest, OrderResult, CancelRequest } from './types';

function routeBySymbol(symbol: string) {
  return getMarketFromSymbol(symbol) === 'overseas' ? ovs : dom;
}

async function getTicker(symbol: string): Promise<Ticker> {
  return routeBySymbol(symbol).getTicker(symbol);
}

async function getCandles(symbol: string, interval: string, count: number): Promise<Candle[]> {
  return routeBySymbol(symbol).getCandles(symbol, interval, count);
}

/**
 * 잔고 조회 결과 — **부분 실패를 완전 성공과 구분할 수 있게** 하는 것이 유일한 목적이다.
 *
 * ## 왜 필요한가 (T-012, 2026-08-09)
 *
 * 기존 `getBalances()` 는 시장별 실패를 `.catch(() => [])` 로 삼켰다. 그 결과 KIS 레이트리밋
 * (`EGW00201`, HTTP 500) 한 번에 **국내 쪽 전체(KRW 예수금 + 보유 종목)가 통째로 빠진 잔고가
 * "정상 응답"처럼** 반환됐다. 호출부는 그것이 부분 실패인지 알 방법이 없어 그대로 총액을
 * 계산했고, `portfolio_snapshots` 에 -20% 짜리 총액이 기록됐다 —
 * 최근 30일 14건, 전체 188건. 이 값은 킬스위치 24h drawdown 기준선이다.
 *
 * 운영 로그 실측: `[kis] domestic balances failed` 1,077건 / `overseas` 241건.
 * 즉 **어댑터는 정상적으로 예외를 던지고 있었고, 삼킨 것은 이 Facade 였다.**
 */
export interface BalancesResult {
  balances: Balance[];
  /** 조회에 성공한 시장 */
  ok:       Market[];
  /** 조회에 실패한 시장과 사유 */
  failed:   { market: Market; error: string }[];
  /** 활성화된 모든 시장이 성공 = 이 잔고로 총액을 계산해도 된다 */
  complete: boolean;
}

/**
 * 잔고 부분 실패. `getBalances()` 가 던진다.
 *
 * 총액을 계산하는 호출부는 이 예외를 **낮은 총액으로 대체하지 말고 그대로 실패시켜야 한다.**
 * 틀린 총액은 없는 총액보다 위험하다 — 안전장치가 그 값을 기준선으로 삼기 때문이다.
 */
export class BalancesIncompleteError extends Error {
  readonly failed: { market: Market; error: string }[];
  readonly okMarkets: Market[];
  constructor(failed: { market: Market; error: string }[], okMarkets: Market[]) {
    super(
      `KIS 잔고 부분 실패 — 실패 시장: ${failed.map(f => `${f.market}(${f.error})`).join(', ')}`
      + `${okMarkets.length ? ` / 성공: ${okMarkets.join(', ')}` : ''}`,
    );
    this.name = 'BalancesIncompleteError';
    this.failed = failed;
    this.okMarkets = okMarkets;
  }
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * 시장별 성공/실패를 **보존한 채** 잔고를 반환한다.
 *
 * 부분 데이터라도 써야 하는 호출부(표시 전용, 시장 하나만 보는 호출부)만 이걸 쓴다.
 * 총액을 계산한다면 `getBalances()` 를 써서 부분 실패에 예외를 받아야 한다.
 */
export async function getBalancesDetailed(): Promise<BalancesResult> {
  const enableOverseas = String(process.env.KIS_OVERSEAS_ENABLED ?? 'true').toLowerCase() === 'true';

  const tasks: { market: Market; run: () => Promise<Balance[]> }[] = [
    { market: 'domestic', run: () => dom.getBalances() },
  ];
  if (enableOverseas) tasks.push({ market: 'overseas', run: () => ovs.getBalances() });

  const settled = await Promise.all(tasks.map(async (t) => {
    try {
      return { market: t.market, balances: await t.run(), error: null as string | null };
    } catch (e) {
      const error = errMsg(e);
      console.error(`[kis] ${t.market} balances failed:`, error);
      return { market: t.market, balances: [] as Balance[], error };
    }
  }));

  const failed = settled.filter(s => s.error !== null).map(s => ({ market: s.market, error: s.error! }));
  return {
    balances: settled.flatMap(s => s.balances),
    ok:       settled.filter(s => s.error === null).map(s => s.market),
    failed,
    complete: failed.length === 0,
  };
}

/**
 * 두 시장 잔고 합산. **활성 시장 중 하나라도 실패하면 던진다** (`BalancesIncompleteError`).
 *
 * 기본값을 "던진다"로 둔 이유: 호출부 7곳 중 5곳이 총액을 계산하거나 매매 판단을 한다.
 * 안전한 쪽을 기본값으로 두어야 새 호출부가 **실수로** 잘린 잔고를 받는 일이 없다.
 * 부분 데이터가 정말 필요하면 `getBalancesDetailed()` 로 **이름을 지정해 옵트인**해야 한다.
 */
async function getBalances(): Promise<Balance[]> {
  const r = await getBalancesDetailed();
  if (!r.complete) throw new BalancesIncompleteError(r.failed, r.ok);
  return r.balances;
}

async function createOrder(req: OrderRequest): Promise<OrderResult> {
  return routeBySymbol(req.symbol).createOrder(req);
}

async function cancelOrder(req: CancelRequest): Promise<OrderResult> {
  const market: Market = req.market ?? getMarketFromSymbol(req.symbol);
  return market === 'overseas' ? ovs.cancelOrder(req) : dom.cancelOrder(req);
}

export const kis: ExchangeClient & {
  getMarket: (s: string) => Market;
  fetchMarketCapRanking: (limit?: number) => Promise<Array<{
    symbol: string; name: string; marketCap: number; quoteVolume: number; volume: number;
  }>>;
} = {
  id: 'kis',
  getTicker,
  getCandles,
  getBalances,
  createOrder,
  cancelOrder,
  getMarket: getMarketFromSymbol,
  fetchMarketCapRanking: (limit = 50) => dom.fetchMarketCapRanking(limit),
};

// 기존 export 호환
export { fetchMarketCapRanking, getKisTickers } from './kis-domestic';
export { getKisOverseasTickers } from './kis-overseas';

/**
 * 미체결 주문 조회 결과 — {@link BalancesResult} 와 **의도적으로 같은 모양**이다 (T-018).
 *
 * ## 왜 필요한가
 *
 * `order-sync` 는 "미체결 목록에 없다 + 체결 목록에도 없다 → 취소된 주문" 이라는
 * **부재 추론**으로 DB 에 `cancelled` 를 쓴다. 그래서 이 함수가 실패를 빈 배열로 바꾸면
 * 그 추론이 **브로커에 살아 있는 지정가 주문 전부를 `cancelled` 로 마킹**한다. 결과는
 * 중복 진입(포지션이 없다고 오인)과 청산 추적 유실이다.
 *
 * 예전 구조는 실패를 **다섯 겹**으로 삼켰다 — 어댑터 3겹(`!res.ok`, `rt_cd!=='0'`, catch)
 * × 2시장, Facade 의 `.catch(()=>[])`, 그리고 `order-sync` 자신의 catch. 그 결과
 * `order-sync` 에 이미 있던 fail-closed 조기 반환은 **도달 불가능한 죽은 코드**였다.
 *
 * 모양을 [[T-014]] 의 `BalancesResult` 와 맞춘 이유: 이 코드베이스에는 이미 "시장별
 * 부분 실패를 보존해 넘기는" 확립된 계약이 있다. 새 모양을 발명하면 읽는 사람이 두 규약을
 * 익혀야 하고, 어느 쪽이 안전 기본값인지 헷갈린다. **일관성이 우아함보다 중요하다.**
 */
export interface ActiveOrdersResult {
  orders:   { orderId: string; symbol: string }[];
  /** 조회에 성공한 시장 */
  ok:       Market[];
  /** 조회에 실패한 시장과 사유 */
  failed:   { market: Market; error: string }[];
  /** 활성화된 모든 시장이 성공 = 이 목록의 "부재"를 근거로 판단해도 된다 */
  complete: boolean;
}

/**
 * 미체결 조회 부분 실패. `getActiveOrders()` 가 던진다.
 *
 * `BalancesIncompleteError` 와 같은 이유로 **던지는 쪽을 기본값**으로 둔다 — 잘린 목록을
 * 실수로 받아 부재 추론에 쓰는 새 호출부가 생기지 않게. 부분 결과가 정말 필요하면
 * `getActiveOrdersDetailed()` 로 **이름을 지정해 옵트인**해야 한다.
 */
export class ActiveOrdersIncompleteError extends Error {
  readonly failed: { market: Market; error: string }[];
  readonly okMarkets: Market[];
  constructor(failed: { market: Market; error: string }[], okMarkets: Market[]) {
    super(
      `KIS 미체결 주문 조회 부분 실패 — 실패 시장: ${failed.map(f => `${f.market}(${f.error})`).join(', ')}`
      + `${okMarkets.length ? ` / 성공: ${okMarkets.join(', ')}` : ''}`,
    );
    this.name = 'ActiveOrdersIncompleteError';
    this.failed = failed;
    this.okMarkets = okMarkets;
  }
}

/**
 * 시장별 성공/실패를 **보존한 채** 미체결 주문을 반환한다.
 *
 * `KIS_OVERSEAS_ENABLED=false` 면 국내만 조회하고 `ok=['domestic']` 이 된다.
 * (예전 코드는 이 분기에서 Facade catch 없이 곧장 위임했지만, 어댑터 자체가 삼켰기 때문에
 * 어차피 던질 수 없었다 — 그 비대칭도 여기서 사라진다.)
 */
export async function getActiveOrdersDetailed(): Promise<ActiveOrdersResult> {
  const enableOverseas = String(process.env.KIS_OVERSEAS_ENABLED ?? 'true').toLowerCase() === 'true';

  const tasks: { market: Market; run: () => Promise<{ orderId: string; symbol: string }[]> }[] = [
    { market: 'domestic', run: () => dom.getActiveOrders() },
  ];
  if (enableOverseas) tasks.push({ market: 'overseas', run: () => ovs.getActiveOrders() });

  const settled = await Promise.all(tasks.map(async (t) => {
    try {
      return { market: t.market, orders: await t.run(), error: null as string | null };
    } catch (e) {
      const error = errMsg(e);
      console.error(`[kis] ${t.market} active orders failed:`, error);
      return { market: t.market, orders: [] as { orderId: string; symbol: string }[], error };
    }
  }));

  const failed = settled.filter(s => s.error !== null).map(s => ({ market: s.market, error: s.error! }));
  return {
    orders:   settled.flatMap(s => s.orders),
    ok:       settled.filter(s => s.error === null).map(s => s.market),
    failed,
    complete: failed.length === 0,
  };
}

/**
 * 양시장 미체결 주문 통합 조회. **활성 시장 중 하나라도 실패하면 던진다.**
 */
export async function getActiveOrders(): Promise<{ orderId: string; symbol: string }[]> {
  const r = await getActiveOrdersDetailed();
  if (!r.complete) throw new ActiveOrdersIncompleteError(r.failed, r.ok);
  return r.orders;
}

/**
 * 체결 완료 주문 조회. 심볼로 시장 판정 후 해당 어댑터에 위임.
 *
 * 호출 하나가 시장 하나만 보므로 부분 실패라는 개념이 없다 — 어댑터가 던지면 그대로 던진다
 * (T-018 이전에는 어댑터가 `[]` 로 삼켰다).
 */
export async function getCompletedOrders(
  symbol: string,
  fromTs: number,
  toTs: number,
  limit = 100,
): Promise<{ orderId: string; side: string; price: number; qty: number; ts: number }[]> {
  return routeBySymbol(symbol).getCompletedOrders(symbol, fromTs, toTs, limit);
}

/** 해외 미체결 조회가 실제로 덮는 거래소 — 근거는 `kis-overseas.activeOrderExchanges` 주석. */
export { activeOrderExchanges as overseasActiveOrderExchanges } from './kis-overseas';
