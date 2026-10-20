/**
 * T-056 — 저장 가드 `cash_row_missing`: **크론이 그 틱에 쓴 시장 활성 값**으로 현금 행을 요구한다.
 *
 * 왜(설계 S4): 저장 가드의 소실 판정은 현금을 빼고 본다(출금은 정상). 해외 매도로 USD 행이 총액의 64% 가 된 뒤 그 행이
 * 조용히 빠지면 "출금"처럼 보여 저장되고 킬스위치가 -64% 를 본다. 이 검사는 그 2차 방어다.
 *
 * 계약:
 *  - `usdCashRequired=true` 인데 USD 행 없음/2개/비유한 qty/환율 0 → 거부. **직전 행과 비교하지 않는다**(최초 배포·재활성 첫 행 정상).
 *  - **릴리스 밸브 없음** — 직전 스냅샷이 3시간을 넘어도 거부한다(밸브가 S4 를 다시 연다).
 *  - `usdCashRequired=false`(해외 비활성) → USD 행을 요구하지 않는다(활성→비활성 데드락 없음, Codex C1-3).
 *  - 요구 플래그 자체가 없으면(타입 우회) 저장하지 않는다 — "못 받으면 요구하지 않음"이 아니다.
 */
const sendAlert = jest.fn();
jest.mock('@/lib/notify', () => ({ sendAlert: (...a: unknown[]) => sendAlert(...a) }));
const query = jest.fn();
jest.mock('@/lib/db', () => ({ getPool: () => ({ query: (...a: unknown[]) => query(...a) }) }));
jest.mock('@/lib/strategy/market-hours', () => ({ minutesSinceSessionOpen: async () => 600 }));

import {
  savePortfolioSnapshot, checkRequiredCashRows, resetSnapshotRejectThrottle, clearZeroPriceAllowlistCache,
  type SnapshotPosition, type SnapshotCashRequirement,
} from '@/lib/safety/volatility-guard';

const RATE = 1332.1;
const KRW = (v: number): SnapshotPosition => ({ currency: 'KRW', qty: v, price: 1, value_krw: v, locked: 0 });
const USD = (usd: number, rate = RATE): SnapshotPosition => ({ currency: 'USD', qty: usd, price: rate, value_krw: usd * rate, locked: 0 });
const H = (c: string, v: number): SnapshotPosition => ({ currency: c, qty: 1, price: v, value_krw: v });
const total = (ps: SnapshotPosition[]) => ps.reduce((s, p) => s + p.value_krw, 0);

const REQ_BOTH: SnapshotCashRequirement = { usdCashRequired: true, krwCashRequired: true };
const REQ_KRW_ONLY: SnapshotCashRequirement = { usdCashRequired: false, krwCashRequired: true };

/** 오늘 운영 모양(신형): KRW + USD + 국내 2 + 해외 3 */
const NEW_ROW = [KRW(80_138), USD(368.51), H('000660', 1_800_000), H('005930', 1_515_500), H('NAS:STK1', 13_259_446), H('NAS:STK2', 2_922_464), H('NYS:STK3', 1_035_753)];
/** 배포 전 구형(USD 행 없음) */
const OLD_ROW = NEW_ROW.filter(p => p.currency !== 'USD');

function mockDb(prev: { ts: Date; positions: SnapshotPosition[] } | null) {
  query.mockImplementation(async (sql: string) => {
    if (/INSERT INTO portfolio_snapshots/.test(sql)) return [{ affectedRows: 1 }];
    if (/snapshot_zero_price_symbols/.test(sql)) return [[]];
    if (/MAX\(ts\)/.test(sql)) return [[{ latest: new Date() }]];
    if (/INTERVAL 24 HOUR/.test(sql)) return [prev ? [{ total_krw: total(prev.positions) }] : []];
    if (/ORDER BY ts DESC LIMIT 1/.test(sql)) {
      return [prev ? [{ ts: prev.ts, total_krw: total(prev.positions), positions: JSON.stringify(prev.positions) }] : []];
    }
    return [[]];
  });
}
const inserts = () => query.mock.calls.filter(c => /INSERT INTO portfolio_snapshots/.test(String(c[0])));

beforeEach(() => {
  jest.clearAllMocks();
  resetSnapshotRejectThrottle();
  clearZeroPriceAllowlistCache();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('checkRequiredCashRows — 순수 판정', () => {
  test('신형 행 + 둘 다 요구 → 통과', () => {
    expect(checkRequiredCashRows(NEW_ROW, REQ_BOTH)).toBeNull();
  });

  test('USD 0 행(확인된 0)은 통과', () => {
    expect(checkRequiredCashRows([KRW(1), USD(0)], REQ_BOTH)).toBeNull();
  });

  test.each<[string, SnapshotPosition[]]>([
    ['USD 행 없음', OLD_ROW],
    ['USD 행 2개', [...NEW_ROW, USD(1)]],
    ['USD qty NaN', [KRW(1), { ...USD(1), qty: NaN }]],
    ['USD qty 음수', [KRW(1), { ...USD(1), qty: -1 }]],
    ['USD 환율 0', [KRW(1), USD(1, 0)]],
    ['USD 환율 NaN', [KRW(1), USD(1, NaN)]],
    ['KRW 행 없음', NEW_ROW.filter(p => p.currency !== 'KRW')],
    ['KRW 행 price≠1', [{ ...KRW(5), price: 2 }, USD(1)]],
    ['KRW 행 2개', [KRW(1), KRW(2), USD(1)]],
  ])('🔴 %s → cash_row_missing', (_n, ps) => {
    expect(checkRequiredCashRows(ps, REQ_BOTH)).toMatchObject({ code: 'cash_row_missing' });
  });

  test('해외 비활성(usdCashRequired=false) → USD 행이 없어도 통과', () => {
    expect(checkRequiredCashRows(OLD_ROW, REQ_KRW_ONLY)).toBeNull();
  });

  test.each([[undefined], [null], [{}], [{ usdCashRequired: true }], [{ usdCashRequired: 'true', krwCashRequired: true }]])(
    '🔴 요구 플래그가 없거나 형식이 틀리면(%p) 저장하지 않는다', (req) => {
      expect(checkRequiredCashRows(NEW_ROW, req as unknown as SnapshotCashRequirement)).toMatchObject({ code: 'cash_row_missing' });
    });
});

describe('savePortfolioSnapshot — 통합', () => {
  test('최초 배포 첫 행: 직전이 구형(USD 없음), 현재 신형 → 저장된다 (직전 행과 비교하지 않는다)', async () => {
    mockDb({ ts: new Date(Date.now() - 60 * 60_000), positions: OLD_ROW });
    await savePortfolioSnapshot(total(NEW_ROW), NEW_ROW, 'hourly', REQ_BOTH);
    expect(inserts()).toHaveLength(1);
  });

  test('🔴 직전 신형, 현재 USD 행 빠짐 + 해외 활성 → 저장 거부 (S4 2차 방어)', async () => {
    const afterSale = [KRW(80_138), USD(10_392.6), H('000660', 1_800_000), H('005930', 1_515_500), H('NAS:STK2', 2_922_464), H('NYS:STK3', 1_035_753)];
    mockDb({ ts: new Date(Date.now() - 60 * 60_000), positions: afterSale });
    const missing = afterSale.filter(p => p.currency !== 'USD');
    await savePortfolioSnapshot(total(missing), missing, 'hourly', REQ_BOTH);
    expect(inserts()).toHaveLength(0);
  });

  test('🔴 릴리스 밸브 없음 — 직전 스냅샷이 4시간 전이어도 USD 행 없는 신형 틱은 거부', async () => {
    mockDb({ ts: new Date(Date.now() - 4 * 60 * 60_000), positions: NEW_ROW });
    await savePortfolioSnapshot(total(OLD_ROW), OLD_ROW, 'hourly', REQ_BOTH);
    expect(inserts()).toHaveLength(0);
  });

  test('🔴 직전 스냅샷이 없어도(부트스트랩) USD 요구는 그대로', async () => {
    mockDb(null);
    await savePortfolioSnapshot(total(OLD_ROW), OLD_ROW, 'hourly', REQ_BOTH);
    expect(inserts()).toHaveLength(0);
  });

  test('활성→비활성: 직전 신형(USD 있음), 현재 USD 없음 + usdCashRequired=false → USD 사유로는 거부하지 않는다', async () => {
    // 해외 보유는 그대로 둔 채 USD 행만 빠진 모양 — 소실 판정(현금 제외)에도 걸리지 않으므로 저장된다.
    mockDb({ ts: new Date(Date.now() - 60 * 60_000), positions: NEW_ROW });
    await savePortfolioSnapshot(total(OLD_ROW), OLD_ROW, 'hourly', REQ_KRW_ONLY);
    expect(inserts()).toHaveLength(1);
  });

  test('비활성→활성: 첫 행부터 USD 요구(직전 행과 무관)', async () => {
    mockDb({ ts: new Date(Date.now() - 60 * 60_000), positions: OLD_ROW });
    await savePortfolioSnapshot(total(OLD_ROW), OLD_ROW, 'hourly', REQ_BOTH);
    expect(inserts()).toHaveLength(0);
    await savePortfolioSnapshot(total(NEW_ROW), NEW_ROW, 'hourly', REQ_BOTH);
    expect(inserts()).toHaveLength(1);
  });

  test('거부는 조용하지 않다 — 사유 코드별 경고가 나간다', async () => {
    mockDb(null);
    await savePortfolioSnapshot(total(OLD_ROW), OLD_ROW, 'hourly', REQ_BOTH);
    expect(sendAlert).toHaveBeenCalled();
    expect(sendAlert.mock.calls.map(c => String(c[2])).join('\n')).toContain('cash_row_missing');
  });
});
