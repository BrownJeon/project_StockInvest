/**
 * T-176 WP-1 — 국내 universe 갱신에서 시총 순위 조회가 **던지면** 빈 배열과 같은 기존 대체 경로
 * (`getKisTickers(ALL_SYMBOLS)` → 거래대금 정렬 → tier 전부 speculative)로 간다.
 *
 * 2026-11-18 12:11 KST: 이 조회의 네트워크 예외 하나로 장중 평가 회차 전체가 HTTP 500 으로 끝났다.
 * 빈 배열일 때·정상일 때의 동작이 종전과 같다는 것도 함께 고정한다.
 */

// ─── 모의 DB ─────────────────────────────────────────────────────────────────
const inserts: Array<{ table: string; params: unknown[] }> = [];
async function poolQuery(sql: unknown, params?: unknown) {
  const s = String(sql);
  const p = (params as unknown[] | undefined) ?? [];
  if (/SELECT refreshed_at FROM symbol_universe/i.test(s)) return [[], []];   // 이전 갱신 없음 → TTL 스킵 안 함
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

import { refreshUniverse } from '../universe';

/** 지표가 모두 계산되도록 변동이 있는 일봉 70개(ATR% ≫ 0.5%) */
const CANDLES = Array.from({ length: 70 }, (_, i) => {
  const close = 100 + 10 * Math.sin(i / 3);
  return { ts: i * 86_400_000, open: close, high: close * 1.03, low: close * 0.97, close, volume: 1_000 + i };
});

const FALLBACK_TICKERS = [
  { symbol: '005930', price: 100, quoteVolume24h: 900 },
  { symbol: '000660', price: 100, quoteVolume24h: 800 },
  { symbol: '247540', price: 100, quoteVolume24h: 700 },
];

let warn: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  inserts.length = 0;
  getCandles.mockResolvedValue(CANDLES);
  getKisTickers.mockResolvedValue(FALLBACK_TICKERS);
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const universeRows = () => inserts.filter((r) => r.table === 'symbol_universe');
/** symbol_universe INSERT 파라미터: [now, profile, symbol, rank_pos, score, vol_rank, atr_pct, tier, detail, market] */
const tiersOf = () => new Set(universeRows().map((r) => r.params[7]));
const symbolsOf = () => new Set(universeRows().map((r) => r.params[2]));

function networkError() {
  const e = new TypeError('fetch failed');
  (e as { cause?: unknown }).cause = Object.assign(new Error('connect ECONNREFUSED'), {
    code: 'ECONNREFUSED', syscall: 'connect', address: '10.0.0.1', port: 9443,
  });
  return e;
}

describe('순위 조회가 던질 때 — 대체 경로', () => {
  test('🔴 던져도 refreshUniverse 는 끝까지 가서 refreshed:true, 정적 목록 시세로 후보를 만든다', async () => {
    fetchMarketCapRanking.mockRejectedValue(networkError());
    await expect(refreshUniverse('domestic', true)).resolves.toEqual({ refreshed: true });

    expect(getKisTickers).toHaveBeenCalledTimes(1);
    const fallbackSymbols = getKisTickers.mock.calls[0][0] as string[];
    expect(fallbackSymbols).toEqual(expect.arrayContaining(['005930', '000660', '247540']));
    expect(fallbackSymbols.length).toBeGreaterThanOrEqual(40);   // ALL_SYMBOLS(KOSPI_TOP ∪ KOSDAQ_TOP)
    expect(symbolsOf()).toEqual(new Set(['005930', '000660', '247540']));
    expect(tiersOf()).toEqual(new Set(['speculative']));          // 빈 배열일 때와 같은 결과
    expect(inserts.filter((r) => r.table === 'stock_meta')).toHaveLength(0);
  });

  test('원인(코드·주소)을 한 줄 남긴다', async () => {
    fetchMarketCapRanking.mockRejectedValue(networkError());
    await refreshUniverse('domestic', true);
    const l = warn.mock.calls.map((c) => c.map(String).join(' '));
    const line = l.find((x) => x.includes('[universe:domestic] 시총 순위 조회 실패'));
    expect(line).toBeDefined();
    expect(line).toContain('정적 목록으로 대체: fetch failed');
    expect(line).toContain('cause=ECONNREFUSED connect 10.0.0.1:9443');
  });

  test('메시지의 URL 쿼리스트링·제어문자는 가린다, Error 가 아닌 값(문자열화 불가 포함)도 대체 경로로', async () => {
    fetchMarketCapRanking.mockRejectedValue(new Error('bad https://x/ranking?appkey=SECRET123&b=1\nnext'));
    await expect(refreshUniverse('domestic', true)).resolves.toEqual({ refreshed: true });
    const l1 = warn.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
    expect(l1).not.toContain('SECRET123');
    expect(l1).toContain('?***');

    warn.mockClear();
    fetchMarketCapRanking.mockRejectedValue(Object.create(null));
    await expect(refreshUniverse('domestic', true)).resolves.toEqual({ refreshed: true });
    expect(warn.mock.calls.map((c) => c.map(String).join(' ')).join('\n')).toContain('(문자열화 불가)');
  });
});

describe('종전 동작 불변', () => {
  test('순위가 빈 배열이면 같은 대체 경로 — 실패 로그는 없다', async () => {
    fetchMarketCapRanking.mockResolvedValue([]);
    await expect(refreshUniverse('domestic', true)).resolves.toEqual({ refreshed: true });
    expect(getKisTickers).toHaveBeenCalledTimes(1);
    expect(tiersOf()).toEqual(new Set(['speculative']));
    expect(warn.mock.calls.some((c) => String(c[0]).includes('시총 순위 조회 실패'))).toBe(false);
  });

  test('순위가 오면 대체 경로를 타지 않고 시총 순으로 tier 를 매긴다', async () => {
    fetchMarketCapRanking.mockResolvedValue([
      { symbol: '005930', name: '삼성전자', marketCap: 4e14, quoteVolume: 900, volume: 10 },
      { symbol: '000660', name: 'SK하이닉스', marketCap: 2e14, quoteVolume: 800, volume: 10 },
    ]);
    await expect(refreshUniverse('domestic', true)).resolves.toEqual({ refreshed: true });
    expect(getKisTickers).not.toHaveBeenCalled();
    expect(tiersOf()).toEqual(new Set(['core']));
    expect(inserts.filter((r) => r.table === 'stock_meta')).toHaveLength(2);
    expect(warn).not.toHaveBeenCalled();
  });

  test('대체 경로의 시세가 0건이면 종전처럼 refreshed:false (던지지 않는다)', async () => {
    fetchMarketCapRanking.mockRejectedValue(networkError());
    getKisTickers.mockResolvedValue([]);
    await expect(refreshUniverse('domestic', true)).resolves.toEqual({ refreshed: false });
    expect(universeRows()).toHaveLength(0);
  });
});
