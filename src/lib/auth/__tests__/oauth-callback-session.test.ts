/**
 * OAuth 콜백이 **기존 HMAC 세션 쿠키**를 발급하는지 (T-009 B1·B2, 2026-08-08).
 *
 * 워크스페이스 가이드 §B-5 와 `adapters/nextjs.js:109-111` 은 JWT 를 서명해
 * `/oauth/callback?token=...` 으로 리다이렉트하고 프론트가 localStorage 에 넣는다.
 * 이 앱에서 그 방식은 **보안 후퇴**라 채택하지 않았다. 이 테스트는 그 결정이
 * 나중에 조용히 되돌려지는 것을 막는 회귀 방지선이다:
 *
 *   - 응답에 `si_session` HttpOnly 쿠키가 실린다
 *   - 리다이렉트 URL 에는 토큰이 **없다**
 */
import { NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/auth/session';
import { OAUTH_STATE_COOKIE, createOAuthState } from '@/lib/auth/oauth/state';
import { OAUTH_PENDING_COOKIE } from '@/lib/auth/oauth/pending';
import type { OAuthProfile } from '@/lib/auth/oauth/provider-types';

const SECRET = 'test-session-secret-0123456789abcdef';
const BASE = 'https://stock.example.com';

// DB 를 타지 않도록 회원 저장소를 통째로 대체한다.
const findUserByOAuth = jest.fn();
const findUserByEmail = jest.fn();
const linkOAuthToUser = jest.fn();
jest.mock('@/lib/auth/users', () => ({
  findUserByOAuth: (...a: unknown[]) => findUserByOAuth(...a),
  findUserByEmail: (...a: unknown[]) => findUserByEmail(...a),
  linkOAuthToUser: (...a: unknown[]) => linkOAuthToUser(...a),
  maskEmail: (e: string) => e.replace(/(?<=.{2}).*(?=@)/, '***'),
}));

const fetchOAuthProfile = jest.fn();
jest.mock('@/lib/auth/oauth/providers', () => ({
  fetchOAuthProfile: (...a: unknown[]) => fetchOAuthProfile(...a),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { GET } = require('@/app/api/auth/[provider]/callback/route') as {
  GET: (req: NextRequest, ctx: { params: Promise<{ provider: string }> }) => Promise<Response>;
};

const profile: OAuthProfile = {
  providerId: 'g-77', email: 'owner@example.com', name: '전주인', avatar: null, emailVerified: true,
};

function callbackRequest(over: { state?: string; nonce?: string | null; code?: string | null } = {}) {
  const url = new URL(`${BASE}/api/auth/google/callback`);
  if (over.code !== null) url.searchParams.set('code', over.code ?? 'auth-code');
  if (over.state) url.searchParams.set('state', over.state);
  const headers = new Headers({ 'x-forwarded-proto': 'https' });
  if (over.nonce) headers.set('cookie', `${OAUTH_STATE_COOKIE}=${over.nonce}`);
  return new NextRequest(url, { headers });
}

function run(req: NextRequest) {
  return GET(req, { params: Promise.resolve({ provider: 'google' }) });
}

/** Set-Cookie 헤더들에서 특정 쿠키의 값과 속성 문자열을 뽑는다. */
function readCookie(res: Response, name: string): string | null {
  const raw = res.headers.getSetCookie?.() ?? [];
  const hit = raw.find((c) => c.startsWith(`${name}=`));
  return hit ?? null;
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.AUTH_SESSION_SECRET = SECRET;
  process.env.OAUTH_CALLBACK_BASE = BASE;
  process.env.GOOGLE_CLIENT_ID = 'cid';
  process.env.GOOGLE_CLIENT_SECRET = 'csecret';
  delete process.env.SIGNUP_INVITE_CODE;
  fetchOAuthProfile.mockResolvedValue(profile);
  findUserByOAuth.mockResolvedValue(null);
  findUserByEmail.mockResolvedValue(null);
  linkOAuthToUser.mockResolvedValue(true);
});

describe('★ 기존 회원 로그인 — 세션 쿠키 발급 (JWT 리다이렉트 아님)', () => {
  it('si_session HttpOnly 쿠키가 실리고 URL 에는 토큰이 없다', async () => {
    findUserByOAuth.mockResolvedValue({ id: 42, oauthProvider: 'google', oauthId: 'g-77' });
    const { state, nonce } = createOAuthState(SECRET, 'google', '/settings');

    const res = await run(callbackRequest({ state, nonce }));

    expect(res.status).toBe(307);
    const location = res.headers.get('location')!;
    expect(location).toBe(`${BASE}/settings`);

    // 가이드가 지시하는 `?token=` 패턴이 절대 나타나지 않아야 한다
    expect(location).not.toMatch(/token=/);
    expect(location).not.toContain('/oauth/callback');
    expect(new URL(location).search).toBe('');

    const cookie = readCookie(res, SESSION_COOKIE);
    expect(cookie).toBeTruthy();
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=lax');
    expect(cookie).toContain('Secure');
  });

  it('발급된 쿠키는 기존 verifySession 으로 검증되고 sub 이 회원 id 다', async () => {
    findUserByOAuth.mockResolvedValue({ id: 42, oauthProvider: 'google', oauthId: 'g-77' });
    const { state, nonce } = createOAuthState(SECRET, 'google', '/');

    const res = await run(callbackRequest({ state, nonce }));
    const token = decodeURIComponent(readCookie(res, SESSION_COOKIE)!.split(';')[0].split('=')[1]);

    const verified = await verifySession(token, SECRET);
    expect(verified.ok).toBe(true);
    expect(verified.ok && verified.payload.sub).toBe(42);
  });

  it('state nonce 쿠키는 사용 후 제거된다', async () => {
    findUserByOAuth.mockResolvedValue({ id: 42, oauthProvider: 'google', oauthId: 'g-77' });
    const { state, nonce } = createOAuthState(SECRET, 'google', '/');
    const res = await run(callbackRequest({ state, nonce }));
    // NextResponse.cookies.delete 는 값을 비우고 Expires 를 epoch 으로 되돌린다.
    const cleared = readCookie(res, OAUTH_STATE_COOKIE)!;
    expect(cleared).toMatch(/^si_oauth_state=;/);
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/);
  });
});

describe('★ 미검증 이메일 — 세션을 발급하지 않는다', () => {
  it('기존 계정이 있어도 연결하지 않고 로그인 화면으로 되돌린다', async () => {
    fetchOAuthProfile.mockResolvedValue({ ...profile, emailVerified: false });
    findUserByEmail.mockResolvedValue({ id: 5, oauthProvider: null, oauthId: null });
    const { state, nonce } = createOAuthState(SECRET, 'google', '/');

    const res = await run(callbackRequest({ state, nonce }));

    expect(res.headers.get('location')).toContain('oauth_error=email_unverified');
    expect(readCookie(res, SESSION_COOKIE)).toBeNull();
    expect(linkOAuthToUser).not.toHaveBeenCalled();
  });
});

describe('★ 신규 가입 — 콜백은 계정도 세션도 만들지 않는다', () => {
  it('초대코드가 필요하면 대기 쿠키만 심고 초대 화면으로 보낸다', async () => {
    process.env.SIGNUP_INVITE_CODE = 'let-me-in';
    const { state, nonce } = createOAuthState(SECRET, 'google', '/');

    const res = await run(callbackRequest({ state, nonce }));

    expect(res.headers.get('location')).toBe(`${BASE}/oauth/invite`);
    expect(readCookie(res, SESSION_COOKIE)).toBeNull();
    const pending = readCookie(res, OAUTH_PENDING_COOKIE);
    expect(pending).toBeTruthy();
    expect(pending).toContain('HttpOnly');
  });
});

describe('state 검증 실패 시 세션이 나가지 않는다', () => {
  it('nonce 쿠키가 없으면 거부', async () => {
    findUserByOAuth.mockResolvedValue({ id: 42, oauthProvider: 'google', oauthId: 'g-77' });
    const { state } = createOAuthState(SECRET, 'google', '/');
    const res = await run(callbackRequest({ state, nonce: null }));
    expect(res.headers.get('location')).toContain('oauth_error=invalid_state');
    expect(readCookie(res, SESSION_COOKIE)).toBeNull();
  });

  it('다른 흐름의 nonce 는 거부 (로그인 CSRF)', async () => {
    findUserByOAuth.mockResolvedValue({ id: 42, oauthProvider: 'google', oauthId: 'g-77' });
    const { state } = createOAuthState(SECRET, 'google', '/');
    const other = createOAuthState(SECRET, 'google', '/');
    const res = await run(callbackRequest({ state, nonce: other.nonce }));
    expect(res.headers.get('location')).toContain('oauth_error=invalid_state');
    expect(readCookie(res, SESSION_COOKIE)).toBeNull();
  });

  it('code 가 없으면 토큰 교환을 시도조차 하지 않는다', async () => {
    const { state, nonce } = createOAuthState(SECRET, 'google', '/');
    const res = await run(callbackRequest({ state, nonce, code: null }));
    expect(res.headers.get('location')).toContain('oauth_error=failed');
    expect(fetchOAuthProfile).not.toHaveBeenCalled();
  });
});

describe('제공자 오류·취소', () => {
  it('사용자가 취소하면 cancelled 로 안내한다', async () => {
    const url = new URL(`${BASE}/api/auth/google/callback`);
    url.searchParams.set('error', 'access_denied');
    const res = await run(new NextRequest(url));
    expect(res.headers.get('location')).toContain('oauth_error=cancelled');
  });

  it('제공자 원문 오류 메시지는 URL 로 새어나가지 않는다', async () => {
    fetchOAuthProfile.mockRejectedValue(new Error('invalid_client: secret leaked here'));
    const { state, nonce } = createOAuthState(SECRET, 'google', '/');
    const res = await run(callbackRequest({ state, nonce }));
    const location = res.headers.get('location')!;
    expect(location).toContain('oauth_error=failed');
    expect(location).not.toContain('secret');
    expect(location).not.toContain('invalid_client');
  });
});
