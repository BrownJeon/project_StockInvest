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

// ─────────────────────────────────────────────────────────────────────────────
// T-175 WP-3 — 예외의 원인 사슬(진단 로그용)
// ─────────────────────────────────────────────────────────────────────────────

const CAUSE_MAX_DEPTH = 4;
const CAUSE_MAX_ERRORS = 6;

interface ErrorBag {
  code?: unknown; syscall?: unknown; hostname?: unknown; address?: unknown; port?: unknown;
  name?: unknown; message?: unknown; cause?: unknown; errors?: unknown;
}

/** 비밀값·URL 쿼리스트링·제어문자 제거 + 길이 제한 */
function scrubDiag(s: string, secrets: string[]): string {
  return redactSecrets(s, ...secrets)
    .replace(/\?[^\s'"<>()[\]]*/g, '?***')          // URL 쿼리(appkey·token 등)가 섞여도 통째로 가린다
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .trim()
    .slice(0, 160);
}

const isObj = (x: unknown): x is ErrorBag => x !== null && (typeof x === 'object' || typeof x === 'function');

/** 한 노드 요약: `code syscall hostname address:port`. 그 넷이 다 없으면(withMessage) `name: message`. */
function nodeSummary(x: unknown, secrets: string[], withMessage: boolean): string {
  if (!isObj(x)) return x === undefined || x === null ? '' : scrubDiag(String(x), secrets);
  const parts: string[] = [];
  if (typeof x.code === 'string' || typeof x.code === 'number') parts.push(String(x.code));
  if (typeof x.syscall === 'string') parts.push(x.syscall);
  if (typeof x.hostname === 'string') parts.push(x.hostname);
  if (typeof x.address === 'string') {
    parts.push(typeof x.port === 'number' || typeof x.port === 'string' ? `${x.address}:${x.port}` : x.address);
  }
  if (parts.length === 0 && withMessage) {
    const name = typeof x.name === 'string' ? x.name : '';
    const msg = typeof x.message === 'string' ? x.message : '';
    return scrubDiag([name, msg].filter(Boolean).join(': '), secrets);
  }
  return scrubDiag(parts.join(' '), secrets);
}

function errorsSummary(x: unknown, secrets: string[]): string {
  if (!isObj(x) || !Array.isArray(x.errors) || x.errors.length === 0) return '';
  const items = x.errors.slice(0, CAUSE_MAX_ERRORS).map((e) => nodeSummary(e, secrets, true) || '?');
  const more = x.errors.length > CAUSE_MAX_ERRORS ? `, … +${x.errors.length - CAUSE_MAX_ERRORS}` : '';
  return `[${items.join(', ')}${more}]`;
}

/**
 * 예외에서 **어느 연결이 왜 실패했는지**를 한 줄로 뽑는다(로그 전용 — 응답 본문에 싣지 않는다).
 *
 * undici `fetch failed` 는 message 가 늘 같아 어느 호스트인지 알 수 없다. 실제 정보는 `cause` 에 있다 —
 * Happy Eyeballs 실패면 `cause` 가 AggregateError(code ETIMEDOUT)이고 `errors[]` 에 주소별 ETIMEDOUT·ENETUNREACH 가 있다.
 * 예: `cause=ETIMEDOUT cause.errors=[ETIMEDOUT connect 149.154.166.110:443, ENETUNREACH connect 2001:67c:4e8:f004::9:443]`.
 *
 * - 최상위 `code`·`errors`, `cause` 사슬(깊이 4)·각 단계의 `errors`(6개)를 본다. 순환 참조 안전.
 * - Error 가 아닌 값이 던져졌으면 `thrown=<typeof>`(값 자체는 호출부가 이미 String 으로 찍는다).
 * - 비밀값: `redactSecrets`(+ 호출부가 아는 비밀 문자열) · URL 쿼리스트링 전체 가림 · 제어문자 제거.
 * - 원인 정보가 없으면 ''.
 */
export function describeErrorCause(e: unknown, ...secrets: string[]): string {
  if (!isObj(e)) return `thrown=${e === null ? 'null' : typeof e}`;
  const out: string[] = [];
  const top = nodeSummary(e, secrets, false);
  if (top) out.push(`code=${top}`);
  const topErrs = errorsSummary(e, secrets);
  if (topErrs) out.push(`errors=${topErrs}`);

  const seen = new Set<unknown>([e]);
  let c: unknown = e.cause;
  for (let depth = 1; depth <= CAUSE_MAX_DEPTH && c !== undefined && c !== null && !seen.has(c); depth++) {
    seen.add(c);
    const label = depth === 1 ? 'cause' : `cause${depth}`;
    const node = nodeSummary(c, secrets, true);
    if (node) out.push(`${label}=${node}`);
    const errs = errorsSummary(c, secrets);
    if (errs) out.push(`${label}.errors=${errs}`);
    c = isObj(c) ? c.cause : undefined;
  }
  return out.join(' ');
}
