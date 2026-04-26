import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { getKisTickers } from '@/lib/exchanges/kis';
import { getKisToken } from '@/lib/exchanges/kis-auth';
import { getCredential } from '@/lib/credentials';
import { getStaticOverseasUniverse } from '@/lib/strategy/universe-overseas-static';

/** KIS search-info로 국내 종목명 단건 조회 (실패 시 null) */
async function fetchDomesticName(symbol: string, token: string): Promise<string | null> {
  try {
    const isMock = String(process.env.KIS_MOCK ?? 'true').toLowerCase() === 'true';
    const base = isMock
      ? 'https://openapivts.koreainvestment.com:29443'
      : 'https://openapi.koreainvestment.com:9443';
    const [appkey, appsecret] = await Promise.all([
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
    const res = await fetch(`${base}/uapi/domestic-stock/v1/quotations/search-info?${params}`, { headers });
    if (!res.ok) return null;
    const data = await res.json();
    const name: string = data?.output?.prdt_abrv_name ?? data?.output?.prdt_name ?? '';
    return name || null;
  } catch {
    return null;
  }
}

export const dynamic = 'force-dynamic';

/**
 * 대시보드 종목 추가 picker용. stock_meta에 캐시된 종목명을 합쳐 반환.
 * - symbols: 코드 배열(legacy 호환)
 * - meta: { code: name } 매핑 (없으면 빈 객체)
 */
export async function GET() {
  try {
    const pool = getPool();

    // stock_meta 전체 조회 (universe 갱신 시 upsert됨, 보통 50~100건)
    let meta: Record<string, string> = {};
    let domesticCodes: string[] = [];
    try {
      const [rows] = await pool.query<(RowDataPacket & { symbol: string; name: string; market: string })[]>(
        "SELECT symbol, name, market FROM stock_meta",
      );
      for (const r of rows) {
        meta[r.symbol] = r.name;
        if (r.market === 'domestic') domesticCodes.push(r.symbol);
      }
    } catch { /* fall through */ }

    // 국내 후보가 비어있으면 대표 종목으로 폴백
    if (domesticCodes.length === 0) {
      const fallback = ['005930','000660','207940','005380','068270','055550','000270','003670','035420','035720'];
      const tickers = await getKisTickers(fallback);
      domesticCodes = tickers.map(t => t.symbol);
    }

    // 국내 코드 중 이름 누락분 lazy 채움 (KIS search-info 병렬 조회 + stock_meta upsert)
    const missing = domesticCodes.filter(s => !meta[s]);
    if (missing.length > 0) {
      try {
        const token = await getKisToken();
        const fetched = await Promise.allSettled(missing.map(async s => {
          const name = await fetchDomesticName(s, token);
          return { symbol: s, name };
        }));
        for (const r of fetched) {
          if (r.status !== 'fulfilled' || !r.value.name) continue;
          meta[r.value.symbol] = r.value.name;
          try {
            await pool.query<ResultSetHeader>(
              "INSERT INTO stock_meta (symbol, name, market) VALUES (?, ?, 'domestic') " +
              "ON DUPLICATE KEY UPDATE name = VALUES(name)",
              [r.value.symbol, r.value.name],
            );
          } catch { /* swallow */ }
        }
      } catch { /* token 발급 실패 시 메타 보강 skip */ }
    }

    // 해외 정적 universe도 함께 노출 (이름 없으면 티커로)
    const overseasCodes = getStaticOverseasUniverse();
    for (const sym of overseasCodes) {
      if (!meta[sym]) {
        const idx = sym.indexOf(':');
        meta[sym] = idx > 0 ? sym.slice(idx + 1) : sym;
      }
    }

    const allCodes = [...new Set([...domesticCodes, ...overseasCodes])].sort();

    return Response.json({ ok: true, symbols: allCodes, meta });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
