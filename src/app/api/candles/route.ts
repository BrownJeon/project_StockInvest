import { kis } from '@/lib/exchanges/kis';
import { isAllowedSymbol } from '@/lib/symbols';

export const dynamic = 'force-dynamic';

// KIS는 4h 미지원 (분봉 1/3/5/10/15/30/60, 일봉 1d). 1w도 일봉 합성 미구현.
const ALLOWED_INTERVALS = new Set(['1m', '5m', '15m', '30m', '1h', '1d']);

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const symbol = url.searchParams.get('symbol');
    const interval = url.searchParams.get('interval') ?? '1h';
    const countStr = url.searchParams.get('count') ?? '200';
    const count = Math.min(Math.max(Number(countStr), 1), 500);

    if (!symbol) return Response.json({ ok: false, error: 'symbol required' }, { status: 400 });
    if (!isAllowedSymbol(symbol)) return Response.json({ ok: false, error: `symbol not allowed: ${symbol}` }, { status: 400 });
    if (!ALLOWED_INTERVALS.has(interval)) return Response.json({ ok: false, error: `interval not allowed: ${interval}` }, { status: 400 });

    const data = await kis.getCandles(symbol, interval, count);
    return Response.json({ ok: true, data });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/candles]', error);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
