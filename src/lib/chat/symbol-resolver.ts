import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';

export interface ResolvedSymbol {
  symbol: string;
  name: string;
  matchedText: string;
}

const MAX_RESOLVED = 3;
const NAME_MIN_LEN = 2;

/**
 * 사용자 텍스트에서 종목 코드·종목명을 자동 추출.
 *
 * 매칭 우선순위:
 *  1) 6자리 숫자 코드 — `\b\d{6}\b` (국내)
 *  2) 해외 형식 — `(NAS|NYS|AMS):[A-Z]+`
 *  3) 한국 종목명 — stock_meta 테이블 LIKE 검색 (universe refresh가 채움)
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

  // 3) 한국어 종목명 — stock_meta 전체 fetch(domestic, < 200행) 후 인메모리 부분 매칭
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

  return result;
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
