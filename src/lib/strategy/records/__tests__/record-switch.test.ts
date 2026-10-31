/**
 * T-112 record-switch — 기록 스위치(fail-closed) 시험. DB 는 목(`@/lib/db`).
 *  1. 정확히 JSON true 만 켜짐 — 키 없음·false·"1"·1·"yes"·해석 불가 = 꺼짐
 *  2. DB 오류·테이블 없음·getPool 예외·2초 초과 = 꺼짐, 던지지 않음
 *  3. 허용 목록 밖 키는 DB 를 건드리지 않음
 *  4. 30초 캐시(키별) — 30초 안 재호출은 DB 1회, 지나면 다시 읽음
 *  5. readRecordSwitchState — 꺼짐(missing·value)과 읽지 못함(read_error·timeout)을 source 로 가른다
 *  6. (T-139) 변경 전/후 동치 표 — 같은 DB 응답에 같은 (enabled, source)·같은 경고 줄. 이 표는 SELECT 가 어느 창구(풀 query / 풀에서 받은 연결)로
 *     가든 같은 `queryMock` 에 닿게 짠 목으로 돌므로 변경 전 코드에서도 그대로 통과한다(동치의 근거).
 *  7. (T-139) 연결 상한 — SELECT 는 풀에서 받은 연결 하나로만(풀 query 0), 정상 release · 오류 destroy · 상한 **시점에** destroy(busy 0) ·
 *     상한 뒤에 받은 연결은 SELECT 없이 release · 연결 받기 실패 = read_error
 *  8. (T-139) 같은 키 조회 합치기 — 동시 N건 = 조회 1·같은 결과, 키가 다르면 따로, 진행 중 표지는 값·오류·초과 뒤 반드시 지운다,
 *     시험용 초기화는 진행 중 표지도 지우고 그 전에 시작한 조회가 새 캐시를 덮지 않는다
 *  (실 mysql2 풀·`LOCK TABLES` 재현은 record-switch-disposable-mariadb.test.ts)
 */
/** 스위치 SELECT 가 닿는 곳 — 연결 경로(T-139)든 풀 query 경로(그 전)든 이 목 하나에 모인다(기존 단언 그대로). */
const queryMock = jest.fn();
/** 풀에서 받은 연결 — 받을 때마다 새 연결(운영 mysql2 와 같게). 문장은 queryMock 으로 보내고, 연결마다 끝(release·destroy)을 센다. */
interface FakeConn { query: jest.Mock; release: jest.Mock; destroy: jest.Mock }
const conns: FakeConn[] = [];
function newConn(): FakeConn {
  const c: FakeConn = { query: jest.fn((...a: unknown[]) => queryMock(...a)), release: jest.fn(), destroy: jest.fn() };
  conns.push(c);
  return c;
}
const getConnectionMock = jest.fn(async () => newConn());
/** (T-139) 풀 query 는 일부러 **동작하게** 둔다 — 스위치가 이 창구로 되돌아가면 오류(read_error)가 아니라 아래 「풀 query 0」 단언이 잡게. */
const poolQueryMock = jest.fn((...a: unknown[]) => queryMock(...a));
const getPoolMock = jest.fn(() => ({ query: poolQueryMock, getConnection: getConnectionMock }));
jest.mock('@/lib/db', () => ({ getPool: () => getPoolMock() }));

import {
  RECORD_SWITCH_CACHE_MS,
  RECORD_SWITCH_KEYS,
  RECORD_SWITCH_TIMEOUT_MS,
  readRecordSwitch,
  readRecordSwitchState,
  recordSwitchValueEnabled,
  resetRecordSwitchCacheForTest,
  type RecordSwitchKey,
} from '../record-switch';

function rows(value?: unknown) {
  return Promise.resolve([value === undefined ? [] : [{ value }], []]);
}

beforeEach(() => {
  resetRecordSwitchCacheForTest();
  queryMock.mockReset();
  conns.length = 0;
  getConnectionMock.mockReset();
  getConnectionMock.mockImplementation(async () => newConn());
  poolQueryMock.mockClear();
  getPoolMock.mockClear();
  getPoolMock.mockImplementation(() => ({ query: poolQueryMock, getConnection: getConnectionMock }));
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('recordSwitchValueEnabled', () => {
  it('정확히 JSON true 만', () => {
    expect(recordSwitchValueEnabled(true)).toBe(true);
    expect(recordSwitchValueEnabled('true')).toBe(true);
    expect(recordSwitchValueEnabled(' true ')).toBe(true); // JSON.parse 는 바깥 공백 허용 — 원본 규칙과 같다
    for (const v of [false, 'false', '"true"', 'TRUE', '1', 1, 'yes', '', null, undefined, '{', {}, [true]]) {
      expect(recordSwitchValueEnabled(v)).toBe(false);
    }
  });
});

describe('readRecordSwitch', () => {
  it('🔴 키 없음 = 꺼짐(fail-closed)', async () => {
    queryMock.mockReturnValueOnce(rows());
    await expect(readRecordSwitch('job_run_log_enabled')).resolves.toBe(false);
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[0][0]).toBe('SELECT value FROM system_config WHERE `key` = ? LIMIT 1');
    expect(queryMock.mock.calls[0][1]).toEqual(['job_run_log_enabled']);
  });
  it('값 true(문자열) = 켜짐, 드라이버가 파싱한 true 도 켜짐', async () => {
    queryMock.mockReturnValueOnce(rows('true'));
    await expect(readRecordSwitch('job_run_log_enabled')).resolves.toBe(true);
    queryMock.mockReturnValueOnce(rows(true));
    await expect(readRecordSwitch('judgment_record_enabled')).resolves.toBe(true);
  });
  it.each([['false'], ['1'], [1], ['yes'], ['{bad']])('값 %p = 꺼짐', async (v) => {
    queryMock.mockReturnValueOnce(rows(v));
    await expect(readRecordSwitch('judgment_record_enabled')).resolves.toBe(false);
  });
  it('DB 오류·테이블 없음 = 꺼짐, 던지지 않음', async () => {
    queryMock.mockReturnValueOnce(Promise.reject(Object.assign(new Error('gone'), { errno: 2013 })));
    await expect(readRecordSwitch('job_run_log_enabled')).resolves.toBe(false);
    resetRecordSwitchCacheForTest();
    queryMock.mockReturnValueOnce(Promise.reject(Object.assign(new Error('no table'), { errno: 1146 })));
    await expect(readRecordSwitch('job_run_log_enabled')).resolves.toBe(false);
  });
  it('getPool 자체가 던져도 꺼짐', async () => {
    getPoolMock.mockImplementationOnce(() => { throw new Error('pool init'); });
    await expect(readRecordSwitch('job_run_log_enabled')).resolves.toBe(false);
  });
  it(`🔴 ${RECORD_SWITCH_TIMEOUT_MS}ms 초과 = 꺼짐(늦게 true 가 와도 꺼짐)`, async () => {
    jest.useFakeTimers();
    let resolveLate!: (v: unknown) => void;
    queryMock.mockReturnValueOnce(new Promise((r) => { resolveLate = r; }));
    const p = readRecordSwitch('job_run_log_enabled');
    await Promise.resolve();
    jest.advanceTimersByTime(RECORD_SWITCH_TIMEOUT_MS);
    await expect(p).resolves.toBe(false);
    resolveLate([[{ value: 'true' }], []]);
  });
  it('허용 목록 밖 키는 DB 를 건드리지 않고 꺼짐', async () => {
    await expect(readRecordSwitch('safety_kill_switch' as unknown as RecordSwitchKey)).resolves.toBe(false);
    await expect(readRecordSwitch('' as unknown as RecordSwitchKey)).resolves.toBe(false);
    expect(queryMock).not.toHaveBeenCalled();
  });
  it(`캐시: ${RECORD_SWITCH_CACHE_MS}ms 안 재호출은 DB 1회(키별), 지나면 다시 읽음`, async () => {
    const t0 = 1_800_000_000_000;
    const now = jest.spyOn(Date, 'now').mockReturnValue(t0);
    queryMock.mockReturnValueOnce(rows('true')).mockReturnValueOnce(rows()).mockReturnValueOnce(rows('false'));
    await expect(readRecordSwitch('job_run_log_enabled')).resolves.toBe(true);
    now.mockReturnValue(t0 + RECORD_SWITCH_CACHE_MS - 1);
    await expect(readRecordSwitch('job_run_log_enabled')).resolves.toBe(true);
    expect(queryMock).toHaveBeenCalledTimes(1);
    await expect(readRecordSwitch('judgment_record_enabled')).resolves.toBe(false); // 다른 키는 따로 읽는다
    expect(queryMock).toHaveBeenCalledTimes(2);
    now.mockReturnValue(t0 + RECORD_SWITCH_CACHE_MS + 1);
    await expect(readRecordSwitch('job_run_log_enabled')).resolves.toBe(false);
    expect(queryMock).toHaveBeenCalledTimes(3);
  });
});

describe('readRecordSwitchState — 꺼짐과 읽지 못함을 가른다', () => {
  it('키 없음 → missing, 값 → value', async () => {
    queryMock.mockReturnValueOnce(rows()).mockReturnValueOnce(rows('false')).mockReturnValueOnce(rows('true'));
    await expect(readRecordSwitchState('job_run_log_enabled')).resolves.toEqual({ enabled: false, source: 'missing' });
    resetRecordSwitchCacheForTest();
    await expect(readRecordSwitchState('job_run_log_enabled')).resolves.toEqual({ enabled: false, source: 'value' });
    resetRecordSwitchCacheForTest();
    await expect(readRecordSwitchState('job_run_log_enabled')).resolves.toEqual({ enabled: true, source: 'value' });
  });
  it('DB 오류·getPool 예외 → read_error, 시간 초과 → timeout, 허용 밖 키 → unknown_key', async () => {
    queryMock.mockReturnValueOnce(Promise.reject(new Error('x')));
    await expect(readRecordSwitchState('job_run_log_enabled')).resolves.toEqual({ enabled: false, source: 'read_error' });
    resetRecordSwitchCacheForTest();
    getPoolMock.mockImplementationOnce(() => { throw new Error('pool'); });
    await expect(readRecordSwitchState('job_run_log_enabled')).resolves.toEqual({ enabled: false, source: 'read_error' });
    resetRecordSwitchCacheForTest();
    jest.useFakeTimers();
    queryMock.mockReturnValueOnce(new Promise(() => {}));
    const p = readRecordSwitchState('judgment_record_enabled');
    await Promise.resolve();
    jest.advanceTimersByTime(RECORD_SWITCH_TIMEOUT_MS);
    await expect(p).resolves.toEqual({ enabled: false, source: 'timeout' });
    await expect(readRecordSwitchState('x' as unknown as RecordSwitchKey)).resolves.toEqual({ enabled: false, source: 'unknown_key' });
  });
});

// T-126 — 청산 판단 기록 스위치 키 추가. 같은 판정(정확히 JSON true 만)·같은 30초 캐시(키별)를 쓰고, 기존 두 키의 동작은 바뀌지 않는다.
describe('T-126 exit_judgment_record_enabled', () => {
  it('허용 목록 = 기존 두 키 + 새 키(순서 유지)', () => {
    expect(RECORD_SWITCH_KEYS).toEqual(['job_run_log_enabled', 'judgment_record_enabled', 'exit_judgment_record_enabled']);
  });
  it('🔴 키 없음 = 꺼짐, 정확히 true 만 켜짐, 같은 SQL·인자', async () => {
    queryMock.mockReturnValueOnce(rows());
    await expect(readRecordSwitchState('exit_judgment_record_enabled')).resolves.toEqual({ enabled: false, source: 'missing' });
    expect(queryMock.mock.calls[0]).toEqual(['SELECT value FROM system_config WHERE `key` = ? LIMIT 1', ['exit_judgment_record_enabled']]);
    for (const [v, on] of [['true', true], [true, true], ['false', false], ['1', false], [1, false], ['"true"', false]] as const) {
      resetRecordSwitchCacheForTest();
      queryMock.mockReturnValueOnce(rows(v));
      await expect(readRecordSwitch('exit_judgment_record_enabled')).resolves.toBe(on);
    }
  });
  it('DB 오류 = 꺼짐(read_error), 캐시는 키별 — 새 키를 읽어도 기존 키 캐시가 바뀌지 않는다', async () => {
    queryMock.mockReturnValueOnce(Promise.reject(Object.assign(new Error('no table'), { errno: 1146 })));
    await expect(readRecordSwitchState('exit_judgment_record_enabled')).resolves.toEqual({ enabled: false, source: 'read_error' });
    const t0 = 1_800_000_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(t0);
    resetRecordSwitchCacheForTest();
    queryMock.mockReturnValueOnce(rows('true')).mockReturnValueOnce(rows('false'));
    await expect(readRecordSwitch('judgment_record_enabled')).resolves.toBe(true);
    await expect(readRecordSwitch('exit_judgment_record_enabled')).resolves.toBe(false);
    await expect(readRecordSwitch('judgment_record_enabled')).resolves.toBe(true);   // 캐시(DB 2회뿐)
    expect(queryMock).toHaveBeenCalledTimes(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T-139 — 변경 전/후 동치 표. 같은 입력(DB 응답)에 같은 (enabled, source)·같은 경고 줄 수·문구.
// 목은 SELECT 가 풀 query 로 가든(변경 전) 받은 연결로 가든(변경 후) 같은 queryMock 에 닿는다 — 이 표는 변경 전 코드에서도 그대로 통과한다.
// ─────────────────────────────────────────────────────────────────────────────
describe('T-139 변경 전/후 동치 — 같은 DB 응답이면 같은 결과·같은 경고', () => {
  const SQL = 'SELECT value FROM system_config WHERE `key` = ? LIMIT 1';
  const switchWarns = () => (console.warn as jest.Mock).mock.calls.map((c) => String(c[0])).filter((m) => m.startsWith('[strategy/records/switch]'));
  type Arrange = () => void;
  const reply = (v: unknown): Arrange => () => { queryMock.mockReturnValueOnce(Promise.resolve(v)); };
  const fail = (e: Error): Arrange => () => { queryMock.mockReturnValueOnce(Promise.reject(e)); };
  // [이름, DB 응답, 기대 결과, 경고 줄(없으면 null), 보낸 SELECT 수]
  const cases: Array<[string, Arrange, { enabled: boolean; source: string }, RegExp | null, number]> = [
    ['키 없음(빈 행)', reply([[], []]), { enabled: false, source: 'missing' }, null, 1],
    ['첫 행이 null', reply([[null], []]), { enabled: false, source: 'missing' }, null, 1],
    ['행 묶음이 배열이 아님', reply([undefined, []]), { enabled: false, source: 'missing' }, null, 1],
    ["값 'true'", reply([[{ value: 'true' }], []]), { enabled: true, source: 'value' }, null, 1],
    ['값 true(드라이버 파싱)', reply([[{ value: true }], []]), { enabled: true, source: 'value' }, null, 1],
    ["값 ' true '(바깥 공백)", reply([[{ value: ' true ' }], []]), { enabled: true, source: 'value' }, null, 1],
    ["값 'false'", reply([[{ value: 'false' }], []]), { enabled: false, source: 'value' }, null, 1],
    ['값 false', reply([[{ value: false }], []]), { enabled: false, source: 'value' }, null, 1],
    ['값 \'"true"\'(문자열 "true")', reply([[{ value: '"true"' }], []]), { enabled: false, source: 'value' }, null, 1],
    ["값 'TRUE'", reply([[{ value: 'TRUE' }], []]), { enabled: false, source: 'value' }, null, 1],
    ["값 '1'", reply([[{ value: '1' }], []]), { enabled: false, source: 'value' }, null, 1],
    ['값 1', reply([[{ value: 1 }], []]), { enabled: false, source: 'value' }, null, 1],
    ["값 'yes'", reply([[{ value: 'yes' }], []]), { enabled: false, source: 'value' }, null, 1],
    ['잘못된 JSON', reply([[{ value: '{bad' }], []]), { enabled: false, source: 'value' }, null, 1],
    ['값 NULL', reply([[{ value: null }], []]), { enabled: false, source: 'value' }, null, 1],
    ['value 열 없음', reply([[{ other: 'true' }], []]), { enabled: false, source: 'value' }, null, 1],
    ['드라이버가 아무것도 안 줌(해석 예외)', reply(undefined), { enabled: false, source: 'read_error' }, /^\[strategy\/records\/switch\] 스위치\(job_run_log_enabled\) 읽기 실패 — 꺼짐으로 본다: /, 1],
    ['DB 오류(2013)', fail(Object.assign(new Error('Connection lost'), { errno: 2013 })), { enabled: false, source: 'read_error' },
      /^\[strategy\/records\/switch\] 스위치\(job_run_log_enabled\) 읽기 실패 — 꺼짐으로 본다: Connection lost$/, 1],
    ['테이블 없음(1146)', fail(Object.assign(new Error('no table'), { errno: 1146 })), { enabled: false, source: 'read_error' },
      /^\[strategy\/records\/switch\] 스위치\(job_run_log_enabled\) 읽기 실패 — 꺼짐으로 본다: no table$/, 1],
    ['getPool 예외', () => { getPoolMock.mockImplementationOnce(() => { throw new Error('pool init'); }); }, { enabled: false, source: 'read_error' },
      /^\[strategy\/records\/switch\] 스위치\(job_run_log_enabled\) 읽기 실패 — 꺼짐으로 본다: pool init$/, 0],
  ];
  it.each(cases)('%s', async (_name, arrange, expected, warnRe, selects) => {
    arrange();
    await expect(readRecordSwitchState('job_run_log_enabled')).resolves.toEqual(expected);
    expect(queryMock.mock.calls).toEqual(Array.from({ length: selects }, () => [SQL, ['job_run_log_enabled']]));
    expect(switchWarns()).toHaveLength(warnRe ? 1 : 0);
    if (warnRe) expect(switchWarns()[0]).toMatch(warnRe);
  });
  it(`${RECORD_SWITCH_TIMEOUT_MS}ms 초과 → timeout, 경고 1줄(같은 문구) · 1ms 전에는 아직 기다린다`, async () => {
    jest.useFakeTimers();
    queryMock.mockReturnValueOnce(new Promise(() => {}));
    let settled = false;
    const p = readRecordSwitchState('judgment_record_enabled').then((v) => { settled = true; return v; });
    await Promise.resolve();
    jest.advanceTimersByTime(RECORD_SWITCH_TIMEOUT_MS - 1);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(settled).toBe(false);
    jest.advanceTimersByTime(1);
    await expect(p).resolves.toEqual({ enabled: false, source: 'timeout' });
    expect(switchWarns()).toEqual([`[strategy/records/switch] 스위치(judgment_record_enabled) 읽기 ${RECORD_SWITCH_TIMEOUT_MS}ms 초과 — 꺼짐으로 본다`]);
  });
  it('허용 목록 밖 키 → unknown_key, DB 0·경고 0', async () => {
    for (const k of ['safety_kill_switch', '', 'JOB_RUN_LOG_ENABLED', 'job_run_log_enabled '] as unknown as RecordSwitchKey[]) {
      await expect(readRecordSwitchState(k)).resolves.toEqual({ enabled: false, source: 'unknown_key' });
    }
    expect(getPoolMock).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
    expect(switchWarns()).toEqual([]);
  });
  it('캐시 — 오류 결과도 30초 기억(그동안 DB 0), 지나면 다시 읽는다', async () => {
    const t0 = 1_800_000_000_000;
    const now = jest.spyOn(Date, 'now').mockReturnValue(t0);
    queryMock.mockReturnValueOnce(Promise.reject(new Error('x'))).mockReturnValueOnce(Promise.resolve([[{ value: 'true' }], []]));
    await expect(readRecordSwitchState('exit_judgment_record_enabled')).resolves.toEqual({ enabled: false, source: 'read_error' });
    now.mockReturnValue(t0 + RECORD_SWITCH_CACHE_MS - 1);
    await expect(readRecordSwitchState('exit_judgment_record_enabled')).resolves.toEqual({ enabled: false, source: 'read_error' });
    expect(queryMock).toHaveBeenCalledTimes(1);
    now.mockReturnValue(t0 + RECORD_SWITCH_CACHE_MS);
    await expect(readRecordSwitchState('exit_judgment_record_enabled')).resolves.toEqual({ enabled: true, source: 'value' });
    expect(queryMock).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T-139 — 연결 상한(withBoundedConn). 예전 `withDeadline(pool.query(...))` 는 기다림만 끊어서 멈춘 SELECT 의 연결이 풀에 돌아오지 않았다.
// ─────────────────────────────────────────────────────────────────────────────
describe('🔴 T-139 연결 상한 — SELECT 는 받은 연결 하나로, 상한이면 그 자리에서 풀에서 뺀다', () => {
  const ends = (c: FakeConn) => [c.query.mock.calls.length, c.release.mock.calls.length, c.destroy.mock.calls.length];
  /** 받았는데 아직 끝내지 않은(release·destroy 0) 연결 수 = 이 모듈이 붙잡고 있는 풀 슬롯. */
  const busy = () => conns.filter((c) => c.release.mock.calls.length + c.destroy.mock.calls.length === 0).length;
  const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

  it('정상 — 연결 1개로 SELECT 1문장 뒤 release(destroy 0), 풀 query 0', async () => {
    queryMock.mockReturnValueOnce(rows('true'));
    await expect(readRecordSwitchState('job_run_log_enabled')).resolves.toEqual({ enabled: true, source: 'value' });
    expect(getConnectionMock).toHaveBeenCalledTimes(1);
    expect(conns.map(ends)).toEqual([[1, 1, 0]]);
    expect(conns[0].query.mock.calls[0]).toEqual(['SELECT value FROM system_config WHERE `key` = ? LIMIT 1', ['job_run_log_enabled']]);
    expect(poolQueryMock).not.toHaveBeenCalled();
    expect(busy()).toBe(0);
  });
  it('키 없음도 release(destroy 0)', async () => {
    queryMock.mockReturnValueOnce(rows());
    await expect(readRecordSwitchState('judgment_record_enabled')).resolves.toEqual({ enabled: false, source: 'missing' });
    expect(conns.map(ends)).toEqual([[1, 1, 0]]);
  });
  it('상한 전 문장 오류 → read_error, 그 연결은 destroy(상태를 믿지 않는다) · release 0', async () => {
    queryMock.mockReturnValueOnce(Promise.reject(Object.assign(new Error('Lock wait timeout'), { errno: 1205 })));
    await expect(readRecordSwitchState('job_run_log_enabled')).resolves.toEqual({ enabled: false, source: 'read_error' });
    expect(conns.map(ends)).toEqual([[1, 0, 1]]);
    expect(busy()).toBe(0);
  });
  it('연결 받기 실패 → read_error(그 오류 문구), SELECT 0', async () => {
    getConnectionMock.mockImplementationOnce(async () => { throw Object.assign(new Error('connect ECONNREFUSED'), { errno: -111 }); });
    await expect(readRecordSwitchState('job_run_log_enabled')).resolves.toEqual({ enabled: false, source: 'read_error' });
    expect(queryMock).not.toHaveBeenCalled();
    expect(conns).toHaveLength(0);
    expect((console.warn as jest.Mock).mock.calls.map((c) => String(c[0]))).toEqual([
      '[strategy/records/switch] 스위치(job_run_log_enabled) 읽기 실패 — 꺼짐으로 본다: connect ECONNREFUSED',
    ]);
  });
  it(`🔴 SELECT 가 멈추면 ${RECORD_SWITCH_TIMEOUT_MS}ms **그 시점에** 연결을 destroy(busy 0) — 늦은 응답·늦은 실패는 연결을 다시 건드리지 않는다`, async () => {
    jest.useFakeTimers();
    let late!: (v: unknown) => void;
    queryMock.mockReturnValueOnce(new Promise((r) => { late = r; }));
    const p = readRecordSwitchState('exit_judgment_record_enabled');
    await flush();
    expect(conns.map(ends)).toEqual([[1, 0, 0]]);
    expect(busy()).toBe(1);                                  // 조회 중에는 붙잡고 있다
    jest.advanceTimersByTime(RECORD_SWITCH_TIMEOUT_MS);
    await expect(p).resolves.toEqual({ enabled: false, source: 'timeout' });
    expect(conns.map(ends)).toEqual([[1, 0, 1]]);            // 답을 돌려주기 **전에** 이미 뺐다
    expect(busy()).toBe(0);
    late([[{ value: 'true' }], []]);
    await flush();
    expect(conns.map(ends)).toEqual([[1, 0, 1]]);
    expect((console.warn as jest.Mock).mock.calls).toHaveLength(1);   // 경고는 초과 1줄뿐
  });
  it('🔴 풀이 바빠 상한 뒤에야 받은 연결 — SELECT 를 보내지 않고 release, 결과는 timeout', async () => {
    jest.useFakeTimers();
    let give!: (c: FakeConn) => void;
    getConnectionMock.mockImplementationOnce(() => new Promise<FakeConn>((r) => { give = r; }));
    const p = readRecordSwitchState('job_run_log_enabled');
    await flush();
    expect(getConnectionMock).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(RECORD_SWITCH_TIMEOUT_MS);
    await expect(p).resolves.toEqual({ enabled: false, source: 'timeout' });
    give(newConn());
    await flush();
    expect(queryMock).not.toHaveBeenCalled();                // 늦은 SELECT 없음
    expect(conns.map(ends)).toEqual([[0, 1, 0]]);
    expect(busy()).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T-139 — 같은 키 조회 합치기(single-flight)
// ─────────────────────────────────────────────────────────────────────────────
describe('🔴 T-139 같은 키 조회 합치기 — 동시 N건 = 조회 1, 진행 중 표지는 끝나면 반드시 지운다', () => {
  const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
  function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  }

  it('같은 키 10건 동시 → 연결 1·SELECT 1, 열 호출 모두 같은 결과, 연결 release 1', async () => {
    const d = deferred<unknown>();
    queryMock.mockReturnValueOnce(d.promise);
    const ps = Array.from({ length: 10 }, () => readRecordSwitchState('exit_judgment_record_enabled'));
    await flush();
    expect(getConnectionMock).toHaveBeenCalledTimes(1);
    expect(queryMock).toHaveBeenCalledTimes(1);
    d.resolve([[{ value: 'true' }], []]);
    const rs = await Promise.all(ps);
    expect(rs).toEqual(Array.from({ length: 10 }, () => ({ enabled: true, source: 'value' })));
    expect(conns.map((c) => [c.release.mock.calls.length, c.destroy.mock.calls.length])).toEqual([[1, 0]]);
    expect(poolQueryMock).not.toHaveBeenCalled();
  });
  it(`🔴 같은 키 10건 동시 + SELECT 멈춤 → ${RECORD_SWITCH_TIMEOUT_MS}ms 에 모두 timeout, 연결 1개만 destroy, 경고 1줄`, async () => {
    jest.useFakeTimers();
    queryMock.mockReturnValueOnce(new Promise(() => {}));
    const ps = Array.from({ length: 10 }, () => readRecordSwitchState('job_run_log_enabled'));
    await flush();
    jest.advanceTimersByTime(RECORD_SWITCH_TIMEOUT_MS);
    const rs = await Promise.all(ps);
    expect(rs).toEqual(Array.from({ length: 10 }, () => ({ enabled: false, source: 'timeout' })));
    expect(getConnectionMock).toHaveBeenCalledTimes(1);
    expect(conns.map((c) => [c.query.mock.calls.length, c.release.mock.calls.length, c.destroy.mock.calls.length])).toEqual([[1, 0, 1]]);
    expect((console.warn as jest.Mock).mock.calls).toHaveLength(1);
  });
  it('진행 중에 늦게 합류한 호출도 같은 조회를 기다린다(상한은 처음 조회 기준 — 늦게 온 쪽은 남은 시간만)', async () => {
    jest.useFakeTimers();
    queryMock.mockReturnValueOnce(new Promise(() => {}));
    const first = readRecordSwitchState('job_run_log_enabled');
    await flush();
    jest.advanceTimersByTime(RECORD_SWITCH_TIMEOUT_MS - 500);
    let lateDone = false;
    const joiner = readRecordSwitchState('job_run_log_enabled').then((v) => { lateDone = true; return v; });
    await flush();
    expect(getConnectionMock).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(499);
    await flush();
    expect(lateDone).toBe(false);
    jest.advanceTimersByTime(1);
    await expect(first).resolves.toEqual({ enabled: false, source: 'timeout' });
    await expect(joiner).resolves.toEqual({ enabled: false, source: 'timeout' });
    expect(getConnectionMock).toHaveBeenCalledTimes(1);
  });
  it('키가 다르면 합치지 않는다(키마다 조회 1)', async () => {
    queryMock.mockImplementation((_sql: string, p: unknown[]) => Promise.resolve([[{ value: p[0] === 'judgment_record_enabled' ? 'true' : 'false' }], []]));
    const rs = await Promise.all(RECORD_SWITCH_KEYS.flatMap((k) => [readRecordSwitchState(k), readRecordSwitchState(k)]));
    expect(rs).toEqual([
      { enabled: false, source: 'value' }, { enabled: false, source: 'value' },
      { enabled: true, source: 'value' }, { enabled: true, source: 'value' },
      { enabled: false, source: 'value' }, { enabled: false, source: 'value' },
    ]);
    expect(getConnectionMock).toHaveBeenCalledTimes(RECORD_SWITCH_KEYS.length);
    expect(queryMock.mock.calls.map((c) => (c[1] as unknown[])[0])).toEqual([...RECORD_SWITCH_KEYS]);
  });
  it('합쳐진 조회가 끝나면 30초 캐시 — 그 안의 호출은 DB 0', async () => {
    const t0 = 1_800_000_000_000;
    const now = jest.spyOn(Date, 'now').mockReturnValue(t0);
    queryMock.mockReturnValueOnce(rows('true'));
    await Promise.all([readRecordSwitchState('job_run_log_enabled'), readRecordSwitchState('job_run_log_enabled')]);
    now.mockReturnValue(t0 + RECORD_SWITCH_CACHE_MS - 1);
    await expect(readRecordSwitchState('job_run_log_enabled')).resolves.toEqual({ enabled: true, source: 'value' });
    expect(getConnectionMock).toHaveBeenCalledTimes(1);
  });

  // 🔴 진행 중 표지 정리 — 끝난 뒤(캐시가 지나면) 새 호출은 새 조회를 한다. 지우지 않으면 그 키는 영구히 첫 결과를 돌려준다.
  it.each([
    ['값', () => queryMock.mockReturnValueOnce(rows('false')), { enabled: false, source: 'value' }],
    ['문장 오류', () => queryMock.mockReturnValueOnce(Promise.reject(new Error('boom'))), { enabled: false, source: 'read_error' }],
    ['연결 받기 실패', () => getConnectionMock.mockImplementationOnce(async () => { throw new Error('refused'); }), { enabled: false, source: 'read_error' }],
    ['getPool 예외', () => getPoolMock.mockImplementationOnce(() => { throw new Error('pool'); }), { enabled: false, source: 'read_error' }],
  ] as const)('%s 로 끝난 뒤 표지가 지워진다 — 캐시가 지나면 새 조회로 새 값', async (_n, arrange, firstState) => {
    const t0 = 1_800_000_000_000;
    const now = jest.spyOn(Date, 'now').mockReturnValue(t0);
    arrange();
    await expect(readRecordSwitchState('judgment_record_enabled')).resolves.toEqual(firstState);
    const before = getPoolMock.mock.calls.length;
    now.mockReturnValue(t0 + RECORD_SWITCH_CACHE_MS + 1);
    queryMock.mockReturnValueOnce(rows('true'));
    await expect(readRecordSwitchState('judgment_record_enabled')).resolves.toEqual({ enabled: true, source: 'value' });
    expect(getPoolMock.mock.calls.length).toBe(before + 1);
  });
  it(`🔴 ${RECORD_SWITCH_TIMEOUT_MS}ms 초과로 끝난 뒤에도 표지가 지워진다 — 캐시가 지나면 새 연결로 새 조회`, async () => {
    jest.useFakeTimers();
    queryMock.mockReturnValueOnce(new Promise(() => {}));
    const p = readRecordSwitchState('exit_judgment_record_enabled');
    await flush();
    jest.advanceTimersByTime(RECORD_SWITCH_TIMEOUT_MS);
    await expect(p).resolves.toEqual({ enabled: false, source: 'timeout' });
    jest.setSystemTime(Date.now() + RECORD_SWITCH_CACHE_MS + 1);
    queryMock.mockReturnValueOnce(rows('true'));
    await expect(readRecordSwitchState('exit_judgment_record_enabled')).resolves.toEqual({ enabled: true, source: 'value' });
    expect(getConnectionMock).toHaveBeenCalledTimes(2);
  });
  it('시험용 초기화는 진행 중 표지도 지운다 — 초기화 전에 시작한 조회가 늦게 끝나도 새 캐시를 덮지 않는다', async () => {
    const t0 = 1_800_000_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(t0);
    const d1 = deferred<unknown>();
    const d2 = deferred<unknown>();
    queryMock.mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise);
    const stale = readRecordSwitchState('job_run_log_enabled');
    await flush();
    resetRecordSwitchCacheForTest();
    const fresh = readRecordSwitchState('job_run_log_enabled');
    await flush();
    expect(getConnectionMock).toHaveBeenCalledTimes(2);       // 낡은 조회에 합류하지 않는다
    d2.resolve([[], []]);
    await expect(fresh).resolves.toEqual({ enabled: false, source: 'missing' });
    d1.resolve([[{ value: 'true' }], []]);
    await expect(stale).resolves.toEqual({ enabled: true, source: 'value' });   // 낡은 호출자는 자기 결과를 받는다
    await expect(readRecordSwitchState('job_run_log_enabled')).resolves.toEqual({ enabled: false, source: 'missing' });   // 캐시는 새 조회 값
    expect(getConnectionMock).toHaveBeenCalledTimes(2);
  });

  // (T-139 Reviewer F-1) 캐시 시각 = 조회가 **끝난** 시각(예전 코드와 같다). 시작 시각으로 바뀌면 오래 걸린 조회의 캐시가 그만큼 일찍 끝난다.
  it(`🔴 캐시 시각은 조회가 끝난 시각 — 1.5초 걸린 값·${RECORD_SWITCH_TIMEOUT_MS}ms 초과 결과 모두 끝난 뒤 ${RECORD_SWITCH_CACHE_MS - 1}ms 까지 hit, ${RECORD_SWITCH_CACHE_MS}ms 에 만료`, async () => {
    jest.useFakeTimers();
    const t0 = 1_800_000_000_000;
    jest.setSystemTime(t0);
    const slow = deferred<unknown>();
    const answers: Record<string, Array<() => Promise<unknown>>> = {
      judgment_record_enabled: [() => slow.promise, () => rows('false')],            // 1.5초 뒤 값 → 만료 뒤 새 값
      exit_judgment_record_enabled: [() => new Promise(() => {}), () => rows('true')], // 멈춤(2초 초과) → 만료 뒤 새 값
    };
    queryMock.mockImplementation((_sql: string, p: unknown[]) => answers[String(p[0])].shift()!());
    const pVal = readRecordSwitchState('judgment_record_enabled');
    const pOut = readRecordSwitchState('exit_judgment_record_enabled');
    await flush();
    expect(getConnectionMock).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(1_500);                          // 값 조회는 시작 1.5초 뒤에 끝난다
    slow.resolve([[{ value: 'true' }], []]);
    await expect(pVal).resolves.toEqual({ enabled: true, source: 'value' });
    jest.advanceTimersByTime(RECORD_SWITCH_TIMEOUT_MS - 1_500); // 멈춘 조회는 시작 2초 뒤 timeout 으로 끝난다
    await expect(pOut).resolves.toEqual({ enabled: false, source: 'timeout' });
    const doneVal = t0 + 1_500;
    const doneOut = t0 + RECORD_SWITCH_TIMEOUT_MS;

    // 끝난 시각 + 29,999ms — 아직 캐시(시작 시각 기준이면 이미 만료돼 새 조회가 나간다)
    jest.setSystemTime(doneVal + RECORD_SWITCH_CACHE_MS - 1);
    await expect(readRecordSwitchState('judgment_record_enabled')).resolves.toEqual({ enabled: true, source: 'value' });
    jest.setSystemTime(doneOut + RECORD_SWITCH_CACHE_MS - 1);
    await expect(readRecordSwitchState('exit_judgment_record_enabled')).resolves.toEqual({ enabled: false, source: 'timeout' });
    expect(getConnectionMock).toHaveBeenCalledTimes(2);
    expect(queryMock).toHaveBeenCalledTimes(2);

    // 끝난 시각 + 30,000ms — 만료, 새 연결로 새 조회
    jest.setSystemTime(doneVal + RECORD_SWITCH_CACHE_MS);
    await expect(readRecordSwitchState('judgment_record_enabled')).resolves.toEqual({ enabled: false, source: 'value' });
    expect(getConnectionMock).toHaveBeenCalledTimes(3);
    jest.setSystemTime(doneOut + RECORD_SWITCH_CACHE_MS);
    await expect(readRecordSwitchState('exit_judgment_record_enabled')).resolves.toEqual({ enabled: true, source: 'value' });
    expect(getConnectionMock).toHaveBeenCalledTimes(4);
  });

  // (T-139 Reviewer F-2) 진행 중 표지는 **자기 표지일 때만** 지운다. 초기화 뒤 새 조회가 진행 중일 때 낡은 조회가 먼저 끝나도 새 표지를 지우지 않아,
  // 그 사이의 세 번째 호출은 새 조회에 합류한다(지워 버리면 세 번째 호출이 조회를 하나 더 낸다). 낡은 결과는 새 캐시도 덮지 않는다.
  it('🔴 초기화 → 새 조회 진행 중 → 낡은 조회가 먼저 끝나도 새 표지·새 캐시를 지우거나 덮지 않는다(세 번째 호출은 새 조회에 합류)', async () => {
    const t0 = 1_800_000_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(t0);
    const dStale = deferred<unknown>();
    const dFresh = deferred<unknown>();
    queryMock.mockReturnValueOnce(dStale.promise).mockReturnValueOnce(dFresh.promise);
    const stale = readRecordSwitchState('exit_judgment_record_enabled');
    await flush();
    resetRecordSwitchCacheForTest();                          // 세대가 바뀐다 — 낡은 조회의 표지는 지워진다
    const fresh = readRecordSwitchState('exit_judgment_record_enabled');
    await flush();
    expect(getConnectionMock).toHaveBeenCalledTimes(2);

    dStale.resolve([[{ value: 'true' }], []]);                // 낡은 조회가 **먼저** 끝난다(새 조회는 아직 진행 중)
    await expect(stale).resolves.toEqual({ enabled: true, source: 'value' });
    await flush();

    const third = readRecordSwitchState('exit_judgment_record_enabled');   // 새 표지가 살아 있으면 합류 — 새 연결·새 SELECT 없음
    await flush();
    expect(getConnectionMock).toHaveBeenCalledTimes(2);
    expect(queryMock).toHaveBeenCalledTimes(2);

    dFresh.resolve([[], []]);
    await expect(fresh).resolves.toEqual({ enabled: false, source: 'missing' });
    await expect(third).resolves.toEqual({ enabled: false, source: 'missing' });   // 낡은 결과(켜짐)가 아니라 새 조회 결과
    await expect(readRecordSwitchState('exit_judgment_record_enabled')).resolves.toEqual({ enabled: false, source: 'missing' });   // 캐시도 새 값
    expect(getConnectionMock).toHaveBeenCalledTimes(2);
    expect(conns.map((c) => [c.release.mock.calls.length, c.destroy.mock.calls.length])).toEqual([[1, 0], [1, 0]]);
  });
});
