/**
 * T-097 — "주가(수량) 먼저, 결과 금액으로 처리" 사이징. 수용 기준 (a)(c)(d).
 *
 *  (a) 🔴 옵션 OFF(기본)에서 **주문 요청이 T-097 이전(base f50a3f7)과 비트 단위로 같다.**
 *      base 의 `sizeOrderQuantity`·`buildOrderRequest` 를 이 파일 안에 그대로 복제(`base*`)해 같은 입력의 출력을 `Object.is` 로 비교한다.
 *      가격 격자(미국 $50·$200·$880, 국내 5만·50만 원) × 호가 추격(0·+0.5%) × 시장 2 × 지정가·시장가 × 매수·매도 × 수량 유무,
 *      그리고 시드 고정 난수 2만 건(부동소수점 경계 포함).
 *  (c) 옵션 ON: 1주가 목표보다 크면 1주로 올리고, 한도 기준 금액이 실현액이 되어 1회 한도에서 막힌다.
 *  (d) 해외는 `amountKRW` 를 원화로 직접 채운다 — 비우면 `resolveOrderAmountKRWAsync` 가 환율을 또 곱한다(재현·방지).
 */
jest.mock('@/lib/db', () => ({ getPool: jest.fn(), getAccountId: jest.fn() }));
jest.mock('@/lib/exchanges/fx', () => ({
  usdToKrw: jest.fn(async (usd: number) => usd * 1324),
  getUsdKrwRate: jest.fn(async () => 1324),
}));

import { usdToKrw } from '@/lib/exchanges/fx';
import { getMarketFromSymbol, type Market } from '@/lib/exchanges/kis-symbols';
import { submittedQuantity } from '@/lib/exchanges/order-quantity';
import type { OrderRequest } from '@/lib/exchanges/types';
import { checkOrderMax, resolveOrderAmountKRWAsync } from '@/lib/safety/order-limits';
import type { SignalInput } from '../router';
import { buildOrderRequest, sizeOrderQuantity } from '../service';
import { overseasLimitUnitUsd } from '../signal-cash-gate';
import {
  SIZING_RULE,
  attachSizingSnapshot,
  computeRealizedKrw,
  computeSizingSnapshot,
  limitBasisKrw,
  readSizingSnapshot,
} from '../sizing-snapshot';

const FX = 1324;

// ── base(f50a3f7) 복제 — 이 블록은 고치지 않는다. T-097 이전 동작의 기준값이다 ─────────────────
function baseToWholeShares(market: Market, raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return submittedQuantity(market, Math.floor(raw));
}
function baseSizeOrderQuantity(args: {
  market: Market; orderType: 'limit' | 'market'; requestedQuantity?: number | null; amountKRW: number; price?: number | null;
}): { quantity: number | undefined; raw: number | undefined } {
  const { market, orderType, requestedQuantity, amountKRW, price } = args;
  if (requestedQuantity != null && Number.isFinite(requestedQuantity)) {
    return { quantity: baseToWholeShares(market, requestedQuantity), raw: requestedQuantity };
  }
  if (orderType === 'limit' && price != null && Number.isFinite(price) && price > 0) {
    const raw = amountKRW / price;
    return { quantity: baseToWholeShares(market, raw), raw };
  }
  return { quantity: undefined, raw: undefined };
}
function baseBuildOrderRequest(input: SignalInput, chasePct = 0): { req: OrderRequest; sized: { quantity: number | undefined; raw: number | undefined } } {
  const market = getMarketFromSymbol(input.symbol);
  let chasedPrice = input.price;
  if (chasedPrice != null && chasePct > 0 && input.orderType === 'limit') {
    const factor = input.side === 'buy' ? 1 + chasePct : 1 - chasePct;
    chasedPrice = chasedPrice * factor;
  }
  const sized = baseSizeOrderQuantity({
    market, orderType: input.orderType, requestedQuantity: input.quantity, amountKRW: input.amountKRW, price: chasedPrice,
  });
  return {
    req: {
      exchange: 'kis', symbol: input.symbol, side: input.side, type: input.orderType, price: chasedPrice,
      quantity: sized.quantity, amountKRW: input.amountKRW, market, currency: market === 'overseas' ? 'USD' : 'KRW',
    },
    sized,
  };
}
// ────────────────────────────────────────────────────────────────────────────────────────────

/** 두 주문 요청이 키 집합·값 모두 `Object.is` 로 같다(-0·NaN 구분 포함) */
function expectBitIdentical(actual: Record<string, unknown>, expected: Record<string, unknown>) {
  expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
  for (const k of Object.keys(expected)) {
    if (!Object.is(actual[k], expected[k])) {
      throw new Error(`필드 ${k} 불일치: actual=${String(actual[k])} expected=${String(expected[k])}`);
    }
  }
}

/** 가격 격자 — 해외는 원화 환산 단가(달러 × 1,324) */
const PRICE_GRID: Array<{ label: string; symbol: string; price: number }> = [
  { label: '미국 $50', symbol: 'NAS:AAPL', price: 50 * FX },
  { label: '미국 $200', symbol: 'NAS:AAPL', price: 200 * FX },
  { label: '미국 $880', symbol: 'NAS:MU', price: 880 * FX },
  { label: '국내 5만', symbol: '005930', price: 50_000 },
  { label: '국내 50만', symbol: '000660', price: 500_000 },
];
/** 목표금액 — 엔진 슬롯 10만, 해외 평가액 4% 근사 75만, T-020 실측(132,223·718,971), 가격과 정확히 나눠지는 값, 1주 미만 */
const TARGETS = [100_000, 750_000, 132_223, 718_971, 132_400, 1_000_000, 30_000];
const CHASES = [0, 0.005];

describe('(a) 옵션 OFF — 주문 요청이 T-097 이전과 비트 단위로 같다', () => {
  test('가격 격자 × 목표 × 호가 추격 × 지정가·시장가 × 매수·매도 × 수량 유무', () => {
    let n = 0;
    for (const g of PRICE_GRID) {
      for (const amountKRW of TARGETS) {
        for (const chase of CHASES) {
          for (const orderType of ['limit', 'market'] as const) {
            for (const side of ['buy', 'sell'] as const) {
              for (const quantity of [undefined, 7, 2.6]) {
                const input: SignalInput = { symbol: g.symbol, side, orderType, price: g.price, amountKRW, ...(quantity !== undefined ? { quantity } : {}) };
                const base = baseBuildOrderRequest(input, chase);
                const now = buildOrderRequest(input, chase);
                expectBitIdentical(now.req as unknown as Record<string, unknown>, base.req as unknown as Record<string, unknown>);
                // 사이징 결과도 키까지 같다 — 옵션 OFF 에서는 `minOneShareApplied` 키가 없다
                expectBitIdentical(now.sized as unknown as Record<string, unknown>, base.sized as unknown as Record<string, unknown>);
                // sizeOrderQuantity 단독도 같다
                const sq = { market: getMarketFromSymbol(g.symbol), orderType, requestedQuantity: quantity, amountKRW, price: g.price };
                expectBitIdentical(sizeOrderQuantity(sq) as unknown as Record<string, unknown>, baseSizeOrderQuantity(sq) as unknown as Record<string, unknown>);
                // 기록의 한도 기준 금액 = 실제 주문 요청 amountKRW
                expect(Object.is(now.sizing.limitBasisKrw, now.req.amountKRW)).toBe(true);
                n++;
              }
            }
          }
        }
      }
    }
    expect(n).toBe(PRICE_GRID.length * TARGETS.length * CHASES.length * 2 * 2 * 3);
  });

  // 격자의 핵심 값은 숫자로도 박아 둔다(base 복제가 함께 틀리는 경우 대비)
  test.each([
    // [라벨, symbol, price, target, chase, 기대 수량, 기대 지정가, 기대 amountKRW]
    ['국내 5만 · 10만', '005930', 50_000, 100_000, 0, 2, 50_000, 100_000],
    ['국내 5만 · 10만 · 추격', '005930', 50_000, 100_000, 0.005, 1, 50_000 * 1.005, 100_000],
    ['국내 50만 · 10만(1주 미만)', '000660', 500_000, 100_000, 0, 0, 500_000, 100_000],
    ['미국 $50 · 75만', 'NAS:AAPL', 66_200, 750_000, 0, 11, 66_200, 750_000],
    ['미국 $50 · 75만 · 추격', 'NAS:AAPL', 66_200, 750_000, 0.005, 11, 66_200 * 1.005, 750_000],
    ['미국 $200 · 75만', 'NAS:AAPL', 264_800, 750_000, 0, 2, 264_800, 750_000],
    ['미국 $880 · 75만(1주 미만)', 'NAS:MU', 1_165_120, 750_000, 0, 0, 1_165_120, 750_000],
    ['미국 $880 · 10만(1주 미만)', 'NAS:MU', 1_165_120, 100_000, 0.005, 0, 1_165_120 * 1.005, 100_000],
  ])('고정 기대값: %s', (_l, symbol, price, amountKRW, chase, qty, px, amt) => {
    const { req } = buildOrderRequest({ symbol, side: 'buy', orderType: 'limit', price, amountKRW }, chase);
    expect(req.quantity).toBe(qty);
    expect(req.price).toBe(px);
    expect(req.amountKRW).toBe(amt);
  });

  test('시드 고정 난수 20,000건 — 부동소수점 경계 포함', () => {
    let seed = 0x9e3779b9;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
    for (let i = 0; i < 20_000; i++) {
      const overseas = rnd() < 0.5;
      const price = Math.round((overseas ? 1 + rnd() * 1500 : 100 + rnd() * 900_000) * (overseas ? FX : 1) * 100) / 100;
      // 절반은 "가격의 정수배 ± 아주 작은 값" — floor(a/p)×p 가 a 를 1ulp 넘는 경계를 노린다
      const k = 1 + Math.floor(rnd() * 20);
      const amountKRW = rnd() < 0.5 ? k * price * (1 + (rnd() - 0.5) * 1e-15) : 1_000 + rnd() * 3_000_000;
      const chase = rnd() < 0.5 ? 0 : 0.005;
      const side = rnd() < 0.8 ? 'buy' as const : 'sell' as const;
      const input: SignalInput = { symbol: overseas ? 'NYS:KO' : '035420', side, orderType: 'limit', price, amountKRW };
      const base = baseBuildOrderRequest(input, chase);
      const now = buildOrderRequest(input, chase);
      expectBitIdentical(now.req as unknown as Record<string, unknown>, base.req as unknown as Record<string, unknown>);
      expectBitIdentical(now.sized as unknown as Record<string, unknown>, base.sized as unknown as Record<string, unknown>);
    }
  });

  test('부동소수점 경계(수량 × 가격이 목표를 1ulp 넘음)에서도 목표금액 그대로 — 값 비교가 아니라 분기로 보장', () => {
    // floor(a/p) 가 반올림으로 정수에 닿아 수량 × 가격이 a 를 1ulp 넘는 실제 사례를 찾는다
    let found: { a: number; p: number } | null = null;
    for (let p = 3; p < 20_000 && !found; p += 0.37) {
      for (let k = 2; k < 40 && !found; k++) {
        const a = k * p * (1 - 2 ** -52);
        const q = Math.floor(a / p);
        if (q * p > a) found = { a, p };
      }
    }
    expect(found).not.toBeNull();
    const { a, p } = found!;
    const realized = Math.floor(a / p) * p;
    expect(realized > a).toBe(true);
    // limitBasisKrw 자체는 엄격한 max 라 이 값을 고른다 — 그래서 옵션이 적용되지 않은 경로에서는 아예 부르지 않는다
    expect(limitBasisKrw(a, realized)).toBe(realized);
    const now = buildOrderRequest({ symbol: '005930', side: 'buy', orderType: 'limit', price: p, amountKRW: a }, 0);
    expect(Object.is(now.req.amountKRW, a)).toBe(true);
    expect(Object.is(now.sizing.limitBasisKrw, a)).toBe(true);
    expect(now.sizing.realizedKrw! > a).toBe(true);           // 기록에는 실현액이 그대로 남는다
  });

  test('🔴 Codex C2 재현값(목표 383,614,116,660,319.2 · 단가 42,623,790,740,035.47) — amountKRW 가 목표 그대로(Object.is)', () => {
    const input: SignalInput = { symbol: '005930', side: 'buy', orderType: 'limit', price: 42623790740035.47, amountKRW: 383614116660319.2 };
    const now = buildOrderRequest(input, 0);
    // 곱셈 오차로 실현액이 목표를 0.005원 넘게 넘는 입력이다(1·2라운드 허용치 방식은 여기서 0.0625원 올렸다)
    expect(now.sizing.realizedKrw! - input.amountKRW).toBeGreaterThan(0.005);
    expect(Object.is(now.req.amountKRW, input.amountKRW)).toBe(true);
    expect(Object.is(now.sizing.limitBasisKrw, input.amountKRW)).toBe(true);
    expectBitIdentical(now.req as unknown as Record<string, unknown>, baseBuildOrderRequest(input, 0).req as unknown as Record<string, unknown>);
    // 옵션 ON 이어도 내림이 1주 이상이면 옵션이 적용되지 않으므로 같다
    expectBitIdentical(buildOrderRequest(input, 0, { minOneShare: true }).req as unknown as Record<string, unknown>,
      baseBuildOrderRequest(input, 0).req as unknown as Record<string, unknown>);
  });

  test('시드 고정 난수 20,000건 — 큰 금액 영역(1e13~1e15 원) · 추격 · 시장 2 · 옵션 OFF/ON(1주 이상)', () => {
    let seed = 0x2545f491;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
    for (let i = 0; i < 20_000; i++) {
      const overseas = rnd() < 0.5;
      const amountKRW = 10 ** (13 + rnd() * 2) * (1 + rnd());
      const k = 1 + Math.floor(rnd() * 30);
      const price = rnd() < 0.5 ? amountKRW / k * (1 + (rnd() - 0.5) * 1e-14) : amountKRW / (1 + rnd() * 40);
      const chase = rnd() < 0.5 ? 0 : 0.005;
      const input: SignalInput = { symbol: overseas ? 'NAS:MU' : '005930', side: rnd() < 0.8 ? 'buy' : 'sell', orderType: 'limit', price, amountKRW };
      const base = baseBuildOrderRequest(input, chase);
      expectBitIdentical(buildOrderRequest(input, chase).req as unknown as Record<string, unknown>, base.req as unknown as Record<string, unknown>);
      if (base.sized.quantity) {
        expectBitIdentical(buildOrderRequest(input, chase, { minOneShare: true }).req as unknown as Record<string, unknown>,
          base.req as unknown as Record<string, unknown>);
      }
    }
  });

  test('비정상 목표금액(NaN·0·음수·문자열)은 받은 값 그대로 — 한도 검사가 지금처럼 막게 둔다', () => {
    for (const bad of [Number.NaN, 0, -5, '100000' as unknown as number, undefined as unknown as number]) {
      const input: SignalInput = { symbol: '005930', side: 'buy', orderType: 'limit', price: 1_000, amountKRW: bad };
      expect(Object.is(buildOrderRequest(input, 0).req.amountKRW, baseBuildOrderRequest(input, 0).req.amountKRW)).toBe(true);
    }
  });
});

describe('(c) 옵션 ON(minOneShare) — 1주로 올리고 한도는 실현액으로 판정', () => {
  const mu = { symbol: 'NAS:MU', side: 'buy' as const, orderType: 'limit' as const, price: 880 * FX, amountKRW: 100_000 };

  test('sizeOrderQuantity: 0주 → 1주, 플래그 true / 1주 이상이면 수량 그대로, 플래그 false', () => {
    expect(sizeOrderQuantity({ market: 'overseas', orderType: 'limit', amountKRW: 100_000, price: 880 * FX }, { minOneShare: true }))
      .toEqual({ quantity: 1, raw: 100_000 / (880 * FX), minOneShareApplied: true });
    expect(sizeOrderQuantity({ market: 'domestic', orderType: 'limit', amountKRW: 100_000, price: 50_000 }, { minOneShare: true }))
      .toEqual({ quantity: 2, raw: 2, minOneShareApplied: false });
  });

  test('옵션 ON 이어도 올리지 않는 경우 — 금액 비정상·시장가·요청 수량', () => {
    for (const amt of [Number.NaN, 0, -1]) {
      expect(sizeOrderQuantity({ market: 'domestic', orderType: 'limit', amountKRW: amt, price: 1_000 }, { minOneShare: true }).quantity).toBe(0);
    }
    expect(sizeOrderQuantity({ market: 'domestic', orderType: 'market', amountKRW: 100_000, price: 500_000 }, { minOneShare: true }))
      .toEqual({ quantity: undefined, raw: undefined });
    expect(sizeOrderQuantity({ market: 'domestic', orderType: 'limit', requestedQuantity: 0.4, amountKRW: 100_000, price: 500_000 }, { minOneShare: true }))
      .toEqual({ quantity: 0, raw: 0.4 });
  });

  test('🔴 MU $880 · 목표 10만: 1주, 한도 기준 = 실현액(1,165,120) → 1회 한도 20만에서 막힌다', () => {
    const { req, sized, sizing } = buildOrderRequest(mu, 0, { minOneShare: true });
    expect(sized.quantity).toBe(1);
    expect(sized.minOneShareApplied).toBe(true);
    expect(sizing.realizedKrw).toBe(880 * FX);
    expect(sizing.limitBasisKrw).toBe(880 * FX);
    expect(req.amountKRW).toBe(880 * FX);
    expect(sizing.minOneShareApplied).toBe(true);
    const verdict = checkOrderMax(req, 200_000);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('order_limit');
    // 대조: 목표금액(10만)으로 판정했다면 통과했을 것 — max(목표, 실현액)이 한도를 느슨하게 만들지 않는다
    expect(checkOrderMax({ ...req, amountKRW: 100_000 }, 200_000).ok).toBe(true);
  });

  test('국내 50만 · 목표 10만 · 추격 +0.5%: 1주 × 502,500 이 한도 기준', () => {
    const { req, sizing } = buildOrderRequest({ symbol: '000660', side: 'buy', orderType: 'limit', price: 500_000, amountKRW: 100_000 }, 0.005, { minOneShare: true });
    expect(req.quantity).toBe(1);
    expect(req.amountKRW).toBe(500_000 * 1.005);          // 부동소수점 그대로(≈ 502,500)
    expect(req.amountKRW).toBeCloseTo(502_500, 6);
    expect(sizing.limitBasisKrw).toBe(req.amountKRW);
    expect(checkOrderMax(req, 400_000).ok).toBe(false);
    expect(checkOrderMax(req, 600_000).ok).toBe(true);
  });

  test('옵션 ON 이어도 1주 이상 사이징되는 종목은 OFF 와 같은 주문 요청', () => {
    for (const g of PRICE_GRID) {
      for (const amountKRW of TARGETS) {
        const input: SignalInput = { symbol: g.symbol, side: 'buy', orderType: 'limit', price: g.price, amountKRW };
        const base = baseBuildOrderRequest(input, 0.005);
        if (!base.sized.quantity) continue;
        expectBitIdentical(buildOrderRequest(input, 0.005, { minOneShare: true }).req as unknown as Record<string, unknown>,
          base.req as unknown as Record<string, unknown>);
      }
    }
  });
});

describe('(d) 해외 — amountKRW 를 원화로 직접 채운다(환율 이중 곱 방지)', () => {
  beforeEach(() => (usdToKrw as jest.Mock).mockClear());

  test('🔴 재현: amountKRW 를 비우면 원화 환산 단가를 USD 로 보고 환율을 또 곱한다(약 1,324배)', async () => {
    const { req } = buildOrderRequest({ symbol: 'NAS:MU', side: 'buy', orderType: 'limit', price: 880 * FX, amountKRW: 100_000 }, 0, { minOneShare: true });
    const emptied: OrderRequest = { ...req, amountKRW: undefined };
    const wrong = await resolveOrderAmountKRWAsync(emptied);
    expect(usdToKrw).toHaveBeenCalledTimes(1);
    expect(wrong).toBe(880 * FX * FX);            // 1주 × 1,165,120 × 1,324
    expect(wrong / (880 * FX)).toBe(FX);
  });

  test('방지: buildOrderRequest 는 해외도 원화 금액을 채운다 → 환산 없이 그대로 쓰인다(옵션 OFF·ON)', async () => {
    const off = buildOrderRequest({ symbol: 'NAS:AAPL', side: 'buy', orderType: 'limit', price: 50 * FX, amountKRW: 750_000 }, 0.005);
    expect(off.req.currency).toBe('USD');
    expect(await resolveOrderAmountKRWAsync(off.req)).toBe(750_000);
    const on = buildOrderRequest({ symbol: 'NAS:MU', side: 'buy', orderType: 'limit', price: 880 * FX, amountKRW: 100_000 }, 0, { minOneShare: true });
    expect(await resolveOrderAmountKRWAsync(on.req)).toBe(880 * FX);
    expect(usdToKrw).not.toHaveBeenCalled();
  });

  test('실현액 정밀 계산(fxRate 제공 시)은 어댑터와 같은 정수 달러 반올림 — overseasLimitUnitUsd 재사용', () => {
    const chased = 50 * FX * 1.005;                     // $50.25 → 송신 단가 $50
    expect(overseasLimitUnitUsd(chased, FX)).toBe(50);
    expect(computeRealizedKrw({ market: 'overseas', quantity: 11, unitPriceKrw: chased, fxRate: FX })).toBe(11 * 50 * FX);
    // 환율 없이(주문 경로 기본)는 원화 환산 단가 그대로 — 차이는 주당 $0.5 이하
    const krwOnly = computeRealizedKrw({ market: 'overseas', quantity: 11, unitPriceKrw: chased })!;
    expect(krwOnly).toBeCloseTo(11 * chased, 6);
    expect(Math.abs(krwOnly - 11 * 50 * FX)).toBeLessThanOrEqual(11 * 0.5 * FX);
    // 국내는 환율과 무관
    expect(computeRealizedKrw({ market: 'domestic', quantity: 2, unitPriceKrw: 50_000, fxRate: FX })).toBe(100_000);
  });
});

describe('sizing-snapshot 순수 함수', () => {
  test('computeRealizedKrw — 수량 0·미확정·소수·단가 비정상·환율 비정상은 null', () => {
    expect(computeRealizedKrw({ market: 'domestic', quantity: 0, unitPriceKrw: 1_000 })).toBeNull();
    expect(computeRealizedKrw({ market: 'domestic', quantity: undefined, unitPriceKrw: 1_000 })).toBeNull();
    expect(computeRealizedKrw({ market: 'domestic', quantity: 1.5, unitPriceKrw: 1_000 })).toBeNull();
    expect(computeRealizedKrw({ market: 'domestic', quantity: 2, unitPriceKrw: Number.NaN })).toBeNull();
    expect(computeRealizedKrw({ market: 'overseas', quantity: 2, unitPriceKrw: 66_200, fxRate: 0 })).toBeNull();
  });

  test('limitBasisKrw — 엄격한 max(목표, 실현액)(허용치 없음), 비정상 목표는 그대로', () => {
    expect(limitBasisKrw(100_000, 98_100)).toBe(100_000);
    expect(limitBasisKrw(100_000, 1_165_120)).toBe(1_165_120);
    expect(limitBasisKrw(100_000, 100_000.001)).toBe(100_000.001);
    expect(limitBasisKrw(100_000, 100_000)).toBe(100_000);
    expect(limitBasisKrw(100_000, null)).toBe(100_000);
    expect(limitBasisKrw(100_000, Number.POSITIVE_INFINITY)).toBe(100_000);
    expect(Number.isNaN(limitBasisKrw(Number.NaN, 5_000))).toBe(true);
  });

  test('computeSizingSnapshot — 옵션이 적용되지 않으면(minOneShareApplied 거짓) 실현액이 커도 한도 기준은 목표 그 자체', () => {
    for (const src of ['amount', 'requested', 'unresolved'] as const) {
      for (const applied of [undefined, false]) {
        const s = computeSizingSnapshot({ market: 'domestic', targetKrw: 100_000, quantity: 2, unitPriceKrw: 60_000, quantitySource: src, minOneShareApplied: applied, chasePct: 0 });
        expect(s.realizedKrw).toBe(120_000);
        expect(s.limitBasisKrw).toBe(100_000);
      }
    }
    const on = computeSizingSnapshot({ market: 'domestic', targetKrw: 100_000, quantity: 1, unitPriceKrw: 500_000, quantitySource: 'amount', minOneShareApplied: true, chasePct: 0 });
    expect(on.limitBasisKrw).toBe(500_000);
  });

  test('수량을 들고 온 주문(requested)은 실현액이 커도 한도 기준이 목표금액(현행) — 기록에는 실현액이 남는다', () => {
    const s = computeSizingSnapshot({ market: 'domestic', targetKrw: 50_000, quantity: 7, unitPriceKrw: 70_000, quantitySource: 'requested', chasePct: 0 });
    expect(s.realizedKrw).toBe(490_000);
    expect(s.limitBasisKrw).toBe(50_000);
    const { req, sizing } = buildOrderRequest({ symbol: '005930', side: 'sell', orderType: 'market', price: 70_000, quantity: 7, amountKRW: 50_000 }, 0);
    expect(req.amountKRW).toBe(50_000);
    expect(sizing.quantitySource).toBe('requested');
  });

  test('buildOrderRequest 의 sizing 형태 — 국내 5만 · 10만 · 추격', () => {
    const { sizing } = buildOrderRequest({ symbol: '005930', side: 'buy', orderType: 'limit', price: 50_000, amountKRW: 100_000 }, 0.005);
    expect(sizing).toEqual({
      rule: SIZING_RULE, targetKrw: 100_000, quantity: 1, unitPriceKrw: 50_000 * 1.005, realizedKrw: 50_000 * 1.005,
      limitBasisKrw: 100_000, quantitySource: 'amount', minOneShareApplied: false, chasePct: 0.005,
    });
  });

  test('1주 미만(옵션 OFF) — quantity 0, realizedKrw null, 한도 기준 = 목표(H-G "1주 가격 > 시그널 금액" 판정 가능)', () => {
    const { sizing } = buildOrderRequest({ symbol: 'NAS:MU', side: 'buy', orderType: 'limit', price: 880 * FX, amountKRW: 100_000 }, 0);
    expect(sizing.quantity).toBe(0);
    expect(sizing.realizedKrw).toBeNull();
    expect(sizing.limitBasisKrw).toBe(100_000);
    expect(sizing.unitPriceKrw! > sizing.targetKrw).toBe(true);
  });

  test('시장가 — 수량 미확정(null), quantitySource unresolved', () => {
    const { sizing } = buildOrderRequest({ symbol: '005930', side: 'buy', orderType: 'market', price: 50_000, amountKRW: 100_000 }, 0.005);
    expect(sizing.quantity).toBeNull();
    expect(sizing.quantitySource).toBe('unresolved');
    expect(sizing.realizedKrw).toBeNull();
    expect(sizing.limitBasisKrw).toBe(100_000);
  });

  test('attachSizingSnapshot — null→객체, 객체→키 추가(원본 불변·기존 sizing 덮음), 배열·문자열은 그대로', () => {
    const snap = buildOrderRequest({ symbol: '005930', side: 'buy', orderType: 'limit', price: 50_000, amountKRW: 100_000 }, 0).sizing;
    expect(attachSizingSnapshot(null, snap)).toEqual({ sizing: snap });
    expect(attachSizingSnapshot(undefined, snap)).toEqual({ sizing: snap });
    const orig = { rsi14: 30, sizing: { rule: 'forged' } };
    const out = attachSizingSnapshot(orig, snap) as Record<string, unknown>;
    expect(out).toEqual({ rsi14: 30, sizing: snap });
    expect(orig.sizing).toEqual({ rule: 'forged' });
    const arr = [1, 2];
    expect(attachSizingSnapshot(arr, snap)).toBe(arr);
    expect(attachSizingSnapshot('x', snap)).toBe('x');
  });

  test('readSizingSnapshot — JSON 문자열·객체 모두 읽고, 규칙 버전·형태가 깨지면 null', () => {
    const snap = buildOrderRequest({ symbol: 'NAS:AAPL', side: 'buy', orderType: 'limit', price: 66_200, amountKRW: 750_000 }, 0).sizing;
    const row = JSON.stringify({ rsi14: 31, sizing: snap });
    expect(readSizingSnapshot(row)).toEqual(snap);
    expect(readSizingSnapshot(JSON.parse(row))).toEqual(snap);
    expect(readSizingSnapshot(null)).toBeNull();
    expect(readSizingSnapshot('not json')).toBeNull();
    expect(readSizingSnapshot({ sizing: { ...snap, rule: 'qty_first_v0' } })).toBeNull();
    expect(readSizingSnapshot({ sizing: { ...snap, quantity: 1.5 } })).toBeNull();
    expect(readSizingSnapshot({ sizing: { ...snap, limitBasisKrw: '1e9' } })).toBeNull();
    expect(readSizingSnapshot({ ai: {} })).toBeNull();
  });
});

// T-097 Reviewer 생존 변이 S1·S2·S3(M16·M33·M35) 대응 — 1라운드 PASS 후 비차단 권고 반영
describe('Reviewer 생존 변이 대응(S1·S2·S3)', () => {
  test('S1(M16): limitBasisKrw 는 비정상 목표(0·음수)를 받은 값 그대로 돌려준다 — 실현액으로 "고쳐" 주지 않는다', () => {
    expect(limitBasisKrw(0, 5_000)).toBe(0);
    expect(limitBasisKrw(-5, 5_000)).toBe(-5);
  });

  test('S2(M33): 옵션 ON + 금액 Infinity — 1주로 올리지 않고 base 와 같은 결과(수량 0, amountKRW Infinity → 한도 검사가 막음)', () => {
    const sq = sizeOrderQuantity({ market: 'domestic', orderType: 'limit', amountKRW: Number.POSITIVE_INFINITY, price: 1_000 }, { minOneShare: true });
    expect(sq).toEqual({ quantity: 0, raw: Number.POSITIVE_INFINITY, minOneShareApplied: false });
    const input: SignalInput = { symbol: '005930', side: 'buy', orderType: 'limit', price: 1_000, amountKRW: Number.POSITIVE_INFINITY };
    const now = buildOrderRequest(input, 0, { minOneShare: true });
    expectBitIdentical(now.req as unknown as Record<string, unknown>, baseBuildOrderRequest(input, 0).req as unknown as Record<string, unknown>);
    expect(now.sized.minOneShareApplied).toBe(false);
  });

  test('🔴 S3(M35): 옵션 ON + 수량 NaN + 지정가 + 미국 $880 — 수량 출처는 amount(requested 오분류 금지), 한도 기준은 실현액', () => {
    const input: SignalInput = { symbol: 'NAS:MU', side: 'buy', orderType: 'limit', price: 880 * FX, amountKRW: 100_000, quantity: Number.NaN };
    const { req, sized, sizing } = buildOrderRequest(input, 0, { minOneShare: true });
    expect(sized.quantity).toBe(1);
    expect(sized.minOneShareApplied).toBe(true);
    expect(sizing.quantitySource).toBe('amount');
    expect(sizing.limitBasisKrw).toBe(880 * FX);   // 1,165,120 — requested 로 오분류되면 목표 10만으로 느슨해진다
    expect(req.amountKRW).toBe(880 * FX);
  });

  test('F-8: 옵션 ON + 수량 Infinity + 지정가 + 미국 $880 — 수량 1, 출처 amount, 한도 기준은 실현액', () => {
    const input: SignalInput = { symbol: 'NAS:MU', side: 'buy', orderType: 'limit', price: 880 * FX, amountKRW: 100_000, quantity: Number.POSITIVE_INFINITY };
    const { req, sized, sizing } = buildOrderRequest(input, 0, { minOneShare: true });
    expect(sized.quantity).toBe(1);
    expect(sizing.quantitySource).toBe('amount');
    expect(sizing.limitBasisKrw).toBe(880 * FX);
    expect(req.amountKRW).toBe(880 * FX);
  });
});
