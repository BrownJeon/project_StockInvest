/**
 * T-066 — GET/PUT /api/settings/risk-policy
 *
 * 리스크 정책(손절폭·손실 손절 합 한도·손절 기준가)을 읽고 저장하며, 최신 포트폴리오 스냅샷과
 * position_state 로 보유 종목의 예상 손절가·손절 합을 계산해 돌려준다.
 *
 * - **표시·위험 계산 전용**(`enforcement: 'display_only'`). 주문·매도·알림을 만들지 않는다.
 * - DB 만 읽고 쓴다(KIS·외부 호출 없음). 쓰는 곳은 `system_config.risk_policy` 한 키뿐.
 * - `/api/settings/safety` 와 분리돼 있다(안전장치 저장 흐름·커밋 훅 대상과 섞지 않는다).
 * - 인증은 전역 미들웨어(`src/middleware.ts`)가 다른 `/api/settings/*` 와 같이 세션으로 막는다.
 */
import { NextRequest, NextResponse } from 'next/server';
import { computeRisk, checkHeatCapPct, checkStopPct, isStopBasis } from '@/lib/risk/compute';
import {
  DEFAULT_EDITABLE, POLICY_SOURCES, READ_ONLY_POLICY,
  type RiskPolicyEditable,
} from '@/lib/risk/defaults';
import { RECOVERY_HINT, readHoldings, readRiskPolicy, saveRiskPolicy, type StoredRiskPolicy } from '@/lib/risk/policy-store';
// 안내 문구('자동 청산 엔진 지금 OFF')를 사실대로 쓰기 위해 엔진과 같은 판독기로 스위치만 읽는다(읽기 전용).
// 방향은 risk → exit-switch 한쪽뿐이다. 청산 엔진·시그널·안전장치 쪽은 risk_policy 를 읽지 않는다.
import { readExitEngineSwitch } from '@/lib/strategy/exit-switch';

export const dynamic = 'force-dynamic';

function policyView(p: StoredRiskPolicy) {
  return {
    version: p.version,
    updatedAt: p.updatedAt,
    stopPct: p.stopPct,
    heatCapPct: p.heatCapPct,
    stopBasis: p.stopBasis,
    history: p.history,
    readOnly: READ_ONLY_POLICY,
    sources: POLICY_SOURCES,
  };
}

export type RiskPolicyView = ReturnType<typeof policyView>;

async function buildData(policy: StoredRiskPolicy | null, now: Date) {
  const [{ snapshot, holdings }, exitSwitch] = await Promise.all([
    readHoldings(now),
    // 판독기는 throw 하지 않지만(DB 오류→OFF), 안내 문구 때문에 화면 전체가 실패하지 않게 한 겹 더 막는다
    readExitEngineSwitch().catch(() => ({ enabled: false })),
  ]);
  const effective: RiskPolicyEditable = policy
    ? { stopPct: policy.stopPct, heatCapPct: policy.heatCapPct, stopBasis: policy.stopBasis }
    : { ...DEFAULT_EDITABLE };
  const computed = computeRisk(holdings, snapshot?.totalKrw ?? 0, effective, snapshot?.cashKrw ?? null);
  return {
    enforcement: 'display_only' as const,
    policy: policy ? policyView(policy) : null,
    defaults: { ...DEFAULT_EDITABLE },
    readOnly: READ_ONLY_POLICY,
    sources: POLICY_SOURCES,
    snapshot,
    holdings,
    computed,
    /** 자동 청산 엔진 마스터 스위치 (안내 문구용, 판독 실패 시 OFF — 엔진과 같은 규칙) */
    exitEngine: { enabled: exitSwitch.enabled },
  };
}

export type RiskPolicyData = Awaited<ReturnType<typeof buildData>>;

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function GET() {
  try {
    const read = await readRiskPolicy();
    if (read.status === 'invalid') {
      return NextResponse.json(
        { ok: false, error: `저장된 리스크 정책 값을 읽을 수 없습니다 (${read.detail}) — ${RECOVERY_HINT}` },
        { status: 500 },
      );
    }
    const data = await buildData(read.status === 'ok' ? read.policy : null, new Date());
    return NextResponse.json({ ok: true, data }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    console.error('[api/settings/risk-policy GET]', errorText(e));
    return NextResponse.json({ ok: false, error: errorText(e) }, { status: 500 });
  }
}

interface PutBody {
  stopPct?: unknown;
  heatCapPct?: unknown;
  stopBasis?: unknown;
  baseVersion?: unknown;
}

export async function PUT(req: NextRequest) {
  let body: PutBody;
  try {
    body = (await req.json()) as PutBody;
  } catch {
    return NextResponse.json({ ok: false, error: '요청 본문이 JSON 이 아닙니다' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: '요청 본문이 비어 있습니다' }, { status: 400 });
  }

  // 숫자만 받는다 — 화면은 숫자로 보낸다. 문자열 "3%" 같은 값은 거절해 저장 형식을 고정한다.
  const fieldErrors: Record<string, string> = {};
  const stop = typeof body.stopPct === 'number' ? checkStopPct(body.stopPct) : { error: '숫자를 넣어 주세요.', warning: null, value: null };
  const cap = typeof body.heatCapPct === 'number' ? checkHeatCapPct(body.heatCapPct) : { error: '숫자를 넣어 주세요.', warning: null, value: null };
  if (stop.error) fieldErrors.stopPct = stop.error;
  if (cap.error) fieldErrors.heatCapPct = cap.error;
  if (!isStopBasis(body.stopBasis)) fieldErrors.stopBasis = '손절 기준가는 avg 또는 peak 입니다.';
  const baseVersion = body.baseVersion == null ? 0 : body.baseVersion;
  if (typeof baseVersion !== 'number' || !Number.isInteger(baseVersion) || baseVersion < 0) {
    fieldErrors.baseVersion = 'baseVersion 은 0 이상의 정수입니다.';
  }
  if (Object.keys(fieldErrors).length > 0) {
    const error = Object.entries(fieldErrors).map(([k, v]) => `${k}: ${v}`).join(' · ');
    return NextResponse.json({ ok: false, error, fieldErrors }, { status: 400 });
  }

  const values: RiskPolicyEditable = {
    stopPct: stop.value as number,
    heatCapPct: cap.value as number,
    stopBasis: body.stopBasis as RiskPolicyEditable['stopBasis'],
  };

  try {
    const now = new Date();
    const result = await saveRiskPolicy(values, baseVersion as number, now);
    if (!result.ok) {
      const data = await buildData(result.latest, now);
      return NextResponse.json(
        { ok: false, error: '다른 기기에서 먼저 저장했습니다 — 최신 값을 확인한 뒤 다시 저장하세요', code: 'conflict', data },
        { status: 409 },
      );
    }
    const data = await buildData(result.policy, now);
    const warnings = stop.warning ? [stop.warning] : [];
    return NextResponse.json({ ok: true, data, warnings });
  } catch (e) {
    console.error('[api/settings/risk-policy PUT]', errorText(e));
    return NextResponse.json({ ok: false, error: errorText(e) }, { status: 500 });
  }
}
