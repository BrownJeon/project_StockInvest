/**
 * T-088 — 앱 Google 로그인 라우트 전 구간: 시작(platform=app) → 콜백(앱 분기) → 교환(POST /api/auth/app-exchange).
 *
 * 실제 라우트·state·app-code 모듈을 쓰고, DB 만 `getPool()` 가짜로 바꾼다 — 가짜 풀은 app-code 가 내는 4개 문장만 알아듣고
 * (모르는 문장은 던진다) DB 시계(`clock.now`)로 TTL·조건부 소각을 흉내 낸다. 실제 MariaDB 의미는 t088-disposable-mariadb.test.ts.
 */
import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/auth/session';
import { OAUTH_STATE_COOKIE, createAppOAuthState, createOAuthState, verifyOAuthState } from '@/lib/auth/oauth/state';
import { signToken } from '@/lib/auth/oauth/token';
import { APP_AUTH_CODE_SQL, bindAppAuthCode } from '@/lib/auth/oauth/app-code';
import { pkceChallengeOf } from '@/lib/auth/oauth/pkce';
import { APP_EXCHANGE_LIMIT_PER_MIN, appExchangeLimiter } from '@/lib/auth/oauth/app-exchange';
import type { OAuthProfile } from '@/lib/auth/oauth/provider-types';

const SECRET = 'test-session-secret-0123456789abcdef';
const BASE = 'https://stock.example.com';

// ── 가짜 DB(app_auth_code 만) ────────────────────────────────────────────────
const db = {
  clock: { now: 1_800_000_000_000 },
  rows: new Map<string, { userId: number; expiresAt: number; usedAt: number | null }>(),
  missingTable: false,
  calls: [] as string[],
};
const fakePool = {
  async query(sql: string, values: unknown[] = []) {
    db.calls.push(sql);
    if (db.missingTable) throw Object.assign(new Error("Table 't.app_auth_code' doesn't exist"), { code: 'ER_NO_SUCH_TABLE', errno: 1146, sqlMessage: "Table 't.app_auth_code' doesn't exist" });
    if (sql === APP_AUTH_CODE_SQL.insert) {
      const [code, userId, ttl] = values as [string, number, number];
      db.rows.set(code, { userId, expiresAt: db.clock.now + ttl * 1000, usedAt: null });
      return [{ affectedRows: 1 }, undefined];
    }
    if (sql === APP_AUTH_CODE_SQL.burn) {
      const r = db.rows.get(values[0] as string);
      if (!r || r.usedAt !== null || !(r.expiresAt > db.clock.now)) return [{ affectedRows: 0 }, undefined];
      r.usedAt = db.clock.now;
      return [{ affectedRows: 1 }, undefined];
    }
    if (sql === APP_AUTH_CODE_SQL.userOf) {
      const r = db.rows.get(values[0] as string);
      return [r ? [{ user_id: r.userId }] : [], []];
    }
    if (sql === APP_AUTH_CODE_SQL.prune) return [{ affectedRows: 0 }, undefined];
    throw new Error(`가짜 풀이 모르는 문장: ${sql}`);
  },
};
jest.mock('@/lib/db', () => ({ getPool: () => fakePool }));

const findUserByOAuth = jest.fn();
const findUserByEmail = jest.fn();
const linkOAuthToUser = jest.fn();
const findUserById = jest.fn();
jest.mock('@/lib/auth/users', () => ({
  findUserByOAuth: (...a: unknown[]) => findUserByOAuth(...a),
  findUserByEmail: (...a: unknown[]) => findUserByEmail(...a),
  linkOAuthToUser: (...a: unknown[]) => linkOAuthToUser(...a),
  findUserById: (...a: unknown[]) => findUserById(...a),
  maskEmail: (e: string) => e.replace(/(?<=.{2}).*(?=@)/, '***'),
}));

const fetchOAuthProfile = jest.fn();
jest.mock('@/lib/auth/oauth/providers', () => {
  const actual = jest.requireActual('@/lib/auth/oauth/providers');
  return { ...actual, fetchOAuthProfile: (...a: unknown[]) => fetchOAuthProfile(...a) };
});

/* eslint-disable @typescript-eslint/no-var-requires */
type Ctx = { params: Promise<{ provider: string }> };
const { GET: START } = require('@/app/api/auth/[provider]/route') as { GET: (r: NextRequest, c: Ctx) => Promise<Response> };
const { GET: CALLBACK } = require('@/app/api/auth/[provider]/callback/route') as { GET: (r: NextRequest, c: Ctx) => Promise<Response> };
const EXCHANGE = require('@/app/api/auth/app-exchange/route') as { POST: (r: NextRequest) => Promise<Response>; GET: () => Response };
/* eslint-enable @typescript-eslint/no-var-requires */

const profile: OAuthProfile = { providerId: 'g-77', email: 'owner@example.com', name: '전주인', avatar: null, emailVerified: true };

function pkce(seed: string) {
  const verifier = createHash('sha256').update(seed).digest('base64url');
  return { verifier, challenge: pkceChallengeOf(verifier) };
}
const ctx = (provider: string): Ctx => ({ params: Promise.resolve({ provider }) });

function startReq(provider: string, params: Record<string, string>) {
  const u = new URL(`${BASE}/api/auth/${provider}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return new NextRequest(u, { headers: new Headers({ 'x-forwarded-proto': 'https' }) });
}
function cbReq(provider: string, o: { state?: string; nonce?: string | null; code?: string | null; extra?: Record<string, string> }) {
  const url = new URL(`${BASE}/api/auth/${provider}/callback`);
  if (o.code !== null) url.searchParams.set('code', o.code ?? 'auth-code');
  if (o.state) url.searchParams.set('state', o.state);
  for (const [k, v] of Object.entries(o.extra ?? {})) url.searchParams.set(k, v);
  const headers = new Headers({ 'x-forwarded-proto': 'https' });
  if (o.nonce) headers.set('cookie', `${OAUTH_STATE_COOKIE}=${o.nonce}`);
  return new NextRequest(url, { headers });
}
let ipSeq = 0;
/** 요청마다 다른 IP(요청 제한 시험만 IP 를 고정해 넘긴다). */
function exReq(body: unknown, h: Record<string, string | null> = {}, raw?: string) {
  ipSeq += 1;
  const headers = new Headers({ 'content-type': 'application/json', origin: BASE, 'sec-fetch-site': 'same-origin', 'x-forwarded-proto': 'https', 'x-real-ip': `10.1.${ipSeq >> 8}.${ipSeq & 255}` });
  for (const [k, v] of Object.entries(h)) {
    if (v === null) headers.delete(k);
    else headers.set(k, v);
  }
  return new NextRequest(`${BASE}/api/auth/app-exchange`, { method: 'POST', headers, body: raw ?? JSON.stringify(body) });
}
function setCookies(res: Response): string[] {
  return res.headers.getSetCookie?.() ?? [];
}

beforeEach(() => {
  jest.clearAllMocks();
  db.rows.clear();
  db.calls.length = 0;
  db.missingTable = false;
  appExchangeLimiter.reset();
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
  findUserById.mockImplementation(async (id: number) => ({ id, email: 'owner@example.com' }));
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

/** 시작 → 콜백(기존 회원) 까지 돌려 딥링크의 code_r 을 얻는다. */
async function loginToCode(seed = 'flow', userId = 42): Promise<{ codeR: string; verifier: string; challenge: string }> {
  findUserByOAuth.mockResolvedValue({ id: userId, oauthProvider: 'google', oauthId: 'g-77' });
  const { verifier, challenge } = pkce(seed);
  const start = await START(startReq('google', { platform: 'app', challenge, next: '/settings' }), ctx('google'));
  const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
  const nonce = setCookies(start).find((c) => c.startsWith(`${OAUTH_STATE_COOKIE}=`))!.split(';')[0].split('=')[1];
  const cb = await CALLBACK(cbReq('google', { state, nonce }), ctx('google'));
  const loc = cb.headers.get('location')!;
  const codeR = /^stockinvest:\/\/auth\/callback\?code=([0-9a-f]{64})$/.exec(loc)![1];
  return { codeR, verifier, challenge };
}

// ── state ──────────────────────────────────────────────────────────────────
describe('state — 앱 표지는 서명 안에만', () => {
  test('앱 state 는 pl·ch 를 싣고 검증 결과에 app.challenge 가 나온다', () => {
    const { challenge } = pkce('s');
    const { state, nonce } = createAppOAuthState(SECRET, 'google', '/x', challenge);
    const payload = JSON.parse(Buffer.from(state.split('.')[0], 'base64url').toString('utf8'));
    expect(Object.keys(payload)).toEqual(['n', 'p', 'r', 'exp', 'pl', 'ch']);
    expect(verifyOAuthState(state, nonce, 'google', SECRET)).toEqual({ ok: true, nextPath: '/x', app: { challenge } });
  });

  test('웹 state 결과에는 app 키가 없다', () => {
    const { state, nonce } = createOAuthState(SECRET, 'google', '/x');
    const r = verifyOAuthState(state, nonce, 'google', SECRET);
    expect(r).toEqual({ ok: true, nextPath: '/x' });
    expect(Object.prototype.hasOwnProperty.call(r, 'app')).toBe(false);
  });

  test('웹 state 본문에 pl:"app" 을 끼워 넣으면(재서명 없이) 서명 검증 실패', () => {
    const { state, nonce } = createOAuthState(SECRET, 'google', '/x');
    const [body, sig] = state.split('.');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    const forged = Buffer.from(JSON.stringify({ ...payload, pl: 'app', ch: 'A'.repeat(43) })).toString('base64url');
    expect(verifyOAuthState(`${forged}.${sig}`, nonce, 'google', SECRET)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  test('서명은 맞아도 모양이 어긋난 앱 표지는 malformed(웹으로 낮춰 받지 않는다)', () => {
    const exp = Date.now() + 60_000;
    const mk = (extra: Record<string, unknown>) => signToken(SECRET, 'oauth-state-v1', { n: 'nn', p: 'google', r: '/', exp, ...extra });
    expect(verifyOAuthState(mk({ pl: 'web', ch: 'A'.repeat(43) }), 'nn', 'google', SECRET)).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyOAuthState(mk({ pl: 'app' }), 'nn', 'google', SECRET)).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyOAuthState(mk({ pl: 'app', ch: 'short' }), 'nn', 'google', SECRET)).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyOAuthState(mk({ ch: 'A'.repeat(43) }), 'nn', 'google', SECRET)).toEqual({ ok: false, reason: 'malformed' });
  });

  test('createAppOAuthState 는 challenge 형식이 틀리면 던진다', () => {
    expect(() => createAppOAuthState(SECRET, 'google', '/', 'nope')).toThrow();
  });
});

// ── 시작 라우트 ───────────────────────────────────────────────────────────────
describe('시작 — platform=app', () => {
  test('Google + 올바른 challenge → 인가 주소로 307, state 에 앱 표지, 웹과 같은 state 쿠키 속성', async () => {
    const { challenge } = pkce('start');
    const res = await START(startReq('google', { platform: 'app', challenge, next: '/settings' }), ctx('google'));
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get('location')!);
    expect(loc.origin + loc.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    const payload = JSON.parse(Buffer.from(loc.searchParams.get('state')!.split('.')[0], 'base64url').toString('utf8'));
    expect(payload).toMatchObject({ p: 'google', r: '/settings', pl: 'app', ch: challenge });
    // challenge 는 state(서명) 안에만 — 인가 주소의 다른 파라미터로 따로 새지 않는다
    expect([...loc.searchParams.keys()].sort()).toEqual(['access_type', 'client_id', 'prompt', 'redirect_uri', 'response_type', 'scope', 'state']);
    const cookie = setCookies(res).find((c) => c.startsWith(`${OAUTH_STATE_COOKIE}=`))!;
    expect(cookie.replace(/=[0-9a-f]{32};/, '=<v>;').replace(/Expires=[^;]+/, 'Expires=<d>')).toBe('si_oauth_state=<v>; Path=/; Expires=<d>; Max-Age=600; Secure; HttpOnly; SameSite=lax');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  test.each<[string, string, Record<string, string>, string]>([
    ['challenge 없음', 'google', { platform: 'app' }, 'app_login_invalid'],
    ['challenge 42자', 'google', { platform: 'app', challenge: 'A'.repeat(42) }, 'app_login_invalid'],
    ['challenge 에 =', 'google', { platform: 'app', challenge: 'A'.repeat(42) + '=' }, 'app_login_invalid'],
    ['GitHub 은 앱에서 거부', 'github', { platform: 'app', challenge: 'A'.repeat(43) }, 'app_login_invalid'],
  ])('%s → 앱 딥링크 오류', async (_l, provider, params, err) => {
    const res = await START(startReq(provider, params), ctx(provider));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`stockinvest://auth/callback?error=${err}`);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(setCookies(res).some((c) => c.startsWith(`${OAUTH_STATE_COOKIE}=`) && !c.startsWith(`${OAUTH_STATE_COOKIE}=;`))).toBe(false);
  });

  test('서버 OAuth 미설정 → not_configured 딥링크', async () => {
    delete process.env.GOOGLE_CLIENT_SECRET;
    const res = await START(startReq('google', { platform: 'app', challenge: 'A'.repeat(43) }), ctx('google'));
    expect(res.headers.get('location')).toBe('stockinvest://auth/callback?error=not_configured');
    delete process.env.AUTH_SESSION_SECRET;
    process.env.GOOGLE_CLIENT_SECRET = 'csecret';
    const res2 = await START(startReq('google', { platform: 'app', challenge: 'A'.repeat(43) }), ctx('google'));
    expect(res2.headers.get('location')).toBe('stockinvest://auth/callback?error=not_configured');
  });

  test('unknown provider 는 앱이어도 404(목록 검사가 먼저)', async () => {
    const res = await START(startReq('naver', { platform: 'app', challenge: 'A'.repeat(43) }), ctx('naver'));
    expect(res.status).toBe(404);
  });
});

// ── 콜백 ──────────────────────────────────────────────────────────────────────
describe('콜백 — 앱 state', () => {
  async function appCallback(o: { extra?: Record<string, string>; code?: string | null } = {}) {
    const { challenge } = pkce('cb');
    const { state, nonce } = createAppOAuthState(SECRET, 'google', '/settings', challenge);
    return { res: await CALLBACK(cbReq('google', { state, nonce, ...o }), ctx('google')), challenge };
  }

  test('기존 회원 → 세션 쿠키 없이 stockinvest://auth/callback?code=<64hex> 302, DB 에는 결속값만', async () => {
    findUserByOAuth.mockResolvedValue({ id: 42, oauthProvider: 'google', oauthId: 'g-77' });
    const { res, challenge } = await appCallback();
    expect(res.status).toBe(302);
    const loc = res.headers.get('location')!;
    const m = /^stockinvest:\/\/auth\/callback\?code=([0-9a-f]{64})$/.exec(loc);
    expect(m).not.toBeNull();
    expect(setCookies(res).some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(false);
    expect(setCookies(res).find((c) => c.startsWith(`${OAUTH_STATE_COOKIE}=`))).toMatch(/^si_oauth_state=;/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect([...db.rows.keys()]).toEqual([bindAppAuthCode(m![1], challenge)]);
    expect(db.rows.get(bindAppAuthCode(m![1], challenge))!.userId).toBe(42);
    // 코드 값이 서버 로그에 남지 않는다
    const logged = [...(console.log as jest.Mock).mock.calls, ...(console.warn as jest.Mock).mock.calls].flat().join(' ');
    expect(logged).not.toContain(m![1]);
  });

  test('검증된 이메일로 기존 계정 연결(link_and_login) → 연결 후 코드', async () => {
    findUserByEmail.mockResolvedValue({ id: 7, oauthProvider: null, oauthId: null });
    const { res } = await appCallback();
    expect(res.headers.get('location')).toMatch(/^stockinvest:\/\/auth\/callback\?code=[0-9a-f]{64}$/);
    expect(linkOAuthToUser).toHaveBeenCalledWith(7, 'google', 'g-77');
  });

  test('다른 소셜에 묶인 기존 계정 → 링크 유지하고 코드', async () => {
    findUserByEmail.mockResolvedValue({ id: 8, oauthProvider: 'github', oauthId: 'gh' });
    const { res } = await appCallback();
    expect(res.headers.get('location')).toMatch(/\?code=[0-9a-f]{64}$/);
    expect(linkOAuthToUser).not.toHaveBeenCalled();
  });

  test.each<[string, () => void, string]>([
    ['신규(초대 필요) → signup_requires_web, 대기 쿠키 없음', () => { process.env.SIGNUP_INVITE_CODE = 'x'; }, 'signup_requires_web'],
    ['신규(가입 개방) → signup_requires_web', () => {}, 'signup_requires_web'],
    ['미검증 이메일 → email_unverified', () => { fetchOAuthProfile.mockResolvedValue({ ...profile, emailVerified: false }); findUserByEmail.mockResolvedValue({ id: 5, oauthProvider: null, oauthId: null }); }, 'email_unverified'],
    ['프로필 조회 실패 → failed', () => { fetchOAuthProfile.mockRejectedValue(new Error('invalid_client secret')); }, 'failed'],
  ])('%s', async (_l, setup, err) => {
    setup();
    const { res } = await appCallback();
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`stockinvest://auth/callback?error=${err}`);
    expect(setCookies(res).every((c) => !c.startsWith('si_session=') && !c.startsWith('si_oauth_pending='))).toBe(true);
    expect(db.rows.size).toBe(0);
    expect(linkOAuthToUser).not.toHaveBeenCalled();
  });

  test('제공자 취소 → cancelled, 기타 오류 → failed, code 없음 → failed', async () => {
    expect((await appCallback({ code: null, extra: { error: 'access_denied' } })).res.headers.get('location')).toBe('stockinvest://auth/callback?error=cancelled');
    expect((await appCallback({ code: null, extra: { error: 'server_error' } })).res.headers.get('location')).toBe('stockinvest://auth/callback?error=failed');
    expect((await appCallback({ code: null })).res.headers.get('location')).toBe('stockinvest://auth/callback?error=failed');
  });

  test('테이블 미적용 → not_configured (웹 로그인은 영향 없음)', async () => {
    findUserByOAuth.mockResolvedValue({ id: 42, oauthProvider: 'google', oauthId: 'g-77' });
    db.missingTable = true;
    const { res } = await appCallback();
    expect(res.headers.get('location')).toBe('stockinvest://auth/callback?error=not_configured');
    // 같은 상태에서 웹 콜백은 세션을 그대로 발급한다
    const { state, nonce } = createOAuthState(SECRET, 'google', '/');
    const web = await CALLBACK(cbReq('google', { state, nonce }), ctx('google'));
    expect(web.status).toBe(307);
    expect(setCookies(web).some((c) => c.startsWith('si_session=v1.'))).toBe(true);
  });

  test('앱 state 라도 nonce 쿠키가 없으면(다른 브라우저) 앱 분기로 가지 않고 웹 invalid_state', async () => {
    findUserByOAuth.mockResolvedValue({ id: 42, oauthProvider: 'google', oauthId: 'g-77' });
    const { state } = createAppOAuthState(SECRET, 'google', '/', pkce('x').challenge);
    const res = await CALLBACK(cbReq('google', { state, nonce: null }), ctx('google'));
    expect(res.headers.get('location')).toBe(`${BASE}/login?oauth_error=invalid_state&provider=google`);
    expect(db.rows.size).toBe(0);
  });

  test('웹 state + 쿼리 platform=app 위조 → 코드 발급 없음, 웹 세션 응답', async () => {
    findUserByOAuth.mockResolvedValue({ id: 42, oauthProvider: 'google', oauthId: 'g-77' });
    const { state, nonce } = createOAuthState(SECRET, 'google', '/');
    const res = await CALLBACK(cbReq('google', { state, nonce, extra: { platform: 'app', challenge: pkce('y').challenge } }), ctx('google'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(`${BASE}/`);
    expect(db.rows.size).toBe(0);
  });

  test('github 세그먼트 + 앱 state(서명 위조 불가)는 provider_mismatch → 웹 invalid_state', async () => {
    const { state, nonce } = createAppOAuthState(SECRET, 'google', '/', pkce('z').challenge);
    const res = await CALLBACK(cbReq('github', { state, nonce }), ctx('github'));
    expect(res.headers.get('location')).toBe(`${BASE}/login?oauth_error=invalid_state&provider=github`);
  });
});

// ── 교환 ──────────────────────────────────────────────────────────────────────
describe('교환 — POST /api/auth/app-exchange', () => {
  test('정상 → 200 {ok,next}, 세션 쿠키(웹과 같은 속성), sub = 회원 id, 같은 코드 두 번째는 400', async () => {
    const { codeR, verifier } = await loginToCode('ex', 42);
    const res = await EXCHANGE.POST(exReq({ code: codeR, verifier, next: '/settings' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, next: '/settings' });
    expect(res.headers.get('cache-control')).toBe('no-store');
    const cookie = setCookies(res).find((c) => c.startsWith(`${SESSION_COOKIE}=`))!;
    expect(cookie.replace(/=v1\.[^;]+;/, '=<v>;').replace(/Expires=[^;]+/, 'Expires=<d>')).toBe('si_session=<v>; Path=/; Expires=<d>; Max-Age=2592000; Secure; HttpOnly; SameSite=lax');
    const token = decodeURIComponent(cookie.split(';')[0].slice(`${SESSION_COOKIE}=`.length));
    const v = await verifySession(token, SECRET);
    expect(v.ok && v.payload.sub).toBe(42);

    const again = await EXCHANGE.POST(exReq({ code: codeR, verifier, next: '/settings' }));
    expect(again.status).toBe(400);
    expect(setCookies(again)).toEqual([]);
  });

  test('next 는 같은 출처 경로만 — 외부·프로토콜 상대·인증 경로는 "/"', async () => {
    for (const [next, want] of [['//evil.com', '/'], ['https://evil.com', '/'], ['/\t/evil.com', '/'], ['/login', '/'], ['/order?x=1', '/order?x=1']]) {
      const { codeR, verifier } = await loginToCode(`n-${next}`);
      const res = await EXCHANGE.POST(exReq({ code: codeR, verifier, next }));
      expect(await res.json()).toEqual({ ok: true, next: want });
    }
    const { codeR, verifier } = await loginToCode('n-none');
    expect(await (await EXCHANGE.POST(exReq({ code: codeR, verifier }))).json()).toEqual({ ok: true, next: '/' });
  });

  test('★ 모든 실패는 같은 응답(상태·본문·헤더) — 사유를 구분하지 않는다', async () => {
    const snapshots: string[] = [];
    const record = async (res: Response) => {
      const headers: string[] = [];
      res.headers.forEach((v, k) => headers.push(`${k}:${v}`));
      snapshots.push(JSON.stringify({ s: res.status, b: await res.text(), h: headers.sort(), c: setCookies(res) }));
    };
    const ok = await loginToCode('fail-base', 42);
    const other = pkce('other');

    // 1) verifier 불일치(가로챈 앱)
    await record(await EXCHANGE.POST(exReq({ code: ok.codeR, verifier: other.verifier })));
    // 2) 미존재 코드
    await record(await EXCHANGE.POST(exReq({ code: 'e'.repeat(64), verifier: ok.verifier })));
    // 3) 형식 오류(대문자 코드·짧은 verifier·숫자)
    await record(await EXCHANGE.POST(exReq({ code: 'E'.repeat(64), verifier: ok.verifier })));
    await record(await EXCHANGE.POST(exReq({ code: ok.codeR, verifier: 'short' })));
    await record(await EXCHANGE.POST(exReq({ code: 1, verifier: 2 })));
    // 4) 만료(60초 경과)
    const exp = await loginToCode('fail-exp', 42);
    db.clock.now += 60_000;
    await record(await EXCHANGE.POST(exReq({ code: exp.codeR, verifier: exp.verifier })));
    // 5) 재사용
    const reuse = await loginToCode('fail-reuse', 42);
    expect((await EXCHANGE.POST(exReq({ code: reuse.codeR, verifier: reuse.verifier }))).status).toBe(200);
    await record(await EXCHANGE.POST(exReq({ code: reuse.codeR, verifier: reuse.verifier })));
    // 6) 출처: Origin 없음·다른 출처·Sec-Fetch-Site cross-site·Content-Type 폼
    const o2 = await loginToCode('fail-origin', 42);
    await record(await EXCHANGE.POST(exReq({ code: o2.codeR, verifier: o2.verifier }, { origin: null })));
    await record(await EXCHANGE.POST(exReq({ code: o2.codeR, verifier: o2.verifier }, { origin: 'https://evil.example' })));
    await record(await EXCHANGE.POST(exReq({ code: o2.codeR, verifier: o2.verifier }, { origin: `${BASE}.evil.example` })));
    await record(await EXCHANGE.POST(exReq({ code: o2.codeR, verifier: o2.verifier }, { 'sec-fetch-site': 'cross-site' })));
    await record(await EXCHANGE.POST(exReq({ code: o2.codeR, verifier: o2.verifier }, { 'content-type': 'application/x-www-form-urlencoded' })));
    await record(await EXCHANGE.POST(exReq({ code: o2.codeR, verifier: o2.verifier }, { 'content-type': 'text/plain' })));
    // 7) 본문: JSON 아님·배열·알 수 없는 키·next 비문자열·상한 초과·빈 본문
    await record(await EXCHANGE.POST(exReq(null, {}, 'not json')));
    await record(await EXCHANGE.POST(exReq(null, {}, '[1]')));
    await record(await EXCHANGE.POST(exReq({ code: o2.codeR, verifier: o2.verifier, extra: 1 })));
    await record(await EXCHANGE.POST(exReq({ code: o2.codeR, verifier: o2.verifier, next: 5 })));
    await record(await EXCHANGE.POST(exReq(null, {}, JSON.stringify({ code: o2.codeR, verifier: o2.verifier, next: `/${'a'.repeat(3000)}` }))));
    await record(await EXCHANGE.POST(exReq(null, {}, '')));
    // 8) 회원이 사라짐
    const gone = await loginToCode('fail-gone', 99);
    findUserById.mockResolvedValueOnce(null);
    await record(await EXCHANGE.POST(exReq({ code: gone.codeR, verifier: gone.verifier })));
    // 9) 서버 서명 키 없음·DB 오류
    const nosecret = await loginToCode('fail-secret', 42);
    delete process.env.AUTH_SESSION_SECRET;
    await record(await EXCHANGE.POST(exReq({ code: nosecret.codeR, verifier: nosecret.verifier })));
    process.env.AUTH_SESSION_SECRET = SECRET;
    db.missingTable = true;
    await record(await EXCHANGE.POST(exReq({ code: nosecret.codeR, verifier: nosecret.verifier })));
    db.missingTable = false;

    expect(snapshots.length).toBe(22);
    expect(new Set(snapshots).size).toBe(1);
    expect(JSON.parse(snapshots[0])).toEqual({
      s: 400,
      b: '{"ok":false,"error":"app_code_invalid"}',
      h: ['cache-control:no-store', 'content-type:application/json'],
      c: [],
    });
    // 오리진 실패로 버려진 코드(o2)는 소각되지 않아 정상 요청으로는 아직 교환된다(출처 검사가 소각보다 먼저)
    expect((await EXCHANGE.POST(exReq({ code: o2.codeR, verifier: o2.verifier }))).status).toBe(200);
  });

  test('chunked(본문 길이 헤더 없음) 상한 초과도 거부', async () => {
    const big = new ReadableStream<Uint8Array>({
      start(c) { for (let i = 0; i < 5; i += 1) c.enqueue(new Uint8Array(1024).fill(32)); c.close(); },
    });
    const req = new NextRequest(`${BASE}/api/auth/app-exchange`, {
      method: 'POST',
      headers: new Headers({ 'content-type': 'application/json', origin: BASE, 'x-real-ip': '10.0.0.9' }),
      body: big,
      // @ts-expect-error — Node fetch 의 스트림 본문 옵션
      duplex: 'half',
    });
    expect(req.headers.get('content-length')).toBeNull();
    const res = await EXCHANGE.POST(req);
    expect(res.status).toBe(400);
  });

  test('GET 은 405, 본문 없음', async () => {
    const res = EXCHANGE.GET();
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
    expect(await res.text()).toBe('');
  });

  test(`IP별 요청 제한 — 분당 ${APP_EXCHANGE_LIMIT_PER_MIN}건 넘으면 429(다른 IP 는 영향 없음)`, async () => {
    const fixed = { 'x-real-ip': '10.9.9.9' };
    for (let i = 0; i < APP_EXCHANGE_LIMIT_PER_MIN; i += 1) {
      expect((await EXCHANGE.POST(exReq({ code: 'e'.repeat(64), verifier: pkce('l').verifier }, fixed))).status).toBe(400);
    }
    const limited = await EXCHANGE.POST(exReq({ code: 'e'.repeat(64), verifier: pkce('l').verifier }, fixed));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    const { codeR, verifier } = await loginToCode('other-ip');
    expect((await EXCHANGE.POST(exReq({ code: codeR, verifier }, { 'x-real-ip': '10.0.0.2' }))).status).toBe(200);
  });

  test('코드·verifier 값은 서버 로그에 남지 않는다', async () => {
    const { codeR, verifier } = await loginToCode('log');
    await EXCHANGE.POST(exReq({ code: codeR, verifier: pkce('bad').verifier }));
    await EXCHANGE.POST(exReq({ code: codeR, verifier }));
    db.missingTable = true;
    await EXCHANGE.POST(exReq({ code: codeR, verifier }));
    const all = [console.log, console.warn, console.error].flatMap((f) => (f as jest.Mock).mock.calls.flat()).map(String).join(' ');
    expect(all).not.toContain(codeR);
    expect(all).not.toContain(verifier);
    expect(all).not.toContain(bindAppAuthCode(codeR, pkceChallengeOf(verifier)));
  });
});
