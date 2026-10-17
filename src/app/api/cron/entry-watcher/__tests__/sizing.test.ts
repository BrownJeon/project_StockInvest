/**
 * T-020 — **두 번째 사이징 지점(`entry-watcher`)도 정수만 만든다.**
 *
 * ## 왜 별도 파일인가
 *
 * 소수점 수량을 만드는 곳은 정확히 두 곳이었다:
 *   `signals/service.ts:119` (`buildOrderRequest`) · `cron/entry-watcher/route.ts:238`
 * 두 곳이 **같은 공식을 각자** 들고 있었으므로 한쪽만 고치면 다른 경로로 계속 생성된다
 * (T-018 reviewer 지적). 이제 둘 다 `sizeOrderQuantity` 하나를 쓴다 — 이 파일은 그
 * 사실을 *실제 라우트 실행*으로 확인한다. 순수 함수 테스트만으로는 "배선이 됐는가"를
 * 증명하지 못하기 때문이다.
 */
jest.mock('@/lib/cron-auth', () => ({ checkCronAuth: jest.fn(() => null) }));
jest.mock('@/lib/strategy/market-hours', () => ({
  isDomesticOpen:  jest.fn(async () => true),
  isOverseasOpen:  jest.fn(async () => true),
}));
jest.mock('@/lib/db', () => ({ getPool: jest.fn(), getAccountId: jest.fn(async () => 1) }));
jest.mock('@/lib/exchanges/kis', () => ({
  kis: { getTicker: jest.fn(), createOrder: jest.fn() },
}));
jest.mock('@/lib/safety/dry-run', () => ({ submitOrder: jest.fn() }));
jest.mock('@/lib/strategy/style', () => ({
  // 호가 추격은 이 테스트의 관심사가 아니다 — 수량 계산만 보기 위해 0 으로 고정한다.
  getStyleConfig: jest.fn(async () => ({ limitChasePct: 0 })),
}));
jest.mock('@/lib/strategy/position-state', () => ({
  setPositionScenarioExit: jest.fn(async () => undefined),
}));
jest.mock('@/lib/notify', () => ({
  sendAlert: jest.fn(),
  getSymbolLabel: jest.fn(async (s: string) => s),
}));
jest.mock('@/lib/notify/throttle', () => ({
  sendAlertThrottled: jest.fn(() => true),
  resetAlertThrottle: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { POST } from '../route';
import { getPool } from '@/lib/db';
import { kis } from '@/lib/exchanges/kis';
import { submitOrder } from '@/lib/safety/dry-run';
import { sendAlertThrottled } from '@/lib/notify/throttle';
import { sizeOrderQuantity } from '@/lib/signals/service';

interface SignalFixture {
  id: number;
  symbol: string;
  side: 'buy' | 'sell';
  order_type: 'limit' | 'market';
  price: string | null;
  quantity: string | null;
  amount_krw: string;
  market: 'domestic' | 'overseas';
}

/** 항상 구간 안에 들어오게 넓게 잡는다 — 이 파일의 관심사는 진입 판정이 아니라 수량이다. */
const ZONE = { ai: { scenario: { entry: { price_zone: '1 ~ 99999999' } } } };

function fixture(o: Partial<SignalFixture> & { id: number }) {
  return {
    symbol: '005930', side: 'buy' as const, order_type: 'limit' as const,
    price: '6540', quantity: null, amount_krw: '100000', market: 'domestic' as const,
    indicators: JSON.stringify(ZONE), reasoning: null, expires_at: null,
    ...o,
  };
}

interface Captured { tradeLogs: Array<{ event: string; payload: Record<string, unknown> }> }

function setupPool(rows: unknown[]): Captured {
  const cap: Captured = { tradeLogs: [] };
  const query = jest.fn(async (sqlArg: unknown, paramsArg: unknown[] = []) => {
    const sql = String(sqlArg);
    const params = paramsArg ?? [];
    if (/INSERT INTO trade_logs/i.test(sql)) {
      cap.tradeLogs.push({
        event: String(params[1]),
        payload: JSON.parse(String(params[2])) as Record<string, unknown>,
      });
      return [{ insertId: 1 }];
    }
    // T-043 — 주문 직전 선점 UPDATE 는 성공한다(이 테스트의 관심사는 사이징이다)
    if (/^UPDATE signals SET status='executing'/.test(sql.replace(/\s+/g, ' ').trim())) return [{ affectedRows: 1 }];
    if (/FROM signals/i.test(sql)) return [rows];
    return [[]];
  });
  (getPool as jest.Mock).mockReturnValue({ query });
  return cap;
}

const req = () => new NextRequest('http://localhost:3003/api/cron/entry-watcher', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  (kis.getTicker as jest.Mock).mockResolvedValue({ price: 6_540 });
  (submitOrder as jest.Mock).mockResolvedValue({ ok: true, orderId: 42 });
});
afterEach(() => jest.restoreAllMocks());

describe('entry-watcher 사이징', () => {
  test('🔴 소수가 아니라 정수 주식 수를 submitOrder 로 넘긴다', async () => {
    setupPool([fixture({ id: 1, price: '6540', amount_krw: '100000' })]);
    await POST(req());

    expect(submitOrder).toHaveBeenCalledTimes(1);
    const sent = (submitOrder as jest.Mock).mock.calls[0][0];
    // 예전 공식이면 15.29051987 이 나갔다 — 국내 KIS 가 거절하는 값이다
    expect(sent.quantity).toBe(15);
    expect(Number.isInteger(sent.quantity)).toBe(true);
  });

  test('🔴 service.ts 경로와 **동일한 수량**을 만든다 (두 지점이 갈라지지 않는다)', async () => {
    setupPool([fixture({ id: 2, symbol: 'NAS:AAPL', market: 'overseas', price: '190', amount_krw: '1000' })]);
    (kis.getTicker as jest.Mock).mockResolvedValue({ price: 190 });
    await POST(req());

    const sent = (submitOrder as jest.Mock).mock.calls[0][0];
    const viaService = sizeOrderQuantity({
      market: 'overseas', orderType: 'limit', amountKRW: 1_000, price: 190,
    });
    expect(sent.quantity).toBe(viaService.quantity);
    expect(sent.quantity).toBe(5);
  });

  test('🔴 1주 미만이면 주문하지 않고 집계 가능한 outcome 으로 남긴다', async () => {
    const cap = setupPool([fixture({ id: 3, symbol: 'NAS:META', market: 'overseas', price: '905000', amount_krw: '718971' })]);
    (kis.getTicker as jest.Mock).mockResolvedValue({ price: 905_000 });

    const res = await POST(req());
    const body = await res.json() as { results: Array<{ outcome: string; detail?: string }> };

    expect(submitOrder).not.toHaveBeenCalled();
    // `order_failed` 로 뭉개면 "브로커가 거절했다"와 구분할 수 없다
    expect(body.results[0].outcome).toBe('quantity_below_min');
    expect(body.results[0].detail).toContain('1주 미만');

    // 로그 토큰 · 감사 기록 — 사후 집계 경로가 둘 다 살아 있다
    const logged = (console.warn as jest.Mock).mock.calls.flat().join(' ');
    expect(logged).toContain('SIZING_BELOW_MIN_QTY');
    const audit = cap.tradeLogs.find(l => l.event === 'sizing_below_min_qty');
    expect(audit).toBeDefined();
    expect(audit!.payload).toMatchObject({ where: 'entry-watcher', signalId: 3, symbol: 'NAS:META' });
  });

  test('스킵된 시그널의 상태는 바꾸지 않는다 — 감시자이므로 다음 틱에 다시 본다', async () => {
    setupPool([fixture({ id: 4, price: '905000', amount_krw: '10000' })]);
    (kis.getTicker as jest.Mock).mockResolvedValue({ price: 905_000 });

    await POST(req());
    const pool = (getPool as jest.Mock).mock.results[0].value as { query: jest.Mock };
    const statusWrites = pool.query.mock.calls
      .map(c => String(c[0]))
      .filter(s => /UPDATE signals SET status=/i.test(s));
    expect(statusWrites).toHaveLength(0);
  });

  test('회차 요약 로그에 스킵 건수가 실린다', async () => {
    setupPool([fixture({ id: 5, price: '905000', amount_krw: '10000' })]);
    (kis.getTicker as jest.Mock).mockResolvedValue({ price: 905_000 });

    await POST(req());
    const summary = (console.log as jest.Mock).mock.calls.flat().join(' ');
    expect(summary).toContain('below_min_qty=1');
  });

  test('🔴 매도 스킵은 알림까지 간다 (포지션이 안 닫힌 상태)', async () => {
    setupPool([fixture({ id: 6, side: 'sell', price: '905000', amount_krw: '10000' })]);
    (kis.getTicker as jest.Mock).mockResolvedValue({ price: 905_000 });

    await POST(req());
    const call = (sendAlertThrottled as jest.Mock).mock.calls
      .find(c => String(c[0]).startsWith('sizing-below-min:'));
    expect(call).toBeDefined();
    expect(call![3]).toContain('포지션이 그대로 남아 있습니다');
  });

  test('시그널이 이미 정수 수량을 들고 있으면 그대로 쓴다 (무회귀)', async () => {
    setupPool([fixture({ id: 7, quantity: '3' })]);
    await POST(req());
    expect((submitOrder as jest.Mock).mock.calls[0][0].quantity).toBe(3);
  });
});
