/**
 * OAuth 가입의 초대코드 게이트 (T-009 D1=A, 2026-08-08).
 *
 * ★ 이 파일이 지키는 계약: **초대코드가 틀리면 계정이 만들어지지 않는다.**
 *   콜백은 계정을 만들지 않고, 계정 생성은 `evaluateOAuthCompletion` 이 ok 를 줄 때만
 *   실행되므로, 이 함수가 거부하면 생성 경로 자체가 실행되지 않는다.
 */
import { evaluateOAuthCompletion, verifyPendingForCompletion } from '@/lib/auth/oauth/complete-gate';
import { signPendingSignup } from '@/lib/auth/oauth/pending';
import { resetSignupGateWarning } from '@/lib/auth/signup-gate';
import type { OAuthProfile } from '@/lib/auth/oauth/provider-types';

const SECRET = 'test-session-secret-0123456789abcdef';
const NOW = 1_760_000_000_000;
const CODE = 'let-me-in-2026';

const profile: OAuthProfile = {
  providerId: 'g-77', email: 'owner@example.com', name: '전주인', avatar: null, emailVerified: true,
};

function pendingToken(over: Partial<OAuthProfile> = {}): string {
  return signPendingSignup(SECRET, 'google', { ...profile, ...over }, '/', NOW);
}

const ORIGINAL = process.env.SIGNUP_INVITE_CODE;

beforeEach(() => {
  process.env.SIGNUP_INVITE_CODE = CODE;
  resetSignupGateWarning();
});

afterAll(() => {
  if (ORIGINAL === undefined) delete process.env.SIGNUP_INVITE_CODE;
  else process.env.SIGNUP_INVITE_CODE = ORIGINAL;
});

describe('초대코드 통과', () => {
  it('정확한 코드면 통과하고 신원을 그대로 넘긴다', () => {
    const r = evaluateOAuthCompletion({ pendingToken: pendingToken(), secret: SECRET, inviteCode: CODE, nowMs: NOW });
    expect(r.ok).toBe(true);
    expect(r.ok && r.pending.email).toBe('owner@example.com');
    expect(r.ok && r.inviteGate).toBe('invite_required');
  });

  it('앞뒤 공백은 허용한다 (모바일 자동 공백 입력)', () => {
    const r = evaluateOAuthCompletion({ pendingToken: pendingToken(), secret: SECRET, inviteCode: `  ${CODE}  `, nowMs: NOW });
    expect(r.ok).toBe(true);
  });
});

describe('★ 초대코드 실패 — 계정이 만들어지지 않는다', () => {
  const wrong = ['wrong-code', '', '   ', CODE.toUpperCase(), `${CODE}x`, undefined, null, 123, {}];

  it.each(wrong.map((c) => [JSON.stringify(c) ?? String(c), c] as const))(
    '틀린 코드 %s 는 거부되고 reason=invite 다',
    (_label, code) => {
      const r = evaluateOAuthCompletion({ pendingToken: pendingToken(), secret: SECRET, inviteCode: code, nowMs: NOW });
      expect(r.ok).toBe(false);
      expect(!r.ok && r.reason).toBe('invite');
      expect(!r.ok && r.status).toBe(403);
      // ok:false 결과에는 pending 이 아예 없다 — 생성에 쓸 신원 자체가 손에 들어오지 않는다.
      expect((r as { pending?: unknown }).pending).toBeUndefined();
    },
  );
});

describe('대기 토큰이 없거나 위조된 경우', () => {
  it('토큰이 없으면 코드가 맞아도 거부', () => {
    const r = evaluateOAuthCompletion({ pendingToken: null, secret: SECRET, inviteCode: CODE, nowMs: NOW });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe('expired');
  });

  it('위조된 토큰은 거부 — OAuth 를 거치지 않고 계정을 만들 수 없다', () => {
    const forged = Buffer.from(JSON.stringify({
      p: 'google', i: 'x', e: 'victim@example.com', nm: 'v', v: true, r: '/', exp: NOW + 9e9,
    })).toString('base64url') + '.deadbeef';
    const r = evaluateOAuthCompletion({ pendingToken: forged, secret: SECRET, inviteCode: CODE, nowMs: NOW });
    expect(r.ok).toBe(false);
  });

  it('만료된 토큰은 거부', () => {
    const r = evaluateOAuthCompletion({
      pendingToken: pendingToken(), secret: SECRET, inviteCode: CODE, nowMs: NOW + 16 * 60 * 1000,
    });
    expect(r.ok).toBe(false);
  });
});

describe('★ 미검증 이메일은 완료 단계에서도 다시 막힌다 (이중 방어)', () => {
  it('코드가 맞아도 emailVerified=false 면 거부', () => {
    const r = evaluateOAuthCompletion({
      pendingToken: pendingToken({ emailVerified: false }), secret: SECRET, inviteCode: CODE, nowMs: NOW,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe('unverified');
    expect(!r.ok && r.status).toBe(403);
  });

  it('초대코드를 보기 전 단계(verifyPendingForCompletion)에서 이미 걸린다', () => {
    const r = verifyPendingForCompletion(pendingToken({ emailVerified: false }), SECRET, NOW);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe('unverified');
  });
});

describe('초대코드 미설정 (가입 개방)', () => {
  beforeEach(() => { delete process.env.SIGNUP_INVITE_CODE; });

  it('코드 없이 통과하고 gate=open 으로 표시된다 — 이메일 가입과 동일한 규칙', () => {
    const r = evaluateOAuthCompletion({ pendingToken: pendingToken(), secret: SECRET, inviteCode: undefined, nowMs: NOW });
    expect(r.ok).toBe(true);
    expect(r.ok && r.inviteGate).toBe('open');
  });

  it('그래도 미검증 이메일은 통과하지 못한다', () => {
    const r = evaluateOAuthCompletion({
      pendingToken: pendingToken({ emailVerified: false }), secret: SECRET, inviteCode: undefined, nowMs: NOW,
    });
    expect(r.ok).toBe(false);
  });
});
