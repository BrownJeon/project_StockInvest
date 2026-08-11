import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { kis } from '@/lib/exchanges/kis';
import type { Market } from '@/lib/exchanges/kis-symbols';
import { submittedQuantity } from '@/lib/exchanges/order-quantity';
import type { OrderRequest } from '@/lib/exchanges/types';
import { getSymbolLabel, sendAlert } from '@/lib/notify';
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
import { getStyleConfig } from '@/lib/strategy/style';

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
  | 'quantity_below_min';

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
    const ttlMin = decision.expiresAt
      ? Math.round((new Date(decision.expiresAt).getTime() - Date.now()) / 60000)
      : 30;
    const flags = await getSignalNotifyFlags();
    if (flags.pending) {
      const exitKind = enrichedIndicators != null && typeof enrichedIndicators === 'object'
        ? (enrichedIndicators as Record<string, unknown>)['exit_kind'] as string | undefined
        : undefined;
      const exitLabel: Record<string, string> = {
        hard_stop: '🔴 하드 손절 (자금보호)',
        target_profit: '🟢 목표 익절',
        trailing_stop: '🟡 트레일링 스탑',
        eod_loss_cut: '🔴 EOD 손절',
      };
      // reasoning 핵심 라인 추출:
      //  - exit 시그널: 첫 번째 줄 (이미 "[하드 손절] 손실 -X.XX%..." 형태)
      //  - AI 선택 시그널: "[AI N%]" 포함 줄 우선 (AI 근거가 가장 핵심)
      //  - 그 외: 첫 번째 비어있지 않은 줄
      const reasonLine = (() => {
        if (!input.reasoning) return undefined;
        const lines = input.reasoning.split('\n').map(l => l.trim()).filter(Boolean);
        if (!lines.length) return undefined;
        if (exitKind) return lines[0].slice(0, 100); // exit: 첫 줄이 핵심
        const aiLine = lines.find(l => l.startsWith('[AI '));
        return (aiLine ?? lines[0]).slice(0, 100);
      })();
      const bodyLines = [
        `${input.side === 'buy' ? '매수' : '매도'} ₩${fmtNum(input.amountKRW)} · TTL ${ttlMin}분`,
        exitKind && exitLabel[exitKind] ? `유형: ${exitLabel[exitKind]}` : undefined,
        reasonLine ? `사유: ${reasonLine}` : undefined,
      ].filter(Boolean);
      sendAlert('info', `📩 승인 요청: ${await getSymbolLabel(input.symbol)}`, bodyLines.join('\n'));
    }
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
      reasonLine2 ? `사유: ${reasonLine2}` : undefined,
    ].filter(Boolean);
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
    const pool = getPool();
    await pool.query(`UPDATE signals SET status='expired', updated_at=NOW() WHERE id=?`, [id]);
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

  const orderResult = await submitOrder(orderReq, kis.createOrder, {
    assetClass: 'stock',
    source: 'signal',
  });
  await pool.query(
    `UPDATE signals SET status='approved', consumed_order_id=? WHERE id=?`,
    [orderResult.orderId ?? null, id],
  );
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
    await pool.query(`UPDATE signals SET status='expired', updated_at=NOW() WHERE id=?`, [id]);
    return { ok: false, error: 'signal_expired' };
  }

  // editedScenario가 있으면 indicators.ai.scenario에 merge
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
    await pool.query(
      `UPDATE signals SET indicators=?, status='approved_pending_entry', updated_at=NOW() WHERE id=?`,
      [JSON.stringify(mergedIndicators), id],
    );
  } else {
    await pool.query(
      `UPDATE signals SET status='approved_pending_entry', updated_at=NOW() WHERE id=?`,
      [id],
    );
  }

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

  await pool.query(`UPDATE signals SET status='rejected' WHERE id=?`, [id]);
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
