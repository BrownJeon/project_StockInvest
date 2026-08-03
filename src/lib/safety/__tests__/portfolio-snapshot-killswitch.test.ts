/**
 * Phase 0 — Kill Switch drawdown 배선 테스트.
 *
 * checkAndTriggerDrawdownKillSwitch()는 구현돼 있었지만 호출처가 없는 dead code였다.
 * 이제 /api/cron/portfolio-snapshot 이 스냅샷 저장 **후** 반드시 호출해야 한다.
 */
import type { NextRequest } from 'next/server';

const savePortfolioSnapshot = jest.fn().mockResolvedValue(undefined);
const checkVolatilityGuard = jest.fn().mockResolvedValue({ ok: true });
const checkAndTriggerDrawdownKillSwitch = jest.fn().mockResolvedValue(undefined);
const isKillSwitchActive = jest.fn().mockResolvedValue(false);
const sendAlert = jest.fn();

jest.mock('@/lib/cron-auth', () => ({ checkCronAuth: () => undefined }));
jest.mock('@/lib/notify', () => ({ sendAlert: (...a: unknown[]) => sendAlert(...a) }));
jest.mock('@/lib/db', () => ({ getPool: () => ({ query: async () => [[]] }) }));
jest.mock('@/lib/strategy/market-hours', () => ({ getCurrentMarket: async () => 'domestic' }));
jest.mock('@/lib/exchanges/kis', () => ({
  kis: {
    getBalances: async () => [
      { currency: 'KRW', free: 500_000, locked: 0 },
      { currency: '005930', free: 10, locked: 0, avgPrice: 70_000 },
    ],
    getTicker: async () => ({ price: 72_000 }),
  },
}));
jest.mock('@/lib/safety/volatility-guard', () => ({
  savePortfolioSnapshot: (...a: unknown[]) => savePortfolioSnapshot(...a),
  checkVolatilityGuard: (...a: unknown[]) => checkVolatilityGuard(...a),
}));
jest.mock('@/lib/safety/kill-switch', () => ({
  checkAndTriggerDrawdownKillSwitch: (...a: unknown[]) => checkAndTriggerDrawdownKillSwitch(...a),
  isKillSwitchActive: (...a: unknown[]) => isKillSwitchActive(...a),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
import { POST } from '@/app/api/cron/portfolio-snapshot/route';

function makeReq(): NextRequest {
  return { json: async () => ({ force: true }) } as unknown as NextRequest;
}

describe('/api/cron/portfolio-snapshot — drawdown kill switch 배선', () => {
  afterEach(() => jest.clearAllMocks());

  test('스냅샷 저장 후 checkAndTriggerDrawdownKillSwitch()를 호출한다', async () => {
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    expect(savePortfolioSnapshot).toHaveBeenCalledTimes(1);
    expect(checkAndTriggerDrawdownKillSwitch).toHaveBeenCalledTimes(1);
  });

  test('호출 순서: savePortfolioSnapshot → drawdown check (방금 저장한 스냅샷이 현재 자본)', async () => {
    const order: string[] = [];
    savePortfolioSnapshot.mockImplementation(async () => { order.push('save'); });
    checkAndTriggerDrawdownKillSwitch.mockImplementation(async () => { order.push('drawdown'); });
    await POST(makeReq());
    expect(order).toEqual(['save', 'drawdown']);
  });

  test('응답에 현재 kill switch 상태를 포함한다', async () => {
    isKillSwitchActive.mockResolvedValue(true);
    const res = await POST(makeReq());
    const body = await res.json() as { ok: boolean; killSwitch: boolean };
    expect(body.ok).toBe(true);
    expect(body.killSwitch).toBe(true);
  });

  test('총 평가액 = KRW 예수금 + 보유 종목 평가 (10주 × 72,000)', async () => {
    const res = await POST(makeReq());
    const body = await res.json() as { totalKRW: number };
    expect(body.totalKRW).toBe(500_000 + 10 * 72_000);
  });
});
