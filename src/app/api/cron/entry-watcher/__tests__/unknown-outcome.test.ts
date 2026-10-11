/**
 * T-042 (2라운드 감사 — 같은 결함 계열) — **결과 불명 주문은 다음 틱에 다시 내지 않는다.**
 *
 * `entry-watcher` 는 1분마다 돈다. 주문이 실패(`ok:false`)하면 시그널을 `approved_pending_entry` 로 두고 다음 틱에
 * 다시 시도하는데, 실패가 "거래소가 접수했는지 알 수 없는" 종류(송신 중 예외·5xx·연결 끊김)이면 **1분마다 같은 주문이
 * 반복돼 이중 주문**이 된다. `submitOrder` 가 붙이는 `outcomeUnknown` 으로 이를 구분해 시그널을 잠근다.
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

const ZONE = { ai: { scenario: { entry: { price_zone: '1 ~ 99999999' } } } };
const row = (id: number) => ({
  id, symbol: '005930', side: 'buy', order_type: 'limit', price: '6540', quantity: null, amount_krw: '100000',
  market: 'domestic', indicators: JSON.stringify(ZONE), reasoning: null, expires_at: null,
});

let updates: Array<{ sql: string; params: unknown[] }>;
function setupPool(rows: unknown[]) {
  updates = [];
  (getPool as jest.Mock).mockReturnValue({
    query: jest.fn(async (sqlArg: unknown, params: unknown[] = []) => {
      const sql = String(sqlArg);
      if (/UPDATE signals/i.test(sql)) { updates.push({ sql: sql.replace(/\s+/g, ' '), params }); return [{ affectedRows: 1 }]; }
      if (/FROM signals/i.test(sql)) return [rows];
      return [[]];
    }),
  });
}
const req = () => new NextRequest('http://localhost:3003/api/cron/entry-watcher', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
const run = async () => (await POST(req())).json() as Promise<{ results?: Array<{ outcome: string; detail?: string }> }>;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  (kis.getTicker as jest.Mock).mockResolvedValue({ price: 6_540 });
});
afterEach(() => jest.restoreAllMocks());

describe('entry-watcher — 결과 불명 주문', () => {
  test('🔴 outcomeUnknown 이면 시그널을 executing 으로 잠가 다음 틱의 재주문을 막는다 (+ critical 알림)', async () => {
    (submitOrder as jest.Mock).mockResolvedValue({ ok: false, orderId: 77, error: 'fetch failed (ECONNRESET)', outcomeUnknown: true });
    setupPool([row(5)]);
    const body = await run();
    const lock = updates.find((u) => /status='executing'/.test(u.sql));
    expect(lock).toBeDefined();
    expect(lock!.sql).toMatch(/WHERE id=\? AND status='approved_pending_entry'/);      // 조건부 — 다른 쪽이 바꾼 행은 덮어쓰지 않는다
    expect(lock!.params).toEqual([77, 5]);                                              // 확인용으로 주문 ID 를 남긴다
    expect(body.results?.[0].outcome).toBe('order_uncertain');
    const alert = (sendAlert as jest.Mock).mock.calls[0];
    expect(alert[0]).toBe('critical');
    expect(String(alert[1])).toContain('결과 불명');
  });

  test('🔴 확정 거부(outcomeUnknown 없음)는 기존대로 approved_pending_entry 를 유지해 다음 틱에 다시 시도한다 (가격·잔고가 바뀔 수 있다)', async () => {
    (submitOrder as jest.Mock).mockResolvedValue({ ok: false, orderId: 78, blockedBy: 'order_limit', error: 'x' });
    setupPool([row(6)]);
    const body = await run();
    expect(updates.some((u) => /status='executing'/.test(u.sql))).toBe(false);
    expect(body.results?.[0].outcome).toBe('order_failed');
    expect(sendAlert).not.toHaveBeenCalled();
  });

  test('성공은 기존대로 executing + consumed_order_id', async () => {
    (submitOrder as jest.Mock).mockResolvedValue({ ok: true, orderId: 79 });
    setupPool([row(7)]);
    const body = await run();
    expect(updates.find((u) => /status='executing'/.test(u.sql))?.params).toEqual([79, 7]);
    expect(body.results?.[0].outcome).toBe('submitted');
  });

  test('알림 본문의 사유는 이스케이프된다', async () => {
    (submitOrder as jest.Mock).mockResolvedValue({ ok: false, orderId: 80, error: 'bad <gateway> & more', outcomeUnknown: true });
    setupPool([row(8)]);
    await run();
    expect(String((sendAlert as jest.Mock).mock.calls[0][2])).toContain('bad &lt;gateway&gt; &amp; more');
  });
});

// ── 3라운드 감사 R3-1 재현 (이 블록은 수정 전에 실패해야 한다) ──────────────────────────────────────────────
describe('R3-1 — 잠금/기록 UPDATE 자체가 실패해도 재주문하지 않고 경보한다', () => {
  function setupPoolWithFailingUpdate(rows: unknown[]) {
    (getPool as jest.Mock).mockReturnValue({
      query: jest.fn(async (sqlArg: unknown) => {
        const sql = String(sqlArg);
        if (/UPDATE signals/i.test(sql)) throw new Error('db gone');
        if (/FROM signals/i.test(sql)) return [rows];
        return [[]];
      }),
    });
  }

  test('🔴 결과 불명 + 잠금 UPDATE 실패 → critical 경보는 나가고, 같은 시그널을 다음 틱에 다시 제출하지 않는다', async () => {
    (submitOrder as jest.Mock).mockResolvedValue({ ok: false, orderId: 91, error: 'fetch failed', outcomeUnknown: true });
    setupPoolWithFailingUpdate([row(31)]);
    const first = await run();
    expect(first.results?.[0].outcome).toBe('order_uncertain');            // order_failed 로 떨어지지 않는다
    expect((sendAlert as jest.Mock).mock.calls.some((c) => c[0] === 'critical')).toBe(true);
    const second = await run();                                            // 1분 뒤 다음 틱
    expect(submitOrder).toHaveBeenCalledTimes(1);                          // 🔴 두 번째 틱에 같은 주문을 다시 내지 않는다
    expect(second.results?.[0].outcome).toBe('order_uncertain');
  });

  test('🔴 접수 확정 + executing 기록 UPDATE 실패 → 재주문하지 않고 critical 경보', async () => {
    (submitOrder as jest.Mock).mockResolvedValue({ ok: true, orderId: 92 });
    setupPoolWithFailingUpdate([row(32)]);
    const first = await run();
    expect(first.results?.[0].outcome).toBe('submitted');                  // 주문은 접수됐다 — 거짓으로 order_failed 라고 하지 않는다
    expect((sendAlert as jest.Mock).mock.calls.some((c) => c[0] === 'critical')).toBe(true);
    await run();
    expect(submitOrder).toHaveBeenCalledTimes(1);
  });
});
