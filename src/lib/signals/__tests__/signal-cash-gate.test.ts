/**
 * T-058 — 시그널 생성 시점 실시간 현금 게이트 (판정·스위치·환율·관측).
 *
 * 지킬 것:
 *  (1) 현금이 필요 금액보다 **엄격히 적을 때만** insufficient — 같으면 통과, 1원(해외 1센트) 모자라면 막힘
 *  (2) 🔴 모르면 막지 않는다 — 조회 실패·상한 초과·unknown·not_queried·환율 없음/오래됨/폴백·시장가·수량 0·값 이상·설정 읽기 오류·내부 예외
 *  (3) 스위치: 키 없음·JSON true = 켜짐, 그 밖의 모든 값과 읽기 오류 = 꺼짐
 *  (4) 해외 필요 USD 는 주문 어댑터와 같은 단가(원화 ÷ 환율 → 호가 반올림)로 계산한다
 *  (5) 관측: 건너뜀 자체는 매번, 로그·trade_logs 는 1시간 1회. 관측 실패는 판정을 바꾸지 않는다. 수치를 싣지 않는다
 */
jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));
jest.mock('@/lib/exchanges/kis', () => ({ getBalancesDetailed: jest.fn() }));
jest.mock('@/lib/exchanges/fx', () => ({ getUsdKrwRate: jest.fn() }));

import { getPool } from '@/lib/db';
import { getBalancesDetailed } from '@/lib/exchanges/kis';
import { getUsdKrwRate } from '@/lib/exchanges/fx';
import {
  CASH_GATE_TRADE_LOG_EVENT,
  FX_MAX_AGE_SEC,
  GATE_LOG_WINDOW_MS,
  SIGNAL_CASH_GATE_KEYS,
  THROTTLE_MAX_KEYS,
  THROTTLE_PRUNE_AT,
  evaluateSignalCashGate,
  gateSwitchValueEnabled,
  judgeFxRow,
  observeSignalCashGate,
  overseasLimitUnitUsd,
  readGateSwitches,
  readGateUsdKrwRate,
  resetSignalCashGateState,
  throttleCheck,
  throttleSize,
  type FxReading,
  type GateSwitches,
  type SignalCashGateDeps,
  type SignalCashGateInput,
} from '../signal-cash-gate';
import {
  overseasUsdCashFromBalances,
  readAvailableCash,
  readDomesticAvailableCashKRW,
  resetEntryCashCache,
  type AvailableCash,
} from '../entry-cash-precheck';

const pool = { query: jest.fn() };
(getPool as jest.Mock).mockReturnValue(pool);

const ON: GateSwitches = { domestic: { enabled: true, source: 'missing' }, overseas: { enabled: true, source: 'missing' } };
const cashOf = (over: Partial<AvailableCash> = {}): AvailableCash => ({ domesticKRW: 1_000_000, overseasUSD: 1_000, overseasUnknownReason: null, ...over });
const FX_1400: FxReading = { kind: 'known', rate: 1400 };

function deps(over: Partial<SignalCashGateDeps> = {}, cash: AvailableCash | null = cashOf(), fx: FxReading = FX_1400) {
  return {
    switches: jest.fn(async () => ON),
    readCash: jest.fn(async () => cash),
    readFx: jest.fn(async () => fx),
    ...over,
  } satisfies SignalCashGateDeps;
}

/** 국내 005930: 5주 × 70,000원 × 1.002 = 350,700원 필요 */
const dom = (over: Partial<SignalCashGateInput> = {}): SignalCashGateInput => ({
  symbol: '005930', side: 'buy', orderType: 'limit',
  size: jest.fn(async () => ({ quantity: 5, price: 70_000 })), ...over,
});
/** 해외 NAS:AAPL: 원화 280,000 ÷ 1400 = $200 → 3주 × $200 × 1.002 = $601.20 필요 */
const ovs = (over: Partial<SignalCashGateInput> = {}): SignalCashGateInput => ({
  symbol: 'NAS:AAPL', side: 'buy', orderType: 'limit',
  size: jest.fn(async () => ({ quantity: 3, price: 280_000 })), ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  (getPool as jest.Mock).mockReturnValue(pool);
  resetSignalCashGateState();
  resetEntryCashCache();
});

describe('1. 판정 — 국내', () => {
  test('🔴 경계: 필요 금액과 같으면 sufficient', async () => {
    const v = await evaluateSignalCashGate(dom(), deps({}, cashOf({ domesticKRW: 350_700 })));
    expect(v).toEqual({ kind: 'sufficient', market: 'domestic', unit: 'KRW', required: 350_700, available: 350_700 });
  });
  test('🔴 경계: 1원 모자라면 insufficient', async () => {
    const v = await evaluateSignalCashGate(dom(), deps({}, cashOf({ domesticKRW: 350_699 })));
    expect(v).toEqual({ kind: 'insufficient', market: 'domestic', unit: 'KRW', required: 350_700, available: 350_699 });
  });
  test('현금 0 은 insufficient (모름이 아니다)', async () => {
    expect((await evaluateSignalCashGate(dom(), deps({}, cashOf({ domesticKRW: 0 })))).kind).toBe('insufficient');
  });
  test('국내는 환율을 읽지 않는다', async () => {
    const d = deps();
    await evaluateSignalCashGate(dom(), d);
    expect(d.readFx).not.toHaveBeenCalled();
  });
  test('여유 0.002 가 반영된다 — 여유 없이 딱 맞는 350,000원은 부족', async () => {
    expect((await evaluateSignalCashGate(dom(), deps({}, cashOf({ domesticKRW: 350_000 })))).kind).toBe('insufficient');
  });
});

describe('2. 판정 — 해외 (USD, 센트 단위)', () => {
  test('🔴 경계: $601.20 이면 sufficient', async () => {
    const v = await evaluateSignalCashGate(ovs(), deps({}, cashOf({ overseasUSD: 601.2 })));
    expect(v).toEqual({ kind: 'sufficient', market: 'overseas', unit: 'USD', required: 601.2, available: 601.2 });
  });
  test('🔴 경계: 1센트 모자라면($601.19) insufficient', async () => {
    const v = await evaluateSignalCashGate(ovs(), deps({}, cashOf({ overseasUSD: 601.19 })));
    expect(v).toMatchObject({ kind: 'insufficient', market: 'overseas', unit: 'USD', required: 601.2, available: 601.19 });
  });
  test('🔴 USD 0 이면 insufficient (known 0 은 진짜 0)', async () => {
    expect((await evaluateSignalCashGate(ovs(), deps({}, cashOf({ overseasUSD: 0 })))).kind).toBe('insufficient');
  });
  test('🔴 국내 KRW 가 아무리 많아도 해외 매수는 USD 로만 본다', async () => {
    expect((await evaluateSignalCashGate(ovs(), deps({}, cashOf({ domesticKRW: 1e12, overseasUSD: 0 })))).kind).toBe('insufficient');
  });
  test('🔴 달러 단위 올림으로 과하게 막지 않는다 — $100.20 필요·$100.25 보유는 통과', async () => {
    // 원화 140,000 ÷ 1400 = $100 → 1주 × $100 × 1.002 = $100.20
    const v = await evaluateSignalCashGate(ovs({ size: async () => ({ quantity: 1, price: 140_000 }) }), deps({}, cashOf({ overseasUSD: 100.25 })));
    expect(v).toMatchObject({ kind: 'sufficient', required: 100.2 });
  });
  test('단가는 주문 어댑터처럼 반올림한다 — $50.54 → $51 로 계산 (실측 NYS:BAC 형태)', async () => {
    // 67,109.0336원 ÷ 1327.84 = $50.54 → 송신 단가 $51 → 15주 × 51 × 1.002 = $766.53
    const v = await evaluateSignalCashGate(
      ovs({ symbol: 'NYS:BAC', size: async () => ({ quantity: 15, price: 67_109.0336 }) }),
      deps({}, cashOf({ overseasUSD: 766.53 }), { kind: 'known', rate: 1327.84 }),
    );
    expect(v).toMatchObject({ kind: 'sufficient', required: 766.53 });
    const v2 = await evaluateSignalCashGate(
      ovs({ symbol: 'NYS:BAC', size: async () => ({ quantity: 15, price: 67_109.0336 }) }),
      deps({}, cashOf({ overseasUSD: 766.52 }), { kind: 'known', rate: 1327.84 }),
    );
    expect(v2.kind).toBe('insufficient');
  });
});

describe('3. 🔴 모르면 막지 않는다 — unknown 전 분기', () => {
  const cases: Array<[string, () => Promise<unknown>, string]> = [
    ['국내 조회 상한 초과(readCash=null)', () => evaluateSignalCashGate(dom(), deps({}, null)), 'cash_timeout'],
    ['국내 현금 모름(domesticKRW=null)', () => evaluateSignalCashGate(dom(), deps({}, cashOf({ domesticKRW: null }))), 'domestic_cash_unknown'],
    ['해외 조회 상한 초과(readCash=null)', () => evaluateSignalCashGate(ovs(), deps({}, null)), 'cash_timeout'],
    ['해외 USD unknown', () => evaluateSignalCashGate(ovs(), deps({}, cashOf({ overseasUSD: null, overseasUnknownReason: 'usd_unknown' }))), 'usd_unknown'],
    ['해외 USD not_queried', () => evaluateSignalCashGate(ovs(), deps({}, cashOf({ overseasUSD: null, overseasUnknownReason: 'usd_not_queried' }))), 'usd_not_queried'],
    ['환율 없음', () => evaluateSignalCashGate(ovs(), deps({}, cashOf({ overseasUSD: 0 }), { kind: 'unknown', reason: 'fx_missing' })), 'fx_missing'],
    ['환율 오래됨(폴백)', () => evaluateSignalCashGate(ovs(), deps({}, cashOf({ overseasUSD: 0 }), { kind: 'unknown', reason: 'fx_stale' })), 'fx_stale'],
    ['환율 이상', () => evaluateSignalCashGate(ovs(), deps({}, cashOf({ overseasUSD: 0 }), { kind: 'unknown', reason: 'fx_invalid' })), 'fx_invalid'],
    ['시장가(국내)', () => evaluateSignalCashGate(dom({ orderType: 'market' }), deps({}, cashOf({ domesticKRW: 0 }))), 'market_order'],
    ['시장가(해외)', () => evaluateSignalCashGate(ovs({ orderType: 'market' }), deps({}, cashOf({ overseasUSD: 0 }))), 'market_order'],
    ['수량 0(1주 미만)', () => evaluateSignalCashGate(dom({ size: async () => ({ quantity: 0, price: 70_000 }) }), deps({}, cashOf({ domesticKRW: 0 }))), 'quantity_zero'],
    ['수량 미확정', () => evaluateSignalCashGate(dom({ size: async () => ({ quantity: undefined, price: 70_000 }) }), deps({}, cashOf({ domesticKRW: 0 }))), 'quantity_unresolved'],
    ['수량 NaN', () => evaluateSignalCashGate(dom({ size: async () => ({ quantity: NaN, price: 70_000 }) }), deps({}, cashOf({ domesticKRW: 0 }))), 'quantity_invalid'],
    ['수량 소수', () => evaluateSignalCashGate(dom({ size: async () => ({ quantity: 1.5, price: 70_000 }) }), deps({}, cashOf({ domesticKRW: 0 }))), 'quantity_invalid'],
    ['가격 없음', () => evaluateSignalCashGate(dom({ size: async () => ({ quantity: 5, price: undefined }) }), deps({}, cashOf({ domesticKRW: 0 }))), 'price_invalid'],
    ['가격 0', () => evaluateSignalCashGate(dom({ size: async () => ({ quantity: 5, price: 0 }) }), deps({}, cashOf({ domesticKRW: 0 }))), 'price_invalid'],
    ['가격 Infinity', () => evaluateSignalCashGate(ovs({ size: async () => ({ quantity: 5, price: Infinity }) }), deps({}, cashOf({ overseasUSD: 0 }))), 'price_invalid'],
    ['사이징 예외', () => evaluateSignalCashGate(dom({ size: async () => { throw new Error('style db down'); } }), deps({}, cashOf({ domesticKRW: 0 }))), 'sizing_failed'],
    ['현금 조회가 던짐(게이트 내부 예외)', () => evaluateSignalCashGate(dom(), deps({ readCash: async () => { throw new Error('x'); } })), 'gate_exception'],
    ['스위치 조회가 던짐(게이트 내부 예외)', () => evaluateSignalCashGate(dom(), deps({ switches: async () => { throw new Error('x'); } })), 'gate_exception'],
    ['환율 조회가 던짐(게이트 내부 예외)', () => evaluateSignalCashGate(ovs(), deps({ readFx: async () => { throw new Error('x'); } }, cashOf({ overseasUSD: 0 }))), 'gate_exception'],
  ];
  test.each(cases)('%s → unknown(%s 아님 insufficient)', async (_label, run, reason) => {
    const v = await run();
    expect(v).toMatchObject({ kind: 'unknown', reason });
  });

  test('🔴 게이트 전체 상한 초과 → unknown(gate_timeout), 던지지 않는다', async () => {
    const hang = new Promise<AvailableCash | null>(() => { /* 영원히 */ });
    const v = await evaluateSignalCashGate(dom(), deps({ readCash: () => hang }), 30);
    expect(v).toEqual({ kind: 'unknown', market: 'domestic', reason: 'gate_timeout' });
  });

  test('수량 0·시장가는 현금을 읽지도 않는다 (KIS 호출을 늘리지 않는다)', async () => {
    const d = deps();
    await evaluateSignalCashGate(dom({ orderType: 'market' }), d);
    await evaluateSignalCashGate(dom({ size: async () => ({ quantity: 0, price: 70_000 }) }), d);
    expect(d.readCash).not.toHaveBeenCalled();
  });
});

describe('4. 매도·스위치', () => {
  test('매도는 not_applicable — 스위치·사이징·현금 어느 것도 부르지 않는다', async () => {
    const d = deps();
    const input = dom({ side: 'sell' });
    expect(await evaluateSignalCashGate(input, d)).toEqual({ kind: 'not_applicable' });
    expect(d.switches).not.toHaveBeenCalled();
    expect(input.size).not.toHaveBeenCalled();
    expect(d.readCash).not.toHaveBeenCalled();
  });
  test('🔴 시장별 스위치 — 해외만 꺼도 국내는 막고 해외는 막지 않는다', async () => {
    const sw: GateSwitches = { domestic: { enabled: true, source: 'missing' }, overseas: { enabled: false, source: 'value' } };
    const d = deps({ switches: async () => sw }, cashOf({ domesticKRW: 0, overseasUSD: 0 }));
    expect((await evaluateSignalCashGate(dom(), d)).kind).toBe('insufficient');
    const o = ovs();
    expect(await evaluateSignalCashGate(o, d)).toEqual({ kind: 'disabled', market: 'overseas', source: 'value' });
    expect(o.size).not.toHaveBeenCalled();                 // 꺼져 있으면 사이징(DB 읽기)도 하지 않는다
  });

  test.each([
    ['true', true], ['false', false], ['"false"', false], ['"true"', false], ['0', false], ['1', false],
    ['null', false], ['not-json', false], ['', false], ['TRUE', false],
  ])('저장값 %s → 켜짐=%s', (raw, on) => {
    expect(gateSwitchValueEnabled(raw)).toBe(on);
  });
  test('드라이버가 이미 파싱한 값: true 만 켜짐', () => {
    expect(gateSwitchValueEnabled(true)).toBe(true);
    for (const v of [false, 0, 1, null, undefined, {}]) expect(gateSwitchValueEnabled(v)).toBe(false);
  });

  test('readGateSwitches — 🔴 키 없음 = 켜짐(missing)', async () => {
    pool.query.mockResolvedValueOnce([[]]);
    expect(await readGateSwitches()).toEqual(ON);
    expect(pool.query.mock.calls[0][1]).toEqual([SIGNAL_CASH_GATE_KEYS.domestic, SIGNAL_CASH_GATE_KEYS.overseas]);
  });
  test('readGateSwitches — 값이 있으면 true 만 켜짐, 시장별로 따로', async () => {
    pool.query.mockResolvedValueOnce([[
      { key: SIGNAL_CASH_GATE_KEYS.domestic, value: 'true' },
      { key: SIGNAL_CASH_GATE_KEYS.overseas, value: '"false"' },
    ]]);
    expect(await readGateSwitches()).toEqual({ domestic: { enabled: true, source: 'value' }, overseas: { enabled: false, source: 'value' } });
  });
  test('🔴 readGateSwitches — 읽기 오류는 키 없음(켜짐)으로 합치지 않는다 → 꺼짐(read_error)', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'));
    expect(await readGateSwitches()).toEqual({ domestic: { enabled: false, source: 'read_error' }, overseas: { enabled: false, source: 'read_error' } });
  });
  test('readGateSwitches — 30초 캐시 (매 호출 DB 를 읽지 않는다)', async () => {
    let t = 0;
    pool.query.mockResolvedValue([[]]);
    await readGateSwitches(() => t);
    t = 29_999; await readGateSwitches(() => t);
    expect(pool.query).toHaveBeenCalledTimes(1);
    t = 30_000; await readGateSwitches(() => t);
    expect(pool.query).toHaveBeenCalledTimes(2);
  });
});

describe('5. 환율 (S-1 — 폴백 숫자를 모름으로 읽는다)', () => {
  test('judgeFxRow — 신선하고 상식 범위면 known', () => {
    expect(judgeFxRow('1327.8400', 59)).toEqual({ kind: 'known', rate: 1327.84 });
    expect(judgeFxRow(1400, '0')).toEqual({ kind: 'known', rate: 1400 });
    expect(judgeFxRow('1400', FX_MAX_AGE_SEC)).toEqual({ kind: 'known', rate: 1400 });
  });
  test('🔴 judgeFxRow — 허용 시간(1시간) 초과는 fx_stale', () => {
    expect(judgeFxRow('1400', FX_MAX_AGE_SEC + 1)).toEqual({ kind: 'unknown', reason: 'fx_stale' });
    expect(judgeFxRow('1400', 86_400 * 3)).toEqual({ kind: 'unknown', reason: 'fx_stale' });
  });
  test('🔴 judgeFxRow — 값 이상은 fx_invalid', () => {
    for (const [r, a] of [[null, 10], ['', 10], ['abc', 10], [0, 10], [-1400, 10], [1, 10], [99, 10], [10_001, 10], [NaN, 10], ['1400', null], ['1400', -5], ['1400', 'x']] as const) {
      expect(judgeFxRow(r, a)).toEqual({ kind: 'unknown', reason: 'fx_invalid' });
    }
  });

  test('readGateUsdKrwRate — 갱신을 유도하고, 반환값이 아니라 DB 행의 나이로 판정한다', async () => {
    (getUsdKrwRate as jest.Mock).mockResolvedValue(1400);
    pool.query.mockResolvedValueOnce([[{ rate: '1327.8400', age_sec: 30 }]]);
    expect(await readGateUsdKrwRate()).toEqual({ kind: 'known', rate: 1327.84 });   // 1400 이 아니라 행의 값
    expect(getUsdKrwRate).toHaveBeenCalledTimes(1);
    expect(String(pool.query.mock.calls[0][0])).toMatch(/TIMESTAMPDIFF\(SECOND, fetched_at, NOW\(\)\)/);
  });
  test('🔴 외부 실패 + DB 오래됨 → fx.ts 는 오래된 값을 숫자로 주지만 게이트는 fx_stale', async () => {
    (getUsdKrwRate as jest.Mock).mockResolvedValue(1350);         // fx.ts 의 "DB 마지막 값(stale 이라도)" 반환
    pool.query.mockResolvedValueOnce([[{ rate: '1350.0000', age_sec: 7_200 }]]);
    expect(await readGateUsdKrwRate()).toEqual({ kind: 'unknown', reason: 'fx_stale' });
  });
  test('🔴 환경변수·하드코딩 폴백(1380) 상황 = DB 행 없음 → fx_missing', async () => {
    (getUsdKrwRate as jest.Mock).mockResolvedValue(1380);
    pool.query.mockResolvedValueOnce([[]]);
    expect(await readGateUsdKrwRate()).toEqual({ kind: 'unknown', reason: 'fx_missing' });
  });
  test('DB 조회 실패 → fx_read_failed', async () => {
    (getUsdKrwRate as jest.Mock).mockResolvedValue(1400);
    pool.query.mockRejectedValueOnce(new Error('db down'));
    expect(await readGateUsdKrwRate()).toEqual({ kind: 'unknown', reason: 'fx_read_failed' });
  });
  test('갱신이 던져도 DB 가 신선하면 known', async () => {
    (getUsdKrwRate as jest.Mock).mockRejectedValue(new Error('net'));
    pool.query.mockResolvedValueOnce([[{ rate: '1400', age_sec: 10 }]]);
    expect(await readGateUsdKrwRate()).toEqual({ kind: 'known', rate: 1400 });
  });
  test('🔴 갱신이 멈춰도 상한 뒤에 DB 를 읽는다(게이트를 붙잡지 않는다)', async () => {
    (getUsdKrwRate as jest.Mock).mockReturnValue(new Promise(() => { /* 멈춤 */ }));
    pool.query.mockResolvedValueOnce([[{ rate: '1400', age_sec: 10 }]]);
    expect(await readGateUsdKrwRate(20)).toEqual({ kind: 'known', rate: 1400 });
  });
});

describe('6. 해외 주문 단가 (kis-overseas createOrder 와 같은 반올림)', () => {
  test('$1 이상은 1달러 단위 반올림, 미만은 0.0001 단위', () => {
    expect(overseasLimitUnitUsd(280_000, 1400)).toBe(200);
    expect(overseasLimitUnitUsd(67_109.0336, 1327.84)).toBe(51);       // 50.54 → 51
    expect(overseasLimitUnitUsd(66_000, 1327.84)).toBe(50);            // 49.70 → 50
    expect(overseasLimitUnitUsd(700, 1400)).toBe(0.5);
    expect(overseasLimitUnitUsd(172.79, 1400)).toBe(0.1234);
  });
  test('비정상 입력은 null', () => {
    for (const [p, f] of [[0, 1400], [-1, 1400], [NaN, 1400], [Infinity, 1400], [1000, 0], [1000, NaN], [0.00001, 1400]] as const) {
      expect(overseasLimitUnitUsd(p, f)).toBeNull();
    }
  });
});

describe('7. 현금 읽기 — 한 번의 잔고 조회로 국내·해외 (entry-cash-precheck 확장)', () => {
  const detailed = getBalancesDetailed as jest.Mock;
  const balances = (usd: unknown, ok = ['domestic', 'overseas']) => ({
    balances: [{ currency: 'KRW', free: 500_000 }], ok, failed: [], complete: true, cash: { USD: usd }, overseasEnabled: true,
  });

  test('known USD 는 그 값, unknown/not_queried/형식 이상은 null + 이유', () => {
    expect(overseasUsdCashFromBalances(balances({ state: 'known', usd: 12.5 }))).toEqual({ usd: 12.5, reason: null });
    expect(overseasUsdCashFromBalances(balances({ state: 'known', usd: 0 }))).toEqual({ usd: 0, reason: null });
    expect(overseasUsdCashFromBalances(balances({ state: 'unknown', error: 'x' }))).toEqual({ usd: null, reason: 'usd_unknown' });
    expect(overseasUsdCashFromBalances(balances({ state: 'not_queried' }))).toEqual({ usd: null, reason: 'usd_not_queried' });
    for (const bad of [{ state: 'known', usd: '' }, { state: 'known', usd: null }, { state: 'known', usd: -1 }, { state: 'known', usd: NaN }, { state: 'known' }]) {
      expect(overseasUsdCashFromBalances(balances(bad))).toEqual({ usd: null, reason: 'usd_invalid' });
    }
    expect(overseasUsdCashFromBalances({})).toEqual({ usd: null, reason: 'usd_missing' });
    expect(overseasUsdCashFromBalances(null)).toEqual({ usd: null, reason: 'usd_missing' });
  });

  test('🔴 국내(entry-watcher)와 해외(게이트)가 같은 조회 1회를 공유한다', async () => {
    detailed.mockResolvedValue(balances({ state: 'known', usd: 42 }));
    const [a, b] = await Promise.all([readDomesticAvailableCashKRW(), readAvailableCash()]);
    expect(a).toBe(500_000);
    expect(b).toEqual({ domesticKRW: 500_000, overseasUSD: 42, overseasUnknownReason: null });
    expect(detailed).toHaveBeenCalledTimes(1);
  });
  test('조회가 던지면 모든 값이 null(던지지 않는다)', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    detailed.mockRejectedValue(new Error('EGW00201'));
    expect(await readAvailableCash()).toEqual({ domesticKRW: null, overseasUSD: null, overseasUnknownReason: 'balances_read_failed' });
  });
  test('국내 조회만 실패해도 해외 USD 는 쓴다(시장별 독립)', async () => {
    detailed.mockResolvedValue(balances({ state: 'known', usd: 7 }, ['overseas']));
    expect(await readAvailableCash()).toEqual({ domesticKRW: null, overseasUSD: 7, overseasUnknownReason: null });
  });
});

describe('8. 관측 — 스로틀·best-effort·수치 없음', () => {
  let info: jest.SpyInstance;
  let err: jest.SpyInstance;
  beforeEach(() => {
    info = jest.spyOn(console, 'info').mockImplementation(() => {});
    err = jest.spyOn(console, 'error').mockImplementation(() => {});
    pool.query.mockResolvedValue([{}]);
  });
  afterEach(() => { info.mockRestore(); err.mockRestore(); });

  const INSUF = { kind: 'insufficient', market: 'domestic', unit: 'KRW', required: 350_700, available: 80_138 } as const;
  const tradeLogCalls = () => pool.query.mock.calls.filter((c) => /INSERT INTO trade_logs/.test(String(c[0])));

  test('🔴 같은 (시장, 심볼, 방향)은 1시간 1회만 로그·trade_logs — 억제 건수를 다음 기록에 싣는다', async () => {
    const t0 = 1_000_000_000;
    await observeSignalCashGate({ symbol: '005930', side: 'buy' }, INSUF, t0);
    for (let i = 1; i <= 5; i++) await observeSignalCashGate({ symbol: '005930', side: 'buy' }, INSUF, t0 + i * 10 * 60_000 - 1);
    expect(info).toHaveBeenCalledTimes(1);
    expect(tradeLogCalls()).toHaveLength(1);
    await observeSignalCashGate({ symbol: '005930', side: 'buy' }, INSUF, t0 + GATE_LOG_WINDOW_MS);
    expect(info).toHaveBeenCalledTimes(2);
    expect(info.mock.calls[1][0]).toContain('suppressed_since_last=5');
    const logs = tradeLogCalls();
    expect(logs).toHaveLength(2);
    expect(logs[1][1][1]).toBe(CASH_GATE_TRADE_LOG_EVENT);
    expect(JSON.parse(String(logs[1][1][2]))).toEqual({ market: 'domestic', symbol: '005930', side: 'buy', reason: 'insufficient_cash', suppressedSinceLast: 5 });
  });

  test('다른 심볼·다른 시장은 각자 기록된다 (해외는 국내와 따로 센다)', async () => {
    await observeSignalCashGate({ symbol: '005930', side: 'buy' }, INSUF, 1);
    await observeSignalCashGate({ symbol: '000660', side: 'buy' }, INSUF, 2);
    await observeSignalCashGate({ symbol: 'NAS:AAPL', side: 'buy' }, { ...INSUF, market: 'overseas', unit: 'USD' }, 3);
    expect(info).toHaveBeenCalledTimes(3);
    expect(info.mock.calls[2][0]).toContain('market=overseas symbol=NAS:AAPL');
  });

  test('🔴 로그·기록에 금액·잔고 수치를 싣지 않는다', async () => {
    await observeSignalCashGate({ symbol: '005930', side: 'buy' }, INSUF, 1);
    const line = String(info.mock.calls[0][0]);
    expect(line).toBe('[signal-cash-gate] 현금 부족 매수 — 시그널·알림을 만들지 않음: market=domestic symbol=005930 side=buy reason=insufficient_cash suppressed_since_last=0');
    const payload = String(tradeLogCalls()[0][1][2]);
    for (const n of ['350700', '350,700', '80138', '80,138']) { expect(line).not.toContain(n); expect(payload).not.toContain(n); }
  });

  test('🔴 trade_logs 기록이 실패해도 던지지 않는다', async () => {
    pool.query.mockRejectedValue(new Error('db down'));
    await expect(observeSignalCashGate({ symbol: '005930', side: 'buy' }, INSUF, 1)).resolves.toBeUndefined();
    expect(err).toHaveBeenCalled();
  });
  test('🔴 로그 출력 자체가 던져도 던지지 않는다', async () => {
    info.mockImplementation(() => { throw new Error('stdout closed'); });
    await expect(observeSignalCashGate({ symbol: '005930', side: 'buy' }, INSUF, 1)).resolves.toBeUndefined();
  });

  test('unknown·disabled·sufficient 는 trade_logs 없이 로그만, 사유별 1시간 1회', async () => {
    await observeSignalCashGate({ symbol: 'A', side: 'buy' }, { kind: 'unknown', market: 'overseas', reason: 'fx_stale' }, 1);
    await observeSignalCashGate({ symbol: 'B', side: 'buy' }, { kind: 'unknown', market: 'overseas', reason: 'fx_stale' }, 2);
    await observeSignalCashGate({ symbol: 'C', side: 'buy' }, { kind: 'unknown', market: 'overseas', reason: 'usd_unknown' }, 3);
    await observeSignalCashGate({ symbol: 'D', side: 'buy' }, { kind: 'disabled', market: 'domestic', source: 'read_error' }, 4);
    await observeSignalCashGate({ symbol: 'E', side: 'buy' }, { kind: 'sufficient', market: 'domestic', unit: 'KRW', required: 1, available: 2 }, 5);
    await observeSignalCashGate({ symbol: 'F', side: 'buy' }, { kind: 'sufficient', market: 'domestic', unit: 'KRW', required: 1, available: 2 }, 6);
    expect(info).toHaveBeenCalledTimes(4);
    expect(tradeLogCalls()).toHaveLength(0);
    expect(info.mock.calls.map((c) => String(c[0]))).toEqual([
      '[signal-cash-gate] 현금 판단 불가 — 막지 않고 기존대로 생성: market=overseas reason=fx_stale suppressed_since_last=0',
      '[signal-cash-gate] 현금 판단 불가 — 막지 않고 기존대로 생성: market=overseas reason=usd_unknown suppressed_since_last=0',
      '[signal-cash-gate] 스위치 꺼짐 — 점검 생략: market=domestic source=read_error',
      '[signal-cash-gate] 점검 통과(현금 충분) — 시그널 생성: market=domestic suppressed_since_last=0',
    ]);
  });
  test('not_applicable(매도)은 아무것도 남기지 않는다', async () => {
    await observeSignalCashGate({ symbol: 'A', side: 'sell' }, { kind: 'not_applicable' }, 1);
    expect(info).not.toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('🔴 스로틀 키 정리 — 만료 키는 지우고, 절대 상한을 넘지 않는다', () => {
    for (let i = 0; i < THROTTLE_PRUNE_AT; i++) throttleCheck(`k${i}`, 0);
    expect(throttleSize()).toBe(THROTTLE_PRUNE_AT);
    throttleCheck('fresh', GATE_LOG_WINDOW_MS);              // 상한 초과 → 만료된 k* 전부 정리
    expect(throttleSize()).toBe(1);
    for (let i = 0; i < THROTTLE_MAX_KEYS + 500; i++) throttleCheck(`n${i}`, GATE_LOG_WINDOW_MS + 1);   // 모두 창 안
    expect(throttleSize()).toBeLessThanOrEqual(THROTTLE_MAX_KEYS);
  });
});
