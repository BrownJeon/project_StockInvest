/**
 * OAuth 가입 완료 게이트 — **순수 함수** (T-009 D1=A, 2026-08-08).
 *
 * `POST /api/auth/oauth-complete` 가 계정을 만들기 **전에** 통과해야 하는 관문 전부를 한 곳에 모았다.
 * 라우트는 이 함수가 `ok: true` 를 줄 때만 INSERT 를 호출한다 —
 * 그래서 **"초대코드가 틀리면 계정이 만들어지지 않는다"가 코드 구조로 보장**되고,
 * DB 없이 테스트로 고정할 수 있다.
 *
 * 검사 순서:
 *   1) 대기 토큰 (서명·만료) — 없으면 애초에 OAuth 인증을 거치지 않은 요청이다
 *   2) 이메일 검증 재확인 — 콜백에서 이미 걸렀지만 완료 시점에도 강제한다(이중 방어)
 *   3) 초대코드 — 기존 이메일 가입과 **같은 `SIGNUP_INVITE_CODE`** (D1: 공용 코드 1개)
 */
import { checkSignupInvite } from '@/lib/auth/signup-gate';
import { verifyPendingSignup, type PendingSignup } from '@/lib/auth/oauth/pending';

/** 실패 종류 — 라우트가 "시도 횟수를 셀지"를 이 값으로 판단한다. */
export type CompletionFailure = 'expired' | 'unverified' | 'invite';

export type CompletionResult =
  | { ok: true; pending: PendingSignup; inviteGate: 'invite_required' | 'open' }
  | { ok: false; reason: CompletionFailure; status: number; error: string };

/** 대기 토큰이 없거나 만료된 경우의 안내 — 처음부터 다시 하면 된다. */
const EXPIRED = {
  ok: false as const,
  reason: 'expired' as const,
  status: 400,
  error: '인증 정보가 만료되었습니다. 소셜 로그인을 다시 시도해 주세요',
};

/**
 * 1~2 단계만 (초대코드 제외).
 * 라우트가 **초대코드를 대조하기 전에** 시도 제한 키(이메일)를 알아야 해서 따로 노출한다.
 */
export function verifyPendingForCompletion(
  pendingToken: string | null | undefined,
  secret: string | null | undefined,
  nowMs: number = Date.now(),
): { ok: true; pending: PendingSignup } | { ok: false; reason: CompletionFailure; status: number; error: string } {
  const verified = verifyPendingSignup(pendingToken, secret, nowMs);
  if (!verified.ok) return { ok: false, reason: EXPIRED.reason, status: EXPIRED.status, error: EXPIRED.error };

  // 콜백이 이미 막았지만 여기서도 막는다. 이 한 줄이 빠지면 콜백 분기가 하나만 바뀌어도
  // 미검증 이메일 계정이 조용히 생성될 수 있다.
  if (verified.pending.emailVerified !== true) {
    return {
      ok: false,
      reason: 'unverified',
      status: 403,
      error: '이 소셜 계정의 이메일이 확인되지 않았습니다',
    };
  }
  return { ok: true, pending: verified.pending };
}

/**
 * 전체 관문 (1~3 단계). 계정 생성 직전에 이 함수 하나만 통과하면 된다 —
 * 라우트가 개별 검사를 조합하다 하나를 빠뜨리는 실수를 구조적으로 막는다.
 */
export function evaluateOAuthCompletion(args: {
  pendingToken: string | null | undefined;
  secret: string | null | undefined;
  inviteCode: unknown;
  nowMs?: number;
}): CompletionResult {
  const pre = verifyPendingForCompletion(args.pendingToken, args.secret, args.nowMs ?? Date.now());
  if (!pre.ok) return pre;

  const invite = checkSignupInvite(args.inviteCode);
  if (!invite.ok) return { ok: false, reason: 'invite', status: 403, error: invite.error };

  return { ok: true, pending: pre.pending, inviteGate: invite.gate };
}
