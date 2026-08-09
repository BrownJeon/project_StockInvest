import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { kis } from '@/lib/exchanges/kis';
import type { OrderRequest } from '@/lib/exchanges/types';
import { getSymbolLabel, sendAlert } from '@/lib/notify';
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
export type CreateSignalErrorCode = 'symbol_blacklisted' | 'duplicate_active_signal';

export interface CreateSignalResult {
  ok: boolean;
  signalId: number;
  autoSubmitted: boolean;
  orderId?: number;
  orderResult?: unknown;
  error?: string;
  errorCode?: CreateSignalErrorCode;
}

function buildOrderRequest(input: SignalInput, chasePct = 0): OrderRequest {
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

  let quantity = input.quantity;
  // 지정가 주문에 수량이 없으면 amountKRW / price 로 계산 (소수 8자리, 내림)
  // 해외주식: input.price가 USD라면 amountKRW를 USD로 환산해야 하지만 여기서는 동기 함수라 KRW 가정
  if (input.orderType === 'limit' && quantity == null && chasedPrice != null && chasedPrice > 0) {
    quantity = Math.floor((input.amountKRW / chasedPrice) * 1e8) / 1e8;
  }
  return {
    exchange: 'kis',
    symbol: input.symbol,
    side: input.side,
    type: input.orderType,
    price: chasedPrice,
    quantity,
    amountKRW: input.amountKRW,
    market,
    currency: market === 'overseas' ? 'USD' : 'KRW',
  };
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
  const orderReq = buildOrderRequest(input, chasePct);
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
  const orderReq = buildOrderRequest(input, chasePct);
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
