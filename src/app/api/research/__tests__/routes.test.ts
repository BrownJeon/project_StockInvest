/**
 * /api/research/* + /api/favorites/[symbol]/research — 조회·토글 라우트 (T-032).
 */
import type { NextRequest } from 'next/server';

const getLatestMock = jest.fn();
const buildReportMock = jest.fn();
const queryMock = jest.fn();

jest.mock('@/lib/research/storage', () => ({ getLatestResearchResults: () => getLatestMock() }));
jest.mock('@/lib/research/research-report', () => ({
  buildResearchReport: (...a: unknown[]) => buildReportMock(...a),
}));
jest.mock('@/lib/db', () => ({ getPool: () => ({ query: (...a: unknown[]) => queryMock(...a) }) }));

function nextReq(url: string): NextRequest {
  return { nextUrl: new URL(url) } as unknown as NextRequest;
}

beforeEach(() => {
  getLatestMock.mockReset();
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
