/**
 * T-072 G5 — entry-watcher × 검증 상태 관문.
 *
 * 지킬 것 (설계 F-2·F-8, Stage 0 C 의 G5 필수 사유, WP-2b 지시 5·8):
 *  1. 🔴 매수 행은 시세 조회·T-051 현금 점검·T-043 선점·submitOrder **전에** 그 행의 strategy_id 로 판정한다.
 *     결정적 차단(귀속 없음·미등록·미검증·상태 이상) → 선점 0 · submitOrder 0 · 시세 0 · 잔고 0 · setPositionScenarioExit 0 · 알림 0,
 *     행은 조건부 UPDATE 로 `superseded` 종결 + trade_logs `signal_validation_gate`(행당 1회). 다음 틱엔 행이 없어 아무 일도 없다
 *     (submitOrder 에 맡기면 선점 복귀 → 매 분 재선점·blocked 주문·스로틀 없는 경고 — 그 실패 모드가 없음을 고정).
 *  2. 조회 실패(일시 장애)는 막되 종결하지 않는다 — 행 유지, 기록·알림 없음, 다음 틱 재판정.
 *  3. 조건부 UPDATE: 다른 실행이 방금 선점한 행(executing)을 덮어쓰지 않고, 그때는 trade_logs 도 남기지 않는다.
 *  4. 🔴 매도 행은 관문이 strategies 조회 없이 통과시킨다 — 전략이 없거나 미등록이어도 기존대로 선점·주문.
 *     WP-2c R-1: 판정은 관문 함수 첫 줄에만 있다(라우트의 `=== 'buy'` 지역 분기 제거). 'BUY' 같은 변형 행도 매수로 판정.
 *  5. 통과한 매수는 submitOrder 에 그 행의 전략 귀속을 넘긴다(G6).
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
jest.mock('@/lib/notify/throttle', () => ({ sendAlertThrottled: jest.fn(() => true), resetAlertThrottle: jest.fn() }));
// 관문은 **실제 구현**을 쓴다 — 호출 여부만 보려고 감싼다(매도 경로에서 호출 0 을 단언).
jest.mock('@/lib/safety/validation-gate', () => {
  const actual = jest.requireActual('@/lib/safety/validation-gate');
  return { ...actual, evaluateValidationGate: jest.fn(actual.evaluateValidationGate) };
});

import { NextRequest } from 'next/server';
import { POST } from '../route';
import { getPool } from '@/lib/db';
import { getBalancesDetailed, kis } from '@/lib/exchanges/kis';
import { submitOrder } from '@/lib/safety/dry-run';
import { evaluateValidationGate } from '@/lib/safety/validation-gate';
import { setPositionScenarioExit } from '@/lib/strategy/position-state';
import { sendAlert } from '@/lib/notify';
import { sendAlertThrottled } from '@/lib/notify/throttle';
import { resetEntryCashCache } from '@/lib/signals/entry-cash-precheck';
import { FakeSignalsDb, VALIDATED_STRATEGY, fakeSignal } from './fakeSignalsDb';

let db: FakeSignalsDb;
type Result = { signalId: number; outcome: string; detail?: string };
const req = () => new NextRequest('http://localhost:3003/api/cron/entry-watcher', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
const run = async () => (await POST(req())).json() as Promise<{ results?: Result[] }>;
const strategyLookups = () => db.events.filter((e) => e.startsWith('strategy:'));
const claims = () => db.events.filter((e) => e.startsWith('claim:'));
const gateLogs = () => db.tradeLogs.filter((l) => l.event === 'signal_validation_gate');

beforeEach(() => {
  jest.clearAllMocks();
  resetEntryCashCache();
  for (const m of ['log', 'warn', 'error'] as const) jest.spyOn(console, m).mockImplementation(() => {});
  (kis.getTicker as jest.Mock).mockResolvedValue({ price: 6_540 });
  (getBalancesDetailed as jest.Mock).mockResolvedValue({
    balances: [{ currency: 'KRW', free: 100_000_000, used: 0, total: 100_000_000 }], ok: ['domestic'], failed: [], complete: true,
  });
  (submitOrder as jest.Mock).mockResolvedValue({ ok: true, orderId: 77 });
  db = new FakeSignalsDb();
  db.strategies['rsi-oversold-v1'] = 'unvalidated';
  db.strategies['weird-v1'] = 'BACKTESTED';
  (getPool as jest.Mock).mockReturnValue(db.pool);
});
afterEach(() => jest.restoreAllMocks());

function expectNothingDownstream() {
  expect(claims()).toEqual([]);                                     // 🔴 선점 0
  expect(submitOrder).not.toHaveBeenCalled();                       // 🔴 주문 0
  expect(kis.getTicker).not.toHaveBeenCalled();                     // 시세 조회 0 (관문이 그 앞)
  expect(getBalancesDetailed).not.toHaveBeenCalled();               // T-051 현금 점검 0 (관문이 그 앞)
  expect(setPositionScenarioExit).not.toHaveBeenCalled();           // 포지션 기록 0
  expect(sendAlert).not.toHaveBeenCalled();                         // 알림 0 (스로틀 없는 경고 반복 금지)
  expect(sendAlertThrottled).not.toHaveBeenCalled();
}

describe('1. 🔴 결정적 차단 — 선점·주문 전에 끝내고 superseded 로 종결', () => {
  test.each([
    ['전략 귀속 없음(custom/confirm 행)', null, 'null_strategy'],
    ['미등록(oversold-bounce-v1)', 'oversold-bounce-v1', 'unregistered'],
    ['unvalidated', 'rsi-oversold-v1', 'unvalidated'],
    ['상태값 이상', 'weird-v1', 'invalid_status'],
  ])('%s → validation_blocked · superseded · trade_logs 1 · 하류 0', async (_n, sid, reason) => {
    db.add(fakeSignal(1, { strategy_id: sid }));
    const body = await run();
    expect(body.results).toEqual([{ signalId: 1, symbol: '005930', outcome: 'validation_blocked', detail: `${reason} → superseded` }]);
    expect(db.statusOf(1)).toBe('superseded');
    expectNothingDownstream();
    expect(gateLogs()).toEqual([{
      event: 'signal_validation_gate',
      payload: { where: 'entry-watcher', signalId: 1, strategyId: sid, symbol: '005930', side: 'buy', reason },
    }]);
  });

  test('🔴 다음 틱: 행이 종결돼 다시 보지 않는다 — 재판정·기록·알림·주문 0 (매 분 반복 없음)', async () => {
    db.add(fakeSignal(2, { strategy_id: null }));
    await run();
    jest.clearAllMocks();
    db.events = [];
    const second = await run();
    expect(second.results ?? []).toEqual([]);
    expect(strategyLookups()).toEqual([]);
    expect(gateLogs()).toHaveLength(1);                              // 첫 틱의 1건 그대로
    expectNothingDownstream();
  });

  test('막힌 행이 있어도 같은 틱의 다음(검증된) 시그널은 그대로 주문한다', async () => {
    db.add(fakeSignal(3, { strategy_id: null }));
    db.add(fakeSignal(4));
    const body = await run();
    expect(body.results?.map((r) => [r.signalId, r.outcome])).toEqual([[3, 'validation_blocked'], [4, 'submitted']]);
    expect(submitOrder).toHaveBeenCalledTimes(1);
    expect(claims()).toEqual(['claim:4:won']);
  });

  test('회차 요약 로그에 validation_blocked 건수', async () => {
    db.add(fakeSignal(5, { strategy_id: null }));
    await run();
    expect((console.log as jest.Mock).mock.calls.flat().join(' ')).toContain('validation_blocked=1');
  });
});

describe('2. 조회 실패(일시 장애) — 막되 종결하지 않는다', () => {
  test('ER_BAD_FIELD_ERROR(마이그레이션 전) → validation_blocked(lookup_error), 행 유지, 기록·알림·선점·주문 0, 다음 틱 재판정', async () => {
    db.strategies['boom-v1'] = Object.assign(new Error("Unknown column 'validation_status'"), { code: 'ER_BAD_FIELD_ERROR' });
    db.add(fakeSignal(6, { strategy_id: 'boom-v1' }));
    const body = await run();
    expect(body.results?.[0]).toMatchObject({ signalId: 6, outcome: 'validation_blocked' });
    expect(body.results?.[0].detail).toMatch(/^lookup_error — 행 유지/);
    expect(db.statusOf(6)).toBe('approved_pending_entry');
    expect(db.events.some((e) => e.startsWith('supersede'))).toBe(false);
    expect(gateLogs()).toHaveLength(0);
    expectNothingDownstream();
    await run();                                                     // 다음 틱 — 다시 판정한다(종결하지 않았으므로)
    expect(strategyLookups()).toEqual(['strategy:boom-v1', 'strategy:boom-v1']);
    expect(submitOrder).not.toHaveBeenCalled();
  });
});

describe('3. 조건부 UPDATE — 다른 실행이 방금 가져간 행을 덮지 않는다', () => {
  test('조회 스냅숏은 대기지만 실제 행은 이미 executing → supersede-noop, trade_logs 0, 상태 그대로, 주문 0', async () => {
    db.add(fakeSignal(7, { strategy_id: null }));
    const snap = [{ ...db.rows.get(7)! }];
    db.selectHook = () => snap.map((r) => ({ ...r }));
    db.rows.get(7)!.status = 'executing';
    const body = await run();
    expect(body.results?.[0]).toMatchObject({ signalId: 7, outcome: 'validation_blocked', detail: 'null_strategy — 종결 대상 아님' });
    expect(db.statusOf(7)).toBe('executing');
    expect(db.events).toContain('supersede-noop:7');
    expect(gateLogs()).toHaveLength(0);
    expectNothingDownstream();
  });

  test('종결 UPDATE 가 DB 오류여도 선점·주문 0, 던지지 않음(다음 틱 재판정)', async () => {
    db.add(fakeSignal(8, { strategy_id: null }));
    db.failOn = [/^UPDATE signals SET status='superseded'/];
    const body = await run();
    expect(body.results?.[0]).toMatchObject({ signalId: 8, outcome: 'validation_blocked' });
    expect(db.statusOf(8)).toBe('approved_pending_entry');
    expect(gateLogs()).toHaveLength(0);
    expectNothingDownstream();
  });
});

describe('4. 🔴 매도 행은 관문이 조회 없이 통과시킨다 (보호 청산)', () => {
  test.each([
    ['전략 없음(custom/confirm 매도)', null],
    ['미등록 exit-engine-v1', 'exit-engine-v1'],
    ['미검증', 'rsi-oversold-v1'],
  ])('%s 매도 → 관문 not_applicable · strategies 조회 0 · 기존대로 선점 → 주문', async (_n, sid) => {
    db.add(fakeSignal(9, { side: 'sell', strategy_id: sid }));
    const body = await run();
    expect(evaluateValidationGate).toHaveBeenCalledWith({ side: 'sell', strategyId: sid });
    await expect((evaluateValidationGate as jest.Mock).mock.results[0].value).resolves.toEqual({ allowed: true, kind: 'not_applicable' });
    expect(strategyLookups()).toEqual([]);
    expect(body.results?.[0]).toMatchObject({ signalId: 9, outcome: 'submitted' });
    expect(claims()).toEqual(['claim:9:won']);
    expect(submitOrder).toHaveBeenCalledTimes(1);
  });

  test('대조: 같은 조건의 매수는 관문을 부르고 막힌다', async () => {
    db.add(fakeSignal(10, { side: 'buy', strategy_id: 'exit-engine-v1' }));
    await run();
    expect(evaluateValidationGate).toHaveBeenCalledTimes(1);
    expect(submitOrder).not.toHaveBeenCalled();
  });
});

describe('4b. 🔴 WP-2c R-1 — 변형된 side 행', () => {
  test.each([['BUY'], ['Buy'], ['buy ']])("side=%p 행 → 매수로 판정: 선점·주문 0, superseded", async (side) => {
    db.add(fakeSignal(13, { side: side as 'buy', strategy_id: null }));
    const body = await run();
    expect(body.results?.[0]).toMatchObject({ signalId: 13, outcome: 'validation_blocked', detail: 'null_strategy → superseded' });
    expectNothingDownstream();
    expect(gateLogs()[0].payload).toMatchObject({ side: 'buy', reason: 'null_strategy' });
  });
  test("대문자 매도 'SELL' 행은 매도로 보호 — 조회 0 · 선점 → 주문", async () => {
    db.add(fakeSignal(14, { side: 'SELL' as 'sell', strategy_id: null }));
    const body = await run();
    expect(strategyLookups()).toEqual([]);
    expect(body.results?.[0]).toMatchObject({ signalId: 14, outcome: 'submitted' });
  });
});

describe('5. 통과한 매수 → submitOrder 에 그 행의 전략 귀속(G6)', () => {
  test('검증된 전략 → 관문 → 선점 → 주문, attribution = {strategy, 행 전략, 행 id}', async () => {
    db.add(fakeSignal(11));
    const body = await run();
    expect(body.results?.[0]).toMatchObject({ signalId: 11, outcome: 'submitted' });
    expect(db.events.filter((e) => e.startsWith('strategy:') || e.startsWith('claim:'))).toEqual([`strategy:${VALIDATED_STRATEGY}`, 'claim:11:won']);
    expect((submitOrder as jest.Mock).mock.calls[0][2]).toMatchObject({
      attribution: { kind: 'strategy', strategyId: VALIDATED_STRATEGY, signalId: 11 },
    });
  });

  test('매도도 귀속을 넘긴다(전략 없음은 null) — G6 판정은 매도에 I/O 0', async () => {
    db.add(fakeSignal(12, { side: 'sell', strategy_id: null }));
    await run();
    expect((submitOrder as jest.Mock).mock.calls[0][2]).toMatchObject({ attribution: { kind: 'strategy', strategyId: null, signalId: 12 } });
  });
});
