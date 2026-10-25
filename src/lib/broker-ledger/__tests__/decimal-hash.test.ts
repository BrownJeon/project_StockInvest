/**
 * T-087 — `decimal.ts`(고정소수점)·`hash.ts`(민감 필드 제거·안정 직렬화·raw_hash) 시험. 값은 합성.
 */
import { parseDec, toDbDecimal, quantize, equalAt2dp, withinRelative, mulDiv, formatDec, DEC_SCALE } from '../decimal';
import { sanitizeRawRow, stableJson, rawHashOf, sha256Hex, isSensitiveKey, SENSITIVE_KEYS } from '../hash';
import { domFillRow } from './helpers/kis-fixtures';

describe('decimal — 0 으로 읽지 않는다·부동소수 없음', () => {
  test.each([['', null], ['  ', null], [null, null], [undefined, null], ['abc', null], ['1e3', null], ['1,000', null], ['.5', null], ['5.', null], [{}, null], [NaN, null], [Infinity, null]])(
    '%p → null', (v, want) => expect(parseDec(v)).toBe(want));

  test('정수·소수·음수·앞뒤 공백·부호', () => {
    expect(formatDec(parseDec('303.70350')!, 5)).toBe('303.70350');
    expect(formatDec(parseDec(' -5600 ')!, 0)).toBe('-5600');
    expect(formatDec(parseDec('+0.1')!, 1)).toBe('0.1');
    expect(parseDec('0')).toBe(0n);
    expect(parseDec(12.5)).toBe(125n * 10n ** BigInt(DEC_SCALE - 1));
  });

  test('0.1 + 0.2 = 0.3 (2진 오차 없음)', () => {
    expect(equalAt2dp(parseDec('0.1')! + parseDec('0.2')!, parseDec('0.3')!)).toBe(true);
    expect(parseDec('0.1')! + parseDec('0.2')!).toBe(parseDec('0.3'));
  });

  test('반올림은 0 에서 먼 쪽(부호 대칭) · 12자리 초과 입력도 반올림', () => {
    expect(toDbDecimal(parseDec('1.00005')!, 24, 4)).toBe('1.0001');
    expect(toDbDecimal(parseDec('-1.00005')!, 24, 4)).toBe('-1.0001');
    expect(toDbDecimal(parseDec('1.00004')!, 24, 4)).toBe('1.0000');
    expect(toDbDecimal(parseDec('1400.0000000000')!, 12, 4)).toBe('1400.0000');
    expect(formatDec(parseDec('0.0000000000005')!, 12)).toBe('0.000000000001');
    expect(quantize(parseDec('2.345')!, 2)).toBe(235n);
    expect(toDbDecimal(parseDec('-0.00001')!, 24, 4)).toBe('0.0000');   // -0 은 0
  });

  test('정수부가 DECIMAL 정밀도를 넘으면 null(DB 가 잘라 넣게 두지 않는다)', () => {
    expect(toDbDecimal(parseDec('12345678.9')!, 12, 4)).toBe('12345678.9000');
    expect(toDbDecimal(parseDec('123456789')!, 12, 4)).toBeNull();
    expect(toDbDecimal(parseDec('99999999.99995')!, 12, 4)).toBeNull();   // 반올림 뒤 자리 올림까지 본다
  });

  test('합계 비교 — 소수 2자리 정확 · 상대 허용치(천분율)', () => {
    expect(equalAt2dp(parseDec('100.004')!, parseDec('100.00')!)).toBe(true);
    expect(equalAt2dp(parseDec('100.005')!, parseDec('100.00')!)).toBe(false);
    expect(withinRelative(parseDec('1000')!, parseDec('1000.9')!, 1)).toBe(true);
    expect(withinRelative(parseDec('1000')!, parseDec('1001.2')!, 1)).toBe(false);
    expect(withinRelative(0n, 0n, 1)).toBe(true);
    expect(withinRelative(0n, parseDec('0.01')!, 1)).toBe(false);
  });

  test('mulDiv — 0.25% 수수료', () => {
    expect(toDbDecimal(mulDiv(parseDec('303.7035')!, 25n, 10_000n), 18, 6)).toBe('0.759259');
    expect(() => mulDiv(1n, 1n, 0n)).toThrow(RangeError);
  });
});

describe('hash — 민감 필드 제거 · 안정 직렬화 · SHA-256', () => {
  test('민감 키 3종 + 계좌 키(중첩 포함) 제거, 원본 불변', () => {
    const row = { ...domFillRow(), cano: '99887766', acnt_prdt_cd: '01', nested: { CANO: 'x', ok: 1, list: [{ ctac_tlno: '0', a: 'b' }] } };
    const before = JSON.stringify(row);
    const s = sanitizeRawRow(row) as Record<string, unknown>;
    for (const k of [...SENSITIVE_KEYS, 'cano', 'acnt_prdt_cd']) expect(s).not.toHaveProperty(k);
    expect(s.nested).toEqual({ ok: 1, list: [{ a: 'b' }] });
    expect(s.odno).toBe('0000012345');
    expect(JSON.stringify(row)).toBe(before);
    expect(isSensitiveKey('INQR_IP_ADDR')).toBe(true);
    expect(isSensitiveKey('odno')).toBe(false);
  });

  test('키 순서만 다른 원문 → 같은 해시, 값 한 글자 차이 → 다른 해시, 민감 필드만 다르면 같은 해시', () => {
    const a = { b: '1', a: '2', c: { y: '1', x: '2' } };
    const b = { c: { x: '2', y: '1' }, a: '2', b: '1' };
    expect(stableJson(a)).toBe('{"a":"2","b":"1","c":{"x":"2","y":"1"}}');
    expect(rawHashOf(a).rawHash).toBe(rawHashOf(b).rawHash);
    expect(rawHashOf({ ...a, b: '2' }).rawHash).not.toBe(rawHashOf(a).rawHash);
    expect(rawHashOf(domFillRow({ ctac_tlno: '01011112222' })).rawHash).toBe(rawHashOf(domFillRow({ ctac_tlno: '01033334444' })).rawHash);
    expect(rawHashOf(domFillRow({ tot_ccld_qty: '4' })).rawHash).not.toBe(rawHashOf(domFillRow()).rawHash);
  });

  test('값은 바꾸지 않는다(트림·숫자 변환 없음) — 공백 하나도 변경으로 본다(과탐 방향)', () => {
    expect(rawHashOf({ v: '1' }).rawHash).not.toBe(rawHashOf({ v: ' 1' }).rawHash);
    expect(rawHashOf({ v: '1' }).rawHash).not.toBe(rawHashOf({ v: 1 }).rawHash);
  });

  test('raw_json 은 해시를 만든 바로 그 문자열이고 민감 값이 없다', () => {
    const { rawJson, rawHash } = rawHashOf(domFillRow());
    expect(sha256Hex(rawJson)).toBe(rawHash);
    expect(rawHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rawJson).not.toMatch(/ctac_tlno|inqr_ip_addr|ordr_empno|01000000000|10\.0\.0\.1|E0000/);
    expect(JSON.parse(rawJson).odno).toBe('0000012345');
  });

  test('JSON 이 아닌 값은 던진다(프로그램 오류) · undefined 키는 빠진다', () => {
    expect(() => stableJson({ a: 1n })).toThrow(TypeError);
    expect(() => stableJson({ a: Infinity })).toThrow(TypeError);
    const cyc: Record<string, unknown> = {}; cyc.self = cyc;
    expect(() => stableJson(cyc)).toThrow(TypeError);
    expect(stableJson({ a: undefined, b: [undefined, 1] })).toBe('{"b":[null,1]}');
  });
});
