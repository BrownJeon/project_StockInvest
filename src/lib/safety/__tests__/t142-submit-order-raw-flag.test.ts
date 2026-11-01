/**
 * T-142 — 주문 경로에서 **비 JSON 킬스위치 값**이 실제로 제동을 거는지.
 *
 * [[T-141-killswitch-presend-recheck]] QA 가 재현한 두 경로를 그대로 고정한다:
 *  - **B** — 3단계 첫 확인에서 DB 값이 `yes`(비 JSON): 예전에는 `JSON.parse` 예외가 env 폴백으로 흘러
 *    **송신됐다**
 *  - **G** — 3단계는 통과(`false`)하고 **송신 직전 재확인**에서 값이 비 JSON: 재확인이 같은 함수를 쓰므로
 *    fail-open 을 그대로 상속해 **송신됐다**
 *
 * 단위 시험([[t142-flag-decode]])이 `isKillSwitchActive` 하나를 보는 것과 달리, 이 파일은 **`submitOrder`
 * 를 통째로 돌려** 재확인이 실제로 수정을 상속하는지 본다. T-141 시험은 킬스위치 값을 `JSON.stringify` 로
 * 넣으므로 비 JSON 경로를 전혀 지나지 않는다 — 그래서 별 파일이다.
 */
import { getAccountId, getPool } from '@/lib/db';
import type { OrderRequest } from '@/lib/exchanges/types';
import { getMarketTotal } from '@/lib/safety/portfolio-total';
import { submitOrder } from '../dry-run';

jest.mock('@/lib/db', () => ({ getPool: jest.fn(), getAccountId: jest.fn() }));
jest.mock('@/lib/safety/portfolio-total', () => ({ getMarketTotal: jest.fn() }));
jest.mock('@/lib/notify', () => ({ sendAlert: jest.fn() }));

interface World {
  /** `safety_kill_switch` 의 **DB 원문 값** — 호출 순서대로 하나씩 소비, 마지막 값 반복. JSON 으로 감싸지 않는다. */
  killRaw: string[];
  killReads: number;
  orderUpdates: Array<{ status?: string; blockedBy?: unknown }>;
}
let w: World;

function setupDb() {
  let id = 9500;
  const query = jest.fn(async (sqlArg: unknown, params: unknown[] = []) => {
    const sql = String(sqlArg);
    if (/INSERT INTO orders/i.test(sql)) return [{ insertId: id++ }];
    if (/INSERT INTO trade_logs/i.test(sql)) return [{}];
    if (/UPDATE orders/i.test(sql)) {
      const m = sql.match(/SET\s+status='([^']+)'/);
      w.orderUpdates.push({ status: m?.[1], blockedBy: /blocked_by=\?/.test(sql) ? params[0] : undefined });
      return [{}];
    }
    if (/SUM\(amount_krw\)/i.test(sql)) return [[{ sum_krw: 0 }]];
    if (/FROM system_config/i.test(sql)) {
      const k = String(params?.[0] ?? '');
      if (k === 'safety_kill_switch') {
        const i = Math.min(w.killReads++, w.killRaw.length - 1);
        return [[{ value: w.killRaw[i] }]];     // ← 원문 그대로. 여기가 이 파일의 전부다
      }
      if (k === 'safety_order_max_pct') return [[{ value: '50' }]];
      if (k === 'safety_daily_order_max_pct') return [[{ value: '90' }]];
      return [[]];
    }
    return [[]];
  });
  (getPool as jest.Mock).mockReturnValue({ query });
  (getAccountId as jest.Mock).mockResolvedValue(1);
}

/** 매도 — 검증 관문(G6)이 매도를 I/O 0 으로 통과시키므로 전략 모킹이 필요 없다. */
const domSell: OrderRequest = {
  exchange: 'kis', symbol: '005930', side: 'sell', type: 'limit',
  price: 70_000, quantity: 1, amountKRW: 70_000, market: 'domestic',
};

const origEnv = { ...process.env };
beforeEach(() => {
  jest.clearAllMocks();
  w = { killRaw: ['false'], killReads: 0, orderUpdates: [] };
  process.env.DRY_RUN = 'false';
  delete process.env.KILL_SWITCH;             // 폴백으로 흘렀다면 미설정 → 제동 없음 → 송신된다
  process.env.BLOCKED_SYMBOLS_DOMESTIC = '';
  process.env.BLOCKED_SYMBOLS_OVERSEAS = '';
  (getMarketTotal as jest.Mock).mockResolvedValue({ status: 'ok', krw: 10_000_000 });
  setupDb();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { process.env = { ...origEnv }; jest.restoreAllMocks(); });

test('🔴 경로 B — 3단계에서 DB 값이 `yes`(비 JSON)면 송신 0 · blocked(kill_switch)', async () => {
  w.killRaw = ['yes'];
  const realSubmit = jest.fn();
  const r = await submitOrder(domSell, realSubmit);

  expect(realSubmit).not.toHaveBeenCalled();
  expect(r).toMatchObject({ ok: false, blockedBy: 'kill_switch', error: 'KILL_SWITCH_ACTIVE' });
  expect(w.killReads).toBe(1);                 // 앞단이 막았으므로 재확인까지 가지 않는다
});

test('🔴 경로 G — 3단계 통과 뒤 **송신 직전** 값이 `yes`(비 JSON)면 송신 0 · blocked(kill_switch)', async () => {
  w.killRaw = ['false', 'yes'];
  const realSubmit = jest.fn();
  const r = await submitOrder(domSell, realSubmit);

  expect(realSubmit).not.toHaveBeenCalled();   // ← 예전에는 1 이었다 (QA 재현 G)
  expect(r).toMatchObject({ ok: false, blockedBy: 'kill_switch' });
  expect(w.orderUpdates).toContainEqual({ status: 'blocked', blockedBy: 'kill_switch' });
  expect(w.killReads).toBe(2);                 // 3단계 + 8a-0
});

test('🔴 비 JSON `no` 는 제동이 아니다 — 송신이 그대로 일어난다 (과차단 변이를 잡는다)', async () => {
  w.killRaw = ['no', 'no'];
  const realSubmit = jest.fn(async () => ({ ok: true, exchangeOrderId: 'X1' }));
  const r = await submitOrder(domSell, realSubmit);

  expect(realSubmit).toHaveBeenCalledTimes(1);
  expect(r).toMatchObject({ ok: true });
  expect(w.killReads).toBe(2);
});

test('해석 불가한 값(`뭔가이상한값`)도 송신 직전에 막는다', async () => {
  w.killRaw = ['false', '뭔가이상한값'];
  const realSubmit = jest.fn();
  const r = await submitOrder(domSell, realSubmit);

  expect(realSubmit).not.toHaveBeenCalled();
  expect(r).toMatchObject({ ok: false, blockedBy: 'kill_switch' });
});
