import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { US_NAME_ALIASES } from './us-name-aliases';

export interface ResolvedSymbol {
  symbol: string;
  name: string;
  matchedText: string;
}

const MAX_RESOLVED = 3;
const NAME_MIN_LEN = 2;
/** 한 질문에서 미국 후보(별칭 티커 + 단독 티커)를 최대 몇 개까지 DB 에 물어볼지 — 쿼리 크기 상한 */
const MAX_US_CANDIDATES = 12;
/** 같은 티커가 여러 거래소에 있으면 이 순서로 고른다(T-169 B3). */
const US_EXCHANGES = ['NAS', 'NYS', 'AMS'] as const;

/**
 * T-169 B3 — 단독 티커로 보지 않는 대문자 낱말. 지표·거시·일반 약어가 우연히 해외 티커와 같아 엉뚱한 종목이 첨부되는 것을 막는다.
 * 실제 티커와 겹치는 것(AI·ALL·NOW·ON 등)도 있지만, 그 종목은 `NYS:ALL` 처럼 거래소를 붙이거나 한글 별칭으로 물으면 된다.
 */
export const US_TICKER_STOPWORDS: ReadonlySet<string> = new Set([
  'AI', 'ETF', 'ETN', 'RSI', 'EMA', 'SMA', 'MA', 'MACD', 'ATR', 'BB', 'OBV', 'VWAP', 'ADX', 'CCI', 'MFI',
  'CPI', 'PPI', 'PCE', 'FOMC', 'FED', 'GDP', 'ISM', 'PMI', 'ECB', 'BOJ', 'BOK', 'SEC', 'IMF', 'OPEC',
  'PER', 'PBR', 'PSR', 'EPS', 'BPS', 'ROE', 'ROA', 'ROI', 'EV', 'EBIT', 'FCF', 'DCF', 'TTM', 'YOY', 'QOQ', 'MOM', 'YTD', 'ATH',
  'USD', 'KRW', 'JPY', 'EUR', 'CNY', 'IPO', 'SPAC', 'ADR', 'CEO', 'CFO', 'CTO', 'COO', 'IR', 'PR', 'HR', 'ESG',
  'US', 'USA', 'KR', 'JP', 'EU', 'UK', 'CN', 'IT', 'OK', 'VS', 'TOP', 'BUY', 'SELL', 'HOLD', 'NEW', 'ALL', 'NOW', 'ANY',
  'THE', 'AND', 'FOR', 'NOT', 'YES', 'NO', 'ON', 'IN', 'AT', 'BY', 'OF', 'OR', 'TO', 'UP', 'DOWN', 'LOW', 'HIGH', 'HOT',
  'LONG', 'SHORT', 'CALL', 'PUT', 'CASH', 'RISK', 'BEST', 'GOOD', 'NEXT', 'WEEK', 'DAY', 'YEAR', 'NEWS', 'API', 'LLM',
  'GPU', 'CPU', 'HBM', 'NPU', 'AR', 'VR', 'XR', 'AM', 'PM', 'ET', 'KST', 'UTC', 'EST', 'NYSE', 'AMEX', 'NAS', 'NYS',
  'AMS', 'KOSPI', 'DOW', 'SP', 'NDX', 'SPX', 'VIX',
]);

/**
 * 사용자 텍스트에서 종목 코드·종목명을 자동 추출.
 *
 * 매칭 우선순위 (1~3 은 T-169 이전 그대로):
 *  1) 6자리 숫자 코드 — `\b\d{6}\b` (국내)
 *  2) 해외 형식 — `(NAS|NYS|AMS):[A-Z]+`
 *  3) 한국 종목명 — stock_meta 국내 행 부분 매칭
 *  4) (T-169) 미국 대형주 한글 별칭 — `us-name-aliases.ts` 고정 표, stock_meta 해외 행에 있는 심볼만
 *  5) (T-169) 단독 티커 — 대문자 2~5자 낱말이 stock_meta 해외 심볼 접미사와 같고 제외어가 아닐 때만. NAS→NYS→AMS 순
 *
 * 결과는 최대 3개 (LLM 토큰 보호). 중복 제거 (symbol 기준).
 */
export async function resolveSymbolsInText(text: string): Promise<ResolvedSymbol[]> {
  if (!text || text.trim().length === 0) return [];

  const result: ResolvedSymbol[] = [];
  const seen = new Set<string>();

  const push = (entry: ResolvedSymbol) => {
    if (seen.has(entry.symbol)) return;
    seen.add(entry.symbol);
    result.push(entry);
  };

  // 1) 6자리 코드
  const codeMatches = text.match(/\b\d{6}\b/g) ?? [];
  for (const code of codeMatches) {
    if (result.length >= MAX_RESOLVED) break;
    const name = await lookupName(code);
    push({ symbol: code, name: name ?? code, matchedText: code });
  }

  // 2) 해외 EXCHG:SYMBOL
  const overseasMatches = text.match(/\b(NAS|NYS|AMS):[A-Z]{1,8}\b/g) ?? [];
  for (const overseas of overseasMatches) {
    if (result.length >= MAX_RESOLVED) break;
    const name = await lookupName(overseas);
    push({ symbol: overseas, name: name ?? overseas, matchedText: overseas });
  }

  // 3) 한국어 종목명 — stock_meta 전체 fetch(domestic) 후 인메모리 부분 매칭
  if (result.length < MAX_RESOLVED) {
    try {
      const pool = getPool();
      const [rows] = await pool.query<RowDataPacket[]>(
        "SELECT symbol, name FROM stock_meta WHERE market = 'domestic' AND name IS NOT NULL AND name != ''",
      );
      for (const row of rows) {
        const name = String(row.name);
        if (name.length < NAME_MIN_LEN) continue;
        if (text.includes(name)) {
          if (result.length >= MAX_RESOLVED) break;
          push({ symbol: String(row.symbol), name, matchedText: name });
        }
      }
    } catch {
      // stock_meta 미초기화 시 무시
    }
  }

  // 4)·5) 미국 — 한글 별칭(글 순서) 다음 단독 티커(글 순서)
  if (result.length < MAX_RESOLVED) {
    const wanted = [...findAliasTickers(text), ...findBareTickers(text)];
    const tickers: { ticker: string; matchedText: string }[] = [];
    for (const w of wanted) {
      if (tickers.length >= MAX_US_CANDIDATES) break;
      if (!tickers.some((t) => t.ticker === w.ticker)) tickers.push(w);
    }
    if (tickers.length > 0) {
      const found = await lookupOverseasSymbols(tickers.map((t) => t.ticker));
      for (const t of tickers) {
        if (result.length >= MAX_RESOLVED) break;
        const hit = found.get(t.ticker);
        if (hit) push({ symbol: hit.symbol, name: hit.name, matchedText: t.matchedText });
      }
    }
  }

  return result;
}

/** 한글 별칭 → 티커(글에 처음 나온 순서). 뒤에 막힌 접미사가 붙은 자리는 건너뛴다. */
export function findAliasTickers(text: string): { ticker: string; matchedText: string; index: number }[] {
  const hits: { ticker: string; matchedText: string; index: number }[] = [];
  for (const a of US_NAME_ALIASES) {
    let from = 0;
    while (from <= text.length) {
      const idx = text.indexOf(a.alias, from);
      if (idx < 0) break;
      const rest = text.slice(idx + a.alias.length);
      const blocked = (a.blockedSuffixes ?? []).some((suf) => rest.startsWith(suf));
      if (!blocked) {
        hits.push({ ticker: a.ticker, matchedText: a.alias, index: idx });
        break;
      }
      from = idx + a.alias.length;
    }
  }
  return hits.sort((x, y) => x.index - y.index);
}

/** 단독 티커 후보 — 대문자 2~5자 낱말(앞뒤가 영문·숫자·`:`·`.` 이 아님), 제외어 아님, 글 순서. */
export function findBareTickers(text: string): { ticker: string; matchedText: string; index: number }[] {
  const out: { ticker: string; matchedText: string; index: number }[] = [];
  const re = /(?<![A-Za-z0-9:.&])[A-Z]{2,5}(?![A-Za-z0-9:.&])/g;
  for (const m of text.matchAll(re)) {
    const tok = m[0];
    if (US_TICKER_STOPWORDS.has(tok)) continue;
    out.push({ ticker: tok, matchedText: tok, index: m.index ?? 0 });
  }
  return out;
}

/** 티커 → stock_meta 해외 심볼(NAS→NYS→AMS 순 첫 번째). DB 오류면 빈 맵(인식 안 함). */
async function lookupOverseasSymbols(tickers: string[]): Promise<Map<string, { symbol: string; name: string }>> {
  const out = new Map<string, { symbol: string; name: string }>();
  const candidates = tickers.flatMap((t) => US_EXCHANGES.map((ex) => `${ex}:${t}`));
  if (candidates.length === 0) return out;
  try {
    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT symbol, name FROM stock_meta WHERE market = 'overseas' AND symbol IN (?)",
      [candidates],
    );
    const bySymbol = new Map<string, string>();
    for (const row of rows) bySymbol.set(String(row.symbol), row.name ? String(row.name) : String(row.symbol));
    for (const t of tickers) {
      for (const ex of US_EXCHANGES) {
        const sym = `${ex}:${t}`;
        if (bySymbol.has(sym)) {
          out.set(t, { symbol: sym, name: bySymbol.get(sym) ?? sym });
          break;
        }
      }
    }
  } catch {
    // stock_meta 조회 실패 — 미국 종목 인식만 건너뛴다
  }
  return out;
}

async function lookupName(symbol: string): Promise<string | null> {
  try {
    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT name FROM stock_meta WHERE symbol = ? LIMIT 1',
      [symbol],
    );
    if (rows.length > 0 && rows[0].name) return String(rows[0].name);
  } catch { /* fall through */ }
  return null;
}
