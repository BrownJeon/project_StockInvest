import { kis } from '@/lib/exchanges/kis';
import { getUsdKrwRate } from '@/lib/exchanges/fx';

/**
 * 거시 시장 지표 — 분석가 프롬프트 보강용.
 *  - KOSPI: KODEX 200 (069500) 사용 — 코스피 추종 ETF, 시세 API 호환성 ↑
 *  - SP500: NYS:SPY (SPDR S&P 500 ETF Trust)
 *  - USD/KRW: fx 모듈 + 24h 전 캐시 비교
 *
 * 5분 in-memory 캐시 (분석가 5분 cron 주기에 맞춤).
 */

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { value: MacroIndicators; ts: number } | null = null;

export interface MacroIndicators {
  kospiChangePct: number | null;
  sp500ChangePct: number | null;
  usdKrwChangePct: number | null;
}

const KOSPI_PROXY = '069500';   // KODEX 200
const SP500_PROXY = 'NYS:SPY';

let prevUsdKrw: { rate: number; ts: number } | null = null;

async function safeChange(symbol: string): Promise<number | null> {
  try {
    const t = await kis.getTicker(symbol);
    if (!t.open24h || t.open24h <= 0 || !t.price) return null;
    return ((t.price - t.open24h) / t.open24h) * 100;
  } catch {
    return null;
  }
}

async function usdKrwChange(): Promise<number | null> {
  try {
    const cur = await getUsdKrwRate();
    if (!Number.isFinite(cur) || cur <= 0) return null;
    const now = Date.now();
    if (!prevUsdKrw || now - prevUsdKrw.ts > 24 * 60 * 60 * 1000) {
      prevUsdKrw = { rate: cur, ts: now };
      return 0;
    }
    return ((cur - prevUsdKrw.rate) / prevUsdKrw.rate) * 100;
  } catch {
    return null;
  }
}

export async function fetchMacroIndicators(): Promise<MacroIndicators> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.value;
  const [kospiChangePct, sp500ChangePct, usdKrwChangePct] = await Promise.all([
    safeChange(KOSPI_PROXY),
    safeChange(SP500_PROXY),
    usdKrwChange(),
  ]);
  const value = { kospiChangePct, sp500ChangePct, usdKrwChangePct };
  cache = { value, ts: Date.now() };
  return value;
}

export function clearMacroCache(): void {
  cache = null;
  prevUsdKrw = null;
}
