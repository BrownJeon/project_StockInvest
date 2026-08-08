/**
 * OAuth 콜백 판정 — **순수 함수** (T-009, 2026-08-08).
 *
 * DB 조회 결과 2개(프로바이더 신원으로 찾은 회원 / 이메일로 찾은 회원)와 프로필을 받아
 * "무엇을 할지"만 결정한다. I/O 가 없으므로 계정 탈취 방어의 핵심 분기를 테스트로 고정할 수 있다.
 *
 * ── 판정 순서와 그 이유 ────────────────────────────────────────────────────
 *
 * 1) **프로바이더 신원 일치가 최우선.** 이미 이 계정에 묶인 소셜 신원으로 돌아온
 *    재방문자다. 이메일 검증 여부는 여기서 따지지 않는다 — 검증은 "이메일로 남의 계정을
 *    찾아 붙는" 경로를 막기 위한 것이고, 이 경로는 이메일로 찾은 게 아니다.
 *
 * 2) **미검증 이메일이면 여기서 끝.** (T-009 B3 — 가장 심각한 구멍)
 *    공격자가 피해자 주소로 소셜 계정을 만들어 로그인하면 3)의 이메일 매칭이
 *    **피해자의 계정에 붙여 준다.** 이 앱은 암호화된 KIS 증권 자격증명을 쥐고 있다.
 *
 *    ⚠️ 리더 지시는 "**기존 계정 연결**을 거부"였는데, 여기서는 **신규 생성도 함께 거부**한다.
 *       미검증 이메일로 계정을 만들게 두면 공격자가 피해자 주소를 **선점**할 수 있고,
 *       나중에 진짜 주인이 이메일로 가입할 때 UNIQUE 충돌로 막힌다(피해자 배제).
 *       더 엄격한 쪽이라 안전하지만 **지시 범위를 넘어선 판단**이므로 리뷰에서 뒤집을 수 있게
 *       분기를 이 한 곳에 모아 뒀다.
 *
 * 3) **검증된 이메일이 기존 계정과 일치 → 연결(또는 그대로 로그인).**
 *
 * 4) 그 외 → 신규 가입. 초대코드가 필요하면 화면을 한 번 더 거친다(D1=A).
 */
import type { OAuthProviderName } from '@/lib/auth/oauth/names';
import type { OAuthProfile } from '@/lib/auth/oauth/provider-types';

/** 판정에 필요한 회원 정보만 추린 최소 형태 (users.ts 의 UserRecord 가 이 형태를 만족한다). */
export interface OAuthCandidateUser {
  id: number;
  oauthProvider: string | null;
  oauthId: string | null;
}

export type OAuthOutcome =
  /** 이 소셜 신원으로 이미 가입된 회원 — 바로 로그인 */
  | { kind: 'login'; userId: number }
  /** 검증된 이메일이 기존 계정과 일치 — 소셜 신원을 연결한 뒤 로그인 */
  | { kind: 'link_and_login'; userId: number }
  /** 기존 계정이 **다른** 소셜 신원에 이미 묶여 있음 — 링크는 건드리지 않고 로그인만 */
  | { kind: 'login_without_relink'; userId: number }
  /** 미검증 이메일 — 거부 */
  | { kind: 'reject_unverified' }
  /** 신규 — 초대코드 화면으로 (계정은 아직 만들지 않는다) */
  | { kind: 'need_invite' }
  /** 신규 — 초대코드 미설정(가입 개방)이라 바로 생성 */
  | { kind: 'create' };

export interface DecideInput {
  provider: OAuthProviderName;
  profile: OAuthProfile;
  /** (oauth_provider, oauth_id) 로 찾은 회원 */
  byOAuth: OAuthCandidateUser | null;
  /** 정규화된 email 로 찾은 회원 */
  byEmail: OAuthCandidateUser | null;
  /** `SIGNUP_INVITE_CODE` 가 설정돼 있는가 */
  inviteRequired: boolean;
}

export function decideOAuthOutcome(input: DecideInput): OAuthOutcome {
  const { provider, profile, byOAuth, byEmail, inviteRequired } = input;

  // 1) 이미 이 소셜 신원으로 가입된 회원
  if (byOAuth) return { kind: 'login', userId: byOAuth.id };

  // 2) 미검증 이메일은 여기서 끝 (연결·생성 모두 거부)
  if (profile.emailVerified !== true) return { kind: 'reject_unverified' };

  // 3) 검증된 이메일이 기존 계정과 일치
  if (byEmail) {
    const alreadyLinked =
      typeof byEmail.oauthProvider === 'string' && byEmail.oauthProvider.length > 0;
    if (!alreadyLinked) return { kind: 'link_and_login', userId: byEmail.id };
    // 이미 다른 프로바이더(또는 다른 신원)에 묶여 있다 — 덮어쓰면 기존 연결이 끊긴다.
    // 이메일은 제공자가 검증했으므로 로그인 자체는 허용하되 링크는 보존한다.
    if (byEmail.oauthProvider === provider && byEmail.oauthId === profile.providerId) {
      // byOAuth 가 잡았어야 하는 경우 — 조회 경합 등으로 여기 왔다면 그냥 로그인.
      return { kind: 'login', userId: byEmail.id };
    }
    return { kind: 'login_without_relink', userId: byEmail.id };
  }

  // 4) 신규
  return inviteRequired ? { kind: 'need_invite' } : { kind: 'create' };
}

/** 판정 결과가 "세션을 발급해야 하는" 종류인지 + 대상 회원 id. */
export function outcomeUserId(outcome: OAuthOutcome): number | null {
  switch (outcome.kind) {
    case 'login':
    case 'link_and_login':
    case 'login_without_relink':
      return outcome.userId;
    default:
      return null;
  }
}
