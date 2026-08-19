/**
 * /api/research/* + /api/favorites/[symbol]/research — 조회·토글 라우트 (T-032).
 */
import type { NextRequest } from 'next/server';

const getLatestMock = jest.fn();
const listTrackedMock = jest.fn();
const upsertMock = jest.fn();
const buildReportMock = jest.fn();
const queryMock = jest.fn();

jest.mock('@/lib/research/storage', () => ({
  getLatestResearchResults: () => getLatestMock(),
  listTrackedSymbols: (...a: unknown[]) => listTrackedMock(...a),
  upsertResearchResult: (...a: unknown[]) => upsertMock(...a),
}));
jest.mock('@/lib/research/research-report', () => ({
  buildResearchReport: (...a: unknown[]) => buildReportMock(...a),
}));
jest.mock('@/lib/db', () => ({ getPool: () => ({ query: (...a: unknown[]) => queryMock(...a) }) }));

function nextReq(url: string): NextRequest {
  return { nextUrl: new URL(url) } as unknown as NextRequest;
}

beforeEach(() => {
  getLatestMock.mockReset();
  listTrackedMock.mockReset();
  upsertMock.mockReset();
  buildReportMock.mockReset();
  queryMock.mockReset();
});

describe('GET /api/research/tracked', () => {
  test('추적 심볼 순서를 유지하고 결과가 없으면 result:null', async () => {
    getLatestMock.mockResolvedValue({
      tracked: [
        { symbol: 'NAS:MU', name: 'Micron', market: 'overseas' },
        { symbol: '005930', name: '삼성전자', market: 'domestic' },
      ],
      results: [{ symbol: 'NAS:MU', eventCount: 3 }],
    });

    const { GET } = await import('../tracked/route');
    const body = await (await GET()).json();

    expect(body.ok).toBe(true);
    expect(body.data.map((d: { symbol: string }) => d.symbol)).toEqual(['NAS:MU', '005930']);
    expect(body.data[0].result.eventCount).toBe(3);
    expect(body.data[1].result).toBeNull();
  });

  test('조회 실패는 500', async () => {
    getLatestMock.mockRejectedValue(new Error('db down'));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { GET } = await import('../tracked/route');
    const res = await GET();
    expect(res.status).toBe(500);
    spy.mockRestore();
  });
});

describe('GET /api/research/rally-cycles', () => {
  test('symbol 이 없으면 400', async () => {
    const { GET } = await import('../rally-cycles/route');
    const res = await GET(nextReq('http://x/api/research/rally-cycles'));
    expect(res.status).toBe(400);
    expect(buildReportMock).not.toHaveBeenCalled();
  });

  test('🔴 지원하지 않는 심볼 포맷은 계산 전에 400 으로 막는다', async () => {
    const { GET } = await import('../rally-cycles/route');
    const res = await GET(nextReq('http://x/api/research/rally-cycles?symbol=' + encodeURIComponent('MU/../../etc')));
    expect(res.status).toBe(400);
    expect(buildReportMock).not.toHaveBeenCalled();
  });

  test('정상 심볼은 리포트를 계산하되 저장하지 않는다', async () => {
    buildReportMock.mockResolvedValue({ symbol: 'NAS:MU', eventCount: 2, error: null });
    const { GET } = await import('../rally-cycles/route');
    const body = await (await GET(nextReq('http://x/api/research/rally-cycles?symbol=NAS%3AMU'))).json();

    expect(buildReportMock).toHaveBeenCalledWith('NAS:MU');
    expect(body.ok).toBe(true);
    expect(body.persisted).toBe(false);
  });

  test('데이터 소스 실패는 502', async () => {
    buildReportMock.mockResolvedValue({ symbol: 'NAS:MU', error: 'yahoo down' });
    const { GET } = await import('../rally-cycles/route');
    const res = await GET(nextReq('http://x/api/research/rally-cycles?symbol=NAS%3AMU'));
    expect(res.status).toBe(502);
  });
});

describe('PATCH /api/favorites/[symbol]/research', () => {
  const params = (symbol: string) => Promise.resolve({ symbol });
  const jsonReq = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;

  test('enabled=true 로 플래그를 켠다', async () => {
    queryMock.mockResolvedValue([{ affectedRows: 1 }]);
    const { PATCH } = await import('@/app/api/favorites/[symbol]/research/route');
    const body = await (await PATCH(jsonReq({ enabled: true }), { params: params('NAS%3AMU') })).json();

    const [sql, args] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(String(sql)).toMatch(/UPDATE stock_favorites SET research_enabled/);
    expect(args).toEqual([1, 'NAS:MU']);
    expect(body).toEqual({ ok: true, data: { symbol: 'NAS:MU', enabled: true } });
  });

  test('enabled=false 로 끈다', async () => {
    queryMock.mockResolvedValue([{ affectedRows: 1 }]);
    const { PATCH } = await import('@/app/api/favorites/[symbol]/research/route');
    await PATCH(jsonReq({ enabled: false }), { params: params('005930') });
    expect((queryMock.mock.calls[0] as [string, unknown[]])[1]).toEqual([0, '005930']);
  });

  test('boolean 이 아닌 enabled 는 400', async () => {
    const { PATCH } = await import('@/app/api/favorites/[symbol]/research/route');
    for (const bad of [undefined, 'true', 1, null]) {
      const res = await PATCH(jsonReq({ enabled: bad }), { params: params('005930') });
      expect(res.status).toBe(400);
    }
    expect(queryMock).not.toHaveBeenCalled();
  });

  test('🔴 지원하지 않는 심볼은 DB 를 건드리기 전에 400', async () => {
    const { PATCH } = await import('@/app/api/favorites/[symbol]/research/route');
    const res = await PATCH(jsonReq({ enabled: true }), { params: params('bogus symbol') });
    expect(res.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  test('즐겨찾기에 없는 종목은 404', async () => {
    queryMock
      .mockResolvedValueOnce([{ affectedRows: 0 }])
      .mockResolvedValueOnce([[]]);
    const { PATCH } = await import('@/app/api/favorites/[symbol]/research/route');
    const res = await PATCH(jsonReq({ enabled: true }), { params: params('005930') });
    expect(res.status).toBe(404);
  });

  test('값이 이미 같아 affectedRows=0 이어도 행이 있으면 성공', async () => {
    queryMock
      .mockResolvedValueOnce([{ affectedRows: 0 }])
      .mockResolvedValueOnce([[{ 1: 1 }]]);
    const { PATCH } = await import('@/app/api/favorites/[symbol]/research/route');
    const res = await PATCH(jsonReq({ enabled: true }), { params: params('005930') });
    expect(res.status).toBe(200);
  });
});

describe('POST /api/research/tracked/[symbol]/run', () => {
  const params = (symbol: string) => Promise.resolve({ symbol });
  const emptyReq = () => ({}) as unknown as NextRequest;

  test('추적중 심볼은 재분석 후 upsert하고 결과를 반환한다', async () => {
    listTrackedMock.mockResolvedValue([{ symbol: 'NAS:MU', name: 'Micron', market: 'overseas' }]);
    buildReportMock.mockResolvedValue({
      symbol: 'NAS:MU', market: 'overseas', runDate: '2026-08-20',
      eventCount: 8, avgRallyPct: 23.25, error: null,
    });

    const { POST } = await import('../tracked/[symbol]/run/route');
    const res = await POST(emptyReq(), { params: params('NAS%3AMU') });
    const body = await res.json();

    // cron 경로와 동일하게 심볼당 fetch 타임아웃(PER_FETCH_TIMEOUT_MS)을 넘긴다 — 8초 상한 이중화.
    expect(buildReportMock).toHaveBeenCalledWith('NAS:MU', { history: { timeoutMs: 6000 } });
    expect(upsertMock).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'NAS:MU', eventCount: 8 }));
    expect(body.ok).toBe(true);
    expect(body.data.name).toBe('Micron');
    expect(body.data.result.eventCount).toBe(8);
  });

  test('추적(research_enabled=1) 중이 아닌 심볼은 계산 없이 404', async () => {
    listTrackedMock.mockResolvedValue([{ symbol: '005930', name: '삼성전자', market: 'domestic' }]);
    const { POST } = await import('../tracked/[symbol]/run/route');
    const res = await POST(emptyReq(), { params: params('NAS%3AMU') });

    expect(res.status).toBe(404);
    expect(buildReportMock).not.toHaveBeenCalled();
    expect(upsertMock).not.toHaveBeenCalled();
  });

  test('빈 심볼은 400', async () => {
    const { POST } = await import('../tracked/[symbol]/run/route');
    const res = await POST(emptyReq(), { params: params('') });
    expect(res.status).toBe(400);
    expect(listTrackedMock).not.toHaveBeenCalled();
  });

  test('🔴 buildResearchReport가 무한정 걸리면 8초 상한에서 타임아웃 처리한다(무한 대기 금지)', async () => {
    jest.useFakeTimers();
    listTrackedMock.mockResolvedValue([{ symbol: 'NAS:MU', name: 'Micron', market: 'overseas' }]);
    buildReportMock.mockImplementation(() => new Promise(() => {})); // 영원히 끝나지 않음
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { POST } = await import('../tracked/[symbol]/run/route');
    const resPromise = POST(emptyReq(), { params: params('NAS%3AMU') });
    await jest.advanceTimersByTimeAsync(8010); // SYMBOL_TIMEOUT_MS + 여유
    const res = await resPromise;

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/timeout after/);
    expect(upsertMock).not.toHaveBeenCalled();
    spy.mockRestore();
    jest.useRealTimers();
  });

  test('계산 실패는 500이고 upsert를 호출하지 않는다', async () => {
    listTrackedMock.mockResolvedValue([{ symbol: 'NAS:MU', name: 'Micron', market: 'overseas' }]);
    buildReportMock.mockRejectedValue(new Error('yahoo timeout'));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { POST } = await import('../tracked/[symbol]/run/route');
    const res = await POST(emptyReq(), { params: params('NAS%3AMU') });

    expect(res.status).toBe(500);
    expect(upsertMock).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
