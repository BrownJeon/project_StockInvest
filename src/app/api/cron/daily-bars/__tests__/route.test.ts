/**
 * POST /api/cron/daily-bars — 수동 일봉 수집 라우트 시험 (T-070).
 * 실제 DB·KIS 호출 없음: cron-auth·db·수집기 본체·오프아워 판정은 mock.
 * 확인: 인증 실패면 아무것도 하지 않는다 · 본문 검증 · 오프아워 밖 409(호출 0) · 중단 시 503 · 본문 옵션 전달.
 */
import type { NextRequest } from 'next/server';

const authMock = jest.fn();
const poolMock = { query: jest.fn(() => { throw new Error('라우트는 DB 를 직접 쓰지 않는다'); }) };
const getPoolMock = jest.fn(() => poolMock);
const runMock = jest.fn();
const windowMock = jest.fn();

jest.mock('@/lib/cron-auth', () => ({ checkCronAuth: (...a: unknown[]) => authMock(...a) }));
jest.mock('@/lib/db', () => ({ getPool: () => getPoolMock() }));
jest.mock('@/lib/profit-engine/daily-bars-collector', () => ({
  ...jest.requireActual('@/lib/profit-engine/daily-bars-collector'),
  runDailyBarsCollect: (...a: unknown[]) => runMock(...a),
}));
jest.mock('@/lib/profit-engine/daily-bars-time', () => ({
  ...jest.requireActual('@/lib/profit-engine/daily-bars-time'),
  checkOffHoursWindow: (...a: unknown[]) => windowMock(...a),
}));
// 수집기 실제 모듈이 끌어오는 KIS 경로 — 이 시험에서는 절대 불리면 안 된다
jest.mock('@/lib/exchanges/kis-http', () => ({ kisFetch: () => { throw new Error('KIS 호출 금지'); }, isKisRateLimited: () => false }));
jest.mock('@/lib/exchanges/kis-auth', () => ({ getKisToken: () => { throw new Error('토큰 금지'); }, kisBaseUrl: () => 'x' }));

import { POST } from '../route';
import { parseDailyBarsBody } from '@/lib/profit-engine/daily-bars-request';

function req(body?: string): NextRequest {
  return { headers: new Headers(), text: async () => body ?? '' } as unknown as NextRequest;
}

beforeEach(() => {
  authMock.mockReset().mockReturnValue(undefined);
  getPoolMock.mockClear();
  runMock.mockReset().mockResolvedValue({ ok: true, targets: 0, symbols: [], remaining: [] });
  windowMock.mockReset().mockReturnValue({ ok: true, kst: '06:30' });
});

describe('인증', () => {
  test('인증 실패면 401 그대로, 본문·DB·수집기·시각 판정 모두 건드리지 않는다', async () => {
    const unauthorized = new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401 });
    authMock.mockReturnValue(unauthorized);
    const textSpy = jest.fn(async () => '{"years":3}');
    const r = await POST({ headers: new Headers(), text: textSpy } as unknown as NextRequest);
    expect(r.status).toBe(401);
    expect(textSpy).not.toHaveBeenCalled();
    expect(getPoolMock).not.toHaveBeenCalled();
    expect(runMock).not.toHaveBeenCalled();
    expect(windowMock).not.toHaveBeenCalled();
  });
});

describe('본문 검증 — 오류면 400, 수집기 호출 0', () => {
  test.each([
    ['깨진 JSON', '{years:'],
    ['모르는 키', '{"force":true}'],
    ['배열 본문', '[1]'],
    ['심볼 형식', '{"symbols":["MU"]}'],
    ['심볼 거래소', '{"symbols":["HKS:00700"]}'],
    ['빈 심볼 목록', '{"symbols":[]}'],
    ['심볼 32자 초과(R-9c)', `{"symbols":["NAS:${'A'.repeat(29)}"]}`],
    ['years 범위', '{"years":6}'],
    ['years 정수', '{"years":2.5}'],
    ['maxCalls 0', '{"maxCalls":0}'],
    ['maxCalls 상한', '{"maxCalls":601}'],
  ])('%s', async (_n, body) => {
    const r = await POST(req(body));
    expect(r.status).toBe(400);
    expect(runMock).not.toHaveBeenCalled();
    expect(getPoolMock).not.toHaveBeenCalled();
  });

  test('심볼 길이 32자까지는 허용(R-9c 경계)', () => {
    expect(parseDailyBarsBody({ symbols: [`NAS:${'A'.repeat(28)}`] }).ok).toBe(true);
    expect(parseDailyBarsBody({ symbols: [`NAS:${'A'.repeat(29)}`] }).ok).toBe(false);
  });
  test('심볼 300개 초과 거부', () => {
    const symbols = Array.from({ length: 301 }, (_, i) => String(100000 + i));
    expect(parseDailyBarsBody({ symbols }).ok).toBe(false);
  });
  test('정상 본문은 중복 심볼을 합쳐 전달', () => {
    expect(parseDailyBarsBody({ symbols: ['NAS:MU', 'NAS:MU', '005930', 'NYS:BRK.B'], years: 3, maxCalls: 40 }))
      .toEqual({ ok: true, opts: { symbols: ['NAS:MU', '005930', 'NYS:BRK.B'], years: 3, maxCalls: 40 } });
    expect(parseDailyBarsBody(null)).toEqual({ ok: true, opts: {} });
  });
});

describe('오프아워', () => {
  test('창 밖이면 409, DB·수집기 호출 0', async () => {
    windowMock.mockReturnValue({ ok: false, kst: '10:15', reason: 'outside_window' });
    const r = await POST(req('{"years":3}'));
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ ok: false, skipped: 'outside_offhours', reason: 'outside_window', kst: '10:15' });
    expect(getPoolMock).not.toHaveBeenCalled();
    expect(runMock).not.toHaveBeenCalled();
  });
});

describe('실행', () => {
  test('빈 본문 = 기본값, 풀과 옵션을 수집기에 넘긴다', async () => {
    const r = await POST(req(''));
    expect(r.status).toBe(200);
    expect(runMock).toHaveBeenCalledWith({ db: poolMock }, {});
  });
  test('옵션 전달', async () => {
    await POST(req('{"symbols":["NAS:MU"],"years":5,"maxCalls":12}'));
    expect(runMock.mock.calls[0][1]).toEqual({ symbols: ['NAS:MU'], years: 5, maxCalls: 12 });
  });
  test('유량·레이트리밋·인증 중단은 503, 연속 실패 중단은 200(결과에 aborted)', async () => {
    runMock.mockResolvedValueOnce({ ok: false, aborted: 'kis_throttle' });
    expect((await POST(req())).status).toBe(503);
    runMock.mockResolvedValueOnce({ ok: false, aborted: 'kis_rate_limited' });
    expect((await POST(req())).status).toBe(503);
    runMock.mockResolvedValueOnce({ ok: false, aborted: 'consecutive_failures' });
    expect((await POST(req())).status).toBe(200);
  });
  test('이미 실행 중이면 409', async () => {
    runMock.mockResolvedValueOnce({ ok: false, skipped: 'already_running' });
    expect((await POST(req())).status).toBe(409);
  });
  test('테이블 미적용 결과는 200 그대로', async () => {
    runMock.mockResolvedValueOnce({ ok: true, skipped: 'tables_missing', missing: ['daily_bars'] });
    const r = await POST(req());
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, skipped: 'tables_missing', missing: ['daily_bars'] });
  });
  test('수집기 예외는 500', async () => {
    runMock.mockRejectedValueOnce(new Error('db down'));
    const r = await POST(req());
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ ok: false, error: 'db down' });
  });
});
