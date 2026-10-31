/**
 * exit-judgment.ts — 청산 판단 영구 기록 `exit_judgment` (T-126). 1행 = (청산 평가 틱, 보유 종목)의 **결론 하나**.
 *
 * 왜: 청산 엔진(`engine.ts` `runExitEngine`)의 판단은 `eval_funnel`(30일 롤링 삭제)과 pm2 로그(회전 없음)에만 남는다 — 감사 기간 뒤에도
 * "그 틱에 무엇을 보고 왜 발화했나/안 했나"를 남기려는 가산 기록이다. 정본: T-126 task 「설계」 D1~D5, 지표 계약 §11.3·§11.4,
 * DDL `scripts/migrations/T-126-exit-judgment.sql`.
 *
 * ## 영향 0 원칙 (D3 — 청산 평가를 막지 않는다)
 * - 엔진은 결론 지점마다 {@link ExitJudgmentCollector.add} 로 **메모리에 한 줄 push 만** 한다(동기·await 없음·절대 던지지 않음).
 *   행 값은 엔진이 그 지점까지 **이미 가진 값**으로만 만든다 — 새 DB·KIS 조회 0.
 * - 루프가 끝나면 {@link ExitJudgmentCollector.flushDetached} 가 기록을 **시작만** 한다(기다리지 않음·반환값 없음·절대 던지지 않음).
 *   스위치 읽기·INSERT 는 그 분리 실행 안에서만 한다. 전체 상한 {@link EXIT_JUDGMENT_RECORD_TIMEOUT_MS}.
 * - 🔴 (Reviewer R1) 상한은 **기다림만이 아니라 연결도** 끊는다. INSERT 는 풀에서 연결을 직접 받아(`getConnection`) 그 연결로 보내고,
 *   상한을 넘기거나 오류가 나면 그 연결을 `destroy()`(풀에서 제거 — 다음에 필요하면 풀이 새로 만든다), 정상이면 `release()` 한다.
 *   `pool.query` 로 보내면 상한 뒤에도 매달린 INSERT 가 풀 연결을 계속 잡아(운영 `lock_wait_timeout` 86400초), 표 하나가 잠긴 채 약 10틱이면
 *   10개 풀이 바닥나 청산 엔진·주문 경로 쿼리가 줄을 선다(Reviewer 가 일회용 DB 에서 재현). mysql2 쿼리 옵션 `timeout` 은 연결을 돌려주지 않아
 *   처방이 아니고, 서버 쪽 `SET STATEMENT …` 는 운영 계정 권한이 미확인이라 쓰지 않는다(Leader 결정). 상한 뒤에 연결을 받으면 쓰지 않고 바로 돌려준다.
 *   ⚠ 클라이언트 쪽 `destroy()` 는 풀 슬롯만 돌려준다 — 서버에서 잠금을 기다리던 INSERT 가 언제 끝나는지는 서버 동작에 달렸다(일회용 DB 시험이 관찰값을 남긴다).
 * - 모든 실패는 삼키고 `console.warn` 한 줄(원인 분류어·errno 만 — 종목·금액·DB 오류 원문 없음)만 남긴다. 테이블 없음(1146 — DDL 적용 전)은
 *   프로세스당 1회만 알리고 조용히 건너뛴다(T-112 판단 기록기와 같다).
 * - 엔진 쪽 호출부도 한 번 더 감싼다(`engine.ts` 의 T-126 격리 래퍼) — 이 모듈이 나중에 바뀌어 던지게 되더라도 평가로 새지 않는다.
 *
 * ## 스위치
 * `system_config.exit_judgment_record_enabled` — **키 없음 = 꺼짐**, 정확히 JSON `true` 만 켜짐, DB 오류·2초 초과 = 꺼짐(`record-switch.ts`, 30초 캐시).
 * 기록 스위치이지 안전 스위치가 아니다 — 꺼져 있으면 스위치 읽기 1회 외 I/O 0, 거래 동작 영향 없음.
 *
 * ## 값 규칙 (넣기 전에 — multi-row INSERT 는 한 값만 넘어도 문장 전체가 거부된다, strict)
 * - 문자열은 코드포인트 단위로 자르거나(엔진 릴리스) 거부한다(종목 32자 초과·run_id 40자 초과 → 행 없음, 잘린 기호는 다른 종목이 된다).
 * - 숫자는 유한하고 열 범위 안일 때만, 열 소수 자리로 반올림해 넣는다. 아니면 NULL.
 * - `entry_price` = 엔진이 평가에 쓴 진입가(`position_state.entry_price`, 행을 읽기 전 지점은 KIS 평단). `pnl_pct` 는 **그 행의** price·entry_price 로
 *   엔진과 같은 식 `(price − entry) / entry × 100` 을 계산하되, 시세/진입가 비율이 엔진의 단위 검사 범위([0.3, 3.0]) 안일 때만 채운다
 *   (범위 밖은 엔진도 손익을 계산하지 않는 단위 불일치다 — 원값 price·entry_price 는 그대로 남기고 해석은 읽는 쪽, D5②).
 * - `currency`: 엔진의 가격 값은 **국내·해외 모두 원화**다 — 해외 시세(`kis-overseas.ts` getTicker `price = last × fx`)와 평단(getBalances
 *   `avgKrw = avgUsd × balFx`)을 어댑터가 `fetchUsdKrwRate()` 환율로 원화로 바꿔 준다(시험이 그 소스 줄을 고정한다). 국내는 항상 'KRW',
 *   해외는 시세/진입가 비율이 단위 검사 범위 안일 때만 'KRW', 밖이거나 시세가 없으면 NULL(Leader 승인 2026-10-31).
 *   (R4 정정) `fetchUsdKrwRate()` 는 던지지 않는다 — 환율을 못 얻으면(`getUsdKrwRate` 가 던지거나 유효하지 않은 값) **1 을 돌려주고** 그때 그 값은
 *   달러 원값이다(`getBalances` 의 `.catch(() => 1)` 은 죽은 코드). `getUsdKrwRate` 는 외부 → DB 캐시 → 상수 폴백 순이라 1 이 되는 일은 드물다.
 *   시세·평단이 **둘 다** 1 이면 달러끼리라 단위 검사를 통과해 `currency='KRW'` 가 틀린다(이 규칙으로는 못 거른다 — 알려진 한계).
 *   한쪽만 1 이면 비율이 범위 밖이라 NULL 이다.
 *   (설계 D2 의 "KRW/USD, 시장에서 도출"과 다르다 — 해외를 USD 로 적으면 틀린 값이 된다. task 이력서 Developer 절에 보고·승인.)
 * - `threshold_pct`(적용 임계)는 `pnl_pct` 와 같은 부호 공간(손절 = 음수, 익절 = 양수)으로, `evaluateExit` 가 그 종류에 쓴 임계를 **확실히
 *   알 수 있을 때만** 채운다: 장마감 전 손절 = −eodLossCutPct, 손실한도 손절 = −hardStopPct·익절 = +targetProfitPct(시나리오 포지션이 아닐 때만 —
 *   시나리오면 stopHi/stopLo·targetHi/targetLo 중 무엇이 걸렸는지 다시 계산해야 해서 NULL), 트레일링 = NULL(손익률이 아니라 고점 대비 되돌림 조건).
 * - 스위치 열(`exit_engine_enabled`·`exit_hard_stop_enabled`)은 그 틱에 엔진이 적용한 값. 스위치 조회 자체가 실패한 틱(`db_error`)은 NULL.
 * - DRY_RUN(가상 주문) 열은 두지 않는다 — 청산 평가 틱은 그 값을 읽지 않고(주문 단계 `submitOrder` 가 판정) 새 읽기를 더하지 않으므로 늘 비게 된다
 *   (Leader 결정 2026-10-31: 영구 NULL 열은 읽는 쪽을 오도한다). 가상 주문 여부는 `signal_id → signals.consumed_order_id → orders.status` 로 본다.
 */
import type { ResultSetHeader } from 'mysql2';
import type { PoolConnection } from 'mysql2/promise';
import { getPool } from '@/lib/db';
import type { Market } from '@/lib/exchanges/kis-symbols';
import { EXIT_UNIT_RATIO_MAX, EXIT_UNIT_RATIO_MIN, type ExitKind } from '../exit-engine';
import type { ExitEngineSwitch } from '../exit-switch';
import { readRecordSwitch } from './record-switch';
import { etDate, kstDate, kstDatetime } from './job-slots';
import { isCheckViolation, isNoSuchTable, isRowDataError, normalizeSymbol, truncateCodePoints, withDeadline } from './safe-text';

export const EXIT_JUDGMENT_RECORD_SWITCH_KEY = 'exit_judgment_record_enabled' as const;
/** 기록 1회(스위치 읽기 + INSERT 1문장) 전체 상한. */
export const EXIT_JUDGMENT_RECORD_TIMEOUT_MS = 4000;
/** 한 틱이 남길 행 상한(보유 종목 수 — 실제로는 수 개). 넘는 행은 버리고 센다. */
export const MAX_EXIT_JUDGMENT_ROWS = 100;
/** 열 길이(코드포인트) — DDL 과 같다. */
export const EXIT_JUDGMENT_COLUMN_LIMITS = {
  run_id: 40,
  symbol: 32,
  decision_code: 48,
  engine_release: 48,
} as const;
/** 가격·수량 열에 넣을 수 있는 절댓값 상한(미만). DECIMAL(36,8)·(36,18) 범위보다 훨씬 작게 — 그 이상은 값이 아니라 고장이다. */
export const EXIT_JUDGMENT_MAX_ABS_AMOUNT = 1e15;
/** 퍼센트 열(DECIMAL(10,4)) 절댓값 상한(미만). */
export const EXIT_JUDGMENT_MAX_ABS_PCT = 1e6;
/**
 * 수량 반올림 자리 — 열은 DECIMAL(36,18)이지만 엔진 수량은 `free + locked` 덧셈이라 부동소수 잡음(0.1 + 0.2 = 0.30000000000000004)이 생긴다.
 * 18자리로 반올림하면 잡음이 그대로 남으므로 10자리에서 자른다(KIS 소수 수량은 그보다 짧다 — 가능성 높음, 정수 수량은 영향 없음).
 */
export const EXIT_JUDGMENT_QTY_SCALE = 10;
/** 엔진 가격 값의 통화(머리 주석 `currency`). */
export const ENGINE_PRICE_CURRENCY = 'KRW' as const;

export type ExitDecision = 'fired' | 'skip_policy' | 'skip_cooldown' | 'error' | 'no_fire';
export const EXIT_DECISIONS: readonly ExitDecision[] = ['fired', 'skip_policy', 'skip_cooldown', 'error', 'no_fire'];
export type ExitTriggerKind = ExitKind | 'none';
export const EXIT_TRIGGER_KINDS: readonly ExitTriggerKind[] = ['eod_loss_cut', 'hard_stop', 'target_profit', 'trailing_stop', 'none'];

/**
 * 엔진이 결론 지점마다 넘기는 값 — **그 지점까지 엔진이 이미 가진 것만**. 모양만 맞추면 되도록 느슨하게 받는다(값 검사는 빌더가 한다).
 *  - entry: KIS 잔고 한 줄(`HeldEntry` — qty·avgPrice) · ticker: 시세 · state: `position_state` 행 · exitSig: `evaluateExit` 결과 · signalId: 생성된 시그널.
 */
export interface ExitJudgmentInput {
  symbol: string;
  entry?: { qty: number; avgPrice?: number };
  ticker?: { price: number };
  state?: { entryPrice: number; peakPrice: number; scenarioExit?: unknown };
  exitSig?: { exitKind: ExitKind };
  signalId?: number;
}

/** 틱 공통 문맥(수집기를 열 때 한 번). */
export interface ExitJudgmentContext {
  market: Market;
  runId: string;
  /** 그 틱의 마스터 스위치 판독 결과(`readExitEngineSwitch`). */
  exitSwitch: Pick<ExitEngineSwitch, 'enabled' | 'hardStopEnabled' | 'source'>;
  /** 엔진이 `evaluateExit` 에 넘긴 style(임계 출처). */
  style: { eodLossCutPct?: unknown; hardStopPct?: unknown; targetProfitPct?: unknown };
}

/** INSERT 1행(열 순서 = {@link EXIT_JUDGMENT_COLUMNS}). engine_release 는 기록 시점에 채운다. */
export interface ExitJudgmentRow {
  run_id: string;
  evaluated_at: string;
  session_date_kst: string;
  session_date_et: string | null;
  market: Market;
  symbol: string;
  position_qty: number | null;
  entry_price: number | null;
  peak_price: number | null;
  price: number | null;
  currency: typeof ENGINE_PRICE_CURRENCY | null;
  pnl_pct: number | null;
  trigger_kind: ExitTriggerKind;
  threshold_pct: number | null;
  decision: ExitDecision;
  decision_code: string;
  exit_engine_enabled: 0 | 1 | null;
  exit_hard_stop_enabled: 0 | 1 | null;
  signal_id: number | null;
}

export const EXIT_JUDGMENT_COLUMNS = [
  'run_id', 'evaluated_at', 'session_date_kst', 'session_date_et', 'market', 'symbol', 'position_qty', 'entry_price', 'peak_price',
  'price', 'currency', 'pnl_pct', 'trigger_kind', 'threshold_pct', 'decision', 'decision_code', 'exit_engine_enabled',
  'exit_hard_stop_enabled', 'signal_id', 'engine_release',
] as const;

export type ExitJudgmentRecordStatus = 'written' | 'disabled' | 'empty' | 'no_table' | 'error' | 'timeout';
export interface ExitJudgmentRecordResult {
  status: ExitJudgmentRecordStatus;
  rows?: number;
  dropped?: number;
  /** 실패 분류어(로그와 같다) — 원문 메시지는 담지 않는다 */
  reason?: string;
}

const LOG = '[strategy/records/exit-judgment]';
const DECISION_SET: ReadonlySet<string> = new Set(EXIT_DECISIONS);
const TRIGGER_SET: ReadonlySet<string> = new Set(EXIT_TRIGGER_KINDS);
/** 게이트 ID 모양(eval_funnel gate 와 같은 어휘 — 소문자·숫자·밑줄). 목록으로 막지 않는다: 새 정책 스킵 게이트가 생겨도 행이 사라지지 않게. */
const CODE_RE = /^[a-z0-9_]{1,48}$/;

let warnedNoTable = false;

function warn(msg: string): void {
  try { console.warn(`${LOG} ${msg}`); } catch { /* 로그 실패도 흡수 */ }
}

/** 오류 → 분류어(원문 메시지는 쓰지 않는다 — MariaDB 메시지에 값이 들어갈 수 있다). */
export function classifyExitJudgmentError(e: unknown): string {
  try {
    const errno = e !== null && typeof e === 'object' ? (e as { errno?: unknown }).errno : undefined;
    const n = typeof errno === 'number' ? errno : undefined;
    if (isNoSuchTable(e)) return 'no_table errno=1146';
    if (isCheckViolation(e)) return 'check_violation errno=4025';
    if (isRowDataError(e)) return `row_data errno=${n}`;
    if (n !== undefined) return `db_error errno=${n}`;
    return 'exception';
  } catch {
    return 'exception';
  }
}

/** `…/releases/<이름>` 이면 그 이름(48자), 아니면 null — `judgment-recorder.ts` `engineReleaseFromCwd` 와 같은 규칙(시험이 둘을 대조한다).
 *  이 파일은 그 모듈을 import 하지 않는다: 청산 엔진(engine.ts)의 import 그래프에 LLM 설정 모듈을 끌어들이지 않으려는 것(record-switch.ts 와 같은 복제 원칙). */
export function exitEngineReleaseFromCwd(cwd: unknown): string | null {
  if (typeof cwd !== 'string') return null;
  const m = /\/releases\/([^/]+)\/?$/.exec(cwd);
  return m ? truncateCodePoints(m[1], EXIT_JUDGMENT_COLUMN_LIMITS.engine_release) : null;
}

function currentEngineRelease(): string | null {
  try { return exitEngineReleaseFromCwd(process.cwd()); } catch { return null; }
}

/** 유한하고 |v| < maxAbs 인 수만 `scale` 자리로 반올림해 돌려준다. 아니면 null. −0 은 0. */
export function decimalOrNull(v: unknown, scale: number, maxAbs: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  if (!(Math.abs(v) < maxAbs)) return null;
  const r = Number(v.toFixed(scale));
  if (!Number.isFinite(r) || !(Math.abs(r) < maxAbs)) return null;
  return Object.is(r, -0) ? 0 : r;
}

const amount = (v: unknown, scale: number) => decimalOrNull(v, scale, EXIT_JUDGMENT_MAX_ABS_AMOUNT);
const pct = (v: unknown) => decimalOrNull(v, 4, EXIT_JUDGMENT_MAX_ABS_PCT);
const posFinite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** 시세/진입가 비율이 엔진의 단위 검사 범위 안인가(engine.ts `exit_no_fire` 조건·`evaluateExit` 와 같은 상수). */
export function withinUnitRatio(price: unknown, entry: unknown): boolean {
  if (!posFinite(price) || !posFinite(entry)) return false;
  const ratio = price / entry;
  return ratio >= EXIT_UNIT_RATIO_MIN && ratio <= EXIT_UNIT_RATIO_MAX;
}

/**
 * 적용 임계(머리 주석 `threshold_pct`) — 확실히 알 때만. `state` 가 없으면 시나리오 여부를 몰라 손실한도 손절·익절은 NULL.
 * 판정 식은 `exit-engine.ts` `evaluateExit` 를 따른다(시험이 소스 줄과 무작위 입력으로 대조한다).
 */
export function appliedThresholdPct(
  kind: ExitTriggerKind,
  style: ExitJudgmentContext['style'] | null | undefined,
  state: ExitJudgmentInput['state'] | undefined,
): number | null {
  if (!style) return null;
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  // evaluateExit 는 `sc = state.scenarioExit ?? null` 을 **참/거짓**으로 가른다(`sc ? sc.stopHi : style.hardStopPct`) — 같은 판정을 쓴다. null = 모름.
  const scenario = state ? Boolean(state.scenarioExit ?? null) : null;
  let t: number | null = null;
  if (kind === 'eod_loss_cut') {
    const v = num(style.eodLossCutPct);
    t = v === null ? null : -v;
  } else if (kind === 'hard_stop') {
    const v = num(style.hardStopPct);
    t = scenario === false && v !== null ? -v : null;
  } else if (kind === 'target_profit') {
    const v = num(style.targetProfitPct);
    t = scenario === false && v !== null ? v : null;
  }
  return t === null ? null : pct(t);
}

/** 엔진 가격 값의 통화(머리 주석 `currency`). */
export function priceCurrency(market: Market, price: unknown, entry: unknown): typeof ENGINE_PRICE_CURRENCY | null {
  if (market === 'domestic') return ENGINE_PRICE_CURRENCY;
  return withinUnitRatio(price, entry) ? ENGINE_PRICE_CURRENCY : null;
}

/**
 * 행 1개를 만든다. 넣을 수 없는 입력(시장·run_id·종목·결론·코드가 형식 밖)이면 null — **던지지 않는다**(예외도 null).
 * `nowMs` 는 그 종목의 결론 시각.
 */
export function buildExitJudgmentRow(
  ctx: ExitJudgmentContext,
  decision: unknown,
  code: unknown,
  input: ExitJudgmentInput,
  nowMs: number,
): ExitJudgmentRow | null {
  try {
    if (ctx.market !== 'domestic' && ctx.market !== 'overseas') return null;
    if (typeof ctx.runId !== 'string' || ctx.runId.length === 0 || Array.from(ctx.runId).length > EXIT_JUDGMENT_COLUMN_LIMITS.run_id) return null;
    if (typeof decision !== 'string' || !DECISION_SET.has(decision)) return null;
    if (typeof code !== 'string' || !CODE_RE.test(code)) return null;
    if (!input || typeof input !== 'object') return null;
    const symbol = normalizeSymbol(input.symbol);
    if (!symbol) return null;
    if (!Number.isFinite(nowMs)) return null;

    const tickerPrice = input.ticker ? input.ticker.price : undefined;
    const state = input.state;
    // 엔진이 평가에 쓴 진입가: position_state 를 읽은 뒤면 그 값, 전이면 KIS 평단(upsert 가 그 값을 entry_price 로 쓴다).
    const entryRaw = state ? state.entryPrice : input.entry?.avgPrice;
    const price = amount(tickerPrice, 8);
    const entryPrice = amount(entryRaw, 8);
    const peakPrice = state ? amount(state.peakPrice, 8) : null;
    const pnl = withinUnitRatio(tickerPrice, entryRaw)
      ? pct((((tickerPrice as number) - (entryRaw as number)) / (entryRaw as number)) * 100)
      : null;

    const kindRaw = input.exitSig ? input.exitSig.exitKind : 'none';
    const triggerKind: ExitTriggerKind = typeof kindRaw === 'string' && TRIGGER_SET.has(kindRaw) ? (kindRaw as ExitTriggerKind) : 'none';

    const sw = ctx.exitSwitch;
    const switchKnown = !!sw && sw.source !== 'db_error';
    const sid = input.signalId;

    return {
      run_id: ctx.runId,
      evaluated_at: kstDatetime(nowMs),
      session_date_kst: kstDate(nowMs),
      session_date_et: ctx.market === 'overseas' ? etDate(nowMs) : null,
      market: ctx.market,
      symbol,
      position_qty: amount(input.entry?.qty, EXIT_JUDGMENT_QTY_SCALE),
      entry_price: entryPrice,
      peak_price: peakPrice,
      price,
      currency: priceCurrency(ctx.market, tickerPrice, entryRaw),
      pnl_pct: pnl,
      trigger_kind: triggerKind,
      threshold_pct: appliedThresholdPct(triggerKind, ctx.style, state),
      decision: decision as ExitDecision,
      decision_code: code,
      exit_engine_enabled: switchKnown ? (sw.enabled === true ? 1 : 0) : null,
      exit_hard_stop_enabled: switchKnown ? (sw.hardStopEnabled === true ? 1 : 0) : null,
      signal_id: typeof sid === 'number' && Number.isSafeInteger(sid) && sid > 0 ? sid : null,
    };
  } catch {
    return null;
  }
}

/** INSERT 문장과 값(행 순서·열 순서 그대로). */
export function buildExitJudgmentInsert(
  rows: readonly ExitJudgmentRow[],
  engineRelease: string | null,
): { sql: string; params: Array<string | number | null> } {
  const params: Array<string | number | null> = [];
  for (const r of rows) {
    params.push(
      r.run_id, r.evaluated_at, r.session_date_kst, r.session_date_et, r.market, r.symbol, r.position_qty, r.entry_price, r.peak_price,
      r.price, r.currency, r.pnl_pct, r.trigger_kind, r.threshold_pct, r.decision, r.decision_code, r.exit_engine_enabled,
      r.exit_hard_stop_enabled, r.signal_id, engineRelease,
    );
  }
  const one = `(${EXIT_JUDGMENT_COLUMNS.map(() => '?').join(', ')})`;
  return {
    sql: `INSERT INTO exit_judgment (${EXIT_JUDGMENT_COLUMNS.join(', ')}) VALUES ${rows.map(() => one).join(', ')}`,
    params,
  };
}

/**
 * 기록 1회의 연결 상태 — 바깥(상한)과 본문이 같이 본다. 상한이 먼저 오면 바깥이 `late` 를 세우고 잡고 있는 연결을 `destroy()` 한다.
 * 본문은 단계마다 `late` 를 보고, 상한 뒤에 받은 연결은 쓰지 않고 돌려준다.
 */
interface WriteState {
  late: boolean;
  /** INSERT 를 보내는 동안만 채운다(상한이 오면 바깥이 이 연결을 닫는다) */
  conn: PoolConnection | null;
  /** 기록 1회가 받는 연결은 하나뿐 — 그 연결을 이미 돌려주었거나 닫았는가(두 번 끝내지 않는다) */
  connDone: boolean;
}

/** 연결을 풀에서 빼고 닫는다 — 기록 1회에 한 번만, 절대 던지지 않는다(상한에 닫힌 뒤 늦게 온 실패가 다시 닫지 않는다). */
function destroyConn(st: WriteState, conn: PoolConnection | null): void {
  if (!conn || st.connDone) return;
  st.connDone = true;
  st.conn = null;
  try { conn.destroy(); } catch { /* 이미 닫힘 — 흡수 */ }
}
/** 연결을 풀로 돌려준다 — 한 번만, 절대 던지지 않는다(돌려주기가 실패하면 대신 닫는다). */
function releaseConn(st: WriteState, conn: PoolConnection): void {
  if (st.connDone) return;
  st.connDone = true;
  st.conn = null;
  try { conn.release(); } catch { try { conn.destroy(); } catch { /* 흡수 */ } }
}

/** 본문 — 경고를 내지 않는다(결과만 돌려준다). 시간 초과 뒤 늦게 끝난 본문이 경고를 한 줄 더 남기지 않게 경고는 바깥에서 한 번만 낸다. */
async function writeExitJudgments(rows: readonly ExitJudgmentRow[], dropped: number, st: WriteState): Promise<ExitJudgmentRecordResult> {
  if (!(await readRecordSwitch(EXIT_JUDGMENT_RECORD_SWITCH_KEY))) return { status: 'disabled' };
  if (rows.length === 0) return { status: 'empty', rows: 0, dropped };
  if (st.late) return { status: 'timeout', reason: 'timeout', dropped };
  const q = buildExitJudgmentInsert(rows, truncateCodePoints(currentEngineRelease(), EXIT_JUDGMENT_COLUMN_LIMITS.engine_release));
  let conn: PoolConnection;
  try {
    conn = await getPool().getConnection();
  } catch (e) {
    return { status: 'error', reason: classifyExitJudgmentError(e), dropped };
  }
  if (st.late) {   // 풀이 바빠 상한 뒤에야 받은 연결 — 쓰지 않고 돌려준다(늦은 기록 없음)
    releaseConn(st, conn);
    return { status: 'timeout', reason: 'timeout', dropped };
  }
  st.conn = conn;
  try {
    await conn.query<ResultSetHeader>(q.sql, q.params);
  } catch (e) {
    destroyConn(st, conn);   // 오류(상한에 끊긴 경우 포함) — 연결 상태를 믿지 않고 풀에서 뺀다
    if (isNoSuchTable(e)) return { status: 'no_table', reason: 'no_table', dropped };
    return { status: 'error', reason: classifyExitJudgmentError(e), dropped };
  }
  if (st.late) {   // 상한 직후 늦게 끝난 경우 — 바깥이 이미 닫았거나 닫는 중
    destroyConn(st, conn);
    return { status: 'timeout', reason: 'timeout', dropped };
  }
  releaseConn(st, conn);
  return { status: 'written', rows: rows.length, dropped };
}

/** 결과 → 경고 한 줄(없을 수도). 원인 분류어·시장·개수만 — 종목·금액·DB 오류 원문 없음. */
function report(r: ExitJudgmentRecordResult, market: string): void {
  try {
    const dropped = r.dropped && r.dropped > 0 ? ` dropped=${r.dropped}` : '';
    if (r.status === 'no_table') {
      if (!warnedNoTable) { warnedNoTable = true; warn('exit_judgment 테이블이 없어 청산 판단 기록을 건너뜀(DDL 적용 전) — 이 경고는 프로세스당 1회'); }
      return;
    }
    if (r.status === 'error' || r.status === 'timeout') {
      warn(`청산 판단 기록 실패(${r.reason ?? 'exception'}) market=${market}${dropped} — 청산 평가 영향 없음`);
      return;
    }
    if (dropped) warn(`청산 판단 행 ${r.dropped}개를 뺐다(형식 밖·상한 ${MAX_EXIT_JUDGMENT_ROWS}) market=${market}`);
  } catch { /* 로그 실패도 흡수 */ }
}

/**
 * 기록 1회 — {@link EXIT_JUDGMENT_RECORD_TIMEOUT_MS} 안에 반드시 돌아오고 절대 던지지 않는다(시험·분리 실행 공용 진입점).
 * 실패는 경고 한 줄. 시간 초과 뒤 본문이 늦게 실패해도 줄을 더하지 않는다.
 */
export async function recordExitJudgments(
  rows: readonly ExitJudgmentRow[],
  dropped = 0,
  market = 'unknown',
): Promise<ExitJudgmentRecordResult> {
  const st: WriteState = { late: false, conn: null, connDone: false };
  let r: ExitJudgmentRecordResult;
  try {
    const v = await withDeadline(writeExitJudgments(rows, dropped, st), EXIT_JUDGMENT_RECORD_TIMEOUT_MS);
    if (v === undefined) {
      // 🔴 R1 — 기다림만 끊지 않는다: 매달린 INSERT 의 연결을 풀에서 뺀다(슬롯 복귀). 본문은 late 를 보고 더 쓰지 않는다.
      st.late = true;
      destroyConn(st, st.conn);
      r = { status: 'timeout', reason: 'timeout', dropped };
    } else {
      r = v;
    }
  } catch (e) {
    st.late = true;
    destroyConn(st, st.conn);
    r = { status: 'error', reason: classifyExitJudgmentError(e), dropped };
  }
  report(r, market);
  return r;
}

/** 엔진이 쓰는 수집기(틱 1회용). 두 메서드 모두 **절대 던지지 않는다.** */
export interface ExitJudgmentCollector {
  /** 결론 하나를 메모리에 push(동기). 형식 밖 입력은 행을 버리고 센다. */
  add(decision: ExitDecision, code: string | undefined, input: ExitJudgmentInput): void;
  /** 틱 끝 — 모은 행 기록을 분리 실행으로 **시작만** 한다(기다리지 않음). 두 번째 호출부터는 아무것도 하지 않는다. */
  flushDetached(): void;
}

const pending = new Set<Promise<ExitJudgmentRecordResult>>();

const NOOP_COLLECTOR: ExitJudgmentCollector = { add: () => {}, flushDetached: () => {} };

/**
 * 틱 1회용 수집기를 연다. `rec` 은 그 틱의 `EvalFunnelRecorder`(run_id 를 `eval_funnel` 과 같은 값으로 쓰려고 받는다).
 * 절대 던지지 않는다 — 문맥을 만들 수 없으면 아무것도 하지 않는 수집기를 준다.
 */
export function openExitJudgmentCollector(
  market: Market,
  rec: { readonly runId?: unknown } | null | undefined,
  exitSwitch: ExitJudgmentContext['exitSwitch'],
  style: ExitJudgmentContext['style'],
): ExitJudgmentCollector {
  try {
    const runId = rec ? rec.runId : undefined;
    const ctx: ExitJudgmentContext = {
      market,
      runId: typeof runId === 'string' ? runId : '',
      exitSwitch: { enabled: exitSwitch?.enabled, hardStopEnabled: exitSwitch?.hardStopEnabled, source: exitSwitch?.source },
      style,
    };
    const rows: ExitJudgmentRow[] = [];
    let dropped = 0;
    let flushed = false;
    return {
      add(decision, code, input) {
        try {
          if (flushed || rows.length >= MAX_EXIT_JUDGMENT_ROWS) { dropped++; return; }
          const row = buildExitJudgmentRow(ctx, decision, code, input, Date.now());
          if (row) rows.push(row); else dropped++;
        } catch {
          try { dropped++; } catch { /* 흡수 */ }
        }
      },
      flushDetached() {
        try {
          if (flushed) return;
          flushed = true;
          if (rows.length === 0 && dropped === 0) return;   // 보유 종목 결론이 없는 틱 — I/O 0
          const batch = rows.splice(0, rows.length);
          const droppedAtFlush = dropped;
          // 다음 마이크로태스크에서 시작한다 — 스위치 읽기 쿼리조차 엔진의 호출 스택 안에서 동기로 나가지 않게(엔진이 돌아간 뒤에 시작).
          const p = Promise.resolve()
            .then(() => recordExitJudgments(batch, droppedAtFlush, String(ctx.market)))
            .catch((): ExitJudgmentRecordResult => ({ status: 'error', reason: 'exception' }));
          pending.add(p);
          void p.then(() => { pending.delete(p); });
        } catch (e) {
          warn(`청산 판단 기록 시작 실패(${classifyExitJudgmentError(e)}) — 청산 평가 영향 없음`);
        }
      },
    };
  } catch {
    return NOOP_COLLECTOR;
  }
}

/** 시험 전용 — 시작된 기록이 모두 끝날 때까지 기다려 결과를 돌려준다. */
export async function waitForExitJudgmentRecordsForTest(): Promise<ExitJudgmentRecordResult[]> {
  return Promise.all([...pending]);
}

/** 시험 전용 — 프로세스당 1회 경고 표시를 되돌린다. */
export function resetExitJudgmentForTest(): void {
  warnedNoTable = false;
}
