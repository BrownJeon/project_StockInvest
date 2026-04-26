import { kis } from '@/lib/exchanges/kis';
import { isAllowedSymbol } from '@/lib/symbols';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const symbol = url.searchParams.get('symbol');
    if (!symbol) return Response.json({ ok: false, error: 'symbol required' }, { status: 400 });
    if (!isAllowedSymbol(symbol)) return Response.json({ ok: false, error: `symbol not allowed: ${symbol}` }, { status: 400 });

    const data = await kis.getTicker(symbol);
    return Response.json({ ok: true, data });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/ticker]', error);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
