/**
 * PATCH /api/profile/settings — 회원별 안전장치 저장 (T-008 Step 1, 사용자 결정 Q4).
 *
 * body: { dryRun?, killSwitch?, orderMaxPct?, dailyOrderMaxPct? }
 *
 * ⚠️ **여기서 저장한 값은 아직 매매를 바꾸지 않는다.**
 *    cron·strategy-eval·exit-engine 은 전역 `system_config`/`.env` 만 읽는다.
 *    회원별 배선은 설계문서 §구현순서 4 다. 저장은 허용하되(그 값이 Step 4의 초기값이 된다),
 *    응답에 `engineWired:false` 와 `appliedNow:false` 를 실어 **화면이 "적용됐다"고
 *    말할 수 없게** 만든다. 이 API 를 쓰는 어떤 화면도 그 사실을 감추면 안 된다.
 *
 * 저장을 막지는 않는다 — 값이 없으면 Step 4에서 다시 전부 입력해야 하고, 무엇보다
 * "저장이 안 되는 화면"도 그 나름의 거짓말이다. 진실은 경고로 말한다.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireUserId } from '@/lib/auth/current-user';
import { getUserSettings, saveUserSettings, validatePct, type UserSettings } from '@/lib/auth/users';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest) {
  try {
    const auth = await requireUserId(req);
    if (!auth.ok) return auth.res;

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const patch: Partial<UserSettings> = {};

    // 검증을 전량 선행한다 — 중간에 거절하면 앞 필드만 저장된 부분 반영 상태가 남는다
    // (기존 /api/settings/safety 와 동일한 원칙).
    for (const field of ['dryRun', 'killSwitch'] as const) {
      if (!(field in body)) continue;
      if (typeof body[field] !== 'boolean') {
        return NextResponse.json({ ok: false, error: `${field} 는 true/false 여야 합니다` }, { status: 400 });
      }
      patch[field] = body[field] as boolean;
    }
    for (const field of ['orderMaxPct', 'dailyOrderMaxPct'] as const) {
      if (!(field in body)) continue;
      const v = validatePct(body[field]);
      if (!v.ok) return NextResponse.json({ ok: false, error: `${field}: ${v.error}` }, { status: 400 });
      patch[field] = v.value;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ ok: false, error: '변경할 항목이 없습니다' }, { status: 400 });
    }

    await saveUserSettings(auth.userId, patch);
    const settings = await getUserSettings(auth.userId);

    return NextResponse.json({
      ok: true,
      settings,
      /** 저장은 됐지만 매매 엔진에는 아직 연결되지 않았다 (Step 4에서 true). */
      engineWired: false,
      appliedNow: false,
    });
  } catch (e) {
    console.error('[api/profile/settings]', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ ok: false, error: '설정을 저장하지 못했습니다' }, { status: 500 });
  }
}
