/**
 * T-141 — 킬스위치 **송신 직전 재확인**.
 *
 * ## 왜 필요한가
 *
 * `submitOrder` 는 킬스위치를 **3단계에서 한 번** 보고 실제 송신은 **8단계**다. 그 사이 `await` 중
 * **5~6단계 한도 산정이 KIS 를 탄다**(잔고+시세 → 토큰 획득). 토큰이 죽어 있으면 그 획득이 길어질 수
 * 있고([[T-138-token-issue-single-flight]] QA F-1: 실측 94.8초·이론 약 180초), 그동안 사용자가
 * **킬스위치를 내려도 이미 3단계를 지난 주문은 그대로 나갔다.**
 *
 * 킬스위치는 사용자의 **비상 제동**이다. 그래서 송신 직전에 한 번 더 본다 — 같은 파일의 T-072 F-15
 * (검증 관문 송신 직전 재검증)와 **같은 이유·같은 자리**다.
 *
 * ## 이 시험이 지키는 것
 *  1. 첫 확인 false → **송신 직전 true** 면 `realSubmit` **0회**·`blocked_by='kill_switch'`
 *  2. 평시(둘 다 false)에는 송신이 그대로 일어나고, `safety_kill_switch` 를 **정확히 2회** 읽는다
 *     (한 번만 읽는 변이 = 재확인 제거를 잡는다)
 *  3. 첫 확인에서 이미 true 면 **1회만** 읽고 차단한다(앞단이 막으면 뒤는 보지 않는다)
 */
import { getAccountId, getPool } from '@/lib/db';
import type { OrderRequest } from '@/lib/exchanges/types';
import { sendAlert } from '@/lib/notify';
import { getMarketTotal } from '@/lib/safety/portfolio-total';
import { submitOrder } from '../dry-run';

jest.mock('@/lib/db', () => ({ getPool: jest.fn(), getAccountId: jest.fn() }));
jest.mock('@/lib/safety/portfolio-total', () => ({ getMarketTotal: jest.fn() }));
jest.mock('@/lib/notify', () => ({ sendAlert: jest.fn() }));

interface World {
  /** `safety_kill_switch` 응답 — 호출 순서대로 하나씩 소비, 마지막 값 반복 */
  killAnswers: boolean[];
  killReads: number;
  /** `strategies.validation_status` 응답 — 같은 방식. 매수 경로의 검증 관문용 */
  strategyAnswers: Array<string | undefined>;
  strategyReads: number;
  queries: string[];
  orderUpdates: Array<{ status?: string; blockedBy?: unknown }>;
  logs: Array<{ event: string; payload: Record<string, unknown> }>;
}
let w: World;

function setupDb() {
  let id = 9000;
  const query = jest.fn(async (sqlArg: unknown, params: unknown[] = []) => {
    const sql = String(sqlArg);
    w.queries.push(sql);
    if (/INSERT INTO orders/i.test(sql)) return [{ insertId: id++ }];
    if (/INSERT INTO trade_logs/i.test(sql)) {
      w.logs.push({ event: String(params[1]), payload: JSON.parse(String(params[2])) });
      return [{}];
    }
    if (/UPDATE orders/i.test(sql)) {
      const m = sql.match(/SET\s+status='([^']+)'/);
      w.orderUpdates.push({ status: m?.[1], blockedBy: /blocked_by=\?/.test(sql) ? params[0] : undefined });
      return [{}];
    }
    if (/SELECT validation_status FROM strategies/i.test(sql)) {
      const i = Math.min(w.strategyReads++, w.strategyAnswers.length - 1);
      const a = w.strategyAnswers[i];
      return [a === undefined ? [] : [{ validation_status: a }]];
    }
    if (/SUM\(amount_krw\)/i.test(sql)) return [[{ sum_krw: 0 }]];
    if (/FROM system_config/i.test(sql)) {
      const k = String(params?.[0] ?? '');
      if (k === 'safety_kill_switch') {
        const i = Math.min(w.killReads++, w.killAnswers.length - 1);
        return [[{ value: JSON.stringify(w.killAnswers[i]) }]];
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

/** 매도를 쓴다 — 검증 관문(G6)이 매도를 I/O 0 으로 통과시키므로 전략 모킹이 필요 없다. */
const domSell: OrderRequest = {
  exchange: 'kis', symbol: '005930', side: 'sell', type: 'limit',
  price: 70_000, quantity: 1, amountKRW: 70_000, market: 'domestic',
};

/** 매수 — 검증 관문이 전략을 조회한다. 두 관문이 **동시에** 막는 상황을 만들 때 쓴다. */
const domBuy: OrderRequest = {
  exchange: 'kis', symbol: '005930', side: 'buy', type: 'limit',
  price: 70_000, quantity: 1, amountKRW: 70_000, market: 'domestic',
};
const attr = { attribution: { kind: 'strategy' as const, strategyId: 'rsi-v1', signalId: 42 } };

const origEnv = { ...process.env };
beforeEach(() => {
  jest.clearAllMocks();
  w = { killAnswers: [false], killReads: 0, strategyAnswers: ['backtested'], strategyReads: 0,
        queries: [], orderUpdates: [], logs: [] };
  process.env.DRY_RUN = 'false';
  process.env.KILL_SWITCH = 'false';
  process.env.BLOCKED_SYMBOLS_DOMESTIC = '';
  process.env.BLOCKED_SYMBOLS_OVERSEAS = '';
  (getMarketTotal as jest.Mock).mockResolvedValue({ status: 'ok', krw: 10_000_000 });
  setupDb();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { process.env = { ...origEnv }; jest.restoreAllMocks(); });

test('🔴 첫 확인 false → 송신 직전 true(사용자가 그 사이 내렸다) → 송신 0, blocked(kill_switch)', async () => {
  w.killAnswers = [false, true];
  const realSubmit = jest.fn();
  const r = await submitOrder(domSell, realSubmit);

  expect(realSubmit).not.toHaveBeenCalled();                 // ← 이 한 줄이 이 task 의 전부다
  expect(r).toMatchObject({ ok: false, blockedBy: 'kill_switch', error: 'KILL_SWITCH_ACTIVE' });
  expect(w.orderUpdates).toContainEqual({ status: 'blocked', blockedBy: 'kill_switch' });
  expect(w.orderUpdates.some((u) => u.status === 'accepted' || u.status === 'dry_run')).toBe(false);
  expect(w.logs.some((l) => l.event === 'blocked' && l.payload.reason === 'kill_switch')).toBe(true);
  // 킬스위치 차단은 `critical` 알림이다(다른 차단 사유는 `warning`) — 처음 warning 으로 적어 시험이 먼저 틀렸다.
  expect(sendAlert).toHaveBeenCalledWith('critical', '주문 차단: kill_switch', expect.any(String));
  expect(w.killReads).toBe(2);                               // 3단계 + 8a-0
});

test('🔴 평시(둘 다 false)에는 송신이 그대로 일어나고 킬스위치를 **정확히 2회** 읽는다', async () => {
  w.killAnswers = [false, false];
  const realSubmit = jest.fn(async () => ({ ok: true, exchangeOrderId: 'X1' }));
  const r = await submitOrder(domSell, realSubmit);

  expect(realSubmit).toHaveBeenCalledTimes(1);
  expect(r).toMatchObject({ ok: true });
  expect(w.orderUpdates).toContainEqual({ status: 'accepted', blockedBy: undefined });
  // 2회가 아니면 재확인이 없거나(1) 중복이다(3+). 재확인을 지우는 변이를 이 단언이 잡는다.
  expect(w.killReads).toBe(2);
});

test('첫 확인에서 이미 true 면 1회만 읽고 차단한다 (앞단이 막으면 뒤는 보지 않는다)', async () => {
  w.killAnswers = [true];
  const realSubmit = jest.fn();
  const r = await submitOrder(domSell, realSubmit);

  expect(realSubmit).not.toHaveBeenCalled();
  expect(r).toMatchObject({ ok: false, blockedBy: 'kill_switch' });
  expect(w.killReads).toBe(1);
  // 앞단에서 막혔으므로 한도 산정(KIS)·DRY_RUN 조회까지 가지 않는다.
  // (처음 `SUM(amount_krw)` 가 없는 것을 단언했는데 **매도는 일일 한도를 건너뛰어** 그 쿼리가 애초에
  //  나가지 않는다 — 실패할 수 없는 단언이었다. 감사 F-3. `getMarketTotal` 과 DRY_RUN 조회로 바꿨다.)
  expect(getMarketTotal).not.toHaveBeenCalled();
  expect(w.queries.filter((q) => /FROM system_config/i.test(q))).toHaveLength(1);   // 킬스위치 1회뿐
});

/**
 * 🔴 **재확인은 DRY_RUN 분기 뒤에 있다** (감사 M4 — 앞으로 옮기는 변이가 4건 전부 통과했다).
 *
 * DRY_RUN 이면 송신이 없으므로 재확인도 필요 없다. 앞으로 옮기면 DRY_RUN 경로에서도 한 번 더 읽어
 * 쓸데없는 조회가 늘고, "송신 직전" 이라는 의미도 흐려진다. 읽기 횟수로 위치를 고정한다.
 */
test('🔴 DRY_RUN 이면 재확인하지 않는다 — 킬스위치를 1회만 읽는다 (위치 고정)', async () => {
  process.env.DRY_RUN = 'true';
  w.killAnswers = [false, false];
  const realSubmit = jest.fn();
  const r = await submitOrder(domSell, realSubmit);

  expect(realSubmit).not.toHaveBeenCalled();
  expect(r).toMatchObject({ ok: true, dryRun: true, blockedBy: 'dry_run' });
  expect(w.killReads).toBe(1);                     // 앞으로 옮기면 2 가 된다
});

/**
 * 🔴 **해외 주문도 같이 막는다** (감사 M8 — 해외만 건너뛰는 변이가 4건 전부 통과했다).
 * 시험이 국내만 보고 있었다.
 */
test('🔴 해외 주문도 송신 직전 재확인으로 막힌다', async () => {
  const ovsSell: OrderRequest = {
    exchange: 'kis', symbol: 'NAS:AAPL', side: 'sell', type: 'limit',
    price: 200, quantity: 1, amountKRW: 280_000, market: 'overseas',
  };
  w.killAnswers = [false, true];
  const realSubmit = jest.fn();
  const r = await submitOrder(ovsSell, realSubmit);

  expect(realSubmit).not.toHaveBeenCalled();
  expect(r).toMatchObject({ ok: false, blockedBy: 'kill_switch' });
  expect(w.killReads).toBe(2);
});

/**
 * 🔴 **두 관문이 동시에 막을 때 사유가 `kill_switch` 여야 한다** — 순서를 실제로 가르는 유일한 모양이다.
 *
 * 처음에는 매도로 이 시험을 썼는데, 매도는 검증 관문을 I/O 0 으로 통과하므로 **순서를 바꿔도 결과가
 * 같아** 변이가 살아남았다(순서를 뒤로 옮기는 변이 M2 가 4건 전부 통과). 즉 **실패할 수 없는 시험**을
 * 쓴 것이다. 매수 + 송신 직전 강등으로 두 관문이 **둘 다** 막게 만들어야 사유로 순서를 읽을 수 있다.
 *
 * 왜 사유가 중요한가: `blocked_by` 가 알림 등급을 가른다(`kill_switch` = critical, `validation_gate` =
 * warning). 사용자가 비상 제동을 내린 상황에서 운영자가 보는 것이 전략 불만이면 진단이 틀어진다.
 */
test('🔴 두 관문이 동시에 막으면 사유는 kill_switch 다 (재확인 순서)', async () => {
  w.killAnswers = [false, true];                   // 3단계 통과 → 송신 직전에 내려갔다
  w.strategyAnswers = ['backtested', 'unvalidated']; // 6c 통과 → 송신 직전에 강등됐다
  const realSubmit = jest.fn();
  const r = await submitOrder(domBuy, realSubmit, attr);

  expect(realSubmit).not.toHaveBeenCalled();
  expect(r.blockedBy).toBe('kill_switch');         // 뒤로 옮기면 'validation_gate' 가 된다
  expect(w.orderUpdates).toContainEqual({ status: 'blocked', blockedBy: 'kill_switch' });
  expect(sendAlert).toHaveBeenCalledWith('critical', '주문 차단: kill_switch', expect.any(String));
});
