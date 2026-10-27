/**
 * T-070 일봉 품질 게이트 (T-064 §5.4) — 순수 함수. DB·네트워크 없음.
 *
 *  1. 통화·단위: 시장별 통화 고정(US=USD, KR=KRW). 한 종목 안에서 다른 통화가 섞이면 **거부**(적재하지 않음).
 *     저장된 종가와 새 종가가 수십 배 다르면(환산값 혼입 — 10-21 `price_change_pct_24h` +262% 사고 유형) 역시 거부.
 *  2. 결측·중복·역순·거래량 0 검출. 중복은 날짜당 1행으로 줄이고, 값이 서로 다르면 'dup_conflict' 로 표시.
 *  3. 전일 대비 종가 비율이 [0.70, 1.43] 밖이면 **제외하지 않고** 'corp_action_suspect' 로 표시(분할 종목 = 대개 승자를 빼는 편향 방지).
 *  4. 확정 봉만 is_final=1 (판정은 daily-bars-time.isFinalBar).
 *  5. 조정 기준 변경 감지(검토자 R-10, T-099 개정): 중첩 재조회 구간에서 저장된 확정 종가와 새 종가가 다르면 그 종목 전체를 재수집 대상으로 표시.
 *     단, 불일치가 **가장 최근 비교 봉 ADJ_SETTLING_BARS 개 안에만** 있고 그보다 오래된 비교 봉이 ADJ_SETTLING_MIN_OLDER 개 이상 전부
 *     일치하면 조정이 아니라 '정착 중인 최신 봉'(마감 직후 저장한 잠정값)으로 보고 재수집하지 않는다(덮어쓰기는 겹침 재기록이 한다).
 */
import { daysBetween, type BarMarket } from './daily-bars-time';

export type Currency = 'USD' | 'KRW';
export type AdjMode = 'adjusted' | 'raw';

export const CURRENCY_BY_MARKET: Record<BarMarket, Currency> = { US: 'USD', KR: 'KRW' };

/** KIS 응답 한 행을 정규화한 값. 가격은 **현지 통화 원값**(환산하지 않는다). */
export interface RawBar {
  tradeDate: string;          // 'YYYY-MM-DD' 현지 거래일
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number;
  turnover: number | null;
}

/** 저장된 행 중 비교·문맥에 쓰는 부분. */
export interface StoredBar {
  tradeDate: string;
  close: number;
  isFinal: boolean;
  flags: string[];
}

export const FLAG_CORP_ACTION = 'corp_action_suspect';
export const FLAG_ZERO_VOLUME = 'zero_volume';
export const FLAG_ADJ_STALE = 'adj_stale';
export const FLAG_ADJ_ORPHAN = 'adj_orphan';
export const FLAG_DUP_CONFLICT = 'dup_conflict';

/** 가격제한폭 밖 — 기업행위 의심 경계. 경계값 자체(0.70·1.43)는 정상으로 본다. */
export const CORP_ACTION_RATIO: readonly [number, number] = [0.70, 1.43];
/** 같은 날짜 종가 비교 허용 오차 — 저장 정밀도 DECIMAL(18,4) 의 한 단위. */
export const ADJ_CLOSE_TOLERANCE = 0.0001;
/** 저장 종가 대비 이 배수 이상 차이면 조정이 아니라 단위·통화 혼입으로 본다. */
export const UNIT_MISMATCH_RATIO = 20;
/**
 * (T-099) '정착 중인 최신 봉' 판정 — 불일치가 날짜 오름차순 비교 봉의 **마지막 이 개수 안에만** 있으면 조정 후보에서 뺀다.
 * 근거: 진짜 조정(배당·액면)은 기준일 **이전의 모든 봉**을 바꾸므로 최신 봉만 달라질 수 없다. 10-27 KIS 진단(4종목, 4/4)에서
 * 불일치는 늘 저장된 가장 최신 봉 하나였고 더 오래된 8개 봉은 소수점 끝까지 일치했다(차이 미국 ~0.1%·국내 ~1% — 허용 오차로는 못 막아 위치로 판정).
 * 2 = 최신 봉 하나 + 휴일·수집 시각 어긋남으로 둘째 봉까지 잠정인 경우의 여유.
 */
export const ADJ_SETTLING_BARS = 2;
/**
 * (T-099) 위 판정을 하려면 그보다 오래된 비교 봉이 이 개수 이상 있고 전부 일치해야 한다. 이보다 적으면 '최신 봉만 달라짐'과
 * '기준일 이전 전체가 달라짐'을 구분할 근거가 부족하므로 보수적으로 조정 변경(재수집)으로 본다.
 */
export const ADJ_SETTLING_MIN_OLDER = 3;
/** 이 달력 일수보다 긴 빈틈은 결측 후보로 보고한다(설·추석 연휴 최대 7일 + 주말). */
export const GAP_REPORT_DAYS = 9;

export class CurrencyMismatchError extends Error {
  constructor(public readonly market: BarMarket, public readonly found: string[]) {
    super(`currency_mismatch: market=${market} expected=${CURRENCY_BY_MARKET[market]} found=${found.join(',')}`);
    this.name = 'CurrencyMismatchError';
  }
}

/**
 * 한 종목의 통화 집합이 시장 통화 하나뿐인지. 저장된 행의 통화 + 새로 쓸 통화를 함께 넘긴다.
 * @throws {CurrencyMismatchError} 다른 통화가 하나라도 있으면
 */
export function assertSingleCurrency(market: BarMarket, currencies: Iterable<string>): void {
  const expected = CURRENCY_BY_MARKET[market];
  const found = [...new Set(currencies)];
  if (found.some((c) => c !== expected)) throw new CurrencyMismatchError(market, found.sort());
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * 정규화 값 검증 — 종가 > 0 유한, 거래량 유한 ≥ 0, OHLC 는 0·음수·비유한이면 null(국내 거래정지일은 시·고·저가 0 으로 온다).
 * 통과하지 못하면 null(그 행은 버리고 개수만 센다).
 */
export function normalizeBar(b: {
  tradeDate: string | null; open: unknown; high: unknown; low: unknown; close: unknown; volume: unknown; turnover: unknown;
}): RawBar | null {
  if (!b.tradeDate) return null;
  const close = num(b.close);
  const volume = num(b.volume);
  if (close === null || close <= 0 || volume === null || volume < 0) return null;
  const pos = (v: unknown) => { const n = num(v); return n !== null && n > 0 ? n : null; };
  const t = num(b.turnover);
  return {
    tradeDate: b.tradeDate,
    open: pos(b.open), high: pos(b.high), low: pos(b.low),
    close,
    volume: Math.round(volume),
    turnover: t !== null && t >= 0 ? t : null,
  };
}

const sameBar = (a: RawBar, b: RawBar) =>
  a.close === b.close && a.open === b.open && a.high === b.high && a.low === b.low && a.volume === b.volume;

export interface MergeResult {
  /** 날짜 오름차순, 날짜당 1행 */
  bars: RawBar[];
  /** 같은 날짜가 두 번 이상 온 횟수(페이지 겹침 포함) */
  duplicates: number;
  /** 같은 날짜인데 값이 달랐던 날짜 */
  conflicts: Set<string>;
  /** 한 페이지 안에서 날짜가 내림차순(KIS 기본)이 아니었던 페이지 수 */
  orderViolations: number;
}

/**
 * 여러 페이지를 합친다. 같은 날짜는 **나중에 받은 값**을 쓴다(더 최근 호출이 더 최신 조정 기준이다).
 * 각 페이지는 KIS 관례대로 최신→과거(엄격한 내림차순)여야 하고, 아니면 역순 위반으로 센다(정렬은 여기서 다시 한다).
 */
export function mergePages(pages: RawBar[][]): MergeResult {
  const byDate = new Map<string, RawBar>();
  const conflicts = new Set<string>();
  let duplicates = 0;
  let orderViolations = 0;
  for (const page of pages) {
    for (let i = 1; i < page.length; i++) {
      if (!(page[i].tradeDate < page[i - 1].tradeDate)) { orderViolations++; break; }
    }
    for (const b of page) {
      const prev = byDate.get(b.tradeDate);
      if (prev) {
        duplicates++;
        if (!sameBar(prev, b)) conflicts.add(b.tradeDate);
      }
      byDate.set(b.tradeDate, b);
    }
  }
  const bars = [...byDate.values()].sort((a, b) => (a.tradeDate < b.tradeDate ? -1 : 1));
  return { bars, duplicates, conflicts, orderViolations };
}

export interface AnnotatedBar extends RawBar {
  flags: string[];
  /** 전일 종가를 아는가(문맥 포함). false 면 비율 검사를 못 했다 */
  hasPredecessor: boolean;
}

/**
 * 품질 표시를 붙인다. `context` 는 같은 종목의 이미 저장된 **신뢰할 수 있는**(adj_stale 아닌) 종가 — 페이지 경계의 전일 종가를 찾는 데만 쓴다.
 * 비율 검사는 각 봉의 바로 앞 거래일(대상 ∪ 문맥에서 날짜가 가장 가까운 과거) 종가로 한다.
 */
export function annotateBars(
  bars: RawBar[],
  context: Array<{ tradeDate: string; close: number }>,
  conflicts: Set<string> = new Set(),
): AnnotatedBar[] {
  const closeByDate = new Map<string, number>();
  for (const c of context) closeByDate.set(c.tradeDate, c.close);
  for (const b of bars) closeByDate.set(b.tradeDate, b.close);
  const dates = [...closeByDate.keys()].sort();
  const idx = new Map(dates.map((d, i) => [d, i]));
  return bars.map((b) => {
    const flags: string[] = [];
    const i = idx.get(b.tradeDate)!;
    const prevClose = i > 0 ? closeByDate.get(dates[i - 1])! : null;
    if (prevClose !== null && prevClose > 0) {
      const r = b.close / prevClose;
      if (r < CORP_ACTION_RATIO[0] || r > CORP_ACTION_RATIO[1]) flags.push(FLAG_CORP_ACTION);
    }
    if (b.volume === 0) flags.push(FLAG_ZERO_VOLUME);
    if (conflicts.has(b.tradeDate)) flags.push(FLAG_DUP_CONFLICT);
    return { ...b, flags: flags.sort(), hasPredecessor: prevClose !== null };
  });
}

export function flagsToColumn(flags: string[]): string | null {
  const f = [...new Set(flags)].sort();
  return f.length ? f.join(',') : null;
}

export function flagsFromColumn(v: unknown): string[] {
  if (typeof v !== 'string' || !v.trim()) return [];
  return v.split(',').map((x) => x.trim()).filter(Boolean);
}

export interface AdjustmentCheck {
  /** 겹친 확정 날짜 수 */
  compared: number;
  /** 종가가 허용 오차보다 다른 날짜(정착 중으로 본 것 포함 — 불일치 총수) */
  mismatches: Array<{ tradeDate: string; stored: number; fresh: number }>;
  /** 조정 기준이 바뀌었다(→ 종목 전체 재수집). 정착 중인 최신 봉만 다르면 false */
  changed: boolean;
  /** (T-099) 정착 중인 최신 봉으로 보고 조정 변경에서 뺀 불일치 수(changed=false 일 때만 0 초과, 아니면 0) */
  settling: number;
  /** 조정이 아니라 단위·통화 혼입으로 보이는 차이(→ 적재 거부) */
  unitMismatch: boolean;
}

/**
 * 중첩 재조회 구간 비교. 저장 쪽은 **확정이고 adj_stale·adj_orphan 이 아닌** 행만 비교한다(장중 봉은 원래 바뀐다).
 *
 * (T-099) 불일치가 있어도 그 날짜가 전부 날짜 오름차순 비교 봉의 마지막 ADJ_SETTLING_BARS 개 안에 있고, 그보다 오래된 비교 봉이
 * ADJ_SETTLING_MIN_OLDER 개 이상(그 봉들은 정의상 전부 일치)이면 `changed=false`·`settling` 에 센다 — 마감 직후 저장한 잠정 봉이
 * 확정값으로 바뀐 것이지 조정 사건이 아니다. 그 밖(오래된 봉에도 불일치, 또는 오래된 봉이 부족해 구분 근거가 없음)은 `changed=true`.
 * 단위 혼입(`unitMismatch`)은 위치와 무관하게 **모든** 불일치에 적용한다 — 정착 중이라도 20배 넘게 다르면 적재 거부.
 * 한계: 저장된 가장 최신 봉이 잠정인 채로 다음 증분 전까지 남는 문제는 이 판정이 고치지 않는다(다음 날 증분의 겹침 재기록이 덮는다).
 */
export function detectAdjustmentChange(fresh: RawBar[], stored: StoredBar[]): AdjustmentCheck {
  const freshBy = new Map(fresh.map((b) => [b.tradeDate, b.close]));
  const comparable = stored
    .filter((s) => s.isFinal && !s.flags.includes(FLAG_ADJ_STALE) && !s.flags.includes(FLAG_ADJ_ORPHAN) && freshBy.has(s.tradeDate))
    .sort((a, b) => (a.tradeDate < b.tradeDate ? -1 : a.tradeDate > b.tradeDate ? 1 : 0));
  const mismatches: AdjustmentCheck['mismatches'] = [];
  let unitMismatch = false;
  let oldestMismatchIdx = -1;     // 날짜 오름차순 비교 봉에서 불일치가 처음 나온 위치(가장 오래된 불일치)
  comparable.forEach((s, i) => {
    const f = freshBy.get(s.tradeDate)!;
    if (Math.abs(f - s.close) > ADJ_CLOSE_TOLERANCE) {
      mismatches.push({ tradeDate: s.tradeDate, stored: s.close, fresh: f });
      if (oldestMismatchIdx < 0) oldestMismatchIdx = i;
      const r = s.close > 0 ? f / s.close : Infinity;
      if (r > UNIT_MISMATCH_RATIO || r < 1 / UNIT_MISMATCH_RATIO) unitMismatch = true;
    }
  });
  const compared = comparable.length;
  if (!mismatches.length) return { compared, mismatches, changed: false, settling: 0, unitMismatch };
  const olderCount = compared - ADJ_SETTLING_BARS;          // 최근 K 개보다 오래된 비교 봉 수
  const settlingOnly = olderCount >= ADJ_SETTLING_MIN_OLDER && oldestMismatchIdx >= olderCount;
  return settlingOnly
    ? { compared, mismatches, changed: false, settling: mismatches.length, unitMismatch }
    : { compared, mismatches, changed: true, settling: 0, unitMismatch };
}

/** 오름차순 봉 사이 달력 빈틈이 GAP_REPORT_DAYS 를 넘는 구간(결측 후보 — 거래정지·데이터 누락). */
export function findGaps(barsAsc: Array<{ tradeDate: string }>, maxDays = GAP_REPORT_DAYS): Array<{ from: string; to: string; days: number }> {
  const out: Array<{ from: string; to: string; days: number }> = [];
  for (let i = 1; i < barsAsc.length; i++) {
    const d = daysBetween(barsAsc[i - 1].tradeDate, barsAsc[i].tradeDate);
    if (d > maxDays) out.push({ from: barsAsc[i - 1].tradeDate, to: barsAsc[i].tradeDate, days: d });
  }
  return out;
}
