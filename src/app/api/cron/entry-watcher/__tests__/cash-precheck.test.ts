/**
 * T-051 — entry-watcher **선점 전 가용 현금 사전 점검**.
 *
 * 결함: 1주 비용이 가용 현금보다 큰 매수 시그널이 진입 구간에 있으면 선점 → submitOrder → 거래소 거부 → 선점 복귀가 매 분 반복됐다.
 * 지킬 것:
 *  (a) 국내 매수이고 현금이 모자라면 **선점 UPDATE 도 submitOrder 도 부르지 않는다**(시그널은 approved_pending_entry 로 남는다)
 *  (b) 충분하면 기존 경로 그대로(선점 → submitOrder → 기록)
 *  (c) 잔고 조회가 던지거나 값이 비정상이면 기존 경로 — 이 점검은 편의 기능이지 안전 관문이 아니다
 *  (d) 알림·감사 기록은 시그널당 하루 한 번(두 번째 틱에서 안 나감), 시그널이 다르면 각자 한 번
 *  (e) 매도·해외는 점검하지 않는다
 *  (f) 현금이 채워지면 다음 틱에 정상 진행
 *  (g) 수량 0·구간 밖·분할 대기 같은 기존 분기는 점검보다 먼저이고 그대로다
 */
jest.mock('@/lib/cron-auth', () => ({ checkCronAuth: jest.fn(() => null) }));
jest.mock('@/lib/strategy/market-hours', () => ({
  isDomesticOpen: jest.fn(async () => true),
  isOverseasOpen: jest.fn(async () => true),
}));
jest.mock('@/lib/db', () => ({ getPool: jest.fn(), getAccountId: jest.fn(async () => 1) }));
jest.mock('@/lib/exchanges/kis', () => ({
  kis: { getTicker: jest.fn(), createOrder: jest.fn() },
  getBalancesDetailed: jest.fn(),
}));
jest.mock('@/lib/safety/dry-run', () => ({ submitOrder: jest.fn() }));
jest.mock('@/lib/strategy/style', () => ({ getStyleConfig: jest.fn(async () => ({ limitChasePct: 0 })) }));
jest.mock('@/lib/strategy/position-state', () => ({ setPositionScenarioExit: jest.fn(async () => undefined) }));
jest.mock('@/lib/notify', () => ({ sendAlert: jest.fn(), getSymbolLabel: jest.fn(async (s: string) => s) }));
// 스로틀은 목으로 바꾸지 않는다 — "시그널당 한 번"은 실제 스로틀 동작으로 확인해야 한다(아래로 내려가는 sendAlert 만 목).

import { NextRequest } from 'next/server';
import { POST } from '../route';
import { getPool } from '@/lib/db';
import { getBalancesDetailed, kis } from '@/lib/exchanges/kis';
import { submitOrder } from '@/lib/safety/dry-run';
import { getStyleConfig } from '@/lib/strategy/style';
import { sendAlert } from '@/lib/notify';
import { resetAlertThrottle } from '@/lib/notify/throttle';
import { resetEntryCashCache } from '@/lib/signals/entry-cash-precheck';
import { FakeSignalsDb, fakeSignal } from './fakeSignalsDb';

let db: FakeSignalsDb;
let sqlLog: Array<{ sql: string; params: unknown[] }>;
type Result = { signalId: number; outcome: string; detail?: string };
const req = () => new NextRequest('http://localhost:3003/api/cron/entry-watcher', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
const run = async () => (await POST(req())).json() as Promise<{ results?: Result[] }>;
const cashAlerts = () => ((sendAlert as jest.Mock).mock.calls as Array<[string, string, string]>).filter((a) => a[1].includes('현금 부족'));
const cashLogs = () => sqlLog.filter((q) => /INSERT INTO trade_logs/.test(q.sql) && q.params[1] === 'entry_cash_insufficient');
const claims = () => db.events.filter((e) => e.startsWith('claim:'));
const balancesWithCash = (free: number) => ({ ok: ['domestic', 'overseas'], failed: [], complete: true, balances: [{ currency: 'KRW', free, locked: 0 }] });
/** 다음 틱(30초 TTL 이후)을 모사 — 현금 캐시만 비운다. 알림 스로틀(24시간)은 그대로 둔다. */
const nextTick = () => resetEntryCashCache();

// fakeSignal 기본값: 005930 매수 지정가 6,540원 · 금액 100,000원 → 15주 · 예상 비용 98,100 × 1.002 = 98,297원
const NEED = 98_297;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  resetAlertThrottle();
  resetEntryCashCache();
  (kis.getTicker as jest.Mock).mockResolvedValue({ price: 6_540 });
  (getStyleConfig as jest.Mock).mockResolvedValue({ limitChasePct: 0 });   // (h) 가 바꾼 추격률을 테스트마다 되돌린다
  (getBalancesDetailed as jest.Mock).mockReset().mockResolvedValue(balancesWithCash(80_000));
  (submitOrder as jest.Mock).mockReset().mockImplementation(async () => { db.events.push('submit'); return { ok: true, orderId: 501 }; });
  db = new FakeSignalsDb();
  sqlLog = [];
  const inner = db.pool;
  (getPool as jest.Mock).mockReturnValue({
    query: (sql: unknown, params?: unknown[]) => {
      sqlLog.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params: params ?? [] });
      return inner.query(sql, params);
    },
  });
});
afterEach(() => jest.restoreAllMocks());

describe('(a) 현금이 모자라면 선점·주문 없이 건너뛴다', () => {
  test('🔴 선점 UPDATE·submitOrder 가 불리지 않고, 시그널은 approved_pending_entry 로 남는다', async () => {
    db.add(fakeSignal(1));
    const body = await run();
    expect(submitOrder).not.toHaveBeenCalled();
    expect(claims()).toEqual([]);                                         // 🔴 점검이 선점 뒤로 가면 claim:1:won 이 찍힌다
    expect(db.events.some((e) => e.startsWith('release:'))).toBe(false);
    expect(db.statusOf(1)).toBe('approved_pending_entry');
    expect(body.results).toEqual([expect.objectContaining({ signalId: 1, outcome: 'cash_insufficient' })]);
    expect(body.results?.[0].detail).toContain(`필요 ${NEED.toLocaleString('ko-KR')}`);
  });

  test('알림 본문: 시그널 번호·종목·필요 금액·가용 현금·자동 재시도 안내', async () => {
    db.add(fakeSignal(2));
    await run();
    expect(cashAlerts()).toHaveLength(1);
    const [level, title, text] = cashAlerts()[0];
    expect(level).toBe('warning');
    expect(title).toContain('005930');
    expect(text).toContain('시그널 #2');
    expect(text).toContain(`${NEED.toLocaleString('ko-KR')}원`);
    expect(text).toContain('80,000원');
    expect(text).toContain('현금이 채워지면 자동으로 다시 시도됩니다');
  });

  test('감사 기록 1행(entry_cash_insufficient)에 금액·현금이 남는다', async () => {
    db.add(fakeSignal(3));
    await run();
    expect(cashLogs()).toHaveLength(1);
    const payload = JSON.parse(String(cashLogs()[0].params[2]));
    expect(payload).toMatchObject({ signalId: 3, symbol: '005930', requiredKRW: NEED, availableKRW: 80_000, quantity: 15, price: 6_540 });
  });

  test('🔴 현금 0 도 건너뛴다(모름이 아니라 없음)', async () => {
    (getBalancesDetailed as jest.Mock).mockResolvedValue(balancesWithCash(0));
    db.add(fakeSignal(4));
    const body = await run();
    expect(submitOrder).not.toHaveBeenCalled();
    expect(body.results?.[0].outcome).toBe('cash_insufficient');
  });

  test('🔴 경계: 정확히 필요한 만큼이면 주문, 1원 모자라면 건너뜀', async () => {
    (getBalancesDetailed as jest.Mock).mockResolvedValue(balancesWithCash(NEED - 1));
    db.add(fakeSignal(5));
    expect((await run()).results?.[0].outcome).toBe('cash_insufficient');
    nextTick();
    (getBalancesDetailed as jest.Mock).mockResolvedValue(balancesWithCash(NEED));
    expect((await run()).results?.[0].outcome).toBe('submitted');
    expect(submitOrder).toHaveBeenCalledTimes(1);
  });

  test('🔴 알림 발송·감사 기록이 실패해도 틱은 계속된다(다음 시그널 처리)', async () => {
    (sendAlert as jest.Mock).mockImplementationOnce(() => { throw new Error('telegram down'); });
    db.failOn = [/INSERT INTO trade_logs/];
    db.add(fakeSignal(6));
    db.add(fakeSignal(7, { side: 'sell' }));
    const body = await run();
    expect(body.results?.map((r) => [r.signalId, r.outcome])).toEqual([[6, 'cash_insufficient'], [7, 'submitted']]);
  });
});

describe('(b) 현금이 충분하면 기존 경로 그대로', () => {
  test('선점 → submitOrder → 주문 번호 기록, 알림·감사 기록 없음', async () => {
    (getBalancesDetailed as jest.Mock).mockResolvedValue(balancesWithCash(5_000_000));
    db.add(fakeSignal(10));
    const body = await run();
    // T-072 G5 — 검증 상태 관문(strategies 조회)이 현금 점검·선점보다 먼저다
    expect(db.events.filter((e) => e !== 'select' && e !== 'stuck-check')).toEqual(['strategy:validated-v1', 'claim:10:won', 'submit', 'record:10:501']);
    expect(body.results?.[0].outcome).toBe('submitted');
    expect(cashAlerts()).toHaveLength(0);
    expect(cashLogs()).toHaveLength(0);
  });

  test('🔴 점검이 충분이라고 해도 submitOrder 의 거부(킬스위치)는 그대로 — 선점 복귀, order_failed', async () => {
    (getBalancesDetailed as jest.Mock).mockResolvedValue(balancesWithCash(5_000_000));
    (submitOrder as jest.Mock).mockResolvedValue({ ok: false, blockedBy: 'kill_switch', error: 'KILL_SWITCH_ACTIVE' });
    db.add(fakeSignal(11));
    const body = await run();
    expect(body.results?.[0]).toMatchObject({ outcome: 'order_failed', detail: 'KILL_SWITCH_ACTIVE' });
    expect(db.events).toEqual(expect.arrayContaining(['claim:11:won', 'release:11:ok']));
  });

  test('같은 틱의 여러 시그널은 잔고 조회 1회를 공유한다', async () => {
    (getBalancesDetailed as jest.Mock).mockResolvedValue(balancesWithCash(0));
    db.add(fakeSignal(12)); db.add(fakeSignal(13)); db.add(fakeSignal(14));
    await run();
    expect(getBalancesDetailed).toHaveBeenCalledTimes(1);
  });
});

describe('(c) 잔고를 모르면 기존 경로', () => {
  test.each([
    ['조회가 던짐', () => (getBalancesDetailed as jest.Mock).mockRejectedValue(new Error('EGW00201'))],
    ['국내 조회 실패(해외만 성공)', () => (getBalancesDetailed as jest.Mock).mockResolvedValue({ ok: ['overseas'], failed: [{ market: 'domestic', error: 'x' }], complete: false, balances: [] })],
    ['KRW 행 없음', () => (getBalancesDetailed as jest.Mock).mockResolvedValue({ ok: ['domestic'], failed: [], complete: true, balances: [] })],
    ['KRW 값 NaN', () => (getBalancesDetailed as jest.Mock).mockResolvedValue(balancesWithCash(NaN))],
    ['KRW 값 음수', () => (getBalancesDetailed as jest.Mock).mockResolvedValue(balancesWithCash(-5))],
    ['undefined 반환', () => (getBalancesDetailed as jest.Mock).mockResolvedValue(undefined)],
  ])('🔴 %s → 선점·submitOrder 진행', async (_name, arrange) => {
    arrange();
    db.add(fakeSignal(20));
    const body = await run();
    expect(submitOrder).toHaveBeenCalledTimes(1);
    expect(body.results?.[0].outcome).toBe('submitted');
    expect(cashAlerts()).toHaveLength(0);
  });

  test('🔴 시그널 가격이 비정상(NaN)이면 판단불가 → 기존 경로', async () => {
    (getBalancesDetailed as jest.Mock).mockResolvedValue(balancesWithCash(0));
    db.add(fakeSignal(21, { order_type: 'market', price: 'abc' }));
    await run();
    expect(submitOrder).toHaveBeenCalledTimes(1);
  });
});

describe('(d) 알림은 시그널당 하루 한 번', () => {
  test('🔴 두 번째 틱에서는 알림·감사 기록이 나가지 않는다(건너뛰기는 계속)', async () => {
    db.add(fakeSignal(30));
    const first = await run();
    nextTick();
    const second = await run();
    expect(first.results?.[0].outcome).toBe('cash_insufficient');
    expect(second.results?.[0].outcome).toBe('cash_insufficient');
    expect(getBalancesDetailed).toHaveBeenCalledTimes(2);                 // 틱마다 현금은 다시 본다
    expect(cashAlerts()).toHaveLength(1);
    expect(cashLogs()).toHaveLength(1);
    expect(submitOrder).not.toHaveBeenCalled();
  });

  test('🔴 시그널이 다르면 각자 한 번씩 알린다(키에 시그널 ID)', async () => {
    db.add(fakeSignal(31)); db.add(fakeSignal(32));
    await run();
    const ids = cashAlerts().map((a) => a[2].match(/시그널 #(\d+)/)?.[1]);
    expect(ids.sort()).toEqual(['31', '32']);
    expect(cashLogs()).toHaveLength(2);
  });
});

describe('(e) 매도·해외는 점검하지 않는다', () => {
  test('매도는 현금 0 이어도 선점·주문, 잔고 조회 없음', async () => {
    (getBalancesDetailed as jest.Mock).mockResolvedValue(balancesWithCash(0));
    db.add(fakeSignal(40, { side: 'sell' }));
    const body = await run();
    expect(body.results?.[0].outcome).toBe('submitted');
    expect(getBalancesDetailed).not.toHaveBeenCalled();
  });

  test('해외 매수는 현금 0 이어도 기존 경로, 잔고 조회 없음', async () => {
    (getBalancesDetailed as jest.Mock).mockResolvedValue(balancesWithCash(0));
    (kis.getTicker as jest.Mock).mockResolvedValue({ price: 200 });
    db.add(fakeSignal(41, { symbol: 'NAS:AAPL', market: 'overseas', price: '200', amount_krw: '1000' }));
    const body = await run();
    expect(body.results?.[0].outcome).toBe('submitted');
    expect(getBalancesDetailed).not.toHaveBeenCalled();
  });
});

describe('(f) 현금이 채워지면 다음 틱에 정상 진행', () => {
  test('🔴 부족 → (입금) → 다음 틱에 선점·주문', async () => {
    db.add(fakeSignal(50));
    expect((await run()).results?.[0].outcome).toBe('cash_insufficient');
    nextTick();
    (getBalancesDetailed as jest.Mock).mockResolvedValue(balancesWithCash(1_000_000));
    const body = await run();
    expect(body.results?.[0].outcome).toBe('submitted');
    expect(db.statusOf(50)).toBe('executing');
    expect(submitOrder).toHaveBeenCalledTimes(1);
  });
});

describe('(h) 비용 식의 입력 — 추격 반영 가격·명시 수량 (T-051 Reviewer R-1 ①④)', () => {
  test('🔴 추격 0.3% 이면 필요액은 15주 × 6,559.62원 × 1.002 = 98,592원 — 추격을 무시한 98,297원 기준이면 통과했을 98,500원을 부족으로 본다', async () => {
    (getStyleConfig as jest.Mock).mockResolvedValue({ limitChasePct: 0.003 });
    (getBalancesDetailed as jest.Mock).mockResolvedValue(balancesWithCash(98_500));
    db.add(fakeSignal(70));
    const body = await run();
    expect(body.results?.[0].outcome).toBe('cash_insufficient');
    expect(body.results?.[0].detail).toContain('필요 98,592');
    expect(submitOrder).not.toHaveBeenCalled();
    nextTick();
    (getBalancesDetailed as jest.Mock).mockResolvedValue(balancesWithCash(98_592));   // 정확히 필요한 만큼이면 주문
    expect((await run()).results?.[0].outcome).toBe('submitted');
    expect((submitOrder as jest.Mock).mock.calls[0][0]).toMatchObject({ quantity: 15, price: expect.closeTo(6_559.62, 6) });
  });

  test('🔴 시그널에 명시 수량(5주)이 있으면 그 수량으로 계산한다 — 5 × 6,540 × 1.002 = 32,766원', async () => {
    (getBalancesDetailed as jest.Mock).mockResolvedValue(balancesWithCash(40_000));   // 금액 기준 15주(98,297원)였다면 부족
    db.add(fakeSignal(71, { quantity: '5' }));
    expect((await run()).results?.[0].outcome).toBe('submitted');
    expect((submitOrder as jest.Mock).mock.calls[0][0]).toMatchObject({ quantity: 5 });
    db.add(fakeSignal(72, { quantity: '5' }));
    nextTick();
    (getBalancesDetailed as jest.Mock).mockResolvedValue(balancesWithCash(32_765));   // 1원 부족
    const body = await run();
    expect(body.results?.[0]).toMatchObject({ signalId: 72, outcome: 'cash_insufficient' });
    expect(body.results?.[0].detail).toContain('필요 32,766');
  });
});

describe('(i) 알림 창 24시간 — 가짜 시계 (T-051 Reviewer R-1 ②)', () => {
  test('🔴 24시간 안의 다음 틱엔 알림·감사 기록이 없고, 24시간이 지나면 다시 한 번 나간다', async () => {
    let t = Date.UTC(2026, 9, 20, 0, 30);                                // 스로틀·현금 캐시가 읽는 Date.now 만 고정
    jest.spyOn(Date, 'now').mockImplementation(() => t);
    db.add(fakeSignal(80));
    await run();
    expect(cashAlerts()).toHaveLength(1);
    t += 60_000; nextTick(); await run();                               // 1분 뒤
    t += 24 * 60 * 60_000 - 2 * 60_000; nextTick(); await run();        // 첫 알림 23시간 59분 뒤
    expect(cashAlerts()).toHaveLength(1);
    expect(cashLogs()).toHaveLength(1);
    t += 2 * 60_000; nextTick(); await run();                           // 첫 알림 24시간 1분 뒤
    expect(cashAlerts()).toHaveLength(2);
    expect(cashLogs()).toHaveLength(2);
    expect(submitOrder).not.toHaveBeenCalled();
  });
});

describe('(j) 감사 기록 INSERT 만 실패 (T-051 Reviewer R-1 ③)', () => {
  test('🔴 알림은 나가고 INSERT 가 던져도 틱은 계속된다(다음 시그널 처리, 건너뛰기 유지)', async () => {
    db.failOn = [/INSERT INTO trade_logs/];
    db.add(fakeSignal(90));
    db.add(fakeSignal(91, { side: 'sell' }));
    const body = await run();
    expect(cashAlerts()).toHaveLength(1);                               // sendAlert 는 정상 — INSERT 까지 도달한다
    expect(sqlLog.some((q) => /INSERT INTO trade_logs/.test(q.sql) && q.params[1] === 'entry_cash_insufficient')).toBe(true);
    expect(body.results?.map((r) => [r.signalId, r.outcome])).toEqual([[90, 'cash_insufficient'], [91, 'submitted']]);
    expect(db.statusOf(90)).toBe('approved_pending_entry');
  });
});

describe('(k) 잔고 조회 시간 상한 8초 (T-051 Reviewer R-2)', () => {
  afterEach(() => jest.useRealTimers());

  test('🔴 조회가 8초를 넘기면 판단불가 → 기존 경로(선점·submitOrder), 틱은 그 이상 기다리지 않는다', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    (getBalancesDetailed as jest.Mock).mockImplementation(() => new Promise(() => {}));   // 응답이 오지 않는 해외·환율 조회 모사
    db.add(fakeSignal(100));
    const pending = run();
    await jest.advanceTimersByTimeAsync(7_999);
    expect(submitOrder).not.toHaveBeenCalled();                         // 상한 전에는 기다린다
    await jest.advanceTimersByTimeAsync(1);
    const body = await pending;
    expect(body.results?.[0].outcome).toBe('submitted');
    expect(claims()).toEqual(['claim:100:won']);
    expect(cashAlerts()).toHaveLength(0);
  });

  test('🔴 같은 틱에 구간 내 국내 매수 3개 + 멈춘 잔고 → 틱 전체가 상한 한 번(8초) 안에 끝나고 3개 모두 기존 경로 (라운드 3)', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    (getBalancesDetailed as jest.Mock).mockImplementation(() => new Promise(() => {}));
    db.add(fakeSignal(101)); db.add(fakeSignal(102)); db.add(fakeSignal(103));
    let done = false;
    const pending = run().then((b) => { done = true; return b; });
    await jest.advanceTimersByTimeAsync(8_000);                          // 시그널마다 8초씩이면 24초가 필요하다
    expect(done).toBe(true);
    const body = await pending;
    expect(body.results?.map((r) => [r.signalId, r.outcome])).toEqual([[101, 'submitted'], [102, 'submitted'], [103, 'submitted']]);
    expect(submitOrder).toHaveBeenCalledTimes(3);
    expect(getBalancesDetailed).toHaveBeenCalledTimes(1);
  });
});

describe('(l) 비정상 free 는 현금 0원이 아니라 판단불가 (라운드 3, Codex C2)', () => {
  test.each([['빈 문자열', ''], ['null', null]])('🔴 free=%s → 막지 않고 submitOrder, 같은 틱 다음 시그널도 0원 캐시에 막히지 않음', async (_n, free) => {
    (getBalancesDetailed as jest.Mock).mockResolvedValue(balancesWithCash(free as unknown as number));
    db.add(fakeSignal(110)); db.add(fakeSignal(111));
    const body = await run();
    expect(body.results?.map((r) => r.outcome)).toEqual(['submitted', 'submitted']);
    expect(submitOrder).toHaveBeenCalledTimes(2);
    expect(cashAlerts()).toHaveLength(0);
  });

  test("진짜 0(문자열 '0')은 유효한 현금 0원 → 건너뜀", async () => {
    (getBalancesDetailed as jest.Mock).mockResolvedValue(balancesWithCash('0' as unknown as number));
    db.add(fakeSignal(112));
    expect((await run()).results?.[0].outcome).toBe('cash_insufficient');
    expect(submitOrder).not.toHaveBeenCalled();
  });
});

describe('(g) 기존 분기가 점검보다 먼저다', () => {
  test('수량 0(sizing_below_min_qty)은 그대로 quantity_below_min, 잔고 조회 없음', async () => {
    db.add(fakeSignal(60, { price: '200000', amount_krw: '100000' }));   // 1주 20만 원 > 10만 원
    (kis.getTicker as jest.Mock).mockResolvedValue({ price: 200_000 });
    const body = await run();
    expect(body.results?.[0].outcome).toBe('quantity_below_min');
    expect(getBalancesDetailed).not.toHaveBeenCalled();
  });

  test('구간 밖은 out_of_zone, 잔고 조회 없음', async () => {
    db.add(fakeSignal(61, { indicators: JSON.stringify({ ai: { scenario: { entry: { price_zone: '1 ~ 10' } } } }) }));
    const body = await run();
    expect(body.results?.[0].outcome).toBe('out_of_zone');
    expect(getBalancesDetailed).not.toHaveBeenCalled();
  });

  test('분할 2회차가 1회차를 기다리는 중이면 blocked_by_prior_split, 잔고 조회 없음', async () => {
    const zone = { price_zone: '1 ~ 99999999' };
    db.add(fakeSignal(62, { indicators: JSON.stringify({ ai: { scenario: { entry: zone } }, split: { group_id: 'g', index: 1, total: 2 } }), price: '200000' }));
    db.add(fakeSignal(63, { indicators: JSON.stringify({ ai: { scenario: { entry: zone } }, split: { group_id: 'g', index: 2, total: 2 } }) }));
    (getBalancesDetailed as jest.Mock).mockResolvedValue(balancesWithCash(0));
    const body = await run();
    // 62 는 수량 0(20만 원 > 10만 원)이라 대기 상태로 남고, 63 은 그 뒤에서 막힌다
    expect(body.results?.map((r) => [r.signalId, r.outcome])).toEqual([[62, 'quantity_below_min'], [63, 'blocked_by_prior_split']]);
    expect(getBalancesDetailed).not.toHaveBeenCalled();
  });
});
