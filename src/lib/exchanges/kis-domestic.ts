/**
 * KIS 국내주식 어댑터 (KOSPI/KOSDAQ).
 * 기존 kis.ts 본문을 그대로 이동. 호출처는 kis.ts Facade를 거침.
 */
import { getKisToken, invalidateKisToken, kisBaseUrl } from './kis-auth';
import { getCredential } from '@/lib/credentials';
import type { Ticker, Candle, Balance, OrderRequest, OrderResult, CancelRequest } from './types';

const isMock = () => String(process.env.KIS_MOCK ?? 'true').toLowerCase() === 'true';
// 시세·잔고·주문은 환경별 BASE 사용. 단, 시총 랭킹은 실전 도메인만 지원하므로 PROD_BASE 별도.
const BASE = (): string => kisBaseUrl();

async function accountNo()      { return (await getCredential('KIS_ACCOUNT_NO'))      || ''; }
async function accountProduct() { return (await getCredential('KIS_ACCOUNT_PRODUCT')) || '01'; }

async function kisHeaders(trId: string, extra?: Record<string, string>): Promise<Record<string, string>> {
  const [token, appkey, appsecret] = await Promise.all([
    getKisToken(),
    getCredential('KIS_APP_KEY'),
    getCredential('KIS_APP_SECRET'),
  ]);
  return {
    'Content-Type': 'application/json; charset=utf-8',
    Authorization:  `Bearer ${token}`,
    appkey,
    appsecret,
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
  const [cano, acntPrdt] = await Promise.all([accountNo(), accountProduct()]);
  // 토큰 만료(EGW00123) 시 1회 자동 재발급 + 재시도
  while (true) {
    const headers = await kisHeaders(trId);
    const url = `${BASE()}/uapi/domestic-stock/v1/trading/inquire-balance`
      + `?CANO=${cano}&ACNT_PRDT_CD=${acntPrdt}`
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
    // prvs_rcdl_excc_amt(D+2 가수도정산금액) = 결제 완료 후 확정 예수금 → 진짜 사용 가능 cash
    // dnca_tot_amt(예수금총금액)은 매수 체결됐지만 결제 전인 금액도 포함 → free에 부적합
    // 차액(체결 후 결제 대기 중) = locked로 분리
    const total   = Number(summary.dnca_tot_amt ?? 0);
    const settled = Number(summary.prvs_rcdl_excc_amt ?? total);
    const locked  = Math.max(0, total - settled);
    balances.push({ currency: 'KRW', free: Math.max(0, settled), locked });
  }
  for (const item of (data.output1 ?? []) as Record<string, string>[]) {
    const qty = Number(item.hldg_qty ?? 0);
    if (qty <= 0) continue;
    const avg = Number(item.pchs_avg_pric ?? 0);
    balances.push({
      currency: item.pdno,
      free: qty,
      locked: 0,
      avgPrice: avg > 0 ? avg : undefined,
    });
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

  const [headers, cano, acntPrdt] = await Promise.all([
    kisHeaders(trId), accountNo(), accountProduct(),
  ]);
  const body = {
    CANO:         cano,
    ACNT_PRDT_CD: acntPrdt,
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
  const [headers, cano, acntPrdt] = await Promise.all([
    kisHeaders(trId), accountNo(), accountProduct(),
  ]);
  const body = {
    CANO:         cano,
    ACNT_PRDT_CD: acntPrdt,
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

/**
 * 국내 미체결 주문 조회 — TTTC8036R(실전)/VTTC8036R(모의) inquire-psbl-rvsecncl.
 * order-sync에서 active 주문 매칭에 사용.
 *
 * 응답 필드: odno(주문번호), pdno(종목코드), rmn_qty(잔여수량), ord_qty(주문수량).
 * rmn_qty가 0보다 큰 행만 반환 (전부 체결되거나 취소된 건 제외).
 */
export async function getActiveOrders(): Promise<{ orderId: string; symbol: string }[]> {
  const trId = isMock() ? 'VTTC8036R' : 'TTTC8036R';
  const [cano, acntPrdt] = await Promise.all([accountNo(), accountProduct()]);
  const params = new URLSearchParams({
    CANO:           cano,
    ACNT_PRDT_CD:   acntPrdt,
    INQR_DVSN_1:    '0',
    INQR_DVSN_2:    '0',
    CTX_AREA_FK100: '',
    CTX_AREA_NK100: '',
  });
  try {
    const headers = await kisHeaders(trId);
    const url = `${BASE()}/uapi/domestic-stock/v1/trading/inquire-psbl-rvsecncl?${params}`;
    const res = await fetch(url, { headers });
    if (!res.ok) return [];
    const data = await res.json();
    if (process.env.KIS_DOMESTIC_DEBUG === '1') {
      console.log('[kis-domestic getActiveOrders raw] rt_cd=', data.rt_cd,
        'output[0]=', JSON.stringify(data.output?.[0] ?? null));
    }
    if (data.rt_cd !== '0' || !Array.isArray(data.output)) return [];
    return (data.output as Record<string, string>[])
      .filter(o => Number(o.rmn_qty ?? o.ord_qty ?? 0) > 0)
      .map(o => ({
        orderId: String(o.odno),
        symbol:  String(o.pdno ?? ''),
      }))
      .filter(o => o.orderId && o.symbol);
  } catch (e) {
    console.error('[kis-domestic getActiveOrders]', e);
    return [];
  }
}

/**
 * 국내 일별 주문체결 조회 — TTTC8001R(실전)/VTTC8001R(모의) inquire-daily-ccld.
 * order-sync에서 체결된 주문 매칭에 사용.
 *
 * 응답 필드:
 *  - odno: 주문번호 (cancel·정정 시 새 odno 발급되지만 원 odno는 orgn_odno에 보존)
 *  - sll_buy_dvsn_cd: '01'=매도, '02'=매수
 *  - tot_ccld_qty: 총 체결수량
 *  - avg_prvs: 체결 평균가 (없으면 ord_unpr 사용)
 *  - ord_dt: YYYYMMDD, ord_tmd: HHMMSS
 *
 * tot_ccld_qty가 0보다 큰 (실제 체결분이 있는) 행만 반환.
 * KIS는 PDNO 필터를 지원하므로 symbol 인자로 종목별 필터링.
 */
export async function getCompletedOrders(
  symbol: string, fromTs: number, toTs: number, _limit: number,
): Promise<{ orderId: string; side: string; price: number; qty: number; ts: number }[]> {
  const trId = isMock() ? 'VTTC8001R' : 'TTTC8001R';
  const [cano, acntPrdt] = await Promise.all([accountNo(), accountProduct()]);
  const fmtDate = (ts: number): string => {
    const d = new Date(ts);
    const kst = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const y = kst.getFullYear();
    const m = String(kst.getMonth() + 1).padStart(2, '0');
    const day = String(kst.getDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  };
  const params = new URLSearchParams({
    CANO:               cano,
    ACNT_PRDT_CD:       acntPrdt,
    INQR_STRT_DT:       fmtDate(fromTs),
    INQR_END_DT:        fmtDate(toTs),
    SLL_BUY_DVSN_CD:    '00',  // 전체
    INQR_DVSN:          '00',  // 역순
    PDNO:               symbol,
    CCLD_DVSN:          '01',  // 체결만
    ORD_GNO_BRNO:       '',
    ODNO:               '',
    INQR_DVSN_3:        '00',
    INQR_DVSN_1:        '',
    CTX_AREA_FK100:     '',
    CTX_AREA_NK100:     '',
  });
  let attempt = 0;
  while (true) {
    const headers = await kisHeaders(trId);
    try {
      const url = `${BASE()}/uapi/domestic-stock/v1/trading/inquire-daily-ccld?${params}`;
      const res = await fetch(url, { headers });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        if (attempt === 0 && (body.includes('EGW00123') || body.includes('만료된 token'))) {
          console.warn('[kis-domestic getCompletedOrders] token expired, re-issuing');
          await invalidateKisToken();
          attempt++;
          continue;
        }
        return [];
      }
      const data = await res.json();
      if (process.env.KIS_DOMESTIC_DEBUG === '1') {
        console.log('[kis-domestic getCompletedOrders raw] rt_cd=', data.rt_cd,
          'symbol=', symbol, 'output1[0]=', JSON.stringify(data.output1?.[0] ?? null));
      }
      // KIS는 output1(주문체결 목록) + output2(요약) 구조
      const rows: Record<string, string>[] = data.output1 ?? data.output ?? [];
      if (!Array.isArray(rows)) return [];
      return rows
        .filter(o => Number(o.tot_ccld_qty ?? 0) > 0)
        .map(o => {
          const dt = String(o.ord_dt ?? '');
          const tm = String(o.ord_tmd ?? '000000').padStart(6, '0');
          let ts = 0;
          if (dt.length === 8) {
            ts = new Date(`${dt.slice(0,4)}-${dt.slice(4,6)}-${dt.slice(6,8)}T${tm.slice(0,2)}:${tm.slice(2,4)}:${tm.slice(4,6)}+09:00`).getTime();
          }
          return {
            orderId: String(o.odno ?? ''),
            side:    o.sll_buy_dvsn_cd === '01' ? 'sell' : 'buy',
            price:   Number(o.avg_prvs ?? o.ord_unpr ?? 0),
            qty:     Number(o.tot_ccld_qty ?? 0),
            ts,
          };
        })
        .filter(o => o.orderId);
    } catch (e) {
      console.error('[kis-domestic getCompletedOrders]', e);
      return [];
    }
  }
}
