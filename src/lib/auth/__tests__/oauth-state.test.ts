/**
 * OAuth CSRF state + 대기 토큰 (T-009, 2026-08-08).
 *
 * 공유 패키지 `core/state.js` 가 서명·만료만 보는 것과 달리, 여기서는 nonce 를
 * 쿠키와 대조한다 — 그 대조가 실제로 동작하는지가 로그인 CSRF 방어의 전부다.
 */
import {
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_MAX_AGE_SEC,
  createOAuthState,
  verifyOAuthState,
} from '@/lib/auth/oauth/state';
import {
  OAUTH_PENDING_COOKIE,
  signPendingSignup,
  verifyPendingSignup,
} from '@/lib/auth/oauth/pending';
import { signToken, verifyToken } from '@/lib/auth/oauth/token';
import type { OAuthProfile } from '@/lib/auth/oauth/provider-types';

const SECRET = 'test-session-secret-0123456789abcdef';
const NOW = 1_760_000_000_000;

describe('쿠키 이름', () => {
  it('세션 쿠키와 겹치지 않는다', () => {
    expect(OAUTH_STATE_COOKIE).toBe('si_oauth_state');
    expect(OAUTH_PENDING_COOKIE).toBe('si_oauth_pending');
  });
});

describe('createOAuthState / verifyOAuthState', () => {
  it('정상 흐름 — state + 같은 nonce 쿠키면 통과하고 next 경로를 돌려준다', () => {
    const { state, nonce } = createOAuthState(SECRET, 'google', '/settings', NOW);
    const r = verifyOAuthState(state, nonce, 'google', SECRET, NOW + 1000);
    expect(r).toEqual({ ok: true, nextPath: '/settings' });
  });

  it('★ nonce 쿠키가 없으면 거부 — 다른 브라우저에서 시작된 흐름', () => {
    const { state } = createOAuthState(SECRET, 'google', '/', NOW);
    expect(verifyOAuthState(state, null, 'google', SECRET, NOW)).toEqual({ ok: false, reason: 'missing' });
  });

  it('★ nonce 가 다르면 거부 — 공격자 state 를 피해자에게 먹이는 로그인 CSRF 차단', () => {
    const a = createOAuthState(SECRET, 'google', '/', NOW);
    const b = createOAuthState(SECRET, 'google', '/', NOW);
    expect(verifyOAuthState(a.state, b.nonce, 'google', SECRET, NOW)).toEqual({
      ok: false, reason: 'nonce_mismatch',
    });
  });

  it('길이가 다른 nonce 도 nonce_mismatch 로 떨어진다 (상수시간 비교 전환 후 동작 보존)', () => {
    const { state, nonce } = createOAuthState(SECRET, 'google', '/', NOW);
    expect(verifyOAuthState(state, `${nonce}extra`, 'google', SECRET, NOW)).toEqual({
      ok: false, reason: 'nonce_mismatch',
    });
    expect(verifyOAuthState(state, nonce.slice(0, -1), 'google', SECRET, NOW)).toEqual({
      ok: false, reason: 'nonce_mismatch',
    });
  });

  it('다른 프로바이더의 state 는 재사용할 수 없다', () => {
    const { state, nonce } = createOAuthState(SECRET, 'google', '/', NOW);
    expect(verifyOAuthState(state, nonce, 'github', SECRET, NOW)).toEqual({
      ok: false, reason: 'provider_mismatch',
    });
  });

  it('서명 키가 다르면 거부', () => {
    const { state, nonce } = createOAuthState(SECRET, 'google', '/', NOW);
    expect(verifyOAuthState(state, nonce, 'google', 'other-secret', NOW)).toEqual({
      ok: false, reason: 'bad_signature',
    });
  });

  it('payload 를 조작하면 서명이 깨진다', () => {
    const { state, nonce } = createOAuthState(SECRET, 'google', '/', NOW);
    const [body, sig] = state.split('.');
    const tampered = `${Buffer.from(JSON.stringify({ n: nonce, p: 'google', r: '/evil', exp: NOW + 9e9 }))
      .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.${sig}`;
    expect(tampered).not.toBe(`${body}.${sig}`);
    expect(verifyOAuthState(tampered, nonce, 'google', SECRET, NOW).ok).toBe(false);
  });

  it('만료되면 거부 (10분)', () => {
    const { state, nonce } = createOAuthState(SECRET, 'google', '/', NOW);
    const justBefore = NOW + OAUTH_STATE_MAX_AGE_SEC * 1000 - 1;
    expect(verifyOAuthState(state, nonce, 'google', SECRET, justBefore).ok).toBe(true);
    expect(verifyOAuthState(state, nonce, 'google', SECRET, NOW + OAUTH_STATE_MAX_AGE_SEC * 1000)).toEqual({
      ok: false, reason: 'expired',
    });
  });

  it('외부 URL 은 next 경로로 통과하지 못한다 (open redirect 방지)', () => {
    for (const evil of ['//evil.com', 'https://evil.com', '/\\evil.com', 'javascript:alert(1)']) {
      const { state, nonce } = createOAuthState(SECRET, 'google', evil, NOW);
      const r = verifyOAuthState(state, nonce, 'google', SECRET, NOW);
      expect(r.ok && r.nextPath).toBe('/');
    }
  });

  it('서명 키가 없으면 통과시키지 않는다 (fail-closed)', () => {
    const { state, nonce } = createOAuthState(SECRET, 'google', '/', NOW);
    expect(verifyOAuthState(state, nonce, 'google', undefined, NOW).ok).toBe(false);
  });
});

describe('signPendingSignup / verifyPendingSignup', () => {
  const profile: OAuthProfile = {
    providerId: 'g-77', email: 'owner@example.com', name: '전주인', avatar: null, emailVerified: true,
  };

  it('왕복이 정확히 보존된다', () => {
    const t = signPendingSignup(SECRET, 'google', profile, '/', NOW);
    const r = verifyPendingSignup(t, SECRET, NOW + 1000);
    expect(r.ok && r.pending).toEqual({
      provider: 'google', providerId: 'g-77', email: 'owner@example.com',
      name: '전주인', emailVerified: true, nextPath: '/',
    });
  });

  it('★ 미검증 프로필은 emailVerified false 로 실린다 (완료 단계가 다시 막을 수 있게)', () => {
    const t = signPendingSignup(SECRET, 'github', { ...profile, emailVerified: false }, '/', NOW);
    const r = verifyPendingSignup(t, SECRET, NOW);
    expect(r.ok && r.pending.emailVerified).toBe(false);
  });

  it('만료(15분) 후 거부', () => {
    const t = signPendingSignup(SECRET, 'google', profile, '/', NOW);
    expect(verifyPendingSignup(t, SECRET, NOW + 15 * 60 * 1000).ok).toBe(false);
  });

  it('★ state 토큰을 대기 토큰으로 재사용할 수 없다 (용도별 서브키 분리)', () => {
    const { state } = createOAuthState(SECRET, 'google', '/', NOW);
    expect(verifyPendingSignup(state, SECRET, NOW)).toEqual({ ok: false, reason: 'bad_signature' });
  });
});

describe('signToken / verifyToken', () => {
  it('용도(purpose)가 다르면 서명이 맞지 않는다', () => {
    const t = signToken(SECRET, 'oauth-state-v1', { exp: NOW + 60_000 });
    expect(verifyToken(t, SECRET, 'oauth-pending-v1', NOW)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyToken(t, SECRET, 'oauth-state-v1', NOW).ok).toBe(true);
  });

  it('형식이 깨진 토큰은 malformed', () => {
    for (const bad of ['', 'nodot', '.abc', 'abc.']) {
      expect(verifyToken(bad, SECRET, 'oauth-state-v1', NOW).ok).toBe(false);
    }
  });

  it('exp 가 없으면 거부한다 (무기한 토큰 금지)', () => {
    const t = signToken(SECRET, 'oauth-state-v1', { exp: undefined as unknown as number });
    expect(verifyToken(t, SECRET, 'oauth-state-v1', NOW)).toEqual({ ok: false, reason: 'malformed' });
  });
});
