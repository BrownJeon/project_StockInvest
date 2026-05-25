import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { approveSignal, approveSignalHybrid } from '@/lib/signals/service';
import type { ScenarioCard } from '@/lib/signals/scenario-builder';

export const dynamic = 'force-dynamic';

async function isHybridModeEnabled(): Promise<boolean> {
  try {
    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & { value: string })[]>(
      'SELECT value FROM system_config WHERE `key` = ? LIMIT 1',
      ['hybrid_mode_enabled'],
    );
    if (rows.length > 0) return JSON.parse(rows[0].value) === true;
  } catch { /* fall through */ }
  return String(process.env.HYBRID_MODE_ENABLED ?? 'false').toLowerCase() === 'true';
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = Number(params.id);
    if (!Number.isFinite(id)) {
      return Response.json({ ok: false, error: 'invalid id' }, { status: 400 });
    }

    const hybridMode = await isHybridModeEnabled();

    if (hybridMode) {
      // 하이브리드 모드: 즉시 주문하지 않고 진입 감시 상태로 전환
      let editedScenario: Partial<ScenarioCard> | undefined;
      try {
        const body = await req.json() as { editedScenario?: Partial<ScenarioCard> };
        if (body.editedScenario != null && typeof body.editedScenario === 'object') {
          editedScenario = body.editedScenario;
        }
      } catch { /* body 없음 — 무시 */ }

      const result = await approveSignalHybrid(id, editedScenario);
      return Response.json(result, { status: result.ok ? 200 : 400 });
    }

    // 기존 즉시 주문 승인 경로
    const result = await approveSignal(id);
    return Response.json({ ok: result.ok, data: result }, { status: result.ok ? 200 : 400 });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/signals/:id/approve]', error);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
