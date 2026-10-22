/**
 * T-070 KIS 일봉 한 페이지 조회 — **읽기 전용 GET**, USD 원값(KRW 환산 없음), 수정주가 모드 명시.
 *
 *  - 해외: HHDFS76240000 `/uapi/overseas-price/v1/quotations/dailyprice` (GUBN=0 일봉, MODP=1 수정주가 / 0 원주가).
 *    BYMD(기준일)부터 과거로 최대 100행을 최신→과거 순으로 준다(ADP-006 C01 빌더 실측 100행/호출).
 *    연속조회는 BYMD 를 "받은 가장 오래된 날 − 1일"로 옮겨 다시 부르는 방식이다(daily-bars-paginate).
 *  - 국내: FHKST03010100 `/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice`
 *    (FID_PERIOD_DIV_CODE=D, FID_ORG_ADJ_PRC=0 수정주가 / 1 원주가). 호출당 최대 행수가 고정 100 인지 **실측 전**이라
 *    한 번에 요청하는 기간을 달력 139일(평일 ≤ 99일)로 제한한다 — 응답 행 순서·상한과 무관하게 그 기간 전체를 받는다.
 *    호출당 실제 행수는 결과의 rowsPerCall 로 남겨 Leader 스모크에서 기록한다.
 *
 * 경로 규칙(T-070 금지·안전): `src/lib/exchanges/` 는 수정하지 않고 **읽기 경로만** 가져온다 —
 *   `kisFetch`(유량 스로틀·레이트리밋 백오프 단일 관문, bulk 레인 명시), `getKisToken`(기존 토큰 캐시 — 이 모듈은 토큰 발급 코드를 갖지 않는다),
 *   `kisBaseUrl`, `parseOverseas`. 주문·잔고 함수는 가져오지 않는다(격리 시험 `__tests__/isolation.test.ts`).
 *   토큰 만료 응답이어도 토큰 무효화·재발급 함수를 부르지 않고 `auth` 오류로 실행을 멈춘다.
 */
import { getKisToken, kisBaseUrl } from '@/lib/exchanges/kis-auth';
import { kisFetch, isKisRateLimited } from '@/lib/exchanges/kis-http';
import { parseOverseas } from '@/lib/exchanges/kis-symbols';
import { getCredential } from '@/lib/credentials';
import { normalizeBar, type AdjMode, type RawBar } from './daily-bars-quality';
import { addDays, marketLocal, ymdCompact, ymdFromCompact, type BarMarket } from './daily-bars-time';

export const OVERSEAS_DAILY_TR = 'HHDFS76240000';
export const DOMESTIC_DAILY_TR = 'FHKST03010100';
export const OVERSEAS_DAILY_PATH = '/uapi/overseas-price/v1/quotations/dailyprice';
export const DOMESTIC_DAILY_PATH = '/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice';
/** 국내 한 번 요청 기간(달력 일수 − 1). 20주 − 1일 = 평일 최대 99일. */
export const DOMESTIC_RANGE_DAYS = 139;
export const KIS_DAILY_TIMEOUT_MS = 10_000;
/** 토큰 무효·만료 msg_cd — 재발급하지 않고 실행을 멈춘다. */
const AUTH_MSG_CODES = new Set(['EGW00121', 'EGW00123', 'EGW00133']);

export const SOURCE_BY_MARKET: Record<BarMarket, string> = { US: 'kis_dailyprice', KR: 'kis_itemchartprice' };

export interface PageRequest {
  market: BarMarket;
  symbol: string;
  /** 이 날짜(포함)까지의 과거를 요청. null 이면 오늘 기준. */
  endDate: string | null;
  /** 이보다 과거는 필요 없다(국내는 요청 기간 하한으로 쓴다). */
  stopAt: string;
  adjMode: AdjMode;
}

export interface PageResult {
  /** 받은 순서 그대로(KIS 관례: 최신→과거), 검증 통과 행만 */
  rows: RawBar[];
  /** output2 원래 행 수(빈 행 포함) — 호출당 행수 실측용 */
  rawCount: number;
  /** 검증 실패로 버린 행 수 */
  dropped: number;
  /** 국내: 이번 요청이 빠짐없이 덮은 기간의 시작일. 해외: null(받은 가장 오래된 날이 하한) */
  coveredFrom: string | null;
}

export type FetchDailyPage = (req: PageRequest) => Promise<PageResult>;

export type KisDailyErrorKind = 'rate_limited' | 'auth' | 'http' | 'rt_cd' | 'parse';

export class KisDailyError extends Error {
  constructor(public readonly kind: KisDailyErrorKind, detail: string) {
    super(`kis_daily_${kind}: ${detail}`.slice(0, 200));
    this.name = 'KisDailyError';
  }
}

async function readHeaders(trId: string): Promise<Record<string, string>> {
  const [token, appkey, appsecret] = await Promise.all([
    getKisToken(),
    getCredential('KIS_APP_KEY'),
    getCredential('KIS_APP_SECRET'),
  ]);
  return {
    'Content-Type': 'application/json; charset=utf-8',
    Authorization: `Bearer ${token}`,
    appkey,
    appsecret,
    tr_id: trId,
    custtype: 'P',
  };
}

/** 모든 값이 비어 있는 행(KIS 가 데이터 없음을 빈 행으로 줄 때) — 형식 오류로 세지 않는다. */
function isBlankRow(r: unknown): boolean {
  if (!r || typeof r !== 'object') return true;
  return Object.values(r as Record<string, unknown>).every((v) => v === null || v === undefined || String(v).trim() === '');
}

/**
 * 해외 output2 → RawBar (USD 원값 그대로). (R-5) 날짜(xymd)가 없는데 다른 값이 있는 행은 형식 이상으로 dropped 에 센다
 * (필드 이름이 바뀌면 전부 여기로 와서 fetchKisDailyPage 가 parse 오류로 올린다). 전부 빈 행만 건너뛴다.
 */
export function parseOverseasRows(output2: unknown): { rows: RawBar[]; rawCount: number; dropped: number } {
  const list = Array.isArray(output2) ? (output2 as Record<string, unknown>[]) : [];
  const rows: RawBar[] = [];
  let dropped = 0;
  for (const r of list) {
    if (isBlankRow(r)) continue;
    if (!r.xymd) { dropped++; continue; }
    const bar = normalizeBar({
      tradeDate: ymdFromCompact(r.xymd), open: r.open, high: r.high, low: r.low, close: r.clos, volume: r.tvol, turnover: r.tamt,
    });
    if (bar) rows.push(bar); else dropped++;
  }
  return { rows, rawCount: list.length, dropped };
}

/** 국내 output2 → RawBar (원 단위 그대로). 날짜 없는 비어 있지 않은 행은 dropped(R-5). */
export function parseDomesticRows(output2: unknown): { rows: RawBar[]; rawCount: number; dropped: number } {
  const list = Array.isArray(output2) ? (output2 as Record<string, unknown>[]) : [];
  const rows: RawBar[] = [];
  let dropped = 0;
  for (const r of list) {
    if (isBlankRow(r)) continue;
    if (!r.stck_bsop_date) { dropped++; continue; }
    const bar = normalizeBar({
      tradeDate: ymdFromCompact(r.stck_bsop_date), open: r.stck_oprc, high: r.stck_hgpr, low: r.stck_lwpr,
      close: r.stck_clpr, volume: r.acml_vol, turnover: r.acml_tr_pbmn,
    });
    if (bar) rows.push(bar); else dropped++;
  }
  return { rows, rawCount: list.length, dropped };
}

/** 요청 URL(시험에서 매개변수를 확인할 수 있게 분리). */
export function buildDailyUrl(req: PageRequest, now: Date = new Date()): { url: string; trId: string; coveredFrom: string | null } {
  const base = kisBaseUrl();
  if (req.market === 'US') {
    const { excd, ticker } = parseOverseas(req.symbol);
    const params = new URLSearchParams({
      AUTH: '', EXCD: excd, SYMB: ticker,
      GUBN: '0',                                        // 0=일봉
      BYMD: req.endDate ? ymdCompact(req.endDate) : '', // 빈값=오늘 기준
      MODP: req.adjMode === 'adjusted' ? '1' : '0',     // 1=수정주가
    });
    return { url: `${base}${OVERSEAS_DAILY_PATH}?${params}`, trId: OVERSEAS_DAILY_TR, coveredFrom: null };
  }
  const end = req.endDate ?? marketLocal('KR', now).date;
  const floor = addDays(end, -DOMESTIC_RANGE_DAYS);
  const start = req.stopAt > floor ? req.stopAt : floor;
  const params = new URLSearchParams({
    FID_COND_MRKT_DIV_CODE: 'J',
    FID_INPUT_ISCD: req.symbol,
    FID_INPUT_DATE_1: ymdCompact(start),
    FID_INPUT_DATE_2: ymdCompact(end),
    FID_PERIOD_DIV_CODE: 'D',
    FID_ORG_ADJ_PRC: req.adjMode === 'adjusted' ? '0' : '1',   // 0=수정주가
  });
  return { url: `${base}${DOMESTIC_DAILY_PATH}?${params}`, trId: DOMESTIC_DAILY_TR, coveredFrom: start };
}

/**
 * 실제 KIS 한 페이지. 유량 대기 실패(`KisThrottle*Error`)는 그대로 던진다(호출자가 실행을 멈춘다).
 * @throws {KisDailyError}
 */
export const fetchKisDailyPage: FetchDailyPage = async (req) => {
  const { url, trId, coveredFrom } = buildDailyUrl(req);
  const headers = await readHeaders(trId);
  const res = await kisFetch(url, { headers }, {
    priority: 'bulk', timeoutMs: KIS_DAILY_TIMEOUT_MS, label: `profit-engine daily-bars ${req.market}`,
  });
  if (isKisRateLimited(res)) throw new KisDailyError('rate_limited', `status=${res.status}`);
  if (res.status === 401 || res.status === 403) throw new KisDailyError('auth', `status=${res.status}`);
  let data: Record<string, unknown>;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new KisDailyError(res.ok ? 'parse' : 'http', `status=${res.status}`);
  }
  const msgCd = typeof data?.msg_cd === 'string' ? data.msg_cd : '';
  if (AUTH_MSG_CODES.has(msgCd)) throw new KisDailyError('auth', `msg_cd=${msgCd}`);
  if (!res.ok) throw new KisDailyError('http', `status=${res.status}${msgCd ? ` msg_cd=${msgCd}` : ''}`);
  if (data.rt_cd !== '0') throw new KisDailyError('rt_cd', `rt_cd=${String(data.rt_cd)} msg_cd=${msgCd}`);
  const parsed = req.market === 'US' ? parseOverseasRows(data.output2) : parseDomesticRows(data.output2);
  // (R-5) 행은 왔는데 하나도 해석하지 못했다 = 응답 형식이 바뀌었거나 값이 깨졌다 → 빈 페이지(상장 전)로 오인하지 않는다
  if (parsed.rows.length === 0 && parsed.dropped > 0) {
    throw new KisDailyError('parse', `rows=0 raw=${parsed.rawCount} dropped=${parsed.dropped}`);
  }
  return { ...parsed, coveredFrom };
};
