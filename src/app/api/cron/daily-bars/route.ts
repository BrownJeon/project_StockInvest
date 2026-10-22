/**
 * POST /api/cron/daily-bars — KIS 일봉(USD/KRW 원값) → `daily_bars` 수동 수집·백필 (T-070 Phase 0).
 *
 * ⚠ 이 라우트는 **주문·시그널을 만들지 않는다.** KIS 읽기 GET → daily_bars upsert 뿐. 본체는 `src/lib/profit-engine/daily-bars-collector.ts`.
 * ⚠ **cron-runner 에 등록하지 않는다**(정기 증분은 Phase 1). 사람이 오프아워에 직접 부른다:
 *     curl -s -X POST http://localhost:3003/api/cron/daily-bars -H "x-cron-secret: $CRON_SECRET" \
 *          -H 'Content-Type: application/json' -d '{"symbols":["NAS:MU"],"years":3,"maxCalls":40}'
 *   본문(모두 선택): symbols(최대 300, 국내 6자리·해외 NAS|NYS|AMS:티커) · years(1~5, 기본 3) · maxCalls(1~600, 기본 150).
 *   생략하면 대상 = 보유 → 최근 90일 시그널 종목(≤300). 한 번 실행 예산은 호출 maxCalls·100초 — 남으면 `remaining` 을 돌려주고 다음 호출이 이어 간다.
 *
 * 응답: 인증 실패 401(아무것도 하지 않음) · 본문 오류 400 · 오프아워 밖·이미 실행 중 409(KIS·DB 호출 0) · 테이블 미적용 `{ok:true, skipped:'tables_missing'}`
 *   · 유량·레이트리밋·인증 실패로 중단 503 · 그 밖 200.
 * 인증: `checkCronAuth()`(x-cron-secret, fail-closed).
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkCronAuth } from '@/lib/cron-auth';
import { getPool } from '@/lib/db';
import { runDailyBarsCollect } from '@/lib/profit-engine/daily-bars-collector';
import { parseDailyBarsBody } from '@/lib/profit-engine/daily-bars-request';
import { checkOffHoursWindow } from '@/lib/profit-engine/daily-bars-time';
import type { Queryable } from '@/lib/profit-engine/daily-bars-store';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const authErr = checkCronAuth(req);
  if (authErr) return authErr;

  let raw: unknown = null;
  const text = await req.text().catch(() => '');
  if (text.trim()) {
    try {
      raw = JSON.parse(text);
    } catch {
      return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
    }
  }
  const parsed = parseDailyBarsBody(raw);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

  const win = checkOffHoursWindow(new Date());
  if (!win.ok) {
    return NextResponse.json({ ok: false, skipped: 'outside_offhours', reason: win.reason, kst: win.kst }, { status: 409 });
  }

  console.log('[cron/daily-bars] start');
  try {
    const result = await runDailyBarsCollect({ db: getPool() as unknown as Queryable }, parsed.opts);
    const status = result.skipped === 'already_running' ? 409
      : result.aborted && result.aborted !== 'consecutive_failures' ? 503 : 200;
    return NextResponse.json(result, { status });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[cron/daily-bars] fatal error:', error);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
