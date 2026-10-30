/**
 * T-108 `GET /api/ops/safety-state` — 안전 상태 띠(홈·거래 30초 재조회, 분석 미니 띠)의 **읽기 전용** 원천 (가이드 §4.2).
 *
 * `GET /api/settings/safety` 를 대신한다 — 그 라우트는 조회 중 기본값을 써 넣는다(seedIfEmpty). 여기는 쓰기 0.
 * 주문 경로와 같은 판독기(isDryRun·isKillSwitchActive·readExitEngineSwitch)를 그대로 부른다(`lib/ops/metrics/safety-state.ts`).
 * 인증: 미들웨어 기본 보호(공개 경로 아님). 봉투: `{ ok:true, data: SafetyStateDTO }` / 예기치 못한 실패만 503.
 */
import { NextResponse } from 'next/server';
import { readSafetyState, toSafetyDTO } from '@/lib/ops/metrics/safety-state';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const s = await readSafetyState(Date.now());
    return NextResponse.json({ ok: true, data: toSafetyDTO(s) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[api/ops/safety-state]', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ ok: false, error: 'safety_state_unavailable' }, { status: 503 });
  }
}
