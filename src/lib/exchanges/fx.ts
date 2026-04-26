/**
 * USD/KRW 환율 조회·캐시.
 *
 * 우선순위:
 *  1. in-memory 캐시 (TTL 5분)
 *  2. fx_rates 테이블 (TTL 5분)
 *  3. 외부 API (https://api.exchangerate.host) — 키 불필요
 *  4. env FX_USDKRW_FALLBACK (디폴트 1380)
 *
 * 캐시가 24시간 초과 stale이면 주문 차단 가능 (호출자 판단).
 */
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';

const PAIR = 'USD_KRW';
const TTL_MS = 5 * 60 * 1000;
const STALE_MAX_MS = 24 * 60 * 60 * 1000;

const memCache: { rate?: number; fetchedAt?: number } = {};

interface FxRow extends RowDataPacket {
  rate: string;
  fetched_at: Date;
}

function fallbackRate(): number {
  const v = Number(process.env.FX_USDKRW_FALLBACK ?? '1380');
  return Number.isFinite(v) && v > 0 ? v : 1380;
}

interface FxSource {
  name: string;
  url: string;
  parse: (data: unknown) => number | null;
}

const FX_SOURCES: FxSource[] = [
  // ECB 일중 환율, 키 불필요
  {
    name: 'frankfurter',
    url: 'https://api.frankfurter.app/latest?from=USD&to=KRW',
    parse: (d) => {
      const data = d as { rates?: { KRW?: number } };
      return Number(data?.rates?.KRW) || null;
    },
  },
  // open.er-api.com — 키 불필요, 일 1회 갱신
  {
    name: 'open.er-api',
    url: 'https://open.er-api.com/v6/latest/USD',
    parse: (d) => {
      const data = d as { rates?: { KRW?: number } };
      return Number(data?.rates?.KRW) || null;
    },
  },
  // exchangerate.host — 최근 무료 정책 변경되어 신뢰도 낮음, 마지막 시도
  {
    name: 'exchangerate.host',
    url: 'https://api.exchangerate.host/latest?base=USD&symbols=KRW',
    parse: (d) => {
      const data = d as { rates?: { KRW?: number } };
      return Number(data?.rates?.KRW) || null;
    },
  },
];

async function fetchExternal(): Promise<number | null> {
  for (const src of FX_SOURCES) {
    try {
      const res = await fetch(src.url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) continue;
      const data = await res.json();
      const rate = src.parse(data);
      if (rate != null && Number.isFinite(rate) && rate > 0) {
        console.log(`[fx] fetched USD/KRW=${rate} from ${src.name}`);
        return rate;
      }
    } catch (e) {
      console.warn(`[fx] ${src.name} failed:`, e instanceof Error ? e.message : String(e));
    }
  }
  return null;
}

async function readDbCache(): Promise<{ rate: number; fetchedAt: number } | null> {
  try {
    const pool = getPool();
    const [rows] = await pool.query<FxRow[]>(
      `SELECT rate, fetched_at FROM fx_rates WHERE pair = ? LIMIT 1`,
      [PAIR],
    );
    if (rows.length === 0) return null;
    return {
      rate:      Number(rows[0].rate),
      fetchedAt: new Date(rows[0].fetched_at).getTime(),
    };
  } catch {
    return null;
  }
}

async function writeDbCache(rate: number): Promise<void> {
  try {
    const pool = getPool();
    await pool.query<ResultSetHeader>(
      `INSERT INTO fx_rates (pair, rate, fetched_at) VALUES (?, ?, NOW())
         ON DUPLICATE KEY UPDATE rate = VALUES(rate), fetched_at = VALUES(fetched_at)`,
      [PAIR, rate.toFixed(4)],
    );
  } catch {
    /* swallow */
  }
}

/**
 * USD/KRW 환율 (1 USD = N KRW). forceFresh=true면 캐시 무시하고 외부 API 재조회.
 * 모든 폴백 경로 실패 시 env FX_USDKRW_FALLBACK (디폴트 1380) 반환.
 */
export async function getUsdKrwRate(forceFresh = false): Promise<number> {
  const now = Date.now();

  if (!forceFresh && memCache.rate != null && memCache.fetchedAt != null
      && now - memCache.fetchedAt < TTL_MS) {
    return memCache.rate;
  }

  if (!forceFresh) {
    const db = await readDbCache();
    if (db && now - db.fetchedAt < TTL_MS) {
      memCache.rate = db.rate;
      memCache.fetchedAt = db.fetchedAt;
      return db.rate;
    }
  }

  const fresh = await fetchExternal();
  if (fresh != null) {
    memCache.rate = fresh;
    memCache.fetchedAt = now;
    await writeDbCache(fresh);
    return fresh;
  }

  // 외부 실패 → DB 마지막 값(stale 이라도) 사용
  const db = await readDbCache();
  if (db) {
    memCache.rate = db.rate;
    memCache.fetchedAt = db.fetchedAt;
    return db.rate;
  }

  // 최후 폴백
  const fb = fallbackRate();
  console.warn(`[fx] all sources failed, using FX_USDKRW_FALLBACK=${fb}`);
  return fb;
}

/** USD 금액을 KRW로 환산 */
export async function usdToKrw(usd: number): Promise<number> {
  const rate = await getUsdKrwRate();
  return usd * rate;
}

/** KRW 금액을 USD로 환산 */
export async function krwToUsd(krw: number): Promise<number> {
  const rate = await getUsdKrwRate();
  return krw / rate;
}

/** 캐시 강제 비우기 (테스트용) */
export function clearFxCache(): void {
  memCache.rate = undefined;
  memCache.fetchedAt = undefined;
}

/** 환율이 너무 오래된지 (24h 초과) — 주문 차단 판단용 */
export async function isFxStale(): Promise<boolean> {
  if (memCache.fetchedAt && Date.now() - memCache.fetchedAt < STALE_MAX_MS) return false;
  const db = await readDbCache();
  if (db && Date.now() - db.fetchedAt < STALE_MAX_MS) return false;
  return true;
}
