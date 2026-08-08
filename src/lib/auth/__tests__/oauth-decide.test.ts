/**
 * OAuth 콜백 판정 (T-009, 2026-08-08).
 *
 * 계정 탈취 방어(B3)와 초대코드 게이트(D1)가 실제로 어느 분기에서 걸리는지를 고정한다.
 */
import { decideOAuthOutcome, outcomeUserId, type OAuthCandidateUser } from '@/lib/auth/oauth/decide';
import type { OAuthProfile } from '@/lib/auth/oauth/provider-types';

function profile(over: Partial<OAuthProfile> = {}): OAuthProfile {
  return {
    providerId: 'g-1',
    email: 'owner@example.com',
    name: '전주인',
    avatar: null,
    emailVerified: true,
    ...over,
  };
}

function user(over: Partial<OAuthCandidateUser> = {}): OAuthCandidateUser {
  return { id: 1, oauthProvider: null, oauthId: null, ...over };
}

describe('① 소셜 신원 일치 — 재방문자', () => {
  it('바로 로그인한다', () => {
    const out = decideOAuthOutcome({
      provider: 'google',
      profile: profile(),
      byOAuth: user({ id: 9, oauthProvider: 'google', oauthId: 'g-1' }),
      byEmail: null,
      inviteRequired: true,
    });
    expect(out).toEqual({ kind: 'login', userId: 9 });
  });

  it('이메일이 미검증이어도 통과한다 — 이미 이 계정에 묶인 신원이라 이메일로 찾은 게 아니다', () => {
    const out = decideOAuthOutcome({
      provider: 'github',
      profile: profile({ emailVerified: false }),
      byOAuth: user({ id: 9, oauthProvider: 'github', oauthId: 'g-1' }),
      byEmail: null,
      inviteRequired: true,
    });
    expect(out).toEqual({ kind: 'login', userId: 9 });
  });
});

describe('② 미검증 이메일 — 계정 탈취 차단 (T-009 B3)', () => {
  it('★ 기존 계정이 같은 이메일로 있어도 연결하지 않는다', () => {
    const out = decideOAuthOutcome({
      provider: 'github',
      profile: profile({ emailVerified: false }),
      byOAuth: null,
      byEmail: user({ id: 5 }), // 피해자 계정
      inviteRequired: true,
    });
    expect(out).toEqual({ kind: 'reject_unverified' });
    expect(outcomeUserId(out)).toBeNull();
  });

  it('★ 신규 생성도 거부한다 — 남의 주소 선점 방지 (지시보다 엄격, 보고서에 기재)', () => {
    const out = decideOAuthOutcome({
      provider: 'github',
      profile: profile({ emailVerified: false }),
      byOAuth: null,
      byEmail: null,
      inviteRequired: false,
    });
    expect(out).toEqual({ kind: 'reject_unverified' });
  });
});

describe('③ 검증된 이메일이 기존 계정과 일치', () => {
  it('아직 소셜이 연결되지 않았으면 연결 후 로그인', () => {
    const out = decideOAuthOutcome({
      provider: 'google',
      profile: profile(),
      byOAuth: null,
      byEmail: user({ id: 5, oauthProvider: null, oauthId: null }),
      inviteRequired: true,
    });
    expect(out).toEqual({ kind: 'link_and_login', userId: 5 });
  });

  it('초대코드가 필요해도 기존 계정 연결에는 초대 화면이 나오지 않는다', () => {
    const out = decideOAuthOutcome({
      provider: 'google',
      profile: profile(),
      byOAuth: null,
      byEmail: user({ id: 5 }),
      inviteRequired: true,
    });
    expect(out.kind).not.toBe('need_invite');
  });

  it('이미 다른 프로바이더에 묶여 있으면 링크를 덮어쓰지 않고 로그인만 한다', () => {
    const out = decideOAuthOutcome({
      provider: 'github',
      profile: profile({ providerId: 'gh-2' }),
      byOAuth: null,
      byEmail: user({ id: 5, oauthProvider: 'google', oauthId: 'g-1' }),
      inviteRequired: true,
    });
    expect(out).toEqual({ kind: 'login_without_relink', userId: 5 });
  });
});

describe('④ 신규 — 초대코드 게이트 (D1=A)', () => {
  it('초대코드가 설정돼 있으면 계정을 만들지 않고 초대 화면으로 보낸다', () => {
    const out = decideOAuthOutcome({
      provider: 'google',
      profile: profile(),
      byOAuth: null,
      byEmail: null,
      inviteRequired: true,
    });
    expect(out).toEqual({ kind: 'need_invite' });
    expect(outcomeUserId(out)).toBeNull();
  });

  it('초대코드 미설정(가입 개방)이면 바로 생성 경로 — 이메일 가입과 같은 규칙', () => {
    const out = decideOAuthOutcome({
      provider: 'google',
      profile: profile(),
      byOAuth: null,
      byEmail: null,
      inviteRequired: false,
    });
    expect(out).toEqual({ kind: 'create' });
  });
});

describe('outcomeUserId', () => {
  it('세션을 발급해야 하는 결과에서만 회원 id 를 준다', () => {
    expect(outcomeUserId({ kind: 'login', userId: 1 })).toBe(1);
    expect(outcomeUserId({ kind: 'link_and_login', userId: 2 })).toBe(2);
    expect(outcomeUserId({ kind: 'login_without_relink', userId: 3 })).toBe(3);
    expect(outcomeUserId({ kind: 'need_invite' })).toBeNull();
    expect(outcomeUserId({ kind: 'create' })).toBeNull();
    expect(outcomeUserId({ kind: 'reject_unverified' })).toBeNull();
  });
});
