/**
 * /api/cron/edgar-sync · /api/cron/kis-fundamentals-snapshot — 인증 fail-closed·위임·tables_missing 전달·중단 시 503 (T-059 Part A).
 * SAFETY_PATHS(`^src/app/api/cron/`) 대상이라 research-cycle 라우트 시험과 같은 항목을 고정한다.
 *
 * 🔴 T-145 ⑨ — 스냅샷의 **마감 종료는 503 이 아니라 200** 이다. 두 종료를 한 분기로 합치면(`stopped` 를 `aborted` 에
 * 넣거나 라우트가 `complete:false` 를 503 으로 보내면) `job_run_log` 가 **매일 `failed`** 가 되어 「끊고 이어받는
 * 정상 동작」이 실패로 보인다. 그 경계를 아래 두 시험이 양쪽에서 고정한다.
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

describe('🔴 kis-fundamentals-snapshot 마감 종료 (T-145 ⑨)', () => {
  const load = () => import('../kis-fundamentals-snapshot/route');

  test('🔴 마감으로 끊긴 회차는 **200** 이고 본문이 그대로 실린다(503 이 아니다)', async () => {
    const body = { ok: true, stopped: 'budget', complete: false, partial: true, remaining: 17, targets: 54, written: 37 };
    snapMock.mockResolvedValue(body);
    const { POST } = await load();
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(body);
  });

  test('🔴 그 본문을 `classifyRun` 에 먹이면 `partial`(남은 수)이다 — `failed` 가 아니다', () => {
    const { classifyRun } = jest.requireActual('@/lib/strategy/records/job-run-log') as typeof import('@/lib/strategy/records/job-run-log');
    const partial = classifyRun('kis-fundamentals-snapshot', 200, JSON.stringify(
      { ok: true, stopped: 'budget', complete: false, partial: true, remaining: 17 },
    ));
    expect(partial).toMatchObject({ status: 'partial', degradedReason: 'remaining=17' });
    // 끝난 회차는 그대로 `ok`
    const done = classifyRun('kis-fundamentals-snapshot', 200, JSON.stringify(
      { ok: true, complete: true, remaining: 0, targets: 54, written: 54 },
    ));
    expect(done).toMatchObject({ status: 'ok' });
    // 유량 중단은 여전히 `failed`(그 회차는 실패다)
    const aborted = classifyRun('kis-fundamentals-snapshot', 503, JSON.stringify({ ok: false, aborted: 'kis_throttle' }));
    expect(aborted.status).toBe('failed');
  });
});
