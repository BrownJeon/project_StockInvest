/**
 * T-045 — post-market 엔진: 주말 스킵 + 같은 (종목·방향·valid_from) 카드 중복 INSERT 방지.
 *
 * 배경: 2026-10-17(토) 16:02 실행이 금요일 카드와 같은 월요일용 카드를 구간이 다르게 또 만들었다.
 * 지킬 것: (1) 주말(KST 토·일)에는 LLM·시세·INSERT 를 부르지 않는다 (2) **공휴일은 건너뛰지 않는다** — 공휴일 당일 실행이
 * 그 다음 거래일용 카드를 만드는 유일한 실행이다(독립 감사 R-1) (3) 같은 키가 있으면 INSERT 하지 않고 센다
 * (4) 거래일 정상 경로·해외·INSERT 실패 처리는 그대로다.
 */
import type { DailyCandidate } from '../rules/eod-high-close';
import { runPostMarketAnalysis, insertScenarioCardIfAbsent, isWeekendKst, toKstDatetime, POST_MARKET_CARD_AMOUNT_KRW, POST_MARKET_CARD_AMOUNT_KRW_BY_MARKET, cardBuysZeroShares } from '../post-market-engine';
import { getPool } from '@/lib/db';
import { getStyleConfig } from '../style';
import { getCandles } from '@/lib/exchanges/kis-domestic';
import { getAlwaysIncludeSymbols, getUniverseSnapshot } from '../universe';
import { runLlm } from '@/lib/llm/provider';
import { retrieveRagContext } from '@/lib/rag/retrieval';
import { recordRetrievalNewsOutcome } from '@/lib/rag/news-health';
import { eodHighClose } from '../rules/eod-high-close';
import { insideBar } from '../rules/inside-bar';
import { oversoldBounceDaily } from '../rules/oversold-bounce-daily';

jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));
jest.mock('@/lib/exchanges/kis-domestic', () => ({ getCandles: jest.fn() }));
jest.mock('../universe', () => ({ getAlwaysIncludeSymbols: jest.fn(), getUniverseSnapshot: jest.fn() }));
jest.mock('@/lib/llm/provider', () => ({ runLlm: jest.fn() }));
jest.mock('@/lib/rag/retrieval', () => ({ retrieveRagContext: jest.fn() }));
// T-106 — 뉴스 0건 연속 감시 기록은 이 파일에서 목(호출 지점·인자·흐름 무영향만 본다; 세는 규칙은 rag/__tests__/news-health.test.ts).
jest.mock('@/lib/rag/news-health', () => ({ recordRetrievalNewsOutcome: jest.fn(async () => null) }));
jest.mock('@/lib/rag/format', () => ({ formatRagSection: jest.fn(() => '') }));
jest.mock('../rules/eod-high-close', () => ({ eodHighClose: jest.fn() }));
jest.mock('../rules/inside-bar', () => ({ insideBar: jest.fn() }));
jest.mock('../rules/oversold-bounce-daily', () => ({ oversoldBounceDaily: jest.fn() }));
// T-053 — 엔진이 지정가 추격률(limitChasePct)을 읽는다. DB 목(query)의 INSERT 응답 순서를 건드리지 않도록 따로 목한다.
jest.mock('../style', () => ({ getStyleConfig: jest.fn() }));
// T-112 — 기준 판단 기록기는 이 파일에서 목이다(기록 I/O 가 풀 목·로그·호출 수를 건드리지 않게). 추적 표시(judgment-trace)는 실물이다.
//   기록 on/off·실패·지연이 분석 결과를 바꾸지 않는다는 증명과 거르기 지점별 기록은 records/__tests__/judgment-engine-wiring.test.ts 가 본다.
jest.mock('../records/judgment-recorder', () => ({ recordJudgmentDetached: jest.fn() }));
// T-072 G2 — 이 파일은 카드 INSERT 기계(중복·시각·금액 필터·SQL 모양)를 본다. 관문 판정은 '검증됨'으로 고정해 카드가 기존처럼
//   `pending` 으로 들어가는 경로를 그대로 시험한다(판정 조회가 같은 목 풀의 mockResolvedValueOnce 를 먹지 않게).
//   막히는 경우는 post-market-validation-gate.test.ts 가 실제 관문으로 본다.
jest.mock('@/lib/safety/validation-gate', () => ({
  ...jest.requireActual('@/lib/safety/validation-gate'),
  evaluateValidationGate: jest.fn(async ({ strategyId }: { strategyId: string }) => ({ allowed: true, kind: 'validated', strategyId, status: 'backtested' })),
}));

const mGetPool = getPool as jest.Mock;
const mCandles = getCandles as jest.Mock;
const mAlways = getAlwaysIncludeSymbols as jest.Mock;
const mUniverse = getUniverseSnapshot as jest.Mock;
const mLlm = runLlm as jest.Mock;
const mRag = retrieveRagContext as jest.Mock;
const mEod = eodHighClose as jest.Mock;
const mInside = insideBar as jest.Mock;
const mOversold = oversoldBounceDaily as jest.Mock;
const mStyle = getStyleConfig as jest.Mock;
/** 운영 기본값(DEFAULT_STYLE_CONFIG.limitChasePct, system_config override 없음 — 2026-10-19 실측) */
const PROD_CHASE = 0.005;

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

// T-053 — 기본 진입 구간은 1주를 살 수 있는 가격(중간값 93,500 × 1.005 ≤ 100,000)이다. 예전 기본값 310,000~314,000 은
// 이제 생성 단계에서 "금액 초과"로 제외되므로(그게 이 task 의 목적), T-045/T-046 테스트의 의도와 무관한 가격만 바꿨다.
const buy = (symbol: string, lo = 93000, hi = 94000, confidence = 75) => ({
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
  mStyle.mockResolvedValue({ limitChasePct: PROD_CHASE });
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
    expect(r.validFrom).toBe('2026-10-12 09:00:00');   // 토·일을 건너뛴 다음 월요일 09:00 KST
  });

  // T-062 — 해외는 `post-market-overseas.ts` 로 간다. 스위치 키가 없으면(= 꺼짐) 스위치 SELECT 1회 외에 아무것도 부르지 않는다.
  // (예전 기대값 `errors:['no_symbols']` 는 "해외 종목 0개" 구현의 결과였다 — 해외 경로 상세 시험은 post-market-overseas.test.ts)
  test('해외: 스위치 키가 없으면 overseas_disabled — 국내 경로(심볼·시세·RAG·LLM·INSERT)를 하나도 부르지 않는다', async () => {
    setNow(SAT_1602);
    query.mockResolvedValueOnce([[], undefined]);   // system_config 에 post_market_overseas_enabled 행 없음
    const r = await runPostMarketAnalysis('overseas');
    expect(r).toMatchObject({ market: 'overseas', ok: true, status: 'ok', skipped: 'overseas_disabled', signalsCreated: 0, errors: [] });
    expect(query).toHaveBeenCalledTimes(1);
    expect(String(query.mock.calls[0][0])).toContain('FROM system_config');
    expect(query.mock.calls[0][1]).toEqual(['post_market_overseas_enabled']);
    for (const m of [mAlways, mUniverse, mCandles, mRag, mLlm, mStyle]) expect(m).not.toHaveBeenCalled();
  });
});

describe('중복 카드 방지', () => {
  test('새 카드는 만든다 — NOT EXISTS 조건이 든 한 문장, 다음 거래일(월)·만료 시각 계산 그대로', async () => {
    setNow(FRI_1602);
    arrangeFlow(['005380'], [{ affectedRows: 1 }]);
    const r = await runPostMarketAnalysis('domestic');
    expect(r).toMatchObject({ signalsCreated: 1, signalsSkipped: 0, duplicatesSkipped: 0, validFrom: '2026-10-19 09:00:00' });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/INSERT INTO signals/);
    expect(params[0]).toBe('eod-high-close-v1');
    expect(params[1]).toBe('005380');
    expect(params[2]).toBe(93500);                                // 구간 중간값
    // T-062 — amount_krw·market 이 자리표시자가 되어 인덱스가 밀렸다(저장 값은 같다 — 골든 시험이 열 단위로 고정).
    expect(params[3]).toBe(100000);                               // amount_krw
    expect(String(params[4])).toContain('[익일 시나리오]');
    expect(JSON.parse(String(params[5])).ai.scenario.entry.price_zone).toBe('93000~94000');
    expect(params[6]).toBe('2026-10-19 15:30:00');                // expires_at — 다음 거래일 15:30 KST (T-046: 예전엔 UTC 문자열 06:30)
    expect(params[7]).toBe('2026-10-19 09:00:00');                // valid_from — 다음 거래일 09:00 KST (예전엔 00:00)
    expect(params[8]).toBe('domestic');                           // market
    expect(params[9]).toBe('pending');                            // T-072 — status 자리표시자(맨 뒤 열) · 검증된 전략이면 기존과 같은 값
    expect(params.slice(10)).toEqual(['005380', '2026-10-19 09:00:00']);   // NOT EXISTS 의 비교 키
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
    expect(params).toHaveLength(12);   // T-062 — amount_krw·market 자리표시자 2개 추가 · T-072 — status 자리표시자 1개 추가
  });

  test('🔴 SQL 전체를 고정한다 — "상태 불문" 정책과 대상 테이블이 바뀌면 실패 (독립 감사 R-3)', async () => {
    const q = jest.fn().mockResolvedValue([{ affectedRows: 1 }, undefined]);
    await insertScenarioCardIfAbsent({ query: q } as never, row);
    const sql = norm((q.mock.calls[0] as [string])[0]);
    // 삽입 열과 SELECT 리터럴(방향·주문유형·금액·상태·시장·출처)
    // T-072 G2 — status 는 관문 결과라 자리표시자가 됐고, 앞 열 파라미터 위치를 옮기지 않으려고 맨 뒤 열이다.
    expect(sql).toContain('INSERT INTO signals (strategy_id, symbol, side, order_type, price, amount_krw, reasoning, indicators, expires_at, valid_from, market, scenario_source, status)');
    // T-062 — amount_krw·market 은 자리표시자(국내 행 값은 100000·'domestic' 그대로 — 아래 params 와 골든 시험)
    expect(sql).toContain("SELECT ?, ?, 'buy', 'limit', ?, ?, ?, ?, ?, ?, ?, 'post-market', ? FROM DUAL");
    const params = (q.mock.calls[0] as [string, unknown[]])[1];
    expect([params[3], params[8]]).toEqual([100000, 'domestic']);
    expect(params[9]).toBe('pending');   // 검증된 전략(이 파일의 관문 목) → 승인 가능한 카드 — 기존 리터럴과 같은 값
    // 중복 판정: signals 테이블, 종목·방향·valid_from·출처만 — status/strategy_id 조건이 없다(거절·대체된 카드도 막는다)
    expect(sql).toContain("WHERE NOT EXISTS ( SELECT 1 FROM signals WHERE symbol = ? AND side = 'buy' AND valid_from = ? AND scenario_source = 'post-market' )");
    expect(sql.endsWith("scenario_source = 'post-market' )")).toBe(true);
  });

  test('DB 예외는 삼키지 않고 호출자에게 던진다(호출자가 insert_fail 로 기록)', async () => {
    const q = jest.fn().mockRejectedValue(new Error('boom'));
    await expect(insertScenarioCardIfAbsent({ query: q } as never, row)).rejects.toThrow('boom');
  });
});

describe('toKstDatetime (T-046) — DB 는 KST 라서 KST 벽시계 문자열로 저장한다', () => {
  test.each([
    ['다음 거래일 09:00 KST = 00:00Z', '2026-10-19T00:00:00Z', '2026-10-19 09:00:00'],
    ['다음 거래일 15:30 KST = 06:30Z', '2026-10-19T06:30:00Z', '2026-10-19 15:30:00'],
    ['UTC 로는 전날 15:00 = KST 자정(날짜가 넘어간다)', '2026-10-18T15:00:00Z', '2026-10-19 00:00:00'],
    ['UTC 14:59:59 는 아직 같은 KST 날짜 23:59:59', '2026-10-18T14:59:59Z', '2026-10-18 23:59:59'],
    ['연말 경계', '2026-12-31T15:00:00Z', '2027-01-01 00:00:00'],
  ])('%s', (_n, iso, expected) => {
    expect(toKstDatetime(new Date(iso as string))).toBe(expected);
  });

  test('🔴 UTC 문자열(예전 버그)과 9시간 다르다 — 회귀 방지', () => {
    const d = new Date('2026-10-19T00:00:00Z');
    expect(d.toISOString().slice(0, 19).replace('T', ' ')).toBe('2026-10-19 00:00:00');   // 예전 값
    expect(toKstDatetime(d)).not.toBe('2026-10-19 00:00:00');
  });

  test('🔴 엔진은 금요일 16:02 KST 실행에서 월요일 09:00 / 15:30 KST 를 쓴다 (예전엔 00:00 / 06:30)', async () => {
    setNow(FRI_1602);
    arrangeFlow(['005380'], [{ affectedRows: 1 }]);
    const r = await runPostMarketAnalysis('domestic');
    expect(r.validFrom).toBe('2026-10-19 09:00:00');
    const params = query.mock.calls[0][1] as unknown[];
    expect([params[6], params[7]]).toEqual(['2026-10-19 15:30:00', '2026-10-19 09:00:00']);   // T-062 — 인덱스 +1(amount_krw 자리표시자)
  });
});

describe('ER_DUP_ENTRY 매핑 (T-046 B, T-048 유니크 인덱스)', () => {
  const row = {
    strategyId: 'eod-high-close-v1', symbol: '005380', price: 312000, reasoning: 'r', indicatorsJson: '{}',
    expiresAt: '2026-10-19 15:30:00', validFrom: '2026-10-19 09:00:00',
  };
  const dupErr = (extra: Record<string, unknown>) => Object.assign(new Error("Duplicate entry '005380-buy-…' for key 'uq_signals_scenario_card'"), extra);

  test.each([
    ['errno 1062', { errno: 1062 }],
    ['code ER_DUP_ENTRY', { code: 'ER_DUP_ENTRY' }],
  ])('🔴 %s → duplicate (중복이 생기지 않은 것)', async (_n, extra) => {
    const q = jest.fn().mockRejectedValue(dupErr(extra as Record<string, unknown>));
    expect(await insertScenarioCardIfAbsent({ query: q } as never, row)).toBe('duplicate');
  });

  test.each([
    ['교착 1213', { errno: 1213, code: 'ER_LOCK_DEADLOCK' }],
    ['1467(AUTOINC 읽기 실패)', { errno: 1467 }],
    ['연결 오류', { code: 'ECONNRESET' }],
    ['오류 정보 없음', {}],
  ])('🔴 %s 는 duplicate 로 삼키지 않고 던진다 (호출자가 insert_fail 로 남김)', async (_n, extra) => {
    const q = jest.fn().mockRejectedValue(Object.assign(new Error('x'), extra));
    await expect(insertScenarioCardIfAbsent({ query: q } as never, row)).rejects.toThrow('x');
  });

  test('엔진: 동시 삽입에 진 쪽(1062)은 duplicatesSkipped 로 세고 insert_fail 이 아니다', async () => {
    setNow(FRI_1602);
    arrangeFlow(['005380'], [dupErr({ errno: 1062 }) as never]);
    const r = await runPostMarketAnalysis('domestic');
    expect(r).toMatchObject({ signalsCreated: 0, signalsSkipped: 1, duplicatesSkipped: 1, errors: [] });
  });

  test('엔진: 1062 가 아닌 오류는 기존대로 insert_fail 로 기록한다', async () => {
    setNow(FRI_1602);
    arrangeFlow(['005380'], [Object.assign(new Error('deadlock'), { errno: 1213 }) as never]);
    const r = await runPostMarketAnalysis('domestic');
    expect(r.duplicatesSkipped).toBe(0);
    expect(r.errors).toEqual([expect.stringContaining('insert_fail:005380:deadlock')]);
  });
});

describe('T-053 — 1주 가격이 카드 금액을 넘는 카드는 만들지 않는다 (수량 0 → 영원히 실행 불가)', () => {
  type Zone = { symbol: string; lo: unknown; hi: unknown; confidence?: number; action?: string };
  /** 종목별 진입 구간을 직접 정한다. INSERT 는 들어오는 만큼 created 로 답한다. */
  function arrangeZones(zones: Zone[], close = 312000) {
    mAlways.mockResolvedValue(zones.map(z => z.symbol));
    mUniverse.mockResolvedValue({});
    mCandles.mockResolvedValue([]);
    mEod.mockImplementation((symbol: string) => ({ ...candidate(symbol), close }));
    mInside.mockReturnValue(null);
    mOversold.mockReturnValue(null);
    mRag.mockResolvedValue({ totalChars: 0 });
    mLlm.mockResolvedValue(JSON.stringify({
      decisions: zones.map(z => ({
        ...buy(z.symbol, 0, 0, z.confidence ?? 75),
        action: z.action ?? 'BUY',
        entry_zone: { lo: z.lo, hi: z.hi },
      })),
    }));
    query.mockResolvedValue([{ affectedRows: 1 }, undefined]);
  }
  const insertedSymbols = () => query.mock.calls.map(c => (c[1] as unknown[])[1]);
  const logs = () => (console.log as jest.Mock).mock.calls.map(c => String(c[0]));

  test('카드 금액 상수는 INSERT 의 amount_krw 값과 같다 (한쪽만 바뀌면 필터가 엉뚱한 예산으로 판정한다)', async () => {
    // T-062 — amount_krw 는 리터럴이 아니라 시장별 상수에서 들어간다(D-5·D-6). 기본값은 두 시장 모두 100,000.
    const q = jest.fn().mockResolvedValue([{ affectedRows: 1 }, undefined]);
    await insertScenarioCardIfAbsent({ query: q } as never, {
      strategyId: 's', symbol: '005380', price: 1, reasoning: 'r', indicatorsJson: '{}', expiresAt: 'e', validFrom: 'v',
    });
    expect(POST_MARKET_CARD_AMOUNT_KRW).toBe(100000);
    expect(POST_MARKET_CARD_AMOUNT_KRW_BY_MARKET).toEqual({ domestic: POST_MARKET_CARD_AMOUNT_KRW, overseas: 100000 });
    expect((q.mock.calls[0] as [string, unknown[]])[1][3]).toBe(POST_MARKET_CARD_AMOUNT_KRW);
    expect((q.mock.calls[0] as [string])[0]).toContain("'limit', ?, ?, ?");
  });

  test('T-062 — 해외 행은 market·amount 를 행에서 받는다(국내 기본값 불변)', async () => {
    const q = jest.fn().mockResolvedValue([{ affectedRows: 1 }, undefined]);
    await insertScenarioCardIfAbsent({ query: q } as never, {
      strategyId: 's', symbol: 'NAS:CMCSA', price: 36442, reasoning: 'r', indicatorsJson: '{}', expiresAt: 'e', validFrom: 'v', market: 'overseas',
    });
    const params = (q.mock.calls[0] as [string, unknown[]])[1];
    expect([params[3], params[8]]).toEqual([POST_MARKET_CARD_AMOUNT_KRW_BY_MARKET.overseas, 'overseas']);
    expect(params[9]).toBe('pending');
    expect(params.slice(10)).toEqual(['NAS:CMCSA', 'v']);
  });

  describe('경계 — 추격률 0 일 때 1주 가격 == 카드 금액은 수량 1 이라 만든다', () => {
    beforeEach(() => mStyle.mockResolvedValue({ limitChasePct: 0 }));

    test('🔴 1주 100,000원 == 카드 금액 → 만든다', async () => {
      setNow(FRI_1602);
      arrangeZones([{ symbol: '000001', lo: 100000, hi: 100000 }]);
      const r = await runPostMarketAnalysis('domestic');
      expect(r).toMatchObject({ signalsCreated: 1, signalsSkipped: 0, unaffordableSkipped: 0 });
      expect((query.mock.calls[0][1] as unknown[])[2]).toBe(100000);
    });

    test('🔴 1주 100,001원 (카드 금액 + 1원) → 만들지 않고 금액 초과로 센다, DB 에는 가지 않는다', async () => {
      setNow(FRI_1602);
      arrangeZones([{ symbol: '000002', lo: 100001, hi: 100001 }]);
      const r = await runPostMarketAnalysis('domestic');
      expect(r).toMatchObject({ signalsCreated: 0, signalsSkipped: 1, unaffordableSkipped: 1, duplicatesSkipped: 0, errors: [] });
      expect(query).not.toHaveBeenCalled();
    });
  });

  describe('기준 가격 = 실행 경로(entry-watcher) 사이징과 같은 값: 카드 price(진입 구간 중간값) × (1 + 지정가 추격률)', () => {
    test('🔴 추격 0.5%: 중간값 99,500 → 지정가 99,997.5 → 1주 → 만든다', async () => {
      setNow(FRI_1602);
      arrangeZones([{ symbol: '000003', lo: 99000, hi: 100000 }]);
      const r = await runPostMarketAnalysis('domestic');
      expect(r).toMatchObject({ signalsCreated: 1, unaffordableSkipped: 0 });
    });

    test('🔴 추격 0.5%: 중간값 99,600 은 예산 이하지만 지정가 100,098 → 수량 0 → 만들지 않는다 (중간값만 보면 놓친다)', async () => {
      setNow(FRI_1602);
      arrangeZones([{ symbol: '000004', lo: 99600, hi: 99600 }]);
      const r = await runPostMarketAnalysis('domestic');
      expect(r).toMatchObject({ signalsCreated: 0, signalsSkipped: 1, unaffordableSkipped: 1 });
      expect(query).not.toHaveBeenCalled();
    });

    test('🔴 종가가 아니라 진입 구간 중간값을 본다 — 종가 312,000 이어도 구간 95,000~97,000 이면 만든다', async () => {
      setNow(FRI_1602);
      arrangeZones([{ symbol: '017670', lo: 95000, hi: 97000 }], 312000);
      const r = await runPostMarketAnalysis('domestic');
      expect(r).toMatchObject({ signalsCreated: 1, unaffordableSkipped: 0 });
    });

    test('🔴 종가가 아니라 진입 구간 중간값을 본다 — 종가 90,000 이어도 구간 105,000~107,000 이면 만들지 않는다', async () => {
      setNow(FRI_1602);
      arrangeZones([{ symbol: '000005', lo: 105000, hi: 107000 }], 90000);
      const r = await runPostMarketAnalysis('domestic');
      expect(r).toMatchObject({ signalsCreated: 0, unaffordableSkipped: 1 });
    });

    test('추격률이 음수·NaN 이면 entry-watcher 처럼 추격하지 않은 가격으로 본다', async () => {
      setNow(FRI_1602);
      for (const bad of [-0.01, Number.NaN]) {
        jest.clearAllMocks();
        mGetPool.mockReturnValue({ query });
        mStyle.mockResolvedValue({ limitChasePct: bad });
        arrangeZones([
          { symbol: '000006', lo: 100000, hi: 100000 },   // 추격 없으면 1주 → 만든다
          { symbol: '000016', lo: 100500, hi: 100500 },   // 추격 없으면 0주 → 제외 (음수 추격을 적용하면 99,495원으로 통과해 버린다)
        ]);
        const r = await runPostMarketAnalysis('domestic');
        expect(r).toMatchObject({ signalsCreated: 1, unaffordableSkipped: 1 });
        expect(insertedSymbols()).toEqual(['000006']);
      }
    });

    test('추격률을 읽지 못하면(예외) 추격 0 으로 판정한다 — 필터가 새 실패를 만들지 않고, 실행 가능한 카드를 잘라내지도 않는다', async () => {
      setNow(FRI_1602);
      mStyle.mockRejectedValue(new Error('style down'));
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      arrangeZones([
        { symbol: '000007', lo: 99600, hi: 99600 },     // 추격 0 이면 1주 → 만든다
        { symbol: '000008', lo: 100001, hi: 100001 },   // 추격과 무관하게 수량 0 → 제외
      ]);
      const r = await runPostMarketAnalysis('domestic');
      expect(r).toMatchObject({ signalsCreated: 1, unaffordableSkipped: 1, errors: [] });
      expect(insertedSymbols()).toEqual(['000007']);
    });
  });

  test('🔴 2026-10-19 16:47 재현 — 5장 중 1주 가격이 10만 원을 넘는 3장(009540·032830·068270)은 만들지 않고 나머지 2장은 만든다', async () => {
    setNow('2026-10-19T07:47:00Z');
    arrangeZones([
      { symbol: '009540', lo: 255000, hi: 275000 },
      { symbol: '042660', lo: 62000, hi: 65000 },
      { symbol: '032830', lo: 235000, hi: 245000 },
      { symbol: '055550', lo: 92000, hi: 94000 },
      { symbol: '068270', lo: 195000, hi: 197000 },
    ]);
    const r = await runPostMarketAnalysis('domestic');
    expect(r).toMatchObject({ signalsCreated: 2, signalsSkipped: 3, unaffordableSkipped: 3, duplicatesSkipped: 0, errors: [] });
    expect(insertedSymbols()).toEqual(['042660', '055550']);   // 앞의 제외가 뒤 후보 처리를 멈추지 않는다
    // 종목별 로그 한 줄 — 종목·1주 지정가·구간 중간값·카드 금액
    const excluded = logs().filter(l => l.includes('금액 초과'));
    expect(excluded.filter(l => l.includes('💸'))).toHaveLength(3);
    expect(excluded.find(l => l.includes('009540'))).toEqual(expect.stringContaining('266325'));   // 265,000 × 1.005
    expect(excluded.find(l => l.includes('009540'))).toEqual(expect.stringContaining('265000'));
    expect(excluded.find(l => l.includes('009540'))).toEqual(expect.stringContaining('100000'));
    expect(excluded.find(l => l.includes('032830'))).toEqual(expect.stringContaining('241200'));   // 240,000 × 1.005
    expect(excluded.find(l => l.includes('068270'))).toEqual(expect.stringContaining('196980'));   // 196,000 × 1.005
    // 요약 줄에도 건수
    expect(logs().find(l => l.includes('[post-market] market=domestic'))).toEqual(expect.stringContaining('금액 초과 3'));
  });

  test('다른 필터(SKIP·신뢰도 미달)가 먼저다 — 그쪽에서 걸린 비싼 종목은 금액 초과로 세지 않는다', async () => {
    setNow(FRI_1602);
    arrangeZones([
      { symbol: '000009', lo: 300000, hi: 300000, action: 'SKIP' },
      { symbol: '000010', lo: 300000, hi: 300000, confidence: 50 },
    ]);
    const r = await runPostMarketAnalysis('domestic');
    expect(r).toMatchObject({ signalsCreated: 0, signalsSkipped: 2, unaffordableSkipped: 0 });
  });

  test.each([
    ['NaN', Number.NaN],
    ['0', 0],
    ['음수', -5],
    ['undefined', undefined as unknown as number],
  ])('cardBuysZeroShares: 가격 %s 이면 수량 0 으로 판정하지 않는다(사이징이 수량을 정하지 않는 값)', (_n, price) => {
    expect(cardBuysZeroShares(price, PROD_CHASE).zero).toBe(false);
    expect(cardBuysZeroShares(price, 0).zero).toBe(false);
  });

  test('cardBuysZeroShares: 경계값을 sizeOrderQuantity 와 같은 방식으로 가른다', () => {
    expect(cardBuysZeroShares(100000, 0)).toEqual({ zero: false, chasedPrice: 100000 });
    expect(cardBuysZeroShares(100001, 0)).toEqual({ zero: true, chasedPrice: 100001 });
    expect(cardBuysZeroShares(99500, PROD_CHASE).zero).toBe(false);
    expect(cardBuysZeroShares(99600, PROD_CHASE).zero).toBe(true);
  });

  test.each([
    ['가격 0', 0, 0],
    ['가격 음수', -5, -5],
  ])('%s 이면 이 필터는 판정하지 않는다(기존 동작 그대로 — INSERT 경로로 간다)', async (_n, lo, hi) => {
    setNow(FRI_1602);
    arrangeZones([{ symbol: '000011', lo, hi }]);
    const r = await runPostMarketAnalysis('domestic');
    expect(r.unaffordableSkipped).toBe(0);
    expect(query).toHaveBeenCalledTimes(1);
  });

  test('진입 구간이 없으면 기존 필터가 건너뛴다(금액 초과로 세지 않음)', async () => {
    setNow(FRI_1602);
    arrangeZones([{ symbol: '000012', lo: 1, hi: 1 }]);
    mLlm.mockResolvedValue(JSON.stringify({ decisions: [{ symbol: '000012', action: 'BUY', target_pct: 3, stop_pct: 1, confidence: 80 }] }));
    const r = await runPostMarketAnalysis('domestic');
    expect(r).toMatchObject({ signalsCreated: 0, signalsSkipped: 1, unaffordableSkipped: 0 });
  });

  test('살 수 있는 카드의 중복 판정은 그대로다 — 금액 초과 카드는 DB 에 가지 않으므로 중복으로도 세지 않는다', async () => {
    setNow(FRI_1602);
    arrangeZones([
      { symbol: '000013', lo: 50000, hi: 50000 },
      { symbol: '000014', lo: 500000, hi: 500000 },
    ]);
    query.mockReset();
    query.mockResolvedValueOnce([{ affectedRows: 0 }, undefined]);
    const r = await runPostMarketAnalysis('domestic');
    expect(r).toMatchObject({ signalsCreated: 0, signalsSkipped: 2, duplicatesSkipped: 1, unaffordableSkipped: 1 });
    expect(query).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('T-106 뉴스 0건 연속 감시 — 국내 검색 채널 호출 지점', () => {
  const mHealth = recordRetrievalNewsOutcome as jest.Mock;

  test('🔴 retrieveRagContext 직후 (market, ragCtx) 로 기록 — 카드 생성 흐름 그대로', async () => {
    setNow(FRI_1602);
    arrangeFlow(['005380'], [{ affectedRows: 1 }]);
    const ctx = { pastSignals: [], recentNews: [], macroContext: [], totalChars: 0, elapsedMs: 1, errors: [] };
    mRag.mockResolvedValue(ctx);
    const r = await runPostMarketAnalysis('domestic');
    expect(mHealth).toHaveBeenCalledTimes(1);
    expect(mHealth).toHaveBeenCalledWith('domestic', ctx);
    expect(mHealth.mock.invocationCallOrder[0]).toBeGreaterThan(mRag.mock.invocationCallOrder[0]);
    expect(mHealth.mock.invocationCallOrder[0]).toBeLessThan(mLlm.mock.invocationCallOrder[0]);
    expect(r.signalsCreated).toBe(1);
    expect(r.errors).toEqual([]);
  });

  test('🔴 기록이 던져도(이론상 없음) 분석은 그대로 — rag_fail 을 남기지 않고 LLM·INSERT 진행', async () => {
    setNow(FRI_1602);
    arrangeFlow(['005380'], [{ affectedRows: 1 }]);
    mHealth.mockRejectedValueOnce(new Error('db down'));
    const r = await runPostMarketAnalysis('domestic');
    expect(r.signalsCreated).toBe(1);
    expect(r.errors).toEqual([]);
    expect(mLlm).toHaveBeenCalledTimes(1);
  });

  test('RAG 가 던지면 기록하지 않는다(조회 장애 — 기존 rag_fail 소관)', async () => {
    setNow(FRI_1602);
    arrangeFlow(['005380'], [{ affectedRows: 1 }]);
    mRag.mockRejectedValue(new Error('m4 down'));
    const r = await runPostMarketAnalysis('domestic');
    expect(mHealth).not.toHaveBeenCalled();
    expect(r.errors).toEqual(['rag_fail:m4 down']);
  });

  test('주말 스킵에서는 기록하지 않는다', async () => {
    setNow(SAT_1602);
    await runPostMarketAnalysis('domestic');
    expect(mHealth).not.toHaveBeenCalled();
  });

  test('정적 — 장중 ai-filter-stage1 은 감시 기록을 부르지 않는다', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('node:path') as typeof import('node:path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'ai-filter-stage1.ts'), 'utf8');
    expect(src).not.toMatch(/news-health|recordNewsOutcome|recordRetrievalNewsOutcome/);
  });
});
