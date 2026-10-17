/**
 * T-045 — post-market 엔진: 주말 스킵 + 같은 (종목·방향·valid_from) 카드 중복 INSERT 방지.
 *
 * 배경: 2026-10-17(토) 16:02 실행이 금요일 카드와 같은 월요일용 카드를 구간이 다르게 또 만들었다.
 * 지킬 것: (1) 주말(KST 토·일)에는 LLM·시세·INSERT 를 부르지 않는다 (2) **공휴일은 건너뛰지 않는다** — 공휴일 당일 실행이
 * 그 다음 거래일용 카드를 만드는 유일한 실행이다(독립 감사 R-1) (3) 같은 키가 있으면 INSERT 하지 않고 센다
 * (4) 거래일 정상 경로·해외·INSERT 실패 처리는 그대로다.
 */
import type { DailyCandidate } from '../rules/eod-high-close';
import { runPostMarketAnalysis, insertScenarioCardIfAbsent, isWeekendKst } from '../post-market-engine';
import { getPool } from '@/lib/db';
import { getCandles } from '@/lib/exchanges/kis-domestic';
import { getAlwaysIncludeSymbols, getUniverseSnapshot } from '../universe';
import { runLlm } from '@/lib/llm/provider';
import { retrieveRagContext } from '@/lib/rag/retrieval';
import { eodHighClose } from '../rules/eod-high-close';
import { insideBar } from '../rules/inside-bar';
import { oversoldBounceDaily } from '../rules/oversold-bounce-daily';

jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));
jest.mock('@/lib/exchanges/kis-domestic', () => ({ getCandles: jest.fn() }));
jest.mock('../universe', () => ({ getAlwaysIncludeSymbols: jest.fn(), getUniverseSnapshot: jest.fn() }));
jest.mock('@/lib/llm/provider', () => ({ runLlm: jest.fn() }));
jest.mock('@/lib/rag/retrieval', () => ({ retrieveRagContext: jest.fn() }));
jest.mock('@/lib/rag/format', () => ({ formatRagSection: jest.fn(() => '') }));
jest.mock('../rules/eod-high-close', () => ({ eodHighClose: jest.fn() }));
jest.mock('../rules/inside-bar', () => ({ insideBar: jest.fn() }));
jest.mock('../rules/oversold-bounce-daily', () => ({ oversoldBounceDaily: jest.fn() }));

const mGetPool = getPool as jest.Mock;
const mCandles = getCandles as jest.Mock;
const mAlways = getAlwaysIncludeSymbols as jest.Mock;
const mUniverse = getUniverseSnapshot as jest.Mock;
const mLlm = runLlm as jest.Mock;
const mRag = retrieveRagContext as jest.Mock;
const mEod = eodHighClose as jest.Mock;
const mInside = insideBar as jest.Mock;
const mOversold = oversoldBounceDaily as jest.Mock;

/** Date 만 가짜로 만든다 — 비동기 목은 그대로 동작해야 한다. */
function setNow(iso: string) {
  jest.useFakeTimers({
    now: new Date(iso),
    doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'clearImmediate', 'queueMicrotask', 'performance'],
  });
}
// 16:02 KST = 07:02Z. 금 2026-10-16 / 토 10-17 / 일 10-18 / 한글날(금) 10-09
const FRI_1602 = '2026-10-16T07:02:00Z';
const SAT_1602 = '2026-10-17T07:02:00Z';
const SUN_1602 = '2026-10-18T07:02:00Z';
const HANGUL_DAY_FRI_1602 = '2026-10-09T07:02:00Z';

const candidate = (symbol: string): DailyCandidate => ({
  symbol, pattern: 'eod-high-close', close: 312000, high: 313000, low: 308000, open: 309000,
  volume: 1_000_000, volRatio: 1.8, rsi14: 55, ma5: 311000, ma20: 305000, reasoning: '종가 고가권 마감',
});

const buy = (symbol: string, lo = 310000, hi = 314000, confidence = 75) => ({
  symbol, action: 'BUY', entry_zone: { lo, hi }, target_pct: 3.5, stop_pct: 1.8, holding_days: 2, confidence, reasoning: '근거',
});

let query: jest.Mock;

/** 거래일 정상 경로를 준비한다: 종목 N개 → 후보 → LLM BUY. */
function arrangeFlow(symbols: string[], insertResults: Array<{ affectedRows: number } | Error>) {
  mAlways.mockResolvedValue(symbols);
  mUniverse.mockResolvedValue({});
  mCandles.mockResolvedValue([]);
  mEod.mockImplementation((symbol: string) => candidate(symbol));
  mInside.mockReturnValue(null);
  mOversold.mockReturnValue(null);
  mRag.mockResolvedValue({ totalChars: 0 });
  mLlm.mockResolvedValue(JSON.stringify({ decisions: symbols.map(s => buy(s)) }));
  for (const r of insertResults) {
    if (r instanceof Error) query.mockRejectedValueOnce(r);
    else query.mockResolvedValueOnce([r, undefined]);
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  query = jest.fn();
  mGetPool.mockReturnValue({ query });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('isWeekendKst — 서버 시간대와 무관하게 KST 요일', () => {
  test.each([
    ['금 23:59:59 KST', '2026-10-16T14:59:59Z', false],
    ['토 00:00:00 KST (UTC 로는 아직 금요일)', '2026-10-16T15:00:00Z', true],
    ['토 16:02 KST', SAT_1602, true],
    ['일 23:59:59 KST (UTC 로는 일요일 14:59)', '2026-10-18T14:59:59Z', true],
    ['월 00:00:00 KST (UTC 로는 아직 일요일)', '2026-10-18T15:00:00Z', false],
    ['월 16:02 KST', '2026-10-19T07:02:00Z', false],
    ['평일 한글날(금) 16:02 KST — 공휴일이어도 주말이 아니다', HANGUL_DAY_FRI_1602, false],
  ])('%s → %s', (_n, iso, expected) => {
    expect(isWeekendKst(new Date(iso as string))).toBe(expected);
  });
});

describe('주말 스킵 (국내)', () => {
  test.each([['토요일', SAT_1602], ['일요일', SUN_1602]])('🔴 %s 실행은 심볼 로드·시세·RAG·LLM·INSERT 를 하나도 부르지 않고 skipped 로 끝난다', async (_n, iso) => {
    setNow(iso as string);
    const r = await runPostMarketAnalysis('domestic');
    expect(r).toMatchObject({ market: 'domestic', skipped: 'weekend', signalsCreated: 0, signalsSkipped: 0, candidatesFound: 0, symbolsEvaluated: 0, errors: [] });
    expect(mAlways).not.toHaveBeenCalled();
    expect(mUniverse).not.toHaveBeenCalled();
    expect(mCandles).not.toHaveBeenCalled();
    expect(mRag).not.toHaveBeenCalled();
    expect(mLlm).not.toHaveBeenCalled();
    expect(mGetPool).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  test('평일(금)은 기존대로 분석을 진행한다(skipped 없음)', async () => {
    setNow(FRI_1602);
    arrangeFlow(['005380'], [{ affectedRows: 1 }]);
    const r = await runPostMarketAnalysis('domestic');
    expect(r.skipped).toBeUndefined();
    expect(mLlm).toHaveBeenCalledTimes(1);
    expect(r.signalsCreated).toBe(1);
  });

  test('🔴 평일 공휴일(한글날 금요일)은 건너뛰지 않는다 — 그 다음 거래일(월)용 카드를 만드는 유일한 실행이다 (독립 감사 R-1)', async () => {
    setNow(HANGUL_DAY_FRI_1602);
    arrangeFlow(['005380'], [{ affectedRows: 1 }]);
    const r = await runPostMarketAnalysis('domestic');
    expect(r.skipped).toBeUndefined();
    expect(r.signalsCreated).toBe(1);
    expect(r.validFrom).toBe('2026-10-12 00:00:00');   // 토·일을 건너뛴 다음 월요일
  });

  test('해외는 주말에도 판정하지 않는다(변화 없음 — 종목이 없어 no_symbols)', async () => {
    setNow(SAT_1602);
    mAlways.mockResolvedValue([]);
    const r = await runPostMarketAnalysis('overseas');
    expect(r.errors).toEqual(['no_symbols']);
    expect(r.skipped).toBeUndefined();
  });
});

describe('중복 카드 방지', () => {
  test('새 카드는 만든다 — NOT EXISTS 조건이 든 한 문장, 다음 거래일(월)·만료 시각 계산 그대로', async () => {
    setNow(FRI_1602);
    arrangeFlow(['005380'], [{ affectedRows: 1 }]);
    const r = await runPostMarketAnalysis('domestic');
    expect(r).toMatchObject({ signalsCreated: 1, signalsSkipped: 0, duplicatesSkipped: 0, validFrom: '2026-10-19 00:00:00' });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/INSERT INTO signals/);
    expect(params[0]).toBe('eod-high-close-v1');
    expect(params[1]).toBe('005380');
    expect(params[2]).toBe(312000);                               // 구간 중간값
    expect(String(params[3])).toContain('[익일 시나리오]');
    expect(JSON.parse(String(params[4])).ai.scenario.entry.price_zone).toBe('310000~314000');
    expect(params[5]).toBe('2026-10-19 06:30:00');                // expires_at
    expect(params[6]).toBe('2026-10-19 00:00:00');                // valid_from
    expect(params.slice(7)).toEqual(['005380', '2026-10-19 00:00:00']);   // NOT EXISTS 의 비교 키
  });

  test('🔴 같은 카드가 이미 있으면(affectedRows 0) 만들지 않고 중복으로 센다', async () => {
    setNow(FRI_1602);
    arrangeFlow(['005380'], [{ affectedRows: 0 }]);
    const r = await runPostMarketAnalysis('domestic');
    expect(r).toMatchObject({ signalsCreated: 0, signalsSkipped: 1, duplicatesSkipped: 1, errors: [] });
  });

  test('두 종목 중 하나만 중복이면 하나는 만들고 하나는 센다', async () => {
    setNow(FRI_1602);
    arrangeFlow(['005380', '055550'], [{ affectedRows: 1 }, { affectedRows: 0 }]);
    const r = await runPostMarketAnalysis('domestic');
    expect(r).toMatchObject({ signalsCreated: 1, signalsSkipped: 1, duplicatesSkipped: 1 });
    expect(query).toHaveBeenCalledTimes(2);
  });

  test('INSERT 예외는 기존대로 insert_fail 로 기록하고 중복으로 세지 않는다', async () => {
    setNow(FRI_1602);
    arrangeFlow(['005380'], [new Error('ER_LOCK_WAIT_TIMEOUT')]);
    const r = await runPostMarketAnalysis('domestic');
    expect(r.signalsCreated).toBe(0);
    expect(r.signalsSkipped).toBe(1);
    expect(r.duplicatesSkipped).toBe(0);
    expect(r.errors).toEqual([expect.stringContaining('insert_fail:005380:ER_LOCK_WAIT_TIMEOUT')]);
  });
});

describe('insertScenarioCardIfAbsent', () => {
  const row = {
    strategyId: 'eod-high-close-v1', symbol: '005380', price: 312000, reasoning: 'r', indicatorsJson: '{}',
    expiresAt: '2026-10-19 06:30:00', validFrom: '2026-10-19 00:00:00',
  };
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

  test('affectedRows 로 created / duplicate 를 가른다', async () => {
    const q = jest.fn().mockResolvedValueOnce([{ affectedRows: 1 }, undefined]).mockResolvedValueOnce([{ affectedRows: 0 }, undefined]);
    expect(await insertScenarioCardIfAbsent({ query: q } as never, row)).toBe('created');
    expect(await insertScenarioCardIfAbsent({ query: q } as never, row)).toBe('duplicate');
  });

  test('🔴 SQL 의 ? 개수와 파라미터 개수가 같다(자리 수 어긋남 방지)', async () => {
    const q = jest.fn().mockResolvedValue([{ affectedRows: 1 }, undefined]);
    await insertScenarioCardIfAbsent({ query: q } as never, row);
    const [sql, params] = q.mock.calls[0] as [string, unknown[]];
    expect((sql.match(/\?/g) ?? []).length).toBe(params.length);
    expect(params).toHaveLength(9);
  });

  test('🔴 SQL 전체를 고정한다 — "상태 불문" 정책과 대상 테이블이 바뀌면 실패 (독립 감사 R-3)', async () => {
    const q = jest.fn().mockResolvedValue([{ affectedRows: 1 }, undefined]);
    await insertScenarioCardIfAbsent({ query: q } as never, row);
    const sql = norm((q.mock.calls[0] as [string])[0]);
    // 삽입 열과 SELECT 리터럴(방향·주문유형·금액·상태·시장·출처)
    expect(sql).toContain('INSERT INTO signals (strategy_id, symbol, side, order_type, price, amount_krw, reasoning, indicators, status, expires_at, valid_from, market, scenario_source)');
    expect(sql).toContain("SELECT ?, ?, 'buy', 'limit', ?, 100000, ?, ?, 'pending', ?, ?, 'domestic', 'post-market' FROM DUAL");
    // 중복 판정: signals 테이블, 종목·방향·valid_from·출처만 — status/strategy_id 조건이 없다(거절·대체된 카드도 막는다)
    expect(sql).toContain("WHERE NOT EXISTS ( SELECT 1 FROM signals WHERE symbol = ? AND side = 'buy' AND valid_from = ? AND scenario_source = 'post-market' )");
    expect(sql.endsWith("scenario_source = 'post-market' )")).toBe(true);
  });

  test('DB 예외는 삼키지 않고 호출자에게 던진다(호출자가 insert_fail 로 기록)', async () => {
    const q = jest.fn().mockRejectedValue(new Error('boom'));
    await expect(insertScenarioCardIfAbsent({ query: q } as never, row)).rejects.toThrow('boom');
  });
});
