/**
 * home-m4-api /v1/market-context 클라이언트
 *
 * 엔드포인트: POST {AI_API_BASE}/v1/market-context
 * 인증: X-API-Key 헤더 (AI_API_KEY 환경변수)
 * 응답: { sentiment, key_themes, risks, summary, cached, generated_at }
 *
 * 5분 in-process 캐시 (M4 서버 자체가 30분 Redis 캐시를 가지므로
 * 로컬 캐시는 불필요한 네트워크 요청만 줄이는 역할).
 *
 * 실패(timeout / HTTP 에러 / AI_API_BASE 미설정) 시 null 반환 — 분석 차단 없음.
 */
import { trackCall } from '@/lib/api-usage';

export type MarketSentiment = 'bullish' | 'neutral' | 'bearish';

export interface MarketContextResult {
  sentiment: MarketSentiment;
  key_themes: string[];
  risks: string[];
  summary: string;
  cached: boolean;
  generated_at: string;
}

type ClientMarket = 'domestic' | 'overseas' | 'crypto';

const CACHE_TTL_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 10_000;

const cache = new Map<ClientMarket, { value: MarketContextResult; ts: number }>();

// 서킷 브레이커: 연속 실패 3회 → 5분간 호출 스킵 (timeout 대기 제거 + 로그 노이즈 감소)
const CIRCUIT_FAIL_THRESHOLD = 3;
const CIRCUIT_OPEN_MS = 5 * 60 * 1000;
let circuitFailCount = 0;
let circuitOpenUntil = 0;

/**
 * /v1/market-context를 호출하고 결과를 반환한다.
 *
 * - AI_API_BASE 미설정 → null 반환 (graceful fallback)
 * - timeout / HTTP 에러 → null 반환, 에러 로그만
 * - 5분 in-process 캐시 적용
 */
export async function fetchMarketContext(
  market: ClientMarket,
): Promise<MarketContextResult | null> {
  const base = process.env.AI_API_BASE;
  if (!base) return null;

  // 서킷 브레이커 open 상태이면 즉시 null 반환 (10초 timeout 대기 없이)
  if (circuitOpenUntil > Date.now()) return null;

  const cached = cache.get(market);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.value;

  const apiKey = process.env.AI_API_KEY ?? '';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    // T-040 호출 기록 — 자체 타이머 abort 는 timeout 으로 분류한다.
    const res = await trackCall('m4', 'market-context', () => fetch(`${base}/v1/market-context`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({ market }),
      signal: ctrl.signal,
      cache: 'no-store',
    }), { err: () => (ctrl.signal.aborted ? 'timeout' : undefined) });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(
        `[market-context] HTTP ${res.status} market=${market} body=${body.slice(0, 200)}`,
      );
      return null;
    }

    const data = (await res.json()) as MarketContextResult;
    if (!data.sentiment) {
      console.error(`[market-context] unexpected response shape market=${market}`);
      return null;
    }

    // 성공 → 서킷 브레이커 리셋
    circuitFailCount = 0;
    circuitOpenUntil = 0;
    cache.set(market, { value: data, ts: Date.now() });
    console.log(
      `[market-context] market=${market} sentiment=${data.sentiment} cached=${data.cached}`,
    );
    return data;
  } catch (e) {
    // 실패 카운트 증가 — 임계값 초과 시 서킷 오픈
    circuitFailCount++;
    if (circuitFailCount >= CIRCUIT_FAIL_THRESHOLD) {
      circuitOpenUntil = Date.now() + CIRCUIT_OPEN_MS;
      console.warn(`[market-context] circuit OPEN for 5min (${circuitFailCount} consecutive failures)`);
    }
    if (e instanceof Error && e.name === 'AbortError') {
      console.error(`[market-context] timeout after ${TIMEOUT_MS}ms market=${market}`);
    } else {
      console.error(
        `[market-context] fetch error market=${market}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}
