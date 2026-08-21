/**
 * 리서치 결과 저장·조회 (T-032). DB는 모킹 — SQL 형태와 파라미터 매핑을 검증한다.
 */
import { getPool } from '@/lib/db';
import {
  getLatestResearchResults,
  listTrackedSymbols,
  upsertResearchResult,
} from '../storage';
import type { ResearchReport } from '../types';

jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));

function mockQuery(...results: unknown[]) {
  const query = jest.fn();
  for (const r of results) query.mockResolvedValueOnce([r]);
  query.mockResolvedValue([[]]);
  (getPool as jest.Mock).mockReturnValue({ query });
  return query;
}

const baseReport: ResearchReport = {
  symbol: 'NAS:MU',
  market: 'overseas',
  runDate: '2026-08-19',
  dataRangeFrom: '2021-08-19',
  dataRangeTo: '2026-08-18',
  eventCount: 2,
  events: [],
  avgRallyPct: 18.3456,
  avgDaysToRally: 7.891,
  precursorAnalysis: null,
  todayActiveRuleIds: ['rsi_lt_30', 'bb_pctb_lt_010'],
  dataWarnings: ['short_history'],
  error: null,
};

afterEach(() => jest.clearAllMocks());

describe('listTrackedSymbols', () => {
  test('research_enabled=1 만 조회하고 시장은 심볼 포맷으로 판별한다', async () => {
    const query = mockQuery([
      { symbol: '005930', name: '삼성전자' },
      { symbol: 'NAS:MU', name: 'Micron' },
    ]);
    const rows = await listTrackedSymbols();

    const sql = String(query.mock.calls[0][0]);
    expect(sql).toMatch(/FROM stock_favorites/);
    expect(sql).toMatch(/research_enabled = 1/);
    // stock_meta JOIN 에 의존하지 않는다 — 해외 심볼은 캐시미스가 나기 때문
    expect(sql).not.toMatch(/stock_meta/);

    expect(rows).toEqual([
      { symbol: '005930', name: '삼성전자', market: 'domestic' },
      { symbol: 'NAS:MU', name: 'Micron', market: 'overseas' },
    ]);
  });

  test('market 인자로 필터링한다', async () => {
    mockQuery([{ symbol: '005930', name: null }, { symbol: 'NAS:MU', name: null }]);
    expect(await listTrackedSymbols('overseas')).toEqual([
      { symbol: 'NAS:MU', name: null, market: 'overseas' },
    ]);
  });

  test('추적 대상이 없으면 빈 배열', async () => {
    mockQuery([]);
    expect(await listTrackedSymbols()).toEqual([]);
  });
});

describe('upsertResearchResult', () => {
  test('(symbol, run_date) UNIQUE 로 upsert 하고 JSON 컬럼을 직렬화한다', async () => {
    const query = mockQuery([{ affectedRows: 1 }]);
    await upsertResearchResult(baseReport);

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(String(sql)).toMatch(/INSERT INTO research_rally_results/);
    expect(String(sql)).toMatch(/ON DUPLICATE KEY UPDATE/);

    expect(params[0]).toBe('NAS:MU');
    expect(params[1]).toBe('overseas');
    expect(params[2]).toBe('2026-08-19');
    expect(params[5]).toBe(2);
    expect(params[6]).toBe('[]');                 // events
    expect(params[7]).toBeCloseTo(18.35, 8);      // DECIMAL(6,2) 반올림
    expect(params[8]).toBeCloseTo(7.89, 8);
    expect(params[9]).toBeNull();                 // precursor_analysis
    expect(params[10]).toBe('["rsi_lt_30","bb_pctb_lt_010"]');   // today_active_rule_ids (T-033)
    expect(params[11]).toBe('["short_history"]');
    expect(params[12]).toBeNull();                // error
  });

  test('T-033 — today_active_rule_ids 는 컬럼 목록·VALUES 개수와 UPDATE 절에 모두 들어간다', async () => {
    const query = mockQuery([{ affectedRows: 1 }]);
    await upsertResearchResult(baseReport);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(String(sql)).toMatch(/today_active_rule_ids/);
    expect(String(sql)).toMatch(/today_active_rule_ids = VALUES\(today_active_rule_ids\)/);
    // 플레이스홀더 개수와 파라미터 개수가 어긋나면 런타임에서야 터진다 — 여기서 잡는다.
    expect((String(sql).match(/\?/g) ?? []).length).toBe(params.length);
  });

  test('T-033 — 평가 못 한 경우(null)는 빈 배열로 접지 않고 null 그대로 저장한다', async () => {
    const query = mockQuery([{ affectedRows: 1 }]);
    await upsertResearchResult({ ...baseReport, todayActiveRuleIds: null });
    const [, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params[10]).toBeNull();
  });

  test('실패 리포트도 error 컬럼과 함께 기록한다', async () => {
    const query = mockQuery([{ affectedRows: 1 }]);
    await upsertResearchResult({ ...baseReport, error: 'yahoo fetch failed', eventCount: 0 });
    const [, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params[12]).toBe('yahoo fetch failed');
  });
});

describe('getLatestResearchResults', () => {
  test('추적 심볼이 없으면 쿼리를 더 쏘지 않는다', async () => {
    const query = mockQuery([]);
    const r = await getLatestResearchResults();
    expect(r).toEqual({ tracked: [], results: [] });
    expect(query).toHaveBeenCalledTimes(1);
  });

  test('심볼별 최신 run_date 1건만 반환하고 JSON 을 역직렬화한다', async () => {
    const query = mockQuery(
      [{ symbol: 'NAS:MU', name: 'Micron' }],
      [{
        symbol: 'NAS:MU',
        market: 'overseas',
        run_date: '2026-08-19',
        data_range_from: '2021-08-19',
        data_range_to: '2026-08-18',
        event_count: 3,
        events: '[{"troughIndex":10}]',
        avg_rally_pct: '18.35',
        avg_days_to_rally: '7.89',
        precursor_analysis: '{"positiveDays":12}',
        today_active_rule_ids: '["rsi_lt_30"]',
        data_warnings: '["short_history"]',
        error: null,
        created_at: '2026-08-19T07:00:00.000Z',
      }],
    );

    const { tracked, results } = await getLatestResearchResults();
    expect(tracked).toHaveLength(1);
    expect(String(query.mock.calls[1][0])).toMatch(/MAX\(run_date\)/);

    expect(results).toHaveLength(1);
    const r = results[0];
    expect(r.name).toBe('Micron');            // 즐겨찾기 이름을 붙여준다
    expect(r.runDate).toBe('2026-08-19');
    expect(r.eventCount).toBe(3);
    expect(r.events).toEqual([{ troughIndex: 10 }]);
    expect(r.avgRallyPct).toBeCloseTo(18.35, 8);
    expect(r.precursorAnalysis).toEqual({ positiveDays: 12 });
    expect(r.dataWarnings).toEqual(['short_history']);
    expect(r.todayActiveRuleIds).toEqual(['rsi_lt_30']);   // T-033 컬럼 왕복
  });

  test('T-033 — today_active_rule_ids 가 없는 구버전 행은 null 로 읽힌다(빈 배열 아님)', async () => {
    mockQuery(
      [{ symbol: 'NAS:MU', name: null }],
      [{
        symbol: 'NAS:MU', market: 'overseas', run_date: '2026-08-19',
        data_range_from: null, data_range_to: null, event_count: 0,
        events: '[]', avg_rally_pct: null, avg_days_to_rally: null,
        precursor_analysis: null, data_warnings: '[]', error: null, created_at: null,
      }],
    );
    const { results } = await getLatestResearchResults();
    expect(results[0].todayActiveRuleIds).toBeNull();
  });

  test('T-033 — 빈 배열([])은 "충족 규칙 없음"이라는 관측 결과로 보존된다', async () => {
    mockQuery(
      [{ symbol: 'NAS:MU', name: null }],
      [{
        symbol: 'NAS:MU', market: 'overseas', run_date: '2026-08-19',
        data_range_from: null, data_range_to: null, event_count: 0,
        events: '[]', avg_rally_pct: null, avg_days_to_rally: null,
        precursor_analysis: null, today_active_rule_ids: '[]',
        data_warnings: '[]', error: null, created_at: null,
      }],
    );
    const { results } = await getLatestResearchResults();
    expect(results[0].todayActiveRuleIds).toEqual([]);
  });

  test('깨진 JSON 은 기본값으로 흡수하고 던지지 않는다', async () => {
    mockQuery(
      [{ symbol: '005930', name: null }],
      [{
        symbol: '005930', market: 'domestic', run_date: new Date(Date.UTC(2026, 7, 19)),
        data_range_from: null, data_range_to: null, event_count: 0,
        events: '{{{broken', avg_rally_pct: null, avg_days_to_rally: null,
        precursor_analysis: 'nope', data_warnings: null, error: null, created_at: null,
      }],
    );
    const { results } = await getLatestResearchResults();
    expect(results[0].events).toEqual([]);
    expect(results[0].precursorAnalysis).toBeNull();
    expect(results[0].dataWarnings).toEqual([]);
    expect(results[0].runDate).toBe('2026-08-19'); // Date 객체도 KST 날짜 문자열로 정규화
  });
});
