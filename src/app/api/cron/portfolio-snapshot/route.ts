import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { kis, getBalancesDetailed, BalancesIncompleteError } from '@/lib/exchanges/kis';
import { getUsdKrwRate } from '@/lib/exchanges/fx';
import { sendAlert } from '@/lib/notify';
import { sendAlertThrottled } from '@/lib/notify/throttle';
import {
  savePortfolioSnapshot, checkVolatilityGuard, reportSnapshotBlindness,
  type SnapshotPosition,
} from '@/lib/safety/volatility-guard';
import { sendAlertUntilDelivered } from '@/lib/safety/confirmed-alert';
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

/**
 * (T-056) 현금 행을 확인하지 못해 저장을 보류했다 — **critical, 전달 확인 뒤 2시간 억제**.
 *
 * 이 동안에는 킬스위치가 돌지 않고(저장 뒤에만 실행된다), `kill-switch:stale-current` 경보도 같은 이유로 나가지 않는다.
 * 그래서 이 경보와 `reportSnapshotBlindness` 가 운영자에게 닿는 통로다. 첫 전달이 실패하면 다음 틱에 다시 보낸다.
 * 잔고 부분 실패 경보(30분 warning)와 키를 나눠 서로의 스로틀에 먹히지 않게 한다.
 */
const CASH_ALERT_SUPPRESS_MS = 2 * 60 * 60 * 1000;
type CashHoldReason = 'usd_cash_unavailable' | 'krw_cash_unavailable';

function notifyCashUnavailable(reason: CashHoldReason, detail: string): void {
  const usd = reason === 'usd_cash_unavailable';
  sendAlertUntilDelivered(
    `snapshot:${reason}`,
    'critical',
    usd ? '🚨 포트폴리오 스냅샷 보류 — 해외 USD 예수금 확인 불가'
        : '🚨 포트폴리오 스냅샷 보류 — 국내 KRW 예수금 확인 불가',
    `${detail}\n`
    + '예수금을 모르는 채 총액을 기록하면(행 생략 = 0원) 킬스위치 24h 기준선이 오염되어 거짓 발동하거나 실제 손실을 놓칩니다. '
    + '이번 회차는 기록하지 않았습니다.\n'
    + '**보류가 이어지는 동안 24h drawdown 자동 발동은 동작하지 않습니다.**\n'
    + (usd
      ? '해외 신규 매수 한도도 0 으로 막힙니다(매도·청산은 계속). KIS CTRP6504R 응답·토큰·레이트리밋(EGW00201)과 환율 조회를 확인하세요.'
      : 'KIS 국내 잔고 응답의 예수금 요약(output2)을 확인하세요.'),
    CASH_ALERT_SUPPRESS_MS,
  );
}

/**
 * (T-056) 현금 행을 확인하지 못한 틱 — **저장하지 않고, 이 회차 킬스위치·변동성 가드도 돌리지 않는다**(잔고 부분 실패와 같은
 * 처리). 직전 값을 복사해 저장하지 않는 이유는 아래 catch 주석("없는 관측을 지어내지 않는다")과 같다.
 */
async function holdForCash(reason: CashHoldReason, detail: string): Promise<NextResponse> {
  console.error(`[cron/portfolio-snapshot] ${reason} — 스냅샷 보류: ${detail}`);
  notifyCashUnavailable(reason, detail);
  const freshness = await reportSnapshotBlindness(reason, 'hourly').catch(() => null);
  return NextResponse.json({
    ok: true,
    skipped: reason,
    detail,
    snapshotAgeMin: freshness?.ageMs != null ? Math.round(freshness.ageMs / 60_000) : null,
    blindness: freshness?.level ?? 'unknown',
  });
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

    // T-012: 한 시장이라도 **보유** 조회 실패면 던진다. 아래 catch 에서 스냅샷을 **건너뛴다**.
    // (기록을 남기지 않는 쪽이, 낮은 총액을 남기는 쪽보다 안전하다 — 근거는 catch 주석)
    // T-056: 현금 상태(cash.USD)는 보유 완결성과 독립이라 `getBalancesDetailed()` 로 함께 받는다.
    const detailed = await getBalancesDetailed();
    if (!detailed.complete) throw new BalancesIncompleteError(detailed.failed, detailed.ok);
    const balances = detailed.balances;
    // 저장 가드에 넘길 "이 틱에 USD 행이 있어야 하는가" — 잔고를 조회한 바로 그 값(같은 틱 안에서 판정이 엇갈리지 않게).
    const usdCashRequired = detailed.overseasEnabled;

    // KRW 예수금과 보유 종목(국내 6자리 / 해외 EXCD:TICKER) 분리. USD 는 `balances` 에 없다(cash.USD 로만 온다).
    const krwBalance    = balances.find(b => b.currency === 'KRW');
    const stockHoldings = balances.filter(b => b.currency !== 'KRW' && b.currency !== 'USD');

    // ── T-056 Q3: KRW 예수금 — 요약이 없으면 0원 행을 만들지 않고 **보류** ──
    if (!krwBalance) {
      return await holdForCash('krw_cash_unavailable',
        '국내 잔고 응답에 예수금 요약(output2)이 없거나 값이 숫자가 아닙니다 — KRW 예수금을 확인할 수 없음');
    }
    // KRW free = D+2 확정 예수금(즉시 사용 가능), locked = 결제 대기 중. 자산 평가는 free만 포함.
    const krwFree   = Number(krwBalance.free);
    const krwLocked = Number(krwBalance.locked);
    let totalKRW = krwFree;
    // 잔액 0 이어도 **항상** 기록한다 — "행 없음"과 "확인된 0"을 구분하기 위해서다.
    const positions: SnapshotPosition[] = [
      { currency: 'KRW', qty: krwFree, price: 1, value_krw: krwFree, locked: krwLocked },
    ];

    // ── T-056: USD 예수금 — 해외 활성이면 반드시 known 이어야 하고, 같은 틱 환율 하나로 환산 ──
    let usdCash: number | null = null;
    if (usdCashRequired) {
      const c = detailed.cash.USD;
      if (c.state !== 'known') {
        return await holdForCash('usd_cash_unavailable',
          c.state === 'unknown'
            ? `해외 USD 예수금 조회 실패: ${c.error}`
            : '해외 시장이 활성인데 USD 예수금을 조회하지 않았습니다(not_queried)');
      }
      let rate: number;
      try {
        rate = Number(await getUsdKrwRate());
      } catch (e) {
        return await holdForCash('usd_cash_unavailable',
          `USD/KRW 환율 조회 실패 — USD 예수금(${c.usd} USD)을 환산할 수 없음: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (!Number.isFinite(rate) || !(rate > 0)) {
        return await holdForCash('usd_cash_unavailable', `USD/KRW 환율 값 이상(${rate}) — USD 예수금을 환산할 수 없음`);
      }
      const usdValueKRW = c.usd * rate;
      totalKRW += usdValueKRW;
      usdCash = c.usd;
      positions.push({
        currency: 'USD', qty: c.usd, price: rate, value_krw: usdValueKRW, locked: 0, src: c.source,
        // 미결제 매도 금액은 기록만 한다(총액 미반영) — 단계 4 판별 자료
        ...(c.ustlSllAmtSmtl > 0 ? { ustl_sll_amt_smtl: c.ustlSllAmtSmtl } : {}),
      });
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

    await savePortfolioSnapshot(totalKRW, positions, 'hourly', { usdCashRequired, krwCashRequired: true });

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
      // T-056 배포 직후 첫 행 확인용 — 이 틱에 기록한 현금(USD 는 해외 비활성이면 null)
      cash: { KRW: krwFree, USD: usdCash },
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
