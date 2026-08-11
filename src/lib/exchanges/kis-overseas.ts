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
import { kisFetch, isKisRateLimited, kisBodyText } from './kis-http';
import { mapWithLimit, DEFAULT_FANOUT_CONCURRENCY } from './kis-throttle';
import { parseOverseas, formatOverseas, toOvrsExcgCd, type OverseasExchange } from './kis-symbols';
import { submittedQuantity } from './order-quantity';
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
 *  - 타임아웃 5s. KIS 정상 응답은 <500ms.
 *  - retry는 단 1회. 5xx/429/AbortError/network error 만 재시도, 4xx(인증·심볼) 즉시 throw.
 *  - retry 백오프 300ms — strategy-eval cron 5분 주기 안에서 안전 마진 충분.
 *
 * 🔴 T-017 두 가지 변경:
 *  1. 타임아웃을 `AbortController` 직접 관리에서 `kisFetch({ timeoutMs })` 로 옮겼다.
 *     **스로틀 대기 시간이 타임아웃을 잡아먹지 않게** 하기 위함이다 — 타이머를 대기열에
 *     서기 전에 걸면 "5초 타임아웃"이 "대기+통신 합쳐 5초"가 돼, 스로틀이 만든 대기가
 *     그대로 새로운 실패 모드가 된다. `kisFetch` 는 토큰을 받은 **뒤에** 타이머를 건다.
 *  2. 레이트리밋(EGW00201/EGW00215)은 `res.status >= 500` 재시도 분기를 타지 않는다.
 *     `kisFetch` 가 이미 백오프 재시도를 소진했고, 여기서 또 때리면 증폭이 부활한다.
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
    try {
      res = await kisFetch(url, { headers }, { timeoutMs: TIMEOUT_MS, label: 'overseas getTicker' });
    } catch (e) {
      lastErr = e;
      if (attempt < MAX_ATTEMPTS) {
        await new Promise(r => setTimeout(r, 300));
        continue;
      }
      throw new Error(`KIS overseas getTicker ${symbol}: ${e instanceof Error ? e.message : String(e)}`);
    }
    // 5xx/429만 재시도, 그 외 4xx는 즉시 throw (인증·심볼 에러는 retry로 해결 불가)
    if (res.ok) break;
    if (isKisRateLimited(res)) {
      throw new Error(`KIS overseas getTicker ${symbol}: ${res.status} (레이트리밋 — 백오프 재시도 소진)`);
    }
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
    priceUsd:       Number(o.last),
    timestamp:      Date.now(),
    open24h:        o.open ? Number(o.open) * fx : o.base ? Number(o.base) * fx : undefined,
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
  const res = await kisFetch(url, { headers }, { label: 'overseas getDailyCandles' });
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
  const res = await kisFetch(`${BASE()}/uapi/overseas-stock/v1/trading/inquire-psamount?${params}`, { headers }, { label: 'overseas usdCash' });
  if (!res.ok) return 0;
  const data = await res.json();
  if (data.rt_cd !== '0') return 0;
  const o = data.output;
  // ord_psbl_frcr_amt = 주문가능외화금액(USD), frcr_ord_psbl_amt1 = 외화매수가능금액
  const usd = Number(o?.ord_psbl_frcr_amt ?? o?.frcr_ord_psbl_amt1 ?? 0);
  return Number.isFinite(usd) ? usd : 0;
}

// ── 잔고 조회 ────────────────────────────────────────────────────────────────
async function fetchBalancesForExchange(
  excd: OverseasExchange,
  cano: string,
  acntPrdt: string,
  trId: string,
): Promise<{ usdAmount: number; items: Record<string, string>[] }> {
  const params = new URLSearchParams({
    CANO:           cano,
    ACNT_PRDT_CD:   acntPrdt,
    OVRS_EXCG_CD:   toOvrsExcgCd(excd),
    TR_CRCY_CD:     'USD',
    CTX_AREA_FK200: '',
    CTX_AREA_NK200: '',
  });
  let attempt = 0;
  let res: Response;
  let body = '';
  while (true) {
    const headers = await kisHeaders(trId);
    if (process.env.KIS_OVERSEAS_DEBUG === '1') {
      console.log(`[kis-overseas getBalances(${excd})] attempt=${attempt} token_prefix=${String(headers.Authorization ?? '').slice(7, 19)}`);
    }
    const url = `${BASE()}/uapi/overseas-stock/v1/trading/inquire-balance?${params}`;
    res = await kisFetch(url, { headers }, { label: 'overseas getBalances' });
    if (res.ok) break;
    body = await res.text().catch(() => '');
    if (attempt === 0 && (body.includes('EGW00123') || body.includes('만료된 token'))) {
      await invalidateKisToken();
      attempt++;
      continue;
    }
    throw new Error(`KIS overseas getBalances(${excd}): ${res.status} body=${body.slice(0, 200)}`);
  }
  const data = await res.json();
  if (process.env.KIS_OVERSEAS_DEBUG === '1') {
    const allItems: Record<string, string>[] = data.output1 ?? [];
    console.log(`[kis-overseas getBalances(${excd}) raw] rt_cd=`, data.rt_cd, 'msg=', data.msg1, 'total_items=', allItems.length);
    allItems.forEach((item: Record<string, string>, idx: number) => {
      const { ovrs_pdno, ovrs_cblc_qty, ord_psbl_qty, ovrs_excg_cd, loan_type_cd, prdt_type_cd, cano, acnt_prdt_cd } = item;
      console.log(`  [${excd}][${idx}] cano=${cano}-${acnt_prdt_cd} pdno=${ovrs_pdno} excg=${ovrs_excg_cd} cblc_qty=${ovrs_cblc_qty} ord_psbl_qty=${ord_psbl_qty} loan_type=${loan_type_cd} prdt_type=${prdt_type_cd}`);
    });
  }
  const summary = Array.isArray(data.output2) ? data.output2[0] : data.output2;
  let usdAmount = 0;
  if (summary) {
    const usdRaw = summary.frcr_dncl_amt1 ?? summary.frcr_dncl_amt ?? summary.dnca_tot_amt ?? 0;
    usdAmount = Number(usdRaw);
  }
  return { usdAmount, items: data.output1 ?? [] };
}

/**
 * 해외주식 잔고 조회.
 * TTTS3012R (OVRS_EXCG_CD=NASD) 는 NYSE·AMEX 보유 종목까지 모두 반환한다 (KIS 동작 확인됨).
 * NYSE·AMEX exchange code 로 별도 쿼리를 보내면 KIS 가 "토큰 만료" 오류를 반환하므로
 * NASD 단일 조회로만 전체 해외 보유 포지션을 가져온다.
 */
export async function getBalances(): Promise<Balance[]> {
  const trId = isMock() ? 'VTTS3012R' : 'TTTS3012R';
  const [cano, acntPrdt, balFx] = await Promise.all([
    accountNo(),
    accountProduct(),
    fetchUsdKrwRate().catch(() => 1),
  ]);

  const result = await fetchBalancesForExchange('NAS', cano, acntPrdt, trId);
  const balances: Balance[] = [];

  if (result.usdAmount > 0) {
    balances.push({ currency: 'USD', free: result.usdAmount, locked: 0 });
  } else {
    const fallback = await fetchOverseasUsdCash().catch(() => 0);
    if (fallback > 0) balances.push({ currency: 'USD', free: fallback, locked: 0 });
  }

  for (const item of result.items) {
    const qty = Number(item.ovrs_cblc_qty ?? item.hldg_qty ?? 0);
    if (qty <= 0) continue;
    const ticker = String(item.ovrs_pdno ?? item.pdno ?? '').toUpperCase();
    if (!ticker) continue;
    const excd = String(item.ovrs_excg_cd ?? 'NASD');
    const myExcd: OverseasExchange = excd.startsWith('NAS') ? 'NAS' : excd.startsWith('NYS') ? 'NYS' : 'AMS';
    const avgUsd = Number(item.pchs_avg_pric ?? 0);
    const avgKrw = avgUsd > 0 ? avgUsd * balFx : 0;
    balances.push({
      currency: formatOverseas(myExcd, ticker),
      free:     qty,
      locked:   0,
      avgPrice: avgKrw > 0 ? avgKrw : undefined,
    });
  }

  return balances;
}

// ── 해외주식 호가단위 — $1 기준 ───────────────────────────────────────────────
/** $1 이상: $1 단위, $1 미만(저가주): $0.0001 단위로 반올림 */
function roundToTickOverseas(usdPrice: number): string {
  if (usdPrice >= 1) {
    return String(Math.round(usdPrice));
  }
  const rounded = Math.round(usdPrice * 10000) / 10000;
  return rounded.toFixed(4);
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
    // KIS 해외는 정수 수량. **자르는 규칙은 `submittedQuantity` 하나뿐이다** —
    // `order-sync` 의 완결 판정이 같은 함수를 쓰므로 두 경로가 갈라질 수 없다 (T-018 H-4).
    ORD_QTY:      String(submittedQuantity('overseas', quantity)),
    OVRS_ORD_UNPR: roundToTickOverseas(adjPrice),
    ORD_SVR_DVSN_CD: '0',
    ORD_DVSN:     '00', // 지정가 고정 (KIS 해외 시장가 미지원)
    CTAC_TLNO:    '',
    MGCO_APTM_ODNO: '',
  };
  // 💰 T-017 — 주문 송신은 **무조건 `critical`** (국내 어댑터와 동일 원칙).
  const res = await kisFetch(`${BASE()}/uapi/overseas-stock/v1/trading/order`, {
    method: 'POST', headers, body: JSON.stringify(body),
  }, { priority: 'critical', label: 'overseas createOrder' });
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
  // 💰 T-017 — 주문 취소도 자금 경로다. `critical` 명시.
  const res = await kisFetch(`${BASE()}/uapi/overseas-stock/v1/trading/order-rvsecncl`, {
    method: 'POST', headers, body: JSON.stringify(body),
  }, { priority: 'critical', label: 'overseas cancelOrder' });
  if (!res.ok) return { ok: false, error: `KIS overseas cancel HTTP ${res.status}` };
  const data = await res.json();
  if (data.rt_cd !== '0') return { ok: false, error: data.msg1 as string };
  return { ok: true, exchangeOrderId: req.exchangeOrderId, raw: data };
}

// 일괄 시세 (universe 분석용)
/** T-017 — 동시성 제한. 근거는 `kis-domestic.getKisTickers` 주석 참조. */
export async function getKisOverseasTickers(symbols: string[]): Promise<Ticker[]> {
  const results = await mapWithLimit(symbols, DEFAULT_FANOUT_CONCURRENCY, s => getTicker(s));
  return results.flatMap(r => r.status === 'fulfilled' ? [r.value] : []);
}

/**
 * 이 계좌의 해외 미체결 조회가 **실제로 덮는 거래소**.
 *
 * KIS 의 `inquire-nccs` 는 `OVRS_EXCG_CD` 를 필수로 받으므로 한 번의 호출이 한 거래소만 본다.
 * `getActiveOrders()` 는 `KIS_OVERSEAS_DEFAULT_EXCHANGE`(기본 `NAS`) 하나만 조회한다.
 *
 * ## 🔴 이 목록이 왜 export 되어야 하는가 (T-018)
 *
 * 덮지 못하는 거래소(`NYS`·`AMS`)의 주문은 **성공한 조회 결과에도 원래부터 없다.** 그런데
 * `order-sync` 의 취소 판정은 "미체결 목록에 없다"를 근거로 삼는다. 즉 커버리지 밖 종목
 * (실제 보유 예: `NYS:ORCL`)은 조회가 완벽하게 성공해도 **무조건 `cancelled` 로 오판**된다.
 * 조회 실패를 삼키는 것과 결과가 같은, 같은 계열의 부재 추론 오류다.
 *
 * 그래서 커버리지를 **데이터로 노출**해 소비자가 "이 심볼은 애초에 판정 근거가 없다"를
 * 알 수 있게 한다. 조회 호출 수를 늘리지 않으면서 오판만 제거하는 선택이다
 * (거래소 3곳 팬아웃은 방금 배포한 [[T-017]] 유량 제어와 정면으로 부딪히므로 하지 않는다).
 */
export function activeOrderExchanges(): OverseasExchange[] {
  return [(process.env.KIS_OVERSEAS_DEFAULT_EXCHANGE ?? 'NAS') as OverseasExchange];
}

/**
 * 해외 미체결 주문 조회 — TTTS3018R(실전)/VTTS3018R(모의).
 * order-sync에서 cancel-all 또는 미체결 모니터링에 사용.
 *
 * ## 🔴 실패를 빈 배열로 바꾸지 않는다 (T-018)
 *
 * 예전 코드는 `!res.ok` / `rt_cd !== '0'` / `catch {}` 세 자리에서 실패를 `[]` 로 삼켰고,
 * 특히 catch 는 **로그조차 남기지 않았다**. 이 반환값은 `order-sync` 의 취소 판정 근거이므로
 * 빈 배열은 "살아 있는 주문 전부를 취소로 마킹"으로 직결된다. 지금은 전부 던진다.
 *
 * 커버리지 한계는 {@link activeOrderExchanges} 주석 참조.
 */
export async function getActiveOrders(): Promise<{ orderId: string; symbol: string }[]> {
  const trId = isMock() ? 'VTTS3018R' : 'TTTS3018R';
  const defaultExcd = activeOrderExchanges()[0];
  const [cano, acntPrdt] = await Promise.all([accountNo(), accountProduct()]);
  const params = new URLSearchParams({
    CANO:           cano,
    ACNT_PRDT_CD:   acntPrdt,
    OVRS_EXCG_CD:   toOvrsExcgCd(defaultExcd),
    SORT_SQN:       'DS',
    CTX_AREA_FK200: '',
    CTX_AREA_NK200: '',
  });
  const headers = await kisHeaders(trId);
  const res = await kisFetch(`${BASE()}/uapi/overseas-stock/v1/trading/inquire-nccs?${params}`, { headers }, { label: 'overseas getActiveOrders' });
  if (!res.ok) {
    const body = kisBodyText(res) ?? await res.text().catch(() => '');
    throw new Error(
      `KIS overseas getActiveOrders(${defaultExcd}): ${res.status} body=${body.slice(0, 300)}`
      + (isKisRateLimited(res) ? ' (레이트리밋 — 백오프 재시도 소진)' : ''),
    );
  }
  const data = await res.json();
  if (data.rt_cd !== '0') {
    throw new Error(
      `KIS overseas getActiveOrders(${defaultExcd}): rt_cd=${data.rt_cd} msg_cd=${data.msg_cd ?? '-'} `
      + `msg=${String(data.msg1 ?? '').trim().slice(0, 200)}`,
    );
  }
  const rows = data.output;
  if (rows == null) {
    console.warn('[kis-overseas getActiveOrders] rt_cd=0 인데 output 이 없다 — 미체결 0건으로 간주');
    return [];
  }
  if (!Array.isArray(rows)) {
    throw new Error(`KIS overseas getActiveOrders(${defaultExcd}): output 형식 이상 (${typeof rows}) — 0건과 구분 불가`);
  }
  return (rows as Record<string, string>[])
    .filter(o => Number(o.nccs_qty ?? o.ord_qty ?? 0) > 0)
    .map(o => {
      const ticker = String(o.pdno ?? '').toUpperCase();
      const excdRaw = String(o.ovrs_excg_cd ?? 'NASD');
      const myExcd: OverseasExchange = excdRaw.startsWith('NAS') ? 'NAS' : excdRaw.startsWith('NYS') ? 'NYS' : 'AMS';
      return { orderId: String(o.odno), symbol: formatOverseas(myExcd, ticker) };
    });
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
 *
 * ## 🔴 실패를 빈 배열로 바꾸지 않는다 (T-018)
 *
 * `getActiveOrders` 와 같은 이유. 이쪽은 심볼 하나를 그 심볼의 거래소로 조회하므로
 * 커버리지 문제는 없고, 실패만 전파하면 된다.
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
  for (;;) {
    const headers = await kisHeaders(trId);
    const url = `${BASE()}/uapi/overseas-stock/v1/trading/inquire-ccnl?${params}`;
    const res = await kisFetch(url, { headers }, { label: 'overseas getCompletedOrders' });
    if (!res.ok) {
      const body = kisBodyText(res) ?? await res.text().catch(() => '');
      if (attempt === 0 && (body.includes('EGW00123') || body.includes('만료된 token'))) {
        console.warn('[kis-overseas getCompletedOrders] token expired, re-issuing');
        await invalidateKisToken();
        attempt++;
        continue;
      }
      throw new Error(
        `KIS overseas getCompletedOrders ${symbol}: ${res.status} body=${body.slice(0, 300)}`
        + (isKisRateLimited(res) ? ' (레이트리밋 — 백오프 재시도 소진)' : ''),
      );
    }
    const data = await res.json();
    if (process.env.KIS_OVERSEAS_DEBUG === '1') {
      console.log('[kis-overseas getCompletedOrders raw] rt_cd=', data.rt_cd,
        'symbol=', symbol, 'output[0]=', JSON.stringify(data.output?.[0] ?? null));
    }
    if (data.rt_cd !== '0') {
      throw new Error(
        `KIS overseas getCompletedOrders ${symbol}: rt_cd=${data.rt_cd} msg_cd=${data.msg_cd ?? '-'} `
        + `msg=${String(data.msg1 ?? '').trim().slice(0, 200)}`,
      );
    }
    const rows = data.output;
    if (rows == null) return [];   // rt_cd='0' + 목록 없음 = 체결 0건
    if (!Array.isArray(rows)) {
      throw new Error(`KIS overseas getCompletedOrders ${symbol}: output 형식 이상 (${typeof rows}) — 0건과 구분 불가`);
    }
    return (rows as Record<string, string>[])
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
  }
}
