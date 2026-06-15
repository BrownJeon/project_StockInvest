import { getPool } from '@/lib/db';
import type { ResultSetHeader } from 'mysql2';

export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const pool = getPool();
  const journalId = Number(params.id);
  try {
    const body = await req.json() as {
      phase: string;
      content: string;
      price_at?: number;
    };

    if (!body.phase) return Response.json({ ok: false, error: 'phase required' }, { status: 400 });
    if (!body.content?.trim()) return Response.json({ ok: false, error: 'content required' }, { status: 400 });

    const [result] = await pool.query<ResultSetHeader>(
      'INSERT INTO trade_journal_entries (journal_id, phase, content, price_at) VALUES (?, ?, ?, ?)',
      [journalId, body.phase, body.content.trim(), body.price_at ?? null],
    );

    return Response.json({ ok: true, id: result.insertId });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
