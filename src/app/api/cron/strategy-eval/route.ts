import { NextRequest, NextResponse } from 'next/server';
import { runAll } from '@/lib/strategy/engine';
import { syncPendingOrders } from '@/lib/safety/order-sync';
import { checkCronAuth } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const authErr = checkCronAuth(req);
  if (authErr) return authErr;

  const body = await req.json().catch(() => ({})) as { force?: boolean };
  const force = body.force === true;

  try {
    // 주문 상태 동기화 (비차단 — 실패해도 전략 평가는 진행)
    syncPendingOrders().then(r => {
      if (r.synced > 0 || r.errors.length > 0)
        console.log(`[order-sync] synced=${r.synced} errors=${r.errors.length}`);
    }).catch(() => {});

    const result = await runAll({ force });
    // 정보성 플래그 — 실제 에러와 분리해 로그
    const INFO_FLAGS = new Set([
      'all_markets_closed',
      'domestic_market_closed',
      'overseas_market_closed',
      'analyst_disabled',
    ]);
    const infoFlags = result.errors.filter(e => INFO_FLAGS.has(e));
    const realErrors = result.errors.filter(e => !INFO_FLAGS.has(e));
    if (result.ran === 0 && realErrors.length === 0 && infoFlags.length > 0) {
      console.log(`[cron/strategy-eval] skipped — ${infoFlags.join(', ')}`);
    } else {
      console.log(
        `[cron/strategy-eval] ran=${result.ran} skipped=${result.skipped} errors=${realErrors.length}` +
        (infoFlags.length ? ` info=${infoFlags.join(',')}` : ''),
      );
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[cron/strategy-eval]', error);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
