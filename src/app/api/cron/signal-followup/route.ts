import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { kis } from '@/lib/exchanges/kis';
import { fireAndForgetUpsertSignal } from '@/lib/rag/signals-upsert';
import type { SignalForEmbedding } from '@/lib/rag/format';

export const dynamic = 'force-dynamic';

const CRON_SECRET = process.env.CRON_SECRET;

interface SkippedRow extends RowDataPacket {
  id: number;
  symbol: string;
  price_at_skip: string;
}

/**
 * D-11: 24h 라벨 갱신된 시그널들을 KB(Qdrant) 에 재인덱싱.
 *
 * 갱신된 row 의 모든 컬럼 + price_change_pct_* 라벨을 SignalForEmbedding 으로 매핑해
 * 동일 결정적 UUID 로 upsert (signals-upsert.ts 의 signalIdToUuid).
 *
 * fire-and-forget — main flow 차단 없음. 실패는 로그만.
 *
 * 반환: enqueue 한 시그널 수 (실제 upsert 성공 수가 아님)
 */
async function reindexSignalsToKb(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const pool = getPool();
  const placeholders = ids.map(() => '?').join(',');
  type FullRow = RowDataPacket & {
    id: number; symbol: string; side: 'buy'|'sell'; strategy_id: string|null;
    market: string|null; status: string|null; price: string|null;
    reasoning: string|null; indicators: string|null; created_at: Date|string;
    price_change_pct: number|null;       // 1h
    price_change_pct_4h: number|null;
    price_change_pct_24h: number|null;
    price_1h_after: number|null;
    price_4h_after: number|null;
    price_24h_after: number|null;
  };
  const [rows] = await pool.query<FullRow[]>(
    `SELECT id, symbol, side, strategy_id, market, status, price, reasoning, indicators, created_at,
            price_change_pct, price_change_pct_4h, price_change_pct_24h,
            price_1h_after, price_4h_after, price_24h_after
       FROM signals WHERE id IN (${placeholders})`,
    ids,
  );

  for (const r of rows) {
    let indicators: Record<string, unknown> | null = null;
    if (r.indicators) {
      try { indicators = typeof r.indicators === 'string' ? JSON.parse(r.indicators) : r.indicators; }
      catch { indicators = null; }
    }
    const num = (v: unknown): number | null => v == null ? null : (Number.isFinite(Number(v)) ? Number(v) : null);
    const hitOf = (after: unknown): boolean | null => {
      const a = num(after);
      const p = num(r.price);
      if (a == null || p == null) return null;
      return (r.side === 'buy' && a > p) || (r.side === 'sell' && a < p);
    };
    const signal: SignalForEmbedding & { id: number } = {
      id: r.id,
      symbol: r.symbol,
      side: r.side,
      strategyId: r.strategy_id,
      market: r.market,
      status: r.status,
      price: num(r.price),
      reasoning: r.reasoning,
      indicators,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at ?? ''),
      priceChangePct1h:  num(r.price_change_pct),
      priceChangePct4h:  num(r.price_change_pct_4h),
      priceChangePct24h: num(r.price_change_pct_24h),
      hit1h:  hitOf(r.price_1h_after),
      hit4h:  hitOf(r.price_4h_after),
      hit24h: hitOf(r.price_24h_after),
    };
    fireAndForgetUpsertSignal(signal);
  }
  return rows.length;
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
    // D-11: 24h 윈도우에서 갱신된 signal id 모음 → 후속 KB 재인덱싱
    const updatedFor24h: number[] = [];

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
        // D-11: 24h 라벨이 들어가는 시점에 KB 재인덱싱 큐에 등록 (가장 정보 충분한 상태)
        if (w.hours === 24) updatedFor24h.push(row.id);
      }
    }

    // D-11: 24h 라벨 갱신된 시그널들 KB 재인덱싱 (fire-and-forget)
    // closed-loop RAG 보장 — 사후 P&L 결과가 다음 분석 호출 시 컨텍스트로 들어가도록
    let reindexedCount = 0;
    if (updatedFor24h.length > 0) {
      reindexedCount = await reindexSignalsToKb(updatedFor24h);
    }

    const totalUpdated = Object.values(perWindow).reduce((s, w) => s + w.updated, 0);
    const totalChecked = Object.values(perWindow).reduce((s, w) => s + w.checked, 0);
    return NextResponse.json({
      ok: true,
      updated: totalUpdated,
      checked: totalChecked,
      windows: perWindow,
      reindexed: reindexedCount,   // D-11
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
