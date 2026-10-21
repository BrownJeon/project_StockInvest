/**
 * post-market-engine.ts — 장 마감 후 익일 시나리오 사전 등록 엔진
 *
 * 흐름:
 *  1. 유니버스 심볼 로드 (DB + always_include)
 *  2. 일봉 데이터 조회 (getDailyCandles via getCandles '1d')
 *  3. 3가지 일봉 패턴 검사 → 후보 선별
 *  4. RAG 검색 (당일 뉴스 + 과거 유사 시그널)
 *  5. Claude AI 배치 분석 → 익일 진입 시나리오 판단
 *  6. signals INSERT (valid_from = 다음 거래일 09:00 KST, status = 'pending')
 */
import type { Pool, ResultSetHeader } from 'mysql2/promise';
import { getPool } from '@/lib/db';
import { getCandles } from '@/lib/exchanges/kis-domestic';
import { getAlwaysIncludeSymbols, getUniverseSnapshot } from './universe';
import { runLlm } from '@/lib/llm/provider';
import { retrieveRagContext } from '@/lib/rag/retrieval';
import { formatRagSection } from '@/lib/rag/format';
import { eodHighClose } from './rules/eod-high-close';
import { insideBar } from './rules/inside-bar';
import { oversoldBounceDaily } from './rules/oversold-bounce-daily';
import type { DailyCandidate } from './rules/eod-high-close';
import { getStyleConfig } from './style';
import { sizeOrderQuantity } from '@/lib/signals/service';

export type PostMarketMarket = 'domestic' | 'overseas';

/**
 * T-062 — 해외 실행이 분석을 하지 않고 끝낸 사유(국내는 `weekend` 만 쓴다).
 * `overseas_disabled` = 스위치 `post_market_overseas_enabled` 가 켜져 있지 않음(키 없음 = 꺼짐) — 이 사유 앞에는 다른 I/O 가 없다.
 */
export type PostMarketOverseasSkip =
  | 'overseas_disabled'
  | 'overseas_market_disabled'
  | 'holidays_unknown'
  | 'us_session_open'
  | 'no_new_session'
  | 'fx_unknown'
  | 'fx_inconsistent'
  | 'earnings_unknown'
  | 'candles_unavailable'
  | 'candle_scale_suspect';

/**
 * T-062 S-2·S-3 — 해외 실행의 구조화된 결과 상태. `ok` 가 아니면 라우트가 비-200 으로 답한다(해외만).
 * `data_unknown` = 판정에 필요한 데이터를 일시적으로 모름(`skipped` 가 holidays_unknown·fx_unknown·fx_inconsistent·earnings_unknown·
 * candles_unavailable·candle_scale_suspect)
 * → 503(재시도 가능). 정상 판정으로 건너뛴 경우(스위치 꺼짐·새 세션 없음·장중 등)는 `ok` 다.
 * `in_progress` = 같은 해외 세션(D0) 분석이 이 프로세스에서 이미 실행 중(single-flight, Codex C2) → 503(재시도 가능).
 */
export type PostMarketRunStatus = 'ok' | 'data_unknown' | 'in_progress' | 'ai_fail' | 'ai_parse_fail' | 'insert_fail';

export interface PostMarketResult {
  market: PostMarketMarket;
  symbolsEvaluated: number;
  candidatesFound: number;
  signalsCreated: number;
  signalsSkipped: number;
  errors: string[];
  validFrom: string;
  /** T-045 — 이미 같은 (종목·방향·valid_from) 카드가 있어 만들지 않은 수. `signalsSkipped` 에도 포함된다. */
  duplicatesSkipped?: number;
  /**
   * T-045 — 분석을 하지 않고 끝낸 사유. 주말(토·일, KST)이면 `weekend`. 공휴일은 건너뛰지 않는다.
   * T-062 — 해외는 {@link PostMarketOverseasSkip} 중 하나(국내 실행은 이 값들을 쓰지 않는다).
   */
  skipped?: 'weekend' | PostMarketOverseasSkip;
  /**
   * T-053 — 1주 가격이 카드 금액을 넘어(수량 0) 만들지 않은 수. `signalsSkipped` 에도 포함된다.
   * 다른 필터(BUY 아님·필수 값 없음·신뢰도 미달)에 먼저 걸린 종목은 여기 세지 않는다. (T-062 — 해외도 같은 정의로 센다.)
   */
  unaffordableSkipped?: number;
  /** T-062 — 해외 실행만 싣는다(국내 응답 형태 불변). `ok:false` 이면 분석·저장이 실패한 것이지 "0건"이 아니다. */
  ok?: boolean;
  status?: PostMarketRunStatus;
}

/**
 * post-market 카드 1장의 금액(KRW) — 국내. T-053 필터가 이 값으로 "1주를 살 수 있는가"를 판정한다. 금액 정책 자체는 바꾸지 않는다.
 * T-062 — INSERT 의 `amount_krw` 는 이제 리터럴이 아니라 {@link POST_MARKET_CARD_AMOUNT_KRW_BY_MARKET} 에서 시장별로 넣는다
 * (테스트가 INSERT 값과 이 상수를 대조한다).
 */
export const POST_MARKET_CARD_AMOUNT_KRW = 100000;

/**
 * T-062 D-5·D-6 — 시장별 카드 금액(KRW). 해외도 KRW 100,000(사용자 결정 Q5 (a)·D-6). 해외 금액을 바꾸려면 이 한 줄만 바꾼다
 * (수량 0 필터·사전 금액 필터·INSERT 가 모두 이 값을 읽는다). 국내 값은 {@link POST_MARKET_CARD_AMOUNT_KRW} 와 같다.
 */
export const POST_MARKET_CARD_AMOUNT_KRW_BY_MARKET: Readonly<Record<PostMarketMarket, number>> = {
  domestic: POST_MARKET_CARD_AMOUNT_KRW,
  overseas: 100000,
};

/**
 * T-053 — 이 카드가 실행 시점에 **1주도 살 수 없는가**(수량 0 → `quantity_below_min` 로 영원히 실행되지 않음).
 *
 * 판정은 실행 경로와 **같은 입력·같은 함수**로 한다. post-market 카드는 승인 뒤 `approved_pending_entry` 로 대기하다
 * `entry-watcher` 가 주문하는데, 그쪽 사이징은 `chasedPrice = 카드 price × (1 + limitChasePct)`(추격률 > 0 이고 가격 > 0 일 때만)
 * 를 `sizeOrderQuantity` 에 넣는다(`src/app/api/cron/entry-watcher/route.ts` 의 basePrice/chasedPrice/sizeOrderQuantity).
 * 진입 구간 중간값만 보면 99,600원 카드(추격 0.5% → 100,098원 → 0주)를 놓치고, 종가를 보면 구간이 종가보다 낮게 잡힌
 * 실행 가능한 카드를 잘라낸다.
 *
 * 가격이 0·음수·NaN 이면 `sizeOrderQuantity` 가 수량을 정하지 않는다(`undefined`) → false(이 필터는 판정하지 않고 기존 동작 유지).
 *
 * T-062 — `market` 인자(기본 국내 — 기존 호출부 불변). 해외 카드도 `price` 가 **KRW 환산값**이고 entry-watcher 가 같은 KRW/KRW
 * 나눗셈(`sizeOrderQuantity`, 해외도 `floor` 정수 주)으로 수량을 정하므로 같은 함수·같은 입력으로 판정한다.
 */
export function cardBuysZeroShares(
  cardPrice: number,
  chasePct: number,
  amountKRW: number = POST_MARKET_CARD_AMOUNT_KRW,
  market: PostMarketMarket = 'domestic',
): { zero: boolean; chasedPrice: number } {
  const chasedPrice = chasePct > 0 && cardPrice > 0 ? cardPrice * (1 + chasePct) : cardPrice;
  const sized = sizeOrderQuantity({ market, orderType: 'limit', amountKRW, price: chasedPrice });
  return { zero: sized.quantity === 0, chasedPrice };
}

interface AiDecision {
  symbol: string;
  action: 'BUY' | 'SKIP';
  entry_zone?: { lo: number; hi: number };
  target_pct?: number;
  stop_pct?: number;
  holding_days?: number;
  confidence?: number;
  reasoning?: string;
}

/**
 * 지금이 한국 시간(KST) 기준 토·일인가. 서버 시간대와 무관하게 epoch + 9h 로 요일을 읽는다.
 * DB·공휴일 목록을 쓰지 않는 순수 함수라 던지지 않는다.
 */
export function isWeekendKst(date: Date): boolean {
  const dow = new Date(date.getTime() + 9 * 3600_000).getUTCDay(); // 0=일, 6=토
  return dow === 0 || dow === 6;
}

/** 다음 거래일 09:00 KST (주말 스킵) */
function nextTradingDayOpen(): Date {
  const now = new Date();
  // 한국 현지시간으로 내일 날짜 계산 (UTC+9)
  const kstOffset = 9 * 60 * 60 * 1000;
  const kstNow = new Date(now.getTime() + kstOffset);

  let next = new Date(kstNow);
  next.setUTCDate(next.getUTCDate() + 1);
  next.setUTCHours(0, 0, 0, 0);

  // 주말 스킵 (getUTCDay: 0=Sun, 6=Sat)
  const day = next.getUTCDay();
  if (day === 6) next.setUTCDate(next.getUTCDate() + 2); // Sat → Mon
  if (day === 0) next.setUTCDate(next.getUTCDate() + 1); // Sun → Mon

  // 09:00 KST = 00:00 UTC
  next.setUTCHours(0, 0, 0, 0); // 09:00 KST = 00:00 UTC
  return next;
}

/**
 * `Date` → DB `DATETIME` 문자열을 **KST 벽시계**로 만든다 (`YYYY-MM-DD HH:MM:SS`).
 *
 * T-046 — DB 서버 시간대와 앱 풀(`timezone: '+09:00'`)이 모두 KST 라서 `DATETIME` 컬럼은 KST 로 읽힌다. 예전에는
 * `toISOString()`(UTC) 문자열을 그대로 넣어 의도한 09:00/15:30 이 00:00/06:30 으로 9시간 어긋났고, 카드가 개장 전에 만료돼
 * 한 번도 실행되지 못했다(post-market 카드 46장 전부, 주문 연결 0장).
 */
export function toKstDatetime(date: Date): string {
  return new Date(date.getTime() + 9 * 3600_000).toISOString().slice(0, 19).replace('T', ' ');
}

/** 내일 만료: 장 마감 15:30 KST = 06:30 UTC */
function nextTradingDayClose(): Date {
  const open = nextTradingDayOpen();
  return new Date(open.getTime() + 6.5 * 60 * 60 * 1000); // +6h30m
}

/** MariaDB/MySQL 유니크 키 충돌(1062, ER_DUP_ENTRY). */
function isDuplicateKeyError(e: unknown): boolean {
  const err = e as { errno?: unknown; code?: unknown } | null | undefined;
  return err?.errno === 1062 || err?.code === 'ER_DUP_ENTRY';
}

export interface ScenarioCardRow {
  strategyId: string;
  symbol: string;
  /** 진입 구간 중간값(지정가 기준가) */
  price: number;
  reasoning: string;
  indicatorsJson: string;
  expiresAt: string;
  validFrom: string;
  /** T-062 — 카드 시장. 없으면 국내(기존 호출부 불변). 해외 경로는 항상 `'overseas'` 를 넣는다. */
  market?: PostMarketMarket;
  /** T-062 — 카드 금액(KRW). 없으면 그 시장의 {@link POST_MARKET_CARD_AMOUNT_KRW_BY_MARKET}. */
  amountKrw?: number;
}

/**
 * 시나리오 카드를 넣되, **같은 (종목·방향·valid_from·scenario_source) 카드가 이미 있으면 넣지 않는다.**
 *
 * T-045 — 상태를 가리지 않는다. 사용자가 거절했거나 `superseded` 로 정리한 카드가 같은 `valid_from` 으로
 * 다시 살아나면 안 되기 때문이다. 판정과 삽입이 한 문장이라 "조회 후 삽입" 사이에 끼어들 틈이 없다.
 * 같은 키를 **동시에** 넣는 두 실행은 T-048 의 유니크 인덱스(`uq_signals_scenario_card`)가 구조적으로 막는다 — 진 쪽은
 * 1062(ER_DUP_ENTRY)로 거부되며, 중복이 생기지 않은 것이므로 `duplicate` 로 돌려준다. (REPEATABLE READ 에서는 진 쪽이
 * 다른 오류 코드로 실패할 수도 있다 — 그것은 던져서 호출자가 `insert_fail` 로 남긴다.)
 *
 * T-062 — `market`·`amount_krw` 를 리터럴에서 자리표시자로 바꿨다(국내 행의 저장 값은 그대로 `'domestic'`·100000 — 골든 시험).
 * 중복 판정 키는 바꾸지 않는다: 유니크 인덱스 `(symbol, side, valid_from, scenario_source)` 에 market 이 없지만 심볼 형식이 시장을
 * 정한다(국내 6자리 / 해외 `NAS:AAPL`) — 국내·해외 카드가 같은 키를 가질 수 없다(Stage 0 ⑥, DDL 실측).
 * `pool` 은 풀이든 트랜잭션 연결이든 `query` 만 있으면 된다(해외는 한 실행을 트랜잭션으로 묶는다 — S-3).
 *
 * @returns 'created' | 'duplicate'
 */
export async function insertScenarioCardIfAbsent(
  pool: Pick<Pool, 'query'>,
  row: ScenarioCardRow,
): Promise<'created' | 'duplicate'> {
  const market: PostMarketMarket = row.market ?? 'domestic';
  const amountKrw = row.amountKrw ?? POST_MARKET_CARD_AMOUNT_KRW_BY_MARKET[market];
  let res: ResultSetHeader;
  try {
    [res] = await pool.query<ResultSetHeader>(
      `INSERT INTO signals
         (strategy_id, symbol, side, order_type, price, amount_krw,
          reasoning, indicators, status, expires_at, valid_from, market, scenario_source)
       SELECT ?, ?, 'buy', 'limit', ?, ?, ?, ?, 'pending', ?, ?, ?, 'post-market'
         FROM DUAL
        WHERE NOT EXISTS (
          SELECT 1 FROM signals
           WHERE symbol = ? AND side = 'buy' AND valid_from = ? AND scenario_source = 'post-market'
        )`,
      [
        row.strategyId,
        row.symbol,
        row.price,
        amountKrw,
        row.reasoning,
        row.indicatorsJson,
        row.expiresAt,
        row.validFrom,
        market,
        row.symbol,
        row.validFrom,
      ],
    );
  } catch (e) {
    if (isDuplicateKeyError(e)) return 'duplicate';
    throw e;
  }
  return res.affectedRows > 0 ? 'created' : 'duplicate';
}

async function loadSymbols(market: PostMarketMarket): Promise<string[]> {
  if (market === 'overseas') {
    // T-062 — 해외는 `post-market-overseas.ts` 가 따로 처리한다(runPostMarketAnalysis 첫 줄에서 갈라져 여기 오지 않는다).
    return [];
  }

  const always = await getAlwaysIncludeSymbols('domestic');
  const snapshot = await getUniverseSnapshot();

  const fromUniverse = Object.values(snapshot)
    .flatMap(entries => entries.map(e => e.symbol));

  const merged = [...new Set([...always, ...fromUniverse])];
  return merged;
}

function buildPrompt(
  candidates: DailyCandidate[],
  ragSection: string,
  nextDay: string,
): string {
  const todayStr = new Date().toISOString().slice(0, 10);
  const symbolBlocks = candidates.map(c => {
    const ma5Str  = c.ma5  != null ? c.ma5.toFixed(0)  : 'N/A';
    const ma20Str = c.ma20 != null ? c.ma20.toFixed(0) : 'N/A';
    const rsiStr  = c.rsi14 != null ? c.rsi14.toFixed(1) : 'N/A';
    return [
      `## ${c.symbol} [${c.pattern}]`,
      `- 오늘(${todayStr}): 시=${c.open.toFixed(0)} 고=${c.high.toFixed(0)} 저=${c.low.toFixed(0)} 종=${c.close.toFixed(0)} 거래량비율=${c.volRatio.toFixed(2)}x`,
      `- RSI14=${rsiStr} MA5=${ma5Str} MA20=${ma20Str}`,
      `- 패턴 근거: ${c.reasoning}`,
    ].join('\n');
  }).join('\n\n');

  return `당신은 국내주식 다음날 진입 시나리오를 분석하는 전문 트레이더입니다.

오늘(${todayStr}) 장 마감 후 데이터를 기반으로 내일(${nextDay}) 오전 진입 가능한 종목을 선별하세요.

${ragSection ? ragSection + '\n\n' : ''}### 후보 종목 (일봉 패턴 감지)

${symbolBlocks}

### 판단 기준
1. 내일 갭업/갭다운 위험 (오늘 급등했으면 갭업 차익실현 가능성)
2. 뉴스·섹터 모멘텀 지속 여부 (RAG 컨텍스트 참고)
3. 기술적 지지·저항 레벨 (MA, BB 기준)
4. 진입 구간 현실성 (시초가 ±1~2% 내외)

### 출력 형식 (JSON only)
{
  "decisions": [
    {
      "symbol": "종목코드",
      "action": "BUY" 또는 "SKIP",
      "entry_zone": {"lo": 진입하단가, "hi": 진입상단가},
      "target_pct": 목표수익률(예: 3.5),
      "stop_pct": 손절비율(예: 1.8),
      "holding_days": 예상보유일수(1~5),
      "confidence": 신뢰도(0~100),
      "reasoning": "한국어 판단 근거 2~3문장"
    }
  ]
}

BUY 선택 시 entry_zone, target_pct, stop_pct, confidence 필수.
신뢰도 60% 미만이면 SKIP 권장. 최대 5종목 BUY 선택.`;
}

async function parseAiResponse(raw: string): Promise<AiDecision[]> {
  try {
    const json = typeof raw === 'string'
      ? JSON.parse(raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim())
      : raw;
    return Array.isArray(json?.decisions) ? json.decisions : [];
  } catch {
    return [];
  }
}

export async function runPostMarketAnalysis(market: PostMarketMarket): Promise<PostMarketResult> {
  // T-062 — 해외는 별도 모듈로 간다. 그 모듈의 **첫 동작이 스위치 읽기**이고 꺼져 있으면(키 없음 = 꺼짐) 다른 I/O 없이 끝난다.
  // 아래 국내 경로는 HEAD 7cd47e7 과 같다(국내 골든 시험 `post-market-domestic-golden.test.ts`). 지연 import 라 국내 실행은
  // 해외 모듈(KIS 해외 어댑터·환율·실적 일정)을 불러오지도 않는다.
  if (market === 'overseas') {
    const { runPostMarketOverseas } = await import('./post-market-overseas');
    return runPostMarketOverseas();
  }
  const errors: string[] = [];
  const validFromDate = nextTradingDayOpen();
  const expiresAtDate = nextTradingDayClose();
  // T-046 — DB 는 KST. 다음 거래일 09:00 / 15:30 KST 로 저장한다(UTC 문자열을 넣으면 00:00/06:30 이 된다).
  const validFrom = toKstDatetime(validFromDate);
  const expiresAt = toKstDatetime(expiresAtDate);
  const nextDay = validFromDate.toISOString().slice(0, 10);

  // T-045 — 주말(토·일)에는 새 종가가 없다. 그래도 돌리면 같은 데이터로 LLM 출력만 달라진 모순된 카드를 같은
  // 다음 거래일용으로 또 만든다(2026-10-17 토요일 실행이 금요일 카드와 구간이 다른 카드를 중복 생성).
  // **공휴일은 일부러 건너뛰지 않는다**: `nextTradingDayOpen()` 이 공휴일을 건너뛰지 못하므로, 공휴일 전날 실행은 휴장일용
  // 카드를 만든다. 공휴일 당일 실행이 "그 다음 거래일"용 카드를 만드는 유일한 실행이라, 이것까지 막으면 그 거래일에
  // 카드가 한 장도 없다(독립 감사 R-1). 그 카드는 전날 카드와 valid_from 이 달라 중복도 아니다. 이 방식은 공휴일 목록의
  // 정확도에도 의존하지 않는다. 해외는 `post-market-overseas.ts` 가 ET 기준으로 따로 판정한다(T-062 — 여기 오지 않는다).
  if (market === 'domestic' && isWeekendKst(new Date())) {
    console.log('[post-market] 주말 — 새 종가가 없어 분석을 건너뜁니다');
    return {
      market, symbolsEvaluated: 0, candidatesFound: 0, signalsCreated: 0, signalsSkipped: 0,
      errors, validFrom, skipped: 'weekend',
    };
  }

  // 1. 심볼 로드
  const symbols = await loadSymbols(market);
  if (symbols.length === 0) {
    return { market, symbolsEvaluated: 0, candidatesFound: 0, signalsCreated: 0, signalsSkipped: 0, errors: ['no_symbols'], validFrom };
  }

  // 2. 일봉 데이터 조회 + 패턴 검사 (병렬, 실패 심볼은 skip)
  const candidateResults = await Promise.allSettled(
    symbols.map(async (symbol) => {
      const candles = await getCandles(symbol, '1d', 60);
      const results: DailyCandidate[] = [];
      const eod = eodHighClose(symbol, candles);
      const ib  = insideBar(symbol, candles);
      const osb = oversoldBounceDaily(symbol, candles);
      if (eod) results.push(eod);
      if (ib)  results.push(ib);
      if (osb) results.push(osb);
      return results;
    }),
  );

  const candidates: DailyCandidate[] = [];
  for (let i = 0; i < candidateResults.length; i++) {
    const r = candidateResults[i];
    if (r.status === 'fulfilled') {
      candidates.push(...r.value);
    } else {
      errors.push(`candle_fail:${symbols[i]}:${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
    }
  }

  if (candidates.length === 0) {
    return { market, symbolsEvaluated: symbols.length, candidatesFound: 0, signalsCreated: 0, signalsSkipped: 0, errors, validFrom };
  }

  // 중복 심볼 — 종목당 1개만 (score 순: eod-high-close > inside-bar > oversold-bounce)
  const PATTERN_PRIORITY = { 'eod-high-close': 0, 'inside-bar': 1, 'oversold-bounce': 2 };
  const deduped = new Map<string, DailyCandidate>();
  for (const c of candidates) {
    const existing = deduped.get(c.symbol);
    if (!existing || PATTERN_PRIORITY[c.pattern] < PATTERN_PRIORITY[existing.pattern]) {
      deduped.set(c.symbol, c);
    }
  }
  const uniqueCandidates = [...deduped.values()];

  // 3. RAG 검색
  const queryText = uniqueCandidates.map(c => `${c.symbol} ${c.pattern} ${c.reasoning}`).join(' | ');
  let ragSection = '';
  try {
    const ragCtx = await retrieveRagContext(queryText, market, { lookbackDays: 3, topKNews: 5, topKSignals: 3 });
    if (ragCtx.totalChars > 0) ragSection = formatRagSection(ragCtx);
  } catch (e) {
    errors.push(`rag_fail:${e instanceof Error ? e.message : String(e)}`);
  }

  // 4. AI 배치 분석
  const prompt = buildPrompt(uniqueCandidates, ragSection, nextDay);
  let decisions: AiDecision[] = [];
  try {
    const raw = await runLlm(prompt, { timeoutMs: 90000, responseFormat: 'json' });
    decisions = await parseAiResponse(raw);
  } catch (e) {
    errors.push(`ai_fail:${e instanceof Error ? e.message : String(e)}`);
    return { market, symbolsEvaluated: symbols.length, candidatesFound: uniqueCandidates.length, signalsCreated: 0, signalsSkipped: uniqueCandidates.length, errors, validFrom };
  }

  // 5. signals INSERT
  const pool = getPool();
  let signalsCreated = 0;
  let signalsSkipped = 0;
  let duplicatesSkipped = 0;
  let unaffordableSkipped = 0;

  // T-053 — 실행 경로(entry-watcher)가 쓰는 지정가 추격률. 읽지 못하면 0(추격 없음)으로 판정한다: 그러면 필터가
  // 덜 걸러질 뿐(예전 동작 쪽) 실행 가능한 카드를 잘라내지 않고, 분석 자체를 실패시키지도 않는다.
  // 이 함수 본문은 국내 전용이다 — 해외는 T-062 에서 `post-market-overseas.ts` 로 분리했고 그쪽이 같은 필터를 KRW 환산 카드 가격으로
  // 적용한다(`cardBuysZeroShares(..., 'overseas')`).
  let chasePct = 0;
  if (market === 'domestic') {
    try {
      chasePct = (await getStyleConfig()).limitChasePct;
    } catch (e) {
      console.warn(`[post-market] 지정가 추격률을 읽지 못해 추격 0 으로 금액 판정: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  for (const d of decisions) {
    const candidate = uniqueCandidates.find(c => c.symbol === d.symbol);
    if (!candidate) { signalsSkipped++; continue; }

    if (d.action !== 'BUY' || !d.entry_zone || !d.target_pct || !d.stop_pct) {
      signalsSkipped++;
      continue;
    }

    const confidence = d.confidence ?? 0;
    if (confidence < 60) { signalsSkipped++; continue; }

    const entryMid = (d.entry_zone.lo + d.entry_zone.hi) / 2;

    // T-053 — 1주도 살 수 없는 카드(수량 0)는 만들지 않는다. 승인해도 매 분 quantity_below_min 만 남기고 만료된다.
    // 다른 필터(위)는 그대로 먼저 적용하고, INSERT 직전에 판정한다. 코드에는 카드 개수 제한이 없다(프롬프트의 "최대 5종목"
    // 은 LLM 지시이고, 기준가인 진입 구간은 LLM 응답 뒤에야 생긴다).
    if (market === 'domestic') {
      const { zero, chasedPrice } = cardBuysZeroShares(entryMid, chasePct);
      if (zero) {
        unaffordableSkipped++;
        signalsSkipped++;
        console.log(
          `[post-market] 💸 ${candidate.symbol} 금액 초과 — 1주 지정가 ${Math.round(chasedPrice)}원 > 카드 금액 ${POST_MARKET_CARD_AMOUNT_KRW}원 ` +
          `(진입 구간 중간값 ${Math.round(entryMid)}원, 지정가 추격 ${(chasePct * 100).toFixed(2)}%) — 수량 0 이라 만들지 않음`,
        );
        continue;
      }
    }

    const priceZoneStr = `${d.entry_zone.lo.toFixed(0)}~${d.entry_zone.hi.toFixed(0)}`;
    const holdingDays = d.holding_days ?? 2;
    const holdingDeadline = new Date(validFromDate.getTime() + holdingDays * 86400000)
      .toISOString().slice(0, 10);

    const indicators = {
      pattern: candidate.pattern,
      close: candidate.close,
      volRatio: candidate.volRatio,
      rsi14: candidate.rsi14,
      ma5: candidate.ma5,
      ma20: candidate.ma20,
      ai: {
        confidence,
        reasoning_short: d.reasoning,
        scenario: {
          grade: confidence >= 80 ? 'A' : confidence >= 70 ? 'B+' : 'B',
          entry: { trigger: 'price_zone', price_zone: priceZoneStr },
          exit: {
            target_pct: d.target_pct,
            stop_pct: d.stop_pct,
            holding_days: `${holdingDays}일`,
            holding_deadline: holdingDeadline,
          },
        },
      },
    };

    const reasoning = [
      `[익일 시나리오] ${candidate.reasoning}`,
      `진입구간: ${priceZoneStr} | 목표: +${d.target_pct}% | 손절: -${d.stop_pct}%`,
      d.reasoning ?? '',
    ].join('\n');

    try {
      const outcome = await insertScenarioCardIfAbsent(pool, {
        strategyId: `${candidate.pattern}-v1`,
        symbol: candidate.symbol,
        price: entryMid,
        reasoning,
        indicatorsJson: JSON.stringify(indicators),
        expiresAt,
        validFrom,
      });
      if (outcome === 'duplicate') {
        duplicatesSkipped++;
        signalsSkipped++;
        console.log(`[post-market] ⏭ ${candidate.symbol} valid_from=${validFrom} — 같은 카드가 이미 있어 만들지 않음`);
      } else {
        signalsCreated++;
        console.log(`[post-market] ✅ ${candidate.symbol} ${candidate.pattern} valid_from=${validFrom} conf=${confidence}%`);
      }
    } catch (e) {
      errors.push(`insert_fail:${candidate.symbol}:${e instanceof Error ? e.message : String(e)}`);
      signalsSkipped++;
    }
  }

  console.log(
    `[post-market] market=${market} evaluated=${symbols.length} candidates=${uniqueCandidates.length} ` +
    `created=${signalsCreated} skipped=${signalsSkipped} (중복 ${duplicatesSkipped}, 금액 초과 ${unaffordableSkipped}) valid_from=${validFrom}`,
  );

  return {
    market,
    symbolsEvaluated: symbols.length,
    candidatesFound: uniqueCandidates.length,
    signalsCreated,
    signalsSkipped,
    errors,
    validFrom,
    duplicatesSkipped,
    unaffordableSkipped,
  };
}
