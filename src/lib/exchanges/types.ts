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
  /**
   * T-072 — `'validation_gate'`: 매수인데 귀속 전략이 검증 상태(`strategies.validation_status` ∈ backtested·paper_validated)가
   * 아니거나 확인할 수 없어 `submitOrder` 최후 방어선(G6)이 막았다. 앞단 관문(G1~G5)이 있으면 평소 0건이어야 한다 — 발동 = 우회 버그 신호.
   */
  /**
   * T-072 WP-2d — `'invalid_side'`: `side` 를 정규화(trim·소문자)해도 `'buy'`·`'sell'` 이 아니라 `submitOrder` 가 **orders 행·거래소 호출 없이**
   * 끝냈다(orders.side ENUM 이 그 값을 받지 않는다). 입구 검증이 있으면 평소 0건 — 발동 = 호출부 결함 신호.
   */
  blockedBy?: 'kill_switch' | 'order_limit' | 'daily_limit' | 'symbol_not_allowed' | 'dry_run' | 'validation_gate' | 'invalid_side';
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

/**
 * 해외 USD 예수금 1회 관측값 (T-056). 출처는 CTRP6504R(해외 체결기준현재잔고) `output2` USD 행 `frcr_dncl_amt_2`
 * − `frcr_buy_mgn_amt`(T-102 — 미결제 매수 차감).
 */
export interface UsdCashReading {
  /**
   * USD **순예수금** = 외화예수금액 − 미결제 매수(매수증거금) (T-102). 유한한 0 이상 값만 들어온다 — 판정 규칙을 통과하지 못한
   * 응답은 아예 이 모양이 되지 않는다. 방금 산(결제 전) 종목은 이미 보유 평가에 들어 있으므로 총예수금을 쓰면 이중 계상된다.
   * 미결제 매수가 없으면 외화예수금액 그대로다(T-056 과 같은 값).
   */
  usd: number;
  source: 'CTRP6504R';
  /** (T-102, 미결제 매수가 있을 때만) 외화예수금액 전체(USD) = `usd + unsettledBuyUsd`(소수 6자리 반올림 오차 이내 — `usd` 는 이 값을 넘지 않는다). 기록·진단용 — 평가·한도에 쓰지 않는다. */
  grossDepositUsd?: number;
  /** (T-102, 미결제 매수가 있을 때만) 매수증거금 `frcr_buy_mgn_amt`(USD, 양수). 결제(T+1)되면 사라지고 `usd` 는 그대로 이어진다. */
  unsettledBuyUsd?: number;
  /**
   * `output3.ustl_sll_amt_smtl`(미결제매도금액합계) 원값. **총액에 넣지 않는다** — 단계 4(첫 해외 매도 직후 관측)에서
   * 예수금이 체결기준인지 판별하는 자료로만 남긴다. 단위는 KIS 문서상 명시가 없고 output3 의 다른 원화 합계와 같은 형식이다.
   */
  ustlSllAmtSmtl: number;
}

/**
 * USD 예수금 상태 (T-056). **"행 없음 = 0" 을 타입으로 금지**하려고 현금을 `Balance[]` 에서 분리했다.
 *  - `known`       : 판정 규칙을 통과한 관측값 (0 도 확인된 0 이다)
 *  - `unknown`     : 조회·판정 실패 — 소비자는 0 으로 읽지 말고 보류·차단·조회불가 경로로 가야 한다
 *  - `not_queried` : 해외 시장 비활성으로 조회하지 않음
 */
export type UsdCashState =
  | ({ state: 'known' } & UsdCashReading)
  | { state: 'unknown'; error: string }
  | { state: 'not_queried' };

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
  /**
   * 보유 종목 + 국내 KRW 예수금 행. **USD 예수금은 여기에 없다** (T-056) — `getBalancesDetailed().cash.USD` 로만 읽는다.
   * 이 배열에서 `currency === 'USD'` 를 찾으면 항상 없음(= 0 으로 오독)이다.
   */
  getBalances(): Promise<Balance[]>;
  createOrder(req: OrderRequest): Promise<OrderResult>;
  cancelOrder(req: CancelRequest): Promise<OrderResult>;
}
