import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';

/**
 * 이 값을 넘긴 판단보류는 "구조적 상태"로 취급한다 — 30분 반복 critical 알림을 멈추고
 * 1회성 알림 + 대시보드 추적으로 전환한다. board.md 합의값(2026-08-12).
 */
export const STRUCTURAL_MS = 2 * 60 * 60_000;

export interface StaleTrackingRow {
  orderId: number;
  symbol: string;
  firstStaleAt: number;
  escalatedAt: number | null;
}

interface TrackingDbRow extends RowDataPacket {
  order_id: number;
  symbol: string;
  first_stale_at: Date;
  escalated_at: Date | null;
}

function toRow(r: TrackingDbRow): StaleTrackingRow {
  return {
    orderId: r.order_id,
    symbol: r.symbol,
    firstStaleAt: r.first_stale_at.getTime(),
    escalatedAt: r.escalated_at ? r.escalated_at.getTime() : null,
  };
}

/** 주어진 주문 id들의 추적 상태를 조회한다. 없는 id는 결과 Map에 없다. */
export async function getStaleTracking(orderIds: number[]): Promise<Map<number, StaleTrackingRow>> {
  const map = new Map<number, StaleTrackingRow>();
  if (orderIds.length === 0) return map;
  const pool = getPool();
  const [rows] = await pool.query<TrackingDbRow[]>(
    `SELECT order_id, symbol, first_stale_at, escalated_at
     FROM order_sync_stale_tracking WHERE order_id IN (?)`,
    [orderIds],
  );
  for (const r of rows) map.set(r.order_id, toRow(r));
  return map;
}

/** 처음으로 30분 반복 대상이 된 주문을 기록한다. 이미 있으면 아무 것도 하지 않는다. */
export async function recordFirstStale(orderId: number, symbol: string, firstStaleAtMs: number): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT IGNORE INTO order_sync_stale_tracking (order_id, symbol, first_stale_at) VALUES (?, ?, ?)`,
    [orderId, symbol, new Date(firstStaleAtMs)],
  );
}

/** 구조적 상태로 전환된 시각을 기록한다 — 이후 반복 알림 대상에서 제외하는 잠금 신호. */
export async function markEscalated(orderId: number, nowMs: number): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE order_sync_stale_tracking SET escalated_at = ? WHERE order_id = ?`,
    [new Date(nowMs), orderId],
  );
}

/**
 * 이번 라운드에 더 이상 판단보류가 아닌(=r.unreconciled에서 사라진) 주문의 추적 행을 지운다.
 * 다음에 같은 주문(또는 다른 주문)이 다시 걸리면 처음부터 다시 시작하게 하는 "해제" 동작.
 */
export async function clearResolved(stillUnreconciledIds: number[]): Promise<void> {
  const pool = getPool();
  if (stillUnreconciledIds.length === 0) {
    await pool.query(`DELETE FROM order_sync_stale_tracking`);
    return;
  }
  await pool.query(
    `DELETE FROM order_sync_stale_tracking WHERE order_id NOT IN (?)`,
    [stillUnreconciledIds],
  );
}

/** 대시보드용 — 현재 추적 중인 전체 목록. */
export async function listStaleTracking(): Promise<StaleTrackingRow[]> {
  const pool = getPool();
  const [rows] = await pool.query<TrackingDbRow[]>(
    `SELECT order_id, symbol, first_stale_at, escalated_at
     FROM order_sync_stale_tracking ORDER BY first_stale_at ASC`,
  );
  return rows.map(toRow);
}
