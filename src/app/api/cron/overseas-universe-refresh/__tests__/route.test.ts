/**
 * POST /api/cron/overseas-universe-refresh — **관문 시험** (T-143 WP-A · Reviewer M-1).
 *
 * 왜 이 시험이 필요한가: 이 기능의 1차 안전장치는 「꺼져 있으면 외부 호출 0건·표 변경 0건」이다. 그 판단이
 * 라우트 관문에만 있었고 **회귀망이 없었다** — 관문 한 줄이 지워져도 아무 시험이 깨지지 않았다.
 * (developer 의 「관문이 막히면 외부 호출 0건은 시험으로 고정」은 **엔진**의 `fetchSecListing === null` 경우뿐이었다.)
 *
 * 실제 DB·KIS·SEC 호출 0건: 전부 mock. 시각은 가짜 시계로 고정한다(타이머는 실제 — await 가 정상 동작하게).
 * 선례 `src/app/api/cron/daily-bars/__tests__/route.test.ts`.
 */
import type { NextRequest } from 'next/server';

const authMock = jest.fn();
const cfgMock = jest.fn();
const closedMock = jest.fn();
const sessionOpenMock = jest.fn();
const engineMock = jest.fn();
const expireMock = jest.fn();
const notifyMock = jest.fn();
const uaMock = jest.fn();
const masterMock = jest.fn();
const priceMock = jest.fn();
const secCtor = jest.fn();
const partsMock = jest.fn();
const prevPhaseMock = jest.fn();

jest.mock('@/lib/cron-auth', () => ({ checkCronAuth: (...a: unknown[]) => authMock(...a) }));
jest.mock('@/lib/db', () => ({ getPool: () => ({ query: async () => [[], null] }) }));
jest.mock('@/lib/universe/store', () => ({
  readAutoRefreshConfig: (...a: unknown[]) => cfgMock(...a),
  readUniverseParts: (...a: unknown[]) => partsMock(...a),
}));
jest.mock('@/lib/strategy/us-session', () => ({
  loadUsClosedDaysStrict: (...a: unknown[]) => closedMock(...a),
  isUsRegularSessionOpen: (...a: unknown[]) => sessionOpenMock(...a),
  yearsNeededFor: () => [2026],
}));
jest.mock('@/lib/universe/refresh-engine', () => ({
  ...jest.requireActual('@/lib/universe/refresh-engine'),
  runUniverseRefresh: (...a: unknown[]) => engineMock(...a),
}));
jest.mock('@/lib/universe/refresh-store', () => ({
  expireOldRuns: (...a: unknown[]) => expireMock(...a),
  readPrevMonthRunPhase: (...a: unknown[]) => prevPhaseMock(...a),
}));
jest.mock('@/lib/universe/refresh-notify', () => ({ notifyUniverseRefresh: (...a: unknown[]) => notifyMock(...a) }));
jest.mock('@/lib/universe/kis-overseas-master', () => ({ fetchNyseMaster: (...a: unknown[]) => masterMock(...a) }));
jest.mock('@/lib/data/us-edgar/sec-client', () => ({
  readSecUserAgent: () => uaMock(),
  SecClient: class {
    constructor(o: unknown) { secCtor(o); }
    getJson() { throw new Error('이 시험에서 SEC 네트워크를 쓰면 안 된다'); }
  },
}));
jest.mock('@/lib/data/us-edgar/parse', () => ({ toSecTicker: (s: string) => s }));
jest.mock('@/lib/exchanges/kis-overseas', () => ({
  ...jest.requireActual('@/lib/exchanges/kis-overseas'),
  getPriceDetailByExcd: (...a: unknown[]) => priceMock(...a),
}));

import { POST } from '../route';
import { PriceDetailUnavailableError } from '@/lib/exchanges/kis-overseas';
import { KisThrottleQueueFullError } from '@/lib/exchanges/kis-throttle';
import type { RefreshDeps } from '@/lib/universe/refresh-engine';

const req = () => ({ headers: new Headers() } as unknown as NextRequest);
const CFG = { enabled: true, topN: 50, weekday: 0, nth: 1, windowStart: '01:10', windowEnd: '05:50', excludeDr: true };
/** 2026-12-06 = 그 달 첫째 일요일, 01:10 KST(= 미국 토요일이라 정규장 아님) */
const IN_WINDOW = Date.parse('2026-12-06T01:10:00+09:00');

const okResult = (over: Record<string, unknown> = {}) => ({
  ok: true, status: 'listing', final: false, runId: 1, runKey: '2026-12', phase: 'scan',
  progress: null, elapsedMs: 1, ...over,
});

/** 밖으로 나가는 통로가 하나도 쓰이지 않았다 — 관문이 막혔다는 뜻. */
function expectNoWork() {
  expect(engineMock).not.toHaveBeenCalled();
  expect(secCtor).not.toHaveBeenCalled();
  expect(masterMock).not.toHaveBeenCalled();
  expect(priceMock).not.toHaveBeenCalled();
  expect(expireMock).not.toHaveBeenCalled();
  expect(prevPhaseMock).not.toHaveBeenCalled();
  expect(notifyMock).not.toHaveBeenCalled();
}

beforeAll(() => {
  // Date 만 가짜로(타이머는 실제) — 관문이 시각을 어떻게 읽는지 고정한다
  jest.useFakeTimers({
    doNotFake: ['setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'clearInterval', 'clearImmediate',
      'nextTick', 'queueMicrotask', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'],
  });
});
afterAll(() => jest.useRealTimers());

beforeEach(() => {
  jest.clearAllMocks();
  jest.setSystemTime(IN_WINDOW);
  authMock.mockReturnValue(undefined);
  cfgMock.mockResolvedValue({ ...CFG });
  closedMock.mockResolvedValue(new Set<string>());
  sessionOpenMock.mockReturnValue(false);
  engineMock.mockResolvedValue(okResult());
  expireMock.mockResolvedValue({ kind: 'ok', data: 0 });
  prevPhaseMock.mockResolvedValue({ kind: 'ok', data: 'complete' });
  notifyMock.mockResolvedValue({ sent: true });
  uaMock.mockReturnValue('StockInvest bot (dev@example.com)');
  masterMock.mockResolvedValue({ bySymb: new Map(), entries: [], dropped: 0, rows: 0, sha256: 'm' });
  partsMock.mockResolvedValue({ manual: [] });
});

describe('관문 1 — 인증(fail-closed)', () => {
  it('인증 실패면 401 이고 **설정조차 읽지 않는다**', async () => {
    const res = { status: 401 } as unknown as Response;
    authMock.mockReturnValue(res);
    expect(await POST(req())).toBe(res);
    expect(cfgMock).not.toHaveBeenCalled();
    expectNoWork();
  });
});

describe('🔴 관문 2 — 스위치가 꺼져 있으면 아무 일도 하지 않는다', () => {
  it('disabled: 외부 호출 0건 · final:true · 건너뜀으로 기록된다', async () => {
    cfgMock.mockResolvedValue({ ...CFG, enabled: false });
    const body = await (await POST(req())).json();
    expect(body).toMatchObject({
      ok: true, status: 'disabled', skipped: 'universe_disabled', final: true, runKey: '2026-12',
    });
    expectNoWork();
  });

  it('`skipped` 가 빠지면 실행 기록이 「성공」으로 남는다 — 그 필드를 고정한다', async () => {
    cfgMock.mockResolvedValue({ ...CFG, enabled: false });
    const body = await (await POST(req())).json();
    expect(body.skipped).toBe('universe_disabled');
  });
});

describe('🔴 관문 3 — 요일·회차·창', () => {
  it('평일이면 wrong_weekday(외부 호출 0건)', async () => {
    jest.setSystemTime(Date.parse('2026-12-01T01:10:00+09:00'));   // 화요일
    const body = await (await POST(req())).json();
    // 🔴 M-8: `skipped` 가 없으면 classifyRun 이 이 회차를 **성공**으로 분류한다
    expect(body).toMatchObject({ status: 'wrong_weekday', skipped: 'universe_wrong_weekday', final: false });
    expectNoWork();
  });

  it('둘째 일요일이면 wrong_weekday — nth 가 다르다', async () => {
    jest.setSystemTime(Date.parse('2026-12-13T01:10:00+09:00'));
    const body = await (await POST(req())).json();
    expect(body).toMatchObject({ status: 'wrong_weekday', skipped: 'universe_wrong_weekday' });
    expectNoWork();
  });

  it('창 시작 1분 전이면 outside_window', async () => {
    jest.setSystemTime(Date.parse('2026-12-06T01:09:00+09:00'));
    const body = await (await POST(req())).json();
    expect(body).toMatchObject({ status: 'outside_window', skipped: 'universe_outside_window', kst: '01:09' });
    expectNoWork();
  });

  it('창 끝(05:50)은 포함하지 않는다', async () => {
    jest.setSystemTime(Date.parse('2026-12-06T05:50:00+09:00'));
    expect((await (await POST(req())).json()).status).toBe('outside_window');
    jest.setSystemTime(Date.parse('2026-12-06T05:49:00+09:00'));
    expect((await (await POST(req())).json()).status).toBe('listing');
  });

  it('창 판정은 **설정값**을 쓴다 — 설정을 바꾸면 따라간다', async () => {
    cfgMock.mockResolvedValue({ ...CFG, windowStart: '02:00' });
    const body = await (await POST(req())).json();
    expect(body).toMatchObject({ status: 'outside_window' });
    expectNoWork();
  });
});

describe('🔴 관문 4 — 휴장표를 모르면 거부한다', () => {
  it('휴장표 조회가 던지면 calendar_unknown(외부 호출 0건) — 모르는 채로 2,000건을 부르지 않는다', async () => {
    closedMock.mockRejectedValue(new Error('해외 휴장 표에 2026년 행이 없음'));
    const body = await (await POST(req())).json();
    // 🔴 M-8: 뜻이 같은 기존 사유 코드를 재사용한다(사전에 중복 항목을 만들지 않는다)
    expect(body).toMatchObject({ status: 'calendar_unknown', skipped: 'holidays_unknown', final: false });
    expectNoWork();
  });

  it('미국 정규장이 열려 있으면 us_session_open(마지막 방어)', async () => {
    sessionOpenMock.mockReturnValue(true);
    const body = await (await POST(req())).json();
    expect(body).toMatchObject({ status: 'us_session_open', skipped: 'us_session_open', final: false });
    expectNoWork();
  });
});

describe('🔴 관문 5 — 단일 실행', () => {
  it('앞 호출이 끝나기 전의 두 번째 호출은 already_running(엔진 1회만)', async () => {
    let release: (v: unknown) => void = () => {};
    engineMock.mockImplementation(() => new Promise((r) => { release = r; }));
    const first = POST(req());
    const second = await (await POST(req())).json();
    expect(second).toMatchObject({ status: 'already_running', final: false });
    // 🔴 M-8 의 예외: 여기만 `skipped` 를 **싣지 않는다**. 창 안에서 앞 호출이 도는 동안 나는 정상 동작이고,
    //   건너뜀으로 남기면 **정상 산출 중인 슬롯이 건너뜀으로 덮인다**.
    expect(second.skipped).toBeUndefined();
    release(okResult());
    await first;
    expect(engineMock).toHaveBeenCalledTimes(1);
  });

  it('호출이 끝나면 깃발이 풀린다(엔진이 던져도)', async () => {
    engineMock.mockRejectedValueOnce(new Error('boom'));
    expect((await POST(req())).status).toBe(500);
    engineMock.mockResolvedValue(okResult());
    expect((await (await POST(req())).json()).status).toBe('listing');
  });
});

describe('진행·종결 응답', () => {
  it('표가 없으면 건너뜀으로 남고 final:true 다', async () => {
    engineMock.mockResolvedValue(okResult({ status: 'tables_missing', final: true, phase: null }));
    const body = await (await POST(req())).json();
    expect(body).toMatchObject({ status: 'tables_missing', skipped: 'tables_missing', final: true, expiredRuns: 0 });
  });

  it('지난 달 미완료 run 을 닫은 수는 관측용으로 싣는다(분류 근거는 아니다)', async () => {
    expireMock.mockResolvedValue({ kind: 'ok', data: 2 });
    const body = await (await POST(req())).json();
    expect(body.expiredRuns).toBe(2);
  });

  it('🔴 직전 달이 complete 가 아니면 **매 호출** prevMonthIncomplete:true — 슬롯 ODKU 가 덮어쓰지 못하게(r2 ②)', async () => {
    for (const phase of ['expired', 'failed', 'scan', 'listing']) {
      prevPhaseMock.mockResolvedValue({ kind: 'ok', data: phase });
      // 창 안의 서로 다른 세 시각에서 모두 같은 값이어야 한다(한 호출만 켜지면 마지막 호출이 지운다)
      for (const t of ['01:10', '01:14', '05:48']) {
        jest.setSystemTime(Date.parse(`2026-12-06T${t}:00+09:00`));
        expect((await (await POST(req())).json()).prevMonthIncomplete).toBe(true);
      }
    }
  });

  it('직전 달이 complete 거나 아예 없으면 false(첫 달을 「미완료」로 만들지 않는다)', async () => {
    prevPhaseMock.mockResolvedValue({ kind: 'ok', data: 'complete' });
    expect((await (await POST(req())).json()).prevMonthIncomplete).toBe(false);
    prevPhaseMock.mockResolvedValue({ kind: 'ok', data: null });
    expect((await (await POST(req())).json()).prevMonthIncomplete).toBe(false);
  });

  it('직전 달 조회가 실패하면 false — 모름을 「미완료」로 단정하지 않는다', async () => {
    prevPhaseMock.mockResolvedValue({ kind: 'error', error: 'db' });
    expect((await (await POST(req())).json()).prevMonthIncomplete).toBe(false);
    prevPhaseMock.mockResolvedValue({ kind: 'not_migrated' });
    expect((await (await POST(req())).json()).prevMonthIncomplete).toBe(false);
  });

  it('🔴 M-8 관문 거절이 실제로 **건너뜀**으로 분류된다 — classifyRun 에 응답을 그대로 먹여 확인', async () => {
    // 응답 모양만 고정하면 분류기 쪽이 바뀔 때 놓친다. 실제 분류기를 통과시켜 `ok` 가 아님을 못 박는다.
    const { classifyRun } = jest.requireActual('@/lib/strategy/records/job-run-log') as typeof import('@/lib/strategy/records/job-run-log');
    const cases: Array<[string, string]> = [
      ['2026-12-01T01:10:00+09:00', 'skip:universe_wrong_weekday'],
      ['2026-12-06T01:09:00+09:00', 'skip:universe_outside_window'],
    ];
    for (const [iso, wantReason] of cases) {
      jest.setSystemTime(Date.parse(iso));
      const body = await (await POST(req())).text();
      const got = classifyRun('overseas-universe-refresh', 200, body);
      expect([iso, got.status, got.degradedReason]).toEqual([iso, 'skipped', wantReason]);
    }
    // 휴장표 모름도 같은 경로로
    jest.setSystemTime(Date.parse('2026-12-06T02:00:00+09:00'));
    closedMock.mockRejectedValueOnce(new Error('행 없음'));
    const calUnknown = classifyRun('overseas-universe-refresh', 200, await (await POST(req())).text());
    expect([calUnknown.status, calUnknown.degradedReason]).toEqual(['skipped', 'skip:holidays_unknown']);
  });

  it('M-8 거절 사유 코드는 전부 분류어 규칙(^[a-z][a-z0-9_]{0,47}$)을 만족한다 — codeWord 가 버리면 사유가 사라진다', () => {
    for (const c of ['universe_disabled', 'universe_wrong_weekday', 'universe_outside_window', 'holidays_unknown', 'us_session_open', 'tables_missing']) {
      expect(c).toMatch(/^[a-z][a-z0-9_]{0,47}$/);
    }
  });

  it('표 없음 응답에도 두 필드가 실린다', async () => {
    prevPhaseMock.mockResolvedValue({ kind: 'ok', data: 'expired' });
    engineMock.mockResolvedValue(okResult({ status: 'tables_missing', final: true, phase: null }));
    const body = await (await POST(req())).json();
    expect(body).toMatchObject({ skipped: 'tables_missing', expiredRuns: 0, prevMonthIncomplete: true });
  });

  it('만료 조회가 실패해도 산출은 진행한다(expiredRuns 0)', async () => {
    expireMock.mockResolvedValue({ kind: 'error', error: 'db' });
    const body = await (await POST(req())).json();
    expect(body).toMatchObject({ status: 'listing', expiredRuns: 0 });
  });

  it('complete 면 알림을 1회 부르고 **1회차 신호를 넘긴다**(high-2)', async () => {
    engineMock.mockResolvedValue(okResult({
      status: 'complete', final: true, phase: 'complete',
      changes: { added: [], removed: [], proposalsCreated: 0, firstRun: true, top: ['NYS:A', 'NYS:B'] },
    }));
    await POST(req());
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock.mock.calls[0][0]).toMatchObject({
      runId: 1, added: [], removed: [], firstRun: true, top: ['NYS:A', 'NYS:B'],
    });
  });

  it('complete 가 아니면 알림을 부르지 않는다', async () => {
    engineMock.mockResolvedValue(okResult({ status: 'scan_partial' }));
    await POST(req());
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('알림이 던져도 산출 응답은 그대로다(알림 실패로 run 을 되돌리지 않는다)', async () => {
    engineMock.mockResolvedValue(okResult({ status: 'complete', final: true, phase: 'complete' }));
    notifyMock.mockRejectedValue(new Error('telegram down'));
    const body = await (await POST(req())).json();
    expect(body).toMatchObject({ status: 'complete', final: true });
  });

  it('엔진이 던지면 500 + 분류 가능한 본문', async () => {
    engineMock.mockRejectedValue(new Error('boom'));
    const res = await POST(req());
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false, status: 'failed' });
  });
});

describe('🔴 엔진에 넘기는 deps — 선언 User-Agent 가 없으면 SEC 통로를 아예 만들지 않는다', () => {
  function depsOf(): RefreshDeps {
    return engineMock.mock.calls[0][0] as RefreshDeps;
  }

  it('UA 가 없으면 `fetchSecListing` 이 null 이고 SecClient 를 만들지 않는다', async () => {
    uaMock.mockReturnValue(null);
    await POST(req());
    expect(depsOf().fetchSecListing).toBeNull();
    expect(secCtor).not.toHaveBeenCalled();
  });

  it('UA 가 있으면 SecClient 를 그 값으로 만든다(연락처는 단언하지 않는다)', async () => {
    await POST(req());
    expect(depsOf().fetchSecListing).not.toBeNull();
    expect(secCtor).toHaveBeenCalledTimes(1);
  });

  it('설정의 topN·excludeDr 를 그대로 넘긴다', async () => {
    cfgMock.mockResolvedValue({ ...CFG, topN: 30, excludeDr: false });
    await POST(req());
    expect(engineMock.mock.calls[0][1]).toEqual({ topN: 30, excludeDr: false });
    expect(engineMock.mock.calls[0][2]).toBe('2026-12');
  });

  describe('🔴 fetchPrice 의 오류 분류 — 스로틀을 「조회 불가」로 오해하면 그 종목이 영구히 빠진다', () => {
    const fetchPrice = async () => {
      await POST(req());
      return (engineMock.mock.calls[0][0] as RefreshDeps).fetchPrice('BRK/B');
    };

    it('정상 응답 → ok(원값만 추려 넘긴다)', async () => {
      priceMock.mockResolvedValue({
        marketCap: 1e11, shares: 1e9, lastPrice: 100, currency: 'USD', etpType: null, raw: { rsym: 'DNYSBRK/B' },
      });
      await expect(fetchPrice()).resolves.toEqual({
        kind: 'ok',
        values: { tomv: 1e11, shar: 1e9, last: 100, curr: 'USD', etypNm: null, rsym: 'DNYSBRK/B' },
      });
      expect(priceMock).toHaveBeenCalledWith('NYS', 'BRK/B');
    });

    it('「판정 불가」 → missing(상장폐지·표기 불일치 — 재시도하지 않는다)', async () => {
      priceMock.mockRejectedValue(new PriceDetailUnavailableError('HHDFS76200200 NYS:X 판정 불가 — output 없음'));
      await expect(fetchPrice()).resolves.toMatchObject({ kind: 'missing' });
    });

    it('🔴 레이트리밋 → throttled(missing 이 아니다 — 그러면 그 종목이 영구히 빠진다)', async () => {
      priceMock.mockRejectedValue(new PriceDetailUnavailableError('KIS overseas priceDetail NYS:X: 429 (레이트리밋 — 백오프 재시도 소진)'));
      await expect(fetchPrice()).resolves.toMatchObject({ kind: 'throttled' });
    });

    it('스로틀 대기열·시간 초과 → throttled', async () => {
      priceMock.mockRejectedValue(new KisThrottleQueueFullError('bulk', 99));
      await expect(fetchPrice()).resolves.toMatchObject({ kind: 'throttled' });
    });

    it('그 밖(네트워크·토큰·HTTP) → error(retry 단계가 한 번 더 본다)', async () => {
      priceMock.mockRejectedValue(new Error('ECONNRESET'));
      await expect(fetchPrice()).resolves.toMatchObject({ kind: 'error' });
      priceMock.mockRejectedValue(new PriceDetailUnavailableError('KIS overseas priceDetail NYS:X: 500'));
      jest.clearAllMocks();
      authMock.mockReturnValue(undefined);
      cfgMock.mockResolvedValue({ ...CFG });
      closedMock.mockResolvedValue(new Set<string>());
      sessionOpenMock.mockReturnValue(false);
      engineMock.mockResolvedValue(okResult());
      expireMock.mockResolvedValue({ kind: 'ok', data: 0 });
      uaMock.mockReturnValue('x (a@b.c)');
      priceMock.mockRejectedValue(new PriceDetailUnavailableError('KIS overseas priceDetail NYS:X: 500'));
      await expect(fetchPrice()).resolves.toMatchObject({ kind: 'error' });
    });

    it('오류 메시지는 150자로 자른다(응답 원문이 기록에 길게 들어가지 않게)', async () => {
      priceMock.mockRejectedValue(new Error('x'.repeat(400)));
      const r = await fetchPrice();
      expect(r.kind).toBe('error');
      expect(r.kind === 'error' && r.error.length).toBeLessThanOrEqual(150);
    });
  });
});
