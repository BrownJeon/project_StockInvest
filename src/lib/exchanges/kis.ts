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

async function getBalances(): Promise<Balance[]> {
  // 두 시장 잔고 합산. 환경변수로 비활성화 가능 (환경 미준비 시 한쪽만 호출).
  const enableOverseas = String(process.env.KIS_OVERSEAS_ENABLED ?? 'true').toLowerCase() === 'true';
  if (!enableOverseas) return dom.getBalances();
  const [d, o] = await Promise.all([
    dom.getBalances().catch(e => { console.error('[kis] domestic balances failed:', e); return [] as Balance[]; }),
    ovs.getBalances().catch(e => { console.error('[kis] overseas balances failed:', e); return [] as Balance[]; }),
  ]);
  return [...d, ...o];
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
 * 양시장 미체결 주문 통합 조회.
 * 환경변수 `KIS_OVERSEAS_ENABLED=false` 시 도메스틱만.
 */
export async function getActiveOrders(): Promise<{ orderId: string; symbol: string }[]> {
  const enableOverseas = String(process.env.KIS_OVERSEAS_ENABLED ?? 'true').toLowerCase() === 'true';
  if (!enableOverseas) return dom.getActiveOrders();
  const [d, o] = await Promise.all([
    dom.getActiveOrders().catch(e => { console.error('[kis] domestic active orders failed:', e); return []; }),
    ovs.getActiveOrders().catch(e => { console.error('[kis] overseas active orders failed:', e); return []; }),
  ]);
  return [...d, ...o];
}

/**
 * 체결 완료 주문 조회. 심볼로 시장 판정 후 해당 어댑터에 위임.
 */
export async function getCompletedOrders(
  symbol: string,
  fromTs: number,
  toTs: number,
  limit = 100,
): Promise<{ orderId: string; side: string; price: number; qty: number; ts: number }[]> {
  return routeBySymbol(symbol).getCompletedOrders(symbol, fromTs, toTs, limit);
}
