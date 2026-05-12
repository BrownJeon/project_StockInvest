/**
 * Hybrid Stage 1 — M4 Ollama 도메인 모델로 광역 스크리닝.
 *
 * 입력: BatchSymbolInput[] + market
 * 출력: 각 심볼별 verdict (pass | reject | escalate)
 *
 * 분류 기준:
 *   - pass     : evEstimate >= +0.5% AND confidence >= 0.70 → Stage 2 우회, 즉시 채택
 *   - reject   : evEstimate <= -0.3% OR confidence < 0.40   → Stage 2 우회, 즉시 컷
 *   - escalate : 그 외 회색 영역                            → Stage 2(Claude)에서 최종 결정
 *
 * Stage 1 응답 schema 어긋남·timeout·HTTP 에러 → throw → 호출자가 legacy single-stage로 fallback.
 *
 * 호출자: ai-filter.ts:aiSelectSignalBatch (provider==='hybrid' 일 때만).
 */
import type { BatchSymbolInput } from './ai-filter';
import { runLlmOnce, getProviderConfig } from '@/lib/llm/provider';
import type { Market } from '@/lib/exchanges/kis-symbols';
import { retrieveRagContext } from '@/lib/rag/retrieval';
import { formatRagSection } from '@/lib/rag/format';
import { fetchMarketContext } from './market-context-client';

export type Stage1Verdict = 'pass' | 'reject' | 'escalate';

export interface Stage1Decision {
  symbol: string;
  verdict: Stage1Verdict;
  confidence: number;     // 0.0 ~ 1.0
  evEstimatePct: number;  // -2.0 ~ +3.0
  reasoning: string;      // <=80 chars
}

export interface Stage1Result {
  decisions: Stage1Decision[];
  /** 분류 통계 — 디버깅/로그용 */
  stats: { pass: number; reject: number; escalate: number };
  rawResponseChars: number;
  elapsedMs: number;
}

const STAGE1_TIMEOUT_MS = 30_000;

/** 임계값: pass 조건 (둘 다 만족) */
const PASS_EV_MIN = 0.5;       // %
const PASS_CONF_MIN = 0.70;
/** 임계값: reject 조건 (둘 중 하나라도 만족) */
const REJECT_EV_MAX = -0.3;    // %
const REJECT_CONF_MAX = 0.40;

/**
 * Stage 1 프롬프트 — JSON-only, 종목당 80자 reasoning + verdict.
 *
 * 도메인 fine-tune 모델은 학습된 분포에 따라 응답하므로 prompt는 짧게 유지.
 * Generic 모델(glm-4.7-flash 등) 사용 시에는 system 역할 강한 가이드 + few-shot 추가 검토.
 */
function buildSymbolBlocks(inputs: BatchSymbolInput[]): string {
  return inputs.map((input, idx) => {
    const s = input.summary;
    const candCount = input.candidates.length;
    const heldNote = input.heldQty && input.heldQty > 0 ? ` heldQty=${input.heldQty}` : '';
    const bbWidth = s.bbUpper != null && s.bbLower != null && s.bbMiddle ? ((s.bbUpper - s.bbLower) / s.bbMiddle * 100) : null;
    return [
      `### [${idx}] ${input.symbol}${heldNote}`,
      `price=${s.currentPrice.toFixed(2)} chg5=${s.priceChange5.toFixed(2)}% rsi14=${s.rsi14?.toFixed(0) ?? 'N/A'} volRatio=${s.volumeRatio?.toFixed(2) ?? 'N/A'}`,
      `ema20=${s.ema20?.toFixed(2) ?? 'N/A'} ema60=${s.ema60?.toFixed(2) ?? 'N/A'} macdHist=${s.macdHistogram?.toFixed(3) ?? 'N/A'} bbWidth=${bbWidth?.toFixed(2) ?? 'N/A'}`,
      `atr14=${s.atr14?.toFixed(2) ?? 'N/A'} candidates=${candCount}`,
    ].join('\n');
  }).join('\n\n');
}

/**
 * Stage 1 query 텍스트 — RAG 검색용 자유문.
 *
 * D-10: 종목 수에 따라 분기.
 *  - 종목 ≤3: 기존처럼 한 query 결합 (임베딩 1회로 충분)
 *  - 종목 >3: 종목별 query 로 분리 호출 (다종목 결합은 임베딩 의미 분산 → hits 품질 저하).
 *    news/macro 는 종목 무관해서 결합 query 결과 재사용해도 OK 지만, signals 는 종목별로 따로 검색해야 의미.
 */
const PER_SYMBOL_QUERY_THRESHOLD = 3;

function buildSingleSymbolQuery(i: BatchSymbolInput): string {
  const s = i.summary;
  const side = i.candidates[0]?.side ?? 'buy';
  return `${i.symbol} ${side} rsi=${s.rsi14 ?? 'N/A'} chg5=${s.priceChange5}% volRatio=${s.volumeRatio ?? 'N/A'}`;
}

function buildRagQueryText(inputs: BatchSymbolInput[]): string {
  return inputs.map(buildSingleSymbolQuery).join('; ');
}

/** D-10: signals hits 머지 — id 중복 제거, score desc 정렬. */
function mergeKbHits<T extends { id: string; score: number }>(arrs: T[][], maxKeep: number): T[] {
  const seen = new Map<string, T>();
  for (const arr of arrs) {
    for (const h of arr) {
      const ex = seen.get(h.id);
      if (!ex || h.score > ex.score) seen.set(h.id, h);
    }
  }
  return Array.from(seen.values()).sort((a, b) => b.score - a.score).slice(0, maxKeep);
}

async function buildStage1Prompt(inputs: BatchSymbolInput[], market: Market): Promise<string> {
  const marketLabel = market === 'overseas' ? 'US Stocks' : 'KRX Stocks';
  const blocks = buildSymbolBlocks(inputs);

  // RAG context 검색 (실패·비활성 시 빈 문자열)
  let ragSection = '';
  try {
    const cfg = await getProviderConfig();
    if (cfg.ragEnabled !== false) {
      const ragMarket = market === 'overseas' ? 'overseas' : 'domestic';
      let rag;
      // D-10: 종목 수에 따라 query 분기
      if (inputs.length > PER_SYMBOL_QUERY_THRESHOLD) {
        // 종목별 병렬 호출 (캐시 D-4 가 macro/news 중복 흡수)
        const perSymbolTopK = Math.max(2, Math.ceil((cfg.ragTopKSignals ?? 5) / inputs.length));
        const perSymbolResults = await Promise.all(
          inputs.map(i => retrieveRagContext(buildSingleSymbolQuery(i), ragMarket, {
            topKSignals: perSymbolTopK,
            topKNews:    cfg.ragTopKNews,
            lookbackDays: cfg.ragLookbackDays,
          })),
        );
        // signals 는 종목별 결과 머지 (id 중복 제거), news/macro 는 첫 결과만 (모두 동일 — 캐시 적중)
        const merged = perSymbolResults[0] ?? { pastSignals: [], recentNews: [], macroContext: [], totalChars: 0, elapsedMs: 0, errors: [] };
        const allSignals = perSymbolResults.flatMap(r => r.pastSignals);
        merged.pastSignals = mergeKbHits(perSymbolResults.map(r => r.pastSignals), cfg.ragTopKSignals ?? 5);
        merged.totalChars = merged.pastSignals.reduce((s, h) => s + h.text.length, 0)
                          + merged.recentNews.reduce((s, h) => s + h.text.length, 0)
                          + merged.macroContext.reduce((s, h) => s + h.text.length, 0);
        merged.errors = perSymbolResults.flatMap(r => r.errors);
        rag = merged;
        console.log(`[ai-stage1] RAG per-symbol mode (${inputs.length} symbols, perSymbolTopK=${perSymbolTopK}, signals merged from ${allSignals.length} → ${merged.pastSignals.length})`);
      } else {
        // 결합 query (≤3 종목)
        const queryText = buildRagQueryText(inputs);
        rag = await retrieveRagContext(queryText, ragMarket, {
          topKSignals: cfg.ragTopKSignals,
          topKNews:    cfg.ragTopKNews,
          lookbackDays: cfg.ragLookbackDays,
        });
      }
      if (rag.totalChars > 0) {
        ragSection = formatRagSection(rag);
      }
    }
  } catch (e) {
    console.warn(`[ai-stage1] RAG retrieval skipped: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 시장 컨텍스트 주입 (실패해도 분석 계속)
  let marketContextSection = '';
  try {
    const cfg2 = await getProviderConfig();
    if (cfg2.ragEnabled !== false) {
      const ragMarket = market === 'overseas' ? 'overseas' : 'domestic';
      const mc = await fetchMarketContext(ragMarket);
      if (mc) {
        const lines = [`## 시장 컨텍스트 (AI 요약)`, `감성: ${mc.sentiment}`];
        if (mc.key_themes.length) lines.push(`주요 테마: ${mc.key_themes.join(', ')}`);
        if (mc.risks.length) lines.push(`리스크: ${mc.risks.join(', ')}`);
        if (mc.summary) lines.push(mc.summary);
        marketContextSection = lines.join('\n');
      }
    }
  } catch (e) {
    console.warn(`[ai-stage1] market-context skip: ${e instanceof Error ? e.message : String(e)}`);
  }

  return [
    `You are a trading signal screener for ${marketLabel}.`,
    `For each symbol, decide verdict and rate confidence + EV estimate.`,
    ``,
    `Verdicts:`,
    `  - "pass"     : strong setup, +0.5%+ EV, 70%+ confidence`,
    `  - "reject"   : weak setup, ≤-0.3% EV, OR <40% confidence`,
    `  - "escalate" : ambiguous — defer to senior analyst`,
    ``,
    `LANGUAGE RULE (mandatory): "reasoning_short" MUST be written in Korean (한국어) only.`,
    `Do NOT use English, Chinese (中文), Japanese, or any other language. Korean only.`,
    `Example: "RSI 과열 + 거래량 부족", "MA 데드크로스 + 음봉 확정", "추세 약함 — 진입 보류".`,
    ``,
    ragSection,
    marketContextSection,
    ``,
    `Output ONLY a JSON object (no markdown, no extra text):`,
    `{`,
    `  "decisions": [`,
    `    {"symbol":"<sym>","verdict":"pass|reject|escalate","confidence":<0.0-1.0>,"ev_estimate_pct":<-2.0 to +3.0>,"reasoning_short":"<반드시 한국어 ≤80자>"}`,
    `  ]`,
    `}`,
    ``,
    `### Symbols`,
    blocks,
  ].filter(s => s !== '').join('\n');
}

interface RawStage1Decision {
  symbol?: unknown;
  verdict?: unknown;
  confidence?: unknown;
  ev_estimate_pct?: unknown;
  reasoning_short?: unknown;
}

interface RawStage1Response {
  decisions?: RawStage1Decision[];
}

/**
 * Stage 1 응답 파싱 — JSON 추출 + 검증.
 * 실패 시 throw → 호출자(aiSelectSignalBatch)가 legacy로 fallback.
 */
function parseStage1Response(raw: string, expectedSymbols: string[]): Stage1Decision[] {
  // JSON 블록 추출 (markdown fence·전·후 텍스트 무시)
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Stage 1: JSON 미발견 (raw chars=${raw.length})`);

  let parsed: RawStage1Response;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error(`Stage 1: JSON parse 실패 — ${e instanceof Error ? e.message : String(e)}`);
  }

  if (!parsed.decisions || !Array.isArray(parsed.decisions)) {
    throw new Error('Stage 1: decisions 배열 미발견');
  }

  // 심볼 매핑 — order는 무시, symbol 매칭 우선
  const expectedSet = new Set(expectedSymbols);
  const seen = new Set<string>();
  const decisions: Stage1Decision[] = [];

  for (const d of parsed.decisions) {
    const symbol = String(d.symbol ?? '').trim();
    if (!symbol || !expectedSet.has(symbol) || seen.has(symbol)) continue;
    seen.add(symbol);

    const rawVerdict = String(d.verdict ?? '').toLowerCase().trim();
    const verdict: Stage1Verdict =
      rawVerdict === 'pass' || rawVerdict === 'reject' || rawVerdict === 'escalate'
        ? rawVerdict
        : 'escalate'; // 모르는 값은 안전하게 escalate

    const conf = Number(d.confidence);
    const ev = Number(d.ev_estimate_pct);
    const reasoning = String(d.reasoning_short ?? '').slice(0, 120);

    decisions.push({
      symbol,
      verdict,
      confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0.5,
      evEstimatePct: Number.isFinite(ev) ? Math.max(-5, Math.min(5, ev)) : 0,
      reasoning,
    });
  }

  // 누락된 심볼 — escalate로 채움 (안전)
  for (const sym of expectedSymbols) {
    if (!seen.has(sym)) {
      decisions.push({
        symbol: sym, verdict: 'escalate', confidence: 0.5, evEstimatePct: 0,
        reasoning: 'missing in stage1 response',
      });
    }
  }

  if (decisions.length === 0) throw new Error('Stage 1: 유효한 decision 없음');
  return decisions;
}

/**
 * Stage 1 verdict 임계값 재검증 — 모델이 잘못 분류했을 때 우리가 강제 보정.
 * 예: 모델이 pass라 했지만 confidence가 낮으면 escalate로 끌어내림.
 */
function reclassifyByThreshold(d: Stage1Decision): Stage1Verdict {
  // reject 조건 우선 (안전)
  if (d.evEstimatePct <= REJECT_EV_MAX || d.confidence < REJECT_CONF_MAX) return 'reject';
  // pass 조건 (둘 다 만족)
  if (d.evEstimatePct >= PASS_EV_MIN && d.confidence >= PASS_CONF_MIN) return 'pass';
  // 그 외 회색
  return 'escalate';
}

/**
 * Stage 1 광역 스크리닝 실행.
 *
 * 호출 실패·timeout·파싱 실패 시 throw → ai-filter.ts가 legacy single-stage로 fallback.
 */
export async function runStage1Screen(
  inputs: BatchSymbolInput[],
  market: Market,
): Promise<Stage1Result> {
  const startedAt = Date.now();
  if (inputs.length === 0) {
    return { decisions: [], stats: { pass: 0, reject: 0, escalate: 0 }, rawResponseChars: 0, elapsedMs: 0 };
  }

  const prompt = await buildStage1Prompt(inputs, market);

  const raw = await runLlmOnce(prompt, {
    stage: 1,
    timeoutMs: STAGE1_TIMEOUT_MS,
    responseFormat: 'json',
  });

  const expectedSymbols = inputs.map(i => i.symbol);
  const parsed = parseStage1Response(raw, expectedSymbols);

  // 임계값 재검증 (모델 출력 신뢰도 보정)
  const corrected = parsed.map(d => ({ ...d, verdict: reclassifyByThreshold(d) }));

  const stats = corrected.reduce(
    (acc, d) => { acc[d.verdict]++; return acc; },
    { pass: 0, reject: 0, escalate: 0 },
  );

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[ai-stage1] ${inputs.length} symbols (${market}) → pass=${stats.pass} reject=${stats.reject} escalate=${stats.escalate} elapsed=${elapsedMs}ms`,
  );

  return { decisions: corrected, stats, rawResponseChars: raw.length, elapsedMs };
}
