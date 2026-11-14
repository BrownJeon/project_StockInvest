/**
 * 채팅 첨부 컨텍스트 빌더 — 종목 심볼 리스트 → 시세·지표 스냅샷 + 텍스트 요약.
 *
 * 사용처:
 *  - /api/chat/threads/[id]/draft : 사용자 원문에서 인식된 종목 + 명시 첨부 → drafter LLM에 전달
 *  - /api/chat/threads/[id]/messages : draft 단계에서 받은 attachedContext echo로 재활용
 *
 * T-169 B4 — 통화: KIS 해외 시세·일봉은 **원화 환산값**이다(`kis-overseas.ts` getTicker·getDailyCandles 가 `× fx`). 그래서 `price` 는
 * 국내·해외 모두 원화이고(화면 칩이 그대로 쓴다 — 바꾸지 않는다), 해외는 KIS 가 준 달러 원가를 `priceUsd` 에 따로 담아 프롬프트에서
 * 달러로 적는다. 달러 원가를 모르면(예전 echo 등) 「원화 환산」이라고 밝힌다 — 원화 숫자에 `$` 를 붙이지 않는다.
 */
import { kis } from '@/lib/exchanges/kis';
import { buildMarketSummary, type MarketSummary } from '@/lib/strategy/ai-filter';
import { formatKrw, formatUsd, isOverseasSymbol } from './money-format';
import type { ResolvedSymbol } from './symbol-resolver';

export interface SymbolContext {
  symbol: string;
  name: string;
  matchedText?: string;
  /** 원화(해외는 KIS 원화 환산값) — 화면 칩 표시용 */
  price: number;
  /** T-169 — 해외 종목의 KIS 달러 원가(환산 전). 국내·모름은 null/없음 */
  priceUsd?: number | null;
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
        priceUsd:      isOverseasSymbol(r.symbol) && isFiniteNumber(ticker.priceUsd) && ticker.priceUsd > 0
          ? ticker.priceUsd
          : null,
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

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** T-169 B4 — 심볼에 `:` 가 있으면 해외(달러), 아니면 국내(원). */
function priceText(c: SymbolContext): string {
  if (!isOverseasSymbol(c.symbol)) {
    return isFiniteNumber(c.price) ? `현재 ${formatKrw(c.price)}` : '현재가 미확인';
  }
  if (isFiniteNumber(c.priceUsd) && c.priceUsd > 0) return `현재 ${formatUsd(c.priceUsd)}`;
  return isFiniteNumber(c.price) ? `현재가 달러 미확인(원화 환산 약 ${formatKrw(c.price)})` : '현재가 미확인';
}

/** MACD 히스토그램은 가격 단위라 해외는 달러로 되돌린다(같은 환율로 환산된 값 — 비율로 복원). 모르면 부호만. */
function macdText(c: SymbolContext): string {
  if (c.macdHistogram == null || !isFiniteNumber(c.macdHistogram)) return 'MACD 미산정';
  let v = c.macdHistogram;
  if (isOverseasSymbol(c.symbol)) {
    if (!(isFiniteNumber(c.priceUsd) && c.priceUsd > 0 && isFiniteNumber(c.price) && c.price > 0)) {
      return `MACD 히스토 ${v >= 0 ? '양(+)' : '음(-)'}`;
    }
    v = v * (c.priceUsd / c.price);
  }
  return `MACD 히스토 ${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
}

/** SymbolContext[] → LLM 프롬프트용 한국어 텍스트 요약 */
export function formatSymbolContextsAsText(ctxs: SymbolContext[]): string {
  if (ctxs.length === 0) return '';
  const lines = ctxs.map(c => {
    const trend = c.ema20 != null && c.ema60 != null
      ? (c.ema20 > c.ema60 ? '단기 상승' : '단기 하락')
      : '추세 불명';
    const rsi = c.rsi14 != null ? `RSI(14) ${c.rsi14.toFixed(1)}` : 'RSI 미산정';
    const atr = c.atrPct != null ? `ATR% ${c.atrPct.toFixed(2)}%` : 'ATR 미산정';
    const change5 = `5봉 변화 ${c.priceChange5 >= 0 ? '+' : ''}${c.priceChange5.toFixed(2)}%`;
    const label = c.matchedText && c.matchedText !== c.name && c.matchedText !== c.symbol
      ? `${c.name}(${c.matchedText}, ${c.symbol})`
      : `${c.name} (${c.symbol})`;
    return `- ${label}: ${priceText(c)}, ${rsi}, ${trend}, ${macdText(c)}, ${atr}, ${change5}`;
  });
  return lines.join('\n');
}
