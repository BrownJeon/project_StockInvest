import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import {
  getActiveOrdersDetailed, getCompletedOrders, overseasActiveOrderExchanges,
} from '@/lib/exchanges/kis';
import { getMarketFromSymbol, isOverseasSymbol, parseOverseas, type Market } from '@/lib/exchanges/kis-symbols';
import { submittedQuantity } from '@/lib/exchanges/order-quantity';
import { sendAlertThrottled } from '@/lib/notify/throttle';
import {
  STRUCTURAL_MS, getStaleTracking, recordFirstStale, markEscalated, clearResolved,
} from './order-sync-escalation';

interface PendingOrder extends RowDataPacket {
  id: number;
  exchange_order_id: string | null;
  symbol: string;
  /** T-019 — 부분체결 종결 알림의 긴급도가 매수/매도에서 다르다 (매도 잔량 = 미청산 포지션) */
  side: string | null;
  type: string;
  status: string;
  /** T-019 — 체결가를 브로커 응답에서 얻지 못했을 때의 폴백(지정가) */
  price: string | number | null;
  quantity: string | number | null;
  created_at: Date;
}

/**
 * 체결 목록에서 얻은 **양성 증거** 한 건.
 *
 * 수량만 쓰던 것을 가격·시각까지 함께 들고 다니게 바꾼 이유는 T-019 다 —
 * 부분체결로 종결된 주문의 **실제 체결 수량을 `executions` 에 남겨야** 하는데,
 * `executions.price` 가 `NOT NULL` 이라 수량만으로는 행을 만들 수 없다.
 */
interface FillEvidence {
  /** 확인된 체결 수량. **합이 아니라 최대값** (아래 §체결 수량 집계 참조) */
  qty: number;
  /** 그 수량을 보고한 행의 체결 단가. 0·비유한이면 "모름" */
  price: number;
  /** 그 행의 체결 시각(epoch ms). 0·비유한이면 "모름" */
  ts: number;
}

/** 판정을 보류한 이유. 서로 다른 대응이 필요하므로 뭉개지 않는다. */
export type UnreconciledReason =
  /** 이 시장의 미체결 조회가 실패 — 취소 판정의 근거 절반이 없다 */
  | 'active_query_failed'
  /** 이 종목의 체결 조회가 실패 — 나머지 절반이 없다 */
  | 'completed_query_failed'
  /** 둘 다 실패 */
  | 'both_queries_failed'
  /**
   * 조회는 성공했지만 이 심볼의 거래소가 미체결 조회 범위 밖이다.
   * 재시도로 해결되지 않는 **구조적** 사각지대 — 코드 수정이 필요하다.
   */
  | 'active_coverage_gap'
  /**
   * 부분체결로 기록했지만 **잔량이 남아 있는지 확인할 방법이 없다**(커버리지 밖이거나
   * 미체결 조회 실패가 지속). 상태 자체는 기록됐으므로 판정 실패는 아니지만, 비종결 상태에
   * 영원히 머물 수 있어 드러내야 한다. 재시도로 낫지 않으므로 30분 critical 이 아니라
   * **6시간 warning** 으로 보낸다.
   */
  | 'partial_fill_unconfirmable'
  /**
   * 조회는 성공했고 신뢰할 수 있지만, 주문이 **아직 너무 최근이라** 브로커 미체결 목록에
   * 반영되지 않았을 수 있다. 실패가 아니라 **의도된 대기**다 (아래 §유예 기간).
   * 정체 시계에 올리지 않는다 — 올리면 건강한 새 주문마다 30분 critical 알림이 울린다.
   */
  | 'too_fresh';

export interface UnreconciledOrder {
  /** orders.id */
  id: number;
  exchangeOrderId: string;
  symbol: string;
  market: Market;
  reason: UnreconciledReason;
  detail: string;
  /** **연속으로** 판정하지 못한 시간. 주문이 오래된 것과는 다르다 (아래 §역방향 위험) */
  unreconciledForMs: number;
}

/**
 * **부분체결 상태로 종결된** 주문 (T-019).
 *
 * `unreconciled` 와 의미가 겹치지 않는다 — 저건 "판정하지 못했다"이고 이건
 * **"판정했고, 결과가 '일부만 체결된 채 끝났다'"** 다. 판정 실패가 아니므로 `complete` 를
 * 깎지 않고 정체 시계에도 올리지 않는다. 대신 별도 목록·로그·감사기록으로 드러낸다.
 */
export interface PartialSettlement {
  /** orders.id */
  id: number;
  exchangeOrderId: string;
  symbol: string;
  market: Market;
  side: string | null;
  /** 브로커가 **실제로 받은** 주문 수량 (`submittedQuantity` 기준) */
  orderedQty: number;
  /** 확인된 체결 수량 */
  filledQty: number;
  /**
   * 실제 체결 수량을 `executions` 에 기록했는가.
   *
   * `false` 면 손익 리포트(`trade-report`)가 **여전히 주문 수량을 체결 수량으로 계산**한다 —
   * 즉 이 결함이 그 주문에 대해서는 남아 있다는 뜻이므로 반드시 보여야 한다.
   */
  executionRecorded: boolean;
  /** 기록하지 못했거나 건너뛴 이유 (기록했으면 undefined) */
  note?: string;
}

export interface OrderSyncResult {
  /** 상태를 실제로 갱신한 주문 수 */
  synced: number;
  errors: string[];
  /** 판정을 **보류한** 주문 수 (`too_fresh` 같은 의도된 대기 포함) */
  skipped: number;
  /**
   * 데이터 부족·불신으로 판정하지 **못한** 주문이 없는가.
   * `false` = "판정 못 했다"(≠ "할 게 없었다").
   *
   * `too_fresh` 는 여기 포함되지 않는다 — 판정할 능력이 없었던 게 아니라 **일부러 기다린**
   * 것이고, 건강한 새 주문마다 `complete=false` 가 뜨면 이 플래그의 신호가치가 사라진다.
   */
  complete: boolean;
  /** 미체결 조회에 성공한 시장 */
  marketsOk: Market[];
  /** 미체결 조회에 실패한 시장 */
  marketsFailed: { market: Market; error: string }[];
  /** 보류된 주문 상세 */
  unreconciled: UnreconciledOrder[];
  /** 임계 시간을 넘겨 보류 상태인 주문 수 */
  staleCount: number;
  /** 가장 오래 보류된 주문의 경과 시간(ms). 없으면 0 */
  oldestUnreconciledMs: number;
  /** T-019 — **부분체결로 종결된** 주문들 (판정 실패가 아니다) */
  partialSettlements: PartialSettlement[];
  /**
   * T-019 — 체결 완결성을 **수량으로 검증하지 못한** 채 `filled` 로 쓴 주문 수.
   *
   * 체결 목록에 있는데 수량이 파싱되지 않았거나(`filledQty` 없음) `orders.quantity` 가
   * NULL 인 경우다. 수량으로 반박할 근거가 없으므로 기존 동작(`filled`)을 유지하지만,
   * **그 사실이 조용해지면 안 되므로** 집계로 남긴다.
   */
  completenessUnverified: number;
}

/**
 * DB에서 accepted/pending/partially_filled 상태 주문을 조회해
 * KIS API와 대조 후 filled/cancelled로 업데이트한다.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * # 🔴 T-018 — 실패로 `cancelled` 를 쓰지 않는다 (fail-closed)
 *
 * ## 무엇이 잘못돼 있었나
 *
 * 아래 한 줄이 **살아 있는 지정가 주문을 DB 에서 `cancelled` 로 만들 수 있었다**:
 *
 * ```
 * } else if (order.type !== 'market' && !activeOrderIds.has(eid)) {
 *   UPDATE orders SET status='cancelled' ...
 * ```
 *
 * 이 판정은 **부재 추론**이다 — "두 목록 어디에도 없으니 취소된 것이다". 부재 추론은
 * 두 목록이 **모두 신뢰할 수 있을 때만** 성립한다. 그런데 조회 실패가 다섯 겹으로 삼켜져
 * 빈 목록이 되어 내려왔다:
 *
 * | # | 위치 | 삼킨 방식 |
 * |---|---|---|
 * | 1 | `kis-domestic.getActiveOrders` `!res.ok` | 레이트리밋 HTTP 500 이 여기 떨어졌다 |
 * | 2 | 같은 함수 `rt_cd !== '0'` | HTTP 200 위의 **API 레벨 에러**를 0건과 동일 취급 |
 * | 3 | 같은 함수 catch | 로그 후 `[]` |
 * | 4 | `kis-overseas.getActiveOrders` | 위 셋과 동일. catch 는 **로그조차 없었다** |
 * | 5 | Facade `kis.getActiveOrders` `.catch(()=>[])` | 두 시장 모두 |
 *
 * 그래서 이 함수에 이미 있던 fail-closed 조기 반환(`catch { return ... }`)은
 * **한 번도 도달할 수 없는 죽은 코드**였다. 게다가 이 함수 자신도 여섯 번째 삼킴을 갖고
 * 있었다 — `getCompletedOrders` 실패를 `errors[]` 에 넣고 `completedOrderIds = new Set()`
 * 로 둔 뒤 **그대로 마킹 루프로 진입**했다. 두 집합이 동시에 비면 결과는
 * **모든 비-market 미결 주문을 `cancelled` 로 마킹**이다.
 *
 * 실제 피해: 시스템이 포지션이 없다고 오인해 **중복 진입**하고, 브로커에서 여전히 살아
 * 움직이는 주문의 **청산 추적을 잃는다**. 실제 돈이 걸린 경로다.
 *
 * ## 지금의 규칙 — 증거의 방향으로 나눈다
 *
 * | 판정 | 성격 | 필요한 근거 |
 * |---|---|---|
 * | `partially_filled` | **증거 양성** — "체결 목록에 있다" | 그 종목의 체결 조회 **성공** 하나면 충분 |
 * | `filled` | 양성 + **"잔량 없음"** | 위 **＋** 잔량 부재를 신뢰할 수 있는 근거 (아래 §부분체결) |
 * | `cancelled` | **증거 음성** — "어디에도 없다" | 그 시장의 미체결 조회 성공 **＋** 그 종목의 체결 조회 성공 **＋** 심볼이 커버리지 안 **＋** 유예 기간 경과 |
 *
 * 근거가 없으면 **판정하지 않고 이번 회차를 건너뛴다.** 다음 회차(5분 뒤)에 다시 시도한다.
 * 취소 판정은 되돌릴 수 없는 쓰기이고, 보류는 되돌릴 수 있다.
 *
 * ## §유예 기간 — 실제 사고가 난 지점 (reviewer HIGH-1)
 *
 * 위 규칙만으로는 **"조회가 성공했는데 아직 불완전한"** 경우가 남는다. 방금 접수된 주문은
 * 브로커 미체결 목록에 아직 나타나지 않을 수 있고, 그 부재가 취소로 읽힌다.
 *
 * **운영 실측 (2026-05-26)**: 주문 #3137(`NAS:SNDK` 매도 지정가, 수량 1, `eid=0030357043`)이
 * `23:21:59` 에 생성되어 **`23:22:05` — 6초 뒤 `cancelled` 로 마킹**됐다. 이어서 #3138 이
 * 같은 종목·같은 방향·같은 수량으로 `23:41:03` 에 생성되어 `23:43:07` 에 체결됐다.
 * #3137 이 브로커에 살아 있었다면 이것은 **이중 매도**다 — 이 작업이 막으려는 중복 포지션
 * 위험이 실제로 발생한 사례.
 *
 * → 주문 생성 후 {@link DEFAULT_CANCEL_GRACE_SEC} 동안은 **취소 판정 대상에서 제외**한다.
 * 체결(`filled`) 판정은 유예하지 않는다 — 시장가 주문은 수 초 안에 체결되고, 그건 부재
 * 추론이 아니라 양성 증거이기 때문이다.
 *
 * ## §부분체결 — 두 목록에 동시에 있으면 아직 끝난 게 아니다 (reviewer HIGH-3)
 *
 * 체결 목록에 있다는 것은 **"최소한 일부가 체결됐다"** 만 증명한다. **"전량 체결됐다"** 는
 * 여기에 "잔량이 남아 있지 않다"가 더해져야 하고, 그건 다시 부재 추론이다.
 *
 * | 상황 | 판정 | 이유 |
 * |---|---|---|
 * | 미체결 목록 신뢰 가능 + 그 안에 **있다** | `partially_filled` | 잔량이 아직 작동 중 |
 * | 미체결 목록 신뢰 가능 + 그 안에 **없다** + 체결수량 ≥ 송신수량 | `filled` | 종결 + **전량** |
 * | 미체결 목록 신뢰 가능 + 그 안에 **없다** + 체결수량 < 송신수량 | `filled` **＋ `executions` 기록** | 종결이지만 **전량이 아니다** (아래 §부분체결 종결) |
 * | 미체결 목록 신뢰 불가 + 체결수량 ≥ 주문수량 | `filled` | **수량이라는 양성 증거** — 부재 추론이 필요 없다 |
 * | 미체결 목록 신뢰 불가 + 그 외 | `partially_filled` | 완결을 단정하지 않는다. 비종결 상태라 다음 회차에 스스로 교정된다 |
 * | `market` 주문 | `filled` | 미체결 목록에 **원래** 나타나지 않으므로 그 부재는 아무 정보도 아니다 |
 *
 * `filled` 를 잘못 쓰면 "포지션이 닫혔다"고 알리는 것이라 중복 진입으로 이어진다.
 * `partially_filled` 를 잘못 쓰면 다음 회차에 교정된다. **오류의 비용이 비대칭**이므로
 * 불확실할 때는 `partially_filled` 쪽으로 기운다.
 *
 * ## 🔴 T-019 §부분체결 종결 — "목록에서 사라졌다"는 "전량 체결됐다"가 아니다
 *
 * 위 두 번째 줄은 원래 **수량을 보지 않고** `filled` 로 단정했다. 그 명제가 참이려면
 * "미체결 목록에서 사라지는 유일한 이유가 전량 체결"이어야 하는데 **그렇지 않다** —
 * 장 마감 시 브로커가 미체결 잔량을 자동 취소하는 것은 오류가 아니라 정상 동작이다.
 *
 * | 시각 | 사건 | 미체결 목록 | 체결 목록 |
 * |---|---|---|---|
 * | 14:00 | 매도 지정가 10주 접수 | 있음(10주) | 없음 |
 * | 15:10 | 3주 체결 | 있음(잔량 7주) | 있음(3주) |
 * | 15:30 | **장 마감 — 브로커가 잔량 7주 자동 취소** | **없음** | 있음(3주) |
 *
 * 예전 규칙은 여기서 "10주 매도 완전 체결"을 DB 에 썼다. 실제로는 3주만 팔렸다. 그리고
 * `trade-report` 는 `COALESCE(e.quantity, o.quantity)` 로 손익을 계산하는데 `executions`
 * 가 0행이라 **항상 주문 수량**으로 떨어진다 → 매도 수익이 10주치로 잡히고, LIFO 재고
 * 스택에서 10주가 빠져 **이후 모든 매도의 원가가 오염**된다. 1회성 오차가 아니라 누적이다.
 *
 * 그래서 두 가지를 함께 한다:
 *
 *  1. **판정** — 체결 수량이 송신 수량(`submittedQuantity`)에 미치지 못하면 "전량 체결"로
 *     단정하지 않는다. 비교 기준을 `orders.quantity`(요청 원본)가 아니라 송신 수량으로
 *     두는 이유는 T-018 H-4 와 같다: 브로커는 자기가 **받은** 수량 이상을 채울 수 없다.
 *  2. **기록** — 실제 체결 수량을 `executions` 에 남긴다. 그러면 `trade-report` 의
 *     `COALESCE` 가 자동으로 참값을 집어 손익 왜곡의 **근본 원인이 사라진다.**
 *
 * 상태는 그래도 `filled` 다. `partially_filled` 은 이 함수의 조회 대상(=**비종결 상태**)이라,
 * 잔량이 이미 사라진 주문을 거기 두면 5분마다 영원히 KIS 를 조회한다 — T-018 H-4(B) 가
 * 없앤 덫을 다른 입구로 재현하는 것이다. `partially_filled` 은 **잔량이 아직 살아 있을 때**만
 * 의미가 있다. 즉 "전량 체결"의 의미를 `filled` 에서 떼어내고, 수량의 진실은 `executions`
 * 가 들고 있게 하는 것이 이 설계의 요점이다.
 *
 * ## 완결성은 **시장 단위**다 — 왜 전부를 막지 않는가
 *
 * 국내가 성공하고 해외만 실패했다면 국내 주문의 부재 추론은 여전히 완전하다. 국내 미체결
 * 목록의 완결성은 해외 조회 성공 여부와 **논리적으로 무관**하기 때문이다. 한 시장의 실패로
 * 전부를 막으면, 해외가 오래 불안정할 때 국내 동기화가 **무기한 정지**한다 — 그건 이 작업이
 * 없애려는 조용한 정지를 다른 형태로 되살리는 것이다. 그래서 완결성 판정은 시장별로 하고,
 * **자기 시장의 조회가 실패한 심볼은 절대 판정하지 않는다.**
 *
 * ## §역방향 위험 — fail-closed 가 만들어내는 새 침묵
 *
 * 판정을 보류하기만 하면, 조회가 계속 실패할 때 주문은 `pending` 에 **영원히** 남고 실제로
 * 취소·체결된 주문을 아무도 눈치채지 못한다. 그것 역시 같은 병이다. 그래서:
 *
 *  1. 주문별로 **연속 미판정 시작 시각**을 추적한다(프로세스 메모리). 판정에 성공하면 지운다.
 *     주문의 나이가 아니라 **"우리가 판단하지 못한 기간"** 을 재는 것이 핵심이다 — 정상적으로
 *     6시간 걸려 있는 지정가 주문은 매 회차 정상 판정되므로 0 이다.
 *  2. 임계({@link STALE_MS})를 넘으면 **스로틀된 알림**을 보낸다.
 *  3. 반환값·로그·알림 셋 다에서 **"판정 못 했다"를 "판정할 게 없었다"와 다르게** 표현한다
 *     (`complete=false`, `skipped>0`, `unreconciled[]`, grep 토큰 `ORDER_SYNC_UNRECONCILED`).
 *
 * 2026-04-28: KIS 국내·해외 어댑터의 getActiveOrders/getCompletedOrders 정상 구현됨.
 */
export async function syncPendingOrders(): Promise<OrderSyncResult> {
  const pool = getPool();
  const [rows] = await pool.query<PendingOrder[]>(
    `SELECT id, exchange_order_id, symbol, side, type, status, price, quantity, created_at
     FROM orders
     WHERE status IN ('pending','accepted','partially_filled')
       AND exchange_order_id IS NOT NULL`,
  );

  if (rows.length === 0) {
    // "판정할 게 없었다" — 판정 실패와 명확히 다른 상태다.
    pruneTracker(new Set());
    await clearResolved([]);
    return emptyResult();
  }

  const now = Date.now();
  const graceMs = await cancelGraceMs(pool);
  let synced = 0;
  let completenessUnverified = 0;
  const errors: string[] = [];
  const unreconciled: UnreconciledOrder[] = [];
  const partialSettlements: PartialSettlement[] = [];
  const pendingIds = new Set(rows.map(r => r.id));

  // ── ① 미체결 주문 목록 (limit/stop_limit만 여기 있음) ─────────────────────
  // 시장별 성공/실패를 **보존한 채** 받는다. 예전처럼 합쳐진 빈 배열을 받으면
  // "해외만 실패"와 "둘 다 성공인데 0건"을 구분할 수 없다.
  let active: Awaited<ReturnType<typeof getActiveOrdersDetailed>>;
  try {
    active = await getActiveOrdersDetailed();
  } catch (e) {
    // getActiveOrdersDetailed 는 시장별로 자체 catch 하므로 여기 오면 예상 밖이다.
    // 그래도 "전부 모름"으로 퇴화시킬 뿐, 빈 목록으로 판정하지는 않는다.
    const msg = errMsg(e);
    console.error('[order-sync] active orders lookup threw unexpectedly:', msg);
    active = { orders: [], ok: [], failed: [{ market: 'domestic', error: msg }, { market: 'overseas', error: msg }], complete: false };
  }

  const activeOrderIds  = new Set(active.orders.map(o => o.orderId));
  const activeOkMarkets = new Set<Market>(active.ok);
  const activeFailErr   = new Map<Market, string>(active.failed.map(f => [f.market, f.error]));
  for (const f of active.failed) errors.push(`active_orders ${f.market}: ${f.error}`);

  const coveredExchanges = new Set(overseasActiveOrderExchanges());

  // ── ② 심볼별로 묶어서 completed_orders 조회 ──────────────────────────────
  const bySymbol = new Map<string, PendingOrder[]>();
  for (const row of rows) {
    const sym = row.symbol;
    if (!bySymbol.has(sym)) bySymbol.set(sym, []);
    bySymbol.get(sym)!.push(row);
  }

  for (const [symbol, orders] of bySymbol) {
    const market = getMarketFromSymbol(symbol);

    // 가장 오래된 주문 기준으로 from_ts 계산 (1분 여유)
    const fromTs = Math.min(...orders.map(o => new Date(o.created_at).getTime())) - 60_000;
    const toTs = Date.now() + 5_000;

    let completedOrderIds = new Set<string>();
    /**
     * 주문번호 → 체결 증거. 수량은 **합이 아니라 최대값**을 쓴다.
     *
     * KIS 국내(`tot_ccld_qty`)는 주문당 **누적** 수량이라 여러 행을 더하면 중복 계산이 되고,
     * 그러면 실제로는 부분체결인 주문을 `filled` 로 단정하게 된다. 최대값은 두 표현(누적/개별)
     * 모두에서 **과대평가하지 않는** 값이라, 틀리더라도 항상 보수적인 쪽(`partially_filled`)으로
     * 틀린다.
     *
     * T-019 — 가격·시각은 **최대 수량을 보고한 그 행**의 값을 따라간다. 누적 표현에서는
     * 그 행이 가장 최신 누적이고 `avg_prvs`(평균 체결단가)를 담고 있어, 부분체결을
     * `executions` 에 남길 때 쓸 값으로 가장 적합하다.
     */
    const fills = new Map<string, FillEvidence>();
    let completedOk = true;
    let completedErr = '';
    try {
      const completed = await getCompletedOrders(symbol, fromTs, toTs, 100);
      completedOrderIds = new Set(completed.map(o => o.orderId));
      for (const c of completed) {
        const q = Number(c.qty);
        if (!Number.isFinite(q)) continue;
        const prev = fills.get(c.orderId);
        if (prev === undefined || q > prev.qty) {
          fills.set(c.orderId, { qty: q, price: numOrZero(c.price), ts: numOrZero(c.ts) });
        }
      }
    } catch (e) {
      completedOk = false;
      completedErr = errMsg(e);
      errors.push(`completed_orders ${symbol}: ${completedErr}`);
    }

    // 이 시장의 미체결 조회를 신뢰할 수 있는가.
    const activeOk = activeOkMarkets.has(market);
    const activeErr = activeOk
      ? ''
      : activeFailErr.get(market)
        ?? `${market} 시장 미체결 조회가 수행되지 않았다 (KIS_OVERSEAS_ENABLED 확인)`;

    // 조회가 성공해도 이 심볼이 미체결 조회의 사각지대일 수 있다 (해외 NYS/AMS).
    const coverageGap = isOverseasSymbol(symbol) && !coveredExchanges.has(parseOverseas(symbol).excd);
    /** 이 심볼에 대해 "미체결 목록에 없다"를 근거로 삼아도 되는가. */
    const activeReliable = activeOk && !coverageGap;

    for (const order of orders) {
      const eid = order.exchange_order_id!;
      try {
        // ── 증거 양성: 체결 조회가 성공했고 그 안에 있다 ─────────────────────
        // 최소한 일부는 체결됐다. 전량인지 잔량이 남았는지는 §부분체결 규칙으로 가른다.
        if (completedOk && completedOrderIds.has(eid)) {
          const decision = settleDecision(order, market, eid, fills.get(eid), activeReliable, activeOrderIds);
          const next = decision.status;

          // ── 🔴 T-019 §부분체결 종결 — 상태를 쓰기 **전에** 체결 수량을 남긴다 ─────
          //
          // 순서가 반대면 안 된다. `filled` 로 쓰는 순간 이 주문은 다음 회차 조회 대상
          // (`status IN ('pending','accepted','partially_filled')`)에서 사라지므로, 그 사이에
          // 프로세스가 죽으면 **실제 체결 수량을 복원할 방법이 영원히 없다**. 반대로
          // executions 를 먼저 쓰고 죽으면 다음 회차가 같은 결론에 다시 도달하고, 아래
          // 멱등 가드가 중복 INSERT 를 막는다.
          const rec = decision.partial
            ? await recordSettledFill(pool, order, decision.partial)
            : null;
          if (decision.unverified !== undefined) {
            completenessUnverified++;
            // 알림까지 올리지는 않는다 — 조치할 대상이 없고 빈도도 낮다. 다만 grep 가능한
            // 토큰으로 반드시 남긴다: "수량으로 반박하지 못한 채 filled 를 썼다"는 사실이
            // 조용해지면 이 작업이 없앤 침묵이 다른 이름으로 돌아온다.
            console.warn(
              `[order-sync] ⚠️ ORDER_SYNC_FILL_UNVERIFIED id=${order.id} ${order.symbol}(${market}) `
              + `eid=${eid} reason=${decision.unverified} — 완결을 수량으로 검증하지 못한 채 filled 로 기록`,
            );
          }

          // 이미 그 상태면 쓰지 않는다 — `partially_filled` 는 비종결 상태라 다음 회차에도
          // 다시 여기 오므로, 무조건 쓰면 매 회차 UPDATE 가 나가고 `synced` 가 부풀려진다.
          if (next !== order.status) {
            await pool.query(SET_STATUS_SQL[next], [order.id]);
            synced++;
          }
          // 결과 목록·감사기록은 **상태 전이가 실제로 성립한 뒤**에 남긴다. 위 UPDATE 가
          // 던지면 아래 per-order catch 가 이 주문을 미판정으로 처리하고, 다음 회차가 같은
          // 결론에 다시 도달한다 — 그때는 멱등 가드 덕에 executions 가 늘지 않는다.
          if (decision.partial && rec !== null) {
            partialSettlements.push({
              id: order.id,
              exchangeOrderId: eid,
              symbol: order.symbol,
              market,
              side: order.side ?? null,
              orderedQty: decision.partial.orderedQty,
              filledQty: decision.partial.filledQty,
              executionRecorded: rec.recorded,
              note: rec.note,
            });
            await auditPartialSettlement(pool, order, market, eid, decision.partial, errors);
          }
          // ── 🔴 H-4(B) — 확인 불가능한 부분체결이 조용히 갇히지 않게 ──────────
          // `partially_filled` 는 비종결 상태다. 잔량이 아직 작동 중인지 확인할 방법이
          // 있으면(=`activeReliable`) 다음 회차에 스스로 풀리므로 정상 판정이다.
          // 확인할 방법이 **구조적으로 없으면**(커버리지 밖 / 조회 실패 지속) 이 주문은
          // 영원히 여기 머물며 5분마다 KIS 조회만 소모한다 — 알림이 너무 자주 우는 게 아니라
          // **한 번도 울지 않는** 쪽의 위험이다.
          if (next === 'partially_filled' && !activeReliable) {
            const forMs = unjudgedFor(order.id, now);
            // N회차(기본 30분 = 6회차) 넘게 지속될 때만 승격한다 — 한두 회차는 잔량이 곧
            // 체결될 수 있는 정상 상황이고, 그때 알리면 정상 부분체결마다 알림이 울린다.
            if (forMs >= STALE_MS) {
              unreconciled.push({
                id: order.id,
                exchangeOrderId: eid,
                symbol: order.symbol,
                market,
                reason: 'partial_fill_unconfirmable',
                detail: coverageGap
                  ? `커버리지=${[...coveredExchanges].join(',')} 밖 — 잔량 존재 여부를 확인할 방법이 없다`
                  : `미체결 조회 실패 지속 — ${activeErr}`,
                unreconciledForMs: forMs,
              });
            }
          } else {
            reconciled(order.id);
          }
          continue;
        }

        // 여기부터는 "체결 목록에 없다"가 전제다 — 체결 조회가 실패했다면 그 전제부터 없다.
        if (!completedOk) {
          unreconciled.push(track(order, market, now,
            activeOk ? 'completed_query_failed' : 'both_queries_failed',
            activeOk ? completedErr : `completed: ${completedErr} / active: ${activeErr}`));
          continue;
        }

        // ── market 주문 ────────────────────────────────────────────────────
        // 애초에 미체결 목록에 나타나지 않으므로 취소 추론 대상이 아니다.
        // 체결 조회가 성공했고 거기 없다 = "아직 체결 전" 이라는 **판정된** 상태다.
        if (order.type === 'market') {
          reconciled(order.id);
          continue;
        }

        // ── 증거 음성: 취소 추론. 근거 축이 모두 성립해야 한다 ───────────────
        if (!activeOk) {
          unreconciled.push(track(order, market, now, 'active_query_failed', activeErr));
          continue;
        }
        if (coverageGap) {
          unreconciled.push(track(order, market, now, 'active_coverage_gap',
            `미체결 조회 커버리지=${[...coveredExchanges].join(',')} — 이 심볼의 거래소는 조회 대상이 아니다`));
          continue;
        }

        if (activeOrderIds.has(eid)) {
          reconciled(order.id);   // 아직 살아 있다 — 정상 판정, 변경 없음
          continue;
        }

        // ── §유예 기간 — 여기서만 필요하다 ──────────────────────────────────
        // 바로 위 검사를 통과했다는 것은 "미체결 목록에 **없다**"는 뜻이고, 방금 접수된
        // 주문은 아직 그 목록에 실리지 않았을 수 있다. 유예를 **부재를 확인한 직후**에 두는
        // 이유가 이것이다 — 목록에 보이는 주문(양성 증거)까지 붙잡아 두면, 정상 주문마다
        // 보류가 쌓여 유예 기간이 스스로 소음원이 된다.
        // 실패가 아니라 의도된 대기이므로 정체 시계에 올리지 않는다.
        const ageMs = now - new Date(order.created_at).getTime();
        if (ageMs < graceMs) {
          unreconciled.push(hold(order, market, 'too_fresh',
            `생성 ${Math.max(0, Math.round(ageMs / 1000))}초 경과 — 취소 판정 유예 ${Math.round(graceMs / 1000)}초 미경과`));
          continue;
        }

        // 미체결에도 없고 체결에도 없다 + 근거 축이 모두 성립 + 유예 경과 → 취소된 주문
        await pool.query(SET_STATUS_SQL.cancelled, [order.id]);
        synced++;
        reconciled(order.id);
      } catch (e) {
        // DB 쓰기 실패 등 — 이 주문은 이번 회차에 판정되지 못한 것으로 센다.
        errors.push(`order ${order.id}: ${errMsg(e)}`);
        unreconciled.push(track(order, market, now, 'both_queries_failed', `update failed: ${errMsg(e)}`));
      }
    }
  }

  pruneTracker(pendingIds);

  const staleCount = unreconciled.filter(u => u.unreconciledForMs >= STALE_MS).length;
  const oldestUnreconciledMs = unreconciled.reduce((m, u) => Math.max(m, u.unreconciledForMs), 0);
  // `too_fresh` 는 "판정 못 함"이 아니라 "아직 판정할 때가 아님"이다 — complete 를 깎지 않는다.
  const blocking = unreconciled.filter(u => u.reason !== 'too_fresh');

  const result: OrderSyncResult = {
    synced,
    errors,
    skipped: unreconciled.length,
    complete: blocking.length === 0,
    marketsOk: active.ok,
    marketsFailed: active.failed,
    unreconciled,
    staleCount,
    oldestUnreconciledMs,
    partialSettlements,
    completenessUnverified,
  };

  await reportUnreconciled(result);
  reportPartialSettlements(result);
  return result;
}

// ── 미판정 추적 (§역방향 위험) ───────────────────────────────────────────────

/**
 * `orders.id` → **연속 미판정이 시작된 시각**.
 *
 * 프로세스 메모리인 이유는 `notify/throttle.ts` 와 같다 — 재시작 시 초기화되는 것이 오히려
 * 맞다(재기동 직후의 첫 실패는 다시 알릴 가치가 있다). DB 테이블을 새로 만드는 대신
 * 기존 선례를 따른다. 판정에 성공하면 즉시 지우므로 "직전 회차에 성공했으면 0" 이 보장된다.
 */
const unreconciledSince = new Map<number, number>();

/** 판정 성공 — 미판정 시계를 없앤다. */
function reconciled(orderId: number): void {
  unreconciledSince.delete(orderId);
}

function track(
  order: PendingOrder, market: Market, now: number,
  reason: UnreconciledReason, detail: string,
): UnreconciledOrder {
  let since = unreconciledSince.get(order.id);
  if (since === undefined) {
    since = now;
    unreconciledSince.set(order.id, since);
  }
  return {
    id: order.id,
    exchangeOrderId: order.exchange_order_id!,
    symbol: order.symbol,
    market,
    reason,
    detail,
    unreconciledForMs: now - since,
  };
}

/**
 * 이 주문이 **해소되지 않은 상태로 머문 시간**. 없으면 지금부터 시작한다.
 *
 * `track()` 과 시계를 공유하되 `UnreconciledOrder` 를 만들지는 않는다 — 확인 불가능한
 * 부분체결처럼 **일정 시간이 지난 뒤에야 보고 대상이 되는** 경우를 위해서다.
 * 판정이 풀리면 `reconciled()` 가 시계를 지우므로 "직전 회차에 해소됐으면 0" 은 그대로 성립한다.
 */
function unjudgedFor(orderId: number, now: number): number {
  const since = unreconciledSince.get(orderId);
  if (since === undefined) {
    unreconciledSince.set(orderId, now);
    return 0;
  }
  return now - since;
}

/**
 * 정체 시계를 **올리지 않고** 보류를 기록한다 (`too_fresh` 전용).
 *
 * 시계에 올리면 건강한 새 주문이 30분 뒤 critical 알림을 울린다 — 유예 기간의 목적과 정반대다.
 * 기존 항목도 지운다: "판정에 실패한 게 아니라 아직 때가 아니다"가 정확한 상태이기 때문.
 */
function hold(
  order: PendingOrder, market: Market, reason: UnreconciledReason, detail: string,
): UnreconciledOrder {
  unreconciledSince.delete(order.id);
  return {
    id: order.id,
    exchangeOrderId: order.exchange_order_id!,
    symbol: order.symbol,
    market,
    reason,
    detail,
    unreconciledForMs: 0,
  };
}

/** 더 이상 미결이 아닌 주문의 추적 항목을 정리한다 (맵 무한 증가 방지). */
function pruneTracker(pendingIds: Set<number>): void {
  for (const id of unreconciledSince.keys()) {
    if (!pendingIds.has(id)) unreconciledSince.delete(id);
  }
}

/** 테스트/진단용 — 미판정 추적 상태 초기화. */
export function resetUnreconciledTracker(): void {
  unreconciledSince.clear();
}

// ── 체결 상태 판정 (§부분체결) ───────────────────────────────────────────────

/**
 * 상태별 고정 SQL. 상태값을 파라미터로 넘기지 않고 리터럴로 두는 이유는 두 가지다 —
 * 값이 ENUM 에 묶여 있어 오타가 런타임까지 살아남으면 안 되고, 로그·테스트에서 어떤 상태가
 * 쓰였는지 SQL 문자열만 보고 판별할 수 있어야 한다.
 */
const SET_STATUS_SQL = {
  filled:           `UPDATE orders SET status='filled' WHERE id=?`,
  partially_filled: `UPDATE orders SET status='partially_filled' WHERE id=?`,
  cancelled:        `UPDATE orders SET status='cancelled' WHERE id=?`,
} as const;

/**
 * 부동소수 비교 허용오차. `trade-report.ts` 가 LIFO 재고 차감에 이미 `1e-12` 를 쓰고 있어
 * 같은 관례를 따른다 — 수량 비교의 기준이 모듈마다 다르면 "리포트는 전량인데 동기화는
 * 부분체결"처럼 서로 모순되는 판정이 나온다.
 */
const QTY_EPSILON = 1e-12;

/** 부분체결로 **종결**됐다는 판정에 딸린 증거. */
interface PartialFill {
  /** 브로커가 실제로 받은 수량 */
  orderedQty: number;
  /** 확인된 체결 수량 (`orderedQty` 보다 작다) */
  filledQty: number;
  /** 체결 단가. 0 이면 브로커 응답에서 얻지 못함 */
  price: number;
  /** 체결 시각(epoch ms). 0 이면 모름 */
  ts: number;
}

interface SettleDecision {
  status: 'filled' | 'partially_filled';
  /** 있으면 "종결됐지만 전량이 아니다" — `executions` 에 실제 수량을 남겨야 한다 */
  partial?: PartialFill;
  /** 완결을 **수량으로 검증하지 못한** 채 `filled` 를 쓴 경우의 사유 */
  unverified?: 'fill_qty_unknown' | 'ordered_qty_unknown';
}

/**
 * 체결 목록에 나타난 주문의 최종 판정. 규칙표는 함수 상단 §부분체결 / §부분체결 종결 참조.
 *
 * 핵심: **"일부 체결됐다"는 존재로 증명되고, "끝났다"는 잔량의 부재로 증명되며,
 * "전량 체결됐다"는 수량으로만 증명된다.** 이 셋은 서로 다른 명제다 — 예전 코드는
 * 두 번째에서 세 번째를 곧바로 유도했고 그것이 T-019 의 결함이다.
 */
function settleDecision(
  order: PendingOrder,
  market: Market,
  eid: string,
  fill: FillEvidence | undefined,
  activeReliable: boolean,
  activeOrderIds: Set<string>,
): SettleDecision {
  // 🔴 D-4 — market 주문은 여기서 **수량 검증을 하지 않는다.**
  //
  // 이 함수가 "부분체결로 종결됐다"고 말할 수 있는 근거는 오직 "잔량이 신뢰할 수 있는
  // 미체결 목록에서 사라졌다"이다. market 주문은 그 목록에 **원래** 나타나지 않으므로
  // 그 근거를 얻을 방법이 구조적으로 없다. 그런데도 수량만 보고 종결시키면, 5분 주기
  // 동기화가 **체결 진행 중인 스냅샷**을 잡았을 때 그 중간값이 `executions` 에 영구히
  // 박히고 상태는 종결된다 — 드문 과대계상을 없애려다 매 회차의 과소계상을 만드는 셈이다.
  // 시장가 부분체결은 실재하지만, 그것은 잔량 확인 수단이 생긴 뒤에 다뤄야 한다.
  if (order.type === 'market') return { status: 'filled' };

  // 🔴 H-4 — 비교 대상은 `orders.quantity` 가 **아니라** 브로커가 실제로 받은 수량이다.
  // DB 는 자르지 않은 원본(예: 1.7)을 갖고 있고 해외 주문은 잘린 값(1)으로 나간다.
  // 원본과 비교하면 부등식이 영원히 성립하지 않아 완전 체결된 주문이 갇힌다.
  // 자르는 규칙은 송신 경로와 **같은 함수**를 쓴다 — 재유도하면 버그가 자리만 옮긴다.
  const ordered = submittedQuantity(market, Number(order.quantity));

  if (activeReliable) {
    // 두 목록에 동시에 있다 = 일부 체결 + 잔량이 아직 브로커에서 작동 중
    if (activeOrderIds.has(eid)) return { status: 'partially_filled' };

    // 여기부터 "잔량이 신뢰할 수 있는 목록에서 사라졌다" = **종결**이다.
    // 남은 질문은 하나뿐: 전량이었나?
    if (fill === undefined || !(fill.qty > 0)) {
      // 수량으로 반박할 근거가 없다 → 기존 동작(`filled`) 유지. 다만 조용히 넘기지 않는다.
      return { status: 'filled', unverified: 'fill_qty_unknown' };
    }
    if (!(ordered > 0)) {
      // `orders.quantity` 가 NULL/0 — 비교의 오른쪽이 없다. 마찬가지로 유지 + 흔적.
      return { status: 'filled', unverified: 'ordered_qty_unknown' };
    }
    if (fill.qty < ordered - QTY_EPSILON) {
      return {
        status: 'filled',
        partial: { orderedQty: ordered, filledQty: fill.qty, price: fill.price, ts: fill.ts },
      };
    }
    return { status: 'filled' };
  }

  // 미체결 목록을 신뢰할 수 없다(조회 실패 또는 커버리지 밖).
  // 다만 **체결 수량**은 부재 추론 없이 완결을 직접 증명할 수 있는 양성 증거다.
  // 이 경로가 없으면 커버리지 밖(NYS/AMS) 주문이 영원히 `partially_filled` 로 남는다.
  // 반대로 수량이 모자랄 때는 "끝났다"는 근거가 없으므로 **종결시키지 않는다** —
  // 비종결 상태로 두면 다음 회차에 스스로 교정된다 (T-018 §부분체결 그대로).
  if (ordered > 0 && fill !== undefined && fill.qty >= ordered) {
    return { status: 'filled' };
  }
  return { status: 'partially_filled' };
}

// ── 부분체결 종결의 기록 (T-019 D-2 (a) / D-3) ───────────────────────────────

/**
 * 실제 체결 수량을 `executions` 에 남긴다 — 손익 왜곡의 **근본 원인 제거**.
 *
 * `trade-report.fetchOrderRows` 는 `COALESCE(e.quantity, o.quantity)` 로 수량을 집으므로,
 * 이 행 하나가 있으면 리포트가 자동으로 참값을 쓴다.
 *
 * ## 지켜야 하는 제약 (task 파일 D-2 (a) 및 reviewer 지적)
 *
 *  1. **주문당 행은 정확히 하나.** `fetchOrderRows` 는 `GROUP BY o.id` 아래에서
 *     `e.price`/`e.quantity` 를 **비집계로** 뽑는다 — 주문당 행이 여럿이면 임의 행이
 *     선택된다. 그래서 개별 체결이 아니라 **누적 체결 1행**을 쓴다. 이렇게 하면 임의
 *     선택이 일어나도 항상 같은(참) 값이 나온다.
 *  2. **멱등(순차).** 이미 행이 있으면 쓰지 않는다. 재실행·재배포에도 행이 늘지 않는다.
 *
 *     ⚠️ **진짜 동시 실행에 대해서는 원자적이지 않다** (reviewer MEDIUM-1). SELECT→INSERT
 *     사이에 다른 프로세스가 끼어들면 두 행이 생길 수 있다. 이 한계를 **없애지 않고
 *     남겨 둔 이유**는 아래 §동시성 참조 — 대신 {@link detectDuplicateExecutions} 가
 *     사후에 **탐지**해 로그로 드러낸다. 조용히 넘기지는 않는다.
 *  3. **`NOT NULL` 컬럼 값.**
 *     - `quantity` — 확인된 체결 수량. 이 함수가 불리는 조건 자체가 "수량을 안다"이다.
 *     - `price` — 브로커가 준 체결 단가. 없으면 주문의 지정가로 폴백한다. 둘 다 없으면
 *       **행을 쓰지 않는다**: `e.price` 에 0 을 박으면 `COALESCE(e.price, o.price)` 가
 *       0 을 집어 `computeLifoPnl` 의 "가격 없으면 `amount_krw/quantity`" 폴백까지
 *       무력화된다 — 안 쓰는 것보다 나쁘다.
 *     - `fee` — **0**. 수수료를 모르는데 추정치를 넣으면 손익이 조용히 틀어진다. 0 은
 *       `executions` 가 아예 없던 현재 동작(`COALESCE(SUM(e.fee),0)`)과 정확히 같다.
 *  4. **`executed_at`** — 브로커가 준 체결 시각. 없으면 DB 기본값(NOW()). LIFO 는
 *     `ts ASC` 로 정렬하므로 실제 체결 시각을 쓰는 쪽이 재고 순서에 더 정확하다.
 *
 * ## §동시성 — 왜 원자성을 강제하지 않았나 (reviewer MEDIUM-1 / Leader 판단 반영)
 *
 * 검토한 선택지와 기각 사유:
 *
 * | 안 | 판단 |
 * |---|---|
 * | `UNIQUE KEY (order_id)` | **Leader 가 금지.** "주문당 1행"을 스키마에 못 박으면 장래에 **실제 체결 건별로 여러 행**을 남기는 자연스러운 설계가 영구히 봉쇄된다. 지금의 누적 1행은 편의적 선택이지 최종 형태가 아니다 |
 * | `INSERT … SELECT … WHERE NOT EXISTS` | 기각. UNIQUE 인덱스가 없으면 두 트랜잭션이 모두 "없음"을 보고 각자 INSERT 할 수 있다. 갭 락으로 막히는지는 격리수준·binlog 형식에 좌우돼 **여기서 원자성을 보장한다고 쓸 수 없다.** 보장 못 하는 것을 보장한다고 적는 것 자체가 이 프로젝트가 없애 온 침묵이다 |
 * | `SELECT … FOR UPDATE` (orders 행) | 기각. 5분 주기 cron 이 **주문 경로가 쓰는 `orders` 행에 배타 락**을 잡는다. `submitOrder` 의 상태 UPDATE 와 경합할 수 있고, 막으려는 사고(노출도 낮음)보다 만드는 위험이 크다 |
 * | `GET_LOCK()` 명명 락 | 기각. 커넥션 스코프 락인데 풀에서 획득·해제 커넥션이 같다는 보장이 없다. 전용 커넥션을 잡아야 하고, 누수되면 **이후 회차가 통째로 막힌다** — 중복 행 하나보다 나쁜 실패 모드다 |
 *
 * → **현행(SELECT-then-INSERT) 유지 + 사후 탐지.** 근거:
 *
 *  - **노출 조건이 좁다.** `cron-runner.sh` 는 curl 을 순차 blocking 호출하는 단일 루프라
 *    정상 운영에서 겹치지 않는다. 겹치려면 (a) 수동 강제 트리거가 cron 과 우연히 동시 실행,
 *    또는 (b) pm2 재배포 중 이전 요청이 아직 처리 중 — 둘 다 드물다.
 *  - **터져도 피해가 작다.** 두 행의 값은 같은 주문·비슷한 시점의 브로커 응답이라 통상 동일하고,
 *    `fee=0` 이라 `SUM(e.fee)` 중복 합산이 0 이다. 이론적 잔여 위험은 두 프로세스가 서로 다른
 *    시점에 `getCompletedOrders` 를 호출해 그 사이 추가 체결이 반영된 경우뿐이다.
 *  - **터진 것을 알 수 있다.** 아래 탐지기가 `ORDER_SYNC_EXEC_DUPLICATE` 로 남긴다.
 *
 * **승격 트리거**: `ORDER_SYNC_EXEC_DUPLICATE` 가 **한 번이라도** 로그에 나타나면 이 판단의
 * 전제(노출도 낮음)가 깨진 것이다. 그때는 `executions` 스키마를 "체결 건별 다행"으로
 * 확정하고 `(order_id, executed_at, price, quantity)` 자연키 기준의 중복 제거로 넘어가야 한다.
 */
async function recordSettledFill(
  pool: ReturnType<typeof getPool>,
  order: PendingOrder,
  partial: PartialFill,
): Promise<{ recorded: boolean; note?: string }> {
  const orderPrice = numOrZero(order.price);
  const price = partial.price > 0 ? partial.price : orderPrice;
  if (!(price > 0)) {
    return {
      recorded: false,
      note: '체결가·지정가를 모두 알 수 없어 executions 에 기록하지 못했다 — 이 주문의 손익은 여전히 주문 수량 기준이다',
    };
  }

  const [existing] = await pool.query<RowDataPacket[]>(
    'SELECT id FROM executions WHERE order_id = ? LIMIT 1',
    [order.id],
  );
  if (Array.isArray(existing) && existing.length > 0) {
    // 이미 체결 기록이 있다 — 두 번째 행을 넣으면 `GROUP BY o.id` 의 임의 선택이
    // 비결정적이 된다. 덮어쓰지도 않는다(기존 기록이 더 정확할 수 있다).
    return { recorded: false, note: '이미 executions 행이 있어 추가 기록하지 않았다' };
  }

  const executedAt = partial.ts > 0 ? new Date(partial.ts) : new Date();
  await pool.query(
    `INSERT INTO executions (order_id, price, quantity, fee, executed_at)
     VALUES (?, ?, ?, 0, ?)`,
    [order.id, price, partial.filledQty, executedAt],
  ).catch((e: unknown) => {
    // 여기서 실패하면 상태를 `filled` 로 넘기면 안 된다 — 넘기는 순간 이 주문은 다음
    // 회차 조회 대상에서 사라지고 실제 체결 수량이 영구히 유실된다. 호출부의 per-order
    // catch 로 올려 **이번 회차 미판정**으로 처리하고 다음 회차에 다시 시도하게 한다.
    throw new Error(`executions insert failed (order ${order.id}): ${errMsg(e)}`);
  });

  const dup = await detectDuplicateExecutions(pool, order.id);
  return dup === null ? { recorded: true } : { recorded: true, note: dup };
}

/**
 * 방금 쓴 행이 **혼자인지** 확인한다 (§동시성).
 *
 * 원자성을 강제하지 않기로 한 대가로, 최소한 **깨졌을 때 알 수는 있어야** 한다.
 * 경합이 일어나면 두 프로세스 중 나중에 검사하는 쪽이 `2` 를 보므로 탐지는 실질적으로
 * 확실하다. 비용은 부분체결 종결 1건당 SELECT 한 번 — 이 경로 자체가 드물어 무시할 만하다.
 *
 * 탐지 실패(조회 자체가 실패)는 삼킨다. 이건 진단이지 판정이 아니라서, 여기서 예외를 올리면
 * **이미 성공한 기록과 상태 전이를 미판정으로 되돌려** 다음 회차 중복 판정을 유발한다.
 */
async function detectDuplicateExecutions(
  pool: ReturnType<typeof getPool>,
  orderId: number,
): Promise<string | null> {
  try {
    const [rows] = await pool.query<(RowDataPacket & { n: number })[]>(
      'SELECT COUNT(*) AS n FROM executions WHERE order_id = ?',
      [orderId],
    );
    const n = Number(rows?.[0]?.n ?? 1);
    if (!Number.isFinite(n) || n <= 1) return null;

    const note = `executions 행이 ${n}개다 — 동시 실행 경합으로 중복 기록됐다`;
    console.error(
      `[order-sync] 🔴 ORDER_SYNC_EXEC_DUPLICATE order=${orderId} rows=${n} — `
      + 'SELECT-then-INSERT 멱등 가드가 동시 실행에서 깨졌다. 손익은 (fee=0·동일값 가정) 아직 '
      + '맞을 수 있으나, "노출도가 낮다"는 전제가 깨진 것이므로 executions 스키마를 '
      + '체결 건별 다행 + 자연키 중복 제거로 확정해야 한다 (order-sync.ts §동시성 승격 트리거)',
    );
    return note;
  } catch {
    return null;   // 진단 실패가 판정을 되돌리게 두지 않는다
  }
}

/**
 * `trade_logs` 감사 기록 (CLAUDE.md "실매매 원칙" 3항 — 성공·거부·에러 모두 남긴다).
 *
 * 감사 기록 실패가 상태 전이를 되돌려서는 안 되므로 **여기서만은 삼키고** `errors[]` 에
 * 남긴다. 이미 `executions` 와 `orders.status` 가 쓰인 뒤라, 여기서 예외를 올리면
 * 성공한 전이를 미판정으로 되돌려 다음 회차에 중복 판정을 유발한다.
 */
async function auditPartialSettlement(
  pool: ReturnType<typeof getPool>,
  order: PendingOrder,
  market: Market,
  eid: string,
  partial: PartialFill,
  errors: string[],
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO trade_logs (order_id, event, payload) VALUES (?, ?, ?)`,
      [order.id, 'partial_fill_settled', JSON.stringify({
        exchangeOrderId: eid,
        symbol: order.symbol,
        market,
        side: order.side ?? null,
        orderedQty: partial.orderedQty,
        filledQty: partial.filledQty,
        shortfallQty: partial.orderedQty - partial.filledQty,
        price: partial.price > 0 ? partial.price : null,
        source: 'order-sync',
      })],
    );
  } catch (e) {
    errors.push(`partial_fill_settled audit ${order.id}: ${errMsg(e)}`);
    console.error(`[order-sync] partial_fill_settled 감사 기록 실패 order=${order.id}:`, errMsg(e));
  }
}

// ── 취소 판정 유예 설정 (§유예 기간) ─────────────────────────────────────────

/** 런타임 조정 키 — `kis_rate_limit_per_sec` 와 같은 방식으로 재배포 없이 바꾼다. */
export const ORDER_SYNC_GRACE_KEY = 'order_sync_cancel_grace_sec';

/**
 * 주문 생성 후 취소 판정을 유예하는 시간(초).
 *
 * 고른 근거:
 *  1. **실측 사고와의 마진** — #3137 은 생성 **6초** 뒤 취소로 마킹됐다. 120초는 그 20배다.
 *     "관측된 값보다 조금 큰 값"이 아니라 **자릿수가 다른 값**을 골라야 같은 유형의 지연이
 *     조금 더 길게 나타나도 덮인다.
 *  2. **해외 주문의 전파 지연** — 사고 주문이 `NAS:SNDK` 였다. 해외 주문은 국내보다 브로커
 *     내부 반영이 늦을 여지가 크고, 그 지연을 우리가 측정한 자료는 저장소에 없다.
 *  3. **비용이 싸다** — 동기화 주기가 5분이므로 유예 2분이 실제로 미루는 것은 **최대 한 회차**다.
 *     진짜 취소된 주문의 인지가 최대 5분 늦어질 뿐이고, 그 대가로 이중 주문을 막는다.
 *     오류 비용이 완전히 비대칭이다.
 *
 * 조정(재배포 불필요): `system_config.order_sync_cancel_grace_sec` → env
 * `ORDER_SYNC_CANCEL_GRACE_SEC` → 이 기본값.
 */
export const DEFAULT_CANCEL_GRACE_SEC = 120;

/**
 * 하한이 0 이 아닌 이유: 이 값은 성능 손잡이가 아니라 **안전장치**다. 0 이나 5 로 내리면
 * 실측된 6초짜리 사고가 그대로 재현된다. 진단 목적이라도 코드 수정 없이 보호를 꺼버릴 수
 * 있어서는 안 된다.
 */
const MIN_GRACE_SEC = 30;
const MAX_GRACE_SEC = 3600;

export function clampGraceSec(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return DEFAULT_CANCEL_GRACE_SEC;
  return Math.min(MAX_GRACE_SEC, Math.max(MIN_GRACE_SEC, v));
}

function envGraceSec(): number | null {
  const raw = (process.env.ORDER_SYNC_CANCEL_GRACE_SEC ?? '').trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * 유예 시간(ms). `system_config` → env → 기본값 순으로 해석한다.
 *
 * 스로틀과 달리 캐시를 두지 않는다 — 이 함수는 5분 주기 cron 에서 회차당 한 번만 불리므로
 * hot path 가 아니고, 캐시가 없으면 설정 변경이 **즉시** 반영된다. 조회 실패 시에는 조용히
 * 기본값으로 내려간다: 설정 조회 실패 때문에 동기화 자체가 멈추면 안 되고, 기본값은 보수적
 * (더 안전한) 방향이기 때문.
 */
async function cancelGraceMs(pool: ReturnType<typeof getPool>): Promise<number> {
  try {
    const [rows] = await pool.query<(RowDataPacket & { value: string })[]>(
      'SELECT value FROM system_config WHERE `key` = ? LIMIT 1',
      [ORDER_SYNC_GRACE_KEY],
    );
    if (Array.isArray(rows) && rows.length > 0) {
      const raw = String(rows[0].value);
      let decoded: unknown = raw;
      try { decoded = JSON.parse(raw); } catch { /* 비 JSON 원문 그대로 */ }
      const n = Number(decoded);
      if (Number.isFinite(n) && n > 0) return clampGraceSec(n) * 1000;
    }
  } catch {
    /* 설정 조회 실패 — 기본값으로 진행한다 (보수적 방향) */
  }
  return clampGraceSec(envGraceSec() ?? DEFAULT_CANCEL_GRACE_SEC) * 1000;
}

// ── 임계·가시화 ──────────────────────────────────────────────────────────────

/**
 * 미판정이 이 시간을 넘으면 알린다.
 *
 * `strategy-eval` cron 은 5분 주기이므로 기본 30분 = **연속 6회차 실패**다. 한두 회차의
 * 일시적 레이트리밋으로 알림이 울리면 아무도 보지 않게 되고, 그러면 알림이 있으나 마나다.
 * 6회 연속은 "일시적이 아니다"라고 말하기에 충분하다.
 */
const STALE_MS = Math.max(1, Number(process.env.ORDER_SYNC_STALE_MINUTES ?? 30)) * 60_000;

/**
 * 🔴 Fix3(I3) — `STRUCTURAL_MS`(하드코딩 2시간)는 항상 `STALE_MS`(env로 조정 가능)보다
 * 유의미하게 커야 한다. 그렇지 않으면 "30분~2시간은 반복 알림" 단계가 사라지고, 모든 정체
 * 주문이 첫 감지부터 곧장 구조적으로 승격+잠긴다 — 누군가 `ORDER_SYNC_STALE_MINUTES`를
 * 120분 넘게 설정하는 순간 조용히 벌어질 수 있는 일이다. 여기서 잘못을 알리고, 비교
 * 지점에서는 항상 안전한 값을 쓴다(아래 `EFFECTIVE_STRUCTURAL_MS`).
 */
if (STRUCTURAL_MS <= STALE_MS) {
  console.warn(
    `[order-sync] ⚠️ ORDER_SYNC_STRUCTURAL_MS_MISCONFIGURED — STRUCTURAL_MS(${STRUCTURAL_MS}ms)가 `
    + `STALE_MS(${STALE_MS}ms) 이하다. ORDER_SYNC_STALE_MINUTES 설정을 확인하라 — `
    + '비교 시점에는 방어적으로 보정한 값을 쓴다.',
  );
}
/** 실제 비교에 쓰는 값 — 위 불변식이 깨져도 항상 `STALE_MS`보다 크다. */
const EFFECTIVE_STRUCTURAL_MS = Math.max(STRUCTURAL_MS, STALE_MS + 1);

/** 같은 상황을 30분에 한 번만 알린다 (로그는 매 회차 남는다). */
const STALE_ALERT_TTL_MS = 30 * 60_000;
/**
 * 커버리지 사각지대는 **재시도로 낫지 않는다** — 코드 수정 전까지 매 회차 재발한다.
 * 30분마다 울려봐야 정보량이 늘지 않으므로 훨씬 긴 창을 쓴다.
 */
const COVERAGE_ALERT_TTL_MS = 6 * 60 * 60_000;

/**
 * "판정하지 못했다"를 **보이게** 만든다.
 *
 * 호출부가 반환값을 버려도 최소한 로그와 알림은 남는다. 이 작업의 요점이 조용한 실패의
 * 제거이므로, 새로 만든 신호가 다시 조용해지면 안 된다.
 */
async function reportUnreconciled(r: OrderSyncResult): Promise<void> {
  // 🔴 Fix1(I1) — 이 호출도 에스컬레이션 추적 DB 호출이다. 실패해도 뒤따르는 판정 보고·알림
  // 로직(및 호출부의 reportPartialSettlements)이 죽으면 안 되므로 여기서 삼킨다.
  try {
    await clearResolved(r.unreconciled.map(u => u.id));
  } catch (e) {
    reportEscalationTrackingFailure(e);
  }

  if (r.unreconciled.length === 0) return;
  // `too_fresh` 만 있는 회차는 정상 운영 상태다 — 새 주문을 낼 때마다 경고를 찍으면
  // 이 토큰이 흔해져서 진짜 보류를 가린다. (유예를 넘겨도 안 풀리면 아래 사유로 승격된다.)
  if (r.unreconciled.every(u => u.reason === 'too_fresh')) return;

  const byReason = new Map<UnreconciledReason, number>();
  for (const u of r.unreconciled) byReason.set(u.reason, (byReason.get(u.reason) ?? 0) + 1);
  const reasonSummary = [...byReason].map(([k, v]) => `${k}=${v}`).join(' ');
  const oldestMin = Math.floor(r.oldestUnreconciledMs / 60_000);

  console.warn(
    `[order-sync] ⚠️ ORDER_SYNC_UNRECONCILED — ${r.unreconciled.length}건 판정 보류 (${reasonSummary}) `
    + `최장 ${oldestMin}분 / 조회성공시장=[${r.marketsOk.join(',') || '-'}] `
    + `실패시장=[${r.marketsFailed.map(f => f.market).join(',') || '-'}] `
    + '— 살아 있을 수 있는 주문을 cancelled 로 쓰지 않고 다음 회차로 미뤘다',
  );
  for (const u of r.unreconciled) {
    console.warn(`[order-sync]   보류 id=${u.id} ${u.symbol}(${u.market}) reason=${u.reason} `
      + `${Math.floor(u.unreconciledForMs / 60_000)}분 — ${u.detail}`);
  }

  const staleFailures = r.unreconciled.filter(
    u => u.reason !== 'active_coverage_gap'
      // 시계에 오르지 않으므로 원래 걸릴 수 없지만, 의도를 명시한다
      && u.reason !== 'too_fresh'
      // 체결 사실은 기록됐다 — 긴급도가 다르다
      && u.reason !== 'partial_fill_unconfirmable'
      && u.unreconciledForMs >= STALE_MS,
  );

  if (staleFailures.length > 0) {
    const now = Date.now();
    // 🔴 Fix1(I1) — 에스컬레이션 추적 DB 호출(getStaleTracking/recordFirstStale/markEscalated)이
    // 실패해도 이 함수 전체가 reject하면 안 된다. reject하면 syncPendingOrders()가 reject하고,
    // 바로 뒤에 이어지는 reportPartialSettlements(result)가 **영원히 실행되지 않아** 무관한
    // 부분체결 알림까지 조용히 삼켜진다 — 특히 `order_sync_stale_tracking`이 아직 마이그레이션
    // 되지 않은 부팅 경쟁(getPool()이 ensureSetup() 완료 전에 풀을 내주는 경우)에서 실제로
    // 벌어질 수 있다. 실패하면 **fail-open** — 에스컬레이션이 아예 없었던 것처럼
    // `staleFailures` 전원을 예전 그대로 반복 알림 대상으로 둔다(= fail-closed로 침묵하지 않는다).
    let repeating = staleFailures;
    try {
      const tracking = await getStaleTracking(staleFailures.map(u => u.id));

      for (const u of staleFailures) {
        if (!tracking.has(u.id)) await recordFirstStale(u.id, u.symbol, now - u.unreconciledForMs);
      }

      const newlyStructural = staleFailures.filter(u => {
        const t = tracking.get(u.id);
        if (t?.escalatedAt != null) return false;
        const firstStaleAt = t?.firstStaleAt ?? (now - u.unreconciledForMs);
        return (now - firstStaleAt) >= EFFECTIVE_STRUCTURAL_MS;
      });

      for (const u of newlyStructural) {
        const t = tracking.get(u.id);
        const firstStaleAt = t?.firstStaleAt ?? (now - u.unreconciledForMs);
        // Fix2 bundled M4 — 고정 임계값이 아니라 이 주문의 실제 경과 시간을 보여준다.
        // 재시작 뒤에는 DB에 남은 firstStaleAt 때문에 실제 나이가 2시간보다 훨씬 클 수 있다.
        const ageHours = (now - firstStaleAt) / 3_600_000;
        // 🔴 Fix2(I2) — 키를 주문별로 나눈다. 예전의 고정 키(`order-sync:stale-structural`)는
        // 같은 날 두 번째로 2시간을 넘는 주문의 알림을 24시간 창 안에서 조용히 삼켰다 —
        // markEscalated는 그대로 실행돼 반복 알림 대상에서는 빠지는데, 정작 **한 번도
        // 알려지지 않은 채 잠기는** 결함이었다. TTL은 그대로 defense-in-depth로 남긴다:
        // "알림은 보냈는데 markEscalated가 그 직후에 던지는" 시나리오에서 재전송을 24시간
        // 동안 눌러 준다 — `escalated_at IS NOT NULL` DB 체크와 이중 안전장치를 이룬다.
        sendAlertThrottled(
          `order-sync:stale-structural:${u.id}`,
          'critical',
          '주문 상태 확인 불가가 구조적 상태로 전환됐습니다',
          `${u.symbol}#${u.id}가 ${ageHours.toFixed(1)}시간 넘게 확인되지 않아 반복 알림을 멈추고 `
          + '대시보드로 추적을 전환합니다.\n'
          + '근본 원인(KIS 조회 실패·레이트리밋·토큰)을 확인하세요. 정상 정리되면 이 상태는 '
          + '자동으로 해제되고, 다음 발생 시 처음부터 다시 알립니다.',
          24 * 60 * 60_000,
        );
        await markEscalated(u.id, now);
      }

      const escalatedIds = new Set([
        ...newlyStructural.map(u => u.id),
        ...[...tracking.values()].filter(t => t.escalatedAt != null).map(t => t.orderId),
      ]);
      repeating = staleFailures.filter(u => !escalatedIds.has(u.id));
    } catch (e) {
      reportEscalationTrackingFailure(e);
      // repeating은 위에서 선언한 대로 staleFailures 전체 — fail-open 유지.
    }

    if (repeating.length > 0) {
      sendAlertThrottled(
        'order-sync:stale',
        'critical',
        '주문 상태 확인 불가가 지속되고 있습니다',
        `${repeating.length}건의 주문 상태를 ${Math.floor(STALE_MS / 60_000)}분 넘게 확인하지 못했습니다 `
        + `(최장 ${oldestMin}분).\n`
        + `실패 시장: ${r.marketsFailed.map(f => `${f.market}(${f.error})`).join(', ') || '-'}\n`
        + `대상: ${repeating.map(u => `${u.symbol}#${u.id}`).join(', ')}\n`
        + '이 주문들은 브로커에 살아 있을 수 있어 취소로 처리하지 않았습니다. '
        + 'KIS 조회 실패(레이트리밋·토큰·네트워크)를 확인하세요.',
        STALE_ALERT_TTL_MS,
      );
    }
  }

  const coverage = r.unreconciled.filter(u => u.reason === 'active_coverage_gap');
  if (coverage.length > 0) {
    sendAlertThrottled(
      'order-sync:coverage',
      'warning',
      '미체결 조회 사각지대 — 취소 판정을 보류 중',
      `${coverage.length}건이 해외 미체결 조회 범위 밖 거래소에 있습니다: `
      + `${[...new Set(coverage.map(u => u.symbol))].join(', ')}\n`
      + '조회가 성공해도 이 심볼들은 목록에 나타나지 않으므로, 취소 판정을 하면 오판이 됩니다. '
      + '체결(filled) 판정은 정상 동작합니다. 근본 해결에는 거래소별 미체결 조회 확장이 필요합니다.',
      COVERAGE_ALERT_TTL_MS,
    );
  }

  /**
   * 확인 불가능한 부분체결 — 커버리지 경고와 **키를 나눈다.** 상황이 다르고
   * `sendAlertThrottled` 는 키 단위로 창을 잡으므로, 같은 키를 쓰면 둘 중 하나가 다른 하나를
   * 조용히 억눌러 버린다 (이 작업이 없애려는 바로 그 침묵).
   *
   * 문구는 **양성 오탐을 전제로** 쓴다: 장 마감 때 브로커가 잔량을 취소하는 것은 완전히
   * 정상이고, 그 경우 이 알림은 "오류"가 아니라 "확인해 두라"는 뜻이다. 정상 상황을
   * 에러처럼 알리면 사람이 무시하기 시작하고, 그러면 알림이 있으나 마나가 된다.
   */
  const unconfirmable = r.unreconciled.filter(u => u.reason === 'partial_fill_unconfirmable');
  if (unconfirmable.length > 0) {
    sendAlertThrottled(
      'order-sync:partial-unconfirmed',
      'warning',
      '부분체결 잔량을 확인하지 못하고 있습니다',
      `${unconfirmable.length}건이 부분체결로 기록된 뒤 잔량 존재 여부를 `
      + `${Math.floor(STALE_MS / 60_000)}분 넘게 확인하지 못했습니다.\n`
      + `대상: ${unconfirmable.map(u => `${u.symbol}#${u.id}(${Math.floor(u.unreconciledForMs / 60_000)}분)`).join(', ')}\n`
      + '체결된 부분은 이미 기록되어 있습니다. 잔량이 장 마감 때 취소된 것이라면 정상 상황이며, '
      + '이 알림은 오류 통보가 아니라 확인 요청입니다. KIS 에서 잔량 여부를 확인하고 남아 있지 '
      + '않다면 조치는 필요 없습니다.',
      COVERAGE_ALERT_TTL_MS,
    );
  }
}

/**
 * 🔴 Fix1(I1) — 에스컬레이션 추적 DB 실패의 공통 처리.
 *
 * `order_sync_stale_tracking` 관련 호출(`clearResolved`/`getStaleTracking`/`recordFirstStale`/
 * `markEscalated`)이 던지는 이유는 대부분 인프라성이다 — 테이블이 아직 마이그레이션되지 않은
 * 부팅 경쟁(`getPool()`이 `ensureSetup()` 완료 전에 풀을 내주는 fire-and-forget 설정)이 대표적.
 * 이 자체는 거래 긴급 상황이 아니므로 `warning`으로 6시간 창을 쓴다 — 다만 grep 가능한
 * 토큰으로 반드시 로그에 남긴다: 조용해지면 이 작업이 없애려는 침묵이 다른 이름으로 돌아온다.
 */
function reportEscalationTrackingFailure(e: unknown): void {
  console.warn(
    `[order-sync] ⚠️ ORDER_SYNC_ESCALATION_TRACKING_FAILED — ${errMsg(e)} — `
    + '에스컬레이션 추적 없이 기존 반복 알림 동작으로 계속 진행한다',
  );
  sendAlertThrottled(
    'order-sync:escalation-tracking-failed',
    'warning',
    '주문 에스컬레이션 추적 실패',
    `order_sync_stale_tracking 관련 DB 호출이 실패했습니다: ${errMsg(e)}\n`
    + '구조적 에스컬레이션(2시간 1회 알림·잠금) 없이 기존 반복 알림 동작으로 계속 진행합니다. '
    + '테이블 존재 여부·마이그레이션 상태를 확인하세요.',
    6 * 60 * 60_000,
  );
}

/**
 * 부분체결 종결 알림의 창. 커버리지·확인불가 경고와 같은 6시간을 쓴다 —
 * 재시도로 달라지는 상황이 아니라 **사람이 한 번 확인하면 되는** 종류라 짧은 창은 소음만 늘린다.
 */
const PARTIAL_SETTLED_ALERT_TTL_MS = 6 * 60 * 60_000;

/**
 * 부분체결 종결을 **보이게** 만든다 (T-019 D-3).
 *
 * ## 알림 정책
 *
 * 키를 매수/매도로 **나눈다.** `sendAlertThrottled` 는 키 단위로 창을 잡으므로 한 키에
 * 묶으면 흔한 쪽(매수)이 드문 쪽(매도)을 조용히 억눌러 버린다 — T-018 H-4(B) 가 같은
 * 이유로 `order-sync:coverage` 와 `order-sync:partial-unconfirmed` 를 분리했다.
 *
 * 두 상황의 의미가 실제로 다르다:
 *  - **매수** 부분체결 = 의도한 만큼 자본이 투입되지 않았다. 손실 위험은 없다.
 *  - **매도** 부분체결 = **포지션이 다 닫히지 않았다.** 손절이었다면 보호가 절반만 걸린
 *    상태로 남는다. 확인이 필요한 쪽은 이쪽이다.
 *
 * 수준은 둘 다 `warning` 이다. 장 마감 시 브로커가 잔량을 자동 취소하는 것은 **오류가
 * 아니라 정상 동작**이고(T-018 H-4(B) 가 문구를 조정한 이유와 같다), 정상 이벤트를
 * critical 로 알리면 사람이 무시하기 시작해 알림이 있으나 마나가 된다. 창은 6시간 —
 * 부분체결 종결은 대부분 장 마감 시각에 몰리므로 하루 몇 건이 한 통으로 묶인다.
 *
 * 로그는 스로틀 없이 **매 회차** 남긴다(`ORDER_SYNC_PARTIAL_SETTLED`). 알림을 줄이는
 * 것과 기록을 줄이는 것은 다른 문제다.
 */
function reportPartialSettlements(r: OrderSyncResult): void {
  if (r.partialSettlements.length === 0) return;

  const fmt = (p: PartialSettlement): string =>
    `${p.symbol}#${p.id} ${p.side ?? '?'} ${p.filledQty}/${p.orderedQty}주`;

  console.warn(
    `[order-sync] ⚠️ ORDER_SYNC_PARTIAL_SETTLED — ${r.partialSettlements.length}건이 `
    + '부분체결 상태로 종결됐다 (잔량이 미체결 목록에서 사라짐 — 장 마감 자동취소가 정상 사유). '
    + '완전 체결로 기록하지 않고 실제 체결 수량을 executions 에 남겼다',
  );
  for (const p of r.partialSettlements) {
    console.warn(
      // note 는 미기록 사유일 수도, 기록은 됐지만 짚어야 할 사실(중복 행 탐지)일 수도 있다.
      // 기록됐다는 이유로 note 를 버리면 탐지기가 조용해진다.
      `[order-sync]   부분체결 종결 ${fmt(p)} eid=${p.exchangeOrderId} (${p.market}) `
      + `executions=${p.executionRecorded ? '기록' : '미기록'}${p.note ? ` — ${p.note}` : ''}`,
    );
  }

  const unrecorded = r.partialSettlements.filter(p => !p.executionRecorded);
  if (unrecorded.length > 0) {
    // 여기가 이 작업의 목표를 달성하지 **못한** 잔여분이다. 반드시 따로 드러낸다.
    console.warn(
      `[order-sync] ⚠️ ORDER_SYNC_PARTIAL_UNRECORDED — ${unrecorded.length}건은 실제 체결 수량을 `
      + '남기지 못해 손익 리포트가 주문 수량을 그대로 쓴다: '
      + unrecorded.map(fmt).join(', '),
    );
  }

  const sells = r.partialSettlements.filter(p => p.side === 'sell');
  const buys  = r.partialSettlements.filter(p => p.side !== 'sell');

  if (sells.length > 0) {
    sendAlertThrottled(
      'order-sync:partial-settled-sell',
      'warning',
      '매도 주문이 일부만 체결된 채 종결됐습니다',
      `${sells.length}건의 매도가 주문 수량 전부를 채우지 못하고 끝났습니다.\n`
      + `대상: ${sells.map(fmt).join(', ')}\n`
      + '잔량이 장 마감 때 브로커에서 자동 취소된 것이라면 정상 상황이며, 이 알림은 오류 통보가 '
      + '아니라 확인 요청입니다. 다만 **팔지 못한 수량만큼 포지션이 남아 있습니다** — '
      + '손절·청산 주문이었다면 남은 물량을 어떻게 할지 판단하세요. '
      + '체결된 수량은 이미 기록되어 손익에 반영됩니다.',
      PARTIAL_SETTLED_ALERT_TTL_MS,
    );
  }
  if (buys.length > 0) {
    sendAlertThrottled(
      'order-sync:partial-settled-buy',
      'warning',
      '매수 주문이 일부만 체결된 채 종결됐습니다',
      `${buys.length}건의 매수가 주문 수량 전부를 채우지 못하고 끝났습니다.\n`
      + `대상: ${buys.map(fmt).join(', ')}\n`
      + '잔량이 장 마감 때 브로커에서 자동 취소된 것이라면 정상 상황이며, 이 알림은 오류 통보가 '
      + '아니라 확인 요청입니다. 의도한 것보다 적게 매수됐으므로 목표 비중과 차이가 날 수 있습니다. '
      + '체결된 수량은 이미 기록되어 손익에 반영됩니다.',
      PARTIAL_SETTLED_ALERT_TTL_MS,
    );
  }
}

// ── 유틸 ─────────────────────────────────────────────────────────────────────

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function emptyResult(): OrderSyncResult {
  return {
    synced: 0, errors: [], skipped: 0, complete: true,
    marketsOk: [], marketsFailed: [], unreconciled: [],
    staleCount: 0, oldestUnreconciledMs: 0,
    partialSettlements: [], completenessUnverified: 0,
  };
}

/** `Number()` 로 바꾸되 비유한값은 0(="모름")으로 접는다. */
function numOrZero(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
