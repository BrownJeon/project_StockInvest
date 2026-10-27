/**
 * T-101 — `GET/PATCH /api/settings/safety` 의 '해외 장마감 후 분석' 스위치(`postMarketOverseasEnabled`
 * ↔ `system_config.post_market_overseas_enabled`).
 *
 * 고정하는 것:
 *  - GET 값은 **엔진이 쓰는 판독기(`readPostMarketOverseasSwitch` → `gateSwitchValueEnabled`)와 같은 결과**다
 *    (키 없음·정확히 JSON `true` 외 값·읽기 오류 = false). 화면과 엔진이 갈라지면 "켜져 있다"고 보이는데
 *    분석이 안 돌거나 그 반대가 된다.
 *  - PATCH 는 순수 boolean 만 받고(문자열·숫자·null 은 400, 아무것도 안 씀), 저장 값은 JSON `true`/`false`,
 *    이 키 하나만 쓴다(다른 키 불변).
 *
 * DB 는 모킹한다 — `getPool().query` 를 SQL 모양으로 나눠 답한다. 판독기는 **실제 엔진 모듈의 함수**가
 * 이 모킹된 풀을 읽는다(복제 판정식이 아니다).
 */
import type { NextRequest } from 'next/server';

const SWITCH_KEY_LITERAL = 'post_market_overseas_enabled';

type Row = { value: unknown };
const db: {
  /** post_market_overseas_enabled 행 — undefined 면 키 없음 */
  switchRow: Row | undefined;
  /** true 면 이 키 조회만 실패 */
  switchReadError: boolean;
  safetyCount: number;
  writes: { key: string; value: string }[];
  deletes: unknown[][];
} = { switchRow: undefined, switchReadError: false, safetyCount: 1, writes: [], deletes: [] };

jest.mock('@/lib/db', () => ({
  getPool: () => ({
    query: async (sql: string, params?: unknown[]) => {
      if (/INSERT INTO system_config/i.test(sql)) {
        const [key, value] = params as [string, string];
        db.writes.push({ key, value });
        return [{}];
      }
      if (/^\s*DELETE FROM system_config/i.test(sql)) {
        db.deletes.push((params ?? []) as unknown[]);
        return [{}];
      }
      if (/COUNT\(\*\)/i.test(sql)) return [[{ cnt: db.safetyCount }]];
      if (/WHERE `key` = \? LIMIT 1/.test(sql) && (params ?? [])[0] === SWITCH_KEY_LITERAL) {
        if (db.switchReadError) throw new Error('db down (test)');
        return [db.switchRow ? [db.switchRow] : []];
      }
      return [[]];   // getOverrides·자동 청산 스위치·KIS 유량 등 — 이 시험과 무관(빈 결과)
    },
  }),
}));
jest.mock('@/lib/safety/dry-run', () => ({ isDryRun: async () => true }));
const syncSpy = jest.fn(async () => undefined);
jest.mock('@/lib/signals/router', () => ({ syncEngineSwitchesFromLegacy: () => syncSpy() }));

import { GET, PATCH } from '@/app/api/settings/safety/route';
import { POST_MARKET_OVERSEAS_SWITCH_KEY, readPostMarketOverseasSwitch } from '@/lib/strategy/post-market-overseas';
import { gateSwitchValueEnabled } from '@/lib/signals/signal-cash-gate';

function makeReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

async function getSafety(): Promise<Record<string, unknown>> {
  const res = await GET();
  expect(res.status).toBe(200);
  const body = await res.json() as { ok: boolean; safety: Record<string, unknown> };
  expect(body.ok).toBe(true);
  return body.safety;
}

let warnSpy: jest.SpyInstance;
beforeEach(() => {
  db.switchRow = undefined;
  db.switchReadError = false;
  db.safetyCount = 1;
  db.writes.length = 0;
  db.deletes.length = 0;
  syncSpy.mockClear();
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => warnSpy.mockRestore());

test('엔진 상수와 저장 키 문자열이 같다 (키 오타 = 무반응 스위치)', () => {
  expect(POST_MARKET_OVERSEAS_SWITCH_KEY).toBe(SWITCH_KEY_LITERAL);
});

test('라우트의 리터럴 키 == 엔진 상수 — PATCH 가 실제로 쓴 키로 확인 (라우트는 엔진을 정적 import 하지 않는다)', async () => {
  await PATCH(makeReq({ postMarketOverseasEnabled: true }));
  expect(db.writes.map(w => w.key)).toEqual([POST_MARKET_OVERSEAS_SWITCH_KEY]);
});

describe('GET postMarketOverseasEnabled', () => {
  test('키 없음 = false (지금 운영 상태)', async () => {
    const s = await getSafety();
    expect(s.postMarketOverseasEnabled).toBe(false);
  });

  test("저장 값 'true'(JSON true) = true", async () => {
    db.switchRow = { value: 'true' };
    expect((await getSafety()).postMarketOverseasEnabled).toBe(true);
  });

  test("저장 값 'false' = false", async () => {
    db.switchRow = { value: 'false' };
    expect((await getSafety()).postMarketOverseasEnabled).toBe(false);
  });

  test.each([
    ['"true"'], ['1'], ['0'], ['null'], ['TRUE'], ['True'], ['{"enabled":true}'], ['[true]'], ['not json'], [''], ['"false"'], ['yes'],
  ])('이상한 저장 값 %p = false', async (raw) => {
    db.switchRow = { value: raw };
    expect((await getSafety()).postMarketOverseasEnabled).toBe(false);
  });

  test('읽기 오류 = false 이고, 나머지 응답은 그대로 200', async () => {
    db.switchReadError = true;
    const s = await getSafety();
    expect(s.postMarketOverseasEnabled).toBe(false);
    expect(s).toHaveProperty('killSwitch');
    expect(s).toHaveProperty('analystEnabled');
  });

  test('응답 값은 항상 boolean', async () => {
    for (const raw of ['true', 'false', 'garbage', undefined]) {
      db.switchRow = raw === undefined ? undefined : { value: raw };
      expect(typeof (await getSafety()).postMarketOverseasEnabled).toBe('boolean');
    }
  });

  test('GET 은 이 키를 쓰지 않는다 (빈 DB 시드 경로 포함)', async () => {
    db.safetyCount = 0;   // seedIfEmpty 가 safety_* 를 채우는 경로
    await getSafety();
    expect(db.writes.map(w => w.key)).not.toContain(SWITCH_KEY_LITERAL);
  });
});

describe('GET 값 = 엔진 판정식 (같은 입력 → 같은 결과)', () => {
  // 드라이버가 longtext 를 문자열로 주는 경우 + 이미 파싱된 값을 주는 경우까지
  const INPUTS: unknown[] = [
    'true', 'false', '"true"', '"false"', '1', '0', 'null', 'TRUE', ' true ', 'true\n', '{"a":1}', '[]', 'not json', '',
    true, false, 1, 0, null,
  ];
  test.each(INPUTS.map(v => [v]))('raw=%p', async (raw) => {
    db.switchRow = { value: raw };
    const viaGet = (await getSafety()).postMarketOverseasEnabled;
    const viaEngineReader = (await readPostMarketOverseasSwitch()).enabled;
    expect(viaGet).toBe(gateSwitchValueEnabled(raw));
    expect(viaGet).toBe(viaEngineReader);
  });

  test('키 없음·읽기 오류도 엔진 판독기와 같다', async () => {
    db.switchRow = undefined;
    expect((await getSafety()).postMarketOverseasEnabled).toBe((await readPostMarketOverseasSwitch()).enabled);
    db.switchReadError = true;
    const engine = await readPostMarketOverseasSwitch();
    expect(engine.source).toBe('read_error');
    expect((await getSafety()).postMarketOverseasEnabled).toBe(engine.enabled);
  });
});

describe('PATCH postMarketOverseasEnabled', () => {
  test('true → JSON true 로 이 키 하나만 저장', async () => {
    const res = await PATCH(makeReq({ postMarketOverseasEnabled: true }));
    expect(res.status).toBe(200);
    expect(db.writes).toEqual([{ key: SWITCH_KEY_LITERAL, value: 'true' }]);
  });

  test('false → JSON false 로 이 키 하나만 저장', async () => {
    const res = await PATCH(makeReq({ postMarketOverseasEnabled: false }));
    expect(res.status).toBe(200);
    expect(db.writes).toEqual([{ key: SWITCH_KEY_LITERAL, value: 'false' }]);
  });

  test.each([
    ['true'], ['false'], [1], [0], [null], ['on'], [''], [{}], [[true]],
  ])('boolean 아닌 값 %p 는 400 이고 아무것도 쓰지 않는다', async (bad) => {
    const res = await PATCH(makeReq({ postMarketOverseasEnabled: bad }));
    expect(res.status).toBe(400);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain('postMarketOverseasEnabled');
    expect(db.writes).toHaveLength(0);
    expect(db.deletes).toHaveLength(0);
  });

  test('원자성 — 같은 요청의 다른 유효 필드도 함께 거절', async () => {
    const res = await PATCH(makeReq({ analystEnabled: true, killSwitch: true, postMarketOverseasEnabled: 'true' }));
    expect(res.status).toBe(400);
    expect(db.writes).toHaveLength(0);
    expect(syncSpy).not.toHaveBeenCalled();
  });

  test('이 필드만 보내면 다른 설정 키는 쓰지 않고, 엔진 스위치 동기화도 부르지 않는다', async () => {
    await PATCH(makeReq({ postMarketOverseasEnabled: true }));
    expect(db.writes.map(w => w.key)).toEqual([SWITCH_KEY_LITERAL]);
    expect(syncSpy).not.toHaveBeenCalled();
    // PATCH 마다 도는 기존 폐기 키 정리(DELETE)는 이 키를 지우지 않는다
    for (const params of db.deletes) expect(params).not.toContain(SWITCH_KEY_LITERAL);
  });

  test('다른 필드만 보내면 이 키는 쓰지 않는다', async () => {
    await PATCH(makeReq({ analystEnabled: true, killSwitch: false, orderMaxPct: 5 }));
    expect(db.writes.map(w => w.key)).not.toContain(SWITCH_KEY_LITERAL);
    expect(db.writes.map(w => w.key).sort()).toEqual(['safety_kill_switch', 'safety_order_max_pct', 'strategy_analyst_enabled']);
  });

  test('다른 필드와 함께 보내면 각자 자기 키에 저장된다', async () => {
    await PATCH(makeReq({ killSwitch: true, postMarketOverseasEnabled: false }));
    expect(db.writes).toEqual(expect.arrayContaining([
      { key: 'safety_kill_switch', value: 'true' },
      { key: SWITCH_KEY_LITERAL, value: 'false' },
    ]));
    expect(db.writes).toHaveLength(2);
  });

  test.each([
    [true, 'ON — 미국 정규장이 열린 날의 다음 날 아침 08:00(KST) 미국 종목 시나리오 생성'],
    [false, 'OFF — 미국 종목 시나리오 생성 중단'],
  ])('로그 문구 고정 — %p → %s (옛 "매일 08:00" 없음)', async (v, expected) => {
    await PATCH(makeReq({ postMarketOverseasEnabled: v }));
    const logs = warnSpy.mock.calls.map(c => c.map(String).join(' ')).filter(l => l.includes('해외 장마감 후 분석'));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain(expected);
    expect(logs[0]).toContain(SWITCH_KEY_LITERAL);
    expect(logs[0]).not.toContain('매일 08:00');
  });

  test('변경은 서버 로그에 남는다', async () => {
    await PATCH(makeReq({ postMarketOverseasEnabled: true }));
    expect(warnSpy.mock.calls.map(c => String(c[0])).join('\n')).toContain(SWITCH_KEY_LITERAL);
  });
});

describe('왕복 — PATCH 가 저장한 값을 엔진이 그대로 읽는다', () => {
  test.each([[true], [false]])('PATCH %p → 엔진 판독기·GET 모두 같은 값', async (v) => {
    await PATCH(makeReq({ postMarketOverseasEnabled: v }));
    const stored = db.writes.find(w => w.key === SWITCH_KEY_LITERAL);
    expect(stored).toBeDefined();
    db.switchRow = { value: stored!.value };   // longtext — 드라이버는 문자열로 준다
    expect((await readPostMarketOverseasSwitch()).enabled).toBe(v);
    expect((await getSafety()).postMarketOverseasEnabled).toBe(v);
  });
});
