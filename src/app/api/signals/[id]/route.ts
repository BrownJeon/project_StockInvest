import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { getPool } from '@/lib/db';
import { withDisplayReasoning } from '@/lib/signals/exit-reason-display';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const id = Number((await params).id);
    if (!Number.isFinite(id)) {
      return Response.json({ ok: false, error: 'invalid id' }, { status: 400 });
    }

    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, strategy_id, symbol, side, order_type, price, quantity, amount_krw,
              reasoning, indicators, status, expires_at, valid_from, market,
              consumed_order_id, scenario_source, created_at, updated_at
       FROM signals
       WHERE id = ?
       LIMIT 1`,
      [id],
    );

    if (rows.length === 0) {
      return Response.json({ ok: false, error: 'not found' }, { status: 404 });
    }

    // T-128 A4 — 응답 `reasoning` 의 청산 앞머리만 표시 용어로(시나리오 상세 화면이 그대로 그린다 — DB 값은 불변)
    const row = withDisplayReasoning(rows[0]);
    // indicators는 JSON 문자열로 저장돼 있을 수 있음
    if (typeof row['indicators'] === 'string') {
      try { row['indicators'] = JSON.parse(row['indicators']); } catch { /* keep as string */ }
    }

    return Response.json({ ok: true, data: row });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/signals/:id GET]', error);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const id = Number((await params).id);
    if (!Number.isFinite(id)) {
      return Response.json({ ok: false, error: 'invalid id' }, { status: 400 });
    }

    const pool = getPool();
    const [result] = await pool.query<ResultSetHeader>(
      `DELETE FROM signals WHERE id = ? AND status = 'approved_pending_entry'`,
      [id],
    );

    if (result.affectedRows === 0) {
      return Response.json({ ok: false, error: 'not found or not cancellable' }, { status: 404 });
    }

    return Response.json({ ok: true });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/signals/:id DELETE]', error);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
