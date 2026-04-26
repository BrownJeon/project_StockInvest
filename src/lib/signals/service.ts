import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { kis } from '@/lib/exchanges/kis';
import type { OrderRequest } from '@/lib/exchanges/types';
import { sendAlert } from '@/lib/notify';
import { submitOrder } from '@/lib/safety/dry-run';
import { checkSymbolBlacklist } from '@/lib/safety/order-limits';
import {
  type RouterConfig,
  type SignalInput,
  getRouterConfig,
  routeSignal,
} from './router';

function fmtNum(n: number): string {
  return Math.round(n).toLocaleString('ko-KR');
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
  status:
    | 'pending'
    | 'approved'
    | 'rejected'
    | 'auto_submitted'
    | 'expired'
    | 'superseded';
  expires_at: Date | null;
  consumed_order_id: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateSignalResult {
  ok: boolean;
  signalId: number;
  autoSubmitted: boolean;
  orderId?: number;
  orderResult?: unknown;
  error?: string;
}

function buildOrderRequest(input: SignalInput): OrderRequest {
  // 시장 추정 (input.symbol 형태로)
  const { getMarketFromSymbol } = require('@/lib/exchanges/kis-symbols') as typeof import('@/lib/exchanges/kis-symbols');
  const market = getMarketFromSymbol(input.symbol);
  let quantity = input.quantity;
  // 지정가 주문에 수량이 없으면 amountKRW / price 로 계산 (소수 8자리, 내림)
  // 해외주식: input.price가 USD라면 amountKRW를 USD로 환산해야 하지만 여기서는 동기 함수라 KRW 가정
  if (input.orderType === 'limit' && quantity == null && input.price != null && input.price > 0) {
    quantity = Math.floor((input.amountKRW / input.price) * 1e8) / 1e8;
  }
  return {
    exchange: 'kis',
    symbol: input.symbol,
    side: input.side,
    type: input.orderType,
    price: input.price,
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
  if (!cfg) cfg = await getRouterConfig();
  const sym = await checkSymbolBlacklist(input.symbol);
  if (!sym.ok) {
    return { ok: false, signalId: 0, autoSubmitted: false, error: sym.detail ?? 'symbol_not_allowed' };
  }

  const decision = routeSignal(input, cfg);
  const initialStatus = decision.route === 'auto_submit' ? 'auto_submitted' : 'pending';
  const pool = getPool();
  const { getMarketFromSymbol } = await import('@/lib/exchanges/kis-symbols');
  const market = getMarketFromSymbol(input.symbol);
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
      input.indicators != null ? JSON.stringify(input.indicators) : null,
      initialStatus,
      decision.expiresAt,
      market,
    ],
  );
  const signalId = ins.insertId;

  if (decision.route !== 'auto_submit') {
    const ttlMin = decision.expiresAt
      ? Math.round((new Date(decision.expiresAt).getTime() - Date.now()) / 60000)
      : 30;
    sendAlert(
      'info',
      `📩 승인 요청: ${input.symbol}`,
      `${input.side === 'buy' ? '매수' : '매도'} ₩${fmtNum(input.amountKRW)} · TTL ${ttlMin}분`,
    );
    return { ok: true, signalId, autoSubmitted: false };
  }

  const orderReq = buildOrderRequest(input);
  const orderResult = await submitOrder(orderReq, kis.createOrder, {
    assetClass: 'stock',
    source: 'auto',
  });
  if (orderResult.orderId) {
    await pool.query(`UPDATE signals SET consumed_order_id=? WHERE id=?`, [orderResult.orderId, signalId]);
  }
  sendAlert(
    'info',
    `✅ 자동 제출: ${input.symbol}`,
    `${input.side === 'buy' ? '매수' : '매도'} ₩${fmtNum(input.amountKRW)} · 주문 #${orderResult.orderId ?? '-'}`,
  );
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
  if (row.status !== 'pending') {
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
  const orderReq = buildOrderRequest(input);
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

export async function rejectSignal(id: number): Promise<{ ok: boolean; error?: string }> {
  const pool = getPool();
  const row = await getSignalById(id);
  if (!row) return { ok: false, error: 'not_found' };
  if (row.status !== 'pending') return { ok: false, error: `invalid_status:${row.status}` };

  await pool.query(`UPDATE signals SET status='rejected' WHERE id=?`, [id]);
  await pool.query(
    `INSERT INTO trade_logs (order_id, event, payload) VALUES (?, ?, ?)`,
    [null, 'signal_rejected', JSON.stringify({ signalId: id, symbol: row.symbol, side: row.side })],
  );
  return { ok: true };
}
