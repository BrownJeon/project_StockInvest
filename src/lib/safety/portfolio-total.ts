/**
 * 포트폴리오 총 평가액 (KRW 환산) 조회.
 *
 * 우선순위:
 *  1) 단순 합산 — kis.getBalances() 응답을 기반으로 KRW 예수금 + 종목 평가금액 합
 *  2) 실패 시 0 (호출자가 폴백)
 *
 * pct 기반 주문 한도 계산용. 짧은 in-memory 캐시(60초)로 중복 호출 방지.
 */
import { kis } from '@/lib/exchanges/kis';
import { usdToKrw } from '@/lib/exchanges/fx';

interface Cache { value: number; fetchedAt: number }
const TTL_MS = 60_000;
let cache: Cache | null = null;

export async function getPortfolioTotalKRW(forceFresh = false): Promise<number> {
  if (!forceFresh && cache && Date.now() - cache.fetchedAt < TTL_MS) return cache.value;

  try {
    const balances = await kis.getBalances();
    let totalKRW = 0;
    let totalUSD = 0;

    for (const b of balances) {
      const qty = Number(b.free) + Number(b.locked);
      if (qty <= 0) continue;
      if (b.currency === 'KRW') {
        totalKRW += qty;
      } else if (b.currency === 'USD') {
        totalUSD += qty;
      } else {
        // 종목 보유분: 현재가 × qty 평가
        try {
          const ticker = await kis.getTicker(b.currency);
          const price = Number(ticker.price);
          if (Number.isFinite(price) && price > 0) {
            const amount = price * qty;
            // 해외 심볼이면 USD 가격 → KRW 환산 누적
            if (b.currency.includes(':')) totalUSD += amount;
            else totalKRW += amount;
          }
        } catch { /* 한 종목 실패는 무시 */ }
      }
    }

    if (totalUSD > 0) {
      try { totalKRW += await usdToKrw(totalUSD); }
      catch { /* fx 실패 시 USD 부분 제외 */ }
    }

    cache = { value: totalKRW, fetchedAt: Date.now() };
    return totalKRW;
  } catch {
    return cache?.value ?? 0;
  }
}

/** 테스트/진단용 캐시 무효화 */
export function clearPortfolioTotalCache(): void {
  cache = null;
}
