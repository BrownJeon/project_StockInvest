/**
 * T-135 — 기록기 공용 연결 수명주기(`bounded-conn.ts`) 단위 시험(목 풀).
 *
 *  A. 연결 하나: 첫 문장에서 받고 같은 기록의 문장은 전부 그 연결 · 문장이 없으면 받지 않는다 · 받는 중에 문장이 겹쳐도 한 번만 받는다
 *  B. 끝내기 한 번: 정상 = release · 문장 오류가 있었으면 = destroy · 상한(abort) = 잡고 있던 연결 destroy · finish·abort 를 몇 번 불러도 한 번 ·
 *     release 가 던지면 destroy · destroy 가 던지면 흡수
 *  C. 상한: 상한 뒤 새 문장은 보내지 않는다(LateError) · 상한 뒤 끝난 문장(성공·실패)은 LateError · 받는 중에 상한 → 도착하면 문장 없이 release
 *  D. 오류는 그대로: 상한 전 문장 오류·연결 받기 실패(동기·비동기)는 원래 오류 그대로 던진다(호출자 분기 그대로)
 *  E. withBoundedConn: 시간 안 = 값 + finish · 넘음 = undefined + abort · 시간 안 거부 = 던짐 + abort · 본문은 동기로 시작
 * 실 풀·실 잠금은 judgment-disposable-mariadb.test.ts(E)·job-run-log-disposable-mariadb.test.ts(G).
 */
import {
  BoundedConnLateError,
  createBoundedConn,
  isBoundedConnLate,
  withBoundedConn,
  type BoundedConnection,
  type BoundedPool,
} from '../bounded-conn';

interface FakeConn extends BoundedConnection {
  query: jest.Mock;
  release: jest.Mock;
  destroy: jest.Mock;
}
function fakeConn(impl?: (sql: string, params?: unknown) => Promise<unknown>): FakeConn {
  return {
    query: jest.fn(impl ?? (async () => [{ affectedRows: 1 }, undefined])),
    release: jest.fn(),
    destroy: jest.fn(),
  };
}
function fakePool(conn: BoundedConnection | (() => Promise<BoundedConnection>)): BoundedPool & { getConnection: jest.Mock } {
  return { getConnection: jest.fn(typeof conn === 'function' ? conn : async () => conn) };
}
const ends = (c: FakeConn) => [c.release.mock.calls.length, c.destroy.mock.calls.length];
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
async function caught(p: Promise<unknown>): Promise<unknown> {
  try { await p; return 'resolved'; } catch (e) { return e; }
}

describe('A. 연결 하나', () => {
  test('첫 문장에서 받고, 세 문장 모두 같은 연결 · finish = release 1', async () => {
    const c = fakeConn();
    const pool = fakePool(c);
    const bc = createBoundedConn();
    const db = bc.use(pool);
    expect(pool.getConnection).not.toHaveBeenCalled();     // use 만으로는 받지 않는다
    await db.query('INSERT 1', [1]);
    await db.query('INSERT 2', [2]);
    await db.query('INSERT 3');
    bc.finish();
    expect(pool.getConnection).toHaveBeenCalledTimes(1);
    expect(c.query.mock.calls).toEqual([['INSERT 1', [1]], ['INSERT 2', [2]], ['INSERT 3', undefined]]);
    expect(ends(c)).toEqual([1, 0]);
  });

  test('문장이 없으면 연결을 받지 않는다 — finish·abort 해도 아무것도 안 함', () => {
    const c = fakeConn();
    const pool = fakePool(c);
    const bc = createBoundedConn();
    bc.use(pool);
    bc.finish();
    bc.abort();
    expect(pool.getConnection).not.toHaveBeenCalled();
    expect(ends(c)).toEqual([0, 0]);
  });

  test('받는 중에 문장이 겹쳐도 한 번만 받는다', async () => {
    const c = fakeConn();
    let give!: (x: BoundedConnection) => void;
    const pool = fakePool(() => new Promise((r) => { give = r; }));
    const bc = createBoundedConn();
    const db = bc.use(pool);
    const a = db.query('A');
    const b = db.query('B');
    give(c);
    await Promise.all([a, b]);
    expect(pool.getConnection).toHaveBeenCalledTimes(1);
    expect(c.query).toHaveBeenCalledTimes(2);
  });

  test('use 를 두 번 불러도 첫 풀 하나(연결 하나)', async () => {
    const c1 = fakeConn();
    const c2 = fakeConn();
    const p1 = fakePool(c1);
    const p2 = fakePool(c2);
    const bc = createBoundedConn();
    await bc.use(p1).query('A');
    await bc.use(p2).query('B');
    expect([p1.getConnection.mock.calls.length, p2.getConnection.mock.calls.length, c1.query.mock.calls.length, c2.query.mock.calls.length]).toEqual([1, 0, 2, 0]);
  });
});

describe('B. 끝내기 한 번', () => {
  test('문장 오류가 한 번이라도 있었으면 finish = destroy(release 0) · 오류 뒤 문장도 같은 연결', async () => {
    const err = Object.assign(new Error('chk'), { errno: 4025 });
    let n = 0;
    const c = fakeConn(async () => { if (n++ === 0) throw err; return [{}, undefined]; });
    const bc = createBoundedConn();
    const db = bc.use(fakePool(c));
    expect(await caught(db.query('X'))).toBe(err);
    await db.query('Y');
    bc.finish();
    expect(c.query).toHaveBeenCalledTimes(2);
    expect(ends(c)).toEqual([0, 1]);
  });

  test('finish·abort 를 여러 번 — 끝내기는 정확히 한 번', async () => {
    const c = fakeConn();
    const bc = createBoundedConn();
    await bc.use(fakePool(c)).query('A');
    bc.finish(); bc.finish(); bc.abort(); bc.abort();
    expect(ends(c)).toEqual([1, 0]);
    const c2 = fakeConn();
    const bc2 = createBoundedConn();
    await bc2.use(fakePool(c2)).query('A');
    bc2.abort(); bc2.abort(); bc2.finish();
    expect(ends(c2)).toEqual([0, 1]);
  });

  test('release 가 던지면 destroy 로 대신, destroy 가 던져도 흡수(finish·abort 는 던지지 않는다)', async () => {
    const c = fakeConn();
    c.release.mockImplementation(() => { throw new Error('release boom'); });
    const bc = createBoundedConn();
    await bc.use(fakePool(c)).query('A');
    expect(() => bc.finish()).not.toThrow();
    expect(ends(c)).toEqual([1, 1]);
    const c2 = fakeConn();
    c2.destroy.mockImplementation(() => { throw new Error('destroy boom'); });
    const bc2 = createBoundedConn();
    await bc2.use(fakePool(c2)).query('A');
    expect(() => bc2.abort()).not.toThrow();
    expect(ends(c2)).toEqual([0, 1]);
  });

  test('finish 뒤에 문장을 보내려 하면 거부(연결은 이미 돌려줬다)', async () => {
    const c = fakeConn();
    const bc = createBoundedConn();
    const db = bc.use(fakePool(c));
    await db.query('A');
    bc.finish();
    const e = await caught(db.query('B'));
    expect(e).toBeInstanceOf(Error);
    expect(isBoundedConnLate(e)).toBe(false);
    expect(c.query).toHaveBeenCalledTimes(1);
  });
});

describe('C. 상한', () => {
  test('🔴 문장이 매달린 채 abort → 그 자리에서 destroy, 늦은 실패·늦은 성공은 LateError 로 바뀐다', async () => {
    let rejectLate!: (e: unknown) => void;
    const c = fakeConn(() => new Promise((_, rej) => { rejectLate = rej; }));
    const bc = createBoundedConn();
    const db = bc.use(fakePool(c));
    const q = caught(db.query('HANG'));
    await flush();
    expect(c.query).toHaveBeenCalledTimes(1);
    bc.abort();
    expect(bc.late).toBe(true);
    expect(ends(c)).toEqual([0, 1]);                     // 늦은 실패가 오기 전에
    rejectLate(Object.assign(new Error('Connection lost'), { errno: 2013 }));
    expect(await q).toBeInstanceOf(BoundedConnLateError);
    bc.finish();
    expect(ends(c)).toEqual([0, 1]);

    let okLate!: (v: unknown) => void;
    const c2 = fakeConn(() => new Promise((r) => { okLate = r; }));
    const bc2 = createBoundedConn();
    const q2 = caught(bc2.use(fakePool(c2)).query('HANG'));
    await flush();
    bc2.abort();
    okLate([{ insertId: 1 }, undefined]);
    expect(await q2).toBeInstanceOf(BoundedConnLateError);   // 상한 뒤 결과는 쓰지 않는다
  });

  test('🔴 abort 뒤 새 문장은 보내지 않는다(연결도 받지 않는다)', async () => {
    const c = fakeConn();
    const pool = fakePool(c);
    const bc = createBoundedConn();
    const db = bc.use(pool);
    bc.abort();
    expect(await caught(db.query('A'))).toBeInstanceOf(BoundedConnLateError);
    expect(pool.getConnection).not.toHaveBeenCalled();
    // 받은 뒤 abort → 다음 문장 없음
    const c2 = fakeConn();
    const bc2 = createBoundedConn();
    const db2 = bc2.use(fakePool(c2));
    await db2.query('A');
    bc2.abort();
    expect(await caught(db2.query('B'))).toBeInstanceOf(BoundedConnLateError);
    expect(c2.query).toHaveBeenCalledTimes(1);
    expect(ends(c2)).toEqual([0, 1]);
  });

  test('🔴 연결을 기다리는 중에 abort → 도착한 연결로는 문장 없이 release(destroy 0)', async () => {
    const c = fakeConn();
    let give!: (x: BoundedConnection) => void;
    const pool = fakePool(() => new Promise((r) => { give = r; }));
    const bc = createBoundedConn();
    const q = caught(bc.use(pool).query('A'));
    await flush();
    bc.abort();
    give(c);
    expect(await q).toBeInstanceOf(BoundedConnLateError);
    expect(c.query).not.toHaveBeenCalled();
    expect(ends(c)).toEqual([1, 0]);
  });

  test('🔴 연결이 도착한 직후·문장을 보내기 전에 abort → 그 연결로는 문장을 보내지 않는다(abort 가 destroy 1)', async () => {
    const c = fakeConn();
    let give!: (x: BoundedConnection) => void;
    const arrived = new Promise<BoundedConnection>((r) => { give = r; });
    const bc = createBoundedConn();
    const q = caught(bc.use(fakePool(() => arrived)).query('A'));   // acquire 가 arrived.then 을 먼저 건다
    void arrived.then(() => { bc.abort(); });                        // 같은 도착에 abort 를 그 뒤로 — 연결은 이미 잡혔고 문장은 아직
    give(c);
    expect(await q).toBeInstanceOf(BoundedConnLateError);
    expect(c.query).not.toHaveBeenCalled();
    expect(ends(c)).toEqual([0, 1]);
  });

  test('늦게 도착한 연결의 release 가 던지면 destroy, 그것도 던지면 흡수', async () => {
    const c = fakeConn();
    c.release.mockImplementation(() => { throw new Error('x'); });
    c.destroy.mockImplementation(() => { throw new Error('y'); });
    let give!: (x: BoundedConnection) => void;
    const bc = createBoundedConn();
    const q = caught(bc.use(fakePool(() => new Promise((r) => { give = r; }))).query('A'));
    await flush();
    bc.abort();
    give(c);
    expect(await q).toBeInstanceOf(BoundedConnLateError);
    expect(ends(c)).toEqual([1, 1]);
  });

  test('연결을 기다리는 중 abort 뒤 연결 받기가 실패해도 LateError(원래 오류를 본문에 넘기지 않는다)', async () => {
    let fail!: (e: unknown) => void;
    const bc = createBoundedConn();
    const q = caught(bc.use(fakePool(() => new Promise((_, rej) => { fail = rej; }))).query('A'));
    await flush();
    bc.abort();
    fail(new Error('Pool is closed'));
    expect(await q).toBeInstanceOf(BoundedConnLateError);
  });
});

describe('D. 오류는 그대로', () => {
  test('상한 전 문장 오류는 원래 오류 그대로(errno 유지)', async () => {
    const err = Object.assign(new Error('nope'), { errno: 1146 });
    const c = fakeConn(async () => { throw err; });
    const bc = createBoundedConn();
    expect(await caught(bc.use(fakePool(c)).query('A'))).toBe(err);
  });

  test('연결 받기 실패(비동기 거부·동기 throw·풀 없음) → 원래 오류 그대로, 연결 끝내기 0', async () => {
    const e1 = Object.assign(new Error('ECONNREFUSED'), { errno: -111 });
    const bc1 = createBoundedConn();
    expect(await caught(bc1.use(fakePool(async () => { throw e1; })).query('A'))).toBe(e1);
    bc1.finish();
    const e2 = new Error('sync boom');
    const bc2 = createBoundedConn();
    expect(await caught(bc2.use({ getConnection: () => { throw e2; } }).query('A'))).toBe(e2);
    const bc3 = createBoundedConn();
    expect(await caught(bc3.use(null as unknown as BoundedPool).query('A'))).toBeInstanceOf(Error);
  });
});

describe('E. withBoundedConn', () => {
  afterEach(() => { jest.useRealTimers(); });

  test('시간 안 = 값 + release 1 · 본문은 동기로 시작', async () => {
    const c = fakeConn();
    let started = false;
    const p = withBoundedConn(1000, async (bc) => { started = true; await bc.use(fakePool(c)).query('A'); return 'v'; });
    expect(started).toBe(true);
    await expect(p).resolves.toBe('v');
    expect(ends(c)).toEqual([1, 0]);
  });

  test('시간 안 거부 = 그대로 던지고 잡고 있던 연결은 destroy', async () => {
    const c = fakeConn();
    const err = new Error('body boom');
    await expect(withBoundedConn(1000, async (bc) => { await bc.use(fakePool(c)).query('A'); throw err; })).rejects.toBe(err);
    expect(ends(c)).toEqual([0, 1]);
  });

  test('🔴 넘음 = undefined + 그 시점에 destroy · 본문이 상한 뒤 보내려는 다음 문장은 나가지 않는다', async () => {
    jest.useFakeTimers();
    let okLate!: (v: unknown) => void;
    let n = 0;
    const c = fakeConn(() => (n++ === 0 ? new Promise((r) => { okLate = r; }) : Promise.resolve([{}, undefined])));
    let bodyErr: unknown = null;
    const p = withBoundedConn(500, async (bc) => {
      const db = bc.use(fakePool(c));
      try { await db.query('A'); await db.query('B'); } catch (e) { bodyErr = e; }
      return 'never-used';
    });
    await flush();
    jest.advanceTimersByTime(500);
    await expect(p).resolves.toBeUndefined();
    expect(ends(c)).toEqual([0, 1]);
    okLate([{}, undefined]);
    await flush();
    expect(c.query).toHaveBeenCalledTimes(1);
    expect(bodyErr).toBeInstanceOf(BoundedConnLateError);
  });

  test('본문이 동기로 던져도(비 async) abort 후 그대로 던진다', async () => {
    const err = new Error('sync');
    await expect(withBoundedConn(1000, () => { throw err; })).rejects.toBe(err);
  });
});
