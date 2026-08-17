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

type QueryCall = { sql: string; params: unknown[] };

let calls: QueryCall[];
let insertSeq: number;

beforeEach(() => {
  jest.clearAllMocks();
  calls = [];
  insertSeq = 100;

  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (/^\s*INSERT/i.test(sql)) return [{ insertId: ++insertSeq }, []];
    if (/system_config/i.test(sql)) return [[], []];      // 알람 설정 미기록 → 기본 true
    return [{ affectedRows: 1 }, []];
  });
  (getPool as jest.Mock).mockReturnValue({ query });
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
  exit: { holding_deadline: '2026-08-21' },
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
