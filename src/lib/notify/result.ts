/**
 * 알림 전송 결과 타입 + 전송 구현 공통 헬퍼.
 *
 * 배경(2026-08-06): `sendSlackAlert` / `sendTelegramAlert` 가 `Promise<void>` 라
 * 호출부가 성공과 실패를 구분할 수 없었다. 2026-08-04 08:03 정기 리포트가
 * `ETIMEDOUT` 으로 유실됐는데도 라우트는 `sent:true` 를 응답하고
 * `report_trade_last_sent_at` 까지 갱신해 흔적이 남지 않았다.
 *
 * **예외를 던지지 않고 결과 객체를 반환한다** — 기존 호출부(sendAlert 경유 fire-and-forget
 * 17곳 포함)의 동작을 바꾸지 않으면서 결과만 관측 가능하게 만들기 위함이다.
 */

export interface NotifyResult {
  /** 실제로 전달됐는가 (2xx 응답 수신). */
  ok: boolean;
  /**
   * 자격증명 미설정 등으로 **아예 시도하지 않음**.
   * 재시도해도 결과가 같으므로 호출부는 이것을 "재시도 가능한 실패"로 취급하면 안 된다.
   */
  skipped?: boolean;
  /** 실패 사유. 토큰·웹훅 URL 등 비밀값은 절대 포함하지 않는다(redactSecrets 경유). */
  error?: string;
}

export const NOTIFY_OK: NotifyResult = Object.freeze({ ok: true });
export const NOTIFY_SKIPPED: NotifyResult = Object.freeze({ ok: false, skipped: true });

export function notifyFailed(error: string): NotifyResult {
  return { ok: false, error };
}

/** 1회 재시도 가치가 있는 일시적 네트워크 오류인가. */
export function isTransientNetworkError(msg: string): boolean {
  return /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|aborted|UND_ERR/i.test(msg);
}

/**
 * 에러 문자열에서 비밀값 제거.
 *  - 호출부가 아는 비밀값(봇 토큰 / 웹훅 URL) 문자열 일치 제거
 *  - 텔레그램 `bot<숫자>:<토큰>` · Slack `hooks.slack.com/services/...` 패턴 제거
 */
export function redactSecrets(msg: string, ...secrets: string[]): string {
  let out = msg;
  for (const s of secrets) {
    if (s && s.length >= 8) out = out.split(s).join('***');
  }
  return out
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot***')
    .replace(/(hooks\.slack\.com\/services)\/\S+/g, '$1/***');
}

/** 실패 응답의 본문 일부(진단용). 읽기 실패는 빈 문자열. */
export async function readBodySnippet(res: Response, max = 200): Promise<string> {
  try {
    if (typeof res.text !== 'function') return '';
    const text = await res.text();
    return text ? text.slice(0, max).replace(/\s+/g, ' ').trim() : '';
  } catch {
    return '';
  }
}

/** undici 에러의 cause 코드(ETIMEDOUT 등) 추출. 없으면 빈 문자열. */
export function causeCodeOf(e: unknown): string {
  const cause = (e as { cause?: { code?: string; message?: string } })?.cause;
  if (!cause) return '';
  return String(cause.code ?? cause.message ?? '');
}
