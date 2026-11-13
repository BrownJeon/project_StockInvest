/**
 * T-168 D2 — `getPreviousOrderMax(market)`: 무제한 전환 직전의 양수 1회 한도(`unlimitedPrevious` 비율) × **해당 시장** 평가액.
 *
 * 장중 엔진의 무제한 모드 감사 경로가 T-159 이전과 같은 금액으로 감사 행·가상 체결을 남기는 데 쓴다(주문 한도가 아니라 기록용 금액).
 * 지킬 것:
 *  1. 시장 인자의 평가액을 쓴다(해외 후보를 국내 평가액으로 계산하지 않는다).
 *  2. 🔴 `getLegacyAnalystSellAmount()` 는 이 함수를 국내로 부른 것과 같다 — 값·조회·경고 문구가 이전과 같다(동작 무변화).
 *  3. 이전 비율이 없거나(무제한 아님·`"unlimited"` 만 저장·0·값 이상·키 없음) 평가액을 모르거나 DB 가 죽으면 0. 던지지 않는다.
 */
import { getPool } from '@/lib/db';
import { getMarketTotal } from '@/lib/safety/portfolio-total';
import { getEffectiveOrderMax, getLegacyAnalystSellAmount, getPreviousOrderMax } from '../order-limits';

jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));
jest.mock('@/lib/safety/portfolio-total', () => ({ getMarketTotal: jest.fn() }));

const totals: Record<string, number> = { domestic: 1_000_000, overseas: 14_000_000 };

function mockConfig(values: Record<string, string | undefined>) {
  const query = jest.fn(async (_sql: unknown, params: unknown[] = []) => {
    const v = values[String((params ?? [])[0] ?? '')];
    return v === undefined ? [[]] : [[{ value: v }]];
  });
  (getPool as jest.Mock).mockReturnValue({ query });
  return query;
}

let warn: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  (getMarketTotal as jest.Mock).mockImplementation(async (m: string) => ({ status: 'ok', krw: totals[m] }));
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test('🔴 시장마다 그 시장 평가액 × 이전 비율 — 1회 한도 자체는 여전히 무제한', async () => {
  mockConfig({ safety_order_max_pct: JSON.stringify({ unlimitedPrevious: '10' }) });
  await expect(getEffectiveOrderMax('kis', 'domestic')).resolves.toBe('unlimited');
  await expect(getEffectiveOrderMax('kis', 'overseas')).resolves.toBe('unlimited');
  await expect(getPreviousOrderMax('domestic')).resolves.toBe(100_000);
  await expect(getPreviousOrderMax('overseas')).resolves.toBe(1_400_000);
  expect((getMarketTotal as jest.Mock).mock.calls.map((c) => c[0])).toEqual(['domestic', 'overseas']);
});

test('🔴 getLegacyAnalystSellAmount = 국내 getPreviousOrderMax (값·조회 동일)', async () => {
  for (const previous of ['4', '10', '0.5']) {
    const query = mockConfig({ safety_order_max_pct: JSON.stringify({ unlimitedPrevious: previous }) });
    const legacy = await getLegacyAnalystSellAmount();
    const legacyCalls = query.mock.calls.map((c) => c[1]);
    query.mockClear();
    const domestic = await getPreviousOrderMax('domestic');
    expect(legacy).toBe(domestic);
    expect(legacy).toBe(1_000_000 * Number(previous) / 100);
    expect(query.mock.calls.map((c) => c[1])).toEqual(legacyCalls);
  }
});

test('getLegacyAnalystSellAmount 의 경고 이름은 이전 그대로(기존 RSI 매도)', async () => {
  mockConfig({ safety_order_max_pct: '"unlimited"' });
  await expect(getLegacyAnalystSellAmount()).resolves.toBe(0);
  expect(warn.mock.calls.map((c) => String(c[0]))).toEqual(['[order-limits] safety_order_max_pct 미설정 → 기존 RSI 매도 한도 0 (domestic 신규 매수 차단)']);
});

test.each([
  ['"unlimited" 만 저장(이전 비율 없음)', '"unlimited"'],
  ['무제한이 아닌 양수 비율', '"10"'],
  ['이전 비율 0', JSON.stringify({ unlimitedPrevious: '0' })],
  ['이전 비율 값 이상', JSON.stringify({ unlimitedPrevious: 'abc' })],
  ['키 없음', undefined],
])('%s → 0', async (_n, value) => {
  mockConfig({ safety_order_max_pct: value });
  await expect(getPreviousOrderMax('domestic')).resolves.toBe(0);
  await expect(getPreviousOrderMax('overseas')).resolves.toBe(0);
  expect(getMarketTotal).not.toHaveBeenCalled();
});

test('평가액 모름(unknown)·0 → 0', async () => {
  mockConfig({ safety_order_max_pct: JSON.stringify({ unlimitedPrevious: '10' }) });
  (getMarketTotal as jest.Mock).mockResolvedValueOnce({ status: 'unknown', reason: 'usd_cash_unknown', detail: 'x' });
  await expect(getPreviousOrderMax('overseas')).resolves.toBe(0);
  (getMarketTotal as jest.Mock).mockResolvedValueOnce({ status: 'ok', krw: 0 });
  await expect(getPreviousOrderMax('overseas')).resolves.toBe(0);
});

test('DB 조회 예외·평가액 조회 예외 → 0, 던지지 않는다', async () => {
  (getPool as jest.Mock).mockReturnValue({ query: jest.fn().mockRejectedValue(new Error('connection lost')) });
  await expect(getPreviousOrderMax('domestic')).resolves.toBe(0);
  mockConfig({ safety_order_max_pct: JSON.stringify({ unlimitedPrevious: '10' }) });
  (getMarketTotal as jest.Mock).mockRejectedValueOnce(new Error('kis down'));
  await expect(getPreviousOrderMax('domestic')).resolves.toBe(0);
});
