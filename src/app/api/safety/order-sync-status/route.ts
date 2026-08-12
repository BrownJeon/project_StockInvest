import { listStaleTracking } from '@/lib/safety/order-sync-escalation';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rows = await listStaleTracking();
    const now = Date.now();

    const items = rows.map((r) => ({
      orderId: r.orderId,
      symbol: r.symbol,
      ageMs: now - r.firstStaleAt,
      escalated: r.escalatedAt != null,
    }));

    const structuralCount = items.filter((i) => i.escalated).length;
    const oldestAgeMs = items.reduce((m, i) => Math.max(m, i.ageMs), 0);

    return Response.json({
      ok: true,
      data: { count: items.length, structuralCount, oldestAgeMs, items },
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/safety/order-sync-status]', error);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
