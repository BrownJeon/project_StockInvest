import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { kis } from '@/lib/exchanges/kis';

export const dynamic = 'force-dynamic';

const CRON_SECRET = process.env.CRON_SECRET;

interface SkippedRow extends RowDataPacket {
  id: number;
  symbol: string;
  price_at_skip: string;
}

export async function POST(req: NextRequest) {
  if (CRON_SECRET) {
    const auth = req.headers.get('x-cron-secret');
    if (auth !== CRON_SECRET) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
  }

  try {
    const pool = getPool();

    // 1h 이상 경과했지만 아직 price_1h_after가 없는 ai_skipped 시그널 조회
    const [rows] = await pool.query<SkippedRow[]>(
      `SELECT id, symbol, price_at_skip
       FROM signals
       WHERE status = 'ai_skipped'
         AND price_at_skip IS NOT NULL
         AND price_1h_after IS NULL
         AND created_at < DATE_SUB(NOW(), INTERVAL 1 HOUR)
         AND created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
       ORDER BY created_at DESC
       LIMIT 50`,
    );

    if (rows.length === 0) {
      return NextResponse.json({ ok: true, updated: 0 });
    }

    // 심볼별로 묶어 시세를 한 번만 조회
    const symbolSet = new Set(rows.map(r => r.symbol));
    const priceMap = new Map<string, number>();

    for (const symbol of symbolSet) {
      try {
        const ticker = await kis.getTicker(symbol);
        priceMap.set(symbol, ticker.price);
      } catch {
        // 시세 조회 실패 시 해당 심볼은 건너뜀
      }
    }

    let updated = 0;
    for (const row of rows) {
      const currentPrice = priceMap.get(row.symbol);
      if (currentPrice == null) continue;

      const skipPrice = Number(row.price_at_skip);
      if (skipPrice <= 0) continue;

      const changePct = ((currentPrice - skipPrice) / skipPrice) * 100;

      await pool.query(
        `UPDATE signals
         SET price_1h_after = ?, price_change_pct = ?
         WHERE id = ?`,
        [currentPrice, Math.round(changePct * 10000) / 10000, row.id],
      );
      updated++;
    }

    return NextResponse.json({ ok: true, updated, checked: rows.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
