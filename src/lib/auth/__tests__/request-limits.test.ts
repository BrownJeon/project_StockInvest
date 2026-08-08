/**
 * 무인증 인증 경로 본문 상한 테스트 (T-008 reviewer HIGH 후속).
 */
import { MAX_AUTH_BODY_BYTES, isAuthBodyTooLarge } from '../request-limits';

function reqWith(headers: Record<string, string>) {
  return { headers: new Headers(headers) } as { headers: Headers };
}

describe('isAuthBodyTooLarge', () => {
  test('상한 이하는 통과', () => {
    expect(isAuthBodyTooLarge(reqWith({ 'content-length': '120' }))).toBe(false);
    expect(isAuthBodyTooLarge(reqWith({ 'content-length': String(MAX_AUTH_BODY_BYTES) }))).toBe(false);
  });

  test('상한 초과는 차단', () => {
    expect(isAuthBodyTooLarge(reqWith({ 'content-length': String(MAX_AUTH_BODY_BYTES + 1) }))).toBe(true);
    expect(isAuthBodyTooLarge(reqWith({ 'content-length': '50000000' }))).toBe(true);
  });

  test('헤더가 없거나 숫자가 아니면 여기서 막지 않는다 (2차 방어선이 길이 캡)', () => {
    expect(isAuthBodyTooLarge(reqWith({}))).toBe(false);
    expect(isAuthBodyTooLarge(reqWith({ 'content-length': 'abc' }))).toBe(false);
  });

  test('정상 로그인 본문은 여유롭게 통과한다', () => {
    const body = JSON.stringify({ email: 'a'.repeat(255) + '@example.com', password: 'p'.repeat(200) });
    expect(isAuthBodyTooLarge(reqWith({ 'content-length': String(Buffer.byteLength(body)) }))).toBe(false);
  });
});
