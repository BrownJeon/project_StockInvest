/**
 * T-070 KIS 일봉 한 페이지 — 요청 매개변수(수정주가·일봉·커서), USD 원값 파싱, 오류 분류, bulk 레인.
 * 실제 KIS 호출 없음: kis-http·kis-auth·credentials 는 mock(합성 응답만).
 */
const kisFetchMock = jest.fn();
const rateLimitedMock = jest.fn<boolean, [Response]>(() => false);
const tokenMock = jest.fn(async () => 'TOKEN');

jest.mock('@/lib/exchanges/kis-http', () => ({
  kisFetch: (...a: unknown[]) => kisFetchMock(...a),
  isKisRateLimited: (r: Response) => rateLimitedMock(r),
}));
jest.mock('@/lib/exchanges/kis-auth', () => ({
  getKisToken: () => tokenMock(),
  kisBaseUrl: () => 'https://kis.example',
  invalidateKisToken: () => { throw new Error('토큰 재발급 금지'); },
}));
jest.mock('@/lib/credentials', () => ({ getCredential: async (k: string) => `cred-${k}` }));

import {
  buildDailyUrl, DOMESTIC_DAILY_TR, fetchKisDailyPage, KisDailyError, OVERSEAS_DAILY_TR, parseDomesticRows, parseOverseasRows,
  type PageRequest,
} from '../daily-bars-kis';

const kst = (s: string) => new Date(`${s.replace(' ', 'T')}:00+09:00`);
const q = (url: string) => Object.fromEntries(new URL(url).searchParams.entries());

const usReq = (extra: Partial<PageRequest> = {}): PageRequest => ({
  market: 'US', symbol: 'NAS:MU', endDate: null, stopAt: '2023-10-22', adjMode: 'adjusted', ...extra,
});
const krReq = (extra: Partial<PageRequest> = {}): PageRequest => ({
  market: 'KR', symbol: '005930', endDate: null, stopAt: '2023-10-22', adjMode: 'adjusted', ...extra,
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  kisFetchMock.mockReset();
  rateLimitedMock.mockReset().mockReturnValue(false);
  tokenMock.mockClear();
});

describe('buildDailyUrl — 요청 매개변수', () => {
  test('해외: 일봉(GUBN=0)·수정주가(MODP=1)·기준일 빈값=오늘', () => {
    const r = buildDailyUrl(usReq());
    expect(r.trId).toBe(OVERSEAS_DAILY_TR);
    expect(r.url.startsWith('https://kis.example/uapi/overseas-price/v1/quotations/dailyprice?')).toBe(true);
    expect(q(r.url)).toEqual({ AUTH: '', EXCD: 'NAS', SYMB: 'MU', GUBN: '0', BYMD: '', MODP: '1' });
    expect(r.coveredFrom).toBeNull();
  });
  test('해외: 커서는 BYMD(YYYYMMDD), 원주가 모드는 MODP=0', () => {
    expect(q(buildDailyUrl(usReq({ endDate: '2026-05-29', adjMode: 'raw' })).url)).toMatchObject({ BYMD: '20260529', MODP: '0' });
  });
  test('국내: 기간 = [max(stopAt, end−139일), end], 수정주가 FID_ORG_ADJ_PRC=0', () => {
    const r = buildDailyUrl(krReq({ endDate: '2026-10-21' }));
    expect(r.trId).toBe(DOMESTIC_DAILY_TR);
    expect(q(r.url)).toEqual({
      FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: '005930', FID_INPUT_DATE_1: '20260604', FID_INPUT_DATE_2: '20261021',
      FID_PERIOD_DIV_CODE: 'D', FID_ORG_ADJ_PRC: '0',
    });
    expect(r.coveredFrom).toBe('2026-06-04');
  });
  test('국내: stopAt 이 더 가까우면 그날부터, end 없음은 KST 오늘, 원주가는 1', () => {
    const r = buildDailyUrl(krReq({ stopAt: '2026-10-01', adjMode: 'raw' }), kst('2026-10-22 16:00'));
    expect(q(r.url)).toMatchObject({ FID_INPUT_DATE_1: '20261001', FID_INPUT_DATE_2: '20261022', FID_ORG_ADJ_PRC: '1' });
    expect(r.coveredFrom).toBe('2026-10-01');
  });
});

describe('행 파싱 — 현지 통화 원값(환산 없음)', () => {
  test('해외 output2: 가격·거래량·거래대금을 그대로, 빈 행은 건너뜀', () => {
    const r = parseOverseasRows([
      { xymd: '20261021', clos: '187.4500', open: '185.1000', high: '188.0000', low: '184.2000', tvol: '20123456', tamt: '3765432100' },
      { xymd: '', clos: '' },
      { xymd: '20261020', clos: '0', open: '1', high: '1', low: '1', tvol: '1', tamt: '1' },
    ]);
    expect(r.rows).toEqual([{ tradeDate: '2026-10-21', open: 185.1, high: 188, low: 184.2, close: 187.45, volume: 20123456, turnover: 3765432100 }]);
    expect(r.rawCount).toBe(3);
    expect(r.dropped).toBe(1);
  });
  test('국내 output2: 원 단위 그대로', () => {
    const r = parseDomesticRows([
      { stck_bsop_date: '20261021', stck_oprc: '60000', stck_hgpr: '61000', stck_lwpr: '59500', stck_clpr: '60500', acml_vol: '1234567', acml_tr_pbmn: '74000000000' },
    ]);
    expect(r.rows[0]).toEqual({ tradeDate: '2026-10-21', open: 60000, high: 61000, low: 59500, close: 60500, volume: 1234567, turnover: 74000000000 });
  });
  test('(R-5) 날짜 없는 비어 있지 않은 행은 dropped, 전부 빈 행은 건너뜀', () => {
    expect(parseOverseasRows([{ ymd: '20261021', clos: '10' }, { xymd: '', clos: '', tvol: '' }])).toEqual({ rows: [], rawCount: 2, dropped: 1 });
    expect(parseDomesticRows([{ bsop_date: '20261021', stck_clpr: '1' }])).toMatchObject({ rows: [], dropped: 1 });
  });
  test('output2 가 배열이 아니면 빈 결과', () => {
    expect(parseOverseasRows(undefined)).toEqual({ rows: [], rawCount: 0, dropped: 0 });
  });
});

describe('fetchKisDailyPage — 호출·오류 분류', () => {
  test('bulk 레인·타임아웃·헤더(tr_id·토큰 캐시) 로 부르고 행을 돌려준다', async () => {
    kisFetchMock.mockResolvedValue(json({ rt_cd: '0', output2: [{ xymd: '20261021', clos: '10', open: '9', high: '11', low: '8', tvol: '5', tamt: '50' }] }));
    const r = await fetchKisDailyPage(usReq());
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].close).toBe(10);
    const [url, init, opts] = kisFetchMock.mock.calls[0];
    expect(String(url)).toContain('/dailyprice?');
    expect(init.headers).toMatchObject({ tr_id: OVERSEAS_DAILY_TR, Authorization: 'Bearer TOKEN', appkey: 'cred-KIS_APP_KEY', custtype: 'P' });
    expect(init.method).toBeUndefined();   // GET
    expect(opts).toMatchObject({ priority: 'bulk', timeoutMs: 10_000 });
  });
  test('레이트리밋(백오프 소진) → rate_limited', async () => {
    kisFetchMock.mockResolvedValue(json({ rt_cd: '1', msg_cd: 'EGW00201' }, 500));
    rateLimitedMock.mockReturnValue(true);
    await expect(fetchKisDailyPage(usReq())).rejects.toMatchObject({ name: 'KisDailyError', kind: 'rate_limited' });
  });
  test('401·토큰 만료 msg_cd → auth (재발급하지 않는다)', async () => {
    kisFetchMock.mockResolvedValueOnce(json({}, 401));
    await expect(fetchKisDailyPage(usReq())).rejects.toMatchObject({ kind: 'auth' });
    kisFetchMock.mockResolvedValueOnce(json({ rt_cd: '1', msg_cd: 'EGW00123' }, 500));
    await expect(fetchKisDailyPage(usReq())).rejects.toMatchObject({ kind: 'auth' });
  });
  test('업무 실패 rt_cd≠0 → rt_cd, 5xx 비JSON → http', async () => {
    kisFetchMock.mockResolvedValueOnce(json({ rt_cd: '7', msg_cd: 'APBK0001' }));
    await expect(fetchKisDailyPage(usReq())).rejects.toThrow(/kis_daily_rt_cd: rt_cd=7 msg_cd=APBK0001/);
    kisFetchMock.mockResolvedValueOnce(new Response('oops', { status: 502 }));
    const e = await fetchKisDailyPage(usReq()).catch((x) => x);
    expect(e).toBeInstanceOf(KisDailyError);
    expect(e.kind).toBe('http');
  });
  test('(R-5) 행은 왔는데 하나도 해석 못 하면 parse 오류, 전부 빈 행이면 빈 페이지', async () => {
    kisFetchMock.mockResolvedValueOnce(json({ rt_cd: '0', output2: [{ ymd: '20261021', close: '10' }] }));
    await expect(fetchKisDailyPage(usReq())).rejects.toMatchObject({ kind: 'parse' });
    kisFetchMock.mockResolvedValueOnce(json({ rt_cd: '0', output2: [{ xymd: '', clos: '' }] }));
    await expect(fetchKisDailyPage(usReq())).resolves.toMatchObject({ rows: [], rawCount: 1, dropped: 0 });
  });
  test('유량 대기 실패는 그대로 던진다(호출자가 실행을 멈춘다)', async () => {
    const err = Object.assign(new Error('queue full'), { name: 'KisThrottleQueueFullError' });
    kisFetchMock.mockRejectedValue(err);
    await expect(fetchKisDailyPage(krReq())).rejects.toBe(err);
  });
  test('국내 응답은 coveredFrom(요청 기간 시작일)을 함께 준다', async () => {
    kisFetchMock.mockResolvedValue(json({ rt_cd: '0', output2: [] }));
    const r = await fetchKisDailyPage(krReq({ endDate: '2026-10-21' }));
    expect(r).toEqual({ rows: [], rawCount: 0, dropped: 0, coveredFrom: '2026-06-04' });
  });
});
