/**
 * 가입 초대 코드 게이트 테스트 (T-008).
 *
 * 설계문서는 "KIS 키 실검증이 사실상의 가입 제한"이라 가정했는데(문서 line 28),
 * 사용자 결정 Q1 로 가입에서 KIS 가 빠지면서 그 제한이 사라졌다. 이 게이트가 대체물이다.
 */
import { checkSignupInvite, isInviteRequired, resetSignupGateWarning, timingSafeEqualStr } from '../signup-gate';

const ORIG = process.env.SIGNUP_INVITE_CODE;
let warnSpy: jest.SpyInstance;

beforeEach(() => {
  resetSignupGateWarning();
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => { /* 테스트 출력 억제 */ });
});
afterEach(() => warnSpy.mockRestore());
afterAll(() => {
  if (ORIG === undefined) delete process.env.SIGNUP_INVITE_CODE;
  else process.env.SIGNUP_INVITE_CODE = ORIG;
});

describe('코드가 설정된 경우 — 가입 제한', () => {
  beforeEach(() => { process.env.SIGNUP_INVITE_CODE = 'let-me-in-2026'; });

  test('isInviteRequired = true', () => {
    expect(isInviteRequired()).toBe(true);
  });

  test('정확히 일치해야 통과', () => {
    const r = checkSignupInvite('let-me-in-2026');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.gate).toBe('invite_required');
  });

  test('앞뒤 공백은 허용(trim)', () => {
    expect(checkSignupInvite('  let-me-in-2026 ').ok).toBe(true);
  });

  test('불일치·빈 값·미입력은 거부', () => {
    for (const bad of ['let-me-in-2025', 'LET-ME-IN-2026', '', '   ', undefined, null, 123, {}]) {
      expect(checkSignupInvite(bad).ok).toBe(false);
    }
  });

  test('거부 사유에 실제 코드가 노출되지 않는다', () => {
    const r = checkSignupInvite('wrong');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).not.toContain('let-me-in-2026');
  });
});

describe('코드가 없는 경우 — 가입 개방 + 경고', () => {
  beforeEach(() => { delete process.env.SIGNUP_INVITE_CODE; });

  test('isInviteRequired = false', () => {
    expect(isInviteRequired()).toBe(false);
  });

  test('코드 없이도 통과하되 gate=open 이고 경고를 남긴다', () => {
    const r = checkSignupInvite(undefined);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.gate).toBe('open');
    expect(warnSpy).toHaveBeenCalled();
  });

  test('공백만 있는 값도 미설정으로 취급', () => {
    process.env.SIGNUP_INVITE_CODE = '   ';
    expect(isInviteRequired()).toBe(false);
    const r = checkSignupInvite('anything');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.gate).toBe('open');
  });
});

describe('timingSafeEqualStr', () => {
  test('같은 값 true / 다른 값 false', () => {
    expect(timingSafeEqualStr('abc', 'abc')).toBe(true);
    expect(timingSafeEqualStr('abc', 'abd')).toBe(false);
    expect(timingSafeEqualStr('', '')).toBe(true);
  });

  test('길이가 달라도 예외 없이 false (해시로 고정 길이화)', () => {
    expect(timingSafeEqualStr('a', 'a-very-long-invite-code')).toBe(false);
    expect(timingSafeEqualStr('a-very-long-invite-code', 'a')).toBe(false);
  });

  test('유니코드도 정확히 비교', () => {
    expect(timingSafeEqualStr('초대코드', '초대코드')).toBe(true);
    expect(timingSafeEqualStr('초대코드', '초대코三')).toBe(false);
  });
});
