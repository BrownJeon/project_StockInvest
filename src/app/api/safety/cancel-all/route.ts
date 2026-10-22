import { NextResponse } from 'next/server';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { kis } from '@/lib/exchanges/kis';

// POST /api/safety/cancel-all
// Cancels all pending/accepted orders. Acts as emergency liquidation trigger.
//
// 🔴 T-071 WP-1b — 취소 **결과를 본다.**
// `kis.cancelOrder` 는 KIS 의 HTTP·업무 오류를 예외가 아니라 `{ ok:false }` 로 돌려준다. 예전 코드는
// 결과를 보지 않고 `cancelled` UPDATE + `cancelled` 감사를 썼다 → 브로커에 **살아 있는 주문을 DB 에서
// 종결**시켜 order-sync 추적까지 끊었다(해외 취소 실패 실례: 주문 #2582 `HTTP 500`).
//  - `ok:true` 일 때만 `cancelled` 로 쓴다. 그것도 **대상 상태 그대로일 때만**(조건부 UPDATE) —
//    그 사이 체결돼 `filled`/`partially_filled` 가 된 행을 덮지 않는다.
//  - `ok:false` 면 상태를 바꾸지 않고 `cancel_failed` 로 남긴다(새 상태값 없음).
//  - 브로커 취소는 성공했는데 조건부 UPDATE 가 0행이면(그 사이 상태가 바뀜) `cancelled` 감사를 쓰지 않고
//    `cancel_requested` 로만 남긴다 — 실제 종결 판정은 order-sync 가 체결/미체결 목록으로 한다.
// 대상 쿼리와 취소 요청 수는 **바꾸지 않는다**(취소를 더 보내지 않는다). `partially_filled` 가 대상 밖인 점,
// 해외 취소 요청 형식(거래소 NASD·종목코드 빈값·수량 0 고정)은 WP-4 로 이월했다.
export async function POST() {
  const pool = getPool();

  interface ActiveRow extends RowDataPacket {
    id: number; exchange_order_id: string; symbol: string; side: string;
  }
  const [rows] = await pool.query<ActiveRow[]>(
    `SELECT id, exchange_order_id, symbol, side
     FROM orders
     WHERE status IN ('pending', 'accepted') AND exchange_order_id IS NOT NULL`,
  );

  const results: { id: number; ok: boolean; error?: string }[] = [];
  let unconfirmed = 0;

  for (const row of rows) {
    try {
      const result = await kis.cancelOrder({ symbol: row.symbol, exchangeOrderId: row.exchange_order_id });
      if (!result.ok) {
        const msg = String(result.error ?? 'cancel rejected');
        await pool.query(
          `INSERT INTO trade_logs (order_id, event, payload, occurred_at)
           VALUES (?, 'cancel_failed', JSON_OBJECT('reason','emergency_cancel_all','error',?), NOW())`,
          [row.id, msg],
        );
        results.push({ id: row.id, ok: false, error: msg });
        continue;
      }

      const [upd] = await pool.query<ResultSetHeader>(
        `UPDATE orders SET status='cancelled', updated_at=NOW()
         WHERE id=? AND status IN ('pending', 'accepted')`,
        [row.id],
      );
      const affected = (upd as { affectedRows?: unknown } | undefined)?.affectedRows;
      if (typeof affected === 'number' && affected > 0) {
        await pool.query(
          `INSERT INTO trade_logs (order_id, event, payload, occurred_at)
           VALUES (?, 'cancelled', JSON_OBJECT('reason','emergency_cancel_all'), NOW())`,
          [row.id],
        );
        results.push({ id: row.id, ok: true });
      } else {
        // 브로커는 취소 요청을 받았지만 DB 상태가 그 사이 바뀌었다(예: 체결) — 취소 확정으로 쓰지 않는다.
        unconfirmed++;
        await pool.query(
          `INSERT INTO trade_logs (order_id, event, payload, occurred_at)
           VALUES (?, 'cancel_requested', JSON_OBJECT('reason','emergency_cancel_all','note','status_changed_before_update'), NOW())`,
          [row.id],
        );
        results.push({
          id: row.id, ok: false,
          error: '취소 요청은 접수됐지만 그 사이 주문 상태가 바뀌어 취소로 확정하지 않았다 — 주문 상태를 확인하세요',
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await pool.query(
        `INSERT INTO trade_logs (order_id, event, payload, occurred_at)
         VALUES (?, 'cancel_failed', JSON_OBJECT('reason','emergency_cancel_all','error',?), NOW())`,
        [row.id, msg],
      );
      results.push({ id: row.id, ok: false, error: msg });
    }
  }

  const cancelled = results.filter(r => r.ok).length;
  const failed    = results.filter(r => !r.ok).length;

  return NextResponse.json({ ok: true, cancelled, failed, unconfirmed, results });
}
