/**
 * post-market-overseas.ts — 미국장 마감 후 "다음 미국 정규장" 시나리오 카드 (T-062 = T-057 P2).
 *
 * `runPostMarketAnalysis('overseas')` 가 지연 import 로 부른다. 국내 경로(`post-market-engine.ts`)는 바꾸지 않는다(요구 9).
 *
 * ## 순서 (앞 단계가 막히면 뒤 단계 코드는 실행되지 않는다)
 *  1. 스위치 `system_config.post_market_overseas_enabled` — **키 없음 = 꺼짐**, 정확히 JSON `true` 만 켜짐, 그 밖의 값·읽기 오류 = 꺼짐.
 *     (T-058 현금 게이트와 방향이 반대다: 그쪽은 기존 기능의 안전장치라 키 없음 = 켜짐, 여기는 새 기능이라 키 없음 = 꺼짐.)
 *     꺼져 있으면 이 함수는 DB 1회(스위치) 외에 아무것도 부르지 않는다 — 시세·환율·실적·LLM·INSERT 0회.
 *  2. `KIS_OVERSEAS_ENABLED`(해외 시장 전체 스위치) 3. 휴장 표 엄격 로드 4. ET 세션 판정(D0·S1..S5)
 *  5. 환율 R 확정(`fx_rates` 신선한 행만) 6. 대상 종목(보유 ∪ 즐겨찾기 ∪ 정적 50) 7. 실적 일정(조회 실패 = 실행 전체 건너뜀, Q-1 (a))
 *  8. 일봉(`kis.getCandles` — 해외 어댑터가 KRW 로 환산) + 마지막 봉 날짜 = D0 검사(S-4) + 환율 일치 검사
 *  9. 규칙 3개(국내와 같음) 10. 블랙아웃 11. 사전 금액 필터(D-5) 12. RAG 13. LLM 1회
 * 14. 응답 엄격 검증(S-1·S-2) 15. 한 실행의 INSERT 를 트랜잭션 하나로(S-3)
 *
 * ## 통화 (T-056·T-058·Q5 (a))
 * 카드 `price`·`indicators.ai.scenario.entry.price_zone` 은 **KRW 환산값**이다 — entry-watcher 가 KIS 해외 현재가(KRW 환산)와
 * 비교하고, 주문 어댑터가 실행 시점 환율로 USD 로 되돌린다. LLM 에는 USD 로 보이고 USD 로 받는다. KRW 구간은
 * `Math.round(USD × R)` 로 같은 R 에서 만든다(화면 데이터 계약 G5: `price_zone_usd`·`fx`).
 */
import type { RowDataPacket } from 'mysql2';
import type { PoolConnection } from 'mysql2/promise';
import { getPool } from '@/lib/db';
import { kis } from '@/lib/exchanges/kis';
import { isOverseasEnabled } from '@/lib/exchanges/market-flags';
import { getUsdKrwRate } from '@/lib/exchanges/fx';
import type { Candle } from '@/lib/exchanges/types';
import { runLlm } from '@/lib/llm/provider';
import { retrieveRagContext } from '@/lib/rag/retrieval';
import { formatRagSection } from '@/lib/rag/format';
import { gateSwitchValueEnabled, judgeFxRow } from '@/lib/signals/signal-cash-gate';
import { loadUsTargetSymbols } from '@/lib/data/us-data-db';
import { eodHighClose } from './rules/eod-high-close';
import { insideBar } from './rules/inside-bar';
import { oversoldBounceDaily } from './rules/oversold-bounce-daily';
import type { DailyCandidate } from './rules/eod-high-close';
import { getStyleConfig } from './style';
import {
  cardBuysZeroShares,
  insertScenarioCardIfAbsent,
  toKstDatetime,
  POST_MARKET_CARD_AMOUNT_KRW_BY_MARKET,
  type PostMarketResult,
  type PostMarketRunStatus,
  type ScenarioCardRow,
} from './post-market-engine';
import {
  candleSessionDate,
  etDateOf,
  isUsRegularSessionOpen,
  lastCompletedSessionEt,
  loadUsClosedDaysStrict,
  nextSessionsEt,
  sessionWindowUtc,
  yearsNeededFor,
} from './us-session';
import { EARNINGS_BLACKOUT_DAYS, judgeBlackout, loadEarningsEvents, type EarningsSummary } from './earnings-blackout';

// ─────────────────────────────────────────────────────────────────────────────
// 상수 — 임계값과 근거 (S-1, D-4, D-5)
// ─────────────────────────────────────────────────────────────────────────────

/** 스위치 키. 🔴 키 없음 = 꺼짐(새 기능 — 사용자가 켜기 전까지 운영 동작 불변). */
export const POST_MARKET_OVERSEAS_SWITCH_KEY = 'post_market_overseas_enabled';

/**
 * LLM 진입 구간의 각 끝(lo·hi)과 중간값이 USD 종가의 이 배수 범위 안이어야 한다(D-4 + S-1).
 * 근거: 프롬프트가 "시초가 ±1~2% 내외"를 요구하고 다음 정규장 하루 갭이 대형주에서 ±15% 를 넘는 일은 드물다. 이 밖이면
 * 단위 착오(KRW 로 답함 = 약 1,300배, 센트 = 100배)이거나 의미 없는 구간이다 — 단위 착오의 유일한 방어선.
 */
export const ZONE_MIN_RATIO = 0.85;
export const ZONE_MAX_RATIO = 1.15;
/**
 * 구간 폭 상한: (hi − lo) ÷ USD 종가 ≤ 5%. 근거: 프롬프트 기준 "±1~2%" → 폭 4% 이하가 정상. entry-watcher 는 현재가가 구간 안이면
 * 바로 주문하므로, 넓은 구간은 사실상 "아무 가격에나 산다"가 된다.
 */
export const ZONE_MAX_WIDTH_RATIO = 0.05;
/** 목표 수익률(%) 허용 범위 (0, 20]. 근거: 보유 1~5일 시나리오 — 프롬프트 예시 3.5. 20% 초과는 착오로 본다. */
export const TARGET_PCT_MAX = 20;
/**
 * 손절 비율(%) 허용 범위 (0, 15]. **양수(크기)만** 받는다 — 카드 reasoning 이 `손절: -${stop_pct}%` 로 부호를 붙이고
 * (국내와 같음), entry-watcher 는 `Math.abs(stop_pct)` 로 읽는다. 음수는 부호 규약 위반이라 거부한다.
 */
export const STOP_PCT_MAX = 15;
/** 보유일 허용 범위(정수) — 프롬프트 "1~5". 없으면 국내와 같이 2일. */
export const HOLDING_DAYS_MIN = 1;
export const HOLDING_DAYS_MAX = 5;
export const HOLDING_DAYS_DEFAULT = 2;
/** 신뢰도 하한(국내와 같음) — 미만은 SKIP 으로 센다. 값 자체는 [0, 100] 이어야 한다(아니면 스키마 위반). */
export const MIN_CONFIDENCE = 60;
/**
 * D-5 — LLM 전 사전 금액 필터: KRW 종가 × (1 + 추격률) 가 카드 금액 × 1.10 을 넘으면 LLM 후보에서 뺀다.
 * 10% 여유는 "다음 날 구간이 종가보다 낮게 잡혀 살 수 있게 되는" 경우를 남기기 위한 것이다. 최종 판정은 LLM 뒤
 * `cardBuysZeroShares` 가 카드 가격으로 다시 한다.
 */
export const PREFILTER_AMOUNT_SLACK = 1.10;
/** 환율 일치 허용 오차 — 캔들 환산 전후 `getUsdKrwRate()` 가 R 과 0.1% 안이어야 한다(`fx_rates` 4자리 저장 반올림 흡수). */
export const FX_CONSISTENCY_TOLERANCE = 0.001;
/** 환율 갱신 유도 대기 상한(ms) — `fx.ts` 외부 원천 3곳 × 5초. 넘어도 `fx_rates` 판정으로 간다. */
export const FX_REFRESH_TIMEOUT_MS = 16_000;
/**
 * Reviewer L-3 — 일봉 KRW 종가 하한(= R × $1). 해외 어댑터는 환율 조회가 던지면 **배수 1**(USD 숫자를 KRW 로 표기)로 환산하는데,
 * 그 값은 `close / R` 로 다시 USD 로 바꿔도 그대로 틀린 스케일이라 구간 가드·프롬프트가 같이 속는다(Reviewer 프로브: 27원 카드).
 * 근거: 대상 종목(정적 50 대형주·보유·즐겨찾기)은 $1 미만일 수 없다고 본다(NASDAQ·NYSE 상장 유지 기준이 $1). 환산되지 않은
 * 값은 USD 가격 그대로라 $1,330 미만 종목 전부가 걸린다. 한 종목이라도 걸리면 **실행 전체를 data_unknown(503)** 으로 끝낸다 —
 * 배수 1 은 같은 실행의 모든 종목이 공유하는 `getUsdKrwRate` 실패에서 오므로, 하한 위에 있는 고가주(환산 안 된 $5,000 종목 등)도
 * 같이 틀렸을 수 있어 종목별 제외로는 막을 수 없다. 대가: 대상에 실제 $1 미만 종목이 들어오면 그날 해외 카드는 0장(503, errors 에 종목명).
 */
export const MIN_CLOSE_USD_FOR_SCALE = 1;
export const LLM_TIMEOUT_MS = 90_000;

// ─────────────────────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────────────────────

export type OverseasSwitchSource = 'missing' | 'value' | 'read_error';

export interface PostMarketOverseasResult extends PostMarketResult {
  market: 'overseas';
  ok: boolean;
  status: PostMarketRunStatus;
  switchSource?: OverseasSwitchSource;
  /** 방금 끝난 세션 D0 와 카드가 겨냥하는 다음 정규장 S1 (ET 날짜). */
  sessionEt?: { d0: string; s1: string };
  /** 마지막 일봉 날짜 ≠ D0 이라 제외한 종목 수(S-4). */
  staleCandleSkipped?: number;
  /** 확정 실적 일정이 블랙아웃 안이라 제외한 후보 수. */
  blackoutSkipped?: number;
  /** D-5 사전 금액 필터로 LLM 전에 제외한 후보 수. */
  prefilterUnaffordable?: number;
  /** LLM 에 넘긴 후보 수. */
  llmCandidates?: number;
  /** S-1 — 형식·범위 위반(숫자 아님·음수·역전·목표/손절/보유일 범위 밖 등) 결정 수. */
  schemaRejected?: number;
  /** D-4·S-1 — 구간이 USD 종가 대비 허용 범위·폭 밖인 결정 수(단위 착오 의심). */
  zoneRejected?: number;
}

interface FxKnown { kind: 'known'; rate: number; asOf: string }
type FxResult = FxKnown | { kind: 'unknown'; reason: string };

/** LLM 결정 한 줄의 검증 결과. */
export type OverseasDecisionCheck =
  | { kind: 'skip' }
  | { kind: 'schema'; why: string }
  | { kind: 'low_confidence'; confidence: number }
  | { kind: 'zone'; why: string }
  | {
      kind: 'buy';
      loUsd: number; hiUsd: number; targetPct: number; stopPct: number; holdingDays: number; confidence: number; reasoning: string;
    };

// ─────────────────────────────────────────────────────────────────────────────
// 작은 순수 함수
// ─────────────────────────────────────────────────────────────────────────────

const round2 = (x: number) => Math.round(x * 100) / 100;
const usd = (krw: number, rate: number) => (krw / rate).toFixed(2);
/** 정수 KRW 천 단위 쉼표 — 로캘 무관. */
export function formatKrwInt(n: number): string {
  const s = String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return n < 0 ? `-${s}` : s;
}
/** 환율 표기 — 정수부 천 단위 쉼표, 소수는 2자리까지(끝 0 제거). 1330 → "1,330", 1327.84 → "1,327.84", 1327.8 → "1,327.8". */
export function formatFxRate(rate: number): string {
  const [i, f = '00'] = rate.toFixed(2).split('.');
  const int = formatKrwInt(Number(i));
  const frac = f.replace(/0+$/, '');
  return frac ? `${int}.${frac}` : int;
}
/**
 * T-062 Leader 결정 — 해외 카드 reasoning 의 규칙 근거 줄(`MA5=36309` 등)은 원화 환산값인데 단위가 없다. 그 줄 바로 뒤에
 * 단위·환율 기준을 밝힌다. 환율·기준일은 카드 `indicators.fx.rate`·`fx.asOf`(KST) 와 같은 값.
 */
export function krwBasisNote(rate: number, fxAsOf: string): string {
  return `※ 위 규칙 근거의 가격 숫자(MA·볼린저·전저점 등)는 원화 환산값입니다 (환율 ${formatFxRate(rate)}원, 기준 ${fxAsOf.slice(5, 10)})`;
}
/** KST ISO 8601 + 오프셋 (`2026-10-21T08:00:12+09:00`). */
export function toKstIso(d: Date): string {
  return `${toKstDatetime(d).replace(' ', 'T')}+09:00`;
}
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 스위치 값 → 켜짐? (정확히 JSON 불리언 true 만) — T-058 게이트의 판정식을 재사용한다(문자열 "true"·0·null·파싱 불가 = 꺼짐). */
export async function readPostMarketOverseasSwitch(): Promise<{ enabled: boolean; source: OverseasSwitchSource }> {
  try {
    const [rows] = await getPool().query<(RowDataPacket & { value: unknown })[]>(
      'SELECT value FROM system_config WHERE `key` = ? LIMIT 1',
      [POST_MARKET_OVERSEAS_SWITCH_KEY],
    );
    const row = (rows ?? [])[0];
    if (!row) return { enabled: false, source: 'missing' };
    return { enabled: gateSwitchValueEnabled(row.value), source: 'value' };
  } catch {
    return { enabled: false, source: 'read_error' };
  }
}

async function raceTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), ms); })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 카드에 쓸 환율 R 과 그 관측 시각. `getUsdKrwRate()` 로 갱신만 유도하고(반환값은 폴백 1380·오래된 값일 수 있어 쓰지 않는다),
 * `fx_rates` 행을 T-058 게이트와 같은 기준(`judgeFxRow` — 1시간 이내·100~10,000)으로 판정한다. 관측 시각은 DB 가 KST 벽시계로
 * 저장한 `fetched_at` 을 그대로 문자열로 받아 `+09:00` 을 붙인다(T-046 — 시간대 해석 차이 없음).
 */
async function readCardFx(): Promise<FxResult> {
  await raceTimeout(getUsdKrwRate().then(() => undefined, () => undefined), FX_REFRESH_TIMEOUT_MS);
  try {
    const [rows] = await getPool().query<RowDataPacket[]>(
      `SELECT rate, TIMESTAMPDIFF(SECOND, fetched_at, NOW()) AS age_sec,
              DATE_FORMAT(fetched_at, '%Y-%m-%dT%H:%i:%s') AS fetched_kst
         FROM fx_rates WHERE pair = ? LIMIT 1`,
      ['USD_KRW'],
    );
    const row = (rows ?? [])[0];
    if (!row) return { kind: 'unknown', reason: 'fx_missing' };
    const v = judgeFxRow(row.rate, row.age_sec);
    if (v.kind !== 'known') return { kind: 'unknown', reason: v.reason };
    const fetched = String(row.fetched_kst ?? '');
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(fetched)) return { kind: 'unknown', reason: 'fx_invalid' };
    return { kind: 'known', rate: v.rate, asOf: `${fetched}+09:00` };
  } catch {
    return { kind: 'unknown', reason: 'fx_read_failed' };
  }
}

function fxMatches(x: unknown, rate: number): boolean {
  return isFiniteNumber(x) && x > 0 && Math.abs(x / rate - 1) <= FX_CONSISTENCY_TOLERANCE;
}

/**
 * S-2 — LLM 응답의 최상위 구조. 파싱 실패·객체 아님·`decisions` 누락/배열 아님은 **실패**다(빈 결과가 아니다).
 * 빈 배열 `[]` 은 "고를 종목 없음"이라는 정상 응답으로 본다.
 */
export function parseOverseasAiResponse(raw: unknown): { ok: true; decisions: unknown[] } | { ok: false; reason: string } {
  let json: unknown = raw;
  if (typeof raw === 'string') {
    try {
      json = JSON.parse(raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
    } catch {
      return { ok: false, reason: 'json_parse' };
    }
  }
  if (json == null || typeof json !== 'object' || Array.isArray(json)) return { ok: false, reason: 'not_object' };
  if (!('decisions' in json)) return { ok: false, reason: 'decisions_missing' };
  const decisions = (json as { decisions: unknown }).decisions;
  if (!Array.isArray(decisions)) return { ok: false, reason: 'decisions_not_array' };
  return { ok: true, decisions };
}

/**
 * S-1 — 해외 LLM 결정 한 줄 엄격 검증(순수). 숫자는 **JSON 숫자형**만 받는다(문자열 "27.2" 거부). 순서: 형식(schema) → 신뢰도
 * → 구간 타당성(zone). `closeUsd` 는 D0 종가(USD).
 */
export function checkOverseasDecision(d: Record<string, unknown>, closeUsd: number): OverseasDecisionCheck {
  if (d.action === 'SKIP') return { kind: 'skip' };
  if (d.action !== 'BUY') return { kind: 'schema', why: 'action' };

  const zone = d.entry_zone;
  if (zone == null || typeof zone !== 'object' || Array.isArray(zone)) return { kind: 'schema', why: 'entry_zone' };
  const { lo, hi } = zone as Record<string, unknown>;
  if (!isFiniteNumber(lo) || !isFiniteNumber(hi)) return { kind: 'schema', why: 'zone_not_number' };
  if (!(lo > 0) || !(hi > 0)) return { kind: 'schema', why: 'zone_not_positive' };
  if (lo > hi) return { kind: 'schema', why: 'zone_inverted' };
  const loUsd = round2(lo);
  const hiUsd = round2(hi);
  if (!(loUsd > 0)) return { kind: 'schema', why: 'zone_not_positive' };

  const target = d.target_pct;
  if (!isFiniteNumber(target) || !(target > 0) || target > TARGET_PCT_MAX) return { kind: 'schema', why: 'target_pct' };
  const stop = d.stop_pct;
  if (!isFiniteNumber(stop) || !(stop > 0) || stop > STOP_PCT_MAX) return { kind: 'schema', why: 'stop_pct' };
  let holdingDays = HOLDING_DAYS_DEFAULT;
  if (d.holding_days !== undefined && d.holding_days !== null) {
    const h = d.holding_days;
    if (!isFiniteNumber(h) || !Number.isInteger(h) || h < HOLDING_DAYS_MIN || h > HOLDING_DAYS_MAX) {
      return { kind: 'schema', why: 'holding_days' };
    }
    holdingDays = h;
  }
  const confidence = d.confidence;
  if (!isFiniteNumber(confidence) || confidence < 0 || confidence > 100) return { kind: 'schema', why: 'confidence' };
  if (d.reasoning !== undefined && d.reasoning !== null && typeof d.reasoning !== 'string') return { kind: 'schema', why: 'reasoning' };

  if (confidence < MIN_CONFIDENCE) return { kind: 'low_confidence', confidence };

  if (!isFiniteNumber(closeUsd) || !(closeUsd > 0)) return { kind: 'zone', why: 'close_unknown' };
  const minOk = closeUsd * ZONE_MIN_RATIO;
  const maxOk = closeUsd * ZONE_MAX_RATIO;
  if (lo < minOk || lo > maxOk) return { kind: 'zone', why: 'lo_out_of_range' };
  if (hi < minOk || hi > maxOk) return { kind: 'zone', why: 'hi_out_of_range' };
  const mid = (lo + hi) / 2;
  if (mid < minOk || mid > maxOk) return { kind: 'zone', why: 'mid_out_of_range' };
  if ((hi - lo) / closeUsd > ZONE_MAX_WIDTH_RATIO) return { kind: 'zone', why: 'too_wide' };

  return {
    kind: 'buy', loUsd, hiUsd, targetPct: target, stopPct: stop, holdingDays, confidence,
    reasoning: typeof d.reasoning === 'string' ? d.reasoning : '',
  };
}

/** 해외 프롬프트(국내 `buildPrompt` 는 건드리지 않는다). 가격은 KRW 환산값 ÷ R 을 USD `toFixed(2)` 로 보인다. */
export function buildOverseasPrompt(
  candidates: DailyCandidate[],
  ragSection: string,
  ctx: { d0: string; s1: string; rate: number; fxAsOf: string },
): string {
  const { d0, s1, rate, fxAsOf } = ctx;
  const symbolBlocks = candidates.map(c => {
    const ma5Str  = c.ma5  != null ? `$${usd(c.ma5, rate)}`  : 'N/A';
    const ma20Str = c.ma20 != null ? `$${usd(c.ma20, rate)}` : 'N/A';
    const rsiStr  = c.rsi14 != null ? c.rsi14.toFixed(1) : 'N/A';
    return [
      `## ${c.symbol} [${c.pattern}]`,
      `- ${d0} 일봉(USD): 시=$${usd(c.open, rate)} 고=$${usd(c.high, rate)} 저=$${usd(c.low, rate)} 종=$${usd(c.close, rate)} 거래량비율=${c.volRatio.toFixed(2)}x`,
      `- RSI14=${rsiStr} MA5=${ma5Str} MA20=${ma20Str}`,
      `- 패턴 근거(괄호·숫자 가격은 원화 환산값): ${c.reasoning}`,
    ].join('\n');
  }).join('\n\n');

  return `당신은 미국주식 다음 정규장 진입 시나리오를 분석하는 전문 트레이더입니다.

미국 정규장(${d0}, 미국 동부시간) 마감 후 데이터를 기반으로 다음 미국 정규장(${s1}, 09:30~16:00 ET)에 진입 가능한 종목을 선별하세요.

가격 단위는 미국 달러(USD)입니다. 아래 가격은 원화 환산 시세를 환율 1 USD = ${rate.toFixed(2)} KRW(fx_rates, 관측 ${fxAsOf})로 나눈 값입니다.

${ragSection ? ragSection + '\n\n' : ''}### 후보 종목 (일봉 패턴 감지)

${symbolBlocks}

### 판단 기준
1. 다음 정규장 갭업/갭다운 위험 (오늘 급등했으면 갭업 차익실현 가능성)
2. 뉴스·섹터 모멘텀 지속 여부 (RAG 컨텍스트 참고)
3. 기술적 지지·저항 레벨 (MA, BB 기준)
4. 진입 구간 현실성 (시초가 ±1~2% 내외)

### 출력 형식 (JSON only)
{
  "decisions": [
    {
      "symbol": "종목코드(위 목록 표기 그대로, 예: NAS:AAPL)",
      "action": "BUY" 또는 "SKIP",
      "entry_zone": {"lo": 진입하단가(USD), "hi": 진입상단가(USD)},
      "target_pct": 목표수익률(예: 3.5),
      "stop_pct": 손절비율(양수, 예: 1.8),
      "holding_days": 예상보유일수(1~5 정수),
      "confidence": 신뢰도(0~100),
      "reasoning": "한국어 판단 근거 2~3문장"
    }
  ]
}

BUY 선택 시 entry_zone, target_pct, stop_pct, confidence 필수. entry_zone 은 반드시 미국 달러(USD, 소수 2자리)로 쓰세요 — 원화 금지.
신뢰도 60% 미만이면 SKIP 권장. 최대 5종목 BUY 선택.`;
}

/** 국내와 같은 우선순위로 종목당 후보 1개(eod-high-close > inside-bar > oversold-bounce). */
function dedupeCandidates(candidates: DailyCandidate[]): DailyCandidate[] {
  const PATTERN_PRIORITY = { 'eod-high-close': 0, 'inside-bar': 1, 'oversold-bounce': 2 };
  const deduped = new Map<string, DailyCandidate>();
  for (const c of candidates) {
    const existing = deduped.get(c.symbol);
    if (!existing || PATTERN_PRIORITY[c.pattern] < PATTERN_PRIORITY[existing.pattern]) deduped.set(c.symbol, c);
  }
  return [...deduped.values()];
}

/**
 * S-3 — 한 실행의 카드 INSERT 를 트랜잭션 하나로. 하나라도 예외면 전부 ROLLBACK(부분 생성 없음). `duplicate`(이미 같은 카드 있음,
 * NOT EXISTS 0행 또는 1062)는 실패가 아니다 — InnoDB 에서 1062 는 그 문장만 되돌리고 트랜잭션은 계속된다.
 * ROLLBACK 자체가 실패하면 연결을 풀에 돌려주지 않고 닫는다(열린 트랜잭션·락이 남은 연결 재사용 방지).
 */
async function insertCardsAtomically(
  rows: ScenarioCardRow[],
): Promise<{ ok: true; outcomes: Array<'created' | 'duplicate'> } | { ok: false; error: string }> {
  let conn: PoolConnection;
  try {
    conn = await getPool().getConnection();
  } catch (e) {
    return { ok: false, error: `connection:${errMsg(e)}` };
  }
  let discard = false;
  try {
    await conn.beginTransaction();
    const outcomes: Array<'created' | 'duplicate'> = [];
    try {
      for (const row of rows) outcomes.push(await insertScenarioCardIfAbsent(conn, row));
      await conn.commit();
      return { ok: true, outcomes };
    } catch (e) {
      await conn.rollback().catch(() => { discard = true; });
      return { ok: false, error: errMsg(e) };
    }
  } catch (e) {
    discard = true;   // beginTransaction 실패 — 연결 상태를 모른다
    return { ok: false, error: `begin:${errMsg(e)}` };
  } finally {
    if (discard) conn.destroy();
    else conn.release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 실행
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Codex C2 ① — 프로세스 내 single-flight. 키 = `overseas:<D0(ET 세션 날짜)>`. 같은 키가 진행 중이면 두 번째 호출은 환율·종목·실적·
 * 시세(KIS)·RAG·LLM·INSERT 를 하나도 부르지 않고 `in_progress` 로 끝난다(라우트 503 → cron 재시도 규칙). 해제는 `finally`
 * (정상·실패·예외 모두) — 영구 잠금 없음.
 * 🔴 한계: 이 집합은 **Node 프로세스 하나 안에서만** 유효하다. `stockinvest` 는 pm2 `instances: 1` 이라 러너 재시작 뒤 재호출·
 * 수동 호출 겹침은 막지만, 프로세스가 여럿이거나 blue/green 전환 중 두 릴리스가 동시에 떠 있는 동안의 겹침은 막지 못한다
 * (그때도 최종 카드 중복은 유니크 키·NOT EXISTS 가 막고, 중복되는 것은 KIS 일봉·RAG·LLM 호출뿐). DB lease·별도 worker 는 후속 과제.
 */
const overseasInFlight = new Set<string>();

export async function runPostMarketOverseas(): Promise<PostMarketOverseasResult> {
  const errors: string[] = [];
  const base = (over: Partial<PostMarketOverseasResult> = {}): PostMarketOverseasResult => ({
    market: 'overseas', ok: true, status: 'ok',
    symbolsEvaluated: 0, candidatesFound: 0, signalsCreated: 0, signalsSkipped: 0, errors, validFrom: '',
    ...over,
  });
  // T-062 Leader 결정 — 데이터를 일시적으로 모르는 날은 "정상 0건"이 아니라 재시도 가능한 실패(503, cron-runner 가 하루 최대 3회).
  // 셋(휴장·환율·실적)은 KIS·LLM 호출 전에 끝나고, fx_inconsistent·candles_unavailable·candle_scale_suspect 는 일봉 GET(종목 수만큼) 뒤
  // LLM 전에 끝난다.
  const unknownDay = { ok: false, status: 'data_unknown' } as const;

  // 1. 스위치 — 🔴 이 줄 앞에 다른 I/O 를 두지 않는다(꺼짐 = 해외 경로 호출 0).
  const sw = await readPostMarketOverseasSwitch();
  if (!sw.enabled) {
    console.log(`[post-market] market=overseas 꺼짐(${POST_MARKET_OVERSEAS_SWITCH_KEY}: ${sw.source}) — 해외 카드를 만들지 않습니다`);
    return base({ skipped: 'overseas_disabled', switchSource: sw.source });
  }
  // 2. 해외 시장 전체 스위치(env)
  if (!isOverseasEnabled()) return base({ skipped: 'overseas_market_disabled', switchSource: sw.source });

  const now = new Date();
  const observedAt = toKstIso(now);

  // 3. 휴장 표(엄격 — 모르면 만들지 않는다)
  let closed: Set<string>;
  try {
    closed = await loadUsClosedDaysStrict(getPool(), yearsNeededFor(now));
  } catch (e) {
    errors.push(`holidays_unknown:${errMsg(e)}`);
    return base({ ...unknownDay, skipped: 'holidays_unknown', switchSource: sw.source });
  }

  // 4. 세션 — 장중이면 새 종가가 없고, ET 날짜가 거래일이 아니거나 16:00 ET 전이면 새 세션이 없다.
  if (isUsRegularSessionOpen(now, closed)) return base({ skipped: 'us_session_open', switchSource: sw.source });
  const d0 = lastCompletedSessionEt(now, closed);
  if (!d0) {
    console.log(`[post-market] market=overseas ET ${etDateOf(now)} — 새로 끝난 미국 정규장이 없어 건너뜁니다`);
    return base({ skipped: 'no_new_session', switchSource: sw.source });
  }
  const flightKey = `overseas:${d0}`;
  if (overseasInFlight.has(flightKey)) {
    console.log(`[post-market] market=overseas D0=${d0} 분석이 이미 진행 중 — 외부 호출 없이 끝냅니다(재시도 가능)`);
    errors.push(`in_progress:${flightKey}`);
    return base({ ok: false, status: 'in_progress', switchSource: sw.source });
  }
  overseasInFlight.add(flightKey);
  try {
    const sessions = nextSessionsEt(d0, EARNINGS_BLACKOUT_DAYS, closed);
    const s1 = sessions[0];
    const { openUtc, closeUtc } = sessionWindowUtc(s1);
    const validFrom = toKstDatetime(new Date(openUtc));
    const expiresAt = toKstDatetime(new Date(closeUtc));
    const sessionEt = { d0, s1 };

    // 5. 환율 R
    const fx = await readCardFx();
    if (fx.kind !== 'known') {
      errors.push(`fx_unknown:${fx.reason}`);
      return base({ ...unknownDay, skipped: 'fx_unknown', switchSource: sw.source, validFrom, sessionEt });
    }
    const R = fx.rate;

    // 6. 대상 종목
    const target = await loadUsTargetSymbols(getPool());
    for (const src of target.errors) errors.push(`symbol_source_fail:${src}`);
    const symbols = target.symbols;
    if (symbols.length === 0) {
      errors.push('no_symbols');
      return base({ switchSource: sw.source, validFrom, sessionEt });
    }

    // 7. 실적 일정 — 조회 실패·테이블 없음이면 실행 전체를 건너뛴다(Q-1 (a)). 시세 호출 전에 확인해 KIS 호출을 아낀다.
    const earnings = await loadEarningsEvents(getPool(), symbols, d0);
    if (earnings.kind !== 'ok') {
      errors.push(`earnings_unknown:${earnings.reason}`);
      return base({ ...unknownDay, skipped: 'earnings_unknown', switchSource: sw.source, validFrom, sessionEt, symbolsEvaluated: symbols.length });
    }

    // 8. 일봉 — 해외 어댑터가 KRW 로 환산한다. 환산에 쓴 환율이 R 과 같았는지 전후로 확인한다(폴백 1·1380 오염 방지).
    const fxBefore = await getUsdKrwRate().catch(() => Number.NaN);
    const candleResults = await Promise.allSettled(symbols.map((s) => kis.getCandles(s, '1d', 60)));
    const fxAfter = await getUsdKrwRate().catch(() => Number.NaN);
    // T-062 Leader 결정 — 요청한 일봉이 **전부** 응답을 못 받았으면(KIS 장애) "후보 0" 이 아니라 일시 모름(503 → 재시도).
    // 응답은 받았지만 오래된 봉(stale)·빈 봉은 성공으로 센다. 일부만 실패하면 실패 종목만 건너뛰고 진행한다(아래 candle_fail).
    if (symbols.length > 0 && candleResults.every((r) => r.status === 'rejected')) {
      const first = candleResults[0] as PromiseRejectedResult;
      errors.push(`candles_unavailable:${symbols.length}/${symbols.length}:${errMsg(first.reason)}`);
      console.error(`[post-market] market=overseas 일봉 ${symbols.length}종목 조회가 전부 실패 — 이번 실행은 카드를 만들지 않음(재시도 가능)`);
      return base({ ...unknownDay, skipped: 'candles_unavailable', switchSource: sw.source, validFrom, sessionEt, symbolsEvaluated: symbols.length });
    }
    if (!fxMatches(fxBefore, R) || !fxMatches(fxAfter, R)) {
      errors.push(`fx_inconsistent:R=${R},before=${fxBefore},after=${fxAfter}`);
      return base({ ...unknownDay, skipped: 'fx_inconsistent', switchSource: sw.source, validFrom, sessionEt, symbolsEvaluated: symbols.length });
    }

    // Reviewer L-3 — 환산 스케일 방어선: 마지막 봉 KRW 종가 < R × $1 이면 환산 실패(배수 1) 의심 → 실행 전체 503.
    const scaleSuspects: string[] = [];
    candleResults.forEach((r, i) => {
      if (r.status !== 'fulfilled') return;
      const last = (r.value ?? [])[(r.value ?? []).length - 1];
      if (last && !(last.close >= R * MIN_CLOSE_USD_FOR_SCALE)) scaleSuspects.push(`${symbols[i]}(close=${last.close})`);
    });
    if (scaleSuspects.length > 0) {
      errors.push(`candle_scale_suspect:${scaleSuspects.join(',')}`);
      console.error(`[post-market] market=overseas 일봉 KRW 종가가 R×$${MIN_CLOSE_USD_FOR_SCALE} 미만 — 환산 실패 의심, 이번 실행은 카드를 만들지 않음: ${scaleSuspects.join(', ')}`);
      return base({ ...unknownDay, skipped: 'candle_scale_suspect', switchSource: sw.source, validFrom, sessionEt, symbolsEvaluated: symbols.length });
    }

    let staleCandleSkipped = 0;
    const candidates: DailyCandidate[] = [];
    candleResults.forEach((r, i) => {
      const symbol = symbols[i];
      if (r.status === 'rejected') {
        errors.push(`candle_fail:${symbol}:${errMsg(r.reason)}`);
        return;
      }
      const candles: Candle[] = r.value ?? [];
      const last = candles[candles.length - 1];
      const lastDate = last ? candleSessionDate(last.ts) : null;
      if (lastDate !== d0) {   // 🔴 S-4 — UTC 날짜 그대로 비교(시간대 변환 없음)
        staleCandleSkipped++;
        return;
      }
      const eod = eodHighClose(symbol, candles);
      const ib  = insideBar(symbol, candles);
      const osb = oversoldBounceDaily(symbol, candles);
      if (eod) candidates.push(eod);
      if (ib)  candidates.push(ib);
      if (osb) candidates.push(osb);
    });
    const unique = dedupeCandidates(candidates);

    // 9~10. 블랙아웃
    let blackoutSkipped = 0;
    const earningsBySymbol = new Map<string, EarningsSummary>();
    const afterBlackout = unique.filter((c) => {
      const v = judgeBlackout(earnings.bySymbol.get(c.symbol) ?? [], d0, sessions, observedAt);
      if (v.blocked) {
        blackoutSkipped++;
        console.log(`[post-market] 📅 ${c.symbol} 확정 실적 일정이 다음 ${EARNINGS_BLACKOUT_DAYS}거래일 안 — BUY 카드를 만들지 않음`);
        return false;
      }
      earningsBySymbol.set(c.symbol, v.summary);
      return true;
    });

    // 11. 사전 금액 필터(D-5) — 실행 경로와 같은 추격률. 읽지 못하면 0(국내와 같은 이유: 덜 거를 뿐 새 실패를 만들지 않는다).
    let chasePct = 0;
    try {
      chasePct = (await getStyleConfig()).limitChasePct;
    } catch (e) {
      console.warn(`[post-market] 지정가 추격률을 읽지 못해 추격 0 으로 금액 판정: ${errMsg(e)}`);
    }
    const amountKrw = POST_MARKET_CARD_AMOUNT_KRW_BY_MARKET.overseas;
    const chase = chasePct > 0 ? chasePct : 0;
    let prefilterUnaffordable = 0;
    const llmCandidates = afterBlackout.filter((c) => {
      if (c.close * (1 + chase) > amountKrw * PREFILTER_AMOUNT_SLACK) {
        prefilterUnaffordable++;
        return false;
      }
      return true;
    });

    const common = {
      switchSource: sw.source, validFrom, sessionEt, symbolsEvaluated: symbols.length, candidatesFound: unique.length,
      staleCandleSkipped, blackoutSkipped, prefilterUnaffordable, llmCandidates: llmCandidates.length,
    };
    if (llmCandidates.length === 0) {
      console.log(
        `[post-market] market=overseas evaluated=${symbols.length} candidates=${unique.length} LLM 후보 0 ` +
        `(오래된 봉 ${staleCandleSkipped}, 블랙아웃 ${blackoutSkipped}, 사전 금액 초과 ${prefilterUnaffordable}) valid_from=${validFrom}`,
      );
      return base({ ...common, schemaRejected: 0, zoneRejected: 0, duplicatesSkipped: 0, unaffordableSkipped: 0 });
    }

    // 12. RAG
    const queryText = llmCandidates.map(c => `${c.symbol} ${c.pattern} ${c.reasoning}`).join(' | ');
    let ragSection = '';
    try {
      const ragCtx = await retrieveRagContext(queryText, 'overseas', { lookbackDays: 3, topKNews: 5, topKSignals: 3 });
      if (ragCtx.totalChars > 0) ragSection = formatRagSection(ragCtx);
    } catch (e) {
      errors.push(`rag_fail:${errMsg(e)}`);
    }

    // 13. LLM 1회 — 실패는 "0건"이 아니라 구조화된 실패(S-2)
    const prompt = buildOverseasPrompt(llmCandidates, ragSection, { d0, s1, rate: R, fxAsOf: fx.asOf });
    let raw: unknown;
    try {
      raw = await runLlm(prompt, { timeoutMs: LLM_TIMEOUT_MS, responseFormat: 'json' });
    } catch (e) {
      errors.push(`ai_fail:${errMsg(e)}`);
      return base({ ...common, ok: false, status: 'ai_fail', signalsSkipped: llmCandidates.length });
    }
    const parsed = parseOverseasAiResponse(raw);
    if (!parsed.ok) {
      errors.push(`ai_parse_fail:${parsed.reason}`);
      console.error(`[post-market] market=overseas AI 응답 해석 실패(${parsed.reason}) — 카드를 만들지 않음`);
      return base({ ...common, ok: false, status: 'ai_parse_fail', signalsSkipped: llmCandidates.length });
    }

    // 14. 결정 검증 → 카드 행(아직 저장하지 않음)
    let signalsSkipped = 0;
    let schemaRejected = 0;
    let zoneRejected = 0;
    let unaffordableSkipped = 0;
    const rows: ScenarioCardRow[] = [];
    const rowMeta: Array<{ symbol: string; pattern: string; confidence: number }> = [];
    const used = new Set<string>();
    for (const item of parsed.decisions) {
      if (item == null || typeof item !== 'object' || Array.isArray(item)) { schemaRejected++; signalsSkipped++; continue; }
      const d = item as Record<string, unknown>;
      if (typeof d.symbol !== 'string') { schemaRejected++; signalsSkipped++; continue; }
      const candidate = llmCandidates.find(c => c.symbol === d.symbol);
      if (!candidate || used.has(candidate.symbol)) { signalsSkipped++; continue; }   // 후보 아님·같은 종목 두 번째 결정(첫 결정만 본다)
      used.add(candidate.symbol);

      const closeUsd = candidate.close / R;
      const chk = checkOverseasDecision(d, closeUsd);
      if (chk.kind === 'skip' || chk.kind === 'low_confidence') { signalsSkipped++; continue; }
      if (chk.kind === 'schema') {
        schemaRejected++; signalsSkipped++;
        console.log(`[post-market] ⚠ ${candidate.symbol} AI 결정 형식·범위 위반(${chk.why}) — 만들지 않음`);
        continue;
      }
      if (chk.kind === 'zone') {
        zoneRejected++; signalsSkipped++;
        console.log(`[post-market] ⚠ ${candidate.symbol} 진입 구간이 종가 $${closeUsd.toFixed(2)} 대비 허용 범위 밖(${chk.why}) — 단위 착오 의심, 만들지 않음`);
        continue;
      }

      const loKrw = Math.round(chk.loUsd * R);
      const hiKrw = Math.round(chk.hiUsd * R);
      const priceKrw = (loKrw + hiKrw) / 2;
      const { zero, chasedPrice } = cardBuysZeroShares(priceKrw, chasePct, amountKrw, 'overseas');
      if (zero) {
        unaffordableSkipped++; signalsSkipped++;
        console.log(
          `[post-market] 💸 ${candidate.symbol} 금액 초과 — 1주 지정가 ${Math.round(chasedPrice)}원 > 카드 금액 ${amountKrw}원 ` +
          `(진입 구간 $${chk.loUsd.toFixed(2)}~$${chk.hiUsd.toFixed(2)}, 환율 ${R}) — 수량 0 이라 만들지 않음`,
        );
        continue;
      }

      const priceZoneKrw = `${loKrw}~${hiKrw}`;   // entry-watcher `parsePriceZone` 이 읽는 형식(쉼표 없음)
      const holdingDeadline = new Date(openUtc + chk.holdingDays * 86400000).toISOString().slice(0, 10);
      const indicators = {
        pattern: candidate.pattern,
        close: candidate.close,
        volRatio: candidate.volRatio,
        rsi14: candidate.rsi14,
        ma5: candidate.ma5,
        ma20: candidate.ma20,
        ai: {
          confidence: chk.confidence,
          reasoning_short: chk.reasoning,
          scenario: {
            grade: chk.confidence >= 80 ? 'A' : chk.confidence >= 70 ? 'B+' : 'B',
            entry: { trigger: 'price_zone', price_zone: priceZoneKrw },
            exit: {
              target_pct: chk.targetPct,
              stop_pct: chk.stopPct,
              holding_days: `${chk.holdingDays}일`,
              holding_deadline: holdingDeadline,
            },
          },
        },
        // ── T-062 화면 데이터 계약(G5) — 해외 카드에만 있다 ──
        currency: 'KRW',
        close_usd: round2(closeUsd),
        price_zone_usd: { lo: chk.loUsd, hi: chk.hiUsd },
        fx: { pair: 'USD_KRW', rate: R, asOf: fx.asOf, source: 'fx_rates' },
        earnings: earningsBySymbol.get(candidate.symbol),
      };

      // G5-b — 승인 화면 "분석 사유"가 이 문자열을 그대로 보인다: 달러 주표기 + 원화 보조.
      const reasoning = [
        `[다음 미국장 시나리오] ${candidate.reasoning}`,
        krwBasisNote(R, fx.asOf),
        `진입구간: $${chk.loUsd.toFixed(2)}~$${chk.hiUsd.toFixed(2)} (≈ ${formatKrwInt(loKrw)}~${formatKrwInt(hiKrw)}원) | 목표: +${chk.targetPct}% | 손절: -${chk.stopPct}%`,
        chk.reasoning,
      ].join('\n');

      rows.push({
        strategyId: `${candidate.pattern}-v1`,
        symbol: candidate.symbol,
        price: priceKrw,
        reasoning,
        indicatorsJson: JSON.stringify(indicators),
        expiresAt,
        validFrom,
        market: 'overseas',
        amountKrw,
      });
      rowMeta.push({ symbol: candidate.symbol, pattern: candidate.pattern, confidence: chk.confidence });
    }

    // 15. 저장(트랜잭션 하나)
    let signalsCreated = 0;
    let duplicatesSkipped = 0;
    const counts = { ...common, schemaRejected, zoneRejected, unaffordableSkipped };
    if (rows.length > 0) {
      const ins = await insertCardsAtomically(rows);
      if (!ins.ok) {
        errors.push(`insert_fail:${ins.error}`);
        console.error(`[post-market] market=overseas 카드 저장 실패 — 이 실행의 카드 ${rows.length}장 전부 되돌림: ${ins.error}`);
        return base({
          ...counts, ok: false, status: 'insert_fail',
          signalsCreated: 0, signalsSkipped: signalsSkipped + rows.length, duplicatesSkipped: 0,
        });
      }
      ins.outcomes.forEach((o, i) => {
        const m = rowMeta[i];
        if (o === 'duplicate') {
          duplicatesSkipped++;
          signalsSkipped++;
          console.log(`[post-market] ⏭ ${m.symbol} valid_from=${validFrom} — 같은 카드가 이미 있어 만들지 않음`);
        } else {
          signalsCreated++;
          console.log(`[post-market] ✅ ${m.symbol} ${m.pattern} valid_from=${validFrom} conf=${m.confidence}%`);
        }
      });
    }

    console.log(
      `[post-market] market=overseas evaluated=${symbols.length} candidates=${unique.length} llm=${llmCandidates.length} ` +
      `created=${signalsCreated} skipped=${signalsSkipped} (중복 ${duplicatesSkipped}, 금액 초과 ${unaffordableSkipped}, ` +
      `형식 ${schemaRejected}, 구간 ${zoneRejected}; 오래된 봉 ${staleCandleSkipped}, 블랙아웃 ${blackoutSkipped}, 사전 금액 초과 ${prefilterUnaffordable}) ` +
      `D0=${d0} S1=${s1} valid_from=${validFrom}`,
    );

    return base({ ...counts, signalsCreated, signalsSkipped, duplicatesSkipped });
  } finally {
    overseasInFlight.delete(flightKey);   // 정상·실패·예외 모두 해제
  }
}
