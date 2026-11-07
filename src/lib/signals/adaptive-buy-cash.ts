import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { roundToTick } from '@/lib/exchanges/kis-domestic';
import type { Market } from '@/lib/exchanges/kis-symbols';
import { AMBIGUOUS_ORDER_PREDICATE } from '@/lib/safety/submission-outcome';
import { CASH_READ_TIMEOUT_MS, ENTRY_CASH_BUFFER_RATIO, readAvailableCash } from './entry-cash-precheck';
import { overseasLimitUnitUsd, readGateUsdKrwRate } from './signal-cash-gate';

export const ADAPTIVE_BUY_MARKER = 'adaptiveBuyAllocation';

export function hasAdaptiveBuyAllocation(indicators: unknown): boolean {
  if (typeof indicators === 'string') {
    try { indicators = JSON.parse(indicators); } catch { return false; }
  }
  return !!indicators && typeof indicators === 'object' && ADAPTIVE_BUY_MARKER in indicators;
}

export interface AdaptiveCashBudget {
  /** Whole KRW or USD cents. */
  availableMinor: number;
  krwPerMinor: number;
}

export async function readAdaptiveCashBudget(market: Market, accountId: number, selfOrderId = 0): Promise<AdaptiveCashBudget | null> {
  // The two currencies come from the same KIS cash read. USD net cash already excludes filled buy margin.
  // A concurrent caller may join a fresh read that started up to one timeout earlier.
  const startedAt = new Date(Date.now() - CASH_READ_TIMEOUT_MS);
  const [cash, fx] = await Promise.all([
    readAvailableCash(Date.now, CASH_READ_TIMEOUT_MS, 0),
    market === 'overseas' ? readGateUsdKrwRate() : null,
  ]);
  const nativeCash = market === 'domestic' ? cash?.domesticKRW : cash?.overseasUSD;
  const krwPerMinor = market === 'domestic' ? 1 : fx?.kind === 'known' ? fx.rate / 100 : 0;
  if (nativeCash == null || !Number.isFinite(nativeCash) || nativeCash <= 0 || !Number.isFinite(krwPerMinor) || krwPerMinor <= 0) return null;

  // Pending rows are inserted before checking. Include unfilled exposure and fills that may have
  // landed during the cash read. Older partial fills are already reflected in broker cash.
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(CASE
              WHEN o.status = 'partially_filled' AND o.updated_at < ? AND o.quantity > 0
              THEN o.amount_krw * GREATEST(0, 1 - COALESCE((
                SELECT SUM(e.quantity) FROM executions e WHERE e.order_id = o.id
              ), 0) / o.quantity)
              ELSE o.amount_krw END), 0) AS reserved_krw,
            COUNT(*) - COUNT(CASE WHEN o.amount_krw > 0 THEN 1 END) AS unresolved
       FROM orders o
      WHERE o.account_id = ? AND o.market = ? AND o.side = 'buy' AND o.id <> ?
        AND (o.status IN ('pending', 'accepted', 'partially_filled')
          OR ${AMBIGUOUS_ORDER_PREDICATE}
          OR (o.status = 'filled' AND o.updated_at >= ?))`,
    [startedAt, accountId, market, selfOrderId, startedAt],
  );
  const reserved = Number(rows[0]?.reserved_krw);
  if (!Number.isFinite(reserved) || reserved < 0 || Number(rows[0]?.unresolved) !== 0) return null;
  const cashMinor = Math.floor(nativeCash * (market === 'domestic' ? 1 : 100));
  const reservedMinor = Math.ceil(reserved * (1 + ENTRY_CASH_BUFFER_RATIO) / krwPerMinor);
  if (!Number.isSafeInteger(cashMinor) || !Number.isSafeInteger(reservedMinor)) return null;
  return { availableMinor: Math.max(0, cashMinor - reservedMinor), krwPerMinor };
}

export function adaptiveLimitUnit(market: Market, priceKrw: number, krwPerMinor: number): number | null {
  if (!Number.isFinite(priceKrw) || priceKrw <= 0) return null;
  const unit = market === 'domestic' ? roundToTick(priceKrw) : overseasLimitUnitUsd(priceKrw, krwPerMinor * 100);
  return unit != null && unit > 0 ? unit * (market === 'domestic' ? 1 : 100) : null;
}

export function adaptiveOrderCostMinor(unitMinor: number, quantity: number): number {
  return Math.ceil(unitMinor * quantity * (1 + ENTRY_CASH_BUFFER_RATIO));
}
