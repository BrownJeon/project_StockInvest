/**
 * 리서치 사이클 실행기 — 부분 실패 격리·동시성·타임아웃 검증 (T-032).
 */
import { runResearchCycle, CONCURRENCY, SYMBOL_TIMEOUT_MS } from '../run-cycle';
import { buildResearchReport } from '../research-report';
import { listTrackedSymbols, upsertResearchResult } from '../storage';
import type { ResearchReport } from '../types';

jest.mock('../storage', () => ({
  listTrackedSymbols: jest.fn(),
  upsertResearchResult: jest.fn(async () => {}),
}));
jest.mock('../research-report', () => {
  const actual = jest.requireActual('../research-report');
  return { ...actual, buildResearchReport: jest.fn() };
});

const mockList = listTrackedSymbols as jest.MockedFunction<typeof listTrackedSymbols>;
const mockBuild = buildResearchReport as jest.MockedFunction<typeof buildResearchReport>;
const mockUpsert = upsertResearchResult as jest.MockedFunction<typeof upsertResearchResult>;

function report(symbol: string, over: Partial<ResearchReport> = {}): ResearchReport {
  return {
    symbol, market: 'overseas', runDate: '2026-08-19',
    dataRangeFrom: null, dataRangeTo: null, eventCount: 0, events: [],
    avgRallyPct: null, avgDaysToRally: null, precursorAnalysis: null,
    dataWarnings: [], error: null, ...over,
  };
}

function tracked(symbols: string[]) {
  return symbols.map((symbol) => ({ symbol, name: null, market: 'overseas' as const }));
}

afterEach(() => jest.clearAllMocks());

describe('runResearchCycle', () => {
  test('시장별 추적 심볼만 조회한다', async () => {
    mockList.mockResolvedValue([]);
    const r = await runResearchCycle('domestic');
    expect(mockList).toHaveBeenCalledWith('domestic');
    expect(r.total).toBe(0);
    expect(r.market).toBe('domestic');
    expect(mockBuild).not.toHaveBeenCalled();
  });

  test('모든 심볼을 계산해 upsert 한다', async () => {
    mockList.mockResolvedValue(tracked(['NAS:MU', 'NAS:SNDK']));
    mockBuild.mockImplementation(async (s) => report(s));

    const r = await runResearchCycle('overseas');
    expect(mockUpsert).toHaveBeenCalledTimes(2);
    expect(r.total).toBe(2);
    expect(r.succeeded).toBe(2);
    expect(r.failed).toBe(0);
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('🔴 심볼 하나가 실패해도 나머지는 계속 처리하고 error 를 기록한다', async () => {
    mockList.mockResolvedValue(tracked(['A_OK', 'B_ERR', 'C_OK']));
    mockBuild.mockImplementation(async (s) =>
      s === 'B_ERR' ? report(s, { error: 'yahoo down' }) : report(s),
    );

    const r = await runResearchCycle('overseas');
    expect(mockUpsert).toHaveBeenCalledTimes(3);           // 실패분도 기록한다
    expect(r.succeeded).toBe(2);
    expect(r.failed).toBe(1);
    expect(r.failures).toEqual([{ symbol: 'B_ERR', error: 'yahoo down' }]);
  });

  test('예외를 던지는 심볼도 사이클을 멈추지 않는다', async () => {
    mockList.mockResolvedValue(tracked(['A', 'B']));
    mockBuild.mockImplementation(async (s) => {
      if (s === 'A') throw new Error('boom');
      return report(s);
    });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const r = await runResearchCycle('overseas');
    expect(r.succeeded).toBe(1);
    expect(r.failed).toBe(1);
    expect(r.failures[0].error).toMatch(/boom/);
    spy.mockRestore();
  });

  test(`동시 실행 심볼 수가 ${CONCURRENCY}개를 넘지 않는다`, async () => {
    const symbols = Array.from({ length: 11 }, (_, i) => `S${i}`);
    mockList.mockResolvedValue(tracked(symbols));

    let inFlight = 0;
    let maxInFlight = 0;
    mockBuild.mockImplementation(async (s) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((res) => setTimeout(res, 1));
      inFlight--;
      return report(s);
    });

    const r = await runResearchCycle('overseas');
    expect(r.total).toBe(11);
    expect(maxInFlight).toBeLessThanOrEqual(CONCURRENCY);
  });

  test('심볼별 타임아웃이 걸리면 실패로 기록하고 넘어간다', async () => {
    jest.useFakeTimers();
    mockList.mockResolvedValue(tracked(['HANG']));
    mockBuild.mockImplementation(() => new Promise(() => {})); // 영원히 끝나지 않음
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const p = runResearchCycle('overseas');
    await jest.advanceTimersByTimeAsync(SYMBOL_TIMEOUT_MS + 10);
    const r = await p;

    expect(r.failed).toBe(1);
    expect(r.failures[0].error).toMatch(/timeout after/);
    expect(mockUpsert).not.toHaveBeenCalled();
    spy.mockRestore();
    jest.useRealTimers();
  });

  test('한 사이클의 run_date 는 하나로 고정된다', async () => {
    mockList.mockResolvedValue(tracked(['A', 'B']));
    mockBuild.mockImplementation(async (s) => report(s));

    const r = await runResearchCycle('overseas');
    const dates = mockBuild.mock.calls.map((c) => (c[1] as { runDate: string }).runDate);
    expect(new Set(dates).size).toBe(1);
    expect(r.runDate).toBe(dates[0]);
  });
});
