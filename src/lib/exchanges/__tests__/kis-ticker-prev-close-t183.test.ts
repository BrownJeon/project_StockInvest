/**
 * T-183 — 시세(`getTicker`)가 **전일 종가**(`prevClose`)를 노출한다. 거시 하락 게이트의 「전일 종가 대비」 기준이다.
 *
 * - 국내: `stck_sdpr`(기준가 = 전일 종가). 2026-11-20 069500 실측 `stck_prpr 76210 · stck_oprc 77370 · stck_sdpr 80630`.
 * - 해외: `base`(전일 종가) × 환율. 2026-11-20 AMS:SPY 실측 `last 709.87 · base 715.87`, `open` 필드 없음.
 * - 값이 없거나 0·NaN·빈 문자열이면 `undefined` — 0 을 넣지 않는다(NYS:SPY 는 `rt_cd=0` 에 전 필드 빈 값이었다).
 * - `open24h` 의 의미는 바꾸지 않는다(국내=당일 시가·해외=open 없으면 base) — 포트폴리오·즐겨찾기 화면이 쓴다.
 *
 * 모의 구조는 kis-ticker-business-failure.test.ts 와 같다.
 */
jest.mock('../kis-auth', () => ({
  getKisToken:        jest.fn(async () => 'tok'),
  invalidateKisToken: jest.fn(async () => {}),
  kisBaseUrl:         jest.fn(() => 'https://mock-base'),
}));
jest.mock('@/lib/credentials', () => ({
  getCredential: jest.fn(async (key: string) => (key === 'KIS_ACCOUNT_NO' ? '12345678' : '01')),
}));
jest.mock('../kis-http', () => ({
  kisFetch:         jest.fn(),
  isKisRateLimited: jest.fn(() => false),
  kisBodyText:      jest.fn(() => ''),
}));
jest.mock('../fx', () => ({ getUsdKrwRate: jest.fn(async () => FX) }));

import { kisFetch } from '../kis-http';
import { getTicker as domGetTicker } from '../kis-domestic';
import { getTicker as ovsGetTicker } from '../kis-overseas';

const FX = 1332.1;

function ok200(body: unknown) {
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) };
}
const respond = (output: Record<string, string>) => (kisFetch as jest.Mock).mockResolvedValue(ok200({ rt_cd: '0', output }));

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('국내 getTicker — prevClose = stck_sdpr', () => {
  test('🔴 실측 모양: prevClose 80630, open24h 는 종전대로 당일 시가 77370', async () => {
    respond({ stck_prpr: '76210', stck_oprc: '77370', stck_sdpr: '80630', stck_hgpr: '78000', stck_lwpr: '75000', acml_vol: '1', acml_tr_pbmn: '1' });
    const t = await domGetTicker('069500');
    expect(t.prevClose).toBe(80630);
    expect(t.open24h).toBe(77370);
    expect(t.price).toBe(76210);
  });

  test.each([
    ['필드 없음', undefined],
    ['빈 문자열', ''],
    ['0', '0'],
    ['숫자 아님', 'abc'],
  ])('%s → undefined (0 을 넣지 않는다)', async (_d, sdpr) => {
    const output: Record<string, string> = { stck_prpr: '76210', stck_oprc: '77370' };
    if (sdpr !== undefined) output.stck_sdpr = sdpr;
    respond(output);
    const t = await domGetTicker('069500');
    expect(t.prevClose).toBeUndefined();
  });
});

describe('해외 getTicker — prevClose = base × 환율', () => {
  test('🔴 실측 모양(open 없음): prevClose = 715.87 × FX, open24h 도 종전대로 base 로 채워진다', async () => {
    respond({ last: '709.87', base: '715.87', high: '712', low: '708', tvol: '10', tamt: '7000' });
    const t = await ovsGetTicker('AMS:SPY');
    expect(t.prevClose).toBeCloseTo(715.87 * FX, 6);
    expect(t.open24h).toBeCloseTo(715.87 * FX, 6);
    expect(t.price).toBeCloseTo(709.87 * FX, 6);
  });

  test('open 이 있으면 open24h 는 open(종전), prevClose 는 base — 둘은 다른 값이다', async () => {
    respond({ last: '709.87', open: '712.58', base: '715.87' });
    const t = await ovsGetTicker('AMS:SPY');
    expect(t.open24h).toBeCloseTo(712.58 * FX, 6);
    expect(t.prevClose).toBeCloseTo(715.87 * FX, 6);
  });

  test.each([
    ['필드 없음', undefined],
    ['빈 문자열(NYS:SPY 실측 모양)', ''],
    ['0', '0'],
    ['숫자 아님', 'abc'],
  ])('%s → undefined', async (_d, base) => {
    const output: Record<string, string> = { last: '709.87' };
    if (base !== undefined) output.base = base;
    respond(output);
    const t = await ovsGetTicker('AMS:SPY');
    expect(t.prevClose).toBeUndefined();
  });

  test('NYS:SPY 실측 모양(전 필드 빈 문자열) — price 0, prevClose undefined', async () => {
    respond({ rsym: '', zdiv: '', base: '', pvol: '', last: '', sign: '', diff: '', rate: '', tvol: '', tamt: '', ordy: '' });
    const t = await ovsGetTicker('NYS:SPY');
    expect(t.price).toBe(0);
    expect(t.prevClose).toBeUndefined();
  });
});
