/**
 * T-042 + T-043 — **결과별로 시그널이 어떤 상태로 끝나는가**, 그리고 다음 틱에 같은 주문이 다시 나가는가.
 *
 * 시그널은 주문 직전에 `executing` 으로 선점된다(T-043). 그 뒤:
 *  - 성공·결과 불명 → `executing` 유지(+주문 번호). 다음 틱의 조회에 잡히지 않아 재주문이 없다.
 *  - 확정 거부 → `approved_pending_entry` 로 복귀, 다음 틱에 다시 시도(가격·잔고가 바뀔 수 있다).
 * 상태를 가진 가짜 DB(`fakeSignalsDb`)로 "행의 실제 상태"와 "다음 틱의 submitOrder 호출 수"를 본다.
 */
jest.mock('@/lib/cron-auth', () => ({ checkCronAuth: jest.fn(() => null) }));
jest.mock('@/lib/strategy/market-hours', () => ({
  isDomesticOpen: jest.fn(async () => true),
  isOverseasOpen: jest.fn(async () => true),
}));
jest.mock('@/lib/db', () => ({ getPool: jest.fn(), getAccountId: jest.fn(async () => 1) }));
jest.mock('@/lib/exchanges/kis', () => ({ kis: { getTicker: jest.fn(), createOrder: jest.fn() } }));
jest.mock('@/lib/safety/dry-run', () => ({ submitOrder: jest.fn() }));
jest.mock('@/lib/strategy/style', () => ({ getStyleConfig: jest.fn(async () => ({ limitChasePct: 0 })) }));
jest.mock('@/lib/strategy/position-state', () => ({ setPositionScenarioExit: jest.fn(async () => undefined) }));
jest.mock('@/lib/notify', () => ({ sendAlert: jest.fn(), getSymbolLabel: jest.fn(async (s: string) => s) }));
jest.mock('@/lib/notify/throttle', () => ({ sendAlertThrottled: jest.fn(() => true), resetAlertThrottle: jest.fn() }));

import { NextRequest } from 'next/server';
import { POST } from '../route';
import { getPool } from '@/lib/db';
import { kis } from '@/lib/exchanges/kis';
import { submitOrder } from '@/lib/safety/dry-run';
import { sendAlert } from '@/lib/notify';
import { FakeSignalsDb, fakeSignal } from './fakeSignalsDb';

let db: FakeSignalsDb;
const req = () => new NextRequest('http://localhost:3003/api/cron/entry-watcher', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
const run = async () => (await POST(req())).json() as Promise<{ results?: Array<{ outcome: string; detail?: string }> }>;
const alerts = () => (sendAlert as jest.Mock).mock.calls as Array<[string, string, string]>;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  (kis.getTicker as jest.Mock).mockResolvedValue({ price: 6_540 });
  db = new FakeSignalsDb();
  (getPool as jest.Mock).mockReturnValue(db.pool);
});
afterEach(() => jest.restoreAllMocks());

describe('결과 불명 주문 (T-042/T-043)', () => {
  test('🔴 outcomeUnknown → 시그널은 executing 으로 남고(선점 유지) 주문 번호가 연결되며 critical 경보가 나간다', async () => {
    (submitOrder as jest.Mock).mockResolvedValue({ ok: false, orderId: 77, error: 'fetch failed (ECONNRESET)', outcomeUnknown: true });
    db.add(fakeSignal(5));
    const body = await run();
    expect(body.results?.[0].outcome).toBe('order_uncertain');
    expect(db.statusOf(5)).toBe('executing');
    expect(db.orderOf(5)).toBe(77);
    expect(db.events).not.toContain('release:5:ok');
    expect(alerts()[0][0]).toBe('critical');
    expect(alerts()[0][1]).toContain('결과 불명');
  });

  test('🔴 결과 불명 뒤 다음 틱에는 같은 주문을 다시 내지 않는다 (잠금이 DB 상태라서 재기동·다른 인스턴스에도 유효)', async () => {
    (submitOrder as jest.Mock).mockResolvedValue({ ok: false, orderId: 77, error: 'x', outcomeUnknown: true });
    db.add(fakeSignal(5));
    await run();
    await run();
    await run();
    expect(submitOrder).toHaveBeenCalledTimes(1);
  });

  test('🔴 결과 불명 + 주문 번호 기록 UPDATE 실패 → 여전히 executing, 재주문 없음, 경보 본문에 안내', async () => {
    (submitOrder as jest.Mock).mockResolvedValue({ ok: false, orderId: 78, error: 'x', outcomeUnknown: true });
    db.add(fakeSignal(6));
    db.failOn = [/^UPDATE signals SET consumed_order_id=/];
    const body = await run();
    expect(body.results?.[0].outcome).toBe('order_uncertain');
    expect(db.statusOf(6)).toBe('executing');
    expect(alerts().some((a) => a[0] === 'critical' && a[2].includes('consumed_order_id'))).toBe(true);
    db.failOn = [];
    await run();
    expect(submitOrder).toHaveBeenCalledTimes(1);
  });

  test('알림 본문의 사유는 이스케이프된다', async () => {
    (submitOrder as jest.Mock).mockResolvedValue({ ok: false, orderId: 80, error: 'bad <gateway> & more', outcomeUnknown: true });
    db.add(fakeSignal(8));
    await run();
    expect(alerts()[0][2]).toContain('bad &lt;gateway&gt; &amp; more');
  });
});

describe('확정 거부', () => {
  test('🔴 outcomeUnknown 이 없는 거부는 선점을 되돌려 approved_pending_entry 로 두고 다음 틱에 다시 시도한다', async () => {
    (submitOrder as jest.Mock)
      .mockResolvedValueOnce({ ok: false, orderId: 78, blockedBy: 'order_limit', error: 'x' })
      .mockResolvedValueOnce({ ok: true, orderId: 79 });
    db.add(fakeSignal(6));
    const first = await run();
    expect(first.results?.[0].outcome).toBe('order_failed');
    expect(db.statusOf(6)).toBe('approved_pending_entry');            // 되돌려졌다
    expect(db.events).toContain('release:6:ok');
    expect(sendAlert).not.toHaveBeenCalled();                          // 확정 거부는 경보 대상이 아니다(기존과 동일)
    const second = await run();                                        // 1분 뒤 — 다시 시도해 성공
    expect(second.results?.[0].outcome).toBe('submitted');
    expect(submitOrder).toHaveBeenCalledTimes(2);
    expect(db.statusOf(6)).toBe('executing');
    expect(db.orderOf(6)).toBe(79);
  });
});

describe('성공', () => {
  test('성공은 executing 으로 남고 주문 번호가 연결된다 — 다음 틱 재주문 없음', async () => {
    (submitOrder as jest.Mock).mockResolvedValue({ ok: true, orderId: 79 });
    db.add(fakeSignal(7));
    const body = await run();
    expect(body.results?.[0].outcome).toBe('submitted');
    expect(db.statusOf(7)).toBe('executing');
    expect(db.orderOf(7)).toBe(79);
    await run();
    expect(submitOrder).toHaveBeenCalledTimes(1);
  });

  test('🔴 성공 + 주문 번호 기록 UPDATE 실패 → 주문은 접수된 것으로 처리(submitted), executing 유지, 재주문 없음, warning 경보', async () => {
    (submitOrder as jest.Mock).mockResolvedValue({ ok: true, orderId: 92 });
    db.add(fakeSignal(32));
    db.failOn = [/^UPDATE signals SET consumed_order_id=/];
    const first = await run();
    expect(first.results?.[0].outcome).toBe('submitted');              // 거짓으로 order_failed 라고 하지 않는다
    expect(db.statusOf(32)).toBe('executing');
    expect(alerts().some((a) => a[0] === 'warning' && a[1].includes('주문 번호 기록 실패'))).toBe(true);
    db.failOn = [];
    await run();
    expect(submitOrder).toHaveBeenCalledTimes(1);
  });
});
