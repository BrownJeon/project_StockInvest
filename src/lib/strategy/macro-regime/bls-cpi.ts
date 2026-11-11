/**
 * T-165 — BLS Public Data API v1 에서 CPI(CUUR0000SA0) 지수를 받는 수집기.
 *
 * ## 경계 (Analyst §8 · Leader G2)
 * - URL 상수 1개, 호스트 allowlist `api.bls.gov` · https 만 · `redirect: 'error'`(리다이렉트 불허).
 *   API 키 없음(v1, 미등록 일 25쿼리). 연도 미지정 GET = 당해 포함 3개 연도(36개월) — 기준월과
 *   12개월 전이 항상 들어 있다.
 * - 타임아웃 5초(헤더+본문 전체 마감, 타이머 `unref`) · 응답 상한 64KB(**스트림으로 읽으며** 초과 즉시
 *   중단 — Content-Length 만 믿지 않는다).
 * - 응답 검증: `status === "REQUEST_SUCCEEDED"`, `Results.series[0].seriesID === "CUUR0000SA0"`,
 *   `data[]` 각 원소 `year` 4자리 · `period` `M01`~`M12`(`M13` 연평균 행은 건너뜀) · `value` 숫자 또는 `"-"`.
 *   `"-"` 는 그 달 결측(null, 예: 2025-10 미공표). 그 밖의 값은 형식 변경으로 보고 응답 전체를 `bad_schema`.
 *   또 **사용 가능한 YoY 쌍**(어떤 월 M 과 M−12 가 모두 양의 유한 숫자)이 하나도 없으면 `bad_schema`(C2-1) —
 *   한 달짜리·결측뿐인 응답이 `ok` 로 정상 캐시를 덮어쓰지 않게 한다(2025-10 같은 결측이 섞인 정상 응답은 통과).
 * - **절대 throw 하지 않는다.** 실패는 `fetchStatus` 코드로만 돌려준다(캐시 보존은 `snapshot.ts` 몫).
 * - 🔴 시험 환경 실호출 차단(G2): `fetchImpl` 을 주입하지 않은 기본 경로는 jest(`NODE_ENV=test` 또는
 *   `JEST_WORKER_ID`)에서 네트워크로 나가지 않고 `disabled_in_test` 로 즉시 끝난다. 운영 동작은 그대로다.
 */
import { CPI_SERIES_ID, type BlsFetchStatus, type CpiIndexByMonth } from './types';

export const BLS_CPI_URL = 'https://api.bls.gov/publicAPI/v1/timeseries/data/CUUR0000SA0';
export const BLS_ALLOWED_HOST = 'api.bls.gov';
export const BLS_TIMEOUT_MS = 5_000;
export const BLS_MAX_RESPONSE_BYTES = 64 * 1024;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface BlsFetchResult {
  fetchStatus: BlsFetchStatus;
  /** fetchStatus === 'ok' 일 때만 있다 */
  observations?: CpiIndexByMonth;
  httpStatus?: number;
  bytes?: number;
}

export interface FetchBlsCpiOptions {
  /** 시험용 주입. 생략하면 전역 fetch(시험 환경에서는 차단) */
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxBytes?: number;
}

/** jest 등 시험 실행 중인가 — 기본 수집 경로의 실호출 차단 조건 */
export function isTestEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'test' || typeof env.JEST_WORKER_ID === 'string';
}

/** allowlist — https + 정확히 api.bls.gov(포트·자격증명 없음) */
export function isAllowedBlsUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && u.hostname === BLS_ALLOWED_HOST && u.port === ''
      && u.username === '' && u.password === '';
  } catch {
    return false;
  }
}

class Abort extends Error {}

/**
 * BLS 에서 CPI 지수를 받는다. 결과는 항상 resolve 된다(reject·throw 0).
 */
export async function fetchBlsCpi(opts: FetchBlsCpiOptions = {}): Promise<BlsFetchResult> {
  try {
    if (!opts.fetchImpl && isTestEnvironment()) return { fetchStatus: 'disabled_in_test' };
    const fetchImpl: FetchLike | undefined = opts.fetchImpl
      ?? (typeof globalThis.fetch === 'function' ? (u, i) => globalThis.fetch(u, i) : undefined);
    if (!fetchImpl || !isAllowedBlsUrl(BLS_CPI_URL)) return { fetchStatus: 'internal_error' };
    const timeoutMs = positiveOr(opts.timeoutMs, BLS_TIMEOUT_MS);
    const maxBytes = positiveOr(opts.maxBytes, BLS_MAX_RESPONSE_BYTES);
    return await boundedFetch(fetchImpl, timeoutMs, maxBytes);
  } catch {
    return { fetchStatus: 'internal_error' };
  }
}

function positiveOr(v: number | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
}

async function boundedFetch(fetchImpl: FetchLike, timeoutMs: number, maxBytes: number): Promise<BlsFetchResult> {
  const controller = new AbortController();
  let timedOut = false;
  let rejectAbort: ((e: Error) => void) | undefined;
  // 주입된/비협조적인 fetch 가 signal 을 무시해도 마감을 지키도록 매 await 를 이 promise 와 경주시킨다.
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  aborted.catch(() => {}); // 경주에 아직 걸리지 않은 상태에서 reject 돼도 unhandledRejection 이 나지 않게
  const timer = setTimeout(() => {
    timedOut = true;
    try { controller.abort(); } catch { /* ignore */ }
    rejectAbort?.(new Abort('timeout'));
  }, timeoutMs);
  (timer as { unref?: () => void }).unref?.();

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    let res: Response;
    try {
      res = await Promise.race([
        fetchImpl(BLS_CPI_URL, {
          method: 'GET',
          redirect: 'error',
          cache: 'no-store',
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        }),
        aborted,
      ]);
    } catch {
      return { fetchStatus: timedOut ? 'timeout' : 'network_error' };
    }
    const httpStatus = typeof res?.status === 'number' ? res.status : 0;
    if (!res || !res.ok) {
      cancelQuietly(res);
      return { fetchStatus: 'http_error', httpStatus };
    }
    const declared = res.headers?.get?.('content-length') ?? null;
    if (declared !== null && (!/^\d+$/.test(declared.trim()) || Number(declared) > maxBytes)) {
      cancelQuietly(res);
      return { fetchStatus: 'too_large', httpStatus };
    }

    const chunks: Uint8Array[] = [];
    let bytes = 0;
    if (res.body) {
      reader = res.body.getReader();
      for (;;) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await Promise.race([reader.read(), aborted]);
        } catch {
          // C2-2 — signal 을 무시하는 본문 스트림도 닫히게 best-effort 취소(거절은 흡수, 기다리지 않는다)
          try { void reader.cancel().catch(() => {}); } catch { /* ignore */ }
          return { fetchStatus: timedOut ? 'timeout' : 'network_error', httpStatus, bytes };
        }
        if (chunk.done) break;
        const value = chunk.value;
        const len = value?.byteLength ?? 0;
        bytes += len;
        if (bytes > maxBytes) {
          void reader.cancel().catch(() => {});
          return { fetchStatus: 'too_large', httpStatus, bytes };
        }
        if (len > 0) chunks.push(value);
      }
    }

    let json: unknown;
    try {
      json = JSON.parse(Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)), bytes).toString('utf8'));
    } catch {
      return { fetchStatus: 'bad_json', httpStatus, bytes };
    }
    const parsed = parseBlsCpiResponse(json);
    if (!parsed.ok) return { fetchStatus: parsed.status, httpStatus, bytes };
    return { fetchStatus: 'ok', observations: parsed.observations, httpStatus, bytes };
  } catch {
    return { fetchStatus: timedOut ? 'timeout' : 'internal_error' };
  } finally {
    clearTimeout(timer);
    try { reader?.releaseLock(); } catch { /* 취소된 스트림 — 무시 */ }
  }
}

function cancelQuietly(res: Response | undefined): void {
  try { void res?.body?.cancel().catch(() => {}); } catch { /* ignore */ }
}

export type ParseBlsResult =
  | { ok: true; observations: CpiIndexByMonth }
  | { ok: false; status: 'bad_schema' | 'request_failed_status' };

const YEAR_RE = /^\d{4}$/;
const PERIOD_RE = /^M(0[1-9]|1[0-2])$/;
const VALUE_RE = /^\d+(\.\d+)?$/;

/**
 * BLS v1 응답 JSON → 기준월('YYYY-MM') → 지수 맵. 검증 실패는 status 로 돌려준다(throw 0).
 * 빈 data(유효 월 0개)·사용 가능한 YoY 쌍 0개는 `bad_schema` — 빈·짧은 응답으로 기존 캐시를 덮어쓰지 않기 위해서다.
 */
export function parseBlsCpiResponse(json: unknown): ParseBlsResult {
  try {
    if (!isObj(json)) return { ok: false, status: 'bad_schema' };
    if (json.status !== 'REQUEST_SUCCEEDED') return { ok: false, status: 'request_failed_status' };
    const results = json.Results;
    if (!isObj(results) || !Array.isArray(results.series) || results.series.length < 1) {
      return { ok: false, status: 'bad_schema' };
    }
    const series = results.series[0];
    if (!isObj(series) || series.seriesID !== CPI_SERIES_ID || !Array.isArray(series.data)) {
      return { ok: false, status: 'bad_schema' };
    }
    const out: Record<string, number | null> = Object.create(null);
    let count = 0;
    for (const row of series.data as unknown[]) {
      if (!isObj(row)) return { ok: false, status: 'bad_schema' };
      const { year, period, value } = row;
      if (typeof year !== 'string' || !YEAR_RE.test(year)) return { ok: false, status: 'bad_schema' };
      if (period === 'M13') continue; // 연평균 행 — 월 값이 아니다
      if (typeof period !== 'string' || !PERIOD_RE.test(period)) return { ok: false, status: 'bad_schema' };
      if (typeof value !== 'string') return { ok: false, status: 'bad_schema' };
      let v: number | null;
      if (value.trim() === '-') v = null;
      else if (VALUE_RE.test(value.trim())) {
        v = Number(value.trim());
        if (!Number.isFinite(v) || v <= 0) return { ok: false, status: 'bad_schema' };
      } else return { ok: false, status: 'bad_schema' };
      const key = `${year}-${period.slice(1)}`;
      if (key in out && out[key] !== v) return { ok: false, status: 'bad_schema' }; // 같은 달 상충
      if (!(key in out)) count++;
      out[key] = v;
    }
    if (count === 0) return { ok: false, status: 'bad_schema' };
    if (!hasUsableYoyPair(out)) return { ok: false, status: 'bad_schema' }; // C2-1
    // 일반 객체로 복사(프로토타입 없는 객체를 그대로 기록·직렬화해도 되지만 비교·디버깅 편의상)
    return { ok: true, observations: Object.freeze({ ...out }) };
  } catch {
    return { ok: false, status: 'bad_schema' };
  }
}

/** 어떤 월 M 과 M−12(같은 달 전년) 가 모두 양의 유한 숫자인 쌍이 하나라도 있는가 */
function hasUsableYoyPair(map: Record<string, number | null>): boolean {
  for (const key of Object.keys(map)) {
    const v = map[key];
    if (typeof v !== 'number' || !(v > 0)) continue;
    const base = `${String(Number(key.slice(0, 4)) - 1).padStart(4, '0')}-${key.slice(5, 7)}`;
    const b = map[base];
    if (typeof b === 'number' && Number.isFinite(b) && b > 0) return true;
  }
  return false;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
