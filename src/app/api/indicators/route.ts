import { kis } from '@/lib/exchanges/kis';
import { isAllowedSymbol } from '@/lib/symbols';
import { sma, ema, rsi, macd, bollinger, atr } from '@/lib/strategy/indicators';

export const dynamic = 'force-dynamic';

const ALLOWED_TYPES = new Set(['sma', 'ema', 'rsi', 'macd', 'bollinger', 'atr', 'all']);
const ALLOWED_INTERVALS = new Set(['1m', '5m', '15m', '30m', '1h', '1d']);

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const symbol   = url.searchParams.get('symbol');
    const type     = url.searchParams.get('type') ?? 'all';
    const interval = url.searchParams.get('interval') ?? '1h';
    const countStr = url.searchParams.get('count') ?? '200';
    const count    = Math.min(Math.max(Number(countStr), 50), 500);

    // Params: optional overrides for indicator periods
    const smaPeriod  = Number(url.searchParams.get('sma_period')  ?? 20);
    const emaPeriod  = Number(url.searchParams.get('ema_period')  ?? 20);
    const rsiPeriod  = Number(url.searchParams.get('rsi_period')  ?? 14);
    const bbPeriod   = Number(url.searchParams.get('bb_period')   ?? 20);
    const bbK        = Number(url.searchParams.get('bb_k')        ?? 2);
    const atrPeriod  = Number(url.searchParams.get('atr_period')  ?? 14);
    const macdFast   = Number(url.searchParams.get('macd_fast')   ?? 12);
    const macdSlow   = Number(url.searchParams.get('macd_slow')   ?? 26);
    const macdSignal = Number(url.searchParams.get('macd_signal') ?? 9);

    if (!symbol) return Response.json({ ok: false, error: 'symbol required' }, { status: 400 });
    if (!isAllowedSymbol(symbol)) return Response.json({ ok: false, error: `symbol not allowed: ${symbol}` }, { status: 400 });
    if (!ALLOWED_TYPES.has(type)) return Response.json({ ok: false, error: `type not allowed: ${type}` }, { status: 400 });
    if (!ALLOWED_INTERVALS.has(interval)) return Response.json({ ok: false, error: `interval not allowed: ${interval}` }, { status: 400 });

    const candles = await kis.getCandles(symbol, interval, count);
    const closes  = candles.map(c => c.close);

    const result: Record<string, unknown> = { symbol, interval, count: candles.length };

    if (type === 'sma' || type === 'all') {
      result.sma = { period: smaPeriod, values: sma(closes, smaPeriod) };
    }
    if (type === 'ema' || type === 'all') {
      result.ema = { period: emaPeriod, values: ema(closes, emaPeriod) };
    }
    if (type === 'rsi' || type === 'all') {
      result.rsi = { period: rsiPeriod, values: rsi(closes, rsiPeriod) };
    }
    if (type === 'macd' || type === 'all') {
      result.macd = { fast: macdFast, slow: macdSlow, signal: macdSignal, values: macd(closes, macdFast, macdSlow, macdSignal) };
    }
    if (type === 'bollinger' || type === 'all') {
      result.bollinger = { period: bbPeriod, k: bbK, values: bollinger(closes, bbPeriod, bbK) };
    }
    if (type === 'atr' || type === 'all') {
      result.atr = { period: atrPeriod, values: atr(candles, atrPeriod) };
    }

    return Response.json({ ok: true, ...result });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/indicators]', error);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
