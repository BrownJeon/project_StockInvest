/**
 * /api/cron/edgar-sync · /api/cron/kis-fundamentals-snapshot — 인증 fail-closed·위임·tables_missing 전달·중단 시 503 (T-059 Part A).
 * SAFETY_PATHS(`^src/app/api/cron/`) 대상이라 research-cycle 라우트 시험과 같은 항목을 고정한다.
 */
import { NextResponse, type NextRequest } from 'next/server';

const authMock = jest.fn<NextResponse | undefined, unknown[]>();
const edgarMock = jest.fn();
const snapMock = jest.fn();
jest.mock('@/lib/cron-auth', () => ({ checkCronAuth: (...a: unknown[]) => authMock(...a) }));
jest.mock('@/lib/db', () => ({ getPool: () => ({ query: jest.fn() }) }));
jest.mock('@/lib/data/us-edgar/sync-job', () => ({ runEdgarSync: (...a: unknown[]) => edgarMock(...a) }));
jest.mock('@/lib/data/kis-fundamentals-snapshot', () => ({ runKisFundamentalsSnapshot: (...a: unknown[]) => snapMock(...a) }));

const req = {} as NextRequest;
beforeEach(() => {
  authMock.mockReset(); edgarMock.mockReset(); snapMock.mockReset();
  authMock.mockReturnValue(undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe.each([
  ['edgar-sync', () => import('../edgar-sync/route'), edgarMock, { ok: false, aborted: 'sec_blocked' }],
  ['kis-fundamentals-snapshot', () => import('../kis-fundamentals-snapshot/route'), snapMock, { ok: false, aborted: 'kis_throttle' }],
] as const)('%s', (_name, load, run, abortedBody) => {
  test('🔴 인증 실패면 본체를 실행하지 않고 401', async () => {
    authMock.mockReturnValue(NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 }));
    const { POST } = await load();
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  test('테이블 미적용이면 200 + skipped:tables_missing 를 그대로(크래시 없음)', async () => {
    run.mockResolvedValue({ ok: true, skipped: 'tables_missing', missing: ['x'] });
    const { POST } = await load();
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, skipped: 'tables_missing', missing: ['x'] });
  });

  test('외부 차단으로 중단하면 503(cron-runner 로그에 본문이 남는다)', async () => {
    run.mockResolvedValue(abortedBody);
    const { POST } = await load();
    expect((await POST(req)).status).toBe(503);
  });

  test('본체 예외는 500 으로 흡수', async () => {
    run.mockRejectedValue(new Error('boom'));
    const { POST } = await load();
    const res = await POST(req);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: 'boom' });
  });
});
