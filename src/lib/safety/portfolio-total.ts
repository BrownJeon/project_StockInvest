/**
 * 포트폴리오 평가액 (KRW 환산) 조회.
 *
 * 시장별 분리 합산:
 *  - domestic: KRW 예수금 + 국내 종목(currency에 ':' 미포함) 평가금액
 *  - overseas: USD 예수금(× FX) + 해외 종목(currency 'EXCHG:SYMBOL' 형식) 평가금액(× FX)
 *
 * 정책 (2026-04-27): 1회/일일 주문 한도 pct는 **해당 시장 평가액 × pct**로 산정.
 * 시장 합산 의미가 모호한 단순 합계는 부차적 용도(전체 portfolio summary 등)로만 노출.
 *
 * 짧은 in-memory 캐시(60초)로 중복 호출 방지. balances + tickers fetch는 단일 패스.
 */
import { kis } from '@/lib/exchanges/kis';
import { usdToKrw } from '@/lib/exchanges/fx';
import type { Market } from '@/lib/exchanges/kis-symbols';

export interface MarketTotals {
  domestic: number;
  overseas: number;
  total:    number;
}

interface Cache extends MarketTotals { fetchedAt: number }
const TTL_MS = 60_000;
let cache: Cache | null = null;

async function fetchTotals(): Promise<MarketTotals> {
  try {
    const balances = await kis.getBalances();
    let domesticKRW = 0;
    let overseasKRW = 0;
    let cashUSD = 0;  // USD 예수금만 별도 환산 — 해외 종목 ticker.price는 이미 KRW로 환산됨 (kis-overseas.ts 2026-04-28 fix)

    for (const b of balances) {
      const qty = Number(b.free) + Number(b.locked);
      if (qty <= 0) continue;
      if (b.currency === 'KRW') {
        domesticKRW += qty;
      } else if (b.currency === 'USD') {
        cashUSD += qty;
      } else {
        // 종목 보유분: 현재가 × qty 평가 (해외는 ticker.price가 이미 KRW 환산됨)
        try {
          const ticker = await kis.getTicker(b.currency);
          const price = Number(ticker.price);
          if (Number.isFinite(price) && price > 0) {
            const amount = price * qty;
            if (b.currency.includes(':')) overseasKRW += amount;
            else                          domesticKRW += amount;
          }
        } catch { /* 한 종목 실패는 무시 */ }
      }
    }

    if (cashUSD > 0) {
      try { overseasKRW += await usdToKrw(cashUSD); }
      catch { /* fx 실패 시 cashUSD는 누락 */ }
    }

    return {
      domestic: domesticKRW,
      overseas: overseasKRW,
      total:    domesticKRW + overseasKRW,
    };
  } catch (e) {
    // T-012: `kis.getBalances()` 는 한 시장이라도 실패하면 던진다(BalancesIncompleteError).
    // 여기서 0/0/0 을 돌려주면 `getPortfolioTotalsKRW` 가 **직전 캐시로 폴백**하거나(캐시 있음)
    // pct 한도를 0 으로 만들어 신규 주문을 막는다(캐시 없음) — 둘 다 "낮은 총액을 진짜처럼
    // 쓰는 것"보다 안전한 방향이다. 단, 조용히 넘어가면 안 되므로 반드시 남긴다.
    console.error('[portfolio-total] 잔고 조회 실패 — 평가액 산출 포기(직전 캐시 또는 0 반환):',
      e instanceof Error ? e.message : String(e));
    return { domestic: 0, overseas: 0, total: 0 };
  }
}

/**
 * 시장별 + 합계 평가액(KRW). 60초 캐시.
 * 호출 실패 시 직전 캐시 또는 0/0/0 반환.
 */
export async function getPortfolioTotalsKRW(forceFresh = false): Promise<MarketTotals> {
  if (!forceFresh && cache && Date.now() - cache.fetchedAt < TTL_MS) {
    return { domestic: cache.domestic, overseas: cache.overseas, total: cache.total };
  }
  const totals = await fetchTotals();
  // fetch 실패(전 항목 0)면 직전 캐시 유지
  if (totals.total === 0 && cache) return { domestic: cache.domestic, overseas: cache.overseas, total: cache.total };
  cache = { ...totals, fetchedAt: Date.now() };
  return totals;
}

/** 시장별 평가액(KRW). pct 기반 한도 계산용. */
export async function getPortfolioTotalByMarketKRW(market: Market, forceFresh = false): Promise<number> {
  const t = await getPortfolioTotalsKRW(forceFresh);
  return market === 'overseas' ? t.overseas : t.domestic;
}

/** @deprecated 시장별 분리 한도로 정책 변경 (2026-04-27) — getPortfolioTotalByMarketKRW 사용. 합계 표시용으로만 유지. */
export async function getPortfolioTotalKRW(forceFresh = false): Promise<number> {
  const { total } = await getPortfolioTotalsKRW(forceFresh);
  return total;
}

/** 테스트/진단용 캐시 무효화 */
export function clearPortfolioTotalCache(): void {
  cache = null;
}
