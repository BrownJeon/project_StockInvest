/**
 * Phase 0 — 안전장치 불리언 플래그 파서 테스트.
 *
 * 회귀 방어 ①: `val === true || val === 'true'` 로만 판정하면 `1` · `"1"` · `"ON"` 이
 * false 로 해석돼 DRY_RUN·KILL_SWITCH 가 조용히 해제된다 (fail-open).
 * 회귀 방어 ②: **미설정과 해석 불가는 반드시 구분**돼야 한다. 둘의 안전 기본값이 다르다
 * (KILL_SWITCH 미설정 → 비활성 / 해석 불가 → 활성).
 */
import { parseBoolFlag, resetUnparsableReports, shouldReportUnparsable } from '../flags';

describe('parseBoolFlag — parsed', () => {
  test('불리언 그대로', () => {
    expect(parseBoolFlag(true)).toEqual({ state: 'parsed', value: true });
    expect(parseBoolFlag(false)).toEqual({ state: 'parsed', value: false });
  });

  test('숫자 1/0', () => {
    expect(parseBoolFlag(1)).toEqual({ state: 'parsed', value: true });
    expect(parseBoolFlag(0)).toEqual({ state: 'parsed', value: false });
  });

  test('문자열 truthy 토큰', () => {
    for (const v of ['true', '1', 'on', 'yes', 'y']) {
      expect(parseBoolFlag(v)).toEqual({ state: 'parsed', value: true });
    }
  });

  test('문자열 falsy 토큰', () => {
    for (const v of ['false', '0', 'off', 'no', 'n']) {
      expect(parseBoolFlag(v)).toEqual({ state: 'parsed', value: false });
    }
  });

  test('대소문자·앞뒤 공백은 정규화 후 판정 — unparsable 아님', () => {
    expect(parseBoolFlag(' TRUE ')).toEqual({ state: 'parsed', value: true });
    expect(parseBoolFlag('\tFalse\n')).toEqual({ state: 'parsed', value: false });
    expect(parseBoolFlag('ON')).toEqual({ state: 'parsed', value: true });
    expect(parseBoolFlag(' 1 ')).toEqual({ state: 'parsed', value: true });
  });
});

describe('parseBoolFlag — unset (설정된 적 없음)', () => {
  test('null / undefined', () => {
    expect(parseBoolFlag(null)).toEqual({ state: 'unset' });
    expect(parseBoolFlag(undefined)).toEqual({ state: 'unset' });
  });

  test('빈 문자열 / 공백뿐인 문자열', () => {
    expect(parseBoolFlag('')).toEqual({ state: 'unset' });
    expect(parseBoolFlag('   ')).toEqual({ state: 'unset' });
  });
});

describe('parseBoolFlag — unparsable (값은 있는데 인식 실패)', () => {
  test('알 수 없는 문자열은 raw 를 보존해 돌려준다', () => {
    expect(parseBoolFlag('maybe')).toEqual({ state: 'unparsable', raw: 'maybe' });
    expect(parseBoolFlag('ㅇ')).toEqual({ state: 'unparsable', raw: 'ㅇ' });
    expect(parseBoolFlag('flase')).toEqual({ state: 'unparsable', raw: 'flase' });
  });

  test('1/0 이 아닌 숫자', () => {
    expect(parseBoolFlag(2)).toEqual({ state: 'unparsable', raw: '2' });
    expect(parseBoolFlag(-1)).toEqual({ state: 'unparsable', raw: '-1' });
    expect(parseBoolFlag(NaN)).toEqual({ state: 'unparsable', raw: 'NaN' });
  });

  test('객체·배열', () => {
    expect(parseBoolFlag({}).state).toBe('unparsable');
    expect(parseBoolFlag([]).state).toBe('unparsable');
  });

  test('unset 과 절대 혼동되지 않는다', () => {
    // 이 구분이 무너지면 KILL_SWITCH 오타가 "미설정"으로 처리돼 비활성이 된다.
    expect(parseBoolFlag('maybe').state).not.toBe('unset');
    expect(parseBoolFlag('').state).not.toBe('unparsable');
  });
});

describe('shouldReportUnparsable — 중복 보고 억제', () => {
  beforeEach(() => resetUnparsableReports());

  test('같은 (key, raw) 는 최초 1회만 true', () => {
    expect(shouldReportUnparsable('KILL_SWITCH', 'maybe')).toBe(true);
    expect(shouldReportUnparsable('KILL_SWITCH', 'maybe')).toBe(false);
    expect(shouldReportUnparsable('KILL_SWITCH', 'maybe')).toBe(false);
  });

  test('값이 바뀌면 다시 보고한다', () => {
    expect(shouldReportUnparsable('KILL_SWITCH', 'maybe')).toBe(true);
    expect(shouldReportUnparsable('KILL_SWITCH', 'ㅇㅇ')).toBe(true);
  });

  test('key 가 다르면 별개로 집계', () => {
    expect(shouldReportUnparsable('KILL_SWITCH', 'x')).toBe(true);
    expect(shouldReportUnparsable('DRY_RUN', 'x')).toBe(true);
  });
});
