/**
 * T-042 / D2 — "이 매수가 지금 실행될 수 있는가".
 *
 * 🔴 이 판정은 알림을 **줄이는** 쪽이다. 잘못 줄이면 사용자가 실행 가능한 시그널을 놓친다.
 *    그래서 불확실하면 언제나 "실행 가능"(= 알림을 보낸다)이어야 한다 — 아래 fail-open 테스트가 핵심이다.
 */
import { assessExecutability, CASH_SHORTFALL_RATIO, exceedsLimit, resetApprovalContextCache } from '../approval-context';
import { checkDailyMax, checkOrderMax } from '@/lib/safety/order-limits';
import { getPool } from '@/lib/db';
import { getEffectiveDailyMax, getEffectiveOrderMax } from '@/lib/safety/order-limits';

jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));
// 🔴 한도 *계산*(getEffective*)만 목으로 두고 판정 함수(checkOrderMax·checkDailyMax)는 **실제 구현**을 쓴다.
//    이전에는 전부 목이어서 "한도 조회 실패 = 0 을 돌려준다"는 실제 계약을 놓쳤다(T-042 감사 D-3).
jest.mock('@/lib/safety/order-limits', () => ({
  ...jest.requireActual('@/lib/safety/order-limits'),
  getEffectiveOrderMax: jest.fn(),
  getEffectiveDailyMax: jest.fn(),
}));

const NOW = Date.parse('2026-10-12T04:20:00Z');
const AMOUNT = 1_000_000;

interface World {
  snapshot?: { total_krw: number; positions: unknown; ageMs: number } | 'throw' | 'none';
  used?: number | 'throw';
}

let snapshotQueries = 0;

function world(w: World = {}) {
  snapshotQueries = 0;
  const query = jest.fn(async (sql: string) => {
    if (/FROM portfolio_snapshots/.test(sql)) {
      snapshotQueries++;
      if (w.snapshot === 'throw') throw new Error('db down');
      if (w.snapshot === 'none') return [[]];
      const s = w.snapshot ?? { total_krw: 20_000_000, positions: [{ currency: 'KRW', value_krw: 3_000_000 }, { currency: 'USD', value_krw: 500_000 }, { currency: 'NAS:MU', value_krw: 16_500_000 }], ageMs: 10 * 60_000 };
      return [[{ total_krw: s.total_krw, positions: JSON.stringify(s.positions), ts: new Date(NOW - s.ageMs) }]];
    }
    if (/FROM orders/.test(sql)) {
      if (w.used === 'throw') throw new Error('db down');
      return [[{ sum_krw: w.used ?? 400_000 }]];
    }
    throw new Error(`unexpected SQL: ${sql}`);
  });
  (getPool as jest.Mock).mockReturnValue({ query });
  (getEffectiveOrderMax as jest.Mock).mockResolvedValue(1_200_000);
  (getEffectiveDailyMax as jest.Mock).mockResolvedValue(2_300_000);
}

const run = (over: Partial<Parameters<typeof assessExecutability>[0]> = {}) =>
  assessExecutability({ symbol: 'NAS:BKNG', side: 'buy', amountKRW: AMOUNT, price: 215_000, now: NOW, ...over });

beforeEach(() => { jest.clearAllMocks(); resetApprovalContextCache(); });

describe('실행 가능', () => {
  test('현금·한도 모두 충분하면 실행 가능 + 맥락 값을 채운다', async () => {
    world();
    const r = await run();
    expect(r).toEqual({
      executable: true, reasons: [],
      // T-056: 해외 매수(NAS:BKNG)의 현금 = **USD 행만**(500,000). 예전 기대값 3,500,000 은 KRW+USD 합산이었다 —
      //        달러가 아닌 원화로는 해외 주식을 못 사고 그 반대도 같아서 시장별로 나눴다(계약 변경, task T-056 Developer 절).
      ctx: { totalKRW: 20_000_000, cashKRW: 500_000, dailyRemainingKRW: 1_900_000 },
    });
  });

  test('🔴 매도는 한도·현금과 무관하게 항상 실행 가능 (포지션 청산 — 주문 경로와 같은 원칙), 조회도 하지 않는다', async () => {
    world();
    (getEffectiveOrderMax as jest.Mock).mockResolvedValue(1);        // 매수라면 막힐 한도
    const r = await run({ side: 'sell' });
    expect(r.executable).toBe(true);
    expect(getPool).not.toHaveBeenCalled();
  });

  test('현금이 시그널 금액의 정확히 50% 이면 아직 실행 가능, 1원 모자라면 현금 부족', async () => {
    expect(CASH_SHORTFALL_RATIO).toBe(0.5);
    // T-056: 기본 심볼이 해외(NAS:BKNG)라 현금 행을 USD 로 둔다(시장별 현금). 경계 판정 자체는 그대로다.
    world({ snapshot: { total_krw: 20_000_000, positions: [{ currency: 'USD', value_krw: 500_000 }], ageMs: 60_000 } });
    expect((await run()).executable).toBe(true);
    resetApprovalContextCache();
    world({ snapshot: { total_krw: 20_000_000, positions: [{ currency: 'USD', value_krw: 499_999 }], ageMs: 60_000 } });
    expect(await run()).toMatchObject({ executable: false, reasons: ['cash'] });
  });
});

describe('실행 불가 사유', () => {
  test('🔴 오늘의 실제 상황 — 현금 8만 원, 매수 112만 원 → 현금 부족', async () => {
    world({ snapshot: { total_krw: 22_936_066, positions: [{ currency: 'KRW', value_krw: 80_000 }, { currency: 'NAS:MU', value_krw: 15_180_000 }], ageMs: 5 * 60_000 } });
    // T-056: 이 스냅샷(배포 전 구형)에는 USD 행이 없다 → 해외 매수의 현금은 "모름" — 원화 8만 원을 해외 현금으로 세지 않는다.
    //        같은 사실을 국내 매수로 보면 예전 판정(현금 8만 원 → 부족)이 그대로다.
    expect(await run({ symbol: '005930', amountKRW: 1_121_925, price: 70_000 })).toMatchObject({ executable: false, reasons: ['cash'], ctx: { cashKRW: 80_000 } });
  });

  test('🔴 T-056 배포 후 실제 모양 — KRW 80,138 + USD 368.51(490,892원), 해외 매수 112만 원 → USD 만 보고 현금 부족', async () => {
    world({ snapshot: { total_krw: 20_560_017, positions: [{ currency: 'KRW', value_krw: 80_138 }, { currency: 'USD', value_krw: 490_892 }, { currency: 'NAS:MU', value_krw: 13_259_446 }], ageMs: 5 * 60_000 } });
    expect(await run({ amountKRW: 1_121_925 })).toMatchObject({ executable: false, reasons: ['cash'], ctx: { cashKRW: 490_892 } });
  });

  test('1회 한도(양수)를 금액이 넘으면 order_limit — 주문 경로의 실제 checkOrderMax 판정', async () => {
    world();
    (getEffectiveOrderMax as jest.Mock).mockResolvedValue(900_000);          // 금액 1,000,000 > 900,000
    expect(await run()).toMatchObject({ executable: false, reasons: ['order_limit'] });
  });

  test('1회 한도와 정확히 같은 금액은 통과 (경계: amount > max 만 차단)', async () => {
    world();
    (getEffectiveOrderMax as jest.Mock).mockResolvedValue(AMOUNT);
    expect((await run()).executable).toBe(true);
  });

  test('일 한도: 오늘 사용액 + 이번 금액이 한도를 넘으면 daily_limit — 실제 checkDailyMax 판정', async () => {
    world({ used: 1_500_000 });                                              // 1.5M + 1.0M > 2.3M
    expect(await run()).toMatchObject({ executable: false, reasons: ['daily_limit'] });
  });

  test('일 한도 경계: 사용액 + 금액 == 한도 는 통과', async () => {
    world({ used: 1_300_000 });                                              // 1.3M + 1.0M == 2.3M
    expect((await run()).executable).toBe(true);
  });

  test('여러 사유가 겹치면 모두 적는다', async () => {
    world({ used: 2_000_000, snapshot: { total_krw: 20_000_000, positions: [{ currency: 'USD', value_krw: 1 }], ageMs: 60_000 } });   // 해외 매수 → USD 행 (T-056)
    (getEffectiveOrderMax as jest.Mock).mockResolvedValue(500_000);
    expect((await run()).reasons.sort()).toEqual(['cash', 'daily_limit', 'order_limit']);
  });

  test('시그널의 시장에 맞는 한도를 묻는다 (국내 종목은 국내 한도)', async () => {
    world();
    await run({ symbol: '005930', amountKRW: 700_000, price: 70_000 });
    expect(getEffectiveOrderMax).toHaveBeenCalledWith('kis', 'domestic');
    expect(getEffectiveDailyMax).toHaveBeenCalledWith('kis', 'domestic');
    await run({ symbol: 'NAS:BKNG' });
    expect(getEffectiveOrderMax).toHaveBeenCalledWith('kis', 'overseas');
  });
});

describe('🔴 의심스러우면 보낸다 (fail-open)', () => {
  test('스냅샷 조회 실패 → 현금을 모르므로 현금 사유를 만들지 않는다', async () => {
    world({ snapshot: 'throw' });
    expect(await run()).toMatchObject({ executable: true, ctx: { cashKRW: null, totalKRW: null } });
  });

  test('스냅샷이 없다 → 실행 가능', async () => {
    world({ snapshot: 'none' });
    expect((await run()).executable).toBe(true);
  });

  test('스냅샷이 3시간보다 낡았다 → 현금을 믿지 않는다 (킬스위치의 현재값 신뢰 한계와 같다)', async () => {
    world({ snapshot: { total_krw: 20_000_000, positions: [{ currency: 'KRW', value_krw: 1 }], ageMs: 3 * 3600_000 + 1000 } });
    expect(await run()).toMatchObject({ executable: true, ctx: { cashKRW: null } });
  });

  test('positions 가 깨졌다·배열이 아니다 → 실행 가능', async () => {
    world({ snapshot: { total_krw: 20_000_000, positions: 'garbage' as unknown, ageMs: 60_000 } });
    expect((await run()).executable).toBe(true);
    resetApprovalContextCache();
    world({ snapshot: { total_krw: 20_000_000, positions: { a: 1 }, ageMs: 60_000 } });
    expect((await run()).executable).toBe(true);
  });

  test('총자산이 0 이하·비정상 → 스냅샷을 믿지 않는다', async () => {
    world({ snapshot: { total_krw: 0, positions: [{ currency: 'KRW', value_krw: 1 }], ageMs: 60_000 } });
    expect(await run()).toMatchObject({ executable: true, ctx: { cashKRW: null } });
  });

  test('🔴 집계 쿼리가 실패해 checkDailyMax 가 fail-closed 로 막아도 "일 한도 소진"으로 세지 않는다', async () => {
    world({ used: 'throw' });
    const r = await run();
    expect(r).toMatchObject({ executable: true, reasons: [] });
  });

  test('금액이 확정되지 않았을 때(NaN)의 차단도 한도 초과가 아니다', async () => {
    world();
    expect(await run({ amountKRW: NaN })).toMatchObject({ reasons: expect.not.arrayContaining(['order_limit', 'daily_limit']) });
  });

  test('🔴 [감사 D-3] 한도가 0 이면(KIS 평가액 조회 실패·정책 미설정) "모른다"로 본다 — 실행 불가로 오판해 알림을 삼키지 않는다', async () => {
    // 실제 order-limits 계약: 조회 실패/미설정 시 *예외 없이* 0 을 돌려준다. 0 은 주문 경로에서 "신규 매수 전면 거부"로 읽힌다.
    world();
    (getEffectiveOrderMax as jest.Mock).mockResolvedValue(0);
    (getEffectiveDailyMax as jest.Mock).mockResolvedValue(0);
    const r = await run();
    expect(r).toMatchObject({ executable: true, reasons: [] });
    expect(r.ctx.dailyRemainingKRW).toBeNull();            // 모르는 한도로 잔여액을 지어내지 않는다
  });

  test('한도가 NaN·Infinity·음수여도 모른다로 본다', async () => {
    for (const bad of [NaN, Infinity, -5]) {
      resetApprovalContextCache(); world();
      (getEffectiveOrderMax as jest.Mock).mockResolvedValue(bad);
      (getEffectiveDailyMax as jest.Mock).mockResolvedValue(bad);
      expect((await run()).executable).toBe(true);
    }
  });

  test('한도 하나만 0 이면 나머지 한도 판정은 유효하다 (1회 한도 조회 실패 + 일 한도 소진)', async () => {
    world({ used: 2_000_000 });
    (getEffectiveOrderMax as jest.Mock).mockResolvedValue(0);
    expect(await run()).toMatchObject({ executable: false, reasons: ['daily_limit'] });
  });

  test('한도 조회가 던지면 한도 사유를 만들지 않고, 현금 판정은 계속한다', async () => {
    world({ snapshot: { total_krw: 20_000_000, positions: [{ currency: 'USD', value_krw: 1 }], ageMs: 60_000 } });   // 해외 매수 → USD 행 (T-056)
    (getEffectiveOrderMax as jest.Mock).mockRejectedValue(new Error('db down'));
    expect(await run()).toMatchObject({ executable: false, reasons: ['cash'] });
  });

  test('오늘 사용액 조회가 실패해도(표시 전용) 판정은 영향받지 않는다', async () => {
    world({ used: 'throw' });
    const r = await run();
    expect(r.executable).toBe(true);
    expect(r.ctx.dailyRemainingKRW).toBeNull();
  });

  test('현금 행의 값이 숫자가 아니면 0 으로 센다 (예외 없음)', async () => {
    world({ snapshot: { total_krw: 20_000_000, positions: [{ currency: 'KRW', value_krw: 'abc' }, null, 5, { currency: 'USD' }], ageMs: 60_000 } });
    await expect(run()).resolves.toMatchObject({ executable: false, reasons: ['cash'], ctx: { cashKRW: 0 } });
  });
});

describe('🔴 T-056 — 현금은 시장별로 본다 (달러로 국내 주식을 못 산다)', () => {
  test('국내 매수는 KRW 행만 — USD 를 더하면 통과했을 금액도 현금 부족', async () => {
    world();                                                                 // KRW 3,000,000 + USD 500,000
    const r = await run({ symbol: '005930', amountKRW: 7_000_000, price: 70_000 });   // 기준 3,500,000
    expect(r).toMatchObject({ reasons: expect.arrayContaining(['cash']), ctx: { cashKRW: 3_000_000 } });
  });

  test('해외 매수는 USD 행만 — KRW 를 더하면 통과했을 금액도 현금 부족', async () => {
    world();
    const r = await run({ amountKRW: 1_100_000 });                             // 기준 550,000 > USD 500,000
    expect(r).toMatchObject({ reasons: expect.arrayContaining(['cash']), ctx: { cashKRW: 500_000 } });
  });

  test('그 시장의 현금 행이 없으면(구형 스냅샷) 모름 — 현금 사유를 만들지 않는다(의심스러우면 보낸다)', async () => {
    world({ snapshot: { total_krw: 20_000_000, positions: [{ currency: 'KRW', value_krw: 1 }, { currency: 'NAS:MU', value_krw: 19_999_999 }], ageMs: 60_000 } });
    expect(await run()).toMatchObject({ executable: true, reasons: [], ctx: { cashKRW: null, totalKRW: 20_000_000 } });
    resetApprovalContextCache();
    world({ snapshot: { total_krw: 20_000_000, positions: [{ currency: 'USD', value_krw: 1 }, { currency: '005930', value_krw: 19_999_999 }], ageMs: 60_000 } });
    expect(await run({ symbol: '005930', price: 70_000 })).toMatchObject({ executable: true, reasons: [], ctx: { cashKRW: null } });
  });

  test('USD 0 행(확인된 0)은 모름이 아니라 0 — 해외 매수 현금 부족', async () => {
    world({ snapshot: { total_krw: 20_000_000, positions: [{ currency: 'KRW', value_krw: 5_000_000 }, { currency: 'USD', value_krw: 0 }], ageMs: 60_000 } });
    expect(await run()).toMatchObject({ executable: false, reasons: ['cash'], ctx: { cashKRW: 0 } });
  });
});

describe('캐시', () => {
  test('스냅샷은 60초 동안 한 번만 읽는다 (신호가 몰릴 때 DB 를 두드리지 않는다)', async () => {
    world();
    await run(); await run({ now: NOW + 30_000 });
    expect(snapshotQueries).toBe(1);
    await run({ now: NOW + 61_000 });
    expect(snapshotQueries).toBe(2);
  });
});

describe('exceedsLimit — 진짜 초과와 "확인 못 함"을 구분 (실제 함수의 상세 형식에 묶인다)', () => {
  test('🔴 실제 checkOrderMax·checkDailyMax 가 내는 초과 상세를 알아본다 (형식이 바뀌면 여기서 깨진다)', async () => {
    const orderOver = checkOrderMax({ exchange: 'kis', symbol: '005930', side: 'buy', type: 'limit', amountKRW: 1_000_000 }, 900_000);
    expect(orderOver.ok).toBe(false);
    expect(exceedsLimit(orderOver)).toBe(true);

    world({ used: 1_500_000 });
    const dailyOver = await checkDailyMax({ exchange: 'kis', symbol: '005930', side: 'buy', type: 'limit', amountKRW: 1_000_000, market: 'domestic' }, 2_300_000);
    expect(dailyOver.ok).toBe(false);
    expect(exceedsLimit(dailyOver)).toBe(true);
  });

  test.each([
    'order limit not configured (0) — buy blocked',
    'daily limit not configured (0) — buy blocked',
    'aggregate query failed',
    'amount unresolved',
    '',
  ])('"%s" 는 초과가 아니다', (detail) => {
    expect(exceedsLimit({ ok: false, detail })).toBe(false);
  });

  test('통과(ok)면 당연히 아니다', () => {
    expect(exceedsLimit({ ok: true })).toBe(false);
    expect(exceedsLimit({ ok: true, detail: '1 > 0' })).toBe(false);
  });
});
