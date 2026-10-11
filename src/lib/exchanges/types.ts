export type ExchangeId = 'coinone' | 'upbit' | 'binance' | 'kis';

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'limit' | 'market';

export interface OrderRequest {
  exchange: ExchangeId;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  price?: number;
  quantity?: number;
  amountKRW?: number;
  clientOrderId?: string;
  /** 'domestic'(국내주식) | 'overseas'(해외주식). 명시 안하면 symbol 형태로 추정 */
  market?: 'domestic' | 'overseas';
  /** 가격 통화 (해외주식은 'USD'). 디폴트 'KRW' */
  currency?: 'KRW' | 'USD';
}

export interface OrderResult {
  ok: boolean;
  dryRun?: boolean;
  blockedBy?: 'kill_switch' | 'order_limit' | 'daily_limit' | 'symbol_not_allowed' | 'dry_run';
  exchangeOrderId?: string;
  raw?: unknown;
  error?: string;
  /**
   * T-042 — `ok:false` 인데 **주문이 거래소에 접수됐는지 알 수 없다**(송신 중 예외·연결 끊김·5xx, 접수 직후 DB 갱신 실패).
   * 안전층 차단(`blockedBy`)이나 거래소의 명시적 거부와 달리 *재시도하면 같은 주문이 두 번 나갈 수 있다.*
   * 설정되는 곳은 `submitOrder` 의 송신 단계뿐이다. 없으면(undefined) 확정 거부로 읽는다.
   */
  outcomeUnknown?: boolean;
}

export interface CancelRequest {
  exchangeOrderId: string;
  symbol: string;
  /** 'domestic' | 'overseas'. 명시 안하면 symbol로 추정 */
  market?: 'domestic' | 'overseas';
}

export interface Ticker {
  symbol: string;
  price: number;
  timestamp: number;
  /** 24h 시작가 (24h 변동률 계산용) */
  open24h?: number;
  /** 24h 고가 */
  high24h?: number;
  /** 24h 저가 */
  low24h?: number;
  /** 24h 거래량 (target currency 기준) */
  volume24h?: number;
  /** 24h 거래대금 (quote currency 기준, 대개 KRW) */
  quoteVolume24h?: number;
  /** 해외주식 USD 원가 (kis-overseas만 제공, 환산 전) */
  priceUsd?: number;
}

export interface Balance {
  currency: string;
  free: number;
  locked: number;
  /** 매입평단가 (원/주, 보유 종목만 채워짐). KIS pchs_avg_pric. */
  avgPrice?: number;
}

export interface Candle {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ExchangeClient {
  id: ExchangeId;
  getTicker(symbol: string): Promise<Ticker>;
  /**
   * 캔들 반환 계약: **`ts` 오름차순** (과거 → 최신).
   * 거래소 API가 내림차순 응답이라도 어댑터 내부에서 반드시 정렬 후 반환한다.
   * (lightweight-charts 등 차트 라이브러리는 오름차순 입력을 요구)
   */
  getCandles(symbol: string, interval: string, count: number): Promise<Candle[]>;
  getBalances(): Promise<Balance[]>;
  createOrder(req: OrderRequest): Promise<OrderResult>;
  cancelOrder(req: CancelRequest): Promise<OrderResult>;
}
