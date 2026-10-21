import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { kis } from '@/lib/exchanges/kis';
import type { Market } from '@/lib/exchanges/kis-symbols';
import { submittedQuantity } from '@/lib/exchanges/order-quantity';
import type { OrderRequest } from '@/lib/exchanges/types';
import { getSymbolLabel, sendAlert } from '@/lib/notify';
import { escapeAlertText } from '@/lib/notify/escape';
import { sendAlertThrottled } from '@/lib/notify/throttle';
import { submitOrder } from '@/lib/safety/dry-run';
import { checkSymbolBlacklist } from '@/lib/safety/order-limits';
import {
  type RouterConfig,
  type SignalInput,
  getEngineSwitches,
  getRouterConfig,
  routeSignal,
} from './router';
import {
  AWAITING_APPROVAL_STATUSES,
  type SignalStatus,
  isAwaitingApproval,
  sqlStatusList,
} from './statuses';
import { buildScenarioFromAiResult } from './scenario-builder';
import {
  claimAwaitingSignal,
  rejectAwaitingSignal,
  releaseClaim,
} from './approval-transitions';
import { getStyleConfig } from '@/lib/strategy/style';
import { evaluateSignalCashGate, observeSignalCashGate } from './signal-cash-gate';

/** safety_limit_chase_disabled = true 면 chasePct 0 강제 (즉시 무력화 스위치). */
async function getEffectiveChasePct(stylePct: number): Promise<number> {
  try {
    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & { value: string })[]>(
      'SELECT value FROM system_config WHERE `key` = ? LIMIT 1',
      ['safety_limit_chase_disabled'],
    );
    if (rows.length > 0) {
      const val = JSON.parse(rows[0].value);
      if (val === true || val === 'true') return 0;
    }
  } catch { /* ignore */ }
  return stylePct;
}

function fmtNum(n: number): string {
  return Math.round(n).toLocaleString('ko-KR');
}

// ─── 시그널 알람 on/off 캐시 (30초 TTL) ──────────────────────────────────────
type NotifyFlagCache = { autoSubmit: boolean; pending: boolean; ts: number };
let notifyFlagCache: NotifyFlagCache | null = null;
const NOTIFY_FLAG_TTL_MS = 30_000;

async function getSignalNotifyFlags(): Promise<{ autoSubmit: boolean; pending: boolean }> {
  if (notifyFlagCache && Date.now() - notifyFlagCache.ts < NOTIFY_FLAG_TTL_MS) {
    return { autoSubmit: notifyFlagCache.autoSubmit, pending: notifyFlagCache.pending };
  }
  let autoSubmit = true, pending = true;
  try {
    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & { key: string; value: string })[]>(
      "SELECT `key`, value FROM system_config WHERE `key` IN ('notify_signal_auto_submit','notify_signal_pending')",
    );
    for (const r of rows) {
      try {
        const v = JSON.parse(r.value);
        if (r.key === 'notify_signal_auto_submit') autoSubmit = Boolean(v);
        if (r.key === 'notify_signal_pending')     pending    = Boolean(v);
      } catch { /* ignore */ }
    }
  } catch { /* DB 실패 시 기본 true 유지 */ }
  notifyFlagCache = { autoSubmit, pending, ts: Date.now() };
  return { autoSubmit, pending };
}

export interface SignalRow {
  id: number;
  strategy_id: string | null;
  symbol: string;
  side: 'buy' | 'sell';
  order_type: 'limit' | 'market';
  price: string | null;
  quantity: string | null;
  amount_krw: string;
  reasoning: string | null;
  indicators: unknown;
  status: SignalStatus;
  expires_at: Date | null;
  consumed_order_id: number | null;
  created_at: Date;
  updated_at: Date;
}

/** 관측 게이트 분류용 기계 판독 코드. `error`는 사람이 읽는 상세 메시지라 문자열이 가변적이다. */
export type CreateSignalErrorCode =
  | 'symbol_blacklisted'
  | 'duplicate_active_signal'
  /** T-020 — 사이징 결과가 1주 미만이라 주문이 성립하지 않는다 */
  | 'quantity_below_min'
  /** T-042 — 승인은 됐지만 안전층·거래소가 주문을 받지 않았다(킬스위치·한도·잔고 부족 등). 시그널은 대기로 남는다 */
  | 'order_not_accepted'
  /** T-042 — 주문이 거래소에 접수됐는지 알 수 없다(송신 중 예외·5xx·연결 끊김). 재시도하면 이중 주문이 될 수 있어 시그널을 `executing` 으로 잠가 둔다 */
  | 'order_uncertain'
  /**
   * T-058 — 매수인데 실시간 가용 현금이 사이징된 주문 전체 비용(수량 × 지정가 × 1.002)에 못 미쳐 **시그널을 만들지 않았다**(행·RAG·알림 없음, `signalId` 0).
   * 오류가 아니라 정책 건너뜀이다 — 호출부는 경보·재시도 대상으로 다루지 않는다.
   */
  | 'insufficient_cash';

/**
 * `trade_logs.event` 는 **varchar(32)** 이고 운영 DB 는 STRICT 모드다 — 33자가 되면 INSERT 가 실패한다.
 * 이 INSERT 들은 감사 보조라 `.catch` 로 삼키기 때문에 **초과해도 아무 데도 안 남고 아무도 모른다**(T-042 감사 D-2).
 * 이름을 바꿀 때는 `service.test.ts` 가 길이 ≤ 32 를 단언한다.
 */
export const TRADE_LOG_EVENTS = {
  approveOrderRejected: 'signal_approve_order_rejected',    // 29자
  approveOrderUncertain: 'signal_approve_order_uncertain',  // 30자
} as const;

export interface CreateSignalResult {
  ok: boolean;
  signalId: number;
  autoSubmitted: boolean;
  orderId?: number;
  orderResult?: unknown;
  error?: string;
  errorCode?: CreateSignalErrorCode;
}

/**
 * 사이징 결과 (T-020).
 *
 * `quantity` 의 세 값이 **서로 다른 의미**다 — 뭉개면 "0주 주문"과 "수량 미지정"을
 * 구분할 수 없어진다:
 *
 * | 값 | 의미 |
 * |---|---|
 * | `undefined` | 여기서 수량을 확정하지 않는다. 어댑터가 금액에서 파생한다(이미 정수) |
 * | `0` | **주문이 성립하지 않는다** — 1주도 살 수 없다. 송신하면 안 된다 |
 * | `> 0` | 브로커에 그대로 나갈 정수 주식 수 |
 */
export interface SizedQuantity {
  quantity: number | undefined;
  /** 정수화 이전 값. 로그·집계에서 "얼마가 잘렸는가"를 설명하는 데 쓴다 */
  raw: number | undefined;
}

/**
 * 주식 주문 수량을 **정수 주식 수**로 확정한다 (T-020).
 *
 * ## 왜 사이징 시점인가
 *
 * 예전에는 `Math.floor((amountKRW / price) * 1e8) / 1e8` — **소수점 8자리로 내림**,
 * 즉 소수를 *만드는* 코드였다(암호화폐 자매 프로젝트에서 온 관례로 보인다). 그 소수는
 * `orders.quantity` 에 그대로 저장되고, 전송 직전 `submittedQuantity` 가 해외만 `Math.floor`
 * 로 잘랐다. 결과는 두 갈래 손해였다:
 *
 *  - **1주 미만**(실측 79건 중 11건) → 잘라서 0주. 브로커에 `ORD_QTY: "0"` 이 나간다.
 *  - **나머지** → 평균 16.8%·최대 49.9% 의 자본이 **조용히** 미투입. DB 에는 원래 소수가
 *    남아 있어 사후에도 그 사실을 알 수 없다.
 *
 * 국내도 안전하지 않다. `submittedQuantity('domestic', …)` 는 가공 없이 통과시키는데
 * (T-018 이 "현행 송신 동작을 정확히 반영만 한다"고 의도적으로 그렇게 뒀다) 국내 KIS 는
 * 정수 주식 수만 받는다 — 이 코드베이스 자신도 `kis-domestic.ts` 폴백에서
 * `Math.floor(amountKRW / price)` 를 쓴다. 즉 국내 지정가 신규 매수는 **전송돼서 거절**된다.
 * "조용한 축소집행"이 아니라 "시끄러운 실패"라 성격은 다르지만 주문이 안 나가는 건 같다.
 *
 * → 주식은 국내·해외 모두 **정수 주식 수**로만 거래된다. 그러니 가장자리에서 자를 게 아니라
 *   **처음부터 정수를 만든다.** 그러면 `orders.quantity`(요청)와 송신 수량이 같아지고,
 *   "0.7주는 어디로 갔는가"라는 질문 자체가 사라진다.
 *
 * ## 왜 `order-quantity.ts` 를 고치지 않았나
 *
 * `submittedQuantity()` 는 **"브로커가 실제로 받는 수량"** 이라는 의미로 [[T-019]] 의
 * 체결 완결성 판정이 함께 쓰는 함수다. 그 의미를 바꾸면 두 작업의 결론이 서로 흔들린다.
 * 대신 여기서 먼저 정수를 만들고 **그 결과를 `submittedQuantity` 에 한 번 더 통과**시킨다.
 * 오늘은 국내·해외 모두 항등이지만, 송신 규칙이 언젠가 달라지면 사이징이 자동으로 따라가고
 * 두 값이 갈라질 수 있는 구조 자체가 생기지 않는다 (T-018 H-4 의 요점).
 */
export function sizeOrderQuantity(args: {
  market: Market;
  orderType: 'limit' | 'market';
  /** 시그널이 이미 들고 있는 수량 (exit-engine 의 보유수량 등) */
  requestedQuantity?: number | null;
  amountKRW: number;
  /** 호가 추격까지 반영된 최종 지정가 */
  price?: number | null;
}): SizedQuantity {
  const { market, orderType, requestedQuantity, amountKRW, price } = args;

  // ① 요청에 수량이 이미 있으면 그것을 정수화한다.
  //    (exit-engine 의 `heldQty` 등 — 브로커 잔고에서 온 값이라 보통 이미 정수지만,
  //     "주문서의 수량 = 송신 수량"이라는 불변식은 출처와 무관하게 성립해야 한다.)
  if (requestedQuantity != null && Number.isFinite(requestedQuantity)) {
    return { quantity: toWholeShares(market, requestedQuantity), raw: requestedQuantity };
  }

  // ② 지정가 + 수량 미지정 → 금액/가격으로 산출.
  //    해외주식: input.price 가 USD 라면 amountKRW 를 USD 로 환산해야 하지만 여기서는
  //    동기 함수라 KRW 가정 (기존 동작 그대로 — 이번 변경 대상이 아니다).
  if (orderType === 'limit' && price != null && Number.isFinite(price) && price > 0) {
    const raw = amountKRW / price;
    return { quantity: toWholeShares(market, raw), raw };
  }

  // ③ 시장가 등 — 여기서 확정하지 않는다. 어댑터가 금액에서 파생하며 그 경로는 이미
  //    `Math.floor(amountKRW / price)` 라 정수다.
  return { quantity: undefined, raw: undefined };
}

function toWholeShares(market: Market, raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return submittedQuantity(market, Math.floor(raw));
}

function buildOrderRequest(input: SignalInput, chasePct = 0): { req: OrderRequest; sized: SizedQuantity } {
  // 시장 추정 (input.symbol 형태로)
  const { getMarketFromSymbol } = require('@/lib/exchanges/kis-symbols') as typeof import('@/lib/exchanges/kis-symbols');
  const market = getMarketFromSymbol(input.symbol);

  // 호가 추격 — limit 주문에 한해 매수는 시장가 위로, 매도는 아래로 양보해 체결률 ↑.
  // chasePct=0 이면 그대로 (Phase M 이전 동작).
  let chasedPrice = input.price;
  if (chasedPrice != null && chasePct > 0 && input.orderType === 'limit') {
    const factor = input.side === 'buy' ? 1 + chasePct : 1 - chasePct;
    chasedPrice = chasedPrice * factor;
  }

  const sized = sizeOrderQuantity({
    market,
    orderType: input.orderType,
    requestedQuantity: input.quantity,
    amountKRW: input.amountKRW,
    price: chasedPrice,
  });

  return {
    req: {
      exchange: 'kis',
      symbol: input.symbol,
      side: input.side,
      type: input.orderType,
      price: chasedPrice,
      quantity: sized.quantity,
      // `amountKRW` 는 **재계산하지 않는다.** 안전 한도(`checkOrderMax`/`checkDailyMax`)가
      // 이 값을 쓰므로 정수화 뒤의 (더 작은) 실집행액으로 낮추면 한도가 느슨해진다.
      // 기록의 정합성보다 한도의 보수성이 우선이다 (T-020 D-1 판단 기준 ②).
      amountKRW: input.amountKRW,
      market,
      currency: market === 'overseas' ? 'USD' : 'KRW',
    },
    sized,
  };
}

/**
 * 1주 미만이라 주문을 내지 못했다는 사실을 **기계 판독 가능하게** 남긴다 (T-020 D-2).
 *
 * 흔적 없는 스킵은 이 프로젝트가 T-007·T-012·T-014·T-018 내내 없애 온 바로 그 침묵이다.
 * 세 곳에 동시에 남긴다:
 *  - grep 토큰 `SIZING_BELOW_MIN_QTY` (로그)
 *  - `trade_logs` 감사 기록 (CLAUDE.md 실매매 원칙 3항)
 *  - 호출부가 돌려주는 `errorCode` → `eval_funnel` 의 `quantity_below_min` 게이트
 *
 * 알림은 **매도만** 보낸다. 매수 스킵은 "자본이 투입되지 않았다"로 끝나지만, 매도 스킵은
 * **포지션이 닫히지 않았다** — 손절이었다면 보호가 아예 걸리지 않은 상태다. 매수까지 울리면
 * (소액 계좌 × 고가 종목에서 자주 발생할 수 있어) 알림이 흔해져 정작 매도 경고가 묻힌다.
 */
export function describeBelowMinQty(
  symbol: string, side: 'buy' | 'sell', amountKRW: number, price: number | null | undefined, raw: number | undefined,
): string {
  const rawStr = raw != null && Number.isFinite(raw) ? raw.toFixed(6) : '?';
  return `1주 미만 — 금액 ₩${fmtNum(amountKRW)} / 가격 ${price != null ? fmtNum(price) : '?'} = ${rawStr}주 (${symbol} ${side})`;
}

export async function recordBelowMinQty(args: {
  /** 어느 경로에서 스킵됐는가 — 로그·감사 기록의 grep 축 (`signal-sizing`/`signal-approve`/`entry-watcher`) */
  where: string;
  symbol: string;
  side: 'buy' | 'sell';
  amountKRW: number;
  price: number | null | undefined;
  raw: number | undefined;
  signalId: number | null;
}): Promise<string> {
  const detail = describeBelowMinQty(args.symbol, args.side, args.amountKRW, args.price, args.raw);
  console.warn(`[${args.where}] SIZING_BELOW_MIN_QTY signal=${args.signalId ?? '-'} ${detail}`);
  try {
    const pool = getPool();
    await pool.query(
      // 기존 감사 기록 관례(`rejectSignal`·`dry-run.auditLog`)와 같은 파라미터 형태를 쓴다.
      `INSERT INTO trade_logs (order_id, event, payload) VALUES (?, ?, ?)`,
      [null, 'sizing_below_min_qty', JSON.stringify({
        where: args.where,
        signalId: args.signalId,
        symbol: args.symbol,
        side: args.side,
        amountKRW: args.amountKRW,
        price: args.price ?? null,
        rawQuantity: args.raw ?? null,
      })],
    );
  } catch (e) {
    console.error('[signal-sizing] trade_logs 기록 실패:', e instanceof Error ? e.message : String(e));
  }
  if (args.side === 'sell') {
    // 같은 종목이 매 틱 재시도될 수 있으므로 종목 단위로 창을 잡는다 (기본 30분보다 길게).
    sendAlertThrottled(
      `sizing-below-min:${args.symbol}`,
      'warning',
      `청산 주문을 내지 못했습니다: ${args.symbol}`,
      `${detail}\n`
      + '매도 금액이 1주 값에 못 미쳐 주문을 내지 않았습니다. **포지션이 그대로 남아 있습니다** — '
      + '손절·청산 목적이었다면 수동으로 확인하세요.',
      6 * 60 * 60_000,
    );
  }
  return detail;
}

export async function createSignal(
  input: SignalInput,
  cfg?: RouterConfig,
): Promise<CreateSignalResult> {
  const [resolvedCfg, switches] = await Promise.all([
    cfg ?? getRouterConfig(),
    getEngineSwitches(),
  ]);
  cfg = resolvedCfg;

  const sym = await checkSymbolBlacklist(input.symbol);
  if (!sym.ok) {
    return { ok: false, signalId: 0, autoSubmitted: false, error: sym.detail ?? 'symbol_not_allowed', errorCode: 'symbol_blacklisted' };
  }

  // 🔴 T-058 — 실시간 현금 게이트. 현금이 모자라는 매수는 **행을 만들지 않는다**(→ RAG 색인·승인 요청 알림도 없다).
  //    중복 검사/INSERT 앞이라 승인 대기 경로와 자동 제출 경로를 같은 지점에서 막는다. 모르면 막지 않는다(게이트는 던지지 않는다).
  //    수량·가격은 아래 자동 제출 경로·`approveSignal` 과 **같은** `buildOrderRequest` 로 만든다 — 막는 기준과 실제 주문이 어긋나지 않게.
  if (input.side === 'buy') {
    const gate = await evaluateSignalCashGate({
      symbol: input.symbol,
      side: input.side,
      orderType: input.orderType,
      size: async () => {
        const style = await getStyleConfig();
        const chasePct = await getEffectiveChasePct(style.limitChasePct);
        const { req, sized } = buildOrderRequest(input, chasePct);
        return { quantity: sized.quantity, price: req.price ?? undefined };
      },
    });
    // 관측은 best-effort·fire-and-forget — 기록이 늦거나 실패해도 판정은 그대로다.
    void observeSignalCashGate({ symbol: input.symbol, side: input.side }, gate).catch(() => { /* 던지지 않지만 이중 방어 */ });
    if (gate.kind === 'insufficient') {
      return {
        ok: false, signalId: 0, autoSubmitted: false,
        error: `insufficient_cash: 실시간 가용 현금 부족(${gate.market}) — 시그널·알림을 만들지 않음`,
        errorCode: 'insufficient_cash',
      };
    }
  }

  // T-003 §4-1 전이표 — ENGINE_ENABLED × AUTOPILOT_MODE 가 status·주문 경로를 결정한다.
  // (구 hybrid_mode_enabled 는 getEngineSwitches 안에서 autopilot_mode 로 이관·폴백된다)
  const decision = routeSignal(input, cfg, switches);

  // AI 결과가 있으면 scenario 카드 생성 후 indicators에 merge
  let enrichedIndicators = input.indicators;
  if (input.indicators != null && typeof input.indicators === 'object') {
    const aiData = (input.indicators as Record<string, unknown>)['ai'];
    if (aiData != null && typeof aiData === 'object' && input.price != null) {
      const scenario = buildScenarioFromAiResult(
        aiData as Record<string, unknown>,
        input.price,
      );
      if (scenario !== null) {
        enrichedIndicators = {
          ...(input.indicators as Record<string, unknown>),
          ai: {
            ...(aiData as Record<string, unknown>),
            scenario,
          },
        };
      }
    }
  }
  const initialStatus = decision.status;
  if (decision.demoted) {
    console.log(
      `[signal-route] ${input.symbol} ${input.side} auto→assist 격하: ` +
      `금액 ${Math.round(input.amountKRW)} > SIGNAL_AUTO_SUBMIT_MAX_KRW`,
    );
  }
  const pool = getPool();
  const { getMarketFromSymbol } = await import('@/lib/exchanges/kis-symbols');
  const market = getMarketFromSymbol(input.symbol);

  // 동일 심볼+방향의 활성 시그널 중복 방지:
  // 승인 대기 상태(신규 awaiting_approval + 구 pending/pending_approval)와 manual 모드의
  // 관측 기록(detected)이 이미 있으면 생성하지 않는다.
  // (exit-engine tick 중복, 룰 재발화 중복 모두 차단)
  if (decision.route !== 'auto_submit') {
    const [dup] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM signals
       WHERE symbol = ? AND side = ? AND status IN (${sqlStatusList([...AWAITING_APPROVAL_STATUSES, 'detected'])})
         AND expires_at > NOW()
       LIMIT 1`,
      [input.symbol, input.side],
    );
    if ((dup as RowDataPacket[]).length > 0) {
      const dupId = (dup as RowDataPacket[])[0].id as number;
      return { ok: false, signalId: dupId, autoSubmitted: false, error: 'duplicate_active_signal', errorCode: 'duplicate_active_signal' };
    }
  }
  const [ins] = await pool.query<ResultSetHeader>(
    `INSERT INTO signals
     (strategy_id, symbol, side, order_type, price, quantity, amount_krw,
      reasoning, indicators, status, expires_at, market)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.strategyId ?? null,
      input.symbol,
      input.side,
      input.orderType,
      input.price ?? null,
      input.quantity ?? null,
      input.amountKRW,
      input.reasoning ?? null,
      enrichedIndicators != null ? JSON.stringify(enrichedIndicators) : null,
      initialStatus,
      decision.expiresAt,
      market,
    ],
  );
  const signalId = ins.insertId;

  // Phase AB — RAG 인덱싱 (fire-and-forget, 실패 시 main flow 영향 없음)
  // D-12: dynamic import 실패 silently 무시 X — warn 로그로 진단 가능하게
  void import('@/lib/rag/signals-upsert').then(m => m.fireAndForgetUpsertSignal({
    id: signalId,
    symbol: input.symbol,
    side: input.side,
    strategyId: input.strategyId ?? null,
    market,
    status: initialStatus,
    price: input.price ?? null,
    reasoning: input.reasoning ?? null,
    indicators: (enrichedIndicators ?? null) as Record<string, unknown> | null,
    createdAt: new Date().toISOString(),
  })).catch(e => {
    console.warn(`[rag-upsert] dynamic import @/lib/rag/signals-upsert failed: ${e instanceof Error ? e.message : String(e)}`);
  });

  if (decision.route !== 'auto_submit') {
    // T-042 — 승인 요청 알림은 별도 모듈이 만든다: 모든 동적 값 이스케이프(이전 본문은 사유 줄의 `<` 때문에 텔레그램이
    // 400 으로 거부해 약 78% 가 유실됐다), 실행 불가 매수는 알림 생략 + 서버 로그 1줄(T-044), 버튼 승인이 켜져 있으면 버튼 메시지.
    // fire-and-forget — 알림 I/O 가 시그널 생성을 지연시키거나 실패시키면 안 된다.
    void (async () => {
      const { notifyApprovalRequest } = await import('./approval-notify');
      await notifyApprovalRequest({
        signalId,
        symbol: input.symbol,
        side: input.side,
        amountKRW: input.amountKRW,
        price: input.price,
        strategyId: input.strategyId ?? null,
        reasoning: input.reasoning,
        indicators: enrichedIndicators,
        market,
        expiresAt: decision.expiresAt ? new Date(decision.expiresAt) : null,
      });
    })().catch((e) => {
      console.error(`[createSignal] 승인 요청 알림 실패 (signal ${signalId}):`, e instanceof Error ? e.message : String(e));
    });
    return { ok: true, signalId, autoSubmitted: false };
  }

  const style = await getStyleConfig();
  const chasePct = await getEffectiveChasePct(style.limitChasePct);
  const { req: orderReq, sized } = buildOrderRequest(input, chasePct);

  // 🔴 T-020 — 1주도 살 수 없으면 주문을 내지 않는다. **다만 절대 조용히 넘기지 않는다.**
  //
  // 안전 레이어(`submitOrder`)에서 막지 않는 이유: 그건 사이징 결함을 안전장치로 덮는 것이고,
  // 그러면 "왜 주문이 없는가"가 다시 설명 불가능해진다. 스킵의 이유는 스킵이 결정된 자리에서
  // 말해야 한다.
  if (sized.quantity === 0) {
    const detail = await recordBelowMinQty({
      where: 'signal-sizing', symbol: input.symbol, side: input.side,
      amountKRW: input.amountKRW, price: orderReq.price, raw: sized.raw, signalId,
    });
    // 시그널 상태가 `auto_submitted` 로 남으면 "주문을 냈다"는 거짓말이 된다.
    // 게이트 감사 상태(`skipped`)로 정정한다 — 활성 시그널에서도 빠지므로 다음 틱에
    // 조건이 유지되면 다시 평가된다(가격이 내리면 1주가 성립할 수 있다).
    await pool.query(`UPDATE signals SET status='skipped', updated_at=NOW() WHERE id=?`, [signalId])
      .catch(e => console.error(`[signal-sizing] status 정정 실패 signal=${signalId}:`, e));
    return {
      ok: false, signalId, autoSubmitted: false,
      error: `quantity_below_min: ${detail}`, errorCode: 'quantity_below_min',
    };
  }

  const orderResult = await submitOrder(orderReq, kis.createOrder, {
    assetClass: 'stock',
    source: 'auto',
  });
  if (orderResult.orderId) {
    await pool.query(`UPDATE signals SET consumed_order_id=? WHERE id=?`, [orderResult.orderId, signalId]);
  }
  const flags2 = await getSignalNotifyFlags();
  if (flags2.autoSubmit) {
    const reasonLine2 = input.reasoning
      ? input.reasoning.split('\n').find(l => l.trim().length > 0)?.trim().slice(0, 100)
      : undefined;
    const bodyLines2 = [
      `${input.side === 'buy' ? '매수' : '매도'} ₩${fmtNum(input.amountKRW)} · 주문 #${orderResult.orderId ?? '-'}`,
      // T-042 — 승인 요청과 같은 결함: 사유 줄의 `<`·`&` 를 이스케이프하지 않으면 텔레그램이 400 으로 거부해 알림이 사라진다.
      reasonLine2 ? `사유: ${escapeAlertText(reasonLine2)}` : undefined,
    ].filter(Boolean);
    // `getSymbolLabel` 은 이미 이스케이프된 값을 돌려준다 — 다시 씌우면 `&amp;amp;` (2라운드 감사 R2-1). 사유 줄은 원문이라 이스케이프한다.
    sendAlert('info', `✅ 자동 제출: ${await getSymbolLabel(input.symbol)}`, bodyLines2.join('\n'));
  }
  return {
    ok: true,
    signalId,
    autoSubmitted: true,
    orderId: orderResult.orderId,
    orderResult,
  };
}

export async function getSignalById(id: number): Promise<SignalRow | null> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, strategy_id, symbol, side, order_type, price, quantity, amount_krw,
            reasoning, indicators, status, expires_at, consumed_order_id,
            created_at, updated_at
     FROM signals WHERE id=? LIMIT 1`,
    [id],
  );
  return (rows[0] as SignalRow | undefined) ?? null;
}

export async function approveSignal(id: number): Promise<CreateSignalResult> {
  const pool = getPool();
  const row = await getSignalById(id);
  if (!row) return { ok: false, signalId: id, autoSubmitted: false, error: 'not_found' };
  // 신규 awaiting_approval + 구 pending / pending_approval 을 모두 승인 가능으로 본다.
  // `detected`(manual 모드 관측 기록)는 주문 경로가 없는 상태라 의도적으로 제외한다 (§4-1).
  if (!isAwaitingApproval(row.status)) {
    return { ok: false, signalId: id, autoSubmitted: false, error: `invalid_status:${row.status}` };
  }
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    // T-042 — 조건부 UPDATE: 그 사이 다른 쪽이 승인·거절한 행을 `expired` 로 덮어쓰지 않는다.
    await pool.query(
      `UPDATE signals SET status='expired', updated_at=NOW() WHERE id=? AND status IN (${sqlStatusList(AWAITING_APPROVAL_STATUSES)})`,
      [id],
    );
    return { ok: false, signalId: id, autoSubmitted: false, error: 'signal_expired' };
  }

  const input: SignalInput = {
    strategyId: row.strategy_id ?? undefined,
    symbol: row.symbol,
    side: row.side,
    orderType: row.order_type,
    price: row.price != null ? Number(row.price) : undefined,
    quantity: row.quantity != null ? Number(row.quantity) : undefined,
    amountKRW: Number(row.amount_krw),
  };
  const style = await getStyleConfig();
  const chasePct = await getEffectiveChasePct(style.limitChasePct);
  const { req: orderReq, sized } = buildOrderRequest(input, chasePct);

  // 🔴 T-020 — 승인해도 1주가 안 되면 주문이 성립하지 않는다.
  // 시그널 상태는 **그대로 둔다**: 사람이 다시 판단할 수 있어야 하고(금액을 올리거나 포기),
  // TTL 이 지나면 자연히 `expired` 가 된다. `approved` 로 바꾸면 "승인해서 주문했다"는
  // 거짓 기록이 남고, `rejected` 로 바꾸면 사람이 거부한 것으로 오독된다.
  if (sized.quantity === 0) {
    const detail = await recordBelowMinQty({
      where: 'signal-approve', symbol: row.symbol, side: row.side,
      amountKRW: input.amountKRW, price: orderReq.price, raw: sized.raw, signalId: id,
    });
    return {
      ok: false, signalId: id, autoSubmitted: false,
      error: `quantity_below_min: ${detail}`, errorCode: 'quantity_below_min',
    };
  }

  // T-042 — 선점. 웹과 텔레그램이 동시에 승인해도 이 UPDATE 를 이긴 쪽만 `submitOrder` 를 부른다(이중 주문 방지).
  const claim = await claimAwaitingSignal(pool, id, 'executing');
  if (!claim.ok) {
    return { ok: false, signalId: id, autoSubmitted: false, error: claim.error };
  }

  let orderResult: Awaited<ReturnType<typeof submitOrder>>;
  try {
    orderResult = await submitOrder(orderReq, kis.createOrder, {
      assetClass: 'stock',
      source: 'signal',
    });
  } catch (e) {
    await releaseClaim(pool, id, row.status).catch(() => { /* 복귀 실패는 원 예외를 가리지 않는다 */ });
    throw e;
  }

  // 🔴 T-042 — 주문이 **받아들여졌을 때만** `approved` 로 기록한다. 이전에는 거부·차단(킬스위치·한도·잔고 부족)
  //    이어도 `approved` 로 남아 "승인했는데 주문이 없는" 행이 쌓였다(`consumed_order_id` NULL 4건).
  //    T-020 과 같은 취지: 거짓 기록 대신 대기로 되돌려 사람이 다시 판단하게 하고, 사유는 trade_logs 에 남긴다.
  if (!orderResult.ok) {
    // 🔴 단, 거래소에 접수됐는지 *알 수 없는* 실패(송신 중 예외·5xx·연결 끊김, 접수 직후 DB 갱신 실패)는 되돌리면 안 된다.
    //    대기로 돌려놓으면 같은 시그널을 다시 승인할 수 있고, 첫 주문이 실제로 접수됐다면 **이중 주문**이다(실계좌).
    //    선점(`executing`) 상태로 잠가 두고 사람에게 체결내역 확인을 요청한다. 이전에는 무조건 `approved` 라 재주문이 불가능했다.
    if (orderResult.outcomeUnknown === true) {
      await pool.query(
        `INSERT INTO trade_logs (order_id, event, payload) VALUES (?, ?, ?)`,
        [orderResult.orderId ?? null, TRADE_LOG_EVENTS.approveOrderUncertain,
          JSON.stringify({ signalId: id, symbol: row.symbol, side: row.side, error: orderResult.error ?? null })],
      ).catch((e) => console.error('[approveSignal] 결과 불명 감사 기록 실패:', e instanceof Error ? e.message : String(e)));
      sendAlert(
        'critical',
        '⚠️ 주문 결과 불명 — 체결내역 확인 필요',
        `시그널 #${id} ${escapeAlertText(row.symbol)} ${row.side === 'buy' ? '매수' : '매도'} ₩${fmtNum(input.amountKRW)} · 주문 #${orderResult.orderId ?? '-'}\n`
        + `사유: ${escapeAlertText(String(orderResult.error ?? 'unknown').slice(0, 160))}\n`
        + '거래소에 주문이 접수됐는지 알 수 없어 이중 주문을 막으려고 시그널을 잠갔습니다. KIS 체결/미체결 내역을 확인하세요. '
        + '접수되지 않았다면 DB 에서 시그널 상태를 되돌려야 합니다(runbook: docs/telegram-approval.md).',
      );
      return {
        ok: false,
        signalId: id,
        autoSubmitted: false,
        orderId: orderResult.orderId,
        orderResult,
        error: `order_uncertain: ${orderResult.error ?? 'unknown'}`,
        errorCode: 'order_uncertain',
      };
    }

    // 복귀가 실패해도 "주문이 거부됐다"는 사실은 그대로 돌려준다. 시그널은 `executing` 에 남아(재승인 불가 — 안전한 쪽) 사람이 풀어야 한다.
    await releaseClaim(pool, id, row.status).catch((e) => {
      console.error(`[approveSignal] 선점 복귀 실패 (signal ${id}, executing 에 남음):`, e instanceof Error ? e.message : String(e));
      sendAlert('warning', '시그널 선점 복귀 실패', `시그널 #${id} 의 주문은 거부됐지만 대기 상태로 되돌리지 못해 executing 에 남았습니다. 재승인이 필요하면 DB 에서 상태를 되돌리세요(docs/telegram-approval.md §6.1).`);
    });
    await pool.query(
      `INSERT INTO trade_logs (order_id, event, payload) VALUES (?, ?, ?)`,
      [
        orderResult.orderId ?? null,
        TRADE_LOG_EVENTS.approveOrderRejected,
        JSON.stringify({
          signalId: id, symbol: row.symbol, side: row.side,
          blockedBy: orderResult.blockedBy ?? null, error: orderResult.error ?? null,
        }),
      ],
    ).catch((e) => console.error('[approveSignal] 거부 감사 기록 실패:', e instanceof Error ? e.message : String(e)));
    return {
      ok: false,
      signalId: id,
      autoSubmitted: false,
      orderId: orderResult.orderId,
      orderResult,
      error: `order_not_accepted: ${orderResult.blockedBy ?? orderResult.error ?? 'unknown'}`,
      errorCode: 'order_not_accepted',
    };
  }

  // 주문은 이미 접수됐다. 상태 기록이 실패해도 "처리하지 못했다"고 답하면 거짓이다(재시도를 부추기지만 executing 잠금이 막는다).
  // 기록 실패는 경보로 알리고 결과는 사실대로(주문 접수) 돌려준다. 시그널은 executing 에 남아 이중 주문을 막는다.
  await pool.query(
    `UPDATE signals SET status='approved', consumed_order_id=? WHERE id=? AND status='executing'`,
    [orderResult.orderId ?? null, id],
  ).catch((e) => {
    console.error(`[approveSignal] approved 기록 실패 (signal ${id}, 주문 #${orderResult.orderId ?? '-'} 은 접수됨):`, e instanceof Error ? e.message : String(e));
    sendAlert('warning', '주문은 접수됐으나 시그널 상태 기록 실패', `시그널 #${id} 의 주문 #${orderResult.orderId ?? '-'} 은 접수됐지만 status 를 approved 로 기록하지 못했습니다(executing 에 남음 — 재승인은 막혀 있습니다). DB 에서 status='approved', consumed_order_id=${orderResult.orderId ?? 'NULL'} 로 맞추세요.`);
  });
  return {
    ok: true,
    signalId: id,
    autoSubmitted: false,
    orderId: orderResult.orderId,
    orderResult,
  };
}

/**
 * 하이브리드 모드 승인 — 즉시 주문하지 않고 진입 감시 상태로만 전환.
 * entry-watcher cron이 price_zone 도달 시 자동 주문 실행.
 *
 * @param id         시그널 ID
 * @param editedScenario  body에서 전달된 시나리오 수정값 (optional) — indicators.ai.scenario에 병합
 */
export async function approveSignalHybrid(
  id: number,
  editedScenario?: Partial<import('./scenario-builder').ScenarioCard>,
): Promise<{ ok: boolean; status?: string; message?: string; error?: string }> {
  const pool = getPool();
  const row = await getSignalById(id);
  if (!row) return { ok: false, error: 'not_found' };

  // 승인 대기 상태(awaiting_approval / 구 pending / 구 pending_approval)에서만 승인 가능
  if (!isAwaitingApproval(row.status)) {
    return { ok: false, error: `invalid_status:${row.status}` };
  }
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    await pool.query(
      `UPDATE signals SET status='expired', updated_at=NOW() WHERE id=? AND status IN (${sqlStatusList(AWAITING_APPROVAL_STATUSES)})`,
      [id],
    );
    return { ok: false, error: 'signal_expired' };
  }

  // editedScenario가 있으면 indicators.ai.scenario에 merge
  let mergedIndicatorsJson: string | undefined;
  if (editedScenario != null) {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = typeof row.indicators === 'string'
        ? JSON.parse(row.indicators)
        : (row.indicators as Record<string, unknown> ?? {});
    } catch { /* indicators가 파싱 불가면 빈 객체로 시작 */ }

    const existingAi = (parsed['ai'] as Record<string, unknown> | undefined) ?? {};
    const existingScenario = (existingAi['scenario'] as Record<string, unknown> | undefined) ?? {};
    const mergedScenario = { ...existingScenario, ...editedScenario };

    const mergedIndicators = {
      ...parsed,
      ai: { ...existingAi, scenario: mergedScenario },
    };
    mergedIndicatorsJson = JSON.stringify(mergedIndicators);
  }

  // T-042 — 원자적 전이: 대기 상태이고 만료 전일 때만 바뀐다. 이전에는 `WHERE id=?` 뿐이라 그 사이 거절·만료된
  // 행을 다시 승인 상태로 덮어쓸 수 있었다.
  const claim = await claimAwaitingSignal(pool, id, 'approved_pending_entry', { indicatorsJson: mergedIndicatorsJson });
  if (!claim.ok) return { ok: false, error: claim.error };

  return {
    ok: true,
    status: 'approved_pending_entry',
    message: '진입 감시가 시작됐습니다',
  };
}

export async function rejectSignal(id: number): Promise<{ ok: boolean; error?: string }> {
  const pool = getPool();
  const row = await getSignalById(id);
  if (!row) return { ok: false, error: 'not_found' };
  // manual 모드의 `detected` 도 사람이 "관심 없음"으로 정리할 수 있어야 하므로 거부는 허용한다.
  if (!isAwaitingApproval(row.status) && row.status !== 'detected') {
    return { ok: false, error: `invalid_status:${row.status}` };
  }

  // T-042 — 원자적 전이. 이미 승인·만료된 행을 거절로 덮어쓰지 않고, 이긴 쪽만 로그·쿨다운을 남긴다.
  const rejected = await rejectAwaitingSignal(pool, id);
  if (!rejected.ok) return { ok: false, error: rejected.error };
  await pool.query(
    `INSERT INTO trade_logs (order_id, event, payload) VALUES (?, ?, ?)`,
    [null, 'signal_rejected', JSON.stringify({ signalId: id, symbol: row.symbol, side: row.side })],
  );

  // T-003 §4-3 — 사람이 거부한 후보는 4시간 동안 다시 들이밀지 않는다.
  // (구 `skip_seal_24h` 봉인의 자리를 대신한다. 그건 AI 반복 거절 이력에 묶여 있었고
  //  AI 제거로 근거가 소멸했다 — 이제 근거는 "사람이 아니라고 했다"는 명시적 신호다.)
  // 쿨다운 기록 실패가 거부 자체를 되돌려선 안 되므로 setCooldown 은 throw 하지 않는다.
  const { setCooldown, COOLDOWN_TTL_MIN } = await import('@/lib/strategy/cooldowns');
  await setCooldown(
    {
      scope: 'entry',
      symbol: row.symbol,
      strategyId: row.strategy_id,
      side: row.side,
    },
    COOLDOWN_TTL_MIN.entryRejected,
    'human_rejected',
  );
  return { ok: true };
}
