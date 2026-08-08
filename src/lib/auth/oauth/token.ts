/**
 * OAuth 흐름용 짧은 수명 서명 토큰 (T-009, 2026-08-08).
 *
 * 공유 패키지의 `core/state.js`(JWT)를 **쓰지 않는 이유** 2가지:
 *
 *  1. `jsonwebtoken` 의존성이 필요하다 — 이 프로젝트엔 설치돼 있지 않고, 세션도 JWT 를
 *     쓰지 않기로 확정됐다(T-009 B1). 로그인 하나 붙이자고 새 서드파티를 들이지 않는다.
 *  2. 더 중요한 이유 — `core/state.js` 의 `verifyState` 는 **서명과 만료만** 본다.
 *     그러면 공격자가 자기 브라우저에서 받은 state 를 피해자에게 먹여도 통과한다
 *     (= 로그인 CSRF: 피해자를 공격자 계정으로 로그인시켜 활동을 관찰). 여기서는
 *     state 안의 nonce 를 **HttpOnly 쿠키에도 심어** 두 값이 같을 때만 통과시킨다.
 *
 * 포맷: `<payload(base64url JSON)>.<sig(base64url HMAC-SHA256)>`
 *
 * 서명 키는 `AUTH_SESSION_SECRET` 을 **그대로 쓰지 않고** 용도별 서브키를 유도한다.
 * 세션 쿠키와 같은 키로 다른 형식을 서명하면, 한쪽 포맷의 파싱 허점이 다른 쪽 위조로
 * 번질 수 있다(키 분리 원칙).
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** 용도 라벨 — 서브키를 가르는 값. 새 용도를 추가하면 라벨도 새로 만든다. */
export type TokenPurpose = 'oauth-state-v1' | 'oauth-pending-v1';

function subKey(secret: string, purpose: TokenPurpose): Buffer {
  return createHmac('sha256', secret).update(purpose, 'utf8').digest();
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Buffer {
  const norm = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = norm.length % 4 === 0 ? '' : '='.repeat(4 - (norm.length % 4));
  return Buffer.from(norm + pad, 'base64');
}

/** 예측 불가능한 nonce (state ↔ 쿠키 대조용). */
export function createNonce(): string {
  return randomBytes(16).toString('hex');
}

export interface SignedPayload {
  /** 만료 시각 (epoch ms) */
  exp: number;
  [k: string]: unknown;
}

export function signToken(
  secret: string,
  purpose: TokenPurpose,
  payload: SignedPayload,
): string {
  if (!secret) throw new Error('signToken: secret required');
  const body = b64urlEncode(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = b64urlEncode(createHmac('sha256', subKey(secret, purpose)).update(body, 'utf8').digest());
  return `${body}.${sig}`;
}

export type TokenFailReason = 'missing' | 'malformed' | 'bad_signature' | 'expired';

export type TokenVerifyResult<T> =
  | { ok: true; payload: T }
  | { ok: false; reason: TokenFailReason };

/**
 * 서명 → 파싱 → 만료 순으로 본다.
 * 서명이 틀린 토큰은 **파싱조차 하지 않는다** — 위조된 JSON 을 파싱 로직에 먹이지 않기 위함.
 */
export function verifyToken<T extends SignedPayload>(
  token: string | null | undefined,
  secret: string | null | undefined,
  purpose: TokenPurpose,
  nowMs: number = Date.now(),
): TokenVerifyResult<T> {
  if (!secret) return { ok: false, reason: 'missing' };
  if (!token) return { ok: false, reason: 'missing' };

  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return { ok: false, reason: 'malformed' };
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  let given: Buffer;
  try {
    given = b64urlDecode(sig);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  const expected = createHmac('sha256', subKey(secret, purpose)).update(body, 'utf8').digest();
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: 'bad_signature' };
  }

  let payload: T;
  try {
    payload = JSON.parse(b64urlDecode(body).toString('utf8')) as T;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'malformed' };
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
    return { ok: false, reason: 'malformed' };
  }
  if (nowMs >= payload.exp) return { ok: false, reason: 'expired' };

  return { ok: true, payload };
}
