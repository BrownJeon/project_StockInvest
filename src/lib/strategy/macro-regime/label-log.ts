/**
 * T-167 — 거시 레짐 라벨 장기 보관 표 `macro_regime_label_log` 기록기. 1행 = strategy-eval 런 1회(최종 pass run 행)의 라벨 기록 객체 하나.
 *
 * 왜: T-165 라벨은 `eval_funnel` 최종 run 행 `detail.macroRegime` 에만 남고 그 표는 30일 지난 행을 지운다. T-164 승격 지표(60거래일·
 * 오류율 <5%·월 플립 ≤2회)와 재계산으로 되살릴 수 없는 운영 증거(수집 실패·미로딩·캐시 나이)를 30일 너머로 남긴다.
 * 정본: task T-167 Analyst A1~A7 · Leader L1~L4·G2~G9. DDL `scripts/migrations/T-167-macro-regime-label-log.sql`,
 * 이관 `scripts/migrations/T-167-macro-regime-label-backfill.sql`(같은 열 목록 — 일회용 MariaDB 시험이 둘을 대조한다).
 *
 * ## 영향 0 원칙 (판단·게이트·사이징·프롬프트 영향 0 — T-165 그대로)
 * - 엔진은 `eval_funnel` flush **뒤** {@link recordMacroRegimeLabel} 을 한 번 부른다 — **동기·void·절대 던지지 않음.** 그 호출 안에서는
 *   행 값만 만들고(순수 계산 — 기록 객체를 JSON 으로 굳혀 eval_funnel 에 들어간 것과 같은 바이트를 잡는다), 스위치 확인·풀 연결·INSERT 는
 *   다음 마이크로태스크의 분리 실행에서 한다(DB I/O 0 — `exit-judgment.ts` flushDetached 와 같은 방식). 엔진은 기다리지 않는다.
 * - 쓰기는 `withBoundedConn` 상한 {@link MACRO_REGIME_LABEL_LOG_TIMEOUT_MS} — 상한·예외면 연결을 `destroy()`(풀에서 뺀다, T-126 R1 · T-135).
 *   `pool.query` 로 직접 보내지 않는다(매달린 INSERT 가 공용 풀 연결을 잡아 주문 경로가 줄을 선다). INSERT 1행 1문장, `INSERT IGNORE`·
 *   `ON DUPLICATE KEY` 없음 — 값 오류를 숨기지 않는다.
 * - 결과 분류: written · duplicate(1062 — 이미 이관된 런, **경고 없음**) · no_table(1146 — DDL 적용 전) · disabled(L1 스위치) ·
 *   disabled_in_test(시험 환경 기본 차단) · invalid(행을 만들 수 없음) · error · timeout.
 * - 경고는 스로틀한다: no_table = 프로세스 첫 1회 + 이후 24시간에 1회 · error·timeout·invalid = 분류어별 1시간에 1회(막힌 횟수는 다음 경고에 붙인다).
 *   내용은 분류어·errno·시장만 — DB 오류 원문·값 없음. (운영에서 이 모듈을 평가하는 Node 런타임은 pm2 `stockinvest` 1개 — LSN-0008 대조, 「프로세스당」= 그 하나.)
 * - 🔴 이 모듈은 DELETE·UPDATE·DDL 을 갖지 않는다(A5 — 자동 삭제 없음). 시험이 소스를 읽어 고정한다.
 *
 * ## 스위치 (Leader L1)
 * 환경변수 `MACRO_REGIME_LABEL_LOG_ENABLED` — 키 없음·빈 값 = 켜짐, 앞뒤 공백 제거·대소문자 무시 `false` 만 끈다. `EVAL_FUNNEL_ENABLED` 와 독립
 * (그것이 꺼져도 이 표는 쓴다 — 그때는 이 표가 라벨의 유일한 기록이다). 코드 되돌리기·DDL 없이 끌 수 있는 비상 손잡이다.
 *
 * ## 시험 환경 기본 차단 (T-165 G2 와 같은 장치)
 * `NODE_ENV === 'test'` 또는 `JEST_WORKER_ID` 가 있으면 시험 훅({@link __setMacroRegimeLabelLogForTest})으로 켜지 않는 한 `getPool()` 을 부르지 않고
 * `disabled_in_test` 로 끝난다 — 이 모듈을 모르는 기존 엔진 시험의 질의 순서·개수가 그대로이고, 시험 중 공유 DB 쓰기가 원리적으로 0 이다.
 *
 * ## 값 규칙 (Analyst A2·A7 — 넣기 전에. strict 에서 한 값만 틀려도 문장이 거부된다)
 * - 문자열은 열 길이에 맞춰 코드포인트 단위로 자른다. 단 `run_id` 는 자르지 않고 40자를 넘으면 행을 만들지 않는다(잘린 run_id 는 다른 런이 된다).
 *   `label`·`rule_version` 이 빈 문자열이거나 문자열이 아니면 행을 만들지 않는다(CHECK).
 * - 숫자는 유한하고 열 범위 안일 때만 열 소수 자리로 반올림해 넣는다. 아니면 NULL. 정수 열은 안전한 정수이고 범위 안일 때만.
 * - 불리언 → 1/0(NULL 허용 열은 불리언이 아니면 NULL, NOT NULL 열은 `true` 만 1).
 * - 날짜 'YYYY-MM-DD'·월 'YYYY-MM'·시각 'YYYY-MM-DDTHH:MM:SSZ' 는 형식과 달력이 맞을 때만, 아니면 NULL(이관의 NULLIF·STR_TO_DATE 와 같은 결과).
 * - `as_of_utc` = `asOfUtc` 의 UTC 벽시계. 비었거나 형식 밖이면 호출 시각(`nowMs`)을 초 단위로 내린 값(A2 폴백 — 이 행은 이관 행과 몇 초 달라
 *   유일 키로 합쳐지지 않을 수 있다, 알려진 한계·실질 도달 불가). `as_of_kst` = 같은 시각 + 9시간.
 * - `record_json` = `JSON.stringify(record)`(공백 없음 — 이관의 `JSON_COMPACT(JSON_EXTRACT(…))` 와 같은 바이트, A7).
 * - `engine_release` = 릴리스 디렉터리 이름(`exitEngineReleaseFromCwd(process.cwd())` 재사용 — L3, 세 번째 사본을 만들지 않는다).
 */
import type { Market } from '@/lib/exchanges/kis-symbols';
import { getPool } from '@/lib/db';
import { isBoundedConnLate, withBoundedConn, type BoundedConnUse, type BoundedPool } from '../records/bounded-conn';
import { decimalOrNull, exitEngineReleaseFromCwd } from '../records/exit-judgment';
import { kstDatetime } from '../records/job-slots';
import { isCheckViolation, isNoSuchTable, isRowDataError, truncateCodePoints } from '../records/safe-text';
import type { MacroRegimeRecord } from './types';

export const MACRO_REGIME_LABEL_LOG_TABLE = 'macro_regime_label_log' as const;
/** 기록 1회(INSERT 1문장) 전체 상한 — records 기록기들과 같다. */
export const MACRO_REGIME_LABEL_LOG_TIMEOUT_MS = 4000;
/** 기록 스위치 환경변수(L1). */
export const MACRO_REGIME_LABEL_LOG_ENV_KEY = 'MACRO_REGIME_LABEL_LOG_ENABLED' as const;
/** 표 없음(1146) 경고 간격 — 프로세스 첫 1회 + 이후 이 간격에 1회. */
export const MACRO_REGIME_LABEL_LOG_NO_TABLE_WARN_MS = 24 * 3600_000;
/** error·timeout·invalid 경고 간격(분류어별). */
export const MACRO_REGIME_LABEL_LOG_FAILURE_WARN_MS = 3600_000;
/** 이관 마감(경고 문구용) — 첫 라벨 행 eval_funnel id 904956(2026-11-12 10:20:40 KST) + 30일. */
export const MACRO_REGIME_LABEL_LOG_BACKFILL_DEADLINE = '2026-12-12 10:20 KST' as const;
/** 기록 객체 JSON 상한(eval_funnel `safeJson` 과 같은 60,000자 — 넘으면 그쪽도 `macroRegime` 이 남지 않는다). */
export const MACRO_REGIME_LABEL_LOG_MAX_JSON_CHARS = 60_000;

/**
 * INSERT 열 — DDL 열 순서에서 `id`(AUTO_INCREMENT)·`inserted_at`(DEFAULT) 만 뺀 것. 시험이 DDL 파일·이관 파일의 열 목록과 대조한다.
 */
export const MACRO_REGIME_LABEL_LOG_COLUMNS = [
  'source', 'source_eval_funnel_id', 'source_ts_kst', 'run_id', 'market', 'as_of_utc', 'as_of_kst', 'as_of_et_date',
  'rule_version', 'label', 'is_type5', 'reason_codes', 'reason_first', 'reason_count',
  'cpi_fetch_status', 'cpi_reference_month', 'cpi_expected_reference_month', 'cpi_lags_schedule', 'cpi_release_at_utc',
  'cpi_index', 'cpi_base_month', 'cpi_base_index', 'cpi_yoy_pct_raw', 'cpi_yoy_pct', 'cpi_hot', 'cpi_month_gap',
  'cpi_fetched_at_utc', 'cpi_cache_age_sec',
  'rate_upper_pct', 'rate_upper_effective_from', 'rate_compare_date', 'rate_upper_6m_ago_pct', 'rate_delta_pct', 'rate_direction',
  'rate_table_verified_through', 'rate_next_known_decision_date',
  'engine_release', 'record_json',
] as const;
export type MacroRegimeLabelLogColumn = (typeof MACRO_REGIME_LABEL_LOG_COLUMNS)[number];

/** VARCHAR 열 길이(코드포인트) — DDL 과 같다(시험이 대조). */
export const MACRO_REGIME_LABEL_LOG_COLUMN_LIMITS = {
  run_id: 40,
  rule_version: 32,
  label: 24,
  reason_codes: 200,
  reason_first: 32,
  cpi_fetch_status: 24,
  rate_direction: 12,
  engine_release: 48,
} as const;

/** INSERT 1행 — 키 = {@link MACRO_REGIME_LABEL_LOG_COLUMNS}(같은 순서). */
export interface MacroRegimeLabelLogRow {
  source: 'live';
  source_eval_funnel_id: null;
  source_ts_kst: null;
  run_id: string;
  market: Market;
  as_of_utc: string;
  as_of_kst: string;
  as_of_et_date: string | null;
  rule_version: string;
  label: string;
  is_type5: 0 | 1;
  reason_codes: string;
  reason_first: string | null;
  reason_count: number;
  cpi_fetch_status: string;
  cpi_reference_month: string | null;
  cpi_expected_reference_month: string | null;
  cpi_lags_schedule: 0 | 1;
  cpi_release_at_utc: string | null;
  cpi_index: number | null;
  cpi_base_month: string | null;
  cpi_base_index: number | null;
  cpi_yoy_pct_raw: number | null;
  cpi_yoy_pct: number | null;
  cpi_hot: 0 | 1 | null;
  cpi_month_gap: number | null;
  cpi_fetched_at_utc: string | null;
  cpi_cache_age_sec: number | null;
  rate_upper_pct: number | null;
  rate_upper_effective_from: string | null;
  rate_compare_date: string | null;
  rate_upper_6m_ago_pct: number | null;
  rate_delta_pct: number | null;
  rate_direction: string | null;
  rate_table_verified_through: string | null;
  rate_next_known_decision_date: string | null;
  engine_release: string | null;
  record_json: string;
}

export type MacroRegimeLabelLogStatus =
  | 'written' | 'duplicate' | 'no_table' | 'disabled' | 'disabled_in_test' | 'invalid' | 'error' | 'timeout';
export interface MacroRegimeLabelLogResult {
  status: MacroRegimeLabelLogStatus;
  /** 분류어(+errno) — 원문 메시지는 담지 않는다 */
  reason?: string;
}

export const MACRO_REGIME_LABEL_LOG_INSERT_SQL =
  `INSERT INTO ${MACRO_REGIME_LABEL_LOG_TABLE} (${MACRO_REGIME_LABEL_LOG_COLUMNS.join(', ')}) ` +
  `VALUES (${MACRO_REGIME_LABEL_LOG_COLUMNS.map(() => '?').join(', ')})`;

const LOG = '[strategy/macro-regime/label-log]';
const L = MACRO_REGIME_LABEL_LOG_COLUMN_LIMITS;

// ─── 스위치·시험 환경 ─────────────────────────────────────────────────────────

/** L1 — 키 없음·빈 값 = 켜짐, 앞뒤 공백 제거·대소문자 무시 `false` 만 끈다. */
export function isMacroRegimeLabelLogEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env[MACRO_REGIME_LABEL_LOG_ENV_KEY] ?? '').trim().toLowerCase() !== 'false';
}

/** 시험 환경인가 — `NODE_ENV === 'test'` 또는 jest 워커. */
export function isMacroRegimeLabelLogTestEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'test' || env.JEST_WORKER_ID !== undefined;
}

interface TestOverride { enabled: boolean; timeoutMs?: number }
let testOverride: TestOverride | null = null;

// ─── 값 변환(순수) ────────────────────────────────────────────────────────────

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;
const ISO_Z_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;

function validYmd(y: number, mo: number, d: number): boolean {
  if (y < 1000 || y > 9999 || mo < 1 || mo > 12 || d < 1) return false;
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** 'YYYY-MM-DD'(실제 달력일) → 그대로, 아니면 null */
export function dateOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = DATE_RE.exec(v);
  if (!m) return null;
  return validYmd(Number(m[1]), Number(m[2]), Number(m[3])) ? v : null;
}

/** 'YYYY-MM'(월 01~12) → 그대로, 아니면 null */
export function monthOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = MONTH_RE.exec(v);
  if (!m) return null;
  return validYmd(Number(m[1]), Number(m[2]), 1) ? v : null;
}

/** 'YYYY-MM-DDTHH:MM:SSZ' → epoch ms(형식·달력·시각이 맞을 때만), 아니면 null. 소수 초·오프셋 표기는 받지 않는다(이관 STR_TO_DATE 와 같다). */
export function isoZSecondsToMs(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const m = ISO_Z_RE.exec(v);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  if (!validYmd(y, mo, d) || h > 23 || mi > 59 || s > 59) return null;
  return Date.UTC(y, mo - 1, d, h, mi, s);
}

/** epoch ms → UTC 벽시계 'YYYY-MM-DD HH:MM:SS'(초 미만 버림) */
export function utcDatetime(ms: number): string {
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

function isoZToUtcWallOrNull(v: unknown): string | null {
  const ms = isoZSecondsToMs(v);
  return ms === null ? null : utcDatetime(ms);
}

const text = (v: unknown, max: number): string | null => truncateCodePoints(v, max);
const bit = (v: unknown): 0 | 1 | null => (v === true ? 1 : v === false ? 0 : null);
const bitNotNull = (v: unknown): 0 | 1 => (v === true ? 1 : 0);
/** 안전한 정수이고 [min, max] 안이면 그대로, 아니면 null */
function intOrNull(v: unknown, min: number, max: number): number | null {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) return null;
  return Object.is(v, -0) ? 0 : v;
}
const dec12_4 = (v: unknown) => decimalOrNull(v, 4, 1e8);   // DECIMAL(12,4)
const dec10_4 = (v: unknown) => decimalOrNull(v, 4, 1e6);   // DECIMAL(10,4)
const dec6_1 = (v: unknown) => decimalOrNull(v, 1, 1e5);    // DECIMAL(6,1)
const dec6_2 = (v: unknown) => decimalOrNull(v, 2, 1e4);    // DECIMAL(6,2)

function objOrEmpty(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * 행 1개를 만든다(순수 — DB·환경변수 없음). 넣을 수 없는 입력이면 null — **던지지 않는다**(예외도 null).
 *  - null: `record` 가 객체가 아님 · `run_id` 가 문자열이 아니거나 비었거나 40자 초과 · 시장이 domestic/overseas 아님 · `label`·`ruleVersion` 이 빈 문자열/비문자열 ·
 *    JSON 으로 만들 수 없음(순환 등)·{@link MACRO_REGIME_LABEL_LOG_MAX_JSON_CHARS} 초과 · `asOfUtc` 가 형식 밖인데 `nowMs` 도 유한하지 않음.
 * `nowMs` 는 호출 시각(asOfUtc 폴백용), `engineRelease` 는 릴리스 디렉터리 이름(없으면 null).
 */
export function buildMacroRegimeLabelRow(
  runId: unknown,
  market: unknown,
  record: unknown,
  nowMs: number,
  engineRelease: string | null = null,
): MacroRegimeLabelLogRow | null {
  try {
    if (typeof runId !== 'string' || runId.length === 0 || Array.from(runId).length > L.run_id) return null;
    if (market !== 'domestic' && market !== 'overseas') return null;
    if (record === null || typeof record !== 'object' || Array.isArray(record)) return null;
    const r = record as Partial<MacroRegimeRecord> & Record<string, unknown>;

    // 기록 객체를 지금 굳힌다 — eval_funnel flush 가 같은 객체를 직렬화한 직후라 같은 바이트다(A7).
    const recordJson = JSON.stringify(record);
    if (typeof recordJson !== 'string' || recordJson.length > MACRO_REGIME_LABEL_LOG_MAX_JSON_CHARS) return null;

    const ruleVersion = typeof r.ruleVersion === 'string' && r.ruleVersion.length > 0 ? text(r.ruleVersion, L.rule_version) : null;
    const label = typeof r.label === 'string' && r.label.length > 0 ? text(r.label, L.label) : null;
    if (!ruleVersion || !label) return null;

    let asOfMs = isoZSecondsToMs(r.asOfUtc);
    if (asOfMs === null) {
      if (!Number.isFinite(nowMs)) return null;
      asOfMs = Math.floor(nowMs / 1000) * 1000;   // A2 폴백(실질 도달 불가 — internalErrorRecord 가 무효 Date 를 받은 경우뿐)
    }

    const reasons = Array.isArray(r.reasonCodes) ? (r.reasonCodes as unknown[]).filter((c): c is string => typeof c === 'string') : [];
    const cpi = objOrEmpty(r.cpi);
    const rate = objOrEmpty(r.rate);
    const fetchStatus = text(cpi.fetchStatus, L.cpi_fetch_status);

    return {
      source: 'live',
      source_eval_funnel_id: null,
      source_ts_kst: null,
      run_id: runId,
      market,
      as_of_utc: utcDatetime(asOfMs),
      as_of_kst: kstDatetime(asOfMs),
      as_of_et_date: dateOrNull(r.asOfEtDate),
      rule_version: ruleVersion,
      label,
      is_type5: bitNotNull(r.isType5),
      reason_codes: text(reasons.join(','), L.reason_codes) ?? '',
      reason_first: reasons.length > 0 ? text(reasons[0], L.reason_first) : null,
      reason_count: Math.min(reasons.length, 255),
      cpi_fetch_status: fetchStatus ?? '',
      cpi_reference_month: monthOrNull(cpi.referenceMonth),
      cpi_expected_reference_month: monthOrNull(cpi.expectedReferenceMonth),
      cpi_lags_schedule: bitNotNull(cpi.lagsSchedule),
      cpi_release_at_utc: isoZToUtcWallOrNull(cpi.releaseAtUtc),
      cpi_index: dec12_4(cpi.index),
      cpi_base_month: monthOrNull(cpi.baseMonth),
      cpi_base_index: dec12_4(cpi.baseIndex),
      cpi_yoy_pct_raw: dec10_4(cpi.yoyPctRaw),
      cpi_yoy_pct: dec6_1(cpi.yoyPct),
      cpi_hot: bit(cpi.hot),
      cpi_month_gap: intOrNull(cpi.monthGap, -32768, 32767),
      cpi_fetched_at_utc: isoZToUtcWallOrNull(cpi.fetchedAtUtc),
      cpi_cache_age_sec: intOrNull(cpi.cacheAgeSec, -2147483648, 2147483647),
      rate_upper_pct: dec6_2(rate.upperPct),
      rate_upper_effective_from: dateOrNull(rate.upperEffectiveFrom),
      rate_compare_date: dateOrNull(rate.compareDate),
      rate_upper_6m_ago_pct: dec6_2(rate.upper6mAgoPct),
      rate_delta_pct: dec6_2(rate.deltaPct),
      rate_direction: text(rate.direction, L.rate_direction),
      rate_table_verified_through: dateOrNull(rate.tableVerifiedThrough),
      rate_next_known_decision_date: dateOrNull(rate.nextKnownDecisionDate),
      engine_release: text(engineRelease, L.engine_release),
      record_json: recordJson,
    };
  } catch {
    return null;
  }
}

/** INSERT 값(열 순서 그대로). */
export function macroRegimeLabelLogParams(row: MacroRegimeLabelLogRow): Array<string | number | null> {
  return MACRO_REGIME_LABEL_LOG_COLUMNS.map((c) => row[c]);
}

// ─── 기록 ────────────────────────────────────────────────────────────────────

function errnoOf(e: unknown): number | undefined {
  if (e === null || typeof e !== 'object') return undefined;
  const n = (e as { errno?: unknown }).errno;
  return typeof n === 'number' ? n : undefined;
}

/** 오류 → 분류어(원문 메시지는 쓰지 않는다 — MariaDB 메시지에 값이 들어갈 수 있다). 절대 던지지 않는다. */
export function classifyMacroRegimeLabelLogError(e: unknown): string {
  try {
    const n = errnoOf(e);
    if (isNoSuchTable(e)) return 'no_table errno=1146';
    if (n === 1062) return 'duplicate errno=1062';
    if (isCheckViolation(e)) return 'check_violation errno=4025';
    if (isRowDataError(e)) return `row_data errno=${n}`;
    if (n !== undefined) return `db_error errno=${n}`;
    return 'exception';
  } catch {
    return 'exception';
  }
}

function currentEngineRelease(): string | null {
  try { return exitEngineReleaseFromCwd(process.cwd()); } catch { return null; }
}

/** 본문 — 경고를 내지 않는다(결과만). 상한 뒤 늦게 끝난 문장은 경고를 더하지 않는다(바깥이 이미 timeout 으로 답했다). */
async function writeRow(row: MacroRegimeLabelLogRow, bc: BoundedConnUse): Promise<MacroRegimeLabelLogResult> {
  const db = bc.use(getPool() as unknown as BoundedPool);
  try {
    await db.query(MACRO_REGIME_LABEL_LOG_INSERT_SQL, macroRegimeLabelLogParams(row));
    return { status: 'written' };
  } catch (e) {
    if (isBoundedConnLate(e)) return { status: 'timeout', reason: 'timeout' };
    if (isNoSuchTable(e)) return { status: 'no_table', reason: 'no_table errno=1146' };
    if (errnoOf(e) === 1062) return { status: 'duplicate', reason: 'duplicate errno=1062' };
    return { status: 'error', reason: classifyMacroRegimeLabelLogError(e) };
  }
}

async function decideAndWrite(row: MacroRegimeLabelLogRow | null): Promise<MacroRegimeLabelLogResult> {
  if (!isMacroRegimeLabelLogEnabled()) return { status: 'disabled' };
  const override = testOverride;
  if (isMacroRegimeLabelLogTestEnv() && !(override && override.enabled)) return { status: 'disabled_in_test' };
  if (!row) return { status: 'invalid', reason: 'invalid_row' };
  const ms = override && override.timeoutMs !== undefined ? override.timeoutMs : MACRO_REGIME_LABEL_LOG_TIMEOUT_MS;
  const v = await withBoundedConn(ms, (bc) => writeRow(row, bc));
  // 🔴 상한 — withBoundedConn 이 이미 매달린 연결을 풀에서 뺐다(기다림만 끊지 않는다, T-126 R1).
  return v === undefined ? { status: 'timeout', reason: 'timeout' } : v;
}

// ─── 경고 스로틀 ──────────────────────────────────────────────────────────────

interface WarnSlot { lastAt: number; suppressed: number }
const warnSlots = new Map<string, WarnSlot>();

/** 키별로 `intervalMs` 에 한 번만 true. 첫 호출은 항상 true. 막힌 횟수를 돌려준다(다음 경고에 붙인다). */
function takeWarnSlot(key: string, intervalMs: number, nowMs: number): { ok: boolean; suppressed: number } {
  const s = warnSlots.get(key);
  if (!s || nowMs - s.lastAt >= intervalMs) {
    const suppressed = s ? s.suppressed : 0;
    warnSlots.set(key, { lastAt: nowMs, suppressed: 0 });
    return { ok: true, suppressed };
  }
  s.suppressed += 1;
  return { ok: false, suppressed: s.suppressed };
}

function warn(msg: string): void {
  try { console.warn(`${LOG} ${msg}`); } catch { /* 로그 실패도 흡수 */ }
}

/** 결과 → 경고 한 줄(없을 수도). 분류어·errno·시장·막힌 횟수만. */
function report(r: MacroRegimeLabelLogResult, market: string): void {
  try {
    const now = Date.now();
    if (r.status === 'no_table') {
      const t = takeWarnSlot('no_table', MACRO_REGIME_LABEL_LOG_NO_TABLE_WARN_MS, now);
      if (!t.ok) return;
      const more = t.suppressed > 0 ? ` (직전 경고 뒤 ${t.suppressed}회 더)` : '';
      warn(
        `${MACRO_REGIME_LABEL_LOG_TABLE} 테이블이 없어 라벨 장기 보관 기록을 건너뜀 — DDL 적용 전(라벨 장기 보관 표 없음, ` +
        `이관 마감 ${MACRO_REGIME_LABEL_LOG_BACKFILL_DEADLINE}) market=${market}${more} — 엔진 영향 없음, 이 경고는 24시간에 1회`,
      );
      return;
    }
    if (r.status === 'error' || r.status === 'timeout' || r.status === 'invalid') {
      const t = takeWarnSlot(r.status, MACRO_REGIME_LABEL_LOG_FAILURE_WARN_MS, now);
      if (!t.ok) return;
      const more = t.suppressed > 0 ? ` (직전 경고 뒤 ${t.suppressed}회 더)` : '';
      warn(`라벨 장기 보관 기록 실패(${r.status}: ${r.reason ?? 'exception'}) market=${market}${more} — 엔진 영향 없음, 같은 분류 경고는 1시간에 1회`);
    }
    // written·duplicate(이미 이관된 런)·disabled·disabled_in_test 는 무음
  } catch { /* 로그 실패도 흡수 */ }
}

/**
 * 기록 1회 — 상한 안에 반드시 돌아오고 **절대 던지지 않는다**(분리 실행·시험 공용 진입점). `row` 는 {@link buildMacroRegimeLabelRow} 결과(null = invalid).
 */
export async function recordMacroRegimeLabelRow(
  row: MacroRegimeLabelLogRow | null,
  market: string = 'unknown',
): Promise<MacroRegimeLabelLogResult> {
  let r: MacroRegimeLabelLogResult;
  try {
    r = await decideAndWrite(row);
  } catch (e) {
    r = { status: 'error', reason: classifyMacroRegimeLabelLogError(e) };
  }
  report(r, market === 'domestic' || market === 'overseas' ? market : 'unknown');
  return r;
}

const pending = new Set<Promise<MacroRegimeLabelLogResult>>();

/**
 * 엔진 진입점 — 최종 pass run 행의 `eval_funnel` flush **뒤** 부른다. **동기·void·절대 던지지 않는다.**
 * 여기서는 행 값만 만들고(순수 계산), 스위치 확인·풀 연결·INSERT 는 다음 마이크로태스크에서 시작한다(엔진 호출 스택 안에서 DB I/O 0, 기다리지 않음).
 */
export function recordMacroRegimeLabel(runId: string, market: Market, record: MacroRegimeRecord): void {
  try {
    const row = buildMacroRegimeLabelRow(runId, market, record, Date.now(), currentEngineRelease());
    const mk: string = market === 'domestic' || market === 'overseas' ? market : 'unknown';
    const p = Promise.resolve()
      .then(() => recordMacroRegimeLabelRow(row, mk))
      .catch((): MacroRegimeLabelLogResult => ({ status: 'error', reason: 'exception' }));
    pending.add(p);
    void p.then(() => { pending.delete(p); });
  } catch {
    /* 기록 전용 — 엔진에 넘기지 않는다 */
  }
}

// ─── 시험 전용 ────────────────────────────────────────────────────────────────

/**
 * 시험 전용 — 시험 환경 기본 차단을 풀거나(`enabled: true`) 다시 막는다. `timeoutMs` 는 상한을 줄여 끝나지 않는 INSERT 시험을 빨리 끝낼 때만.
 * null = 기본(시험 환경 차단·상한 4초).
 */
export function __setMacroRegimeLabelLogForTest(o: { enabled?: boolean; timeoutMs?: number } | null): void {
  testOverride = o ? { enabled: o.enabled === true, timeoutMs: o.timeoutMs } : null;
}

/** 시험 전용 — 경고 스로틀 상태를 지운다(다음 경고가 다시 「첫 1회」가 된다). */
export function __resetMacroRegimeLabelLogWarningsForTest(): void {
  warnSlots.clear();
}

/** 시험 전용 — 시작된 기록이 모두 끝날 때까지 기다려 결과를 돌려준다. */
export async function waitForMacroRegimeLabelLogForTest(): Promise<MacroRegimeLabelLogResult[]> {
  return Promise.all([...pending]);
}
