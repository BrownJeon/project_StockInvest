import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { kis, BalancesIncompleteError } from '@/lib/exchanges/kis';
import { sendAlert } from '@/lib/notify';
import { sendAlertThrottled } from '@/lib/notify/throttle';
import {
  savePortfolioSnapshot, checkVolatilityGuard, reportSnapshotBlindness,
  type SnapshotPosition,
} from '@/lib/safety/volatility-guard';
import { checkAndTriggerDrawdownKillSwitch, isKillSwitchActive } from '@/lib/safety/kill-switch';
import { getPool } from '@/lib/db';
import { getCurrentMarket } from '@/lib/strategy/market-hours';

export const dynamic = 'force-dynamic';

import { checkCronAuth } from '@/lib/cron-auth';
const RECENT_SNAPSHOT_MS = 90 * 60 * 1000; // 90분 — 시간당 cron이라 1.5배 여유

/** 잔고 부분 실패 알림 — 30분 스로틀. 건너뛰기가 조용하면 스냅샷 기아가 보이지 않는다. */
function notifyBalancesIncomplete(detail: string): void {
  sendAlertThrottled(
    'snapshot:balances_incomplete',
    'warning',
    '포트폴리오 스냅샷 건너뜀 — 잔고 부분 실패',
    `${detail}\n낮은 총액을 기록하면 킬스위치 24h 기준선이 오염되므로 이번 회차는 기록하지 않았습니다. `
    + '다음 주기에 자동 복구되며, 반복되면 KIS 레이트리밋(EGW00201) 상태를 확인하세요.',
  );
}

// 양시장 마감 + 최근 스냅샷 존재 시 KIS 호출 생략 (price 변동 없음)
async function shouldSkipFetch(): Promise<{ skip: boolean; lastSnapshotAt?: Date }> {
  try {
    const market = await getCurrentMarket();
    if (market !== null) return { skip: false }; // 한 시장이라도 열려있으면 갱신
    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT ts FROM portfolio_snapshots ORDER BY ts DESC LIMIT 1',
    );
    if (rows.length === 0) return { skip: false };
    const lastTs = new Date(rows[0].ts);
    if (Date.now() - lastTs.getTime() < RECENT_SNAPSHOT_MS) {
      return { skip: true, lastSnapshotAt: lastTs };
    }
    return { skip: false };
  } catch {
    return { skip: false };
  }
}

export async function POST(req: NextRequest) {
  const authErr = checkCronAuth(req);
  if (authErr) return authErr;

  const body = await req.json().catch(() => ({})) as { force?: boolean };
  const force = body.force === true;

  try {
    if (!force) {
      const skipCheck = await shouldSkipFetch();
      if (skipCheck.skip) {
        console.log(`[cron/portfolio-snapshot] skipped — markets closed, last snapshot ${skipCheck.lastSnapshotAt?.toISOString()}`);
        return NextResponse.json({ ok: true, skipped: 'markets_closed', lastSnapshotAt: skipCheck.lastSnapshotAt?.toISOString() });
      }
    }

    // T-012: 한 시장이라도 조회 실패면 던진다. 아래 catch 에서 스냅샷을 **건너뛴다**.
    // (기록을 남기지 않는 쪽이, 낮은 총액을 남기는 쪽보다 안전하다 — 근거는 catch 주석)
    const balances = await kis.getBalances();

    // KRW/USD 예수금과 보유 종목(국내 6자리 / 해외 EXCD:TICKER) 분리
    const krwBalance      = balances.find(b => b.currency === 'KRW');
    const usdBalance      = balances.find(b => b.currency === 'USD');
    const stockHoldings   = balances.filter(b => b.currency !== 'KRW' && b.currency !== 'USD');

    // KRW free = D+2 확정 예수금(즉시 사용 가능), locked = 결제 대기 중. 자산 평가는 free만 포함.
    const krwFree   = Number(krwBalance?.free ?? 0);
    const krwLocked = Number(krwBalance?.locked ?? 0);
    let totalKRW = krwFree;
    const positions: SnapshotPosition[] = [];

    if (krwBalance && (krwFree > 0 || krwLocked > 0)) {
      positions.push({ currency: 'KRW', qty: krwFree, price: 1, value_krw: krwFree, locked: krwLocked });
    }

    // USD 예수금은 환율 환산
    if (usdBalance) {
      const usdQty = Number(usdBalance.free) + Number(usdBalance.locked);
      if (usdQty > 0) {
        try {
          const { usdToKrw } = await import('@/lib/exchanges/fx');
          const usdValueKRW = await usdToKrw(usdQty);
          totalKRW += usdValueKRW;
          positions.push({ currency: 'USD', qty: usdQty, price: usdValueKRW / usdQty, value_krw: usdValueKRW });
        } catch { /* fx 실패 시 USD 제외 */ }
      }
    }

    // 보유 종목 — symbol == currency (국내 6자리 또는 해외 EXCD:TICKER)
    // kis-overseas.getTicker가 USD→KRW 환산 후 반환하므로 추가 변환 불필요 (2026-04-28).
    // 시세 조회 실패 시 avgPrice(KRW 환산값)를 fallback으로 사용 — 제외하면 총액이 급락해 오탐 발생.
    for (const b of stockHoldings) {
      const qty = Number(b.free) + Number(b.locked);
      if (qty <= 0) continue;
      let price = 0;
      try {
        const ticker = await kis.getTicker(b.currency);
        price = Number(ticker.price);
        // 조회가 "성공"했는데 값이 0/NaN 인 경우도 실패로 다룬다 (T-012).
        // 0원 단가를 그대로 쓰면 그 종목이 총액에서 조용히 사라져 안전장치 기준값이 오염되고,
        // savePortfolioSnapshot 이 스냅샷 전체를 거부한다. 바로 옆에 avgPrice 폴백이 있는데
        // 그걸 못 쓰고 tick 을 통째로 버리는 것은 손해다.
        if (!Number.isFinite(price) || price <= 0) throw new Error(`ticker price=${ticker.price}`);
      } catch {
        // 시세 조회 실패 → avgPrice(KRW) fallback. 없으면 해당 종목 제외.
        if (b.avgPrice && b.avgPrice > 0) {
          price = b.avgPrice;
          console.warn(`[portfolio-snapshot] ticker 실패 ${b.currency} — avgPrice fallback ${price.toFixed(0)}KRW`);
        } else {
          console.warn(`[portfolio-snapshot] ticker 실패 ${b.currency} — avgPrice 없음, 제외`);
          continue;
        }
      }
      const value_krw = qty * price;
      totalKRW += value_krw;
      positions.push({ currency: b.currency, qty, price, value_krw });
    }

    await savePortfolioSnapshot(totalKRW, positions, 'hourly');

    // 24h drawdown 기반 Kill Switch 자동 발동 (Phase 0, 2026-08-02 배선).
    // 방금 저장한 스냅샷이 '현재 자본'이 되므로 반드시 savePortfolioSnapshot 이후에 호출한다.
    // 발동 시 kill-switch.ts 내부에서 system_config 영속 저장 + sendAlert('critical') 통지.
    // 자체적으로 try/catch 하므로 예외가 스냅샷 응답을 깨지 않는다.
    // 반환값을 응답에 싣는다 — "검사를 못 했다"가 로그에만 남으면 조용한 무력화와 구분되지 않는다.
    const drawdown = await checkAndTriggerDrawdownKillSwitch();
    const killSwitchActive = await isKillSwitchActive();

    // 변동폭 가드 체크
    const volCheck = await checkVolatilityGuard();
    let action: string | null = null;

    if (!volCheck.ok) {
      if (volCheck.level === 'panic') {
        action = 'panic_alert';
        console.error(`[cron/portfolio-snapshot] PANIC ${volCheck.changePct?.toFixed(2)}% — 패닉 청산 필요`);
        sendAlert('critical', '🚨 변동폭 패닉 경고', `포트폴리오 변동: ${volCheck.changePct?.toFixed(1)}% — Kill Switch 발동 권고`);
      } else if (volCheck.level === 'block') {
        action = 'block_alert';
        console.error(`[cron/portfolio-snapshot] BLOCK ${volCheck.changePct?.toFixed(2)}% — KILL_SWITCH 권고`);
        sendAlert('warning', '⚠️ 변동폭 차단', `변동: ${volCheck.changePct?.toFixed(1)}% — 신규 주문 차단 중`);
      }
    }

    return NextResponse.json({
      ok: true,
      totalKRW: Math.round(totalKRW),
      positions: positions.length,
      volGuard: { level: volCheck.level ?? 'ok', changePct: volCheck.changePct },
      killSwitch: killSwitchActive,
      drawdown,
      action,
    });
  } catch (e) {
    /**
     * 잔고 부분 실패 — 스냅샷을 **건너뛴다**(기록하지 않는다).
     *
     * ## 왜 "직전 값을 복사해 기록"이 아니라 "건너뛰기"인가
     *
     * 직전 총액을 새 타임스탬프로 다시 넣는 것은 **없는 관측을 지어내는 것**이다.
     * "T 시각에 포트폴리오가 그대로였다"는 사실을 우리는 모르는데, 킬스위치는 그 행을
     * 현재값으로 읽는다 — 실제 폭락 중이라면 그 위조 행이 폭락을 **은폐**한다.
     * 오염된 값을 못 넣게 만드는 작업에서 값을 지어내는 것은 자기모순이다.
     *
     * ## 건너뛰기의 비용은 실측상 작다
     *
     * 킬스위치 drawdown 은 24h 전 **±60분(1380~1500분) 창**에서 기준선을 찾고, 없으면
     * 검사를 건너뛴다(오발동이 아니라 미검사 — 페일오픈). 스냅샷 간격 실측 중앙값은 71분,
     * 부분 실패는 다음 tick(60~90분 뒤)에 거의 항상 복구된다(직후 tick 정상 복귀 확인).
     * 즉 2시간 창에 행이 없을 확률은 매우 낮고, 있어도 결과는 "그 회차 미검사"다.
     *
     * 대신 조용히 넘어가지 않도록 사유별 30분 스로틀 알림을 보낸다.
     */
    if (e instanceof BalancesIncompleteError) {
      const markets = e.failed.map(f => f.market).join(', ');
      console.error(`[cron/portfolio-snapshot] 잔고 부분 실패(${markets}) — 스냅샷 건너뜀: ${e.message}`);
      notifyBalancesIncomplete(e.message);
      // 건너뛰기도 sanity 거부와 똑같은 "실명"이다. 원인이 달라도 킬스위치가 낡은 값을
      // 현재값으로 읽는 결과는 같으므로, 같은 감시기로 시간을 재고 승격 경보한다.
      const freshness = await reportSnapshotBlindness(`balances_incomplete(${markets})`, 'hourly')
        .catch(() => null);
      return NextResponse.json({
        ok: true,
        skipped: 'balances_incomplete',
        failedMarkets: e.failed.map(f => f.market),
        snapshotAgeMin: freshness?.ageMs != null ? Math.round(freshness.ageMs / 60_000) : null,
        blindness: freshness?.level ?? 'unknown',
      });
    }
    const error = e instanceof Error ? e.message : String(e);
    console.error('[cron/portfolio-snapshot]', error);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
