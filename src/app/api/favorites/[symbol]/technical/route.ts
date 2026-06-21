import { NextRequest } from 'next/server';
import { kis } from '@/lib/exchanges/kis';
import { buildMarketSummary } from '@/lib/strategy/ai-filter';
import { classifyMarketState, type MarketStateCategory } from '@/lib/strategy/market-state';

export interface TechnicalData {
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  ema20: number | null;
  ema60: number | null;
  bbUpper: number | null;
  bbMiddle: number | null;
  bbLower: number | null;
  bbPosition: number | null;
  marketState: MarketStateCategory;
  volumeRatio: number;
  periodHighDays: number;
  periodHigh: number | null;
  periodLow: number | null;
  periodPosition: number | null;
  atr14: number | null;
  poc: number | null;
  vah: number | null;
  val: number | null;
  priceChange5: number;
  currentPrice: number;
  updatedAt: string;
}

const cache = new Map<string, { data: TechnicalData; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function GET(
  _req: NextRequest,
  { params }: { params: { symbol: string } },
) {
  const { symbol } = params;
  if (!symbol) {
    return Response.json({ ok: false, error: 'symbol required' }, { status: 400 });
  }

  const cached = cache.get(symbol);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return Response.json({ ok: true, data: cached.data, cached: true });
  }

  try {
    const [ticker, intraCandlesRaw, dailyCandlesRaw] = await Promise.all([
      kis.getTicker(symbol),
      kis.getCandles(symbol, '30m', 100).catch(() => [] as Awaited<ReturnType<typeof kis.getCandles>>),
      kis.getCandles(symbol, '1d', 120).catch(() => [] as Awaited<ReturnType<typeof kis.getCandles>>),
    ]);

    const intraCandles = intraCandlesRaw.length > 0 ? intraCandlesRaw : dailyCandlesRaw;
    const summary = buildMarketSummary(intraCandles, ticker);
    const marketState = classifyMarketState(summary);

    const bbUpper = summary.bbUpper ?? null;
    const bbLower = summary.bbLower ?? null;
    const bbPosition =
      bbUpper != null && bbLower != null && bbUpper > bbLower
        ? Math.min(1, Math.max(0, (ticker.price - bbLower) / (bbUpper - bbLower)))
        : null;

    let periodHigh: number | null = null;
    let periodLow: number | null = null;
    let periodPosition: number | null = null;
    const periodHighDays = dailyCandlesRaw.length;

    if (dailyCandlesRaw.length > 0) {
      periodHigh = Math.max(...dailyCandlesRaw.map(c => c.high));
      periodLow = Math.min(...dailyCandlesRaw.map(c => c.low));
      if (periodHigh > periodLow) {
        periodPosition = Math.min(100, Math.max(0,
          ((ticker.price - periodLow) / (periodHigh - periodLow)) * 100,
        ));
      }
    }

    const data: TechnicalData = {
      rsi14: summary.rsi14 ?? null,
      macd: summary.macd ?? null,
      macdSignal: summary.macdSignal ?? null,
      macdHistogram: summary.macdHistogram ?? null,
      ema20: summary.ema20 ?? null,
      ema60: summary.ema60 ?? null,
      bbUpper,
      bbMiddle: summary.bbMiddle ?? null,
      bbLower,
      bbPosition,
      marketState,
      volumeRatio: summary.volumeRatio,
      periodHighDays,
      periodHigh,
      periodLow,
      periodPosition,
      atr14: summary.atr14 ?? null,
      poc: summary.poc ?? null,
      vah: summary.vah ?? null,
      val: summary.val ?? null,
      priceChange5: summary.priceChange5,
      currentPrice: ticker.price,
      updatedAt: new Date().toISOString(),
    };

    cache.set(symbol, { data, ts: Date.now() });
    return Response.json({ ok: true, data, cached: false });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[api/favorites/technical] ${symbol}:`, error);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
