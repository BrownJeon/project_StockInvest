/**
 * KIS 해외주식(미국 NASDAQ/NYSE/AMEX) 어댑터.
 * 심볼은 'NAS:AAPL' 형태로 입력받아 EXCD/SYMB로 분해해서 KIS 호출.
 *
 * 엔드포인트:
 *  - 시세: /uapi/overseas-price/v1/quotations/price
 *  - 일봉: /uapi/overseas-price/v1/quotations/dailyprice
 *  - 분봉: /uapi/overseas-price/v1/quotations/inquire-time-itemchartprice
 *  - 잔고: /uapi/overseas-stock/v1/trading/inquire-balance
 *  - 주문: /uapi/overseas-stock/v1/trading/order
 *  - 취소: /uapi/overseas-stock/v1/trading/order-rvsecncl
 *
 * 주문 통화는 USD. 호출자(safety/dry-run)에서 KRW 환산 한도 검증 수행.
 */
import { getKisToken, invalidateKisToken, kisBaseUrl } from './kis-auth';
import { getCredential } from '@/lib/credentials';
import { parseOverseas, formatOverseas, toOvrsExcgCd, type OverseasExchange } from './kis-symbols';
import { getUsdKrwRate } from './fx';
import type { Ticker, Candle, Balance, OrderRequest, OrderResult, CancelRequest } from './types';

/**
 * 해외 시세 응답은 USD 원본. 룰·prefilter·indicator 계산은 KRW 가격 가정으로 일관 동작하도록
 * **fetch 직후 KRW로 환산**해서 반환한다 (2026-04-28 fix). NFLX 92(원) 같은 1만배 괴리 노이즈 제거.
 *
 * 주문 단가는 USD가 필요하므로 dry-run.ts·createOrder는 별도 환산 로직(이미 amountKRW 분리)으로 처리.
 */
async function fetchUsdKrwRate(): Promise<number> {
  try {
    const r = await getUsdKrwRate();
    return Number.isFinite(r) && r > 0 ? r : 1;
  } catch {
    return 1;  // FX 실패 시 환산 미적용 (변경 전 동작)
  }
}

const isMock = () => String(process.env.KIS_MOCK ?? 'true').toLowerCase() === 'true';
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
/**
 * KIS overseas getTicker — 단발 5xx/429/네트워크 hiccup으로 strategy-eval errors가
 * 5분마다 1~6건씩 누적되는 사례(2026-05-16 분석)를 완화하기 위해 timeout+1회 retry 적용.
 * 비교: getBalances 는 이미 retry 루프가 있으나 getTicker 는 단순 fetch였음.
 *
 * 정책:
 *  - 타임아웃 5s (AbortController). KIS 정상 응답은 <500ms.
 *  - retry는 단 1회. 5xx/429/AbortError/network error 만 재시도, 4xx(인증·심볼) 즉시 throw.
 *  - retry 백오프 300ms — strategy-eval cron 5분 주기 안에서 안전 마진 충분.
 */
export async function getTicker(symbol: string): Promise<Ticker> {
  const { excd, ticker } = parseOverseas(symbol);
  const headers = await kisHeaders('HHDFS00000300');
  const params = new URLSearchParams({ AUTH: '', EXCD: excd, SYMB: ticker });
  const url = `${BASE()}/uapi/overseas-price/v1/quotations/price?${params}`;

  const MAX_ATTEMPTS = 2;
  const TIMEOUT_MS = 5_000;
  let res: Response | undefined;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      res = await fetch(url, { headers, signal: ctrl.signal });
    } catch (e) {
      lastErr = e;
      clearTimeout(timer);
      if (attempt < MAX_ATTEMPTS) {
        await new Promise(r => setTimeout(r, 300));
        continue;
      }
      throw new Error(`KIS overseas getTicker ${symbol}: ${e instanceof Error ? e.message : String(e)}`);
    }
    clearTimeout(timer);
    // 5xx/429만 재시도, 그 외 4xx는 즉시 throw (인증·심볼 에러는 retry로 해결 불가)
    if (res.ok) break;
    if ((res.status >= 500 || res.status === 429) && attempt < MAX_ATTEMPTS) {
      await new Promise(r => setTimeout(r, 300));
      continue;
    }
    throw new Error(`KIS overseas getTicker ${symbol}: ${res.status}`);
  }
  if (!res || !res.ok) {
    throw new Error(`KIS overseas getTicker ${symbol}: retries exhausted ${lastErr ?? ''}`);
  }
  const data = await res.json();
  const o = data.output;
  if (!o) throw new Error(`KIS overseas getTicker no output: ${JSON.stringify(data)}`);
  if (process.env.KIS_OVERSEAS_DEBUG === '1') {
    console.log('[kis-overseas getTicker raw]', symbol, JSON.stringify(o));
  }
  // last/open/high/low/tamt를 KRW로 환산 (가격은 KRW, 거래량 tvol은 주식수 그대로)
  const fx = await fetchUsdKrwRate();
  return {
    symbol,
    price:          Number(o.last) * fx,
    timestamp:      Date.now(),
    open24h:        Number(o.open ?? o.base ?? 0) * fx,
    high24h:        Number(o.high ?? 0) * fx,
    low24h:         Number(o.low ?? 0) * fx,
    volume24h:      Number(o.tvol ?? 0),
    quoteVolume24h: Number(o.tamt ?? 0) * fx,
  };
}

// ── 캔들 조회 ────────────────────────────────────────────────────────────────
export async function getCandles(symbol: string, interval: string, count: number): Promise<Candle[]> {
  if (interval === '1d') return getDailyCandles(symbol, count);
  // 해외 분봉은 오늘 데이터만 — 30m/1h는 일봉 기반 전략 권장. 미지원 간격은 일봉으로 폴백.
  return getDailyCandles(symbol, count);
}

async function getDailyCandles(symbol: string, count: number): Promise<Candle[]> {
  const { excd, ticker } = parseOverseas(symbol);
  const headers = await kisHeaders('HHDFS76240000');
  const params = new URLSearchParams({
    AUTH:  '',
    EXCD:  excd,
    SYMB:  ticker,
    GUBN:  '0',  // 0=일봉 1=주봉 2=월봉
    BYMD:  '',   // 빈값=오늘 기준
    MODP:  '1',  // 1=수정주가
  });
  const url = `${BASE()}/uapi/overseas-price/v1/quotations/dailyprice?${params}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`KIS overseas getDailyCandles ${symbol}: ${res.status}`);
  const data = await res.json();
  if (process.env.KIS_OVERSEAS_DEBUG === '1') {
    console.log('[kis-overseas getDailyCandles raw]', symbol, 'rt_cd=', data.rt_cd,
      'output2[0]=', JSON.stringify(data.output2?.[0]),
      'keys=', Object.keys(data));
  }
  const rows: Record<string, string>[] = data.output2 ?? [];
  // 가격을 KRW로 환산 (volume은 주식수라 환산 불필요). ticker.price와 일관성 유지.
  const fx = await fetchUsdKrwRate();
  return rows
    .filter(r => r.xymd && Number(r.clos) > 0)
    .map(r => ({
      ts:     new Date(`${r.xymd.slice(0,4)}-${r.xymd.slice(4,6)}-${r.xymd.slice(6,8)}T00:00:00Z`).getTime(),
      open:   Number(r.open) * fx,
      high:   Number(r.high) * fx,
      low:    Number(r.low)  * fx,
      close:  Number(r.clos) * fx,
      volume: Number(r.tvol),
    }))
    .sort((a, b) => a.ts - b.ts)
    .slice(-count);
}

// ── 해외 매수가능금액(USD) 조회 — TTTS3007R(실전)/VTTS3007R(모의) ─────────────
async function fetchOverseasUsdCash(): Promise<number> {
  const trId = isMock() ? 'VTTS3007R' : 'TTTS3007R';
  const defaultExcd = (process.env.KIS_OVERSEAS_DEFAULT_EXCHANGE ?? 'NAS') as OverseasExchange;
  const [cano, acntPrdt] = await Promise.all([accountNo(), accountProduct()]);
  const params = new URLSearchParams({
    CANO:         cano,
    ACNT_PRDT_CD: acntPrdt,
    OVRS_EXCG_CD: toOvrsExcgCd(defaultExcd),
    OVRS_ORD_UNPR: '0',
    ITEM_CD:      '',
  });
  const headers = await kisHeaders(trId);
  const res = await fetch(`${BASE()}/uapi/overseas-stock/v1/trading/inquire-psamount?${params}`, { headers });
  if (!res.ok) return 0;
  const data = await res.json();
  if (data.rt_cd !== '0') return 0;
  const o = data.output;
  // ord_psbl_frcr_amt = 주문가능외화금액(USD), frcr_ord_psbl_amt1 = 외화매수가능금액
  const usd = Number(o?.ord_psbl_frcr_amt ?? o?.frcr_ord_psbl_amt1 ?? 0);
  return Number.isFinite(usd) ? usd : 0;
}

// ── 잔고 조회 ────────────────────────────────────────────────────────────────
export async function getBalances(): Promise<Balance[]> {
  // TR ID — 모의: VTTS3012R, 실전: TTTS3012R (해외주식 잔고)
  const trId = isMock() ? 'VTTS3012R' : 'TTTS3012R';
  const defaultExcd = (process.env.KIS_OVERSEAS_DEFAULT_EXCHANGE ?? 'NAS') as OverseasExchange;
  const [cano, acntPrdt] = await Promise.all([accountNo(), accountProduct()]);
  const params = new URLSearchParams({
    CANO:           cano,
    ACNT_PRDT_CD:   acntPrdt,
    OVRS_EXCG_CD:   toOvrsExcgCd(defaultExcd),
    TR_CRCY_CD:     'USD',
    CTX_AREA_FK200: '',
    CTX_AREA_NK200: '',
  });
  let attempt = 0;
  let res: Response;
  let body = '';
  while (true) {
    const headers = await kisHeaders(trId);
    const url = `${BASE()}/uapi/overseas-stock/v1/trading/inquire-balance?${params}`;
    res = await fetch(url, { headers });
    if (res.ok) break;
    body = await res.text().catch(() => '');
    if (attempt === 0 && (body.includes('EGW00123') || body.includes('만료된 token'))) {
      console.warn('[kis-overseas] token expired, re-issuing');
      await invalidateKisToken();
      attempt++;
      continue;
    }
    throw new Error(`KIS overseas getBalances: ${res.status} body=${body.slice(0, 300)}`);
  }
  const data = await res.json();
  if (process.env.KIS_OVERSEAS_DEBUG === '1') {
    console.log('[kis-overseas getBalances raw] rt_cd=', data.rt_cd,
      'msg=', data.msg1,
      'output1[0]=', JSON.stringify(data.output1?.[0] ?? null),
      'output2=', JSON.stringify(data.output2));
  }

  const balances: Balance[] = [];
  // 예수금 (USD) — output2 종합 정보. KIS 해외 잔고 응답은 environment·계좌 종류에 따라
  // 필드명이 일관적이지 않음. 1) summary 탐색 → 2) 매수가능금액 별도 조회 폴백.
  const summary = Array.isArray(data.output2) ? data.output2[0] : data.output2;
  let usdAmount = 0;
  if (summary) {
    const usdRaw =
      summary.frcr_dncl_amt1 ??     // 외화예수금
      summary.frcr_dncl_amt ??       // (변형)
      summary.dnca_tot_amt ??        // 일부 응답에서 USD로 직접
      0;
    usdAmount = Number(usdRaw);
  }
  if (!Number.isFinite(usdAmount) || usdAmount === 0) {
    usdAmount = await fetchOverseasUsdCash().catch(() => 0);
  }
  if (Number.isFinite(usdAmount) && usdAmount > 0) {
    balances.push({ currency: 'USD', free: usdAmount, locked: 0 });
  }
  // 보유 주식 (output1) — pdno = 영문 티커
  // avgPrice(pchs_avg_pric)는 USD 단가이므로 ticker.price와 단위를 맞추기 위해 KRW 환산 필요.
  const balFx = await fetchUsdKrwRate().catch(() => 1);
  for (const item of (data.output1 ?? [])) {
    const qty = Number(item.ovrs_cblc_qty ?? item.hldg_qty ?? 0);
    if (qty <= 0) continue;
    const ticker = String(item.ovrs_pdno ?? item.pdno ?? '').toUpperCase();
    if (!ticker) continue;
    const excd = String(item.ovrs_excg_cd ?? 'NASD');
    const myExcd: OverseasExchange = excd.startsWith('NAS') ? 'NAS' : excd.startsWith('NYS') ? 'NYS' : 'AMS';
    const avgUsd = Number(item.pchs_avg_pric ?? 0);  // USD 단가
    const avgKrw = avgUsd > 0 ? avgUsd * balFx : 0;  // KRW 환산 (ticker.price와 단위 일치)
    balances.push({
      currency: formatOverseas(myExcd, ticker),  // 'NAS:AAPL' 형태로 normalize
      free:     qty,
      locked:   0,
      avgPrice: avgKrw > 0 ? avgKrw : undefined,
    });
  }
  return balances;
}

// ── 주문 ─────────────────────────────────────────────────────────────────────
export async function createOrder(req: OrderRequest): Promise<OrderResult> {
  const { excd, ticker } = parseOverseas(req.symbol);
  const isBuy = req.side === 'buy';
  // TR ID — 매수: TTTT1002U(실전)/VTTT1002U(모의), 매도: TTTT1006U/VTTT1006U
  const trId = isMock()
    ? (isBuy ? 'VTTT1002U' : 'VTTT1006U')
    : (isBuy ? 'TTTT1002U' : 'TTTT1006U');

  const krwPrice = req.price ?? 0;
  const quantity = req.quantity ?? 0;
  if (quantity <= 0) return { ok: false, error: 'quantity 계산 실패 (해외는 USD 가격·수량 필수)' };

  // KIS 해외 주문은 지정가(ORD_DVSN='00')만 지원 — '01'은 장전시간외(오류 유발).
  // 가격은 USD 단가: ticker.price가 KRW로 환산되어 있으므로 FX로 역산.
  const fx = await fetchUsdKrwRate().catch(() => 1400);
  const usdPrice = krwPrice > 0 ? krwPrice / fx : 0;
  // market 주문은 매도 -0.5% / 매수 +0.5% 공격적 호가로 즉시 체결 유도.
  const adjPrice = usdPrice > 0
    ? (req.type === 'market'
        ? (isBuy ? usdPrice * 1.005 : usdPrice * 0.995)
        : usdPrice)
    : 0;
  if (adjPrice <= 0) return { ok: false, error: 'USD 가격 계산 실패 (FX 환산 오류)' };

  const [headers, cano, acntPrdt] = await Promise.all([kisHeaders(trId), accountNo(), accountProduct()]);
  const body = {
    CANO:         cano,
    ACNT_PRDT_CD: acntPrdt,
    OVRS_EXCG_CD: toOvrsExcgCd(excd),
    PDNO:         ticker,
    ORD_QTY:      String(Math.floor(quantity)), // KIS 해외는 정수 수량
    OVRS_ORD_UNPR: adjPrice >= 1 ? adjPrice.toFixed(2) : adjPrice.toFixed(4),
    ORD_SVR_DVSN_CD: '0',
    ORD_DVSN:     '00', // 지정가 고정 (KIS 해외 시장가 미지원)
    CTAC_TLNO:    '',
    MGCO_APTM_ODNO: '',
  };
  const res = await fetch(`${BASE()}/uapi/overseas-stock/v1/trading/order`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, error: `KIS overseas order HTTP ${res.status}` };
  const data = await res.json();
  if (data.rt_cd !== '0') return { ok: false, error: data.msg1 as string };
  return { ok: true, exchangeOrderId: data.output?.ODNO as string, raw: data };
}

export async function cancelOrder(req: CancelRequest): Promise<OrderResult> {
  const trId = isMock() ? 'VTTT1004U' : 'TTTT1004U'; // 해외 주문 정정·취소
  const [headers, cano, acntPrdt] = await Promise.all([kisHeaders(trId), accountNo(), accountProduct()]);
  const body = {
    CANO:         cano,
    ACNT_PRDT_CD: acntPrdt,
    OVRS_EXCG_CD: 'NASD',  // 호출자가 모를 수 있어 기본 NASD. 실 운용 시 req에 excd 추가 권장.
    PDNO:         '',
    ORGN_ODNO:    req.exchangeOrderId,
    RVSE_CNCL_DVSN_CD: '02', // 취소
    ORD_QTY:      '0',
    OVRS_ORD_UNPR: '0',
    CTAC_TLNO:    '',
    MGCO_APTM_ODNO: '',
    ORD_SVR_DVSN_CD: '0',
  };
  const res = await fetch(`${BASE()}/uapi/overseas-stock/v1/trading/order-rvsecncl`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, error: `KIS overseas cancel HTTP ${res.status}` };
  const data = await res.json();
  if (data.rt_cd !== '0') return { ok: false, error: data.msg1 as string };
  return { ok: true, exchangeOrderId: req.exchangeOrderId, raw: data };
}

// 일괄 시세 (universe 분석용)
export async function getKisOverseasTickers(symbols: string[]): Promise<Ticker[]> {
  const results = await Promise.allSettled(symbols.map(s => getTicker(s)));
  return results.flatMap(r => r.status === 'fulfilled' ? [r.value] : []);
}

/**
 * 해외 미체결 주문 조회 — TTTS3018R(실전)/VTTS3018R(모의).
 * order-sync에서 cancel-all 또는 미체결 모니터링에 사용.
 */
export async function getActiveOrders(): Promise<{ orderId: string; symbol: string }[]> {
  const trId = isMock() ? 'VTTS3018R' : 'TTTS3018R';
  const defaultExcd = (process.env.KIS_OVERSEAS_DEFAULT_EXCHANGE ?? 'NAS') as OverseasExchange;
  const [cano, acntPrdt] = await Promise.all([accountNo(), accountProduct()]);
  const params = new URLSearchParams({
    CANO:           cano,
    ACNT_PRDT_CD:   acntPrdt,
    OVRS_EXCG_CD:   toOvrsExcgCd(defaultExcd),
    SORT_SQN:       'DS',
    CTX_AREA_FK200: '',
    CTX_AREA_NK200: '',
  });
  try {
    const headers = await kisHeaders(trId);
    const res = await fetch(`${BASE()}/uapi/overseas-stock/v1/trading/inquire-nccs?${params}`, { headers });
    if (!res.ok) return [];
    const data = await res.json();
    if (data.rt_cd !== '0' || !Array.isArray(data.output)) return [];
    return (data.output as Record<string, string>[])
      .filter(o => Number(o.nccs_qty ?? o.ord_qty ?? 0) > 0)
      .map(o => {
        const ticker = String(o.pdno ?? '').toUpperCase();
        const excdRaw = String(o.ovrs_excg_cd ?? 'NASD');
        const myExcd: OverseasExchange = excdRaw.startsWith('NAS') ? 'NAS' : excdRaw.startsWith('NYS') ? 'NYS' : 'AMS';
        return { orderId: String(o.odno), symbol: formatOverseas(myExcd, ticker) };
      });
  } catch {
    return [];
  }
}

/**
 * 해외 일별 주문체결 조회 — TTTS3035R(실전)/VTTS3035R(모의) inquire-period-trans.
 * order-sync에서 체결된 해외 주문 매칭에 사용.
 *
 * 응답 필드:
 *  - odno: 주문번호
 *  - sll_buy_dvsn_cd: '01'=매도, '02'=매수
 *  - ft_ccld_qty: 외화 체결수량 (전체 체결)
 *  - ft_ccld_unpr3: 외화 체결단가
 *  - dmst_ord_dt: 국내 주문일자, ord_tmd: 주문시각
 *
 * 응답이 USD 단위 단가라 점에 유의 (호출처에서 KRW 변환 필요 시 별도 처리).
 */
export async function getCompletedOrders(
  symbol: string, fromTs: number, toTs: number, _limit: number,
): Promise<{ orderId: string; side: string; price: number; qty: number; ts: number }[]> {
  const trId = isMock() ? 'VTTS3035R' : 'TTTS3035R';
  const { excd, ticker } = parseOverseas(symbol);
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
    CANO:           cano,
    ACNT_PRDT_CD:   acntPrdt,
    OVRS_EXCG_CD:   toOvrsExcgCd(excd),
    PDNO:           ticker,
    ORD_STRT_DT:    fmtDate(fromTs),
    ORD_END_DT:     fmtDate(toTs),
    SLL_BUY_DVSN:   '00',  // 전체
    CCLD_NCCS_DVSN: '01',  // 체결만
    SORT_SQN:       'DS',
    CTX_AREA_FK200: '',
    CTX_AREA_NK200: '',
  });
  let attempt = 0;
  while (true) {
    const headers = await kisHeaders(trId);
    try {
      const url = `${BASE()}/uapi/overseas-stock/v1/trading/inquire-ccnl?${params}`;
      const res = await fetch(url, { headers });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        if (attempt === 0 && (body.includes('EGW00123') || body.includes('만료된 token'))) {
          await invalidateKisToken();
          attempt++;
          continue;
        }
        return [];
      }
      const data = await res.json();
      if (process.env.KIS_OVERSEAS_DEBUG === '1') {
        console.log('[kis-overseas getCompletedOrders raw] rt_cd=', data.rt_cd,
          'symbol=', symbol, 'output[0]=', JSON.stringify(data.output?.[0] ?? null));
      }
      if (data.rt_cd !== '0' || !Array.isArray(data.output)) return [];
      return (data.output as Record<string, string>[])
        .filter(o => Number(o.ft_ccld_qty ?? o.ccld_qty ?? 0) > 0)
        .map(o => {
          const dt = String(o.dmst_ord_dt ?? o.ord_dt ?? '');
          const tm = String(o.ord_tmd ?? '000000').padStart(6, '0');
          let ts = 0;
          if (dt.length === 8) {
            ts = new Date(`${dt.slice(0,4)}-${dt.slice(4,6)}-${dt.slice(6,8)}T${tm.slice(0,2)}:${tm.slice(2,4)}:${tm.slice(4,6)}+09:00`).getTime();
          }
          return {
            orderId: String(o.odno ?? ''),
            side:    o.sll_buy_dvsn_cd === '01' ? 'sell' : 'buy',
            price:   Number(o.ft_ccld_unpr3 ?? o.ccld_unpr ?? o.ord_unpr ?? 0),
            qty:     Number(o.ft_ccld_qty ?? o.ccld_qty ?? 0),
            ts,
          };
        })
        .filter(o => o.orderId);
    } catch (e) {
      console.error('[kis-overseas getCompletedOrders]', e);
      return [];
    }
  }
}
