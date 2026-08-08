/**
 * 공유 패키지 프로바이더 정규화 (T-009, 2026-08-08).
 *
 * `@workspace/auth-oauth` 는 TheRoute·bjj-trainning 도 쓰는 공유 코드다. 두 프로젝트에는
 * 테스트가 없으므로, **하위호환(기존 4개 필드 불변)을 검증하는 유일한 자동화 장치가 여기**다.
 * 이 파일이 깨지면 형제 프로젝트의 로그인이 깨질 수 있다는 뜻이다.
 */
import googleProvider from '@workspace/auth-oauth/providers/google';
import githubProvider from '@workspace/auth-oauth/providers/github';
import { normalizeSharedProfile } from '@/lib/auth/oauth/providers';

describe('google.normalizeProfile', () => {
  const raw = { id: '1088', email: 'Owner@Example.com', name: '전주인', picture: 'https://x/a.png' };

  it('기존 4개 필드는 그대로다 (형제 프로젝트 하위호환)', () => {
    const p = googleProvider.normalizeProfile({ ...raw, verified_email: true });
    expect(p.providerId).toBe('1088');
    expect(p.email).toBe('Owner@Example.com'); // 공유 패키지는 소문자화하지 않는다 — 기존 동작 유지
    expect(p.name).toBe('전주인');
    expect(p.avatar).toBe('https://x/a.png');
  });

  it('verified_email=true → emailVerified true', () => {
    expect(googleProvider.normalizeProfile({ ...raw, verified_email: true }).emailVerified).toBe(true);
  });

  it('OIDC userinfo 의 email_verified 도 인식한다', () => {
    expect(googleProvider.normalizeProfile({ ...raw, email_verified: true }).emailVerified).toBe(true);
  });

  it('verified_email=false → emailVerified false', () => {
    expect(googleProvider.normalizeProfile({ ...raw, verified_email: false }).emailVerified).toBe(false);
  });

  it('검증 필드가 아예 없으면 false (모르면 미검증 — fail-closed)', () => {
    expect(googleProvider.normalizeProfile(raw).emailVerified).toBe(false);
  });

  it('문자열 "true" 같은 값은 true 로 통과하지 않는다', () => {
    expect(googleProvider.normalizeProfile({ ...raw, verified_email: 'true' }).emailVerified).toBe(false);
  });

  it('name/picture 가 없으면 기존과 동일하게 email/null 로 떨어진다', () => {
    const p = googleProvider.normalizeProfile({ id: '1', email: 'a@b.co' });
    expect(p.name).toBe('a@b.co');
    expect(p.avatar).toBeNull();
  });
});

describe('github.normalizeProfile', () => {
  const user = { id: 42, login: 'jeon', name: '전주인', email: 'fallback@example.com', avatar_url: 'https://x/g.png' };

  it('검증된 primary 이메일 → 그 주소 + emailVerified true', () => {
    const p = githubProvider.normalizeProfile({
      user,
      emails: [
        { email: 'other@example.com', primary: false, verified: true },
        { email: 'primary@example.com', primary: true, verified: true },
      ],
    });
    expect(p.email).toBe('primary@example.com');
    expect(p.emailVerified).toBe(true);
    expect(p.providerId).toBe('42');
    expect(p.name).toBe('전주인');
    expect(p.avatar).toBe('https://x/g.png');
  });

  it('★ 폴백은 유지된다 — 검증된 primary 가 없어도 user.email 을 그대로 돌려준다', () => {
    // 이 폴백을 지우면 TheRoute·bjj-trainning 의 기존 사용자가 즉시 로그인 불가가 된다.
    const p = githubProvider.normalizeProfile({
      user,
      emails: [{ email: 'primary@example.com', primary: true, verified: false }],
    });
    expect(p.email).toBe('fallback@example.com');
  });

  it('★ 폴백 경로는 emailVerified false 로 태그된다 (계정 탈취 차단의 근거)', () => {
    const p = githubProvider.normalizeProfile({
      user,
      emails: [{ email: 'primary@example.com', primary: true, verified: false }],
    });
    expect(p.emailVerified).toBe(false);
  });

  it('primary 이지만 미검증 / 검증됐지만 primary 아님 → 둘 다 false', () => {
    expect(
      githubProvider.normalizeProfile({ user, emails: [{ email: 'x@y.z', primary: true, verified: false }] }).emailVerified,
    ).toBe(false);
    expect(
      githubProvider.normalizeProfile({ user, emails: [{ email: 'x@y.z', primary: false, verified: true }] }).emailVerified,
    ).toBe(false);
  });

  it('emails 가 없거나 빈 배열이어도 기존처럼 폴백한다', () => {
    expect(githubProvider.normalizeProfile({ user, emails: undefined }).email).toBe('fallback@example.com');
    expect(githubProvider.normalizeProfile({ user, emails: [] }).emailVerified).toBe(false);
  });

  it('이메일이 하나도 없으면 기존과 동일하게 throw', () => {
    expect(() =>
      githubProvider.normalizeProfile({ user: { id: 1, login: 'x', email: null }, emails: [] }),
    ).toThrow(/인증된 이메일/);
  });
});

describe('normalizeSharedProfile (StockInvest 어댑터)', () => {
  it('이메일을 소문자·trim 으로 정규화한다 (users 테이블 조회 키와 일치시키기 위해)', () => {
    const p = normalizeSharedProfile('google', { id: '7', email: '  Owner@EXAMPLE.com ', verified_email: true });
    expect(p.email).toBe('owner@example.com');
  });

  it('emailVerified 는 === true 일 때만 true 다', () => {
    expect(normalizeSharedProfile('google', { id: '7', email: 'a@b.co', verified_email: true }).emailVerified).toBe(true);
    expect(normalizeSharedProfile('google', { id: '7', email: 'a@b.co' }).emailVerified).toBe(false);
  });

  it('providerId 나 email 이 비면 거부한다', () => {
    expect(() => normalizeSharedProfile('google', { id: '', email: 'a@b.co' })).toThrow();
    expect(() => normalizeSharedProfile('google', { id: '7', email: '   ' })).toThrow();
  });
});
