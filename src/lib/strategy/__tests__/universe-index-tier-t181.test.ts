/**
 * T-181 — 국내 universe 등급을 **지수 편입 표시**로 매긴다(2026-11-20 사용자 결정 「지수 편입 기준」).
 *
 * ② 등급 매핑: 시세의 대표 시장명 `KOSPI200` → core, `KSQ150`(코스닥150) → satellite, 그 밖·없음 → speculative
 *    (앞뒤 공백 제거 + 대문자 비교, 정확 일치)
 * ③ 갱신 경로가 시총 순위 조회를 부르지 않는다
 * ④ 시세는 왔는데 core·satellite 가 하나도 없으면 경고 한 줄(응답 형식 변경 신호) — 갱신은 계속
 * ⑥ 정적 후보 목록의 중복(247540) 제거
 *
 * 배경: 순위 조회가 한 번도 성공하지 못해 국내 3,977행 전부 speculative 였고, 실보유 005930 이 비core 라
 * 코어 비율 가드가 국내 매수 후보 3,630건(11-16~20)을 전부 막았다.
 */

// ─── 모의 DB ─────────────────────────────────────────────────────────────────
const inserts: Array<{ table: string; params: unknown[] }> = [];
async function poolQuery(sql: unknown, params?: unknown) {
  const s = String(sql);
  const p = (params as unknown[] | undefined) ?? [];
  if (/SELECT refreshed_at FROM symbol_universe/i.test(s)) return [[], []];
  if (/INSERT INTO symbol_universe/i.test(s)) { inserts.push({ table: 'symbol_universe', params: p }); return [{ affectedRows: 1 }, []]; }
  if (/INSERT INTO stock_meta/i.test(s)) { inserts.push({ table: 'stock_meta', params: p }); return [{ affectedRows: 1 }, []]; }
  return [[], []];
}
jest.mock('@/lib/db', () => ({ getPool: () => ({ query: (...a: unknown[]) => poolQuery(a[0], a[1]) }) }));

// ─── 외부 I/O ────────────────────────────────────────────────────────────────
const fetchMarketCapRanking = jest.fn();
const getKisTickers = jest.fn();
const getKisOverseasTickers = jest.fn();
const getCandles = jest.fn();
jest.mock('@/lib/exchanges/kis', () => ({
  fetchMarketCapRanking: (...a: unknown[]) => fetchMarketCapRanking(...a),
  getKisTickers: (...a: unknown[]) => getKisTickers(...a),
  getKisOverseasTickers: (...a: unknown[]) => getKisOverseasTickers(...a),
  kis: { getCandles: (...a: unknown[]) => getCandles(...a) },
}));
jest.mock('@/lib/exchanges/kis-throttle', () => ({
  withKisPriority: (_p: string, fn: () => Promise<unknown>) => fn(),
  mapWithLimit: async <T, R>(items: T[], _n: number, fn: (t: T) => Promise<R>) =>
    Promise.allSettled(items.map((t) => fn(t))),
  DEFAULT_FANOUT_CONCURRENCY: 4,
}));
jest.mock('@/lib/strategy/universe-overseas-static', () => ({ getStaticOverseasUniverse: async () => ['NAS:AAPL'] }));
jest.mock('../adaptive-interval', () => ({ upsertSymbolVolatility: jest.fn(async () => undefined) }));

import { refreshUniverse, tierFromIndexTag, ALL_SYMBOLS } from '../universe';

const CANDLES = Array.from({ length: 70 }, (_, i) => {
  const close = 100 + 10 * Math.sin(i / 3);
  return { ts: i * 86_400_000, open: close, high: close * 1.03, low: close * 0.97, close, volume: 1_000 + i };
});

let warn: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  inserts.length = 0;
  getCandles.mockResolvedValue(CANDLES);
  fetchMarketCapRanking.mockResolvedValue([]);
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const universeRows = () => inserts.filter((r) => r.table === 'symbol_universe');
/** symbol_universe INSERT 파라미터: [now, profile, symbol, rank_pos, score, vol_rank, atr_pct, tier, detail, market] */
const tierBySymbol = () => {
  const m = new Map<string, Set<unknown>>();
  for (const r of universeRows()) {
    const sym = String(r.params[2]);
    if (!m.has(sym)) m.set(sym, new Set());
    m.get(sym)!.add(r.params[7]);
  }
  return m;
};
const warnLines = () => warn.mock.calls.map((c) => c.map(String).join(' '));
const NO_TAG_WARN = '[universe:domestic] 지수 편입 표시 없음 — 전 종목 speculative';

describe('② tierFromIndexTag — 대표 시장명 → 등급', () => {
  test.each([
    ['KOSPI200', 'core'],
    ['KSQ150', 'satellite'],
    ['KOSPI', 'speculative'],
    ['KOSDAQ', 'speculative'],
    [' kospi200 ', 'core'],
    ['ksq150', 'satellite'],
    ['\tKSQ150\n', 'satellite'],
    ['KOSPI 200', 'speculative'],      // 정확 일치만
    ['KOSPI2000', 'speculative'],
    ['KSQ1500', 'speculative'],
    ['', 'speculative'],
    ['   ', 'speculative'],
    ['__proto__', 'speculative'],      // 객체 원형 키로 새지 않는다
    ['constructor', 'speculative'],
    ['toString', 'speculative'],
  ])('%j → %s', (tag, tier) => {
    expect(tierFromIndexTag(tag)).toBe(tier);
  });

  test('없음(undefined·null) → speculative', () => {
    expect(tierFromIndexTag(undefined)).toBe('speculative');
    expect(tierFromIndexTag(null)).toBe('speculative');
  });
});

describe('갱신 경로 — 등급은 시세의 indexTag 로', () => {
  test('🔴 ③ 순위 조회를 부르지 않고, 종목별 등급이 indexTag 대로 기록된다', async () => {
    getKisTickers.mockResolvedValue([
      { symbol: '005930', price: 100, quoteVolume24h: 900, indexTag: 'KOSPI200', marketCapKrw: 1e15 },
      { symbol: '247540', price: 100, quoteVolume24h: 800, indexTag: 'KSQ150' },
      { symbol: '030200', price: 100, quoteVolume24h: 700, indexTag: 'KOSPI' },
      { symbol: '263750', price: 100, quoteVolume24h: 600 },                      // 표시 없음
    ]);
    await expect(refreshUniverse('domestic', true)).resolves.toEqual({ refreshed: true });
    expect(fetchMarketCapRanking).not.toHaveBeenCalled();
    expect(getKisTickers).toHaveBeenCalledTimes(1);
    const t = tierBySymbol();
    expect(t.get('005930')).toEqual(new Set(['core']));
    expect(t.get('247540')).toEqual(new Set(['satellite']));
    expect(t.get('030200')).toEqual(new Set(['speculative']));
    expect(t.get('263750')).toEqual(new Set(['speculative']));
    expect(warnLines().some((x) => x.includes('지수 편입 표시 없음'))).toBe(false);
    expect(inserts.filter((r) => r.table === 'stock_meta')).toHaveLength(0);
  });

  test('시총이 커도 지수 표시가 없으면 speculative — 시총은 이번에 등급에 쓰지 않는다', async () => {
    getKisTickers.mockResolvedValue([
      { symbol: '005930', price: 100, quoteVolume24h: 900, indexTag: 'KOSPI200' },
      { symbol: '000660', price: 100, quoteVolume24h: 800, marketCapKrw: 9e14 },
    ]);
    await refreshUniverse('domestic', true);
    const t = tierBySymbol();
    expect(t.get('000660')).toEqual(new Set(['speculative']));
    // score_detail 에 시총을 싣지 않는다(범위 밖)
    for (const r of universeRows()) expect(String(r.params[8])).not.toMatch(/marketCap/i);
  });

  test('한 종목의 시세가 실패해(목록에서 빠져) 도 다른 종목 등급은 그대로 — 종목 단위', async () => {
    getKisTickers.mockResolvedValue([
      { symbol: '005930', price: 100, quoteVolume24h: 900, indexTag: 'KOSPI200' },
      { symbol: '247540', price: 100, quoteVolume24h: 800, indexTag: 'KSQ150' },
    ]);
    await refreshUniverse('domestic', true);
    const t = tierBySymbol();
    expect(t.get('005930')).toEqual(new Set(['core']));
    expect(t.get('247540')).toEqual(new Set(['satellite']));
    expect([...t.keys()].sort()).toEqual(['005930', '247540']);
  });

  test('🔴 ④ 시세는 왔는데 core·satellite 가 하나도 없으면 경고 한 줄, 갱신은 계속(전부 speculative)', async () => {
    getKisTickers.mockResolvedValue([
      { symbol: '005930', price: 100, quoteVolume24h: 900, indexTag: 'KOSPI' },
      { symbol: '000660', price: 100, quoteVolume24h: 800 },
    ]);
    await expect(refreshUniverse('domestic', true)).resolves.toEqual({ refreshed: true });
    const l = warnLines().filter((x) => x.includes('지수 편입 표시 없음'));
    expect(l).toEqual([NO_TAG_WARN]);
    const tiers = new Set(universeRows().map((r) => r.params[7]));
    expect(tiers).toEqual(new Set(['speculative']));
  });

  test('satellite 만 있어도 경고하지 않는다(표시 자체는 오고 있다)', async () => {
    getKisTickers.mockResolvedValue([
      { symbol: '247540', price: 100, quoteVolume24h: 800, indexTag: 'KSQ150' },
      { symbol: '000660', price: 100, quoteVolume24h: 700, indexTag: 'KOSPI' },
    ]);
    await refreshUniverse('domestic', true);
    expect(warnLines().some((x) => x.includes('지수 편입 표시 없음'))).toBe(false);
  });

  test('해외 갱신은 등급 로직을 타지 않는다 — indexTag 가 와도 speculative, 경고 없음', async () => {
    getKisOverseasTickers.mockResolvedValue([
      { symbol: 'NAS:AAPL', price: 100, quoteVolume24h: 900, indexTag: 'KOSPI200' },
    ]);
    await refreshUniverse('overseas', true);
    expect(getKisTickers).not.toHaveBeenCalled();
    expect(new Set(universeRows().map((r) => r.params[7]))).toEqual(new Set(['speculative']));
    expect(warnLines().some((x) => x.includes('지수 편입 표시 없음'))).toBe(false);
  });
});

describe('⑥ 정적 후보 목록 중복 제거', () => {
  test('ALL_SYMBOLS 에 중복이 없고 247540 은 한 번만 — 갱신 때 같은 목록을 넘긴다', async () => {
    expect(new Set(ALL_SYMBOLS).size).toBe(ALL_SYMBOLS.length);
    expect(ALL_SYMBOLS.filter((s) => s === '247540')).toHaveLength(1);
    expect(ALL_SYMBOLS).toHaveLength(44);                         // KOSPI_TOP 35 + KOSDAQ_TOP 10 − 중복 1
    expect(ALL_SYMBOLS.slice(0, 2)).toEqual(['005930', '000660']); // 순서 유지

    getKisTickers.mockResolvedValue([]);
    await refreshUniverse('domestic', true);
    const passed = getKisTickers.mock.calls[0][0] as string[];
    expect(passed).toEqual([...ALL_SYMBOLS]);
    expect(new Set(passed).size).toBe(passed.length);
  });
});
