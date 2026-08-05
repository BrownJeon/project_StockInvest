import { rejectSignal } from '@/lib/signals/service';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = Number((await params).id);
    if (!Number.isFinite(id)) return Response.json({ ok: false, error: 'invalid id' }, { status: 400 });

    const result = await rejectSignal(id);
    return Response.json({ ok: result.ok, error: result.error }, { status: result.ok ? 200 : 400 });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/signals/:id/reject]', error);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
