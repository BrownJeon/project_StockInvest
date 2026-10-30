/**
 * T-072 G2 — post-market 카드 × 검증 상태 관문 (**실제 관문**으로 — `@/lib/safety/validation-gate` 를 목하지 않는다).
 *
 * 지킬 것 (설계 F-2·F-3·F-13·F-16, WP-2b 지시 2):
 *  1. 🔴 검증 안 된 전략(미등록·unvalidated·상태 이상·조회 실패)의 카드는 **승인 가능한 `pending` 이 아니라 승인 불가 `skipped`** 로 같은 문장에
 *     들어간다(중복 방지 NOT EXISTS·유니크 인덱스는 그대로). 대시보드 '내일'·추천 탭(`status='pending'` 조회)에 나오지 않는다(사용자 고지).
 *  2. 막힌 카드가 **실제로 새 행이 됐을 때만** 그 행 id 로 가상 체결(카드형 zone_touch_pending, origin post_market, 구간·유효기간·사이징)을 남긴다.
 *     `duplicate`(NOT EXISTS 0행·1062)에는 남기지 않는다.
 *  3. 카드 생성 배치(LLM 호출)는 그대로 돈다. 집계: signalsCreated(승인 가능) 0 · validationBlocked · signalsSkipped 포함.
 *  4. 검증된 전략은 기존 그대로 `pending`·가상 체결 없음(과차단 없음).
 *  5. 가상 체결 기록 실패는 카드 결과·실행을 바꾸지 않는다(던지지 않음). 트랜잭션 안에서 부르면(deferPaperFills) 쌓기만 한다.
 *  6. 🔴 실 장부 테이블에 쓰지 않는다.
 * 해외(트랜잭션·커밋 뒤 기록)는 post-market-overseas.test.ts 의 "T-072 G2" 절.
 */
import type { DailyCandidate } from '../rules/eod-high-close';
import { runPostMarketAnalysis, insertScenarioCardIfAbsent, flushCardPaperFills, type ScenarioCardRow } from '../post-market-engine';
import { getPool } from '@/lib/db';
import { getStyleConfig } from '../style';
import { getCandles } from '@/lib/exchanges/kis-domestic';
import { getAlwaysIncludeSymbols, getUniverseSnapshot } from '../universe';
import { runLlm } from '@/lib/llm/provider';
import { retrieveRagContext } from '@/lib/rag/retrieval';
import { eodHighClose } from '../rules/eod-high-close';
import { insideBar } from '../rules/inside-bar';
import { oversoldBounceDaily } from '../rules/oversold-bounce-daily';
import type { PaperFillInput } from '@/lib/signals/paper-fill';

jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));
jest.mock('@/lib/exchanges/kis-domestic', () => ({ getCandles: jest.fn() }));
jest.mock('@/lib/exchanges/kis', () => ({ kis: {}, getBalancesDetailed: jest.fn() }));
jest.mock('@/lib/exchanges/fx', () => ({ getUsdKrwRate: jest.fn(async () => { throw new Error('external fx must not be called'); }) }));
jest.mock('../universe', () => ({ getAlwaysIncludeSymbols: jest.fn(), getUniverseSnapshot: jest.fn() }));
jest.mock('@/lib/llm/provider', () => ({ runLlm: jest.fn() }));
jest.mock('@/lib/rag/retrieval', () => ({ retrieveRagContext: jest.fn() }));
jest.mock('@/lib/rag/format', () => ({ formatRagSection: jest.fn(() => '') }));
jest.mock('../rules/eod-high-close', () => ({ eodHighClose: jest.fn() }));
jest.mock('../rules/inside-bar', () => ({ insideBar: jest.fn() }));
jest.mock('../rules/oversold-bounce-daily', () => ({ oversoldBounceDaily: jest.fn() }));
jest.mock('../style', () => ({ getStyleConfig: jest.fn() }));
// T-112 — 기준 판단 기록기는 이 파일에서 목이다(기록 I/O 가 풀 목·로그·호출 수를 건드리지 않게). 추적 표시(judgment-trace)는 실물이다.
//   기록 on/off·실패·지연이 분석 결과를 바꾸지 않는다는 증명과 거르기 지점별 기록은 records/__tests__/judgment-engine-wiring.test.ts 가 본다.
jest.mock('../records/judgment-recorder', () => ({ recordJudgmentDetached: jest.fn() }));

const mGetPool = getPool as jest.Mock;
const LEDGER = /\b(orders|executions|position_state|portfolio_snapshots|holdings)\b/i;
const WRITE = /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i;

function setNow(iso: string) {
  jest.useFakeTimers({
    now: new Date(iso),
    doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'clearImmediate', 'queueMicrotask', 'performance'],
  });
}
const FRI_1602 = '2026-10-16T07:02:00Z';   // 금 16:02 KST → 카드 valid_from 월 10-19 09:00, expires 15:30
const VALID_FROM = '2026-10-19 09:00:00';
const EXPIRES = '2026-10-19 15:30:00';

/** INSERT 파라미터 순서 (status 는 맨 뒤 열 — post-market-engine.ts) */
const CARD = { strategy: 0, symbol: 1, price: 2, amount: 3, reasoning: 4, indicators: 5, expires: 6, validFrom: 7, market: 8, status: 9 } as const;
const PF_COLS = ['signal_id', 'strategy_id', 'gate_reason', 'origin', 'market', 'symbol', 'order_type', 'currency',
  'limit_price', 'limit_price_krw', 'fx_usdkrw', 'zone_lo', 'zone_hi', 'quantity', 'amount_krw',
  'fee_rate_pct', 'fee_est_krw', 'fill_model', 'valid_from', 'valid_until', 'signal_created_at'] as const;
const pf = (params: unknown[]) => Object.fromEntries(PF_COLS.map((c, i) => [c, params[i]])) as Record<(typeof PF_COLS)[number], unknown>;

interface World {
  /** strategies.validation_status — 없음 = 행 없음, Error = 조회 예외 */
  strategies: Record<string, string | Error>;
  /** 이미 있는 카드 키(symbol|valid_from) → id */
  cards: Map<string, { id: number; params: unknown[] }>;
  nextCardId: number;
  /** 카드 INSERT 가 1062 를 던진다(동시 삽입에 진 쪽) */
  card1062: boolean;
  /** 카드 INSERT 응답에서 insertId 를 뺀다 */
  noInsertId: boolean;
  paper: Map<unknown, unknown[]>;
  paperThrows: Error | null;
  calls: Array<{ sql: string; params: unknown[] }>;
  /** 'S' = strategies 조회, 'C' = 카드 INSERT, 'P' = paper_fills INSERT — 순서 확인용 */
  events: string[];
}
let w: World;

function wireDb() {
  const query = jest.fn(async (sqlArg: unknown, paramsArg: unknown[] = []) => {
    const sql = String(sqlArg);
    const params = paramsArg ?? [];
    w.calls.push({ sql, params });
    if (/SELECT validation_status FROM strategies WHERE id = \?/.test(sql)) {
      w.events.push('S');
      const v = w.strategies[String(params[0])];
      if (v instanceof Error) throw v;
      return [v === undefined ? [] : [{ validation_status: v }], undefined];
    }
    if (/INSERT INTO signals/.test(sql) && /FROM DUAL/.test(sql)) {
      w.events.push('C');
      if (w.card1062) throw Object.assign(new Error("Duplicate entry for key 'uq_signals_scenario_card'"), { errno: 1062, code: 'ER_DUP_ENTRY' });
      const key = `${String(params[params.length - 2])}|${String(params[params.length - 1])}`;   // NOT EXISTS 의 (symbol, valid_from)
      if (w.cards.has(key)) return [{ affectedRows: 0, insertId: 0 }, undefined];
      const id = w.nextCardId++;
      w.cards.set(key, { id, params });
      return [w.noInsertId ? { affectedRows: 1 } : { affectedRows: 1, insertId: id }, undefined];
    }
    if (/INSERT INTO paper_fills/.test(sql)) {
      w.events.push('P');
      if (w.paperThrows) throw w.paperThrows;
      if (w.paper.has(params[0])) throw Object.assign(new Error('Duplicate entry'), { errno: 1062, code: 'ER_DUP_ENTRY' });
      w.paper.set(params[0], params);
      return [{ affectedRows: 1, insertId: 800 + w.paper.size }, undefined];
    }
    if (/FROM fx_rates/.test(sql)) return [[{ rate: '1330.0000', age_sec: 60 }], undefined];
    throw new Error(`예상하지 못한 SQL: ${sql.slice(0, 80)}`);
  });
  mGetPool.mockReturnValue({ query });
  return query;
}

const cand = (symbol: string, pattern: DailyCandidate['pattern']): DailyCandidate => ({
  symbol, pattern, close: 93800, high: 94200, low: 92500, open: 92900, volume: 1_000_000, volRatio: 1.8,
  rsi14: 55, ma5: 93100, ma20: 90500, reasoning: '종가 고가권 마감',
});
const buy = (symbol: string) => ({
  symbol, action: 'BUY', entry_zone: { lo: 93000, hi: 94000 }, target_pct: 3.5, stop_pct: 1.8, holding_days: 2, confidence: 85, reasoning: '근거',
});

/** 005380 → eod-high-close-v1 · 055550 → inside-bar-v1 (패턴별 전략 ID `${pattern}-v1`) */
function arrangeFlow(symbols: Array<[string, DailyCandidate['pattern']]>) {
  (getAlwaysIncludeSymbols as jest.Mock).mockResolvedValue(symbols.map(([s]) => s));
  (getUniverseSnapshot as jest.Mock).mockResolvedValue({});
  (getCandles as jest.Mock).mockResolvedValue([]);
  const by = new Map(symbols);
  (eodHighClose as jest.Mock).mockImplementation((s: string) => (by.get(s) === 'eod-high-close' ? cand(s, 'eod-high-close') : null));
  (insideBar as jest.Mock).mockImplementation((s: string) => (by.get(s) === 'inside-bar' ? cand(s, 'inside-bar') : null));
  (oversoldBounceDaily as jest.Mock).mockImplementation((s: string) => (by.get(s) === 'oversold-bounce' ? cand(s, 'oversold-bounce') : null));
  (retrieveRagContext as jest.Mock).mockResolvedValue({ totalChars: 0 });
  (runLlm as jest.Mock).mockResolvedValue(JSON.stringify({ decisions: symbols.map(([s]) => buy(s)) }));
}

const cardInserts = () => w.calls.filter((c) => /INSERT INTO signals/.test(c.sql));
const logs = () => (console.log as jest.Mock).mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  jest.clearAllMocks();
  for (const m of ['log', 'warn', 'error', 'info'] as const) jest.spyOn(console, m).mockImplementation(() => {});
  w = {
    strategies: { 'eod-high-close-v1': 'unvalidated', 'ok-v1': 'backtested' },
    cards: new Map(), nextCardId: 7000, card1062: false, noInsertId: false,
    paper: new Map(), paperThrows: null, calls: [], events: [],
  };
  wireDb();
  (getStyleConfig as jest.Mock).mockResolvedValue({ limitChasePct: 0.005 });
});
afterEach(() => {
  // 🔴 모든 시험: 실 장부 쓰기 0
  expect(w.calls.filter((c) => WRITE.test(c.sql) && LEDGER.test(c.sql))).toEqual([]);
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('1. 🔴 국내 실행 — 검증 안 된 전략의 카드는 승인 불가(skipped) + 가상 체결', () => {
  test('unvalidated(eod-high-close-v1)·미등록(inside-bar-v1) → 둘 다 skipped, 승인 가능한 새 카드 0, 배치(LLM)는 그대로', async () => {
    setNow(FRI_1602);
    arrangeFlow([['005380', 'eod-high-close'], ['055550', 'inside-bar']]);
    const r = await runPostMarketAnalysis('domestic');

    expect(runLlm).toHaveBeenCalledTimes(1);                                // 카드 생성 배치는 계속 돈다
    expect(r).toMatchObject({ signalsCreated: 0, signalsSkipped: 2, validationBlocked: 2, duplicatesSkipped: 0, errors: [] });
    const ins = cardInserts();
    expect(ins).toHaveLength(2);
    expect(ins.map((c) => c.params[CARD.status])).toEqual(['skipped', 'skipped']);
    // 🔴 어떤 카드도 승인 가능한 상태로 들어가지 않는다 (대시보드 '내일'·추천 탭은 status='pending' 만 본다)
    expect(ins.some((c) => c.params.includes('pending'))).toBe(false);
    expect(ins.map((c) => c.params[CARD.strategy])).toEqual(['eod-high-close-v1', 'inside-bar-v1']);
    // 판정 → INSERT 순서(카드마다), 가상 체결은 새 행 뒤
    expect(w.events.join('')).toBe('SCPSCP');
    // 가상 체결 2행 — 사유는 카드마다
    expect(w.paper.size).toBe(2);
    expect([...w.paper.values()].map((p) => pf(p).gate_reason)).toEqual(['unvalidated', 'unregistered']);
    expect(logs().filter((l) => l.includes('🚫'))).toHaveLength(2);
    expect(logs().some((l) => l.includes('created=0 skipped=2') && l.includes('검증 관문 2'))).toBe(true);
  });

  test('막힌 카드 행: 가격·금액·구간·만료는 그대로, indicators 에 관문 표지 + 원래 시나리오(목표·손절)는 보존', async () => {
    setNow(FRI_1602);
    arrangeFlow([['005380', 'eod-high-close']]);
    await runPostMarketAnalysis('domestic');
    const p = cardInserts()[0].params;
    expect(p[CARD.price]).toBe(93500);
    expect(p[CARD.amount]).toBe(100000);
    expect([p[CARD.expires], p[CARD.validFrom], p[CARD.market]]).toEqual([EXPIRES, VALID_FROM, 'domestic']);
    const ind = JSON.parse(String(p[CARD.indicators]));
    expect(ind).toMatchObject({
      pattern: 'eod-high-close',
      gate: 'validation_gate',
      validation_gate: { reason: 'unvalidated', status: 'unvalidated', origin: 'post_market' },
      ai: { scenario: { entry: { trigger: 'price_zone', price_zone: '93000~94000' }, exit: { target_pct: 3.5, stop_pct: 1.8 } } },
    });
  });

  test('🔴 가상 체결 = 그 카드 행 id · 카드형(zone_touch_pending) · 구간(원) · 카드와 같은 KST 유효기간 · entry-watcher 와 같은 사이징', async () => {
    setNow(FRI_1602);
    arrangeFlow([['005380', 'eod-high-close']]);
    await runPostMarketAnalysis('domestic');
    const cardId = [...w.cards.values()][0].id;
    const row = pf(w.paper.get(cardId)!);
    const chased = 93500 * 1.005;                                          // entry-watcher: 카드 price × (1 + 추격률)
    expect(row).toMatchObject({
      signal_id: cardId, strategy_id: 'eod-high-close-v1', gate_reason: 'unvalidated', origin: 'post_market',
      market: 'domestic', symbol: '005380', order_type: 'limit', currency: 'KRW',
      zone_lo: 93000, zone_hi: 94000, amount_krw: 100000, fee_rate_pct: 0.014, fill_model: 'zone_touch_pending',
      valid_from: VALID_FROM, valid_until: EXPIRES, fx_usdkrw: null,
    });
    expect(row.limit_price_krw).toBeCloseTo(chased, 6);
    expect(row.quantity).toBe(Math.floor(100000 / chased));              // 1주
    expect(row.signal_created_at).toBeNull();                             // → DB NOW()
  });

  test.each([
    ['상태값 이상', 'BACKTESTED', 'invalid_status'],
    ['조회 실패(마이그레이션 전 ER_BAD_FIELD_ERROR)', Object.assign(new Error("Unknown column 'validation_status'"), { code: 'ER_BAD_FIELD_ERROR' }), 'lookup_error'],
  ])('%s → skipped(fail-closed), 가상 체결에 그 사유', async (_n, v, reason) => {
    setNow(FRI_1602);
    w.strategies['eod-high-close-v1'] = v as string | Error;
    arrangeFlow([['005380', 'eod-high-close']]);
    const r = await runPostMarketAnalysis('domestic');
    expect(r).toMatchObject({ signalsCreated: 0, validationBlocked: 1 });
    expect(cardInserts()[0].params[CARD.status]).toBe('skipped');
    expect(pf([...w.paper.values()][0]).gate_reason).toBe(reason);
  });

  test('검증된 전략은 기존 그대로 pending · 가상 체결 없음 · 응답에 validationBlocked 없음(형태 불변)', async () => {
    setNow(FRI_1602);
    w.strategies['eod-high-close-v1'] = 'backtested';
    arrangeFlow([['005380', 'eod-high-close']]);
    const r = await runPostMarketAnalysis('domestic');
    expect(r).toMatchObject({ signalsCreated: 1, signalsSkipped: 0 });
    expect('validationBlocked' in r).toBe(false);
    expect(cardInserts()[0].params[CARD.status]).toBe('pending');
    expect(JSON.parse(String(cardInserts()[0].params[CARD.indicators])).gate).toBeUndefined();
    expect(w.paper.size).toBe(0);
    expect(w.events.join('')).toBe('SC');
  });
});

describe('2. 🔴 중복이면 가상 체결을 만들지 않는다 (새 행이 생긴 경우에만)', () => {
  test('같은 카드가 이미 있음(NOT EXISTS 0행) → duplicate, 가상 체결 0', async () => {
    setNow(FRI_1602);
    w.cards.set(`005380|${VALID_FROM}`, { id: 1, params: [] });
    arrangeFlow([['005380', 'eod-high-close']]);
    const r = await runPostMarketAnalysis('domestic');
    expect(r).toMatchObject({ signalsCreated: 0, duplicatesSkipped: 1, signalsSkipped: 1 });
    expect('validationBlocked' in r).toBe(false);
    expect(w.paper.size).toBe(0);
    expect(w.events).not.toContain('P');
  });

  test('동시 삽입에 진 쪽(1062) → duplicate, 가상 체결 0, insert_fail 아님', async () => {
    setNow(FRI_1602);
    w.card1062 = true;
    arrangeFlow([['005380', 'eod-high-close']]);
    const r = await runPostMarketAnalysis('domestic');
    expect(r).toMatchObject({ duplicatesSkipped: 1, errors: [] });
    expect(w.paper.size).toBe(0);
  });

  test('같은 실행을 두 번 돌려도 카드 1장 · 가상 체결 1행', async () => {
    setNow(FRI_1602);
    arrangeFlow([['005380', 'eod-high-close']]);
    await runPostMarketAnalysis('domestic');
    const r2 = await runPostMarketAnalysis('domestic');
    expect(r2).toMatchObject({ duplicatesSkipped: 1 });
    expect(w.cards.size).toBe(1);
    expect(w.paper.size).toBe(1);
  });
});

describe('3. 🔴 가상 체결 기록 실패는 카드·실행을 바꾸지 않는다', () => {
  test('paper_fills 없음(마이그레이션 전) → 카드는 skipped 로 남고 blocked 로 센다, 던지지 않음·insert_fail 아님', async () => {
    setNow(FRI_1602);
    w.paperThrows = Object.assign(new Error("Table 'paper_fills' doesn't exist"), { code: 'ER_NO_SUCH_TABLE' });
    arrangeFlow([['005380', 'eod-high-close'], ['055550', 'inside-bar']]);
    const r = await runPostMarketAnalysis('domestic');
    expect(r).toMatchObject({ signalsCreated: 0, validationBlocked: 2, errors: [] });
    expect(cardInserts()).toHaveLength(2);                                // 두 번째 카드도 계속 처리됐다
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('가상 체결 기록 실패'));
  });

  test('카드 id 를 알 수 없으면(insertId 없음) 가상 체결 없이 blocked — 로그', async () => {
    w.noInsertId = true;
    const row: ScenarioCardRow = {
      strategyId: 'eod-high-close-v1', symbol: '005380', price: 93500, reasoning: 'r', indicatorsJson: '{}', expiresAt: EXPIRES, validFrom: VALID_FROM,
    };
    await expect(insertScenarioCardIfAbsent(getPool(), row)).resolves.toBe('blocked');
    expect(w.paper.size).toBe(0);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('막힌 카드 id'));
  });
});

describe('4. insertScenarioCardIfAbsent — 트랜잭션용 deferPaperFills', () => {
  const row = (over: Partial<ScenarioCardRow> = {}): ScenarioCardRow => ({
    strategyId: 'eod-high-close-v1', symbol: 'NAS:CMCSA', price: 36442, reasoning: 'r', indicatorsJson: '{"ai":{}}',
    expiresAt: '2026-10-22 05:00:00', validFrom: '2026-10-21 22:30:00', market: 'overseas', amountKrw: 100000,
    zoneLo: 27.2, zoneHi: 27.6, chasedPriceKrw: 36442 * 1.005, ...over,
  });

  test('🔴 막힘 + 미루기 → 가상 체결은 배열에만 쌓이고 paper_fills SQL 0 (호출부가 커밋 뒤 기록)', async () => {
    const deferred: PaperFillInput[] = [];
    await expect(insertScenarioCardIfAbsent(getPool(), row(), { deferPaperFills: deferred })).resolves.toBe('blocked');
    expect(w.events).not.toContain('P');
    expect(deferred).toHaveLength(1);
    expect(deferred[0]).toMatchObject({
      signalId: 7000, strategyId: 'eod-high-close-v1', gateReason: 'unvalidated', origin: 'post_market', symbol: 'NAS:CMCSA',
      orderType: 'limit', amountKrw: 100000, fillModel: 'zone_touch_pending', zoneLo: 27.2, zoneHi: 27.6,
      validFrom: '2026-10-21 22:30:00', validUntil: '2026-10-22 05:00:00', quantity: 2,   // floor(100000 / 36624.2) = 2
    });
    expect(deferred[0].limitPriceKrw).toBeCloseTo(36442 * 1.005, 6);
  });

  test('통과 → created, 배열 비어 있음 · 중복 → duplicate, 배열 비어 있음', async () => {
    w.strategies['ok-v1'] = 'paper_validated';
    const d1: PaperFillInput[] = [];
    await expect(insertScenarioCardIfAbsent(getPool(), row({ strategyId: 'ok-v1' }), { deferPaperFills: d1 })).resolves.toBe('created');
    expect(d1).toHaveLength(0);
    const d2: PaperFillInput[] = [];
    await expect(insertScenarioCardIfAbsent(getPool(), row(), { deferPaperFills: d2 })).resolves.toBe('duplicate');   // 같은 키
    expect(d2).toHaveLength(0);
  });

  test('flushCardPaperFills — 쌓인 것을 기록하고 새로 생긴 수를 돌려준다, 실패해도 던지지 않는다', async () => {
    const deferred: PaperFillInput[] = [];
    await insertScenarioCardIfAbsent(getPool(), row(), { deferPaperFills: deferred });
    await insertScenarioCardIfAbsent(getPool(), row({ symbol: 'NYS:BAC' }), { deferPaperFills: deferred });
    await expect(flushCardPaperFills(deferred)).resolves.toBe(2);
    expect(pf(w.paper.get(7000)!)).toMatchObject({ currency: 'USD', market: 'overseas', zone_lo: 27.2, zone_hi: 27.6, fx_usdkrw: 1330 });
    await expect(flushCardPaperFills(deferred)).resolves.toBe(0);          // 같은 카드 다시 → 1062 = 중복(새 행 0)
    w.paperThrows = new Error('db down');
    await expect(flushCardPaperFills([{ ...deferred[0], signalId: 1 }])).resolves.toBe(0);
  });

  test('카드 indicators 를 해석할 수 없으면 원문을 지우지 않고 그대로 둔다(상태는 skipped)', async () => {
    await insertScenarioCardIfAbsent(getPool(), row({ indicatorsJson: 'not-json' }), { deferPaperFills: [] });
    const p = cardInserts()[0].params;
    expect(p[CARD.indicators]).toBe('not-json');
    expect(p[CARD.status]).toBe('skipped');
  });
});
