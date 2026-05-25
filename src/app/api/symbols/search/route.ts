import { NextRequest } from 'next/server';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface StockRow extends RowDataPacket {
  symbol: string;
  name: string;
  market: string;
}

/**
 * 종목 검색 — 이름 또는 코드 prefix 검색
 *
 * GET /api/symbols/search?q=삼성&market=domestic
 * GET /api/symbols/search?q=AAPL&market=overseas
 *
 * 1) stock_meta 캐시 LIKE 검색
 * 2) 국내: q가 6자리 숫자인 경우 KIS CTPF1604R 단건 조회 후 결과 merge
 * Returns: { ok, results: { symbol, name, market }[] }
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const q = url.searchParams.get('q')?.trim() ?? '';
  const market = url.searchParams.get('market') ?? '';

  if (q.length < 1) return Response.json({ ok: true, results: [] });

  const pool = getPool();
  const results: { symbol: string; name: string; market: string }[] = [];
  const seen = new Set<string>();

  // 1) stock_meta DB 검색
  // 정렬: 이름이 검색어로 시작 → 코드 정확 일치 → 나머지(ETF 등)
  try {
    const marketCond = market ? 'AND market = ?' : '';
    const likeAll = `%${q}%`;
    const likeStart = `${q}%`;

    // WHERE 파라미터
    const whereParams: (string | number)[] = [likeAll, likeAll];
    if (market) whereParams.push(market);

    // ORDER BY 파라미터 (name LIKE 'q%', symbol = q)
    const orderParams: (string | number)[] = [likeStart, q];

    const [rows] = await pool.query<StockRow[]>(
      `SELECT symbol, name, market FROM stock_meta
       WHERE (name LIKE ? OR symbol LIKE ?) ${marketCond}
       ORDER BY
         CASE
           WHEN name LIKE ? THEN 0
           WHEN symbol = ?  THEN 1
           ELSE 2
         END,
         name
       LIMIT 20`,
      [...whereParams, ...orderParams],
    );
    for (const r of rows) {
      if (!seen.has(r.symbol)) {
        seen.add(r.symbol);
        results.push({ symbol: r.symbol, name: r.name, market: r.market });
      }
    }
  } catch { /* fall through */ }

  // 2) 국내: q가 숫자만으로 구성된 경우 KIS 단건 조회 → DB에도 upsert
  const isDomesticCode = /^\d{1,6}$/.test(q) && (!market || market === 'domestic');
  if (isDomesticCode && !seen.has(q.padStart(6, '0'))) {
    const padded = q.padStart(6, '0');
    try {
      const { getKisToken } = await import('@/lib/exchanges/kis-auth');
      const { getCredential } = await import('@/lib/credentials');
      const { kisBaseUrl } = await import('@/lib/exchanges/kis-auth');
      const [token, appkey, appsecret] = await Promise.all([
        getKisToken(),
        getCredential('KIS_APP_KEY'),
        getCredential('KIS_APP_SECRET'),
      ]);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${token}`,
        appkey, appsecret,
        tr_id: 'CTPF1604R',
        custtype: 'P',
      };
      const params = new URLSearchParams({ PRDT_TYPE_CD: '300', PDNO: padded });
      const res = await fetch(
        `${kisBaseUrl()}/uapi/domestic-stock/v1/quotations/search-info?${params}`,
        { headers, signal: AbortSignal.timeout(4000) },
      );
      if (res.ok) {
        const data = await res.json();
        const name: string = data?.output?.prdt_abrv_name ?? data?.output?.prdt_name ?? '';
        if (name) {
          results.unshift({ symbol: padded, name, market: 'domestic' });
          seen.add(padded);
          // 캐시 upsert (화면에 표시됐으니 다음 검색에 활용)
          pool.query<ResultSetHeader>(
            "INSERT INTO stock_meta (symbol, name, market) VALUES (?, ?, 'domestic') " +
            'ON DUPLICATE KEY UPDATE name = VALUES(name)',
            [padded, name],
          ).catch(() => {});
        }
      }
    } catch { /* 조회 실패 시 무시 */ }
  }

  return Response.json({ ok: true, results: results.slice(0, 15) });
}
