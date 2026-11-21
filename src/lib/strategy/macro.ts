import { kis } from '@/lib/exchanges/kis';
import { getUsdKrwRate } from '@/lib/exchanges/fx';

/**
 * 거시 시장 지표 — 전략 엔진의 거시 하락 게이트(regime gate) 입력.
 *  - KOSPI: KODEX 200 (069500) 사용 — 코스피 추종 ETF, 시세 API 호환성 ↑
 *  - SP500: AMS:SPY (SPDR S&P 500 ETF Trust — NYSE Arca 상장이라 KIS 거래소 코드는 `AMS`)
 *  - USD/KRW: fx 모듈 + 24h 전 캐시 비교
 *
 * 지수 변화율은 **전일 종가 대비**다(T-183): `(price − prevClose) / prevClose × 100`.
 *   종전에는 `open24h` 를 기준으로 썼는데, 국내 `open24h` 는 **당일 시가**라 갭 하락분이 통째로 빠졌다
 *   (2026-11-20 실측: KODEX200 전일 대비 −5.48% 인데 계산값 −1.50%). 또 `NYS:SPY` 는 KIS 가 오류 없이
 *   빈 값을 돌려줘(같은 날 실측) S&P 변화율이 늘 null 이었다 — 게이트가 한 번도 작동할 수 없었던 원인.
 *
 * 지수별 5분 in-memory 캐시 (분석가 5분 cron 주기에 맞춤). **판정 불가 결과는 캐시하지 않는다** —
 * 일시 장애 뒤 다음 틱에 바로 다시 조회한다. 성공한 지수만 캐시하므로 한쪽 실패가 다른 쪽 재조회를 부르지 않는다.
 */

const CACHE_TTL_MS = 5 * 60 * 1000;

/** 지수 1개의 판정 결과 — `pct` 가 null 이면 `error` 에 사유를 담는다. */
export interface MacroIndexReading {
  pct: number | null;
  error?: string;
}

export interface MacroIndicators {
  kospiChangePct: number | null;
  sp500ChangePct: number | null;
  usdKrwChangePct: number | null;
  /** (T-183) `kospiChangePct` 가 null 인 사유 — 성공이면 없음 */
  kospiError?: string;
  /** (T-183) `sp500ChangePct` 가 null 인 사유 — 성공이면 없음 */
  sp500Error?: string;
}

export const KOSPI_PROXY = '069500';   // KODEX 200
export const SP500_PROXY = 'AMS:SPY';  // T-183 실측: `NYS:SPY` 는 rt_cd=0 + 전 필드 빈 값, `AMS:SPY` 정상

/** 사유 문구 상한 — 예외 메시지가 응답 본문을 통째로 싣는 경우가 있어 자른다 */
const ERROR_MAX_LEN = 200;

/** 변화율 반올림 단위 — 소수 6자리. 부동소수 경계 잡음(1e-12 수준)만 지우고 판정에 의미 있는 자릿수는 남긴다 */
const PCT_ROUND = 1e6;

const readingCache = new Map<string, { reading: MacroIndexReading; ts: number }>();
let usdKrwCache: { value: number; ts: number } | null = null;
let prevUsdKrw: { rate: number; ts: number } | null = null;

/**
 * 전일 종가 대비 변화율(%). 예외를 삼키지 않고 사유를 돌려준다 — 호출자가 `regime_gate_macro_error` 로 기록한다.
 * 사유: `price_unavailable`(현재가 빈 값·0·NaN) · `prev_close_unavailable`(전일 종가 없음) · `ticker_error: <메시지>`.
 *
 * 결과는 소수 6자리로 반올림한다(T-183 라운드 2, Codex C2 지적 1). 해외는 어댑터가 현재가·전일 종가에 같은 환율을 곱해
 * KRW 로 넘기므로 수학적으로는 환율이 약분되지만 부동소수로는 잡음이 남는다 — 예: `last=689.50·base=700.00·환율 1332.1`
 * 이면 USD 비율은 정확히 −1.5% 인데 환산값으로 계산하면 `-1.4999999999999927` 이 되어 게이트의 `<= -1.5` 가 거짓이 된다.
 * 소비처가 게이트 외에도 있으므로(같은 값이 다른 모듈로도 간다) 비교 쪽이 아니라 여기 한 곳에서 정규화한다.
 */
async function safeChange(symbol: string): Promise<MacroIndexReading> {
  try {
    const t = await kis.getTicker(symbol);
    if (!Number.isFinite(t.price) || t.price <= 0) return { pct: null, error: 'price_unavailable' };
    const prev = t.prevClose;
    if (prev == null || !Number.isFinite(prev) || prev <= 0) return { pct: null, error: 'prev_close_unavailable' };
    return { pct: Math.round(((t.price - prev) / prev) * 100 * PCT_ROUND) / PCT_ROUND };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { pct: null, error: `ticker_error: ${msg}`.slice(0, ERROR_MAX_LEN) };
  }
}

/** 성공한 지수만 TTL 동안 캐시한다 — 실패는 캐시하지 않아 다음 호출에서 다시 조회한다. */
async function cachedChange(symbol: string): Promise<MacroIndexReading> {
  const hit = readingCache.get(symbol);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.reading;
  const reading = await safeChange(symbol);
  if (reading.pct != null) readingCache.set(symbol, { reading, ts: Date.now() });
  else readingCache.delete(symbol);
  return reading;
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

async function cachedUsdKrwChange(): Promise<number | null> {
  if (usdKrwCache && Date.now() - usdKrwCache.ts < CACHE_TTL_MS) return usdKrwCache.value;
  const value = await usdKrwChange();
  if (value != null) usdKrwCache = { value, ts: Date.now() };
  else usdKrwCache = null;
  return value;
}

export async function fetchMacroIndicators(): Promise<MacroIndicators> {
  const [kospi, sp500, usdKrwChangePct] = await Promise.all([
    cachedChange(KOSPI_PROXY),
    cachedChange(SP500_PROXY),
    cachedUsdKrwChange(),
  ]);
  return {
    kospiChangePct: kospi.pct,
    sp500ChangePct: sp500.pct,
    usdKrwChangePct,
    ...(kospi.error ? { kospiError: kospi.error } : {}),
    ...(sp500.error ? { sp500Error: sp500.error } : {}),
  };
}

export function clearMacroCache(): void {
  readingCache.clear();
  usdKrwCache = null;
  prevUsdKrw = null;
}
