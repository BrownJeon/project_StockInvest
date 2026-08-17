/**
 * T-027 (Developer 조사 중 발견) — **NaN 주문금액이 1회·일일 한도를 통째로 통과하던 fail-open.**
 *
 * `price` 에 비-number 가 섞이면 `price * quantity` 는 NaN 이 된다. NaN 은 모든 관계연산에서
 * false 이므로 `amount <= 0`(→false) 도 `amount > effectiveMax`(→false) 도 걸리지 않았다.
 * 즉 **한도 검사를 통과한 것처럼 보이는 무한대 금액**이 성립했다. 원래의 T-027 결함(비-number
 * quantity 가 어댑터 가드를 통과)과 같은 계열이되, 이쪽은 자금 한도를 우회하므로 더 무겁다.
 *
 * 수정은 두 겹이다: ① `resolveOrderAmountKRW*` 가 NaN 대신 0 을 돌려준다
 * ② 한도 검사가 `amount <= 0` 대신 `!(amount > 0)` 로 판정한다(부정형이라 NaN 도 멈춘다).
 */
import type { OrderRequest } from '@/lib/exchanges/types';
import {
  checkOrderMax,
  resolveOrderAmountKRW,
  resolveOrderAmountKRWAsync,
} from '../order-limits';

const base: OrderRequest = {
  exchange: 'kis',
  symbol: '005930',
  side: 'buy',
  type: 'limit',
  market: 'domestic',
};

/** 타입 경계 밖에서 실제로 들어올 수 있는 값들을 그대로 흉내 낸다. */
function withPrice(price: unknown, quantity: unknown = 5): OrderRequest {
  return { ...base, price, quantity } as unknown as OrderRequest;
}

describe('resolveOrderAmountKRW — NaN 을 흘리지 않는다', () => {
  test.each([['\'abc\'', 'abc'], ['객체', {}], ['배열 [1,2]', [1, 2]]])(
    'price=%s 는 NaN 이 아니라 0 을 돌려준다',
    (_label, price) => {
      expect(resolveOrderAmountKRW(withPrice(price))).toBe(0);
    },
  );

  test('async 판도 동일하다', async () => {
    await expect(resolveOrderAmountKRWAsync(withPrice('abc'))).resolves.toBe(0);
  });

  // ── 회귀 방지: 정상값은 그대로 ──────────────────────────────────────────────
  test('정상 price × quantity 는 그대로 계산된다', () => {
    expect(resolveOrderAmountKRW(withPrice(70_000, 3))).toBe(210_000);
  });

  test('숫자 문자열은 기존처럼 강제변환되어 계산된다 — 기존 허용 동작 유지', () => {
    expect(resolveOrderAmountKRW(withPrice('70000', 3))).toBe(210_000);
  });

  test('amountKRW 우선 규칙은 그대로다', () => {
    expect(resolveOrderAmountKRW({ ...base, amountKRW: 20_000, price: 1000, quantity: 1 })).toBe(20_000);
  });
});

describe('checkOrderMax — NaN 금액은 통과가 아니라 거부다', () => {
  const MAX = 100_000;

  test.each([['\'abc\'', 'abc'], ['객체', {}]])(
    'price=%s (→ NaN 금액) 는 한도를 통과하지 못한다',
    (_label, price) => {
      const r = checkOrderMax(withPrice(price), MAX);
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('order_limit');
      expect(r.detail).toBe('amount unresolved');
    },
  );

  test('직접 NaN 금액이 주어져도(내부 연산 유래) 거부된다', () => {
    const r = checkOrderMax({ ...base, amountKRW: Number.NaN, price: Number.NaN, quantity: 1 }, MAX);
    expect(r.ok).toBe(false);
  });

  // ── 회귀 방지: 정상 주문은 여전히 통과 / 초과는 여전히 차단 ──────────────────
  test('한도 이내 정상 주문은 통과한다', () => {
    expect(checkOrderMax(withPrice(10_000, 5), MAX).ok).toBe(true);   // 50,000
  });

  test('한도 경계값(정확히 max)은 통과한다 — 경계 회귀 없음', () => {
    expect(checkOrderMax(withPrice(20_000, 5), MAX).ok).toBe(true);   // 100,000
  });

  test('한도 초과는 여전히 차단된다', () => {
    const r = checkOrderMax(withPrice(30_000, 5), MAX);               // 150,000
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/150000 > 100000/);
  });

  test('금액 0 은 기존처럼 amount unresolved 로 거부된다 — 문구 회귀 없음', () => {
    const r = checkOrderMax({ ...base }, MAX);
    expect(r.ok).toBe(false);
    expect(r.detail).toBe('amount unresolved');
  });
});
