import { approveSignal } from '@/lib/signals/service';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const id = Number(params.id);
    if (!Number.isFinite(id)) return Response.json({ ok: false, error: 'invalid id' }, { status: 400 });

    const result = await approveSignal(id);
    return Response.json({ ok: result.ok, data: result }, { status: result.ok ? 200 : 400 });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/signals/:id/approve]', error);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
