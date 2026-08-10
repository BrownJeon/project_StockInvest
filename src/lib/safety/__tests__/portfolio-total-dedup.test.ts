/**
 * T-017 — 포트폴리오 평가액 조회의 **in-flight 중복 제거**.
 *
 * ## 왜 필요한가 (실측)
 *
 * `getPortfolioTotalsKRW()` 1회 = KIS 잔고 2~3건 + 보유 종목 수만큼의 시세. 그런데 캐시가 빈
 * 순간 여러 호출부가 **동시에** 들어온다:
 *
 *  - `/api/health` — **무인증** 라우트다. `getEffectiveOrderMax(domestic/overseas)` +
 *    `getEffectiveDailyMax(domestic/overseas)` **4개를 `Promise.all` 로** 부르고 넷 다 여기로
 *    수렴한다. 즉 콜드 캐시에서 헬스체크 한 번이 잔고·시세 팬아웃을 **4배**로 터뜨렸다.
 *  - `submitOrder` — 한도 2건을 `Promise.all` 로 부른다(같은 구조).
 *
 * TTL 캐시는 "이미 끝난 조회"만 막고 "지금 진행 중인 조회"는 못 막는다. 이 테스트는 진행 중인
 * Promise 를 공유해 **동시 호출 N건이 KIS 왕복 1회로 합쳐지는지**를 고정한다.
 */
const getBalances = jest.fn();
const getTicker   = jest.fn();

jest.mock('@/lib/exchanges/kis', () => ({
  kis: {
    getBalances: (...a: unknown[]) => getBalances(...a),
    getTicker:   (...a: unknown[]) => getTicker(...a),
  },
}));
jest.mock('@/lib/exchanges/fx', () => ({
  usdToKrw: jest.fn(async (usd: number) => usd * 1400),
}));

import {
  getPortfolioTotalsKRW,
  getPortfolioTotalByMarketKRW,
  clearPortfolioTotalCache,
  isPortfolioTotalFetchInFlight,
} from '@/lib/safety/portfolio-total';
import type { Balance } from '@/lib/exchanges/types';

const BALANCES: Balance[] = [
  { currency: 'KRW',      free: 100_000, locked: 0 },
  { currency: '005930',   free: 10,      locked: 0, avgPrice: 70_000 },
  { currency: '000660',   free: 3,       locked: 0, avgPrice: 474_000 },
  { currency: 'NAS:SNPS', free: 2,       locked: 0, avgPrice: 558_654 },
];

const deferred = () => {
  let resolve!: (v: Balance[]) => void;
  const promise = new Promise<Balance[]>(r => { resolve = r; });
  return { promise, resolve };
};

beforeEach(() => {
  jest.clearAllMocks();
  clearPortfolioTotalCache();
  getTicker.mockImplementation(async (sym: string) => ({ symbol: sym, price: 1000, timestamp: Date.now() }));
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
  clearPortfolioTotalCache();
});

describe('in-flight 중복 제거', () => {
  it('동시 호출 4건(= /api/health 패턴)이 잔고 조회 1회로 합쳐진다', async () => {
    const d = deferred();
    getBalances.mockReturnValue(d.promise);

    // /api/health 가 실제로 하는 것과 같은 모양 — 넷 다 콜드 캐시에서 동시에 진입한다.
    const all = Promise.all([
      getPortfolioTotalByMarketKRW('domestic'),
      getPortfolioTotalByMarketKRW('overseas'),
      getPortfolioTotalByMarketKRW('domestic'),
      getPortfolioTotalByMarketKRW('overseas'),
    ]);

    await Promise.resolve();
    expect(getBalances).toHaveBeenCalledTimes(1);   // 중복 제거 없으면 4

    d.resolve(BALANCES);
    await all;
    expect(getBalances).toHaveBeenCalledTimes(1);
  });

  it('보유 종목 시세 팬아웃도 1회분만 나간다', async () => {
    const d = deferred();
    getBalances.mockReturnValue(d.promise);

    const all = Promise.all(Array.from({ length: 5 }, () => getPortfolioTotalsKRW()));
    await Promise.resolve();
    d.resolve(BALANCES);
    await all;

    // 종목 3개 × 1회. 중복 제거가 없으면 15회가 나간다.
    expect(getTicker).toHaveBeenCalledTimes(3);
  });

  it('동시 호출자는 모두 같은 값을 받는다', async () => {
    getBalances.mockResolvedValue(BALANCES);
    const [a, b, c] = await Promise.all([
      getPortfolioTotalsKRW(), getPortfolioTotalsKRW(), getPortfolioTotalsKRW(),
    ]);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(a.total).toBeGreaterThan(0);
  });

  it('forceFresh 여도 동시 호출끼리는 합쳐진다', async () => {
    const d = deferred();
    getBalances.mockReturnValue(d.promise);
    const all = Promise.all([getPortfolioTotalsKRW(true), getPortfolioTotalsKRW(true)]);
    await Promise.resolve();
    expect(getBalances).toHaveBeenCalledTimes(1);
    d.resolve(BALANCES);
    await all;
  });

  it('조회가 끝나면 in-flight 가 해제된다 (다음 호출이 영구히 옛 결과를 받지 않는다)', async () => {
    getBalances.mockResolvedValue(BALANCES);
    await getPortfolioTotalsKRW();
    expect(isPortfolioTotalFetchInFlight()).toBe(false);

    clearPortfolioTotalCache();          // TTL 캐시를 비우면 다시 실제 조회가 나가야 한다
    await getPortfolioTotalsKRW();
    expect(getBalances).toHaveBeenCalledTimes(2);
  });

  it('실패해도 in-flight 가 해제된다 — 이후 호출이 영구 실패에 갇히지 않는다', async () => {
    // fetchTotals 는 던지지 않고 0/0/0 을 반환하지만, 내부 예외 경로를 태워 해제를 확인한다.
    getBalances.mockRejectedValueOnce(new Error('KIS getBalances: 500 EGW00201'));
    const first = await getPortfolioTotalsKRW();
    expect(first).toEqual({ domestic: 0, overseas: 0, total: 0 });
    // 🔑 in-flight 가 남아 있으면 이후 모든 호출이 그 실패 Promise 를 영구히 공유한다.
    expect(isPortfolioTotalFetchInFlight()).toBe(false);

    /**
     * ⚠️ 여기서 `forceFresh` 를 쓰는 이유 — **이 동작은 T-017 이전부터 그랬다.**
     *    콜드 캐시에서 실패하면 0/0/0 이 60초 TTL 캐시에 그대로 들어가므로, 그 사이의 호출은
     *    재조회 없이 0 을 받는다. 방향은 안전한 쪽이다(한도 0 = 신규 매수 차단).
     *    이 테스트의 관심사는 그 캐시 정책이 아니라 **in-flight 잠금이 풀렸는가** 이다.
     */
    getBalances.mockResolvedValue(BALANCES);
    const second = await getPortfolioTotalsKRW(true);
    expect(second.total).toBeGreaterThan(0);
    expect(getBalances).toHaveBeenCalledTimes(2);
  });
});

describe('T-014/T-012 회귀 방지 — 스로틀이 안전 계약을 바꾸지 않는다', () => {
  it('잔고 조회 실패는 여전히 0/0/0 이고, 직전 캐시가 있으면 캐시를 유지한다', async () => {
    getBalances.mockResolvedValue(BALANCES);
    const good = await getPortfolioTotalsKRW();
    expect(good.total).toBeGreaterThan(0);

    // 캐시 TTL 을 우회해 강제로 재조회시키되 실패하게 만든다.
    getBalances.mockRejectedValue(new Error('KIS 잔고 부분 실패 — 실패 시장: domestic(EGW00201)'));
    const afterFail = await getPortfolioTotalsKRW(true);

    // **낮은 총액으로 대체되지 않는다.** 직전 정상값을 그대로 쓴다 (T-012 계약).
    expect(afterFail).toEqual({ domestic: good.domestic, overseas: good.overseas, total: good.total });
  });

  it('스로틀 대기열 초과로 시세가 실패해도 그 종목만 빠지고 조용하지 않다', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    getBalances.mockResolvedValue(BALANCES);
    getTicker.mockImplementation(async (sym: string) => {
      if (sym === '000660') {
        const e = new Error('KIS 요청 대기열 초과 (lane=bulk ...)');
        e.name = 'KisThrottleQueueFullError';
        throw e;
      }
      return { symbol: sym, price: 1000, timestamp: Date.now() };
    });

    const totals = await getPortfolioTotalsKRW();
    expect(totals.total).toBeGreaterThan(0);
    // 조용히 사라지면 원인 모를 과소평가가 남는다 — 반드시 로그가 있어야 한다.
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('000660'),
      expect.stringContaining('대기열 초과'),
    );
  });
});
