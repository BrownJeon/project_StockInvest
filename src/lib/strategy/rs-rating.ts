import { getPool } from '@/lib/db';
import { kis } from '@/lib/exchanges/kis';
import type { RowDataPacket } from 'mysql2';

export interface RsResult {
  symbol: string;
  rsRating: number;       // 0~99 (백분위)
  near52wHigh: boolean;
  volRatio20d: number;
  pct1m: number;
  pct3m: number;
  pct6m: number;
  pct12m: number;
}

const CANDLES_1Y = 260;
const BARS_1M = 22;
const BARS_3M = 63;
const BARS_6M = 126;
const BARS_12M = 252;
const NEAR_52W_THRESHOLD = 0.90;
const VOL_RATIO_THRESHOLD = 1.5;

function retPct(candles: { close: number }[], bars: number): number {
  const len = candles.length;
  if (len < bars + 1) return 0;
  const old = candles[len - bars - 1].close;
  const cur = candles[len - 1].close;
  if (old <= 0) return 0;
  return ((cur - old) / old) * 100;
}

function rsScore(p1m: number, p3m: number, p6m: number, p12m: number): number {
  return 0.1 * p1m + 0.4 * p3m + 0.3 * p6m + 0.2 * p12m;
}

async function computeOne(symbol: string): Promise<{
  symbol: string; score: number; near52wHigh: boolean; volRatio20d: number;
  pct1m: number; pct3m: number; pct6m: number; pct12m: number;
} | null> {
  try {
    const candles = await kis.getCandles(symbol, '1d', CANDLES_1Y);
    if (!candles || candles.length < 30) return null;

    const closes = candles.map((c) => ({ close: c.close, volume: c.volume ?? 0, high: c.high }));

    const pct1m  = retPct(closes, BARS_1M);
    const pct3m  = retPct(closes, BARS_3M);
    const pct6m  = retPct(closes, BARS_6M);
    const pct12m = retPct(closes, BARS_12M);
    const score  = rsScore(pct1m, pct3m, pct6m, pct12m);

    // 52주 신고가 근접
    const relevant = closes.slice(-BARS_12M);
    const max52w = Math.max(...relevant.map((c) => c.high));
    const cur = closes[closes.length - 1].close;
    const near52wHigh = max52w > 0 && cur / max52w >= NEAR_52W_THRESHOLD;

    // 거래량 비율 (20일 평균 대비)
    const volSlice = closes.slice(-21);
    const avgVol20 = volSlice.slice(0, 20).reduce((s, c) => s + c.volume, 0) / 20;
    const todayVol = closes[closes.length - 1].volume;
    const volRatio20d = avgVol20 > 0 ? todayVol / avgVol20 : 0;

    return { symbol, score, near52wHigh, volRatio20d, pct1m, pct3m, pct6m, pct12m };
  } catch {
    return null;
  }
}

export async function updateRsRatings(market: 'domestic' | 'overseas' = 'domestic'): Promise<number> {
  const pool = getPool();

  // 최신 universe 배치에서 중복 제거된 심볼 목록 조회
  const [rows] = await pool.query<RowDataPacket[]>(`
    SELECT DISTINCT symbol
    FROM symbol_universe
    WHERE market = ?
      AND refreshed_at >= DATE_SUB(NOW(), INTERVAL 48 HOUR)
    LIMIT 250
  `, [market]);

  const symbols = rows.map((r) => r.symbol as string);
  if (symbols.length === 0) return 0;

  // 순차 계산 (KIS rate limit 방지, 100ms 간격)
  const results: Array<ReturnType<typeof computeOne> extends Promise<infer T> ? Exclude<T, null> : never> = [];
  for (const sym of symbols) {
    const r = await computeOne(sym);
    if (r) results.push(r as NonNullable<Awaited<ReturnType<typeof computeOne>>>);
    await new Promise((res) => setTimeout(res, 100));
  }

  if (results.length === 0) return 0;

  // 백분위 계산
  const scores = results.map((r) => r.score).sort((a, b) => a - b);
  const percentile = (score: number) => {
    const rank = scores.filter((s) => s < score).length;
    return Math.round((rank / scores.length) * 99);
  };

  // DB upsert
  for (const r of results) {
    const rating = percentile(r.score);
    await pool.query(
      `UPDATE symbol_universe
       SET rs_rating = ?, near_52w_high = ?, vol_ratio_20d = ?, rs_updated_at = NOW()
       WHERE symbol = ? AND market = ?
         AND refreshed_at >= DATE_SUB(NOW(), INTERVAL 48 HOUR)`,
      [rating, r.near52wHigh ? 1 : 0, r.volRatio20d, r.symbol, market],
    );
  }

  return results.length;
}

export async function getLeaders(
  market: 'domestic' | 'overseas' | 'all',
  opts: { minRs?: number; requireNear52w?: boolean; requireVolSpike?: boolean } = {},
): Promise<RsResult[]> {
  const pool = getPool();
  const { minRs = 0, requireNear52w = false, requireVolSpike = false } = opts;

  const conditions = ['rs_rating IS NOT NULL'];
  const params: unknown[] = [];

  if (market !== 'all') { conditions.push('market = ?'); params.push(market); }
  if (minRs > 0) { conditions.push('rs_rating >= ?'); params.push(minRs); }
  if (requireNear52w) conditions.push('near_52w_high = 1');
  if (requireVolSpike) { conditions.push('vol_ratio_20d >= ?'); params.push(VOL_RATIO_THRESHOLD); }

  const where = conditions.join(' AND ');
  const [rows] = await pool.query<RowDataPacket[]>(`
    SELECT su.symbol, sm.name, su.rs_rating, su.near_52w_high, su.vol_ratio_20d,
           su.rs_updated_at, su.market
    FROM (
      SELECT symbol, market, rs_rating, near_52w_high, vol_ratio_20d, rs_updated_at
      FROM symbol_universe
      WHERE ${where}
      ORDER BY refreshed_at DESC
    ) su
    LEFT JOIN stock_meta sm ON sm.symbol = su.symbol
    GROUP BY su.symbol
    ORDER BY su.rs_rating DESC
    LIMIT 100
  `, params);

  return rows.map((r) => ({
    symbol: r.symbol as string,
    rsRating: Number(r.rs_rating),
    near52wHigh: Boolean(r.near_52w_high),
    volRatio20d: Number(r.vol_ratio_20d ?? 0),
    pct1m: 0, pct3m: 0, pct6m: 0, pct12m: 0,
  }));
}
