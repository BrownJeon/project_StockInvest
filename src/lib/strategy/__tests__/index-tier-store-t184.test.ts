/**
 * T-184 — 코어 비율 가드의 보유 종목 등급 보존.
 *
 * 결함(T-181 Analyst §6 · Codex C2 · Reviewer 23:12): 국내 등급은 전략 점수 선별을 통과한 종목에만 `symbol_universe` 로
 * 저장되고, 가드(`lookupTier`)는 그 행의 나이를 보지 않았다. 보유 종목이 선별에서 빠지면
 *   ① 강등돼도 과거 core 행(최대 48시간)으로 통과 ② 48시간 뒤엔 unknown 으로 국내 매수 전면 차단.
 * 수정: 갱신 때 시세를 받은 전 종목의 등급을 보존소(`system_config.domestic_index_tier`)에 남기고, 가드는 관측 시각이
 * 24시간 안인 값만 쓴다.
 *
 * 완료 기준 시험: (가) 보유 종목이 선별에서 빠져도 등급 유지 (나) 강등 + 탈락이 이어져도 낡은 core 로 통과하지 않음
 * (다) 최신성 한도를 넘으면 unknown.
 */

// ─── 메모리 DB ───────────────────────────────────────────────────────────────
interface UniverseRow { symbol: string; tier: unknown; profile: unknown }
const db = {
  config: new Map<string, string>(),
  universe: [] as UniverseRow[],
  failConfigWrite: false,
  /** CAS 갱신 직전에 한 번 끼어드는 다른 쓰기(겹친 갱신 재현) */
  interleave: null as null | (() => void),
};
const sqlLog: string[] = [];
async function poolQuery(sql: unknown, params?: unknown) {
  const s = String(sql);
  const p = (params as unknown[] | undefined) ?? [];
  sqlLog.push(s);
  if (/SELECT refreshed_at FROM symbol_universe/i.test(s)) return [[], []];
  if (/INSERT INTO symbol_universe/i.test(s)) {
    db.universe.push({ profile: p[1], symbol: String(p[2]), tier: p[7] });
    return [{ affectedRows: 1 }, []];
  }
  if (/DELETE FROM symbol_universe/i.test(s)) return [{ affectedRows: 0 }, []];
  if (/SELECT value FROM system_config WHERE `key` = \?/i.test(s)) {
    const v = db.config.get(String(p[0]));
    return [v === undefined ? [] : [{ value: v }], []];
  }
  if (/INSERT IGNORE INTO system_config/i.test(s)) {
    if (db.failConfigWrite) throw new Error('write failed\nsecond line');
    if (db.interleave) { const f = db.interleave; db.interleave = null; f(); }
    if (db.config.has(String(p[0]))) return [{ affectedRows: 0 }, []];
    db.config.set(String(p[0]), String(p[1]));
    return [{ affectedRows: 1 }, []];
  }
  if (/UPDATE system_config SET value = \? WHERE `key` = \? AND COALESCE\(JSON_VALUE\(value, '\$\.rev'\), '0'\) = \?/i.test(s)) {
    if (db.failConfigWrite) throw new Error('write failed\nsecond line');
    if (db.interleave) { const f = db.interleave; db.interleave = null; f(); }
    const cur = db.config.get(String(p[1]));
    if (cur === undefined || String(parseIndexTierRev(cur)) !== String(p[2])) return [{ affectedRows: 0 }, []];
    db.config.set(String(p[1]), String(p[0]));
    return [{ affectedRows: 1 }, []];
  }
  if (/system_config/i.test(s)) throw new Error(`unexpected system_config SQL: ${s}`);
  if (/COUNT\(\*\)[\s\S]*FROM orders/i.test(s)) return [[{ n: 0 }], []];
  // 예전 경로(symbol_universe 의 tier 를 가드가 읽던 것)로 되돌아가면 바로 드러나게 한다.
  if (/FROM symbol_universe WHERE symbol = \?/i.test(s)) throw new Error('guard must not read symbol_universe');
  return [[], []];
}
jest.mock('@/lib/db', () => ({ getPool: () => ({ query: (...a: unknown[]) => poolQuery(a[0], a[1]) }) }));

// ─── 외부 I/O ────────────────────────────────────────────────────────────────
const getKisTickers = jest.fn();
const getCandles = jest.fn();
jest.mock('@/lib/exchanges/kis', () => ({
  fetchMarketCapRanking: jest.fn(async () => []),
  getKisTickers: (...a: unknown[]) => getKisTickers(...a),
  getKisOverseasTickers: jest.fn(async () => []),
  kis: { getCandles: (...a: unknown[]) => getCandles(...a) },
}));
jest.mock('@/lib/exchanges/kis-throttle', () => ({
  withKisPriority: (_p: string, fn: () => Promise<unknown>) => fn(),
  mapWithLimit: async <T, R>(items: T[], _n: number, fn: (t: T) => Promise<R>) =>
    Promise.allSettled(items.map((t) => fn(t))),
  DEFAULT_FANOUT_CONCURRENCY: 4,
}));
jest.mock('@/lib/strategy/universe-overseas-static', () => ({ getStaticOverseasUniverse: async () => [] }));
jest.mock('../adaptive-interval', () => ({ upsertSymbolVolatility: jest.fn(async () => undefined) }));

import { refreshUniverse } from '../universe';
import { checkPortfolioStability } from '../portfolio-stability';
import { DEFAULT_STYLE_CONFIG, type StyleConfig } from '../style';
import {
  INDEX_TIER_CONFIG_KEY,
  INDEX_TIER_MAX_AGE_MS,
  INDEX_TIER_RETAIN_MS,
  combineIndexTierSnapshots,
  mergeIndexTierObservations,
  parseIndexTierRev,
  parseIndexTierSnapshot,
  resetIndexTierProcessStateForTest,
  saveIndexTierObservations,
  resolveHeldTier,
  serializeIndexTierSnapshot,
  type IndexTierSnapshot,
} from '../index-tier-store';

const HOUR = 60 * 60 * 1000;
const T0 = Date.parse('2026-11-23T01:00:00.000Z'); // 월요일 10:00 KST

const CANDLES = Array.from({ length: 70 }, (_, i) => {
  const close = 100 + 10 * Math.sin(i / 3);
  return { ts: i * 86_400_000, open: close, high: close * 1.03, low: close * 0.97, close, volume: 1_000 + i };
});

/** 실보유 재현(T-181 Analyst): 005930 13주 × 238,000 = 3,094,000원 하나. */
const HELD = new Map([['005930', { qty: 13, avgPrice: 238_000 }]]);
const STYLE: StyleConfig = { ...DEFAULT_STYLE_CONFIG, stableCoreRatioMin: 0.20, maxPositionsPerSymbol: 3 };

const tk = (symbol: string, indexTag: string | undefined, quoteVolume24h: number) =>
  ({ symbol, price: 1000, quoteVolume24h, ...(indexTag !== undefined ? { indexTag } : {}) });

let nowMs = T0;
let warn: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  db.config.clear();
  db.universe.length = 0;
  db.failConfigWrite = false;
  db.interleave = null;
  sqlLog.length = 0;
  resetIndexTierProcessStateForTest();
  nowMs = T0;
  jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  getCandles.mockResolvedValue(CANDLES);
});
afterEach(() => jest.restoreAllMocks());

const guardBuy = () => checkPortfolioStability({
  symbol: '263750', side: 'buy', amountKRW: 100_000, market: 'domestic', style: STYLE, heldAmounts: HELD,
});
const stored = () => parseIndexTierSnapshot(db.config.get(INDEX_TIER_CONFIG_KEY));

// ─── 순수 함수 ───────────────────────────────────────────────────────────────
describe('parseIndexTierSnapshot — 손상된 값은 버린다(버린 종목은 unknown)', () => {
  test('문자열·객체 둘 다 읽고, 틀린 항목만 뺀다', () => {
    const doc = {
      v: 1,
      symbols: {
        '005930': { tier: 'core', at: '2026-11-23T01:00:00.000Z' },
        '000660': { tier: 'CORE', at: '2026-11-23T01:00:00.000Z' },     // 대소문자 다름 → 버림
        '207940': { tier: 'core', at: 'not-a-date' },                    // 시각 손상 → 버림
        '005380': { tier: 'core', at: 1_700_000_000_000 },               // 숫자 시각 → 버림
        '068270': null,
        '': { tier: 'core', at: '2026-11-23T01:00:00.000Z' },
        ['X'.repeat(33)]: { tier: 'core', at: '2026-11-23T01:00:00.000Z' },
      },
    };
    for (const raw of [doc, JSON.stringify(doc)]) {
      const m = parseIndexTierSnapshot(raw);
      expect([...m.keys()]).toEqual(['005930']);
      expect(m.get('005930')).toEqual({ tier: 'core', atMs: T0 });
    }
  });

  test.each([[undefined], [null], ['{not json'], ['[]'], [{ symbols: [] }], [{ symbols: 'x' }], [42]])(
    '%p → 빈 스냅샷', (raw) => {
      expect(parseIndexTierSnapshot(raw).size).toBe(0);
    });

  test('직렬화 → 파싱 왕복이 같다', () => {
    const m: IndexTierSnapshot = new Map([['005930', { tier: 'core', atMs: T0 }], ['247540', { tier: 'satellite', atMs: T0 - HOUR }]]);
    expect(parseIndexTierSnapshot(serializeIndexTierSnapshot(m))).toEqual(m);
  });
});

describe('mergeIndexTierObservations', () => {
  test('이번 관측은 지금 시각으로 덮고, 못 받은 종목은 이전 관측 시각 그대로 남긴다', () => {
    const prev: IndexTierSnapshot = new Map([['005930', { tier: 'core', atMs: T0 - 2 * HOUR }], ['000660', { tier: 'core', atMs: T0 - 2 * HOUR }]]);
    const next = mergeIndexTierObservations(prev, [{ symbol: '005930', tier: 'speculative' }], T0);
    expect(next.get('005930')).toEqual({ tier: 'speculative', atMs: T0 });
    expect(next.get('000660')).toEqual({ tier: 'core', atMs: T0 - 2 * HOUR });
    expect(prev.get('005930')).toEqual({ tier: 'core', atMs: T0 - 2 * HOUR }); // 입력 불변
  });

  test('보관 기한(48h)을 넘긴 종목은 지운다 — 경계값은 남긴다', () => {
    const prev: IndexTierSnapshot = new Map([
      ['A', { tier: 'core', atMs: T0 - INDEX_TIER_RETAIN_MS }],
      ['B', { tier: 'core', atMs: T0 - INDEX_TIER_RETAIN_MS - 1 }],
    ]);
    const next = mergeIndexTierObservations(prev, [], T0);
    expect([...next.keys()]).toEqual(['A']);
  });

  test('관측 시각이 더 늦은 기존 값은 더 이른 관측으로 덮지 않는다(같으면 이번 관측)', () => {
    const prev: IndexTierSnapshot = new Map([['005930', { tier: 'speculative', atMs: T0 }]]);
    expect(mergeIndexTierObservations(prev, [{ symbol: '005930', tier: 'core' }], T0 - 1).get('005930'))
      .toEqual({ tier: 'speculative', atMs: T0 });
    expect(mergeIndexTierObservations(prev, [{ symbol: '005930', tier: 'core' }], T0).get('005930'))
      .toEqual({ tier: 'core', atMs: T0 });
  });

  test('combineIndexTierSnapshots — 종목마다 늦은 관측 우선', () => {
    const a: IndexTierSnapshot = new Map([['A', { tier: 'core', atMs: T0 }], ['B', { tier: 'core', atMs: T0 }]]);
    const b: IndexTierSnapshot = new Map([['A', { tier: 'speculative', atMs: T0 + 1 }], ['B', { tier: 'speculative', atMs: T0 - 1 }]]);
    const c = combineIndexTierSnapshots(a, b);
    expect(c.get('A')?.tier).toBe('speculative');
    expect(c.get('B')?.tier).toBe('core');
  });

  test('parseIndexTierRev — 0 이상 안전 정수만, 그 밖은 0', () => {
    expect(parseIndexTierRev('{"rev":7,"symbols":{}}')).toBe(7);
    for (const raw of [undefined, '{', '{"rev":-1}', '{"rev":1.5}', '{"rev":"3"}', { rev: 2 ** 60 }]) {
      expect(parseIndexTierRev(raw)).toBe(0);
    }
  });

  test('잘못된 관측(빈 심볼·등급 아님)은 넣지 않는다', () => {
    const next = mergeIndexTierObservations(new Map(), [
      { symbol: '', tier: 'core' },
      { symbol: '005930', tier: 'unknown' as never },
    ], T0);
    expect(next.size).toBe(0);
  });
});

describe('resolveHeldTier — 최신성 한도', () => {
  const snap: IndexTierSnapshot = new Map([['005930', { tier: 'core', atMs: T0 }]]);
  test('없으면 unknown', () => expect(resolveHeldTier(snap, '000660', T0)).toBe('unknown'));
  test('정확히 24h 경과는 유효', () => expect(resolveHeldTier(snap, '005930', T0 + INDEX_TIER_MAX_AGE_MS)).toBe('core'));
  test('24h + 1ms 경과는 unknown', () => expect(resolveHeldTier(snap, '005930', T0 + INDEX_TIER_MAX_AGE_MS + 1)).toBe('unknown'));
  test('관측 시각이 5분 넘게 미래면 unknown, 5분 이내 오차는 허용', () => {
    expect(resolveHeldTier(snap, '005930', T0 - 5 * 60 * 1000)).toBe('core');
    expect(resolveHeldTier(snap, '005930', T0 - 5 * 60 * 1000 - 1)).toBe('unknown');
  });
  test('한도 상수는 24시간, 보관은 48시간', () => {
    expect(INDEX_TIER_MAX_AGE_MS).toBe(24 * HOUR);
    expect(INDEX_TIER_RETAIN_MS).toBe(48 * HOUR);
  });
});

// ─── 갱신 → 가드 통합 ────────────────────────────────────────────────────────
describe('universe 갱신이 시세를 받은 전 종목 등급을 보존소에 남긴다', () => {
  test('분석에 실패해 symbol_universe 에 안 들어간 종목도 보존소에는 남는다', async () => {
    getKisTickers.mockResolvedValue([tk('005930', 'KOSPI200', 9e12), tk('247540', 'KSQ150', 5e12), tk('263750', 'KOSPI', 1e12)]);
    getCandles.mockImplementation(async (sym: string) => (sym === '005930' ? [] : CANDLES)); // 005930 분석 실패
    await refreshUniverse('domestic', true);

    expect(db.universe.some((r) => r.symbol === '005930')).toBe(false);
    const snap = stored();
    expect(snap.get('005930')).toEqual({ tier: 'core', atMs: T0 });
    expect(snap.get('247540')).toEqual({ tier: 'satellite', atMs: T0 });
    expect(snap.get('263750')).toEqual({ tier: 'speculative', atMs: T0 });
  });

  test('분석이 전부 실패해 refreshed:false 여도 등급은 저장된다', async () => {
    getKisTickers.mockResolvedValue([tk('005930', 'KOSPI200', 9e12)]);
    getCandles.mockResolvedValue([]);
    await expect(refreshUniverse('domestic', true)).resolves.toEqual({ refreshed: false });
    expect(stored().get('005930')?.tier).toBe('core');
  });

  test('시세가 0건이면 보존소를 건드리지 않는다', async () => {
    getKisTickers.mockResolvedValue([]);
    await refreshUniverse('domestic', true);
    expect(sqlLog.some((s) => /system_config/i.test(s))).toBe(false);
  });

  test('해외 갱신은 보존소를 건드리지 않는다', async () => {
    await refreshUniverse('overseas', true);
    expect(sqlLog.some((s) => /system_config/i.test(s))).toBe(false);
  });

  test('저장이 실패해도 갱신은 계속되고 경고 한 줄(줄바꿈 제거)만 남긴다', async () => {
    db.failConfigWrite = true;
    getKisTickers.mockResolvedValue([tk('005930', 'KOSPI200', 9e12)]);
    await expect(refreshUniverse('domestic', true)).resolves.toEqual({ refreshed: true });
    const lines = warn.mock.calls.map((c) => c.map(String).join(' ')).filter((l) => l.includes('등급 보존 저장 실패'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('[universe:domestic] 등급 보존 저장 실패 — 이번 관측은 이 프로세스의 가드에만 반영(재시작 뒤엔 DB 값·24시간 한도): Error: write failed second line');
    expect(db.universe.length).toBeGreaterThan(0);
  });
});

describe('완료 기준 (가)(나)(다) — 실보유 005930 + speculative 10만원 매수', () => {
  test('(가) 보유 종목이 선별에서 빠져도(48시간이 지나 universe 행이 없어도) 최신 등급으로 통과한다', async () => {
    getKisTickers.mockResolvedValue([tk('005930', 'KOSPI200', 9e12), tk('263750', 'KOSPI', 1e12)]);
    getCandles.mockImplementation(async (sym: string) => (sym === '005930' ? [] : CANDLES));
    await refreshUniverse('domestic', true);
    expect(db.universe.some((r) => r.symbol === '005930')).toBe(false); // 예전 가드라면 unknown → 0.0% → skip

    nowMs = T0 + 10 * 60 * 1000;
    const r = await guardBuy();
    expect(r.verdict).toBe('pass');
    expect(sqlLog.some((s) => /FROM symbol_universe WHERE symbol/i.test(s))).toBe(false);
  });

  test('(나) core 로 저장된 뒤 강등 + 탈락이 이어지면 낡은 core 로 통과하지 않는다', async () => {
    // 1회차: 005930 KOSPI200, 분석 통과 → symbol_universe 에 core 행
    getKisTickers.mockResolvedValue([tk('005930', 'KOSPI200', 9e12), tk('263750', 'KOSPI', 1e12)]);
    await refreshUniverse('domestic', true);
    expect(db.universe.filter((r) => r.symbol === '005930').every((r) => r.tier === 'core')).toBe(true);
    expect((await guardBuy()).verdict).toBe('pass');

    // 2회차(20분 뒤): 005930 지수 표시가 KOSPI 로 강등 + 분석 실패로 선별 탈락 → universe 에는 과거 core 행만 남는다
    nowMs = T0 + 20 * 60 * 1000;
    getKisTickers.mockResolvedValue([tk('005930', 'KOSPI', 9e12), tk('263750', 'KOSPI', 1e12)]);
    getCandles.mockImplementation(async (sym: string) => (sym === '005930' ? [] : CANDLES));
    const before = db.universe.length;
    await refreshUniverse('domestic', true);
    expect(db.universe.slice(before).some((r) => r.symbol === '005930')).toBe(false);
    expect(db.universe.filter((r) => r.symbol === '005930').every((r) => r.tier === 'core')).toBe(true);

    const r = await guardBuy();
    expect(r.verdict).toBe('skip');
    expect(r.reason).toBe('core_ratio_below_min');
    expect(r.detail).toContain('core 비율 0.0%');
    expect(stored().get('005930')).toEqual({ tier: 'speculative', atMs: T0 + 20 * 60 * 1000 });
  });

  test('(다) 마지막 관측이 24시간을 넘으면 unknown — 경계(정확히 24h)까지는 통과', async () => {
    getKisTickers.mockResolvedValue([tk('005930', 'KOSPI200', 9e12)]);
    await refreshUniverse('domestic', true);

    nowMs = T0 + INDEX_TIER_MAX_AGE_MS;
    expect((await guardBuy()).verdict).toBe('pass');

    nowMs = T0 + INDEX_TIER_MAX_AGE_MS + 1;
    const r = await guardBuy();
    expect(r.verdict).toBe('skip');
    expect(r.detail).toContain('core 비율 0.0%');
    expect(r.detail).toContain('tier=unknown');
  });

  test('(다-2) 시세 일시 실패 종목은 이전 관측 시각 그대로 — 한도 안에선 유지, 넘으면 unknown', async () => {
    getKisTickers.mockResolvedValue([tk('005930', 'KOSPI200', 9e12), tk('263750', 'KOSPI', 1e12)]);
    await refreshUniverse('domestic', true);

    nowMs = T0 + 20 * HOUR; // 005930 시세만 실패
    getKisTickers.mockResolvedValue([tk('263750', 'KOSPI', 1e12)]);
    await refreshUniverse('domestic', true);
    expect(stored().get('005930')).toEqual({ tier: 'core', atMs: T0 });
    expect(stored().get('263750')?.atMs).toBe(T0 + 20 * HOUR);

    nowMs = T0 + 23 * HOUR;
    expect((await guardBuy()).verdict).toBe('pass');
    nowMs = T0 + 25 * HOUR;
    expect((await guardBuy()).verdict).toBe('skip');
  });

  test('보존소가 비어 있으면(배포 직후 첫 갱신 전) unknown — 차단 방향', async () => {
    const r = await guardBuy();
    expect(r.verdict).toBe('skip');
    expect(r.detail).toContain('tier=unknown');
  });

  test('보유가 없으면 부트스트랩 통과는 그대로', async () => {
    const r = await checkPortfolioStability({
      symbol: '263750', side: 'buy', amountKRW: 100_000, market: 'domestic', style: STYLE, heldAmounts: new Map(),
    });
    expect(r.verdict).toBe('pass');
  });
});

describe('동시성·저장 실패 (Codex C2 지적 반영)', () => {
  test('겹친 갱신: 나중 시세(강등)가 먼저 저장되고 이른 시세(core)가 뒤늦게 저장돼도 강등이 남는다', async () => {
    await saveIndexTierObservations([{ symbol: '005930', tier: 'speculative' }], T0 + 2 * 60 * 1000); // B(나중 시세)
    await saveIndexTierObservations([{ symbol: '005930', tier: 'core' }], T0);                        // A(이른 시세)
    expect(stored().get('005930')).toEqual({ tier: 'speculative', atMs: T0 + 2 * 60 * 1000 });
    nowMs = T0 + 5 * 60 * 1000;
    expect((await guardBuy()).verdict).toBe('skip');
  });

  test('CAS: 읽은 뒤 다른 갱신이 먼저 쓰면 다시 읽어 병합한다 — 다른 갱신의 관측을 지우지 않는다', async () => {
    await saveIndexTierObservations([{ symbol: '005930', tier: 'core' }, { symbol: '247540', tier: 'satellite' }], T0);
    // A 가 읽은 직후 B 가 005930 강등을 먼저 기록(관측 T0+2분)
    db.interleave = () => {
      const cur = parseIndexTierSnapshot(db.config.get(INDEX_TIER_CONFIG_KEY));
      cur.set('005930', { tier: 'speculative', atMs: T0 + 2 * 60 * 1000 });
      db.config.set(INDEX_TIER_CONFIG_KEY, serializeIndexTierSnapshot(cur, parseIndexTierRev(db.config.get(INDEX_TIER_CONFIG_KEY)) + 1));
    };
    await saveIndexTierObservations([{ symbol: '005930', tier: 'core' }, { symbol: '000660', tier: 'core' }], T0 + 60 * 1000); // A
    const snap = stored();
    expect(snap.get('005930')).toEqual({ tier: 'speculative', atMs: T0 + 2 * 60 * 1000 });
    expect(snap.get('000660')).toEqual({ tier: 'core', atMs: T0 + 60 * 1000 });
    expect(snap.get('247540')?.tier).toBe('satellite');
    expect(parseIndexTierRev(db.config.get(INDEX_TIER_CONFIG_KEY))).toBe(3);
    const updates = sqlLog.filter((q) => /UPDATE system_config/i.test(q));
    expect(updates).toHaveLength(2); // 첫 시도 충돌 → 재시도 성공
  });

  test('CAS 충돌이 계속되면(3회) 던진다 — 호출부가 경고', async () => {
    await saveIndexTierObservations([{ symbol: '005930', tier: 'core' }], T0);
    let n = 0;
    const bump = () => {
      n++;
      const cur = db.config.get(INDEX_TIER_CONFIG_KEY)!;
      db.config.set(INDEX_TIER_CONFIG_KEY, serializeIndexTierSnapshot(parseIndexTierSnapshot(cur), parseIndexTierRev(cur) + 1));
      if (n < 3) db.interleave = bump;
    };
    db.interleave = bump;
    await expect(saveIndexTierObservations([{ symbol: '005930', tier: 'speculative' }], T0 + 60 * 1000))
      .rejects.toThrow('index tier save conflict after 3 attempts');
  });

  test('DB 쓰기가 실패해도 같은 프로세스의 가드는 방금 확인한 강등을 쓴다(낡은 core 로 통과하지 않음)', async () => {
    getKisTickers.mockResolvedValue([tk('005930', 'KOSPI200', 9e12), tk('263750', 'KOSPI', 1e12)]);
    await refreshUniverse('domestic', true);
    expect(stored().get('005930')?.tier).toBe('core');

    nowMs = T0 + 20 * 60 * 1000;
    db.failConfigWrite = true;
    getKisTickers.mockResolvedValue([tk('005930', 'KOSPI', 9e12), tk('263750', 'KOSPI', 1e12)]);
    getCandles.mockImplementation(async (sym: string) => (sym === '005930' ? [] : CANDLES));
    await refreshUniverse('domestic', true);
    expect(stored().get('005930')?.tier).toBe('core'); // DB 는 낡은 core 그대로

    const r = await guardBuy();
    expect(r.verdict).toBe('skip');
    expect(r.detail).toContain('core 비율 0.0%');

    // 프로세스 재시작(메모리 소실) 뒤에는 DB 값만 남고 24시간 한도가 상한이다
    resetIndexTierProcessStateForTest();
    expect((await guardBuy()).verdict).toBe('pass');
    nowMs = T0 + INDEX_TIER_MAX_AGE_MS + 1;
    expect((await guardBuy()).verdict).toBe('skip');
  });
});
