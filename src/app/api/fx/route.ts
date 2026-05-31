import { getUsdKrwRate } from '@/lib/exchanges/fx';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rate = await getUsdKrwRate();
    return Response.json({ ok: true, rate });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error, rate: 1380 }, { status: 500 });
  }
}
