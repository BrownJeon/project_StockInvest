/**
 * POST /api/cron/job-run-log (T-112) — 라우트 시험. 기록기(`recordSpoolBatch`)는 목으로 막고 인증·크기 제한·응답 코드만 본다(DB 없음).
 *  1. 🔴 인증: x-cron-secret 없음·틀림 → 401, 기록기 미호출(진짜 checkCronAuth 사용 — 목 아님)
 *  2. 크기: content-length 1MiB 초과 → 413(본문 안 읽음), 실제 본문 1MiB 초과 → 413, 500줄 초과 → 413
 *  3. 결과 → 응답: ok·skipped_disabled·skipped_no_table → 200(러너가 스풀을 비운다), failed → 503(러너가 남긴다)
 *  4. 본문 읽기 실패 → 503 분류어(원문 오류 미노출)
 */
const recordMock = jest.fn();
jest.mock('@/lib/db', () => ({ getPool: () => { throw new Error('운영 풀 사용 금지(시험)'); } }));
jest.mock('@/lib/strategy/records/job-run-log', () => {
  const actual = jest.requireActual('@/lib/strategy/records/job-run-log');
  return { ...actual, recordSpoolBatch: (...a: unknown[]) => recordMock(...a) };
});

import type { NextRequest } from 'next/server';
import { JRL_MAX_BODY_BYTES, JRL_MAX_LINES } from '@/lib/strategy/records/job-run-log';

// cron-auth 는 모듈을 읽을 때 CRON_SECRET 을 잡는다 — 환경변수를 먼저 두고 라우트를 늦게 읽는다(진짜 checkCronAuth 를 쓰려고).
let POST: (r: NextRequest) => Promise<Response>;
beforeAll(async () => {
  process.env.CRON_SECRET = 'test-cron-secret';
  ({ POST } = await import('../route'));
});

function req(body: string, headers: Record<string, string> = { 'x-cron-secret': 'test-cron-secret' }, textImpl?: () => Promise<string>): NextRequest {
  const h = new Headers(headers);
  return { headers: h, text: textImpl ?? (async () => body) } as unknown as NextRequest;
}
const OKR = { status: 'ok', received: 1, rejected: 0, runRows: 1, rollupRows: 0, rowErrors: 0 };

beforeEach(() => {
  recordMock.mockReset();
  recordMock.mockResolvedValue(OKR);
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('🔴 인증', () => {
  it.each([[{}], [{ 'x-cron-secret': 'wrong' }], [{ 'x-cron-secret': '' }]])('헤더 %p → 401, 기록기 미호출', async (h) => {
    const r = await POST(req('v1\tx', h as Record<string, string>));
    expect(r.status).toBe(401);
    expect(recordMock).not.toHaveBeenCalled();
  });
  it('맞는 비밀 → 기록기 호출(본문 그대로)', async () => {
    const r = await POST(req('line1\nline2\n'));
    expect(r.status).toBe(200);
    expect(recordMock).toHaveBeenCalledWith('line1\nline2\n');
    await expect(r.json()).resolves.toMatchObject({ ok: true, status: 'ok' });
  });
});

describe('크기 제한', () => {
  it('content-length 가 상한을 넘으면 본문을 읽지 않고 413', async () => {
    const text = jest.fn(async () => 'x');
    const r = await POST(req('', { 'x-cron-secret': 'test-cron-secret', 'content-length': String(JRL_MAX_BODY_BYTES + 1) }, text));
    expect(r.status).toBe(413);
    expect(text).not.toHaveBeenCalled();
    expect(recordMock).not.toHaveBeenCalled();
  });
  it('실제 본문 바이트가 상한을 넘으면 413(한글은 3바이트로 센다)', async () => {
    const r = await POST(req('가'.repeat(Math.floor(JRL_MAX_BODY_BYTES / 3) + 1)));
    expect(r.status).toBe(413);
    expect(recordMock).not.toHaveBeenCalled();
  });
  it(`${JRL_MAX_LINES}줄은 받고 ${JRL_MAX_LINES + 1}줄은 413(끝 줄바꿈 유무 무관)`, async () => {
    expect((await POST(req('a\n'.repeat(JRL_MAX_LINES)))).status).toBe(200);
    expect((await POST(req(`${'a\n'.repeat(JRL_MAX_LINES)}a`))).status).toBe(413);
    expect((await POST(req('a\n'.repeat(JRL_MAX_LINES + 1)))).status).toBe(413);
  });
});

describe('결과 → 응답 코드(러너는 200 일 때만 스풀을 비운다)', () => {
  it.each([['skipped_disabled'], ['skipped_no_table']])('%s → 200', async (status) => {
    recordMock.mockResolvedValue({ ...OKR, status, runRows: 0 });
    const r = await POST(req('x'));
    expect(r.status).toBe(200);
    await expect(r.json()).resolves.toMatchObject({ ok: true, status });
  });
  it.each([['timeout'], ['db_error'], ['switch_unreadable']])('failed(%s) → 503', async (reason) => {
    recordMock.mockResolvedValue({ ...OKR, status: 'failed', reason });
    const r = await POST(req('x'));
    expect(r.status).toBe(503);
    await expect(r.json()).resolves.toMatchObject({ ok: false, status: 'failed', reason });
  });
  it('본문 읽기 실패 → 503 분류어, 원문 오류는 응답에 없다', async () => {
    const r = await POST(req('', undefined, async () => { throw new Error('/home/brownjeon/.env secret path'); }));
    expect(r.status).toBe(503);
    const j = await r.json();
    expect(j).toEqual({ ok: false, status: 'failed', reason: 'request_error' });
    expect(JSON.stringify(j)).not.toContain('.env');
  });
});

describe('관례', () => {
  it('dynamic = force-dynamic, POST 만 export', async () => {
    const mod = await import('../route');
    expect(mod.dynamic).toBe('force-dynamic');
    expect(Object.keys(mod).sort()).toEqual(['POST', 'dynamic']);
  });
});
