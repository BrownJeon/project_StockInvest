/**
 * Phase 0 — 세션 토큰 서명/검증 단위 테스트.
 * middleware(Edge Runtime)와 /api/auth/login이 공유하는 모듈이므로
 * Web Crypto만으로 동작해야 한다 (node:crypto import 금지).
 */
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SEC,
  getAuthPin,
  isAuthConfigured,
  safeEqualStr,
  signSession,
  verifySession,
} from '../session';

const PIN = '135790';

describe('signSession / verifySession', () => {
  test('서명한 토큰은 같은 secret으로 검증 통과', async () => {
    const token = await signSession(PIN);
    const r = await verifySession(token, PIN);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload.sub).toBe('owner');
      expect(r.payload.exp).toBeGreaterThan(r.payload.iat);
    }
  });

  test('토큰 포맷은 v1.<payload>.<sig>', async () => {
    const token = await signSession(PIN);
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe('v1');
    // base64url — '+', '/', '=' 이 없어야 쿠키 값으로 안전
    expect(token).not.toMatch(/[+/=]/);
  });

  test('다른 secret으로는 검증 실패 (PIN 변경 시 기존 세션 무효화)', async () => {
    const token = await signSession(PIN);
    const r = await verifySession(token, '999999');
    expect(r).toEqual({ ok: false, reason: 'bad_signature' });
  });

  test('payload 변조 시 서명 불일치', async () => {
    const token = await signSession(PIN);
    const [ver, body, sig] = token.split('.');
    const forgedBody = Buffer.from(
      JSON.stringify({ iat: Date.now(), exp: Date.now() + 10 ** 12, sub: 'owner' }),
    ).toString('base64url');
    expect(forgedBody).not.toBe(body);
    const r = await verifySession(`${ver}.${forgedBody}.${sig}`, PIN);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('bad_signature');
  });

  test('서명 변조 시 실패', async () => {
    const token = await signSession(PIN);
    const parts = token.split('.');
    parts[2] = parts[2].slice(0, -2) + (parts[2].endsWith('AA') ? 'BB' : 'AA');
    const r = await verifySession(parts.join('.'), PIN);
    expect(r.ok).toBe(false);
  });

  test('만료 토큰 → expired', async () => {
    const now = Date.now();
    const token = await signSession(PIN, { nowMs: now, maxAgeSec: 60 });
    expect((await verifySession(token, PIN, now + 59_000)).ok).toBe(true);
    const r = await verifySession(token, PIN, now + 61_000);
    expect(r).toEqual({ ok: false, reason: 'expired' });
  });

  test('만료 경계(exp 시점)는 무효', async () => {
    const now = Date.now();
    const token = await signSession(PIN, { nowMs: now, maxAgeSec: 60 });
    const r = await verifySession(token, PIN, now + 60_000);
    expect(r).toEqual({ ok: false, reason: 'expired' });
  });

  test('쿠키 없음 → missing', async () => {
    expect(await verifySession(undefined, PIN)).toEqual({ ok: false, reason: 'missing' });
    expect(await verifySession('', PIN)).toEqual({ ok: false, reason: 'missing' });
  });

  test('secret 없음 → no_secret (fail-closed)', async () => {
    const token = await signSession(PIN);
    expect(await verifySession(token, undefined)).toEqual({ ok: false, reason: 'no_secret' });
    expect(await verifySession(token, '')).toEqual({ ok: false, reason: 'no_secret' });
  });

  test('형식 오류 → malformed', async () => {
    for (const bad of ['abc', 'v1.onlytwo', 'v2.a.b', 'v1..sig', 'v1.body.', 'a.b.c.d']) {
      const r = await verifySession(bad, PIN);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(['malformed', 'bad_signature']).toContain(r.reason);
    }
  });

  test('기본 유효기간은 30일', async () => {
    const now = Date.now();
    const token = await signSession(PIN, { nowMs: now });
    const r = await verifySession(token, PIN, now);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload.exp - now).toBe(SESSION_MAX_AGE_SEC * 1000);
  });

  test('secret 없이 서명 시도 → throw', async () => {
    await expect(signSession('')).rejects.toThrow();
  });
});

describe('safeEqualStr', () => {
  test('같은 값 true / 다른 값 false / 길이 다르면 false', () => {
    expect(safeEqualStr('1234', '1234')).toBe(true);
    expect(safeEqualStr('1234', '1235')).toBe(false);
    expect(safeEqualStr('1234', '12345')).toBe(false);
    expect(safeEqualStr('', '')).toBe(true);
  });

  test('유니코드도 정확히 비교', () => {
    expect(safeEqualStr('핀번호', '핀번호')).toBe(true);
    expect(safeEqualStr('핀번호', '핀번화')).toBe(false);
  });
});

describe('getAuthPin / isAuthConfigured', () => {
  const orig = process.env.AUTH_PIN;
  afterEach(() => {
    if (orig === undefined) delete process.env.AUTH_PIN;
    else process.env.AUTH_PIN = orig;
  });

  test('미설정 → undefined / false', () => {
    delete process.env.AUTH_PIN;
    expect(getAuthPin()).toBeUndefined();
    expect(isAuthConfigured()).toBe(false);
  });

  test('공백만 있으면 미설정 취급', () => {
    process.env.AUTH_PIN = '   ';
    expect(getAuthPin()).toBeUndefined();
    expect(isAuthConfigured()).toBe(false);
  });

  test('설정 시 trim된 값 반환', () => {
    process.env.AUTH_PIN = ' 4821 ';
    expect(getAuthPin()).toBe('4821');
    expect(isAuthConfigured()).toBe(true);
  });
});

describe('쿠키 상수', () => {
  test('쿠키 이름 고정 (middleware ↔ login 라우트 계약)', () => {
    expect(SESSION_COOKIE).toBe('si_session');
  });
});
