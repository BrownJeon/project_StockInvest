/**
 * KIS 국내주식 어댑터 (KOSPI/KOSDAQ).
 * 기존 kis.ts 본문을 그대로 이동. 호출처는 kis.ts Facade를 거침.
 */
import { getKisToken, invalidateKisToken, kisBaseUrl } from './kis-auth';
import { getCredential } from '@/lib/credentials';
import { kisFetch, isKisRateLimited, kisBodyText } from './kis-http';
import { mapWithLimit, DEFAULT_FANOUT_CONCURRENCY } from './kis-throttle';
import { submittedQuantity } from './order-quantity';
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
  const url = `${BASE()}/uapi/domestic-stock/v1/quotations/inquire-price?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${symbol}`;
  // KIS API는 개장 직후나 부하 시 일시적 500을 반환하는 경우가 있음 — 최대 2회 재시도
  for (let attempt = 0; attempt < 3; attempt++) {
    const headers = await kisHeaders('FHKST01010100');
    const res = await kisFetch(url, { headers }, { label: 'domestic getTicker' });
    if (res.ok) {
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
    /**
     * 🔴 T-017 — **여기가 재시도 증폭의 진원지였다.**
     *
     * KIS 레이트리밋(`EGW00201`/`EGW00215`)은 **HTTP 500** 으로 온다. 아래 조건은
     * `status === 500` 만 보고 300ms 뒤 재시도했으므로, 레이트리밋을 맞을 때마다 곧바로
     * 한 번 더 때려서 과부하를 스스로 키웠다.
     *
     * 이제 레이트리밋은 `kisFetch` 안에서 이미 백오프 + 재대기열로 소진된 상태다.
     * 여기서 또 재시도하면 그 증폭이 그대로 부활하므로 **즉시 던진다.**
     * 진짜 일시적 5xx(레이트리밋 아님)만 종전대로 재시도한다.
     */
    const rateLimited = isKisRateLimited(res);
    if (rateLimited) {
      throw new Error(`KIS getTicker ${symbol}: ${res.status} (레이트리밋 — 백오프 재시도 소진)`);
    }
    if (res.status !== 500 || attempt === 2) {
      throw new Error(`KIS getTicker ${symbol}: ${res.status}`);
    }
    // 500 일시 오류 — 300ms 대기 후 재시도
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error(`KIS getTicker ${symbol}: unreachable`);
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
  // KIS 분봉 API는 장 시간 외(주말·야간)에 빈 응답이거나 500 — 일봉으로 자동 폴백
  try {
    const minute = await getMinuteCandles(symbol, fid, count);
    if (minute.length > 0) return minute;
  } catch {
    // 장 외 시간 500 등 — 일봉 폴백
  }
  console.log(`[kis-domestic] minute API unavailable for ${symbol} ${interval}, falling back to daily`);
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
  const res = await kisFetch(url, { headers }, { label: 'domestic getDailyCandles' });
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

async function fetchMinutePage(symbol: string, fidPeriod: string, timeStr: string): Promise<Record<string, string>[]> {
  const headers = await kisHeaders('FHKST03010200');
  const url = `${BASE()}/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice`
    + `?FID_ETC_CLS_CODE=&FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${symbol}`
    + `&FID_INPUT_HOUR_1=${timeStr}&FID_PW_DATA_INCU_YN=Y`
    + `&FID_PERIOD_DIV_CODE=${fidPeriod}`;
  const res = await kisFetch(url, { headers }, { label: 'domestic getMinuteCandles' });
  if (!res.ok) throw new Error(`KIS getMinuteCandles ${symbol}: ${res.status}`);
  const data = await res.json();
  return (data.output2 ?? []) as Record<string, string>[];
}

function parseMinuteRow(r: Record<string, string>): Candle {
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
}

/**
 * KIS 분봉 조회 — 한 번에 최대 ~30봉만 반환하므로, count 충족까지 이전 시간으로 페이지네이션.
 * 장 중 유동성 낮은 종목이나 장 시작 직후에도 충분한 봉 수를 확보하기 위해 최대 3회 요청.
 */
async function getMinuteCandles(symbol: string, fidPeriod: string, count: number): Promise<Candle[]> {
  const periodMin = Number(fidPeriod); // 30m → 30
  const allRows: Record<string, string>[] = [];
  const now = new Date();
  let pivot = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));

  for (let attempt = 0; attempt < 3; attempt++) {
    const timeStr = `${String(pivot.getHours()).padStart(2,'0')}${String(pivot.getMinutes()).padStart(2,'0')}${String(pivot.getSeconds()).padStart(2,'0')}`;
    const rows = await fetchMinutePage(symbol, fidPeriod, timeStr);
    const valid = rows.filter(r => r.stck_bsop_date && Number(r.stck_clpr) > 0);
    allRows.push(...valid);

    const parsed = allRows.map(parseMinuteRow).sort((a, b) => a.ts - b.ts);
    const unique = parsed.filter((c, i, arr) => i === 0 || c.ts !== arr[i - 1].ts);
    if (unique.length >= count) return unique.slice(-count);

    // 봉 수 부족 — pivot을 (count × periodMin)분 앞으로 당겨 재요청
    pivot = new Date(pivot.getTime() - count * periodMin * 60 * 1000);
  }

  const parsed = allRows.map(parseMinuteRow).sort((a, b) => a.ts - b.ts);
  const unique = parsed.filter((c, i, arr) => i === 0 || c.ts !== arr[i - 1].ts);
  return unique.slice(-count);
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
    res = await kisFetch(url, { headers }, { label: 'domestic getBalances' });
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
    console.log('[kis-domestic getBalances raw] rt_cd=', data.rt_cd, 'msg=', data.msg1);
    (data.output1 ?? []).forEach((item: Record<string, string>, idx: number) => {
      console.log(`  [domestic][${idx}] pdno=${item.pdno} hldg_qty=${item.hldg_qty} loan_type=${item.loan_type_cd ?? item.bfdy_buy_qty}`);
    });
    console.log('  [domestic summary] cano=', cano, 'acntPrdt=', acntPrdt, 'dnca_tot_amt=', data.output2?.[0]?.dnca_tot_amt);
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

// ── 호가단위 (KOSPI/KOSDAQ 공통, 2024년 기준) ─────────────────────────────────
function tickSize(price: number): number {
  if (price < 2000)    return 1;
  if (price < 5000)    return 5;
  if (price < 20000)   return 10;
  if (price < 50000)   return 50;
  if (price < 200000)  return 100;
  if (price < 500000)  return 500;
  return 1000;
}

/** 지정가 주문 가격을 호가단위에 맞게 반올림 */
function roundToTick(price: number): number {
  const tick = tickSize(price);
  return Math.round(price / tick) * tick;
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
    // 국내는 가공 없이 통과 — 기존 동작 그대로다. `submittedQuantity` 를 경유시키는 이유는
    // "DB 수량 ≠ 송신 수량"을 판정하는 코드가 시장별 규칙을 **다시 유도하지 않게** 하기 위함.
    ORD_QTY:      String(submittedQuantity('domestic', quantity)),
    ORD_UNPR:     req.type === 'market' ? '0' : String(roundToTick(price)),
  };
  // 💰 T-017 — 주문 송신은 **무조건 `critical`**. 주변 실행 컨텍스트가 `bulk` 여도
  //    (예: strategy-eval 틱 안에서 청산 주문이 나가는 경우) 여기서 명시로 덮어쓴다.
  //    150건짜리 universe 스캔 뒤에 실주문이 줄 서는 상황을 구조적으로 불가능하게 만든다.
  const res = await kisFetch(`${BASE()}/uapi/domestic-stock/v1/trading/order-cash`, {
    method: 'POST', headers, body: JSON.stringify(body),
  }, { priority: 'critical', label: 'domestic createOrder' });
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
  // 💰 T-017 — 주문 취소도 자금 경로다. `critical` 명시.
  const res = await kisFetch(`${BASE()}/uapi/domestic-stock/v1/trading/order-rvsecncl`, {
    method: 'POST', headers, body: JSON.stringify(body),
  }, { priority: 'critical', label: 'domestic cancelOrder' });
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
  const res = await kisFetch(url, { headers }, { label: 'domestic marketCapRanking' });
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

/**
 * 일괄 시세. T-017 — `Promise.allSettled(symbols.map(...))` 는 심볼 수만큼(최대 150건)을
 * 한꺼번에 대기열에 밀어 넣어 그 한 번의 호출이 lane 을 독차지했다. 동시성을 제한해
 * 대기열을 얕게 유지한다 (유량 자체는 스로틀이 결정한다).
 */
export async function getKisTickers(symbols: string[]): Promise<Ticker[]> {
  const results = await mapWithLimit(symbols, DEFAULT_FANOUT_CONCURRENCY, s => getTicker(s));
  return results.flatMap(r => r.status === 'fulfilled' ? [r.value] : []);
}

/**
 * 국내 미체결 주문 조회 — TTTC8036R(실전)/VTTC8036R(모의) inquire-psbl-rvsecncl.
 * order-sync에서 active 주문 매칭에 사용.
 *
 * 응답 필드: odno(주문번호), pdno(종목코드), rmn_qty(잔여수량), ord_qty(주문수량).
 * rmn_qty가 0보다 큰 행만 반환 (전부 체결되거나 취소된 건 제외).
 *
 * ## 🔴 실패를 빈 배열로 바꾸지 않는다 (T-018)
 *
 * 이 함수의 반환값은 `order-sync` 에서 **"미체결 목록에 없다 → 취소된 주문이다"** 라는
 * 부재 추론의 근거로 쓰인다. 따라서 조회 실패를 `[]` 로 퇴화시키면 그 추론이
 * **살아 있는 지정가 주문 전부를 `cancelled` 로 마킹**한다. 예전 코드는 세 자리에서
 * 이걸 삼켰다 — `!res.ok`(레이트리밋 HTTP 500 이 여기 떨어진다), `rt_cd !== '0'`,
 * 그리고 catch. 지금은 셋 다 던진다.
 *
 * `rt_cd !== '0'` 은 HTTP 200 이어도 **API 레벨 에러**다. "주문 0건"과 같은 값으로
 * 뭉개면 안 된다 ([[T-012]]·[[T-014]] 와 같은 결함 유형).
 *
 * ## 🔴 연속조회(페이지네이션) 처리 (T-023)
 *
 * KIS는 한 응답에 담기는 행 수에 한도가 있고, 더 있으면 응답 헤더 `tr_cont` 가 `M`/`F`
 * (계속 있음)로 오며 body의 `ctx_area_fk100`/`ctx_area_nk100`(다음 페이지 조회 키)가
 * 채워져 온다. 예전 코드는 첫 페이지만 읽고 멈췄다 — 미체결 주문이 한 페이지를 넘기면
 * 뒤쪽 페이지의 주문은 이 함수 결과에 아예 없어, order-sync 가 "조회 성공, 목록에 없음"
 * 으로 읽고 **살아 있는 주문을 cancelled 로 오기록**할 수 있었다(T-018 과 같은 실패
 * 유형 — 이번엔 원인이 볼륨). 다음 요청은 `tr_cont: 'N'` 헤더와 함께 이전 응답의
 * ctx_area_fk100/nk100 을 그대로 되돌려 보낸다. `MAX_PAGES` 는 무한루프 방지용 — 실계좌
 * 에서 도달할 상황이 아니지만, 도달했는데 `tr_cont` 가 여전히 계속(M/F)을 가리키면 결과가
 * **불완전하다는 걸 아는 채로** 던진다(T-023 Reviewer HIGH-1) — 이걸 조용히 truncate 해
 * 성공으로 반환하면 이 함수 상단의 "실패를 빈 배열로 바꾸지 않는다" 원칙을 어기고, 21페이지
 * 이후에 있었을 주문이 order-sync 에서 cancelled 로 오기록될 수 있다.
 */
const MAX_ACTIVE_ORDERS_PAGES = 20;

export async function getActiveOrders(): Promise<{ orderId: string; symbol: string }[]> {
  const trId = isMock() ? 'VTTC8036R' : 'TTTC8036R';
  const [cano, acntPrdt] = await Promise.all([accountNo(), accountProduct()]);

  const allRows: Record<string, string>[] = [];
  let fk100 = '';
  let nk100 = '';
  let trCont = '';

  for (let page = 0; page < MAX_ACTIVE_ORDERS_PAGES; page++) {
    const params = new URLSearchParams({
      CANO:           cano,
      ACNT_PRDT_CD:   acntPrdt,
      INQR_DVSN_1:    '0',
      INQR_DVSN_2:    '0',
      CTX_AREA_FK100: fk100,
      CTX_AREA_NK100: nk100,
    });
    const headers = await kisHeaders(trId, { tr_cont: trCont });
    const url = `${BASE()}/uapi/domestic-stock/v1/trading/inquire-psbl-rvsecncl?${params}`;
    const res = await kisFetch(url, { headers }, { label: 'domestic getActiveOrders' });
    if (!res.ok) {
      const body = kisBodyText(res) ?? await res.text().catch(() => '');
      throw new Error(
        `KIS getActiveOrders: ${res.status} body=${body.slice(0, 300)}`
        + (isKisRateLimited(res) ? ' (레이트리밋 — 백오프 재시도 소진)' : ''),
      );
    }
    const data = await res.json();
    if (process.env.KIS_DOMESTIC_DEBUG === '1') {
      console.log('[kis-domestic getActiveOrders raw] page=', page, 'rt_cd=', data.rt_cd,
        'output[0]=', JSON.stringify(data.output?.[0] ?? null));
    }
    if (data.rt_cd !== '0') {
      throw new Error(
        `KIS getActiveOrders: rt_cd=${data.rt_cd} msg_cd=${data.msg_cd ?? '-'} `
        + `msg=${String(data.msg1 ?? '').trim().slice(0, 200)}`,
      );
    }
    const rows = data.output;
    // rt_cd='0' 은 API 가 명시적으로 "성공"이라고 말한 것이다. 그 상태에서 배열이 아예 없는 것은
    // KIS 가 빈 결과를 그렇게 표현하는 경우가 있어 **이 페이지 0건으로 읽는다** (경고는 남긴다).
    if (rows == null) {
      console.warn(`[kis-domestic getActiveOrders] page=${page} rt_cd=0 인데 output 이 없다 — 이 페이지 0건으로 간주`);
    } else if (!Array.isArray(rows)) {
      // "있는데 배열이 아니다"는 해석 불가능한 형태다. 0건과 구분이 안 되므로 던진다.
      throw new Error(`KIS getActiveOrders: output 형식 이상 (${typeof rows}) — 0건과 구분할 수 없어 실패로 처리`);
    } else {
      allRows.push(...(rows as Record<string, string>[]));
    }

    const respTrCont = res.headers.get('tr_cont') ?? '';
    if (respTrCont !== 'M' && respTrCont !== 'F') break; // 마지막 페이지

    if (page === MAX_ACTIVE_ORDERS_PAGES - 1) {
      throw new Error(
        `KIS getActiveOrders: 페이지 상한(${MAX_ACTIVE_ORDERS_PAGES})에 도달했는데 `
        + `tr_cont=${respTrCont}(계속) — ${allRows.length}건만 모은 채 불완전하여 실패로 처리`,
      );
    }
    fk100 = String(data.ctx_area_fk100 ?? '');
    nk100 = String(data.ctx_area_nk100 ?? '');
    trCont = 'N';
  }

  return allRows
    .filter(o => Number(o.rmn_qty ?? o.ord_qty ?? 0) > 0)
    .map(o => ({
      orderId: String(o.odno),
      symbol:  String(o.pdno ?? ''),
    }))
    .filter(o => o.orderId && o.symbol);
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
 *
 * ## 🔴 실패를 빈 배열로 바꾸지 않는다 (T-018)
 *
 * `getActiveOrders` 와 같은 이유다 — `order-sync` 는 "체결 목록에도 없다"를 취소 판정의
 * 나머지 절반으로 쓴다. 조회 실패가 `[]` 가 되면 그 절반이 무너진다.
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
  for (;;) {
    const headers = await kisHeaders(trId);
    const url = `${BASE()}/uapi/domestic-stock/v1/trading/inquire-daily-ccld?${params}`;
    const res = await kisFetch(url, { headers }, { label: 'domestic getCompletedOrders' });
    if (!res.ok) {
      const body = kisBodyText(res) ?? await res.text().catch(() => '');
      if (attempt === 0 && (body.includes('EGW00123') || body.includes('만료된 token'))) {
        console.warn('[kis-domestic getCompletedOrders] token expired, re-issuing');
        await invalidateKisToken();
        attempt++;
        continue;
      }
      throw new Error(
        `KIS getCompletedOrders ${symbol}: ${res.status} body=${body.slice(0, 300)}`
        + (isKisRateLimited(res) ? ' (레이트리밋 — 백오프 재시도 소진)' : ''),
      );
    }
    const data = await res.json();
    if (process.env.KIS_DOMESTIC_DEBUG === '1') {
      console.log('[kis-domestic getCompletedOrders raw] rt_cd=', data.rt_cd,
        'symbol=', symbol, 'output1[0]=', JSON.stringify(data.output1?.[0] ?? null));
    }
    // HTTP 200 이어도 rt_cd 가 '0' 이 아니면 API 레벨 에러다 — "체결 0건"과 뭉개지 않는다.
    if (data.rt_cd !== '0') {
      throw new Error(
        `KIS getCompletedOrders ${symbol}: rt_cd=${data.rt_cd} msg_cd=${data.msg_cd ?? '-'} `
        + `msg=${String(data.msg1 ?? '').trim().slice(0, 200)}`,
      );
    }
    // KIS는 output1(주문체결 목록) + output2(요약) 구조
    const rows = data.output1 ?? data.output;
    if (rows == null) return [];   // rt_cd='0' + 목록 없음 = 체결 0건
    if (!Array.isArray(rows)) {
      throw new Error(`KIS getCompletedOrders ${symbol}: output 형식 이상 (${typeof rows}) — 0건과 구분 불가`);
    }
    return (rows as Record<string, string>[])
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
  }
}
