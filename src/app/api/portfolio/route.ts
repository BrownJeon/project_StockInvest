import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { kis } from '@/lib/exchanges/kis';
import type { Ticker } from '@/lib/exchanges/types';
import { kstTodayStart } from '@/lib/time';
import { getMarketFromSymbol } from '@/lib/exchanges/kis-symbols';
import { usdToKrw } from '@/lib/exchanges/fx';

export const dynamic = 'force-dynamic';

interface HoldingView {
  currency: string;
  symbol: string | null;
  qty: number;
  price: number;
  value_krw: number;
  open24h_krw: number;
  change_24h_pct: number | null;
  is_cash: boolean;
}

async function saveSnapshot(totalKRW: number, holdings: HoldingView[]): Promise<void> {
  try {
    const pool = getPool();
    const positions = holdings.map((h) => ({
      currency: h.currency, qty: h.qty, price: h.price, value_krw: h.value_krw,
    }));
    await pool.query(
      'INSERT INTO portfolio_snapshots (ts, total_krw, positions, source) VALUES (?, ?, ?, ?)',
      [new Date(), Math.round(totalKRW), JSON.stringify(positions), 'dashboard'],
    );
  } catch (e) {
    console.error('[portfolio] snapshot save failed:', e);
  }
}

async function fetchTodayOpenKRW(): Promise<number | null> {
  try {
    const pool = getPool();
    const start = kstTodayStart();
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT total_krw FROM portfolio_snapshots WHERE ts <= ? ORDER BY ts DESC LIMIT 1',
      [start],
    );
    const row = rows[0];
    if (!row) return null;
    return Number(row.total_krw);
  } catch (e) {
    console.error('[portfolio] today open fetch failed:', e);
    return null;
  }
}

export async function GET() {
  try {
    const balances = await kis.getBalances();
    const DUST_THRESHOLD_KRW = 10_000;

    // 보유 종목 (현금 KRW/USD 제외) — symbol == currency (국내 6자리 또는 해외 EXCD:TICKER)
    const stockHoldings = balances.filter((b) => b.currency !== 'KRW' && b.currency !== 'USD' && (b.free + b.locked) > 0);
    const tickerResults = await Promise.allSettled(
      stockHoldings.map((b) => kis.getTicker(b.currency)),
    );
    const tickerMap = new Map<string, Ticker>();
    tickerResults.forEach((r, i) => {
      if (r.status === 'fulfilled') tickerMap.set(stockHoldings[i].currency, r.value);
    });

    // FX 1회 조회 (USD 환산용)
    let usdKrwRate = 0;
    try { usdKrwRate = await usdToKrw(1); } catch { /* fx 실패 시 USD 잔고 0 처리 */ }

    const holdings: HoldingView[] = await Promise.all(balances.map(async (b): Promise<HoldingView> => {
      const qty = b.free + b.locked;
      if (b.currency === 'KRW') {
        return {
          currency: 'KRW', symbol: null, qty,
          price: 1, value_krw: qty, open24h_krw: qty,
          change_24h_pct: 0, is_cash: true,
        };
      }
      if (b.currency === 'USD') {
        const value_krw = usdKrwRate > 0 ? qty * usdKrwRate : 0;
        return {
          currency: 'USD', symbol: null, qty,
          price: usdKrwRate, value_krw, open24h_krw: value_krw,
          change_24h_pct: 0, is_cash: true,
        };
      }
      const t = tickerMap.get(b.currency);
      const price = t?.price ?? 0;
      const open = t?.open24h ?? price;
      const isOverseas = getMarketFromSymbol(b.currency) === 'overseas';
      // 해외 종목은 USD 가격 → KRW 환산
      const fxMul = isOverseas && usdKrwRate > 0 ? usdKrwRate : 1;
      const value_krw = qty * price * fxMul;
      const open24h_krw = qty * open * fxMul;
      const change_24h_pct = open > 0 ? ((price - open) / open) * 100 : null;
      return {
        currency: b.currency, symbol: b.currency, qty,
        price, value_krw, open24h_krw, change_24h_pct, is_cash: false,
      };
    }));

    const total_krw = holdings.reduce((s, h) => s + h.value_krw, 0);
    const visibleHoldings = holdings.filter((h) => h.is_cash || h.value_krw >= DUST_THRESHOLD_KRW);
    const total_open24h_krw = holdings.reduce((s, h) => s + h.open24h_krw, 0);
    const change_24h_krw = total_krw - total_open24h_krw;
    const change_24h_pct = total_open24h_krw > 0 ? (change_24h_krw / total_open24h_krw) * 100 : 0;
    const cash_krw = holdings.filter((h) => h.is_cash).reduce((s, h) => s + h.value_krw, 0);
    const cash_pct = total_krw > 0 ? (cash_krw / total_krw) * 100 : 0;

    // 오늘 00:00 KST 기준 시작값 조회 + 현재 값 스냅샷 저장 (병렬)
    const [today_open_krw] = await Promise.all([
      fetchTodayOpenKRW(),
      saveSnapshot(total_krw, holdings),
    ]);
    const today_change_krw = today_open_krw != null ? total_krw - today_open_krw : null;
    const today_change_pct =
      today_open_krw != null && today_open_krw > 0
        ? ((total_krw - today_open_krw) / today_open_krw) * 100
        : null;

    return Response.json({
      ok: true,
      data: {
        total_krw,
        cash_krw,
        cash_pct,
        change_24h_krw,
        change_24h_pct,
        today_open_krw,
        today_change_krw,
        today_change_pct,
        holdings: visibleHoldings,
        updated_at: new Date().toISOString(),
      },
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/portfolio]', error);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
