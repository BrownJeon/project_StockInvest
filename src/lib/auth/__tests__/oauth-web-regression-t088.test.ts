/**
 * T-088 — **웹 OAuth 응답 불변 고정** (앱 Google 로그인 분기 추가 전 기준값).
 *
 * T-088 은 같은 시작·콜백 라우트에 앱 분기(서명된 state 안의 `pl:'app'`)를 더한다. 설계 ③ "웹 분기(platform 없음)의
 * 코드 경로·응답은 바이트 단위로 불변" 을 시험으로 못 박는다. 아래 `EXPECTED` 는 **T-088 변경 전 코드(base da35af7)** 에서
 * 이 파일의 `snap()` 으로 뽑은 값을 그대로 옮긴 것이다(무작위·시각 값만 자리표시자로 정규화):
 *   - state 쿼리 값 → `<state>` (대신 서명 본문의 **키 목록**을 `stateKeys` 로 고정 — 웹 state 에 새 필드가 끼면 실패)
 *   - 쿠키 값(si_oauth_state nonce·si_session 토큰·si_oauth_pending) → `<v>`, 1970 이 아닌 Expires 날짜 → `<date>`
 * 상태코드·Location·모든 응답 헤더 이름과 값·Set-Cookie 속성·본문은 정규화하지 않는다.
 *
 * 기존 `oauth-callback-session.test.ts` 등은 손대지 않는다 — 이 파일은 그 위에 "응답 전체" 를 더 고정한다.
 */
import { NextRequest } from 'next/server';
import { OAUTH_STATE_COOKIE, createOAuthState } from '@/lib/auth/oauth/state';
import type { OAuthProfile } from '@/lib/auth/oauth/provider-types';

const SECRET = 'test-session-secret-0123456789abcdef';
const BASE = 'https://stock.example.com';

const findUserByOAuth = jest.fn();
const findUserByEmail = jest.fn();
const linkOAuthToUser = jest.fn();
jest.mock('@/lib/auth/users', () => ({
  findUserByOAuth: (...a: unknown[]) => findUserByOAuth(...a),
  findUserByEmail: (...a: unknown[]) => findUserByEmail(...a),
  linkOAuthToUser: (...a: unknown[]) => linkOAuthToUser(...a),
  findUserById: jest.fn(),
  maskEmail: (e: string) => e.replace(/(?<=.{2}).*(?=@)/, '***'),
}));

const fetchOAuthProfile = jest.fn();
jest.mock('@/lib/auth/oauth/providers', () => {
  const actual = jest.requireActual('@/lib/auth/oauth/providers');
  return { ...actual, fetchOAuthProfile: (...a: unknown[]) => fetchOAuthProfile(...a) };
});

// 앱 코드 발급이 웹 경로에서 불리면 안 된다 — 불리면 시험이 실패하도록 던지는 가짜를 넣는다(모듈이 아직 없던 base 에서도 무해).
jest.mock('@/lib/auth/oauth/app-code', () => ({
  issueAppAuthCode: () => { throw new Error('웹 경로에서 앱 코드 발급 금지'); },
  consumeAppAuthCode: () => { throw new Error('웹 경로에서 앱 코드 소각 금지'); },
  isAppAuthCodeNotMigrated: () => false,
}), { virtual: true });

/* eslint-disable @typescript-eslint/no-var-requires */
const { GET: START } = require('@/app/api/auth/[provider]/route') as {
  GET: (req: NextRequest, ctx: { params: Promise<{ provider: string }> }) => Promise<Response>;
};
const { GET: CALLBACK } = require('@/app/api/auth/[provider]/callback/route') as {
  GET: (req: NextRequest, ctx: { params: Promise<{ provider: string }> }) => Promise<Response>;
};
/* eslint-enable @typescript-eslint/no-var-requires */

const profile: OAuthProfile = {
  providerId: 'g-77', email: 'owner@example.com', name: '전주인', avatar: null, emailVerified: true,
};

interface Snap {
  status: number;
  location: string | null;
  stateKeys: string[] | null;
  headers: Array<[string, string]>;
  cookies: string[];
  body: string;
}

function decodeStateKeys(location: string | null): string[] | null {
  if (!location) return null;
  let u: URL;
  try { u = new URL(location); } catch { return null; }
  const st = u.searchParams.get('state');
  if (!st) return null;
  const body = st.split('.')[0];
  const json = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  return Object.keys(json);
}

function normCookie(c: string): string {
  const eq = c.indexOf('=');
  const semi = c.indexOf(';');
  const name = c.slice(0, eq);
  const value = c.slice(eq + 1, semi === -1 ? undefined : semi);
  const rest = semi === -1 ? '' : c.slice(semi);
  const v = value === '' ? '' : '<v>';
  return `${name}=${v}${rest.replace(/Expires=(?!Thu, 01 Jan 1970)[^;]+/g, 'Expires=<date>')}`;
}

async function snap(res: Response): Promise<Snap> {
  const location = res.headers.get('location');
  const headers: Array<[string, string]> = [];
  res.headers.forEach((v, k) => {
    // x-middleware-set-cookie 는 Next 가 Set-Cookie 를 그대로 복제해 두는 내부 헤더다 — 쿠키는 아래 cookies 로 정규화해 비교한다.
    if (k === 'set-cookie' || k === 'x-middleware-set-cookie') return;
    headers.push([k, k === 'location' ? v.replace(/([?&]state=)[^&]+/, '$1<state>') : v]);
  });
  headers.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const cookies = (res.headers.getSetCookie?.() ?? []).map(normCookie).sort();
  return {
    status: res.status,
    location: location ? location.replace(/([?&]state=)[^&]+/, '$1<state>') : null,
    stateKeys: decodeStateKeys(location),
    headers,
    cookies,
    body: await res.text(),
  };
}

function startReq(provider: string, qs: string, proto = 'https'): [NextRequest, { params: Promise<{ provider: string }> }] {
  const req = new NextRequest(`${BASE}/api/auth/${provider}${qs}`, { headers: new Headers({ 'x-forwarded-proto': proto }) });
  return [req, { params: Promise.resolve({ provider }) }];
}

function cbReq(
  provider: string,
  o: { state?: string; nonce?: string | null; code?: string | null; extra?: Record<string, string> } = {},
): [NextRequest, { params: Promise<{ provider: string }> }] {
  const url = new URL(`${BASE}/api/auth/${provider}/callback`);
  if (o.code !== null) url.searchParams.set('code', o.code ?? 'auth-code');
  if (o.state) url.searchParams.set('state', o.state);
  for (const [k, v] of Object.entries(o.extra ?? {})) url.searchParams.set(k, v);
  const headers = new Headers({ 'x-forwarded-proto': 'https' });
  if (o.nonce) headers.set('cookie', `${OAUTH_STATE_COOKIE}=${o.nonce}`);
  return [new NextRequest(url, { headers }), { params: Promise.resolve({ provider }) }];
}

function webState(next = '/settings', provider: 'google' | 'github' = 'google') {
  return createOAuthState(SECRET, provider, next);
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.AUTH_SESSION_SECRET = SECRET;
  process.env.OAUTH_CALLBACK_BASE = BASE;
  process.env.GOOGLE_CLIENT_ID = 'cid';
  process.env.GOOGLE_CLIENT_SECRET = 'csecret';
  process.env.GITHUB_CLIENT_ID = 'ghid';
  process.env.GITHUB_CLIENT_SECRET = 'ghsecret';
  delete process.env.SIGNUP_INVITE_CODE;
  fetchOAuthProfile.mockResolvedValue(profile);
  findUserByOAuth.mockResolvedValue(null);
  findUserByEmail.mockResolvedValue(null);
  linkOAuthToUser.mockResolvedValue(true);
});

// ── 기준값: base da35af7 에서 snap() 으로 뽑은 값 ─────────────────────────────
const SI_STATE_SET = 'si_oauth_state=<v>; Path=/; Expires=<date>; Max-Age=600; Secure; HttpOnly; SameSite=lax';
const SI_STATE_CLEAR = 'si_oauth_state=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
const SI_SESSION_SET = 'si_session=<v>; Path=/; Expires=<date>; Max-Age=2592000; Secure; HttpOnly; SameSite=lax';
const SI_PENDING_SET = 'si_oauth_pending=<v>; Path=/; Expires=<date>; Max-Age=900; Secure; HttpOnly; SameSite=lax';

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=cid&redirect_uri=https%3A%2F%2Fstock.example.com%2Fapi%2Fauth%2Fgoogle%2Fcallback&response_type=code&scope=openid+email+profile&state=<state>&access_type=online&prompt=select_account';
const GITHUB_AUTH = 'https://github.com/login/oauth/authorize?client_id=ghid&redirect_uri=https%3A%2F%2Fstock.example.com%2Fapi%2Fauth%2Fgithub%2Fcallback&response_type=code&scope=user%3Aemail&state=<state>';

function redirect(location: string, cookies: string[], stateKeys: string[] | null = null): Snap {
  return { status: 307, location, stateKeys, headers: [['location', location]], cookies: [...cookies].sort(), body: '' };
}
function json(status: number, body: string): Snap {
  return { status, location: null, stateKeys: null, headers: [['content-type', 'application/json']], cookies: [], body };
}
const loginErr = (code: string, provider = 'google') => redirect(`${BASE}/login?oauth_error=${code}&provider=${provider}`, [SI_STATE_CLEAR]);

describe('시작 라우트 — platform 없는 웹 요청의 응답 전체가 변경 전과 같다', () => {
  test.each<[string, string, string, Snap]>([
    ['google next=/settings', 'google', '?next=%2Fsettings', redirect(GOOGLE_AUTH, [SI_STATE_SET], ['n', 'p', 'r', 'exp'])],
    ['google next 없음', 'google', '', redirect(GOOGLE_AUTH, [SI_STATE_SET], ['n', 'p', 'r', 'exp'])],
    ['github next=/x', 'github', '?next=%2Fx', redirect(GITHUB_AUTH, [SI_STATE_SET], ['n', 'p', 'r', 'exp'])],
    ['google next=//evil.com', 'google', '?next=%2F%2Fevil.com', redirect(GOOGLE_AUTH, [SI_STATE_SET], ['n', 'p', 'r', 'exp'])],
    // platform 이 'app' 이 아닌 값·challenge 만 있는 요청은 웹으로 수렴한다(앱 분기는 정확히 platform=app 일 때만).
    ['google platform=web&challenge=…', 'google', '?next=%2Fsettings&platform=web&challenge=' + 'A'.repeat(43), redirect(GOOGLE_AUTH, [SI_STATE_SET], ['n', 'p', 'r', 'exp'])],
    ['google platform=APP(대문자)', 'google', '?platform=APP&challenge=' + 'A'.repeat(43), redirect(GOOGLE_AUTH, [SI_STATE_SET], ['n', 'p', 'r', 'exp'])],
    ['unknown provider', 'naver', '', json(404, '{"ok":false,"error":"unknown_provider"}')],
  ])('%s', async (_l, provider, qs, want) => {
    const [req, ctx] = startReq(provider, qs);
    expect(await snap(await START(req, ctx))).toEqual(want);
  });

  test('state 의 r 은 sanitize 된 next 다(웹 state 형식 불변)', async () => {
    const [req, ctx] = startReq('google', '?next=%2Fsettings%3Ftab%3D1');
    const loc = (await START(req, ctx)).headers.get('location')!;
    const st = new URL(loc).searchParams.get('state')!;
    const payload = JSON.parse(Buffer.from(st.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    expect(payload.p).toBe('google');
    expect(payload.r).toBe('/settings?tab=1');
    expect(Object.keys(payload)).toEqual(['n', 'p', 'r', 'exp']);
  });

  test('세션 서명 키 없음 → 503 본문 그대로', async () => {
    delete process.env.AUTH_SESSION_SECRET;
    const [req, ctx] = startReq('google', '');
    expect(await snap(await START(req, ctx))).toEqual(json(503, '{"ok":false,"error":"auth_not_configured","detail":"AUTH_SESSION_SECRET 설정 필요"}'));
  });

  test('자격증명 없음 → 503 본문 그대로', async () => {
    delete process.env.GOOGLE_CLIENT_SECRET;
    const [req, ctx] = startReq('google', '');
    expect(await snap(await START(req, ctx))).toEqual(json(503, '{"ok":false,"error":"provider_not_configured","detail":"google OAuth 가 설정되지 않았습니다"}'));
  });

  test('http 요청이면 state 쿠키에 Secure 가 없다(변경 전과 같음)', async () => {
    const [req, ctx] = startReq('google', '', 'http');
    const s = await snap(await START(req, ctx));
    expect(s.cookies).toEqual(['si_oauth_state=<v>; Path=/; Expires=<date>; Max-Age=600; HttpOnly; SameSite=lax']);
  });
});

describe('콜백 — 웹 state(platform 없음)의 응답 전체가 변경 전과 같다', () => {
  test('기존 회원(소셜 신원 일치) → 세션 쿠키 + next 로 307', async () => {
    findUserByOAuth.mockResolvedValue({ id: 42, oauthProvider: 'google', oauthId: 'g-77' });
    const { state, nonce } = webState('/settings');
    const [req, ctx] = cbReq('google', { state, nonce });
    expect(await snap(await CALLBACK(req, ctx))).toEqual(redirect(`${BASE}/settings`, [SI_STATE_CLEAR, SI_SESSION_SET]));
  });

  test('콜백 쿼리에 platform=app 을 붙여도(위조) 웹 응답 그대로 — 앱 분기는 서명된 state 만 본다', async () => {
    findUserByOAuth.mockResolvedValue({ id: 42, oauthProvider: 'google', oauthId: 'g-77' });
    const { state, nonce } = webState('/settings');
    const [req, ctx] = cbReq('google', { state, nonce, extra: { platform: 'app', challenge: 'A'.repeat(43) } });
    expect(await snap(await CALLBACK(req, ctx))).toEqual(redirect(`${BASE}/settings`, [SI_STATE_CLEAR, SI_SESSION_SET]));
  });

  test('검증된 이메일로 기존 계정 연결 → 세션', async () => {
    findUserByEmail.mockResolvedValue({ id: 7, oauthProvider: null, oauthId: null });
    const { state, nonce } = webState('/');
    const [req, ctx] = cbReq('google', { state, nonce });
    expect(await snap(await CALLBACK(req, ctx))).toEqual(redirect(`${BASE}/`, [SI_STATE_CLEAR, SI_SESSION_SET]));
    expect(linkOAuthToUser).toHaveBeenCalledWith(7, 'google', 'g-77');
  });

  test('다른 소셜 신원에 묶인 기존 계정 → 링크 유지 로그인', async () => {
    findUserByEmail.mockResolvedValue({ id: 8, oauthProvider: 'github', oauthId: 'gh-1' });
    const { state, nonce } = webState('/order');
    const [req, ctx] = cbReq('google', { state, nonce });
    expect(await snap(await CALLBACK(req, ctx))).toEqual(redirect(`${BASE}/order`, [SI_STATE_CLEAR, SI_SESSION_SET]));
    expect(linkOAuthToUser).not.toHaveBeenCalled();
  });

  test('미검증 이메일 → email_unverified', async () => {
    fetchOAuthProfile.mockResolvedValue({ ...profile, emailVerified: false });
    findUserByEmail.mockResolvedValue({ id: 5, oauthProvider: null, oauthId: null });
    const { state, nonce } = webState('/');
    const [req, ctx] = cbReq('google', { state, nonce });
    expect(await snap(await CALLBACK(req, ctx))).toEqual(loginErr('email_unverified'));
  });

  test('신규 + 초대코드 필요 → /oauth/invite + 대기 쿠키', async () => {
    process.env.SIGNUP_INVITE_CODE = 'let-me-in';
    const { state, nonce } = webState('/');
    const [req, ctx] = cbReq('google', { state, nonce });
    expect(await snap(await CALLBACK(req, ctx))).toEqual(redirect(`${BASE}/oauth/invite`, [SI_STATE_CLEAR, SI_PENDING_SET]));
  });

  test('신규 + 가입 개방 → /oauth/invite + 대기 쿠키', async () => {
    const { state, nonce } = webState('/');
    const [req, ctx] = cbReq('google', { state, nonce });
    expect(await snap(await CALLBACK(req, ctx))).toEqual(redirect(`${BASE}/oauth/invite`, [SI_STATE_CLEAR, SI_PENDING_SET]));
  });

  test('제공자 취소(state 있음) → cancelled', async () => {
    const { state, nonce } = webState('/');
    const [req, ctx] = cbReq('google', { state, nonce, code: null, extra: { error: 'access_denied' } });
    expect(await snap(await CALLBACK(req, ctx))).toEqual(loginErr('cancelled'));
  });

  test('제공자 취소(state 없음) → cancelled', async () => {
    const [req, ctx] = cbReq('google', { code: null, extra: { error: 'access_denied' } });
    expect(await snap(await CALLBACK(req, ctx))).toEqual(loginErr('cancelled'));
  });

  test('제공자 기타 오류 → failed', async () => {
    const [req, ctx] = cbReq('github', { code: null, extra: { error: 'server_error' } });
    expect(await snap(await CALLBACK(req, ctx))).toEqual(loginErr('failed', 'github'));
  });

  test('code 없음 → failed', async () => {
    const { state, nonce } = webState('/');
    const [req, ctx] = cbReq('google', { state, nonce, code: null });
    expect(await snap(await CALLBACK(req, ctx))).toEqual(loginErr('failed'));
  });

  test('nonce 쿠키 없음 → invalid_state', async () => {
    const { state } = webState('/');
    const [req, ctx] = cbReq('google', { state, nonce: null });
    expect(await snap(await CALLBACK(req, ctx))).toEqual(loginErr('invalid_state'));
  });

  test('자격증명 없음 → not_configured', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const { state, nonce } = webState('/');
    const [req, ctx] = cbReq('google', { state, nonce });
    expect(await snap(await CALLBACK(req, ctx))).toEqual(loginErr('not_configured'));
  });

  test('세션 서명 키 없음 → not_configured', async () => {
    const { state, nonce } = webState('/');
    delete process.env.AUTH_SESSION_SECRET;
    const [req, ctx] = cbReq('google', { state, nonce });
    expect(await snap(await CALLBACK(req, ctx))).toEqual(loginErr('not_configured'));
  });

  test('프로필 조회 예외 → failed', async () => {
    fetchOAuthProfile.mockRejectedValue(new Error('boom'));
    const { state, nonce } = webState('/');
    const [req, ctx] = cbReq('google', { state, nonce });
    expect(await snap(await CALLBACK(req, ctx))).toEqual(loginErr('failed'));
  });

  test('unknown provider → 404 본문 그대로', async () => {
    const [req, ctx] = cbReq('naver', {});
    expect(await snap(await CALLBACK(req, ctx))).toEqual(json(404, '{"ok":false,"error":"unknown_provider"}'));
  });
});
