/**
 * RAG context를 LLM prompt에 첨부할 텍스트 section으로 포맷.
 *
 * 출력 길이: 평균 1500~3000자. 비어있으면 빈 문자열.
 * 토큰 예산: glm-4.7-flash 128K context — 여유.
 */
import type { RagContext } from './retrieval';
import type { KbHit } from './m4-kb';

const MAX_REASONING_CHARS = 200;
const MAX_NEWS_CHARS = 240;

/**
 * D-7: KbHit 최소 schema 검증.
 * 적재 시점과 검색 시점의 스키마가 다를 경우(컬렉션 모델 교체·재인덱싱 누락 등) 깨진 데이터를 LLM 에 주입하면 환각 유발.
 * 다음 조건 미충족 hit 는 형식이 깨진 것으로 간주, 제외:
 *   - id 가 string
 *   - score 가 finite number, 0~1 범위 (cosine similarity 기준; 음수도 허용은 하지만 0 이상만 통과)
 *   - text 가 비어있지 않은 string
 *   - metadata 가 plain object (또는 null/undefined)
 */
export function isValidKbHit(h: unknown): h is KbHit {
  if (!h || typeof h !== 'object') return false;
  const x = h as Record<string, unknown>;
  if (typeof x.id !== 'string') return false;
  if (typeof x.score !== 'number' || !Number.isFinite(x.score) || x.score < 0) return false;
  if (typeof x.text !== 'string' || x.text.trim() === '') return false;
  if (x.metadata != null && (typeof x.metadata !== 'object' || Array.isArray(x.metadata))) return false;
  return true;
}

/** 잘못된 hit 만 걸러내고 갯수만 호출자에게 반환. 로깅은 호출자가 결정. */
export function filterValidHits(hits: KbHit[]): { valid: KbHit[]; invalidCount: number } {
  const valid: KbHit[] = [];
  let invalidCount = 0;
  for (const h of hits) {
    if (isValidKbHit(h)) valid.push(h);
    else invalidCount++;
  }
  return { valid, invalidCount };
}

function fmtMeta(h: KbHit, keys: string[]): string {
  const parts: string[] = [];
  for (const k of keys) {
    const v = h.metadata?.[k];
    if (v != null && v !== '') parts.push(`${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
  }
  return parts.join(' ');
}

function truncate(text: string, max: number): string {
  if (!text) return '';
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
}

/**
 * D-6: 임베딩 텍스트에 잠재 PII/민감정보 마스킹.
 *
 * Reasoning 텍스트가 LLM 가공이라 사용자 식별자·내부 코드명·API 키 등이 우발적으로 박힐 수 있음.
 * KB 에 영구 저장되므로 적재 전 차단 필수. 보수적으로 다음 패턴만 마스킹 (overblock 보다 underblock 위험 우선):
 *   - 이메일
 *   - 전화번호 (한국 010-XXXX-XXXX, 011~019 포함)
 *   - 카드번호 형태 (4-4-4-4 숫자)
 *   - JWT/Bearer 토큰
 *   - mk_ 또는 sk_ prefix API 키 (32자 이상 영숫자)
 *   - AWS_ACCESS_KEY 형태 (AKIA + 16자 대문자/숫자)
 *
 * 마스킹 후 길이가 max 초과면 truncate.
 */
export function redactReasoning(text: string | null | undefined, max = MAX_REASONING_CHARS): string {
  if (!text) return '';
  let out = text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[EMAIL]')
    .replace(/01[016789][- ]?\d{3,4}[- ]?\d{4}/g, '[PHONE]')
    .replace(/\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g, '[CARD]')
    .replace(/\bBearer\s+[A-Za-z0-9._\-]{20,}/gi, 'Bearer [TOKEN]')
    .replace(/\beyJ[A-Za-z0-9._\-]{20,}/g, '[JWT]')
    .replace(/\b(mk|sk)_[A-Za-z0-9_\-]{20,}/g, '[API_KEY]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[AWS_KEY]');
  return truncate(out, max);
}

function formatPastSignal(h: KbHit): string {
  const meta = fmtMeta(h, ['symbol', 'side', 'date', 'hit_4h', 'hit_24h', 'pnl_pct_1h', 'pnl_pct_4h', 'pnl_pct_24h', 'regime_bucket']);
  return `- ${meta} score=${h.score.toFixed(3)} | ${truncate(h.text, MAX_REASONING_CHARS)}`;
}

function formatNewsItem(h: KbHit): string {
  const meta = fmtMeta(h, ['date', 'source', 'topic', 'tickers_mentioned', 'event_type', 'impact']);
  return `- ${meta} score=${h.score.toFixed(3)} | ${truncate(h.text, MAX_NEWS_CHARS)}`;
}

/**
 * RAG context section 빌더.
 * pastSignals + recentNews + macroContext가 모두 비어있으면 빈 문자열 반환.
 */
export function formatRagSection(rag: RagContext): string {
  const sections: string[] = [];

  if (rag.pastSignals.length > 0) {
    sections.push([
      `#### Past similar signals (top ${rag.pastSignals.length}):`,
      ...rag.pastSignals.map(formatPastSignal),
    ].join('\n'));
  }

  if (rag.recentNews.length > 0) {
    sections.push([
      `#### Recent news (top ${rag.recentNews.length}):`,
      ...rag.recentNews.map(formatNewsItem),
    ].join('\n'));
  }

  if (rag.macroContext.length > 0) {
    sections.push([
      `#### Macro context (top ${rag.macroContext.length}):`,
      ...rag.macroContext.map(formatNewsItem),
    ].join('\n'));
  }

  if (sections.length === 0) return '';

  return [
    `### Reference Context (RAG)`,
    `Use these reference points to anchor your confidence and EV estimates. Cite ` +
      `briefly in reasoning_short when relevant. Do NOT hallucinate beyond this context.`,
    ``,
    sections.join('\n\n'),
  ].join('\n');
}

/**
 * 시그널 1건을 임베딩에 적합한 자유문 텍스트로 변환 (Qdrant upsert용).
 *
 * 형식:
 *   [YYYY-MM-DD HH:mm] SYMBOL side strategy=...
 *   가격 ..., RSI ..., MACD ..., 거래량 ...
 *   근거: ...
 *   AI: confidence=.., EV=.., regime=..
 *   결과 (있으면): 1h=+0.4% 4h=+1.2% hit_4h=true
 */
export interface SignalForEmbedding {
  symbol: string;
  side: 'buy' | 'sell';
  strategyId?: string | null;
  market?: string | null;
  status?: string | null;
  price?: number | null;
  reasoning?: string | null;
  indicators?: Record<string, unknown> | null;
  /** ISO 8601 또는 'YYYY-MM-DD HH:mm:ss' */
  createdAt?: string | null;
  /** Phase Q 컬럼 — 가능하면 포함 */
  priceChangePct1h?: number | null;
  priceChangePct4h?: number | null;
  priceChangePct24h?: number | null;
  hit1h?: boolean | null;
  hit4h?: boolean | null;
  hit24h?: boolean | null;
}

function pct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return 'N/A';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

export function buildSignalText(s: SignalForEmbedding): string {
  const ts = (s.createdAt ?? '').slice(0, 16).replace('T', ' ');
  const ind = (s.indicators ?? {}) as Record<string, unknown>;
  const ai  = (ind.ai ?? {}) as Record<string, unknown>;

  // D-6: reasoning 은 redact + truncate (200자)
  const reasoningSafe = s.reasoning ? redactReasoning(s.reasoning) : '';
  const lines = [
    `[${ts}] ${s.symbol} ${s.side} strategy=${s.strategyId ?? 'unknown'}`,
    `price=${s.price ?? 'N/A'} rsi14=${ind.rsi14 ?? 'N/A'} macdHist=${ind.macdHistogram ?? 'N/A'} volRatio=${ind.volumeRatio ?? 'N/A'}`,
    reasoningSafe ? `근거: ${reasoningSafe}` : '',
    `AI: confidence=${ai.confidence ?? 'N/A'} ev=${ai.ev ?? 'N/A'} regime=${ai.regimeBucket ?? 'N/A'} skipCategory=${ai.skipCategory ?? 'N/A'}`,
    `시장: ${s.market ?? 'N/A'} status: ${s.status ?? 'N/A'}`,
  ];

  // Phase Q 라벨 (있을 때만 추가)
  if (s.hit1h != null || s.hit4h != null || s.hit24h != null) {
    lines.push(
      `결과: 1h=${pct(s.priceChangePct1h)}(hit=${s.hit1h ?? 'N/A'}) ` +
      `4h=${pct(s.priceChangePct4h)}(hit=${s.hit4h ?? 'N/A'}) ` +
      `24h=${pct(s.priceChangePct24h)}(hit=${s.hit24h ?? 'N/A'})`,
    );
  }

  return lines.filter(Boolean).join('\n');
}

/** 시그널 → Qdrant 메타데이터 (search filter용). */
export function buildSignalMetadata(s: SignalForEmbedding & { id?: string | number }): Record<string, unknown> {
  const ind = (s.indicators ?? {}) as Record<string, unknown>;
  const ai  = (ind.ai ?? {}) as Record<string, unknown>;
  return {
    signal_id: s.id ?? null,
    symbol: s.symbol,
    side: s.side,
    market: s.market ?? null,
    status: s.status ?? null,
    strategy_id: s.strategyId ?? null,
    regime_bucket: ai.regimeBucket ?? null,
    confidence: ai.confidence ?? null,
    ev: ai.ev ?? null,
    pnl_pct_1h: s.priceChangePct1h ?? null,
    pnl_pct_4h: s.priceChangePct4h ?? null,
    pnl_pct_24h: s.priceChangePct24h ?? null,
    hit_1h: s.hit1h ?? null,
    hit_4h: s.hit4h ?? null,
    hit_24h: s.hit24h ?? null,
    date: (s.createdAt ?? '').slice(0, 10),  // YYYY-MM-DD (Qdrant range filter)
    created_at: s.createdAt ?? null,
  };
}
