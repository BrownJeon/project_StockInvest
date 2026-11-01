import { randomUUID } from 'node:crypto';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getAccountId, getPool } from '@/lib/db';
import type { ExchangeId, OrderRequest, OrderResult } from '@/lib/exchanges/types';
import { withKisPriority } from '@/lib/exchanges/kis-throttle';
import { sendAlert } from '@/lib/notify';
import { type AssetClass } from './asset-profile';
import { parseBoolFlag, shouldReportUnparsable } from './flags';
import { isKillSwitchActive } from './kill-switch';
import {
  checkDailyMax,
  checkOrderMax,
  checkSymbolBlacklist,
  getEffectiveDailyMax,
  getEffectiveOrderMax,
  resolveOrderAmountKRW,
  resolveOrderAmountKRWAsync,
} from './order-limits';
import { describeValidationBlock, evaluateValidationGate, normalizeOrderSide, type ValidationGateVerdict } from './validation-gate';
import { checkVolatilityGuard } from './volatility-guard';

/**
 * DB system_config override takes precedence over env var.
 *
 * **fail-safe (Phase 0, 2026-08-02)**: DRY_RUN 은 "실거래 차단" 스위치이므로 애매하면 ON.
 * 이전에는 `val === true || val === 'true'` 만 인정해서 `1` · `"1"` · `"ON"` 같은 값이
 * 조용히 false(=실거래)로 해석되는 fail-open 여지가 있었다.
 *
 *  - 미설정(DB 키 부재 + env 미설정) → `true` (ON, 안전 기본값)
 *  - 정상 인식                        → 그 값. 끄려면 명시적 false(false/"false"/0/"off"...)
 *  - **해석 불가(오타 등)**           → `true` + console.error 경고 (조용히 넘어가지 않는다)
 */
export async function isDryRun(): Promise<boolean> {
  try {
    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & { value: string })[]>(
      'SELECT value FROM system_config WHERE `key` = ? LIMIT 1',
      ['safety_dry_run'],
    );
    if (rows.length > 0) {
      const r = parseBoolFlag(JSON.parse(rows[0].value));
      if (r.state === 'parsed') return r.value;
      if (r.state === 'unparsable') {
        if (shouldReportUnparsable('safety_dry_run', r.raw)) {
          console.error(
            `[safety] system_config.safety_dry_run 값을 해석할 수 없음(${JSON.stringify(r.raw)}) ` +
            '→ 안전을 위해 DRY_RUN ON 으로 처리. 설정 > 안전장치에서 값을 바로잡아라.',
          );
        }
        return true;
      }
      // unset — env 폴백으로 진행
    }
  } catch {
    // DB unavailable — fall through to env
  }

  const e = parseBoolFlag(process.env.DRY_RUN);
  if (e.state === 'parsed') return e.value;
  if (e.state === 'unparsable') {
    if (shouldReportUnparsable('env.DRY_RUN', e.raw)) {
      console.error(
        `[safety] 환경변수 DRY_RUN 값을 해석할 수 없음(${JSON.stringify(e.raw)}) ` +
        '→ 안전을 위해 DRY_RUN ON 으로 처리.',
      );
    }
    return true;
  }
  return true;  // unset — 안전 기본값 ON
}

/**
 * T-072 — 주문의 **전략 귀속**. 검증 상태 관문(G6)이 이 값으로 판정한다.
 * `OrderRequest` 에는 전략 ID 가 없으므로(`types.ts`) 호출부가 여기로 넘긴다. `source` 는 클라이언트가 고를 수 있는 값이라
 * (`orders/route.ts`) 판정 근거로 쓰지 않는다.
 */
export interface OrderAttribution {
  kind: 'strategy';
  /** null = 전략 귀속 없음 → 매수 차단 */
  strategyId: string | null;
  signalId: number | null;
}

/** 귀속 미지정 = 전략 없음으로 취급한다(fail-closed, 설계 F-1). */
const UNATTRIBUTED: OrderAttribution = { kind: 'strategy', strategyId: null, signalId: null };

interface SubmitOptions {
  assetClass?: AssetClass;
  source?: 'manual' | 'signal' | 'auto';
  clientOrderId?: string;
  /** T-072 — 미지정이면 `{ kind:'strategy', strategyId:null }` 로 취급 → **매수 차단**. 매도에는 영향 없음. */
  attribution?: OrderAttribution;
}

/**
 * 모든 주문 송신은 이 래퍼를 통과해야 한다.
 * 순서:
 *  0. T-072 WP-2d — `side` 정규화(trim·소문자). 정확히 buy/sell 이면 그 값으로 `req` 를 바꿔 **이후 모든 단계와 어댑터에 정확한 값만** 넘긴다.
 *     그 밖의 값은 orders 행·거래소 호출 없이 `blocked(invalid_side)` 로 끝낸다(trade_logs `blocked` + 경고 알림)
 *  1. 멱등성 key 확정
 *  2. orders INSERT (status=pending)
 *  3. Kill Switch
 *  4. 심볼 화이트리스트
 *  5. 단계별 1회 한도
 *  6. 일일 누적 한도 (2에서 얻은 자기 orderId 만 합산에서 제외 — 다른 주문의 pending 은 합산, T-081 WP-B)
 *  6c. T-072 검증 상태 관문(G6) — 매수만. 미검증·미등록·귀속 없음·조회 실패 → blocked(validation_gate). DRY_RUN 과 무관(F-4)
 *  7. DRY_RUN: 실제 송신 생략 → status=dry_run
 *  8. 실 송신 → status=accepted (상세 상태는 거래소 응답에 따라 후속 업데이트).
 *      `realSubmit` 직전에 **킬스위치(3)와 검증 관문(6c)을 각각 한 번 더** 본다 — T-141·T-072 F-15.
 *      이유: 3~6 사이에 `await` 가 여러 번 들어가고 **5~6 한도 산정이 KIS 를 타기 때문**에(토큰 획득)
 *      그 구간이 길어질 수 있다. 그동안 내려간 킬스위치·강등된 전략을 놓치지 않는다.
 * 각 단계에서 발생 이벤트는 trade_logs에 기록.
 */
/**
 * 💰 T-017 — **주문 제출 전 구간을 KIS 유량 `critical` lane 으로 실행한다.**
 *
 * 왜 `realSubmit` 만이 아니라 함수 전체인가: 주문이 나가기까지 KIS 를 두 번 탄다.
 *   ① 5~6단계 한도 산정 — `getEffectiveOrderMax/DailyMax` → `portfolio-total` → **잔고+시세 조회**
 *   ② 8단계 실 송신 — `realSubmit` (= `kis.createOrder`)
 * ①이 대량 스캔 뒤에 줄 서면 주문 자체가 그만큼 늦어진다. 즉 **주문을 게이팅하는 잔고 조회도
 * 주문의 일부**이므로 같은 lane 에 둔다. 실행 컨텍스트(`AsyncLocalStorage`)로 전달되므로
 * 중간 계층에 인자를 뚫지 않아도 하위 KIS 호출 전부가 자동으로 상속받는다.
 *
 * 면제(exempt)가 아니라 **최우선 순위**를 준 이유: 면제는 유량 상한 자체를 벗어나는 것이라
 * 레이트리밋을 다시 유발할 수 있다. 주문은 빈도가 낮아(하루 수십 건) 우선순위만으로도
 * 사실상 즉시 통과하며, 그러면서도 전체 유량 상한은 지켜진다.
 */
export async function submitOrder(
  req: OrderRequest,
  realSubmit: (req: OrderRequest) => Promise<OrderResult>,
  options: SubmitOptions = {},
): Promise<OrderResult & { orderId?: number; clientOrderId?: string }> {
  return withKisPriority('critical', () => submitOrderInner(req, realSubmit, options));
}

async function submitOrderInner(
  rawReq: OrderRequest,
  realSubmit: (req: OrderRequest) => Promise<OrderResult>,
  options: SubmitOptions = {},
): Promise<OrderResult & { orderId?: number; clientOrderId?: string }> {
  // 0. 🔴 T-072 WP-2d — 방향 정규화(가장 이른 지점: orders INSERT·한도·관문·어댑터 전). 어댑터는 `req.side === 'buy'` 일 때만 매수 TR 을
  //    고르므로 `'BUY'`·`'buy '` 가 원문 그대로 내려가면 **매도 TR** 로 나갔다(Reviewer 2차 항목 6 — 검증된 전략 귀속이면 G6 를 통과했다).
  //    `'SELL'`·`' sell '` 은 정상 매도로 정규화돼 매도 한도 면제(`!== 'sell'`)도 제대로 받는다. 이 아래의 `req` 는 전부 정규화된 값이다.
  const clientOrderId = options.clientOrderId ?? `co-${randomUUID()}`;
  const side = normalizeOrderSide(rawReq.side);
  if (side === null) return rejectInvalidSide(rawReq, clientOrderId);
  const req: OrderRequest = side === rawReq.side ? rawReq : { ...rawReq, side };

  const assetClass: AssetClass = options.assetClass ?? 'stock';
  const source = options.source ?? 'manual';

  const pool = getPool();
  const accountId = await getAccountIdSafe(req.exchange);
  const { getMarketFromSymbol } = await import('@/lib/exchanges/kis-symbols');
  const market = req.market ?? getMarketFromSymbol(req.symbol);
  const amountKRW = await resolveOrderAmountKRWAsync(req);

  // 2. orders 행 생성 (pending) — market 컬럼 채움
  const [ins] = await pool.query<ResultSetHeader>(
    `INSERT INTO orders
     (account_id, client_order_id, asset_class, symbol, side, type,
      price, quantity, amount_krw, status, source, market)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [
      accountId, clientOrderId, assetClass,
      req.symbol, req.side, req.type,
      req.price ?? null, req.quantity ?? null,
      amountKRW > 0 ? amountKRW : null,
      source, market,
    ],
  );
  const orderId = ins.insertId;
  // T-042 — 거래소로 송신을 시작했는가. 이 이후의 어떤 예외도 "주문이 나갔을 수 있다"이므로 `outcomeUnknown` 이다.
  // (송신 성공 뒤 `accepted` UPDATE 가 실패하고 안쪽 catch 의 `failed` UPDATE 까지 던지면 예외가 *바깥* catch 로 올라간다 —
  //  그 catch 는 원래 "송신 전 예외"만 가정하고 있었다. 2라운드 감사 R2-2.)
  let sendReached = false;
  await auditLog(orderId, 'submit_attempt', { req, assetClass, source });

  try {
  // 3. Kill Switch
  if (await isKillSwitchActive()) {
    await markBlocked(orderId, 'kill_switch');
    return { ok: false, orderId, clientOrderId, blockedBy: 'kill_switch', error: 'KILL_SWITCH_ACTIVE' };
  }

  // 4. 심볼 화이트리스트 + 블랙리스트 (시장별)
  const sym = await checkSymbolBlacklist(req.symbol, req.exchange, market);
  if (!sym.ok) {
    await markBlocked(orderId, 'symbol_not_allowed', sym.detail);
    return { ok: false, orderId, clientOrderId, blockedBy: 'symbol_not_allowed', error: sym.detail };
  }

  // 5~6. 시장별 한도 (DB → env 폴백)
  const [effOrderMax, effDailyMax] = await Promise.all([
    getEffectiveOrderMax(req.exchange, market),
    getEffectiveDailyMax(req.exchange, market),
  ]);

  // sell은 포지션 청산이므로 1회 한도 제외 (변동폭 가드와 동일 원칙)
  // checkOrderMax는 sync resolveOrderAmountKRW 사용 — USD 주문은 amountKRW를 미리 채워서 전달
  const reqWithKrw: typeof req = (market === 'overseas' && (req.amountKRW == null || req.amountKRW <= 0))
    ? { ...req, amountKRW }
    : req;
  if (req.side !== 'sell') {
    const one = checkOrderMax(reqWithKrw, effOrderMax);
    if (!one.ok) {
      await markBlocked(orderId, one.reason ?? 'order_limit', one.detail);
      return { ok: false, orderId, clientOrderId, blockedBy: one.reason, error: one.detail };
    }
  }

  // sell은 포지션 청산이므로 일일 누적 한도도 제외 — 1회 한도·변동성 가드와 동일 원칙.
  // 이전: sell이 daily_limit에 걸려 청산 차단됨 (변동장 손절 불가 위험). 정책 일관성 회복.
  // T-081 WP-B — 자기 `pending` 행(orderId)만 합산에서 뺀다. 다른 주문의 `pending`(송신 중)은 합산 → 동시 매수 경합 차단.
  if (req.side !== 'sell') {
    const daily = await checkDailyMax(reqWithKrw, effDailyMax, orderId);
    if (!daily.ok) {
      await markBlocked(orderId, daily.reason ?? 'daily_limit', daily.detail);
      return { ok: false, orderId, clientOrderId, blockedBy: daily.reason, error: daily.detail };
    }
  }

  // 6b. 변동폭 가드 — 매도는 하락 시 청산 목적이므로 제외
  if (req.side !== 'sell') {
    const volCheck = await checkVolatilityGuard(req.symbol);
    if (!volCheck.ok) {
      const reason = volCheck.level === 'panic' ? 'vol_panic' : 'vol_block';
      await markBlocked(orderId, reason, volCheck.detail);
      return { ok: false, orderId, clientOrderId, blockedBy: 'order_limit', error: volCheck.detail };
    }
  }

  // 6c. 🔴 T-072 G6 — 검증 상태 관문(최후 방어선). 킬스위치·블랙리스트·한도·변동성 **뒤**, DRY_RUN 분기 **앞**(F-15·F-4).
  //     side 판정은 관문 함수의 첫 줄이다 — 매도는 strategies 를 조회하지 않고 그대로 통과한다(I/O 0).
  //     앞단 관문(G1~G5)이 있으면 평소 0건이어야 하므로 `markBlocked` 의 스로틀 없는 경고 알림을 그대로 둔다(F-12: 발동 = 우회 버그 신호).
  const attribution = options.attribution ?? UNATTRIBUTED;
  const vg = await evaluateValidationGate({ side: req.side, strategyId: attributedStrategyId(attribution) });
  if (!vg.allowed) {
    const detail = validationBlockDetail(vg, attribution, 'pre_dry_run');
    await markBlocked(orderId, 'validation_gate', detail);
    return { ok: false, orderId, clientOrderId, blockedBy: 'validation_gate', error: `validation_gate: ${detail}` };
  }

  // 7. DRY_RUN
  if (await isDryRun()) {
    await pool.query(`UPDATE orders SET status='dry_run' WHERE id=?`, [orderId]);
    // Phase 0: effOrderMax/effDailyMax 는 항상 유한값 (미설정 시 0). Infinity 분기 제거.
    await auditLog(orderId, 'dry_run', { effOrderMax, effDailyMax });
    return { ok: true, orderId, clientOrderId, dryRun: true, blockedBy: 'dry_run' };
  }

  // 8a-0. 🔴 T-141 — **킬스위치 송신 직전 재확인.** 3단계에서 한 번 보고 여기까지 오는 사이에 `await` 가 여러 번
  //     들어가는데, 그중 **5~6단계 한도 산정이 KIS 를 탄다**(잔고+시세 → 토큰 획득). 토큰이 죽어 있으면 그 획득이
  //     길어질 수 있고(T-138 QA F-1: 실측 94.8초·이론 약 180초), 그동안 사용자가 킬스위치를 내려도 **이미 3단계를
  //     지난 주문은 그대로 나갔다.** 킬스위치는 사용자의 비상 제동이므로 그 지연을 받아들일 수 없다.
  //
  //     검증 관문 재확인(아래 8a)보다 **먼저** 본다 — 킬스위치가 주 제동이고, 차단 사유도 그쪽이 더 정확하다
  //     (`blocked_by` 가 알림 등급을 가른다: `kill_switch`=critical, `validation_gate`=warning).
  //     차단 모양은 3단계와 동일하다(`kill_switch`). 여기서는 PK 조회 1회뿐이다.
  //
  //     ⚠ **틈을 전부 닫지는 못한다**(T-141 감사 F-1 — 처음 「닫는다」고 적었는데 부분 해소다).
  //     `getMarketTotal` 은 60초 메모리 캐시가 있어(`portfolio-total.ts`) 적중하면 **5~6단계가 KIS 를 타지
  //     않는다.** 그러면 토큰 대기가 `realSubmit` 안으로 옮겨가 **이 재확인 뒤에** 남는다. 그 캐시는 전략
  //     사이징·승인 문맥·헬스가 주문 직전에 채워 두므로 자동 주문 흐름에서 적중이 적지 않을 것이다.
  //     여기서 토큰을 미리 확보해 흡수하는 방법은 **쓰지 않았다** — 이 파일이 KIS 에 직접 묶이고 기존
  //     안전장치 시험 수십 개가 토큰 경로를 타게 된다. 진짜 해결은 대기 자체를 없애는 것이다
  //     (T-138 후속 1 serve-stale: 감사자 하네스에서 모든 시나리오 0초·0실패).
  if (await isKillSwitchActive()) {
    await markBlocked(orderId, 'kill_switch');
    return { ok: false, orderId, clientOrderId, blockedBy: 'kill_switch', error: 'KILL_SWITCH_ACTIVE' };
  }

  // 8a. 🔴 T-072 F-15 — 송신 **직전** 재검증. 6c 와 여기 사이에 DRY_RUN 조회 등 await 가 끼어 있으므로 그 사이 강등(사용자 SQL)을
  //     놓치지 않게 PK 조회 1회로 다시 본다. 실패·미검증이면 송신하지 않는다(fail-closed). 매도는 I/O 0.
  const vgSend = await evaluateValidationGate({ side: req.side, strategyId: attributedStrategyId(attribution) });
  if (!vgSend.allowed) {
    const detail = validationBlockDetail(vgSend, attribution, 'pre_send');
    await markBlocked(orderId, 'validation_gate', detail);
    return { ok: false, orderId, clientOrderId, blockedBy: 'validation_gate', error: `validation_gate: ${detail}` };
  }

  // 8. 실 송신
  try {
    sendReached = true;
    const result = await realSubmit(req);
    // T-042 — 거래소가 5xx 를 돌려줬거나 연결이 끊긴 경우 주문이 접수됐는지 알 수 없다(KIS 가 처리한 뒤 응답만 잃을 수 있다).
    let outcomeUnknown = false;
    if (result.ok) {
      await pool.query(
        `UPDATE orders SET status='accepted', exchange_order_id=? WHERE id=?`,
        [result.exchangeOrderId ?? null, orderId],
      );
      await auditLog(orderId, 'accepted', result);
    } else {
      // KIS createOrder 응답에 blockedBy 필드 없음 → error 메시지에서 카테고리 자동 분류.
      // raw error 는 trade_logs(audit) 에 보존, blocked_by 컬럼엔 짧은 카테고리만.
      const blockedBy = result.blockedBy ?? categorizeRejectReason(result.error);
      outcomeUnknown = blockedBy === 'kis_5xx' || blockedBy === 'network_error';
      await pool.query(
        `UPDATE orders SET status='rejected', blocked_by=? WHERE id=?`,
        [blockedBy, orderId],
      );
      await auditLog(orderId, 'rejected', result);
    }
    return { ...result, orderId, clientOrderId, ...(outcomeUnknown ? { outcomeUnknown: true } : {}) };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await pool.query(`UPDATE orders SET status='failed' WHERE id=?`, [orderId]);
    await auditLog(orderId, 'error', { error });
    // T-042 — 송신 단계의 예외는 거래소가 주문을 받은 뒤(예: 접수 직후 orders UPDATE 실패)에도 날 수 있다 → 결과 불명.
    return { ok: false, orderId, clientOrderId, error, outcomeUnknown: true };
  }

  } catch (e) {
    // step 3~7 사이 예외 — pending 상태로 남지 않도록 failed 처리
    const error = e instanceof Error ? e.message : String(e);
    await pool.query(`UPDATE orders SET status='failed' WHERE id=?`, [orderId]).catch(() => {});
    await auditLog(orderId, 'error', { error, phase: sendReached ? 'post_send' : 'safety_check' });
    // 송신 전 예외는 확정 실패(거래소에 나가지 않았다). 송신 시작 후라면 결과 불명 — 호출처가 재시도하면 이중 주문이 될 수 있다.
    return sendReached
      ? { ok: false, orderId, clientOrderId, error, outcomeUnknown: true }
      : { ok: false, orderId, clientOrderId, error };
  }
}

/**
 * KIS rejected 응답의 error 메시지를 짧은 카테고리로 분류 (orders.blocked_by 저장용).
 *
 * KIS API msg1 패턴 (한국어) 기반. 매칭 안 되면 'kis_rejected'.
 * raw error 는 trade_logs(audit) 에 그대로 보존되므로 카테고리는 추적·통계용.
 *
 * varchar(64) 컬럼 가정 — 키워드는 32자 이내 ASCII.
 */
export function categorizeRejectReason(error: string | null | undefined): string {
  if (!error) return 'kis_rejected';
  const e = String(error);

  if (/HTTP\s+5\d\d/i.test(e))                                       return 'kis_5xx';
  if (/HTTP\s+4\d\d/i.test(e))                                       return 'kis_4xx';
  if (/EGW00201|초당\s*거래건수|rate.?limit/i.test(e))               return 'rate_limit';
  if (/EGW00133|EGW00123|토큰|token/i.test(e))                       return 'kis_token';
  if (/주문가능금액|잔고\s*부족|insufficient/i.test(e))               return 'insufficient_balance';
  if (/주문가능수량|보유.*수량/i.test(e))                              return 'insufficient_qty';
  if (/호가단위|tick.?size|가격대비/i.test(e))                        return 'price_unit';
  if (/장.*마감|시간.*외|장종료|market.?closed/i.test(e))             return 'market_closed';
  if (/주문가능시간|주문.*시간/i.test(e))                              return 'time_restriction';
  if (/거래정지|관리종목|trading.?halt/i.test(e))                     return 'trading_halt';
  if (/단일가|예상체결|동시호가/i.test(e))                             return 'auction_phase';
  // T-027 — 타입 결함(비-number)과 사이징 결과 0은 원인도 조치도 다르므로 분리해서 남긴다.
  if (/(quantity|price)\s*타입\s*오류/i.test(e))                      return 'bad_number_field';
  if (/quantity\s*계산\s*실패|quantity\s*<=\s*0/i.test(e))           return 'qty_calc_failed';
  if (/timeout|aborted|ETIMEDOUT|ECONNRESET|fetch failed/i.test(e))   return 'network_error';
  return 'kis_rejected';
}

/**
 * T-072 WP-2d — 정규화해도 buy/sell 이 아닌 주문. **orders 행을 만들지 않는다**(orders.side ENUM 이 그 값을 STRICT 로 거부해 예외가 나던
 * 기존 동작 대신 명시적 차단 결과로 일관화). 거래소 호출 0. 감사 원칙 3 은 trade_logs(order_id NULL) `blocked` 로 지킨다. 입구 검증이
 * 있으면 평소 0건이어야 하므로 경고 알림을 보낸다(발동 = 호출부 결함 신호). 원문 값은 알림 본문이 아니라 trade_logs 에만 남긴다. 던지지 않는다.
 */
async function rejectInvalidSide(
  raw: OrderRequest,
  clientOrderId: string,
): Promise<OrderResult & { orderId?: number; clientOrderId?: string }> {
  let shown: string;
  try { shown = String(JSON.stringify(raw.side) ?? String(raw.side)).slice(0, 40); } catch { shown = '(표시 불가)'; }
  await auditLog(null, 'blocked', { reason: 'invalid_side', side: shown, symbol: raw.symbol, type: raw.type, clientOrderId });
  try {
    sendAlert('warning', '주문 차단: invalid_side', '주문 방향 값이 buy/sell 이 아니어서 거래소로 보내지 않았습니다 (trade_logs 의 blocked·invalid_side 확인)');
  } catch { /* 알림 실패가 결과를 바꾸지 않는다 */ }
  return { ok: false, clientOrderId, blockedBy: 'invalid_side', error: 'invalid_side: 주문 방향이 buy/sell 이 아님 — 송신하지 않음' };
}

/** 귀속이 `strategy` 가 아니면(런타임 오용) 전략 없음으로 본다 — fail-closed. */
function attributedStrategyId(a: OrderAttribution): string | null {
  return a && a.kind === 'strategy' ? a.strategyId : null;
}

function validationBlockDetail(
  v: Extract<ValidationGateVerdict, { allowed: false }>,
  a: OrderAttribution,
  phase: 'pre_dry_run' | 'pre_send',
): string {
  return `${describeValidationBlock(v)} · reason=${v.reason} · signal=${a?.signalId ?? '-'} · phase=${phase}`;
}

async function markBlocked(orderId: number, reason: string, detail?: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE orders SET status='blocked', blocked_by=? WHERE id=?`,
    [reason, orderId],
  );
  await auditLog(orderId, 'blocked', { reason, detail });

  const isUrgent = reason === 'kill_switch' || reason === 'vol_panic';
  sendAlert(
    isUrgent ? 'critical' : 'warning',
    `주문 차단: ${reason}`,
    `주문 #${orderId} · ${detail ?? reason}`,
  );
}

async function auditLog(orderId: number | null, event: string, payload: unknown): Promise<void> {
  try {
    const pool = getPool();
    await pool.query(
      `INSERT INTO trade_logs (order_id, event, payload) VALUES (?, ?, ?)`,
      [orderId, event, JSON.stringify(payload)],
    );
  } catch (e) {
    console.error('[safety] trade_logs write failed:', e);
  }
}

async function getAccountIdSafe(exchange: ExchangeId): Promise<number> {
  try {
    return await getAccountId(exchange);
  } catch {
    return getAccountId('kis');
  }
}
