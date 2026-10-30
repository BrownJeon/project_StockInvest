/**
 * judgment-recorder.ts — 장마감 분석 기준 판단(baseline) 기록기 (T-112 B).
 *
 * 엔진이 모은 {@link JudgmentTrace} 를 `judgment_run`(실행 1회) + `judgment_candidate`(종목 1개) 로 남긴다.
 * 정본: DDL 초안 `docs/design/2026-10-30-t112-record-ddl-draft.md` §3.2·§3.5·§5.3, T-112 「구현 규칙」(F3·F5·F6·R2·스위치).
 *
 * ## 영향 0 원칙 (R2 — "결과를 정한 뒤 기다리지 않는 기록")
 * - 엔진은 결과가 정해진 뒤 {@link recordJudgmentDetached} 를 부르고 **기다리지 않는다**(반환값 없음, 절대 던지지 않는다).
 *   해외 분석은 러너 curl 상한(120초) 안에 응답해야 성공으로 센다 — 기록 대기가 경계 실행을 그 밖으로 밀지 않게 한다.
 *   Next 서버는 pm2 상주 프로세스라 응답 뒤에도 남은 기록이 끝까지 돈다.
 * - 기록 1회 전체에 자체 상한 {@link JUDGMENT_RECORD_TIMEOUT_MS}. 넘으면 경고 1줄 후 포기(늦게 끝난 본문의 오류는 흡수).
 * - 모든 실패(스위치 읽기·설정 읽기·카드 id 조회·INSERT)는 삼킨다. 카드 id 조회가 실패해도 판단 기록은 `signal_id` NULL 로 남긴다.
 * - 해외 카드 트랜잭션 연결을 받지 않는다 — 커밋이 끝난 뒤 `getPool()` 로 따로 쓴다.
 *
 * ## 스위치·테이블
 * - `system_config.judgment_record_enabled` — **키 없음 = 꺼짐**(fail-closed, `readRecordSwitch`). 꺼져 있으면 스위치 읽기 외 I/O 0.
 * - 테이블 없음(1146 — DDL 적용 전)은 경고 1회(프로세스당) 후 조용히 건너뛴다.
 *
 * ## 값 다듬기 (넣기 전에 — 한 값만 넘어도 multi-row INSERT 한 문장 전체가 거부된다)
 * - F3 모든 문자열 열을 코드포인트 단위로 자른다(근거 500자). JSON 열은 글자 수 상한(4096·1024) 안으로 줄인다.
 * - F5 종목은 정규화(앞뒤 공백·대문자) 뒤 같은 종목을 하나로(첫 행 유지). 32자를 넘는 종목은 행을 뺀다(잘린 기호는 다른 종목이 된다).
 * - F6 CHECK 위반 판별은 errno 4025(`isCheckViolation`).
 *
 * ## 설정 기준 값 (엔진이 모르는 것)
 * - `llm_provider`·`llm_model`: 기록 시점의 `getProviderConfig()` — 엔진의 `runLlm` 호출(모델·stage 미지정)이 고르는 규칙과 같게:
 *   claude → CLI 기본 모델 {@link CLAUDE_CLI_DEFAULT_MODEL}, home-m4-api → `homeM4ApiModel`, hybrid → stage 1 `stage1Model`.
 *   호출 중 설정이 바뀌면 실제와 어긋날 수 있다(DDL 초안 §3.5-③).
 * - `signal_id`: 카드 생성 함수를 바꾸지 않고, 카드 결과가 있는 종목만 유니크 키(`uq_signals_scenario_card` 의 열
 *   symbol·side='buy'·valid_from·scenario_source='post-market')로 **한 번** 조회한다(DDL 초안 §3.5-②·§10).
 * - `engine_release`: `process.cwd()` 가 `…/releases/<이름>` 일 때 그 이름(blue/green 릴리스 디렉터리). 아니면 NULL.
 */
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { getProviderConfig } from '@/lib/llm/provider';
import { toKstDatetime } from '@/lib/time';
import { readRecordSwitch } from './record-switch';
import { dedupeBy, isCheckViolation, isNoSuchTable, normalizeSymbol, truncateCodePoints, withDeadline } from './safe-text';
import {
  EXCLUSION_CODES,
  type AiDecisionValue,
  type CardOutcome,
  type DataStatusKey,
  type DataStatusValue,
  type JudgmentRunSnapshot,
  type JudgmentTrace,
  type RagContextIds,
} from './judgment-trace';

export const JUDGMENT_RECORD_SWITCH_KEY = 'judgment_record_enabled' as const;
/** 기록 1회(스위치·설정·카드 id 조회·INSERT 2문장) 전체 상한. */
export const JUDGMENT_RECORD_TIMEOUT_MS = 4000;
/** 한 실행이 남길 후보 행 상한(넘으면 후보 행 우선, 종목 단계 제외 행부터 버리고 경고). */
export const MAX_CANDIDATE_ROWS = 500;
/** 열 길이(코드포인트) — DDL 초안 §3.2. */
export const JUDGMENT_COLUMN_LIMITS = {
  symbol: 32,
  pattern: 32,
  exclusion_code: 40,
  llm_provider: 24,
  llm_model: 64,
  engine_release: 48,
  ai_reasoning: 500,
} as const;
/** JSON 열 글자 수 상한(CHECK 는 CHAR_LENGTH — F7). */
export const RAG_CONTEXT_IDS_MAX_CHARS = 4096;
export const DATA_STATUS_MAX_CHARS = 1024;
/** 문맥 id 하나·종류별 개수 상한(엔진 topK 는 5·3·2 — 여유). */
export const RAG_ID_MAX_CHARS = 128;
export const RAG_IDS_PER_KIND_MAX = 20;
/** `claude-cli.ts` `resolveModel()` 의 기본값 — 엔진은 모델을 지정하지 않는다(시험이 원본과 대조한다). */
export const CLAUDE_CLI_DEFAULT_MODEL = 'sonnet';

const LOG = '[strategy/records/judgment]';
const DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const EXCLUSION_SET: ReadonlySet<string> = new Set(EXCLUSION_CODES);
const AI_DECISIONS: ReadonlySet<string> = new Set<AiDecisionValue>(['BUY', 'SKIP', 'NONE', 'INVALID']);
const STATUS_KEYS: readonly DataStatusKey[] = ['candles', 'news', 'earnings', 'fx', 'llm'];
const STATUS_VALUES: ReadonlySet<string> = new Set<DataStatusValue>(['available', 'partial', 'stale', 'unknown', 'error']);
const CARD_OUTCOMES: ReadonlySet<string> = new Set<CardOutcome>(['created', 'duplicate', 'blocked']);

export type JudgmentRecordStatus = 'written' | 'partial' | 'disabled' | 'not_recordable' | 'invalid' | 'no_table' | 'error' | 'timeout';

export interface JudgmentRecordResult {
  status: JudgmentRecordStatus;
  judgmentRunId?: number;
  candidates?: number;
  dropped?: number;
  error?: string;
}

export interface JudgmentRunRow {
  market: 'domestic' | 'overseas';
  judgment_role: 'baseline' | 'shadow';
  session_d0: string | null;
  valid_from: string;
  started_at: string;
  ended_at: string | null;
  as_of: string | null;
  candidate_count: number;
  llm_provider: string | null;
  llm_model: string | null;
  prompt_sha256: string | null;
  rag_context_ids: string | null;
  data_status: string | null;
  engine_release: string | null;
}

export interface JudgmentCandidateRow {
  symbol: string;
  pattern: string | null;
  exclusion_code: string | null;
  sent_to_llm: 0 | 1;
  ai_decision: AiDecisionValue | null;
  confidence: number | null;
  ai_reasoning: string | null;
  /** 카드 id 조회 대상인지(INSERT 열 아님) */
  card: CardOutcome | null;
}

let warnedNoTable = false;

function warn(msg: string): void {
  try { console.warn(`${LOG} ${msg}`); } catch { /* 로그 실패도 흡수 */ }
}
const errMsg = (e: unknown): string => {
  try { return e instanceof Error ? e.message : String(e); } catch { return 'unknown'; }
};

function kstOrNull(d: unknown): string | null {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  const s = toKstDatetime(d);
  return DATETIME_RE.test(s) ? s : null;
}

/** `…/releases/<이름>` 이면 그 이름(48자), 아니면 null. */
export function engineReleaseFromCwd(cwd: unknown): string | null {
  if (typeof cwd !== 'string') return null;
  const m = /\/releases\/([^/]+)\/?$/.exec(cwd);
  return m ? truncateCodePoints(m[1], JUDGMENT_COLUMN_LIMITS.engine_release) : null;
}

function currentEngineRelease(): string | null {
  try { return engineReleaseFromCwd(process.cwd()); } catch { return null; }
}

/** 설정 기준 공급자·모델(머리 주석). 읽기 실패 = 둘 다 null. */
export async function readLlmSetting(): Promise<{ provider: string | null; model: string | null }> {
  try {
    const cfg = await getProviderConfig();
    const provider = typeof cfg?.provider === 'string' ? cfg.provider : null;
    let model: string | null = null;
    if (provider === 'claude') model = CLAUDE_CLI_DEFAULT_MODEL;
    else if (provider === 'home-m4-api') model = typeof cfg.homeM4ApiModel === 'string' ? cfg.homeM4ApiModel : null;
    else if (provider === 'hybrid') model = typeof cfg.stage1Model === 'string' ? cfg.stage1Model : null;
    return {
      provider: truncateCodePoints(provider, JUDGMENT_COLUMN_LIMITS.llm_provider),
      model: truncateCodePoints(model, JUDGMENT_COLUMN_LIMITS.llm_model),
    };
  } catch (e) {
    warn(`LLM 설정을 읽지 못해 공급자·모델을 비워 기록: ${errMsg(e)}`);
    return { provider: null, model: null };
  }
}

/** RAG 문맥 id → JSON(4096자 이하). 넘으면 가장 긴 목록의 끝부터 버린다. 문맥이 없으면 null. */
export function ragContextIdsJson(ids: RagContextIds | null | undefined): string | null {
  if (!ids || typeof ids !== 'object') return null;
  const pick = (v: unknown): string[] => {
    if (!Array.isArray(v)) return [];
    const out: string[] = [];
    for (const x of v) {
      const s = truncateCodePoints(x, RAG_ID_MAX_CHARS);
      if (s) out.push(s);
      if (out.length >= RAG_IDS_PER_KIND_MAX) break;
    }
    return out;
  };
  const obj = { news: pick(ids.news), signals: pick(ids.signals), macro: pick(ids.macro) };
  let json = JSON.stringify(obj);
  while (json.length > RAG_CONTEXT_IDS_MAX_CHARS) {
    const longest = (['news', 'signals', 'macro'] as const).reduce((a, b) => (obj[b].length > obj[a].length ? b : a));
    if (obj[longest].length === 0) return null;
    obj[longest].pop();
    json = JSON.stringify(obj);
  }
  return json;
}

/** 자료 상태 → JSON(J5 어휘만, 1024자 이하). 비었으면 null. */
export function dataStatusJson(ds: unknown): string | null {
  if (!ds || typeof ds !== 'object') return null;
  const out: Partial<Record<DataStatusKey, DataStatusValue>> = {};
  for (const k of STATUS_KEYS) {
    const v = (ds as Record<string, unknown>)[k];
    if (typeof v === 'string' && STATUS_VALUES.has(v)) out[k] = v as DataStatusValue;
  }
  if (Object.keys(out).length === 0) return null;
  const json = JSON.stringify(out);
  return json.length <= DATA_STATUS_MAX_CHARS ? json : null;
}

/** 헤더 행. `valid_from`·`started_at`(NOT NULL)을 만들 수 없으면 null(기록하지 않는다). */
export function buildJudgmentRunRow(
  snap: JudgmentRunSnapshot,
  meta: { provider: string | null; model: string | null; engineRelease: string | null },
): JudgmentRunRow | null {
  const validFrom = typeof snap.validFrom === 'string' && DATETIME_RE.test(snap.validFrom) ? snap.validFrom : null;
  const startedAt = kstOrNull(snap.startedAt);
  if (!validFrom || !startedAt) return null;
  if (snap.market !== 'domestic' && snap.market !== 'overseas') return null;
  const count = Number.isFinite(snap.candidateCount) ? Math.min(65535, Math.max(0, Math.trunc(snap.candidateCount))) : 0;
  return {
    market: snap.market,
    judgment_role: snap.judgmentRole === 'shadow' ? 'shadow' : 'baseline',
    session_d0: typeof snap.sessionD0 === 'string' && DATE_RE.test(snap.sessionD0) ? snap.sessionD0 : null,
    valid_from: validFrom,
    started_at: startedAt,
    ended_at: kstOrNull(snap.endedAt),
    as_of: kstOrNull(snap.asOf),
    candidate_count: count,
    llm_provider: truncateCodePoints(meta.provider, JUDGMENT_COLUMN_LIMITS.llm_provider),
    llm_model: truncateCodePoints(meta.model, JUDGMENT_COLUMN_LIMITS.llm_model),
    prompt_sha256: typeof snap.promptSha256 === 'string' && SHA256_RE.test(snap.promptSha256) ? snap.promptSha256 : null,
    rag_context_ids: ragContextIdsJson(snap.ragContextIds),
    data_status: dataStatusJson(snap.dataStatus),
    engine_release: truncateCodePoints(meta.engineRelease, JUDGMENT_COLUMN_LIMITS.engine_release),
  };
}

/**
 * 후보 행 — 정규화(F5)·자르기(F3)·중복 제거·상한. 후보(패턴 있음) 행을 앞에 두고, 상한을 넘으면 뒤(종목 단계 제외)부터 버린다.
 */
export function buildJudgmentCandidateRows(snap: JudgmentRunSnapshot): { rows: JudgmentCandidateRow[]; dropped: number } {
  const src = Array.isArray(snap.candidates) ? snap.candidates : [];
  const built: JudgmentCandidateRow[] = [];
  for (const c of src) {
    try {
      const symbol = normalizeSymbol(c?.symbol);
      if (!symbol) continue;
      const sent = c.sentToLlm === true;
      const decision = sent && typeof c.aiDecision === 'string' && AI_DECISIONS.has(c.aiDecision) ? c.aiDecision : null;
      const conf = typeof c.confidence === 'number' && Number.isFinite(c.confidence) && c.confidence >= 0 && c.confidence <= 100
        ? Math.round(c.confidence * 100) / 100 : null;
      const code = typeof c.exclusionCode === 'string' && EXCLUSION_SET.has(c.exclusionCode)
        ? truncateCodePoints(c.exclusionCode, JUDGMENT_COLUMN_LIMITS.exclusion_code) : null;
      const reasoning = truncateCodePoints(c.reasoning, JUDGMENT_COLUMN_LIMITS.ai_reasoning);
      built.push({
        symbol,
        pattern: truncateCodePoints(c.pattern, JUDGMENT_COLUMN_LIMITS.pattern),
        exclusion_code: code,
        sent_to_llm: sent ? 1 : 0,
        ai_decision: decision,
        confidence: sent ? conf : null,
        ai_reasoning: sent && reasoning ? reasoning : null,
        card: typeof c.card === 'string' && CARD_OUTCOMES.has(c.card) ? c.card : null,
      });
    } catch {
      /* 형식 불량 행은 뺀다(dropped 에 센다) */
    }
  }
  // 후보(패턴 있음) 먼저 — 안정 정렬
  const ordered = [...built.filter((r) => r.pattern != null), ...built.filter((r) => r.pattern == null)];
  const unique = dedupeBy(ordered, (r) => r.symbol);
  const kept = unique.slice(0, MAX_CANDIDATE_ROWS);
  return { rows: kept, dropped: src.length - kept.length };   // 형식 불량·중복·상한으로 뺀 행 수
}

/** 카드 결과가 있는 종목의 signals.id — 유니크 키로 한 번 조회. 실패하면 빈 표(판단 기록은 signal_id NULL 로 남는다). */
export async function lookupCardIds(validFrom: string, symbols: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (symbols.length === 0) return out;
  try {
    const [rows] = await getPool().query<RowDataPacket[]>(
      `SELECT id, symbol FROM signals
        WHERE side = 'buy' AND scenario_source = 'post-market' AND valid_from = ?
          AND symbol IN (${symbols.map(() => '?').join(',')})`,
      [validFrom, ...symbols],
    );
    for (const r of Array.isArray(rows) ? rows : []) {
      const sym = normalizeSymbol((r as { symbol?: unknown }).symbol);
      const id = Number((r as { id?: unknown }).id);
      if (sym && Number.isSafeInteger(id) && id > 0 && !out.has(sym)) out.set(sym, id);
    }
  } catch (e) {
    warn(`카드 id 조회 실패 — signal_id 를 비워 기록: ${errMsg(e)}`);
    out.clear();
  }
  return out;
}

async function writeJudgmentRecord(snap: JudgmentRunSnapshot): Promise<JudgmentRecordResult> {
  if (!(await readRecordSwitch(JUDGMENT_RECORD_SWITCH_KEY))) return { status: 'disabled' };

  const { rows, dropped } = buildJudgmentCandidateRows(snap);
  const cardSymbols = rows.filter((r) => r.card != null).map((r) => r.symbol);
  const validFromForLookup = typeof snap.validFrom === 'string' ? snap.validFrom : '';
  const [setting, cardIds] = await Promise.all([
    readLlmSetting(),
    lookupCardIds(validFromForLookup, cardSymbols),
  ]);
  const head = buildJudgmentRunRow(snap, { ...setting, engineRelease: currentEngineRelease() });
  if (!head) return { status: 'invalid' };
  if (dropped > 0) warn(`후보 행 ${dropped}개를 뺐다(형식 불량·중복·상한 ${MAX_CANDIDATE_ROWS}) market=${head.market} valid_from=${head.valid_from}`);

  const pool = getPool();
  let judgmentRunId: number;
  try {
    const [res] = await pool.query<ResultSetHeader>(
      `INSERT INTO judgment_run
         (market, judgment_role, session_d0, valid_from, started_at, ended_at, as_of, candidate_count,
          llm_provider, llm_model, prompt_sha256, rag_context_ids, data_status, engine_release)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        head.market, head.judgment_role, head.session_d0, head.valid_from, head.started_at, head.ended_at, head.as_of,
        head.candidate_count, head.llm_provider, head.llm_model, head.prompt_sha256, head.rag_context_ids, head.data_status,
        head.engine_release,
      ],
    );
    judgmentRunId = Number(res?.insertId);
  } catch (e) {
    if (isNoSuchTable(e)) {
      if (!warnedNoTable) { warnedNoTable = true; warn('judgment_run 테이블이 없어 판단 기록을 건너뜀(DDL 적용 전) — 이 경고는 프로세스당 1회'); }
      return { status: 'no_table' };
    }
    warn(`judgment_run 기록 실패${isCheckViolation(e) ? '(CHECK 위반 4025)' : ''} — 분석 영향 없음: ${errMsg(e)}`);
    return { status: 'error', error: errMsg(e) };
  }
  if (!(Number.isSafeInteger(judgmentRunId) && judgmentRunId > 0)) {
    warn('judgment_run 의 새 id 를 알 수 없어 후보 기록을 건너뜀');
    return { status: 'partial', error: 'no_insert_id' };
  }
  if (rows.length === 0) return { status: 'written', judgmentRunId, candidates: 0, dropped };

  const params: Array<string | number | null> = [];
  for (const r of rows) {
    params.push(
      judgmentRunId, head.judgment_role, r.symbol, r.pattern, r.exclusion_code, r.sent_to_llm, r.ai_decision, r.confidence,
      r.ai_reasoning, r.card != null ? cardIds.get(r.symbol) ?? null : null,
    );
  }
  try {
    await pool.query<ResultSetHeader>(
      `INSERT INTO judgment_candidate
         (judgment_run_id, judgment_role, symbol, pattern, exclusion_code, sent_to_llm, ai_decision, confidence, ai_reasoning, signal_id)
       VALUES ${rows.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
      params,
    );
  } catch (e) {
    warn(`judgment_candidate 기록 실패${isCheckViolation(e) ? '(CHECK 위반 4025)' : ''} — 헤더 id=${judgmentRunId} 만 남음, 분석 영향 없음: ${errMsg(e)}`);
    return { status: 'partial', judgmentRunId, error: errMsg(e) };
  }
  return { status: 'written', judgmentRunId, candidates: rows.length, dropped };
}

/**
 * 기록 1회 — {@link JUDGMENT_RECORD_TIMEOUT_MS} 안에 반드시 돌아오고 절대 던지지 않는다.
 * 분석 실행이 아니면(정상 건너뜀 등) I/O 없이 `not_recordable`.
 */
export async function recordJudgment(snap: JudgmentRunSnapshot): Promise<JudgmentRecordResult> {
  try {
    if (!snap || snap.recordable !== true) return { status: 'not_recordable' };
    const r = await withDeadline(writeJudgmentRecord(snap), JUDGMENT_RECORD_TIMEOUT_MS);
    if (r === undefined) {
      warn(`판단 기록이 ${JUDGMENT_RECORD_TIMEOUT_MS}ms 안에 끝나지 않아 포기 — 분석 영향 없음`);
      return { status: 'timeout' };
    }
    return r;
  } catch (e) {
    warn(`판단 기록 예외 흡수 — 분석 영향 없음: ${errMsg(e)}`);
    return { status: 'error', error: errMsg(e) };
  }
}

const pending = new Set<Promise<JudgmentRecordResult>>();

/**
 * 엔진 진입점 — 분석 결과가 정해진 **뒤** 부른다. 추적을 닫고 기록을 시작만 한다: **기다리지 않고, 반환값이 없고, 절대 던지지 않는다.**
 */
export function recordJudgmentDetached(trace: JudgmentTrace): void {
  try {
    trace.finish();
    const snap = trace.snapshot();
    if (snap.recordable !== true) return;   // 분석 실행이 아님 — I/O 0
    const p = recordJudgment(snap).catch((e: unknown): JudgmentRecordResult => ({ status: 'error', error: errMsg(e) }));
    pending.add(p);
    void p.then(() => { pending.delete(p); });
  } catch (e) {
    warn(`판단 기록 시작 실패 — 분석 영향 없음: ${errMsg(e)}`);
  }
}

/** 시험 전용 — 시작된 기록이 모두 끝날 때까지 기다려 결과를 돌려준다. */
export async function waitForJudgmentRecordsForTest(): Promise<JudgmentRecordResult[]> {
  return Promise.all([...pending]);
}

/** 시험 전용 — 프로세스당 1회 경고 표시를 되돌린다. */
export function resetJudgmentRecorderForTest(): void {
  warnedNoTable = false;
}
