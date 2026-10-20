/**
 * T-056 — 포트폴리오 평가액을 시장별 **상태**로 돌려준다 (Codex C1-2).
 *
 *  - USD 예수금 unknown → 해외 `unknown(usd_cash_unknown)`. **보유만으로 과소 계상하지 않는다**(그것도 "모르는 값 = 0" 의 변형, Q5).
 *  - USD 환산 실패 → 해외 `unknown(fx_unavailable)`.
 *  - 위 두 경우 **캐시 폴백 금지** — 직전 정상값이 있어도 되살리지 않는다(예전: total 0 + 캐시 → 직전 양수 한도 부활).
 *  - 잔고(보유) 조회 실패의 직전값 폴백은 기존 동작 그대로(범위 밖, 설계 R5). 단 더 새로운 판정이 "모름"이면 그 시장 직전값은 지운다.
 *  - 국내는 해외 현금 상태와 무관하게 그대로. Q3: KRW 요약이 없으면 국내 `unknown(krw_cash_unknown)`.
 */
const getBalancesDetailed = jest.fn();
const getTicker = jest.fn();
const usdToKrw = jest.fn();
jest.mock('@/lib/exchanges/kis', () => ({
  getBalancesDetailed: (...a: unknown[]) => getBalancesDetailed(...a),
  kis: { getTicker: (...a: unknown[]) => getTicker(...a) },
}));
jest.mock('@/lib/exchanges/fx', () => ({ usdToKrw: (...a: unknown[]) => usdToKrw(...a) }));

import {
  getPortfolioTotalsKRW, getMarketTotal, getPortfolioTotalState, clearPortfolioTotalCache,
} from '@/lib/safety/portfolio-total';

const KNOWN = (usd: number) => ({ state: 'known', usd, source: 'CTRP6504R', ustlSllAmtSmtl: 0 });
function detailed(opts: { usd?: unknown; overseasEnabled?: boolean; krw?: boolean; complete?: boolean } = {}) {
  return {
    balances: [
      ...(opts.krw === false ? [] : [{ currency: 'KRW', free: 80_000, locked: 0 }]),
      { currency: '005930', free: 10, locked: 0 },
      { currency: 'NAS:STK1', free: 2, locked: 0 },
    ],
    ok: opts.complete === false ? ['overseas'] : ['domestic', 'overseas'],
    failed: opts.complete === false ? [{ market: 'domestic', error: 'EGW00201' }] : [],
    complete: opts.complete !== false,
    cash: { USD: opts.usd ?? KNOWN(100) },
    overseasEnabled: opts.overseasEnabled ?? true,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  clearPortfolioTotalCache();
  getTicker.mockImplementation(async (s: string) => ({ price: s.includes(':') ? 1_000_000 : 70_000 }));
  usdToKrw.mockImplementation(async (u: number) => u * 1300);
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); clearPortfolioTotalCache(); });

test('정상 → 해외 = 보유 + USD×환율, 국내 = KRW + 보유', async () => {
  getBalancesDetailed.mockResolvedValue(detailed());
  expect(await getPortfolioTotalsKRW()).toEqual({
    domestic: { status: 'ok', krw: 80_000 + 10 * 70_000 },
    overseas: { status: 'ok', krw: 2 * 1_000_000 + 100 * 1300 },
  });
  expect(await getPortfolioTotalState()).toEqual({ status: 'ok', krw: 780_000 + 2_130_000 });
});

test('USD 확인된 0 → 환율 없이도 ok (보유만)', async () => {
  getBalancesDetailed.mockResolvedValue(detailed({ usd: KNOWN(0) }));
  usdToKrw.mockRejectedValue(new Error('fx down'));
  expect(await getMarketTotal('overseas')).toEqual({ status: 'ok', krw: 2_000_000 });
});

test('🔴 USD unknown → 해외 unknown(usd_cash_unknown) — 보유만으로 과소 계상하지 않는다, 해외 시세도 부르지 않는다', async () => {
  getBalancesDetailed.mockResolvedValue(detailed({ usd: { state: 'unknown', error: 'CTRP6504R down' } }));
  expect(await getMarketTotal('overseas')).toMatchObject({ status: 'unknown', reason: 'usd_cash_unknown' });
  expect(getTicker).not.toHaveBeenCalledWith('NAS:STK1');
  expect(await getMarketTotal('domestic')).toEqual({ status: 'ok', krw: 780_000 });          // 국내 무영향
  expect(await getPortfolioTotalState()).toMatchObject({ status: 'unknown', reason: 'usd_cash_unknown' });
});

test('🔴 USD 환산 실패 → 해외 unknown(fx_unavailable) (예전: catch {} 로 USD 누락)', async () => {
  getBalancesDetailed.mockResolvedValue(detailed());
  usdToKrw.mockRejectedValue(new Error('fx down'));
  expect(await getMarketTotal('overseas')).toMatchObject({ status: 'unknown', reason: 'fx_unavailable' });
});

test.each([[NaN], [-1], [Infinity]])('USD 환산값이 %p 이면 fx_unavailable', async (v) => {
  getBalancesDetailed.mockResolvedValue(detailed());
  usdToKrw.mockResolvedValue(v);
  expect(await getMarketTotal('overseas')).toMatchObject({ status: 'unknown', reason: 'fx_unavailable' });
});

test('🔴 C1-2: 직전 정상 캐시가 있어도 unknown 은 캐시로 되살아나지 않는다', async () => {
  getBalancesDetailed.mockResolvedValue(detailed());
  expect(await getMarketTotal('overseas')).toMatchObject({ status: 'ok' });
  getBalancesDetailed.mockResolvedValue(detailed({ usd: { state: 'unknown', error: 'x' } }));
  expect(await getMarketTotal('overseas', true)).toMatchObject({ status: 'unknown', reason: 'usd_cash_unknown' });
  getBalancesDetailed.mockResolvedValue(detailed());
  usdToKrw.mockRejectedValue(new Error('fx down'));
  expect(await getMarketTotal('overseas', true)).toMatchObject({ status: 'unknown', reason: 'fx_unavailable' });
});

test('🔴 C1-2 재현: 국내 0 · 해외 unknown 인 계좌에서도 해외는 unknown (총액 0 → 캐시 폴백 경로 없음)', async () => {
  getBalancesDetailed.mockResolvedValue({ ...detailed(), balances: [{ currency: 'KRW', free: 0, locked: 0 }, { currency: 'NAS:STK1', free: 2, locked: 0 }] });
  expect(await getMarketTotal('overseas')).toMatchObject({ status: 'ok', krw: 2_130_000 });
  getBalancesDetailed.mockResolvedValue({ ...detailed({ usd: { state: 'unknown', error: 'x' } }), balances: [{ currency: 'KRW', free: 0, locked: 0 }, { currency: 'NAS:STK1', free: 2, locked: 0 }] });
  expect(await getPortfolioTotalsKRW(true)).toEqual({
    domestic: { status: 'ok', krw: 0 },
    overseas: expect.objectContaining({ status: 'unknown', reason: 'usd_cash_unknown' }),
  });
});

test('잔고(보유) 조회 실패 → 기존처럼 시장별 직전 정상값 폴백', async () => {
  getBalancesDetailed.mockResolvedValue(detailed());
  const good = await getPortfolioTotalsKRW();
  getBalancesDetailed.mockResolvedValue(detailed({ complete: false }));
  expect(await getPortfolioTotalsKRW(true)).toEqual(good);
  getBalancesDetailed.mockRejectedValue(new Error('boom'));
  expect(await getPortfolioTotalsKRW(true)).toEqual(good);
});

test('잔고 실패 + 직전값 없음(콜드) → unknown(balances_failed)', async () => {
  getBalancesDetailed.mockResolvedValue(detailed({ complete: false }));
  expect(await getMarketTotal('domestic')).toMatchObject({ status: 'unknown', reason: 'balances_failed' });
});

test('🔴 더 새로운 판정이 "모름"이면 그 시장의 직전값을 지운다 — 뒤이은 잔고 실패가 낡은 값을 되살리지 않는다', async () => {
  getBalancesDetailed.mockResolvedValue(detailed());
  await getPortfolioTotalsKRW();                                                        // 해외 ok 기억
  getBalancesDetailed.mockResolvedValue(detailed({ usd: { state: 'unknown', error: 'x' } }));
  await getPortfolioTotalsKRW(true);                                                    // 해외 모름 → 기억 삭제
  getBalancesDetailed.mockResolvedValue(detailed({ complete: false }));
  const t = await getPortfolioTotalsKRW(true);
  expect(t.overseas).toMatchObject({ status: 'unknown', reason: 'balances_failed' });
  expect(t.domestic).toEqual({ status: 'ok', krw: 780_000 });                           // 국내는 직전값 유지
});

test('unknown 결과도 60초 캐시된다 (무인증 /api/health 가 KIS 를 두드리지 않게) — 캐시는 그 판정 그대로', async () => {
  getBalancesDetailed.mockResolvedValue(detailed({ usd: { state: 'unknown', error: 'x' } }));
  await getMarketTotal('overseas');
  getBalancesDetailed.mockResolvedValue(detailed());
  expect(await getMarketTotal('overseas')).toMatchObject({ status: 'unknown' });
  expect(getBalancesDetailed).toHaveBeenCalledTimes(1);
});

test('해외 비활성(not_queried) → 해외 ok 0 (예전과 같은 값 — 해외 한도 0)', async () => {
  getBalancesDetailed.mockResolvedValue({ ...detailed({ usd: { state: 'not_queried' }, overseasEnabled: false }), balances: [{ currency: 'KRW', free: 80_000, locked: 0 }] });
  expect(await getMarketTotal('overseas')).toEqual({ status: 'ok', krw: 0 });
});

test('Q3: KRW 요약 없음 → 국내 unknown(krw_cash_unknown), 해외 무영향', async () => {
  getBalancesDetailed.mockResolvedValue(detailed({ krw: false }));
  expect(await getMarketTotal('domestic')).toMatchObject({ status: 'unknown', reason: 'krw_cash_unknown' });
  expect(await getMarketTotal('overseas')).toMatchObject({ status: 'ok' });
});
