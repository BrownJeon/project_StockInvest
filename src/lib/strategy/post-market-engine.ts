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
import type { ResultSetHeader } from 'mysql2';
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
      await pool.query<ResultSetHeader>(
        `INSERT INTO signals
           (strategy_id, symbol, side, order_type, price, amount_krw,
            reasoning, indicators, status, expires_at, valid_from, market, scenario_source)
         VALUES (?, ?, 'buy', 'limit', ?, 100000, ?, ?, 'pending', ?, ?, 'domestic', 'post-market')`,
        [
          `${candidate.pattern}-v1`,
          candidate.symbol,
          entryMid,
          reasoning,
          JSON.stringify(indicators),
          expiresAt,
          validFrom,
        ],
      );
      signalsCreated++;
      console.log(`[post-market] ✅ ${candidate.symbol} ${candidate.pattern} valid_from=${validFrom} conf=${confidence}%`);
    } catch (e) {
      errors.push(`insert_fail:${candidate.symbol}:${e instanceof Error ? e.message : String(e)}`);
      signalsSkipped++;
    }
  }

  console.log(
    `[post-market] market=${market} evaluated=${symbols.length} candidates=${uniqueCandidates.length} ` +
    `created=${signalsCreated} skipped=${signalsSkipped} valid_from=${validFrom}`,
  );

  return {
    market,
    symbolsEvaluated: symbols.length,
    candidatesFound: uniqueCandidates.length,
    signalsCreated,
    signalsSkipped,
    errors,
    validFrom,
  };
}
