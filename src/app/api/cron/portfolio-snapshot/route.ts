import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { kis } from '@/lib/exchanges/kis';
import { sendAlert } from '@/lib/notify';
import { savePortfolioSnapshot, checkVolatilityGuard } from '@/lib/safety/volatility-guard';
import { getPool } from '@/lib/db';
import { getCurrentMarket } from '@/lib/strategy/market-hours';

export const dynamic = 'force-dynamic';

import { checkCronAuth } from '@/lib/cron-auth';
const RECENT_SNAPSHOT_MS = 90 * 60 * 1000; // 90분 — 시간당 cron이라 1.5배 여유

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

    const balances = await kis.getBalances();

    // KRW/USD 예수금과 보유 종목(국내 6자리 / 해외 EXCD:TICKER) 분리
    const krwBalance      = balances.find(b => b.currency === 'KRW');
    const usdBalance      = balances.find(b => b.currency === 'USD');
    const stockHoldings   = balances.filter(b => b.currency !== 'KRW' && b.currency !== 'USD');

    // KRW free = D+2 확정 예수금(즉시 사용 가능), locked = 결제 대기 중. 자산 평가는 free만 포함.
    const krwFree   = Number(krwBalance?.free ?? 0);
    const krwLocked = Number(krwBalance?.locked ?? 0);
    let totalKRW = krwFree;
    const positions: Array<{ currency: string; qty: number; price: number; value_krw: number; locked?: number }> = [];

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
        price = ticker.price;
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
      action,
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[cron/portfolio-snapshot]', error);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
