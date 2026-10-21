/**
 * /api/fundamentals/[symbol] 해외 분기 (T-059 Part A, R-1 반영).
 *  - 해외: 기존 LLM 경로·`data`·`cached`·`stock_fundamentals` 캐시 동작은 그대로. 스냅샷이 있으면 **별도 필드 `observed`** 에
 *    관측 원값을 덧붙일 뿐이고, 새 코드는 `stock_fundamentals` 를 쓰지 않는다.
 *  - 스냅샷 없음/테이블 없음 → `observed:false`. 그 밖의 조회 실패 → `observed:false` + `observed_error`(기존 경로는 막지 않음).
 *  - 국내 → 스냅샷을 조회하지 않고 응답 형식 불변(observed 키 없음).
 */
const llmMock = jest.fn();
const queries: Array<{ sql: string; params: unknown[] }> = [];
let snapshotBehavior: 'row' | 'empty' | 'no_table' | 'error' = 'row';
let cacheRow: Record<string, unknown> | undefined;

jest.mock('@/lib/llm/provider', () => ({ runLlm: (...a: unknown[]) => llmMock(...a) }));
jest.mock('@/lib/exchanges/kis', () => ({ kis: { getTicker: jest.fn(async () => ({ price: 1 })) } }));
jest.mock('@/lib/db', () => ({
  getPool: () => ({
    query: async (sql: string, params: unknown[] = []) => {
      const s = sql.replace(/\s+/g, ' ').trim();
      queries.push({ sql: s, params });
      if (s.includes('FROM us_fundamentals_snapshot')) {
        if (snapshotBehavior === 'no_table') throw Object.assign(new Error("Table 'x.us_fundamentals_snapshot' doesn't exist"), { code: 'ER_NO_SUCH_TABLE', errno: 1146 });
        if (snapshotBehavior === 'error') throw Object.assign(new Error('connection lost'), { code: 'PROTOCOL_CONNECTION_LOST' });
        if (snapshotBehavior === 'empty') return [[], undefined];
        return [[{
          symbol: 'NAS:INTC', per: '-12.340000', pbr: '1.560000', eps: '-2.930000', bps: '23.100000',
          market_cap: '157000000000.0000', shares: '4361000000.00', h52: '42.5', l52: '18.1', last_price: '36.12',
          currency: 'USD', sector: '반도체', etp_type: null, observed_at: '2026-10-22T08:05:00.000Z',
        }], undefined];
      }
      if (s.startsWith('SELECT * FROM stock_fundamentals')) return [cacheRow ? [cacheRow] : [], undefined];
      if (s.startsWith('SELECT name FROM stock_meta')) return [[{ name: 'Intel' }], undefined];
      return [{ affectedRows: 1 }, undefined];
    },
  }),
}));

import { GET } from '../[symbol]/route';

const call = (symbol: string) => GET(new Request(`http://x/api/fundamentals/${symbol}`), { params: Promise.resolve({ symbol }) });
const LLM_JSON = JSON.stringify({ pbr: 1.1, per: 9.9, eps: 100, market_cap_bn: 5000, dividend_yield: 2, roe: 10, key_factors: [], ai_summary: '요약' });
const fundWrites = () => queries.filter((q) => /^(INSERT|UPDATE|DELETE)/.test(q.sql) && q.sql.includes('stock_fundamentals'));

beforeEach(() => {
  llmMock.mockReset();
  llmMock.mockResolvedValue(LLM_JSON);
  queries.length = 0;
  snapshotBehavior = 'row';
  cacheRow = undefined;
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

test('🔴 해외 + 스냅샷 있음 → data 는 기존 LLM 경로 그대로, 관측값은 별도 observed 필드(원값·observed_at·kis_price_detail)', async () => {
  const body = await (await call('NAS:INTC')).json();
  expect(llmMock).toHaveBeenCalledTimes(1);                         // 기존 경로 불변
  expect(body.ok).toBe(true);
  expect(body.cached).toBe(false);
  expect(body.data).toMatchObject({ symbol: 'NAS:INTC', per: 9.9, roe: 10, market_cap_bn: 5000, data_source: 'claude_ai' });
  expect(body.observed).toEqual({
    per: -12.34, pbr: 1.56, eps: -2.93, bps: 23.1, market_cap_raw: 157000000000, shares: 4361000000,
    high_52w: 42.5, low_52w: 18.1, last_price: 36.12, currency: 'USD', sector: '반도체', etp_type: null,
    observed_at: '2026-10-22T08:05:00.000Z', data_source: 'kis_price_detail',
  });
  // 새 코드는 stock_fundamentals 를 쓰지 않는다 — 쓰기는 기존 LLM 캐시 저장 1회(claude_ai)뿐
  const w = fundWrites();
  expect(w).toHaveLength(1);
  expect(w[0].params).toContain('claude_ai');
  expect(w[0].params).not.toContain('kis_price_detail');
});

test('🔴 (R-1) 해외 + 신선한 LLM 캐시 → 캐시 행을 그대로 돌려주고(ROE 등 유지) observed 만 덧붙인다, stock_fundamentals 쓰기 0', async () => {
  cacheRow = { symbol: 'NAS:INTC', pbr: 9, per: 9, roe: 9, ai_summary: '옛 요약', data_source: 'claude_ai', updated_at: new Date().toISOString() };
  const body = await (await call('NAS:INTC')).json();
  expect(body).toMatchObject({ ok: true, cached: true, data: cacheRow });
  expect(body.observed).toMatchObject({ per: -12.34, data_source: 'kis_price_detail' });
  expect(llmMock).not.toHaveBeenCalled();
  expect(fundWrites()).toHaveLength(0);
});

test.each(['empty', 'no_table'] as const)('해외 + 스냅샷 %s → 기존 LLM 경로, observed:false', async (b) => {
  snapshotBehavior = b;
  const body = await (await call('NAS:INTC')).json();
  expect(llmMock).toHaveBeenCalledTimes(1);
  expect(body).toMatchObject({ ok: true, observed: false, cached: false });
  expect(body.observed_error).toBeUndefined();
  expect(body.data.data_source).toBe('claude_ai');
});

test('해외 + 스냅샷 조회가 테이블 없음 외 이유로 실패 → 기존 경로는 그대로, observed:false + observed_error', async () => {
  snapshotBehavior = 'error';
  const res = await call('NAS:INTC');
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(llmMock).toHaveBeenCalledTimes(1);
  expect(body).toMatchObject({ ok: true, observed: false, observed_error: 'snapshot_read_failed' });
});

test('해외 + LLM 실패·캐시 없음 → 기존 claude_unavailable 응답에 observed 만 덧붙음', async () => {
  llmMock.mockResolvedValue('not json');
  const body = await (await call('NAS:INTC')).json();
  expect(body).toMatchObject({ ok: false, error: 'claude_unavailable' });
  expect(body.observed).toMatchObject({ data_source: 'kis_price_detail' });
  expect(fundWrites()).toHaveLength(0);
});

test('🔴 국내 심볼은 스냅샷을 조회하지 않고 응답 형식이 그대로다(observed 키 없음)', async () => {
  const body = await (await call('005930')).json();
  expect(queries.some((q) => q.sql.includes('us_fundamentals_snapshot'))).toBe(false);
  expect(llmMock).toHaveBeenCalledTimes(1);
  expect(body).toEqual({ ok: true, data: expect.objectContaining({ symbol: '005930', data_source: 'claude_ai' }), cached: false });
  expect('observed' in body).toBe(false);

  cacheRow = { symbol: '005930', pbr: 1, per: 2, roe: 3, data_source: 'claude_ai', updated_at: new Date().toISOString() };
  const cached = await (await call('005930')).json();
  expect(cached).toEqual({ ok: true, data: cacheRow, cached: true });
});
