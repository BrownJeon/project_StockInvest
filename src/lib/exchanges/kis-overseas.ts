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
import { getKisToken, kisBaseUrl } from './kis-auth';
import { getCredential } from '@/lib/credentials';
import { kisFetch, isKisRateLimited, kisBodyText } from './kis-http';
import { shouldRetryAfterTokenError } from './kis-token-retry';
import { mapWithLimit, DEFAULT_FANOUT_CONCURRENCY } from './kis-throttle';
import { parseOverseas, formatOverseas, toOvrsExcgCd, type OverseasExchange } from './kis-symbols';
import { submittedQuantity, unusableQuantityReason } from './order-quantity';
import { getUsdKrwRate } from './fx';
import type { Ticker, Candle, Balance, OrderRequest, OrderResult, CancelRequest, UsdCashReading } from './types';

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
 * KIS overseas getTicker — 단발 5xx/429/네트워크 hiccup 으로 strategy-eval errors 가 5분마다
 * 1~6건씩 누적되던 사례(2026-05-16 분석)를 완화하려고 타임아웃 + 재시도를 붙였던 경로다.
 *
 * 🔴 T-017 두 가지:
 *  1. 타임아웃을 `AbortController` 직접 관리에서 `kisFetch({ timeoutMs })` 로 옮겼다.
 *     **스로틀 대기 시간이 타임아웃을 잡아먹지 않게** 하기 위함이다 — 타이머를 대기열에 서기 전에
 *     걸면 "5초 타임아웃"이 "대기+통신 합쳐 5초"가 돼, 스로틀이 만든 대기가 그대로 새 실패 모드가
 *     된다. `kisFetch` 는 토큰을 받은 **뒤에** 타이머를 건다(시도마다 새로).
 *  2. 레이트리밋(EGW00201/EGW00215)은 재시도 분기를 타지 않는다 — `kisFetch` 가 이미 백오프를
 *     소진했고, 여기서 또 때리면 증폭이 부활한다.
 *
 * 🔴 T-133 — **응답 기반 재시도를 게이트웨이로 넘겼다**(`transientRetries: 2`).
 *  - 손으로 만든 루프를 남긴 채 옵션만 켜면 바깥 × 안쪽으로 호출이 곱해지므로, 응답 분기는 걷어냈다.
 *  - 이로써 HTTP 500 뿐 아니라 **HTTP 200 업무실패(`rt_cd≠'0'`, 예: `OPSQ1002 SESSION FULL`)도
 *    재시도 대상**이 된다. 예전에는 `res.ok === true` 라 루프를 비껴가 1회 실패로 끝났고, 호출부
 *    `portfolio-total` 이 그 종목을 총액에서 제외했다(2026-10-31 하루 11건 — T-133 측정).
 *  - **던진 예외(타임아웃·네트워크)의 재시도 1회는 남겨 둔다** — `kisFetch` 는 던진 예외를
 *    재시도하지 않으므로 지우면 기능 후퇴다(실측: 오늘 KIS 1233건 중 `timeout` 3건).
 *  - **호출 상한(레이트리밋까지 센 값, T-133 Reviewer L-2 정정)**: `kisFetch` 한 번이 최악 5회
 *    (최초 1 + 일시 2 + 레이트리밋 2)이고 아래 예외 루프가 2회이므로 **최악 10회**다. 종전 최악은
 *    2 × 3 = **6회**였다(처음 적었던 "6회(이전 2회)" 는 레이트리밋 예산을 빼고 센 값이라 틀렸다).
 *    최악 벽시계는 **실측 9.0초**, 이론 상한 약 **34초**다("20초 안팎" 도 정정). 장중 틱 시간 영향은
 *    여전히 측정하지 않았다(T-133 미확인 — QA·운영 관찰로 넘긴다).
 */
export async function getTicker(symbol: string): Promise<Ticker> {
  const { excd, ticker } = parseOverseas(symbol);
  const headers = await kisHeaders('HHDFS00000300');
  const params = new URLSearchParams({ AUTH: '', EXCD: excd, SYMB: ticker });
  const url = `${BASE()}/uapi/overseas-price/v1/quotations/price?${params}`;

  const MAX_THROW_ATTEMPTS = 2;   // 던진 예외(타임아웃·네트워크)만 여기서 재시도한다
  const TIMEOUT_MS = 5_000;
  let res: Response | undefined;
  for (let attempt = 1; attempt <= MAX_THROW_ATTEMPTS; attempt++) {
    try {
      res = await kisFetch(url, { headers }, {
        timeoutMs: TIMEOUT_MS, label: 'overseas getTicker', transientRetries: 2,
      });
      break;
    } catch (e) {
      if (attempt < MAX_THROW_ATTEMPTS) {
        await new Promise(r => setTimeout(r, 300));
        continue;
      }
      throw new Error(`KIS overseas getTicker ${symbol}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  // 타입 좁히기용 가드다 — 위 루프는 `break`(res 설정) 또는 `throw` 로만 끝나므로 실제로는
  // 도달하지 않는다(T-133 Reviewer I-4). 삭제하면 `res` 가 `Response | undefined` 로 남는다.
  if (!res) throw new Error(`KIS overseas getTicker ${symbol}: retries exhausted`);
  if (!res.ok) {
    if (isKisRateLimited(res)) {
      throw new Error(`KIS overseas getTicker ${symbol}: ${res.status} (레이트리밋 — 백오프 재시도 소진)`);
    }
    throw new Error(`KIS overseas getTicker ${symbol}: ${res.status}`);
  }
  const data = await res.json();
  /**
   * (T-133) HTTP 200 인데 업무 실패 — 위 `transientRetries` 를 **소진한 뒤**에만 여기 온다.
   * 예전에는 `output` 이 없어 아래 `no output` 으로 던졌는데 본문 JSON 을 통째로 싣는 메시지라
   * 로그에서 원인(`SESSION FULL` 인지 다른 업무 오류인지)을 가를 수 없었다.
   */
  // (T-133 QA #3) 숫자형 `rt_cd` 정규화 — 국내 쪽 같은 지점의 주석 참고.
  if (data?.rt_cd != null && String(data.rt_cd) !== '0') {
    throw new Error(
      `KIS overseas getTicker ${symbol}: 200 업무실패 rt_cd=${data.rt_cd} msg_cd=${data.msg_cd ?? '-'} `
      + `msg=${String(data.msg1 ?? '').trim().slice(0, 120)}`,
    );
  }
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
    // (T-183) `base` = 전일 종가. 빈 값·0·NaN 은 `> 0` 비교에서 걸러 키 자체를 싣지 않는다
    // (국내 getTicker·T-181 과 같은 방식).
    ...(Number(o.base) > 0 ? { prevClose: Number(o.base) * fx } : {}),
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

// ── 해외 USD 예수금 — CTRP6504R(실전)/VTRP6504R(모의) 체결기준현재잔고 (T-056) ───
//
// ## 왜 바꿨는가 (2026-10-20 실측)
//
// 예전 경로는 ① TTTS3012R `output2` 의 `frcr_dncl_amt1 ?? frcr_dncl_amt ?? dnca_tot_amt` 를 읽었는데 그 응답에는 셋 다
// **없다**(항상 0). ② 그래서 매번 TTTS3007R 매수가능금액 폴백을 불렀는데 `ITEM_CD=''` 때문에 `rt_cd=7 APBN0746 상품이 없습니다`
// 로 **매번 실패**했고, 그 실패를 `!res.ok → 0`·`rt_cd≠0 → 0`·호출부 `.catch(() => 0)` 세 겹이 0 으로 바꿨다. 스냅샷 4,667행에
// USD 행이 한 번도 없었던 이유다. 해외 매도 대금이 총자산에서 사라져 10-03 킬스위치 오발동의 한 원인이 됐다.
//
// ## 무엇을 읽는가
//
// `output2` USD 행의 `frcr_dncl_amt_2`(외화예수금액2) **하나만** 평가에 쓴다. `output3` 의 현금 합계(`tot_frcr_cblc_smtl`·
// `tot_dncl_amt`·`wdrw_psbl_tot_amt`)는 원화 예수금이 섞여 있어(실측: `tot_frcr_cblc_smtl` = USD 원화값 + KRW 예수금) 쓰면
// KRW 행과 **이중 계상**된다. `output3` 은 아래 정합 검사에만 쓴다.
//
// ## 판정 규칙 (설계 Q9 + Leader 결정 — 비교는 모두 ±1원, T-102 독립 검산만 ±2원)
//
//  1. `rt_cd='0'` + USD 행 정확히 1개 + `frcr_dncl_amt_2` 유한·≥0
//     + 환율 `frst_bltn_exrt` 유한한 양수 **이고 타당 범위 100~10000 KRW/USD** (`USD_KRW_RATE_MIN/MAX`, T-102 Codex C2 high —
//       원 단위 허용치는 달러로 1/환율이라 극단 환율에서 아래 정합이 무력화된다)
//     + 매수증거금 margin = `frcr_buy_mgn_amt`(키 없음·공백 = 0, 비숫자·음수 → 던짐), 순예수금 net = min(round6(예수금 − margin), 예수금)
//       (margin 0 이면 net = 예수금 그대로, net < 0 이면 던짐 — 자세한 근거는 아래 T-102 절)
//     + 정합 검사 5종:
//         ① 행        `frcr_evlu_amt2 ≈ net × 환율`
//         ② 합계      `output3.frcr_evlu_tota ≈ Σ output2.frcr_evlu_amt2 + margin × 환율`
//         ③ 교차      `output3.buy_mgn_amt ≈ margin × 환율` (margin 0 이면 값이 있을 때 ≈ 0, 비숫자는 던짐)
//         ④ 체결분 대조(margin > 0 만) `output3.ustl_buy_amt_smtl ≈ output3.buy_mgn_amt`
//         ⑤ 독립 검산(margin > 0 만)  `tot_asst_amt ≈ evlu_amt_smtl_amt + tot_dncl_amt + Σ frcr_evlu_amt2` (±2원)
//     (margin 0 이면 ①② 는 T-056 원래 식 `evlu ≈ 예수금 × 환율`·`tota ≈ Σ evlu` 와 같다)
//                                                                                          → **known = net** (margin 0 이면 frcr_dncl_amt_2)
//  2. `rt_cd='0'` + USD 행 없음 + output3 존재 + `frcr_evlu_tota ≈ 0` + `tot_asst_amt − evlu_amt_smtl_amt − tot_dncl_amt ≈ 0`
//     (+ 1번과 같은 `frcr_evlu_tota ≈ Σ output2.frcr_evlu_amt2` — 자기모순 응답 차단, 구현 시 추가)
//                                                                                          → **known = 0** (KIS 가 0 통화를 생략해도 데드락 없음)
//  3. 그 밖 전부(HTTP≠200, `rt_cd≠'0'`, output3 없음, 항등식 불일치, 비유한 값, USD 행 2개 이상)  → **던진다** (호출부는 unknown)
//
// ## T-102 — 미결제 매수(매수증거금)가 있을 때 (2026-10-27 실측 1건 + KIS 자체 총자산 항등식)
//
// 매수 체결 후 결제(T+1) 전에는 USD 행에 `frcr_buy_mgn_amt`(매수증거금, USD)가 생기고 관계가 바뀐다:
//   - `frcr_evlu_amt2` = (예수금 − 매수증거금) × 환율   (출금가능 기준. 예전 가정은 예수금 × 환율)
//   - `output3.frcr_evlu_tota` = 예수금 전체 × 환율     → `tota = Σ frcr_evlu_amt2 + 매수증거금 × 환율`
//   - `output3.buy_mgn_amt` = 매수증거금 × 환율
//   - `output3.tot_asst_amt = evlu_amt_smtl_amt + tot_dncl_amt + Σ frcr_evlu_amt2` — KIS 도 총자산에 순예수금을 쓴다
// 그래서 1번 분기를 넓힌다: margin = `frcr_buy_mgn_amt`(키 없음·빈 값 = 0, 비숫자·음수·예수금 초과는 던진다), net = 예수금 − margin,
//   행 `frcr_evlu_amt2 ≈ net × 환율` · 합계 `frcr_evlu_tota ≈ Σ frcr_evlu_amt2 + margin × 환율` (±1원, margin 0 이면 예전 식 그대로)
//   · 교차 `output3.buy_mgn_amt ≈ margin × 환율` (±1원, margin 0 이면 값이 있을 때 ≈ 0)
//   · 체결분 대조(margin > 0 일 때만) `output3.ustl_buy_amt_smtl ≈ output3.buy_mgn_amt` (±1원 — 미체결 주문 예약금이 섞인 증거금 차단)
//   · 독립 검산(margin > 0 일 때만) `tot_asst_amt ≈ evlu_amt_smtl_amt + tot_dncl_amt + Σ frcr_evlu_amt2` (±2원 — 반올림된 세 항)
//                                                                                          → **known = net**
// 결제된 종목은 이미 보유(output1) 평가에 들어 있으므로 총예수금을 쓰면 이중 계상된다. 결제가 끝나면 margin 0 → net = 예수금이라
// 값이 연속이다(결제 시점 총자산 튐 없음). 미결제 **매도**(`ustl_sll_amt_smtl`)는 여전히 기록만 하고 평가에 넣지 않는다(실측 없음).
//
// 🔴 **이 경로 어디에도 실패를 0 으로 바꾸는 지점이 없어야 한다.** 0 은 2번 분기(항등식이 0 을 확인)에서만 나온다.

/** 정합·항등식 허용치 — 원화 반올림 한 칸. 분기마다 같은 값을 쓴다(Leader 결정 10-20 08:30). */
export const USD_CASH_RECONCILE_TOLERANCE_KRW = 1;

/** USD 예수금을 확인할 수 없다 — 0 으로 해석하지 말 것. */
export class UsdCashUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsdCashUnavailableError';
  }
}

/**
 * KIS 숫자 문자열(`"368.510000"`) → 유한한 숫자. 빈 문자열·null·`'abc'`·`'1e3'` 등은 null.
 * `Number('')`·`Number(null)` 이 0 이 되는 것을 그대로 쓰면 "값 없음"이 확정적인 0 이 된다 — 그래서 형식을 먼저 본다.
 */
function strictNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * (T-102) 미결제 매수 상태의 독립 검산 `tot_asst_amt ≈ evlu_amt_smtl_amt + tot_dncl_amt + Σ frcr_evlu_amt2` 허용치.
 * 우변 세 항이 각각 원 단위로 반올림된 값이라 한 칸(1원)보다 하나 넓게 둔다(Leader 설계 T-102).
 */
export const USD_CASH_TOT_ASST_TOLERANCE_KRW = 2;

/**
 * (T-102 Codex C2 high) USD 행 환율(`frst_bltn_exrt`, KRW/USD) 타당 범위. 원 단위 허용치(±1·±2원)를 달러로 바꾸면 1/환율이라,
 * 환율이 극단적으로 작으면 정합 검사가 사실상 무력화돼 손상 응답의 `usd` 가 과대 계상될 수 있다 → 범위 밖이면 던진다.
 */
export const USD_KRW_RATE_MIN = 100;
export const USD_KRW_RATE_MAX = 10_000;

function within(a: number, b: number, tol: number = USD_CASH_RECONCILE_TOLERANCE_KRW): boolean {
  return Math.abs(a - b) <= tol;
}

/** USD 소수 6자리 반올림 — 예수금 − 증거금 의 부동소수 잡음(…0000001)을 지운다. */
function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

/**
 * (T-102) 생략 가능한 숫자 필드. 키가 없거나(null/undefined) 공백뿐인 문자열이면 0(과거 응답 모양 호환),
 * 값이 있는데 숫자 형식이 아니면(비유한·'abc'·'1e3') null — 호출부가 던진다.
 */
function optionalNumOrZero(v: unknown): number | null {
  if (v == null) return 0;
  if (typeof v === 'string' && v.trim() === '') return 0;
  return strictNum(v);
}

export interface ParsedUsdCash {
  /** 순예수금(미결제 매수 차감) — `UsdCashReading.usd` */
  usd: number;
  ustlSllAmtSmtl: number;
  /** 미결제 매수가 있을 때만: 총예수금(USD) */
  grossDepositUsd?: number;
  /** 미결제 매수가 있을 때만: 매수증거금(USD) */
  unsettledBuyUsd?: number;
}

/**
 * CTRP6504R 응답 본문 → USD 예수금. **순수 함수**(fetch·db 없음) — 판정 규칙 전부가 여기 있다.
 * 규칙을 통과하지 못하면 `UsdCashUnavailableError` 를 던진다. 0 은 2번 분기(항등식이 0 확인) 또는 1번 분기의
 * 정합 검사를 모두 통과한 순예수금이 0 일 때만 반환된다.
 */
export function parseUsdCashFromPresentBalance(data: unknown): ParsedUsdCash {
  const fail = (why: string): never => { throw new UsdCashUnavailableError(`CTRP6504R USD 예수금 판정 불가 — ${why}`); };
  if (!data || typeof data !== 'object') fail('응답 본문이 객체가 아님');
  const d = data as Record<string, unknown>;
  if (d.rt_cd !== '0') {
    fail(`rt_cd=${String(d.rt_cd)} msg_cd=${String(d.msg_cd ?? '-')} msg=${String(d.msg1 ?? '').trim().slice(0, 120)}`);
  }

  const o3raw = d.output3;
  const o3 = (Array.isArray(o3raw) ? o3raw[0] : o3raw) as Record<string, unknown> | undefined;
  if (!o3 || typeof o3 !== 'object') fail('output3(합계) 없음');
  const o3n = (key: string): number => {
    const n = strictNum(o3![key]);
    if (n == null) fail(`output3.${key} 가 숫자가 아님 (${JSON.stringify(o3![key])})`);
    return n as number;
  };

  // output2: 통화별 행. KIS 는 한 행일 때 객체로 줄 수도 있어 배열로 맞춘다. null/undefined 는 "행 없음".
  const o2raw = d.output2;
  let rows: Record<string, unknown>[];
  if (o2raw == null) rows = [];
  else if (Array.isArray(o2raw)) rows = o2raw as Record<string, unknown>[];
  else if (typeof o2raw === 'object') rows = [o2raw as Record<string, unknown>];
  else return fail(`output2 형식 이상 (${typeof o2raw})`);

  const frcrEvluTota = o3n('frcr_evlu_tota');
  const ustlSll = strictNum(o3!.ustl_sll_amt_smtl);
  const ustlSllAmtSmtl = ustlSll != null && ustlSll > 0 ? ustlSll : 0;

  const usdRows = rows.filter(r => r && String(r.crcy_cd ?? '').trim().toUpperCase() === 'USD');
  if (usdRows.length > 1) fail(`output2 에 USD 행이 ${usdRows.length}개`);

  // 두 분기 공통 항등식: output3.frcr_evlu_tota ≈ Σ output2.frcr_evlu_amt2 (+ 분기 1 의 매수증거금 × 환율, T-102).
  // 분기 2 에도 적용한다 — USD 행은 없는데 다른 통화 행에 값이 있고 합계는 0 이라고 말하는 자기모순 응답을 0 으로 읽지 않게.
  // (T-102) 매수증거금 항은 USD 행 환율을 확인한 뒤에야 계산할 수 있어 비교는 각 분기 안에서 한다 — 검사 집합은 같다.
  let sumEvlu = 0;
  for (const row of rows) {
    const v = strictNum(row?.frcr_evlu_amt2);
    if (v == null) fail(`output2 ${String(row?.crcy_cd)} 행의 frcr_evlu_amt2 가 숫자가 아님`);
    sumEvlu += v as number;
  }

  if (usdRows.length === 1) {
    // ── 분기 1: USD 행 있음 + 정합 (T-102: 미결제 매수 = 매수증거금이 있으면 순예수금 기준) ──
    const r = usdRows[0];
    const dncl = strictNum(r.frcr_dncl_amt_2);
    if (dncl == null) fail(`frcr_dncl_amt_2 가 숫자가 아님 (${JSON.stringify(r.frcr_dncl_amt_2)})`);
    if ((dncl as number) < 0) fail(`frcr_dncl_amt_2 음수 (${dncl})`);
    const rate = strictNum(r.frst_bltn_exrt);
    const evlu = strictNum(r.frcr_evlu_amt2);
    if (rate == null || evlu == null) fail('USD 행의 frst_bltn_exrt·frcr_evlu_amt2 가 숫자가 아님');
    // (Codex C2 high) 환율 0·음수면 `0 × usd = 0` 정합이 아무 예수금이나 통과시킨다 — 앱은 자체 환율로 환산하므로 총자산 과대 기록.
    if (!((rate as number) > 0)) fail(`USD 행 환율(frst_bltn_exrt)이 양수가 아님 (${rate})`);
    // (T-102 Codex C2 high) 아주 작은(또는 큰) 양수 환율도 원 단위 정합을 무력화한다 — 분기 1 공통(margin 0·>0).
    if ((rate as number) < USD_KRW_RATE_MIN || (rate as number) > USD_KRW_RATE_MAX) {
      fail(`USD 행 환율(frst_bltn_exrt)이 타당 범위(${USD_KRW_RATE_MIN}~${USD_KRW_RATE_MAX}) 밖 (${rate})`);
    }

    // (T-102) 매수증거금(미결제 매수, USD). 키 없음·빈 값 = 0(과거 응답 호환), 비숫자·음수·예수금 초과는 던진다.
    const margin = optionalNumOrZero(r.frcr_buy_mgn_amt);
    if (margin == null) fail(`USD 행 frcr_buy_mgn_amt 가 숫자가 아님 (${JSON.stringify(r.frcr_buy_mgn_amt)})`);
    if ((margin as number) < 0) fail(`USD 행 frcr_buy_mgn_amt 음수 (${margin})`);
    const hasMargin = (margin as number) > 0;
    // margin 0 이면 예수금 그대로(T-056 과 비트 단위로 같은 값), 있으면 순예수금.
    // (Reviewer F1) 소수 7자리 이하 입력에서 round6 이 예수금 위로 올림하지 않게 `≤ 예수금` 으로 묶는다.
    const net = hasMargin ? Math.min(round6((dncl as number) - (margin as number)), dncl as number) : (dncl as number);
    // 순예수금 음수 = 증거금이 예수금보다 크다(통합증거금·신용 등 모르는 상태) — 0 으로 자르지 않고 던진다.
    if (net < 0) fail(`USD 행 매수증거금 ${margin} > 예수금 ${dncl} (순예수금 음수 — 모르는 상태)`);
    const marginKrw = (margin as number) * (rate as number);

    // 행: frcr_evlu_amt2 ≈ 순예수금 × 환율 (margin 0 이면 예전 식 `예수금 × 환율` 과 같다)
    if (!within(evlu as number, net * (rate as number))) {
      fail(`USD 행 정합 불일치: frcr_evlu_amt2=${evlu} ≠ ${net}×${rate}`
        + (hasMargin ? ` (순예수금 = 예수금 ${dncl} − 매수증거금 ${margin})` : ''));
    }
    // 합계: frcr_evlu_tota ≈ Σ frcr_evlu_amt2 + 매수증거금 × 환율 (margin 0 이면 예전 식과 같다)
    if (!within(frcrEvluTota, sumEvlu + marginKrw)) {
      fail(`output3.frcr_evlu_tota=${frcrEvluTota} ≠ Σ output2.frcr_evlu_amt2=${sumEvlu}`
        + (hasMargin ? ` + 매수증거금×환율=${marginKrw}` : ''));
    }
    // 교차: output3.buy_mgn_amt ≈ 매수증거금 × 환율. margin > 0 이면 반드시 있어야 하고, 0 이면 (있을 때) ≈ 0.
    if (hasMargin) {
      const buyMgnKrw = strictNum(o3!.buy_mgn_amt);
      if (buyMgnKrw == null) fail(`매수증거금이 있는데 output3.buy_mgn_amt 가 숫자가 아님 (${JSON.stringify(o3!.buy_mgn_amt)})`);
      if (!within(buyMgnKrw as number, marginKrw)) {
        fail(`output3.buy_mgn_amt=${buyMgnKrw} ≠ 매수증거금×환율=${marginKrw}`);
      }
      // (T-102 Leader 결정) 체결분 대조: 매수증거금이 **체결된 미결제 매수**만인지 확인한다. 미체결 주문 예약금이 섞이면
      // `ustl_buy_amt_smtl`(미결제매수금액 — 체결분만)이 더 작아진다 → 순예수금이 보유에 없는 금액까지 빼게 되므로 던진다.
      const ustlBuyKrw = strictNum(o3!.ustl_buy_amt_smtl);
      if (ustlBuyKrw == null) {
        fail(`매수증거금이 있는데 output3.ustl_buy_amt_smtl 가 숫자가 아님 (${JSON.stringify(o3!.ustl_buy_amt_smtl)})`);
      }
      if (!within(ustlBuyKrw as number, buyMgnKrw as number)) {
        fail(`output3.ustl_buy_amt_smtl=${ustlBuyKrw} ≠ output3.buy_mgn_amt=${buyMgnKrw} (미체결 주문 예약금 등 체결분 외 증거금 — 모르는 상태)`);
      }
      // 독립 검산(새 경로라 더 엄격하게): KIS 자신의 총자산이 순예수금 기준인지
      const assetRhs = o3n('evlu_amt_smtl_amt') + o3n('tot_dncl_amt') + sumEvlu;
      const totAsst = o3n('tot_asst_amt');
      if (!within(totAsst, assetRhs, USD_CASH_TOT_ASST_TOLERANCE_KRW)) {
        fail(`미결제 매수 상태 독립 검산 불일치: tot_asst_amt=${totAsst} ≠ evlu_amt_smtl_amt + tot_dncl_amt + Σ frcr_evlu_amt2 = ${assetRhs}`);
      }
      return { usd: net, ustlSllAmtSmtl, grossDepositUsd: dncl as number, unsettledBuyUsd: margin as number };
    }
    const buyMgnKrw0 = optionalNumOrZero(o3!.buy_mgn_amt);
    if (buyMgnKrw0 == null) fail(`output3.buy_mgn_amt 가 숫자가 아님 (${JSON.stringify(o3!.buy_mgn_amt)})`);
    if (!within(buyMgnKrw0 as number, 0)) {
      fail(`USD 행 매수증거금이 0 인데 output3.buy_mgn_amt=${buyMgnKrw0} ≠ 0 (다른 통화 증거금 등 모르는 상태)`);
    }
    return { usd: net, ustlSllAmtSmtl };
  }

  // ── 분기 2: USD 행 없음 — output3 항등식이 0 을 확인할 때만 known 0 ──
  if (!within(frcrEvluTota, sumEvlu)) {
    fail(`output3.frcr_evlu_tota=${frcrEvluTota} ≠ Σ output2.frcr_evlu_amt2=${sumEvlu}`);
  }
  if (!within(frcrEvluTota, 0)) fail(`USD 행이 없는데 output3.frcr_evlu_tota=${frcrEvluTota} ≠ 0`);
  const residual = o3n('tot_asst_amt') - o3n('evlu_amt_smtl_amt') - o3n('tot_dncl_amt');
  if (!within(residual, 0)) fail(`USD 행이 없는데 tot_asst_amt − evlu_amt_smtl_amt − tot_dncl_amt = ${residual} ≠ 0`);
  return { usd: 0, ustlSllAmtSmtl };
}

/**
 * 해외 USD 예수금 조회. **실패하면 던진다**(0 을 돌려주지 않는다). 토큰 계열 오류(T-136 `isKisTokenError` —
 * `EGW00121`·`EGW00123`)에서만 1회 재시도하고, 재발급은 DB 토큰이 방금 쓴 것과 같을 때만 한다.
 * 호출 수: 예전에 매 해외 잔고마다 실패하던 TTTS3007R 1회를 이 호출 1회가 **대체**한다.
 */
export async function getUsdCash(): Promise<UsdCashReading> {
  const trId = isMock() ? 'VTRP6504R' : 'CTRP6504R';
  const [cano, acntPrdt] = await Promise.all([accountNo(), accountProduct()]);
  const params = new URLSearchParams({
    CANO:              cano,
    ACNT_PRDT_CD:      acntPrdt,
    WCRC_FRCR_DVSN_CD: '02',   // 외화
    NATN_CD:           '840',  // 미국
    TR_MKET_CD:        '00',   // 전체
    INQR_DVSN_CD:      '00',   // 전체
  });
  let attempt = 0;
  for (;;) {
    const headers = await kisHeaders(trId);
    const url = `${BASE()}/uapi/overseas-stock/v1/trading/inquire-present-balance?${params}`;
    // (T-132) 게이트웨이 일시 오류 재시도. `rt_cd≠'0'` 는 파서가 이미 거부하므로(아래
    // parseUsdCashFromPresentBalance) 여기서는 재시도만 더한다.
    const res = await kisFetch(url, { headers }, { label: 'overseas usdCash', transientRetries: 2 });
    if (!res.ok) {
      const body = kisBodyText(res) ?? await res.text().catch(() => '');
      if (attempt === 0 && await shouldRetryAfterTokenError(body, headers.Authorization, 'kis-overseas usdCash')) {
        attempt++;
        continue;
      }
      throw new UsdCashUnavailableError(
        `KIS overseas usdCash(CTRP6504R): ${res.status} body=${body.slice(0, 200)}`
        + (isKisRateLimited(res) ? ' (레이트리밋 — 백오프 재시도 소진)' : ''),
      );
    }
    const data: unknown = await res.json();
    const parsed = parseUsdCashFromPresentBalance(data);
    return {
      usd: parsed.usd, source: 'CTRP6504R', ustlSllAmtSmtl: parsed.ustlSllAmtSmtl,
      // (T-102) 미결제 매수가 있을 때만 붙는다 — 없으면 T-056 과 같은 모양.
      ...(parsed.unsettledBuyUsd != null
        ? { grossDepositUsd: parsed.grossDepositUsd, unsettledBuyUsd: parsed.unsettledBuyUsd }
        : {}),
    };
  }
}

// ── 해외주식 현재가상세 — HHDFS76200200 (T-059 Part A, 읽기 전용 GET) ─────────
//
// 엔드포인트: GET /uapi/overseas-price/v1/quotations/price-detail · tr_id HHDFS76200200 · 파라미터 AUTH='', EXCD(NAS/NYS/AMS), SYMB.
// 근거(필드명·의미): KIS 공식 저장소 open-trading-api `examples_llm/overseas_stock/price_detail/price_detail.py`(API_URL·tr_id·params)
//   와 같은 폴더 `chk_price_detail.py` 의 COLUMN_MAPPING — 2026-10-21 조회
//   https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/overseas_stock/price_detail/chk_price_detail.py
//   perx=PER · pbrx=PBR · epsx=EPS · bpsx=BPS · tomv=시가총액 · shar=상장주수 · h52p/h52d=52주최고가/일자 · l52p/l52d=52주최저가/일자
//   last=현재가 · curr=통화 · e_icod=업종(섹터) · etyp_nm=ETP 분류명.  (주의: `mcap` 은 시가총액이 아니라 **자본금**이다.)
// 🔴 미확인(실응답을 본 적 없음 — 사용자 승인된 1회 읽기 전용 호출 필요): PER·PBR 의 회계 기준·갱신 주기, `tomv` 의 단위(USD 원값인지
//    천·백만 단위인지), 손실 기업의 PER 표기(0·음수·빈 값). 그래서 **원값 그대로** 저장하고 해석·환산하지 않는다.
//
// 판정(T-056 원칙 — 모르면 0 이 아니라 보류):
//  - `rt_cd !== '0'`·output 없음·현재가(last) 가 양수가 아님 → 던진다(행을 쓰지 않음).
//  - 각 지표: 키가 없거나 빈 문자열이면 **null(모름)**, 값이 있는데 숫자 형식이 아니면 **응답 형식이 다르다고 보고 던진다.**
//  - PER·PBR 이 정확히 0 이면 null(측정값으로 위조하지 않음), 음수는 그대로(아래 `zeroToNull` 주석).
//  - 지표 8개(per·pbr·eps·bps·시총·주수·52주 고저)가 **전부 null** 이면 빈 응답으로 보고 던진다.

/** 현재가상세를 확인할 수 없다 — 이 종목은 스냅샷을 쓰지 않는다. */
export class PriceDetailUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PriceDetailUnavailableError';
  }
}

export interface OverseasPriceDetail {
  symbol: string;
  lastPrice: number;
  per: number | null;
  pbr: number | null;
  eps: number | null;
  bps: number | null;
  marketCap: number | null;   // tomv 원값(단위 미확인)
  shares: number | null;
  high52: number | null;
  low52: number | null;
  high52Date: string | null;  // YYYY-MM-DD
  low52Date: string | null;
  currency: string | null;
  sector: string | null;
  etpType: string | null;
  /** KIS output 원문(시세 정보만 — 계좌 정보 없음). 감사·단위 확인용. */
  raw: Record<string, unknown>;
}

/** HHDFS76200200 응답 본문 → 스냅샷 값. **순수 함수**(fetch·db 없음). 판정 규칙은 위 블록 주석. */
export function parsePriceDetail(data: unknown, symbol: string): OverseasPriceDetail {
  const fail = (why: string): never => { throw new PriceDetailUnavailableError(`HHDFS76200200 ${symbol} 판정 불가 — ${why}`); };
  if (!data || typeof data !== 'object') fail('응답 본문이 객체가 아님');
  const d = data as Record<string, unknown>;
  if (d.rt_cd !== '0') fail(`rt_cd=${String(d.rt_cd)} msg_cd=${String(d.msg_cd ?? '-')}`);
  const oraw = Array.isArray(d.output) ? (d.output.length === 1 ? d.output[0] : undefined) : d.output;
  if (!oraw || typeof oraw !== 'object') fail('output 없음');
  const o = oraw as Record<string, unknown>;

  /** 없음·빈 문자열 → null, 형식 이상 → 던짐. */
  const num = (key: string): number | null => {
    const v = o[key];
    if (v == null) return null;
    if (typeof v === 'string' && v.trim() === '') return null;
    const n = strictNum(v);
    if (n == null) fail(`${key} 가 숫자 형식이 아님 (${JSON.stringify(v).slice(0, 40)})`);
    return n;
  };
  // (C-3) 8자리 숫자 형식만이 아니라 **실제 달력 날짜**인지 본다(연 1900~2100, Date 왕복 일치 — `20261340`·`20260230` 은 null).
  //   통과 못 한 날짜를 그대로 DATE 컬럼에 넣으면 strict 모드 DB 가 그 종목 행 전체를 거부한다.
  const ymd = (key: string): string | null => {
    const v = typeof o[key] === 'string' ? (o[key] as string).trim() : '';
    if (!/^\d{8}$/.test(v)) return null;
    const y = Number(v.slice(0, 4)), m = Number(v.slice(4, 6)), d = Number(v.slice(6, 8));
    if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
  };
  const text = (key: string, max: number): string | null => {
    const v = typeof o[key] === 'string' ? (o[key] as string).trim() : '';
    return v ? v.slice(0, max) : null;
  };

  const lastPrice = num('last');
  if (lastPrice == null || !(lastPrice > 0)) fail(`현재가(last)가 양수가 아님 (${JSON.stringify(o.last)})`);
  // (R-2) PER·PBR 이 **정확히 0**("0"·"0.00" 포함)이면 null. 실제 PER·PBR 은 0 이 될 수 없고, 손실 기업·자본잠식 등 계산 불가 상태를
  //   KIS 가 0 으로 채우는지 미확인이라 0 을 측정값으로 저장하지 않는다(원문은 `raw` 에 남는다).
  //   **음수는 그대로 둔다** — 손실 기업 PER 을 음수(EPS 음수 ÷ 가격)로 주는 표기가 흔하고, 음수는 "0 으로 채운 빈 값"과 달리
  //   계산 결과이므로 위조가 아니다. EPS·BPS 는 0 이 실제 값일 수 있어 이 규칙을 적용하지 않는다.
  const zeroToNull = (v: number | null): number | null => (v === 0 ? null : v);
  const metrics = {
    per: zeroToNull(num('perx')), pbr: zeroToNull(num('pbrx')), eps: num('epsx'), bps: num('bpsx'),
    marketCap: num('tomv'), shares: num('shar'), high52: num('h52p'), low52: num('l52p'),
  };
  if (Object.values(metrics).every((v) => v == null)) fail('지표 8개가 모두 비어 있음');
  return {
    symbol,
    lastPrice: lastPrice as number,
    ...metrics,
    high52Date: ymd('h52d'),
    low52Date: ymd('l52d'),
    currency: text('curr', 8),
    sector: text('e_icod', 64),
    etpType: text('etyp_nm', 64),
    raw: { ...o },
  };
}

/**
 * 해외주식 현재가상세 조회(읽기 전용). 실패하면 던진다 — 0·빈 값으로 바꾸지 않는다.
 * 토큰 계열 오류(T-136 `isKisTokenError`)에서만 1회 재시도. 스로틀은 `kisFetch` 가 담당한다(호출부가 `withKisPriority('bulk')` 로 감싼다).
 */
export async function getPriceDetail(symbol: string): Promise<OverseasPriceDetail> {
  const { excd, ticker } = parseOverseas(symbol);
  return getPriceDetailByExcd(excd, ticker, symbol);
}

/**
 * 같은 조회를 **거래소 코드 + KIS 표기로 직접** 한다 (T-143 WP-A). `parseOverseas` 를 거치지 않는다.
 *
 * ## 왜 이 입구가 따로 필요한가
 * 내부 심볼 규약은 **점**이고(`NYS:BRK.B` — `OVERSEAS_PATTERN` 이 `/` 를 거부한다) **KIS 가 받는 표기는
 * 슬래시**다(`BRK/B`). 2026-11-01 KIS 종목 마스터(`nysmst.cod`) 실측에서 클래스주 23종이 전부 슬래시였고,
 * 그래서 `NYS:BRK.B` 는 2026-10-21~11-01 **11일 연속** 현재가상세 조회에 실패했다(NYSE 시총 상위 종목이
 * 조용히 빠졌다).
 *
 * 🔴 **기존 경로는 한 글자도 바뀌지 않는다.** `parseOverseas`·`OVERSEAS_PATTERN`·`kis-symbols.ts` 를 건드리지
 * 않았고, `getPriceDetail(symbol)` 은 전과 같은 값을 전과 같은 방식으로 돌려준다(위에서 이 함수에 위임할 뿐이다).
 * 내부 심볼 → KIS 표기 변환은 **이 어댑터가 아니라** 호출부(`src/lib/universe/`)가 종목 마스터를 보고 정한다 —
 * 어댑터가 표기를 추측하기 시작하면 54종목 경로의 동작이 조용히 달라진다.
 *
 * @param excd 거래소 코드(NAS·NYS·AMS)
 * @param symb KIS 가 받는 표기(마스터 `symb` 열 그대로 — 클래스주는 `BRK/B`)
 * @param label 오류 메시지·판정에 쓸 이름. 생략하면 `EXCD:SYMB`
 */
export async function getPriceDetailByExcd(
  excd: OverseasExchange,
  symb: string,
  label?: string,
): Promise<OverseasPriceDetail> {
  const symbol = label ?? `${excd}:${symb}`;
  const ticker = symb;
  const params = new URLSearchParams({ AUTH: '', EXCD: excd, SYMB: ticker });
  const url = `${BASE()}/uapi/overseas-price/v1/quotations/price-detail?${params}`;
  let attempt = 0;
  for (;;) {
    const headers = await kisHeaders('HHDFS76200200');
    const res = await kisFetch(url, { headers }, { timeoutMs: 5_000, label: 'overseas priceDetail' });
    if (!res.ok) {
      const body = kisBodyText(res) ?? await res.text().catch(() => '');
      if (attempt === 0 && await shouldRetryAfterTokenError(body, headers.Authorization, 'kis-overseas priceDetail')) {
        attempt++;
        continue;
      }
      throw new PriceDetailUnavailableError(
        `KIS overseas priceDetail ${symbol}: ${res.status}` + (isKisRateLimited(res) ? ' (레이트리밋 — 백오프 재시도 소진)' : ''),
      );
    }
    const data: unknown = await res.json();
    return parsePriceDetail(data, symbol);
  }
}

// ── 잔고 조회 ────────────────────────────────────────────────────────────────
async function fetchBalancesForExchange(
  excd: OverseasExchange,
  cano: string,
  acntPrdt: string,
  trId: string,
): Promise<{ items: Record<string, string>[] }> {
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
    // (T-132) 게이트웨이 일시 오류 재시도 — 멱등한 읽기 전용 조회에만 켠다.
    res = await kisFetch(url, { headers }, { label: 'overseas getBalances', transientRetries: 2 });
    if (res.ok) break;
    body = await res.text().catch(() => '');
    if (attempt === 0 && await shouldRetryAfterTokenError(body, headers.Authorization, `kis-overseas getBalances(${excd})`)) {
      attempt++;
      continue;
    }
    throw new Error(`KIS overseas getBalances(${excd}): ${res.status} body=${body.slice(0, 200)}`);
  }
  const data = await res.json();
  /**
   * (T-132) HTTP 200 + `rt_cd≠'0'` 를 성공으로 보지 않는다.
   *
   * 여기서는 국내보다 위험하다 — 아래 `return { items: data.output1 ?? [] }` 는 업무 실패 응답을
   * **"보유 종목 없음"** 으로 바꿔 놓고, 빈 보유는 정상 상태와 구분되지 않는다. 그 총액은 해외 보유가
   * 통째로 빠진 값이 되고(T-012 유형 B), 지금은 sanity guard 4단(`checkHoldingVanished`)이 마지막에
   * 막아 주지만 그 결과는 "거부 = 실명" 이다. 원천에서 실패로 만드는 것이 맞다.
   */
  if (data?.rt_cd != null && data.rt_cd !== '0') {
    throw new Error(
      `KIS overseas getBalances(${excd}): 200 업무실패 rt_cd=${data.rt_cd} `
      + `msg_cd=${data.msg_cd ?? '-'} msg=${String(data.msg1 ?? '').trim().slice(0, 120)}`,
    );
  }
  if (process.env.KIS_OVERSEAS_DEBUG === '1') {
    const allItems: Record<string, string>[] = data.output1 ?? [];
    console.log(`[kis-overseas getBalances(${excd}) raw] rt_cd=`, data.rt_cd, 'msg=', data.msg1, 'total_items=', allItems.length);
    allItems.forEach((item: Record<string, string>, idx: number) => {
      const { ovrs_pdno, ovrs_cblc_qty, ord_psbl_qty, ovrs_excg_cd, loan_type_cd, prdt_type_cd, cano, acnt_prdt_cd } = item;
      console.log(`  [${excd}][${idx}] cano=${cano}-${acnt_prdt_cd} pdno=${ovrs_pdno} excg=${ovrs_excg_cd} cblc_qty=${ovrs_cblc_qty} ord_psbl_qty=${ord_psbl_qty} loan_type=${loan_type_cd} prdt_type=${prdt_type_cd}`);
    });
  }
  // T-056: TTTS3012R `output2` 에는 예수금 필드가 없다(실측) — 여기서 USD 를 읽지 않는다. 예수금은 `getUsdCash()`.
  return { items: data.output1 ?? [] };
}

/**
 * 해외주식 **보유 종목** 조회. USD 예수금 행은 만들지 않는다(T-056 — `getUsdCash()` 로 분리).
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
  // 🔴 T-027 — 국내 어댑터와 동일. `quantity <= 0` 은 비-number 를 못 거른다(`'3.7' <= 0 → false`).
  //    해외는 `adjPrice <= 0` 가드가 뒤에 한 겹 더 있어 실도달이 어려웠지만, 두 어댑터가 같은
  //    규칙을 쓰지 않으면 한쪽만 고친 상태가 다시 결함의 구조가 된다.
  //    기존 문구는 그대로 유지된다(`context` 인자) — 분류 정규식·운영 로그가 걸려 있다.
  const badQty = unusableQuantityReason(quantity, '해외는 USD 가격·수량 필수');
  if (badQty) return { ok: false, error: badQty };

  // 🔴 T-027 (Reviewer MEDIUM-1) — 국내에만 있던 price 유한성 가드를 해외에도 대칭으로 둔다.
  //    아래 `adjPrice <= 0` 는 `NaN` 은 막지만(`NaN > 0` → false) **`Infinity` 는 통과시킨다**
  //    (`Infinity > 0` → true) → `OVRS_ORD_UNPR: "Infinity"` 라는 쓰레기 payload 가 라이브로
  //    나간다. 국내의 `ORD_UNPR:"NaN"` 과 정확히 같은 클래스다. 특히 **매도는 상위 한도 검사를
  //    건너뛰므로**(청산 우선 정책) 해외 매도에서는 이 가드가 유일한 방어선이다.
  //
  //    ⚠️ 두 가지가 국내와 다르다.
  //    ① **`type` 으로 스코프하지 않는다.** 국내는 시장가면 `ORD_UNPR:'0'` 이라 price 를 아예
  //       쓰지 않지만, KIS 해외는 시장가를 지원하지 않아 `ORD_DVSN:'00'`(지정가) 고정이고
  //       시장가도 `usdPrice` 에서 공격적 호가를 파생시킨다 — 즉 **모든 주문이 price 를 쓴다.**
  //    ② quantity 와 달리 **느슨하게(`Number(...)`) 판정한다.** mysql2 가 DECIMAL 을 문자열로
  //       돌려주므로 `'280000'` 은 오늘 정상 송신되는 값이다. 엄격하게 가면 해외 매도가 끊기고,
  //       청산을 막는 것은 이 결함보다 훨씬 무겁다.
  //
  //    `<= 0` 은 여전히 아래 `adjPrice` 가드가 담당한다 — 현행 동작을 바꾸지 않는다.
  if (!Number.isFinite(Number(krwPrice))) {
    // 값 자체는 `trade_logs.submit_attempt` 에 원본 req 로 남으므로 여기서는 타입만 적는다.
    return { ok: false, error: `price 타입 오류: 유한한 숫자가 아님 (${typeof krwPrice})` };
  }

  // KIS 해외 주문은 지정가(ORD_DVSN='00')만 지원 — '01'은 장전시간외(오류 유발).
  // 가격은 USD 단가: ticker.price가 KRW로 환산되어 있으므로 FX로 역산.
  const verifiedUsd = req.verifiedAdaptiveLimitUsd;
  if (verifiedUsd !== undefined && (!isBuy || req.type !== 'limit' || !Number.isFinite(verifiedUsd) || verifiedUsd <= 0)) {
    return { ok: false, error: '검증된 USD 지정가가 유효하지 않습니다.' };
  }
  const fx = verifiedUsd === undefined ? await fetchUsdKrwRate().catch(() => 1400) : 1;
  const usdPrice = krwPrice > 0 ? krwPrice / fx : 0;
  // market 주문은 매도 -0.5% / 매수 +0.5% 공격적 호가로 즉시 체결 유도.
  const adjPrice = verifiedUsd ?? (usdPrice > 0
    ? (req.type === 'market'
        ? (isBuy ? usdPrice * 1.005 : usdPrice * 0.995)
        : usdPrice)
    : 0);
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
 *
 * ## 🔴 연속조회(페이지네이션) 처리 (T-023)
 *
 * kis-domestic.ts의 getActiveOrders와 같은 이유·같은 프로토콜(필드 접미사만 FK200/NK200)
 * — 상세 설명은 그쪽 주석 참조.
 */
const MAX_ACTIVE_ORDERS_PAGES = 20;

export async function getActiveOrders(): Promise<{ orderId: string; symbol: string }[]> {
  const trId = isMock() ? 'VTTS3018R' : 'TTTS3018R';
  const defaultExcd = activeOrderExchanges()[0];
  const [cano, acntPrdt] = await Promise.all([accountNo(), accountProduct()]);

  const allRows: Record<string, string>[] = [];
  let fk200 = '';
  let nk200 = '';
  let trCont = '';

  for (let page = 0; page < MAX_ACTIVE_ORDERS_PAGES; page++) {
    const params = new URLSearchParams({
      CANO:           cano,
      ACNT_PRDT_CD:   acntPrdt,
      OVRS_EXCG_CD:   toOvrsExcgCd(defaultExcd),
      SORT_SQN:       'DS',
      CTX_AREA_FK200: fk200,
      CTX_AREA_NK200: nk200,
    });
    const headers = await kisHeaders(trId, { tr_cont: trCont });
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
      console.warn(`[kis-overseas getActiveOrders] page=${page} rt_cd=0 인데 output 이 없다 — 이 페이지 0건으로 간주`);
    } else if (!Array.isArray(rows)) {
      throw new Error(`KIS overseas getActiveOrders(${defaultExcd}): output 형식 이상 (${typeof rows}) — 0건과 구분 불가`);
    } else {
      allRows.push(...(rows as Record<string, string>[]));
    }

    const respTrCont = res.headers.get('tr_cont') ?? '';
    if (respTrCont !== 'M' && respTrCont !== 'F') break;

    if (page === MAX_ACTIVE_ORDERS_PAGES - 1) {
      throw new Error(
        `KIS overseas getActiveOrders(${defaultExcd}): 페이지 상한(${MAX_ACTIVE_ORDERS_PAGES})에 `
        + `도달했는데 tr_cont=${respTrCont}(계속) — ${allRows.length}건만 모은 채 불완전하여 실패로 처리`,
      );
    }
    fk200 = String(data.ctx_area_fk200 ?? '');
    nk200 = String(data.ctx_area_nk200 ?? '');
    trCont = 'N';
  }

  return allRows
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
 *
 * ## 🔴 연속조회(페이지네이션) 처리 (T-071 WP-1, 설계 v2-3 / reviewer R-04)
 *
 * 예전에는 **첫 페이지만** 읽었다. 대상 주문이 2페이지에 있으면 `order-sync` 에는
 * "체결목록에 없다"로 보이고, 지정가(그리고 T-071 이후로는 해외 market 도)는 그 부재를
 * 근거로 **실제로 체결된 주문을 `cancelled` 로 오판**할 수 있었다.
 *
 * `getActiveOrders` 와 같은 프로토콜로 다음 페이지를 **따라간다**: 응답 헤더 `tr_cont` 가
 * `M`/`F` 이면 `ctx_area_fk200/nk200` 을 넘겨 `tr_cont:'N'` 으로 다시 요청하고 행을 합친다.
 * "다음 페이지 신호면 바로 실패"로 하지 않은 이유: `tr_cont` 의미가 미체결 조회와 다르면
 * (상시 `M` 등 — 실응답 미확인) 모든 해외 심볼이 영구 보류에 빠진다. 대신 **상한
 * ({@link MAX_COMPLETED_ORDERS_PAGES})을 넘을 때만** 던진다 — 잘린 목록을 성공으로
 * 위장하지 않는다(→ `order-sync` 의 `completed_query_failed` 보류). 중간 페이지 하나라도
 * 실패하면 전체 실패다(부분 결과로 판정하지 않는다).
 *
 * 토큰 만료 1회 재발급은 **페이지 단위**로 유지한다(첫 페이지 동작 불변).
 */
export const MAX_COMPLETED_ORDERS_PAGES = 10;

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
  const allRows: Record<string, string>[] = [];
  let trCont = '';
  for (let page = 0; ; page++) {
    let attempt = 0;
    let res: Response;
    for (;;) {
      // 첫 페이지는 예전과 똑같은 헤더(연속조회 헤더 없음), 이후 페이지만 `tr_cont:'N'`.
      const headers = await kisHeaders(trId, trCont ? { tr_cont: trCont } : undefined);
      const url = `${BASE()}/uapi/overseas-stock/v1/trading/inquire-ccnl?${params}`;
      res = await kisFetch(url, { headers }, { label: 'overseas getCompletedOrders' });
      if (!res.ok) {
        const body = kisBodyText(res) ?? await res.text().catch(() => '');
        if (attempt === 0 && await shouldRetryAfterTokenError(body, headers.Authorization, 'kis-overseas getCompletedOrders')) {
          attempt++;
          continue;
        }
        throw new Error(
          `KIS overseas getCompletedOrders ${symbol}: ${res.status} body=${body.slice(0, 300)}`
          + (page > 0 ? ` (연속조회 page=${page})` : '')
          + (isKisRateLimited(res) ? ' (레이트리밋 — 백오프 재시도 소진)' : ''),
        );
      }
      break;
    }
    const data = await res.json();
    if (process.env.KIS_OVERSEAS_DEBUG === '1') {
      console.log('[kis-overseas getCompletedOrders raw] rt_cd=', data.rt_cd,
        'symbol=', symbol, 'page=', page, 'tr_cont=', res.headers.get('tr_cont') ?? '',
        'output[0]=', JSON.stringify(data.output?.[0] ?? null));
    }
    if (data.rt_cd !== '0') {
      throw new Error(
        `KIS overseas getCompletedOrders ${symbol}: rt_cd=${data.rt_cd} msg_cd=${data.msg_cd ?? '-'} `
        + `msg=${String(data.msg1 ?? '').trim().slice(0, 200)}`,
      );
    }
    const rows = data.output;
    if (rows == null) {
      // rt_cd='0' + 목록 없음 = 이 페이지 0건 (첫 페이지면 체결 0건 — 기존 동작)
    } else if (!Array.isArray(rows)) {
      throw new Error(`KIS overseas getCompletedOrders ${symbol}: output 형식 이상 (${typeof rows}) — 0건과 구분 불가`);
    } else {
      allRows.push(...(rows as Record<string, string>[]));
    }

    const respTrCont = res.headers.get('tr_cont') ?? '';
    if (respTrCont !== 'M' && respTrCont !== 'F') break;
    if (page >= MAX_COMPLETED_ORDERS_PAGES - 1) {
      throw new Error(
        `KIS overseas getCompletedOrders ${symbol}: 페이지 상한(${MAX_COMPLETED_ORDERS_PAGES})에 `
        + `도달했는데 tr_cont=${respTrCont}(계속) — ${allRows.length}건만 모은 채 불완전하여 실패로 처리`,
      );
    }
    params.set('CTX_AREA_FK200', String(data.ctx_area_fk200 ?? ''));
    params.set('CTX_AREA_NK200', String(data.ctx_area_nk200 ?? ''));
    trCont = 'N';
  }
  return allRows
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

// ── T-087 (T-081 WP-D1a) 브로커 원장 조회(읽기 전용 GET) — 구현은 kis-overseas-ledger.ts ──
// 위 함수들(getCompletedOrders·getBalances·getUsdCash 등)의 동작·시그니처는 바꾸지 않았다. 원장 조회는 order-sync·킬스위치·스냅샷 경로에서 쓰지 않는다.
export { getDailyOrderFills, getPeriodProfit, getPositionSnapshot } from './kis-overseas-ledger';
