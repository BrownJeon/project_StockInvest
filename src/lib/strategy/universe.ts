import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { getKisTickers, getKisOverseasTickers, kis } from '@/lib/exchanges/kis';
import { withKisPriority, mapWithLimit, DEFAULT_FANOUT_CONCURRENCY } from '@/lib/exchanges/kis-throttle';
import type { Market } from '@/lib/exchanges/kis-symbols';
import { getStaticOverseasUniverse } from '@/lib/strategy/universe-overseas-static';
import { atrLast } from '@/lib/strategy/indicators/atr';
import { emaLast } from '@/lib/strategy/indicators/ema';
import { rsiLast } from '@/lib/strategy/indicators/rsi';
import { bollinger } from '@/lib/strategy/indicators/bollinger';
import { saveIndexTierObservations } from '@/lib/strategy/index-tier-store';

export type StrategyProfile = 'trend' | 'mean-rev' | 'breakout';
export type UniverseTier = 'core' | 'satellite' | 'speculative';

const UNIVERSE_TOP_N = 150;
const UNIVERSE_TTL_MS = 15 * 60 * 1000;
/**
 * T-181 — 국내 등급은 **지수 편입 표시**로 매긴다(2026-11-20 사용자 결정 「지수 편입 기준」).
 * 시세 응답의 대표 시장명(`rprs_mrkt_kor_name` → `Ticker.indexTag`)이 `KOSPI200` 이면 core, `KSQ150`(코스닥150)이면
 * satellite, 그 밖·없음은 speculative. 예전의 「KIS 시총 순위 1~100 = core, 101~200 = satellite」는 순위 조회가
 * 한 번도 성공하지 못해(요청 파라미터 오류) 실제로 쓰인 적이 없고, 고쳐도 시장당 30행이 상한이라 채울 수 없었다.
 */
const INDEX_TAG_TIER: Readonly<Record<string, UniverseTier>> = {
  KOSPI200: 'core',
  KSQ150:   'satellite',
};

/** 대표 시장명 → 등급. 앞뒤 공백을 지우고 대문자로 바꾼 뒤 **정확히** 일치할 때만 core·satellite. 시험용 export. */
export function tierFromIndexTag(indexTag: string | undefined | null): UniverseTier {
  if (typeof indexTag !== 'string') return 'speculative';
  const key = indexTag.trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(INDEX_TAG_TIER, key) ? INDEX_TAG_TIER[key] : 'speculative';
}

/** 국내 분석 후보 목록(정적) — always-include 기본값으로도 사용. T-181 부터 순위 조회 없이 항상 이 목록에서 후보를 고른다 */
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
  // T-184 — '042670'(두산밥캣) 제거: T-181 실측(2026-11-20)에서 시세 응답이 rt_cd=0 인데 가격·시총·상장주수가 전부 0
  //   이었고 symbol_universe 에 한 번도 저장된 적이 없다(분석 불가). 상장폐지·코드 변경으로 보인다.
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
  // T-184 — '091990'(셀트리온헬스케어) 제거: 2023-12 셀트리온에 합병돼 상장폐지(T-181 실측도 가격·시총 0).
  '263750', // 펄어비스
  '357780', // 솔브레인
  '293490', // 카카오게임즈
  '112040', // 위메이드
  '039030', // 이오테크닉스
  '041510', // SM엔터테인먼트
];

/** T-181 — `247540` 이 두 목록에 모두 있어 시세를 두 번 불렀다. 순서를 지키며 중복을 지운다. 시험용 export */
export const ALL_SYMBOLS: readonly string[] = [...new Set([...KOSPI_TOP, ...KOSDAQ_TOP])];

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
   * 이 함수는 KIS 호출량이 가장 큰 단일 경로다: 후보 시세(국내 정적 목록 — T-181 부터 시총 랭킹 2건은 부르지 않는다)
   * + 상위 `UNIVERSE_TOP_N`(=150) 종목의 일봉. 지연돼도 무해한 배치이므로, 이 스캔이 `entry-watcher` 의 단건 시세나
   * 실주문 앞에 서지 않도록 가장 낮은 lane 에 둔다.
   */
  return withKisPriority('bulk', () => refreshUniverseImpl(market, force));
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
  // tierMap: 종목별 등급. 국내만 채운다(T-181 지수 편입 기준 — `tierFromIndexTag`). 없으면 'speculative'.
  const tierMap = new Map<string, UniverseTier>();
  let top20: Array<{ symbol: string; quoteVolume24h: number }>;
  if (market === 'domestic') {
    /**
     * T-181 — 시총 순위 조회를 이 경로에서 뺐다(사용자 결정 「갱신 경로에서 제거」). 후보는 10-25 이후 매일 실제로 돌던
     * 경로 그대로 정적 목록 시세 → 거래대금 정렬이고, 등급은 **같은 시세 응답**의 지수 편입 표시로 매긴다(추가 호출 0).
     * 시세가 실패한 종목은 후보에서 빠질 뿐 다른 종목 등급에 영향이 없다(종목 단위 — 부분 실패 개념이 없다).
     */
    // T-184 — 등급 관측 시각은 시세를 **요청하기 전** 시각으로 둔다(겹친 갱신에서 더 이른 관측이 최신 등급을 덮지 않게).
    const tierObservedAtMs = Date.now();
    const tickers = await getKisTickers([...ALL_SYMBOLS]);
    let tagged = 0;
    for (const t of tickers) {
      const tier = tierFromIndexTag(t.indexTag);
      if (tier !== 'speculative') tagged++;
      tierMap.set(t.symbol, tier);
    }
    if (tickers.length > 0 && tagged === 0) {
      // KIS 시세 응답 형식(필드명·값)이 바뀐 신호다 — 전 종목 speculative 면 코어 비율 가드가 국내 매수를 다시 전부 막는다.
      console.warn('[universe:domestic] 지수 편입 표시 없음 — 전 종목 speculative');
    }
    /**
     * T-184 — 코어 비율 가드가 읽는 등급은 아래 전략 점수 선별(30·40·30)과 **무관하게** 시세를 받은 전 종목 것을 보존한다
     * (`index-tier-store.ts`). 선별에서 빠진 보유 종목도 매 갱신 최신 등급을 갖게 되어, 강등된 종목이 과거 core 로
     * 통과하거나 48시간 뒤 unknown 으로 막히는 일이 없다. 저장 실패는 갱신을 멈추지 않는다 — 이번 관측은 같은 프로세스의
     * 가드에 메모리로 반영되고(DB 에는 못 남음), DB 값은 최신성 한도(24시간) 안에서만 쓰이며 넘으면 unknown(차단 방향)이다.
     */
    if (tierMap.size > 0) {
      try {
        await saveIndexTierObservations([...tierMap].map(([symbol, tier]) => ({ symbol, tier })), tierObservedAtMs);
      } catch (e) {
        const msg = (e instanceof Error ? `${e.name}: ${e.message}` : 'non-error thrown').replace(/[\r\n\t]+/g, ' ').slice(0, 200);
        console.warn(`[universe:domestic] 등급 보존 저장 실패 — 이번 관측은 이 프로세스의 가드에만 반영(재시작 뒤엔 DB 값·24시간 한도): ${msg}`);
      }
    }
    top20 = tickers
      .sort((a, b) => (b.quoteVolume24h ?? 0) - (a.quoteVolume24h ?? 0))
      .slice(0, UNIVERSE_TOP_N)
      .map(t => ({ symbol: t.symbol, quoteVolume24h: t.quoteVolume24h ?? 0 }));
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
 *  - 'kospi100'   → tier=core 만 (T-181 부터 core = KOSPI200 편입 — 이름과 달리 KOSPI 100 이 아니다)
 *  - 'kospi200'   → tier IN (core, satellite) (KOSPI200 ∪ 코스닥150)
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
