/**
 * T-087 — 원장 조회가 **실제 `kisFetch`**(스로틀·레이트리밋 백오프·본문 재생) 위에서 도는지 확인한다. 전역 `fetch` 만 가짜로 바꾼다(KIS 실호출 없음).
 *  - 레이트리밋(HTTP 500 + EGW00201): kisFetch 가 기본 2회 백오프 재시도한 뒤 포기 → 원장 조회는 **추가 재시도 없이** failed(rate_limited),
 *    호출 수 = 실제 HTTP 시도 3회(run 당 호출 상한에 그대로 반영).
 *  - 재생 응답에서도 `tr_cont` 헤더가 살아 있어 연속조회가 동작한다.
 */
// 스로틀이 유량 설정을 system_config 에서 읽으려 DB 풀을 연다 — 시험에서는 어떤 DB 에도 연결하지 않는다(실패 → 기본 유량, 스로틀 규약).
jest.mock('@/lib/db', () => ({ getPool: () => { throw new Error('no db in this test'); } }));
jest.mock('@/lib/exchanges/kis-auth', () => ({
  getKisToken:        jest.fn(async () => 'test-token'),
  invalidateKisToken: jest.fn(async () => 'test-token'),
  kisBaseUrl:         () => 'https://kis.example',
}));
jest.mock('@/lib/credentials', () => ({
  getCredential: jest.fn(async (k: string) => (k === 'KIS_ACCOUNT_NO' ? '99887766' : k === 'KIS_ACCOUNT_PRODUCT' ? '01' : 'x')),
}));

import * as dom from '@/lib/exchanges/kis-domestic';
import * as ovs from '@/lib/exchanges/kis-overseas';

const opts = { fingerprint: () => '0123456789abcdef', now: () => Date.parse('2026-11-05T10:00:00+09:00') };
const ORIG_FETCH = global.fetch;
const ORIG_MOCK = process.env.KIS_MOCK;
let fetchMock: jest.Mock;

beforeEach(() => {
  process.env.KIS_MOCK = 'false';
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); });
afterAll(() => {
  global.fetch = ORIG_FETCH;
  if (ORIG_MOCK === undefined) delete process.env.KIS_MOCK; else process.env.KIS_MOCK = ORIG_MOCK;
});

test('레이트리밋 소진 → failed(rate_limited), 실제 HTTP 시도 3회를 호출 수로 센다, 원장 쪽 재시도 없음', async () => {
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ rt_cd: '1', msg_cd: 'EGW00201', msg1: '초당 거래건수를 초과하였습니다.' }), { status: 500 }));
  const r = await dom.getDailyOrderFills({ from: '2026-11-01', to: '2026-11-05' }, opts);
  expect(r).toMatchObject({ outcome: 'failed', error: 'rate_limited', rateLimited: true, kisCalls: 3, pages: 0, rows: [] });
  expect(fetchMock).toHaveBeenCalledTimes(3);
}, 15_000);

test('재생 응답의 tr_cont 헤더로 연속조회(해외 체결 M → D)', async () => {
  fetchMock
    .mockResolvedValueOnce(new Response(JSON.stringify({ rt_cd: '0', output: [{ odno: '0000030001' }], ctx_area_fk200: 'F', ctx_area_nk200: 'N' }), { status: 200, headers: { tr_cont: 'M' } }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ rt_cd: '0', output: [{ odno: '0000030002' }] }), { status: 200, headers: { tr_cont: 'D' } }));
  const r = await ovs.getDailyOrderFills({ from: '2026-11-01', to: '2026-11-06' }, opts);
  expect(r).toMatchObject({ outcome: 'ended', pages: 2, kisCalls: 2, lastTrCont: 'D' });
  expect(r.rows.map((x) => x.odno)).toEqual(['0000030001', '0000030002']);
  const second = fetchMock.mock.calls[1] as [string, { headers: Record<string, string> }];
  expect(second[1].headers.tr_cont).toBe('N');
  expect(new URL(second[0]).searchParams.get('CTX_AREA_FK200')).toBe('F');
});
