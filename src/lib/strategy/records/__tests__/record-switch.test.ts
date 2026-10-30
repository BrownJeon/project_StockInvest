/**
 * T-112 record-switch — 기록 스위치(fail-closed) 시험. DB 는 목(`@/lib/db`).
 *  1. 정확히 JSON true 만 켜짐 — 키 없음·false·"1"·1·"yes"·해석 불가 = 꺼짐
 *  2. DB 오류·테이블 없음·getPool 예외·2초 초과 = 꺼짐, 던지지 않음
 *  3. 허용 목록 밖 키는 DB 를 건드리지 않음
 *  4. 30초 캐시(키별) — 30초 안 재호출은 DB 1회, 지나면 다시 읽음
 *  5. readRecordSwitchState — 꺼짐(missing·value)과 읽지 못함(read_error·timeout)을 source 로 가른다
 */
const queryMock = jest.fn();
const getPoolMock = jest.fn(() => ({ query: queryMock }));
jest.mock('@/lib/db', () => ({ getPool: () => getPoolMock() }));

import {
  RECORD_SWITCH_CACHE_MS,
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
  getPoolMock.mockClear();
  getPoolMock.mockImplementation(() => ({ query: queryMock }));
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
