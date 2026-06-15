import { updateRsRatings } from '@/lib/strategy/rs-rating';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const market = (url.searchParams.get('market') ?? 'domestic') as 'domestic' | 'overseas';

  console.log(`[cron/rs-update] start market=${market}`);
  try {
    const updated = await updateRsRatings(market);
    console.log(`[cron/rs-update] done updated=${updated}`);
    return Response.json({ ok: true, updated, market });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[cron/rs-update] error', error);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
