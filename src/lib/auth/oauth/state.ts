/**
 * OAuth CSRF state (T-009, 2026-08-08).
 *
 * 리다이렉트 시 nonce 를 만들어 **state 토큰과 HttpOnly 쿠키 양쪽에** 넣고,
 * 콜백에서 두 값이 같을 때만 통과시킨다(double submit). 서명만 검사하면
 * 공격자가 자기 브라우저에서 받은 state 를 피해자에게 먹이는 로그인 CSRF 를 막지 못한다.
 *
 * 유효기간 10분 — 제공자 동의 화면에 머무는 시간을 감안한 값이고, 그 이상은 필요 없다.
 */
import { OAUTH_PROVIDERS, type OAuthProviderName, isOAuthProviderName } from '@/lib/auth/oauth/names';
import { sanitizeNextPath } from '@/lib/auth/oauth/config';
import { timingSafeEqualStr } from '@/lib/auth/signup-gate';
import { createNonce, signToken, verifyToken, type SignedPayload } from '@/lib/auth/oauth/token';

/** state nonce 를 담는 쿠키. 콜백에서 1회 쓰고 즉시 지운다. */
export const OAUTH_STATE_COOKIE = 'si_oauth_state';

/** state 유효기간 (초) */
export const OAUTH_STATE_MAX_AGE_SEC = 10 * 60;

interface StatePayload extends SignedPayload {
  /** nonce — 쿠키의 값과 일치해야 한다 */
  n: string;
  /** 프로바이더 — 다른 프로바이더의 state 를 재사용하지 못하게 고정 */
  p: OAuthProviderName;
  /** 로그인 후 돌아갈 내부 경로 */
  r: string;
}

export interface CreatedState {
  /** 제공자에게 보낼 state 파라미터 */
  state: string;
  /** 쿠키에 심을 값 */
  nonce: string;
}

export function createOAuthState(
  secret: string,
  provider: OAuthProviderName,
  nextPath: string,
  nowMs: number = Date.now(),
): CreatedState {
  const nonce = createNonce();
  const payload: StatePayload = {
    n: nonce,
    p: provider,
    r: sanitizeNextPath(nextPath),
    exp: nowMs + OAUTH_STATE_MAX_AGE_SEC * 1000,
  };
  return { state: signToken(secret, 'oauth-state-v1', payload), nonce };
}

export type StateCheckFail =
  | 'missing'      // state 파라미터 또는 쿠키 없음
  | 'malformed'
  | 'bad_signature'
  | 'expired'
  | 'nonce_mismatch'   // 다른 브라우저에서 시작된 흐름 (로그인 CSRF 시도)
  | 'provider_mismatch';

export type StateCheckResult =
  | { ok: true; nextPath: string }
  | { ok: false; reason: StateCheckFail };

/**
 * 콜백에서의 state 검증.
 * @param state    쿼리스트링의 state
 * @param nonce    `si_oauth_state` 쿠키 값
 * @param provider URL 세그먼트의 프로바이더
 */
export function verifyOAuthState(
  state: string | null | undefined,
  nonce: string | null | undefined,
  provider: OAuthProviderName,
  secret: string | null | undefined,
  nowMs: number = Date.now(),
): StateCheckResult {
  const res = verifyToken<StatePayload>(state, secret, 'oauth-state-v1', nowMs);
  if (!res.ok) return { ok: false, reason: res.reason };

  const payload = res.payload;
  if (typeof payload.n !== 'string' || payload.n.length === 0) return { ok: false, reason: 'malformed' };
  if (!isOAuthProviderName(payload.p)) return { ok: false, reason: 'malformed' };
  if (payload.p !== provider) return { ok: false, reason: 'provider_mismatch' };
  if (typeof nonce !== 'string' || nonce.length === 0) return { ok: false, reason: 'missing' };
  // 이 인증 코드의 다른 모든 비밀값 비교와 동일하게 상수시간 비교를 쓴다
  // (`timingSafeEqualStr` — 양쪽을 SHA-256 으로 고정 길이화하므로 길이 정보도 새지 않는다).
  //
  // 여기서 타이밍이 실제로 악용되지는 않는다: `payload.n` 은 이미 HMAC 검증을 통과한 값이라
  // 공격자가 내용을 조종할 수 없다. 그럼에도 맞추는 이유는 **일관성**이다 — 상수시간 비교로
  // 둘러싸인 보안 모듈에서 이 줄만 `!==` 면, 다음에 읽는 사람이 "여기선 그래도 된다"고
  // 오해해 복사하거나, 반대로 놓친 의도가 있다고 헛짚는다.
  if (!timingSafeEqualStr(nonce, payload.n)) {
    return { ok: false, reason: 'nonce_mismatch' };
  }

  return { ok: true, nextPath: sanitizeNextPath(payload.r) };
}

/** 지원 프로바이더 전체 목록 재노출 (라우트에서 목록 검증에 쓴다). */
export { OAUTH_PROVIDERS };
