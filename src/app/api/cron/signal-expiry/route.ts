import { NextRequest, NextResponse } from 'next/server';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { checkCronAuth } from '@/lib/cron-auth';
import { EXPIRABLE_STATUSES, sqlStatusList } from '@/lib/signals/statuses';

export const dynamic = 'force-dynamic';

interface ExpiredRow extends RowDataPacket {
  id: number;
  symbol: string;
  side: string;
}

export async function POST(req: NextRequest) {
  const authErr = checkCronAuth(req);
  if (authErr) return authErr;

  try {
    const pool = getPool();

    const [rows] = await pool.query<ExpiredRow[]>(
      // 신규 awaiting_approval·detected + 구 pending/pending_approval 전부 TTL 만료 대상 (§4-1)
      `SELECT id, symbol, side FROM signals
       WHERE status IN (${sqlStatusList(EXPIRABLE_STATUSES)})
         AND expires_at IS NOT NULL
         AND expires_at < NOW()`,
    );

    if (rows.length === 0) {
      return NextResponse.json({ ok: true, expired: 0 });
    }

    const ids = rows.map(r => r.id);
    const [result] = await pool.query<ResultSetHeader>(
      `UPDATE signals SET status = 'expired', updated_at = NOW()
       WHERE id IN (${ids.map(() => '?').join(',')})`,
      ids,
    );

    // 만료된 시그널마다 감사 로그 기록
    for (const row of rows) {
      await pool.query(
        `INSERT INTO trade_logs (order_id, event, payload) VALUES (?, ?, ?)`,
        [null, 'signal_expired', JSON.stringify({ signalId: row.id, symbol: row.symbol, side: row.side })],
      );
    }

    return NextResponse.json({ ok: true, expired: result.affectedRows });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
