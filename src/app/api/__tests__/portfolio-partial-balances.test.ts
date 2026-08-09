/**
 * T-012 — 잔고 부분 실패·시세 실패 시 **총액을 지어내지 않는다.**
 *
 * 두 소비자의 정책이 다른 이유:
 *  - cron 스냅샷: 기록을 **건너뛴다**. 직전 값을 복사해 넣으면 없는 관측을 지어내는 것이고,
 *    킬스위치가 그 위조 행을 현재값으로 읽어 실제 폭락을 은폐한다.
 *  - 대시보드: **오류를 표시**한다. 낮은 총액을 숫자로 보여주면 사용자가 사실로 읽는다.
 *    단 개별 종목 시세 실패는 매입평단가로 대체 평가하되 `price_source` 로 구분한다.
 */
import type { NextRequest } from 'next/server';

const sendAlert = jest.fn();
const savePortfolioSnapshot = jest.fn().mockResolvedValue(undefined);
const reportSnapshotBlindness = jest.fn().mockResolvedValue({ latestTs: new Date(), ageMs: 0, level: 'ok' });
const getBalances = jest.fn();
const getTicker = jest.fn();
const poolQuery = jest.fn().mockResolvedValue([[]]);

// 실제 클래스를 유지해야 라우트의 `instanceof` 분기가 동작한다
const actualKis = jest.requireActual('@/lib/exchanges/kis') as {
  BalancesIncompleteError: new (
    f: { market: string; error: string }[], ok: string[],
  ) => Error & { failed: { market: string; error: string }[] };
};
const { BalancesIncompleteError } = actualKis;

jest.mock('@/lib/exchanges/kis', () => ({
  ...(jest.requireActual('@/lib/exchanges/kis') as object),
  kis: {
    getBalances: (...a: unknown[]) => getBalances(...a),
    getTicker:   (...a: unknown[]) => getTicker(...a),
  },
}));
jest.mock('@/lib/notify', () => ({ sendAlert: (...a: unknown[]) => sendAlert(...a) }));
jest.mock('@/lib/db', () => ({
  getPool: () => ({ query: (...a: unknown[]) => poolQuery(...a) }),
  getAccountId: async () => 1,
}));
jest.mock('@/lib/exchanges/fx', () => ({ usdToKrw: async (n: number) => n * 1400 }));
jest.mock('@/lib/safety/volatility-guard', () => ({
  savePortfolioSnapshot: (...a: unknown[]) => savePortfolioSnapshot(...a),
  checkVolatilityGuard:  async () => ({ ok: true }),
  reportSnapshotBlindness: (...a: unknown[]) => reportSnapshotBlindness(...a),
}));
jest.mock('@/lib/safety/kill-switch', () => ({
  checkAndTriggerDrawdownKillSwitch: async () => undefined,
  isKillSwitchActive: async () => false,
}));
jest.mock('@/lib/cron-auth', () => ({ checkCronAuth: () => undefined }));
jest.mock('@/lib/strategy/market-hours', () => ({ getCurrentMarket: async () => 'domestic' }));

import { POST as snapshotPOST } from '@/app/api/cron/portfolio-snapshot/route';
import { GET as portfolioGET } from '@/app/api/portfolio/route';
import { resetAlertThrottle } from '@/lib/notify/throttle';

const RATE_LIMIT_MSG =
  'KIS getBalances: 500 body={"rt_cd":"1","msg_cd":"EGW00201"}';
const incomplete = () => new BalancesIncompleteError(
  [{ market: 'domestic', error: RATE_LIMIT_MSG }], ['overseas'],
);

const cronReq = () => ({ json: async () => ({ force: true }) }) as unknown as NextRequest;

beforeEach(() => {
  jest.clearAllMocks();
  resetAlertThrottle();          // 스로틀 창은 모듈 전역이라 테스트마다 초기화
  poolQuery.mockResolvedValue([[]]);
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('cron/portfolio-snapshot — 잔고 부분 실패는 기록하지 않고 건너뛴다', () => {
  test('🔴 부분 실패 시 스냅샷을 저장하지 않는다 (낮은 총액을 남기지 않음)', async () => {
    getBalances.mockRejectedValue(incomplete());
    const res = await snapshotPOST(cronReq());
    const body = await res.json() as { ok: boolean; skipped?: string; failedMarkets?: string[] };
    expect(savePortfolioSnapshot).not.toHaveBeenCalled();
    expect(body.skipped).toBe('balances_incomplete');
    expect(body.failedMarkets).toEqual(['domestic']);
  });

  test('직전 값을 복사해 새 행으로 기록하지 않는다 (관측 위조 금지)', async () => {
    getBalances.mockRejectedValue(incomplete());
    await snapshotPOST(cronReq());
    const inserts = poolQuery.mock.calls.filter(c => /INSERT INTO portfolio_snapshots/.test(String(c[0])));
    expect(inserts).toHaveLength(0);
  });

  test('건너뛰기는 조용하지 않다 — 알림이 나간다', async () => {
    getBalances.mockRejectedValue(incomplete());
    await snapshotPOST(cronReq());
    expect(sendAlert).toHaveBeenCalledTimes(1);
    expect(String(sendAlert.mock.calls[0][1])).toContain('건너뜀');
  });

  test('건너뛰기도 실명 감시기에 보고된다 (sanity 거부와 같은 실명)', async () => {
    getBalances.mockRejectedValue(incomplete());
    await snapshotPOST(cronReq());
    expect(reportSnapshotBlindness).toHaveBeenCalledTimes(1);
    expect(String(reportSnapshotBlindness.mock.calls[0][0])).toContain('balances_incomplete');
  });

  test('응답에 관측 공백 상태가 실린다', async () => {
    getBalances.mockRejectedValue(incomplete());
    reportSnapshotBlindness.mockResolvedValueOnce({
      latestTs: new Date(), ageMs: 4 * 60 * 60 * 1000, level: 'critical',
    });
    const body = await (await snapshotPOST(cronReq())).json() as { blindness: string; snapshotAgeMin: number };
    expect(body.blindness).toBe('critical');
    expect(body.snapshotAgeMin).toBe(240);
  });

  test('정상 조회면 평소대로 저장된다', async () => {
    getBalances.mockResolvedValue([
      { currency: 'KRW', free: 500_000, locked: 0 },
      { currency: '005930', free: 10, locked: 0, avgPrice: 70_000 },
    ]);
    getTicker.mockResolvedValue({ price: 72_000 });
    const res = await snapshotPOST(cronReq());
    const body = await res.json() as { ok: boolean; totalKRW: number };
    expect(body.totalKRW).toBe(500_000 + 10 * 72_000);
    expect(savePortfolioSnapshot).toHaveBeenCalledTimes(1);
  });
});

describe('api/portfolio — 시세 실패를 0원으로 표시하지 않는다', () => {
  const BAL = [
    { currency: 'KRW',      free: 78_218, locked: 0 },
    { currency: '005930',   free: 30, locked: 0, avgPrice: 69_300 },
    { currency: 'NAS:SNPS', free: 23, locked: 0, avgPrice: 558_654 },
  ];

  interface Holding { currency: string; price: number; value_krw: number; price_source: string; change_24h_pct: number | null }
  interface Body { ok: boolean; error?: string; data?: { total_krw: number; holdings: Holding[] } }

  test('🔴 실측 재현 — SNPS 시세 실패가 0원이 아니라 평단가로 평가된다', async () => {
    getBalances.mockResolvedValue(BAL);
    getTicker.mockImplementation(async (sym: string) => {
      if (sym === 'NAS:SNPS') throw new Error('KIS overseas getTicker NAS:SNPS: 500');
      return { price: 69_300, open24h: 69_300 };
    });
    const body = await (await portfolioGET()).json() as Body;
    expect(body.ok).toBe(true);
    const snps = body.data!.holdings.find(h => h.currency === 'NAS:SNPS')!;
    expect(snps.price).toBe(558_654);              // 0 이 아니다
    expect(snps.price_source).toBe('avg_cost');    // 실시간이 아님이 구분돼 나간다
    expect(snps.change_24h_pct).toBeNull();        // 평단가 대비 변동률은 의미 없음
    // 총액이 74% 붕괴하지 않는다
    expect(body.data!.total_krw).toBe(78_218 + 30 * 69_300 + 23 * 558_654);
  });

  test('시세 정상이면 price_source=market', async () => {
    getBalances.mockResolvedValue(BAL);
    getTicker.mockResolvedValue({ price: 100_000, open24h: 100_000 });
    const body = await (await portfolioGET()).json() as Body;
    expect(body.data!.holdings.every(h => h.price_source === 'market')).toBe(true);
  });

  test('시세가 0/NaN 으로 "성공" 반환돼도 평단가 폴백을 쓴다', async () => {
    getBalances.mockResolvedValue(BAL);
    getTicker.mockImplementation(async (sym: string) =>
      sym === 'NAS:SNPS' ? { price: 0 } : { price: 69_300, open24h: 69_300 });
    const body = await (await portfolioGET()).json() as Body;
    const snps = body.data!.holdings.find(h => h.currency === 'NAS:SNPS')!;
    expect(snps.price_source).toBe('avg_cost');
    expect(snps.value_krw).toBe(23 * 558_654);
  });

  test('시세도 평단가도 없으면 총액을 내보내지 않고 실패로 응답한다', async () => {
    getBalances.mockResolvedValue([
      { currency: 'KRW', free: 78_218, locked: 0 },
      { currency: 'NAS:SNPS', free: 23, locked: 0 },   // avgPrice 없음
    ]);
    getTicker.mockRejectedValue(new Error('ticker down'));
    const res = await portfolioGET();
    const body = await res.json() as Body;
    expect(res.status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.error).toContain('NAS:SNPS');
  });

  test('🔴 잔고 부분 실패면 숫자 대신 오류를 준다 (대시보드가 오류 상태로 렌더)', async () => {
    getBalances.mockRejectedValue(incomplete());
    const res = await portfolioGET();
    const body = await res.json() as Body;
    expect(res.status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.error).toContain('domestic');
    expect(savePortfolioSnapshot).not.toHaveBeenCalled();
  });
});
