/**
 * T-012 — 잔고 **부분 실패**를 완전 성공과 구분한다.
 *
 * ## 실측 배경
 *
 * KIS 레이트리밋은 `HTTP 500 + {"rt_cd":"1","msg_cd":"EGW00201"}` 로 온다. 어댑터는 이때
 * 정상적으로 throw 하고 있었지만, Facade 가 `.catch(() => [])` 로 삼켜 **국내 쪽이 통째로
 * 빠진 잔고를 정상 응답처럼** 반환했다. 운영 로그 실측 `[kis] domestic balances failed`
 * 1,077건 / `overseas` 241건 — 그때마다 호출부는 그것이 부분 실패인지 알 수 없었다.
 *
 * 결과: `portfolio_snapshots` 에 -20% 짜리 총액 188건(최근 30일 14건). 이 값은 킬스위치
 * 24h drawdown 기준선이다.
 */
const domGetBalances = jest.fn();
const ovsGetBalances = jest.fn();

jest.mock('@/lib/exchanges/kis-domestic', () => ({
  getBalances: (...a: unknown[]) => domGetBalances(...a),
  getTicker: jest.fn(), getCandles: jest.fn(), createOrder: jest.fn(), cancelOrder: jest.fn(),
  fetchMarketCapRanking: jest.fn(), getKisTickers: jest.fn(),
  getActiveOrders: jest.fn(), getCompletedOrders: jest.fn(),
}));
jest.mock('@/lib/exchanges/kis-overseas', () => ({
  getBalances: (...a: unknown[]) => ovsGetBalances(...a),
  getTicker: jest.fn(), getCandles: jest.fn(), createOrder: jest.fn(), cancelOrder: jest.fn(),
  getKisOverseasTickers: jest.fn(),
  getActiveOrders: jest.fn(), getCompletedOrders: jest.fn(),
}));

import { kis, getBalancesDetailed, BalancesIncompleteError } from '@/lib/exchanges/kis';
import type { Balance } from '@/lib/exchanges/types';

const DOM: Balance[] = [
  { currency: 'KRW',    free: 78_218, locked: 0 },
  { currency: '000660', free: 3,  locked: 0, avgPrice: 474_000 },
  { currency: '005930', free: 30, locked: 0, avgPrice: 69_300 },
];
const OVS: Balance[] = [
  { currency: 'NYS:ORCL', free: 6,  locked: 0, avgPrice: 208_173 },
  { currency: 'NAS:SNPS', free: 23, locked: 0, avgPrice: 558_654 },
];

/** 실측 레이트리밋 응답 형태 */
const RATE_LIMIT = new Error(
  'KIS getBalances: 500 body={"rt_cd":"1","msg1":"초당 거래건수를 초과하였습니다.","msg_cd":"EGW00201"}',
);

const origOverseasEnabled = process.env.KIS_OVERSEAS_ENABLED;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.KIS_OVERSEAS_ENABLED = 'true';
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
  if (origOverseasEnabled === undefined) delete process.env.KIS_OVERSEAS_ENABLED;
  else process.env.KIS_OVERSEAS_ENABLED = origOverseasEnabled;
});

describe('getBalancesDetailed — 시장별 성공/실패를 보존한다', () => {
  test('양 시장 성공 → complete=true, 잔고 합산', async () => {
    domGetBalances.mockResolvedValue(DOM);
    ovsGetBalances.mockResolvedValue(OVS);
    const r = await getBalancesDetailed();
    expect(r.complete).toBe(true);
    expect(r.failed).toEqual([]);
    expect(r.ok.sort()).toEqual(['domestic', 'overseas']);
    expect(r.balances).toHaveLength(5);
  });

  test('🔴 국내 실패 → complete=false, 남은 해외 잔고는 보존, 실패 사유 노출', async () => {
    domGetBalances.mockRejectedValue(RATE_LIMIT);
    ovsGetBalances.mockResolvedValue(OVS);
    const r = await getBalancesDetailed();
    expect(r.complete).toBe(false);
    expect(r.failed.map(f => f.market)).toEqual(['domestic']);
    expect(r.failed[0].error).toContain('EGW00201');
    expect(r.ok).toEqual(['overseas']);
    // 부분 데이터 자체는 살아 있다 — 다만 "부분"임이 표시된다
    expect(r.balances.map(b => b.currency)).toEqual(['NYS:ORCL', 'NAS:SNPS']);
  });

  test('해외 실패 → complete=false, 국내 잔고 보존', async () => {
    domGetBalances.mockResolvedValue(DOM);
    ovsGetBalances.mockRejectedValue(RATE_LIMIT);
    const r = await getBalancesDetailed();
    expect(r.complete).toBe(false);
    expect(r.failed.map(f => f.market)).toEqual(['overseas']);
    expect(r.balances.map(b => b.currency)).toEqual(['KRW', '000660', '005930']);
  });

  test('양쪽 실패 → 둘 다 failed 에 담긴다', async () => {
    domGetBalances.mockRejectedValue(RATE_LIMIT);
    ovsGetBalances.mockRejectedValue(RATE_LIMIT);
    const r = await getBalancesDetailed();
    expect(r.complete).toBe(false);
    expect(r.failed.map(f => f.market).sort()).toEqual(['domestic', 'overseas']);
    expect(r.balances).toEqual([]);
  });

  test('KIS_OVERSEAS_ENABLED=false 면 국내만 조회하고, 국내 성공이면 complete', async () => {
    process.env.KIS_OVERSEAS_ENABLED = 'false';
    domGetBalances.mockResolvedValue(DOM);
    const r = await getBalancesDetailed();
    expect(ovsGetBalances).not.toHaveBeenCalled();
    expect(r.complete).toBe(true);
    expect(r.ok).toEqual(['domestic']);
  });
});

describe('kis.getBalances — 부분 실패는 조용히 통과시키지 않고 던진다', () => {
  test('양 시장 성공이면 합산 잔고를 그대로 반환', async () => {
    domGetBalances.mockResolvedValue(DOM);
    ovsGetBalances.mockResolvedValue(OVS);
    await expect(kis.getBalances()).resolves.toHaveLength(5);
  });

  test('🔴 국내 실패 시 BalancesIncompleteError — 잘린 잔고를 반환하지 않는다', async () => {
    domGetBalances.mockRejectedValue(RATE_LIMIT);
    ovsGetBalances.mockResolvedValue(OVS);
    await expect(kis.getBalances()).rejects.toBeInstanceOf(BalancesIncompleteError);
  });

  test('예외에 실패 시장과 성공 시장이 모두 담긴다', async () => {
    domGetBalances.mockRejectedValue(RATE_LIMIT);
    ovsGetBalances.mockResolvedValue(OVS);
    const err = await kis.getBalances().catch((e: unknown) => e) as BalancesIncompleteError;
    expect(err.failed.map(f => f.market)).toEqual(['domestic']);
    expect(err.okMarkets).toEqual(['overseas']);
    expect(err.message).toContain('domestic');
  });

  test('KIS_OVERSEAS_ENABLED=false + 국내 실패 → 역시 던진다', async () => {
    process.env.KIS_OVERSEAS_ENABLED = 'false';
    domGetBalances.mockRejectedValue(RATE_LIMIT);
    await expect(kis.getBalances()).rejects.toBeInstanceOf(BalancesIncompleteError);
  });

  /**
   * 회귀 방어의 핵심: 예전 동작은 국내 실패 시 **해외만 든 배열을 정상 반환**했다.
   * 그 배열로 총액을 계산하면 -20% 짜리 값이 나오고 그게 킬스위치 기준선이 됐다.
   */
  test('🔴 회귀 — 국내 실패가 "해외만 든 정상 배열"로 둔갑하지 않는다', async () => {
    domGetBalances.mockRejectedValue(RATE_LIMIT);
    ovsGetBalances.mockResolvedValue(OVS);
    let resolved: Balance[] | null = null;
    try { resolved = await kis.getBalances(); } catch { /* expected */ }
    expect(resolved).toBeNull();
  });
});
