/**
 * KIS 국내주식 어댑터 (KOSPI/KOSDAQ).
 * 기존 kis.ts 본문을 그대로 이동. 호출처는 kis.ts Facade를 거침.
 */
import { getKisToken, invalidateKisToken, kisBaseUrl } from './kis-auth';
import type { Ticker, Candle, Balance, OrderRequest, OrderResult, CancelRequest } from './types';

const isMock = () => String(process.env.KIS_MOCK ?? 'true').toLowerCase() === 'true';
// 시세·잔고·주문은 환경별 BASE 사용. 단, 시총 랭킹은 실전 도메인만 지원하므로 PROD_BASE 별도.
const BASE = (): string => kisBaseUrl();

function accountNo()      { return process.env.KIS_ACCOUNT_NO      ?? ''; }
function accountProduct() { return process.env.KIS_ACCOUNT_PRODUCT ?? '01'; }

async function kisHeaders(trId: string, extra?: Record<string, string>): Promise<Record<string, string>> {
  const token = await getKisToken();
  return {
    'Content-Type': 'application/json; charset=utf-8',
    Authorization:  `Bearer ${token}`,
    appkey:          process.env.KIS_APP_KEY    ?? '',
    appsecret:       process.env.KIS_APP_SECRET ?? '',
    tr_id:           trId,
    custtype:        'P',
    ...extra,
  };
}

// ── 시세 조회 ────────────────────────────────────────────────────────────────
export async function getTicker(symbol: string): Promise<Ticker> {
  const headers = await kisHeaders('FHKST01010100');
  const url = `${BASE()}/uapi/domestic-stock/v1/quotations/inquire-price?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${symbol}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`KIS getTicker ${symbol}: ${res.status}`);
  const data = await res.json();
  const o = data.output;
  if (!o) throw new Error(`KIS getTicker no output: ${JSON.stringify(data)}`);
  return {
    symbol,
    price:        Number(o.stck_prpr),
    timestamp:    Date.now(),
    open24h:      Number(o.stck_oprc),
    high24h:      Number(o.stck_hgpr),
    low24h:       Number(o.stck_lwpr),
    volume24h:    Number(o.acml_vol),
    quoteVolume24h: Number(o.acml_tr_pbmn),
  };
}

// ── 캔들 조회 ────────────────────────────────────────────────────────────────
const MINUTE_MAP: Record<string, string> = {
  '1m': '1', '3m': '3', '5m': '5', '10m': '10',
  '15m': '15', '30m': '30', '1h': '60',
};

export async function getCandles(symbol: string, interval: string, count: number): Promise<Candle[]> {
  if (interval === '1d') {
    return getDailyCandles(symbol, count);
  }
  const fid = MINUTE_MAP[interval];
  if (!fid) throw new Error(`KIS unsupported interval: ${interval}`);
  // KIS 분봉 API는 장 시간 외에는 빈 응답 (주말·야간) — 일봉으로 자동 폴백해 차트 끊김 방지
  const minute = await getMinuteCandles(symbol, fid, count);
  if (minute.length > 0) return minute;
  console.log(`[kis-domestic] minute API empty for ${symbol} ${interval}, falling back to daily`);
  return getDailyCandles(symbol, count);
}

async function getDailyCandles(symbol: string, count: number): Promise<Candle[]> {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const fromDate = new Date(Date.now() - count * 2 * 86400000).toISOString().slice(0, 10).replace(/-/g, '');
  const headers = await kisHeaders('FHKST03010100');
  const url = `${BASE()}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice`
    + `?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${symbol}`
    + `&FID_INPUT_DATE_1=${fromDate}&FID_INPUT_DATE_2=${today}`
    + `&FID_PERIOD_DIV_CODE=D&FID_ORG_ADJ_PRC=0`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`KIS getDailyCandles ${symbol}: ${res.status}`);
  const data = await res.json();
  const rows: Record<string, string>[] = data.output2 ?? [];
  return rows
    .filter(r => r.stck_bsop_date && Number(r.stck_clpr) > 0)
    .map(r => ({
      ts:     new Date(`${r.stck_bsop_date.slice(0,4)}-${r.stck_bsop_date.slice(4,6)}-${r.stck_bsop_date.slice(6,8)}`).getTime(),
      open:   Number(r.stck_oprc),
      high:   Number(r.stck_hgpr),
      low:    Number(r.stck_lwpr),
      close:  Number(r.stck_clpr),
      volume: Number(r.acml_vol),
    }))
    .sort((a, b) => a.ts - b.ts)
    .slice(-count);
}

async function getMinuteCandles(symbol: string, fidPeriod: string, count: number): Promise<Candle[]> {
  const now = new Date();
  const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const timeStr = `${String(kst.getHours()).padStart(2,'0')}${String(kst.getMinutes()).padStart(2,'0')}${String(kst.getSeconds()).padStart(2,'0')}`;
  const headers = await kisHeaders('FHKST03010200');
  const url = `${BASE()}/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice`
    + `?FID_ETC_CLS_CODE=&FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${symbol}`
    + `&FID_INPUT_HOUR_1=${timeStr}&FID_PW_DATA_INCU_YN=Y`
    + `&FID_PERIOD_DIV_CODE=${fidPeriod}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`KIS getMinuteCandles ${symbol}: ${res.status}`);
  const data = await res.json();
  const rows: Record<string, string>[] = data.output2 ?? [];
  return rows
    .filter(r => r.stck_bsop_date && Number(r.stck_clpr) > 0)
    .map(r => {
      const d = r.stck_bsop_date;
      const t = r.stck_cntg_hour ?? '000000';
      return {
        ts:     new Date(`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}T${t.slice(0,2)}:${t.slice(2,4)}:${t.slice(4,6)}+09:00`).getTime(),
        open:   Number(r.stck_oprc),
        high:   Number(r.stck_hgpr),
        low:    Number(r.stck_lwpr),
        close:  Number(r.stck_clpr),
        volume: Number(r.cntg_vol),
      };
    })
    .sort((a, b) => a.ts - b.ts)
    .slice(-count);
}

// ── 잔고 조회 ────────────────────────────────────────────────────────────────
export async function getBalances(): Promise<Balance[]> {
  const trId = isMock() ? 'VTTC8434R' : 'TTTC8434R';
  let attempt = 0;
  let res: Response;
  let body = '';
  // 토큰 만료(EGW00123) 시 1회 자동 재발급 + 재시도
  while (true) {
    const headers = await kisHeaders(trId);
    const url = `${BASE()}/uapi/domestic-stock/v1/trading/inquire-balance`
      + `?CANO=${accountNo()}&ACNT_PRDT_CD=${accountProduct()}`
      + `&AFHR_FLPR_YN=N&OFL_YN=&INQR_DVSN=02&UNPR_DVSN=01&FUND_STTL_ICLD_YN=N`
      + `&FNCG_AMT_AUTO_RDPT_YN=N&PRCS_DVSN=01&CTX_AREA_FK100=&CTX_AREA_NK100=`;
    res = await fetch(url, { headers });
    if (res.ok) break;
    body = await res.text().catch(() => '');
    if (attempt === 0 && (body.includes('EGW00123') || body.includes('만료된 token'))) {
      console.warn('[kis-domestic] token expired, re-issuing');
      await invalidateKisToken();
      attempt++;
      continue;
    }
    throw new Error(`KIS getBalances: ${res.status} body=${body.slice(0, 300)}`);
  }
  const data = await res.json();
  if (process.env.KIS_OVERSEAS_DEBUG === '1') {
    console.log('[kis-domestic getBalances raw] rt_cd=', data.rt_cd,
      'msg=', data.msg1,
      'output1[0]=', JSON.stringify(data.output1?.[0] ?? null),
      'output2[0]=', JSON.stringify(data.output2?.[0] ?? null));
  }

  const balances: Balance[] = [];
  const summary = data.output2?.[0];
  if (summary) {
    balances.push({ currency: 'KRW', free: Number(summary.dnca_tot_amt ?? 0), locked: 0 });
  }
  for (const item of (data.output1 ?? [])) {
    const qty = Number(item.hldg_qty ?? 0);
    if (qty <= 0) continue;
    balances.push({ currency: item.pdno as string, free: qty, locked: 0 });
  }
  return balances;
}

// ── 주문 ─────────────────────────────────────────────────────────────────────
export async function createOrder(req: OrderRequest): Promise<OrderResult> {
  const isBuy  = req.side === 'buy';
  const trId   = isMock()
    ? (isBuy ? 'VTTC0802U' : 'VTTC0801U')
    : (isBuy ? 'TTTC0802U' : 'TTTC0801U');

  const price    = req.price ?? 0;
  const quantity = req.quantity ?? (price > 0 && req.amountKRW ? Math.floor(req.amountKRW / price) : 0);
  if (quantity <= 0) return { ok: false, error: 'quantity 계산 실패' };

  const headers = await kisHeaders(trId);
  const body = {
    CANO:         accountNo(),
    ACNT_PRDT_CD: accountProduct(),
    PDNO:         req.symbol,
    ORD_DVSN:     req.type === 'market' ? '01' : '00',
    ORD_QTY:      String(quantity),
    ORD_UNPR:     req.type === 'market' ? '0' : String(Math.round(price)),
  };
  const res = await fetch(`${BASE()}/uapi/domestic-stock/v1/trading/order-cash`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, error: `KIS order HTTP ${res.status}` };
  const data = await res.json();
  if (data.rt_cd !== '0') return { ok: false, error: data.msg1 as string };
  return { ok: true, exchangeOrderId: data.output?.ODNO as string, raw: data };
}

export async function cancelOrder(req: CancelRequest): Promise<OrderResult> {
  const trId = isMock() ? 'VTTC0803U' : 'TTTC0803U';
  const headers = await kisHeaders(trId);
  const body = {
    CANO:         accountNo(),
    ACNT_PRDT_CD: accountProduct(),
    KRX_FWDG_ORD_ORGNO: '',
    ORGN_ODNO:    req.exchangeOrderId,
    ORD_DVSN:     '00',
    RVSE_CNCL_DVSN_CD: '02',
    ORD_QTY:      '0',
    ORD_UNPR:     '0',
    QTY_ALL_ORD_YN: 'Y',
  };
  const res = await fetch(`${BASE()}/uapi/domestic-stock/v1/trading/order-rvsecncl`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, error: `KIS cancel HTTP ${res.status}` };
  const data = await res.json();
  if (data.rt_cd !== '0') return { ok: false, error: data.msg1 as string };
  return { ok: true, exchangeOrderId: req.exchangeOrderId, raw: data };
}

// ── 시가총액 랭킹 (KOSPI + KOSDAQ) ────────────────────────────────────────────
const PROD_BASE = 'https://openapi.koreainvestment.com:9443';

function isExcluded(symbol: string, name: string, volume: number): boolean {
  if (volume === 0) return true;
  if (symbol[4] === '5') return true;       // 우선주
  if (name.includes('ETN')) return true;
  if (name.includes('스팩') || /spac/i.test(name)) return true;
  if (name.includes('리츠')) return true;
  return false;
}

async function fetchMarketCapPage(market: 'J' | 'Q', inputIscd: string): Promise<Array<{
  symbol: string; name: string; marketCap: number; quoteVolume: number; volume: number;
}>> {
  const headers = await kisHeaders('FHPST01740000');
  const params = new URLSearchParams({
    FID_COND_MRKT_DIV_CODE:  market,
    FID_COND_SCR_DIV_CODE:   '20174',
    FID_INPUT_ISCD:          inputIscd,
    FID_DIV_CLS_CODE:        '0',
    FID_BLNG_CLS_CODE:       '0',
    FID_TRGT_CLS_CODE:       '111111111',
    FID_TRGT_EXLS_CLS_CODE:  '0000000000',
  });
  const url = `${PROD_BASE}/uapi/domestic-stock/v1/ranking/market-cap?${params}`;
  const res = await fetch(url, { headers });
  if (!res.ok) return [];
  const data = await res.json();
  if (data.rt_cd !== '0' || !Array.isArray(data.output)) return [];
  return (data.output as Record<string, string>[]).map(o => ({
    symbol:      o.mksc_shrn_iscd,
    name:        o.hts_kor_isnm,
    marketCap:   Number(o.stck_avls) * 1e8,
    quoteVolume: Number(o.acml_tr_pbmn),
    volume:      Number(o.acml_vol),
  }));
}

export async function fetchMarketCapRanking(limit = 50): Promise<Array<{
  symbol: string; name: string; marketCap: number; quoteVolume: number; volume: number;
}>> {
  const [kospi, kosdaq] = await Promise.all([
    fetchMarketCapPage('J', '0001'),
    fetchMarketCapPage('Q', '1001'),
  ]);
  return [...kospi, ...kosdaq]
    .filter(r => !isExcluded(r.symbol, r.name, r.volume))
    .sort((a, b) => b.marketCap - a.marketCap)
    .slice(0, limit);
}

export async function getKisTickers(symbols: string[]): Promise<Ticker[]> {
  const results = await Promise.allSettled(symbols.map(s => getTicker(s)));
  return results.flatMap(r => r.status === 'fulfilled' ? [r.value] : []);
}

export async function getActiveOrders(): Promise<{ orderId: string; symbol: string }[]> {
  return [];
}
export async function getCompletedOrders(
  _symbol: string, _from: number, _to: number, _limit: number,
): Promise<{ orderId: string; side: string; price: number; qty: number; ts: number }[]> {
  return [];
}
