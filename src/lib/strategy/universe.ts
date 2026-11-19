import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { fetchMarketCapRanking, getKisTickers, getKisOverseasTickers, kis } from '@/lib/exchanges/kis';
import { withKisPriority, mapWithLimit, DEFAULT_FANOUT_CONCURRENCY } from '@/lib/exchanges/kis-throttle';
import type { Market } from '@/lib/exchanges/kis-symbols';
import { getStaticOverseasUniverse } from '@/lib/strategy/universe-overseas-static';
import { describeErrorCause } from '@/lib/notify/result';
import { atrLast } from '@/lib/strategy/indicators/atr';
import { emaLast } from '@/lib/strategy/indicators/ema';
import { rsiLast } from '@/lib/strategy/indicators/rsi';
import { bollinger } from '@/lib/strategy/indicators/bollinger';

export type StrategyProfile = 'trend' | 'mean-rev' | 'breakout';
export type UniverseTier = 'core' | 'satellite' | 'speculative';

const UNIVERSE_TOP_N = 150;
const UNIVERSE_TTL_MS = 15 * 60 * 1000;
/** KOSPI 100/200 근사 — KIS 시총 랭킹 기준 */
const TIER_CORE_LIMIT      = 100;  // 시총 상위 1~100 = core (KOSPI 100 근사)
const TIER_SATELLITE_LIMIT = 200;  // 시총 상위 101~200 = satellite (KOSPI 200 근사)

/** 동적 조회 실패 시 폴백 목록 — always-include 기본값으로도 사용 */
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
  '042660', // 한화오션
  '272210', // 한화시스템
  '009830', // 한화솔루션
  '012450', // 한화에어로스페이스
  '000880', // 한화
  '010140', // 삼성중공업
  '009540', // HD한국조선해양
  '042670', // 두산밥캣
  '034020', // 두산에너빌리티
  '011200', // HMM
  '086280', // 현대글로비스
  '307950', // 현대오토에버
  '373220', // LG에너지솔루션
  '006400', // 삼성SDI
  '247540', // 에코프로비엠
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
 * 후보 풀(UNIVERSE_TOP_N = 150)을 거래대금 순으로 추려 분석하고 전략별 선별 결과를 DB에 저장(30·40·30).
 * (옛 주석의 「상위 20개」·「프로파일별 상위 5개」는 코인 시절 값이라 2026-11-01 에 정정했다 — 전략별 선별 수는
 *  `engine.ts:426~428` 의 할당이고 **시장과 무관하다**(국내 한정이 아니다).
 *  숫자는 이 파일의 UNIVERSE_TOP_N 과 engine.ts 의 상수가 정본이므로, 바뀌면 여기도 같이 고친다.)
 * universe 테이블의 refreshed_at이 15분 이내면 스킵 (force=true로 강제 갱신 가능).
 */
export function refreshUniverse(market: Market = 'domestic', force = false): Promise<{ refreshed: boolean }> {
  /**
   * T-017 — universe 갱신 전체를 `bulk` lane 에서 돌린다.
   *
   * 이 함수는 KIS 호출량이 가장 큰 단일 경로다: 시총 랭킹 2건 + 상위 `UNIVERSE_TOP_N`(=150)
   * 종목의 일봉. 지연돼도 무해한 배치이므로, 이 스캔이 `entry-watcher` 의 단건 시세나
   * 실주문 앞에 서지 않도록 가장 낮은 lane 에 둔다.
   */
  return withKisPriority('bulk', () => refreshUniverseImpl(market, force));
}

/**
 * T-176 WP-1 — 시총 순위 조회가 **던지면** 빈 배열과 같게 취급한다(호출부의 기존 대체 경로 `getKisTickers(ALL_SYMBOLS)` 로 간다).
 *
 * 2026-11-18 12:11 KST 장중 평가가 이 조회의 네트워크 예외(`fetch failed`) 하나로 회차째 HTTP 500 이 됐다.
 * `fetchMarketCapPage` 는 `!res.ok`·`rt_cd≠0` 을 이미 `[]` 로 바꾸지만 **던진 예외**(연결 실패·토큰 발급 실패·
 * JSON 파싱 실패 등)는 잡는 곳이 없었다. 순위가 빈 경우의 대체 경로는 지난 25일 매일 실제로 돈 경로라 새 동작이 아니다.
 *
 * - `fetchMarketCapRanking` 의 `Promise.all` 은 그대로 둔다 — 한 페이지만 성공한 부분 결과로 tier 를 매기면
 *   (코스피만 core 가 되는 등) tier 의 뜻이 바뀐다. 부분 결과 대신 전부 대체 경로로 보내는 쪽이 기존 동작과 같다.
 * - 원인은 T-175 `describeErrorCause`(코드·주소, 비밀·쿼리스트링 가림)로 한 줄 남긴다. 순위 갱신은 TTL(15분)당
 *   최대 1회라 억제하지 않는다.
 */
async function fetchMarketCapRankingOrEmpty(limit: number): Promise<Awaited<ReturnType<typeof fetchMarketCapRanking>>> {
  try {
    return await fetchMarketCapRanking(limit);
  } catch (e) {
    // 메시지에 URL 이 섞여도 쿼리스트링은 가린다(describeErrorCause 와 같은 규칙) — 시총 순위 URL 에는 비밀이 없지만 방어한다.
    // 문자열화 자체가 던질 수 있다(`Object.create(null)` 을 던진 경우) — 격리하려는 catch 가 다시 던지면 안 된다(T-148 QA L-3).
    let raw: string;
    try { raw = e instanceof Error ? e.message : String(e); } catch { raw = '(문자열화 불가)'; }
    const msg = raw
      .replace(/\?[^\s'"<>()[\]]*/g, '?***')
      .replace(/[\u0000-\u001F\u007F]+/g, ' ')
      .slice(0, 200);
    const cause = describeErrorCause(e);
    console.warn(
      `[universe:domestic] 시총 순위 조회 실패 — 정적 목록으로 대체: ${msg}`
      + (cause ? ` | ${cause}` : ''),
    );
    return [];
  }
}

async function refreshUniverseImpl(market: Market, force: boolean): Promise<{ refreshed: boolean }> {
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
    const ranked = await fetchMarketCapRankingOrEmpty(TIER_SATELLITE_LIMIT);
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
    // 해외: 시총 랭킹 API 부재 → 분석 대상 목록(T-143 수동 ∪ 자동, DB > env > 코드) + 거래대금 정렬.
    // 즉 해외의 「동적 선별」은 이 목록을 **정렬**하는 일이다 — 목록 자체를 바꾸는 곳은 설정 › 해외 분석 대상이다.
    const overseasSyms = await getStaticOverseasUniverse();
    const tickers = await getKisOverseasTickers(overseasSyms);
    top20 = tickers
      .sort((a, b) => (b.quoteVolume24h ?? 0) - (a.quoteVolume24h ?? 0))
      .slice(0, UNIVERSE_TOP_N)
      .map(t => ({ symbol: t.symbol, quoteVolume24h: t.quoteVolume24h ?? 0 }));
  }

  if (top20.length === 0) return { refreshed: false };

  /**
   * T-017 — 기존 `Promise.all(top20.map(...))` 은 최대 150건을 **동시에** 발사했다.
   * 유량은 스로틀이 잡지만, 그 150건이 한 번에 대기열로 들어가면 이 한 호출이 lane 을
   * 독차지해 뒤따르는 요청이 대기열 초과로 거절된다. 동시성을 제한해 대기열을 얕게 유지한다.
   * (`analyzeSymbol` 은 자체적으로 실패를 null 로 흡수하므로 결과 의미는 종전과 동일하다.)
   */
  const settled = await mapWithLimit(top20, DEFAULT_FANOUT_CONCURRENCY,
    t => analyzeSymbol(t.symbol, t.quoteVolume24h ?? 0));
  const analyses = settled
    .map(r => (r.status === 'fulfilled' ? r.value : null))
    .filter((a): a is StockAnalysis => a !== null);

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
    const profileTopN = profile === 'mean-rev' ? 40 : 30;
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

/**
 * 항상 분석 대상에 포함할 종목 리스트 (모멘텀 누락 방지).
 *
 * 우선순위:
 *   1) DB system_config.universe_always_include (JSON array)
 *   2) env UNIVERSE_ALWAYS_INCLUDE (콤마 구분)
 *   3) KOSPI 시총 상위 hard-coded (KOSPI_TOP / KOSDAQ_TOP) — fallback
 *
 * 결함 배경: 005930 같은 안정 대형주가 strategy profile score 기반 top N 산정에서 밀려
 * universe에서 누락되는 현상 (11% 급등에도 분석 안 됨). always-include로 시총 핵심 종목은
 * score와 무관하게 매 cron 분석 대상에 영구 포함.
 */
export async function getAlwaysIncludeSymbols(market: Market = 'domestic'): Promise<string[]> {
  const pool = getPool();
  const result: string[] = [];

  if (market === 'overseas') {
    // 해외 즐겨찾기 자동 편입 (stock_favorites JOIN stock_meta WHERE market='overseas')
    try {
      const [favRows] = await pool.query<RowDataPacket[]>(`
        SELECT f.symbol FROM stock_favorites f
        INNER JOIN stock_meta m ON m.symbol = f.symbol
        WHERE m.market = 'overseas'
      `);
      result.push(...favRows.map(r => r.symbol as string));
    } catch { /* 즐겨찾기 조회 실패 시 무시 */ }
    return [...new Set(result)];
  }

  // domestic (기존 로직)
  // 1) DB override
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT value FROM system_config WHERE \`key\` = 'universe_always_include' LIMIT 1`,
    );
    if (rows.length > 0) {
      const raw = rows[0].value as string;
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.every(s => typeof s === 'string')) {
          result.push(...parsed.map(s => s.trim()).filter(Boolean));
        }
      } catch { /* ignore */ }
    }
  } catch { /* DB 미가용 */ }

  // 2) env override
  const envVal = process.env.UNIVERSE_ALWAYS_INCLUDE;
  if (envVal && envVal.trim()) {
    result.push(...envVal.split(',').map(s => s.trim()).filter(Boolean));
  }

  // 3) 즐겨찾기 종목 자동 편입 (stock_favorites → domestic 종목만)
  try {
    const [favRows] = await pool.query<RowDataPacket[]>(`
      SELECT f.symbol FROM stock_favorites f
      LEFT JOIN stock_meta m ON m.symbol = f.symbol
      WHERE m.market = 'domestic' OR m.market IS NULL
    `);
    result.push(...favRows.map(r => r.symbol as string));
  } catch { /* 즐겨찾기 조회 실패 시 무시 */ }

  // 4) 하나도 없으면 hard-coded fallback
  if (result.length === 0) return KOSPI_TOP;

  return [...new Set(result)];
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
