/**
 * T-087 (T-081 WP-D1a) — 브로커 체결 원장 수집용 KIS **읽기 전용 GET** 조회의 공통 페이지 루프.
 *
 * 설계 정본: `docs/design/2026-10-25-wpd-broker-fills-design.md` v3.1 §3.4·§3.5·§3.6.
 * 이 파일과 `kis-domestic-ledger.ts`·`kis-overseas-ledger.ts` 는 **조회 TR 만** 부른다. 주문·취소·정정 경로와 코드를 공유하지 않는다
 * (정적 시험 `__tests__/kis-ledger-static.test.ts` 가 주문 TR 문자열·POST 를 봉인한다).
 *
 * ## 왜 기존 `getCompletedOrders`·`getBalances` 를 쓰지 않는가
 * 기존 함수는 order-sync·킬스위치·스냅샷 경로의 입력이고 반환 형식·실패 의미(던짐)가 그 소비자에 맞춰 고정돼 있다
 * (`getCompletedOrders` 는 종목 지정·체결만·연속조회 신호면 던짐). 원장 수집은 전 종목·전체(체결+미체결)·연속조회 추적·
 * "받은 행은 남기고 불완전으로 닫기"가 필요해 의미가 다르다. 기존 함수 본문은 건드리지 않고 이 모듈을 새로 둔다.
 *
 * ## 결과 의미 (fail-closed — 설계 §3.5)
 *  - `ended`     : 마지막 페이지 응답의 `tr_cont` 가 계속(M/F)이 아니었다. **완전하다는 뜻이 아니다** — `complete` 판정은
 *                  `@/lib/broker-ledger/normalize` 의 `assessRunCompleteness`(tr_cont 명시·합계 대조·중복 0·호출 ≥1)가 한다.
 *  - `truncated` : 1페이지 이상 받은 뒤 멈췄다(페이지 상한·호출 상한·시간 예산·중간 페이지 실패·연속 키 없음/정체·모르는 tr_cont).
 *                  받은 행은 사실이므로 돌려준다 → 수집기는 `incomplete`.
 *  - `failed`    : 첫 응답부터 실패(rt_cd≠0·HTTP 오류·레이트리밋 소진·네트워크·인증·계좌 없음·지문 키 없음). 행 0.
 *  - `skipped`   : KIS 를 부르지 않았다(국내 3개월 TR 의 85일 밖 창 — L-c). 수집기는 run 행을 쓰지 않는다.
 *
 * ## 민감정보
 *  - 계좌번호는 요청 파라미터에만 쓰고 결과 객체에 넣지 않는다. 지문은 호출자가 넘긴 `fingerprint()`(서버 비밀 HMAC)가 만든다.
 *  - `error` 는 사유 코드 + `rt_cd`/`msg_cd`/HTTP 상태만 담는다. KIS `msg1` 원문·응답 본문은 넣지 않는다.
 *  - 행 원문(`rows`)에는 KIS 가 준 개인·단말 필드가 남아 있을 수 있다 — 저장 전 `sanitizeRawRow` 를 거쳐야 한다(normalize 가 한다).
 */
import { getKisToken, kisBaseUrl } from './kis-auth';
import { getCredential } from '@/lib/credentials';
import { isKisRateLimited, kisBodyText, kisAttempts } from './kis-http';
import { shouldRetryAfterTokenError } from './kis-token-retry';

export type LedgerMarket = 'domestic' | 'overseas';
export type LedgerKind = 'fills' | 'realized_pnl' | 'position_snapshot';
export type LedgerFetchOutcome = 'ended' | 'truncated' | 'failed' | 'skipped';

/** 설계 §3.5 제안값 — 페이지 상한 30. */
export const LEDGER_MAX_PAGES = 30;
/** 설계 §3.6 L-8 — KIS 호출 상한은 run(= 이 함수 한 번) 당 12. 토큰 재발급 재시도·kisFetch 레이트리밋 재시도도 실제 호출이라 센다. */
export const LEDGER_MAX_CALLS = 12;
/** 설계 §3.6 — 통신 구간 타임아웃(토큰 획득 이후부터). */
export const LEDGER_TIMEOUT_MS = 20_000;

export interface LedgerQueryOptions {
  /**
   * 계좌 지문 함수. 입력은 `${CANO}-${ACNT_PRDT_CD}`(설계 §2.3), 출력은 16자리 소문자 hex 또는 `null`(서버 비밀 키 없음).
   * 계좌 원문은 이 함수 밖으로 나가지 않는다 — 결과에는 지문만 담긴다. `null`·형식 이상·예외면 **KIS 를 부르지 않고** `failed`.
   */
  fingerprint: (accountIdentity: string) => string | null;
  /** 페이지 상한(기본 {@link LEDGER_MAX_PAGES}). */
  maxPages?: number;
  /** KIS 호출 상한(기본 {@link LEDGER_MAX_CALLS}). */
  maxCalls?: number;
  /** 이 시각(epoch ms)을 넘기면 다음 페이지를 요청하지 않는다(라우트 예산 75초 — 수집기가 넘긴다). */
  deadlineMs?: number;
  /** 시험용 시계. 기본 `Date.now`. 국내 85일 창 판정·스냅샷 조회일·시간 예산에 쓴다. */
  now?: () => number;
}

export interface LedgerQueryResult {
  market: LedgerMarket;
  kind: LedgerKind;
  /** 실제로 보낸 TR ID(실전 `T…`/모의 `V…`). runs.source_tr 에 그대로 쓴다. */
  trId: string;
  /** 실제로 KIS 에 보낸 조회 범위(KST 날짜 `YYYY-MM-DD`). 스냅샷은 조회일 하루. */
  queryFrom: string;
  queryTo: string;
  outcome: LedgerFetchOutcome;
  /** 사유 코드(계좌·키·본문 원문 없음). `ended` 이면 null. */
  error: string | null;
  /** 받은 페이지들의 행 원문(순서 보존). 민감 필드 제거 전이다. */
  rows: Record<string, unknown>[];
  /** 페이지별 요약 블록 원문(국내 output2·해외 기간손익 output2·해외 잔고 output3). 해외 체결은 없음. */
  summaries: unknown[];
  /** 정상 수신한 페이지 수. */
  pages: number;
  /** 실제로 나간 KIS HTTP 시도 수(토큰 재발급 재시도·레이트리밋 백오프 재시도 포함). */
  kisCalls: number;
  /** 마지막으로 정상 수신한 페이지 응답 헤더 `tr_cont`(앞뒤 공백 제거, 빈 값·없음 = null). */
  lastTrCont: string | null;
  /** 레이트리밋 재시도 소진으로 멈췄는가. 수집기는 이 실행 안에서 추가 재시도하지 않는다(`isKisRateLimited` 규약). */
  rateLimited: boolean;
  /** `fingerprint()` 결과. 계좌 없음·키 없음이면 null. */
  accountFingerprint: string | null;
}

/** 연속조회 키 — 요청 파라미터 이름과, 응답 본문에서 다음 페이지 값을 읽을 키 이름. */
export interface LedgerContinuation {
  requestFk: string;
  requestNk: string;
  responseFk: string;
  responseNk: string;
}

export interface LedgerQuerySpec {
  market: LedgerMarket;
  kind: LedgerKind;
  trId: string;
  path: string;
  /**
   * 한 페이지 요청. 각 어댑터가 kisFetch 호출(priority bulk · timeoutMs LEDGER_TIMEOUT_MS · 코드 상수 label)을 감싸서 넘긴다
   * — label 을 호출부에 리터럴로 두어야 T-040 가드 시험(kis-http-usage.test.ts: 호출마다 리터럴 label, KIS_LABELS 일치)이 이 호출을 센다.
   */
  fetchPage: (url: string, headers: Record<string, string>) => Promise<Response>;
  /** 계좌 외 요청 파라미터(순서 유지). 연속 키는 빈 값으로 넣어 둔다. */
  params: Record<string, string>;
  rowsKey: string;
  /** 행 키가 없을 때 대신 볼 키(국내 체결 `output1 ?? output` 처럼 기존 어댑터와 같은 폴백). */
  rowsFallbackKey?: string;
  summaryKey?: string;
  /** 연속조회를 지원하지 않는 TR(해외 잔고 CTRP6504R)은 undefined — M/F 가 오면 `truncated`. */
  continuation?: LedgerContinuation;
  queryFrom: string;
  queryTo: string;
}

const isMockEnv = (): boolean => String(process.env.KIS_MOCK ?? 'true').toLowerCase() === 'true';

/** 실전/모의 TR ID 선택 — 기존 어댑터와 같은 규칙(`KIS_MOCK` 기본 true). */
export function ledgerTrId(real: string, mock: string): string {
  return isMockEnv() ? mock : real;
}

export function ledgerIsMock(): boolean {
  return isMockEnv();
}

async function ledgerHeaders(trId: string, extra?: Record<string, string>): Promise<Record<string, string>> {
  const [token, appkey, appsecret] = await Promise.all([
    getKisToken(),
    getCredential('KIS_APP_KEY'),
    getCredential('KIS_APP_SECRET'),
  ]);
  return {
    'Content-Type': 'application/json; charset=utf-8',
    Authorization:  `Bearer ${token}`,
    appkey,
    appsecret,
    tr_id:          trId,
    custtype:       'P',
    ...extra,
  };
}

const FINGERPRINT_RE = /^[0-9a-f]{16}$/;

/** 오류 코드 문자열에 넣을 수 있는 짧은 식별자만 남긴다(영숫자·_·- 최대 16자). */
function safeCode(v: unknown): string {
  const s = typeof v === 'string' ? v : v == null ? '' : String(v);
  const t = s.replace(/[^0-9A-Za-z_-]/g, '').slice(0, 16);
  return t || '-';
}

function readCtx(data: Record<string, unknown>, key: string): string | null {
  const v = data[key] ?? data[key.toUpperCase()];
  return typeof v === 'string' ? v : null;
}

/** KST(UTC+9) 날짜 `YYYY-MM-DD`. */
export function kstDateOf(ms: number): string {
  return new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` 가 실제 달력 날짜이고 2000~2100 범위인가(DDL 날짜 CHECK 와 같은 범위). */
export function isLedgerDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const y = Number(s.slice(0, 4)), m = Number(s.slice(5, 7)), d = Number(s.slice(8, 10));
  if (y < 2000 || y > 2100) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** `YYYY-MM-DD` ± n 일. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` → KIS 요청 형식 `YYYYMMDD`. */
export function toKisDate(date: string): string {
  return date.replace(/-/g, '');
}

/** 조회 범위 입력 검증 — 잘못된 값은 프로그램 오류라 던진다(KIS 를 부르지 않는다). */
export function assertQueryRange(from: string, to: string): void {
  if (!isLedgerDate(from) || !isLedgerDate(to)) throw new RangeError(`조회 날짜 형식 오류(YYYY-MM-DD, 2000~2100): ${String(from)}~${String(to)}`);
  if (from > to) throw new RangeError(`조회 시작일이 종료일보다 늦다: ${from}~${to}`);
}

function baseResult(spec: LedgerQuerySpec): LedgerQueryResult {
  return {
    market: spec.market, kind: spec.kind, trId: spec.trId,
    queryFrom: spec.queryFrom, queryTo: spec.queryTo,
    outcome: 'failed', error: null, rows: [], summaries: [], pages: 0, kisCalls: 0,
    lastTrCont: null, rateLimited: false, accountFingerprint: null,
  };
}

/** KIS 를 부르지 않은 결과(국내 85일 창 밖 — L-c). */
export function skippedLedgerResult(spec: LedgerQuerySpec, error: string): LedgerQueryResult {
  return { ...baseResult(spec), outcome: 'skipped', error };
}

/**
 * 공통 페이지 루프. **던지지 않는다**(입력 검증은 호출 전에 끝난다) — KIS·네트워크·인증·스로틀 실패는 전부 결과의 outcome/error 로 돌려준다.
 */
export async function runLedgerQuery(spec: LedgerQuerySpec, opts: LedgerQueryOptions): Promise<LedgerQueryResult> {
  const out = baseResult(spec);
  const maxPages = opts.maxPages ?? LEDGER_MAX_PAGES;
  const maxCalls = opts.maxCalls ?? LEDGER_MAX_CALLS;
  const now = opts.now ?? Date.now;

  /** 첫 페이지 전이면 failed(행 0), 이후면 truncated(받은 행 유지). */
  const stop = (error: string): LedgerQueryResult => {
    if (out.pages === 0) {
      out.outcome = 'failed';
      out.rows = [];
      out.summaries = [];
    } else {
      out.outcome = 'truncated';
    }
    out.error = error;
    return out;
  };

  // ── 계좌·지문: 계좌 원문은 이 블록 밖으로 나가지 않는다 ──
  let cano = '';
  let prdt = '';
  try {
    cano = String((await getCredential('KIS_ACCOUNT_NO')) || '').trim();
    prdt = String((await getCredential('KIS_ACCOUNT_PRODUCT')) || '01').trim();
  } catch {
    return stop('credential_error');
  }
  if (!cano) return stop('account_missing');
  let fp: string | null;
  try {
    fp = opts.fingerprint(`${cano}-${prdt}`);
  } catch {
    return stop('fingerprint_error');
  }
  if (fp == null) return stop('fingerprint_key_missing');
  if (typeof fp !== 'string' || !FINGERPRINT_RE.test(fp)) return stop('fingerprint_invalid');
  out.accountFingerprint = fp;

  const params = new URLSearchParams({ CANO: cano, ACNT_PRDT_CD: prdt, ...spec.params });
  let trContHeader = '';
  let prevCtx: string | null = spec.continuation ? JSON.stringify(['', '']) : null;

  for (;;) {
    if (out.pages >= maxPages) return stop('page_limit');
    if (opts.deadlineMs != null && now() >= opts.deadlineMs) return stop('time_budget');
    if (out.kisCalls >= maxCalls) return stop('call_budget');

    // ── 한 페이지: 토큰 계열 오류에서만 1회 재시도(T-136 공용 헬퍼 — 어댑터 전체와 같은 규칙) ──
    let res: Response | null = null;
    let tokenRetried = false;
    for (;;) {
      let headers: Record<string, string>;
      try {
        headers = await ledgerHeaders(spec.trId, trContHeader ? { tr_cont: trContHeader } : undefined);
      } catch {
        return stop('auth_error');
      }
      const url = `${kisBaseUrl()}${spec.path}?${params}`;
      try {
        res = await spec.fetchPage(url, headers);
      } catch (e) {
        // 유량 대기열 실패(KisThrottle*Error)는 KIS 에 가지 않았으므로 호출로 세지 않는다(kis-http §호출 기록과 같은 기준).
        const name = e instanceof Error ? e.name : '';
        if (/Throttle/.test(name)) return stop('throttle_wait');
        out.kisCalls += 1;
        return stop(name === 'AbortError' ? 'timeout' : 'network_error');
      }
      out.kisCalls += kisAttempts(res);
      // 레이트리밋은 kisFetch 가 이미 백오프 재시도를 소진한 상태다 — 여기서 다시 부르지 않는다(HTTP 상태와 무관하게 먼저 본다).
      if (isKisRateLimited(res)) {
        out.rateLimited = true;
        return stop('rate_limited');
      }
      if (res.ok) break;
      const body = kisBodyText(res) ?? await res.text().catch(() => '');
      /**
       * (T-136) 토큰 분기를 공용 헬퍼로 바꿨다 — 자체 정규식(`EGW00123` only)은 `EGW00121` 을 놓쳤고,
       * 재발급을 먼저 해서 다른 프로세스가 회전시킨 토큰을 지울 수 있었다. 헬퍼는 DB 를 먼저 읽고
       * 값이 같을 때만 재발급한다. 예외를 `stop('auth_error')` 로 바꾸는 이 사이트의 규칙은 그대로
       * 두려고 호출을 try/catch 로 감싼다(종전 `invalidateKisToken()` 과 같은 처리).
       */
      // 🔴 가드가 **헬퍼보다 먼저**다 (T-136 감사 H-1). 순서를 뒤집으면 재발급 뒤 또 토큰 오류가 날 때
      //    헬퍼가 한 번 더 돌아 `invalidateKisToken()` 이 2회 불리고, 이 task 가 없애려던 `EGW00133`
      //    60초 대기를 이 경로에 새로 만든다. 다른 7곳은 모두 `attempt === 0 &&`·`!tokenRetried &&` 를
      //    앞에 두는데 여기만 달랐다.
      if (!tokenRetried) {
        let retryToken = false;
        try {
          retryToken = await shouldRetryAfterTokenError(body, headers.Authorization, `kis-ledger ${spec.trId}`);
        } catch { return stop('auth_error'); }
        if (retryToken) {
          tokenRetried = true;
          if (out.kisCalls >= maxCalls) return stop('call_budget');
          continue;
        }
      }
      return stop(`http_${res.status}`);
    }

    let data: Record<string, unknown>;
    try {
      const j: unknown = await res.json();
      if (!j || typeof j !== 'object' || Array.isArray(j)) return stop('body_format');
      data = j as Record<string, unknown>;
    } catch {
      return stop('body_json');
    }
    if (data.rt_cd !== '0') return stop(`rt_cd_${safeCode(data.rt_cd)}_${safeCode(data.msg_cd)}`);

    const rawRows = data[spec.rowsKey] ?? (spec.rowsFallbackKey ? data[spec.rowsFallbackKey] : undefined);
    if (rawRows != null && !Array.isArray(rawRows)) return stop('rows_format');   // "있는데 배열이 아니다" — 0건과 구분 불가
    const pageRows = (rawRows ?? []) as unknown[];
    if (pageRows.some((r) => !r || typeof r !== 'object' || Array.isArray(r))) return stop('rows_format');

    out.pages += 1;
    out.rows.push(...(pageRows as Record<string, unknown>[]));
    if (spec.summaryKey && data[spec.summaryKey] != null) out.summaries.push(data[spec.summaryKey]);
    const hdr = (res.headers.get('tr_cont') ?? '').trim();
    out.lastTrCont = hdr === '' ? null : hdr;

    if (hdr !== 'M' && hdr !== 'F') {
      if (hdr === '' || hdr === 'D' || hdr === 'E') {
        // (T-087 Codex C2) 한 페이지 요청이 kisFetch 내부 레이트리밋 재시도로 여러 번 나갈 수 있어(kisAttempts), 마지막 페이지에서 상한을 넘겼을 수 있다.
        //   kisFetch 는 그대로 두고(주문 경로 공유) 여기서 사후 검사 — 넘었으면 받은 행은 남기고 truncated.
        if (out.kisCalls > maxCalls) return stop('call_cap_exceeded');
        out.outcome = 'ended';
        out.error = null;
        return out;
      }
      return stop('unexpected_tr_cont');
    }

    // ── 다음 페이지 ──
    const c = spec.continuation;
    if (!c) return stop('continuation_unsupported');
    const fk = readCtx(data, c.responseFk);
    const nk = readCtx(data, c.responseNk);
    if (fk == null || nk == null || (fk.trim() === '' && nk.trim() === '')) return stop('continuation_key_missing');
    const ctx = JSON.stringify([fk, nk]);
    if (ctx === prevCtx) return stop('continuation_stalled');
    prevCtx = ctx;
    params.set(c.requestFk, fk);
    params.set(c.requestNk, nk);
    trContHeader = 'N';
  }
}
