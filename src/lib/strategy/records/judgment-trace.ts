/**
 * judgment-trace.ts — 장마감 분석(국내·해외) 기준 판단(baseline) 기록용 **메모리 추적** (T-112 B).
 *
 * 엔진(`post-market-engine.ts`·`post-market-overseas.ts`)이 거르기 지점마다 이 수집기에 표시만 한다. 표시는 순수 메모리 작업이다:
 * I/O 없음, 로그 없음, **모든 메서드가 예외를 삼킨다**(입력이 이상해도 엔진 흐름·반환값·카드·LLM 결과에 영향 0).
 * DB 쓰기는 `judgment-recorder.ts` 가 분석 결과가 정해진 **뒤** 기다리지 않고 한다(T-112 구현 규칙 R2).
 *
 * 정본: DDL 초안 `docs/design/2026-10-30-t112-record-ddl-draft.md` §3.2(열)·§3.4(`exclusion_code` 어휘 — 엔진 분기와 1:1)·§3.5.
 *
 * ## 한 실행 = 헤더 1개 + 종목당 1행
 * - 헤더는 **분석 실행**에만 남긴다 = 세션이 정해진 뒤({@link JudgmentTrace.session}). 정상 건너뜀(국내 주말, 해외 스위치 꺼짐·
 *   시장 꺼짐·장중·새 세션 없음·진행 중)과 세션을 정하기 전 실패(해외 휴장 표 모름)는 `valid_from` 이 없어 헤더를 남기지 않는다 —
 *   그 실행은 `job_run_log` 가 상태로 남긴다. 세션이 정해진 뒤의 데이터 모름(503: 환율·실적·일봉)·후보 0건은 헤더만 남는다.
 * - 후보 행: 종목 단계 제외(`candle_fail`·`stale_candle` — pattern NULL)와 후보(종목당 1개로 줄인 패턴). 패턴이 하나도 안 걸린
 *   종목은 남기지 않는다(후보가 아니다).
 * - 같은 종목에 LLM 결정이 여럿이면(국내 엔진은 중복 결정을 그대로 처리한다) **첫 결정**을 남기되, 뒤 결정이 카드를 새로
 *   만들었고(created·blocked) 앞 결정은 아니었으면 뒤 결정으로 바꾼다 — 카드 ↔ 판단 연결(`signal_id`)을 잃지 않기 위해서다.
 *   해외 엔진은 같은 종목의 두 번째 결정을 보지 않으므로 해외에서는 늘 첫 결정이다.
 */
import { createHash } from 'node:crypto';
import { isNewsRetrievalReliable } from '@/lib/rag/news-health';

export type JudgmentMarket = 'domestic' | 'overseas';
export type JudgmentRole = 'baseline' | 'shadow';

/** DDL 초안 §3.4 — `judgment_candidate.exclusion_code` 어휘(VARCHAR(40)). NULL = 끝까지 통과(BUY → 카드) 또는 AI 가 SKIP. */
export const EXCLUSION_CODES = [
  'candle_fail',
  'stale_candle',
  'blackout',
  'prefilter_unaffordable',
  'llm_error',
  'schema_invalid',
  'zone_out_of_range',
  'low_confidence',
  'unaffordable',
  'duplicate',
  'validation_blocked',
  'insert_fail',
] as const;
export type ExclusionCode = (typeof EXCLUSION_CODES)[number];

/**
 * 시장별로 엔진에 실제 분기가 있는 코드(DDL 초안 §3.4 표의 ○). 정적 대조 시험이 엔진 소스의 표시 호출과 이 목록을 1:1 로 맞춘다
 * (국내 8 · 해외 12).
 */
export const EXCLUSION_CODES_BY_MARKET: Readonly<Record<JudgmentMarket, readonly ExclusionCode[]>> = {
  domestic: ['candle_fail', 'llm_error', 'schema_invalid', 'low_confidence', 'unaffordable', 'duplicate', 'validation_blocked', 'insert_fail'],
  overseas: [
    'candle_fail', 'stale_candle', 'blackout', 'prefilter_unaffordable', 'llm_error', 'schema_invalid',
    'zone_out_of_range', 'low_confidence', 'unaffordable', 'duplicate', 'validation_blocked', 'insert_fail',
  ],
};

/** `judgment_candidate.ai_decision`. NONE = 보낸 후보인데 응답에 결정이 없음, INVALID = action 이 BUY/SKIP 이 아님. */
export type AiDecisionValue = 'BUY' | 'SKIP' | 'NONE' | 'INVALID';
/** `judgment_run.data_status` 키 — J5 어휘(available/partial/stale/unknown/error). 거치지 않은 단계의 키는 넣지 않는다. */
export type DataStatusKey = 'candles' | 'news' | 'earnings' | 'fx' | 'llm';
export type DataStatusValue = 'available' | 'partial' | 'stale' | 'unknown' | 'error';
/** 카드 INSERT 결과(`insertScenarioCardIfAbsent`) — 기록기가 이 결과가 있는 종목만 카드 id 를 조회한다. */
export type CardOutcome = 'created' | 'duplicate' | 'blocked';

export interface CandidateTrace {
  symbol: string;
  /** 종목 단계 제외면 null */
  pattern: string | null;
  exclusionCode: ExclusionCode | null;
  sentToLlm: boolean;
  aiDecision: AiDecisionValue | null;
  /** LLM 이 준 값 — [0,100] 의 유한수만, 소수 2자리. 아니면 null */
  confidence: number | null;
  /** LLM 판단 근거 원문(자르기는 기록기가 코드포인트 단위로 한다) — 외부 데이터 */
  reasoning: string | null;
  card: CardOutcome | null;
}

export interface RagContextIds {
  news: string[];
  signals: string[];
  macro: string[];
}

export interface JudgmentRunSnapshot {
  market: JudgmentMarket;
  judgmentRole: JudgmentRole;
  /** 분석 실행인가(세션이 정해졌는가) — false 면 기록기는 I/O 없이 끝난다 */
  recordable: boolean;
  startedAt: Date;
  endedAt: Date | null;
  /** 분석한 마지막 일봉의 현지 거래일. 해외 = 엔진의 D0, 국내 = 조회한 일봉들의 마지막 봉 날짜 중 가장 늦은 날 */
  sessionD0: string | null;
  /** 카드가 겨냥한 다음 세션 시작(KST 벽시계 `YYYY-MM-DD HH:MM:SS`) = signals.valid_from */
  validFrom: string | null;
  /** 판단 입력을 고정한 시각(RAG 조회 직전). RAG 전에 끝나면 null */
  asOf: Date | null;
  /** 종목당 1개로 줄인 후보 수(엔진의 candidatesFound) */
  candidateCount: number;
  /** runLlm 에 넘긴 프롬프트 문자열의 sha256 16진 */
  promptSha256: string | null;
  ragContextIds: RagContextIds | null;
  dataStatus: Partial<Record<DataStatusKey, DataStatusValue>>;
  candidates: CandidateTrace[];
  /** 표시 중 삼킨 예외 수(진단용 — 0 이 정상) */
  traceErrors: number;
}

interface MutableCandidate extends CandidateTrace {
  decided: boolean;
}

const CARD_MADE: ReadonlySet<CardOutcome> = new Set<CardOutcome>(['created', 'blocked']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 일봉 ts(UTC 자정 = 거래일, 국내·해외 어댑터 공통 규칙) → `YYYY-MM-DD`. 해석할 수 없으면 null. */
export function dailyBarDate(ts: unknown): string | null {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  const s = d.toISOString().slice(0, 10);
  return DATE_RE.test(s) ? s : null;
}

/** LLM 결정의 action → 기록 값. 정확히 'BUY'/'SKIP' 만 그 값, 그 밖은 INVALID. */
export function aiDecisionOf(d: unknown): AiDecisionValue {
  const action = d != null && typeof d === 'object' ? (d as { action?: unknown }).action : undefined;
  if (action === 'BUY') return 'BUY';
  if (action === 'SKIP') return 'SKIP';
  return 'INVALID';
}

/** LLM 결정의 confidence → [0,100] 유한수(소수 2자리) 또는 null. 숫자 모양 문자열은 숫자로 읽는다(엔진 비교와 같은 강제 변환). */
export function confidenceOf(d: unknown): number | null {
  const raw = d != null && typeof d === 'object' ? (d as { confidence?: unknown }).confidence : undefined;
  let n: number;
  if (typeof raw === 'number') n = raw;
  else if (typeof raw === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(raw)) n = Number(raw);
  else return null;
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100) / 100;
}

function reasoningOf(d: unknown): string | null {
  const r = d != null && typeof d === 'object' ? (d as { reasoning?: unknown }).reasoning : undefined;
  return typeof r === 'string' ? r : null;
}

/**
 * 국내 엔진 `parseAiResponse` 와 같은 해석으로 "결정 목록을 읽을 수 있었는가"만 판정한다(엔진은 실패를 빈 목록으로 삼킨다 —
 * 기록에서는 "응답 해석 실패"와 "결정 0건"을 가르기 위해서다). 엔진의 해석을 바꾸지 않는다.
 */
export function domesticLlmResponseReadable(raw: unknown): boolean {
  try {
    const json = typeof raw === 'string'
      ? JSON.parse(raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim())
      : raw;
    return Array.isArray((json as { decisions?: unknown } | null | undefined)?.decisions);
  } catch {
    return false;
  }
}

function hitIds(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const h of v) {
    const id = h != null && typeof h === 'object' ? (h as { id?: unknown }).id : undefined;
    if (typeof id === 'string' && id.length > 0) out.push(id);
    else if (typeof id === 'number' && Number.isFinite(id)) out.push(String(id));
  }
  return out;
}

/**
 * 한 분석 실행의 추적. 엔진이 만들고, 끝에서 기록기에 넘긴다. **어떤 메서드도 던지지 않는다.**
 */
export class JudgmentTrace {
  readonly market: JudgmentMarket;
  private readonly startedAt: Date;
  private endedAt: Date | null = null;
  private recordable = false;
  private sessionD0: string | null = null;
  private maxBarDate: string | null = null;
  private validFrom: string | null = null;
  private asOf: Date | null = null;
  private candidateCount = 0;
  private promptSha256: string | null = null;
  private ragContextIds: RagContextIds | null = null;
  private readonly dataStatus: Partial<Record<DataStatusKey, DataStatusValue>> = {};
  private readonly rows = new Map<string, MutableCandidate>();
  private traceErrors = 0;

  constructor(market: JudgmentMarket, now: Date = new Date()) {
    this.market = market;
    this.startedAt = now;
  }

  private guard(fn: () => void): void {
    try {
      fn();
    } catch {
      this.traceErrors++;
    }
  }

  /** 세션이 정해졌다 = 분석 실행이다(헤더를 남긴다). 해외는 D0 를 같이 준다. 국내 D0 는 {@link observeLastBar} 로 모은다. */
  session(validFrom: string, sessionD0?: string | null): void {
    this.guard(() => {
      this.recordable = true;
      this.validFrom = typeof validFrom === 'string' ? validFrom : null;
      if (typeof sessionD0 === 'string' && DATE_RE.test(sessionD0)) this.sessionD0 = sessionD0;
    });
  }

  /** 국내 — 종목 하나의 일봉 배열(오름차순)에서 마지막 봉 날짜를 본다. 실행의 D0 = 본 날짜 중 가장 늦은 날. */
  observeLastBar(candles: unknown): void {
    this.guard(() => {
      if (!Array.isArray(candles) || candles.length === 0) return;
      const last = candles[candles.length - 1] as { ts?: unknown } | null | undefined;
      const d = dailyBarDate(last?.ts);
      if (d && (this.maxBarDate == null || d > this.maxBarDate)) this.maxBarDate = d;
    });
  }

  /** 자료 상태 한 칸(J5 어휘). */
  status(key: DataStatusKey, value: DataStatusValue): void {
    this.guard(() => {
      this.dataStatus[key] = value;
    });
  }

  /**
   * 일봉 조회가 끝난 뒤 — 종목 단계 제외 행(`candle_fail`·`stale_candle`)으로 `candles` 상태를 정한다.
   * 전부 실패 = error, 성공한 것이 전부 오래됨 = stale, 일부 실패·오래됨 = partial, 그 밖 = available.
   */
  candlesFetched(total: number): void {
    this.guard(() => {
      if (!(Number.isFinite(total) && total > 0)) return;
      let failed = 0;
      let stale = 0;
      for (const r of this.rows.values()) {
        if (r.exclusionCode === 'candle_fail') failed++;
        else if (r.exclusionCode === 'stale_candle') stale++;
      }
      let v: DataStatusValue = 'available';
      if (failed >= total) v = 'error';
      else if (stale > 0 && failed + stale >= total) v = 'stale';
      else if (failed > 0 || stale > 0) v = 'partial';
      this.dataStatus.candles = v;
    });
  }

  /** 종목 단계 제외(패턴 검사 전) — pattern NULL, LLM 미전송. */
  symbolExcluded(symbol: string, code: 'candle_fail' | 'stale_candle'): void {
    this.guard(() => {
      if (typeof symbol !== 'string' || this.rows.has(symbol)) return;
      this.rows.set(symbol, {
        symbol, pattern: null, exclusionCode: code, sentToLlm: false,
        aiDecision: null, confidence: null, reasoning: null, card: null, decided: false,
      });
    });
  }

  /** 종목당 1개로 줄인 후보 목록(엔진의 candidatesFound). 한 번만 부른다. */
  candidates(list: ReadonlyArray<{ symbol: string; pattern: string }>): void {
    this.guard(() => {
      if (!Array.isArray(list)) return;
      this.candidateCount = list.length;
      for (const c of list) {
        if (!c || typeof c.symbol !== 'string') continue;
        this.rows.set(c.symbol, {
          symbol: c.symbol, pattern: typeof c.pattern === 'string' ? c.pattern : null, exclusionCode: null, sentToLlm: false,
          aiDecision: null, confidence: null, reasoning: null, card: null, decided: false,
        });
      }
    });
  }

  /** 후보 단계 제외(LLM 전). */
  candidateExcluded(symbol: string, code: 'blackout' | 'prefilter_unaffordable'): void {
    this.guard(() => {
      const r = this.rows.get(symbol);
      if (r && !r.sentToLlm) r.exclusionCode = code;
    });
  }

  /** 판단 입력을 고정하는 시각 — RAG 조회 직전에 부른다. */
  markAsOf(now: Date = new Date()): void {
    this.guard(() => {
      this.asOf = now;
    });
  }

  /** RAG 결과 — 문맥 id 와 뉴스 상태(뉴스 검색을 믿을 수 있는 실행이면 available, 아니면 error). */
  rag(ctx: unknown): void {
    this.guard(() => {
      const c = (ctx ?? {}) as { recentNews?: unknown; pastSignals?: unknown; macroContext?: unknown; errors?: unknown };
      this.ragContextIds = { news: hitIds(c.recentNews), signals: hitIds(c.pastSignals), macro: hitIds(c.macroContext) };
      this.dataStatus.news = 'unknown';
      if (Array.isArray(c.errors)) this.dataStatus.news = isNewsRetrievalReliable(this.market, c.errors) ? 'available' : 'error';
    });
  }

  /** RAG 단계가 던졌다 — 프롬프트에 문맥이 들어가지 않았다(문맥 id 는 버린다). */
  ragFailed(): void {
    this.guard(() => {
      this.ragContextIds = null;
      this.dataStatus.news = 'error';
    });
  }

  /** LLM 에 보낸 후보와 그 프롬프트(해시만 남긴다). runLlm 호출 직전에 부른다. */
  sentToLlm(list: ReadonlyArray<{ symbol: string }>, prompt: string): void {
    this.guard(() => {
      for (const c of list) {
        const r = c && typeof c.symbol === 'string' ? this.rows.get(c.symbol) : undefined;
        if (r) r.sentToLlm = true;
      }
      this.promptSha256 = typeof prompt === 'string' ? createHash('sha256').update(prompt, 'utf8').digest('hex') : null;
    });
  }

  /** LLM 응답을 받아 결정 목록을 읽었다. */
  llmOk(): void {
    this.status('llm', 'available');
  }

  /** LLM 호출 실패·응답 해석 실패(실행 전체) — 보낸 후보 중 결정 없는 것은 `llm_error`. */
  llmFailed(): void {
    this.status('llm', 'error');
  }

  /** 국내 — 엔진과 같은 해석으로 응답을 읽을 수 있었는지에 따라 llmOk/llmFailed. */
  domesticLlmParsed(raw: unknown): void {
    this.guard(() => {
      this.dataStatus.llm = domesticLlmResponseReadable(raw) ? 'available' : 'error';
    });
  }

  /**
   * LLM 결정 한 줄의 최종 결과. `code` = 이 결정이 걸린 거르기(없으면 null), `card` = 카드 INSERT 결과(있으면 `code` 대신 카드
   * 결과로 정한다: duplicate → `duplicate`, blocked → `validation_blocked`, created → null).
   */
  decide(symbol: string, d: unknown, code: ExclusionCode | null, card?: CardOutcome): void {
    this.guard(() => {
      const r = this.rows.get(symbol);
      if (!r || !r.sentToLlm) return;
      const nextCard: CardOutcome | null = card ?? null;
      if (r.decided && !(nextCard != null && CARD_MADE.has(nextCard) && !(r.card != null && CARD_MADE.has(r.card)))) return;
      // 값을 모두 계산한 뒤 한 번에 바꾼다(결정 객체가 이상해 중간에 던져도 행이 반쯤 바뀌지 않게)
      const next = {
        aiDecision: aiDecisionOf(d),
        confidence: confidenceOf(d),
        reasoning: reasoningOf(d),
        card: nextCard,
        exclusionCode: nextCard === 'duplicate' ? 'duplicate' as const
          : nextCard === 'blocked' ? 'validation_blocked' as const
            : nextCard === 'created' ? null : code,
      };
      Object.assign(r, next, { decided: true });
    });
  }

  /** 해외 — 트랜잭션 커밋 뒤 카드 결과(결정은 {@link decide} 로 이미 남겼다). */
  cardResult(symbol: string, outcome: CardOutcome): void {
    this.guard(() => {
      const r = this.rows.get(symbol);
      if (!r || !r.decided) return;
      r.card = outcome;
      r.exclusionCode = outcome === 'duplicate' ? 'duplicate' : outcome === 'blocked' ? 'validation_blocked' : null;
    });
  }

  /** 해외 — 트랜잭션이 되돌려졌다(카드 없음). */
  insertFailed(symbol: string): void {
    this.guard(() => {
      const r = this.rows.get(symbol);
      if (!r || !r.decided) return;
      r.card = null;
      r.exclusionCode = 'insert_fail';
    });
  }

  /** 분석 종료 시각. 여러 번 불러도 첫 값이 남는다. */
  finish(now: Date = new Date()): void {
    this.guard(() => {
      if (this.endedAt == null) this.endedAt = now;
    });
  }

  /** 기록기에 넘길 사본. 보낸 후보 중 결정이 없는 것은 LLM 상태에 따라 `llm_error`(결정 NULL) 또는 NONE 으로 닫는다. */
  snapshot(): JudgmentRunSnapshot {
    const llm = this.dataStatus.llm;
    const candidates: CandidateTrace[] = [];
    for (const r of this.rows.values()) {
      try {
        let { exclusionCode, aiDecision } = r;
        if (r.sentToLlm && !r.decided) {
          if (llm === 'error') {
            exclusionCode = 'llm_error';
            aiDecision = null;
          } else if (llm === 'available') {
            aiDecision = 'NONE';
          }
        }
        candidates.push({
          symbol: r.symbol, pattern: r.pattern, exclusionCode, sentToLlm: r.sentToLlm,
          aiDecision: r.sentToLlm ? aiDecision : null, confidence: r.confidence, reasoning: r.reasoning, card: r.card,
        });
      } catch {
        this.traceErrors++;
      }
    }
    return {
      market: this.market,
      judgmentRole: 'baseline',
      recordable: this.recordable,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      sessionD0: this.sessionD0 ?? this.maxBarDate,
      validFrom: this.validFrom,
      asOf: this.asOf,
      candidateCount: this.candidateCount,
      promptSha256: this.promptSha256,
      ragContextIds: this.ragContextIds,
      dataStatus: { ...this.dataStatus },
      candidates,
      traceErrors: this.traceErrors,
    };
  }
}
