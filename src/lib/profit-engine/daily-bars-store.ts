/**
 * T-070 `daily_bars` 읽기·쓰기. **쓰는 테이블은 daily_bars 하나뿐**이다(격리 시험이 SQL 문자열로 고정한다).
 *
 *  - 쓰기 3종: 멱등 upsert(`DAILY_BARS_UPSERT_SQL`), 조정 기준 변경 시 종목 전체 'adj_stale' 표시(`MARK_STALE_SQL`),
 *    전체 재수집이 끝났는데도 남은 stale 행을 'adj_orphan' 으로 바꾸기(`RELABEL_ORPHAN_SQL` — 재수집 무한 반복 방지).
 *  - 읽기: 테이블 존재(information_schema), 종목 상태(MIN/MAX/통화/조정 모드/stale 수), 저장 종가, 기본 대상 심볼
 *    (position_state·signals 의 **심볼 이름만** — 수량·평단·금액은 읽지 않는다).
 *  - 날짜는 `DATE_FORMAT(…,'%Y-%m-%d')` 로 문자열로 받는다(mysql2 의 DATE → 로컬 자정 Date 해석에 기대지 않는다).
 *  - `fetched_at` 은 KST 벽시계 문자열(T-046 — DB·앱 풀 모두 KST).
 */
import type { RowDataPacket } from 'mysql2';
import { isDomesticSymbol, isOverseasSymbol } from '@/lib/exchanges/kis-symbols';
import { toKstDatetime } from '@/lib/time';
import {
  CURRENCY_BY_MARKET, FLAG_ADJ_ORPHAN, FLAG_ADJ_STALE, flagsFromColumn, flagsToColumn,
  type AdjMode, type AnnotatedBar, type StoredBar,
} from './daily-bars-quality';
import type { BarMarket } from './daily-bars-time';

/** 최소 쿼리 인터페이스 — mysql2 Pool 과 시험 대역이 모두 만족한다. */
export interface Queryable {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<[T, unknown]>;
}

export const DAILY_BARS_TABLE = 'daily_bars';

export const DAILY_BARS_COLUMNS = [
  'market', 'symbol', 'trade_date', 'open', 'high', 'low', 'close', 'volume', 'turnover',
  'currency', 'adj_mode', 'is_final', 'flags', 'source', 'fetched_at',
] as const;

/** 확정 봉을 장중 봉으로 되돌리지 않는다(값 열은 기존 확정 값 유지). `is_final` 은 맨 끝에 대입한다 — 앞 식들이 옛 값을 보게. */
const KEEP_FINAL = (c: string) => `${c} = IF(is_final = 1 AND VALUES(is_final) = 0, ${c}, VALUES(${c}))`;
export const DAILY_BARS_UPSERT_SQL = `INSERT INTO daily_bars (${DAILY_BARS_COLUMNS.join(', ')}) VALUES ?
  ON DUPLICATE KEY UPDATE ${['open', 'high', 'low', 'close', 'volume', 'turnover', 'flags', 'source', 'fetched_at'].map(KEEP_FINAL).join(', ')},
    currency = VALUES(currency), adj_mode = VALUES(adj_mode), is_final = GREATEST(is_final, VALUES(is_final))`;

export const MARK_STALE_SQL = `UPDATE daily_bars SET flags = '${FLAG_ADJ_STALE}' WHERE market = ? AND symbol = ?`;

export const RELABEL_ORPHAN_SQL = `UPDATE daily_bars SET flags = '${FLAG_ADJ_ORPHAN}'
  WHERE market = ? AND symbol = ? AND FIND_IN_SET('${FLAG_ADJ_STALE}', flags) > 0`;

/** 한 번에 보내는 행 수 상한(패킷 크기 여유). */
export const UPSERT_CHUNK = 500;

export async function findMissingTables(db: Queryable, names: readonly string[]): Promise<string[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)`,
    [names as unknown as string[]],
  );
  const have = new Set((rows ?? []).map((r) => String(r.t ?? r.TABLE_NAME)));
  return names.filter((n) => !have.has(n));
}

export interface SymbolState {
  count: number;
  minDate: string | null;
  maxDate: string | null;
  /** adj_stale 이 아닌 행 중 가장 이른 날 */
  minFreshDate: string | null;
  staleCount: number;
  currencies: string[];
  adjModes: string[];
}

export async function loadSymbolState(db: Queryable, market: BarMarket, symbol: string): Promise<SymbolState> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT currency, adj_mode, COUNT(*) AS n,
            DATE_FORMAT(MIN(trade_date), '%Y-%m-%d') AS min_d, DATE_FORMAT(MAX(trade_date), '%Y-%m-%d') AS max_d,
            SUM(FIND_IN_SET('${FLAG_ADJ_STALE}', IFNULL(flags, '')) > 0) AS stale_n,
            DATE_FORMAT(MIN(IF(FIND_IN_SET('${FLAG_ADJ_STALE}', IFNULL(flags, '')) > 0, NULL, trade_date)), '%Y-%m-%d') AS min_fresh_d
       FROM daily_bars WHERE market = ? AND symbol = ? GROUP BY currency, adj_mode`,
    [market, symbol],
  );
  const st: SymbolState = { count: 0, minDate: null, maxDate: null, minFreshDate: null, staleCount: 0, currencies: [], adjModes: [] };
  const lo = (a: string | null, b: unknown) => (typeof b === 'string' && b && (a === null || b < a) ? b : a);
  const hi = (a: string | null, b: unknown) => (typeof b === 'string' && b && (a === null || b > a) ? b : a);
  for (const r of rows ?? []) {
    st.count += Number(r.n ?? 0);
    st.staleCount += Number(r.stale_n ?? 0);
    st.minDate = lo(st.minDate, r.min_d);
    st.maxDate = hi(st.maxDate, r.max_d);
    st.minFreshDate = lo(st.minFreshDate, r.min_fresh_d);
    st.currencies.push(String(r.currency));
    st.adjModes.push(String(r.adj_mode));
  }
  return st;
}

/** 저장된 행(문맥·비교용). fromDate 이후만. */
export async function loadStoredBars(db: Queryable, market: BarMarket, symbol: string, fromDate: string | null): Promise<StoredBar[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(trade_date, '%Y-%m-%d') AS d, close, is_final, flags
       FROM daily_bars WHERE market = ? AND symbol = ? AND trade_date >= ? ORDER BY trade_date`,
    [market, symbol, fromDate ?? '1900-01-01'],
  );
  return (rows ?? []).map((r) => ({
    tradeDate: String(r.d),
    close: Number(r.close),
    isFinal: Number(r.is_final) === 1,
    flags: flagsFromColumn(r.flags),
  }));
}

export interface UpsertContext {
  market: BarMarket;
  symbol: string;
  adjMode: AdjMode;
  source: string;
  isFinal: (tradeDate: string) => boolean;
  now: Date;
}

export function toUpsertTuples(bars: AnnotatedBar[], c: UpsertContext): unknown[][] {
  const currency = CURRENCY_BY_MARKET[c.market];
  const fetchedAt = toKstDatetime(c.now);
  return bars.map((b) => [
    c.market, c.symbol, b.tradeDate, b.open, b.high, b.low, b.close, b.volume, b.turnover,
    currency, c.adjMode, c.isFinal(b.tradeDate) ? 1 : 0, flagsToColumn(b.flags), c.source, fetchedAt,
  ]);
}

/** 멱등 upsert. 반환: 보낸 행 수. */
export async function upsertBars(db: Queryable, bars: AnnotatedBar[], c: UpsertContext): Promise<number> {
  const tuples = toUpsertTuples(bars, c);
  for (let i = 0; i < tuples.length; i += UPSERT_CHUNK) {
    await db.query(DAILY_BARS_UPSERT_SQL, [tuples.slice(i, i + UPSERT_CHUNK)]);
  }
  return tuples.length;
}

export async function markSymbolStale(db: Queryable, market: BarMarket, symbol: string): Promise<void> {
  await db.query(MARK_STALE_SQL, [market, symbol]);
}

export async function relabelOrphans(db: Queryable, market: BarMarket, symbol: string): Promise<void> {
  await db.query(RELABEL_ORPHAN_SQL, [market, symbol]);
}

export interface Target {
  symbol: string;
  market: BarMarket;
  origin: 'holding' | 'signal' | 'request';
}

export function marketOfSymbol(symbol: string): BarMarket | null {
  if (isOverseasSymbol(symbol)) return 'US';
  if (isDomesticSymbol(symbol)) return 'KR';
  return null;
}

export const DEFAULT_SIGNAL_LOOKBACK_DAYS = 90;
export const MAX_SIGNAL_TARGETS = 300;

/**
 * 기본 대상 = 보유(position_state, 최우선) → 최근 90일 시그널 종목(발화 수 많은 순, ≤300).
 * 각 SELECT 가 실패해도 나머지로 계속한다(출처 이름을 errors 에 남김). 심볼 이름 외의 값은 읽지 않는다.
 */
export async function loadDefaultTargets(db: Queryable): Promise<{ targets: Target[]; errors: string[] }> {
  const errors: string[] = [];
  const out: Target[] = [];
  const seen = new Set<string>();
  const add = (symbol: string, origin: Target['origin']) => {
    const market = marketOfSymbol(symbol);
    if (!market || seen.has(symbol)) return false;
    seen.add(symbol);
    out.push({ symbol, market, origin });
    return true;
  };
  try {
    const [rows] = await db.query<RowDataPacket[]>(`SELECT symbol FROM position_state ORDER BY symbol`);
    for (const r of rows ?? []) add(String(r.symbol), 'holding');
  } catch {
    errors.push('position_state');
  }
  try {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT symbol, COUNT(*) AS n FROM signals
        WHERE created_at >= NOW() - INTERVAL ${DEFAULT_SIGNAL_LOOKBACK_DAYS} DAY
        GROUP BY symbol ORDER BY n DESC, symbol LIMIT ${MAX_SIGNAL_TARGETS + 50}`,
    );
    let n = 0;
    for (const r of rows ?? []) {
      if (n >= MAX_SIGNAL_TARGETS) break;
      if (add(String(r.symbol), 'signal')) n++;
    }
  } catch {
    errors.push('signals');
  }
  return { targets: out, errors };
}
