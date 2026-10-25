/**
 * T-088 — 앱 Google 로그인: PKCE 형식·1회용 코드 발급/소각(메모리 저장소)·SQL 저장소가 내는 문장·딥링크/next 형식.
 *
 * 저장소는 `AppAuthCodeStore` 를 주입한다 — 여기서는 DB 와 같은 의미(조건부 소각·DB 시계 TTL)를 흉내 내는 메모리 구현을 쓰고,
 * 실제 MariaDB 의미(조건부 UPDATE 동시성·CHECK·만료)는 `t088-disposable-mariadb.test.ts` 가 일회용 컨테이너로 확인한다.
 */
import { createHash } from 'node:crypto';
import {
  APP_AUTH_CODE_RETENTION_SEC,
  APP_AUTH_CODE_SQL,
  APP_AUTH_CODE_TTL_SEC,
  bindAppAuthCode,
  consumeAppAuthCode,
  createSqlAppAuthCodeStore,
  isAppAuthCodeNotMigrated,
  issueAppAuthCode,
  type AppAuthCodeStore,
} from '@/lib/auth/oauth/app-code';
import { isPkceChallenge, isPkceVerifier, pkceChallengeOf } from '@/lib/auth/oauth/pkce';
import {
  APP_DEEP_LINK_BASE,
  APP_LOGIN_ERRORS,
  buildAppCallbackDeepLink,
  parseAppDeepLink,
  sanitizeAppNextPath,
} from '@/lib/auth/oauth/app-flow';

jest.mock('@/lib/db', () => ({ getPool: () => { throw new Error('운영 풀 사용 금지(시험)'); } }));

/** DB 와 같은 의미의 메모리 저장소. 시계는 `clock.now` 로 조종한다. */
function memoryStore(clock = { now: 1_000_000 }) {
  const rows = new Map<string, { userId: number; expiresAt: number; usedAt: number | null; createdAt: number }>();
  const store: AppAuthCodeStore & { rows: typeof rows; clock: typeof clock; pruned: number[] } = {
    rows,
    clock,
    pruned: [],
    async create({ code, userId, ttlSec }) {
      if (rows.has(code)) throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
      rows.set(code, { userId, expiresAt: clock.now + ttlSec * 1000, usedAt: null, createdAt: clock.now });
    },
    async burn(code) {
      const r = rows.get(code);
      if (!r || r.usedAt !== null || !(r.expiresAt > clock.now)) return 0;
      r.usedAt = clock.now;
      return 1;
    },
    async userIdOf(code) {
      return rows.get(code)?.userId ?? null;
    },
    async prune(sec) {
      store.pruned.push(sec);
      for (const [k, r] of rows) if (r.expiresAt < clock.now - sec * 1000) rows.delete(k);
    },
  };
  return store;
}

/** 클라이언트(`appLogin.ts`)와 같은 방식의 PKCE 쌍(32바이트 → base64url 43자). */
function pkcePair(seed: string) {
  const verifier = createHash('sha256').update(seed).digest('base64url'); // 43자
  return { verifier, challenge: pkceChallengeOf(verifier) };
}

describe('PKCE 형식', () => {
  test('S256 계산은 RFC 7636 부록 B 시험 벡터와 같다', () => {
    expect(pkceChallengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
  test('challenge·verifier 는 정확히 43자 base64url 만', () => {
    const { verifier, challenge } = pkcePair('a');
    expect(isPkceVerifier(verifier)).toBe(true);
    expect(isPkceChallenge(challenge)).toBe(true);
    for (const bad of ['', 'A'.repeat(42), 'A'.repeat(44), 'A'.repeat(42) + '=', 'A'.repeat(42) + '+', 'A'.repeat(42) + '.', 'A'.repeat(128), null, 42, { length: 43 }]) {
      expect(isPkceChallenge(bad)).toBe(false);
      expect(isPkceVerifier(bad)).toBe(false);
    }
  });
});

describe('결속값 = sha256hex(code_r + ":" + challenge)', () => {
  test('고정 벡터', () => {
    const codeR = 'a'.repeat(64);
    const ch = 'B'.repeat(43);
    expect(bindAppAuthCode(codeR, ch)).toBe(createHash('sha256').update(`${codeR}:${ch}`, 'utf8').digest('hex'));
    // challenge 가 결속에 들어가 있다 — 다른 challenge 는 다른 값
    expect(bindAppAuthCode(codeR, ch)).not.toBe(bindAppAuthCode(codeR, 'C'.repeat(43)));
    expect(bindAppAuthCode(codeR, ch)).not.toBe(createHash('sha256').update(codeR).digest('hex'));
  });
});

describe('발급 → 교환(메모리 저장소)', () => {
  test('정상: 코드 64 hex, DB 에는 결속값만, 교환 성공 → 회원 id', async () => {
    const s = memoryStore();
    const { verifier, challenge } = pkcePair('ok');
    const codeR = await issueAppAuthCode(42, challenge, s);
    expect(codeR).toMatch(/^[0-9a-f]{64}$/);
    expect([...s.rows.keys()]).toEqual([bindAppAuthCode(codeR, challenge)]);
    expect([...s.rows.keys()][0]).not.toContain(codeR);
    expect(s.rows.get(bindAppAuthCode(codeR, challenge))!.expiresAt - s.clock.now).toBe(60_000);
    expect(await consumeAppAuthCode(codeR, verifier, s)).toBe(42);
  });

  test('TTL 은 60초 — 59.999초까지 성공, 60초부터 실패', async () => {
    expect(APP_AUTH_CODE_TTL_SEC).toBe(60);
    const s = memoryStore();
    const { verifier, challenge } = pkcePair('ttl');
    const a = await issueAppAuthCode(1, challenge, s);
    const b = await issueAppAuthCode(1, challenge, s);
    s.clock.now += 59_999;
    expect(await consumeAppAuthCode(a, verifier, s)).toBe(1);
    s.clock.now += 1;
    expect(await consumeAppAuthCode(b, verifier, s)).toBeNull();
  });

  test('1회용 — 두 번째 교환은 실패(동시 두 요청 중 하나만 성공)', async () => {
    const s = memoryStore();
    const { verifier, challenge } = pkcePair('once');
    const codeR = await issueAppAuthCode(9, challenge, s);
    const results = await Promise.all([consumeAppAuthCode(codeR, verifier, s), consumeAppAuthCode(codeR, verifier, s)]);
    expect(results.filter((r) => r === 9)).toHaveLength(1);
    expect(results.filter((r) => r === null)).toHaveLength(1);
    expect(await consumeAppAuthCode(codeR, verifier, s)).toBeNull();
  });

  test('PKCE 결속 — 다른 verifier(가로챈 앱)로는 교환 불가, 원래 verifier 는 여전히 가능', async () => {
    const s = memoryStore();
    const mine = pkcePair('mine');
    const thief = pkcePair('thief');
    const codeR = await issueAppAuthCode(5, mine.challenge, s);
    expect(await consumeAppAuthCode(codeR, thief.verifier, s)).toBeNull();
    // challenge 자체를 verifier 자리에 넣어도(딥링크·state 에서 본 값) 안 된다
    expect(await consumeAppAuthCode(codeR, mine.challenge, s)).toBeNull();
    expect(await consumeAppAuthCode(codeR, mine.verifier, s)).toBe(5);
  });

  test('형식 오류는 저장소에 닿기 전에 실패', async () => {
    const s = memoryStore();
    const burn = jest.spyOn(s, 'burn');
    const { verifier } = pkcePair('fmt');
    for (const [c, v] of [
      ['A'.repeat(64), verifier], ['a'.repeat(63), verifier], ['a'.repeat(65), verifier], [`${'a'.repeat(63)}\n`, verifier],
      [null, verifier], [123, verifier], ['a'.repeat(64), 'short'], ['a'.repeat(64), null], ['a'.repeat(64), `${verifier}=`],
    ] as Array<[unknown, unknown]>) {
      expect(await consumeAppAuthCode(c, v, s)).toBeNull();
    }
    expect(burn).not.toHaveBeenCalled();
  });

  test('미존재 코드·소각 성공 후 행 없음 → null', async () => {
    const s = memoryStore();
    const { verifier } = pkcePair('none');
    expect(await consumeAppAuthCode('b'.repeat(64), verifier, s)).toBeNull();
    const odd: AppAuthCodeStore = { ...s, burn: async () => 1, userIdOf: async () => null };
    expect(await consumeAppAuthCode('b'.repeat(64), verifier, odd)).toBeNull();
  });

  test('발급 입력 검사 — challenge 형식·회원 id', async () => {
    const s = memoryStore();
    await expect(issueAppAuthCode(1, 'not-a-challenge', s)).rejects.toThrow();
    await expect(issueAppAuthCode(0, 'B'.repeat(43), s)).rejects.toThrow();
    await expect(issueAppAuthCode(1.5, 'B'.repeat(43), s)).rejects.toThrow();
    expect(s.rows.size).toBe(0);
  });

  test('발급 때 보관시간(1시간) 지난 행을 청소하고, 청소 실패는 발급을 막지 않는다', async () => {
    const s = memoryStore();
    await issueAppAuthCode(1, 'B'.repeat(43), s);
    await new Promise((r) => setImmediate(r));
    expect(s.pruned).toEqual([APP_AUTH_CODE_RETENTION_SEC]);
    expect(APP_AUTH_CODE_RETENTION_SEC).toBe(3600);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const broken: AppAuthCodeStore = { ...s, prune: async () => { throw new Error('x'); } };
    await expect(issueAppAuthCode(2, 'C'.repeat(43), broken)).resolves.toMatch(/^[0-9a-f]{64}$/);
    await new Promise((r) => setImmediate(r));
    warn.mockRestore();
  });
});

describe('SQL 저장소가 내는 문장(DB 시계·조건부 소각)', () => {
  test('소각은 used_at IS NULL AND expires_at > NOW(3) 조건부 UPDATE 한 방', () => {
    expect(APP_AUTH_CODE_SQL.burn).toBe('UPDATE app_auth_code SET used_at = NOW(3) WHERE code = ? AND used_at IS NULL AND expires_at > NOW(3)');
    expect(APP_AUTH_CODE_SQL.insert).toBe('INSERT INTO app_auth_code (code, user_id, expires_at) VALUES (?, ?, NOW(3) + INTERVAL ? SECOND)');
    expect(APP_AUTH_CODE_SQL.prune).toBe('DELETE FROM app_auth_code WHERE expires_at < NOW(3) - INTERVAL ? SECOND');
  });

  test('값은 자리표시자로만, affectedRows 를 그대로 돌려준다', async () => {
    const calls: Array<[string, unknown[] | undefined]> = [];
    const replies: unknown[] = [[{ affectedRows: 1 }, undefined], [{ affectedRows: 0 }, undefined], [[{ user_id: 42 }], []], [[], []], [[{ affectedRows: 1 }], undefined], [[{ affectedRows: 3 }], undefined]];
    const runner = { query: async (sql: string, values?: unknown[]) => { calls.push([sql, values]); return replies.shift(); } };
    const st = createSqlAppAuthCodeStore(runner);
    expect(await st.burn('c'.repeat(64))).toBe(1);
    expect(await st.burn('c'.repeat(64))).toBe(0);
    expect(await st.userIdOf('c'.repeat(64))).toBe(42);
    expect(await st.userIdOf('d'.repeat(64))).toBeNull();
    await st.create({ code: 'e'.repeat(64), userId: 7, ttlSec: 60 });
    await st.prune(3600);
    expect(calls).toEqual([
      [APP_AUTH_CODE_SQL.burn, ['c'.repeat(64)]],
      [APP_AUTH_CODE_SQL.burn, ['c'.repeat(64)]],
      [APP_AUTH_CODE_SQL.userOf, ['c'.repeat(64)]],
      [APP_AUTH_CODE_SQL.userOf, ['d'.repeat(64)]],
      [APP_AUTH_CODE_SQL.insert, ['e'.repeat(64), 7, 60]],
      [APP_AUTH_CODE_SQL.prune, [3600]],
    ]);
  });

  test('영향 행이 2 이상이면(있을 수 없는 상태) 교환 실패', async () => {
    const runner = { query: async () => [{ affectedRows: 2 }] };
    const { verifier } = pkcePair('two');
    expect(await consumeAppAuthCode('a'.repeat(64), verifier, createSqlAppAuthCodeStore(runner))).toBeNull();
  });

  test('테이블 미적용 판별 — 1146 + app_auth_code 만', () => {
    expect(isAppAuthCodeNotMigrated({ code: 'ER_NO_SUCH_TABLE', errno: 1146, sqlMessage: "Table 'x.app_auth_code' doesn't exist" })).toBe(true);
    expect(isAppAuthCodeNotMigrated({ code: 'ER_NO_SUCH_TABLE', errno: 1146, sqlMessage: "Table 'x.users' doesn't exist" })).toBe(false);
    expect(isAppAuthCodeNotMigrated(new Error('app_auth_code'))).toBe(false);
    expect(isAppAuthCodeNotMigrated(null)).toBe(false);
  });
});

describe('딥링크 형식', () => {
  test('발급 주소는 고정 접두어 + 64 hex / 고정 오류 코드', () => {
    expect(APP_DEEP_LINK_BASE).toBe('stockinvest://auth/callback');
    expect(buildAppCallbackDeepLink({ code: 'a'.repeat(64) })).toBe(`stockinvest://auth/callback?code=${'a'.repeat(64)}`);
    for (const e of APP_LOGIN_ERRORS) expect(buildAppCallbackDeepLink({ error: e })).toBe(`stockinvest://auth/callback?error=${e}`);
    expect(() => buildAppCallbackDeepLink({ code: 'A'.repeat(64) })).toThrow();
    expect(() => buildAppCallbackDeepLink({ code: 'a'.repeat(64) + '&x=1' })).toThrow();
    expect(() => buildAppCallbackDeepLink({ error: 'oops' as never })).toThrow();
  });

  test('파싱 — 로그인 콜백 주소만, 형식 밖 값은 failed 로 수렴', () => {
    const c = 'f'.repeat(64);
    expect(parseAppDeepLink(`stockinvest://auth/callback?code=${c}`)).toEqual({ kind: 'code', code: c });
    expect(parseAppDeepLink('stockinvest://auth/callback?error=signup_requires_web')).toEqual({ kind: 'error', error: 'signup_requires_web' });
    expect(parseAppDeepLink('stockinvest://auth/callback?error=<script>')).toEqual({ kind: 'error', error: 'failed' });
    expect(parseAppDeepLink('stockinvest://auth/callback?code=ABC')).toEqual({ kind: 'error', error: 'failed' });
    expect(parseAppDeepLink(`stockinvest://auth/callback?code=${c}&error=failed`)).toEqual({ kind: 'error', error: 'failed' });
    expect(parseAppDeepLink('stockinvest://auth/callback')).toEqual({ kind: 'error', error: 'failed' });
    for (const other of [
      `stockinvest://auth/other?code=${c}`, `stockinvest://evil/callback?code=${c}`, `https://auth/callback?code=${c}`,
      `stockinvestx://auth/callback?code=${c}`, `stockinvest://auth/callback/x?code=${c}`, `stockinvest://u:p@auth/callback?code=${c}`,
      `stockinvest://auth:1/callback?code=${c}`, 'not a url', '', null, 42,
    ]) {
      expect(parseAppDeepLink(other)).toBeNull();
    }
  });
});

describe('앱 착지 경로(next) — 같은 출처 경로만', () => {
  test.each([
    ['/settings', '/settings'],
    ['/order?tab=1#x', '/order?tab=1#x'],
    ['/', '/'],
    ['/a/../b', '/b'],
  ])('허용 %s → %s', (raw, want) => expect(sanitizeAppNextPath(raw)).toBe(want));

  test.each([
    '//evil.com', '/\\evil.com', '\\\\evil.com', 'https://evil.com', 'http:/evil.com', 'javascript:alert(1)', 'evil.com',
    '/\t/evil.com', '/\n/evil.com', '/\r//evil.com', ' /settings', '/..//evil.com', '/a/../..//evil.com',
    '/ /evil.com', '/ x', '/login', '/login?next=/x', '/signup', '/oauth/invite', '/api/orders', '/api',
    '', 'x'.repeat(10), '/' + 'a'.repeat(600),
  ])('거부 %j → /', (raw) => {
    expect(sanitizeAppNextPath(raw)).toBe('/');
  });

  test('비문자열 → /', () => {
    for (const v of [null, undefined, 1, {}, ['/x']]) expect(sanitizeAppNextPath(v)).toBe('/');
  });

  test('속성: 무작위 입력 2만 건 — 결과는 항상 "/" 로 시작하고 "//" 로 시작하지 않으며 같은 출처', () => {
    const alphabet = ['/', '\\', '.', ':', '%', '0', '9', 'a', 'Z', '?', '#', '@', '\t', '\n', ' ', '-', '_', '~', 'é'];
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
    for (let i = 0; i < 20000; i += 1) {
      const len = rnd() % 24;
      let s = '';
      for (let j = 0; j < len; j += 1) s += alphabet[rnd() % alphabet.length];
      const out = sanitizeAppNextPath(s);
      expect(out.startsWith('/') && !out.startsWith('//')).toBe(true);
      expect(new URL(out, 'https://stock.example.com').origin).toBe('https://stock.example.com');
    }
  });
});
