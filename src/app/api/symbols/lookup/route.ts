import { NextRequest } from 'next/server';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { getMarketFromSymbol } from '@/lib/exchanges/kis-symbols';

export const dynamic = 'force-dynamic';

/**
 * 단일 심볼의 종목명 조회.
 *
 * 1) stock_meta 캐시 우선
 * 2) 캐시 미스: 국내라면 inquire-search-info(`CTPF1604R`) 호출 후 upsert
 *    해외는 ticker 자체를 이름으로 폴백
 *
 * GET /api/symbols/lookup?symbol=005930  →  { ok, symbol, name, market }
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const symbol = url.searchParams.get('symbol')?.trim() ?? '';
  if (!symbol) return Response.json({ ok: false, error: 'symbol required' }, { status: 400 });

  const market = getMarketFromSymbol(symbol);
  const pool = getPool();

  // 1) 캐시
  try {
    const [rows] = await pool.query<(RowDataPacket & { name: string })[]>(
      'SELECT name FROM stock_meta WHERE symbol = ? LIMIT 1',
      [symbol],
    );
    if (rows.length > 0 && rows[0].name) {
      return Response.json({ ok: true, symbol, name: rows[0].name, market });
    }
  } catch { /* fall through */ }

  // 2) 라이브 조회 (국내만)
  if (market === 'domestic') {
    try {
      const { getKisToken } = await import('@/lib/exchanges/kis-auth');
      const { kisFetch } = await import('@/lib/exchanges/kis-http');
      const { getCredential } = await import('@/lib/credentials');
      const [token, appkey, appsecret] = await Promise.all([
        getKisToken(),
        getCredential('KIS_APP_KEY'),
        getCredential('KIS_APP_SECRET'),
      ]);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization:  `Bearer ${token}`,
        appkey,
        appsecret,
        tr_id:          'CTPF1604R',
        custtype:       'P',
      };
      const params = new URLSearchParams({ PRDT_TYPE_CD: '300', PDNO: symbol });
      const isMock = String(process.env.KIS_MOCK ?? 'true').toLowerCase() === 'true';
      const base = isMock
        ? 'https://openapivts.koreainvestment.com:29443'
        : 'https://openapi.koreainvestment.com:9443';
      // T-017 — 어댑터를 우회해 KIS 를 직접 부르던 자리. 단일 관문(kisFetch)으로 합류시킨다.
      const res = await kisFetch(`${base}/uapi/domestic-stock/v1/quotations/search-info?${params}`, { headers }, { label: 'search-info(lookup)' });
      if (res.ok) {
        const data = await res.json();
        const name: string = data?.output?.prdt_abrv_name ?? data?.output?.prdt_name ?? '';
        if (name) {
          try {
            await pool.query<ResultSetHeader>(
              "INSERT INTO stock_meta (symbol, name, market) VALUES (?, ?, 'domestic') " +
              "ON DUPLICATE KEY UPDATE name = VALUES(name)",
              [symbol, name],
            );
          } catch { /* swallow */ }
          return Response.json({ ok: true, symbol, name, market });
        }
      }
    } catch { /* fall through */ }
  }

  // 3) 폴백 — 코드 또는 티커 그대로
  const idx = symbol.indexOf(':');
  const fallback = idx > 0 ? symbol.slice(idx + 1) : symbol;
  return Response.json({ ok: true, symbol, name: fallback, market });
}
