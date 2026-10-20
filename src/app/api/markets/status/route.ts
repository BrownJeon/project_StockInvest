import { isDomesticOpen, isOverseasOpen, getCurrentMarket, isUSDST, nextOpenAt } from '@/lib/strategy/market-hours';
import { getUsdKrwRate, usdToKrw } from '@/lib/exchanges/fx';
import { kis, getBalancesDetailed, BalancesIncompleteError } from '@/lib/exchanges/kis';
import type { Ticker } from '@/lib/exchanges/types';
import { getMarketFromSymbol } from '@/lib/exchanges/kis-symbols';

export const dynamic = 'force-dynamic';

interface MarketBalance {
  cash: number;
  cashCurrency: 'KRW' | 'USD';
  cashKRW: number;
  holdingsCount: number;
  holdingsValueKRW: number;
  totalKRW: number;
}

/**
 * 시장별 잔고 요약. **예수금(KRW·USD) 중 하나라도 모르면 전체 null** — 보유 조회 실패와 같은 기존 "조회 불가" 경로다 (T-056).
 * 0원으로 표시하지 않는다. 시장 하나만 null 로 두지 않는 이유: 화면이 두 시장 합계를 `?? 0` 으로 더하므로, 한쪽만 비우면
 * 과소 계상된 총 평가액이 숫자로 뜬다(화면은 이번 범위에서 바꾸지 않는다).
 */
async function computeMarketBalances(): Promise<{ domestic: MarketBalance; overseas: MarketBalance } | null> {
  try {
    const detailed = await getBalancesDetailed();
    if (!detailed.complete) throw new BalancesIncompleteError(detailed.failed, detailed.ok);
    const balances = detailed.balances;   // USD 예수금은 여기 없다 — cash.USD
    const domHoldings = balances.filter(b => b.currency !== 'KRW' && b.currency !== 'USD' && getMarketFromSymbol(b.currency) === 'domestic' && (b.free + b.locked) > 0);
    const ovsHoldings = balances.filter(b => b.currency !== 'KRW' && b.currency !== 'USD' && getMarketFromSymbol(b.currency) === 'overseas' && (b.free + b.locked) > 0);
    const krwRow = balances.find(b => b.currency === 'KRW');
    if (!krwRow) throw new Error('국내 예수금(KRW) 요약 없음 — 잔고 요약 조회 불가로 처리');   // Q3: 요약 없음 = 모름
    const krwCash = Number(krwRow.free);
    const usdState = detailed.cash.USD;
    let usdCash = 0;                                                            // 해외 비활성 — 예전과 같은 0 표시
    if (detailed.overseasEnabled) {
      if (usdState.state !== 'known') {
        throw new Error(`해외 예수금(USD) 확인 불가 — 잔고 요약 조회 불가로 처리: ${usdState.state === 'unknown' ? usdState.error : usdState.state}`);
      }
      usdCash = usdState.usd;
    }

    const tickerResults = await Promise.allSettled([
      ...domHoldings.map(b => kis.getTicker(b.currency)),
      ...ovsHoldings.map(b => kis.getTicker(b.currency)),
    ]);
    const tmap = new Map<string, Ticker>();
    [...domHoldings, ...ovsHoldings].forEach((b, i) => {
      const r = tickerResults[i];
      if (r.status === 'fulfilled') tmap.set(b.currency, r.value);
    });

    const domHoldingsKRW = domHoldings.reduce((s, b) => {
      const qty = b.free + b.locked;
      const price = Number(tmap.get(b.currency)?.price ?? 0);
      return s + qty * price;
    }, 0);
    // kis-overseas.getTicker가 USD→KRW 환산 후 반환 (2026-04-28) — ticker.price는 이미 KRW
    const ovsHoldingsKRW = ovsHoldings.reduce((s, b) => {
      const qty = b.free + b.locked;
      const price = Number(tmap.get(b.currency)?.price ?? 0);
      return s + qty * price;
    }, 0);

    // 환산 실패를 0원으로 바꾸지 않는다(예전: `.catch(() => 0)`) — 실패면 전체 조회 불가.
    let usdCashKRW = 0;
    if (usdCash > 0) {
      const v = Number(await usdToKrw(usdCash));
      if (!Number.isFinite(v) || v < 0) throw new Error(`USD 예수금 환산 실패 (${v})`);
      usdCashKRW = v;
    }

    return {
      domestic: {
        cash: krwCash,
        cashCurrency: 'KRW',
        cashKRW: krwCash,
        holdingsCount: domHoldings.length,
        holdingsValueKRW: domHoldingsKRW,
        totalKRW: krwCash + domHoldingsKRW,
      },
      overseas: {
        cash: usdCash,
        cashCurrency: 'USD',
        cashKRW: usdCashKRW,
        holdingsCount: ovsHoldings.length,
        holdingsValueKRW: ovsHoldingsKRW,
        totalKRW: usdCashKRW + ovsHoldingsKRW,
      },
    };
  } catch (e) {
    console.error('[markets/status] balance breakdown failed:', e);
    return null;
  }
}

/**
 * GET /api/markets/status
 *
 * 응답:
 *  - current: 현재 열린 시장 ('domestic'|'overseas'|null)
 *  - domestic / overseas: { open, nextOpenAt(ISO), nextOpenInMs, sessionLabel, balance? }
 *  - usDST: 미국 동부가 EDT(서머타임) 중인지
 *  - fx: { usdKrw, fetchedAt(ISO) }
 *  - now: 서버 현재 시각 (ISO)
 *
 * 쿼리: ?balance=1 시 시장별 잔고 합산 포함 (KIS 호출 필요 — 느릴 수 있음)
 */
export async function GET(req: Request) {
  const now = new Date();
  const includeBalance = new URL(req.url).searchParams.get('balance') === '1';
  try {
    const [current, domesticOpen, overseasOpen, usdKrw, balances] = await Promise.all([
      getCurrentMarket(now),
      isDomesticOpen(now),
      isOverseasOpen(now),
      getUsdKrwRate().catch(() => null),
      includeBalance ? computeMarketBalances() : Promise.resolve(null),
    ]);
    const dNext = nextOpenAt('domestic', now);
    const oNext = nextOpenAt('overseas', now);
    return Response.json({
      ok: true,
      current,
      domestic: {
        open: domesticOpen,
        nextOpenAt: new Date(dNext).toISOString(),
        nextOpenInMs: domesticOpen ? 0 : Math.max(0, dNext - now.getTime()),
        sessionLabel: '평일 09:00–15:30 KST',
        balance: balances?.domestic ?? null,
      },
      overseas: {
        open: overseasOpen,
        nextOpenAt: new Date(oNext).toISOString(),
        nextOpenInMs: overseasOpen ? 0 : Math.max(0, oNext - now.getTime()),
        sessionLabel: isUSDST(now) ? '평일 22:30–05:00 KST (EDT)' : '평일 23:30–06:00 KST (EST)',
        balance: balances?.overseas ?? null,
      },
      usDST: isUSDST(now),
      fx: usdKrw ? { usdKrw, fetchedAt: new Date().toISOString() } : null,
      now: now.toISOString(),
    });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
