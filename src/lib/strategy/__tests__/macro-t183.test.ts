/**
 * T-183 — 거시 지표(`fetchMacroIndicators`)가 **전일 종가 대비**로 계산하고, 판정 불가 사유를 돌려주고, 실패를 캐시하지 않는다.
 *
 * 2026-11-20 운영 KIS 실측(읽기 전용, Leader):
 *  - `NYS:SPY` HHDFS00000300 → `rt_cd=0` 인데 전 필드 빈 값 → 종전 S&P 변화율이 늘 null(게이트 영구 미발동)
 *  - `AMS:SPY` → `last 709.87 · base 715.87`(전일 대비 −0.84%)
 *  - `069500` → `stck_prpr 76210 · stck_oprc 77370 · stck_sdpr 80630 · prdy_ctrt −5.48`
 *    → 종전 시가 기준 계산값 −1.50%(갭 하락분 누락), 전일 종가 기준 −5.48%
 */
const getTicker = jest.fn();
jest.mock('@/lib/exchanges/kis', () => ({ kis: { getTicker: (...a: unknown[]) => getTicker(...a) } }));
const getUsdKrwRate = jest.fn();
jest.mock('@/lib/exchanges/fx', () => ({ getUsdKrwRate: (...a: unknown[]) => getUsdKrwRate(...a) }));

import { clearMacroCache, fetchMacroIndicators, KOSPI_PROXY, SP500_PROXY } from '../macro';

const FX = 1450;
/** 실측 값을 그대로 쓴 정상 응답 — 해외는 어댑터처럼 KRW 환산값 */
const TICKERS: Record<string, unknown> = {
  '069500': { symbol: '069500', price: 76210, open24h: 77370, prevClose: 80630, timestamp: 0 },
  'AMS:SPY': { symbol: 'AMS:SPY', price: 709.87 * FX, priceUsd: 709.87, open24h: 715.87 * FX, prevClose: 715.87 * FX, timestamp: 0 },
};

const T0 = new Date('2026-11-20T05:00:00Z');
beforeAll(() => { jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask'] }); });
afterAll(() => { jest.useRealTimers(); });
beforeEach(() => {
  jest.clearAllMocks();
  jest.setSystemTime(T0);
  clearMacroCache();
  getTicker.mockImplementation(async (s: string) => {
    if (!(s in TICKERS)) throw new Error(`unexpected symbol ${s}`);
    return { ...(TICKERS[s] as object) };
  });
  getUsdKrwRate.mockResolvedValue(FX);
});

const calledSymbols = () => getTicker.mock.calls.map((c) => c[0]);
const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

describe('대용 심볼', () => {
  test('🔴 S&P 대용은 AMS:SPY 다 — NYS:SPY 는 KIS 가 빈 값을 준다', async () => {
    expect(SP500_PROXY).toBe('AMS:SPY');
    expect(KOSPI_PROXY).toBe('069500');
    await fetchMacroIndicators();
    expect(calledSymbols().sort()).toEqual(['069500', 'AMS:SPY']);
    expect(calledSymbols()).not.toContain('NYS:SPY');
  });
});

describe('전일 종가 대비 계산', () => {
  test('🔴 국내: 갭 하락이 포함된다 — −5.48%(종전 시가 기준이면 −1.50%)', async () => {
    const m = await fetchMacroIndicators();
    // 라운드 2 — 결과는 소수 6자리 반올림값이다
    expect(m.kospiChangePct).toBe(round6(((76210 - 80630) / 80630) * 100));
    expect(m.kospiChangePct).toBeCloseTo(-5.48, 2);
    expect(m.kospiError).toBeUndefined();
  });

  test('해외: KRW 환산이 약분돼 USD 기준 변화율과 같다(−0.84%)', async () => {
    const m = await fetchMacroIndicators();
    expect(m.sp500ChangePct).toBeCloseTo(((709.87 - 715.87) / 715.87) * 100, 6);
    expect(m.sp500ChangePct).toBeCloseTo(-0.84, 2);
    expect(m.sp500Error).toBeUndefined();
  });

  test('open24h 는 보지 않는다 — prevClose 만 기준이다', async () => {
    TICKERS['069500'] = { symbol: '069500', price: 100, open24h: 1, prevClose: 100, timestamp: 0 };
    try {
      const m = await fetchMacroIndicators();
      expect(m.kospiChangePct).toBe(0);
    } finally {
      TICKERS['069500'] = { symbol: '069500', price: 76210, open24h: 77370, prevClose: 80630, timestamp: 0 };
    }
  });
});

/**
 * 라운드 2 (Codex C2 지적 1) — 정확히 −1.5% 인 가격쌍이 부동소수 잡음으로 −1.4999… 가 되어 게이트를 빠져나가지 않는다.
 * 어댑터(`kis-overseas.ts` getTicker)와 같은 식으로 환산한다: `price = Number(last) * fx`, `prevClose = Number(base) * fx`.
 * 반올림 전 값은 −1.4999999999999927 이라 이 시험은 반올림이 없으면 실패한다.
 */
describe('경계 −1.5% — 부동소수 잡음 제거(소수 6자리 반올림)', () => {
  const OVERSEAS_FX = 1332.1;
  /** KIS HHDFS00000300 응답 문자열 → 어댑터 환산 그대로 */
  const overseasTicker = (last: string, base: string) => ({
    symbol: 'AMS:SPY', price: Number(last) * OVERSEAS_FX, priceUsd: Number(last), timestamp: 0,
    open24h: Number(base) * OVERSEAS_FX, prevClose: Number(base) > 0 ? Number(base) * OVERSEAS_FX : undefined,
  });

  test('🔴 해외 last=689.50·base=700.00·환율 1332.1 → sp500ChangePct 는 정확히 −1.5(게이트 `<= -1.5` 참)', async () => {
    const t = overseasTicker('689.50', '700.00');
    // 전제 확인 — 반올림 없이 계산하면 경계를 빠져나간다(이 시험이 무엇을 잡는지 고정)
    const raw = ((t.price - t.prevClose!) / t.prevClose!) * 100;
    expect(raw).not.toBe(-1.5);
    expect(raw <= -1.5).toBe(false);
    getTicker.mockImplementation(async (s: string) => (s === 'AMS:SPY' ? t : { ...(TICKERS[s] as object) }));
    const m = await fetchMacroIndicators();
    expect(m.sp500ChangePct).toBe(-1.5);
    expect(m.sp500ChangePct! <= -1.5).toBe(true);
    expect(m.sp500Error).toBeUndefined();
  });

  test('해외 바로 위(−1.49%) 는 −1.49 로 남는다 — 반올림이 허용 쪽 값을 차단으로 끌어내리지 않는다', async () => {
    const t = overseasTicker('689.57', '700.00');
    getTicker.mockImplementation(async (s: string) => (s === 'AMS:SPY' ? t : { ...(TICKERS[s] as object) }));
    const m = await fetchMacroIndicators();
    expect(m.sp500ChangePct).toBe(-1.49);
    expect(m.sp500ChangePct! <= -1.5).toBe(false);
  });

  test.each([
    [80600, 79391, -1.5, true],
    [80600, 79392, round6(((79392 - 80600) / 80600) * 100), false],
  ])('국내 정수 가격 prev=%s·price=%s → %s (차단=%s)', async (prev, price, expected, blocked) => {
    getTicker.mockImplementation(async (s: string) => (s === '069500'
      ? { symbol: s, price, open24h: price, prevClose: prev, timestamp: 0 }
      : { ...(TICKERS[s] as object) }));
    const m = await fetchMacroIndicators();
    expect(m.kospiChangePct).toBe(expected);
    expect(m.kospiChangePct! <= -1.5).toBe(blocked);
  });
});

describe('판정 불가 → null + 사유 (예외를 삼키지 않는다)', () => {
  test.each([
    ['현재가 0(빈 문자열 → Number("")=0 — NYS:SPY 실측 모양)', { price: 0, prevClose: 80630 }, 'price_unavailable'],
    ['현재가 NaN', { price: Number.NaN, prevClose: 80630 }, 'price_unavailable'],
    ['전일 종가 없음', { price: 76210 }, 'prev_close_unavailable'],
    ['전일 종가 0', { price: 76210, prevClose: 0 }, 'prev_close_unavailable'],
    ['전일 종가 NaN', { price: 76210, prevClose: Number.NaN }, 'prev_close_unavailable'],
  ])('%s', async (_d, ticker, reason) => {
    getTicker.mockImplementation(async (s: string) => (s === '069500' ? { symbol: s, timestamp: 0, ...ticker } : { ...(TICKERS[s] as object) }));
    const m = await fetchMacroIndicators();
    expect(m.kospiChangePct).toBeNull();
    expect(m.kospiError).toBe(reason);
    // 다른 지수는 영향 없음
    expect(m.sp500ChangePct).toBeCloseTo(-0.84, 2);
    expect(m.sp500Error).toBeUndefined();
  });

  test('시세 예외 → ticker_error: <메시지>, 200자 상한', async () => {
    getTicker.mockImplementation(async (s: string) => {
      if (s === 'AMS:SPY') throw new Error(`KIS overseas getTicker AMS:SPY: 500 ${'x'.repeat(500)}`);
      return { ...(TICKERS[s] as object) };
    });
    const m = await fetchMacroIndicators();
    expect(m.sp500ChangePct).toBeNull();
    expect(m.sp500Error).toMatch(/^ticker_error: KIS overseas getTicker AMS:SPY: 500 x+$/);
    expect(m.sp500Error!.length).toBe(200);
    expect(m.kospiChangePct).toBeCloseTo(-5.48, 2);
  });

  test('Error 가 아닌 값을 던져도 사유가 남는다', async () => {
    getTicker.mockImplementation(async (s: string) => {
      if (s === '069500') throw 'boom';   // eslint-disable-line no-throw-literal
      return { ...(TICKERS[s] as object) };
    });
    const m = await fetchMacroIndicators();
    expect(m.kospiError).toBe('ticker_error: boom');
  });
});

describe('캐시 — 성공만 5분, 실패는 캐시하지 않는다', () => {
  test('🔴 실패한 지수는 다음 호출에서 바로 다시 조회한다 — 성공한 지수는 다시 조회하지 않는다', async () => {
    let spyFails = true;
    getTicker.mockImplementation(async (s: string) => {
      if (s === 'AMS:SPY' && spyFails) throw new Error('KIS overseas getTicker AMS:SPY: 500');
      return { ...(TICKERS[s] as object) };
    });
    const first = await fetchMacroIndicators();
    expect(first.sp500ChangePct).toBeNull();
    expect(calledSymbols()).toEqual(expect.arrayContaining(['069500', 'AMS:SPY']));
    expect(getTicker).toHaveBeenCalledTimes(2);

    spyFails = false;
    jest.setSystemTime(new Date(T0.getTime() + 60_000));   // 1분 뒤 — 성공 캐시 유효 구간
    const second = await fetchMacroIndicators();
    expect(second.sp500ChangePct).toBeCloseTo(-0.84, 2);
    expect(second.sp500Error).toBeUndefined();
    expect(second.kospiChangePct).toBeCloseTo(-5.48, 2);
    expect(getTicker).toHaveBeenCalledTimes(3);
    expect(getTicker.mock.calls[2][0]).toBe('AMS:SPY');   // KOSPI 는 캐시에서
  });

  test('성공은 5분 동안 재조회하지 않고, 5분이 지나면 다시 조회한다', async () => {
    await fetchMacroIndicators();
    expect(getTicker).toHaveBeenCalledTimes(2);
    jest.setSystemTime(new Date(T0.getTime() + 5 * 60_000 - 1));
    await fetchMacroIndicators();
    expect(getTicker).toHaveBeenCalledTimes(2);
    jest.setSystemTime(new Date(T0.getTime() + 5 * 60_000));
    await fetchMacroIndicators();
    expect(getTicker).toHaveBeenCalledTimes(4);
  });

  test('판정 불가(빈 값)도 캐시하지 않는다', async () => {
    getTicker.mockImplementation(async (s: string) => (s === '069500' ? { symbol: s, price: 0, timestamp: 0 } : { ...(TICKERS[s] as object) }));
    await fetchMacroIndicators();
    await fetchMacroIndicators();
    expect(calledSymbols().filter((s) => s === '069500')).toHaveLength(2);
    expect(calledSymbols().filter((s) => s === 'AMS:SPY')).toHaveLength(1);
  });

  test('clearMacroCache 는 캐시를 비운다', async () => {
    await fetchMacroIndicators();
    clearMacroCache();
    await fetchMacroIndicators();
    expect(getTicker).toHaveBeenCalledTimes(4);
  });
});

describe('USD/KRW — 종전 동작 유지', () => {
  test('첫 호출은 0(기준점 설정), 이후 기준 대비 변화율', async () => {
    expect((await fetchMacroIndicators()).usdKrwChangePct).toBe(0);
    jest.setSystemTime(new Date(T0.getTime() + 10 * 60_000));
    getUsdKrwRate.mockResolvedValue(FX * 1.01);
    expect((await fetchMacroIndicators()).usdKrwChangePct).toBeCloseTo(1, 6);
  });

  test('환율 조회 실패는 null — 지수 판정에는 영향 없음', async () => {
    getUsdKrwRate.mockRejectedValue(new Error('fx down'));
    const m = await fetchMacroIndicators();
    expect(m.usdKrwChangePct).toBeNull();
    expect(m.kospiChangePct).toBeCloseTo(-5.48, 2);
  });
});
