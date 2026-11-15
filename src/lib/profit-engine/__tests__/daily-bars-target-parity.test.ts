/**
 * T-173 대등성 시험 — 일봉 감시(ops `bars-lag.ts`)의 「수집 대상」이 수집기 `loadDefaultTargets`(전 시장 기본 실행)와 같은가.
 *
 * ops 계층은 이 모듈을 import 할 수 없어(격리 시험) 대상 규칙을 따로 들고 있다. 한쪽만 바뀌면 감시가 다른 종목을 세게 되므로
 * 같은 가짜 DB 하나로 두 구현을 돌려 ① 시장별 종목 집합 ② 대상 오류 이름 ③ 보낸 SQL 문장(보유·시그널)이 같은지 고정한다.
 * (이 파일은 수집 모듈 쪽 시험이라 ops 를 import 해도 격리 시험의 대상이 아니다 — 격리 시험은 이 모듈의 비시험 파일만 본다.)
 */
jest.mock('@/lib/strategy/universe-overseas-static', () => ({ readOverseasUniverse: jest.fn() }));

import { readOverseasUniverse } from '@/lib/strategy/universe-overseas-static';
import { readBarsTargets, targetMarketOf } from '@/lib/ops/metrics/bars-lag';
import type { OpsReader } from '@/lib/ops/metrics/read-only';
import { loadDefaultTargets, marketOfSymbol, TARGET_MAX_DATES_SQL, type Queryable } from '../daily-bars-store';
import { FakeBarsDb } from './fake-bars-db';

const universe = readOverseasUniverse as jest.Mock;
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** 같은 가짜 DB 를 ops 읽기 래퍼 모양으로(ops 쪽 대상 판독은 이 셋 — 보유·해외 분석 목록·시그널 — 만 읽는다). */
function opsReaderOver(db: FakeBarsDb): OpsReader {
  const memo = new Map<string, Promise<unknown>>();
  return {
    nowMs: 0,
    async rows<T>(sql: string, params: unknown[] = []): Promise<T[]> { return (await db.query(sql, params))[0] as T[]; },
    memo<T>(key: string, fn: () => Promise<T>): Promise<T> {
      if (!memo.has(key)) memo.set(key, fn());
      return memo.get(key) as Promise<T>;
    },
  };
}

/** 두 구현 실행 → 시장별 정렬 집합·오류·보유/시그널 SQL. 수집기 쪽의 「낡은 순」 정렬 조회와 그 오류는 대상 규칙이 아니라 비교에서 뺀다. */
async function both(db: FakeBarsDb) {
  const engine = await loadDefaultTargets(db as unknown as Queryable);
  const engineSql = db.queries.map((q) => q.sql).filter((s) => s !== norm(TARGET_MAX_DATES_SQL));
  db.queries.length = 0;
  const ops = await readBarsTargets(opsReaderOver(db));
  const opsSql = db.queries.map((q) => q.sql);
  const bySet = (m: 'KR' | 'US') => engine.targets.filter((t) => t.market === m).map((t) => t.symbol).sort();
  return {
    engine: { KR: bySet('KR'), US: bySet('US'), errors: engine.errors.filter((e) => e !== 'staleness_order') },
    ops: { KR: [...ops.symbols.domestic].sort(), US: [...ops.symbols.overseas].sort(), errors: ops.errors },
    engineSql, opsSql,
  };
}

beforeEach(() => universe.mockReset());

describe('T-173 — ops 일봉 감시 대상 = 수집기 기본 대상', () => {
  test('섞인 입력(중복·모르는 모양·두 시장·시그널 300 상한 초과) — 집합·오류·SQL 이 같다', async () => {
    const db = new FakeBarsDb();
    db.positions = ['005930', 'NAS:MU', 'BAD'];
    universe.mockResolvedValue({ symbols: ['NAS:MU', 'NAS:AAA', 'NYS:BRK.B', 'nas:low', '000660'], degraded: false });
    const kr = Array.from({ length: 200 }, (_, i) => String(200001 + i));
    const us = Array.from({ length: 140 }, (_, i) => `NAS:Z${String(i).padStart(3, '0')}`);
    db.signalCounts = [
      { symbol: '005930', n: 1000 }, { symbol: 'NAS:AAA', n: 999 }, { symbol: 'XX', n: 998 },
      ...kr.map((symbol, i) => ({ symbol, n: 900 - i })), ...us.map((symbol, i) => ({ symbol, n: 600 - i })),
    ];
    const r = await both(db);
    expect(r.ops).toEqual(r.engine);
    expect(r.engine.KR.length + r.engine.US.length).toBe(3 + 2 + 300);   // 보유 2(+BAD 제외) · 분석 3(+중복·모양 제외) · 시그널 새로 300
    expect(r.ops.KR).toContain('000660');   // 분석 목록에 국내 모양이 섞여도 두 구현이 같은 시장으로 넣는다
    expect(r.opsSql).toEqual(r.engineSql);
    expect(r.opsSql).toHaveLength(2);
  });

  test('보유 조회 실패 · 해외 분석 목록 저하 · 시그널 조회 실패 — 오류 이름과 순서가 같다', async () => {
    const db = new FakeBarsDb();
    db.failPositions = true;
    universe.mockResolvedValue({ symbols: ['NAS:AAA'], degraded: true });
    const query = db.query;
    db.query = async (sql: unknown, params?: unknown[]) => {
      if (/FROM signals/.test(String(sql))) throw new Error('signals unavailable');
      return query(sql, params);
    };
    const r = await both(db);
    expect(r.engine.errors).toEqual(['position_state', 'universe_list', 'signals']);
    expect(r.ops).toEqual(r.engine);
  });

  test('두 구현 모두 해외 분석 목록을 같은 판독기로 읽는다(호출 1번씩)', async () => {
    const db = new FakeBarsDb();
    universe.mockResolvedValue({ symbols: ['NAS:AAA'], degraded: false });
    await both(db);
    expect(universe).toHaveBeenCalledTimes(2);
  });

  test.each(['005930', '0059300', 'NAS:AAPL', 'NYS:BRK.B', 'nas:aapl', 'AAPL', 'KRX:005930', 'NAS:', ''])('심볼 시장 판별이 같다 %p', (s) => {
    const engine = marketOfSymbol(s);
    expect(targetMarketOf(s)).toBe(engine === 'KR' ? 'domestic' : engine === 'US' ? 'overseas' : null);
  });
});
