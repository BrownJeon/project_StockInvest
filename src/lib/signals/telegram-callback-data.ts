/**
 * 텔레그램 인라인 버튼 `callback_data` 코덱 (T-042) — 서명·검증만 한다. db·notify import 없음.
 *
 * 형식: `si1:<동작>:<시그널ID>:<서명 16hex>`  (예: `si1:a:17546:0f3a…`) — 64바이트 제한 안.
 *   - 동작 `a` 승인 · `r` 거절 · `t` 자가 점검(거래 없음)
 *   - 접두 `si1` : 같은 봇을 쓰는 다른 프로젝트의 콜백과 구분한다. 모르는 접두는 **무시**한다(답하지도 않는다).
 *
 * ## 서명이 막는 것
 * 텔레그램 서버가 "누가 눌렀는지"는 보증하지만 `callback_data` 가 **우리가 만든 값인지**는 보증하지 않는다. 봇 토큰이
 * DB(`cred_*`)와 두 프로젝트의 환경변수에 있어 토큰 보유자는 임의 버튼이 달린 메시지를 소유자에게 보낼 수 있다. 서명 키를
 * 모르면 유효한 `a`(승인) 버튼을 만들 수 없다.
 * 서명은 **금액에도 묶여** 있다 — 서버가 눌린 시점에 DB 의 금액으로 다시 계산하므로, 버튼이 보여 준 금액과 지금 금액이
 * 다르면(시그널이 바뀐 경우) 검증에 실패한다.
 *
 * 키는 `AUTH_SESSION_SECRET` 에서 **용도별로 파생**한다(세션 쿠키 서명 키와 같은 값을 직접 쓰지 않는다).
 * 비밀이 없거나 짧으면 `null` — 호출처는 기능을 끈다(fail-closed).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const CALLBACK_PREFIX = 'si1';
export type CallbackAction = 'a' | 'r' | 't';

const PATTERN = /^si1:([art]):(\d{1,12}):([0-9a-f]{16})$/;

export function deriveApprovalKey(secret: string | undefined | null): Buffer | null {
  if (typeof secret !== 'string' || secret.trim().length < 16) return null;
  return createHmac('sha256', secret.trim()).update('stockinvest/telegram-approval/v1').digest();
}

function mac(key: Buffer, action: CallbackAction, signalId: number, amountKRW: number): string {
  return createHmac('sha256', key)
    .update(`${CALLBACK_PREFIX}|${action}|${signalId}|${Math.round(Number.isFinite(amountKRW) ? amountKRW : 0)}`)
    .digest('hex')
    .slice(0, 16);
}

export function encodeCallbackData(key: Buffer, action: CallbackAction, signalId: number, amountKRW: number): string {
  if (!Number.isInteger(signalId) || signalId < 0 || signalId > 999_999_999_999) {
    throw new Error(`invalid signalId for callback data: ${signalId}`);
  }
  return `${CALLBACK_PREFIX}:${action}:${signalId}:${mac(key, action, signalId, amountKRW)}`;
}

export interface ParsedCallback { action: CallbackAction; signalId: number; sig: string }

/** 우리 형식이 아니면 null (다른 프로젝트의 콜백이거나 깨진 값) — 호출처는 조용히 무시한다. */
export function parseCallbackData(data: unknown): ParsedCallback | null {
  if (typeof data !== 'string') return null;
  const m = PATTERN.exec(data);
  if (!m) return null;
  return { action: m[1] as CallbackAction, signalId: Number(m[2]), sig: m[3] };
}

/** 상수 시간 비교. `amountKRW` 는 **지금 DB 의 값**을 넘긴다. */
export function verifyCallbackData(key: Buffer, parsed: ParsedCallback, amountKRW: number): boolean {
  const expected = Buffer.from(mac(key, parsed.action, parsed.signalId, amountKRW), 'utf8');
  const given = Buffer.from(parsed.sig, 'utf8');
  return expected.length === given.length && timingSafeEqual(expected, given);
}
