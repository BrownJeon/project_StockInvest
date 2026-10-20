/**
 * T-056 — 스냅샷 크론의 현금 행 처리.
 *
 *  - 해외 활성인데 USD 예수금이 unknown(또는 환율 실패) → **저장 보류** + critical(전달 확인 경보, 키 `snapshot:usd_cash_unavailable`)
 *    + 실명 감시 보고, 이 회차 **킬스위치·변동성 가드 미실행**.
 *  - known 0 → USD 0 행을 기록(행 없음과 확인된 0 을 구분). known X → total 에 X×환율, 행 price = 그 틱 환율.
 *  - `ustl_sll_amt_smtl > 0` → 행에 기록만(총액 미반영).
 *  - Q3: KRW 요약이 없으면 보류(키 `snapshot:krw_cash_unavailable`), KRW 행은 0 이어도 항상 기록.
 *  - 저장 가드에 넘기는 `usdCashRequired` = 그 틱의 `overseasEnabled` 값 그대로.
 */
import type { NextRequest } from 'next/server';

const savePortfolioSnapshot = jest.fn().mockResolvedValue(undefined);
const reportSnapshotBlindness = jest.fn().mockResolvedValue({ latestTs: new Date(), ageMs: 0, level: 'ok' });
const checkVolatilityGuard = jest.fn().mockResolvedValue({ ok: true });
const checkAndTriggerDrawdownKillSwitch = jest.fn().mockResolvedValue({ status: 'evaluated', drawdownPct: 0, triggered: false });
const isKillSwitchActive = jest.fn().mockResolvedValue(false);
const sendAlertUntilDelivered = jest.fn();
const sendAlertThrottled = jest.fn();
const getBalancesDetailed = jest.fn();
const getTicker = jest.fn();
const getUsdKrwRate = jest.fn();

jest.mock('@/lib/cron-auth', () => ({ checkCronAuth: () => undefined }));
jest.mock('@/lib/notify', () => ({ sendAlert: jest.fn() }));
jest.mock('@/lib/notify/throttle', () => ({ sendAlertThrottled: (...a: unknown[]) => sendAlertThrottled(...a) }));
jest.mock('@/lib/db', () => ({ getPool: () => ({ query: async () => [[]] }) }));
jest.mock('@/lib/strategy/market-hours', () => ({ getCurrentMarket: async () => 'overseas' }));
jest.mock('@/lib/exchanges/kis', () => ({
  BalancesIncompleteError: jest.requireActual('@/lib/exchanges/kis').BalancesIncompleteError,
  getBalancesDetailed: (...a: unknown[]) => getBalancesDetailed(...a),
  kis: { getTicker: (...a: unknown[]) => getTicker(...a) },
}));
jest.mock('@/lib/exchanges/fx', () => ({ getUsdKrwRate: (...a: unknown[]) => getUsdKrwRate(...a) }));
jest.mock('@/lib/safety/volatility-guard', () => ({
  savePortfolioSnapshot: (...a: unknown[]) => savePortfolioSnapshot(...a),
  checkVolatilityGuard: (...a: unknown[]) => checkVolatilityGuard(...a),
  reportSnapshotBlindness: (...a: unknown[]) => reportSnapshotBlindness(...a),
}));
jest.mock('@/lib/safety/kill-switch', () => ({
  checkAndTriggerDrawdownKillSwitch: (...a: unknown[]) => checkAndTriggerDrawdownKillSwitch(...a),
  isKillSwitchActive: (...a: unknown[]) => isKillSwitchActive(...a),
}));
jest.mock('@/lib/safety/confirmed-alert', () => ({
  sendAlertUntilDelivered: (...a: unknown[]) => sendAlertUntilDelivered(...a),
}));

import { POST } from '@/app/api/cron/portfolio-snapshot/route';

const req = () => ({ json: async () => ({ force: true }) }) as unknown as NextRequest;
const RATE = 1332.1;

type Cash = { state: 'known'; usd: number; source: 'CTRP6504R'; ustlSllAmtSmtl: number } | { state: 'unknown'; error: string } | { state: 'not_queried' };
function detailed(opts: { cash?: Cash; overseasEnabled?: boolean; krw?: number | null; holdings?: { currency: string; free: number }[] } = {}) {
  const krw = opts.krw === undefined ? 80_138 : opts.krw;
  const balances = [
    ...(krw == null ? [] : [{ currency: 'KRW', free: krw, locked: 0 }]),
    ...(opts.holdings ?? [{ currency: '005930', free: 30 }, { currency: 'NAS:STK1', free: 11 }]).map(h => ({ ...h, locked: 0, avgPrice: 100 })),
  ];
  return {
    balances, ok: ['domestic', 'overseas'], failed: [], complete: true,
    cash: { USD: opts.cash ?? { state: 'known', usd: 368.51, source: 'CTRP6504R', ustlSllAmtSmtl: 0 } },
    overseasEnabled: opts.overseasEnabled ?? true,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  getUsdKrwRate.mockResolvedValue(RATE);
  getTicker.mockImplementation(async (s: string) => ({ price: s.includes(':') ? 1_205_000 : 70_000 }));
});
afterEach(() => jest.restoreAllMocks());

const saved = () => savePortfolioSnapshot.mock.calls[0] as [number, Array<Record<string, unknown>>, string, Record<string, boolean>];

describe('USD 예수금을 모르면 보류한다 (0 으로 기록하지 않는다)', () => {
  test.each<[string, Cash]>([
    ['조회 실패(unknown)', { state: 'unknown', error: 'CTRP6504R rt_cd=1' }],
    ['해외 활성인데 조회 안 함(not_queried)', { state: 'not_queried' }],
  ])('🔴 %s → INSERT 시도 없음 + critical 전달확인 경보 + 실명 보고 + 킬스위치 미실행', async (_n, cash) => {
    getBalancesDetailed.mockResolvedValue(detailed({ cash }));
    const body = await (await POST(req())).json() as { ok: boolean; skipped?: string };
    expect(body).toMatchObject({ ok: true, skipped: 'usd_cash_unavailable' });
    expect(savePortfolioSnapshot).not.toHaveBeenCalled();
    expect(checkAndTriggerDrawdownKillSwitch).not.toHaveBeenCalled();
    expect(checkVolatilityGuard).not.toHaveBeenCalled();
    expect(sendAlertUntilDelivered).toHaveBeenCalledTimes(1);
    const [key, level, , , suppressMs] = sendAlertUntilDelivered.mock.calls[0];
    expect(key).toBe('snapshot:usd_cash_unavailable');
    expect(level).toBe('critical');
    expect(suppressMs).toBe(2 * 60 * 60 * 1000);
    expect(sendAlertThrottled).not.toHaveBeenCalled();             // 공용 스로틀(선기록 결함)을 쓰지 않는다
    expect(reportSnapshotBlindness).toHaveBeenCalledWith('usd_cash_unavailable', 'hourly');
  });

  test('🔴 환율 조회가 던지면 보류 (예전: catch {} 로 USD 를 조용히 뺐다)', async () => {
    getBalancesDetailed.mockResolvedValue(detailed());
    getUsdKrwRate.mockRejectedValue(new Error('fx down'));
    const body = await (await POST(req())).json() as { skipped?: string };
    expect(body.skipped).toBe('usd_cash_unavailable');
    expect(savePortfolioSnapshot).not.toHaveBeenCalled();
    expect(checkAndTriggerDrawdownKillSwitch).not.toHaveBeenCalled();
  });

  test.each([[0], [NaN], [-1], [Infinity]])('환율 값이 %p 이면 보류', async (rate) => {
    getBalancesDetailed.mockResolvedValue(detailed());
    getUsdKrwRate.mockResolvedValue(rate);
    const body = await (await POST(req())).json() as { skipped?: string };
    expect(body.skipped).toBe('usd_cash_unavailable');
    expect(savePortfolioSnapshot).not.toHaveBeenCalled();
  });
});

describe('USD 예수금을 알면 행으로 기록한다', () => {
  test('known X → total 에 X×환율, 행 = {USD, qty X, price 그 틱 환율, value_krw}, 저장 가드에 usdCashRequired=true', async () => {
    getBalancesDetailed.mockResolvedValue(detailed());
    const body = await (await POST(req())).json() as { totalKRW: number; cash: { KRW: number; USD: number } };
    const [total, positions, source, cashReq] = saved();
    const usd = positions.find(p => p.currency === 'USD')!;
    expect(usd).toEqual({ currency: 'USD', qty: 368.51, price: RATE, value_krw: 368.51 * RATE, locked: 0, src: 'CTRP6504R' });
    expect(source).toBe('hourly');
    expect(cashReq).toEqual({ usdCashRequired: true, krwCashRequired: true });
    const expected = 80_138 + 368.51 * RATE + 30 * 70_000 + 11 * 1_205_000;
    expect(total).toBeCloseTo(expected, 6);
    expect(positions.reduce((s, p) => s + Number(p.value_krw), 0)).toBeCloseTo(total, 6);   // Σvalue 정합
    expect(body.cash).toEqual({ KRW: 80_138, USD: 368.51 });
    expect(checkAndTriggerDrawdownKillSwitch).toHaveBeenCalledTimes(1);
  });

  test('🔴 known 0 → USD 0 행을 기록한다 (행 없음 ≠ 확인된 0)', async () => {
    getBalancesDetailed.mockResolvedValue(detailed({ cash: { state: 'known', usd: 0, source: 'CTRP6504R', ustlSllAmtSmtl: 0 } }));
    await POST(req());
    const [, positions] = saved();
    expect(positions.filter(p => p.currency === 'USD')).toEqual([
      { currency: 'USD', qty: 0, price: RATE, value_krw: 0, locked: 0, src: 'CTRP6504R' },
    ]);
  });

  test('미결제 매도 금액 > 0 → 행에 기록만, 총액에는 넣지 않는다', async () => {
    getBalancesDetailed.mockResolvedValue(detailed({ cash: { state: 'known', usd: 100, source: 'CTRP6504R', ustlSllAmtSmtl: 2_500_000 } }));
    await POST(req());
    const [total, positions] = saved();
    const usd = positions.find(p => p.currency === 'USD')!;
    expect(usd.ustl_sll_amt_smtl).toBe(2_500_000);
    expect(usd.value_krw).toBe(100 * RATE);
    expect(total).toBeCloseTo(80_138 + 100 * RATE + 30 * 70_000 + 11 * 1_205_000, 6);
  });

  test('해외 비활성 → USD 행 없이 저장, usdCashRequired=false (데드락 없음)', async () => {
    getBalancesDetailed.mockResolvedValue(detailed({ overseasEnabled: false, cash: { state: 'not_queried' }, holdings: [{ currency: '005930', free: 30 }] }));
    await POST(req());
    const [, positions, , cashReq] = saved();
    expect(positions.some(p => p.currency === 'USD')).toBe(false);
    expect(cashReq).toEqual({ usdCashRequired: false, krwCashRequired: true });
    expect(getUsdKrwRate).not.toHaveBeenCalled();
  });
});

describe('Q3 — 국내 KRW 행도 같은 규칙', () => {
  test('🔴 KRW 요약 없음 → 보류 + critical(키 snapshot:krw_cash_unavailable) + 킬스위치 미실행', async () => {
    getBalancesDetailed.mockResolvedValue(detailed({ krw: null }));
    const body = await (await POST(req())).json() as { skipped?: string };
    expect(body.skipped).toBe('krw_cash_unavailable');
    expect(savePortfolioSnapshot).not.toHaveBeenCalled();
    expect(checkAndTriggerDrawdownKillSwitch).not.toHaveBeenCalled();
    expect(sendAlertUntilDelivered.mock.calls[0][0]).toBe('snapshot:krw_cash_unavailable');
    expect(sendAlertUntilDelivered.mock.calls[0][1]).toBe('critical');
  });

  test('KRW 0 이어도 행을 기록한다 (예전: 0 이면 행 생략)', async () => {
    getBalancesDetailed.mockResolvedValue(detailed({ krw: 0 }));
    await POST(req());
    const [, positions] = saved();
    expect(positions.filter(p => p.currency === 'KRW')).toEqual([{ currency: 'KRW', qty: 0, price: 1, value_krw: 0, locked: 0 }]);
  });
});

describe('기존 경로 회귀 — 보유 부분 실패는 여전히 balances_incomplete', () => {
  test('보유 미완결이면 현금 판정 전에 기존 경로로 건너뛴다', async () => {
    getBalancesDetailed.mockResolvedValue({ ...detailed(), complete: false, ok: ['overseas'], failed: [{ market: 'domestic', error: 'EGW00201' }] });
    const body = await (await POST(req())).json() as { skipped?: string; failedMarkets?: string[] };
    expect(body).toMatchObject({ skipped: 'balances_incomplete', failedMarkets: ['domestic'] });
    expect(savePortfolioSnapshot).not.toHaveBeenCalled();
    expect(sendAlertUntilDelivered).not.toHaveBeenCalled();
  });
});
