/**
 * KIS 국내주식 어댑터 (KOSPI/KOSDAQ).
 * 기존 kis.ts 본문을 그대로 이동. 호출처는 kis.ts Facade를 거침.
 */
import { getKisToken, invalidateKisToken, kisBaseUrl } from './kis-auth';
import { getCredential } from '@/lib/credentials';
import { kisFetch, isKisRateLimited, kisBodyText, isKisTokenError } from './kis-http';
import { mapWithLimit, DEFAULT_FANOUT_CONCURRENCY } from './kis-throttle';
import { submittedQuantity, unusableQuantityReason } from './order-quantity';
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
/**
 * 🔴 T-017 — **여기가 재시도 증폭의 진원지였다.**
 *
 * KIS 레이트리밋(`EGW00201`/`EGW00215`)은 **HTTP 500** 으로 온다. 예전 코드는 `status === 500` 만
 * 보고 300ms 뒤 재시도했으므로, 레이트리밋을 맞을 때마다 곧바로 한 번 더 때려서 과부하를 스스로
 * 키웠다. 이제 레이트리밋은 `kisFetch` 안에서 백오프 + 재대기열로 소진되므로 **즉시 던진다.**
 *
 * 🔴 T-133 — 진짜 일시 오류의 재시도도 `kisFetch`(`transientRetries`)로 옮겼다. 손으로 만든 루프를
 * 남긴 채 옵션만 켜면 바깥 루프 × 안쪽 루프로 호출이 곱해져 위 증폭이 그대로 부활하므로, 응답 기반
 * 루프를 걷어내고 게이트웨이 한 곳에서만 센다. 달라진 것은 ① HTTP 200 업무실패(`rt_cd≠'0'`, 예:
 * `OPSQ1002 SESSION FULL`)도 재시도 대상이 된다 ② 백오프가 300ms 고정에서 게이트웨이 0.4s·1.2s 로
 * 바뀐다.
 *
 * **호출 상한(레이트리밋까지 센 값)** — `kisFetch` 한 번은 최악 5회다(최초 1 + 일시 2 + 레이트리밋 2).
 * 아래 토큰 재발급 루프가 최대 1회 더 돌 수 있어 이 함수의 최악은 **10회**다. 종전(3회 루프 ×
 * `kisFetch` 3회)의 최악은 **9회**였다 — 즉 상한은 거의 그대로고, 예전 "총 3회" 라는 설명은
 * 레이트리밋 예산을 빼고 센 값이라 틀렸다(T-133 Reviewer L-2).
 *
 * 토큰 만료(`EGW00123`)는 `isTransientKisFailure` 가 제외하므로 게이트웨이가 재시도하지 않는다 —
 * **어댑터가 처리하는 것이 설계다.** 종전 루프는 매 시도 `kisHeaders` 를 다시 불러 **다른 프로세스가
 * 회전시켜 둔 토큰을 주워 왔다**(T-133 Reviewer L-1 이 실증). 응답 루프를 걷어내면 그 복구가 사라지므로
 * 아래에 1회짜리 토큰 루프를 둔다.
 *
 * 🔴 그 루프는 **재발급을 먼저 하지 않는다**(T-133 Reviewer M-2). `getBalances` 처럼 곧바로
 * `invalidateKisToken()` 을 부르면, DB 에 이미 있는 **멀쩡한 새 토큰을 지우고** 재발급을 요청한다.
 * 직전 발급이 1분 안이면 KIS 가 `EGW00133` 으로 거부하고 `issueAndStore` 가 60초를 기다리므로,
 * 그 사이 같은 프로세스의 **모든** `getKisToken()` 호출이 막힌다 — `createOrder` 도 그 경로다.
 * 그래서 먼저 `getKisToken()` 으로 **DB 를 다시 읽고**(이 함수는 호출마다 DB 를 본다),
 * 값이 **이번 요청 헤더에 실린 토큰과 같을 때만** 재발급한다.
 */
export async function getTicker(symbol: string): Promise<Ticker> {
  const url = `${BASE()}/uapi/domestic-stock/v1/quotations/inquire-price?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${symbol}`;
  let res: Response;
  let tokenRetried = false;
  for (;;) {
    const headers = await kisHeaders('FHKST01010100');
    // 이번 요청이 **어떤 토큰으로** 나갔는지 — 아래 만료 분기의 비교 대상이다. `getKisToken()` 을
    // 한 번 더 부르지 않고 헤더에서 읽는다(T-133 Reviewer L-7): 건강한 경로의 DB SELECT 가 2배가
    // 되는 것도 막고, 두 번 읽는 사이에 토큰이 회전하는 경쟁도 아예 없앤다.
    const usedAuth = headers.Authorization;
    res = await kisFetch(url, { headers }, { label: 'domestic getTicker', transientRetries: 2 });
    if (res.ok) break;
    if (isKisRateLimited(res)) {
      throw new Error(`KIS getTicker ${symbol}: ${res.status} (레이트리밋 — 백오프 재시도 소진)`);
    }
    const body = await res.text().catch(() => '');
    // (T-133 QA #2) 토큰 판정은 게이트웨이와 **같은 출처**를 쓴다 — `EGW00121` 도 포함된다.
    // 손으로 `EGW00123` 만 적으면 게이트웨이는 재시도를 건너뛰는데 여기서는 재발급도 안 하는
    // 사각지대가 생긴다(종전 코드는 500 이면 무조건 재시도해 그 경우를 우연히 덮고 있었다).
    if (!tokenRetried && isKisTokenError(body)) {
      tokenRetried = true;
      const fresh = await getKisToken();   // DB 재읽기 — 캐시를 **지우지 않는다**
      if (`Bearer ${fresh}` !== usedAuth) {
        // 다른 프로세스가 이미 회전시켜 뒀다. 재발급 없이 그 토큰으로 한 번 더 간다.
        console.warn('[kis-domestic getTicker] token rotated elsewhere — 재읽기로 재시도');
        continue;
      }
      // DB 토큰도 방금 쓴 것과 같다 — 그때만 재발급한다(60초 대기 위험을 여기로 좁힌다).
      console.warn('[kis-domestic getTicker] token expired, re-issuing');
      await invalidateKisToken();
      continue;
    }
    throw new Error(`KIS getTicker ${symbol}: ${res.status}`);
  }
  const data = await res.json();
  /**
   * (T-133) HTTP 200 인데 업무 실패(`rt_cd≠'0'`) — 2026-10-31 KIS 장애에서 실제로 온 모양이
   * `rt_cd:"9" OPSQ1002 SESSION FULL` 이다. 예전에는 `output` 이 없어 아래 `no output` 으로 던졌는데,
   * 본문 JSON 을 통째로 싣는 메시지라 로그에서 원인을 가를 수 없었다. 여기 도달했다는 것은 위
   * `transientRetries` 를 **이미 소진했다**는 뜻이다.
   */
  // (T-133 QA #3) `String()` 으로 정규화한다 — 숫자 `0` 을 업무실패로 오판하지 않기 위해서다.
  // 종전 코드는 `rt_cd` 를 보지 않아 숫자 0 을 그대로 통과시켰다. KIS 는 문자열을 쓰는 것으로
  // 보이지만(실측 근거는 T-132 관찰뿐) 회귀를 만들 이유가 없다. 숫자 9 는 그대로 실패다.
  if (data?.rt_cd != null && String(data.rt_cd) !== '0') {
    throw new Error(
      `KIS getTicker ${symbol}: 200 업무실패 rt_cd=${data.rt_cd} msg_cd=${data.msg_cd ?? '-'} `
      + `msg=${String(data.msg1 ?? '').trim().slice(0, 120)}`,
    );
  }
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
/**
 * KIS 숫자 문자열 → 유한한 숫자(부호 허용). 빈 문자열·비숫자·`'1e3'` 등은 null (`Number('')` 이 0 이 되는 것을 막는다).
 * 음수를 거부하지 않는 이유: D+2 정산금액은 미수가 생기면 음수일 수 있고, 예전 코드는 그것을 0 으로 잘라 썼다.
 * 음수를 "판정 불가"로 보면 그 기간 스냅샷이 계속 보류된다 — 잘라 쓰는 기존 동작을 유지한다.
 */
function cashNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * 국내 잔고 `output2`(요약) → KRW 예수금 행. **판정할 수 없으면 null** — 0원 행을 지어내지 않는다 (T-056 Q3).
 *
 * prvs_rcdl_excc_amt(D+2 가수도정산금액) = 결제 완료 후 확정 예수금 → 진짜 사용 가능 cash.
 * dnca_tot_amt(예수금총금액)은 매수 체결됐지만 결제 전인 금액도 포함 → free에 부적합. 차액(결제 대기) = locked.
 * `prvs_rcdl_excc_amt` 가 응답에 **없을 때만**(null·undefined) 예수금총금액을 쓴다(기존 `??` 동작) — 있는데 숫자가 아니면 null.
 * 예전 코드는 `dnca_tot_amt` 가 없으면 `?? 0` 으로 **0원 행**을 만들었다 — 그것이 이 함수가 막는 경로다.
 */
export function parseDomesticCashSummary(output2: unknown): Balance | null {
  const summary = (Array.isArray(output2) ? output2[0] : output2) as Record<string, unknown> | null | undefined;
  if (!summary || typeof summary !== 'object') return null;
  const total = cashNum(summary.dnca_tot_amt);
  if (total == null) return null;
  const settled = summary.prvs_rcdl_excc_amt == null ? total : cashNum(summary.prvs_rcdl_excc_amt);
  if (settled == null) return null;
  return { currency: 'KRW', free: Math.max(0, settled), locked: Math.max(0, total - settled) };
}

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
    // (T-132) 게이트웨이 일시 오류(EGW00300·SESSION FULL)로 **한 틱이 통째로 버려지는 것**을 막는다.
    // 잔고 조회는 멱등한 읽기이므로 재시도가 안전하다. 레이트리밋은 kisFetch 가 따로 처리한다.
    res = await kisFetch(url, { headers }, { label: 'domestic getBalances', transientRetries: 2 });
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
  /**
   * (T-132) HTTP 200 인데 업무 실패(`rt_cd≠'0'`) — **성공으로 통과시키지 않는다.**
   *
   * 예전에는 그대로 내려가 `output2`(예수금)·`output1`(보유) 가 없는 응답이 "예수금 행 없는 정상
   * 잔고" 로 반환됐다. 그 잔고로 총액을 내면 조용히 축소된 값이 킬스위치 기준선이 된다 — T-012 가
   * 막으려던 계열이다. 2026-10-31 KIS 장애에서 실제로 나온 모양: `rt_cd:"9" OPSQ1002 SESSION FULL`.
   * 평시 이 경로의 업무 실패는 0건이다(실측 — 42건/일은 전부 market-cap-ranking).
   */
  if (data?.rt_cd != null && data.rt_cd !== '0') {
    throw new Error(
      `KIS getBalances: 200 업무실패 rt_cd=${data.rt_cd} msg_cd=${data.msg_cd ?? '-'} `
      + `msg=${String(data.msg1 ?? '').trim().slice(0, 120)}`,
    );
  }
  if (process.env.KIS_OVERSEAS_DEBUG === '1') {
    console.log('[kis-domestic getBalances raw] rt_cd=', data.rt_cd, 'msg=', data.msg1);
    (data.output1 ?? []).forEach((item: Record<string, string>, idx: number) => {
      console.log(`  [domestic][${idx}] pdno=${item.pdno} hldg_qty=${item.hldg_qty} loan_type=${item.loan_type_cd ?? item.bfdy_buy_qty}`);
    });
    console.log('  [domestic summary] cano=', cano, 'acntPrdt=', acntPrdt, 'dnca_tot_amt=', data.output2?.[0]?.dnca_tot_amt);
  }

  const balances: Balance[] = [];
  const krw = parseDomesticCashSummary(data.output2);
  if (krw) balances.push(krw);
  else {
    // T-056 Q3 — 요약이 없거나 값이 이상하면 KRW 행을 **만들지 않는다**(예전: 필드가 없으면 `?? 0` 으로 0원 행).
    // 보유 종목은 그대로 돌려준다(보유 완결성과 현금 상태는 독립). 스냅샷 크론은 KRW 행이 없으면 저장을 보류한다.
    console.error('[kis-domestic getBalances] 예수금 요약(output2) 없음 또는 값 이상 — KRW 행 생략(0원으로 만들지 않음):',
      JSON.stringify(Array.isArray(data.output2) ? data.output2[0] ?? null : data.output2 ?? null).slice(0, 200));
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
export function roundToTick(price: number): number {
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
  // 🔴 T-027 — 타입까지 본다. `quantity <= 0` 만으로는 `'3.7' <= 0 → false` 라 비-number 가
  //    통과해 아래 라이브 주문 호출까지 도달했다. 사유 구분은 `unusableQuantityReason` 참조.
  const badQty = unusableQuantityReason(quantity);
  if (badQty) return { ok: false, error: badQty };

  // 🔴 T-027 — 지정가의 `price` 도 같은 계열의 구멍이었다. 비-number 가격은 `roundToTick`
  //    을 통과하면서 `NaN` 이 되고 `ORD_UNPR: "NaN"` 이라는 쓰레기 payload 가 그대로 라이브
  //    API 로 나간다. 매수는 한도 검사(`checkOrderMax`)가 NaN 금액을 막게 됐지만 **매도는
  //    한도 검사 자체를 건너뛰므로**(청산 우선 정책) 여기서 막지 않으면 남는 경로가 있다.
  //
  //    ⚠️ 여기는 quantity 와 달리 **`typeof === 'number'` 까지 요구하지 않는다.** quantity 는
  //    앞단 `sizeOrderQuantity` 가 모든 진입점에서 number|undefined 로 정규화하지만, price 는
  //    가공 없이 통과하고 `POST /api/signals` 는 본문의 price 를 그대로 흘린다. 게다가 mysql2
  //    는 DECIMAL 을 **문자열로** 돌려준다(2026-08-16 에 같은 원인의 표시 결함을 고쳤다).
  //    즉 `'70000'` 은 오늘 정상 송신되는 값이고, 그것을 막으면 실매매를 끊는 사고가 된다.
  //    막아야 할 것은 딱 하나 — `ORD_UNPR: "NaN"` 을 만드는 값이다.
  //    `<= 0` 도 건드리지 않는다 — 현행 동작(0 이면 KIS 가 거절)을 바꾸지 않기 위해서다.
  if (req.type !== 'market' && !Number.isFinite(Number(price))) {
    // 값 자체는 `trade_logs.submit_attempt` 에 원본 req 로 남으므로 여기서는 타입만 적는다
    // (임의 객체를 문자열화하다 던지는 일이 없게).
    return { ok: false, error: `price 타입 오류: 유한한 숫자가 아님 (${typeof price})` };
  }

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
 * 국내 일별 주문체결 조회 — TTTC0081R(실전)/VTTC0081R(모의) inquire-daily-ccld (3개월 이내 조회 현행 TR).
 * order-sync에서 체결된 주문 매칭에 사용.
 *
 * 구 `TTTC8001R`/`VTTC8001R` 은 쓰지 않는다 — 2026-10-25 라이브 비교(T-081 A06): 같은 조건(계정·기간·
 * 종목·체결만)에서 구 TR 호출은 rt_cd=0 + "조회할 내용이 없습니다"(빈 목록), 현행 TR + `EXCG_ID_DVSN_CD=ALL`
 * 호출은 체결 2건이었다. TR ID 와 파라미터가 함께 달라 둘 중 무엇이 원인인지는 분리하지 못했다.
 * 현행 TR 은 `EXCG_ID_DVSN_CD`(거래소 구분)가 추가로 필요하다: 실전 'ALL', 모의 'KRX'(모의는 KRX 만 지원).
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
  const mock = isMock();
  const trId = mock ? 'VTTC0081R' : 'TTTC0081R';
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
    EXCG_ID_DVSN_CD:    mock ? 'KRX' : 'ALL',  // 현행 TR 필수 — 모의는 KRX 만 지원
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
    // 연속조회는 구현하지 않는다(종목 지정·짧은 기간 호출). 다음 페이지 신호(M/F)가 오면 fail-closed 로 던진다 —
    // order-sync 의 "체결 목록에도 없다 → cancelled" 추론은 완전한 목록이 전제이므로, 첫 페이지만으로
    // 반환하면 후속 페이지의 체결이 취소로 오기록될 수 있다(T-018 "실패를 빈 배열로 바꾸지 않는다"와 같은 이유).
    // D/E(마지막 페이지)·헤더 없음은 통과.
    const respTrCont = res.headers?.get?.('tr_cont') ?? '';
    if (respTrCont === 'M' || respTrCont === 'F') {
      throw new Error(
        `KIS getCompletedOrders ${symbol}: 연속조회 신호(tr_cont=${respTrCont}) — 첫 페이지만으로는 `
        + `체결 부재를 판정할 수 없다 (기간 ${params.get('INQR_STRT_DT')}~${params.get('INQR_END_DT')})`,
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

// ── T-087 (T-081 WP-D1a) 브로커 원장 조회(읽기 전용 GET) — 구현은 kis-domestic-ledger.ts ──
// 위 함수들(getCompletedOrders·getBalances 등)의 동작·시그니처는 바꾸지 않았다. 원장 조회는 order-sync·킬스위치·스냅샷 경로에서 쓰지 않는다.
export { getDailyOrderFills, getPeriodProfit, getPositionSnapshot } from './kis-domestic-ledger';
