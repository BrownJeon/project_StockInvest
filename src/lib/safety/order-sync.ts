import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import {
  getActiveOrdersDetailed, getCompletedOrders, overseasActiveOrderExchanges,
} from '@/lib/exchanges/kis';
import { getMarketFromSymbol, isOverseasSymbol, parseOverseas, type Market } from '@/lib/exchanges/kis-symbols';
import { submittedQuantity } from '@/lib/exchanges/order-quantity';
import { sendAlertThrottled } from '@/lib/notify/throttle';

interface PendingOrder extends RowDataPacket {
  id: number;
  exchange_order_id: string | null;
  symbol: string;
  type: string;
  status: string;
  quantity: string | number | null;
  created_at: Date;
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
 * | 미체결 목록 신뢰 가능 + 그 안에 **없다** | `filled` | 신뢰할 수 있는 부재 |
 * | 미체결 목록 신뢰 불가 + 체결수량 ≥ 주문수량 | `filled` | **수량이라는 양성 증거** — 부재 추론이 필요 없다 |
 * | 미체결 목록 신뢰 불가 + 그 외 | `partially_filled` | 완결을 단정하지 않는다. 비종결 상태라 다음 회차에 스스로 교정된다 |
 * | `market` 주문 | `filled` | 미체결 목록에 **원래** 나타나지 않으므로 그 부재는 아무 정보도 아니다 |
 *
 * `filled` 를 잘못 쓰면 "포지션이 닫혔다"고 알리는 것이라 중복 진입으로 이어진다.
 * `partially_filled` 를 잘못 쓰면 다음 회차에 교정된다. **오류의 비용이 비대칭**이므로
 * 불확실할 때는 `partially_filled` 쪽으로 기운다.
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
    `SELECT id, exchange_order_id, symbol, type, status, quantity, created_at
     FROM orders
     WHERE status IN ('pending','accepted','partially_filled')
       AND exchange_order_id IS NOT NULL`,
  );

  if (rows.length === 0) {
    // "판정할 게 없었다" — 판정 실패와 명확히 다른 상태다.
    pruneTracker(new Set());
    return emptyResult();
  }

  const now = Date.now();
  const graceMs = await cancelGraceMs(pool);
  let synced = 0;
  const errors: string[] = [];
  const unreconciled: UnreconciledOrder[] = [];
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
     * 주문번호 → 체결 수량. **합이 아니라 최대값**을 쓴다.
     *
     * KIS 국내(`tot_ccld_qty`)는 주문당 **누적** 수량이라 여러 행을 더하면 중복 계산이 되고,
     * 그러면 실제로는 부분체결인 주문을 `filled` 로 단정하게 된다. 최대값은 두 표현(누적/개별)
     * 모두에서 **과대평가하지 않는** 값이라, 틀리더라도 항상 보수적인 쪽(`partially_filled`)으로
     * 틀린다.
     */
    const filledQty = new Map<string, number>();
    let completedOk = true;
    let completedErr = '';
    try {
      const completed = await getCompletedOrders(symbol, fromTs, toTs, 100);
      completedOrderIds = new Set(completed.map(o => o.orderId));
      for (const c of completed) {
        const q = Number(c.qty);
        if (Number.isFinite(q)) filledQty.set(c.orderId, Math.max(filledQty.get(c.orderId) ?? 0, q));
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
          const next = settledStatus(order, market, eid, filledQty.get(eid), activeReliable, activeOrderIds);
          // 이미 그 상태면 쓰지 않는다 — `partially_filled` 는 비종결 상태라 다음 회차에도
          // 다시 여기 오므로, 무조건 쓰면 매 회차 UPDATE 가 나가고 `synced` 가 부풀려진다.
          if (next !== order.status) {
            await pool.query(SET_STATUS_SQL[next], [order.id]);
            synced++;
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
  };

  reportUnreconciled(result);
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
 * 체결 목록에 나타난 주문의 최종 상태. 규칙표는 함수 상단 §부분체결 참조.
 *
 * 핵심: **"일부 체결됐다"는 존재로 증명되지만 "전량 체결됐다"는 잔량의 부재로만 증명된다.**
 * 그래서 잔량 판단의 근거가 없으면 `filled` 로 단정하지 않는다.
 */
function settledStatus(
  order: PendingOrder,
  market: Market,
  eid: string,
  filledQty: number | undefined,
  activeReliable: boolean,
  activeOrderIds: Set<string>,
): 'filled' | 'partially_filled' {
  // market 주문은 미체결 목록에 원래 나타나지 않는다 — 그 부재는 아무 정보도 아니므로
  // 부분체결 추론의 근거가 될 수 없다. 기존 동작(체결 목록에 있으면 filled)을 유지한다.
  if (order.type === 'market') return 'filled';

  if (activeReliable) {
    // 두 목록에 동시에 있다 = 일부 체결 + 잔량이 아직 브로커에서 작동 중
    return activeOrderIds.has(eid) ? 'partially_filled' : 'filled';
  }

  // 미체결 목록을 신뢰할 수 없다(조회 실패 또는 커버리지 밖).
  // 다만 **체결 수량**은 부재 추론 없이 완결을 직접 증명할 수 있는 양성 증거다.
  // 이 경로가 없으면 커버리지 밖(NYS/AMS) 주문이 영원히 `partially_filled` 로 남는다.
  //
  // 🔴 H-4 — 비교 대상은 `orders.quantity` 가 **아니라** 브로커가 실제로 받은 수량이다.
  // DB 는 자르지 않은 원본(예: 1.7)을 갖고 있고 해외 주문은 잘린 값(1)으로 나간다.
  // 원본과 비교하면 부등식이 영원히 성립하지 않아 완전 체결된 주문이 갇힌다.
  // 자르는 규칙은 송신 경로와 **같은 함수**를 쓴다 — 재유도하면 버그가 자리만 옮긴다.
  const ordered = submittedQuantity(market, Number(order.quantity));
  if (ordered > 0 && filledQty !== undefined && filledQty >= ordered) {
    return 'filled';
  }
  return 'partially_filled';
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
function reportUnreconciled(r: OrderSyncResult): void {
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
      && u.reason !== 'too_fresh'          // 시계에 오르지 않으므로 원래 걸릴 수 없지만, 의도를 명시한다
      && u.reason !== 'partial_fill_unconfirmable'   // 체결 사실은 기록됐다 — 긴급도가 다르다
      && u.unreconciledForMs >= STALE_MS,
  );
  if (staleFailures.length > 0) {
    sendAlertThrottled(
      'order-sync:stale',
      'critical',
      '주문 상태 확인 불가가 지속되고 있습니다',
      `${staleFailures.length}건의 주문 상태를 ${Math.floor(STALE_MS / 60_000)}분 넘게 확인하지 못했습니다 `
      + `(최장 ${oldestMin}분).\n`
      + `실패 시장: ${r.marketsFailed.map(f => `${f.market}(${f.error})`).join(', ') || '-'}\n`
      + `대상: ${staleFailures.map(u => `${u.symbol}#${u.id}`).join(', ')}\n`
      + '이 주문들은 브로커에 살아 있을 수 있어 취소로 처리하지 않았습니다. '
      + 'KIS 조회 실패(레이트리밋·토큰·네트워크)를 확인하세요.',
      STALE_ALERT_TTL_MS,
    );
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

// ── 유틸 ─────────────────────────────────────────────────────────────────────

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function emptyResult(): OrderSyncResult {
  return {
    synced: 0, errors: [], skipped: 0, complete: true,
    marketsOk: [], marketsFailed: [], unreconciled: [],
    staleCount: 0, oldestUnreconciledMs: 0,
  };
}
