/**
 * T-029 — `POST /api/signals/custom/confirm` 수치·shape 런타임 가드.
 *
 * 🔴 이 라우트가 [[T-027-nonnumber-quantity-guard]]·[[T-028-signals-api-numeric-guard]] 보다
 *    위험한 두 가지:
 *      ① 문자열 `+` 는 연결이다 — `'100' + '200'` → `'100200'` → /2 → **50100**.
 *         `NaN` 이 아니라 **유효해 보이는 오염 가격**이라 아래 단계(한도 fail-closed·어댑터
 *         가드)가 통째로 무력하다.
 *      ② INSERT 직후 `approved_pending_entry`(진입 감시)로 전환된다 — **사람 승인이 없다.**
 *
 * 🔴 그리고 이 파일의 최대 목적은 **과도차단 회귀 방지**다 — 실계좌 실거래 중이라
 *    정상 시나리오 확정을 막는 것 자체가 사고다(사용자가 시나리오를 만들 수 없게 된다).
 *    아래 "과도차단 회귀 방지" 블록이 그 방어선이며, UI 호출자 2곳의 **실제 페이로드**를 쓴다.
 */
import { POST } from '../route';

jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));
jest.mock('@/lib/notify', () => ({
  sendAlert: jest.fn(),
  getSymbolLabel: jest.fn(async (s: string) => s),
}));

import { getPool } from '@/lib/db';
import { AWAITING_APPROVAL_STATUSES } from '@/lib/signals/statuses';
import { CONFIRM_LOCK_WAIT_SEC } from '@/lib/signals/custom-confirm-guard';

type QueryCall = { sql: string; params: unknown[]; via: 'pool' | 'conn' };

/**
 * T-052 — 목 확장. 라우트가 `pool.query` 만 쓰던 구조에서 **전용 연결 + 트랜잭션**(`getConnection` →
 * `GET_LOCK`/`beginTransaction`/`commit`/`rollback`/`RELEASE_LOCK`/`release`)으로 바뀌었다.
 *
 * 기존 단언을 약화하지 않도록:
 *  - 연결(conn)의 쿼리도 풀 쿼리와 **같은 `calls` 배열**에 쌓는다 → 기존 `inserts()`·UPDATE 단언이 그대로 의미를 갖는다.
 *  - INSERT·UPDATE 응답 형태(`insertId`·`affectedRows`)는 예전과 같다.
 *  - 다만 UPDATE 는 이제 "무조건 1행" 이 아니라 **작은 메모리 DB** 에서 조건(`status IN …`)을 실제로 평가한다 —
 *    선점 성패가 결과를 가르므로 "늘 성공" 목으로는 중복 확정을 시험할 수 없다. 기본 원본(#41)은 승인 대기라 예전처럼 1행이다.
 *  - 트랜잭션은 begin 시 스냅숏 → rollback 시 복원으로 흉내 낸다(롤백이 원본 상태를 되돌리는지 시험하려고).
 */
type MemRow = {
  id: number; symbol: string; side: string; status: string; scenario_source: string | null;
  consumed_order_id: number | null; expires_at: string | null; indicators: string | null;
};

let calls: QueryCall[];
let insertSeq: number;
let events: string[];
let mem: { rows: MemRow[] };
let snapshot: { rows: MemRow[] } | null;
/** GET_LOCK 결과 — 1 획득, 0 대기 시간 초과, null 오류 */
let lockGot: number | null | 'throw';
/** RELEASE_LOCK 결과 — 'throw' 면 예외 */
let releaseRel: number | null | 'throw';
/** n번째 INSERT 에서 예외(트랜잭션 롤백 시험) */
let failInsertNo: number | null;
let insertCount: number;

/** 승인 대기로 보는 원본 상태 — 라우트의 `[...AWAITING_APPROVAL_STATUSES, 'detected']` 와 같다. */
const CLAIMABLE = ['awaiting_approval', 'pending_approval', 'pending', 'detected'];

function kstNowString(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 19).replace('T', ' ');
}

async function handle(via: 'pool' | 'conn', sql: string, params: unknown[] = []): Promise<unknown> {
  calls.push({ sql, params, via });
  if (/GET_LOCK/i.test(sql)) {
    events.push('GET_LOCK');
    // 'throw' = 서버는 락을 잡았는데 응답이 유실돼 호출만 거부된 경우를 흉내 낸다(T-052 Reviewer R-3)
    if (lockGot === 'throw') throw new Error('lost GET_LOCK response');
    return [[{ got: lockGot }], []];
  }
  if (/RELEASE_LOCK/i.test(sql)) {
    events.push('RELEASE_LOCK');
    if (releaseRel === 'throw') throw new Error('connection lost');
    return [[{ rel: releaseRel }], []];
  }
  if (/^\s*INSERT/i.test(sql)) {
    events.push('INSERT');
    insertCount += 1;
    if (failInsertNo === insertCount) throw new Error('insert boom');
    const id = ++insertSeq;
    mem.rows.push({
      id, symbol: String(params[1]), side: String(params[2]), status: String(params[9]),
      scenario_source: params[12] as string, consumed_order_id: null,
      expires_at: params[10] as string, indicators: params[8] as string,
    });
    return [{ insertId: id }, []];
  }
  if (/^\s*UPDATE signals/i.test(sql)) {
    events.push('UPDATE');
    const row = mem.rows.find(r => r.id === params[0]);
    if (row && CLAIMABLE.includes(row.status)) { row.status = 'approved'; return [{ affectedRows: 1 }, []]; }
    return [{ affectedRows: 0 }, []];
  }
  if (/^\s*SELECT\s+status\s+FROM\s+signals/i.test(sql)) {
    const row = mem.rows.find(r => r.id === params[0]);
    return [row ? [{ status: row.status }] : [], []];
  }
  if (/^\s*SELECT[\s\S]*FROM\s+signals/i.test(sql)) {
    events.push('SELECT_ACTIVE');
    const now = kstNowString();
    // 메모리 DB 위에서 같은 술어를 흉내 낸다(실제 SQL 의미는 일회용 MariaDB 동시성 실증이 검증한다 — task T-052 Developer 절).
    // 라운드3: 술어는 **SQL 문에 실제로 있을 때만** 적용한다 — 조건을 지운 변이(예: scenario_source 조건 삭제로 AI 원본 행이
    //   중복으로 잡힘)가 목에서 그대로 살아남지 않게. 정상 SQL 에서는 예전과 같은 결과다.
    const q = sql.replace(/\s+/g, ' ');
    const rows = mem.rows.filter(r =>
      (!q.includes('symbol = ?') || r.symbol === params[0])
      && (!q.includes('side = ?') || r.side === params[1])
      && (!q.includes("scenario_source = 'user'") || r.scenario_source === 'user')
      && (!/status IN \('approved_pending_entry', ?'executing'\)/.test(q) || r.status === 'approved_pending_entry' || r.status === 'executing')
      && (!q.includes('consumed_order_id IS NULL') || r.consumed_order_id === null)
      && (!q.includes('expires_at > NOW()') || r.expires_at === null || r.expires_at > now));
    return [rows.map(r => ({ id: r.id, indicators: r.indicators })), []];
  }
  if (/system_config/i.test(sql)) return [[], []];      // 알람 설정 미기록 → 기본 true
  return [{ affectedRows: 1 }, []];
}

let conn: Record<string, jest.Mock>;

beforeEach(() => {
  jest.clearAllMocks();
  // T-052: 시계를 고정한다 — 보유 마감일(D-2) 판정이 실행 날짜에 따라 바뀌지 않게.
  // 2026-10-19T00:00:00Z = 월요일 09:00 KST. 아래 SCENARIO 의 마감일(2026-10-26)은 이 시각 기준 미래다.
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-19T00:00:00Z'));
  calls = [];
  insertSeq = 100;
  events = [];
  snapshot = null;
  lockGot = 1;
  releaseRel = 1;
  failInsertNo = null;
  insertCount = 0;
  mem = {
    rows: [{
      id: 41, symbol: '005930', side: 'buy', status: 'awaiting_approval', scenario_source: 'ai',
      consumed_order_id: null, expires_at: '2026-10-20 00:00:00', indicators: null,
    }],
  };

  conn = {
    query: jest.fn((sql: string, params?: unknown[]) => handle('conn', sql, params)),
    beginTransaction: jest.fn(async () => { events.push('begin'); snapshot = JSON.parse(JSON.stringify(mem)); }),
    commit: jest.fn(async () => { events.push('commit'); snapshot = null; }),
    rollback: jest.fn(async () => { events.push('rollback'); if (snapshot) mem = snapshot; snapshot = null; }),
    release: jest.fn(() => { events.push('release'); }),
    destroy: jest.fn(() => { events.push('destroy'); }),
  };
  const query = jest.fn((sql: string, params?: unknown[]) => handle('pool', sql, params));
  const getConnection = jest.fn(async () => { events.push('getConnection'); return conn; });
  (getPool as jest.Mock).mockReturnValue({ query, getConnection });
});

function req(body: unknown) {
  return new Request('http://x/api/signals/custom/confirm', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

const SCENARIO = {
  grade: 'B+',
  why_now: 'RSI 42 · MACD 정배열',
  entry: { trigger: '눌림목', price_zone: '68600~69300' },
  // T-052: 예전 값 '2026-08-21' 은 이제 과거라 D-2(지난 보유 마감 거절)에 걸린다. 위 고정 시계 기준 미래로 바꿔
  //        "정상 시나리오는 통과" 시험이 그대로 의미를 갖게 한다(마감이 now+24h 보다 늦어 만료 시각도 24h 그대로).
  exit: { holding_deadline: '2026-10-26' },
  risk_factors: [],
};

/** `src/app/recommend/build/page.tsx:84` 가 실제로 보내는 형태. */
function buildPagePayload(over: Record<string, unknown> = {}) {
  return {
    market: 'domestic',
    symbol: '005930',
    direction: 'buy',
    scenario: SCENARIO,
    currentPrice: 70000,
    manualSlices: [{ zoneLo: 68600, zoneHi: 69300, qty: 3 }],
    splits: 1,
    ...over,
  };
}

/** `src/components/ScenarioDetail.tsx:280` 이 실제로 보내는 형태 (sourceSignalId 포함). */
function scenarioDetailPayload(over: Record<string, unknown> = {}) {
  return {
    market: 'domestic',
    symbol: '005930',
    direction: 'buy',
    currentPrice: 70000,
    scenario: SCENARIO,
    manualSlices: [
      { zoneLo: 68600, zoneHi: 69300, qty: 3 },
      { zoneLo: 69400, zoneHi: 70000, qty: 2 },
    ],
    splits: 2,
    sourceSignalId: 41,
    ...over,
  };
}

const inserts = () => calls.filter(c => /^\s*INSERT/i.test(c.sql));

// ── 과도차단 회귀 방지 (최우선) ───────────────────────────────────────────────
describe('POST custom/confirm — UI 호출자의 정상 페이로드는 그대로 통과한다', () => {
  test('recommend/build 페이지 페이로드 → 200 + signals INSERT 1건', async () => {
    const res = await POST(req(buildPagePayload()));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true, splitCount: 1, status: 'approved_pending_entry',
    });
    expect(inserts()).toHaveLength(1);
  });

  test('ScenarioDetail(AI 시그널 승인) 페이로드 → 200 + 2분할 INSERT + 원본 approved 마킹', async () => {
    const res = await POST(req(scenarioDetailPayload()));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, splitCount: 2 });
    expect(inserts()).toHaveLength(2);
    expect(calls.some(c => /^\s*UPDATE signals/i.test(c.sql) && c.params[0] === 41)).toBe(true);
  });

  test('매도 시나리오도 그대로 통과한다', async () => {
    const res = await POST(req(scenarioDetailPayload({ direction: 'sell' })));

    expect(res.status).toBe(200);
    expect(inserts()).toHaveLength(2);
  });

  test('해외 심볼도 그대로 통과한다', async () => {
    const res = await POST(req(buildPagePayload({ symbol: 'NAS:AAPL', market: 'overseas' })));

    expect(res.status).toBe(200);
    expect(inserts()).toHaveLength(1);
  });

  test('정상 값은 오염 없이 정확한 가격·금액으로 저장된다 (가드가 계산을 바꾸지 않는다)', async () => {
    // 68600~69300 → mid 68950 → 호가단위 100 반올림 → 69000, 금액 = 3 × 69000
    const res = await POST(req(buildPagePayload()));

    expect(res.status).toBe(200);
    const params = inserts()[0].params;
    expect(params[4]).toBe(69000);    // price
    expect(params[5]).toBe(3);        // quantity
    expect(params[6]).toBe(207000);   // amount_krw
  });
});

describe('POST custom/confirm — 선택 필드 미지정 경로는 여전히 통과한다', () => {
  test('manualSlices 미지정 → 기본 분할 계산(calcSplitSlices) 경로로 간다', async () => {
    const body = buildPagePayload({ splits: 2 }) as Record<string, unknown>;
    delete body.manualSlices;

    const res = await POST(req(body));

    expect(res.status).toBe(200);
    expect(inserts()).toHaveLength(2);
  });

  test('manualSlices: [] 도 기본 분할 계산으로 간다 (length > 0 분기 유지)', async () => {
    const res = await POST(req(buildPagePayload({ manualSlices: [], splits: 3 })));

    expect(res.status).toBe(200);
    expect(inserts()).toHaveLength(3);
  });

  test('entryZonePct 미지정 → 기본값 [-0.5, 0.5] 로 계산된다', async () => {
    const body = buildPagePayload() as Record<string, unknown>;
    delete body.manualSlices;

    const res = await POST(req(body));

    expect(res.status).toBe(200);
    // 70000 기준 -0.5%~+0.5% → 호가단위(100) 반올림 구간
    const params = inserts()[0].params;
    expect(typeof params[4]).toBe('number');
    expect(params[4]).toBeGreaterThan(69000);
    expect(params[4]).toBeLessThan(71000);
  });

  test('entryZonePct 를 명시해도 통과한다', async () => {
    const body = buildPagePayload({ entryZonePct: [-2, -0.5], splits: 2 }) as Record<string, unknown>;
    delete body.manualSlices;

    const res = await POST(req(body));

    expect(res.status).toBe(200);
    expect(inserts()).toHaveLength(2);
  });

  test('splits 미지정 → 1분할', async () => {
    const body = buildPagePayload() as Record<string, unknown>;
    delete body.manualSlices;
    delete body.splits;

    const res = await POST(req(body));

    expect(res.status).toBe(200);
    expect(inserts()).toHaveLength(1);
  });

  test('holdingQty 미지정도 통과한다 (매도 분할 수량 배분 없음)', async () => {
    const body = buildPagePayload({ direction: 'sell', splits: 2 }) as Record<string, unknown>;
    delete body.manualSlices;

    const res = await POST(req(body));

    expect(res.status).toBe(200);
    expect(inserts()).toHaveLength(2);
  });

  test('holdingQty 지정 시 수량이 배분된다', async () => {
    const body = buildPagePayload({ direction: 'sell', splits: 2, holdingQty: 10 }) as Record<string, unknown>;
    delete body.manualSlices;

    const res = await POST(req(body));

    expect(res.status).toBe(200);
    expect(inserts().map(c => c.params[5])).toEqual([5, 5]);
  });

  test('currentPrice 0 + scenario.entry.price_zone 폴백 경로도 통과한다', async () => {
    const body = buildPagePayload({ currentPrice: 0 }) as Record<string, unknown>;
    delete body.manualSlices;

    const res = await POST(req(body));

    expect(res.status).toBe(200);
    expect(inserts()).toHaveLength(1);
    expect(inserts()[0].params[4]).toBe(69000); // '68600~69300' 파싱 → mid 반올림
  });

  test('sourceSignalId 미지정이면 UPDATE 를 하지 않는다', async () => {
    const res = await POST(req(buildPagePayload()));

    expect(res.status).toBe(200);
    expect(calls.some(c => /^\s*UPDATE signals/i.test(c.sql))).toBe(false);
  });
});

// ── 가드 본체: 문자열 연결 오염 (T-029 핵심) ──────────────────────────────────
describe('POST custom/confirm — manualSlices 문자열 수치는 400 이고, 오염 가격이 만들어지지 않는다', () => {
  test('문자열 `+` 가 연결이라는 사실 고정 — 이 가드가 없으면 50100 이 만들어진다', () => {
    const zoneLo = '100' as unknown as number;
    const zoneHi = '200' as unknown as number;

    expect((zoneLo + zoneHi) / 2).toBe(50100);        // NaN 이 아니다
    expect(Number.isFinite((zoneLo + zoneHi) / 2)).toBe(true);  // 아래 단계가 못 잡는 이유
  });

  test("zoneLo='100' / zoneHi='200' → 400, INSERT 0건, 50100 이 DB 로 가지 않는다", async () => {
    const res = await POST(req(buildPagePayload({
      manualSlices: [{ zoneLo: '100', zoneHi: '200', qty: 3 }],
    })));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      ok: false, error: 'manualSlices[0].zoneLo must be a finite number',
    });
    expect(inserts()).toHaveLength(0);
    // 어떤 쿼리에도 오염 가격·파생 금액이 실리지 않았다
    const allParams = calls.flatMap(c => c.params);
    expect(allParams).not.toContain(50100);
    expect(allParams).not.toContain(150300); // 3 × 50100
  });

  test('숫자 모양 문자열 zoneHi 하나만으로도 400 — 혼합이 가장 위험하다', async () => {
    const res = await POST(req(buildPagePayload({
      manualSlices: [{ zoneLo: 68600, zoneHi: '69300', qty: 3 }],
    })));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'manualSlices[0].zoneHi must be a finite number',
    });
    expect(inserts()).toHaveLength(0);
  });

  test('qty 가 문자열이면 400 — 금액 파생(qty × priceMid)이 오염된다', async () => {
    const res = await POST(req(buildPagePayload({
      manualSlices: [{ zoneLo: 68600, zoneHi: 69300, qty: '3' }],
    })));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'manualSlices[0].qty must be a finite number',
    });
    expect(inserts()).toHaveLength(0);
  });

  test('2번째 슬라이스만 오염돼도 400 이고, 1번째도 INSERT 되지 않는다 (부분 등록 금지)', async () => {
    const res = await POST(req(scenarioDetailPayload({
      manualSlices: [
        { zoneLo: 68600, zoneHi: 69300, qty: 3 },
        { zoneLo: '69400', zoneHi: 70000, qty: 2 },
      ],
    })));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'manualSlices[1].zoneLo must be a finite number',
    });
    expect(inserts()).toHaveLength(0);
    expect(calls.some(c => /^\s*UPDATE signals/i.test(c.sql))).toBe(false);
  });

  test('manualSlices 가 배열이 아니면 400 (기존에는 .map TypeError → 500)', async () => {
    const res = await POST(req(buildPagePayload({ manualSlices: { zoneLo: 1, zoneHi: 2, qty: 1 } })));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'manualSlices must be an array' });
  });
});

// ── 가드 본체: 나머지 필드 ───────────────────────────────────────────────────
describe('POST custom/confirm — entryZonePct 배열 shape', () => {
  test.each([
    ['배열 아님', 0.5],
    ['길이 1', [-0.5]],
    ['길이 3', [-0.5, 0, 0.5]],
    ['원소 문자열', ['-0.5', '0.5']],
  ])('%s → 400 + INSERT 0건', async (_label, value) => {
    const body = buildPagePayload({ entryZonePct: value }) as Record<string, unknown>;
    delete body.manualSlices;

    const res = await POST(req(body));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'entryZonePct must be an array of exactly 2 finite numbers',
    });
    expect(inserts()).toHaveLength(0);
  });
});

describe('POST custom/confirm — 스칼라 필드', () => {
  test.each([['70000'], ['abc'], [true], [{ v: 1 }]])(
    'currentPrice=%p → 400 + INSERT 0건',
    async (value) => {
      const res = await POST(req(buildPagePayload({ currentPrice: value })));

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({
        error: 'currentPrice must be a finite number',
      });
      expect(inserts()).toHaveLength(0);
    },
  );

  test.each([['2'], [0], [-1], [2.5]])('splits=%p → 400 + INSERT 0건', async (value) => {
    const body = buildPagePayload({ splits: value }) as Record<string, unknown>;
    delete body.manualSlices;

    const res = await POST(req(body));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'splits must be an integer >= 1' });
    expect(inserts()).toHaveLength(0);
  });

  test('splits=0 은 이전에 "시그널 0건 + ok:true 또는 알람 단계 500" 이었다 — 이제 명시적 400', async () => {
    const body = buildPagePayload({ splits: 0 }) as Record<string, unknown>;
    delete body.manualSlices;

    const res = await POST(req(body));

    expect(res.status).toBe(400);
    expect(inserts()).toHaveLength(0);
  });

  test('holdingQty 가 문자열이면 400', async () => {
    const body = buildPagePayload({ holdingQty: '10' }) as Record<string, unknown>;
    delete body.manualSlices;

    const res = await POST(req(body));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'holdingQty must be a finite number' });
  });

  test('sourceSignalId 가 객체면 400 — SQL 바인딩 파라미터로 직행하는 값이다', async () => {
    const res = await POST(req(scenarioDetailPayload({ sourceSignalId: { id: 1 } })));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'sourceSignalId must be an integer' });
    expect(inserts()).toHaveLength(0);
  });
});

// ── 거절 흔적 · 기존 게이트 회귀 ─────────────────────────────────────────────
describe('POST custom/confirm — 거절 흔적과 기존 게이트', () => {
  test('거절은 흔적을 남긴다 — signals 행이 없으므로 console.warn 이 유일한 기록이다', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await POST(req(buildPagePayload({ manualSlices: [{ zoneLo: '100', zoneHi: '200', qty: 3 }] })));

      expect(warn).toHaveBeenCalledTimes(1);
      const line = warn.mock.calls[0][0] as string;
      expect(line).toContain('api/signals/custom/confirm POST');
      expect(line).toContain('005930');
      expect(line).toContain('manualSlices[0].zoneLo');
    } finally {
      warn.mockRestore();
    }
  });

  test('required 누락은 여전히 기존 문구로 400 — 수치 가드가 앞지르지 않는다', async () => {
    const res = await POST(req({ symbol: '005930', currentPrice: 'abc' }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'symbol/direction/scenario required',
    });
  });

  test('currentPrice 0 + price_zone 없음은 여전히 기존 문구로 400', async () => {
    const body = buildPagePayload({ currentPrice: 0, scenario: { why_now: 'x' } }) as Record<string, unknown>;
    delete body.manualSlices;

    const res = await POST(req(body));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'currentPrice or scenario.entry.price_zone required',
    });
  });

  test.each([['NaN', Number.NaN], ['Infinity', Number.POSITIVE_INFINITY]])(
    '%s 은 JSON 직렬화에서 null 이 되므로 이 경계에 도달하지 못한다 (사실 고정)',
    async (_label, value) => {
      expect(JSON.parse(JSON.stringify({ v: value })).v).toBeNull();

      // currentPrice: null → `?? 0` → price_zone 폴백 경로. 400 이 아니다.
      const body = buildPagePayload({ currentPrice: value }) as Record<string, unknown>;
      delete body.manualSlices;

      const res = await POST(req(body));

      expect(res.status).toBe(200);
    },
  );

  test('price_zone 이 파싱 불가 문자열이면 price 는 NaN 이 아니라 null 로 저장된다', async () => {
    const body = buildPagePayload({
      currentPrice: 0,
      scenario: { why_now: 'x', entry: { price_zone: 'abc~def' } },
    }) as Record<string, unknown>;
    delete body.manualSlices;

    const res = await POST(req(body));

    expect(res.status).toBe(200);
    expect(inserts()[0].params[4]).toBeNull();
  });
});

// ── T-050 — 만료 시각은 KST 벽시계로 저장한다 ───────────────────────────────────────
describe('POST custom/confirm — expires_at 은 지금 + 24시간의 KST 벽시계 (T-050)', () => {
  afterEach(() => jest.restoreAllMocks());

  test('🔴 INSERT 의 expires_at = 현재(KST) + 24h — UTC 문자열이면 DB 가 KST 로 읽어 15시간 만에 만료된다', async () => {
    // 2026-10-19T00:00:00Z = 월요일 09:00 KST → 만료는 화요일 09:00 KST 여야 한다.
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-19T00:00:00Z'));
    const res = await POST(req(buildPagePayload()));
    expect(res.status).toBe(200);
    const ins = inserts();
    expect(ins).toHaveLength(1);
    expect(ins[0].params[10]).toBe('2026-10-20 09:00:00');            // expires_at (INSERT 열 순서 11번째)
    expect(ins[0].params[10]).not.toBe('2026-10-20 00:00:00');        // 🔴 옛 UTC 값 — DB 가 KST 로 읽으면 화요일 00:00, 요청 15시간 뒤에 만료된다
  });

  test('분할 진입(2건)도 모두 같은 만료 시각을 쓴다', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-17T15:00:00Z'));   // 일요일 00:00 KST
    const res = await POST(req(scenarioDetailPayload()));
    expect(res.status).toBe(200);
    const ins = inserts();
    expect(ins).toHaveLength(2);
    expect(ins.map(c => c.params[10])).toEqual(['2026-10-19 00:00:00', '2026-10-19 00:00:00']);
  });
});

// ── T-052 D-2 — 보유 마감일이 만료 시각을 당긴다 · 지난 마감은 거절 ─────────────────────────
describe('POST custom/confirm — expires_at = min(지금+24h, 보유 마감일 23:59:59 KST) (T-052 D-2)', () => {
  const withDeadline = (holding_deadline: unknown, over: Record<string, unknown> = {}) =>
    buildPagePayload({ scenario: { ...SCENARIO, exit: { holding_deadline } }, ...over });
  const expiresOf = () => inserts().map(c => c.params[10]);

  test('마감 당일(오늘 KST) → 오늘 23:59:59 로 당겨진다 (24h 뒤인 내일 09:00 이 아니다)', async () => {
    const res = await POST(req(withDeadline('2026-10-19')));   // 지금 = 10-19 09:00 KST
    expect(res.status).toBe(200);
    expect(expiresOf()).toEqual(['2026-10-19 23:59:59']);
  });

  test('마감 전일(마감=내일) → 지금+24h(내일 09:00)가 더 이르므로 24h 그대로', async () => {
    const res = await POST(req(withDeadline('2026-10-20')));
    expect(res.status).toBe(200);
    expect(expiresOf()).toEqual(['2026-10-20 09:00:00']);
  });

  test('경계: 지금+24h 가 마감보다 1초 늦으면 마감(더 이른 쪽)', async () => {
    // 지금 = 10-20 00:00:00 KST → +24h = 10-21 00:00:00, 마감 10-20 23:59:59 가 1초 이르다
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-19T15:00:00Z'));
    const res = await POST(req(withDeadline('2026-10-20')));
    expect(res.status).toBe(200);
    expect(expiresOf()).toEqual(['2026-10-20 23:59:59']);
  });

  test('경계: 지금+24h 가 마감보다 1초 이르면 지금+24h(더 이른 쪽)', async () => {
    // 지금 = 10-19 23:59:58 KST → +24h = 10-20 23:59:58
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-19T14:59:58Z'));
    const res = await POST(req(withDeadline('2026-10-20')));
    expect(res.status).toBe(200);
    expect(expiresOf()).toEqual(['2026-10-20 23:59:58']);
  });

  test('🔴 지난 마감(어제) → 400 · 한국어 메시지 · INSERT 0건 · DB 연결도 잡지 않는다', async () => {
    const res = await POST(req(withDeadline('2026-10-18')));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('보유 마감일');
    expect(body.error).toContain('2026-10-18');
    expect(inserts()).toHaveLength(0);
    expect(events).not.toContain('getConnection');
  });

  test('🔴 지난 마감은 sourceSignalId 경로에서도 400 이고 원본 시그널은 소비되지 않는다', async () => {
    const res = await POST(req(scenarioDetailPayload({ scenario: { ...SCENARIO, exit: { holding_deadline: '2026-10-01' } } })));
    expect(res.status).toBe(400);
    expect(inserts()).toHaveLength(0);
    expect(calls.some(c => /^\s*UPDATE signals/i.test(c.sql))).toBe(false);
    expect(mem.rows.find(r => r.id === 41)?.status).toBe('awaiting_approval');
  });

  test('경계: 지금 = 마감 23:59:59.000 KST 정각 → 400 (남은 시간 0)', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-19T14:59:59.000Z'));
    const res = await POST(req(withDeadline('2026-10-19')));
    expect(res.status).toBe(400);
    expect(inserts()).toHaveLength(0);
  });

  test('경계: 지금 = 마감 1ms 전 → 통과, 만료는 마감 시각', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-19T14:59:58.999Z'));
    const res = await POST(req(withDeadline('2026-10-19')));
    expect(res.status).toBe(200);
    expect(expiresOf()).toEqual(['2026-10-19 23:59:59']);
  });

  test.each([
    ['형식 다름 YYYY/MM/DD (과거처럼 보여도)', '2026/10/01'],
    ['구분자 없음', '20261001'],
    ['달력에 없는 날짜', '2026-02-30'],
    ['자유 문자열', '이번 주 금요일'],
    ['숫자', 20261001],
    ['null', null],
    ['빈 문자열', ''],
  ])('과도차단 금지 — 마감 %s → 거절하지 않고 기존대로 24시간', async (_label, value) => {
    const res = await POST(req(withDeadline(value)));
    expect(res.status).toBe(200);
    expect(expiresOf()).toEqual(['2026-10-20 09:00:00']);
  });

  test('과도차단 금지 — exit 자체가 없으면 24시간', async () => {
    const res = await POST(req(buildPagePayload({ scenario: { why_now: 'x', entry: { price_zone: '68600~69300' } } })));
    expect(res.status).toBe(200);
    expect(expiresOf()).toEqual(['2026-10-20 09:00:00']);
  });

  test.each([['당일'], ['1~2일'], ['1주']])(
    '구형 holding_days=%p 만 있으면 24시간 (entry-watcher 해석도 지금+1일 이상이라 24h 보다 이르지 않다)',
    async (hd) => {
      const res = await POST(req(buildPagePayload({ scenario: { ...SCENARIO, exit: { holding_days: hd } } })));
      expect(res.status).toBe(200);
      expect(expiresOf()).toEqual(['2026-10-20 09:00:00']);
    },
  );

  test('분할 2건도 모두 같은(당겨진) 만료 시각', async () => {
    const res = await POST(req(scenarioDetailPayload({ scenario: { ...SCENARIO, exit: { holding_deadline: '2026-10-19' } } })));
    expect(res.status).toBe(200);
    expect(expiresOf()).toEqual(['2026-10-19 23:59:59', '2026-10-19 23:59:59']);
  });
});

// ── T-052 D-1(a) — sourceSignalId 경로: 원본 조건부 선점 + 한 트랜잭션 ──────────────────────
describe('POST custom/confirm — 원본 시그널 선점 뒤에만 INSERT, 같은 트랜잭션 (T-052 D-1 a)', () => {
  test('선점 → INSERT → commit 순서이고, 전부 같은 전용 연결에서 일어난다', async () => {
    const res = await POST(req(scenarioDetailPayload()));
    expect(res.status).toBe(200);
    const flow = events.filter(e => ['begin', 'UPDATE', 'INSERT', 'commit', 'rollback', 'release'].includes(e));
    expect(flow).toEqual(['begin', 'UPDATE', 'INSERT', 'INSERT', 'commit', 'release']);
    const writes = calls.filter(c => /^\s*(INSERT|UPDATE)/i.test(c.sql));
    expect(writes.every(c => c.via === 'conn')).toBe(true);
    expect(mem.rows.find(r => r.id === 41)?.status).toBe('approved');
  });

  test('🔴 선점 UPDATE 의 SQL 술어·파라미터·연결을 정확히 고정한다 (Reviewer R-2)', async () => {
    // 메모리 DB 목은 SQL 이 아니라 자체 CLAIMABLE 목록으로 판정하므로, 멱등성의 전부인 WHERE 절은 문장 자체로 고정해야 한다
    // (status 조건 삭제·'approved' 추가·id 조건 삭제 변이가 이 단언 전에는 생존했다).
    await POST(req(scenarioDetailPayload()));
    const upd = calls.filter(c => /^\s*UPDATE signals/i.test(c.sql));
    expect(upd).toHaveLength(1);
    expect(upd[0].sql.replace(/\s+/g, ' ').trim()).toBe(
      "UPDATE signals SET status='approved', updated_at=NOW() WHERE id=? AND status IN ('awaiting_approval','pending_approval','pending','detected')",
    );
    expect(upd[0].params).toEqual([41]);
    expect(upd[0].via).toBe('conn');
    // 상태 목록은 기존 코드의 [...AWAITING_APPROVAL_STATUSES, 'detected'] 와 같아야 한다
    expect([...AWAITING_APPROVAL_STATUSES, 'detected']).toEqual(['awaiting_approval', 'pending_approval', 'pending', 'detected']);
  });

  test('🔴 원본이 이미 처리됨(approved) → 409 · INSERT 0건 · rollback · 한국어 메시지', async () => {
    mem.rows[0].status = 'approved';
    const res = await POST(req(scenarioDetailPayload()));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('#41');
    expect(body.error).toContain('이미');
    // Reviewer R-4: 영문 상태 코드를 보이지 않는다. 라운드3 R-7: 승인 경로는 곧바로 주문하기도 하므로 "진입 감시 또는 주문이 시작된" 으로 바꿨다
    expect(body.error).toContain('이미 진입 감시 또는 주문이 시작된 시나리오입니다');
    expect(body.error).not.toMatch(/approved|[a-z]_[a-z]/);
    expect(inserts()).toHaveLength(0);
    expect(events).toContain('rollback');
    expect(events).not.toContain('commit');
    expect(events.filter(e => e === 'release')).toHaveLength(1);
  });

  test.each([['expired'], ['rejected'], ['approved_pending_entry']])(
    '원본 상태가 %p 면 409 이고 INSERT 0건',
    async (status) => {
      mem.rows[0].status = status;
      const res = await POST(req(scenarioDetailPayload()));
      expect(res.status).toBe(409);
      expect(inserts()).toHaveLength(0);
    },
  );

  // Reviewer R-4 — 사용자에게 보이는 문구. 상태별로 한국어로 풀고, "중복"은 이미 등록된 경우에만 말한다.
  test.each([
    ['approved', '이미 진입 감시 또는 주문이 시작된 시나리오입니다'],
    ['approved_pending_entry', '이미 진입 감시 또는 주문이 시작된 시나리오입니다'],
    ['executing', '이미 진입 감시 또는 주문이 시작된 시나리오입니다'],
    ['auto_submitted', '이미 진입 감시 또는 주문이 시작된 시나리오입니다'],
    ['expired', '이미 처리되었거나 만료되어 등록할 수 없습니다(만료됨)'],
    ['rejected', '이미 처리되었거나 만료되어 등록할 수 없습니다(거절됨)'],
    ['superseded', '이미 처리되었거나 만료되어 등록할 수 없습니다(새 시그널로 대체됨)'],
    ['skipped', '이미 처리되었거나 만료되어 등록할 수 없습니다(처리됨)'],
  ])('원본 상태 %p → 409 문구 "%s"', async (status, phrase) => {
    mem.rows[0].status = status;
    const res = await POST(req(scenarioDetailPayload()));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false });
    expect(body.error).toContain(phrase);
    expect(body.error).toContain('#41');
    expect(body.error).not.toContain(status);          // 영문 상태 코드 노출 금지
    if (phrase.includes('만료되어')) expect(body.error).not.toContain('중복');
  });

  test('원본이 없으면 404 · INSERT 0건', async () => {
    const res = await POST(req(scenarioDetailPayload({ sourceSignalId: 9999 })));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ ok: false });
    expect(inserts()).toHaveLength(0);
  });

  test.each([['detected'], ['pending_approval'], ['pending']])('원본 상태 %p 는 예전처럼 선점된다(과도차단 금지)', async (status) => {
    mem.rows[0].status = status;
    const res = await POST(req(scenarioDetailPayload()));
    expect(res.status).toBe(200);
    expect(inserts()).toHaveLength(2);
  });

  test('🔴 같은 원본을 두 번 확정 → 두 번째는 409, 분할 묶음은 하나만 생긴다', async () => {
    const first = await POST(req(scenarioDetailPayload()));
    const second = await POST(req(scenarioDetailPayload()));
    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(mem.rows.filter(r => r.scenario_source === 'user')).toHaveLength(2);   // 첫 확정의 2분할뿐
  });

  test('🔴 2번째 분할 INSERT 실패 → 500 · rollback 으로 원본은 승인 대기로 복원 · 행 0건', async () => {
    failInsertNo = 2;
    const res = await POST(req(scenarioDetailPayload()));
    expect(res.status).toBe(500);
    expect(events).toContain('rollback');
    expect(events).not.toContain('commit');
    expect(mem.rows.find(r => r.id === 41)?.status).toBe('awaiting_approval');
    expect(mem.rows.filter(r => r.scenario_source === 'user')).toHaveLength(0);
    expect(events.filter(e => e === 'release' || e === 'destroy')).toHaveLength(1);
  });

  // 라운드3(Codex C2 critical): 예전 시험 "sourceSignalId 경로는 (종목·방향) 락을 잡지 않는다" 를 **반대 사양**으로 바꿨다 —
  //   락을 건너뛰면 직접 경로와 같은 구간을 동시에 넣을 수 있었다. 이제 두 경로가 같은 락·같은 중복 검사를 거친다.
  test('🔴 sourceSignalId 경로도 (종목·방향) 락 → begin → 선점 → 활성 중복 검사 → INSERT → commit → 락 해제 순서', async () => {
    const res = await POST(req(scenarioDetailPayload()));
    expect(res.status).toBe(200);
    expect(events.filter(e => e !== 'getConnection'))
      .toEqual(['GET_LOCK', 'begin', 'UPDATE', 'SELECT_ACTIVE', 'INSERT', 'INSERT', 'commit', 'RELEASE_LOCK', 'release']);
    const lockCalls = calls.filter(c => /GET_LOCK|RELEASE_LOCK/i.test(c.sql));
    expect(lockCalls).toHaveLength(2);
    expect(lockCalls.every(c => c.via === 'conn')).toBe(true);
    expect(lockCalls[0].params[1]).toBe(0);
  });
});

// ── T-052 D-1(c) — 직접 작성 경로: (종목·방향) 직렬화 + 활성 중복 거절 ─────────────────────────
describe('POST custom/confirm — 같은 (종목·방향·구간) 활성 사용자 시나리오가 있으면 거절 (T-052 D-1 c)', () => {
  const activeUserRow = (over: Partial<MemRow> = {}): MemRow => ({
    id: 500, symbol: '005930', side: 'buy', status: 'approved_pending_entry', scenario_source: 'user',
    consumed_order_id: null, expires_at: '2026-10-20 09:00:00',
    indicators: JSON.stringify({ ai: { scenario: { entry: { price_zone: '68600~69300' } } } }),
    ...over,
  });

  test('락 → begin → 활성 조회 → INSERT → commit → 락 해제 → 연결 반환 순서', async () => {
    const res = await POST(req(buildPagePayload()));
    expect(res.status).toBe(200);
    const flow = events.filter(e => e !== 'getConnection');
    expect(flow).toEqual(['GET_LOCK', 'begin', 'SELECT_ACTIVE', 'INSERT', 'commit', 'RELEASE_LOCK', 'release']);
    // Reviewer R-1: 명명 락은 세션(연결)에 붙는다 — 획득·해제가 둘 다 getConnection() 이 준 전용 연결에서 일어나야 한다.
    //   pool.query 로 보내면 임의의 풀 연결에 락이 걸리고 다른 연결에서 풀려 해 누수·직렬화 붕괴가 난다(이 단언 전에는 그 변이가 생존).
    const lockCalls = calls.filter(c => /GET_LOCK|RELEASE_LOCK/i.test(c.sql));
    expect(lockCalls).toHaveLength(2);
    expect(lockCalls.every(c => c.via === 'conn')).toBe(true);
    // Reviewer R-5 → 라운드3(Codex C2 medium, Leader 결정): 락 대기 0 — 기다리는 동안 풀 연결을 쥐지 않게 한다(2 → 0 으로 사양 변경)
    expect(lockCalls[0].params[1]).toBe(CONFIRM_LOCK_WAIT_SEC);
    expect(lockCalls[0].params[1]).toBe(0);
  });

  test('락 대기 상수는 0초다 (라운드3 — 못 잡으면 기다리지 않고 409 로 연결을 돌려준다)', () => {
    expect(CONFIRM_LOCK_WAIT_SEC).toBe(0);
  });

  test('🔴 같은 구간의 활성 시나리오가 있으면 409 · INSERT 0건 · 기존 행 번호를 알려 준다', async () => {
    mem.rows.push(activeUserRow());
    const res = await POST(req(buildPagePayload()));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('#500');
    expect(body.error).toContain('68600~69300');
    // Reviewer R-4: 사용자 문구 — 무엇이 겹쳤는지 한국어로
    expect(body.error).toContain('같은 종목·방향·구간');
    expect(body.error).toContain('이미 진행 중입니다');
    expect(inserts()).toHaveLength(0);
    expect(events).toContain('rollback');
    expect(events).toContain('RELEASE_LOCK');
  });

  test('🔴 같은 요청을 연달아 두 번 → 두 번째는 409', async () => {
    const first = await POST(req(buildPagePayload()));
    const second = await POST(req(buildPagePayload()));
    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(mem.rows.filter(r => r.scenario_source === 'user')).toHaveLength(1);
  });

  test('executing(주문 번호 없음 = 주문 진행 중)도 활성으로 본다', async () => {
    mem.rows.push(activeUserRow({ status: 'executing' }));
    const res = await POST(req(buildPagePayload()));
    expect(res.status).toBe(409);
  });

  test('분할 중 한 구간만 겹쳐도 409', async () => {
    mem.rows.push(activeUserRow({ indicators: JSON.stringify({ ai: { scenario: { entry: { price_zone: '69400~70000' } } } }) }));
    const res = await POST(req(scenarioDetailPayload({ sourceSignalId: undefined })));
    expect(res.status).toBe(409);
    expect(inserts()).toHaveLength(0);
  });

  test.each([
    ['구간이 다르다', activeUserRow({ indicators: JSON.stringify({ ai: { scenario: { entry: { price_zone: '60000~61000' } } } }) })],
    ['방향이 다르다', activeUserRow({ side: 'sell' })],
    ['종목이 다르다', activeUserRow({ symbol: '000660' })],
    ['만료됐다(정당한 재등록)', activeUserRow({ expires_at: '2026-10-19 08:59:59' })],
    ['체결돼 소비됐다(정당한 재등록)', activeUserRow({ status: 'executing', consumed_order_id: 77 })],
    ['상태가 expired', activeUserRow({ status: 'expired' })],
    ['AI 시나리오다(scenario_source≠user)', activeUserRow({ scenario_source: 'ai' })],
    ['indicators 가 깨졌다', activeUserRow({ indicators: '{not json' })],
  ])('과도차단 금지 — 기존 행이 %s → 200', async (_label, row) => {
    mem.rows.push(row);
    const res = await POST(req(buildPagePayload()));
    expect(res.status).toBe(200);
    expect(inserts()).toHaveLength(1);
  });

  test('활성 조회 SQL 은 (symbol, side) 를 바인딩하고 미소비·미만료·user 조건을 담는다', async () => {
    await POST(req(buildPagePayload()));
    const sel = calls.find(c => c.via === 'conn' && /^\s*SELECT[\s\S]*FROM\s+signals/i.test(c.sql) && !/GET_LOCK/i.test(c.sql));
    expect(sel).toBeDefined();
    expect(sel!.params.slice(0, 2)).toEqual(['005930', 'buy']);
    const sql = sel!.sql.replace(/\s+/g, ' ');
    // 메모리 DB 목은 SQL 문을 해석하지 않으므로(바인딩 값으로 흉내만 낸다) 술어가 SQL 에 실제로 있는지 따로 고정한다.
    expect(sql).toContain('WHERE symbol = ? AND side = ? AND');
    expect(sql).toContain("scenario_source = 'user'");
    expect(sql).toContain('consumed_order_id IS NULL');
    expect(sql).toContain('expires_at > NOW()');
    expect(sql).toMatch(/status IN \('approved_pending_entry', ?'executing'\)/);
  });

  test('🔴 락 대기 시간 초과(GET_LOCK=0) → 409 · INSERT 0건 · 트랜잭션을 열지 않는다 · 연결 반환', async () => {
    lockGot = 0;
    const res = await POST(req(buildPagePayload()));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false });
    expect(body.error).toContain('잠시 후 다시 시도해 주세요');   // Reviewer R-4
    expect(inserts()).toHaveLength(0);
    expect(events).not.toContain('begin');
    expect(events).not.toContain('RELEASE_LOCK');     // 잡지 못한 락은 풀지 않는다
    expect(events.filter(e => e === 'release')).toHaveLength(1);
  });

  // 라운드3(Leader 결정): NULL(서버 오류)도 "락을 못 잡음" 으로 취급해 500 이 아니라 409 — 값은 정상 수신했으므로 연결은 반환한다.
  test('GET_LOCK 오류(NULL) → 409 · INSERT 0건 · 트랜잭션 없음 · 연결은 폐기하지 않고 반환', async () => {
    lockGot = null;
    const res = await POST(req(buildPagePayload()));
    expect(res.status).toBe(409);
    expect(inserts()).toHaveLength(0);
    expect(events).not.toContain('begin');
    expect(events).not.toContain('destroy');
    expect(events.filter(e => e === 'release')).toHaveLength(1);
  });

  test('🔴 GET_LOCK 호출이 거부되면(응답 유실) 연결을 풀에 돌려주지 않고 폐기한다 (Reviewer R-3)', async () => {
    // 서버에서는 락을 잡았는데 응답만 잃었을 수 있다 — 그 연결을 풀에 돌려주면 락이 남아 같은 (종목·방향) 확정이 막힌다.
    lockGot = 'throw';
    const res = await POST(req(buildPagePayload()));
    expect(res.status).toBe(500);
    expect(inserts()).toHaveLength(0);
    expect(events).not.toContain('begin');
    expect(events).toContain('destroy');
    expect(events).not.toContain('release');
  });

  test('🔴 RELEASE_LOCK 이 실패하면 연결을 풀에 돌려주지 않고 폐기한다(락 누수 방지)', async () => {
    releaseRel = 'throw';
    const res = await POST(req(buildPagePayload()));
    expect(res.status).toBe(200);                      // 이미 커밋됐다 — 응답은 성공
    expect(events).toContain('destroy');
    expect(events).not.toContain('release');
  });

  test('RELEASE_LOCK 이 1 이 아니면(락을 잃음) 역시 폐기', async () => {
    releaseRel = 0;
    await POST(req(buildPagePayload()));
    expect(events).toContain('destroy');
    expect(events).not.toContain('release');
  });

  test('INSERT 실패 → 500 · rollback · 락 해제 · 연결 반환', async () => {
    failInsertNo = 1;
    const res = await POST(req(buildPagePayload()));
    expect(res.status).toBe(500);
    expect(events).toContain('rollback');
    expect(events).toContain('RELEASE_LOCK');
    expect(events.filter(e => e === 'release')).toHaveLength(1);
  });

  test('락 이름은 (종목·방향)마다 같고, 다르면 다르며, MariaDB 한도 64자 이내', async () => {
    const lockNames: string[] = [];
    for (const body of [buildPagePayload(), buildPagePayload(), buildPagePayload({ direction: 'sell' }), buildPagePayload({ symbol: 'NAS:AAPL', market: 'overseas' })]) {
      calls = [];
      mem.rows = mem.rows.filter(r => r.scenario_source !== 'user');
      await POST(req(body));
      const lock = calls.find(c => /GET_LOCK/i.test(c.sql));
      lockNames.push(String(lock!.params[0]));
    }
    expect(lockNames[0]).toBe(lockNames[1]);
    expect(new Set(lockNames).size).toBe(3);
    expect(lockNames.every(n => n.length <= 64)).toBe(true);
  });
});

// ── T-052 라운드3 (Codex C2 critical) — 경로 사이 직렬화: 두 경로가 같은 락·같은 활성 구간 중복 검사 ────────────
describe('POST custom/confirm — 직접 경로와 sourceSignalId 경로가 서로의 중복을 막는다 (T-052 라운드3)', () => {
  const activeUserRow = (over: Partial<MemRow> = {}): MemRow => ({
    id: 500, symbol: '005930', side: 'buy', status: 'approved_pending_entry', scenario_source: 'user',
    consumed_order_id: null, expires_at: '2026-10-20 09:00:00',
    indicators: JSON.stringify({ ai: { scenario: { entry: { price_zone: '68600~69300' } } } }),
    ...over,
  });

  test('🔴 직접 경로로 먼저 등록 → 같은 구간의 AI 시그널을 sourceSignalId 로 확정 → 409 · INSERT 없음 · 원본 선점 되돌림', async () => {
    expect((await POST(req(buildPagePayload()))).status).toBe(200);
    const before = inserts().length;
    const res = await POST(req(scenarioDetailPayload()));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain('같은 종목·방향·구간');
    expect(inserts()).toHaveLength(before);
    expect(mem.rows.find(r => r.id === 41)?.status).toBe('awaiting_approval');   // rollback 으로 선점 복원
    expect(events.filter(e => e === 'rollback').length).toBeGreaterThanOrEqual(1);
  });

  test('🔴 sourceSignalId 로 먼저 확정 → 같은 구간을 직접 경로로 → 409', async () => {
    expect((await POST(req(scenarioDetailPayload()))).status).toBe(200);
    const res = await POST(req(buildPagePayload()));
    expect(res.status).toBe(409);
    expect(mem.rows.filter(r => r.scenario_source === 'user')).toHaveLength(2);   // 첫 확정의 2분할뿐
  });

  test('🔴 서로 다른 원본 둘이 같은 구간 → 두 번째는 409 이고 두 번째 원본은 승인 대기로 남는다', async () => {
    mem.rows.push({ ...mem.rows[0], id: 42 });
    expect((await POST(req(scenarioDetailPayload()))).status).toBe(200);
    const res = await POST(req(scenarioDetailPayload({ sourceSignalId: 42 })));
    expect(res.status).toBe(409);
    expect(mem.rows.find(r => r.id === 42)?.status).toBe('awaiting_approval');
    expect(mem.rows.filter(r => r.scenario_source === 'user')).toHaveLength(2);
  });

  test('🔴 활성 사용자 행과 구간이 겹치면 sourceSignalId 경로도 409 · rollback · 원본 복원 · commit 없음', async () => {
    mem.rows.push(activeUserRow());
    const res = await POST(req(scenarioDetailPayload()));
    expect(res.status).toBe(409);
    expect(inserts()).toHaveLength(0);
    expect(events).toContain('rollback');
    expect(events).not.toContain('commit');
    expect(events).toContain('RELEASE_LOCK');
    expect(mem.rows.find(r => r.id === 41)?.status).toBe('awaiting_approval');
  });

  test('과도차단 금지 — AI 원본 행 자신·다른 AI 진입 감시 행은 중복으로 잡히지 않는다(scenario_source=user 만 본다)', async () => {
    // 원본 41 과 같은 구간을 가진 AI 행(진입 감시 중)을 둔다 — 사용자 시나리오가 아니므로 막지 않는다
    mem.rows[0].indicators = JSON.stringify({ ai: { scenario: { entry: { price_zone: '68600~69300' } } } });
    mem.rows.push(activeUserRow({ id: 43, scenario_source: 'ai' }));
    const res = await POST(req(scenarioDetailPayload()));
    expect(res.status).toBe(200);
    expect(inserts()).toHaveLength(2);
  });

  test.each([
    ['구간이 다르다', activeUserRow({ indicators: JSON.stringify({ ai: { scenario: { entry: { price_zone: '60000~61000' } } } }) })],
    ['방향이 다르다', activeUserRow({ side: 'sell' })],
    ['종목이 다르다', activeUserRow({ symbol: '000660' })],
  ])('과도차단 금지 — sourceSignalId 경로에서 기존 사용자 행이 %s → 200', async (_label, row) => {
    mem.rows.push(row);
    const res = await POST(req(scenarioDetailPayload()));
    expect(res.status).toBe(200);
    expect(inserts()).toHaveLength(2);
  });

  test('🔴 두 경로는 같은 (종목·방향)에 같은 락 이름을 쓴다', async () => {
    await POST(req(buildPagePayload()));
    await POST(req(scenarioDetailPayload({ manualSlices: [{ zoneLo: 60000, zoneHi: 61000, qty: 1 }], splits: 1 })));
    const names = calls.filter(c => /GET_LOCK/i.test(c.sql)).map(c => c.params[0]);
    expect(names).toHaveLength(2);
    expect(names[0]).toBe(names[1]);
  });

  test('🔴 R-8: 철자만 다른 같은 종목·방향(대소문자·공백)도 두 경로가 같은 락 이름을 쓰고, 저장값은 요청 그대로다', async () => {
    await POST(req(buildPagePayload({ symbol: 'NAS:AAPL', market: 'overseas' })));
    await POST(req(scenarioDetailPayload({
      symbol: ' nas:aapl ', market: 'overseas', direction: 'BUY',
      manualSlices: [{ zoneLo: 60000, zoneHi: 61000, qty: 1 }], splits: 1,
    })));
    const names = calls.filter(c => /GET_LOCK/i.test(c.sql)).map(c => c.params[0]);
    expect(names).toHaveLength(2);
    expect(names[0]).toBe(names[1]);
    // 락 이름만 정규화한다 — DB 에 넣는 symbol·side 는 바꾸지 않는다(저장값 정규화는 별개 변경)
    expect(inserts().map(c => [c.params[1], c.params[2]])).toEqual([['NAS:AAPL', 'buy'], [' nas:aapl ', 'BUY']]);
  });

  test('🔴 sourceSignalId 경로에서 락을 못 잡으면(0) 409 · 원본을 건드리지 않는다 · 연결 반환', async () => {
    lockGot = 0;
    const res = await POST(req(scenarioDetailPayload()));
    expect(res.status).toBe(409);
    expect(calls.some(c => /^\s*UPDATE signals/i.test(c.sql))).toBe(false);
    expect(mem.rows.find(r => r.id === 41)?.status).toBe('awaiting_approval');
    expect(events).not.toContain('destroy');
    expect(events.filter(e => e === 'release')).toHaveLength(1);
  });
});
