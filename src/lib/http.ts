/**
 * 클라이언트 fetch 결과 판정 공통 헬퍼 (UI 전용).
 *
 * 배경(2026-08-06, T-007): 여러 변경 핸들러가 fetch 의 **네트워크 예외만** 잡고
 * HTTP 4xx/5xx 를 성공으로 취급해 실패한 동작을 성공으로 표시했다.
 * `/api/settings/strategies` 는 이미 400 을 반환하고 있었으므로 잠재 결함이 아니라
 * 실제로 살아있던 오표시였다.
 *
 * 판정 기준은 두 가지를 **모두** 본다:
 *  1. `res.ok` (HTTP 상태)
 *  2. 본문 `ok:false` — 이 코드베이스의 기존 관례(형제 설정 섹션들이 쓰는 방식)
 *
 * 던지지 않고 결과를 반환한다 — `Promise.all` 이 첫 실패에서 끊기지 않게 하기 위함.
 */

export type RequestFailure = {
  /** rejected: 서버에 닿았고 거부됨(사용자가 고칠 수 있는 정보) · network: 서버에 닿지 못함 */
  kind: 'rejected' | 'network';
  message: string;
};

export type RequestOutcome<T> =
  | { ok: true;  data: T }
  | { ok: false; failure: RequestFailure };

export async function requestJson<T = unknown>(
  url: string,
  init?: RequestInit,
): Promise<RequestOutcome<T>> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    return {
      ok: false,
      failure: { kind: 'network', message: '네트워크 오류로 요청하지 못했습니다. 연결을 확인하고 다시 시도하세요.' },
    };
  }

  let body: unknown = null;
  try { body = await res.json(); } catch { /* 비JSON 본문(에러 페이지 등) — 아래 상태코드로 판정 */ }

  const parsed = body as { ok?: boolean; error?: string } | null;

  // 본문 `ok:false` 는 **`error` 필드 유무와 무관하게** 거부다.
  // 사유 문자열의 truthiness 로 분기하면 `error` 없는 `{ok:false}` 가 성공으로 새는데,
  // 그 형태는 이미 이 코드베이스에 존재한다 — /api/cron/trade-report 는
  // 200 + `{ok:false, skipped:'channel_invalid'}` 로 응답한다.
  const bodyRejected = parsed?.ok === false;
  if (!res.ok || bodyRejected) {
    const reason = (bodyRejected ? parsed?.error : undefined) ?? '';
    const message = reason || (res.ok
      ? `서버가 요청을 거부했습니다 (응답 본문 ok:false, HTTP ${res.status})`
      : `서버가 요청을 거부했습니다 (HTTP ${res.status})`);
    return { ok: false, failure: { kind: 'rejected', message } };
  }
  return { ok: true, data: (body ?? {}) as T };
}
