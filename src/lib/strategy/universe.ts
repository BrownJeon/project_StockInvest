import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { fetchMarketCapRanking, getKisTickers, getKisOverseasTickers, kis } from '@/lib/exchanges/kis';
import type { Market } from '@/lib/exchanges/kis-symbols';
import { getStaticOverseasUniverse } from '@/lib/strategy/universe-overseas-static';
import { atrLast } from '@/lib/strategy/indicators/atr';
import { emaLast } from '@/lib/strategy/indicators/ema';
import { rsiLast } from '@/lib/strategy/indicators/rsi';
import { bollinger } from '@/lib/strategy/indicators/bollinger';

export type StrategyProfile = 'trend' | 'mean-rev' | 'breakout';
export type UniverseTier = 'core' | 'satellite' | 'speculative';

const UNIVERSE_TOP_N = 40;
const UNIVERSE_TTL_MS = 15 * 60 * 1000;
/** KOSPI 100/200 근사 — KIS 시총 랭킹 기준 */
const TIER_CORE_LIMIT      = 100;  // 시총 상위 1~100 = core (KOSPI 100 근사)
const TIER_SATELLITE_LIMIT = 200;  // 시총 상위 101~200 = satellite (KOSPI 200 근사)

/** 동적 조회 실패 시 폴백 목록 */
const KOSPI_TOP = [
  '005930', // 삼성전자
  '000660', // SK하이닉스
  '207940', // 삼성바이오로직스
  '005380', // 현대차
  '068270', // 셀트리온
  '105560', // KB금융
  '055550', // 신한지주
  '000270', // 기아
  '032830', // 삼성생명
  '086790', // 하나금융지주
  '012330', // 현대모비스
  '018260', // 삼성에스디에스
  '028260', // 삼성물산
  '003670', // 포스코홀딩스
  '096770', // SK이노베이션
  '034730', // SK
  '017670', // SK텔레콤
  '030200', // KT
  '003550', // LG
  '051910', // LG화학
];

const KOSDAQ_TOP = [
  '247540', // 에코프로비엠
  '086520', // 에코프로
  '196170', // 알테오젠
  '091990', // 셀트리온헬스케어
  '263750', // 펄어비스
  '357780', // 솔브레인
  '293490', // 카카오게임즈
  '112040', // 위메이드
  '039030', // 이오테크닉스
  '041510', // SM엔터테인먼트
];

const ALL_SYMBOLS = [...KOSPI_TOP, ...KOSDAQ_TOP];

const MIN_ATR_PCT = 0.005;

export interface UniverseEntry {
  symbol: string;
  rank: number;
  score: number;
  atrPct: number | null;
}

function gaussianScore(x: number, mu: number, sigma: number): number {
  return Math.exp(-0.5 * Math.pow((x - mu) / sigma, 2));
}

function normalize(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 0.5);
  return values.map(v => (v - min) / (max - min));
}

interface StockAnalysis {
  symbol: string;
  atrPct: number;
  ema20: number;
  ema50: number;
  rsi14: number;
  bbWidth: number;
  close: number;
  quoteVolume: number;
}

async function analyzeSymbol(symbol: string, quoteVolume: number): Promise<StockAnalysis | null> {
  try {
    const candles = await kis.getCandles(symbol, '1d', 70);
    if (candles.length < 55) return null;
    const closes = candles.map(c => c.close);
    const atr = atrLast(candles, 14);
    const ema20 = emaLast(closes, 20);
    const ema50 = emaLast(closes, 50);
    const rsi14 = rsiLast(closes, 14);
    const bands = bollinger(closes, 20, 2);
    const lastBand = bands[bands.length - 1];
    if (atr == null || ema20 == null || ema50 == null || rsi14 == null || lastBand.middle == null) return null;
    const close = closes[closes.length - 1];
    const atrPct = atr / close;
    if (atrPct < MIN_ATR_PCT) return null;
    const bbWidth = lastBand.upper != null && lastBand.lower != null
      ? (lastBand.upper - lastBand.lower) / lastBand.middle
      : 0;
    return { symbol, atrPct, ema20, ema50, rsi14, bbWidth, close, quoteVolume };
  } catch {
    return null;
  }
}

function scoreForProfile(a: StockAnalysis, profile: StrategyProfile, volScore: number): number {
  switch (profile) {
    case 'trend': {
      const trendScore = a.ema20 > a.ema50 ? 1 : 0;
      const atrScore = gaussianScore(a.atrPct, 0.015, 0.01);
      return volScore * 0.2 + trendScore * 0.5 + atrScore * 0.3;
    }
    case 'mean-rev': {
      // RSI<35 강한 부스트 — 과매도 진입 종목이 풀 상단으로 올라오도록 비선형 가중
      // RSI 28 → bonus 1.0, RSI 35 → bonus 0, RSI 21 → bonus 2.0(상한 1.0 적용)
      const oversoldBonus = a.rsi14 < 35 ? Math.min(1, (35 - a.rsi14) / 7) : 0;
      const rsiScore = Math.max(0, (50 - a.rsi14) / 50);
      const atrScore = gaussianScore(a.atrPct, 0.012, 0.008);
      return volScore * 0.15 + rsiScore * 0.35 + atrScore * 0.20 + oversoldBonus * 0.30;
    }
    case 'breakout': {
      const bbScore = Math.min(1, a.bbWidth / 0.1);
      const atrScore = gaussianScore(a.atrPct, 0.018, 0.012);
      return volScore * 0.2 + bbScore * 0.4 + atrScore * 0.4;
    }
  }
}

/**
 * 거래대금 상위 20개 종목을 분석하고 프로파일별 상위 5개를 DB에 저장.
 * universe 테이블의 refreshed_at이 15분 이내면 스킵 (force=true로 강제 갱신 가능).
 */
export async function refreshUniverse(market: Market = 'domestic', force = false): Promise<{ refreshed: boolean }> {
  const pool = getPool();

  if (!force) {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT refreshed_at FROM symbol_universe WHERE market = ? ORDER BY refreshed_at DESC LIMIT 1',
      [market],
    );
    if (rows.length > 0) {
      const age = Date.now() - new Date(rows[0].refreshed_at as string).getTime();
      if (age < UNIVERSE_TTL_MS) return { refreshed: false };
    }
  }

  // 시장별 종목 후보 구성
  // tierMap: 시총 랭킹 기반 종목별 tier 분류 (KOSPI 100/200 근사). 거래대금 상위 fallback은 'speculative'.
  const tierMap = new Map<string, UniverseTier>();
  let top20: Array<{ symbol: string; quoteVolume24h: number }>;
  if (market === 'domestic') {
    // 시총 상위 200까지 fetch — core(1~100) / satellite(101~200) tier 분류용
    const ranked = await fetchMarketCapRanking(TIER_SATELLITE_LIMIT);
    if (ranked.length > 0) {
      // stock_meta에 종목명 upsert (검색·표시용)
      try {
        for (const r of ranked) {
          if (!r.symbol || !r.name) continue;
          await pool.query(
            `INSERT INTO stock_meta (symbol, name, market) VALUES (?, ?, 'domestic')
               ON DUPLICATE KEY UPDATE name = VALUES(name), market = VALUES(market)`,
            [r.symbol, r.name],
          );
        }
      } catch { /* meta upsert 실패는 universe에 영향 없음 */ }
      // 시총 순으로 tier 부여 (ranked는 이미 시총 내림차순 가정 — 안전을 위해 재정렬)
      const byMarketCap = [...ranked].sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
      byMarketCap.forEach((r, idx) => {
        if (idx < TIER_CORE_LIMIT)            tierMap.set(r.symbol, 'core');
        else if (idx < TIER_SATELLITE_LIMIT)  tierMap.set(r.symbol, 'satellite');
      });
      // top20은 거래대금 상위 — universe 평가용 (현행 동등)
      top20 = ranked
        .sort((a, b) => b.quoteVolume - a.quoteVolume)
        .slice(0, UNIVERSE_TOP_N)
        .map(r => ({ symbol: r.symbol, quoteVolume24h: r.quoteVolume }));
    } else {
      const tickers = await getKisTickers(ALL_SYMBOLS);
      top20 = tickers
        .sort((a, b) => (b.quoteVolume24h ?? 0) - (a.quoteVolume24h ?? 0))
        .slice(0, UNIVERSE_TOP_N)
        .map(t => ({ symbol: t.symbol, quoteVolume24h: t.quoteVolume24h ?? 0 }));
    }
  } else {
    // 해외: 시총 랭킹 API 부재 → 정적 allowlist + 거래대금 정렬
    const overseasSyms = getStaticOverseasUniverse();
    const tickers = await getKisOverseasTickers(overseasSyms);
    top20 = tickers
      .sort((a, b) => (b.quoteVolume24h ?? 0) - (a.quoteVolume24h ?? 0))
      .slice(0, UNIVERSE_TOP_N)
      .map(t => ({ symbol: t.symbol, quoteVolume24h: t.quoteVolume24h ?? 0 }));
  }

  if (top20.length === 0) return { refreshed: false };

  const analyses = (await Promise.all(
    top20.map(t => analyzeSymbol(t.symbol, t.quoteVolume24h ?? 0)),
  )).filter((a): a is StockAnalysis => a !== null);

  if (analyses.length === 0) return { refreshed: false };

  // 적응형 interval — 분석 시점의 ATR%를 symbol_volatility에 upsert
  // analyses[i].atrPct는 ratio(0~1) → ×100으로 percent 변환 후 저장
  try {
    const { upsertSymbolVolatility } = await import('./adaptive-interval');
    await Promise.all(analyses.map(a => upsertSymbolVolatility(a.symbol, a.atrPct * 100, 14, '30m')));
  } catch { /* 비차단 */ }

  const volumes = analyses.map(a => Math.log(a.quoteVolume + 1));
  const normVolumes = normalize(volumes);

  const profiles: StrategyProfile[] = ['trend', 'mean-rev', 'breakout'];
  const now = new Date();

  for (const profile of profiles) {
    // mean-rev는 매수 후보 풀 확대 (과매도 종목 포착률 ↑)
    const profileTopN = profile === 'mean-rev' ? 8 : 5;
    const scored = analyses
      .map((a, i) => ({
        symbol: a.symbol,
        score: scoreForProfile(a, profile, normVolumes[i]),
        atrPct: a.atrPct,
        volRank: top20.findIndex(t => t.symbol === a.symbol) + 1,
        detail: { atrPct: a.atrPct, ema20: a.ema20, ema50: a.ema50, rsi14: a.rsi14, bbWidth: a.bbWidth, volScore: normVolumes[i] },
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, profileTopN);

    for (let i = 0; i < scored.length; i++) {
      const s = scored[i];
      const tier = tierMap.get(s.symbol) ?? 'speculative';
      await pool.query(
        `INSERT INTO symbol_universe (refreshed_at, profile, symbol, rank_pos, score, vol_rank, atr_pct, tier, score_detail, market)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [now, profile, s.symbol, i + 1, s.score.toFixed(6), s.volRank, s.atrPct.toFixed(4), tier, JSON.stringify(s.detail), market],
      );
    }
  }

  await pool.query(
    "DELETE FROM symbol_universe WHERE refreshed_at < DATE_SUB(NOW(), INTERVAL 48 HOUR)",
  );

  return { refreshed: true };
}

/**
 * 최신 universe에서 프로파일별 상위 N개 심볼 반환.
 * DB가 비어있거나 TTL 초과 시 빈 배열 반환 (fallback은 호출부 책임).
 *
 * universeSource:
 *  - 'kospi100'   → tier=core 만 (시총 상위 100)
 *  - 'kospi200'   → tier IN (core, satellite) (시총 상위 200)
 *  - 'volume-top' → 모든 tier 허용 (현행 거래대금 상위 — 기본값)
 */
export async function getUniverseSymbols(
  profile: StrategyProfile,
  topN = 5,
  market: Market = 'domestic',
  universeSource: 'volume-top' | 'kospi200' | 'kospi100' = 'volume-top',
): Promise<string[]> {
  const pool = getPool();
  const [latest] = await pool.query<RowDataPacket[]>(
    'SELECT refreshed_at FROM symbol_universe WHERE market = ? ORDER BY refreshed_at DESC LIMIT 1',
    [market],
  );
  if (latest.length === 0) return [];

  const age = Date.now() - new Date(latest[0].refreshed_at as string).getTime();
  if (age > UNIVERSE_TTL_MS * 2) return [];

  // tier 필터 — universeSource에 따라 분기
  const tierFilter =
    universeSource === 'kospi100' ? `AND tier = 'core'` :
    universeSource === 'kospi200' ? `AND tier IN ('core','satellite')` :
                                     '';  // volume-top: 모든 tier

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT symbol FROM symbol_universe
     WHERE profile = ? AND refreshed_at = ? AND market = ? ${tierFilter}
     ORDER BY rank_pos ASC LIMIT ?`,
    [profile, latest[0].refreshed_at, market, topN],
  );
  return rows.map(r => r.symbol as string);
}

/** 현재 universe에서 모든 프로파일의 선별 종목 조회 (UI/로그용) */
export async function getUniverseSnapshot(): Promise<Record<StrategyProfile, UniverseEntry[]>> {
  const pool = getPool();
  const [latest] = await pool.query<RowDataPacket[]>(
    'SELECT refreshed_at FROM symbol_universe ORDER BY refreshed_at DESC LIMIT 1',
  );
  if (latest.length === 0) return { trend: [], 'mean-rev': [], breakout: [] };

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT profile, symbol, rank_pos, score, atr_pct
     FROM symbol_universe WHERE refreshed_at = ?
     ORDER BY profile, rank_pos`,
    [latest[0].refreshed_at],
  );

  const result: Record<StrategyProfile, UniverseEntry[]> = { trend: [], 'mean-rev': [], breakout: [] };
  for (const r of rows) {
    const p = r.profile as StrategyProfile;
    if (p in result) {
      result[p].push({ symbol: r.symbol as string, rank: Number(r.rank_pos), score: Number(r.score), atrPct: r.atr_pct != null ? Number(r.atr_pct) : null });
    }
  }
  return result;
}
