/**
 * 초대코드 대기 상태 (T-009 D1=A, 2026-08-08).
 *
 * **핵심 보증: 초대코드가 틀리면 계정이 만들어지지 않는다.**
 * 그러려면 OAuth 인증 성공 시점에 계정을 만들면 안 된다. 대신 검증된 신원을
 * 짧은 수명 서명 토큰에 담아 HttpOnly 쿠키로 들려 보내고, 초대코드가 통과한
 * `POST /api/auth/oauth-complete` 에서 **처음으로** INSERT 한다.
 *
 * 왜 쿠키에 담고 DB 에 임시행을 만들지 않는가:
 *   - 임시행을 만들면 "가입 안 된 계정"이 users 에 남아 중복 이메일·통계가 오염된다
 *   - 코드 오입력·이탈 시 청소 작업(cron)이 또 필요해진다
 *   - 서명 토큰은 만료되면 그냥 사라진다 — 정리할 상태가 없다
 *
 * 쿠키는 HttpOnly 라 JS 가 못 읽는다. 화면이 "누구로 인증했는지" 보여줘야 하므로
 * `GET /api/auth/oauth-pending` 이 표시용 요약(provider·email)만 돌려준다.
 *
 * 유효기간 15분 — 초대코드를 찾아 입력하기엔 넉넉하고, 탈취된 쿠키의 수명은 짧게.
 */
import { isOAuthProviderName, type OAuthProviderName } from '@/lib/auth/oauth/names';
import { sanitizeNextPath } from '@/lib/auth/oauth/config';
import { signToken, verifyToken, type SignedPayload } from '@/lib/auth/oauth/token';
import type { OAuthProfile } from '@/lib/auth/oauth/provider-types';

export const OAUTH_PENDING_COOKIE = 'si_oauth_pending';

export const OAUTH_PENDING_MAX_AGE_SEC = 15 * 60;

interface PendingPayload extends SignedPayload {
  p: OAuthProviderName;
  /** providerId */
  i: string;
  /** email (정규화 완료) */
  e: string;
  /** 표시용 이름 */
  nm: string;
  /** emailVerified — 토큰에도 실어 완료 시점에 다시 강제한다 */
  v: boolean;
  /** 가입 후 돌아갈 내부 경로 */
  r: string;
}

export interface PendingSignup {
  provider: OAuthProviderName;
  providerId: string;
  email: string;
  name: string;
  emailVerified: boolean;
  nextPath: string;
}

export function signPendingSignup(
  secret: string,
  provider: OAuthProviderName,
  profile: OAuthProfile,
  nextPath: string,
  nowMs: number = Date.now(),
): string {
  const payload: PendingPayload = {
    p: provider,
    i: profile.providerId,
    e: profile.email,
    nm: profile.name,
    v: profile.emailVerified === true,
    r: sanitizeNextPath(nextPath),
    exp: nowMs + OAUTH_PENDING_MAX_AGE_SEC * 1000,
  };
  return signToken(secret, 'oauth-pending-v1', payload);
}

export type PendingFailReason = 'missing' | 'malformed' | 'bad_signature' | 'expired';

export type PendingVerifyResult =
  | { ok: true; pending: PendingSignup }
  | { ok: false; reason: PendingFailReason };

export function verifyPendingSignup(
  token: string | null | undefined,
  secret: string | null | undefined,
  nowMs: number = Date.now(),
): PendingVerifyResult {
  const res = verifyToken<PendingPayload>(token, secret, 'oauth-pending-v1', nowMs);
  if (!res.ok) return { ok: false, reason: res.reason };

  const p = res.payload;
  if (!isOAuthProviderName(p.p)) return { ok: false, reason: 'malformed' };
  if (typeof p.i !== 'string' || p.i.length === 0) return { ok: false, reason: 'malformed' };
  if (typeof p.e !== 'string' || p.e.length === 0) return { ok: false, reason: 'malformed' };

  return {
    ok: true,
    pending: {
      provider: p.p,
      providerId: p.i,
      email: p.e,
      name: typeof p.nm === 'string' && p.nm.length > 0 ? p.nm : p.e,
      // 서명 토큰이라 위조는 불가능하지만, 타입이 어긋난 값이 true 로 통과하지 않게 `=== true`.
      emailVerified: p.v === true,
      nextPath: sanitizeNextPath(p.r),
    },
  };
}
