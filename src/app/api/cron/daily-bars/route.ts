/**
 * POST /api/cron/daily-bars — KIS 일봉(USD/KRW 원값) → `daily_bars` 수동 수집·백필 (T-070 Phase 0).
 *
 * ⚠ 이 라우트는 **주문·시그널을 만들지 않는다.** KIS 읽기 GET → daily_bars upsert 뿐. 본체는 `src/lib/profit-engine/daily-bars-collector.ts`.
 * 정기 호출: cron-runner 가 매일 07:40~07:54 첫 틱에 본문 없이(전 시장, T-117), 18:10~18:54 첫 틱에 `?market=KR`(국내만, T-170) 부른다.
 * 수동 호출(오프아워에 사람이 직접):
 *     curl -s -X POST http://localhost:3003/api/cron/daily-bars -H "x-cron-secret: $CRON_SECRET" \
 *          -H 'Content-Type: application/json' -d '{"symbols":["NAS:MU"],"years":3,"maxCalls":40}'
 *   본문(모두 선택): symbols(최대 300, 국내 6자리·해외 NAS|NYS|AMS:티커) · years(1~5, 기본 3) · maxCalls(1~600, 기본 150)
 *     · market('KR'|'US' — 기본 대상을 그 시장만 남김, symbols 와 함께 주면 400, T-170).
 *   쿼리(T-170): `?market=KR|US` = 본문 market 과 같은 뜻(러너가 쓴다 — T-170 때 본문을 넘기면 call() 이 `}` 를 덧붙이는 결함이 있었다.
 *     그 결함은 T-172 가 고쳤고 러너는 쿼리를 그대로 쓴다).
 *     모르는 쿼리 키·market 두 번·본문에도 market 이면 400.
 *   생략하면 대상 = 보유 → 해외 분석 목록·최근 90일 시그널 종목(≤300)을 저장된 마지막 거래일이 오래된 순으로(T-170).
 *   한 번 실행 예산은 호출 maxCalls·100초 — 남으면 `remaining` 을 돌려주고 다음 호출이 이어 간다.
 *
 * 응답: 인증 실패 401(아무것도 하지 않음) · 본문 오류 400 · 오프아워 밖·이미 실행 중 409(KIS·DB 호출 0) · 테이블 미적용 `{ok:true, skipped:'tables_missing'}`
 *   · 유량·레이트리밋·인증 실패로 중단 503 · 그 밖 200.
 * 인증: `checkCronAuth()`(x-cron-secret, fail-closed).
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkCronAuth } from '@/lib/cron-auth';
import { getPool } from '@/lib/db';
import { runDailyBarsCollect } from '@/lib/profit-engine/daily-bars-collector';
import { parseDailyBarsRequest } from '@/lib/profit-engine/daily-bars-request';
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
  const parsed = parseDailyBarsRequest(raw, req.nextUrl.searchParams);
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
