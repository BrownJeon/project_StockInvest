/**
 * /api/cron/research-cycle-{domestic,overseas} — 인증 fail-closed + 위임 검증 (T-032).
 *
 * 이 두 라우트는 SAFETY_PATHS 대상(`^src/app/api/cron/`)이다. 주문을 내지 않는 조회 전용
 * 작업이지만 무인 실행 경로이므로 다음을 회귀 검증한다:
 *  1. `checkCronAuth()` 가 거부하면 본체를 **절대** 실행하지 않는다
 *  2. 시장 인자를 각각 domestic / overseas 로 고정 전달한다
 *  3. 본체 예외를 500 으로 흡수하고 프로세스를 죽이지 않는다
 */
import { NextResponse, type NextRequest } from 'next/server';

const authMock = jest.fn<NextResponse | undefined, unknown[]>();
const runMock = jest.fn();

jest.mock('@/lib/cron-auth', () => ({ checkCronAuth: (...a: unknown[]) => authMock(...a) }));
jest.mock('@/lib/research/run-cycle', () => ({ runResearchCycle: (...a: unknown[]) => runMock(...a) }));

const req = {} as NextRequest;

function result(market: string) {
  return { market, runDate: '2026-08-19', total: 2, succeeded: 2, failed: 0, failures: [], durationMs: 12 };
}

beforeEach(() => {
  authMock.mockReset();
  runMock.mockReset();
  authMock.mockReturnValue(undefined);
});

describe.each([
  ['domestic', () => import('../research-cycle-domestic/route')],
  ['overseas', () => import('../research-cycle-overseas/route')],
] as const)('research-cycle-%s', (market, load) => {
  test('🔴 인증 실패 시 본체를 실행하지 않고 401 을 그대로 돌려준다', async () => {
    const unauthorized = NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    authMock.mockReturnValue(unauthorized);

    const { POST } = await load();
    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(runMock).not.toHaveBeenCalled();
  });

  test(`인증 통과 시 '${market}' 로 사이클을 실행한다`, async () => {
    runMock.mockResolvedValue(result(market));
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const { POST } = await load();
    const res = await POST(req);
    const body = await res.json();

    expect(runMock).toHaveBeenCalledWith(market);
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.market).toBe(market);
    expect(body.total).toBe(2);
    spy.mockRestore();
  });

  test('본체 예외는 500 으로 흡수한다', async () => {
    runMock.mockRejectedValue(new Error('db down'));
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { POST } = await load();
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/db down/);
    logSpy.mockRestore();
    errSpy.mockRestore();
  });
});
