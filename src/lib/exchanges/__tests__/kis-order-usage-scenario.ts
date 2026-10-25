/**
 * T-040 — 주문 경로(`submitOrder` → 국내 `createOrder` → `kisFetch`)가 호출 기록 유무와 무관하게
 * **같은 결과·같은 DB 기록**을 내는지 보는 공용 시나리오(시험 파일 아님).
 *
 * DB(`@/lib/db`)·KIS 토큰(`../kis-auth`)·자격증명(`@/lib/credentials`)은 각 시험 파일이 jest.mock 으로 바꾸고,
 * 그 mock 함수를 여기 넘긴다. 외부 HTTP 는 전역 fetch 를 갈아 끼워 KIS 주문 응답만 흉내 낸다.
 */
import type { OrderRequest, OrderResult } from '../types';
import { __resetKisThrottleForTest } from '../kis-throttle';

export interface OrderPathCapture {
  result: OrderResult;
  /** orders UPDATE 의 SQL 과 파라미터, trade_logs 이벤트 순서 — 안전층이 남기는 감사 기록 */
  updates: Array<{ sql: string; params: unknown[] }>;
  events: string[];
  fetchCalls: number;
}

export type OrderKisReply = { status: number; body: string } | 'throw-network';

/**
 * 매도 지정가 1주(한도 검사·변동성 가드를 건너뛰는 청산 경로 — 외부 의존이 가장 적다).
 * 매도/매수 모두 `createOrder` 의 같은 `kisFetch` 호출을 지난다.
 */
export const SELL_REQ: OrderRequest = {
  exchange: 'kis', symbol: '005930', side: 'sell', type: 'limit', price: 70_000, quantity: 1, market: 'domestic',
};

export async function runOrderPath(deps: {
  submitOrder: (req: OrderRequest, real: (r: OrderRequest) => Promise<OrderResult>) => Promise<OrderResult>;
  createOrder: (r: OrderRequest) => Promise<OrderResult>;
  getPool: jest.Mock;
  getAccountId: jest.Mock;
  dryRun: boolean;
  killSwitch?: boolean;
  reply: OrderKisReply;
}): Promise<OrderPathCapture> {
  const updates: OrderPathCapture['updates'] = [];
  const events: string[] = [];
  let nextId = 5000;
  const query = jest.fn(async (sqlArg: unknown, paramsArg: unknown[] = []) => {
    const sql = String(sqlArg);
    const params = paramsArg ?? [];
    if (/INSERT INTO orders/i.test(sql)) return [{ insertId: nextId++ }];
    if (/INSERT INTO trade_logs/i.test(sql)) { events.push(String(params[1])); return [{}]; }
    if (/UPDATE orders/i.test(sql)) { updates.push({ sql, params }); return [{}]; }
    if (/FROM system_config/i.test(sql)) {
      if (params[0] === 'safety_dry_run') return [[{ value: JSON.stringify(deps.dryRun) }]];
      if (params[0] === 'safety_kill_switch') return [[{ value: JSON.stringify(deps.killSwitch === true) }]];
      return [[]];
    }
    return [[]];
  });
  deps.getPool.mockReturnValue({ query });
  deps.getAccountId.mockResolvedValue(1);

  const original = global.fetch;
  let calls = 0;
  (global as unknown as { fetch: unknown }).fetch = async () => {
    calls += 1;
    if (deps.reply === 'throw-network') {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) });
    }
    return new Response(deps.reply.body, { status: deps.reply.status, headers: { 'content-type': 'application/json' } });
  };
  __resetKisThrottleForTest(1000);
  try {
    const result = await deps.submitOrder(SELL_REQ, deps.createOrder);
    // clientOrderId 는 실행마다 다른 UUID 라 비교에서 뺀다(모양만 확인).
    const { clientOrderId, ...rest } = result as OrderResult & { clientOrderId?: string };
    if (clientOrderId !== undefined) expect(typeof clientOrderId).toBe('string');
    return {
      result: rest as OrderResult,
      updates: updates.map((u) => ({ sql: u.sql, params: u.params.map((p) => (typeof p === 'string' && /^co-/.test(p) ? 'co-*' : p)) })),
      events,
      fetchCalls: calls,
    };
  } finally {
    (global as unknown as { fetch: unknown }).fetch = original;
    __resetKisThrottleForTest();
  }
}

export const ORDER_REPLIES: Record<string, OrderKisReply> = {
  accepted: { status: 200, body: '{"rt_cd":"0","msg1":"주문 전송 완료","output":{"ODNO":"0000123456","ORD_TMD":"101500"}}' },
  rejected: { status: 200, body: '{"rt_cd":"1","msg_cd":"APBK0013","msg1":"주문가능수량을 초과 했습니다"}' },
  http500: { status: 500, body: '{"rt_cd":"1","msg_cd":"EGW00000","msg1":"서버 오류"}' },
  network: 'throw-network',
};
