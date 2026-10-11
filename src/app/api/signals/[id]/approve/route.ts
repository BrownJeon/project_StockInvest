import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { approveSignal, approveSignalHybrid, getSignalById } from '@/lib/signals/service';
import { readHybridModeEnabled, resolveApprovalPath } from '@/lib/signals/approval-transitions';
import type { ScenarioCard } from '@/lib/signals/scenario-builder';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = Number((await params).id);
    if (!Number.isFinite(id)) {
      return Response.json({ ok: false, error: 'invalid id' }, { status: 400 });
    }

    const hybridMode = await readHybridModeEnabled(getPool());

    // 사용자가 진입 구간을 직접 고쳐 보냈는가 (하이브리드 승인 화면에서만 온다)
    let editedScenario: Partial<ScenarioCard> | undefined;
    if (hybridMode) {
      try {
        const body = await req.json() as { editedScenario?: Partial<ScenarioCard> };
        if (body.editedScenario != null && typeof body.editedScenario === 'object') {
          editedScenario = body.editedScenario;
        }
      } catch { /* body 없음 — 무시 */ }
    }

    // T-042 — 승인 경로는 하이브리드 플래그만이 아니라 **진입 구간이 있는가**로 정한다.
    // 구간이 없는 룰 시그널(RSI 과매도 등)을 진입 감시로 보내면 감시가 `no_zone` 으로 건너뛰어
    // 승인해도 주문이 영원히 나가지 않았다. 텔레그램 버튼 승인과 같은 규칙(`resolveApprovalPath`)을 쓴다.
    const row = await getSignalById(id);
    const path = resolveApprovalPath({
      hybridEnabled: hybridMode,
      indicators: row?.indicators,
      hasEditedScenario: editedScenario != null,
    });

    if (path === 'hybrid') {
      // 하이브리드 모드: 즉시 주문하지 않고 진입 감시 상태로 전환
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
