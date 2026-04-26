import { isDomesticOpen, isOverseasOpen, getCurrentMarket, isUSDST, nextOpenAt } from '@/lib/strategy/market-hours';
import { getUsdKrwRate, usdToKrw } from '@/lib/exchanges/fx';
import { kis } from '@/lib/exchanges/kis';
import type { Ticker } from '@/lib/exchanges/types';
import { getMarketFromSymbol } from '@/lib/exchanges/kis-symbols';

export const dynamic = 'force-dynamic';

interface MarketBalance {
  cash: number;
  cashCurrency: 'KRW' | 'USD';
  cashKRW: number;
  holdingsCount: number;
  holdingsValueKRW: number;
  totalKRW: number;
}

async function computeMarketBalances(): Promise<{ domestic: MarketBalance; overseas: MarketBalance } | null> {
  try {
    const balances = await kis.getBalances();
    const domHoldings = balances.filter(b => b.currency !== 'KRW' && b.currency !== 'USD' && getMarketFromSymbol(b.currency) === 'domestic' && (b.free + b.locked) > 0);
    const ovsHoldings = balances.filter(b => b.currency !== 'KRW' && b.currency !== 'USD' && getMarketFromSymbol(b.currency) === 'overseas' && (b.free + b.locked) > 0);
    const krwCash = Number(balances.find(b => b.currency === 'KRW')?.free ?? 0);
    const usdCash = Number(balances.find(b => b.currency === 'USD')?.free ?? 0);

    const tickerResults = await Promise.allSettled([
      ...domHoldings.map(b => kis.getTicker(b.currency)),
      ...ovsHoldings.map(b => kis.getTicker(b.currency)),
    ]);
    const tmap = new Map<string, Ticker>();
    [...domHoldings, ...ovsHoldings].forEach((b, i) => {
      const r = tickerResults[i];
      if (r.status === 'fulfilled') tmap.set(b.currency, r.value);
    });

    const domHoldingsKRW = domHoldings.reduce((s, b) => {
      const qty = b.free + b.locked;
      const price = Number(tmap.get(b.currency)?.price ?? 0);
      return s + qty * price;
    }, 0);
    const ovsHoldingsUSD = ovsHoldings.reduce((s, b) => {
      const qty = b.free + b.locked;
      const price = Number(tmap.get(b.currency)?.price ?? 0);
      return s + qty * price;
    }, 0);

    const usdCashKRW = usdCash > 0 ? await usdToKrw(usdCash).catch(() => 0) : 0;
    const ovsHoldingsKRW = ovsHoldingsUSD > 0 ? await usdToKrw(ovsHoldingsUSD).catch(() => 0) : 0;

    return {
      domestic: {
        cash: krwCash,
        cashCurrency: 'KRW',
        cashKRW: krwCash,
        holdingsCount: domHoldings.length,
        holdingsValueKRW: domHoldingsKRW,
        totalKRW: krwCash + domHoldingsKRW,
      },
      overseas: {
        cash: usdCash,
        cashCurrency: 'USD',
        cashKRW: usdCashKRW,
        holdingsCount: ovsHoldings.length,
        holdingsValueKRW: ovsHoldingsKRW,
        totalKRW: usdCashKRW + ovsHoldingsKRW,
      },
    };
  } catch (e) {
    console.error('[markets/status] balance breakdown failed:', e);
    return null;
  }
}

/**
 * GET /api/markets/status
 *
 * 응답:
 *  - current: 현재 열린 시장 ('domestic'|'overseas'|null)
 *  - domestic / overseas: { open, nextOpenAt(ISO), nextOpenInMs, sessionLabel, balance? }
 *  - usDST: 미국 동부가 EDT(서머타임) 중인지
 *  - fx: { usdKrw, fetchedAt(ISO) }
 *  - now: 서버 현재 시각 (ISO)
 *
 * 쿼리: ?balance=1 시 시장별 잔고 합산 포함 (KIS 호출 필요 — 느릴 수 있음)
 */
export async function GET(req: Request) {
  const now = new Date();
  const includeBalance = new URL(req.url).searchParams.get('balance') === '1';
  try {
    const [current, domesticOpen, overseasOpen, usdKrw, balances] = await Promise.all([
      getCurrentMarket(now),
      isDomesticOpen(now),
      isOverseasOpen(now),
      getUsdKrwRate().catch(() => null),
      includeBalance ? computeMarketBalances() : Promise.resolve(null),
    ]);
    const dNext = nextOpenAt('domestic', now);
    const oNext = nextOpenAt('overseas', now);
    return Response.json({
      ok: true,
      current,
      domestic: {
        open: domesticOpen,
        nextOpenAt: new Date(dNext).toISOString(),
        nextOpenInMs: domesticOpen ? 0 : Math.max(0, dNext - now.getTime()),
        sessionLabel: '평일 09:00–15:30 KST',
        balance: balances?.domestic ?? null,
      },
      overseas: {
        open: overseasOpen,
        nextOpenAt: new Date(oNext).toISOString(),
        nextOpenInMs: overseasOpen ? 0 : Math.max(0, oNext - now.getTime()),
        sessionLabel: isUSDST(now) ? '평일 22:30–05:00 KST (EDT)' : '평일 23:30–06:00 KST (EST)',
        balance: balances?.overseas ?? null,
      },
      usDST: isUSDST(now),
      fx: usdKrw ? { usdKrw, fetchedAt: new Date().toISOString() } : null,
      now: now.toISOString(),
    });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
