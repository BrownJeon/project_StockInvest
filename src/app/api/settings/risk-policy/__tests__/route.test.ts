/**
 * T-066 GET/PUT /api/settings/risk-policy — 메모리 가짜 DB 로 검증한다(운영 DB 에 쓰지 않는다).
 * 숫자는 데모 v3 합성값(AAA~EEE, 환율 1,250)이다.
 *
 * 확인: 정책 없음(null)과 조회 오류 구분 · 첫 저장/갱신 · 검증 오류 400 · 409(버전 불일치·INSERT 경합·UPDATE 경합) ·
 *       소수 2자리 반올림 · history 20건 상한 · **저장 JSON 에 읽기 전용 값이 없음** · 쓰기는 system_config.risk_policy 뿐.
 * T-068 WP-A: 현금 하한 null(정보 표시) · 분할 최대 4회(비율 없음) · `execution`(확정 1회당 조각 상한 = MAX_SCENARIO_SPLITS,
 *       국내 자동 매수 한도 = 엔진과 같은 판독기 getStyleConfig 의 maxPositionsPerSymbol, 판독 실패 → null).
 */
import type { NextRequest } from 'next/server';

interface FakeState {
  policy: string | null;
  snapshot: { ts: Date; total_krw: number; positions: string } | null;
  states: { symbol: string; market: string; entry_price: string; peak_price: string }[];
  failSelectPolicy: boolean;
  /** 다음 정책 SELECT 1회는 '없음'으로 응답 (INSERT 경합 재현) */
  hidePolicyOnce: boolean;
  /** 다음 UPDATE 직전에 다른 기기가 version 을 올린 것처럼 바꾼다 (UPDATE 경합 재현) */
  bumpBeforeUpdate: boolean;
}

const db: FakeState = {
  policy: null, snapshot: null, states: [],
  failSelectPolicy: false, hidePolicyOnce: false, bumpBeforeUpdate: false,
};
const sqlLog: { sql: string; params: unknown[] }[] = [];

jest.mock('@/lib/db', () => ({
  getPool: () => ({
    query: async (sql: string, params: unknown[] = []) => {
      sqlLog.push({ sql, params });
      if (/^SELECT value FROM system_config/i.test(sql)) {
        if (db.failSelectPolicy) throw new Error('connect ETIMEDOUT');
        if (db.hidePolicyOnce) { db.hidePolicyOnce = false; return [[]]; }
        return [db.policy === null ? [] : [{ value: db.policy }]];
      }
      if (/^INSERT INTO system_config/i.test(sql)) {
        if (db.policy !== null) {
          throw Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY', errno: 1062 });
        }
        db.policy = params[1] as string;
        return [{ affectedRows: 1 }];
      }
      if (/^UPDATE system_config/i.test(sql)) {
        if (db.bumpBeforeUpdate && db.policy) {
          db.bumpBeforeUpdate = false;
          const p = JSON.parse(db.policy);
          db.policy = JSON.stringify({ ...p, version: p.version + 1, stopPct: 2.5 });
        }
        const cur = db.policy ? JSON.parse(db.policy) : null;
        if (!cur || cur.version !== params[2]) return [{ affectedRows: 0 }];
        db.policy = params[0] as string;
        return [{ affectedRows: 1 }];
      }
      if (/FROM portfolio_snapshots/i.test(sql)) return [db.snapshot ? [db.snapshot] : []];
      if (/FROM position_state/i.test(sql)) return [db.states];
      throw new Error(`unexpected SQL: ${sql}`);
    },
  }),
}));
jest.mock('@/lib/strategy/exit-switch', () => ({
  readExitEngineSwitch: async () => ({ enabled: false, hardStopEnabled: true, source: 'config', raw: null }),
}));
/** 엔진과 같은 스타일 판독기 — 시험마다 반환값/예외를 바꾼다(실제 판독기는 DB 를 읽으므로 가짜 DB 와 분리) */
const style: { impl: () => Promise<{ maxPositionsPerSymbol: unknown }> } = { impl: async () => ({ maxPositionsPerSymbol: 4 }) };
const styleCalls = { n: 0 };
jest.mock('@/lib/strategy/style', () => ({
  getStyleConfig: () => { styleCalls.n++; return style.impl(); },
}));

import { GET, PUT } from '@/app/api/settings/risk-policy/route';
import { MAX_SCENARIO_SPLITS } from '@/lib/safety/scenario-confirm-fields';

const FX = 1250;
function seedPortfolio(ageMs = 10 * 60 * 1000) {
  const pos = [
    { currency: 'KRW', qty: 100_000, price: 1, value_krw: 100_000, locked: 0 },
    { currency: 'USD', qty: 400, price: FX, value_krw: 500_000, locked: 0 },
    { currency: 'NAS:AAA', qty: 80, price: 124 * FX, value_krw: 124 * FX * 80 },
    { currency: 'NAS:BBB', qty: 20, price: 48 * FX, value_krw: 48 * FX * 20 },
    { currency: 'CCC001', qty: 50, price: 60_000, value_krw: 3_000_000 },
    { currency: 'DDD001', qty: 40, price: 50_000, value_krw: 2_000_000 },
    { currency: 'EEE001', qty: 20, price: 40_000, value_krw: 800_000 },
  ];
  db.snapshot = { ts: new Date(Date.now() - ageMs), total_krw: 20_000_000, positions: JSON.stringify(pos) };
  db.states = [
    { symbol: 'NAS:AAA', market: 'overseas', entry_price: String(132 * FX), peak_price: String(140 * FX) },
    { symbol: 'NAS:BBB', market: 'overseas', entry_price: String(60 * FX), peak_price: String(62 * FX) },
    { symbol: 'CCC001', market: 'domestic', entry_price: '72000.00000000', peak_price: '75000.00000000' },
    { symbol: 'DDD001', market: 'domestic', entry_price: '62500', peak_price: '66000' },
    { symbol: 'EEE001', market: 'domestic', entry_price: '80000', peak_price: '82000' },
  ];
}

function put(body: unknown): Promise<Response> {
  return PUT({ json: async () => body } as unknown as NextRequest);
}
async function json(res: Response) {
  return res.json() as Promise<{ ok: boolean; error?: string; code?: string; fieldErrors?: Record<string, string>; warnings?: string[]; data?: ReturnType<typeof JSON.parse> }>; // 응답 본문을 자유롭게 탐색(JSON 값)
}
const stored = () => (db.policy ? JSON.parse(db.policy) : null);
const writes = () => sqlLog.filter(l => /^\s*(INSERT|UPDATE|DELETE|REPLACE|ALTER|CREATE|DROP)/i.test(l.sql));

beforeEach(() => {
  db.policy = null; db.failSelectPolicy = false; db.hidePolicyOnce = false; db.bumpBeforeUpdate = false;
  sqlLog.length = 0;
  style.impl = async () => ({ maxPositionsPerSymbol: 4 });
  styleCalls.n = 0;
  seedPortfolio();
});

afterEach(() => {
  // 어떤 경우에도 쓰기는 system_config 의 risk_policy 키 하나뿐이다
  for (const w of writes()) {
    expect(w.sql).toMatch(/system_config/);
    expect(w.params).toContain('risk_policy');
  }
});

describe('GET', () => {
  test('정책 없음 → 200 · policy null · 제안값으로 계산 · 읽기 전용 값은 defaults 로 채움', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const b = await json(res);
    expect(b.ok).toBe(true);
    const d = b.data;
    expect(d.enforcement).toBe('display_only');
    expect(d.policy).toBeNull();
    expect(d.defaults).toEqual({ stopPct: 3, heatCapPct: 2, stopBasis: 'avg' });
    expect(d.readOnly.splitBuy).toEqual({ max: 4 }); // T-068: 4회 · 비율 고정 없음
    expect(d.readOnly.cashFloorPct).toBeNull(); // T-068: 현금 하한 규칙 없음(정보 표시)
    expect(d.readOnly.maxHoldings).toBe(10);
    expect(d.sources.splitBuy).toBe('user');
    expect(d.sources.cashFloorPct).toBe('user');
    expect(d.execution).toEqual({ scenarioSplitCap: 4, domesticMaxBuysPerSymbol24h: 4 });
    expect(d.snapshot).toMatchObject({ stale: false, totalKrw: 20_000_000, cashKrw: 600_000, fx: FX });
    expect(d.holdings).toHaveLength(5);
    expect(d.holdings[0]).toEqual({ symbol: 'NAS:AAA', market: 'overseas', qty: 80, priceKrw: 155_000, avgKrw: 165_000, peakKrw: 175_000 });
    expect(d.holdings[2]).toMatchObject({ symbol: 'CCC001', market: 'domestic', avgKrw: 72_000 });
    expect(d.computed.heatPct.toFixed(2)).toBe('3.36');
    expect(d.computed.maxStopPct).toBe(1.78);
    expect(d.computed.belowLossKrw).toBeCloseTo(-3_000_000, 6);
    expect(d.exitEngine).toEqual({ enabled: false });
    expect(writes()).toHaveLength(0);
  });

  test('스냅샷이 3시간 넘게 지나면 stale', async () => {
    seedPortfolio(3 * 3600 * 1000 + 60_000);
    const d = (await json(await GET())).data;
    expect(d.snapshot.stale).toBe(true);
  });

  test('스냅샷 없음 → snapshot null · 보유 0', async () => {
    db.snapshot = null;
    const d = (await json(await GET())).data;
    expect(d.snapshot).toBeNull();
    expect(d.holdings).toEqual([]);
    expect(d.computed.heatPct).toBeNull();
  });

  test('position_state 에 없거나 entry 0 인 종목은 평균단가 null (계산 불가)', async () => {
    db.states = db.states.filter(s => s.symbol !== 'DDD001').map(s => (s.symbol === 'EEE001' ? { ...s, entry_price: '0', peak_price: '0' } : s));
    const d = (await json(await GET())).data;
    const by = (s: string) => d.holdings.find((h: { symbol: string }) => h.symbol === s);
    expect(by('DDD001').avgKrw).toBeNull();
    expect(by('EEE001').avgKrw).toBeNull();
    expect(d.computed.partial).toBe(true);
  });

  test('DB 오류 → 500 (정책 없음과 구분)', async () => {
    db.failSelectPolicy = true;
    const res = await GET();
    expect(res.status).toBe(500);
    const b = await json(res);
    expect(b.ok).toBe(false);
    expect(b.error).toContain('ETIMEDOUT');
  });

  test('저장값이 손상되면 500', async () => {
    db.policy = '{"version":"x"}';
    const res = await GET();
    expect(res.status).toBe(500);
    expect((await json(res)).error).toContain('읽을 수 없습니다');
  });

  test.each([
    [{ stopPct: 0, heatCapPct: 2 }, 'stopPct 범위 밖'],
    [{ stopPct: 3, heatCapPct: 100 }, 'heatCapPct 범위 밖'],
  ])('저장값이 범위 밖(수동 편집)이면 500 + 복구 안내 — %p', async (vals, detail) => {
    db.policy = JSON.stringify({ version: 1, updatedAt: 'x', stopBasis: 'avg', history: [], ...vals });
    const res = await GET();
    expect(res.status).toBe(500);
    const err = (await json(res)).error ?? '';
    expect(err).toContain(detail);
    expect(err).toContain('risk_policy 키를 삭제한 뒤 리스크 정책 화면에서 다시 저장하세요');
    // PUT 도 덮어쓰지 않는다
    const put500 = await put({ stopPct: 3, heatCapPct: 2, stopBasis: 'avg', baseVersion: 1 });
    expect(put500.status).toBe(500);
    expect(JSON.parse(db.policy as string)).toMatchObject(vals);
  });
});

describe('GET — execution (분할 매수 집행 값, T-068 WP-A)', () => {
  test('확정 1회당 조각 상한은 확정 검증기의 상수 그대로', async () => {
    const d = (await json(await GET())).data;
    expect(d.execution.scenarioSplitCap).toBe(MAX_SCENARIO_SPLITS);
    expect(styleCalls.n).toBe(1); // 엔진 판독기를 한 번 부른다
  });

  test('국내 한도는 판독기 값(DB 덮어쓰기 5 반영)을 그대로 — 화면이 "정책과 다름"을 보일 수 있게', async () => {
    style.impl = async () => ({ maxPositionsPerSymbol: 5 });
    const d = (await json(await GET())).data;
    expect(d.execution).toEqual({ scenarioSplitCap: 4, domesticMaxBuysPerSymbol24h: 5 });
  });

  test.each([
    ['판독기 예외', async () => { throw new Error('boom'); }],
    ['정수가 아님', async () => ({ maxPositionsPerSymbol: 4.5 })],
    ['숫자가 아님', async () => ({ maxPositionsPerSymbol: '4' })],
    ['0 이하', async () => ({ maxPositionsPerSymbol: 0 })],
  ] as [string, () => Promise<{ maxPositionsPerSymbol: unknown }>][])('%s → 국내 한도 null, 화면 전체는 200', async (_n, impl) => {
    style.impl = impl;
    const res = await GET();
    expect(res.status).toBe(200);
    const d = (await json(res)).data;
    expect(d.execution).toEqual({ scenarioSplitCap: 4, domesticMaxBuysPerSymbol24h: null });
    expect(d.computed.heatPct.toFixed(2)).toBe('3.36');
  });

  test('409 응답에도 execution 이 있다(화면이 같은 데이터로 다시 그린다)', async () => {
    await put({ stopPct: 3, heatCapPct: 2, stopBasis: 'avg', baseVersion: 0 });
    const b = await json(await put({ stopPct: 4, heatCapPct: 2, stopBasis: 'avg', baseVersion: 0 }));
    expect(b.code).toBe('conflict');
    expect(b.data.execution).toEqual({ scenarioSplitCap: 4, domesticMaxBuysPerSymbol24h: 4 });
  });
});

describe('PUT — 저장', () => {
  test('첫 저장(baseVersion 0) → version 1 · 저장 JSON 에는 편집 3값·version·updatedAt·history 만', async () => {
    const res = await put({ stopPct: 3, heatCapPct: 2, stopBasis: 'avg', baseVersion: 0 });
    expect(res.status).toBe(200);
    const b = await json(res);
    expect(b.ok).toBe(true);
    expect(b.data.policy).toMatchObject({ version: 1, stopPct: 3, heatCapPct: 2, stopBasis: 'avg' });
    expect(b.data.policy.readOnly.splitBuy.max).toBe(4); // 응답에는 상수에서 채움
    expect(b.data.execution).toEqual({ scenarioSplitCap: 4, domesticMaxBuysPerSymbol24h: 4 });
    const s = stored();
    expect(Object.keys(s).sort()).toEqual(['heatCapPct', 'history', 'stopBasis', 'stopPct', 'updatedAt', 'version']);
    expect(s).not.toHaveProperty('readOnly');
    expect(s).not.toHaveProperty('sources');
    expect(s.history).toEqual([{ version: 1, at: s.updatedAt, stopPct: 3, heatCapPct: 2, stopBasis: 'avg' }]);
    expect(b.data.computed.heatPct.toFixed(2)).toBe('3.36');
  });

  test('baseVersion 생략 = 0 (첫 저장)', async () => {
    const res = await put({ stopPct: 1.5, heatCapPct: 2, stopBasis: 'avg' });
    expect(res.status).toBe(200);
    expect(stored().version).toBe(1);
    expect((await json(res)).data.computed.heatPct.toFixed(2)).toBe('1.68');
  });

  test('갱신(baseVersion 일치) → version +1 · history 누적 · 조건부 UPDATE', async () => {
    await put({ stopPct: 3, heatCapPct: 2, stopBasis: 'avg', baseVersion: 0 });
    const res = await put({ stopPct: 1.5, heatCapPct: 2, stopBasis: 'peak', baseVersion: 1 });
    expect(res.status).toBe(200);
    const s = stored();
    expect(s).toMatchObject({ version: 2, stopPct: 1.5, stopBasis: 'peak' });
    expect(s.history.map((h: { version: number }) => h.version)).toEqual([1, 2]);
    const upd = sqlLog.find(l => /^UPDATE/.test(l.sql));
    expect(upd?.sql).toContain("CAST(JSON_EXTRACT(value, '$.version') AS UNSIGNED) = ?");
    expect(upd?.params[2]).toBe(1);
  });

  test('소수 2자리 반올림 · 10% 초과 손절폭은 저장하되 경고', async () => {
    const res = await put({ stopPct: 10.456, heatCapPct: 2.345, stopBasis: 'avg', baseVersion: 0 });
    expect(res.status).toBe(200);
    const b = await json(res);
    expect(stored()).toMatchObject({ stopPct: 10.46, heatCapPct: 2.35 });
    expect(b.warnings).toEqual(['10%보다 크면 손절이 늦어져 한 번에 잃는 돈이 커집니다.']);
  });

  test('history 는 최근 20건만', async () => {
    const history = Array.from({ length: 20 }, (_, i) => ({ version: i + 6, at: '2026-10-01T00:00:00.000Z', stopPct: 3, heatCapPct: 2, stopBasis: 'avg' }));
    db.policy = JSON.stringify({ version: 25, updatedAt: '2026-10-01T00:00:00.000Z', stopPct: 3, heatCapPct: 2, stopBasis: 'avg', history });
    const res = await put({ stopPct: 2, heatCapPct: 2, stopBasis: 'avg', baseVersion: 25 });
    expect(res.status).toBe(200);
    const s = stored();
    expect(s.history).toHaveLength(20);
    expect(s.history[0].version).toBe(7);
    expect(s.history[19]).toMatchObject({ version: 26, stopPct: 2 });
  });
});

describe('PUT — 409 충돌', () => {
  test('baseVersion 이 현재 version 과 다르면 409 + 최신 정책 · 저장 안 함', async () => {
    await put({ stopPct: 3, heatCapPct: 2, stopBasis: 'avg', baseVersion: 0 });
    await put({ stopPct: 2.5, heatCapPct: 2, stopBasis: 'avg', baseVersion: 1 }); // 다른 기기
    const before = db.policy;
    const res = await put({ stopPct: 4, heatCapPct: 2, stopBasis: 'avg', baseVersion: 1 });
    expect(res.status).toBe(409);
    const b = await json(res);
    expect(b.ok).toBe(false);
    expect(b.code).toBe('conflict');
    expect(b.data.policy).toMatchObject({ version: 2, stopPct: 2.5 });
    expect(db.policy).toBe(before);
  });

  test('정책이 이미 있는데 첫 저장(baseVersion 0)을 보내면 409', async () => {
    await put({ stopPct: 3, heatCapPct: 2, stopBasis: 'avg', baseVersion: 0 });
    const res = await put({ stopPct: 4, heatCapPct: 2, stopBasis: 'avg', baseVersion: 0 });
    expect(res.status).toBe(409);
    expect(stored().stopPct).toBe(3);
  });

  test('INSERT 경합(읽을 땐 없었는데 그새 생김) → 중복 키 → 409', async () => {
    db.policy = JSON.stringify({ version: 1, updatedAt: 'x', stopPct: 2.5, heatCapPct: 2, stopBasis: 'avg', history: [] });
    db.hidePolicyOnce = true;
    const res = await put({ stopPct: 4, heatCapPct: 2, stopBasis: 'avg', baseVersion: 0 });
    expect(res.status).toBe(409);
    expect((await json(res)).data.policy.stopPct).toBe(2.5);
    expect(stored().stopPct).toBe(2.5);
  });

  test('UPDATE 경합(조건부 UPDATE 영향 0행) → 409', async () => {
    await put({ stopPct: 3, heatCapPct: 2, stopBasis: 'avg', baseVersion: 0 });
    db.bumpBeforeUpdate = true;
    const res = await put({ stopPct: 4, heatCapPct: 2, stopBasis: 'avg', baseVersion: 1 });
    expect(res.status).toBe(409);
    expect(stored()).toMatchObject({ version: 2, stopPct: 2.5 });
  });

  test('정책이 없는데 baseVersion > 0 이면 409 (지워진 정책을 갱신하려 함)', async () => {
    const res = await put({ stopPct: 3, heatCapPct: 2, stopBasis: 'avg', baseVersion: 3 });
    expect(res.status).toBe(409);
    expect(db.policy).toBeNull();
  });
});

describe('PUT — 검증 오류 400 (아무것도 쓰지 않음)', () => {
  test.each([
    [{ stopPct: 25, heatCapPct: 2, stopBasis: 'avg' }, 'stopPct'],
    [{ stopPct: 0.4, heatCapPct: 2, stopBasis: 'avg' }, 'stopPct'],
    [{ stopPct: '3', heatCapPct: 2, stopBasis: 'avg' }, 'stopPct'],
    [{ stopPct: 3, heatCapPct: 10.5, stopBasis: 'avg' }, 'heatCapPct'],
    [{ stopPct: 3, heatCapPct: 0.4, stopBasis: 'avg' }, 'heatCapPct'],
    [{ stopPct: 3, heatCapPct: 2, stopBasis: 'close' }, 'stopBasis'],
    [{ stopPct: 3, heatCapPct: 2 }, 'stopBasis'],
    [{ stopPct: 3, heatCapPct: 2, stopBasis: 'avg', baseVersion: -1 }, 'baseVersion'],
    [{ stopPct: 3, heatCapPct: 2, stopBasis: 'avg', baseVersion: 1.5 }, 'baseVersion'],
    [{ stopPct: NaN, heatCapPct: 2, stopBasis: 'avg' }, 'stopPct'],
  ])('%p → 400 (%s)', async (body, field) => {
    const res = await put(body);
    expect(res.status).toBe(400);
    const b = await json(res);
    expect(b.ok).toBe(false);
    expect(Object.keys(b.fieldErrors ?? {})).toContain(field);
    expect(writes()).toHaveLength(0);
  });

  test('JSON 이 아닌 본문 → 400', async () => {
    const res = await PUT({ json: async () => { throw new SyntaxError('bad'); } } as unknown as NextRequest);
    expect(res.status).toBe(400);
  });
});
