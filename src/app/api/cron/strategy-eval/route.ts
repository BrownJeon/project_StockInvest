import { NextRequest, NextResponse } from 'next/server';
import { runAll } from '@/lib/strategy/engine';
import { syncPendingOrders } from '@/lib/safety/order-sync';
import { checkCronAuth } from '@/lib/cron-auth';
import { describeErrorCause } from '@/lib/notify/result';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const authErr = checkCronAuth(req);
  if (authErr) return authErr;

  const body = await req.json().catch(() => ({})) as { force?: boolean };
  const force = body.force === true;

  try {
    /**
     * 주문 상태 동기화 (비차단 — 실패해도 전략 평가는 진행).
     *
     * 🔴 T-018 — **이 fire-and-forget 결과는 아무 데도 저장되지 않는다.** 예전 코드는
     * `synced>0 || errors.length>0` 일 때만 한 줄 찍고 `.catch(() => {})` 로 예외까지
     * 통째로 버렸다. 즉 "주문 상태를 확인하지 못했다"는 사실이 도달할 곳이 없었다.
     *
     * 그래서 `syncPendingOrders` 는 판정 보류를 **자기 안에서** 로그(`ORDER_SYNC_UNRECONCILED`)와
     * 스로틀 알림으로 내보낸다 — 여기서 반환값을 버려도 신호는 살아남는다. 아래 로그는
     * 그 위에 얹는 요약이고, `complete=false` 를 조건에 넣어 **"판정 못 함"이 "할 일 없음"과
     * 같은 침묵이 되지 않게** 한다.
     */
    void syncPendingOrders().then(r => {
      if (r.synced > 0 || r.errors.length > 0 || !r.complete || r.partialSettlements.length > 0) {
        console.log(
          `[order-sync] synced=${r.synced} errors=${r.errors.length} complete=${r.complete}`
          + (r.skipped > 0 ? ` unreconciled=${r.skipped} stale=${r.staleCount}` : '')
          // T-019 — 부분체결 종결은 **판정 실패가 아니다**. complete 를 깎지 않으므로
          // 이 요약에 따로 실어야 회차 로그만 봐도 "일부만 체결된 채 끝난 주문"이 보인다.
          + (r.partialSettlements.length > 0
            ? ` partialSettled=${r.partialSettlements.length}`
              + `/unrecorded=${r.partialSettlements.filter(p => !p.executionRecorded).length}`
            : '')
          + (r.completenessUnverified > 0 ? ` fillUnverified=${r.completenessUnverified}` : ''),
        );
      }
    }).catch(e => {
      // 동기화 자체가 던졌다(예: DB 조회 실패). 조용히 버리면 T-018 이 없앤 침묵이 부활한다.
      console.error('[order-sync] 실행 실패 —', e instanceof Error ? e.message : String(e));
    });

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
    // T-175 WP-3 — `fetch failed` 만으로는 어느 외부 호출(호스트)이 runAll 을 멈췄는지 알 수 없었다(2026-11-18 12:11).
    // 원인 코드·주소(cause·AggregateError.errors)를 같은 줄에 남긴다. 비밀값·쿼리스트링은 가린다. 응답 본문·500 은 그대로.
    const cause = describeErrorCause(e);
    console.error('[cron/strategy-eval]', error, ...(cause ? [`| ${cause}`] : []));
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
