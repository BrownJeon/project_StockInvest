/**
 * 무인증 공개 인증 경로의 요청 본문 상한 (T-008 reviewer HIGH 후속, 2026-08-07).
 *
 * `/api/auth/login`·`/api/auth/signup` 은 middleware 를 통과하는 공개 경로다.
 * App Router 의 `req.json()` 에는 Pages API 의 `bodyParser.sizeLimit` 같은 상한이 없고
 * `next.config.js` 에도 설정이 없어, 거대한 본문이 파싱 전에 메모리에 그대로 버퍼링된다.
 * pm2 `stockinvest` 는 `instances:1` · `max_memory_restart:512M` 이고
 * `stockinvest-cron` 이 이 웹 프로세스에 HTTP 로 의존하므로, 재시작은 곧 매매 스케줄 중단이다.
 *
 * 로그인·가입 본문은 필드 3개(이메일 255 + 비밀번호 200 + 초대코드)라 8KB 면 충분히 넉넉하다.
 *
 * ⚠️ 한계: `content-length` 가 없는 요청(chunked transfer-encoding)은 이 검사가 잡지 못한다.
 *    그 경우의 2차 방어선이 scrypt 직전의 길이 캡(`exceedsPasswordLengthCap`)이다.
 *    둘은 서로를 대체하지 않는다 — 하나는 버퍼링을, 하나는 KDF 비용을 막는다.
 */
import type { NextRequest } from 'next/server';

export const MAX_AUTH_BODY_BYTES = 8 * 1024;

/** content-length 가 상한을 넘는가. 헤더가 없거나 파싱 불가면 false(=여기서 막지 않음). */
export function isAuthBodyTooLarge(
  req: Pick<NextRequest, 'headers'>,
  maxBytes: number = MAX_AUTH_BODY_BYTES,
): boolean {
  const raw = req.headers.get('content-length');
  if (raw === null) return false;
  const len = Number(raw);
  if (!Number.isFinite(len)) return false;
  return len > maxBytes;
}
