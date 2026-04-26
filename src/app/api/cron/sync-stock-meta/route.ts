import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { fetchAllDomesticMaster } from '@/lib/exchanges/kis-master';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * POST /api/cron/sync-stock-meta
 *
 * KIS KOSPI/KOSDAQ 마스터(.mst)를 다운로드해 stock_meta 테이블 전 종목 upsert.
 * 매일 17:00 (KST) cron-runner에서 호출.
 */
export async function POST(req: NextRequest) {
  if (CRON_SECRET) {
    const auth = req.headers.get('x-cron-secret');
    if (auth !== CRON_SECRET) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
  }

  const startedAt = Date.now();
  try {
    const rows = await fetchAllDomesticMaster();
    if (rows.length === 0) {
      return NextResponse.json({ ok: false, error: 'master empty' }, { status: 502 });
    }

    const pool = getPool();
    const BATCH = 500;
    let upserted = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      const values = chunk.map(() => '(?, ?, ?)').join(',');
      const params: unknown[] = [];
      for (const r of chunk) {
        params.push(r.symbol, r.name, 'domestic');
      }
      await pool.query(
        `INSERT INTO stock_meta (symbol, name, market) VALUES ${values}
         ON DUPLICATE KEY UPDATE name = VALUES(name), market = VALUES(market)`,
        params,
      );
      upserted += chunk.length;
    }

    const elapsedMs = Date.now() - startedAt;
    console.log(`[sync-stock-meta] upserted=${upserted} elapsedMs=${elapsedMs}`);
    return NextResponse.json({ ok: true, upserted, elapsedMs });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[sync-stock-meta] error', error);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
