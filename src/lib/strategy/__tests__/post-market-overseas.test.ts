/**
 * T-062 — post-market 해외(미국) 카드. 스위치(키 없음 = 꺼짐)·꺼짐 시 해외 호출 0·세션/DST·환율·블랙아웃·사전 금액 필터·
 * S-1 엄격 검증(schemaRejected/zoneRejected 분리)·S-2 구조화된 AI 실패·S-3 트랜잭션·G5 데이터 계약·G5-b reasoning 문구.
 */
import type { DailyCandidate } from '../rules/eod-high-close';
import { runPostMarketAnalysis } from '../post-market-engine';
import {
  runPostMarketOverseas, checkOverseasDecision, parseOverseasAiResponse, formatKrwInt, formatFxRate, krwBasisNote,
  POST_MARKET_OVERSEAS_SWITCH_KEY, ZONE_MIN_RATIO, ZONE_MAX_RATIO, ZONE_MAX_WIDTH_RATIO, MIN_CLOSE_USD_FOR_SCALE,
} from '../post-market-overseas';
import { getPool } from '@/lib/db';
import { kis } from '@/lib/exchanges/kis';
import { isOverseasEnabled } from '@/lib/exchanges/market-flags';
import { getUsdKrwRate } from '@/lib/exchanges/fx';
import { runLlm } from '@/lib/llm/provider';
import { retrieveRagContext } from '@/lib/rag/retrieval';
import { recordRetrievalNewsOutcome } from '@/lib/rag/news-health';
import { loadUsTargetSymbols, findMissingTables } from '@/lib/data/us-data-db';
import { eodHighClose } from '../rules/eod-high-close';
import { insideBar } from '../rules/inside-bar';
import { oversoldBounceDaily } from '../rules/oversold-bounce-daily';
import { getStyleConfig } from '../style';
import { getCandles as domesticGetCandles } from '@/lib/exchanges/kis-domestic';
import { evaluateValidationGate } from '@/lib/safety/validation-gate';
import { overseasLimitUnitUsd } from '@/lib/signals/signal-cash-gate';

jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));
jest.mock('@/lib/exchanges/kis', () => ({ kis: { getCandles: jest.fn() } }));
jest.mock('@/lib/exchanges/kis-domestic', () => ({ getCandles: jest.fn() }));
jest.mock('@/lib/exchanges/market-flags', () => ({ isOverseasEnabled: jest.fn() }));
jest.mock('@/lib/exchanges/fx', () => ({ getUsdKrwRate: jest.fn() }));
jest.mock('@/lib/llm/provider', () => ({ runLlm: jest.fn() }));
jest.mock('@/lib/rag/retrieval', () => ({ retrieveRagContext: jest.fn() }));
// T-106 — 뉴스 0건 연속 감시 기록은 이 파일에서 목(호출 지점·인자·흐름 무영향만 본다; 세는 규칙은 rag/__tests__/news-health.test.ts).
jest.mock('@/lib/rag/news-health', () => ({ recordRetrievalNewsOutcome: jest.fn(async () => null) }));
jest.mock('@/lib/rag/format', () => ({ formatRagSection: jest.fn(() => '### 뉴스\n- WSJ 헤드라인') }));
jest.mock('@/lib/data/us-data-db', () => ({ loadUsTargetSymbols: jest.fn(), findMissingTables: jest.fn() }));
jest.mock('../rules/eod-high-close', () => ({ eodHighClose: jest.fn() }));
jest.mock('../rules/inside-bar', () => ({ insideBar: jest.fn() }));
jest.mock('../rules/oversold-bounce-daily', () => ({ oversoldBounceDaily: jest.fn() }));
jest.mock('../style', () => ({ getStyleConfig: jest.fn() }));
jest.mock('../universe', () => ({ getAlwaysIncludeSymbols: jest.fn(), getUniverseSnapshot: jest.fn() }));
// T-072 G2 — 이 파일은 해외 카드 생성 기계(스위치·휴장·환율·트랜잭션·필터)를 본다. 관문 판정은 '검증됨'으로 고정해 카드가 기존처럼
//   `pending` 으로 들어가는 경로를 그대로 시험한다(아래 풀 목은 예상 밖 SQL 을 던진다 — 판정 조회가 그 목을 지나지 않게).
//   막히는 경우(skipped + 커밋 뒤 가상 체결)는 post-market-validation-gate.test.ts 가 실제 관문으로 본다.
jest.mock('@/lib/safety/validation-gate', () => ({
  ...jest.requireActual('@/lib/safety/validation-gate'),
  evaluateValidationGate: jest.fn(async ({ strategyId }: { strategyId: string }) => ({ allowed: true, kind: 'validated', strategyId, status: 'backtested' })),
}));

const mGetPool = getPool as jest.Mock;
const mCandles = kis.getCandles as jest.Mock;
const mDomCandles = domesticGetCandles as jest.Mock;
const mOvsEnabled = isOverseasEnabled as jest.Mock;
const mFx = getUsdKrwRate as jest.Mock;
const mLlm = runLlm as jest.Mock;
const mRag = retrieveRagContext as jest.Mock;
const mTargets = loadUsTargetSymbols as jest.Mock;
const mMissing = findMissingTables as jest.Mock;
const mEod = eodHighClose as jest.Mock;
const mInside = insideBar as jest.Mock;
const mOversold = oversoldBounceDaily as jest.Mock;
const mStyle = getStyleConfig as jest.Mock;

function setNow(iso: string) {
  jest.useFakeTimers({
    now: new Date(iso),
    doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'clearImmediate', 'queueMicrotask', 'performance'],
  });
}
/** 수 2026-10-21 08:00 KST = 화 10-20 19:00 EDT → D0 10-20, S1 10-21 */
const WED_0800_KST = '2026-10-20T23:00:00Z';

const CLOSED = [
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07',
  '2026-11-26', '2026-11-27', '2026-12-24', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18', '2027-07-05', '2027-09-06',
  '2027-11-25', '2027-11-26', '2027-12-23', '2027-12-24',
];

/** DB 목 상태 — SQL 로 갈라 답한다. */
interface DbState {
  switchRows: unknown[] | Error;
  holidays: string[] | Error;
  fxRow: Record<string, unknown> | null | Error;
  earningsRows: unknown[] | Error;
  insertResults: Array<{ affectedRows: number; insertId?: number } | Error>;
  /** T-072 G2 — 실제 관문을 쓰는 시험만: strategies.validation_status (없음 = 행 없음, Error = 조회 예외) */
  strategies: Record<string, string | Error>;
  /** T-072 G2 — 풀(트랜잭션 밖)로 들어온 paper_fills INSERT 파라미터 */
  paperFills: unknown[][];
  paperThrows: Error | null;
}
let db: DbState;
let query: jest.Mock;
let conn: { beginTransaction: jest.Mock; query: jest.Mock; commit: jest.Mock; rollback: jest.Mock; release: jest.Mock; destroy: jest.Mock };
let getConnection: jest.Mock;
let R = 1330;

function wireDb() {
  query = jest.fn(async (sql: string, params?: unknown[]) => {
    const pick = <T>(v: T | Error): T => { if (v instanceof Error) throw v; return v; };
    if (sql.includes('FROM system_config')) return [pick(db.switchRows), undefined];
    if (sql.includes('FROM market_holidays')) {
      const years = (params?.[0] as number[]) ?? [];
      return [pick(db.holidays).filter(d => years.includes(Number(d.slice(0, 4)))).map(d => ({ d })), undefined];
    }
    if (sql.includes('FROM fx_rates')) { const r = pick(db.fxRow); return [r ? [r] : [], undefined]; }
    if (sql.includes('FROM us_earnings_events')) return [pick(db.earningsRows), undefined];
    // T-072 G2 — 관문 판정 조회(풀, 트랜잭션 연결 아님)·커밋 뒤 가상 체결 기록(풀). 기존 시험은 관문 목('검증됨')이라 여기 오지 않는다.
    if (sql.includes('SELECT validation_status FROM strategies')) {
      const v = db.strategies[String(params?.[0])];
      if (v instanceof Error) throw v;
      return [v === undefined ? [] : [{ validation_status: v }], undefined];
    }
    if (sql.includes('INSERT INTO paper_fills')) {
      if (db.paperThrows) throw db.paperThrows;
      db.paperFills.push(params ?? []);
      return [{ affectedRows: 1, insertId: 900 + db.paperFills.length }, undefined];
    }
    throw new Error(`예상하지 못한 SQL: ${sql.slice(0, 60)}`);
  });
  let i = 0;
  conn = {
    beginTransaction: jest.fn(async () => undefined),
    query: jest.fn(async () => {
      const r = db.insertResults[i++] ?? { affectedRows: 1 };
      if (r instanceof Error) throw r;
      return [r, undefined];
    }),
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
    release: jest.fn(),
    destroy: jest.fn(),
  };
  getConnection = jest.fn(async () => conn);
  mGetPool.mockReturnValue({ query, getConnection });
}

const candleTs = (dateEt: string) => Date.parse(`${dateEt}T00:00:00Z`);   // kis-overseas 의 xymd → ts 규칙
/** USD 가격으로 후보를 만든다(필드는 어댑터처럼 KRW 환산값). */
function candUsd(symbol: string, closeUsd: number, over: Partial<DailyCandidate> = {}): DailyCandidate {
  return {
    symbol, pattern: 'eod-high-close',
    open: (closeUsd - 0.3) * R, high: (closeUsd + 0.2) * R, low: (closeUsd - 0.4) * R, close: closeUsd * R,
    volume: 1_000_000, volRatio: 1.62, rsi14: 57.3, ma5: (closeUsd - 0.1) * R, ma20: (closeUsd - 0.8) * R,
    reasoning: `종가 고가권 마감 MA5=${Math.round((closeUsd - 0.1) * R)}`, ...over,
  };
}
const buy = (symbol: string, lo: unknown, hi: unknown, over: Record<string, unknown> = {}) => ({
  symbol, action: 'BUY', entry_zone: { lo, hi }, target_pct: 4, stop_pct: 3, holding_days: 3, confidence: 74, reasoning: '실적 시즌 전 눌림', ...over,
});

/** 정상 경로 준비. closes: 종목 → USD 종가. lastDate: 종목 → 마지막 봉 ET 날짜(기본 D0). */
function arrange(opts: {
  closes: Record<string, number>;
  decisions?: unknown[];
  llmRaw?: unknown;
  d0?: string;
  lastDate?: Record<string, string>;
}) {
  const d0 = opts.d0 ?? '2026-10-20';
  const symbols = Object.keys(opts.closes);
  mTargets.mockResolvedValue({ symbols, errors: [] });
  mCandles.mockImplementation(async (s: string) => [{ ts: candleTs(opts.lastDate?.[s] ?? d0), open: 1, high: 1, low: 1, close: (opts.closes[s] ?? 100) * R, volume: 1 }]);
  mEod.mockImplementation((s: string) => (opts.closes[s] != null ? candUsd(s, opts.closes[s]) : null));
  mLlm.mockResolvedValue(opts.llmRaw ?? JSON.stringify({ decisions: opts.decisions ?? [] }));
}
const insertParams = () => conn.query.mock.calls.map(c => c[1] as unknown[]);
const insertedSymbols = () => insertParams().map(p => p[1]);
const offIoCalls = () => ({
  candles: mCandles.mock.calls.length, domCandles: mDomCandles.mock.calls.length, llm: mLlm.mock.calls.length,
  rag: mRag.mock.calls.length, targets: mTargets.mock.calls.length, fx: mFx.mock.calls.length,
  getConnection: getConnection.mock.calls.length, earnings: mMissing.mock.calls.length, style: mStyle.mock.calls.length,
  marketFlag: mOvsEnabled.mock.calls.length,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  R = 1330;
  db = {
    switchRows: [{ value: 'true' }],
    holidays: CLOSED,
    fxRow: { rate: '1330.0000', age_sec: 120, fetched_kst: '2026-10-21T07:58:00' },
    earningsRows: [],
    insertResults: [],
    strategies: {},
    paperFills: [],
    paperThrows: null,
  };
  wireDb();
  mOvsEnabled.mockReturnValue(true);
  mFx.mockImplementation(async () => R);
  mRag.mockResolvedValue({ totalChars: 10 });
  mMissing.mockResolvedValue([]);
  mInside.mockReturnValue(null);
  mOversold.mockReturnValue(null);
  mStyle.mockResolvedValue({ limitChasePct: 0.005 });
  setNow(WED_0800_KST);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('🔴 스위치 post_market_overseas_enabled — 키 없음 = 꺼짐, 정확히 JSON true 만 켜짐', () => {
  test.each([
    ['키 없음', [] as unknown[], 'missing'],
    ['false', [{ value: 'false' }], 'value'],
    ['문자열 "true"', [{ value: '"true"' }], 'value'],
    ['0', [{ value: '0' }], 'value'],
    ['null', [{ value: 'null' }], 'value'],
    ['파싱 불가', [{ value: 'yes' }], 'value'],
  ])('%s → 꺼짐: 스위치 SELECT 1회 외 해외 경로 호출 0', async (_n, rows, source) => {
    db.switchRows = rows;
    arrange({ closes: { 'NAS:CMCSA': 27.4 }, decisions: [buy('NAS:CMCSA', 27.2, 27.6)] });
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ market: 'overseas', ok: true, status: 'ok', skipped: 'overseas_disabled', switchSource: source, signalsCreated: 0, errors: [] });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1]).toEqual([POST_MARKET_OVERSEAS_SWITCH_KEY]);
    expect(offIoCalls()).toEqual({ candles: 0, domCandles: 0, llm: 0, rag: 0, targets: 0, fx: 0, getConnection: 0, earnings: 0, style: 0, marketFlag: 0 });
  });

  test('읽기 오류 → 꺼짐(read_error), 해외 경로 호출 0', async () => {
    db.switchRows = new Error('ECONNREFUSED');
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ skipped: 'overseas_disabled', switchSource: 'read_error', ok: true });
    expect(offIoCalls()).toEqual({ candles: 0, domCandles: 0, llm: 0, rag: 0, targets: 0, fx: 0, getConnection: 0, earnings: 0, style: 0, marketFlag: 0 });
  });

  test('getPool 자체가 던져도 꺼짐(read_error)', async () => {
    mGetPool.mockImplementation(() => { throw new Error('no db'); });
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ skipped: 'overseas_disabled', switchSource: 'read_error' });
  });

  test('JSON true → 켜짐: 진행한다(시세·LLM 호출)', async () => {
    arrange({ closes: { 'NAS:CMCSA': 27.4 }, decisions: [buy('NAS:CMCSA', 27.2, 27.6)] });
    const r = await runPostMarketOverseas();
    expect(r.skipped).toBeUndefined();
    expect(r.switchSource).toBe('value');
    expect(mCandles).toHaveBeenCalledTimes(1);
    expect(mLlm).toHaveBeenCalledTimes(1);
  });

  test('엔진 진입점 runPostMarketAnalysis("overseas") 도 같은 경로 — 꺼짐이면 국내 어댑터·LLM 0회', async () => {
    db.switchRows = [];
    const r = await runPostMarketAnalysis('overseas');
    expect(r).toMatchObject({ market: 'overseas', skipped: 'overseas_disabled' });
    expect(mDomCandles).not.toHaveBeenCalled();
    expect(mLlm).not.toHaveBeenCalled();
  });

  test('KIS_OVERSEAS_ENABLED 꺼짐 → overseas_market_disabled (스위치 외 I/O 없음)', async () => {
    mOvsEnabled.mockReturnValue(false);
    const r = await runPostMarketOverseas();
    expect(r.skipped).toBe('overseas_market_disabled');
    expect(query).toHaveBeenCalledTimes(1);
    expect(mFx).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('정상 경로 — G5 데이터 계약·G5-b 문구·INSERT', () => {
  test('🔴 CMCSA $27.20~$27.60 @1330 → KRW 36176~36708, 카드 1장, 트랜잭션 커밋', async () => {
    arrange({ closes: { 'NAS:CMCSA': 27.4 }, decisions: [buy('NAS:CMCSA', 27.2, 27.6)] });
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({
      market: 'overseas', ok: true, status: 'ok', signalsCreated: 1, signalsSkipped: 0, duplicatesSkipped: 0,
      validFrom: '2026-10-21 22:30:00', sessionEt: { d0: '2026-10-20', s1: '2026-10-21' },
      symbolsEvaluated: 1, candidatesFound: 1, llmCandidates: 1, schemaRejected: 0, zoneRejected: 0,
      staleCandleSkipped: 0, blackoutSkipped: 0, prefilterUnaffordable: 0, unaffordableSkipped: 0, errors: [],
    });
    expect(conn.beginTransaction).toHaveBeenCalledTimes(1);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);

    const [sql, p] = conn.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/INSERT INTO signals/);
    expect(p[0]).toBe('eod-high-close-v1');
    expect(p[1]).toBe('NAS:CMCSA');
    expect(p[2]).toBe(36442);                                       // (36176 + 36708) / 2 — KRW 환산 카드 가격
    expect(p[3]).toBe(100000);                                      // amount_krw — 해외도 100,000 (D-6)
    expect(p[4]).toBe(
      '[다음 미국장 시나리오] 종가 고가권 마감 MA5=36309\n' +
      '※ 위 규칙 근거의 가격 숫자(MA·볼린저·전저점 등)는 원화 환산값입니다 (환율 1,330원, 기준 10-21)\n' +
      '진입구간: $27.20~$27.60 (≈ 36,176~36,708원) | 목표: +4% | 손절: -3%\n' +
      '실적 시즌 전 눌림',
    );
    expect(p[6]).toBe('2026-10-22 05:00:00');                       // expires_at = S1 16:00 EDT (KST)
    expect(p[7]).toBe('2026-10-21 22:30:00');                       // valid_from = S1 09:30 EDT (KST)
    expect(p[8]).toBe('overseas');                                  // market
    expect(p[9]).toBe('pending');                                   // T-072 — status 자리표시자(맨 뒤 열) · 검증된 전략이면 기존과 같은 값
    expect(p.slice(10)).toEqual(['NAS:CMCSA', '2026-10-21 22:30:00']);

    const ind = JSON.parse(String(p[5]));
    expect(ind).toEqual({
      pattern: 'eod-high-close',
      close: 27.4 * 1330, volRatio: 1.62, rsi14: 57.3, ma5: (27.4 - 0.1) * 1330, ma20: (27.4 - 0.8) * 1330,
      ai: {
        confidence: 74, reasoning_short: '실적 시즌 전 눌림',
        scenario: {
          grade: 'B+',
          entry: { trigger: 'price_zone', price_zone: '36176~36708' },
          exit: { target_pct: 4, stop_pct: 3, holding_days: '3일', holding_deadline: '2026-10-24' },
        },
      },
      currency: 'KRW',
      close_usd: 27.4,
      price_zone_usd: { lo: 27.2, hi: 27.6 },
      fx: { pair: 'USD_KRW', rate: 1330, asOf: '2026-10-21T07:58:00+09:00', source: 'fx_rates' },
      earnings: { status: 'none', nextConfirmed: null, blackout_days: 5, observedAt: '2026-10-21T08:00:00+09:00' },
    });
    // G5: KRW 구간은 같은 rate 로 USD 에서 만든다
    expect(ind.ai.scenario.entry.price_zone).toBe(`${Math.round(27.2 * 1330)}~${Math.round(27.6 * 1330)}`);
    // entry-watcher 가 읽는 형식(쉼표 없음)
    expect(ind.ai.scenario.entry.price_zone).toMatch(/^\d+~\d+$/);
  });

  test('프롬프트: "미국주식"·USD toFixed(2)·환율과 관측 시각·다음 정규장 날짜, 국내 문구 없음', async () => {
    arrange({ closes: { 'NAS:CMCSA': 27.4 }, decisions: [] });
    await runPostMarketOverseas();
    const prompt = String(mLlm.mock.calls[0][0]);
    expect(prompt).toContain('당신은 미국주식 다음 정규장 진입 시나리오를 분석하는 전문 트레이더입니다.');
    expect(prompt).toContain('미국 정규장(2026-10-20, 미국 동부시간) 마감 후');
    expect(prompt).toContain('다음 미국 정규장(2026-10-21, 09:30~16:00 ET)');
    expect(prompt).toContain('1 USD = 1330.00 KRW(fx_rates, 관측 2026-10-21T07:58:00+09:00)');
    expect(prompt).toContain('- 2026-10-20 일봉(USD): 시=$27.10 고=$27.60 저=$27.00 종=$27.40 거래량비율=1.62x');
    expect(prompt).toContain('- RSI14=57.3 MA5=$27.30 MA20=$26.60');
    expect(prompt).toContain('패턴 근거(괄호·숫자 가격은 원화 환산값): 종가 고가권 마감 MA5=36309');
    expect(prompt).toContain('entry_zone 은 반드시 미국 달러(USD, 소수 2자리)로 쓰세요');
    expect(prompt).toContain('### 뉴스\n- WSJ 헤드라인');
    expect(prompt).not.toContain('국내주식');
    expect(prompt).not.toContain('종=36442');
    expect(mLlm.mock.calls[0][1]).toEqual({ timeoutMs: 90000, responseFormat: 'json' });
    expect(mRag.mock.calls[0][1]).toBe('overseas');
  });

  test('대상 종목은 loadUsTargetSymbols(보유 ∪ 즐겨찾기 ∪ 정적 50) — 각 종목 kis.getCandles("1d", 60), 출처 오류는 errors 에', async () => {
    arrange({ closes: { 'NAS:MU': 200, 'NYS:BAC': 47.1, 'NAS:CMCSA': 27.4 } });
    mTargets.mockResolvedValue({ symbols: ['NAS:CMCSA', 'NAS:MU', 'NYS:BAC'], errors: ['position_state'] });
    const r = await runPostMarketOverseas();
    expect(mTargets).toHaveBeenCalledWith(expect.objectContaining({ query }));
    expect(mCandles.mock.calls).toEqual([['NAS:CMCSA', '1d', 60], ['NAS:MU', '1d', 60], ['NYS:BAC', '1d', 60]]);
    expect(mDomCandles).not.toHaveBeenCalled();                    // D-1: 국내 어댑터 직결 안 씀
    expect(r.errors).toContain('symbol_source_fail:position_state');
  });

  test('대상 종목 0 → no_symbols, 시세 0', async () => {
    mTargets.mockResolvedValue({ symbols: [], errors: [] });
    const r = await runPostMarketOverseas();
    expect(r.errors).toEqual(['no_symbols']);
    expect(mCandles).not.toHaveBeenCalled();
  });

  test('환산 왕복: R=1327.84, $27.13~$27.57 → 36024~36609, 카드 가격은 구간 안, KRW÷R ≈ USD(±0.5원)', async () => {
    R = 1327.84;
    db.fxRow = { rate: '1327.8400', age_sec: 30, fetched_kst: '2026-10-21T07:59:30' };
    arrange({ closes: { 'NAS:CMCSA': 27.35 }, decisions: [buy('NAS:CMCSA', 27.13, 27.57)] });
    await runPostMarketOverseas();
    const p = insertParams()[0];
    const ind = JSON.parse(String(p[5]));
    expect(ind.ai.scenario.entry.price_zone).toBe('36024~36609');
    expect(ind.price_zone_usd).toEqual({ lo: 27.13, hi: 27.57 });
    expect(ind.fx.rate).toBe(1327.84);
    expect(p[2]).toBe(36316.5);
    for (const [krw, u] of [[36024, 27.13], [36609, 27.57]]) expect(Math.abs(krw / 1327.84 - u)).toBeLessThanOrEqual(0.5 / 1327.84 + 1e-12);
    expect(String(p[4])).toContain('진입구간: $27.13~$27.57 (≈ 36,024~36,609원)');
    // 원화 환산 안내의 환율·기준일 = indicators.fx 와 같은 값
    expect(String(p[4]).split('\n')[1]).toBe('※ 위 규칙 근거의 가격 숫자(MA·볼린저·전저점 등)는 원화 환산값입니다 (환율 1,327.84원, 기준 10-21)');
    expect(ind.fx.asOf.slice(5, 10)).toBe('10-21');
  });

  test('AI 소수 3자리 이상 → 2자리 반올림해 저장(G5 "소수 2자리")', async () => {
    arrange({ closes: { 'NAS:CMCSA': 27.4 }, decisions: [buy('NAS:CMCSA', 27.204, 27.596)] });
    await runPostMarketOverseas();
    const ind = JSON.parse(String(insertParams()[0][5]));
    expect(ind.price_zone_usd).toEqual({ lo: 27.2, hi: 27.6 });
    expect(ind.ai.scenario.entry.price_zone).toBe('36176~36708');
  });

  test('같은 종목 결정이 두 번 오면 첫 결정만 본다', async () => {
    arrange({ closes: { 'NAS:CMCSA': 27.4 }, decisions: [buy('NAS:CMCSA', 27.2, 27.6), buy('NAS:CMCSA', 27.0, 27.3)] });
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ signalsCreated: 1, signalsSkipped: 1 });
    expect(conn.query).toHaveBeenCalledTimes(1);
  });

  test('후보에 없는 종목·SKIP·신뢰도 59 → 건너뜀(schema 아님)', async () => {
    arrange({
      closes: { 'NAS:CMCSA': 27.4, 'NYS:BAC': 47.1 },
      decisions: [buy('NAS:AAPL', 230, 232), { symbol: 'NAS:CMCSA', action: 'SKIP' }, buy('NYS:BAC', 46.9, 47.3, { confidence: 59 })],
    });
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ signalsCreated: 0, signalsSkipped: 3, schemaRejected: 0, zoneRejected: 0, ok: true });
    expect(getConnection).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('세션·시각 (DST 경계 2건·주말·휴장·연말)', () => {
  test.each([
    ['🔴 DST 종료 주: 토 10-31 08:00 KST(금 EDT) → 월 11-02 EST', '2026-10-30T23:00:00Z', '2026-10-30', '2026-11-02', '2026-11-02 23:30:00', '2026-11-03 06:00:00'],
    ['🔴 DST 시작 주: 토 2027-03-13 08:00 KST(금 EST) → 월 03-15 EDT', '2027-03-12T23:00:00Z', '2027-03-12', '2027-03-15', '2027-03-15 22:30:00', '2027-03-16 05:00:00'],
    ['금요일 장 마감 뒤(토 08:00 KST) → 월', '2026-10-23T23:00:00Z', '2026-10-23', '2026-10-26', '2026-10-26 22:30:00', '2026-10-27 05:00:00'],
    ['휴장 전날(11-25 수) → 추수감사절·반일장 건너뛰고 월 11-30', '2026-11-25T23:00:00Z', '2026-11-25', '2026-11-30', '2026-11-30 23:30:00', '2026-12-01 06:00:00'],
    ['연말(12-31 목) → 2027-01-04', '2026-12-31T23:00:00Z', '2026-12-31', '2027-01-04', '2027-01-04 23:30:00', '2027-01-05 06:00:00'],
  ])('%s', async (_n, now, d0, s1, validFrom, expiresAt) => {
    setNow(now as string);
    arrange({ closes: { 'NAS:CMCSA': 27.4 }, decisions: [buy('NAS:CMCSA', 27.2, 27.6)], d0: d0 as string });
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ sessionEt: { d0, s1 }, validFrom, signalsCreated: 1 });
    const p = insertParams()[0];
    expect([p[6], p[7]]).toEqual([expiresAt, validFrom]);
  });

  test.each([
    ['일 08:00 KST (ET 토)', '2026-10-24T23:00:00Z'],
    ['월 08:00 KST (ET 일)', '2026-10-25T23:00:00Z'],
    ['추수감사절 다음 날 08:00 KST (ET 목 휴장)', '2026-11-26T23:00:00Z'],
    ['반일장 다음 날 08:00 KST (ET 금 11-27, 닫힘 취급)', '2026-11-27T23:00:00Z'],
  ])('%s → no_new_session: 환율·종목·시세·LLM 0', async (_n, now) => {
    setNow(now as string);
    arrange({ closes: { 'NAS:CMCSA': 27.4 } });
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ skipped: 'no_new_session', ok: true });
    expect(mFx).not.toHaveBeenCalled();
    expect(mTargets).not.toHaveBeenCalled();
    expect(mCandles).not.toHaveBeenCalled();
    expect(mLlm).not.toHaveBeenCalled();
  });

  test('정규장 진행 중 호출 → us_session_open', async () => {
    setNow('2026-10-21T14:00:00Z');   // 10:00 EDT
    const r = await runPostMarketOverseas();
    expect(r.skipped).toBe('us_session_open');
    expect(mCandles).not.toHaveBeenCalled();
  });

  test.each([
    ['DB 오류', () => { db.holidays = new Error('ECONNRESET'); }],
    ['그해 휴장 행 0', () => { db.holidays = CLOSED.filter(d => !d.startsWith('2026')); }],
  ])('🔴 휴장 표 %s → holidays_unknown(만들지 않음), 시세·LLM 0', async (_n, prep) => {
    prep();
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ skipped: 'holidays_unknown', ok: false, status: 'data_unknown' });
    expect(r.errors[0]).toMatch(/^holidays_unknown:/);
    expect(mCandles).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('🔴 S-4 stale 가드 — 마지막 일봉 UTC 날짜 = D0 인 종목만', () => {
  test('마지막 봉이 D0 전날이면 제외(staleCandleSkipped), 규칙을 부르지 않는다', async () => {
    arrange({ closes: { 'NAS:CMCSA': 27.4, 'NYS:BAC': 47.1 }, lastDate: { 'NYS:BAC': '2026-10-19' }, decisions: [buy('NAS:CMCSA', 27.2, 27.6)] });
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ staleCandleSkipped: 1, candidatesFound: 1, signalsCreated: 1 });
    expect(mEod.mock.calls.map(c => c[0])).toEqual(['NAS:CMCSA']);
  });
  test.each([
    ['UTC 자정(어댑터 형식)', Date.parse('2026-10-20T00:00:00Z'), 0],
    ['같은 UTC 날짜 23:59', Date.parse('2026-10-20T23:59:00Z'), 0],
    ['전날 UTC 23:59 (ET 로 바꾸면 같은 날처럼 보일 수 있는 값)', Date.parse('2026-10-19T23:59:00Z'), 1],
    ['다음 날 UTC 00:00', Date.parse('2026-10-21T00:00:00Z'), 1],
  ])('%s → stale %s', async (_n, ts, stale) => {
    arrange({ closes: { 'NAS:CMCSA': 27.4 } });
    mCandles.mockResolvedValue([{ ts, open: 1, high: 1, low: 1, close: 27.4 * R, volume: 1 }]);
    const r = await runPostMarketOverseas();
    expect(r.staleCandleSkipped).toBe(stale);
  });
  test('빈 일봉 → stale, 일봉 예외 → candle_fail 기록', async () => {
    arrange({ closes: { 'NAS:CMCSA': 27.4, 'NYS:BAC': 47.1 } });
    mCandles.mockImplementation(async (s: string) => { if (s === 'NYS:BAC') throw new Error('EGW00201'); return []; });
    const r = await runPostMarketOverseas();
    expect(r.staleCandleSkipped).toBe(1);
    expect(r.errors).toContain('candle_fail:NYS:BAC:EGW00201');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('환율 — 신선한 fx_rates 만, 캔들 환산 전후 일치', () => {
  test.each([
    ['행 없음', null, 'fx_missing'],
    ['1시간 넘음', { rate: '1330', age_sec: 3601, fetched_kst: '2026-10-21T06:59:00' }, 'fx_stale'],
    ['범위 밖(1)', { rate: '1', age_sec: 10, fetched_kst: '2026-10-21T07:59:50' }, 'fx_invalid'],
    ['관측 시각 형식 이상', { rate: '1330', age_sec: 10, fetched_kst: null }, 'fx_invalid'],
  ])('🔴 %s → fx_unknown, 종목·시세·LLM 0', async (_n, row, reason) => {
    db.fxRow = row as never;
    arrange({ closes: { 'NAS:CMCSA': 27.4 } });
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ skipped: 'fx_unknown', ok: false, status: 'data_unknown', errors: [`fx_unknown:${reason}`], validFrom: '2026-10-21 22:30:00' });
    expect(mTargets).not.toHaveBeenCalled();
    expect(mCandles).not.toHaveBeenCalled();
  });
  test('fx_rates 읽기 오류 → fx_unknown:fx_read_failed', async () => {
    db.fxRow = new Error('x');
    const r = await runPostMarketOverseas();
    expect(r.errors).toEqual(['fx_unknown:fx_read_failed']);
    expect(r).toMatchObject({ ok: false, status: 'data_unknown' });
  });
  test('🔴 캔들 뒤 getUsdKrwRate 가 폴백 1380 → fx_inconsistent, LLM·INSERT 0', async () => {
    arrange({ closes: { 'NAS:CMCSA': 27.4 }, decisions: [buy('NAS:CMCSA', 27.2, 27.6)] });
    let n = 0;
    mFx.mockImplementation(async () => (++n >= 3 ? 1380 : 1330));   // 1: 갱신 유도, 2: 캔들 전, 3: 캔들 뒤
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ skipped: 'fx_inconsistent', ok: false, status: 'data_unknown' });
    expect(mCandles).toHaveBeenCalledTimes(1);   // 이 상태만 일봉 GET 뒤에 판정된다(LLM 전)
    expect(mLlm).not.toHaveBeenCalled();
    expect(getConnection).not.toHaveBeenCalled();
  });
  test('0.1% 안의 차이(fx_rates 4자리 반올림)는 일치로 본다', async () => {
    arrange({ closes: { 'NAS:CMCSA': 27.4 }, decisions: [buy('NAS:CMCSA', 27.2, 27.6)] });
    mFx.mockImplementation(async () => 1330.00004);
    const r = await runPostMarketOverseas();
    expect(r.signalsCreated).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('실적 블랙아웃 (Q6 (b)·Q-1 (a)·Q-2)', () => {
  const evRow = (over: Record<string, unknown>) => ({ symbol: 'NAS:CMCSA', status: 'confirmed', event_time_class: 'AMC', event_date_et: null, window_start_et: null, window_end_et: null, ...over });

  test('🔴 confirmed 가 S5(10-27) → 그 종목은 LLM 후보에서 빠지고 카드 없음', async () => {
    db.earningsRows = [evRow({ event_date_et: '2026-10-27' })];
    arrange({ closes: { 'NAS:CMCSA': 27.4, 'NYS:BAC': 47.1 }, decisions: [buy('NYS:BAC', 46.9, 47.3)] });
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ blackoutSkipped: 1, llmCandidates: 1, signalsCreated: 1 });
    expect(String(mLlm.mock.calls[0][0])).not.toContain('NAS:CMCSA');
    expect(insertedSymbols()).toEqual(['NYS:BAC']);
  });
  test('confirmed 가 S6(10-28) → 통과, earnings.nextConfirmed 기록', async () => {
    db.earningsRows = [evRow({ event_date_et: '2026-10-28' })];
    arrange({ closes: { 'NAS:CMCSA': 27.4 }, decisions: [buy('NAS:CMCSA', 27.2, 27.6)] });
    await runPostMarketOverseas();
    expect(JSON.parse(String(insertParams()[0][5])).earnings).toEqual({ status: 'none', nextConfirmed: '2026-10-28', blackout_days: 5, observedAt: '2026-10-21T08:00:00+09:00' });
  });
  test('🔴 estimated 창이 겹치면 막지 않고 G5 형식으로 기록(window 는 ET 날짜)', async () => {
    db.earningsRows = [evRow({ status: 'estimated', event_time_class: 'unknown', window_start_et: '2026-10-24', window_end_et: '2026-10-31' })];
    arrange({ closes: { 'NAS:CMCSA': 27.4 }, decisions: [buy('NAS:CMCSA', 27.2, 27.6)] });
    const r = await runPostMarketOverseas();
    expect(r.signalsCreated).toBe(1);
    expect(JSON.parse(String(insertParams()[0][5])).earnings).toEqual({
      status: 'estimated_window', window: { from: '2026-10-24', to: '2026-10-31' }, nextConfirmed: null, blackout_days: 5, observedAt: '2026-10-21T08:00:00+09:00',
    });
  });
  test.each([
    ['테이블 없음', () => { mMissing.mockResolvedValue(['us_earnings_events']); }, 'table_missing'],
    ['조회 오류', () => { db.earningsRows = new Error('x'); }, 'read_failed'],
  ])('🔴 일정 %s → 해외 실행 전체 건너뜀(earnings_unknown), 시세 호출 0', async (_n, prep, reason) => {
    prep();
    arrange({ closes: { 'NAS:CMCSA': 27.4 } });
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ skipped: 'earnings_unknown', errors: [`earnings_unknown:${reason}`], ok: false, status: 'data_unknown' });
    expect(mCandles).not.toHaveBeenCalled();
    expect(mLlm).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('금액 — D-5 사전 필터·cardBuysZeroShares 해외', () => {
  test('MU $200(266,000원) 은 LLM 전에 빠진다', async () => {
    arrange({ closes: { 'NAS:MU': 200, 'NAS:CMCSA': 27.4 }, decisions: [buy('NAS:CMCSA', 27.2, 27.6)] });
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ prefilterUnaffordable: 1, llmCandidates: 1 });
    expect(String(mLlm.mock.calls[0][0])).not.toContain('NAS:MU');
  });
  test('경계(추격 0): KRW 종가 110,000 은 남고 110,001 은 빠진다', async () => {
    mStyle.mockResolvedValue({ limitChasePct: 0 });
    R = 1000;
    db.fxRow = { rate: '1000', age_sec: 10, fetched_kst: '2026-10-21T07:59:50' };
    arrange({ closes: { 'NAS:A': 110, 'NAS:B': 110.001 } });
    const r = await runPostMarketOverseas();
    expect(r.prefilterUnaffordable).toBe(1);
    expect(String(mLlm.mock.calls[0][0])).toContain('## NAS:A');
    expect(String(mLlm.mock.calls[0][0])).not.toContain('## NAS:B');
  });
  test('LLM 전 후보가 모두 빠지면 LLM·RAG 를 부르지 않고 ok', async () => {
    arrange({ closes: { 'NAS:MU': 200 } });
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ ok: true, llmCandidates: 0, signalsCreated: 0 });
    expect(mLlm).not.toHaveBeenCalled();
    expect(mRag).not.toHaveBeenCalled();
  });
  test.each([
    ['🔴 $80.00 × 1250 = 100,000원(추격 0) → 만든다', 80.0, 80.0, 1, 0],
    ['🔴 $80.01 × 1250 = 100,013원 → 수량 0, 만들지 않는다', 80.01, 80.01, 0, 1],
  ])('%s', async (_n, lo, hi, created, unaffordable) => {
    mStyle.mockResolvedValue({ limitChasePct: 0 });
    R = 1250;
    db.fxRow = { rate: '1250', age_sec: 10, fetched_kst: '2026-10-21T07:59:50' };
    arrange({ closes: { 'NAS:X': 80 }, decisions: [buy('NAS:X', lo, hi)] });
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ signalsCreated: created, unaffordableSkipped: unaffordable });
    if (created) expect(insertParams()[0][2]).toBe(100000);
  });
  test('추격 0.5%: 99,600원 카드 → 지정가 100,098원 → 만들지 않는다(국내 T-053 과 같은 정의)', async () => {
    R = 1000;
    db.fxRow = { rate: '1000', age_sec: 10, fetched_kst: '2026-10-21T07:59:50' };
    arrange({ closes: { 'NAS:Y': 99.6 }, decisions: [buy('NAS:Y', 99.6, 99.6)] });
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ signalsCreated: 0, unaffordableSkipped: 1 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('🔴 S-1 결정 엄격 검증 — schemaRejected 와 zoneRejected 를 따로 센다', () => {
  const C = 27.4;
  test.each([
    ['lo 문자열', buy('NAS:CMCSA', '27.2', 27.6)],
    ['lo 음수', buy('NAS:CMCSA', -27.2, 27.6)],
    ['lo 0', buy('NAS:CMCSA', 0, 27.6)],
    ['lo > hi (역전)', buy('NAS:CMCSA', 27.6, 27.2)],
    ['entry_zone 없음', { ...buy('NAS:CMCSA', 1, 1), entry_zone: undefined }],
    ['entry_zone 배열', { ...buy('NAS:CMCSA', 1, 1), entry_zone: [27.2, 27.6] }],
    ['target 0', buy('NAS:CMCSA', 27.2, 27.6, { target_pct: 0 })],
    ['target 25', buy('NAS:CMCSA', 27.2, 27.6, { target_pct: 25 })],
    ['stop 음수(부호 규약 위반)', buy('NAS:CMCSA', 27.2, 27.6, { stop_pct: -3 })],
    ['stop 16', buy('NAS:CMCSA', 27.2, 27.6, { stop_pct: 16 })],
    ['holding 0', buy('NAS:CMCSA', 27.2, 27.6, { holding_days: 0 })],
    ['holding 2.5', buy('NAS:CMCSA', 27.2, 27.6, { holding_days: 2.5 })],
    ['holding 6', buy('NAS:CMCSA', 27.2, 27.6, { holding_days: 6 })],
    ['confidence 101', buy('NAS:CMCSA', 27.2, 27.6, { confidence: 101 })],
    ['confidence 문자열', buy('NAS:CMCSA', 27.2, 27.6, { confidence: '80' })],
    ['action 소문자', buy('NAS:CMCSA', 27.2, 27.6, { action: 'buy' })],
    ['reasoning 숫자', buy('NAS:CMCSA', 27.2, 27.6, { reasoning: 5 })],
  ])('schema: %s', (_n, d) => {
    expect(checkOverseasDecision(d as Record<string, unknown>, C).kind).toBe('schema');
  });
  test('JSON 1e400(= Infinity) 는 숫자가 아니다 → schema', () => {
    const d = JSON.parse('{"action":"BUY","entry_zone":{"lo":1e400,"hi":27.6},"target_pct":4,"stop_pct":3,"confidence":74}');
    expect(checkOverseasDecision(d, C)).toEqual({ kind: 'schema', why: 'zone_not_number' });
  });
  test.each([
    ['🔴 원화로 답함(단위 착오)', buy('NAS:CMCSA', 36176, 36708), 'lo_out_of_range'],
    ['lo 가 종가 0.80배', buy('NAS:CMCSA', 21.9, 27.6), 'lo_out_of_range'],
    ['hi 가 종가 1.17배', buy('NAS:CMCSA', 27.2, 32.06), 'hi_out_of_range'],
    ['폭 5.5%', buy('NAS:CMCSA', 26.5, 28.0), 'too_wide'],
  ])('zone: %s', (_n, d, why) => {
    expect(checkOverseasDecision(d as Record<string, unknown>, C)).toEqual({ kind: 'zone', why });
  });
  test('임계값: 0.85~1.15배, 폭 5%', () => {
    expect([ZONE_MIN_RATIO, ZONE_MAX_RATIO, ZONE_MAX_WIDTH_RATIO]).toEqual([0.85, 1.15, 0.05]);
  });
  test('holding_days 없음 → 2일(국내와 같음), 정상 → buy', () => {
    const { holding_days: _h, ...d } = buy('NAS:CMCSA', 27.2, 27.6);
    expect(checkOverseasDecision(d, C)).toMatchObject({ kind: 'buy', holdingDays: 2, loUsd: 27.2, hiUsd: 27.6 });
  });
  test('형식 검사가 신뢰도보다 먼저, 신뢰도가 구간보다 먼저', () => {
    expect(checkOverseasDecision(buy('NAS:CMCSA', -1, 27.6, { confidence: 10 }), C).kind).toBe('schema');
    expect(checkOverseasDecision(buy('NAS:CMCSA', 36176, 36708, { confidence: 10 }), C).kind).toBe('low_confidence');
  });
  test('🔴 엔진: 한 실행에서 schema 1·zone 1·정상 1 → 따로 집계, 정상 1장만', async () => {
    arrange({
      closes: { 'NAS:CMCSA': 27.4, 'NYS:BAC': 47.1, 'NYS:PFE': 25.2 },
      decisions: [buy('NAS:CMCSA', 27.6, 27.2), buy('NYS:BAC', 62643, 62909), buy('NYS:PFE', 25.0, 25.4)],
    });
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ schemaRejected: 1, zoneRejected: 1, signalsCreated: 1, signalsSkipped: 2, ok: true });
    expect(insertedSymbols()).toEqual(['NYS:PFE']);
  });
  test('decisions 원소가 객체가 아니거나 symbol 이 문자열이 아니면 schema', async () => {
    arrange({ closes: { 'NAS:CMCSA': 27.4 }, decisions: ['x', null, { symbol: 7, action: 'BUY' }] });
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ schemaRejected: 3, signalsCreated: 0, ok: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('🔴 S-2 AI 실패는 "0건"이 아니라 구조화된 실패', () => {
  test.each([
    ['JSON 아님', 'not json', 'json_parse'],
    ['decisions 누락', JSON.stringify({ picks: [] }), 'decisions_missing'],
    ['decisions 가 객체', JSON.stringify({ decisions: {} }), 'decisions_not_array'],
    ['최상위 배열', JSON.stringify([]), 'not_object'],
    ['null', 'null', 'not_object'],
  ])('%s → ok:false, status ai_parse_fail, INSERT 0', async (_n, raw, reason) => {
    arrange({ closes: { 'NAS:CMCSA': 27.4 }, llmRaw: raw });
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ ok: false, status: 'ai_parse_fail', signalsCreated: 0, signalsSkipped: 1 });
    expect(r.errors).toEqual([`ai_parse_fail:${reason}`]);
    expect(getConnection).not.toHaveBeenCalled();
  });
  test('정상 0건(decisions: []) 은 ok:true — 실패와 구분된다', async () => {
    arrange({ closes: { 'NAS:CMCSA': 27.4 }, decisions: [] });
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ ok: true, status: 'ok', signalsCreated: 0, errors: [] });
  });
  test('코드펜스로 감싼 JSON 도 읽는다', async () => {
    arrange({ closes: { 'NAS:CMCSA': 27.4 }, llmRaw: '```json\n' + JSON.stringify({ decisions: [buy('NAS:CMCSA', 27.2, 27.6)] }) + '\n```' });
    expect((await runPostMarketOverseas()).signalsCreated).toBe(1);
  });
  test('LLM 호출 예외(타임아웃 등) → ok:false, status ai_fail', async () => {
    arrange({ closes: { 'NAS:CMCSA': 27.4 } });
    mLlm.mockRejectedValue(new Error('timeout 90000ms'));
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ ok: false, status: 'ai_fail', errors: ['ai_fail:timeout 90000ms'] });
  });
  test('parseOverseasAiResponse — 이미 파싱된 객체도 받는다', () => {
    expect(parseOverseasAiResponse({ decisions: [] })).toEqual({ ok: true, decisions: [] });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('🔴 S-3 한 실행의 INSERT = 트랜잭션 하나', () => {
  const two = () => arrange({
    closes: { 'NAS:CMCSA': 27.4, 'NYS:PFE': 25.2 },
    decisions: [buy('NAS:CMCSA', 27.2, 27.6), buy('NYS:PFE', 25.0, 25.4)],
  });
  test('두 번째 INSERT 가 실패하면 전부 ROLLBACK, insert_fail, 생성 0', async () => {
    two();
    db.insertResults = [{ affectedRows: 1 }, Object.assign(new Error('deadlock'), { errno: 1213 })];
    wireDb();
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ ok: false, status: 'insert_fail', signalsCreated: 0, signalsSkipped: 2 });
    expect(r.errors).toEqual(['insert_fail:deadlock']);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
  });
  test('중복(affectedRows 0·1062)은 실패가 아니다 — 커밋, duplicatesSkipped', async () => {
    two();
    db.insertResults = [{ affectedRows: 0 }, Object.assign(new Error('Duplicate entry'), { errno: 1062 })];
    wireDb();
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ ok: true, status: 'ok', signalsCreated: 0, duplicatesSkipped: 2, signalsSkipped: 2 });
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
  });
  test('COMMIT 실패 → ROLLBACK·insert_fail', async () => {
    two();
    conn.commit.mockRejectedValue(new Error('conn lost'));
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ ok: false, status: 'insert_fail', signalsCreated: 0 });
    expect(conn.rollback).toHaveBeenCalled();
  });
  test('ROLLBACK 도 실패하면 연결을 풀에 돌려주지 않고 닫는다', async () => {
    two();
    db.insertResults = [new Error('boom')];
    wireDb();
    conn.rollback.mockRejectedValue(new Error('gone'));
    const r = await runPostMarketOverseas();
    expect(r.status).toBe('insert_fail');
    expect(conn.destroy).toHaveBeenCalledTimes(1);
    expect(conn.release).not.toHaveBeenCalled();
  });
  test('연결을 못 얻으면 insert_fail', async () => {
    two();
    getConnection.mockRejectedValue(new Error('pool closed'));
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ ok: false, status: 'insert_fail', errors: ['insert_fail:connection:pool closed'] });
  });
  test('카드가 0장이면 연결을 열지 않는다', async () => {
    arrange({ closes: { 'NAS:CMCSA': 27.4 }, decisions: [] });
    await runPostMarketOverseas();
    expect(getConnection).not.toHaveBeenCalled();
  });
});

describe('🔴 Leader 결정 — 일시적 "모름" 은 ok:false(data_unknown), 정상 판정 건너뜀은 ok:true', () => {
  test.each([
    ['스위치 꺼짐', () => { db.switchRows = []; }, 'overseas_disabled'],
    ['KIS 해외 시장 꺼짐', () => { mOvsEnabled.mockReturnValue(false); }, 'overseas_market_disabled'],
    ['새 세션 없음(주말)', () => { setNow('2026-10-24T23:00:00Z'); }, 'no_new_session'],
    ['정규장 진행 중', () => { setNow('2026-10-21T14:00:00Z'); }, 'us_session_open'],
  ])('%s → ok:true, status ok (200 — 재시도 안 함)', async (_n, prep, skipped) => {
    prep();
    arrange({ closes: { 'NAS:CMCSA': 27.4 } });
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ ok: true, status: 'ok', skipped });
  });
  test('일봉이 전부 오래됨(stale) → ok:true, 카드 0 (정상 판정)', async () => {
    arrange({ closes: { 'NAS:CMCSA': 27.4 }, lastDate: { 'NAS:CMCSA': '2026-10-19' } });
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ ok: true, status: 'ok', staleCandleSkipped: 1, signalsCreated: 0 });
    expect(mLlm).not.toHaveBeenCalled();
  });
  test('🔴 일봉이 전부 실패(응답 없음, KIS 장애) → ok:false·data_unknown·candles_unavailable, LLM·RAG·INSERT 0', async () => {
    arrange({ closes: { 'NAS:CMCSA': 27.4, 'NYS:BAC': 47.1 } });
    mCandles.mockRejectedValue(new Error('EGW00201'));
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ ok: false, status: 'data_unknown', skipped: 'candles_unavailable', signalsCreated: 0, symbolsEvaluated: 2 });
    expect(r.errors).toEqual(['candles_unavailable:2/2:EGW00201']);
    expect(mCandles).toHaveBeenCalledTimes(2);
    expect(mEod).not.toHaveBeenCalled();
    expect(mLlm).not.toHaveBeenCalled();
    expect(mRag).not.toHaveBeenCalled();
    expect(getConnection).not.toHaveBeenCalled();
  });
  test('일부만 실패 → 진행: 실패 종목만 candle_fail 로 남기고 성공분으로 후보·카드', async () => {
    arrange({ closes: { 'NAS:CMCSA': 27.4, 'NYS:BAC': 47.1 }, decisions: [buy('NAS:CMCSA', 27.2, 27.6)] });
    const ok = mCandles.getMockImplementation()!;
    mCandles.mockImplementation(async (s: string) => { if (s === 'NYS:BAC') throw new Error('EGW00201'); return ok(s); });
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ ok: true, status: 'ok', signalsCreated: 1, candidatesFound: 1 });
    expect(r.errors).toEqual(['candle_fail:NYS:BAC:EGW00201']);
    expect(String(mLlm.mock.calls[0][0])).not.toContain('NYS:BAC');
  });
  test('전부 응답은 받았지만 오래된 봉(stale)·빈 봉 → 성공으로 센다, ok:true(200 유지)', async () => {
    arrange({ closes: { 'NAS:CMCSA': 27.4, 'NYS:BAC': 47.1 }, lastDate: { 'NAS:CMCSA': '2026-10-19' } });
    mCandles.mockImplementation(async (s: string) => (s === 'NYS:BAC' ? [] : [{ ts: candleTs('2026-10-19'), open: 1, high: 1, low: 1, close: 27.4 * R, volume: 1 }]));
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ ok: true, status: 'ok', staleCandleSkipped: 2, signalsCreated: 0 });
    expect(r.skipped).toBeUndefined();
  });
  test('요청 종목 0 → no_symbols, ok:true(200 유지), 일봉 0', async () => {
    mTargets.mockResolvedValue({ symbols: [], errors: [] });
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ ok: true, status: 'ok', errors: ['no_symbols'] });
    expect(mCandles).not.toHaveBeenCalled();
  });
  test('휴장·환율·실적 모름은 KIS·LLM 호출 전에 끝난다(재시도 비용 = DB 조회 몇 번)', async () => {
    for (const prep of [
      () => { db.holidays = new Error('x'); },
      () => { db.fxRow = null; },
      () => { db.earningsRows = new Error('x'); },
    ]) {
      jest.clearAllMocks(); wireDb(); mOvsEnabled.mockReturnValue(true); mFx.mockImplementation(async () => R); mMissing.mockResolvedValue([]);
      db = {
        switchRows: [{ value: 'true' }], holidays: CLOSED, fxRow: { rate: '1330.0000', age_sec: 120, fetched_kst: '2026-10-21T07:58:00' }, earningsRows: [], insertResults: [],
        strategies: {}, paperFills: [], paperThrows: null,   // T-072 WP-2c R-4 — DbState 필수 필드(빠지면 시험 포함 타입 검사에서 오류)
      };
      prep();
      arrange({ closes: { 'NAS:CMCSA': 27.4 } });
      const r = await runPostMarketOverseas();
      expect(r.status).toBe('data_unknown');
      expect(mCandles).not.toHaveBeenCalled();
      expect(mLlm).not.toHaveBeenCalled();
    }
  });
});

describe('원화 환산 안내 줄', () => {
  test.each([[1330, '1,330'], [1327.84, '1,327.84'], [1327.8, '1,327.8'], [1399.999, '1,400'], [987.5, '987.5']])('formatFxRate(%s) → %s', (r, s) => {
    expect(formatFxRate(r)).toBe(s);
  });
  test('기준일은 fx.asOf 의 KST 날짜(MM-DD)', () => {
    expect(krwBasisNote(1330, '2026-12-31T23:58:00+09:00')).toBe('※ 위 규칙 근거의 가격 숫자(MA·볼린저·전저점 등)는 원화 환산값입니다 (환율 1,330원, 기준 12-31)');
  });
});

describe('🔴 Reviewer L-3 — 환산 스케일 방어선(KRW 종가 ≥ R × $1)', () => {
  test('하한 = $1', () => expect(MIN_CLOSE_USD_FOR_SCALE).toBe(1));
  test('🔴 어댑터가 환산 못 한 값(USD 27.4 를 KRW 로 표기) 한 종목이라도 → 실행 전체 data_unknown(503), LLM·INSERT 0', async () => {
    arrange({ closes: { 'NAS:CMCSA': 27.4, 'NYS:BAC': 47.1 }, decisions: [buy('NAS:CMCSA', 0.0205, 0.0206)] });
    const ok = mCandles.getMockImplementation()!;
    mCandles.mockImplementation(async (s: string) => {
      const c = await ok(s);
      return s === 'NAS:CMCSA' ? c.map((x: { close: number }) => ({ ...x, close: 27.4 })) : c;
    });
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ ok: false, status: 'data_unknown', skipped: 'candle_scale_suspect', signalsCreated: 0 });
    expect(r.errors).toEqual(['candle_scale_suspect:NAS:CMCSA(close=27.4)']);
    expect(mEod).not.toHaveBeenCalled();
    expect(mLlm).not.toHaveBeenCalled();
    expect(getConnection).not.toHaveBeenCalled();
  });
  test.each([
    ['정확히 R × $1 (1,330원) → 통과', 1330, false],
    ['1,329.99원 → 의심', 1329.99, true],
    ['NaN → 의심', Number.NaN, true],
  ])('경계: %s', async (_n, close, suspect) => {
    arrange({ closes: { 'NAS:X': 1 } });
    mCandles.mockResolvedValue([{ ts: candleTs('2026-10-20'), open: 1, high: 1, low: 1, close, volume: 1 }]);
    const r = await runPostMarketOverseas();
    expect(r.skipped === 'candle_scale_suspect').toBe(suspect);
  });
  test.each([
    ['🔴 마지막 봉만 낮음(환산 실패가 마지막 봉에만) → 의심', [1330 * 27, 27], true],
    ['🔴 첫 봉만 낮고 마지막 봉 정상 → 통과(마지막 봉을 본다)', [27, 1330 * 27], false],
  ])('다봉: %s', async (_n, closes, suspect) => {
    arrange({ closes: { 'NAS:X': 27 } });
    mCandles.mockResolvedValue((closes as number[]).map((c, i) => ({ ts: candleTs(i === 0 ? '2026-10-19' : '2026-10-20'), open: 1, high: 1, low: 1, close: c, volume: 1 })));
    const r = await runPostMarketOverseas();
    expect(r.skipped === 'candle_scale_suspect').toBe(suspect);
  });
  test('빈 일봉은 스케일 판정 대상 아님(stale 로 처리)', async () => {
    arrange({ closes: { 'NAS:CMCSA': 27.4 } });
    mCandles.mockResolvedValue([]);
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ ok: true, staleCandleSkipped: 1 });
  });
});

describe('🔴 Codex C2 ① — 프로세스 내 single-flight (키 = overseas:<D0>)', () => {
  const flush = async () => { for (let i = 0; i < 50; i++) await new Promise(r => setImmediate(r)); };
  /** LLM 응답을 붙잡아 첫 실행을 진행 중 상태로 둔다. */
  function holdLlm() {
    let release!: () => void;
    mLlm.mockImplementation(() => new Promise<string>(r => { release = () => r(JSON.stringify({ decisions: [buy('NAS:CMCSA', 27.2, 27.6)] })); }));
    return () => release();
  }
  const waitLlm = async () => { for (let i = 0; i < 200 && mLlm.mock.calls.length === 0; i++) await flush(); };

  test('🔴 동시 두 호출: 두 번째는 외부 호출 0회·ok:false·in_progress, 첫 번째는 정상 완료', async () => {
    arrange({ closes: { 'NAS:CMCSA': 27.4 } });
    const release = holdLlm();
    const first = runPostMarketOverseas();
    await waitLlm();
    const before = { candles: mCandles.mock.calls.length, rag: mRag.mock.calls.length, llm: mLlm.mock.calls.length, fx: mFx.mock.calls.length, targets: mTargets.mock.calls.length, earnings: mMissing.mock.calls.length };
    const second = await runPostMarketOverseas();
    expect(second).toMatchObject({ ok: false, status: 'in_progress', signalsCreated: 0, errors: ['in_progress:overseas:2026-10-20'] });
    expect({ candles: mCandles.mock.calls.length, rag: mRag.mock.calls.length, llm: mLlm.mock.calls.length, fx: mFx.mock.calls.length, targets: mTargets.mock.calls.length, earnings: mMissing.mock.calls.length }).toEqual(before);
    expect(getConnection).not.toHaveBeenCalled();
    release();
    expect(await first).toMatchObject({ ok: true, status: 'ok', signalsCreated: 1 });
  });
  test('완료 후에는 다시 부를 수 있다(잠금 해제)', async () => {
    arrange({ closes: { 'NAS:CMCSA': 27.4 }, decisions: [buy('NAS:CMCSA', 27.2, 27.6)] });
    expect((await runPostMarketOverseas()).status).toBe('ok');
    expect((await runPostMarketOverseas()).status).toBe('ok');
    expect(mLlm).toHaveBeenCalledTimes(2);
  });
  test('🔴 첫 호출이 예외로 끝나도 잠금이 풀린다(영구 잠금 없음)', async () => {
    arrange({ closes: { 'NAS:CMCSA': 27.4 }, decisions: [buy('NAS:CMCSA', 27.2, 27.6)] });
    mTargets.mockRejectedValueOnce(new Error('pool exploded'));
    await expect(runPostMarketOverseas()).rejects.toThrow('pool exploded');
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ ok: true, status: 'ok', signalsCreated: 1 });
  });
  test('실패 상태(ok:false)로 끝나도 잠금이 풀린다', async () => {
    arrange({ closes: { 'NAS:CMCSA': 27.4 }, llmRaw: 'not json' });
    expect((await runPostMarketOverseas()).status).toBe('ai_parse_fail');
    mLlm.mockResolvedValue(JSON.stringify({ decisions: [] }));
    expect((await runPostMarketOverseas()).status).toBe('ok');
  });
  test('서로 다른 D0 는 별개 키 — 화 D0 실행 중에도 수 D0 실행은 진행한다', async () => {
    arrange({ closes: { 'NAS:CMCSA': 27.4 } });
    const release = holdLlm();
    const first = runPostMarketOverseas();          // 수 08:00 KST → D0 10-20
    await waitLlm();
    jest.setSystemTime(new Date('2026-10-21T23:00:00Z'));   // 목 08:00 KST → D0 10-21
    const second = await runPostMarketOverseas();
    expect(second.status).not.toBe('in_progress');
    expect(second.sessionEt?.d0).toBe('2026-10-21');
    release();
    await first;
  });
});

describe('Reviewer L-1 — 시험 공백 보강', () => {
  const C = 20;
  test('🔴 폭이 정확히 5% 이면 통과(> 이지 >= 가 아니다)', () => {
    expect((20.5 - 19.5) / C).toBe(ZONE_MAX_WIDTH_RATIO);
    expect(checkOverseasDecision(buy('NAS:X', 19.5, 20.5), C).kind).toBe('buy');
  });
  test('🔴 lo 가 정확히 하한(종가 × 0.85)이면 통과, 그보다 조금 작으면 lo_out_of_range', () => {
    const lo = C * ZONE_MIN_RATIO;
    expect(checkOverseasDecision(buy('NAS:X', lo, lo + 0.5), C).kind).toBe('buy');
    expect(checkOverseasDecision(buy('NAS:X', lo - 1e-9, lo + 0.5), C)).toEqual({ kind: 'zone', why: 'lo_out_of_range' });
  });
  test('🔴 hi 가 정확히 상한(종가 × 1.15)이면 통과, 그보다 조금 크면 hi_out_of_range', () => {
    const hi = C * ZONE_MAX_RATIO;
    expect(checkOverseasDecision(buy('NAS:X', hi - 0.5, hi), C).kind).toBe('buy');
    expect(checkOverseasDecision(buy('NAS:X', hi - 0.5, hi + 1e-9), C)).toEqual({ kind: 'zone', why: 'hi_out_of_range' });
  });
  test('🔴 캔들 **앞** 환율만 어긋나도 fx_inconsistent(뒤 검사만 있는 것이 아님)', async () => {
    arrange({ closes: { 'NAS:CMCSA': 27.4 }, decisions: [buy('NAS:CMCSA', 27.2, 27.6)] });
    let n = 0;
    mFx.mockImplementation(async () => (++n === 2 ? 1380 : 1330));   // 1: 갱신 유도, 2: 캔들 전(어긋남), 3: 캔들 뒤(정상)
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ skipped: 'fx_inconsistent', ok: false, status: 'data_unknown' });
    expect(r.errors[0]).toContain('before=1380');
    expect(mLlm).not.toHaveBeenCalled();
  });
  test('🔴 RAG 실패 → 계속(ok:true·카드 생성), errors 에 rag_fail, 프롬프트에 뉴스 절 없음', async () => {
    arrange({ closes: { 'NAS:CMCSA': 27.4 }, decisions: [buy('NAS:CMCSA', 27.2, 27.6)] });
    mRag.mockRejectedValue(new Error('m4 down'));
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ ok: true, status: 'ok', signalsCreated: 1, errors: ['rag_fail:m4 down'] });
    expect(String(mLlm.mock.calls[0][0])).not.toContain('WSJ');
  });
  test('🔴 추격률 읽기 실패 → 추격 0 으로 계속(ok:true): 99,600원 카드가 만들어진다(추격 0.5% 였다면 수량 0)', async () => {
    R = 1000;
    db.fxRow = { rate: '1000', age_sec: 10, fetched_kst: '2026-10-21T07:59:50' };
    arrange({ closes: { 'NAS:Y': 99.6 }, decisions: [buy('NAS:Y', 99.6, 99.6)] });
    mStyle.mockRejectedValue(new Error('style down'));
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ ok: true, status: 'ok', signalsCreated: 1, unaffordableSkipped: 0 });
    expect(insertParams()[0][2]).toBe(99600);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('🔴 T-072 G2 — 검증 관문(해외 트랜잭션): skipped 카드 + 커밋 뒤에만 가상 체결 (실제 관문)', () => {
  const mGate = evaluateValidationGate as jest.Mock;
  const realGate = (jest.requireActual('@/lib/safety/validation-gate') as typeof import('@/lib/safety/validation-gate')).evaluateValidationGate;
  const defaultGate = mGate.getMockImplementation();
  beforeEach(() => { mGate.mockImplementation(realGate); });
  afterEach(() => { mGate.mockImplementation(defaultGate); });

  const PF_COLS = ['signal_id', 'strategy_id', 'gate_reason', 'origin', 'market', 'symbol', 'order_type', 'currency',
    'limit_price', 'limit_price_krw', 'fx_usdkrw', 'zone_lo', 'zone_hi', 'quantity', 'amount_krw',
    'fee_rate_pct', 'fee_est_krw', 'fill_model', 'valid_from', 'valid_until', 'signal_created_at'] as const;
  const pf = (params: unknown[]) => Object.fromEntries(PF_COLS.map((c, i) => [c, params[i]])) as Record<(typeof PF_COLS)[number], unknown>;
  const pfCalls = () => query.mock.calls.filter((c) => /INSERT INTO paper_fills/.test(String(c[0])));

  test('미등록(eod-high-close-v1) → 카드는 트랜잭션 연결로 status=skipped, 가상 체결은 COMMIT 뒤 풀로 1행(USD 구간·같은 유효기간)', async () => {
    db.insertResults = [{ affectedRows: 1, insertId: 4242 }];
    arrange({ closes: { 'NAS:CMCSA': 27.4 }, decisions: [buy('NAS:CMCSA', 27.2, 27.6)] });
    const r = await runPostMarketOverseas();

    expect(mLlm).toHaveBeenCalledTimes(1);                                   // 배치는 그대로 돈다
    expect(r).toMatchObject({ ok: true, status: 'ok', signalsCreated: 0, signalsSkipped: 1, validationBlocked: 1, duplicatesSkipped: 0, errors: [] });
    const p = insertParams()[0];
    expect(p[9]).toBe('skipped');                                           // 🔴 승인 가능한 pending 이 아니다
    expect(JSON.parse(String(p[5]))).toMatchObject({
      gate: 'validation_gate', validation_gate: { reason: 'unregistered', status: null, origin: 'post_market' }, price_zone_usd: { lo: 27.2, hi: 27.6 },
    });
    // 관문 조회는 풀(트랜잭션 연결에 끼지 않는다), 가상 체결도 풀 — 트랜잭션 연결로는 카드 INSERT 만
    expect(conn.query.mock.calls.every((c) => /^\s*INSERT INTO signals/.test(String(c[0])))).toBe(true);
    expect(query.mock.calls.some((c) => /FROM strategies/.test(String(c[0])))).toBe(true);
    // 🔴 커밋 뒤에만 기록
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(pfCalls()).toHaveLength(1);
    const pfOrder = query.mock.invocationCallOrder[query.mock.calls.findIndex((c) => /INSERT INTO paper_fills/.test(String(c[0])))];
    expect(pfOrder).toBeGreaterThan(conn.commit.mock.invocationCallOrder[0]);
    const row = pf(db.paperFills[0]);
    expect(row).toMatchObject({
      signal_id: 4242, strategy_id: 'eod-high-close-v1', gate_reason: 'unregistered', origin: 'post_market',
      market: 'overseas', symbol: 'NAS:CMCSA', order_type: 'limit', currency: 'USD', zone_lo: 27.2, zone_hi: 27.6,
      amount_krw: 100000, fee_rate_pct: 0.25, fill_model: 'zone_touch_pending', fx_usdkrw: 1330, quantity: 2,
      valid_from: '2026-10-21 22:30:00', valid_until: '2026-10-22 05:00:00',
    });
    expect(row.limit_price_krw).toBeCloseTo(36442 * 1.005, 6);              // entry-watcher 와 같은 추격 반영 원화 지정가
    expect(row.limit_price).toBe(overseasLimitUnitUsd(36442 * 1.005, 1330));
  });

  test('🔴 트랜잭션이 되돌려지면(두 번째 카드 INSERT 실패) 가상 체결 0 — 사라진 카드를 가리키는 고아 행 없음', async () => {
    arrange({ closes: { 'NAS:CMCSA': 27.4, 'NYS:PFE': 25.2 }, decisions: [buy('NAS:CMCSA', 27.2, 27.6), buy('NYS:PFE', 25.0, 25.4)] });
    db.insertResults = [{ affectedRows: 1, insertId: 1 }, Object.assign(new Error('deadlock'), { errno: 1213 })];
    wireDb();
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ ok: false, status: 'insert_fail', signalsCreated: 0 });
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(pfCalls()).toHaveLength(0);
    expect(db.paperFills).toHaveLength(0);
  });

  test('🔴 커밋 뒤 가상 체결 기록이 실패해도(테이블 없음) 실행은 ok·카드는 커밋됨·던지지 않음', async () => {
    db.insertResults = [{ affectedRows: 1, insertId: 4243 }];
    db.paperThrows = Object.assign(new Error("Table 'paper_fills' doesn't exist"), { code: 'ER_NO_SUCH_TABLE' });
    arrange({ closes: { 'NAS:CMCSA': 27.4 }, decisions: [buy('NAS:CMCSA', 27.2, 27.6)] });
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ ok: true, status: 'ok', validationBlocked: 1, errors: [] });
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('가상 체결 기록 실패'));
  });

  test('중복(affectedRows 0)이면 막혔어도 가상 체결 0', async () => {
    db.insertResults = [{ affectedRows: 0 }];
    arrange({ closes: { 'NAS:CMCSA': 27.4 }, decisions: [buy('NAS:CMCSA', 27.2, 27.6)] });
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ ok: true, duplicatesSkipped: 1, signalsCreated: 0 });
    expect('validationBlocked' in r).toBe(false);
    expect(pfCalls()).toHaveLength(0);
  });

  test('검증된 전략이면 기존 그대로 pending · 가상 체결 0', async () => {
    db.strategies['eod-high-close-v1'] = 'backtested';
    db.insertResults = [{ affectedRows: 1, insertId: 4244 }];
    arrange({ closes: { 'NAS:CMCSA': 27.4 }, decisions: [buy('NAS:CMCSA', 27.2, 27.6)] });
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ ok: true, signalsCreated: 1 });
    expect(insertParams()[0][9]).toBe('pending');
    expect(pfCalls()).toHaveLength(0);
  });
});

describe('formatKrwInt', () => {
  test.each([[36176, '36,176'], [999, '999'], [1000, '1,000'], [1234567, '1,234,567'], [36176.4, '36,176']])('%s → %s', (n, s) => {
    expect(formatKrwInt(n)).toBe(s);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('T-106 뉴스 0건 연속 감시 — 해외 검색 채널 호출 지점', () => {
  const mHealth = recordRetrievalNewsOutcome as jest.Mock;

  test('🔴 retrieveRagContext 직후 (\'overseas\', ragCtx) 로 기록 — LLM 전, 카드 생성 그대로', async () => {
    arrange({ closes: { 'NAS:CMCSA': 27.4 }, decisions: [buy('NAS:CMCSA', 27.2, 27.6)] });
    const ctx = { pastSignals: [], recentNews: [], macroContext: [], totalChars: 0, elapsedMs: 1, errors: [] };
    mRag.mockResolvedValue(ctx);
    const r = await runPostMarketOverseas();
    expect(mHealth).toHaveBeenCalledTimes(1);
    expect(mHealth).toHaveBeenCalledWith('overseas', ctx);
    expect(mHealth.mock.invocationCallOrder[0]).toBeGreaterThan(mRag.mock.invocationCallOrder[0]);
    expect(mHealth.mock.invocationCallOrder[0]).toBeLessThan(mLlm.mock.invocationCallOrder[0]);
    expect(r).toMatchObject({ ok: true, status: 'ok', signalsCreated: 1, errors: [] });
  });

  test('🔴 기록이 던져도(이론상 없음) 분석은 그대로 — rag_fail 없음, 뉴스 절 유지', async () => {
    arrange({ closes: { 'NAS:CMCSA': 27.4 }, decisions: [buy('NAS:CMCSA', 27.2, 27.6)] });
    mHealth.mockRejectedValueOnce(new Error('db down'));
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ ok: true, status: 'ok', signalsCreated: 1, errors: [] });
    expect(String(mLlm.mock.calls[0][0])).toContain('WSJ');
  });

  test('RAG 가 던지면 기록하지 않는다', async () => {
    arrange({ closes: { 'NAS:CMCSA': 27.4 }, decisions: [buy('NAS:CMCSA', 27.2, 27.6)] });
    mRag.mockRejectedValue(new Error('m4 down'));
    await runPostMarketOverseas();
    expect(mHealth).not.toHaveBeenCalled();
  });
});
