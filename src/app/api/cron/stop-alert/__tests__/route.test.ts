/**
 * /api/cron/stop-alert — 손절가 도달 알림 라우트 시험 (T-068 WP-C).
 *
 * 실제 DB·KIS·텔레그램 호출 없음: `@/lib/db` 는 가짜 풀, `kis.getTicker`·`dispatchAlert` 는 mock.
 * 합성 종목(AAA·BBB·CCC·NAS:ZZZ)과 합성 가격만 쓴다.
 */
import type { NextRequest } from 'next/server';

const authMock = jest.fn();
const dispatchMock = jest.fn();
const labelMock = jest.fn(async (s: string) => `라벨-${s}`);
const tickerMock = jest.fn();
const domesticOpenMock = jest.fn();

jest.mock('@/lib/cron-auth', () => ({ checkCronAuth: (...a: unknown[]) => authMock(...a) }));
jest.mock('@/lib/notify', () => ({
  dispatchAlert: (...a: unknown[]) => dispatchMock(...a),
  getSymbolLabel: (s: string) => labelMock(s),
  sendAlert: () => { throw new Error('sendAlert 는 쓰지 않는다(결과 확인 불가)'); },
}));
jest.mock('@/lib/exchanges/kis', () => ({
  kis: {
    getTicker: (s: string) => tickerMock(s),
    createOrder: () => { throw new Error('주문 금지'); },
    cancelOrder: () => { throw new Error('주문 금지'); },
    getBalances: () => { throw new Error('잔고 조회 금지'); },
  },
}));
jest.mock('@/lib/strategy/market-hours', () => ({
  ...jest.requireActual('@/lib/strategy/market-hours'),
  isDomesticOpen: (...a: unknown[]) => domesticOpenMock(...a),
}));

// ─── 가짜 DB ────────────────────────────────────────────────────────────────
interface Db {
  config: Map<string, string>;
  positions: { symbol: string; market: string; entry_price: number; peak_price: number; qty: number | null }[];
  usHolidayYears: number[];
  queries: { sql: string; params: unknown[] }[];
  failSave?: boolean;
}
let db: Db;

function fakePool() {
  return {
    query: jest.fn(async (sqlArg: unknown, paramsArg: unknown[] = []) => {
      const sql = String(sqlArg).replace(/\s+/g, ' ').trim();
      const params = paramsArg ?? [];
      db.queries.push({ sql, params });
      if (/^SELECT value FROM system_config WHERE `key` = \? LIMIT 1$/.test(sql)) {
        const v = db.config.get(String(params[0]));
        return [v === undefined ? [] : [{ value: v }], []];
      }
      if (/^INSERT INTO system_config \(`key`, value\) VALUES \(\?, \?\) ON DUPLICATE KEY UPDATE value = VALUES\(value\)$/.test(sql)) {
        if (db.failSave) throw new Error('db write failed');
        db.config.set(String(params[0]), String(params[1]));
        return [{ affectedRows: 1 }, []];
      }
      if (/FROM position_state WHERE entry_price > 0 AND qty > 0$/.test(sql)) {
        return [db.positions.filter(p => p.entry_price > 0 && (p.qty ?? 0) > 0), []];
      }
      if (/FROM market_holidays WHERE market = 'overseas'/.test(sql)) {
        const years = (params[0] as number[]).filter(y => db.usHolidayYears.includes(y));
        return [years.map(y => ({ d: `${y}-11-26` })), []];
      }
      throw new Error(`unexpected SQL: ${sql}`);
    }),
  };
}
jest.mock('@/lib/db', () => ({ getPool: () => fakePool() }));

const POLICY = JSON.stringify({ version: 1, updatedAt: '2026-10-22T08:00:00.000Z', stopPct: 3, heatCapPct: 2, stopBasis: 'avg', history: [] });
// 2026-10-22(목) 02:00Z = 국내 11:00 KST · 미국 전날 22:00 ET(닫힘) / 15:00Z = 미국 11:00 ET(열림)
const T_DOMESTIC = Date.parse('2026-10-22T02:00:00Z');
const T_US = Date.parse('2026-10-22T15:00:00Z');

const req = {} as NextRequest;
const delivered = { channel: 'telegram', delivered: ['telegram'], failed: [], unconfigured: [] };
const notDelivered = { channel: 'telegram', delivered: [], failed: [{ channel: 'telegram', error: 'HTTP 502' }], unconfigured: [] };

async function post(at: number) {
  jest.spyOn(Date, 'now').mockReturnValue(at);
  const { POST } = await import('../route');
  const res = await POST(req);
  return { status: res.status, body: await res.json() };
}

function state() {
  const v = db.config.get('risk_stop_alert_state');
  return v ? JSON.parse(v) : null;
}
const writes = () => db.queries.filter(q => !/^SELECT /i.test(q.sql));

beforeEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
  authMock.mockReset().mockReturnValue(undefined);
  dispatchMock.mockReset().mockResolvedValue(delivered);
  labelMock.mockClear();
  tickerMock.mockReset().mockImplementation(async (s: string) => ({ symbol: s, price: 9_000, timestamp: 0 }));
  domesticOpenMock.mockReset().mockResolvedValue(true);
  db = {
    config: new Map([['risk_policy', POLICY]]),
    positions: [
      { symbol: 'AAA', market: 'domestic', entry_price: 10_000, peak_price: 10_500, qty: 10 },
      { symbol: 'BBB', market: 'domestic', entry_price: 10_000, peak_price: 10_500, qty: 5 },
      { symbol: 'NAS:ZZZ', market: 'overseas', entry_price: 137_500, peak_price: 140_000, qty: 2 },
    ],
    usHolidayYears: [2026],
    queries: [],
  };
});

describe('인증·스위치·정책', () => {
  test('인증 실패 → 401 그대로, DB·KIS·알림 0', async () => {
    const { NextResponse } = await import('next/server');
    authMock.mockReturnValue(NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 }));
    const r = await post(T_DOMESTIC);
    expect(r.status).toBe(401);
    expect(db.queries).toEqual([]);
    expect(tickerMock).not.toHaveBeenCalled();
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  test('risk_stop_alert_enabled = false → 건너뜀, KIS·알림·쓰기 0', async () => {
    db.config.set('risk_stop_alert_enabled', 'false');
    const r = await post(T_DOMESTIC);
    expect(r.body).toEqual({ ok: true, skipped: 'disabled' });
    expect(tickerMock).not.toHaveBeenCalled();
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });

  test('키 없음 = 켜짐, JSON true 도 켜짐', async () => {
    expect((await post(T_DOMESTIC)).body.ok).toBe(true);
    expect(tickerMock).toHaveBeenCalled();
    jest.resetModules(); tickerMock.mockClear();
    db.config.set('risk_stop_alert_enabled', 'true');
    await post(T_DOMESTIC + 60_000);
    expect(tickerMock).toHaveBeenCalled();
  });

  test('정책 없음 → 건너뜀(KIS 0·쓰기 0)', async () => {
    db.config.delete('risk_policy');
    expect((await post(T_DOMESTIC)).body).toEqual({ ok: true, skipped: 'no_policy' });
    expect(tickerMock).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });

  test('정책 손상 → 건너뜀(KIS 0·쓰기 0)', async () => {
    db.config.set('risk_policy', '{"version":1,"stopPct":0,"heatCapPct":2,"stopBasis":"avg"}');
    expect((await post(T_DOMESTIC)).body).toEqual({ ok: true, skipped: 'policy_invalid' });
    expect(tickerMock).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });
});

describe('장 열림 판정', () => {
  test('두 시장 모두 닫힘 → KIS 호출 0·알림 0·상태 불변', async () => {
    domesticOpenMock.mockResolvedValue(false);
    const r = await post(T_DOMESTIC); // 미국은 22:00 ET
    expect(r.body).toEqual({ ok: true, skipped: 'markets_closed' });
    expect(tickerMock).not.toHaveBeenCalled();
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });

  test('미국 휴장 표를 못 읽으면(그해 행 없음) 미국은 닫힘으로 본다 — fail-closed', async () => {
    domesticOpenMock.mockResolvedValue(false);
    db.usHolidayYears = [];
    expect((await post(T_US)).body).toEqual({ ok: true, skipped: 'markets_closed' });
    expect(tickerMock).not.toHaveBeenCalled();
  });

  test('미국 휴장일(반일장 포함 표에 있음) → 닫힘', async () => {
    domesticOpenMock.mockResolvedValue(false);
    expect((await post(Date.parse('2026-11-26T15:00:00Z'))).body).toEqual({ ok: true, skipped: 'markets_closed' });
    expect(tickerMock).not.toHaveBeenCalled();
  });

  test('국내 판정이 던지면 국내는 닫힘 취급', async () => {
    domesticOpenMock.mockRejectedValue(new Error('x'));
    expect((await post(T_DOMESTIC)).body).toEqual({ ok: true, skipped: 'markets_closed' });
  });

  test('국내만 열림 → 국내 종목만 시세 조회', async () => {
    await post(T_DOMESTIC);
    expect(tickerMock.mock.calls.map(c => c[0]).sort()).toEqual(['AAA', 'BBB']);
  });

  test('미국만 열림 → 미국 종목만, 환율은 원화÷USD', async () => {
    domesticOpenMock.mockResolvedValue(false);
    tickerMock.mockImplementation(async (s: string) => ({ symbol: s, price: 125_000, priceUsd: 100, timestamp: 0 }));
    await post(T_US);
    expect(tickerMock.mock.calls.map(c => c[0])).toEqual(['NAS:ZZZ']);
    const [, title, body] = dispatchMock.mock.calls[0];
    expect(title).toBe('🔻 이미 손절가 아래 — 미국 1종목');
    expect(body).toContain('현재가 $100.00 (125,000원)');
  });
});

describe('알림·상태', () => {
  test('첫 실행: 이미 아래인 국내 2종목 → 요약 1건(warning), 상태 저장', async () => {
    const r = await post(T_DOMESTIC);
    expect(r.body).toMatchObject({ ok: true, markets: ['domestic'], held: 3, priced: 2, sent: 1, failed: 0 });
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    const [level, title, body] = dispatchMock.mock.calls[0];
    expect(level).toBe('warning');
    expect(title).toBe('🔻 이미 손절가 아래 — 국내 2종목');
    expect(body).toContain('• 라벨-AAA:');
    expect(body).toContain('주문은 자동으로 나가지 않습니다. 직접 판단하세요.');
    const s = state();
    expect(s.symbols['domestic|AAA'].state).toBe('below');
    expect(s.symbols['domestic|BBB'].state).toBe('below');
    expect(s.symbols['overseas|NAS:ZZZ']).toBeUndefined(); // 닫힌 시장은 평가하지 않는다
    expect(s.sentToday).toBe(1);
  });

  test('교차 1건 → 종목 알림, 다음 틱 같은 가격이면 재발송 없음·쓰기 없음', async () => {
    tickerMock.mockImplementation(async (s: string) => ({ symbol: s, price: 10_000, timestamp: 0 }));
    await post(T_DOMESTIC);
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(state().symbols['domestic|AAA'].state).toBe('above');

    jest.resetModules();
    tickerMock.mockImplementation(async (s: string) => ({ symbol: s, price: s === 'AAA' ? 9_600 : 10_000, timestamp: 0 }));
    await post(T_DOMESTIC + 60_000);
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock.mock.calls[0][1]).toBe('🔻 손절가 도달 — 라벨-AAA');
    expect(dispatchMock.mock.calls[0][2]).toContain('손절 시 손익: −3,000원 (−3.00%, 10주)');
    expect(state().symbols['domestic|AAA'].state).toBe('below');

    jest.resetModules();
    db.queries = [];
    await post(T_DOMESTIC + 120_000);
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(writes()).toEqual([]); // 바뀐 것이 없으면 저장하지 않는다
  });

  test('발송 실패(전달 채널 없음) → 종목 상태 불변, 재시도 기록만 저장, 다음 틱 재발송', async () => {
    dispatchMock.mockResolvedValue(notDelivered);
    const r = await post(T_DOMESTIC);
    expect(r.body).toMatchObject({ sent: 0, failed: 1 });
    const s = state();
    expect(s.symbols['domestic|AAA']).toBeUndefined();
    expect(s.retry['summary:domestic']).toEqual({ failures: 1, until: null });
    expect(s.sentToday).toBe(0);

    jest.resetModules();
    dispatchMock.mockResolvedValue(delivered);
    await post(T_DOMESTIC + 60_000);
    expect(dispatchMock).toHaveBeenCalledTimes(2);
    expect(state().symbols['domestic|AAA'].state).toBe('below');
  });

  test('발송 예외도 실패로 처리하고 200 으로 끝난다(cron 에 번지지 않음)', async () => {
    dispatchMock.mockRejectedValue(new Error('boom'));
    const r = await post(T_DOMESTIC);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ sent: 0, failed: 1 });
  });

  test('시세 실패 종목은 건너뛰고(상태 없음 유지) 나머지는 평가', async () => {
    tickerMock.mockImplementation(async (s: string) => {
      if (s === 'AAA') throw new Error('KIS 500');
      return { symbol: s, price: 9_000, timestamp: 0 };
    });
    const r = await post(T_DOMESTIC);
    expect(r.body).toMatchObject({ priced: 1, tickerFailed: 1, sent: 1 });
    expect(state().symbols['domestic|AAA']).toBeUndefined();
    expect(state().symbols['domestic|BBB'].state).toBe('below');
  });

  test('틱당 시세 조회 상한 10종목', async () => {
    db.positions = Array.from({ length: 12 }, (_, i) => ({ symbol: `S${String(i).padStart(2, '0')}`, market: 'domestic', entry_price: 10_000, peak_price: 10_000, qty: 1 }));
    await post(T_DOMESTIC);
    expect(tickerMock).toHaveBeenCalledTimes(10);
  });

  test('평균단가 0·수량 없음(시나리오 예약 행)은 보유로 보지 않는다', async () => {
    db.positions.push({ symbol: 'CCC', market: 'domestic', entry_price: 0, peak_price: 0, qty: null });
    await post(T_DOMESTIC);
    expect(tickerMock.mock.calls.map(c => c[0])).not.toContain('CCC');
  });

  test('상태 저장 실패 → 500(알림은 이미 나갔을 수 있음), 예외가 밖으로 새지 않는다', async () => {
    db.failSave = true;
    const r = await post(T_DOMESTIC);
    expect(r.status).toBe(500);
    expect(r.body.ok).toBe(false);
  });

  test('저장된 상태가 손상 → 새로 시작(최초 요약)', async () => {
    db.config.set('risk_stop_alert_state', '{broken');
    await post(T_DOMESTIC);
    expect(dispatchMock.mock.calls[0][1]).toMatch(/이미 손절가 아래/);
  });

  test('정책 version 이 바뀐 첫 평가 → 알림 없음, 상태만 새 version 으로', async () => {
    tickerMock.mockImplementation(async (s: string) => ({ symbol: s, price: 10_000, timestamp: 0 }));
    await post(T_DOMESTIC);
    jest.resetModules();
    db.config.set('risk_policy', POLICY.replace('"version":1', '"version":2').replace('"stopPct":3', '"stopPct":0.5'));
    tickerMock.mockImplementation(async (s: string) => ({ symbol: s, price: 9_940, timestamp: 0 })); // 새 손절가 9,950 아래
    await post(T_DOMESTIC + 60_000);
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(state()).toMatchObject({ policyVersion: 2 });
    expect(state().symbols['domestic|AAA']).toMatchObject({ state: 'below', pv: 2 });
  });
});

describe('격리 — 쓰기는 상태 키 하나, 주문 경로 0', () => {
  test('실행한 SQL 중 쓰기는 system_config 의 risk_stop_alert_state 뿐', async () => {
    await post(T_DOMESTIC);
    const w = writes();
    expect(w.length).toBe(1);
    expect(w[0].sql).toMatch(/^INSERT INTO system_config/);
    expect(w[0].params[0]).toBe('risk_stop_alert_state');
    expect(db.queries.some(q => /(UPDATE|DELETE|INSERT)\s+(INTO\s+)?(position_state|orders|signals)/i.test(q.sql))).toBe(false);
  });

  test('겹친 실행은 건너뛴다(같은 알림 두 번 방지)', async () => {
    let release: (v: unknown) => void = () => {};
    tickerMock.mockImplementationOnce(() => new Promise(r => { release = r; }));
    jest.spyOn(Date, 'now').mockReturnValue(T_DOMESTIC);
    const { POST } = await import('../route');
    const first = POST(req);
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));
    const second = await (await POST(req)).json();
    expect(second).toEqual({ ok: true, skipped: 'in_progress' });
    release({ symbol: 'AAA', price: 9_000, timestamp: 0 });
    expect((await first).status).toBe(200);
    const third = await (await POST(req)).json();
    expect(third.ok).toBe(true);
    expect(third.skipped).toBeUndefined();
  });
});

describe('Reviewer M-2 — 발송 성공 뒤 상태 저장 실패 시 재발송 억제(10분)', () => {
  async function postSame(at: number) {
    (Date.now as jest.Mock).mockReturnValue(at);
    const { POST } = await import('../route');   // 같은 모듈 인스턴스(resetModules 하지 않음)
    const res = await POST(req);
    return { status: res.status, body: await res.json() };
  }

  test('저장 실패 → 다음 틱 재발송 0, 저장이 회복되면 below 로 기록되고 이후에도 재발송 0', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(T_DOMESTIC);
    db.failSave = true;
    expect((await postSame(T_DOMESTIC)).status).toBe(500);
    expect(dispatchMock).toHaveBeenCalledTimes(1);

    const r2 = await postSame(T_DOMESTIC + 60_000);
    expect(r2.status).toBe(500);                 // 저장은 여전히 실패
    expect(dispatchMock).toHaveBeenCalledTimes(1); // 재발송 0

    db.failSave = false;
    const r3 = await postSame(T_DOMESTIC + 120_000);
    expect(r3.body).toMatchObject({ ok: true, sent: 0, resendSuppressed: 1 });
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(state().symbols['domestic|AAA'].state).toBe('below');
    expect(state().symbols['domestic|BBB'].state).toBe('below');

    await postSame(T_DOMESTIC + 30 * 60_000);
    expect(dispatchMock).toHaveBeenCalledTimes(1);
  });

  test('저장 실패가 10분 넘게 이어지면 그때 다시 보낸다', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(T_DOMESTIC);
    db.failSave = true;
    await postSame(T_DOMESTIC);
    await postSame(T_DOMESTIC + 9 * 60_000 + 59_000);
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    await postSame(T_DOMESTIC + 10 * 60_000);
    expect(dispatchMock).toHaveBeenCalledTimes(2);
  });

  test('발송 실패는 억제 대상이 아니다 — 다음 틱 재시도', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(T_DOMESTIC);
    dispatchMock.mockResolvedValue(notDelivered);
    await postSame(T_DOMESTIC);
    await postSame(T_DOMESTIC + 60_000);
    expect(dispatchMock).toHaveBeenCalledTimes(2);
  });
});

describe('Reviewer L-2 — 해외 환율 방어(300~5000)', () => {
  beforeEach(() => { domesticOpenMock.mockResolvedValue(false); });

  test.each([
    ['환율 1(fetchUsdKrwRate 실패 흉내)', { price: 100, priceUsd: 100 }],
    ['환율 6000', { price: 600_000, priceUsd: 100 }],
    ['환율 299', { price: 29_900, priceUsd: 100 }],
    ['USD 원가 없음', { price: 125_000 }],
  ])('%s → 그 종목 평가 생략(알림 0·상태 불변)', async (_n, t) => {
    tickerMock.mockImplementation(async (s: string) => ({ symbol: s, timestamp: 0, ...t }));
    const r = await post(T_US);
    expect(r.body).toMatchObject({ priced: 0, fxRejected: 1, sent: 0 });
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(state()?.symbols?.['overseas|NAS:ZZZ']).toBeUndefined();
  });

  test.each([[300], [5000]])('경계 환율 %p 은 허용', async (fx) => {
    tickerMock.mockImplementation(async (s: string) => ({ symbol: s, price: fx * 100, priceUsd: 100, timestamp: 0 }));
    const r = await post(T_US);
    expect(r.body).toMatchObject({ priced: 1, fxRejected: 0 });
  });
});

describe('Reviewer R-1 — 재발송 억제는 같은 종목 키 집합일 때만 (요약 id 는 시장당 하나)', () => {
  async function postSame(at: number) {
    (Date.now as jest.Mock).mockReturnValue(at);
    const { POST } = await import('../route');   // 같은 모듈 인스턴스
    const res = await POST(req);
    return { status: res.status, body: await res.json() };
  }

  test('첫 틱 BBB 시세 실패 → AAA 요약 전달, 둘째 틱 BBB 회복 → BBB 요약도 발송(2회)', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(T_DOMESTIC);
    tickerMock.mockImplementation(async (s: string) => {
      if (s === 'BBB') throw new Error('KIS 500');
      return { symbol: s, price: 9_000, timestamp: 0 };
    });
    await postSame(T_DOMESTIC);
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock.mock.calls[0][2]).toContain('• 라벨-AAA:');
    expect(dispatchMock.mock.calls[0][2]).not.toContain('라벨-BBB');

    tickerMock.mockImplementation(async (s: string) => ({ symbol: s, price: 9_000, timestamp: 0 }));
    const r2 = await postSame(T_DOMESTIC + 60_000);
    expect(r2.body).toMatchObject({ sent: 1, resendSuppressed: 0 });
    expect(dispatchMock).toHaveBeenCalledTimes(2);
    expect(dispatchMock.mock.calls[1][2]).toContain('• 라벨-BBB:');
    expect(dispatchMock.mock.calls[1][2]).not.toContain('라벨-AAA');
    expect(state().symbols['domestic|BBB']).toMatchObject({ state: 'below' });
  });

  test('저장 실패 중: 같은 키 집합 억제 · 부분집합 억제 · 새 키 포함이면 발송', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(T_DOMESTIC);
    db.failSave = true;
    await postSame(T_DOMESTIC);                       // 요약 {AAA, BBB} 전달
    expect(dispatchMock).toHaveBeenCalledTimes(1);

    await postSame(T_DOMESTIC + 60_000);              // 같은 집합 → 억제
    expect(dispatchMock).toHaveBeenCalledTimes(1);

    tickerMock.mockImplementation(async (s: string) => {
      if (s === 'BBB') throw new Error('KIS 500');
      return { symbol: s, price: 9_000, timestamp: 0 };
    });
    await postSame(T_DOMESTIC + 120_000);             // 부분집합 {AAA} → 억제
    expect(dispatchMock).toHaveBeenCalledTimes(1);

    tickerMock.mockImplementation(async (s: string) => ({ symbol: s, price: 9_000, timestamp: 0 }));
    db.positions.push({ symbol: 'CCC', market: 'domestic', entry_price: 10_000, peak_price: 10_000, qty: 3 });
    await postSame(T_DOMESTIC + 180_000);             // {AAA, BBB, CCC} — 새 키 CCC → 발송
    expect(dispatchMock).toHaveBeenCalledTimes(2);
    expect(dispatchMock.mock.calls[1][2]).toContain('• 라벨-CCC:');

    await postSame(T_DOMESTIC + 240_000);             // 합집합 {AAA, BBB, CCC} 로 갱신됐으므로 다시 억제
    expect(dispatchMock).toHaveBeenCalledTimes(2);
  });

  test('교차 알림(id 에 종목 포함)은 기존과 같다 — 저장 실패 중 같은 종목 교차는 10분 안 억제', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(T_DOMESTIC);
    tickerMock.mockImplementation(async (s: string) => ({ symbol: s, price: 10_000, timestamp: 0 }));
    await postSame(T_DOMESTIC);                       // 둘 다 above 로 기록
    db.failSave = true;
    tickerMock.mockImplementation(async (s: string) => ({ symbol: s, price: s === 'AAA' ? 9_000 : 10_000, timestamp: 0 }));
    await postSame(T_DOMESTIC + 60_000);
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock.mock.calls[0][1]).toBe('🔻 손절가 도달 — 라벨-AAA');
    await postSame(T_DOMESTIC + 120_000);
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    await postSame(T_DOMESTIC + 60_000 + 10 * 60_000);
    expect(dispatchMock).toHaveBeenCalledTimes(2);
  });
});
