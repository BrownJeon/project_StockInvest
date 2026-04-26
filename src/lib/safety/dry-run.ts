import { randomUUID } from 'node:crypto';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getAccountId, getPool } from '@/lib/db';
import type { ExchangeId, OrderRequest, OrderResult } from '@/lib/exchanges/types';
import { sendAlert } from '@/lib/notify';
import { type AssetClass } from './asset-profile';
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
import { checkVolatilityGuard } from './volatility-guard';

/** DB system_config override takes precedence over env var. */
export async function isDryRun(): Promise<boolean> {
  try {
    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & { value: string })[]>(
      'SELECT value FROM system_config WHERE `key` = ? LIMIT 1',
      ['safety_dry_run'],
    );
    if (rows.length > 0) {
      const val = JSON.parse(rows[0].value);
      return val === true || val === 'true';
    }
  } catch {
    // DB unavailable — fall through to env
  }
  return String(process.env.DRY_RUN ?? 'true').toLowerCase() === 'true';
}

interface SubmitOptions {
  assetClass?: AssetClass;
  source?: 'manual' | 'signal' | 'auto';
  clientOrderId?: string;
}

/**
 * 모든 주문 송신은 이 래퍼를 통과해야 한다.
 * 순서:
 *  1. 멱등성 key 확정
 *  2. orders INSERT (status=pending)
 *  3. Kill Switch
 *  4. 심볼 화이트리스트
 *  5. 단계별 1회 한도
 *  6. 일일 누적 한도
 *  7. DRY_RUN: 실제 송신 생략 → status=dry_run
 *  8. 실 송신 → status=accepted (상세 상태는 거래소 응답에 따라 후속 업데이트)
 * 각 단계에서 발생 이벤트는 trade_logs에 기록.
 */
export async function submitOrder(
  req: OrderRequest,
  realSubmit: (req: OrderRequest) => Promise<OrderResult>,
  options: SubmitOptions = {},
): Promise<OrderResult & { orderId?: number; clientOrderId?: string }> {
  const assetClass: AssetClass = options.assetClass ?? 'stock';
  const source = options.source ?? 'manual';
  const clientOrderId = options.clientOrderId ?? `co-${randomUUID()}`;

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

  const daily = await checkDailyMax(reqWithKrw, effDailyMax);
  if (!daily.ok) {
    await markBlocked(orderId, daily.reason ?? 'daily_limit', daily.detail);
    return { ok: false, orderId, clientOrderId, blockedBy: daily.reason, error: daily.detail };
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

  // 7. DRY_RUN
  if (await isDryRun()) {
    await pool.query(`UPDATE orders SET status='dry_run' WHERE id=?`, [orderId]);
    await auditLog(orderId, 'dry_run', {
      effOrderMax: effOrderMax === Infinity ? null : effOrderMax,
      effDailyMax: effDailyMax === Infinity ? null : effDailyMax,
    });
    return { ok: true, orderId, clientOrderId, dryRun: true, blockedBy: 'dry_run' };
  }

  // 8. 실 송신
  try {
    const result = await realSubmit(req);
    if (result.ok) {
      await pool.query(
        `UPDATE orders SET status='accepted', exchange_order_id=? WHERE id=?`,
        [result.exchangeOrderId ?? null, orderId],
      );
      await auditLog(orderId, 'accepted', result);
    } else {
      await pool.query(
        `UPDATE orders SET status='rejected', blocked_by=? WHERE id=?`,
        [result.blockedBy ?? null, orderId],
      );
      await auditLog(orderId, 'rejected', result);
    }
    return { ...result, orderId, clientOrderId };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await pool.query(`UPDATE orders SET status='failed' WHERE id=?`, [orderId]);
    await auditLog(orderId, 'error', { error });
    return { ok: false, orderId, clientOrderId, error };
  }

  } catch (e) {
    // step 3~7 사이 예외 — pending 상태로 남지 않도록 failed 처리
    const error = e instanceof Error ? e.message : String(e);
    await pool.query(`UPDATE orders SET status='failed' WHERE id=?`, [orderId]).catch(() => {});
    await auditLog(orderId, 'error', { error, phase: 'safety_check' });
    return { ok: false, orderId, clientOrderId, error };
  }
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
