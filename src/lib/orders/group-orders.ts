import { formatTimeKST24 } from '@/lib/time';

/**
 * 주문 목록을 **날짜(KST) → 종목** 2단 그룹으로 묶는 순수 함수.
 *
 * 분석 탭 "거래 이력"(`OrderHistoryTab`)과 대시보드 "최근 주문"(`RecentExecutionsSection`)이
 * 이 모듈 하나를 공유한다. 화면별로 같은 로직을 복붙하지 않는다.
 *
 * 방어 원칙(T-021 선례 — UI가 API 응답을 무가드로 신뢰해 크래시): `created_at` 파싱 실패나
 * `symbol` 결측이 있어도 **던지지 않고, 해당 주문을 조용히 버리지도 않는다**.
 * 대신 `(날짜 미상)` / `(알 수 없음)` 그룹으로 모아 화면에서 관측 가능하게 만든다.
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** `created_at` 이 이상값인 주문이 모이는 날짜 그룹 */
export const UNKNOWN_DATE_KEY = '__unknown_date__';
export const UNKNOWN_DATE_LABEL = '(날짜 미상)';
/** `symbol` 이 결측/공백인 주문이 모이는 종목 그룹 */
export const UNKNOWN_SYMBOL = '(알 수 없음)';

/**
 * 그룹핑에 필요한 최소 필드만 요구한다 —
 * `@/types/order`의 `Order`와 대시보드 로컬 `OrderRow` 양쪽을 그대로 받기 위함.
 * 타입상 non-null이어도 런타임 값은 신뢰하지 않는다.
 */
export interface GroupableOrder {
  symbol?: string | null;
  created_at?: string | number | Date | null;
}

export interface SymbolGroup<T> {
  /** 원본 심볼. 결측/공백이면 `UNKNOWN_SYMBOL` */
  symbol: string;
  /** 그룹에 담긴 주문 수 */
  count: number;
  /** 그룹 내 가장 이른 주문 시각(ISO). 전부 이상값이면 null */
  firstAt: string | null;
  /** 그룹 내 가장 늦은 주문 시각(ISO). 전부 이상값이면 null */
  lastAt: string | null;
  /** 최신순(내림차순) 주문 목록 */
  orders: T[];
}

export interface DateGroup<T> {
  /** 정렬·React key·펼침 상태 식별용 안정 키. `YYYY-MM-DD`(KST) 또는 `UNKNOWN_DATE_KEY` */
  dateKey: string;
  /** 화면 표기 — '오늘' | '어제' | 'M. D.' | `UNKNOWN_DATE_LABEL` */
  dateLabel: string;
  symbolGroups: SymbolGroup<T>[];
}

/** 어떤 타입이 와도 유한한 epoch ms 또는 null 을 돌려준다 (throw 하지 않음) */
function toTime(v: unknown): number | null {
  if (v == null) return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    if (v.trim() === '') return null;
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** epoch ms → KST 기준 `YYYY-MM-DD` (서버/클라이언트 timezone 무관) */
function kstDayKey(t: number): string {
  const k = new Date(t + KST_OFFSET_MS);
  return `${k.getUTCFullYear()}-${pad2(k.getUTCMonth() + 1)}-${pad2(k.getUTCDate())}`;
}

/** 기존 거래 이력과 동일한 날짜 표기(`ko-KR` numeric month/day → "8. 16.") 유지 */
function kstDayLabel(t: number): string {
  return new Date(t).toLocaleDateString('ko-KR', {
    timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric',
  });
}

/**
 * 그룹 키로 쓸 심볼을 정규화한다.
 * **trim 한 값을 반환**해야 한다 — 앞뒤 공백이 섞인 동일 심볼(`' 005930 '` vs `'005930'`)이
 * 서로 다른 그룹으로 쪼개지면 "같은 종목을 묶어 본다"는 이 화면의 목적 자체가 깨진다.
 * trim 결과가 빈 문자열이면 `UNKNOWN_SYMBOL`.
 */
function normalizeSymbol(v: unknown): string {
  if (typeof v !== 'string') return UNKNOWN_SYMBOL;
  const trimmed = v.trim();
  return trimmed === '' ? UNKNOWN_SYMBOL : trimmed;
}

interface Bucket<T> {
  symbol: string;
  orders: { item: T; time: number | null }[];
  minT: number | null;
  maxT: number | null;
}

/**
 * 날짜(KST) → 종목 2단 그룹핑.
 *
 * - 날짜 그룹: 최신 날짜 우선. `(날짜 미상)` 은 항상 맨 뒤
 * - 종목 그룹: 그룹 내 최신 주문이 늦은 순. 시각 미상 그룹은 뒤, 동률이면 심볼명 오름차순(결정적)
 * - 주문: 각 종목 그룹 안에서 최신순. 시각 미상은 뒤
 *
 * @param orders 원본 주문 목록 (null/undefined/비배열도 안전하게 `[]` 처리)
 * @param now    '오늘'/'어제' 판정 기준 시각 (테스트 주입용)
 */
export function groupByDateThenSymbol<T extends GroupableOrder>(
  orders: readonly T[] | null | undefined,
  now: Date = new Date(),
): DateGroup<T>[] {
  if (!Array.isArray(orders) || orders.length === 0) return [];

  const nowT = toTime(now) ?? Date.now();
  const todayKey = kstDayKey(nowT);
  const yesterdayKey = kstDayKey(nowT - 86_400_000);

  // dateKey → (symbol → bucket). Map 은 삽입 순서를 보존하므로 동률 정렬이 안정적이다.
  const byDate = new Map<string, Map<string, Bucket<T>>>();
  const labelByDate = new Map<string, string>();

  for (const item of orders) {
    if (item == null) continue;

    const time = toTime(item.created_at);
    const dateKey = time == null ? UNKNOWN_DATE_KEY : kstDayKey(time);

    if (!labelByDate.has(dateKey)) {
      let label: string;
      if (dateKey === UNKNOWN_DATE_KEY) label = UNKNOWN_DATE_LABEL;
      else if (dateKey === todayKey) label = '오늘';
      else if (dateKey === yesterdayKey) label = '어제';
      else label = kstDayLabel(time as number);
      labelByDate.set(dateKey, label);
    }

    let bySymbol = byDate.get(dateKey);
    if (!bySymbol) { bySymbol = new Map(); byDate.set(dateKey, bySymbol); }

    const symbol = normalizeSymbol(item.symbol);
    let bucket = bySymbol.get(symbol);
    if (!bucket) { bucket = { symbol, orders: [], minT: null, maxT: null }; bySymbol.set(symbol, bucket); }

    bucket.orders.push({ item, time });
    if (time != null) {
      if (bucket.minT == null || time < bucket.minT) bucket.minT = time;
      if (bucket.maxT == null || time > bucket.maxT) bucket.maxT = time;
    }
  }

  const dateKeys = Array.from(byDate.keys()).sort((a, b) => {
    if (a === UNKNOWN_DATE_KEY) return 1;
    if (b === UNKNOWN_DATE_KEY) return -1;
    return b.localeCompare(a); // YYYY-MM-DD 는 사전순 = 시간순
  });

  return dateKeys.map(dateKey => {
    const buckets = Array.from(byDate.get(dateKey)!.values()).sort((a, b) => {
      if (a.maxT == null && b.maxT == null) return a.symbol.localeCompare(b.symbol);
      if (a.maxT == null) return 1;
      if (b.maxT == null) return -1;
      if (a.maxT !== b.maxT) return b.maxT - a.maxT;
      return a.symbol.localeCompare(b.symbol);
    });

    return {
      dateKey,
      dateLabel: labelByDate.get(dateKey)!,
      symbolGroups: buckets.map<SymbolGroup<T>>(bucket => {
        const sorted = bucket.orders
          .slice()
          .sort((a, b) => {
            if (a.time == null && b.time == null) return 0;
            if (a.time == null) return 1;
            if (b.time == null) return -1;
            return b.time - a.time;
          })
          .map(o => o.item);

        return {
          symbol: bucket.symbol,
          count: sorted.length,
          firstAt: bucket.minT == null ? null : new Date(bucket.minT).toISOString(),
          lastAt: bucket.maxT == null ? null : new Date(bucket.maxT).toISOString(),
          orders: sorted,
        };
      }),
    };
  });
}

/**
 * 종목 그룹 헤더의 시각 범위 표기 — 24시간제(`09:12~14:30`).
 * 1건이거나 분 단위로 같은 시각이면 `09:12~09:12` 대신 `09:12` 단독 표기.
 */
export function formatGroupTimeRange(firstAt: string | null, lastAt: string | null): string {
  const a = firstAt == null ? null : formatTimeKST24(firstAt);
  const b = lastAt == null ? null : formatTimeKST24(lastAt);
  if (!a && !b) return '시각 미상';
  if (!a || !b || a === b) return (a ?? b) as string;
  return `${a}~${b}`;
}

/** 종목 그룹 헤더 요약 — `3건 · 09:12~14:30` / `1건 · 10:05` */
export function formatGroupSummary(group: Pick<SymbolGroup<unknown>, 'count' | 'firstAt' | 'lastAt'>): string {
  return `${group.count}건 · ${formatGroupTimeRange(group.firstAt, group.lastAt)}`;
}

/** 날짜 그룹 하나에 담긴 주문 총 건수 */
export function countOrdersInDateGroup(group: DateGroup<unknown>): number {
  return group.symbolGroups.reduce((sum, g) => sum + g.count, 0);
}
