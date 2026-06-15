import { getPool } from '@/lib/db';
import { kis } from '@/lib/exchanges/kis';
import type { RowDataPacket } from 'mysql2';

export const dynamic = 'force-dynamic';

const TRAILING_ACTIVATE_PCT = 2.5;
const TRAILING_DRAWDOWN_PCT = 1.5;

export async function GET() {
  const pool = getPool();
  try {
    const [rows] = await pool.query<RowDataPacket[]>(`
      SELECT
        ps.symbol, ps.market, ps.entry_price, ps.peak_price, ps.qty,
        sm.name
      FROM position_state ps
      LEFT JOIN stock_meta sm ON sm.symbol = ps.symbol
      WHERE ps.qty > 0
      ORDER BY ps.updated_at DESC
    `);

    if (!rows.length) return Response.json({ ok: true, data: [] });

    // 해외주식이 있으면 USD/KRW 환율 조회
    let usdKrwRate: number | null = null;
    const hasOverseas = rows.some((r) => r.market === 'overseas');
    if (hasOverseas) {
      const [[fxRow]] = await pool.query<RowDataPacket[]>(
        "SELECT rate FROM fx_rates WHERE pair = 'USD/KRW' LIMIT 1",
      );
      usdKrwRate = fxRow ? Number(fxRow.rate) : null;
    }

    // 실시간 가격 조회 (병렬)
    const data = await Promise.all(
      rows.map(async (row) => {
        const symbol = row.symbol as string;
        const market = row.market as string;
        const entryPrice = Number(row.entry_price);
        const peakPrice = Number(row.peak_price);
        const qty = Number(row.qty);

        let currentPrice: number | null = null;
        try {
          const ticker = await kis.getTicker(symbol);
          currentPrice = ticker.price ?? null;
        } catch { /* ignore */ }

        const pnlPct = currentPrice != null
          ? ((currentPrice - entryPrice) / entryPrice) * 100
          : null;

        const peakGainPct = entryPrice > 0
          ? ((peakPrice - entryPrice) / entryPrice) * 100
          : 0;

        const trailingActive = peakGainPct >= TRAILING_ACTIVATE_PCT;
        const stopPrice = peakPrice * (1 - TRAILING_DRAWDOWN_PCT / 100);

        const drawdownFromPeak = currentPrice != null && peakPrice > 0
          ? ((peakPrice - currentPrice) / peakPrice) * 100
          : null;

        const danger = trailingActive && drawdownFromPeak != null && drawdownFromPeak >= 1.0;

        // 해외주식: KRW→USD 변환 (position_state는 KRW 저장)
        const usdRate = market === 'overseas' ? usdKrwRate : null;

        return {
          symbol,
          name: row.name as string | null,
          market,
          entryPrice,
          peakPrice,
          currentPrice,
          qty,
          pnlPct,
          peakGainPct,
          trailingActive,
          stopPrice: trailingActive ? stopPrice : null,
          drawdownFromPeak,
          danger,
          usdRate,
        };
      }),
    );

    return Response.json({ ok: true, data });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/positions/status]', error);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
