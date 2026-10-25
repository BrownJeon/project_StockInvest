/**
 * T-087 (T-081 WP-D1a) — KIS 원장 응답 → 정규화 행 · 자연키 · 합계 대조 · run 완전성 판정(**순수 함수**).
 *
 * 이 모듈은 DB·네트워크·안전장치(`@/lib/db`·`@/lib/safety`)를 import 하지 않는다(정적 시험으로 고정). 거래소 모듈은 **타입만** 가져온다.
 * 수집기(Dev-2 `collector.ts`)가 이 위에서 트랜잭션 upsert 를 한다.
 *
 * 설계 정본: `docs/design/2026-10-25-wpd-broker-fills-design.md` v3.1 — §2.3(열 의미·민감 필드)·§3.1(자연키)·§3.2(쓰기 계약 중 순수 부분)·
 * §3.4(complete 정의·합계 대조 규칙·허용치)·§3.5(조회 창·날짜 기준). DDL: `scripts/migrations/T-081-wpd-broker-fills.sql`.
 *
 * ## fail-closed 원칙(이 파일 전체)
 *  - 값을 지어내지 않는다. 필수 값이 없거나 형식이 다르면 그 행은 **정규화 실패(issue)** 로 돌려주고 행을 만들지 않는다 → 수집기는 run 을
 *    `incomplete` 로 닫는다. `Number('')` = 0 같은 변환을 쓰지 않는다(`decimal.ts`).
 *  - 잔량을 읽을 수 없으면 `settle_state='unknown'`(가짜 0 금지). 환율은 수집기가 쓰지 않는다(USD `amount_krw_est` = null).
 *  - `issue` 와 `reasons` 에는 **값을 넣지 않는다**(필드 이름·사유 코드만) — run.error·로그에 그대로 쓸 수 있다.
 */
import type { LedgerQueryResult } from '@/lib/exchanges/kis-ledger-query';
import { parseDec, toDbDecimal, equalAt2dp, withinRelative, mulDiv } from './decimal';
import { rawHashOf } from './hash';
import type {
  BrokerCurrency, BrokerFillRow, BrokerMarket, BrokerPositionSnapshotRow, BrokerRealizedPnlRow, BrokerRunKind, BrokerSide,
  CompletenessInput, CompletenessResult, FeeEstimate, NormalizeBatch, NormalizeIssue, NormalizedFill, NormalizedPositionSnapshot,
  NormalizedRealizedPnl, PositiveCheck, RawLedgerBatch, SettleState, SumCheckResult,
} from './types';

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 날짜·창 (KST)
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** KST(UTC+9) 날짜 `YYYY-MM-DD`. */
export function kstDate(ms: number): string {
  return new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` 가 실제 달력 날짜이고 DDL 날짜 CHECK 범위(2000-01-01~2100-12-31) 안인가. */
export function isIsoDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const y = Number(s.slice(0, 4)), m = Number(s.slice(5, 7)), d = Number(s.slice(8, 10));
  if (y < 2000 || y > 2100) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function addDaysIso(date: string, n: number): string {
  if (!isIsoDate(date)) throw new RangeError(`날짜 형식 오류: ${String(date)}`);
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 국내 3개월 이내 TR(TTTC0081R) 창 한도 — DDL `chk_bfr_3m_tr` 와 같은 85일(설계 L-3). */
export const DOMESTIC_FILLS_WINDOW_DAYS = 85;

/** DDL `chk_bfr_3m_tr` 와 같은 판정: `query_from >= DATE(started_at) − 85일`. 밖이면 KIS 를 부르지도 run 을 쓰지도 않는다(L-c). */
export function withinDomesticFillsTrWindow(queryFrom: string, startedAtKstDate: string): boolean {
  return queryFrom >= addDaysIso(startedAtKstDate, -DOMESTIC_FILLS_WINDOW_DAYS);
}

/**
 * 커버리지 주장 창(window) → 실제 KIS 조회 범위(query). 설계 §3.5(M5): 해외 조회는 현지 날짜 기준일 수 있어(미확인) **체결·기간손익 모두 ±1일**,
 * 국내는 그대로. 잔고 스냅샷은 하루 창만(DDL `chk_bfr_snapshot`). 커버리지 주장은 window 로만 한다.
 */
export function queryRangeForWindow(
  market: BrokerMarket, kind: BrokerRunKind, windowFrom: string, windowTo: string,
): { queryFrom: string; queryTo: string } {
  if (!isIsoDate(windowFrom) || !isIsoDate(windowTo)) throw new RangeError(`창 날짜 형식 오류: ${String(windowFrom)}~${String(windowTo)}`);
  if (windowFrom > windowTo) throw new RangeError(`창 시작이 끝보다 늦다: ${windowFrom}~${windowTo}`);
  if (kind === 'position_snapshot') {
    if (windowFrom !== windowTo) throw new RangeError('잔고 스냅샷 창은 하루만');
    return { queryFrom: windowFrom, queryTo: windowTo };
  }
  if (market === 'overseas') return { queryFrom: addDaysIso(windowFrom, -1), queryTo: addDaysIso(windowTo, 1) };
  return { queryFrom: windowFrom, queryTo: windowTo };
}

/**
 * (T-087 Codex C2 High) 응답 **행 날짜**의 허용 범위 — 체결 `order_date`·기간손익 `trade_date` 가 실제로 보낸 조회 범위 안인가.
 * 목적은 "날짜 파라미터를 무시한 응답·오래된 응답" 같은 **거칠게 틀린 응답**을 거르는 것이지 하루 단위 정밀 검증이 아니다.
 *  - 국내: `[queryFrom, queryTo]` 엄격(국내 조회 날짜와 행의 `ord_dt`·`trad_dt` 는 같은 KST 기준).
 *  - 해외: `[queryFrom − 1일, queryTo + 1일]`. 행의 `order_date` 는 DDL 의미상 **KST 주문일**(`dmst_ord_dt`)인데 KIS 조회 날짜 기준은 현지일일 수 있다
 *    (미확인 가정 ⑥). KST = 미국 현지 + 13~14시간이라 KST 날짜는 현지 날짜와 같거나 **하루 늦다** — 현지 `queryTo` 저녁 주문은 KST `queryTo+1` 이다
 *    (캡처: `dmst_ord_dt` 가 `ord_dt` 보다 하루 뒤인 행이 KST 01시대 주문과 일치). 반대쪽 −1일은 기준이 KST 이고 현지 날짜로 온 경우를 대칭으로 둔 여유다.
 *    기간손익 `trade_date`(`trad_day`)가 어느 기준인지는 모른다 — 같은 허용폭을 쓴다.
 *  - 잔고 스냅샷: 해당 없음(null) — 조회일 검사는 수집기의 `snapshot_date_mismatch` 가 이미 한다.
 * DB 에는 행 날짜 ↔ run 조회 범위 CHECK 가 없다 — 이 검사는 DB 보다 엄격한 쪽이다.
 */
export function rowDateBounds(market: BrokerMarket, kind: BrokerRunKind, queryFrom: string, queryTo: string): { from: string; to: string } | null {
  if (kind === 'position_snapshot') return null;
  if (!isIsoDate(queryFrom) || !isIsoDate(queryTo) || queryFrom > queryTo) throw new RangeError('조회 범위 형식 오류');
  if (market === 'overseas') return { from: addDaysIso(queryFrom, -1), to: addDaysIso(queryTo, 1) };
  return { from: queryFrom, to: queryTo };
}

/** 항목을 날짜 범위 안/밖으로 나눈다(밖 = 원장에 쓰지 않는다). 날짜를 읽을 수 없는 항목도 밖으로 센다(fail-closed). `bounds` 가 null 이면 전부 안. */
export function splitByRowDate<T>(items: readonly T[], dateOf: (t: T) => string, bounds: { from: string; to: string } | null): { inRange: T[]; outOfRange: number } {
  if (!bounds) return { inRange: [...items], outOfRange: 0 };
  const inRange: T[] = [];
  let outOfRange = 0;
  for (const it of items) {
    const d = dateOf(it);
    if (isIsoDate(d) && d >= bounds.from && d <= bounds.to) inRange.push(it); else outOfRange += 1;
  }
  return { inRange, outOfRange };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// TR·tr_cont·초기 상태
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** DDL `chk_bfr_kind_tr`·`chk_bfr_market_tr` 와 같은 짝(LIKE `_` = 한 글자 — 실전 T/모의 V). 이 판정은 대문자만 받는다(DB 보다 엄격). */
const KIND_TR: Record<BrokerRunKind, RegExp[]> = {
  fills:             [/^.TTC0081R$/, /^.TTS3035R$/, /^CTSC9215R$/],
  realized_pnl:      [/^.TTC8708R$/, /^.TTS3039R$/],
  position_snapshot: [/^.TTC8434R$/, /^.TRP6504R$/],
};
const MARKET_TR: Record<BrokerMarket, RegExp[]> = {
  domestic: [/^.TTC/, /^CTSC/],
  overseas: [/^.TTS/, /^.TRP/],
};

export function sourceTrMatches(market: BrokerMarket, kind: BrokerRunKind, sourceTr: string): boolean {
  return KIND_TR[kind].some((re) => re.test(sourceTr)) && MARKET_TR[market].some((re) => re.test(sourceTr));
}

export function isContinuationTrCont(v: string | null): boolean {
  return v === 'M' || v === 'F';
}

export function isTerminalTrCont(v: string | null): boolean {
  return v === 'D' || v === 'E';
}

/**
 * `broker_fill_runs.last_tr_cont`(CHAR(1) utf8mb4_bin)에 넣을 값. 빈 헤더 = NULL(설계: '' 가 아니라 NULL).
 * 두 글자 이상 같은 이상한 값은 열에 맞지 않아 NULL 로 두되, **완전성 판정은 원문으로** 한다({@link assessRunCompleteness}) — NULL 로 바꿨다고 complete 가 되지 않는다.
 */
export function trContDbValue(raw: string | null | undefined): string | null {
  const t = (raw ?? '').trim();
  return t.length === 1 ? t : null;
}

/** 수집기가 run 을 만들 때 쓰는 `positive_check` 초기값 — 스냅샷 `n/a`, 그 밖 `pending`. `confirmed`/`unconfirmed` 는 D2 만 쓴다(L-e). */
export function initialPositiveCheck(kind: BrokerRunKind): Extract<PositiveCheck, 'pending' | 'n/a'> {
  return kind === 'position_snapshot' ? 'n/a' : 'pending';
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 필드 판독 도우미 — 값은 issue 에 넣지 않는다
// ─────────────────────────────────────────────────────────────────────────────────────────────

class RowReader {
  readonly issues: NormalizeIssue[] = [];
  constructor(private readonly raw: Record<string, unknown>, private readonly index: number) {}

  fail(reason: string, field?: string): void {
    this.issues.push(field ? { index: this.index, reason, field } : { index: this.index, reason });
  }

  /** 문자열 원문(앞뒤 공백 제거). 키 없음·null → undefined, 문자열이 아니면(숫자 제외) issue. */
  str(field: string): string | undefined {
    const v = this.raw[field];
    if (v == null) return undefined;
    if (typeof v === 'string') return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    this.fail('not_string', field);
    return undefined;
  }

  /** 비어 있지 않은 필수 문자열. */
  required(field: string): string | null {
    const s = this.str(field);
    if (s === undefined || s === '') { this.fail('missing', field); return null; }
    return s;
  }

  /** 선택 문자열(빈 값 → null). 코드 열은 길이를 넘으면 issue(DB 가 잘라 넣게 두지 않는다). */
  code(field: string, maxLen: number): string | null {
    const s = this.str(field);
    if (!s) return null;
    if (Array.from(s).length > maxLen) { this.fail('too_long', field); return null; }
    return s;
  }

  /** 선택 표시 문자열(빈 값 → null). 표시용이라 열 길이에 맞게 자른다(원문은 raw_json 에 남는다). */
  text(field: string, maxLen: number): string | null {
    const s = this.str(field);
    if (!s) return null;
    return Array.from(s).slice(0, maxLen).join('');
  }

  /**
   * DECIMAL(precision, scale) 값. `required` 면 없을 때 issue, 아니면 없음/빈 값 → null. 형식 이상·정수부 초과·(nonNegative 인데) 음수 → issue.
   * `defaultIfMissing` 이 주어지면 없음/빈 값 대신 그 값(체결 0 행의 단가·대금 = 0 — DDL 주석 "체결 0 이면 0").
   */
  dec(field: string, precision: number, scale: number, o: { required?: boolean; nonNegative?: boolean; defaultIfMissing?: bigint } = {}):
    { db: string | null; units: bigint | null } {
    const s = this.str(field);
    if (s === undefined || s === '') {
      if (o.defaultIfMissing !== undefined) return { db: toDbDecimal(o.defaultIfMissing, precision, scale), units: o.defaultIfMissing };
      if (o.required) this.fail('missing', field);
      return { db: null, units: null };
    }
    const u = parseDec(s);
    if (u == null) { this.fail('not_decimal', field); return { db: null, units: null }; }
    if (o.nonNegative && u < 0n) { this.fail('negative', field); return { db: null, units: null }; }
    const db = toDbDecimal(u, precision, scale);
    if (db == null) { this.fail('out_of_range', field); return { db: null, units: null }; }
    return { db, units: u };
  }

  /** KIS `YYYYMMDD` → `YYYY-MM-DD`(실제 달력 날짜·2000~2100). */
  date(field: string, required: boolean): string | null {
    const s = this.str(field);
    if (s === undefined || s === '') { if (required) this.fail('missing', field); return null; }
    if (!/^\d{8}$/.test(s)) { this.fail('bad_date', field); return null; }
    const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    if (!isIsoDate(iso)) { this.fail('bad_date', field); return null; }
    return iso;
  }

  /** KIS `HHMMSS` → `HH:MM:SS`. 빈 값 → null. 형식 이상 → issue. */
  time(field: string): string | null {
    const s = this.str(field);
    if (s === undefined || s === '') return null;
    if (!/^\d{6}$/.test(s)) { this.fail('bad_time', field); return null; }
    const h = Number(s.slice(0, 2)), m = Number(s.slice(2, 4)), sec = Number(s.slice(4, 6));
    if (h > 23 || m > 59 || sec > 59) { this.fail('bad_time', field); return null; }
    return `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4, 6)}`;
  }
}

const ORDER_NO_RE = /^[0-9A-Za-z]{1,20}$/;
/** 국내 종목코드 — 6자리 숫자가 앱 규약이지만 KRX 신규 영숫자 단축코드(예: 숫자로 시작하는 6자 영숫자)·ETN 등이 올 수 있어 영숫자 6~12자를 받는다. */
const DOMESTIC_CODE_RE = /^[0-9A-Z]{6,12}$/;
/** 해외 티커 — `kis-symbols.ts` 의 OVERSEAS_PATTERN 티커 부분과 같다(BRK.B 허용). */
const OVERSEAS_TICKER_RE = /^[A-Z][A-Z0-9.]*$/;

/**
 * 해외 거래소 코드 → 앱 접두어. KIS 는 TR 마다 4글자(NASD·NYSE·AMEX — 체결·기간손익·잔고 `ovrs_excg_cd`)와 3글자(NAS·NYS·AMS)를 섞어 쓴다.
 * 이 표에 없는 코드는 **추측하지 않고** issue(`unknown_exchange`) — 기존 어댑터의 `startsWith` 폴백(모르면 AMS)은 쓰지 않는다.
 */
const OVERSEAS_EXCHANGE: Record<string, 'NAS' | 'NYS' | 'AMS'> = {
  NASD: 'NAS', NAS: 'NAS',
  NYSE: 'NYS', NYS: 'NYS',
  AMEX: 'AMS', AMS: 'AMS',
};

/** 해외 (거래소 코드, 원문 티커) → 앱 심볼 `NAS:TICKER`. 매핑할 수 없으면 null. */
export function overseasAppSymbol(exchangeCode: string, brokerSymbol: string): string | null {
  const ex = OVERSEAS_EXCHANGE[exchangeCode.trim().toUpperCase()];
  const t = brokerSymbol.trim().toUpperCase();
  if (!ex || !OVERSEAS_TICKER_RE.test(t)) return null;
  const sym = `${ex}:${t}`;
  return sym.length <= 32 ? sym : null;
}

function sideOf(code: string | null): BrokerSide | null {
  return code === '01' ? 'sell' : code === '02' ? 'buy' : null;
}

function currencyOf(v: string | null): BrokerCurrency | null {
  return v === 'KRW' || v === 'USD' ? v : null;   // 대소문자 그대로 비교 — 'usd' 는 거부(DDL utf8mb4_bin 과 같은 규칙)
}

function settleOf(remaining: bigint | null): SettleState {
  if (remaining == null) return 'unknown';
  return remaining > 0n ? 'open' : 'closed';
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 수수료 추정(수집기 파생 — L-5: 수집기는 fee_kind IN ('unknown','estimated') 일 때만 쓴다)
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** 미국 매수·매도 각 0.25%(사용자 확정, T-067 §8.4 — `signals/paper-fill.ts` 와 같은 값). DECIMAL(8,5) 표기. */
export const OVERSEAS_FEE_RATE_PCT = '0.25000';

/** 해외 USD 행의 추정 수수료 = 체결대금 × 0.25%(소수 6자리). 국내·KRW 행은 null(D2 가 기간손익 fee 를 배분 — §4.2). */
export function estimateFee(market: BrokerMarket, currency: BrokerCurrency, fillAmountUnits: bigint): FeeEstimate | null {
  if (market !== 'overseas' || currency !== 'USD') return null;
  const fee = toDbDecimal(mulDiv(fillAmountUnits, 25n, 10_000n), 18, 6);
  if (fee == null) return null;
  return { fee_kind: 'estimated', fee_native: fee, fee_rate_pct: OVERSEAS_FEE_RATE_PCT };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 자연키 · 응답 안 중복 검사(설계 §3.1·§3.2 ①)
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * 자연키(계좌 제외 — 한 응답은 한 계좌·한 브로커). DB UNIQUE 의 콜레이션이 utf8mb4_general_ci(대소문자 무시)라 **대문자로 접어** 비교한다 —
 * 메모리에서는 다르다고 본 두 키가 DB 에서 1062 로 부딪히는 일을 막는다.
 */
export function fillKey(r: Pick<BrokerFillRow, 'market' | 'order_date' | 'broker_order_no'>): string {
  return `${r.market}|${r.order_date}|${r.broker_order_no.toUpperCase()}`;
}
export function realizedPnlKey(r: Pick<BrokerRealizedPnlRow, 'market' | 'trade_date' | 'grain' | 'symbol'>): string {
  return `${r.market}|${r.trade_date}|${r.grain}|${r.symbol.toUpperCase()}`;
}
export function positionSnapshotKey(r: Pick<BrokerPositionSnapshotRow, 'market' | 'as_of' | 'symbol'>): string {
  return `${r.market}|${r.as_of}|${r.symbol.toUpperCase()}`;
}

/**
 * 한 응답(전 페이지)의 항목을 자연키로 묶어, **겹치는 키의 항목은 전부 빼고** 겹친 키 수를 센다(설계 §3.2 ① — 덮어써서 사실을 잃는 것보다 비우는 쪽).
 * 예: 3행 중 2행이 같은 키 → writable 1, duplicateKeys 1.
 */
export function partitionDuplicates<T extends { key: string }>(items: T[]): { writable: T[]; duplicateKeys: number; duplicateKeyList: string[] } {
  const count = new Map<string, number>();
  for (const it of items) count.set(it.key, (count.get(it.key) ?? 0) + 1);
  const dup = [...count.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  const dupSet = new Set(dup);
  return { writable: items.filter((it) => !dupSet.has(it.key)), duplicateKeys: dup.length, duplicateKeyList: dup };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 정규화 — 체결(broker_fills)
// ─────────────────────────────────────────────────────────────────────────────────────────────

function normalizeFillRow(market: BrokerMarket, trId: string, raw: Record<string, unknown>, index: number):
  { item: NormalizedFill | null; issues: NormalizeIssue[] } {
  const r = new RowReader(raw, index);
  const dom = market === 'domestic';

  const orderNo = r.required('odno');
  if (orderNo != null && !ORDER_NO_RE.test(orderNo)) r.fail('bad_order_no', 'odno');
  const origRaw = r.code('orgn_odno', 20);
  if (origRaw != null && !ORDER_NO_RE.test(origRaw)) r.fail('bad_order_no', 'orgn_odno');

  const orderDate = r.date(dom ? 'ord_dt' : 'dmst_ord_dt', true);
  const localOrderDate = dom ? null : r.date('ord_dt', false);
  const orderTime = r.time('ord_tmd');

  const pdno = r.required('pdno');
  let symbol: string | null = null;
  let brokerSymbol: string | null = null;
  let exchangeCode: string | null;
  if (dom) {
    exchangeCode = r.code('excg_id_dvsn_cd', 8);
    if (pdno != null) {
      if (!DOMESTIC_CODE_RE.test(pdno)) r.fail('bad_symbol', 'pdno');
      else { symbol = pdno; brokerSymbol = pdno; }
    }
  } else {
    exchangeCode = r.code('ovrs_excg_cd', 8);
    if (exchangeCode == null) r.fail('missing', 'ovrs_excg_cd');
    if (pdno != null && exchangeCode != null) {
      symbol = overseasAppSymbol(exchangeCode, pdno);
      if (symbol == null) r.fail(OVERSEAS_EXCHANGE[exchangeCode.toUpperCase()] ? 'bad_symbol' : 'unknown_exchange', OVERSEAS_EXCHANGE[exchangeCode.toUpperCase()] ? 'pdno' : 'ovrs_excg_cd');
      else if (Array.from(pdno).length > 20) { r.fail('too_long', 'pdno'); symbol = null; }
      else brokerSymbol = pdno;
    }
  }

  const sideCode = r.required('sll_buy_dvsn_cd');
  const side = sideOf(sideCode);
  if (sideCode != null && side == null) r.fail('unknown_side', 'sll_buy_dvsn_cd');

  let currency: BrokerCurrency | null;
  if (dom) currency = 'KRW';
  else {
    const c = r.required('tr_crcy_cd');
    currency = currencyOf(c);
    if (c != null && currency == null) r.fail('unsupported_currency', 'tr_crcy_cd');
  }

  const Q = (f: string, req = false) => r.dec(f, 24, 8, { required: req, nonNegative: true });
  const orderQty = Q(dom ? 'ord_qty' : 'ft_ord_qty');
  const filled = Q(dom ? 'tot_ccld_qty' : 'ft_ccld_qty', true);
  const remaining = Q(dom ? 'rmn_qty' : 'nccs_qty');
  const cancelled = dom ? Q('cncl_cfrm_qty') : { db: null, units: null };
  const rejected = dom ? Q('rjct_qty') : { db: null, units: null };
  // 체결 0 행(미체결·취소)의 단가·대금이 비어 오면 0 — 체결이 있는데 비어 있으면 issue(다른 값으로 지어내지 않는다: 기존 어댑터의 ord_unpr 폴백 없음).
  const zeroFill = filled.units === 0n;
  const avg = r.dec(dom ? 'avg_prvs' : 'ft_ccld_unpr3', 24, 8, { required: true, nonNegative: true, defaultIfMissing: zeroFill ? 0n : undefined });
  const amount = r.dec(dom ? 'tot_ccld_amt' : 'ft_ccld_amt3', 24, 4, { required: true, nonNegative: true, defaultIfMissing: zeroFill ? 0n : undefined });

  const orderType = dom ? r.code('ord_dvsn_cd', 8) : null;
  const reviseCancel = r.code(dom ? 'cncl_yn' : 'rvse_cncl_dvsn', 4);
  const statusName = r.text(dom ? 'ccld_cndt_name' : 'prcs_stat_name', 40);
  const rejectReason = dom ? null : (r.text('rjct_rson_name', 100) ?? r.text('rjct_rson', 100));
  const fractionalHint = dom ? null : r.text('splt_buy_attr_name', 40);

  let amountKrw: string | null = null;
  if (currency === 'KRW' && amount.units != null) {
    amountKrw = toDbDecimal(amount.units, 18, 2);
    if (amountKrw == null) r.fail('out_of_range', dom ? 'tot_ccld_amt' : 'ft_ccld_amt3');
  }

  if (r.issues.length > 0 || orderNo == null || orderDate == null || symbol == null || brokerSymbol == null || side == null
      || currency == null || filled.db == null || avg.db == null || amount.db == null || amount.units == null) {
    return { item: null, issues: r.issues.length ? r.issues : [{ index, reason: 'incomplete_row' }] };
  }

  const cancelSignal = dom
    ? ((cancelled.units ?? 0n) > 0n || reviseCancel === 'Y')
    : (reviseCancel === '01' || reviseCancel === '02');

  const { rawJson, rawHash } = rawHashOf(raw);
  const row: BrokerFillRow = {
    broker: 'kis', market,
    order_date: orderDate, local_order_date: localOrderDate,
    broker_order_no: orderNo, orig_order_no: origRaw, order_time: orderTime,
    symbol, broker_symbol: brokerSymbol, exchange_code: exchangeCode,
    side, currency,
    order_qty: orderQty.db, filled_qty: filled.db, remaining_qty: remaining.db, cancelled_qty: cancelled.db, rejected_qty: rejected.db,
    avg_fill_price: avg.db, fill_amount: amount.db,
    order_type_code: orderType, revise_cancel_code: reviseCancel, broker_status_name: statusName, reject_reason: rejectReason,
    fractional_hint: fractionalHint,
    settle_state: settleOf(remaining.units),
    amount_krw_est: amountKrw,
    source_tr: trId, raw_hash: rawHash, raw_json: rawJson,
  };
  return {
    item: { row, key: fillKey(row), cancelOrReviseSignal: cancelSignal, feeEstimate: estimateFee(market, currency, amount.units) },
    issues: [],
  };
}

/** 체결 조회 응답(전 페이지) → 정규화 체결 행. 정규화하지 못한 행은 `issues`(그 행은 쓰지 않는다 → run incomplete). */
export function normalizeFills(batch: RawLedgerBatch): NormalizeBatch<NormalizedFill> {
  if (batch.kind !== 'fills') throw new TypeError(`normalizeFills: kind=${batch.kind}`);
  const items: NormalizedFill[] = [];
  const issues: NormalizeIssue[] = [];
  batch.rows.forEach((raw, i) => {
    const r = normalizeFillRow(batch.market, batch.trId, raw, i);
    if (r.item) items.push(r.item); else issues.push(...r.issues);
  });
  return { items, issues };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 정규화 — 기간손익(broker_realized_pnl)
// ─────────────────────────────────────────────────────────────────────────────────────────────

function normalizePnlRow(market: BrokerMarket, trId: string, raw: Record<string, unknown>, index: number):
  { item: NormalizedRealizedPnl | null; issues: NormalizeIssue[] } {
  const r = new RowReader(raw, index);
  const dom = market === 'domestic';
  const tradeDate = r.date(dom ? 'trad_dt' : 'trad_day', true);

  let symbol = '';
  let brokerSymbol = '';
  let exchangeCode: string | null = null;
  let currency: BrokerCurrency | null = null;
  if (dom) {
    currency = 'KRW';
  } else {
    const pdno = r.required('ovrs_pdno');
    exchangeCode = r.code('ovrs_excg_cd', 8);
    if (exchangeCode == null) r.fail('missing', 'ovrs_excg_cd');
    if (pdno != null && exchangeCode != null) {
      const s = overseasAppSymbol(exchangeCode, pdno);
      if (s == null) r.fail(OVERSEAS_EXCHANGE[exchangeCode.toUpperCase()] ? 'bad_symbol' : 'unknown_exchange', OVERSEAS_EXCHANGE[exchangeCode.toUpperCase()] ? 'ovrs_pdno' : 'ovrs_excg_cd');
      else if (Array.from(pdno).length > 20) r.fail('too_long', 'ovrs_pdno');
      else { symbol = s; brokerSymbol = pdno; }
    }
    // 행에 통화 필드가 없다(캡처). 미국 거래소(위 표)만 받으므로 원통화 = USD
    // [가능성 높음 — 매도대금 ≈ 평균매도단가 × 수량, 단가가 USD 규모임을 캡처로 확인(값 미출력). WCRC_FRCR_DVSN_CD='01' 의 공식 의미는 미확인].
    currency = 'USD';
  }

  const D = (f: string, p: number, s: number, o: { required?: boolean; nonNegative?: boolean } = {}) => r.dec(f, p, s, o).db;
  const nn = { nonNegative: true };
  const row0 = dom
    ? {
        sell_qty: D('sll_qty1', 24, 8, nn), buy_qty: D('buy_qty1', 24, 8, nn),
        sell_amount_native: D('sll_amt', 24, 4, nn), buy_amount_native: D('buy_amt', 24, 4, nn),
        avg_sell_price: null, avg_buy_price: null,
        realized_pnl_native: D('rlzt_pfls', 24, 4, { required: true }),
        fee_native: D('fee', 18, 6), tax_native: D('tl_tax', 18, 6), loan_interest_native: D('loan_int', 18, 6),
        pnl_rate_pct: D('pfls_rt', 10, 4), fx_usdkrw: null, fx_first_notice: null,
      }
    : {
        sell_qty: D('slcl_qty', 24, 8, nn), buy_qty: null,
        sell_amount_native: D('frcr_sll_amt_smtl1', 24, 4, nn), buy_amount_native: D('frcr_pchs_amt1', 24, 4, nn),
        avg_sell_price: D('avg_sll_unpr', 24, 8, nn), avg_buy_price: D('pchs_avg_pric', 24, 8, nn),
        realized_pnl_native: D('ovrs_rlzt_pfls_amt', 24, 4, { required: true }),
        fee_native: D('stck_sll_tlex', 18, 6), tax_native: null, loan_interest_native: null,
        pnl_rate_pct: D('pftrt', 10, 4), fx_usdkrw: positiveOrNull(D('exrt', 12, 4)), fx_first_notice: positiveOrNull(D('frst_bltn_exrt', 12, 4)),
      };

  if (r.issues.length > 0 || tradeDate == null || currency == null || row0.realized_pnl_native == null) {
    return { item: null, issues: r.issues.length ? r.issues : [{ index, reason: 'incomplete_row' }] };
  }
  const { rawJson, rawHash } = rawHashOf(raw);
  const row: BrokerRealizedPnlRow = {
    broker: 'kis', market, trade_date: tradeDate, grain: dom ? 'day' : 'day_symbol',
    symbol, broker_symbol: brokerSymbol, exchange_code: exchangeCode, currency,
    ...row0,
    realized_pnl_native: row0.realized_pnl_native,
    source_tr: trId, raw_hash: rawHash, raw_json: rawJson,
  };
  return { item: { row, key: realizedPnlKey(row) }, issues: [] };
}

/** 환율 0·음수는 저장하지 않는다(가짜 환율 금지 — 설계 §2.3). */
function positiveOrNull(db: string | null): string | null {
  if (db == null) return null;
  const u = parseDec(db);
  return u != null && u > 0n ? db : null;
}

export function normalizeRealizedPnl(batch: RawLedgerBatch): NormalizeBatch<NormalizedRealizedPnl> {
  if (batch.kind !== 'realized_pnl') throw new TypeError(`normalizeRealizedPnl: kind=${batch.kind}`);
  const items: NormalizedRealizedPnl[] = [];
  const issues: NormalizeIssue[] = [];
  batch.rows.forEach((raw, i) => {
    const r = normalizePnlRow(batch.market, batch.trId, raw, i);
    if (r.item) items.push(r.item); else issues.push(...r.issues);
  });
  return { items, issues };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 정규화 — 잔고 스냅샷(broker_position_snapshots)
// ─────────────────────────────────────────────────────────────────────────────────────────────

function normalizeSnapshotRow(market: BrokerMarket, trId: string, asOf: string, raw: Record<string, unknown>, index: number):
  { item: NormalizedPositionSnapshot | null; issues: NormalizeIssue[] } {
  const r = new RowReader(raw, index);
  const dom = market === 'domestic';
  const pdno = r.required('pdno');
  let symbol: string | null = null;
  let brokerSymbol: string | null = null;
  let exchangeCode: string | null = null;
  let currency: BrokerCurrency | null;
  if (dom) {
    currency = 'KRW';
    if (pdno != null) {
      if (!DOMESTIC_CODE_RE.test(pdno)) r.fail('bad_symbol', 'pdno');
      else { symbol = pdno; brokerSymbol = pdno; }
    }
  } else {
    exchangeCode = r.code('ovrs_excg_cd', 8);
    if (exchangeCode == null) r.fail('missing', 'ovrs_excg_cd');
    if (pdno != null && exchangeCode != null) {
      symbol = overseasAppSymbol(exchangeCode, pdno);
      if (symbol == null) r.fail(OVERSEAS_EXCHANGE[exchangeCode.toUpperCase()] ? 'bad_symbol' : 'unknown_exchange', OVERSEAS_EXCHANGE[exchangeCode.toUpperCase()] ? 'pdno' : 'ovrs_excg_cd');
      else if (Array.from(pdno).length > 20) { r.fail('too_long', 'pdno'); symbol = null; }
      else brokerSymbol = pdno;
    }
    const c = r.required('buy_crcy_cd');
    currency = currencyOf(c);
    if (c != null && currency == null) r.fail('unsupported_currency', 'buy_crcy_cd');
  }
  const qty = r.dec(dom ? 'hldg_qty' : 'cblc_qty13', 24, 8, { required: true, nonNegative: true });
  const avg = r.dec(dom ? 'pchs_avg_pric' : 'avg_unpr3', 24, 8, { required: true, nonNegative: true });
  const purchase = r.dec(dom ? 'pchs_amt' : 'frcr_pchs_amt', 24, 4, { nonNegative: true });

  if (r.issues.length > 0 || symbol == null || brokerSymbol == null || currency == null || qty.db == null || avg.db == null) {
    return { item: null, issues: r.issues.length ? r.issues : [{ index, reason: 'incomplete_row' }] };
  }
  const { rawJson, rawHash } = rawHashOf(raw);
  const row: BrokerPositionSnapshotRow = {
    broker: 'kis', market, as_of: asOf, symbol, broker_symbol: brokerSymbol, exchange_code: exchangeCode, currency,
    qty: qty.db, avg_price_native: avg.db, purchase_amount_native: purchase.db, cost_includes_fee: 'unknown',
    source_tr: trId, raw_hash: rawHash, raw_json: rawJson,
  };
  return { item: { row, key: positionSnapshotKey(row) }, issues: [] };
}

/**
 * 잔고 조회 응답 → 스냅샷 행. **보유 0 행도 남긴다**(당일 전량 매도 종목 — L-7 절단식의 `thdt_*` 입력이 raw_json 에 있다).
 * `asOf` = 조회일(KST, 어댑터 결과의 queryFrom).
 */
export function normalizePositionSnapshot(batch: RawLedgerBatch, asOf: string): NormalizeBatch<NormalizedPositionSnapshot> {
  if (batch.kind !== 'position_snapshot') throw new TypeError(`normalizePositionSnapshot: kind=${batch.kind}`);
  if (!isIsoDate(asOf)) throw new RangeError(`as_of 형식 오류: ${String(asOf)}`);
  const items: NormalizedPositionSnapshot[] = [];
  const issues: NormalizeIssue[] = [];
  batch.rows.forEach((raw, i) => {
    const r = normalizeSnapshotRow(batch.market, batch.trId, asOf, raw, i);
    if (r.item) items.push(r.item); else issues.push(...r.issues);
  });
  return { items, issues };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 합계 대조(설계 §3.4 L-3 — TR 별 규칙·허용치)
// ─────────────────────────────────────────────────────────────────────────────────────────────

interface SumRule {
  market: BrokerMarket;
  kind: BrokerRunKind;
  tr: RegExp;
  mode: 'exact' | 'relative' | 'unavailable';
  /** [행 필드, 요약 필드] — Σ행 = 요약. */
  pairs: [string, string][];
  /** relative 모드 허용치(천분율). 해외 잔고 1e-3 = 1. */
  tolPerMille?: number;
}

/**
 * 규칙표(설계 §3.4). "정확" = 소수 2자리 반올림 뒤 일치. 다중 페이지는 **전 페이지 행 합**을 요약과 비교한다(해외 기간손익 첫 페이지 `M` 은
 * 요약과 불일치 — 캡처로 판별력 확인). 요약은 페이지마다 같은 전체 합계라고 본다 — 페이지마다 다르면 mismatch(아래 `resolveSummary`).
 */
export const SUM_RULES: readonly SumRule[] = [
  { market: 'domestic', kind: 'fills', tr: /^.TTC0081R$/, mode: 'exact',
    pairs: [['tot_ccld_qty', 'tot_ccld_qty'], ['tot_ccld_amt', 'tot_ccld_amt']] },
  { market: 'domestic', kind: 'realized_pnl', tr: /^.TTC8708R$/, mode: 'exact',
    pairs: [['rlzt_pfls', 'tot_rlzt_pfls'], ['fee', 'tot_fee'], ['tl_tax', 'tot_tltx']] },
  { market: 'overseas', kind: 'realized_pnl', tr: /^.TTS3039R$/, mode: 'exact',
    pairs: [['ovrs_rlzt_pfls_amt', 'ovrs_rlzt_pfls_tot_amt'], ['frcr_sll_amt_smtl1', 'stck_sll_amt_smtl']] },
  { market: 'domestic', kind: 'position_snapshot', tr: /^.TTC8434R$/, mode: 'exact',
    pairs: [['evlu_amt', 'evlu_amt_smtl_amt']] },
  // 해외 잔고: Σfrcr_evlu_amt2 = output3.evlu_amt_smtl, 상대 1e-3(캡처 실측 상대차 4.0e-5 — 정확 일치면 영구 mismatch). frcr_evlu_tota 는 달러 예수금 줄이라 대상 아님.
  { market: 'overseas', kind: 'position_snapshot', tr: /^.TRP6504R$/, mode: 'relative', tolPerMille: 1,
    pairs: [['frcr_evlu_amt2', 'evlu_amt_smtl']] },
  // 해외 체결 TTTS3035R 은 요약 블록이 없다(캡처) → unavailable(해외 체결 창에만 허용 — DDL chk_bfr_sum_unav)
  { market: 'overseas', kind: 'fills', tr: /^.TTS3035R$/, mode: 'unavailable', pairs: [] },
];

/**
 * 페이지별 요약 원문 → 요약 객체 하나. 배열 1행은 그 행, 빈 배열·null 은 건너뜀, 여러 행이면 판정 불가.
 * 요약이 여러 페이지에 있으면 대조 대상 필드가 **모두 같아야** 한다(아니면 판정 불가 — 페이지별 소계인지 전체 합계인지 모르는 채 고르지 않는다).
 */
function resolveSummary(summaries: unknown[], fields: string[]): { summary: Record<string, unknown> | null; reason: string | null } {
  const objs: Record<string, unknown>[] = [];
  for (const s of summaries) {
    if (s == null) continue;
    if (Array.isArray(s)) {
      if (s.length === 0) continue;
      if (s.length > 1) return { summary: null, reason: 'summary_multiple_rows' };
      const o = s[0];
      if (!o || typeof o !== 'object' || Array.isArray(o)) return { summary: null, reason: 'summary_format' };
      objs.push(o as Record<string, unknown>);
    } else if (typeof s === 'object') {
      objs.push(s as Record<string, unknown>);
    } else {
      return { summary: null, reason: 'summary_format' };
    }
  }
  if (objs.length === 0) return { summary: null, reason: 'summary_missing' };
  const first = objs[0];
  for (const o of objs.slice(1)) {
    for (const f of fields) if (String(o[f] ?? '') !== String(first[f] ?? '')) return { summary: null, reason: 'summary_inconsistent_across_pages' };
  }
  return { summary: first, reason: null };
}

/**
 * 합계 대조. 규칙이 없는 (시장·종류·TR) 조합은 mismatch(`no_sum_rule`) — complete 가 되지 않는다(fail-closed).
 * 입력은 어댑터 결과(`rows`·`summaries` 는 원문 그대로). 행 하나라도 대상 필드가 비었거나 숫자가 아니면 mismatch.
 */
export function checkSums(batch: Pick<LedgerQueryResult, 'market' | 'kind' | 'trId' | 'rows' | 'summaries'>): SumCheckResult {
  const rule = SUM_RULES.find((x) => x.market === batch.market && x.kind === batch.kind && x.tr.test(batch.trId));
  if (!rule) return { result: 'mismatch', reasons: ['no_sum_rule'] };
  if (rule.mode === 'unavailable') return { result: 'unavailable', reasons: [] };
  const { summary, reason } = resolveSummary(batch.summaries, rule.pairs.map(([, s]) => s));
  if (!summary) return { result: 'mismatch', reasons: [reason ?? 'summary_missing'] };
  const reasons: string[] = [];
  for (const [rowField, sumField] of rule.pairs) {
    let total = 0n;
    let bad = false;
    for (const row of batch.rows) {
      const u = parseDec(row[rowField]);
      if (u == null) { bad = true; break; }
      total += u;
    }
    if (bad) { reasons.push(`row_value_invalid:${rowField}`); continue; }
    const s = parseDec(summary[sumField]);
    if (s == null) { reasons.push(`summary_value_invalid:${sumField}`); continue; }
    const ok = rule.mode === 'exact' ? equalAt2dp(total, s) : withinRelative(total, s, rule.tolPerMille ?? 0);
    if (!ok) reasons.push(`sum_mismatch:${rowField}`);
  }
  return reasons.length ? { result: 'mismatch', reasons } : { result: 'match', reasons: [] };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// run 완전성 판정(설계 §3.4 complete 정의 — DDL chk_bfr_complete·짝 CHECK 를 앱에서 같은 조건으로)
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * run 의 최종 상태. **DB CHECK 를 통과할 complete 만** complete 로 돌려준다(그보다 엄격할 수는 있어도 느슨하지 않다).
 *  - fetchOutcome `failed` → failed(행 0).
 *  - complete = 응답 끝(`ended`) ∧ 페이지·호출 ≥ 1 ∧ 마지막 `tr_cont`(연속 TR 은 D/E 명시, 잔고 스냅샷은 빈 헤더 또는 D/E — N-1) ∧ 합계 대조
 *    match(해외 체결 TTTS3035R 만 unavailable 허용) ∧ 응답 안 자연키 중복 0 ∧ 정규화 실패 0 ∧ 쓰기 실패 0 ∧ kind·market·TR 짝.
 *  - 그 밖 → incomplete(사유 코드 목록).
 * ⚠ complete 는 "없음"의 증거가 아니다(M-B) — 부재 주장은 D2 의 positive_check='confirmed' 창에서만.
 * `skipped`(85일 밖) 결과는 run 으로 기록하지 않으므로 이 함수에 넣지 않는다(타입이 막는다).
 * (T-087 Codex C2) 추가 입력: `rowsOutOfRange`(행 날짜가 {@link rowDateBounds} 밖인 행 수 — 0 이 아니면 incomplete) ·
 * `maxKisCalls`(run 당 호출 상한 — `kisCalls` 가 이를 넘으면 incomplete `call_cap_exceeded`; kisFetch 내부 재시도가 상한을 넘긴 경우).
 */
export function assessRunCompleteness(x: CompletenessInput & { rowsOutOfRange?: number; maxKisCalls?: number }): CompletenessResult {
  if (x.fetchOutcome === 'failed') return { status: 'failed', reasons: ['fetch_failed'] };
  const reasons: string[] = [];
  if (!sourceTrMatches(x.market, x.kind, x.sourceTr)) reasons.push('source_tr_mismatch');
  if (x.fetchOutcome !== 'ended') reasons.push('fetch_truncated');
  if (!(x.pages >= 1)) reasons.push('no_pages');
  if (!(x.kisCalls >= 1)) reasons.push('no_kis_calls');
  const tc = x.lastTrCont == null || x.lastTrCont.trim() === '' ? null : x.lastTrCont.trim();
  if (x.kind === 'position_snapshot') {
    if (!(tc == null || isTerminalTrCont(tc))) reasons.push('tr_cont_not_terminal');
  } else if (!isTerminalTrCont(tc)) {
    reasons.push(tc == null ? 'tr_cont_missing' : 'tr_cont_not_terminal');
  }
  const unavailableAllowed = x.market === 'overseas' && x.kind === 'fills' && /^.TTS3035R$/.test(x.sourceTr);
  if (!(x.sumCheck === 'match' || (x.sumCheck === 'unavailable' && unavailableAllowed))) reasons.push(`sum_check_${x.sumCheck === 'unavailable' ? 'unavailable_not_allowed' : x.sumCheck}`);
  if (x.duplicateKeys !== 0) reasons.push('duplicate_keys');
  if (x.normalizeIssues !== 0) reasons.push('normalize_failed');
  if ((x.writeFailures ?? 0) !== 0) reasons.push('write_failed');
  if ((x.rowsOutOfRange ?? 0) !== 0) reasons.push('rows_out_of_range');
  if (x.maxKisCalls != null && x.kisCalls > x.maxKisCalls) reasons.push('call_cap_exceeded');
  return reasons.length ? { status: 'incomplete', reasons } : { status: 'complete', reasons: [] };
}

/** 수집기가 `run.error`(VARCHAR(500))에 쓸 문자열 — 사유 코드를 이어 붙이고 500자에서 자른다. 값·계좌는 들어오지 않는다(사유 코드만 받는다). */
export function runErrorText(parts: (string | null | undefined)[]): string | null {
  const t = parts.filter((p): p is string => !!p && p.length > 0).join('; ');
  return t ? Array.from(t).slice(0, 500).join('') : null;
}
