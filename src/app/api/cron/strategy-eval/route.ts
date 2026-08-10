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

    /**
     * 🔴 T-017 reviewer HIGH-1 — **여기를 `withKisPriority('bulk')` 로 감싸면 안 된다.**
     *
     * 처음엔 "전략 평가 틱 전체가 가장 무거우니 통째로 bulk" 로 감쌌다. 그런데 `runAll` 안의
     * **무거운 배치 작업들은 이미 자기 함수 안에서 스스로 `bulk` 를 선언한다**
     * (`refreshUniverse`, `updateRsRatings`). 즉 이 래퍼가 실제로 강등시키는 대상은
     * 배치가 아니라 **안전 경로**뿐이었다:
     *
     *  - `getHeldAmounts()` — T-014 가 "모름을 0으로 읽지 않게" 굳힌 바로 그 잔고 조회
     *  - `runExitEngine()` — 하드손절·EOD손절·트레일링스탑을 발화시키는 청산 평가
     *
     * 즉 손절 판단이 universe 스캔 뒤에 줄 서는 구조였다. 래퍼를 없애면 이 둘은 기본
     * lane(`normal`)로 돌아가고, 배치는 자기 선언대로 `bulk` 를 유지하므로 **잃는 것이 없다.**
     *
     * ⚠️ **"어차피 지금 exit-engine 은 꺼져 있다"는 이유로 미뤄서는 안 된다.**
     *    [[T-015]] 는 재활성화를 `system_config.exit_engine_enabled` **런타임 판독**으로
     *    만들었다 — 값 하나만 바꾸면 배포 없이 즉시 살아난다. 그 사이에 이 결함을 걸러낼
     *    배포 게이트가 없다. 보호를 되살렸다고 믿는 바로 그 순간에 손절 평가가 최하위
     *    lane 에서 돌게 된다.
     *
     * 실주문은 어차피 `submitOrder`(critical) + `createOrder`/`cancelOrder` 호출 지점의
     * `priority:'critical'` 명시로 보호되므로, 여기서 lane 을 지정할 이유 자체가 없다.
     */
    const result = await runAll({ force });
    // 정보성 플래그 — 실제 에러와 분리해 로그
    const INFO_FLAGS = new Set([
      'all_markets_closed',
      'domestic_market_closed',
      'overseas_market_closed',
      'analyst_disabled',
      // Phase 2 D2 — 엔진 중지는 정상 운영 상태다 (exit 트랙은 계속 돈다). 에러로 세지 않는다.
      'engine_disabled',
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
