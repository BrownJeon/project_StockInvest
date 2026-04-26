/**
 * 종목별 변동성 기반 적응형 interval 선택.
 *
 * 정책:
 *  - 베이스 interval이 '1d'면 그대로 (장기 추세는 변동성과 무관)
 *  - 베이스 '30m' / '1h'에 대해서만 변동성 기반 조정
 *  - ATR(14) / 종가 × 100 = atr_pct
 *      * ≥ 3.0%  (고변동) → '30m' (빠른 반응)
 *      * 1.0~3.0% (중변동) → '1h'  (균형)
 *      * < 1.0%   (저변동) → '1h'  ('15m'은 KIS·수수료 부담으로 기본 30m로 폴백 안 함; 저변동은 노이즈 줄이려 1h)
 *
 * 데이터:
 *  - DB `symbol_volatility` 테이블 — universe 갱신 시 함께 측정·저장
 *  - 미존재 시 베이스 interval 그대로 반환 (안전 폴백)
 *
 * 백테스트 결과 기반 미세 조정:
 *  - `backtests` 테이블 또는 `last_backtest_result`에 저장된 sharpe/winrate를 후행 보정에 활용 가능 (TODO)
 *  - 현재는 변동성 단일 신호만 사용 (1단계)
 */
import type { RowDataPacket } from 'mysql2';
import { getPool } from './../db';

export type Interval = '1m' | '3m' | '5m' | '10m' | '15m' | '30m' | '1h' | '1d';

interface VolatilityRow extends RowDataPacket {
  atr_pct: string;
  suggested_interval: string;
}

const memCache = new Map<string, { suggested: Interval; fetchedAt: number }>();
const TTL_MS = 5 * 60 * 1000;

export function pickIntervalByAtrPct(baseInterval: string, atrPct: number): Interval {
  if (baseInterval === '1d') return '1d';
  if (atrPct >= 3.0) return '30m';
  return '1h';
}

/**
 * 베이스 interval과 종목을 받아 적응형 interval 반환.
 * DB 변동성 정보가 없거나 베이스가 1d면 베이스 그대로.
 */
export async function pickAdaptiveInterval(symbol: string, baseInterval: string): Promise<Interval> {
  if (baseInterval === '1d') return '1d';

  const cached = memCache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached.suggested;

  try {
    const pool = getPool();
    const [rows] = await pool.query<VolatilityRow[]>(
      'SELECT atr_pct, suggested_interval FROM symbol_volatility WHERE symbol = ? LIMIT 1',
      [symbol],
    );
    if (rows.length === 0) {
      memCache.set(symbol, { suggested: baseInterval as Interval, fetchedAt: Date.now() });
      return baseInterval as Interval;
    }
    const atrPct = Number(rows[0].atr_pct);
    if (!Number.isFinite(atrPct)) return baseInterval as Interval;
    const suggested = pickIntervalByAtrPct(baseInterval, atrPct);
    memCache.set(symbol, { suggested, fetchedAt: Date.now() });
    return suggested;
  } catch {
    return baseInterval as Interval;
  }
}

/**
 * 종목 변동성 측정값 upsert. universe.ts 등에서 ATR 계산 후 호출.
 */
export async function upsertSymbolVolatility(
  symbol: string,
  atrPct: number,
  sampleCount: number,
  baseInterval: string = '30m',
): Promise<void> {
  if (!Number.isFinite(atrPct) || atrPct < 0) return;
  const suggested = pickIntervalByAtrPct(baseInterval, atrPct);
  try {
    const pool = getPool();
    await pool.query(
      `INSERT INTO symbol_volatility (symbol, atr_pct, suggested_interval, sample_count)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE atr_pct = VALUES(atr_pct), suggested_interval = VALUES(suggested_interval),
                                sample_count = VALUES(sample_count)`,
      [symbol, atrPct.toFixed(4), suggested, sampleCount],
    );
    // 캐시 무효화 (다음 pickAdaptiveInterval 호출에서 새 값 로드)
    memCache.delete(symbol);
  } catch (e) {
    console.error('[adaptive-interval] upsert failed:', e instanceof Error ? e.message : String(e));
  }
}

/** 테스트용 캐시 비우기 */
export function clearAdaptiveIntervalCache(): void {
  memCache.clear();
}
