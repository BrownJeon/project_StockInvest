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

export type PostMarketMarket = 'domestic' | 'overseas';

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
  /** T-045 — 분석을 하지 않고 끝낸 사유. 주말(토·일, KST)이면 `weekend`. 공휴일은 건너뛰지 않는다. */
  skipped?: 'weekend';
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

/** 내일 만료: 장 마감 15:30 KST = 06:30 UTC */
function nextTradingDayClose(): Date {
  const open = nextTradingDayOpen();
  return new Date(open.getTime() + 6.5 * 60 * 60 * 1000); // +6h30m
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
}

/**
 * 시나리오 카드를 넣되, **같은 (종목·방향·valid_from·scenario_source) 카드가 이미 있으면 넣지 않는다.**
 *
 * T-045 — 상태를 가리지 않는다. 사용자가 거절했거나 `superseded` 로 정리한 카드가 같은 `valid_from` 으로
 * 다시 살아나면 안 되기 때문이다. 판정과 삽입이 한 문장이라 "조회 후 삽입" 사이에 끼어들 틈이 없지만,
 * 같은 키를 **동시에** 넣는 두 실행은 둘 다 통과할 수 있다(유니크 인덱스가 없다 — 마이그레이션은 사용자 승인 사항).
 * cron 은 직렬이라 정상 운영에서는 해당하지 않는다.
 *
 * @returns 'created' | 'duplicate'
 */
export async function insertScenarioCardIfAbsent(
  pool: Pick<Pool, 'query'>,
  row: ScenarioCardRow,
): Promise<'created' | 'duplicate'> {
  const [res] = await pool.query<ResultSetHeader>(
    `INSERT INTO signals
       (strategy_id, symbol, side, order_type, price, amount_krw,
        reasoning, indicators, status, expires_at, valid_from, market, scenario_source)
     SELECT ?, ?, 'buy', 'limit', ?, 100000, ?, ?, 'pending', ?, ?, 'domestic', 'post-market'
       FROM DUAL
      WHERE NOT EXISTS (
        SELECT 1 FROM signals
         WHERE symbol = ? AND side = 'buy' AND valid_from = ? AND scenario_source = 'post-market'
      )`,
    [
      row.strategyId,
      row.symbol,
      row.price,
      row.reasoning,
      row.indicatorsJson,
      row.expiresAt,
      row.validFrom,
      row.symbol,
      row.validFrom,
    ],
  );
  return res.affectedRows > 0 ? 'created' : 'duplicate';
}

async function loadSymbols(market: PostMarketMarket): Promise<string[]> {
  if (market === 'overseas') {
    // 해외 종목은 별도 처리 (현재 미구현, 추후 확장)
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
  const errors: string[] = [];
  const validFromDate = nextTradingDayOpen();
  const expiresAtDate = nextTradingDayClose();
  const validFrom = validFromDate.toISOString().slice(0, 19).replace('T', ' ');
  const expiresAt = expiresAtDate.toISOString().slice(0, 19).replace('T', ' ');
  const nextDay = validFromDate.toISOString().slice(0, 10);

  // T-045 — 주말(토·일)에는 새 종가가 없다. 그래도 돌리면 같은 데이터로 LLM 출력만 달라진 모순된 카드를 같은
  // 다음 거래일용으로 또 만든다(2026-10-17 토요일 실행이 금요일 카드와 구간이 다른 카드를 중복 생성).
  // **공휴일은 일부러 건너뛰지 않는다**: `nextTradingDayOpen()` 이 공휴일을 건너뛰지 못하므로, 공휴일 전날 실행은 휴장일용
  // 카드를 만든다. 공휴일 당일 실행이 "그 다음 거래일"용 카드를 만드는 유일한 실행이라, 이것까지 막으면 그 거래일에
  // 카드가 한 장도 없다(독립 감사 R-1). 그 카드는 전날 카드와 valid_from 이 달라 중복도 아니다. 이 방식은 공휴일 목록의
  // 정확도에도 의존하지 않는다. 해외는 종목이 없어 변화 없음이므로 국내만 건너뛴다.
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
    `created=${signalsCreated} skipped=${signalsSkipped} (중복 ${duplicatesSkipped}) valid_from=${validFrom}`,
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
  };
}
