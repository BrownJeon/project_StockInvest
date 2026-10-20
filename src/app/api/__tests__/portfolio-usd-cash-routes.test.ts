/**
 * T-056 — 표시 경로(대시보드 `/api/portfolio`, 시장 현황 `/api/markets/status`)도 예수금을 모르면 **숫자 대신 기존 실패 경로**를 쓴다.
 * 화면 신규 요소는 없다(대시보드 503 오류 상태, 시장 현황 `balance: null` 은 기존 경로).
 */
const getBalancesDetailed = jest.fn();
const getTicker = jest.fn();
const usdToKrw = jest.fn();

jest.mock('@/lib/exchanges/kis', () => ({
  BalancesIncompleteError: jest.requireActual('@/lib/exchanges/kis').BalancesIncompleteError,
  getBalancesDetailed: (...a: unknown[]) => getBalancesDetailed(...a),
  kis: { getTicker: (...a: unknown[]) => getTicker(...a) },
}));
jest.mock('@/lib/exchanges/fx', () => ({
  usdToKrw: (...a: unknown[]) => usdToKrw(...a),
  getUsdKrwRate: async () => 1332.1,
}));
jest.mock('@/lib/db', () => ({ getPool: () => ({ query: async () => [[]] }) }));
jest.mock('@/lib/strategy/market-hours', () => ({
  isDomesticOpen: async () => false, isOverseasOpen: async () => false, getCurrentMarket: async () => null,
  isUSDST: () => true, nextOpenAt: () => Date.now() + 3600_000,
}));

import { GET as portfolioGET } from '@/app/api/portfolio/route';
import { GET as marketsGET } from '@/app/api/markets/status/route';

function detailed(usd: unknown, opts: { krw?: boolean; overseasEnabled?: boolean } = {}) {
  return {
    balances: [
      ...(opts.krw === false ? [] : [{ currency: 'KRW', free: 80_138, locked: 0 }]),
      { currency: '005930', free: 30, locked: 0, avgPrice: 69_300 },
      { currency: 'NAS:STK1', free: 11, locked: 0, avgPrice: 1_400_000 },
    ],
    ok: ['domestic', 'overseas'], failed: [], complete: true,
    cash: { USD: usd }, overseasEnabled: opts.overseasEnabled ?? true,
  };
}
const KNOWN = { state: 'known', usd: 368.51, source: 'CTRP6504R', ustlSllAmtSmtl: 0 };

beforeEach(() => {
  jest.clearAllMocks();
  getTicker.mockImplementation(async (s: string) => ({ price: s.includes(':') ? 1_205_000 : 70_000, open24h: s.includes(':') ? 1_205_000 : 70_000 }));
  usdToKrw.mockImplementation(async (u: number) => u * 1332.1);
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('/api/portfolio', () => {
  test('USD known → 현금 행(USD)으로 총액에 포함', async () => {
    getBalancesDetailed.mockResolvedValue(detailed(KNOWN));
    const body = await (await portfolioGET()).json() as { ok: boolean; data: { total_krw: number; holdings: { currency: string; value_krw: number }[] } };
    expect(body.ok).toBe(true);
    const usd = body.data.holdings.find(h => h.currency === 'USD')!;
    expect(usd.value_krw).toBeCloseTo(368.51 * 1332.1, 6);
    expect(body.data.total_krw).toBeCloseTo(80_138 + 30 * 70_000 + 11 * 1_205_000 + 368.51 * 1332.1, 6);
  });

  test('🔴 USD unknown → 503 (예수금을 뺀 총액을 숫자로 보여주지 않는다)', async () => {
    getBalancesDetailed.mockResolvedValue(detailed({ state: 'unknown', error: 'x' }));
    const res = await portfolioGET();
    const body = await res.json() as { ok: boolean; error: string };
    expect(res.status).toBe(503);
    expect(body).toMatchObject({ ok: false });
    expect(body.error).toContain('USD');
  });

  test('🔴 Q3 — KRW 요약 없음 → 503', async () => {
    getBalancesDetailed.mockResolvedValue(detailed(KNOWN, { krw: false }));
    expect((await portfolioGET()).status).toBe(503);
  });

  test('해외 비활성 → USD 없이 정상 응답', async () => {
    getBalancesDetailed.mockResolvedValue(detailed({ state: 'not_queried' }, { overseasEnabled: false }));
    const res = await portfolioGET();
    expect(res.status).toBe(200);
  });
});

describe('/api/markets/status?balance=1', () => {
  const call = async () => (await marketsGET(new Request('http://x/api/markets/status?balance=1'))).json() as Promise<{
    domestic: { balance: { cash: number; totalKRW: number } | null }; overseas: { balance: { cash: number; cashKRW: number } | null };
  }>;

  test('USD known → 해외 현금 표시', async () => {
    getBalancesDetailed.mockResolvedValue(detailed(KNOWN));
    const body = await call();
    expect(body.overseas.balance?.cash).toBe(368.51);
    expect(body.overseas.balance?.cashKRW).toBeCloseTo(368.51 * 1332.1, 6);
    expect(body.domestic.balance?.cash).toBe(80_138);
  });

  test.each<[string, () => void]>([
    ['USD unknown', () => getBalancesDetailed.mockResolvedValue(detailed({ state: 'unknown', error: 'x' }))],
    ['USD 환산 실패(예전: 0원)', () => { getBalancesDetailed.mockResolvedValue(detailed(KNOWN)); usdToKrw.mockRejectedValue(new Error('fx')); }],
    ['KRW 요약 없음', () => getBalancesDetailed.mockResolvedValue(detailed(KNOWN, { krw: false }))],
  ])('🔴 %s → 잔고 요약 전체 null (기존 조회 불가 경로 — 0원·부분 합계를 내지 않는다)', async (_n, arrange) => {
    arrange();
    const body = await call();
    expect(body.domestic.balance).toBeNull();
    expect(body.overseas.balance).toBeNull();
  });
});
