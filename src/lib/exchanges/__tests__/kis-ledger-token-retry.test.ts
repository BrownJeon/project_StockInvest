/**
 * T-136 — 원장 조회(`ledgerPage`)의 토큰 분기. **실제 `kisFetch`** 위에서 돌린다(전역 `fetch` 만 가짜).
 *
 * 이 파일이 따로 있는 이유: 감사 H-1 이 여기서 나왔다. 원장 사이트만 `!tokenRetried` 가드를 헬퍼
 * **뒤에** 두고 있어서, 재발급 뒤 또 토큰 오류가 나면 `invalidateKisToken()` 이 **두 번** 불렸다.
 * 그 두 번째 재발급이 KIS 의 "앱키당 1분 1회"(`EGW00133`)에 걸리면 `kis-auth.issueAndStore` 가 60초를
 * 기다리고, 그동안 같은 프로세스의 모든 `getKisToken()`(주문 경로 포함)이 막힌다 — 이 task 가 없애려던
 * 증상을 원장 경로에 새로 만드는 셈이었다.
 *
 * 그래서 이 파일의 핵심 단언은 "복구했는가" 가 아니라 **`invalidateKisToken` 호출 횟수**다.
 * 기존 시험들이 그 횟수를 세지 않아서 H-1 이 668건 전부 통과 상태로 숨어 있었다(감사 지적).
 */
jest.mock('@/lib/db', () => ({ getPool: () => { throw new Error('no db in this test'); } }));
jest.mock('@/lib/exchanges/kis-auth', () => ({
  getKisToken:        jest.fn(async () => tokenValue),
  invalidateKisToken: jest.fn(async () => { tokenValue = 'reissued'; return tokenValue; }),
  kisBaseUrl:         () => 'https://kis.example',
}));
jest.mock('@/lib/credentials', () => ({
  getCredential: jest.fn(async (k: string) =>
    (k === 'KIS_ACCOUNT_NO' ? '99887766' : k === 'KIS_ACCOUNT_PRODUCT' ? '01' : 'x')),
}));

import * as dom from '@/lib/exchanges/kis-domestic';

let tokenValue = 'test-token';

const opts = { fingerprint: () => '0123456789abcdef', now: () => Date.parse('2026-11-05T10:00:00+09:00') };
const RANGE = { from: '2026-11-01', to: '2026-11-05' };
const EXPIRED = JSON.stringify({ rt_cd: '1', msg_cd: 'EGW00123', msg1: '기간이 만료된 token 입니다.' });
const INVALID = JSON.stringify({ rt_cd: '1', msg_cd: 'EGW00121', msg1: '유효하지 않은 token 입니다.' });
const OK      = JSON.stringify({ rt_cd: '0', output1: [{ odno: '0000030001' }] });

const ORIG_FETCH = global.fetch;
const ORIG_MOCK = process.env.KIS_MOCK;
let fetchMock: jest.Mock;

const authMocks = () =>
  jest.requireMock('@/lib/exchanges/kis-auth') as { getKisToken: jest.Mock; invalidateKisToken: jest.Mock };
const authOf = (n: number): string | undefined =>
  (fetchMock.mock.calls[n]?.[1] as { headers?: Record<string, string> } | undefined)?.headers?.Authorization;

beforeEach(() => {
  jest.clearAllMocks();
  tokenValue = 'test-token';
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

test('토큰 만료 1회 → 재발급 후 재시도로 복구한다 (재발급 1회, 재시도는 새 토큰으로)', async () => {
  const { invalidateKisToken } = authMocks();
  fetchMock
    .mockResolvedValueOnce(new Response(EXPIRED, { status: 500 }))
    .mockResolvedValueOnce(new Response(OK, { status: 200, headers: { tr_cont: 'D' } }));
  const r = await dom.getDailyOrderFills(RANGE, opts);
  expect(r).toMatchObject({ outcome: 'ended' });
  expect(invalidateKisToken).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(authOf(0)).toBe('Bearer test-token');
  expect(authOf(1)).toBe('Bearer reissued');
});

test('🔴 토큰 만료가 두 번이어도 재발급은 **1회**다 (감사 H-1 회귀 가드)', async () => {
  const { invalidateKisToken } = authMocks();
  fetchMock.mockImplementation(async () => new Response(EXPIRED, { status: 500 }));
  const r = await dom.getDailyOrderFills(RANGE, opts);
  expect(r).toMatchObject({ outcome: 'failed', error: 'http_500' });
  // 가드를 헬퍼 뒤로 되돌리면 여기서 2가 된다 — 그 두 번째가 EGW00133 60초 대기를 부른다.
  expect(invalidateKisToken).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test('🔴 EGW00121 도 토큰 분기로 간다 (예전 자체 정규식은 EGW00123 만 봤다)', async () => {
  const { invalidateKisToken } = authMocks();
  fetchMock
    .mockResolvedValueOnce(new Response(INVALID, { status: 500 }))
    .mockResolvedValueOnce(new Response(OK, { status: 200, headers: { tr_cont: 'D' } }));
  await expect(dom.getDailyOrderFills(RANGE, opts)).resolves.toMatchObject({ outcome: 'ended' });
  expect(invalidateKisToken).toHaveBeenCalledTimes(1);
  expect(authOf(1)).toBe('Bearer reissued');
});

test('🔴 다른 프로세스가 회전시켜 뒀으면 재발급하지 않는다 (M-2 회귀 가드)', async () => {
  const { invalidateKisToken } = authMocks();
  fetchMock
    .mockImplementationOnce(async () => { tokenValue = 'rotated'; return new Response(EXPIRED, { status: 500 }); })
    .mockResolvedValueOnce(new Response(OK, { status: 200, headers: { tr_cont: 'D' } }));
  await expect(dom.getDailyOrderFills(RANGE, opts)).resolves.toMatchObject({ outcome: 'ended' });
  expect(invalidateKisToken).not.toHaveBeenCalled();
  expect(authOf(1)).toBe('Bearer rotated');
});

test('토큰 오류가 아닌 실패는 토큰 분기를 타지 않는다 (재발급 0회)', async () => {
  const { invalidateKisToken } = authMocks();
  fetchMock.mockImplementation(async () =>
    new Response(JSON.stringify({ rt_cd: '1', msg_cd: 'EGW00300', msg1: 'Gateway 라우팅 오류' }), { status: 500 }));
  const r = await dom.getDailyOrderFills(RANGE, opts);
  expect(r).toMatchObject({ outcome: 'failed', error: 'http_500' });
  expect(invalidateKisToken).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledTimes(1);   // 원장은 `transientRetries` 를 켜지 않는다
});
