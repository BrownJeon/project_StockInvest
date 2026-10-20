/**
 * Phase 0 — 주문 한도 fail-safe 회귀 테스트.
 *
 * 이전 동작: pct 미설정 또는 포트폴리오 평가액 조회 실패 → Infinity(무제한) → 매수 통과 (fail-open)
 * 현재 동작: 위 상황 모두 0 → checkOrderMax/checkDailyMax가 전면 거부 (fail-safe)
 */
import { getPool } from '@/lib/db';
import type { OrderRequest } from '@/lib/exchanges/types';
import { getMarketTotal } from '@/lib/safety/portfolio-total';
import {
  checkDailyMax,
  checkOrderMax,
  getDailyMaxPct,
  getEffectiveDailyMax,
  getEffectiveOrderMax,
  getOrderMaxPct,
} from '../order-limits';

jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));
jest.mock('@/lib/safety/portfolio-total', () => ({
  getMarketTotal: jest.fn(),
}));

/**
 * 시장 평가액(숫자). T-056 부터 한도는 시장별 *상태*(`getMarketTotal`)를 읽는다 — 이 파일의 테스트 본문은 종전처럼 숫자를 넣고,
 * 아래 `beforeEach` 가 그 숫자를 `{ status: 'ok', krw }` 로 감싼다. `unknown` 상태 경로는 `order-limits-market-state.test.ts` 에 있다.
 */
const mockTotal = jest.fn();

/** system_config 조회 결과를 흉내낸다. key → JSON 문자열(없으면 행 없음). */
function mockConfig(values: Record<string, string | undefined>) {
  const query = jest.fn(async (_sql: unknown, params: unknown[] = []) => {
    const key = String((params ?? [])[0] ?? '');
    const v = values[key];
    return v === undefined ? [[]] : [[{ value: v }]];
  });
  (getPool as jest.Mock).mockReturnValue({ query });
  return query;
}

/** DB 자체가 죽은 상황 */
function mockConfigThrows() {
  const query = jest.fn().mockRejectedValue(new Error('connection lost'));
  (getPool as jest.Mock).mockReturnValue({ query });
  return query;
}

const buyReq: OrderRequest = {
  exchange: 'kis',
  symbol: '005930',
  side: 'buy',
  type: 'limit',
  amountKRW: 10_000,
};

beforeEach(() => {
  (getMarketTotal as jest.Mock).mockImplementation(async (m: string) => ({ status: 'ok', krw: await mockTotal(m) }));
  mockTotal.mockResolvedValue(1_000_000);
});
afterEach(() => jest.clearAllMocks());

describe('getEffectiveOrderMax — fail-safe', () => {
  test('DB 한도 키 삭제(미설정) → 0 (무제한 아님)', async () => {
    mockConfig({});
    await expect(getEffectiveOrderMax('kis', 'domestic')).resolves.toBe(0);
  });

  test('pct=0으로 저장돼 있어도 0', async () => {
    mockConfig({ safety_order_max_pct: '0' });
    await expect(getEffectiveOrderMax('kis', 'domestic')).resolves.toBe(0);
  });

  test('DB 조회 실패 → 0', async () => {
    mockConfigThrows();
    await expect(getEffectiveOrderMax('kis', 'domestic')).resolves.toBe(0);
  });

  test('pct 정상이나 포트폴리오 평가액 조회 실패(0) → 0', async () => {
    mockConfig({ safety_order_max_pct: '5' });
    mockTotal.mockResolvedValue(0);
    await expect(getEffectiveOrderMax('kis', 'domestic')).resolves.toBe(0);
  });

  test('정상 → 시장 평가액 × pct%', async () => {
    mockConfig({ safety_order_max_pct: '5' });
    mockTotal.mockResolvedValue(2_000_000);
    await expect(getEffectiveOrderMax('kis', 'domestic')).resolves.toBe(100_000);
  });

  test('시장별로 분리 조회한다', async () => {
    mockConfig({ safety_order_max_pct: '5' });
    mockTotal.mockImplementation(async (m: string) => (m === 'overseas' ? 400_000 : 1_000_000));
    await expect(getEffectiveOrderMax('kis', 'domestic')).resolves.toBe(50_000);
    await expect(getEffectiveOrderMax('kis', 'overseas')).resolves.toBe(20_000);
  });
});

describe('getEffectiveDailyMax — fail-safe', () => {
  test('DB 한도 키 삭제(미설정) → 0', async () => {
    mockConfig({});
    await expect(getEffectiveDailyMax('kis', 'domestic')).resolves.toBe(0);
  });

  test('DB 조회 실패 → 0', async () => {
    mockConfigThrows();
    await expect(getEffectiveDailyMax('kis', 'domestic')).resolves.toBe(0);
  });

  test('평가액 0 → 0', async () => {
    mockConfig({ safety_daily_order_max_pct: '10' });
    mockTotal.mockResolvedValue(0);
    await expect(getEffectiveDailyMax('kis', 'domestic')).resolves.toBe(0);
  });

  test('정상 → 시장 평가액 × pct%', async () => {
    mockConfig({ safety_daily_order_max_pct: '10' });
    mockTotal.mockResolvedValue(1_000_000);
    await expect(getEffectiveDailyMax('kis', 'domestic')).resolves.toBe(100_000);
  });
});

describe('pct 진단 헬퍼 (/api/health 표시용)', () => {
  test('미설정 → 0', async () => {
    mockConfig({});
    await expect(getOrderMaxPct()).resolves.toBe(0);
    await expect(getDailyMaxPct()).resolves.toBe(0);
  });

  test('설정값 그대로 반환', async () => {
    mockConfig({ safety_order_max_pct: '5', safety_daily_order_max_pct: '10' });
    await expect(getOrderMaxPct()).resolves.toBe(5);
    await expect(getDailyMaxPct()).resolves.toBe(10);
  });
});

describe('한도 0이면 매수 주문 거부 (수용 기준 1)', () => {
  test('checkOrderMax(0) → 거부', () => {
    const r = checkOrderMax(buyReq, 0);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('order_limit');
    expect(r.detail).toMatch(/not configured/);
  });

  test('checkOrderMax(Infinity) → 더 이상 무제한 통과하지 않는다 (fail-open 회귀 방어)', () => {
    const r = checkOrderMax(buyReq, Infinity);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('order_limit');
  });

  test('checkDailyMax(0) → 거부 + 누적 집계 쿼리조차 실행하지 않음', async () => {
    const query = mockConfig({});
    const r = await checkDailyMax(buyReq, 0);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('daily_limit');
    expect(r.detail).toMatch(/not configured/);
    expect(query).not.toHaveBeenCalled();
  });

  test('checkDailyMax(Infinity) → 거부 (fail-open 회귀 방어)', async () => {
    mockConfig({});
    const r = await checkDailyMax(buyReq, Infinity);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('daily_limit');
  });

  test('DB 한도 키 삭제 시나리오 end-to-end: getEffectiveOrderMax → checkOrderMax 거부', async () => {
    mockConfig({}); // 한도 키 전부 삭제된 상태
    const effMax = await getEffectiveOrderMax('kis', 'domestic');
    expect(effMax).toBe(0);
    expect(checkOrderMax(buyReq, effMax).ok).toBe(false);
  });
});
