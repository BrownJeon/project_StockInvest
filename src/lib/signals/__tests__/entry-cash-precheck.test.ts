/**
 * T-051 — 진입 감시의 가용 현금 사전 점검 (순수 판정 + 국내 현금 읽기).
 *
 * 지킬 것:
 *  (1) 현금 ≥ 예상 비용(수량 × 가격 × (1 + 여유)) 이면 sufficient — **정확히 같으면 sufficient**
 *  (2) 1원이라도 모자라면 insufficient, 현금 0 도 insufficient(0 은 "모름"이 아니라 "없음")
 *  (3) 입력이 비정상(음수·NaN·Infinity·null·undefined, 수량/가격 0 이하·비정수 수량)이면 unknown → 호출부는 기존 동작
 *  (4) 국내 현금 읽기는 국내 조회가 성공하고 KRW 행이 있을 때만 값을 낸다. 실패·형식 이상은 null(던지지 않는다)
 *  (5) 읽기는 짧은 TTL 로 캐시하고, 동시 호출은 KIS 왕복 1회로 합친다
 */
jest.mock('@/lib/exchanges/kis', () => ({ getBalancesDetailed: jest.fn() }));

import { getBalancesDetailed } from '@/lib/exchanges/kis';
import {
  CASH_READ_TIMEOUT_MS,
  ENTRY_CASH_BUFFER_RATIO,
  ENTRY_CASH_CACHE_TTL_MS,
  domesticCashFromBalances,
  effectiveEntryQuantity,
  estimateEntryCostKRW,
  judgeEntryCash,
  readDomesticAvailableCashKRW,
  resetEntryCashCache,
} from '../entry-cash-precheck';

const detailed = getBalancesDetailed as jest.Mock;

describe('estimateEntryCostKRW', () => {
  test('수량 × 가격 × (1 + 여유), 부동소수 꼬리 없이 원 단위 올림', () => {
    expect(estimateEntryCostKRW(10, 10_000, 0.002)).toBe(100_200);    // 100000 * 1.002 = 100200.00000000001 → 100200
    expect(estimateEntryCostKRW(3, 333.3, 0)).toBe(1_000);            // 999.9 → 1000 (올림)
    expect(estimateEntryCostKRW(1, 6_540, 0)).toBe(6_540);
  });
  test('비정상 입력은 null', () => {
    for (const [q, p] of [[0, 100], [-1, 100], [1.5, 100], [NaN, 100], [1, 0], [1, -5], [1, NaN], [1, Infinity], [Infinity, 1]] as const) {
      expect(estimateEntryCostKRW(q, p, 0.002)).toBeNull();
    }
    expect(estimateEntryCostKRW(1, 100, -0.1)).toBeNull();
    expect(estimateEntryCostKRW(1, 100, NaN)).toBeNull();
  });
});

describe('judgeEntryCash — 경계', () => {
  const base = { quantity: 10, price: 10_000, bufferRatio: 0.002 };   // 필요 100,200원

  test('🔴 정확히 같으면 sufficient', () => {
    expect(judgeEntryCash({ ...base, availableCashKRW: 100_200 })).toEqual({ kind: 'sufficient', requiredKRW: 100_200, availableKRW: 100_200 });
  });
  test('🔴 1원 부족하면 insufficient (부족액 1원)', () => {
    expect(judgeEntryCash({ ...base, availableCashKRW: 100_199 })).toEqual({ kind: 'insufficient', requiredKRW: 100_200, availableKRW: 100_199, shortfallKRW: 1 });
  });
  test('🔴 여유를 반영한다 — 여유 없이는 충분한 현금(100,000원)도 부족으로 본다', () => {
    expect(judgeEntryCash({ ...base, availableCashKRW: 100_000 }).kind).toBe('insufficient');
  });
  test('🔴 현금 0 은 insufficient (모름이 아니다)', () => {
    expect(judgeEntryCash({ ...base, availableCashKRW: 0 })).toMatchObject({ kind: 'insufficient', shortfallKRW: 100_200 });
  });
  test('충분하면 sufficient', () => {
    expect(judgeEntryCash({ ...base, availableCashKRW: 5_000_000 }).kind).toBe('sufficient');
  });
  test('🔴 현금이 음수·NaN·Infinity·null·undefined 이면 unknown (기존 동작으로)', () => {
    for (const c of [-1, NaN, Infinity, -Infinity, null, undefined] as Array<number | null | undefined>) {
      expect(judgeEntryCash({ ...base, availableCashKRW: c }).kind).toBe('unknown');
    }
  });
  test('🔴 수량·가격이 비정상이면 unknown', () => {
    expect(judgeEntryCash({ quantity: undefined, price: 10_000, availableCashKRW: 0 }).kind).toBe('unknown');
    expect(judgeEntryCash({ quantity: 0, price: 10_000, availableCashKRW: 0 }).kind).toBe('unknown');
    expect(judgeEntryCash({ quantity: 10, price: undefined, availableCashKRW: 0 }).kind).toBe('unknown');
    expect(judgeEntryCash({ quantity: 10, price: NaN, availableCashKRW: 0 }).kind).toBe('unknown');
  });
  test('여유 기본값은 ENTRY_CASH_BUFFER_RATIO (0 초과 1% 이하)', () => {
    expect(ENTRY_CASH_BUFFER_RATIO).toBeGreaterThan(0);
    expect(ENTRY_CASH_BUFFER_RATIO).toBeLessThanOrEqual(0.01);
    const need = estimateEntryCostKRW(10, 10_000, ENTRY_CASH_BUFFER_RATIO)!;
    expect(judgeEntryCash({ quantity: 10, price: 10_000, availableCashKRW: need }).kind).toBe('sufficient');
    expect(judgeEntryCash({ quantity: 10, price: 10_000, availableCashKRW: need - 1 }).kind).toBe('insufficient');
  });
});

describe('effectiveEntryQuantity — 어댑터(kis-domestic createOrder)와 같은 파생', () => {
  test('수량이 있으면 그대로, 없으면 floor(금액 / 가격)', () => {
    expect(effectiveEntryQuantity({ quantity: 7, amountKRW: 100_000, price: 6_540 })).toBe(7);
    expect(effectiveEntryQuantity({ quantity: undefined, amountKRW: 100_000, price: 6_540 })).toBe(15);
  });
  test('가격이 없거나 0 이하이면 undefined', () => {
    expect(effectiveEntryQuantity({ quantity: undefined, amountKRW: 100_000, price: undefined })).toBeUndefined();
    expect(effectiveEntryQuantity({ quantity: undefined, amountKRW: 100_000, price: 0 })).toBeUndefined();
  });
});

describe('domesticCashFromBalances', () => {
  test('국내 성공 + KRW 행 → free', () => {
    expect(domesticCashFromBalances({ ok: ['domestic', 'overseas'], balances: [{ currency: 'KRW', free: 80_000, locked: 5_000 }, { currency: '005930', free: 1, locked: 0 }] })).toBe(80_000);
  });
  test('해외만 실패해도 국내 값은 쓴다', () => {
    expect(domesticCashFromBalances({ ok: ['domestic'], balances: [{ currency: 'KRW', free: 0, locked: 0 }] })).toBe(0);
  });
  test('🔴 국내 조회 실패면 null (빈 잔고를 현금 0 으로 읽지 않는다)', () => {
    expect(domesticCashFromBalances({ ok: ['overseas'], balances: [{ currency: 'USD', free: 10, locked: 0 }] })).toBeNull();
    expect(domesticCashFromBalances({ ok: [], balances: [] })).toBeNull();
  });
  test('🔴 KRW 행이 없거나 값이 비정상이면 null', () => {
    expect(domesticCashFromBalances({ ok: ['domestic'], balances: [] })).toBeNull();
    expect(domesticCashFromBalances({ ok: ['domestic'], balances: [{ currency: 'KRW', free: NaN, locked: 0 }] })).toBeNull();
    expect(domesticCashFromBalances({ ok: ['domestic'], balances: [{ currency: 'KRW', free: -1, locked: 0 }] })).toBeNull();
    expect(domesticCashFromBalances(null)).toBeNull();
    expect(domesticCashFromBalances({} as never)).toBeNull();
  });
});

describe('readDomesticAvailableCashKRW — 캐시·실패', () => {
  beforeEach(() => { resetEntryCashCache(); detailed.mockReset(); });
  afterEach(() => jest.restoreAllMocks());

  test('값을 읽고 TTL 동안 다시 조회하지 않는다, TTL 이 지나면 다시 조회한다', async () => {
    detailed.mockResolvedValue({ ok: ['domestic'], balances: [{ currency: 'KRW', free: 80_000, locked: 0 }], failed: [], complete: true });
    let t = 1_000_000;
    expect(await readDomesticAvailableCashKRW(() => t)).toBe(80_000);
    t += ENTRY_CASH_CACHE_TTL_MS - 1;
    expect(await readDomesticAvailableCashKRW(() => t)).toBe(80_000);
    expect(detailed).toHaveBeenCalledTimes(1);
    t += 2;
    detailed.mockResolvedValue({ ok: ['domestic'], balances: [{ currency: 'KRW', free: 200_000, locked: 0 }], failed: [], complete: true });
    expect(await readDomesticAvailableCashKRW(() => t)).toBe(200_000);
    expect(detailed).toHaveBeenCalledTimes(2);
  });

  test('🔴 조회가 던지면 null 을 돌려주고 던지지 않는다', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    detailed.mockRejectedValue(new Error('EGW00201'));
    await expect(readDomesticAvailableCashKRW()).resolves.toBeNull();
  });

  test('🔴 시간 상한 기본값은 8초(CASH_READ_TIMEOUT_MS)', () => {
    expect(CASH_READ_TIMEOUT_MS).toBe(8_000);
  });

  test('🔴 상한을 넘으면 null(판단불가) 을 돌려준다 — 조회가 끝나기를 기다리지 않는다', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    detailed.mockImplementation(async () => { await gate; return { ok: ['domestic'], balances: [{ currency: 'KRW', free: 1, locked: 0 }] }; });
    const started = Date.now();
    await expect(readDomesticAvailableCashKRW(Date.now, 30)).resolves.toBeNull();
    expect(Date.now() - started).toBeLessThan(1_000);
    release();
  });

  test('🔴 상한을 넘겨 늦게 도착한 결과는 캐시에 넣지 않는다 — 다음 읽기는 새로 조회한다', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    detailed.mockImplementationOnce(async () => { await gate; return { ok: ['domestic'], balances: [{ currency: 'KRW', free: 111, locked: 0 }] }; });
    expect(await readDomesticAvailableCashKRW(Date.now, 20)).toBeNull();
    release();
    await new Promise((r) => setTimeout(r, 30));                         // 늦은 결과(111)가 도착해 처리될 시간을 준다
    detailed.mockResolvedValueOnce({ ok: ['domestic'], balances: [{ currency: 'KRW', free: 222, locked: 0 }] });
    expect(await readDomesticAvailableCashKRW(Date.now, 1_000)).toBe(222);  // 111 이 캐시돼 있었다면 111 이 나온다
    expect(detailed).toHaveBeenCalledTimes(2);
  });

  test('상한 안에 끝난 조회는 그대로 쓰고 캐시한다', async () => {
    detailed.mockResolvedValue({ ok: ['domestic'], balances: [{ currency: 'KRW', free: 333, locked: 0 }] });
    expect(await readDomesticAvailableCashKRW(Date.now, 1_000)).toBe(333);
    expect(await readDomesticAvailableCashKRW(Date.now, 1_000)).toBe(333);
    expect(detailed).toHaveBeenCalledTimes(1);
  });

  test('동시 호출은 조회 1회로 합친다', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    detailed.mockImplementation(async () => { await gate; return { ok: ['domestic'], balances: [{ currency: 'KRW', free: 1, locked: 0 }], failed: [], complete: true }; });
    const a = readDomesticAvailableCashKRW();
    const b = readDomesticAvailableCashKRW();
    release();
    expect(await Promise.all([a, b])).toEqual([1, 1]);
    expect(detailed).toHaveBeenCalledTimes(1);
  });
});

describe('domesticCashFromBalances — free 원시 타입 검증 (T-051 라운드 3, Codex C2)', () => {
  const read = (free: unknown) => domesticCashFromBalances({ ok: ['domestic'], balances: [{ currency: 'KRW', free, locked: 0 }] });

  test.each([
    ['빈 문자열', ''], ['공백 문자열', '   '], ['null', null], ['undefined', undefined], ['true', true], ['false', false],
    ['객체', {}], ['배열', []], ["'12abc'", '12abc'], ["'1e3'", '1e3'], ["'0x10'", '0x10'], ["'-1'", '-1'], ["'1,000'", '1,000'],
    ['NaN', NaN], ['Infinity', Infinity], ['-Infinity', -Infinity], ['음수', -1],
  ])('🔴 %s → null(판단불가) — 현금 0원으로 읽지 않는다', (_n, free) => {
    expect(read(free)).toBeNull();
  });

  test.each([
    ['숫자 0', 0, 0], ["문자열 '0'", '0', 0], ['숫자', 80_000, 80_000], ['문자열', '80000', 80_000],
    ['앞뒤 공백 문자열', ' 80000 ', 80_000], ['소수 문자열', '80000.5', 80_000.5], ['소수 숫자', 0.5, 0.5],
  ])('%s → 유효한 현금', (_n, free, want) => {
    expect(read(free)).toBe(want);
  });
});

describe('readDomesticAvailableCashKRW — 공유 마감(한 조회당 대기는 상한 한 번) (T-051 라운드 3, Codex C2·Reviewer R2-1)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    resetEntryCashCache(); detailed.mockReset();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

  /** 끝났는지 들여다볼 수 있게 감싼다 */
  const track = <T>(p: Promise<T>) => { const s = { done: false, value: undefined as T | undefined }; p.then((v) => { s.done = true; s.value = v; }); return s; };
  const hang = () => detailed.mockImplementation(() => new Promise(() => {}));

  test('🔴 멈춘 조회에 4개가 순차로 접근해도 총 대기는 8,000ms — 첫 호출만 기다리고 뒤는 0ms 에 null', async () => {
    hang();
    const t0 = Date.now();
    const first = track(readDomesticAvailableCashKRW());
    await jest.advanceTimersByTimeAsync(7_999);
    expect(first.done).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(first).toEqual({ done: true, value: null });
    for (let i = 0; i < 3; i++) {
      const next = track(readDomesticAvailableCashKRW());
      await jest.advanceTimersByTimeAsync(0);                             // 시간을 흘리지 않고도 끝나야 한다
      expect(next).toEqual({ done: true, value: null });
    }
    expect(Date.now() - t0).toBe(8_000);
    expect(detailed).toHaveBeenCalledTimes(1);                           // 걸린 요청 위에 새 요청을 쌓지 않는다
  });

  test('🔴 상한 직전에 합류한 호출은 남은 시간만 기다린다', async () => {
    hang();
    const first = track(readDomesticAvailableCashKRW());
    await jest.advanceTimersByTimeAsync(7_000);
    const late = track(readDomesticAvailableCashKRW());
    await jest.advanceTimersByTimeAsync(999);
    expect([first.done, late.done]).toEqual([false, false]);
    await jest.advanceTimersByTimeAsync(1);                              // 합류 1,000ms 뒤 = 공유 마감
    expect([first.done, late.done]).toEqual([true, true]);
    expect(late.value).toBeNull();
  });

  test('🔴 늦게 끝난 조회는 캐시하지 않고, 정리된 뒤 다음 호출은 새 조회를 시작해 상한 전체를 다시 쓴다', async () => {
    let release!: () => void;
    detailed.mockImplementationOnce(async () => { await new Promise<void>((r) => { release = r; }); return { ok: ['domestic'], balances: [{ currency: 'KRW', free: 111, locked: 0 }] }; });
    const first = track(readDomesticAvailableCashKRW());
    await jest.advanceTimersByTimeAsync(8_000);
    expect(first.value).toBeNull();
    release();
    await jest.advanceTimersByTimeAsync(1_000);                          // 늦은 결과(111) 처리 — inFlight·시작 시각 정리
    hang();
    const second = track(readDomesticAvailableCashKRW());
    await jest.advanceTimersByTimeAsync(7_999);
    expect(second.done).toBe(false);                                     // 옛 시작 시각이 남아 있었다면 즉시 null
    await jest.advanceTimersByTimeAsync(1);
    expect(second).toEqual({ done: true, value: null });
    expect(detailed).toHaveBeenCalledTimes(2);
  });

  test('실패로 끝난 조회도 정리된다 — 실패는 TTL 동안 null 캐시, TTL 뒤 새 조회는 상한 전체를 쓴다', async () => {
    detailed.mockRejectedValueOnce(new Error('EGW00201'));
    expect(await readDomesticAvailableCashKRW()).toBeNull();
    await jest.advanceTimersByTimeAsync(ENTRY_CASH_CACHE_TTL_MS);
    hang();
    const next = track(readDomesticAvailableCashKRW());
    await jest.advanceTimersByTimeAsync(7_999);
    expect(next.done).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(next.done).toBe(true);
    expect(detailed).toHaveBeenCalledTimes(2);
  });

  test('resetEntryCashCache 는 진행 중 조회와 시작 시각도 비운다', async () => {
    hang();
    track(readDomesticAvailableCashKRW());
    await jest.advanceTimersByTimeAsync(9_000);
    resetEntryCashCache();
    const next = track(readDomesticAvailableCashKRW());
    await jest.advanceTimersByTimeAsync(7_999);
    expect(next.done).toBe(false);
    expect(detailed).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1);
  });

  test('🔴 타이머가 남지 않는다 — 성공·실패·상한 초과 뒤 모두 0개', async () => {
    detailed.mockResolvedValueOnce({ ok: ['domestic'], balances: [{ currency: 'KRW', free: 5, locked: 0 }] });
    expect(await readDomesticAvailableCashKRW()).toBe(5);
    expect(jest.getTimerCount()).toBe(0);

    resetEntryCashCache();
    detailed.mockRejectedValueOnce(new Error('x'));
    expect(await readDomesticAvailableCashKRW()).toBeNull();
    expect(jest.getTimerCount()).toBe(0);

    resetEntryCashCache();
    hang();
    const t = track(readDomesticAvailableCashKRW());
    await jest.advanceTimersByTimeAsync(8_000);
    expect(t.done).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });
});
