/**
 * HMAC 서명 세션 토큰 — Edge Runtime 호환 (Phase 0, 2026-08-02 / T-008 멀티테넌트 전환 2026-08-07).
 *
 * `src/middleware.ts`는 **Edge Runtime**으로 실행되므로 `node:crypto` / `mysql2` 등
 * Node 전용 모듈을 쓸 수 없다. 여기서는 Web Crypto(`crypto.subtle`)와 `btoa`/`atob`만 사용한다.
 *
 * 토큰 포맷: `v1.<payload(base64url JSON)>.<signature(base64url HMAC-SHA256)>`
 *
 * T-008 변경:
 *   - payload `sub`: 고정 문자열 `'owner'` → **회원 id(양의 정수)**
 *   - 서명 키: `AUTH_PIN` → **`AUTH_SESSION_SECRET`** (PIN 이 서명 키를 겸하던 문제 해소)
 *   두 변경 모두 기존 쿠키를 무효화한다 — 배포 후 전원 재로그인(설계문서 §세션의 예정 동작).
 */

/** 세션 쿠키 이름 */
export const SESSION_COOKIE = 'si_session';

/** 세션 유효기간 (30일) */
export const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60;

const TOKEN_VERSION = 'v1';

export interface SessionPayload {
  /** 발급 시각 (epoch ms) */
  iat: number;
  /** 만료 시각 (epoch ms) */
  exp: number;
  /** 주체 — 회원 `users.id` (양의 정수) */
  sub: number;
}

export type VerifyFailReason =
  | 'no_secret'      // AUTH_SESSION_SECRET 미설정
  | 'missing'        // 쿠키 없음
  | 'malformed'      // 포맷/파싱 오류 (sub 타입 오류 포함)
  | 'bad_signature'  // 서명 불일치
  | 'expired';       // 만료

export type VerifyResult =
  | { ok: true; payload: SessionPayload }
  | { ok: false; reason: VerifyFailReason };

// ─── base64url ──────────────────────────────────────────────────────────────

function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  const norm = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = norm.length % 4 === 0 ? '' : '='.repeat(4 - (norm.length % 4));
  const bin = atob(norm + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ─── HMAC (Web Crypto) ──────────────────────────────────────────────────────

async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return new Uint8Array(sig);
}

/** 길이가 같은 두 바이트열의 상수시간 비교. 길이가 다르면 즉시 false. */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ─── 서명 / 검증 ────────────────────────────────────────────────────────────

/**
 * 세션 토큰 서명.
 * @param secret   서명 키 (= AUTH_SESSION_SECRET)
 * @param userId   회원 id (양의 정수)
 * @param opts     nowMs / maxAgeSec 는 테스트 주입용
 */
export async function signSession(
  secret: string,
  userId: number,
  opts: { nowMs?: number; maxAgeSec?: number } = {},
): Promise<string> {
  if (!secret) throw new Error('signSession: secret required');
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new Error('signSession: userId must be a positive integer');
  }
  const now = opts.nowMs ?? Date.now();
  const maxAge = opts.maxAgeSec ?? SESSION_MAX_AGE_SEC;
  const payload: SessionPayload = { iat: now, exp: now + maxAge * 1000, sub: userId };
  const body = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signed = `${TOKEN_VERSION}.${body}`;
  const sig = b64urlEncode(await hmacSha256(secret, signed));
  return `${signed}.${sig}`;
}

/**
 * 세션 토큰 검증. 서명 → payload 형식 → 만료 순으로 확인한다.
 * secret이 비어 있으면 `no_secret` (fail-closed — 호출부는 통과시키면 안 된다).
 *
 * ⚠️ `sub` 는 **양의 정수만** 허용한다. 서명이 맞아도 형식이 어긋나면 거부한다
 *    (`"1 OR 1=1"`·`true`·부동소수 같은 타입 혼동 값이 회원 id 자리로 흘러드는 것을 차단).
 */
export async function verifySession(
  token: string | null | undefined,
  secret: string | null | undefined,
  nowMs: number = Date.now(),
): Promise<VerifyResult> {
  if (!secret) return { ok: false, reason: 'no_secret' };
  if (!token) return { ok: false, reason: 'missing' };

  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION || !parts[1] || !parts[2]) {
    return { ok: false, reason: 'malformed' };
  }
  const [ver, body, sig] = parts;

  let expected: Uint8Array;
  let given: Uint8Array;
  try {
    expected = await hmacSha256(secret, `${ver}.${body}`);
    given = b64urlDecode(sig);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!bytesEqual(expected, given)) return { ok: false, reason: 'bad_signature' };

  let payload: SessionPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as SessionPayload;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!payload || typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof payload.sub !== 'number' || !Number.isSafeInteger(payload.sub) || payload.sub <= 0) {
    return { ok: false, reason: 'malformed' };
  }
  if (nowMs >= payload.exp) return { ok: false, reason: 'expired' };

  return { ok: true, payload };
}

/**
 * 세션 서명 키 조회. 공백만 있거나 미설정이면 undefined.
 * 모듈 top-level이 아니라 호출 시점에 읽는다 — Edge 샌드박스는 요청 시 실제 process.env를 복사한다.
 */
export function getSessionSecret(): string | undefined {
  const v = process.env.AUTH_SESSION_SECRET;
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

/** 세션 서명 키 설정 여부 (값은 노출하지 않는다). */
export function isAuthConfigured(): boolean {
  return getSessionSecret() !== undefined;
}
