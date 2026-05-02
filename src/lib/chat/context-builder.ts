/**
 * 채팅 첨부 컨텍스트 빌더 — 종목 심볼 리스트 → 시세·지표 스냅샷 + 텍스트 요약.
 *
 * 사용처:
 *  - /api/chat/threads/[id]/draft : 사용자 원문에서 인식된 종목 + 명시 첨부 → drafter LLM에 전달
 *  - /api/chat/threads/[id]/messages : draft 단계에서 받은 attachedContext echo로 재활용
 */
import { kis } from '@/lib/exchanges/kis';
import { buildMarketSummary, type MarketSummary } from '@/lib/strategy/ai-filter';
import type { ResolvedSymbol } from './symbol-resolver';

export interface SymbolContext {
  symbol: string;
  name: string;
  matchedText?: string;
  price: number;
  priceChange5: number;
  rsi14: number | null;
  ema20: number | null;
  ema60: number | null;
  macdHistogram: number | null;
  atrPct: number | null;
  high24h: number | undefined;
  low24h: number | undefined;
}

const MAX_CONTEXT_SYMBOLS = 3;
const CANDLE_INTERVAL = '1d';
const CANDLE_COUNT = 60;

/**
 * 종목별 ticker + 일봉 60개 → buildMarketSummary 호출 → 핵심 수치만 요약 SymbolContext로 환원.
 * 실패한 심볼은 결과에서 제외 (호출부가 빈 배열도 처리).
 */
export async function buildSymbolContexts(symbols: ResolvedSymbol[]): Promise<SymbolContext[]> {
  const targets = symbols.slice(0, MAX_CONTEXT_SYMBOLS);
  const out: SymbolContext[] = [];
  for (const r of targets) {
    try {
      const [ticker, candles] = await Promise.all([
        kis.getTicker(r.symbol),
        kis.getCandles(r.symbol, CANDLE_INTERVAL, CANDLE_COUNT),
      ]);
      if (candles.length < 20) continue;
      const summary: MarketSummary = buildMarketSummary(candles, ticker);
      out.push({
        symbol:        r.symbol,
        name:          r.name,
        matchedText:   r.matchedText,
        price:         summary.currentPrice,
        priceChange5:  summary.priceChange5,
        rsi14:         summary.rsi14,
        ema20:         summary.ema20,
        ema60:         summary.ema60,
        macdHistogram: summary.macdHistogram,
        atrPct:        summary.atr14 != null && summary.currentPrice > 0
          ? (summary.atr14 / summary.currentPrice) * 100
          : null,
        high24h:       summary.high24h,
        low24h:        summary.low24h,
      });
    } catch {
      // 한 종목 실패는 무시
    }
  }
  return out;
}

/** SymbolContext[] → LLM 프롬프트용 한국어 텍스트 요약 */
export function formatSymbolContextsAsText(ctxs: SymbolContext[]): string {
  if (ctxs.length === 0) return '';
  const lines = ctxs.map(c => {
    const trend = c.ema20 != null && c.ema60 != null
      ? (c.ema20 > c.ema60 ? '단기 상승' : '단기 하락')
      : '추세 불명';
    const rsi = c.rsi14 != null ? `RSI(14) ${c.rsi14.toFixed(1)}` : 'RSI 미산정';
    const macd = c.macdHistogram != null ? `MACD 히스토 ${c.macdHistogram >= 0 ? '+' : ''}${c.macdHistogram.toFixed(2)}` : 'MACD 미산정';
    const atr = c.atrPct != null ? `ATR% ${c.atrPct.toFixed(2)}%` : 'ATR 미산정';
    const change5 = `5봉 변화 ${c.priceChange5 >= 0 ? '+' : ''}${c.priceChange5.toFixed(2)}%`;
    return `- ${c.name} (${c.symbol}): 현재 ${c.price.toLocaleString()}원, ${rsi}, ${trend}, ${macd}, ${atr}, ${change5}`;
  });
  return lines.join('\n');
}
