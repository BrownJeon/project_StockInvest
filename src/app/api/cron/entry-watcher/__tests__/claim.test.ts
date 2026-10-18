/**
 * T-043 — entry-watcher **주문 전 조건부 선점**.
 *
 * 결함: 조회(SELECT)와 주문(submitOrder) 사이에 선점이 없어, 같은 시그널을 보는 실행이 둘이면(cron 앱 2개·수동 호출·배포 중
 * 끊김 후 새 인스턴스) 둘 다 실주문을 냈다. 지킬 것:
 *  (1) 선점은 submitOrder **앞**이다 (2) 두 실행이 같은 시그널을 동시에 보면 주문은 한 번이다 (3) 선점하지 못하면(경합·만료·DB 오류)
 *  주문하지 않는다 (4) 송신 전 예외·확정 거부만 선점을 되돌린다 (5) **주문 결과를 받은 뒤의 후처리 예외는 선점을 되돌리지 않는다**
 *  (6) 구간 미도달·수량 0·분할 대기 시그널은 선점하지 않는다.
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
import { getSymbolLabel, sendAlert } from '@/lib/notify';
import { sendAlertThrottled } from '@/lib/notify/throttle';
import { isDomesticOpen, isOverseasOpen } from '@/lib/strategy/market-hours';
import { FakeSignalsDb, fakeSignal } from './fakeSignalsDb';

let db: FakeSignalsDb;
type Result = { signalId: number; outcome: string; detail?: string };
const req = () => new NextRequest('http://localhost:3003/api/cron/entry-watcher', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
const run = async () => (await POST(req())).json() as Promise<{ results?: Result[] }>;
const alerts = () => (sendAlert as jest.Mock).mock.calls as Array<[string, string, string]>;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  (kis.getTicker as jest.Mock).mockResolvedValue({ price: 6_540 });
  (getSymbolLabel as jest.Mock).mockReset().mockImplementation(async (sym: string) => sym);
  db = new FakeSignalsDb();
  (getPool as jest.Mock).mockReturnValue(db.pool);
});
afterEach(() => jest.restoreAllMocks());

describe('선점 순서', () => {
  test('🔴 선점(claim)이 submitOrder 보다 먼저, 주문 번호 기록이 그 뒤다', async () => {
    (submitOrder as jest.Mock).mockImplementation(async () => { db.events.push('submit'); return { ok: true, orderId: 11 }; });
    db.add(fakeSignal(1));
    await run();
    expect(db.events.filter((e) => e !== 'select' && e !== 'stuck-check')).toEqual(['claim:1:won', 'submit', 'record:1:11']);
  });
});

describe('경합 — 같은 시그널을 두 실행이 본다', () => {
  test('🔴 두 실행이 동시에 같은 시그널을 조회해도 submitOrder 는 한 번이고 진 쪽은 claim_lost', async () => {
    // 둘 다 같은 스냅샷(아직 approved_pending_entry)을 받는다 — cron 앱 2개·수동 호출·배포 중 끊김 후 새 인스턴스를 모사
    db.add(fakeSignal(2));
    const snapshot = [{ ...db.rows.get(2)! }];
    db.selectHook = () => snapshot.map((r) => ({ ...r }));
    (submitOrder as jest.Mock).mockImplementation(async () => { db.events.push('submit'); return { ok: true, orderId: 22 }; });

    const [a, b] = await Promise.all([run(), run()]);

    expect(submitOrder).toHaveBeenCalledTimes(1);                      // 🔴 선점이 없으면 2회
    const outcomes = [a.results?.[0].outcome, b.results?.[0].outcome].sort();
    expect(outcomes).toEqual(['claim_lost', 'submitted']);
    expect(db.events.filter((e) => e.startsWith('claim:2'))).toHaveLength(2);
    expect(db.statusOf(2)).toBe('executing');
  });

  test('🔴 진 쪽이 주문 중간(느린 submitOrder)에 끼어들어도 주문은 한 번이다', async () => {
    db.add(fakeSignal(3));
    const snapshot = [{ ...db.rows.get(3)! }];
    db.selectHook = () => snapshot.map((r) => ({ ...r }));
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    (submitOrder as jest.Mock).mockImplementation(async () => { await gate; return { ok: true, orderId: 33 }; });

    const first = run();                                               // 선점하고 submitOrder 에서 대기
    await new Promise((r) => setTimeout(r, 20));
    const second = await run();                                        // 느린 주문 중에 두 번째 틱(스냅샷은 아직 옛 상태)
    expect(second.results?.[0].outcome).toBe('claim_lost');
    release();
    expect((await first).results?.[0].outcome).toBe('submitted');
    expect(submitOrder).toHaveBeenCalledTimes(1);
  });

  test('한 시그널이 선점에 져도 같은 틱의 다음 시그널은 계속 처리한다', async () => {
    db.add(fakeSignal(4)); db.add(fakeSignal(5));
    const snap = [db.rows.get(4)!, db.rows.get(5)!].map((r) => ({ ...r }));
    db.selectHook = () => snap.map((r) => ({ ...r }));
    db.rows.get(4)!.status = 'executing';                              // 4 는 이미 다른 실행이 가져갔다
    (submitOrder as jest.Mock).mockResolvedValue({ ok: true, orderId: 44 });
    const body = await run();
    expect(body.results?.map((r) => [r.signalId, r.outcome])).toEqual([[4, 'claim_lost'], [5, 'submitted']]);
    expect(submitOrder).toHaveBeenCalledTimes(1);
  });
});

describe('선점하지 못하면 주문하지 않는다', () => {
  test('🔴 선점 UPDATE 가 DB 오류 → 주문하지 않고 order_failed(claim_failed), 상태는 그대로', async () => {
    db.add(fakeSignal(6));
    db.failOn = [/^UPDATE signals SET status='executing'/];
    const body = await run();
    expect(submitOrder).not.toHaveBeenCalled();
    expect(body.results).toHaveLength(1);                              // 시그널 하나당 결과는 정확히 하나
    expect(body.results?.[0]).toMatchObject({ outcome: 'order_failed' });
    expect(body.results?.[0].detail).toMatch(/^claim_failed:/);
    expect(db.statusOf(6)).toBe('approved_pending_entry');
  });

  test('🔴 선점 시점에 이미 만료됐으면(조회 뒤 만료 경계) 주문하지 않는다', async () => {
    const soon = new Date(Date.now() + 30);                            // 조회 시점엔 살아 있지만 선점 시점엔 지난다
    db.add(fakeSignal(7, { expires_at: soon }));
    db.nowFn = () => new Date(Date.now() + 5_000);                     // "DB 의 지금"은 만료 이후
    const body = await run();
    expect(submitOrder).not.toHaveBeenCalled();
    expect(body.results).toHaveLength(1);
    expect(body.results?.[0].outcome).toBe('claim_lost');
  });
});

describe('선점을 되돌리는 경우는 둘뿐이다 — 확정 거부, 송신 전 예외', () => {
  test('🔴 submitOrder 가 던지면(송신 전 실패) 선점을 되돌려 다음 틱에 다시 시도한다', async () => {
    (submitOrder as jest.Mock)
      .mockRejectedValueOnce(new Error('orders insert failed'))
      .mockResolvedValueOnce({ ok: true, orderId: 61 });
    db.add(fakeSignal(8));
    const first = await run();
    expect(first.results?.[0]).toMatchObject({ outcome: 'order_failed', detail: 'orders insert failed' });
    expect(db.statusOf(8)).toBe('approved_pending_entry');
    const second = await run();
    expect(second.results?.[0].outcome).toBe('submitted');
    expect(submitOrder).toHaveBeenCalledTimes(2);
  });

  test('🔴 선점 복귀 UPDATE 가 실패해도 재주문 위험은 없다 — executing 유지, warning 경보, 이후 틱에 주문 없음', async () => {
    (submitOrder as jest.Mock).mockResolvedValue({ ok: false, orderId: 9, blockedBy: 'kill_switch', error: 'KILL_SWITCH_ACTIVE' });
    db.add(fakeSignal(9));
    db.failOn = [/^UPDATE signals SET status='approved_pending_entry'/];
    const first = await run();
    expect(first.results?.[0].outcome).toBe('order_failed');
    expect(db.statusOf(9)).toBe('executing');                          // 더는 감시되지 않지만 재주문도 없다
    expect(alerts().some((a) => a[0] === 'warning' && a[1].includes('선점 복귀 실패'))).toBe(true);
    db.failOn = [];
    await run();
    expect(submitOrder).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 주문 결과를 받은 뒤의 후처리 예외는 선점을 되돌리지 않는다', () => {
  test('성공 후 알림 단계에서 예외 → submitted(post_order_error), executing 유지, 되돌림 UPDATE 없음, 재주문 없음, warning 경보', async () => {
    (submitOrder as jest.Mock).mockResolvedValue({ ok: true, orderId: 71 });
    (getSymbolLabel as jest.Mock).mockRejectedValueOnce(new Error('label lookup failed'));  // 진입 알림 단계에서 던진다
    db.add(fakeSignal(10));
    const first = await run();
    expect(first.results?.[0].outcome).toBe('submitted');
    expect(first.results?.[0].detail).toMatch(/^post_order_error: label lookup failed/);
    expect(db.statusOf(10)).toBe('executing');
    expect(db.events.some((e) => e.startsWith('release:'))).toBe(false);
    expect(alerts().some((a) => a[0] === 'warning' && a[1].includes('후처리 예외'))).toBe(true);
    await run();
    expect(submitOrder).toHaveBeenCalledTimes(1);
  });

  test('주문 번호 기록이 실패한 직후 후처리 예외가 겹쳐도(consumed_order_id 가 비어 있어도) 되돌리지 않는다 — 이중 주문 방지의 마지막 방어선', async () => {
    (submitOrder as jest.Mock).mockResolvedValue({ ok: true, orderId: 72 });
    (getSymbolLabel as jest.Mock)
      .mockResolvedValueOnce('A')                                     // 기록 실패 경보의 라벨은 통과
      .mockRejectedValueOnce(new Error('label lookup failed'));       // 진입 알림 단계에서 던진다
    db.add(fakeSignal(11));
    db.failOn = [/^UPDATE signals SET consumed_order_id=/];
    const first = await run();
    expect(first.results?.[0].outcome).toBe('submitted');
    expect(db.orderOf(11)).toBeNull();                                // 주문 번호 연결은 실패한 상태
    expect(db.statusOf(11)).toBe('executing');
    expect(db.events.some((e) => e.startsWith('release:'))).toBe(false);
    db.failOn = [];
    await run();
    expect(submitOrder).toHaveBeenCalledTimes(1);
  });
});

describe('선점은 주문 직전에만 한다', () => {
  test('구간 미도달 시그널은 선점하지 않는다', async () => {
    (kis.getTicker as jest.Mock).mockResolvedValue({ price: 50_000_000_000 });   // 구간(1~99999999) 밖
    db.add(fakeSignal(12));
    const body = await run();
    expect(body.results?.[0].outcome).toBe('out_of_zone');
    expect(db.events.some((e) => e.startsWith('claim:'))).toBe(false);
    expect(db.statusOf(12)).toBe('approved_pending_entry');
  });

  test('수량 0(1주도 못 사는 금액) 시그널은 선점하지 않는다', async () => {
    db.add(fakeSignal(13, { price: '905000', amount_krw: '10000' }));
    (kis.getTicker as jest.Mock).mockResolvedValue({ price: 905_000 });
    const body = await run();
    expect(body.results?.[0].outcome).toBe('quantity_below_min');
    expect(db.events.some((e) => e.startsWith('claim:'))).toBe(false);
    expect(submitOrder).not.toHaveBeenCalled();
  });

  test('만료된 시그널은 선점하지 않고 expired 로 처리한다', async () => {
    db.add(fakeSignal(14, { expires_at: new Date(Date.now() - 60_000) }));
    const body = await run();
    expect(body.results?.[0].outcome).toBe('expired');
    expect(db.statusOf(14)).toBe('expired');
    expect(db.events.some((e) => e.startsWith('claim:'))).toBe(false);
  });
});

// ── 독립 감사(T-043) 반영 ────────────────────────────────────────────────────────────

describe('감사 R-2 — JS 만료 판정이 이미 선점된 행을 덮지 않는다', () => {
  test('🔴 다른 실행이 방금 선점(executing)한 행을, 낡은 스냅샷 기준 만료 판정으로 expired 로 덮지 않는다', async () => {
    // DB 행은 이미 만료 시각을 지난 채 다른 실행이 선점(executing)한 상태 — 시간 조건만으로는 막히지 않아 **상태 조건**이 유일한 방어가 된다 (감사 R2-1)
    db.add(fakeSignal(21, { status: 'executing', consumed_order_id: null, expires_at: new Date(Date.now() - 1_000) }));
    const stale = { ...fakeSignal(21, { expires_at: new Date(Date.now() - 1_000) }) };      // 이쪽이 읽은 스냅샷: 아직 approved_pending_entry, 시계상 만료
    db.selectHook = () => [{ ...stale }];
    const body = await run();
    expect(db.statusOf(21)).toBe('executing');                                             // 🔴 상태 조건이 없으면 expired 로 덮인다
    expect(db.events).toContain('expire-noop:21');
    expect(submitOrder).not.toHaveBeenCalled();
    expect(body.results?.[0].outcome).toBe('claim_lost');                                  // 0행이면 expired 로 거짓 보고하지 않는다 (Codex C2)
  });

  test('🔴 앱 시계는 만료로 보지만 DB 시각으로는 아직 유효한 시그널은 expired 로 만들지 않는다 (시계 편차, Codex C2)', async () => {
    db.add(fakeSignal(40, { expires_at: new Date(Date.now() - 1_000) }));                   // 앱 시계 기준 만료
    db.nowFn = () => new Date(Date.now() - 60_000);                                         // DB 시계는 1분 늦다 → 아직 유효
    const body = await run();
    expect(db.statusOf(40)).toBe('approved_pending_entry');
    expect(body.results?.[0].outcome).toBe('claim_lost');
    expect(submitOrder).not.toHaveBeenCalled();
    expect(db.events).toContain('expire-noop:40');
  });

  test('만료 UPDATE 가 DB 오류여도 틱은 계속된다(결과에 사유를 남긴다)', async () => {
    db.add(fakeSignal(41, { expires_at: new Date(Date.now() - 60_000) }));
    db.failOn = [/^UPDATE signals SET status='expired'/];
    const body = await run();
    expect(body.results?.[0]).toMatchObject({ signalId: 41, outcome: 'expired' });
    expect(body.results?.[0].detail).toMatch(/^expire update failed:/);
    expect(db.statusOf(41)).toBe('approved_pending_entry');                                 // 상태는 그대로 — 다음 틱에 다시 본다
  });
});

describe('감사 R-3 — 선점 패배·연결 실패를 조용히 넘기지 않는다', () => {
  test('선점 패배는 경고 로그를 남기고 회차 요약에 claim_lost 건수가 실린다', async () => {
    db.add(fakeSignal(22, { status: 'executing' }));
    db.selectHook = () => [fakeSignal(22)];                                                // 스냅샷은 아직 대기 상태
    await run();
    expect((console.warn as jest.Mock).mock.calls.some((c) => String(c[0]).includes('선점 패배') && String(c[0]).includes('signal=22'))).toBe(true);
    expect((console.log as jest.Mock).mock.calls.some((c) => String(c[0]).includes('claim_lost=1'))).toBe(true);
  });

  test('🔴 성공했는데 주문 번호를 연결할 행이 없으면(그 사이 상태가 바뀜) 기록 실패 경보를 보낸다 — 조용히 넘기지 않는다', async () => {
    db.add(fakeSignal(23));
    (submitOrder as jest.Mock).mockImplementation(async () => { db.rows.get(23)!.status = 'expired'; return { ok: true, orderId: 91 }; });
    const body = await run();
    expect(body.results?.[0].outcome).toBe('submitted');                                   // 주문은 접수됐다
    expect(alerts().some((a) => a[0] === 'warning' && a[1].includes('주문 번호 기록 실패') && a[2].includes('연결할 행이 없습니다'))).toBe(true);
  });

  test('결과 불명인데 연결할 행이 없으면 critical 경보 본문에 consumed_order_id 안내가 붙는다', async () => {
    db.add(fakeSignal(24));
    (submitOrder as jest.Mock).mockImplementation(async () => { db.rows.get(24)!.status = 'expired'; return { ok: false, orderId: 92, error: 'x', outcomeUnknown: true }; });
    await run();
    expect(alerts().some((a) => a[0] === 'critical' && a[2].includes('consumed_order_id'))).toBe(true);
  });
});

describe('회차 요약 로그', () => {
  test('결과 불명이 있으면 요약 로그에 order_uncertain=N 이 실린다', async () => {
    (submitOrder as jest.Mock).mockResolvedValue({ ok: false, orderId: 50, error: 'x', outcomeUnknown: true });
    db.add(fakeSignal(50));
    await run();
    expect((console.log as jest.Mock).mock.calls.some((c) => String(c[0]).includes('order_uncertain=1'))).toBe(true);
  });
});

describe('감사 R-6 — 선점 복귀 실패 경보는 추가 비동기 호출에 기대지 않는다', () => {
  test('🔴 라벨 조회가 실패해도 틱은 정상 응답하고 경보는 나간다', async () => {
    (submitOrder as jest.Mock).mockResolvedValue({ ok: false, orderId: 25, blockedBy: 'kill_switch', error: 'KILL_SWITCH_ACTIVE' });
    (getSymbolLabel as jest.Mock).mockRejectedValue(new Error('label down'));
    db.add(fakeSignal(25));
    db.failOn = [/^UPDATE signals SET status='approved_pending_entry'/];
    const body = await run();
    expect(body.results?.[0].outcome).toBe('order_failed');
    expect(alerts().some((a) => a[0] === 'warning' && a[1].includes('선점 복귀 실패'))).toBe(true);
  });
});

describe('감사 R-4 — 살아남았던 변이를 겨냥', () => {
  test('🔴 결과 불명 주문의 후처리 예외는 order_uncertain 으로 분류되고, 선점은 유지되며 warning 경보가 나간다', async () => {
    (submitOrder as jest.Mock).mockResolvedValue({ ok: false, orderId: 26, error: 'x', outcomeUnknown: true });
    (getSymbolLabel as jest.Mock).mockRejectedValueOnce(new Error('label down'));          // 결과 불명 경보 조립 단계에서 던진다
    db.add(fakeSignal(26));
    const body = await run();
    expect(body.results?.[0].outcome).toBe('order_uncertain');                             // order_failed 로 떨어지지 않는다
    expect(body.results?.[0].detail).toMatch(/^post_order_error: label down/);
    expect(db.statusOf(26)).toBe('executing');
    expect(db.events.some((e) => e.startsWith('release:'))).toBe(false);
    expect(alerts().some((a) => a[0] === 'warning' && a[1].includes('후처리 예외'))).toBe(true);
    await run();
    expect(submitOrder).toHaveBeenCalledTimes(1);
  });

  test('dryRun 결과(ok:false, dryRun:true)는 성공으로 취급한다 — 주문 번호 연결, executing 유지, 복귀 없음', async () => {
    (submitOrder as jest.Mock).mockResolvedValue({ ok: false, dryRun: true, orderId: 27 });
    db.add(fakeSignal(27));
    const body = await run();
    expect(body.results?.[0].outcome).toBe('submitted');
    expect(db.statusOf(27)).toBe('executing');
    expect(db.orderOf(27)).toBe(27);
    expect(db.events.some((e) => e.startsWith('release:'))).toBe(false);
  });

  test('🔴 송신 전 예외의 선점 복귀는 응답 전에 끝난다 — UPDATE 가 느려도 await 한다', async () => {
    (submitOrder as jest.Mock).mockRejectedValue(new Error('orders insert failed'));
    db.add(fakeSignal(28));
    db.delayMs = 15;
    await run();
    expect(db.statusOf(28)).toBe('approved_pending_entry');                               // await 가 빠지면 아직 executing 이다
  });

  test('🔴 확정 거부의 선점 복귀도 응답 전에 끝난다', async () => {
    (submitOrder as jest.Mock).mockResolvedValue({ ok: false, orderId: 29, blockedBy: 'order_limit', error: 'x' });
    db.add(fakeSignal(29));
    db.delayMs = 15;
    await run();
    expect(db.statusOf(29)).toBe('approved_pending_entry');
  });

  test('분할 진입 게이트에 막힌 시그널(이전 회차가 아직 approved_pending_entry)은 선점하지 않는다', async () => {
    const split = (index: number, zone: string) => JSON.stringify({ ai: { scenario: { entry: { price_zone: zone } } }, split: { group_id: 'g1', index, total: 2 } });
    db.add(fakeSignal(30, { indicators: split(1, '1 ~ 2') }));                              // 1회차: 구간 밖이라 대기 유지
    db.add(fakeSignal(31, { indicators: split(2, '1 ~ 99999999') }));                       // 2회차: 구간 안이지만 1회차가 대기 중
    const body = await run();
    expect(body.results?.map((r) => [r.signalId, r.outcome])).toEqual([[30, 'out_of_zone'], [31, 'blocked_by_prior_split']]);
    expect(db.events.some((e) => e.startsWith('claim:'))).toBe(false);
    expect(submitOrder).not.toHaveBeenCalled();
  });
});

// ── T-046 C (T-043 독립 감사 R-1) — 선점 뒤 멈춘 executing 시그널 자동 경보 ───────────────────────────────

describe('멈춘 executing 자동 경보', () => {
  const MIN = 60_000;
  const throttled = () => (sendAlertThrottled as jest.Mock).mock.calls as Array<[string, string, string, string, number]>;

  test('🔴 executing + 주문 번호 없음 + 10분 넘음 → critical 경보 1건(키·1시간 스로틀·시그널 정보 포함)', async () => {
    const claimedAt = new Date(Date.now() - 11 * MIN);
    db.add(fakeSignal(60, { status: 'executing', updated_at: claimedAt }));
    await run();
    expect(throttled()).toHaveLength(1);
    const [key, level, title, body, ttl] = throttled()[0];
    expect(key).toBe('entry-watcher:stuck-executing:60');
    expect(level).toBe('critical');
    expect(title).toContain('1건');
    expect(body).toContain('#60');
    expect(body).toContain('005930');
    expect(ttl).toBe(60 * 60 * 1000);
    // 🔴 선점 시각은 KST 로 표기한다 — 이 값으로 사람이 KIS 체결 내역과 대조한다 (T-046 감사 R-1: 이전에는 UTC 가 시간대 표기 없이 나갔다).
    const kst = claimedAt.toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 19);       // Intl 기반 독립 계산 (구현의 +9h 산술과 다른 경로)
    const utc = claimedAt.toISOString().slice(0, 19).replace('T', ' ');
    expect(body).toContain(`선점 ${kst} KST`);
    expect(body).not.toContain(`선점 ${utc}`);
  });

  test('아직 10분이 안 됐거나(정상 지연) 주문 번호가 있으면 경보하지 않는다', async () => {
    db.add(fakeSignal(61, { status: 'executing', updated_at: new Date(Date.now() - 2 * MIN) }));                       // 방금 선점
    db.add(fakeSignal(62, { status: 'executing', consumed_order_id: 99, updated_at: new Date(Date.now() - 60 * MIN) })); // 주문 번호 있음
    db.add(fakeSignal(63, { status: 'approved_pending_entry', updated_at: new Date(Date.now() - 60 * MIN) }));            // executing 아님
    await run();
    expect(throttled()).toHaveLength(0);
  });

  test('🔴 조회할 대기 시그널이 하나도 없어도 점검한다 (rows.length===0 조기 반환보다 앞)', async () => {
    db.add(fakeSignal(64, { status: 'executing', updated_at: new Date(Date.now() - 30 * MIN) }));   // 대기(approved_pending_entry) 시그널은 없음
    const body = await run();
    expect(body.results).toEqual([]);
    expect(throttled()).toHaveLength(1);
  });

  test('🔴 장외에는 점검하지 않는다 (시장이 닫혀 있으면 조기 반환)', async () => {
    (isDomesticOpen as jest.Mock).mockResolvedValueOnce(false);
    (isOverseasOpen as jest.Mock).mockResolvedValueOnce(false);
    db.add(fakeSignal(65, { status: 'executing', updated_at: new Date(Date.now() - 30 * MIN) }));
    await run();
    expect(db.events).not.toContain('stuck-check');
    expect(throttled()).toHaveLength(0);
  });

  test('🔴 점검 쿼리가 DB 오류여도 주문 경로는 계속된다 (점검 실패가 틱을 막지 않는다)', async () => {
    (submitOrder as jest.Mock).mockResolvedValue({ ok: true, orderId: 70 });
    db.add(fakeSignal(66));
    db.failOn = [/^SELECT id, symbol, side, updated_at FROM signals WHERE status='executing'/];
    const body = await run();
    expect(body.results?.[0].outcome).toBe('submitted');
    expect(submitOrder).toHaveBeenCalledTimes(1);
    expect((console.error as jest.Mock).mock.calls.some((c) => String(c[0]).includes('멈춘 executing 점검 실패'))).toBe(true);
  });

  test('10건을 넘으면 본문은 10건까지만 싣고 나머지 개수를 알린다', async () => {
    for (let i = 0; i < 12; i++) db.add(fakeSignal(100 + i, { status: 'executing', updated_at: new Date(Date.now() - 20 * MIN) }));
    await run();
    const [, , title, body] = throttled()[0];
    expect(title).toContain('12건');
    expect(body).toContain('#109');
    expect(body).not.toContain('#110');
    expect(body).toContain('외 2건');
  });

  test('🔴 스로틀 키는 멈춘 ID 집합별 — 같은 집합은 같은 키(1시간 스로틀), 새 시그널이 더 멈추면 다른 키(즉시 경보) (Codex C2)', async () => {
    db.add(fakeSignal(80, { status: 'executing', updated_at: new Date(Date.now() - 20 * MIN) }));
    await run();
    await run();                                                                                      // 같은 집합 — 같은 키
    db.add(fakeSignal(81, { status: 'executing', updated_at: new Date(Date.now() - 15 * MIN) }));      // 독립 사고가 추가로 발생
    await run();
    const keys = throttled().map((c) => c[0]);
    expect(keys).toEqual([
      'entry-watcher:stuck-executing:80',
      'entry-watcher:stuck-executing:80',
      'entry-watcher:stuck-executing:80,81',
    ]);
    expect(keys[2]).not.toBe(keys[0]);                                                                // 🔴 고정 키였다면 셋 다 같아 81 의 경보가 가려진다
  });

  test('같은 틱에서 점검 경보와 정상 주문이 함께 처리된다', async () => {
    (submitOrder as jest.Mock).mockResolvedValue({ ok: true, orderId: 71 });
    db.add(fakeSignal(67, { status: 'executing', updated_at: new Date(Date.now() - 30 * MIN) }));
    db.add(fakeSignal(68));
    const body = await run();
    expect(throttled()).toHaveLength(1);
    expect(body.results?.map((r) => r.outcome)).toEqual(['submitted']);
  });
});
