/**
 * T-108 읽기 래퍼 — SELECT 전용·상한·예산·동시 실행·오류 분류·섹션 격리 (가이드 §4.0).
 */
jest.mock('@/lib/db', () => ({ getPool: jest.fn(() => { throw new Error('getPool 을 부르면 안 된다(시험은 pool 주입)'); }) }));

import {
  assertSelectOnly, classifyDbError, count, createGate, createReader, num, OPS_GLOBAL_CONCURRENCY, OPS_GLOBAL_GATE, OPS_SAFETY_GATE,
  OPS_SAFETY_LANE_CONCURRENCY, OpsQueryError, parseJsonObject, section, withStatementTimeout,
} from '../read-only';
import { dbError } from './fake-reader';

function pool(fn: (sql: string, params?: unknown[]) => Promise<[unknown, unknown]>) {
  return { query: jest.fn(fn) };
}

describe('assertSelectOnly', () => {
  it.each(['SELECT 1', '  select a FROM b', 'WITH x AS (SELECT 1) SELECT * FROM x'])('통과: %s', (sql) => {
    expect(() => assertSelectOnly(sql)).not.toThrow();
  });
  it.each([
    'INSERT INTO t VALUES (1)', 'UPDATE t SET a=1', 'DELETE FROM t', 'REPLACE INTO t VALUES (1)', 'SET @a=1',
    'SELECT 1; DELETE FROM t', 'CALL p()', '',
    'SELECT * FROM t FOR UPDATE', 'select * from t for update', 'SELECT * FROM t FOR SHARE', 'SELECT * FROM t LOCK IN SHARE MODE',
    "SELECT GET_LOCK('x', 1)", 'SELECT 1 INTO OUTFILE "/tmp/x"', 'SELECT 1 INTO @v',
  ])('거부: %s', (sql) => {
    expect(() => assertSelectOnly(sql)).toThrow(OpsQueryError);
  });
});

describe('createReader', () => {
  it('서버 상한 접두를 붙여 보내고 행 배열을 돌려준다', async () => {
    const p = pool(async () => [[{ a: 1 }], []]);
    const r = createReader({ pool: p, nowMs: 0 });
    await expect(r.rows('SELECT a FROM t WHERE x = ?', [1])).resolves.toEqual([{ a: 1 }]);
    const sent = p.query.mock.calls[0][0] as string;
    expect(sent).toMatch(/^SET STATEMENT max_statement_time=2\.50 FOR SELECT a FROM t WHERE x = \?$/);
    expect(p.query.mock.calls[0][1]).toEqual([1]);
  });

  it('쓰기 문장은 보내기 전에 거부(풀 호출 0)', async () => {
    const p = pool(async () => [[], []]);
    const r = createReader({ pool: p });
    await expect(r.rows('UPDATE t SET a = 1')).rejects.toMatchObject({ code: 'not_select' });
    expect(p.query).not.toHaveBeenCalled();
  });

  it('1146 → not_migrated, 1969 → timeout, 그 밖 → db_error', async () => {
    for (const [errno, code] of [[1146, 'not_migrated'], [1969, 'timeout'], [2013, 'db_error']] as const) {
      const r = createReader({ pool: pool(async () => { throw dbError(errno); }) });
      await expect(r.rows('SELECT 1')).rejects.toMatchObject({ code });
    }
  });

  it('응답이 상한을 넘기면 timeout(늦은 응답은 버린다)', async () => {
    const r = createReader({ pool: pool(() => new Promise(() => { /* 영원히 */ })), deadlineMs: 120 });
    const t0 = Date.now();
    await expect(r.rows('SELECT 1')).rejects.toMatchObject({ code: 'timeout' });
    expect(Date.now() - t0).toBeLessThan(1500);
  });

  it('요청 예산이 남지 않으면 보내지 않고 timeout', async () => {
    let t = 0;
    const p = pool(async () => [[], []]);
    const r = createReader({ pool: p, budgetMs: 1000, clock: () => t });
    t = 990;
    await expect(r.rows('SELECT 1')).rejects.toMatchObject({ code: 'timeout' });
    expect(p.query).not.toHaveBeenCalled();
  });

  it('동시 실행 상한을 지킨다', async () => {
    let active = 0; let peak = 0;
    const p = pool(async () => {
      active++; peak = Math.max(peak, active);
      await new Promise((res) => setTimeout(res, 5));
      active--;
      return [[], []];
    });
    const r = createReader({ pool: p, concurrency: 2 });
    await Promise.all(Array.from({ length: 7 }, () => r.rows('SELECT 1')));
    expect(peak).toBe(2);
    expect(p.query).toHaveBeenCalledTimes(7);
  });

  it('프로세스 전체 관문 — 요청(reader)이 여럿이어도 합계 동시 실행이 상한을 넘지 않는다', async () => {
    let active = 0; let peak = 0;
    const p = pool(async () => {
      active++; peak = Math.max(peak, active);
      await new Promise((res) => setTimeout(res, 5));
      active--;
      return [[], []];
    });
    const gate = createGate(3);
    const readers = [1, 2, 3].map(() => createReader({ pool: p, concurrency: 4, gate }));
    await Promise.all(readers.flatMap((r) => Array.from({ length: 5 }, () => r.rows('SELECT 1'))));
    expect(peak).toBe(3);
    expect(gate.active).toBe(0);
  });

  it('🔴 관문 대기에도 기한 — 포화 중 예산이 지나면 대기열에서 빠지고 timeout, 대기 Promise 가 쌓이지 않는다(Codex C2 ②)', async () => {
    const gate = createGate(1);
    const slow = pool(() => new Promise((res) => setTimeout(() => res([[], []]), 400)));
    const holder = createReader({ pool: slow, gate, budgetMs: 3000 });
    const held = holder.rows('SELECT 1');
    const t0 = Date.now();
    const waiters = Array.from({ length: 50 }, () => createReader({ pool: slow, gate, budgetMs: 150 }).rows('SELECT 1'));
    await new Promise((res) => setImmediate(res));   // 요청 몫(즉시) → 전역 대기열 진입까지 한 틱
    expect(gate.waiting).toBe(50);
    const results = await Promise.allSettled(waiters);
    expect(results.every((x) => x.status === 'rejected' && (x.reason as OpsQueryError).code === 'timeout')).toBe(true);
    expect(Date.now() - t0).toBeLessThan(400);   // 포화 해제를 기다리지 않고 기한에 끝났다
    expect(gate.waiting).toBe(0);
    expect(gate.active).toBe(1);
    await held;
    expect(gate.active).toBe(0);
    expect(slow.query).toHaveBeenCalledTimes(1);   // 기한을 넘긴 대기자는 보내지 않았다
  });

  it('해제 함수는 한 번만 · 슬롯이 풀리면 대기열 맨 앞에게', async () => {
    const gate = createGate(1);
    const relA = await gate.acquire(1000);
    const order: string[] = [];
    const b = gate.acquire(1000).then((r) => { order.push('b'); return r; });
    const c = gate.acquire(1000).then((r) => { order.push('c'); return r; });
    relA(); relA();
    const relB = await b;
    expect(gate.active).toBe(1);
    expect(gate.waiting).toBe(1);
    relB();
    (await c)();
    expect(order).toEqual(['b', 'c']);
    expect(gate.active).toBe(0);
  });

  it('🔴 한 요청은 전역 대기열에 최대 4개만 넣는다 — 질의 45개를 한꺼번에 쏟지 않는다', async () => {
    const gate = createGate(4);
    const slow = pool(() => new Promise((res) => setTimeout(() => res([[], []]), 30)));
    const home = createReader({ pool: slow, gate, budgetMs: 10_000 });
    const all = Array.from({ length: 45 }, () => home.rows('SELECT 1'));
    await new Promise((res) => setImmediate(res));
    expect(gate.active).toBe(4);
    expect(gate.waiting).toBe(0);   // 요청 몫 4개가 전역 4슬롯을 다 쓰고, 나머지 41개는 요청 몫에서 대기
    await Promise.all(all);
    expect(slow.query).toHaveBeenCalledTimes(45);
  });

  it('🔴 홈 2개(질의 45개씩)가 돌고 있어도 다른 요청은 굶지 않는다 — 요청 몫이 전역 FIFO 를 나눠 쓴다', async () => {
    const L = 60;
    const gate = createGate(4);
    const slow = () => pool(() => new Promise((res) => setTimeout(() => res([[], []]), L)));
    const p1 = slow(); const p2 = slow(); const p3 = slow();
    const homes = [createReader({ pool: p1, gate, budgetMs: 20_000 }), createReader({ pool: p2, gate, budgetMs: 20_000 })];
    const homeQ = homes.flatMap((h) => Array.from({ length: 45 }, () => h.rows('SELECT 1')));
    await new Promise((res) => setTimeout(res, 5));
    const other = createReader({ pool: p3, gate, budgetMs: 3800 });
    const t0 = Date.now();
    await Promise.all([other.rows('SELECT 1'), other.rows('SELECT 2')]);
    // 앞선 요청이 전역 대기열에 넣을 수 있는 수는 요청당 4 → 늦게 온 요청은 대략 (8/4 + 1) 회차 안에 서빙된다
    expect(Date.now() - t0).toBeLessThan(L * 6);
    await Promise.all(homeQ);
  });

  it('기본 전역 관문 상한 = 4, 안전 판독 예약 레인 = 2 (합계 < 풀 10)', () => {
    expect(OPS_GLOBAL_CONCURRENCY).toBe(4);
    expect(OPS_SAFETY_LANE_CONCURRENCY).toBe(2);
    expect(OPS_GLOBAL_GATE).not.toBe(OPS_SAFETY_GATE);
    expect(OPS_GLOBAL_GATE.active).toBe(0);
  });

  it('허용 SQL 목록이 있는 reader(안전 레인)는 그 밖의 문장을 보내기 전에 거부한다', async () => {
    const p = pool(async () => [[], []]);
    const r = createReader({ pool: p, allowedSql: ['SELECT 1'] });
    await expect(r.rows('SELECT 1')).resolves.toEqual([]);
    await expect(r.rows('SELECT 2')).rejects.toMatchObject({ code: 'not_select' });
    expect(p.query).toHaveBeenCalledTimes(1);
  });

  it('memo 는 같은 키의 첫 Promise 를 재사용한다', async () => {
    const r = createReader({ pool: pool(async () => [[], []]) });
    const fn = jest.fn(async () => 1);
    await Promise.all([r.memo('k', fn), r.memo('k', fn)]);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('보조 함수', () => {
  it('withStatementTimeout — 최소 0.1초', () => {
    expect(withStatementTimeout(' SELECT 1 ', 20)).toBe('SET STATEMENT max_statement_time=0.10 FOR SELECT 1');
  });
  it('classifyDbError 는 OpsQueryError 를 그대로 돌려준다', () => {
    const e = new OpsQueryError('timeout', 'x');
    expect(classifyDbError(e)).toBe(e);
  });
  it('num — 숫자·숫자 문자열만, 그 밖 null(0 으로 바꾸지 않는다)', () => {
    expect(num(3)).toBe(3);
    expect(num('4.5')).toBe(4.5);
    expect(num('')).toBeNull();
    expect(num(null)).toBeNull();
    expect(num('abc')).toBeNull();
    expect(num(NaN)).toBeNull();
  });
  it('count — 집계 NULL 은 0', () => {
    expect(count(null)).toBe(0);
    expect(count('7')).toBe(7);
  });
  it('parseJsonObject', () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonObject('[1]')).toBeNull();
    expect(parseJsonObject('x')).toBeNull();
  });
});

describe('section — 실패 격리', () => {
  it('성공은 ok, 실패는 error(분류어) — 던지지 않는다', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(section('a', async () => 1)).resolves.toEqual({ state: 'ok', data: 1 });
    await expect(section('b', async () => { throw new OpsQueryError('timeout', 'x'); })).resolves.toEqual({ state: 'error', error: 'timeout' });
    await expect(section('c', async () => { throw new Error('boom'); })).resolves.toEqual({ state: 'error', error: 'internal_error' });
    warn.mockRestore();
  });
});
