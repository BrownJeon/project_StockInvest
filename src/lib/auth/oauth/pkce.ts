/**
 * T-088 — 앱 로그인 PKCE(RFC 7636 S256) 서버 쪽 형식·계산 (TheKaiwa `infra/auth/oauth/pkce.ts` 이식).
 *
 * 커스텀 스킴(`stockinvest://`)은 기기의 다른 앱도 등록할 수 있어 딥링크에 실린 코드가 가로채질 수 있다. 앱(WebView)은 로그인 시작 때
 * 만든 `verifier` 를 WebView 밖으로 내보내지 않고 `challenge = S256(verifier)` 만 **서명된 state** 로 운반한다. 코드를 가로챈 쪽은
 * verifier 가 없어 교환하지 못한다. 클라이언트 쪽 생성은 `src/lib/native/appLogin.ts`.
 *
 * 의존성: `node:crypto` 만(Edge 미들웨어에서 import 하지 않는다).
 */
import { createHash } from 'node:crypto';

/** base64url(sha256) = 패딩 없는 43자. */
export const PKCE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * verifier 형식. RFC 7636 §4.1 은 unreserved 43~128자를 허용하지만, 이 앱의 클라이언트는 항상 32바이트 랜덤의 base64url(43자)만 만든다.
 * 받아들이는 형식을 **실제로 만드는 형식 하나로** 좁힌다(더 엄격한 쪽 — 다른 모양의 값은 이 앱이 만든 것이 아니다).
 */
export const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isPkceChallenge(v: unknown): v is string {
  return typeof v === 'string' && PKCE_CHALLENGE_PATTERN.test(v);
}

export function isPkceVerifier(v: unknown): v is string {
  return typeof v === 'string' && PKCE_VERIFIER_PATTERN.test(v);
}

/** `S256(verifier)` = base64url(sha256(ascii(verifier))), 패딩 없음. */
export function pkceChallengeOf(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}
