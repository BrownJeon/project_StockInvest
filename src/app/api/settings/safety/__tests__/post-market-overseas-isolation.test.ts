/**
 * T-101 Reviewer F-2 (Leader 채택) — 긴급 제어 라우트와 엔진 모듈의 결합 축소.
 *
 * `/api/settings/safety` 는 KILL_SWITCH·DRY_RUN 같은 긴급 제어를 호스팅한다. 해외 장마감 후 분석 엔진
 * (`post-market-overseas.ts` → llm·rag·텔레그램·시그널 모듈 트리)이 로드에 실패해도 이 라우트는 살아 있어야 한다.
 *
 * 고정하는 것:
 *  - 라우트 모듈을 불러오는 것만으로는 엔진 모듈을 로드하지 않는다(정적 import 없음).
 *  - PATCH 는 어떤 필드든 엔진 모듈을 **한 번도** 로드하지 않는다.
 *  - GET 은 엔진 모듈 로드·판독이 실패하면 `postMarketOverseasEnabled` 만 false(꺼짐 방향)이고 나머지는 정상.
 *  - 엔진 판독기가 정상이면 그 결과를 그대로 쓴다(판정식 복제 없음).
 *
 * 엔진 모듈은 모킹한다: `mockEngine.mode === 'load-fail'` 이면 모듈 로드 자체가 throw 한다.
 * (jest 는 factory 가 throw 하면 모듈을 등록하지 않아 다음 require 때 다시 factory 를 부른다. 한 번 성공하면
 *  캐시되므로 'load-fail' 시험을 파일 앞쪽에 둔다.)
 */
import type { NextRequest } from 'next/server';

const mockEngine: {
  mode: 'load-fail' | 'ok';
  loads: number;
  reader: () => Promise<{ enabled: unknown; source: string }>;
} = {
  mode: 'load-fail',
  loads: 0,
  reader: async () => ({ enabled: false, source: 'missing' }),
};

jest.mock('@/lib/strategy/post-market-overseas', () => {
  mockEngine.loads += 1;
  if (mockEngine.mode === 'load-fail') throw new Error('engine module load failed (test)');
  return { readPostMarketOverseasSwitch: () => mockEngine.reader() };
});

const mockDb: { writes: { key: string; value: string }[] } = { writes: [] };
jest.mock('@/lib/db', () => ({
  getPool: () => ({
    query: async (sql: string, params?: unknown[]) => {
      if (/INSERT INTO system_config/i.test(sql)) {
        const [key, value] = params as [string, string];
        mockDb.writes.push({ key, value });
        return [{}];
      }
      if (/COUNT\(\*\)/i.test(sql)) return [[{ cnt: 1 }]];
      if (/LIKE 'safety_%'/.test(sql)) {
        return [[{ key: 'safety_kill_switch', value: 'true' }, { key: 'strategy_analyst_enabled', value: 'true' }, { key: 'safety_order_max_pct', value: '5' }]];
      }
      return [[]];
    },
  }),
}));
jest.mock('@/lib/safety/dry-run', () => ({ isDryRun: async () => true }));
jest.mock('@/lib/signals/router', () => ({ syncEngineSwitchesFromLegacy: async () => undefined }));

import { GET, PATCH } from '@/app/api/settings/safety/route';
import * as routeModule from '@/app/api/settings/safety/route';

const loadsAfterRouteImport = mockEngine.loads;

function makeReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

let errSpy: jest.SpyInstance;
let warnSpy: jest.SpyInstance;
beforeEach(() => {
  mockDb.writes.length = 0;
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => { errSpy.mockRestore(); warnSpy.mockRestore(); });

test('route 파일의 export 는 GET·PATCH·dynamic 만 — Next App Router 는 그 밖의 export 를 빌드에서 거부한다 (Reviewer F-8)', () => {
  const allowed = new Set(['GET', 'PATCH', 'dynamic']);
  const exported = Object.keys(routeModule).filter(k => k !== '__esModule');
  expect(exported.filter(k => !allowed.has(k))).toEqual([]);
  expect(exported).toEqual(expect.arrayContaining(['GET', 'PATCH', 'dynamic']));
});

describe('엔진 모듈 로드 실패 (mode=load-fail)', () => {
  test('라우트를 불러오는 것만으로는 엔진 모듈을 로드하지 않는다 (정적 import 없음)', () => {
    expect(loadsAfterRouteImport).toBe(0);
  });

  test('PATCH — 이 스위치·긴급 제어·잘못된 값 모두 엔진 모듈을 한 번도 로드하지 않는다', async () => {
    const before = mockEngine.loads;

    const r1 = await PATCH(makeReq({ postMarketOverseasEnabled: true }));
    expect(r1.status).toBe(200);
    expect(mockDb.writes).toEqual([{ key: 'post_market_overseas_enabled', value: 'true' }]);

    const r2 = await PATCH(makeReq({ killSwitch: true, dryRun: true }));
    expect(r2.status).toBe(200);

    const r3 = await PATCH(makeReq({ postMarketOverseasEnabled: 'true' }));
    expect(r3.status).toBe(400);

    expect(mockEngine.loads).toBe(before);
    expect(mockEngine.loads).toBe(0);
  });

  test('GET — 200, 긴급 제어 등 나머지 필드는 정상이고 postMarketOverseasEnabled 만 false, 오류 로그', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; safety: Record<string, unknown>; exchanges: unknown };
    expect(body.ok).toBe(true);
    expect(body.safety.postMarketOverseasEnabled).toBe(false);
    expect(body.safety.killSwitch).toBe(true);
    expect(body.safety.dryRun).toBe(true);
    expect(body.safety.analystEnabled).toBe(true);
    expect(body.safety.orderMaxPct).toBe(5);
    expect(body.exchanges).toBeDefined();
    expect(mockEngine.loads).toBeGreaterThan(0);   // 지연 import 를 시도는 했다
    expect(errSpy.mock.calls.map(c => String(c[0])).join('\n')).toContain('해외 장마감 후 분석 스위치 판독 실패');
  });
});

describe('엔진 모듈 정상 (mode=ok) — 판독기 결과를 그대로 쓴다', () => {
  beforeAll(() => { mockEngine.mode = 'ok'; });

  test('판독기 enabled=true → true', async () => {
    mockEngine.reader = async () => ({ enabled: true, source: 'value' });
    const body = await (await GET()).json() as { safety: Record<string, unknown> };
    expect(body.safety.postMarketOverseasEnabled).toBe(true);
  });

  test('판독기 enabled=false → false', async () => {
    mockEngine.reader = async () => ({ enabled: false, source: 'missing' });
    const body = await (await GET()).json() as { safety: Record<string, unknown> };
    expect(body.safety.postMarketOverseasEnabled).toBe(false);
  });

  test('판독기가 reject 해도 → false, 나머지 정상', async () => {
    mockEngine.reader = async () => { throw new Error('reader boom'); };
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json() as { safety: Record<string, unknown> };
    expect(body.safety.postMarketOverseasEnabled).toBe(false);
    expect(body.safety.killSwitch).toBe(true);
  });

  test('판독기가 boolean 아닌 값을 돌려줘도 true 로 승격하지 않는다', async () => {
    mockEngine.reader = async () => ({ enabled: 'true', source: 'value' });
    const body = await (await GET()).json() as { safety: Record<string, unknown> };
    expect(body.safety.postMarketOverseasEnabled).toBe(false);
  });

  test('PATCH 는 엔진 모듈이 로드 가능해도 판독기를 부르지 않는다', async () => {
    const reader = jest.fn(async () => ({ enabled: true, source: 'value' }));
    mockEngine.reader = reader;
    await PATCH(makeReq({ postMarketOverseasEnabled: false }));
    expect(reader).not.toHaveBeenCalled();
    expect(mockDb.writes).toEqual([{ key: 'post_market_overseas_enabled', value: 'false' }]);
  });
});
