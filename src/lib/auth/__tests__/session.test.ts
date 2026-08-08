/**
 * 세션 토큰 서명/검증 단위 테스트 (Phase 0 → T-008 회원제).
 * middleware(Edge Runtime)와 /api/auth/* 가 공유하는 모듈이므로
 * Web Crypto만으로 동작해야 한다 (node:crypto import 금지).
 */
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SEC,
  getSessionSecret,
  isAuthConfigured,
  signSession,
  verifySession,
} from '../session';

const SECRET = 'test-session-secret-6f3a9c';
const USER_ID = 7;

describe('signSession / verifySession', () => {
  test('서명한 토큰은 같은 secret으로 검증 통과하고 sub 는 회원 id', async () => {
    const token = await signSession(SECRET, USER_ID);
    const r = await verifySession(token, SECRET);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload.sub).toBe(USER_ID);
      expect(typeof r.payload.sub).toBe('number');
      expect(r.payload.exp).toBeGreaterThan(r.payload.iat);
    }
  });

  test('토큰 포맷은 v1.<payload>.<sig>', async () => {
    const token = await signSession(SECRET, USER_ID);
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe('v1');
    // base64url — '+', '/', '=' 이 없어야 쿠키 값으로 안전
    expect(token).not.toMatch(/[+/=]/);
  });

  test('다른 secret으로는 검증 실패 (키 교체 시 기존 세션 무효화)', async () => {
    const token = await signSession(SECRET, USER_ID);
    const r = await verifySession(token, 'another-secret');
    expect(r).toEqual({ ok: false, reason: 'bad_signature' });
  });

  test('payload 변조 시 서명 불일치 — 회원 id 승격 시도 차단', async () => {
    const token = await signSession(SECRET, USER_ID);
    const [ver, body, sig] = token.split('.');
    const forgedBody = Buffer.from(
      JSON.stringify({ iat: Date.now(), exp: Date.now() + 10 ** 12, sub: 1 }),
    ).toString('base64url');
    expect(forgedBody).not.toBe(body);
    const r = await verifySession(`${ver}.${forgedBody}.${sig}`, SECRET);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('bad_signature');
  });

  test('서명 변조 시 실패', async () => {
    const token = await signSession(SECRET, USER_ID);
    const parts = token.split('.');
    parts[2] = parts[2].slice(0, -2) + (parts[2].endsWith('AA') ? 'BB' : 'AA');
    const r = await verifySession(parts.join('.'), SECRET);
    expect(r.ok).toBe(false);
  });

  test('만료 토큰 → expired', async () => {
    const now = Date.now();
    const token = await signSession(SECRET, USER_ID, { nowMs: now, maxAgeSec: 60 });
    expect((await verifySession(token, SECRET, now + 59_000)).ok).toBe(true);
    const r = await verifySession(token, SECRET, now + 61_000);
    expect(r).toEqual({ ok: false, reason: 'expired' });
  });

  test('만료 경계(exp 시점)는 무효', async () => {
    const now = Date.now();
    const token = await signSession(SECRET, USER_ID, { nowMs: now, maxAgeSec: 60 });
    const r = await verifySession(token, SECRET, now + 60_000);
    expect(r).toEqual({ ok: false, reason: 'expired' });
  });

  test('쿠키 없음 → missing', async () => {
    expect(await verifySession(undefined, SECRET)).toEqual({ ok: false, reason: 'missing' });
    expect(await verifySession('', SECRET)).toEqual({ ok: false, reason: 'missing' });
  });

  test('secret 없음 → no_secret (fail-closed)', async () => {
    const token = await signSession(SECRET, USER_ID);
    expect(await verifySession(token, undefined)).toEqual({ ok: false, reason: 'no_secret' });
    expect(await verifySession(token, '')).toEqual({ ok: false, reason: 'no_secret' });
  });

  test('형식 오류 → malformed', async () => {
    for (const bad of ['abc', 'v1.onlytwo', 'v2.a.b', 'v1..sig', 'v1.body.', 'a.b.c.d']) {
      const r = await verifySession(bad, SECRET);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(['malformed', 'bad_signature']).toContain(r.reason);
    }
  });

  test('기본 유효기간은 30일', async () => {
    const now = Date.now();
    const token = await signSession(SECRET, USER_ID, { nowMs: now });
    const r = await verifySession(token, SECRET, now);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload.exp - now).toBe(SESSION_MAX_AGE_SEC * 1000);
  });

  test('secret 없이 서명 시도 → throw', async () => {
    await expect(signSession('', USER_ID)).rejects.toThrow();
  });

  test('userId 가 양의 정수가 아니면 서명 거부', async () => {
    for (const bad of [0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 2]) {
      await expect(signSession(SECRET, bad)).rejects.toThrow();
    }
  });
});

describe('sub 타입 혼동 방어', () => {
  /** 서명은 유효하지만 sub 가 이상한 토큰을 만든다 (키가 유출된 최악의 상황 가정). */
  async function signRaw(payload: unknown): Promise<string> {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signed = `v1.${body}`;
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signed)));
    const b64 = Buffer.from(sig).toString('base64url');
    return `${signed}.${b64}`;
  }

  const future = Date.now() + 10 ** 9;

  test.each([
    ['문자열 owner (구 포맷)', 'owner'],
    ['SQL 조각', '1 OR 1=1'],
    ['불리언', true],
    ['객체', { id: 1 }],
    ['숫자 문자열', '1'],
    ['0', 0],
    ['음수', -3],
    ['소수', 1.5],
  ])('sub 가 %s 이면 malformed', async (_label, sub) => {
    const token = await signRaw({ iat: Date.now(), exp: future, sub });
    const r = await verifySession(token, SECRET);
    expect(r).toEqual({ ok: false, reason: 'malformed' });
  });

  test('정상 숫자 sub 는 통과 (대조군 — 위 방어가 과하지 않음을 보인다)', async () => {
    const token = await signRaw({ iat: Date.now(), exp: future, sub: 42 });
    const r = await verifySession(token, SECRET);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload.sub).toBe(42);
  });
});

describe('getSessionSecret / isAuthConfigured', () => {
  const orig = process.env.AUTH_SESSION_SECRET;
  afterEach(() => {
    if (orig === undefined) delete process.env.AUTH_SESSION_SECRET;
    else process.env.AUTH_SESSION_SECRET = orig;
  });

  test('미설정 → undefined / false', () => {
    delete process.env.AUTH_SESSION_SECRET;
    expect(getSessionSecret()).toBeUndefined();
    expect(isAuthConfigured()).toBe(false);
  });

  test('공백만 있으면 미설정 취급', () => {
    process.env.AUTH_SESSION_SECRET = '   ';
    expect(getSessionSecret()).toBeUndefined();
    expect(isAuthConfigured()).toBe(false);
  });

  test('설정 시 trim된 값 반환', () => {
    process.env.AUTH_SESSION_SECRET = ' abc123 ';
    expect(getSessionSecret()).toBe('abc123');
    expect(isAuthConfigured()).toBe(true);
  });

  test('AUTH_PIN 은 더 이상 세션 키로 쓰이지 않는다 (회귀 방어)', () => {
    delete process.env.AUTH_SESSION_SECRET;
    process.env.AUTH_PIN = 'legacy-pin';
    expect(getSessionSecret()).toBeUndefined();
    expect(isAuthConfigured()).toBe(false);
    delete process.env.AUTH_PIN;
  });
});

describe('쿠키 상수', () => {
  test('쿠키 이름 고정 (middleware ↔ auth 라우트 계약)', () => {
    expect(SESSION_COOKIE).toBe('si_session');
  });
});
