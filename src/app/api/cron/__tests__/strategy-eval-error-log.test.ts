/**
 * T-175 WP-3 — strategy-eval 이 실패하면 **원인 코드·주소**를 로그에 남긴다(응답 형식·500 은 그대로).
 *
 * 2026-11-18 12:11 `{"ok":false,"error":"fetch failed"}` 로 끝난 회차는 라우트가 `e.message` 만 찍어 어느 외부 호출(호스트)이
 * runAll 을 멈췄는지 알 수 없었다. 러너·job_run_log 는 응답 본문을 읽으므로 본문은 바꾸지 않는다.
 */
const runAllMock = jest.fn();
jest.mock('@/lib/strategy/engine', () => ({ runAll: (...a: unknown[]) => runAllMock(...a) }));
jest.mock('@/lib/safety/order-sync', () => ({
  syncPendingOrders: jest.fn(async () => ({
    synced: 0, errors: [], skipped: 0, complete: true,
    marketsOk: ['domestic', 'overseas'], marketsFailed: [], unreconciled: [],
    staleCount: 0, oldestUnreconciledMs: 0, partialSettlements: [], completenessUnverified: 0,
  })),
}));
jest.mock('@/lib/cron-auth', () => ({ checkCronAuth: jest.fn(() => null) }));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/cron/strategy-eval/route';

const req = () => new NextRequest('http://localhost:3003/api/cron/strategy-eval', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
});

function happyEyeballsFailure() {
  const sys = (code: string, address: string) =>
    Object.assign(new Error(`connect ${code} ${address}:443`), { code, syscall: 'connect', address, port: 443 });
  const agg = Object.assign(new AggregateError([sys('ETIMEDOUT', '203.0.113.7'), sys('ENETUNREACH', '2001:db8::7')], ''), { code: 'ETIMEDOUT' });
  return new TypeError('fetch failed', { cause: agg });
}

let errSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const evalLogCalls = () => errSpy.mock.calls.filter((c) => c[0] === '[cron/strategy-eval]');

describe('strategy-eval 실패 로그 — 원인 코드·주소', () => {
  test('🔴 fetch failed(AggregateError) → 응답은 그대로 500 {ok:false,error}, 로그에 주소별 코드', async () => {
    runAllMock.mockRejectedValue(happyEyeballsFailure());
    const res = await POST(req());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: 'fetch failed' });
    expect(evalLogCalls()).toEqual([[
      '[cron/strategy-eval]', 'fetch failed',
      '| cause=ETIMEDOUT cause.errors=[ETIMEDOUT connect 203.0.113.7:443, ENETUNREACH connect 2001:db8::7:443]',
    ]]);
  });

  test('원인 정보가 없는 일반 Error → 이전과 같은 두 인자 로그', async () => {
    runAllMock.mockRejectedValue(new Error('db down'));
    const res = await POST(req());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: 'db down' });
    expect(evalLogCalls()).toEqual([['[cron/strategy-eval]', 'db down']]);
  });

  test('Error 가 아닌 값이 던져져도 500 · 로그에 종류', async () => {
    runAllMock.mockRejectedValue('boom');
    const res = await POST(req());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: 'boom' });
    expect(evalLogCalls()).toEqual([['[cron/strategy-eval]', 'boom', '| thrown=string']]);
  });

  test('🔴 원인 메시지의 쿼리스트링·토큰은 로그에서 가린다(응답 본문은 e.message 그대로 — 이전과 같음)', async () => {
    runAllMock.mockRejectedValue(new TypeError('fetch failed', {
      cause: new Error('GET https://openapi.example.com/x?appkey=SECRETKEY bot987:TOKval failed'),
    }));
    const res = await POST(req());
    expect(await res.json()).toEqual({ ok: false, error: 'fetch failed' });
    const line = evalLogCalls()[0].join(' ');
    expect(line).not.toMatch(/SECRETKEY|TOKval/);
    expect(line).toContain('?***');
  });

  test('성공 경로는 바뀌지 않는다', async () => {
    runAllMock.mockResolvedValue({ ran: 1, skipped: 0, skippedStrategyIds: [], results: [], errors: [], universeRefreshed: false });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, ran: 1 });
    expect(evalLogCalls()).toEqual([]);
  });
});
