import { getLeaders } from '@/lib/strategy/rs-rating';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const market = (url.searchParams.get('market') ?? 'domestic') as 'domestic' | 'overseas' | 'all';
    const minRs = Number(url.searchParams.get('min_rs') ?? 0);
    const requireNear52w = url.searchParams.get('near52w') === '1';
    const requireVolSpike = url.searchParams.get('vol_spike') === '1';

    const data = await getLeaders(market, { minRs, requireNear52w, requireVolSpike });
    return Response.json({ ok: true, data });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
