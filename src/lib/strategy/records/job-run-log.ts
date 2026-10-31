/**
 * T-112 크론 잡 실행·상태 기록기 — `job_run_log` (DDL: scripts/migrations/T-112-run-judgment-record.sql).
 *
 * ## 흐름 (초안 §5.1 방식 B · T-112 구현 규칙 R1)
 * `scripts/cron-runner.sh` 의 `call()` 사후 후크가 서버 로컬 스풀 파일에 한 줄씩 덧붙이고, 틱 경과 150초 미만인 가벼운 틱에서만 묶어서
 * `POST /api/cron/job-run-log` 로 보낸다. 그 라우트가 이 모듈의 {@link recordSpoolBatch} 를 부른다. **러너는 판정하지 않는다** —
 * 상태 분류(§2.3)·슬롯(§2.4, `job-slots.ts`)·롤업(U2)은 전부 여기서 한다.
 *
 * ## 스풀 줄 형식 v1 (탭 구분 7칸, 러너 `jrl_hook` 과 같아야 한다)
 *   `v1 <TAB> 라벨 <TAB> 경로 <TAB> HTTP 코드(3자리, 000 = curl 실패·상한) <TAB> 시작 epoch ms <TAB> 종료 epoch ms <TAB> 본문 앞 2KB 의 base64`
 *   매 분 잡 3개는 200 이면 본문 칸이 비어 있다. 경로는 저장하지 않는다(검증만). 응답 본문 **원문은 저장하지 않는다** — 짧은 분류어만.
 *   curl 종료코드는 러너 `call()` 의 기존 줄(`|| code="000"`)을 고치지 않는 한 얻을 수 없어 싣지 않는다(삭제 줄 0 원칙) → `HTTP=000` 만.
 *
 * ## 쓰기 규칙 (T-112 「구현 규칙」)
 * - F1 실행 행 ODKU = **b′**: 비교는 `IFNULL(ended_at,'1000-01-01 00:00:00')`, `ended_at` 대입은 **맨 마지막**. 더 늦게 끝난 시도만
 *   status·http_code·error_code·degraded_reason·counts_json 을 바꾸고 attempt 를 1 올린다. 같은 줄 재전송은 아무것도 바꾸지 않는다.
 *   (degraded_reason 은 초안 §10.6.1 식에 없던 열인데 같은 규칙으로 넣었다 — 재시도 성공 뒤 실패 시도의 사유가 남지 않게.)
 * - F2 `affectedRows`·`insertId` 로 "새 행"을 판정하지 않는다(무변화 재전송도 affectedRows 1). 이 모듈은 행 수를 세지 않고 문장 수만 센다.
 * - F3 모든 문자열 열은 코드포인트 단위로 미리 자른다(`safe-text.ts`). F6 오류는 errno 로 판별.
 * - 롤업 행(U2): (job_id, KST 정시, recorder='runner_rollup') 한 줄에 `{runs, failed, maxMs}` 를 **더해 간다**(배치가 여러 번 와도). 상태 =
 *   failed 0 → ok, failed = runs → failed, 그 밖 → partial. 실패한 실행은 따로 `runner_hook` 1줄(의사 슬롯)을 즉시 남긴다.
 *   알려진 한계(초안 §5.2): 라우트가 커밋한 뒤 응답이 러너 curl 상한(3초) 안에 못 가면 러너가 같은 줄을 다시 보내 롤업 runs 가 과대 집계될
 *   수 있다(실행 행은 ODKU 로 무해). (T-127, Reviewer Minor-2) 더 흔한 경로: 처리 상한 {@link JRL_DEADLINE_MS} 를 넘기면 503(timeout)으로
 *   답하지만 `work()` 는 계속 돌아 나중에 커밋된다 → 러너가 같은 줄을 다시 보내 runs·failed 가 두 배가 될 수 있다(T-112 관찰 22:13 — 71 대 68).
 *   롤업 runs 는 근사값이다(T-108 지표 계약 §6). 재전송 중복 억제는 T-127 범위 밖(후속 후보).
 *   (T-135) 이제 상한에서 연결을 닫으므로 상한 뒤에는 **새 문장을 보내지 않는다** — 상한 순간 이미 서버가 실행한 문장만 남을 수 있다(과대 집계가
 *   줄지만 0 이 되지는 않는다. 롤업 문장은 실행 행 문장 뒤라 상한에 걸리면 대개 빠지고, 재전송 때 한 번 더해진다).
 * - 스위치 `job_run_log_enabled` 키 없음 = 꺼짐 → 아무것도 쓰지 않고 `skipped_disabled`(러너는 스풀을 비운다). 스위치를 **읽지 못하면**
 *   (DB 오류·시간 초과) 꺼짐으로 보되 `failed` 로 답해 러너가 스풀을 남기게 한다(DB 가 잠깐 아플 때 기록이 사라지지 않게).
 * - 테이블 없음(1146, DDL 적용 전) → `skipped_no_table`(프로세스당 경고 1회, 러너는 스풀을 비운다).
 * - `missing` 행 합성·새 잡·청산 기록은 범위 밖(R4·T-126). `recorder` 값 `route`·`reconciler` 는 쓰지 않는다.
 * - 이 모듈은 외부 호출을 하지 않는다(DB 만). 비밀 값을 로그에 남기지 않는다.
 * - (T-135) 배치 1회의 upsert 문장(묶음·값 오류 시 한 줄씩 재시도)은 풀에서 받은 **연결 하나**로 보내고, 처리 상한 {@link JRL_DEADLINE_MS} 에
 *   걸리면 그 연결을 풀에서 뺀다(`bounded-conn.ts` — T-126 R1 과 같은 규칙). 예전에는 상한이 응답만 끊어 표가 잠기면 매달린 upsert 가 풀 연결
 *   (주문·UI 와 공유, 10개)을 붙잡았다 — 러너가 약 분당 1회 보내므로 잠금이 길면 분마다 하나씩 줄었다. 스위치 읽기는 예전처럼 풀 query 다.
 */
import { getPool } from '@/lib/db';
import { isBoundedConnLate, withBoundedConn, type BoundedConnUse, type BoundedPool } from './bounded-conn';
import { readRecordSwitchState } from './record-switch';
import { clampText, isNoSuchTable, isRowDataError } from './safe-text';
import {
  fallbackSpec, kstDatetime, rollupSlot, slotFor, specFor, type JobSpec,
} from './job-slots';

// ─────────────────────────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────────────────────────

/** 요청 본문 상한(바이트). 러너는 한 번에 최대 200줄(줄당 최대 약 3.2KB) → 약 640KB. */
export const JRL_MAX_BODY_BYTES = 1_048_576;
/** 한 번에 받는 줄 상한. */
export const JRL_MAX_LINES = 500;
/** 처리 전체 상한(ms) — 러너 전송 curl 상한 3초보다 짧게(초안 §5.2). 넘기면 failed(timeout) → 러너가 다음 틱에 다시 보낸다. */
export const JRL_DEADLINE_MS = 2500;
/** 본문 디코드 상한(러너는 2048바이트를 보낸다 — 여유 2배). */
export const JRL_BODY_DECODE_MAX = 4096;
/** 열 길이(DDL). F3: 넣기 전에 모두 자른다. */
export const JRL_LEN = { job_id: 64, run_kind: 24, target: 64, error_code: 64, degraded_reason: 128 } as const;
/** counts_json CHECK(CHAR_LENGTH ≤ 2048 — 글자 수, F7). */
export const JRL_COUNTS_MAX_CHARS = 2048;
/** 한 문장당 행 수 상한(multi-row INSERT). */
const ROWS_PER_STATEMENT = 100;

const LOG = '[strategy/records/job-run-log]';

export type JrlStatus = 'ok' | 'partial' | 'failed' | 'skipped' | 'missing' | 'degraded';
export type JrlRecorder = 'runner_hook' | 'runner_rollup';

// ─────────────────────────────────────────────────────────────────────────────
// 스풀 줄 해석
// ─────────────────────────────────────────────────────────────────────────────

export interface SpoolLine {
  label: string;
  path: string;
  /** 0 = curl 실패·상한(러너의 000). */
  http: number;
  startMs: number;
  endMs: number;
  /** 본문 앞부분(디코드한 UTF-8). 비어 있으면 null. */
  body: string | null;
}

const LABEL_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MS_RE = /^\d{12,14}$/;
/** 2020-01-01 ~ 2100-01-01 UTC */
const MS_MIN = 1_577_836_800_000;
const MS_MAX = 4_102_444_800_000;

/** 스풀 줄 1개 → 해석 결과, 형식이 틀리면 null(그 줄만 버린다 — 다시 보내도 같으므로 재전송 대상이 아니다). */
export function parseSpoolLine(line: string): SpoolLine | null {
  if (typeof line !== 'string') return null;
  const f = line.replace(/\r$/, '').split('\t');
  if (f.length !== 7 || f[0] !== 'v1') return null;
  const [, label, path, httpRaw, s0, s1, b64] = f;
  if (!LABEL_RE.test(label)) return null;
  if (path.length > 256 || !path.startsWith('/api/cron/')) return null;
  if (!/^\d{3}$/.test(httpRaw)) return null;
  if (!MS_RE.test(s0) || !MS_RE.test(s1)) return null;
  const startMs = Number(s0);
  const endMs = Number(s1);
  if (startMs < MS_MIN || startMs > MS_MAX || endMs < startMs || endMs - startMs > 86_400_000) return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.length > Math.ceil(JRL_BODY_DECODE_MAX / 3) * 4) return null;
  let body: string | null = null;
  if (b64 !== '') {
    const buf = Buffer.from(b64, 'base64');
    body = buf.subarray(0, JRL_BODY_DECODE_MAX).toString('utf8');
    if (body === '') body = null;
  }
  return { label, path, http: Number(httpRaw), startMs, endMs, body };
}

// ─────────────────────────────────────────────────────────────────────────────
// 본문 읽기 — 완전한 JSON 이면 그대로, 앞 2KB 에서 잘렸으면 최상위 값만 훑는다
// ─────────────────────────────────────────────────────────────────────────────

type Scalar = string | number | boolean | null;
/** 최상위 객체에서 읽은 값 — 스칼라, 또는 (잘렸을 수 있는) 문자열 배열, 또는 완전한 JSON 일 때의 원래 값. */
export type BodyView = Record<string, unknown>;

/**
 * 잘린 JSON 앞부분에서 **최상위** 키의 스칼라 값과, 최상위 배열 안의 문자열 원소만 꺼낸다(깊이 2 이상의 값은 건너뛴다).
 * 중첩 객체 안의 같은 이름 키(`markets[].ok` 등)를 최상위 값으로 잘못 읽지 않으려는 것이다.
 */
export function scanTopLevel(prefix: string): BodyView {
  const out: BodyView = {};
  let i = 0;
  const n = prefix.length;
  const ws = () => { while (i < n && /\s/.test(prefix[i])) i++; };
  const readString = (): string | null => {
    if (prefix[i] !== '"') return null;
    i++;
    let s = '';
    while (i < n) {
      const c = prefix[i];
      if (c === '\\') {
        if (i + 1 >= n) return null;
        const e = prefix[i + 1];
        if (e === 'u') {
          const hex = prefix.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) return null;
          s += String.fromCharCode(parseInt(hex, 16));
          i += 6;
          continue;
        }
        const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' };
        s += map[e] ?? e;
        i += 2;
        continue;
      }
      if (c === '"') { i++; return s; }
      s += c;
      i++;
    }
    return null; // 잘림
  };
  /** 스칼라가 아닌 값(객체·배열)을 건너뛴다. 끝까지 못 닫으면 false. */
  const skipNested = (): boolean => {
    let depth = 0;
    while (i < n) {
      const c = prefix[i];
      if (c === '"') { if (readString() === null) return false; continue; }
      if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') { depth--; if (depth === 0) { i++; return true; } }
      i++;
    }
    return false;
  };
  const readScalar = (): Scalar | undefined => {
    if (prefix[i] === '"') { const s = readString(); return s === null ? undefined : s; }
    const m = /^(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(prefix.slice(i, i + 40));
    if (!m) return undefined;
    // 숫자가 잘렸을 수 있다 — 뒤에 구분자가 와야 확정
    const after = prefix[i + m[0].length];
    if (after === undefined) return undefined;
    i += m[0].length;
    if (m[0] === 'true') return true;
    if (m[0] === 'false') return false;
    if (m[0] === 'null') return null;
    return Number(m[0]);
  };
  ws();
  if (prefix[i] !== '{') return out;
  i++;
  while (i < n) {
    ws();
    if (prefix[i] === '}') break;
    if (prefix[i] === ',') { i++; continue; }
    const key = readString();
    if (key === null) break;
    ws();
    if (prefix[i] !== ':') break;
    i++;
    ws();
    if (i >= n) break;
    const c = prefix[i];
    if (c === '[') {
      // 최상위 배열 — 문자열 원소만 모은다(잘려도 앞부분까지)
      i++;
      const arr: unknown[] = [];
      let closed = false;
      while (i < n) {
        ws();
        if (prefix[i] === ']') { i++; closed = true; break; }
        if (prefix[i] === ',') { i++; continue; }
        if (prefix[i] === '"') {
          const s = readString();
          if (s === null) break;
          arr.push(s);
          continue;
        }
        if (prefix[i] === '{' || prefix[i] === '[') { arr.push(null); if (!skipNested()) break; continue; }
        const v = readScalar();
        if (v === undefined) break;
        arr.push(v);
      }
      out[key] = arr;
      if (!closed) break;
      continue;
    }
    if (c === '{') { if (!skipNested()) break; continue; }
    const v = readScalar();
    if (v === undefined) break;
    out[key] = v;
  }
  return out;
}

/** 본문 → 최상위 보기. 완전한 JSON 객체면 그대로, 아니면 {@link scanTopLevel}. */
export function readBody(body: string | null): BodyView {
  if (body === null || body === '') return {};
  try {
    const v: unknown = JSON.parse(body);
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) return v as BodyView;
    return {};
  } catch {
    return scanTopLevel(body);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 상태 분류기 (초안 §2.3 + G-J1 #2 — 해외 503 data_unknown = failed + error_code)
// ─────────────────────────────────────────────────────────────────────────────

export interface Classified {
  status: JrlStatus;
  errorCode: string | null;
  degradedReason: string | null;
  counts: Record<string, number> | null;
}

/** 분류어만 통과(영소문자·숫자·밑줄, 48자) — 응답 원문(경로·오류 문장)이 열에 들어가지 않게. */
export function codeWord(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  return /^[a-z][a-z0-9_]{0,47}$/.test(s) ? s : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v >= 0 && v <= 1e9 ? v : null;
}

function pickCounts(map: ReadonlyArray<readonly [string, unknown]>): Record<string, number> | null {
  const out: Record<string, number> = {};
  for (const [k, v] of map) { const x = num(v); if (x !== null) out[k] = x; }
  return Object.keys(out).length > 0 ? out : null;
}

function isAnalysisLabel(label: string): boolean {
  return label === 'post-market-domestic' || label === 'post-market-overseas';
}
function isNewsIngestLabel(label: string): boolean {
  return label === 'news-fetch-overseas' || label === 'news-fetch-domestic' || label === 'news-fetch-domestic-pm';
}
function isPeekLabel(label: string): boolean {
  return /^news-peek-(overseas|domestic)-\d{2}$/.test(label);
}

/** 건수(지표 계약 §6 키): 분석 {evaluated, candidates, llm_input, created, blocked, duplicate, skipped}, 수집 {fetched, new, processed}. */
export function extractCounts(label: string, b: BodyView): Record<string, number> | null {
  if (isAnalysisLabel(label)) {
    return pickCounts([
      ['evaluated', b.symbolsEvaluated], ['candidates', b.candidatesFound], ['llm_input', b.llmCandidates],
      ['created', b.signalsCreated], ['blocked', b.validationBlocked], ['duplicate', b.duplicatesSkipped],
      ['skipped', b.signalsSkipped],
    ]);
  }
  if (isNewsIngestLabel(label) && Array.isArray(b.markets)) {
    let processed = 0; let seen = false;
    for (const m of b.markets) {
      const u = m && typeof m === 'object' ? num((m as Record<string, unknown>).upserted) : null;
      if (u !== null) { processed += u; seen = true; }
    }
    return seen ? { processed } : null;
  }
  if (isPeekLabel(label) && Array.isArray(b.capture)) {
    let ins = 0; let dup = 0; let seen = false;
    for (const c of b.capture) {
      if (!c || typeof c !== 'object') continue;
      const o = c as Record<string, unknown>;
      const a = num(o.inserted); const d = num(o.duplicates);
      if (a !== null) { ins += a; seen = true; }
      if (d !== null) { dup += d; seen = true; }
    }
    return seen ? { fetched: ins + dup, new: ins } : null;
  }
  return pickCounts([['fetched', b.fetched], ['new', b.new], ['processed', b.processed ?? b.upserted]]);
}

function firstWord(...vs: unknown[]): string | null {
  for (const v of vs) { const w = codeWord(v); if (w) return w; }
  return null;
}

/** 실행 1건 분류. 러너는 판정하지 않는다 — 이 함수가 정본(초안 §2.3). */
export function classifyRun(label: string, http: number, body: string | null): Classified {
  const b = readBody(body);
  const counts = extractCounts(label, b);
  const res = (status: JrlStatus, errorCode: string | null = null, degradedReason: string | null = null): Classified =>
    ({ status, errorCode, degradedReason, counts });

  if (http === 0) return res('failed', 'HTTP=000');
  if (http !== 200) {
    const w = firstWord(b.status, b.error, b.skipped, b.aborted);
    // 해외 분석 503 data_unknown 등: 판단이 그 회차에 안 나왔다 → failed(G-J1 #2). 건너뛴 이유는 degraded_reason 에 그대로(지표 계약 §6).
    return res('failed', `HTTP=${String(http).padStart(3, '0')}${w ? `:${w}` : ''}`, codeWord(b.skipped) ?? codeWord(b.aborted));
  }
  // 200
  if (b.ok === false) return res('failed', firstWord(b.status, b.error, b.skipped, b.aborted) ?? 'ok_false');

  if (label === 'post-market-domestic' && Array.isArray(b.errors)) {
    // 국내 장마감 분석은 실패해도 항상 200 — 본문 errors 로만 구분된다(route.ts 11~14행).
    const errs = b.errors.filter((e): e is string => typeof e === 'string');
    const kind = (p: string) => errs.filter((e) => e === p || e.startsWith(`${p}:`)).length;
    if (kind('ai_fail') > 0) return res('failed', 'ai_fail');
    if (kind('insert_fail') > 0) return res('failed', 'insert_fail');
    if (codeWord(b.skipped)) return res('skipped', null, `skip:${codeWord(b.skipped)}`);
    const candle = kind('candle_fail');
    if (candle > 0) return res('partial', `candle_fail=${candle}`);
    if (kind('rag_fail') > 0) return res('degraded', null, 'rag_fail');
    if (kind('no_symbols') > 0) return res('degraded', null, 'no_symbols');
    return res('ok');
  }
  if (label === 'strategy-eval' && Array.isArray(b.errors) && b.errors.includes('all_markets_closed')) {
    return res('skipped', null, 'skip:all_markets_closed');
  }
  if (typeof b.skipped === 'string') {
    const w = codeWord(b.skipped);
    return res('skipped', null, w ? `skip:${w}` : 'skip');
  }
  if (b.skipped === true) {
    const w = codeWord(b.reason);
    return res('skipped', null, w ? `skip:${w}` : 'skip');
  }
  if (b.partial === true) {
    const r = num(b.remaining);
    return res('partial', null, r !== null ? `remaining=${r}` : 'partial');
  }
  if (isNewsIngestLabel(label) && counts && counts.processed === 0) return res('degraded', null, 'news=0');
  if (isPeekLabel(label) && Array.isArray(b.capture)) {
    for (const c of b.capture) {
      const st = c && typeof c === 'object' ? codeWord((c as Record<string, unknown>).status) : null;
      if (st && st !== 'ok') return res('degraded', null, `capture=${st}`);
    }
  }
  return res('ok');
}

// ─────────────────────────────────────────────────────────────────────────────
// 행 조립
// ─────────────────────────────────────────────────────────────────────────────

export interface JobRunRow {
  job_id: string;
  run_kind: string;
  market: 'domestic' | 'overseas' | 'common';
  target: string | null;
  scheduled_slot_at: string;
  started_at: string;
  ended_at: string;
  status: JrlStatus;
  attempt: number;
  http_code: number | null;
  counts_json: string | null;
  error_code: string | null;
  degraded_reason: string | null;
  session_date_kst: string;
  session_date_et: string | null;
  recorder: JrlRecorder;
}

export const JRL_COLUMNS: readonly (keyof JobRunRow)[] = [
  'job_id', 'run_kind', 'market', 'target', 'scheduled_slot_at', 'started_at', 'ended_at', 'status', 'attempt',
  'http_code', 'counts_json', 'error_code', 'degraded_reason', 'session_date_kst', 'session_date_et', 'recorder',
];

/** counts → JSON 문자열(2048자 이하만). 넘으면 null(CHECK 는 마지막 방어선). */
export function countsJson(c: Record<string, number> | null): string | null {
  if (!c) return null;
  const s = JSON.stringify(c);
  return s.length <= JRL_COUNTS_MAX_CHARS ? s : null;
}

/** F3 — 모든 문자열 열을 코드포인트 단위로 자른다(job_id 는 라벨 검사로 이미 64자 이하). */
function clampRow(r: JobRunRow): JobRunRow {
  return {
    ...r,
    job_id: clampText(r.job_id, JRL_LEN.job_id) ?? '',
    run_kind: clampText(r.run_kind, JRL_LEN.run_kind) ?? 'other',
    target: r.target === null ? null : clampText(r.target, JRL_LEN.target),
    error_code: r.error_code === null ? null : clampText(r.error_code, JRL_LEN.error_code),
    degraded_reason: r.degraded_reason === null ? null : clampText(r.degraded_reason, JRL_LEN.degraded_reason),
    http_code: r.http_code === null ? null : Math.min(999, Math.max(0, Math.floor(r.http_code))),
  };
}

function specOf(label: string): JobSpec {
  return specFor(label) ?? fallbackSpec(label);
}

/** 실행 1건 → 실행 행(롤업 잡은 실패일 때만 이 행을 만든다 — {@link buildRows}). */
export function runRow(line: SpoolLine, c: Classified = classifyRun(line.label, line.http, line.body)): JobRunRow {
  const spec = specOf(line.label);
  const slot = slotFor(spec, line.startMs);
  return clampRow({
    job_id: line.label,
    run_kind: spec.runKind,
    market: spec.market,
    target: spec.target,
    scheduled_slot_at: kstDatetime(slot.slotMs),
    started_at: kstDatetime(line.startMs),
    ended_at: kstDatetime(line.endMs),
    status: c.status,
    attempt: 1,
    http_code: line.http,
    counts_json: countsJson(c.counts),
    error_code: c.errorCode,
    degraded_reason: c.degradedReason,
    session_date_kst: slot.sessionDateKst,
    session_date_et: slot.sessionDateEt,
    recorder: 'runner_hook',
  });
}

interface RollupAcc { spec: JobSpec; slotMs: number; startMs: number; endMs: number; runs: number; failed: number; maxMs: number }

/** 롤업 집계 결과 → 롤업 행. 상태 = failed 0 → ok, failed = runs → failed, 그 밖 → partial. */
function rollupRow(a: RollupAcc): JobRunRow {
  const slot = rollupSlot(a.spec, a.slotMs);
  const status: JrlStatus = a.failed === 0 ? 'ok' : a.failed >= a.runs ? 'failed' : 'partial';
  return clampRow({
    job_id: a.spec.jobId,
    run_kind: a.spec.runKind,
    market: a.spec.market,
    target: a.spec.target,
    scheduled_slot_at: kstDatetime(slot.slotMs),
    started_at: kstDatetime(a.startMs),
    ended_at: kstDatetime(a.endMs),
    status,
    attempt: 1,
    http_code: null,
    counts_json: countsJson({ runs: a.runs, failed: a.failed, maxMs: a.maxMs }),
    error_code: null,
    degraded_reason: null,
    session_date_kst: slot.sessionDateKst,
    session_date_et: slot.sessionDateEt,
    recorder: 'runner_rollup',
  });
}

export interface BuiltRows { runRows: JobRunRow[]; rollupRows: JobRunRow[]; rejected: number }

/** 스풀 줄들 → 실행 행 + 롤업 행. 형식이 틀린 줄은 rejected 로 센다. */
export function buildRows(lines: readonly string[]): BuiltRows {
  const runRows: JobRunRow[] = [];
  const acc = new Map<string, RollupAcc>();
  let rejected = 0;
  for (const raw of lines) {
    if (raw.trim() === '') continue;
    const line = parseSpoolLine(raw);
    if (!line) { rejected++; continue; }
    const spec = specOf(line.label);
    const c = classifyRun(line.label, line.http, line.body);
    if (spec.rollup) {
      const slotMs = rollupSlot(spec, line.startMs).slotMs;
      const key = `${spec.jobId}|${slotMs}`;
      const a = acc.get(key) ?? { spec, slotMs, startMs: line.startMs, endMs: line.endMs, runs: 0, failed: 0, maxMs: 0 };
      a.runs++;
      if (c.status === 'failed') a.failed++;
      a.startMs = Math.min(a.startMs, line.startMs);
      a.endMs = Math.max(a.endMs, line.endMs);
      a.maxMs = Math.max(a.maxMs, line.endMs - line.startMs);
      acc.set(key, a);
      if (c.status === 'failed') runRows.push(runRow(line, c));   // 실패는 즉시 1줄
    } else {
      runRows.push(runRow(line, c));
    }
  }
  return { runRows, rollupRows: [...acc.values()].map(rollupRow), rejected };
}

// ─────────────────────────────────────────────────────────────────────────────
// SQL (F1 b′ · 롤업 가산)
// ─────────────────────────────────────────────────────────────────────────────

const NEWER = "VALUES(ended_at) > IFNULL(ended_at, '1000-01-01 00:00:00')";

/**
 * 실행 행 ODKU — b′(초안 §10.6.1) + degraded_reason. **`ended_at` 대입은 맨 마지막**(MariaDB 는 ODKU 대입을 왼쪽부터 적용 — 먼저 바꾸면
 * 뒤의 비교가 새 값과 비교되어 재시도가 사라진다). started_at·run_kind·market·target·session_date_* 는 바꾸지 않는다(첫 시도 유지).
 */
export const RUN_ODKU =
  'ON DUPLICATE KEY UPDATE ' +
  `attempt = IF(${NEWER}, attempt + 1, attempt), ` +
  `status = IF(${NEWER}, VALUES(status), status), ` +
  `http_code = IF(${NEWER}, VALUES(http_code), http_code), ` +
  `error_code = IF(${NEWER}, VALUES(error_code), error_code), ` +
  `degraded_reason = IF(${NEWER}, VALUES(degraded_reason), degraded_reason), ` +
  `counts_json = IF(${NEWER}, VALUES(counts_json), counts_json), ` +
  `ended_at = IF(${NEWER}, VALUES(ended_at), ended_at)`;

const J = (expr: string, k: string) => `CAST(IFNULL(JSON_VALUE(${expr}, '$.${k}'), 0) AS UNSIGNED)`;
/**
 * 롤업 행 ODKU — 배치마다 runs·failed 를 더하고 maxMs 는 큰 값. status 는 **counts_json 보다 먼저** 두어 옛 counts_json + 새 값으로 계산한다
 * (왼쪽부터 대입이든 동시 대입이든 같은 결과).
 */
export const ROLLUP_ODKU =
  'ON DUPLICATE KEY UPDATE ' +
  `status = CASE WHEN ${J('counts_json', 'failed')} + ${J('VALUES(counts_json)', 'failed')} = 0 THEN 'ok' ` +
  `WHEN ${J('counts_json', 'failed')} + ${J('VALUES(counts_json)', 'failed')} >= ${J('counts_json', 'runs')} + ${J('VALUES(counts_json)', 'runs')} THEN 'failed' ` +
  "ELSE 'partial' END, " +
  `counts_json = JSON_OBJECT('runs', ${J('counts_json', 'runs')} + ${J('VALUES(counts_json)', 'runs')}, ` +
  `'failed', ${J('counts_json', 'failed')} + ${J('VALUES(counts_json)', 'failed')}, ` +
  `'maxMs', GREATEST(${J('counts_json', 'maxMs')}, ${J('VALUES(counts_json)', 'maxMs')})), ` +
  'started_at = LEAST(started_at, VALUES(started_at)), ' +
  'ended_at = GREATEST(IFNULL(ended_at, VALUES(ended_at)), VALUES(ended_at))';

export function buildUpsert(rows: readonly JobRunRow[], odku: string): { sql: string; params: unknown[] } {
  const ph = `(${JRL_COLUMNS.map(() => '?').join(', ')})`;
  const sql = `INSERT INTO job_run_log (${JRL_COLUMNS.join(', ')}) VALUES ${rows.map(() => ph).join(', ')} ${odku}`;
  const params: unknown[] = [];
  for (const r of rows) for (const c of JRL_COLUMNS) params.push(r[c]);
  return { sql, params };
}

// ─────────────────────────────────────────────────────────────────────────────
// 기록
// ─────────────────────────────────────────────────────────────────────────────

export type RecordStatus = 'ok' | 'skipped_disabled' | 'skipped_no_table' | 'failed';
export interface RecordBatchResult {
  status: RecordStatus;
  /** failed 일 때: switch_unreadable · timeout · db_error */
  reason?: 'switch_unreadable' | 'timeout' | 'db_error';
  received: number;
  rejected: number;
  runRows: number;
  rollupRows: number;
  /** 값 오류로 뺀 행 수(그 행만 빼고 나머지는 저장). */
  rowErrors: number;
}

let noTableWarned = false;
/** 시험 전용. */
export function resetJobRunLogWarningsForTest(): void { noTableWarned = false; }

/**
 * (T-127 ⑤) 503 사유 한 줄 — 스위치를 읽지 못함·처리 상한 초과. 관찰(T-112 10-30 21:30·21:55 …)에서 503 의 원인이 어디에도 남지 않았다
 * (러너는 응답 본문을 버렸고, 상한 초과 경로는 로그가 없었다). **원인 분류어와 상수만** 적는다 — 요청 본문(스풀 줄)·라벨·금액·종목은 넣지 않는다.
 * db_error 는 아래 catch 가 이미 errno 와 함께 한 줄 남기므로 여기서 다시 적지 않는다. timeout 은 work() 가 계속 돌아 늦게 커밋될 수 있다 —
 * 그러면 러너가 같은 줄을 다시 보내 롤업 runs 가 과대 집계된다(T-112 관찰 22:13, +3). 러너는 틱마다 최대 1번 보내므로 반복 억제는 두지 않는다.
 */
function warn503(reason: 'switch_unreadable' | 'timeout', detail: string): void {
  try { console.warn(`${LOG} 503 reason=${reason} (${detail}) — 러너가 스풀을 남겨 다음 가벼운 틱에 다시 보낸다`); } catch { /* 흡수 */ }
}

interface Queryable { query: (sql: string, params?: unknown[]) => Promise<unknown> }

class NoTable extends Error {}

/** 묶어서 넣고, 값 오류(4025·1406 등)면 한 줄씩 다시 넣어 그 행만 뺀다. 테이블 없음은 NoTable, 그 밖은 그대로 던진다. */
async function upsertAll(db: Queryable, rows: readonly JobRunRow[], odku: string): Promise<number> {
  let rowErrors = 0;
  for (let i = 0; i < rows.length; i += ROWS_PER_STATEMENT) {
    const chunk = rows.slice(i, i + ROWS_PER_STATEMENT);
    const { sql, params } = buildUpsert(chunk, odku);
    try {
      await db.query(sql, params);
    } catch (e) {
      if (isNoSuchTable(e)) throw new NoTable();
      if (!isRowDataError(e)) throw e;
      for (const r of chunk) {
        const one = buildUpsert([r], odku);
        try {
          await db.query(one.sql, one.params);
        } catch (e2) {
          if (isNoSuchTable(e2)) throw new NoTable();
          if (!isRowDataError(e2)) throw e2;
          rowErrors++;
          try { console.warn(`${LOG} 행 값 오류로 1행 건너뜀 job=${r.job_id} errno=${String((e2 as { errno?: unknown }).errno)}`); } catch { /* 흡수 */ }
        }
      }
    }
  }
  return rowErrors;
}

/**
 * 스풀 본문(줄바꿈 구분) 기록. **던지지 않는다.** 전체 상한 {@link JRL_DEADLINE_MS}.
 * - 스위치 꺼짐(키 없음·값) → skipped_disabled(아무것도 쓰지 않음) / 읽지 못함 → failed(switch_unreadable)
 * - 테이블 없음 → skipped_no_table / 시간 초과 → failed(timeout) / 그 밖의 DB 오류 → failed(db_error)
 */
export async function recordSpoolBatch(text: string, deadlineMs: number = JRL_DEADLINE_MS): Promise<RecordBatchResult> {
  const lines = typeof text === 'string' ? text.split('\n').filter((l) => l.trim() !== '') : [];
  const base = { received: lines.length, rejected: 0, runRows: 0, rollupRows: 0, rowErrors: 0 };
  const work = async (bc: BoundedConnUse): Promise<RecordBatchResult> => {
    const sw = await readRecordSwitchState('job_run_log_enabled');
    if (!sw.enabled) {
      if (sw.source === 'missing' || sw.source === 'value') return { ...base, status: 'skipped_disabled' };
      warn503('switch_unreadable', `source=${sw.source}`);
      return { ...base, status: 'failed', reason: 'switch_unreadable' };
    }
    const built = buildRows(lines);
    const db: Queryable = bc.use(getPool() as unknown as BoundedPool);   // (T-135) 이 배치의 문장은 연결 하나로(첫 문장에서 받는다)
    try {
      let rowErrors = await upsertAll(db, built.runRows, RUN_ODKU);
      rowErrors += await upsertAll(db, built.rollupRows, ROLLUP_ODKU);
      return {
        ...base, status: 'ok', rejected: built.rejected,
        runRows: built.runRows.length, rollupRows: built.rollupRows.length, rowErrors,
      };
    } catch (e) {
      // (T-135) 상한 뒤 — 바깥이 이미 503(timeout)으로 답하고 사유 줄을 남겼다. 연결이 닫혀 실패한 것까지 줄을 더하지 않는다.
      if (isBoundedConnLate(e)) return { ...base, status: 'failed', reason: 'timeout', rejected: built.rejected };
      if (e instanceof NoTable) {
        if (!noTableWarned) {
          noTableWarned = true;
          try { console.warn(`${LOG} job_run_log 테이블 없음(DDL 적용 전) — 기록을 건너뛴다(이 경고는 프로세스당 1회)`); } catch { /* 흡수 */ }
        }
        return { ...base, status: 'skipped_no_table', rejected: built.rejected };
      }
      try { console.warn(`${LOG} 기록 실패 errno=${String((e as { errno?: unknown })?.errno)} — 러너가 다시 보낸다`); } catch { /* 흡수 */ }
      return { ...base, status: 'failed', reason: 'db_error', rejected: built.rejected };
    }
  };
  try {
    const r = await withBoundedConn(deadlineMs, work);   // (T-135) 상한·예외면 upsert 연결을 그 자리에서 풀에서 뺀다
    if (r) return r;
    warn503('timeout', `deadline=${deadlineMs}ms`);
    return { ...base, status: 'failed', reason: 'timeout' };
  } catch (e) {
    try { console.warn(`${LOG} 예외 흡수: ${e instanceof Error ? e.message : String(e)}`); } catch { /* 흡수 */ }
    return { ...base, status: 'failed', reason: 'db_error' };
  }
}
