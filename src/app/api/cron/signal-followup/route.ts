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

/**
 * 윈도우 정의 — 1h/4h/24h 각각의 follow-up 컬럼 매핑.
 * Phase Q: 장기 라벨(24h) 우선 사용으로 fine-tune 노이즈 감소.
 * lookbackDays 차등: 24h 윈도우는 7일 안에서 후보가 부족할 수 있어 14일까지 허용.
 */
const WINDOWS: ReadonlyArray<{
  hours: number;
  priceCol: 'price_1h_after' | 'price_4h_after' | 'price_24h_after';
  pctCol:   'price_change_pct' | 'price_change_pct_4h' | 'price_change_pct_24h';
  lookbackDays: number;
}> = [
  { hours: 1,  priceCol: 'price_1h_after',  pctCol: 'price_change_pct',     lookbackDays: 7 },
  { hours: 4,  priceCol: 'price_4h_after',  pctCol: 'price_change_pct_4h',  lookbackDays: 7 },
  { hours: 24, priceCol: 'price_24h_after', pctCol: 'price_change_pct_24h', lookbackDays: 14 },
];

export async function POST(req: NextRequest) {
  if (CRON_SECRET) {
    const auth = req.headers.get('x-cron-secret');
    if (auth !== CRON_SECRET) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
  }

  try {
    const pool = getPool();
    const priceCache = new Map<string, number>();
    const perWindow: Record<string, { checked: number; updated: number }> = {};

    for (const w of WINDOWS) {
      const [rows] = await pool.query<SkippedRow[]>(
        `SELECT id, symbol, price_at_skip
         FROM signals
         WHERE status = 'ai_skipped'
           AND price_at_skip IS NOT NULL
           AND ${w.priceCol} IS NULL
           AND created_at < DATE_SUB(NOW(), INTERVAL ? HOUR)
           AND created_at > DATE_SUB(NOW(), INTERVAL ? DAY)
         ORDER BY created_at DESC
         LIMIT 50`,
        [w.hours, w.lookbackDays],
      );

      perWindow[`${w.hours}h`] = { checked: rows.length, updated: 0 };
      if (rows.length === 0) continue;

      // ticker fetch — 같은 cron tick 내에서 캐시 공유 (3 윈도우 공통)
      const symbolsNeeded = new Set(rows.map(r => r.symbol).filter(s => !priceCache.has(s)));
      for (const symbol of symbolsNeeded) {
        try {
          const ticker = await kis.getTicker(symbol);
          priceCache.set(symbol, ticker.price);
        } catch {
          // 시세 조회 실패 — 해당 심볼 건너뜀
        }
      }

      for (const row of rows) {
        const currentPrice = priceCache.get(row.symbol);
        if (currentPrice == null) continue;

        const skipPrice = Number(row.price_at_skip);
        if (skipPrice <= 0) continue;

        const changePct = ((currentPrice - skipPrice) / skipPrice) * 100;

        await pool.query(
          `UPDATE signals SET ${w.priceCol} = ?, ${w.pctCol} = ? WHERE id = ?`,
          [currentPrice, Math.round(changePct * 10000) / 10000, row.id],
        );
        perWindow[`${w.hours}h`].updated++;
      }
    }

    const totalUpdated = Object.values(perWindow).reduce((s, w) => s + w.updated, 0);
    const totalChecked = Object.values(perWindow).reduce((s, w) => s + w.checked, 0);
    return NextResponse.json({
      ok: true,
      updated: totalUpdated,
      checked: totalChecked,
      windows: perWindow,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
