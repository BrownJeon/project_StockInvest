/**
 * position_state — exit-engine 트레일링 peak·진입가 추적 store.
 *
 * 책임:
 *  - 보유 포지션 1개당 1행 (PRIMARY KEY (symbol, market))
 *  - entry_price: KIS 잔고에서 받은 avgPrice 우선, 없으면 첫 ticker 가격
 *  - peak_price: 보유 후 관측된 최고가 (트레일링 스탑 발화 기준)
 *  - 미보유 종목 row는 reconcile에서 일괄 삭제
 *
 * 트레일링 high 보존 정책:
 *  - 매 cron 틱마다 ticker.price > peak_price면 peak_price 갱신
 *  - 청산(exit_kind=hard_stop|target_profit|trailing_stop|eod_loss_cut) 후 row 삭제는
 *    실주문 체결 확인 단계가 아니라 보유 사라짐 시점에 reconcile이 처리 (단순화).
 */

import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import type { Market } from '@/lib/exchanges/kis-symbols';

export interface ScenarioExitParams {
  targetLo: number;
  targetHi: number;
  stopLo: number;
  stopHi: number;
}

export interface PositionState {
  symbol: string;
  market: Market;
  entryPrice: number;
  peakPrice: number;
  qty: number | null;
  scenarioExit: ScenarioExitParams | null;
  holdingDeadline: Date | null;
  firstSeenAt: Date;
  updatedAt: Date;
}

interface PositionRow extends RowDataPacket {
  symbol: string;
  market: Market;
  entry_price: string | number;
  peak_price: string | number;
  qty: string | number | null;
  scenario_exit: string | null;
  holding_deadline: Date | null;
  first_seen_at: Date;
  updated_at: Date;
}

function rowToState(r: PositionRow): PositionState {
  let scenarioExit: ScenarioExitParams | null = null;
  if (r.scenario_exit) {
    try {
      scenarioExit = typeof r.scenario_exit === 'string'
        ? JSON.parse(r.scenario_exit)
        : r.scenario_exit;
    } catch { /* ignore */ }
  }
  return {
    symbol: r.symbol,
    market: r.market,
    entryPrice: Number(r.entry_price),
    peakPrice: Number(r.peak_price),
    qty: r.qty == null ? null : Number(r.qty),
    scenarioExit,
    holdingDeadline: r.holding_deadline ?? null,
    firstSeenAt: r.first_seen_at,
    updatedAt: r.updated_at,
  };
}

export async function loadPositionState(symbol: string, market: Market): Promise<PositionState | null> {
  const pool = getPool();
  const [rows] = await pool.query<PositionRow[]>(
    `SELECT symbol, market, entry_price, peak_price, qty,
            scenario_exit, holding_deadline, first_seen_at, updated_at
       FROM position_state WHERE symbol=? AND market=? LIMIT 1`,
    [symbol, market],
  );
  if (rows.length === 0) return null;
  return rowToState(rows[0]);
}

/** 사용자 시나리오 진입 확정 시 호출 — scenario_exit·holding_deadline 1회 기록. */
export async function setPositionScenarioExit(
  symbol: string,
  market: Market,
  scenarioExit: ScenarioExitParams,
  holdingDeadline: Date | null,
): Promise<void> {
  const pool = getPool();
  await pool.query<ResultSetHeader>(
    `INSERT INTO position_state (symbol, market, entry_price, peak_price, qty, scenario_exit, holding_deadline)
     VALUES (?, ?, 0, 0, NULL, ?, ?)
     ON DUPLICATE KEY UPDATE
       scenario_exit    = VALUES(scenario_exit),
       holding_deadline = VALUES(holding_deadline)`,
    [symbol, market, JSON.stringify(scenarioExit), holdingDeadline ?? null],
  );
}

/**
 * 보유 포지션 1건 upsert. entry_price는 INSERT 시에만 설정 (재구매 평균가는 KIS 측에서 제공).
 * peak_price는 max(prev, currentPrice)로 갱신.
 */
export async function upsertPositionState(
  symbol: string,
  market: Market,
  currentPrice: number,
  avgPrice: number,
  qty: number | null,
): Promise<void> {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return;
  if (!Number.isFinite(avgPrice) || avgPrice <= 0) return;
  const pool = getPool();
  await pool.query<ResultSetHeader>(
    `INSERT INTO position_state (symbol, market, entry_price, peak_price, qty)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       entry_price = VALUES(entry_price),
       peak_price  = GREATEST(peak_price, VALUES(peak_price)),
       qty         = VALUES(qty)`,
    [symbol, market, avgPrice, currentPrice, qty],
  );
}

/**
 * 미보유 종목 row 일괄 삭제 (reconcile).
 * heldSymbols에 없는 row를 market 단위로 삭제.
 */
export async function reconcilePositionState(market: Market, heldSymbols: string[]): Promise<number> {
  const pool = getPool();
  if (heldSymbols.length === 0) {
    const [r] = await pool.query<ResultSetHeader>(
      `DELETE FROM position_state WHERE market=?`, [market],
    );
    return r.affectedRows;
  }
  const placeholders = heldSymbols.map(() => '?').join(',');
  const [r] = await pool.query<ResultSetHeader>(
    `DELETE FROM position_state WHERE market=? AND symbol NOT IN (${placeholders})`,
    [market, ...heldSymbols],
  );
  return r.affectedRows;
}

export async function clearPositionState(symbol: string, market: Market): Promise<void> {
  const pool = getPool();
  await pool.query(`DELETE FROM position_state WHERE symbol=? AND market=?`, [symbol, market]);
}
