/**
 * T-059 Part A 공용 — 신규 테이블 존재 확인·수집 대상 심볼 (DB 읽기).
 *
 * 테이블은 `scripts/migrations/T-059-us-data-collector.sql` 을 **사람이 승인 후 적용**해야 생긴다(앱 부팅 DDL 아님).
 * 그래서 이 데이터를 쓰는 모든 경로는 먼저 `findMissingTables()` 로 확인하고, 없으면 크래시 대신 건너뛴다.
 * 이 모듈은 signals·orders·position_state 에 **쓰지 않는다**(position_state 는 보유 심볼 이름만 SELECT).
 */
import type { RowDataPacket } from 'mysql2';
import { isOverseasSymbol } from '@/lib/exchanges/kis-symbols';
import { getStaticOverseasUniverse } from '@/lib/strategy/universe-overseas-static';

/** 최소 쿼리 인터페이스 — mysql2 Pool 과 테스트 대역이 모두 만족한다. */
export interface Queryable {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<[T, unknown]>;
}

export const EDGAR_TABLES = ['symbol_cik_map', 'us_filings', 'us_financial_facts', 'us_earnings_events'] as const;
export const SNAPSHOT_TABLES = ['us_fundamentals_snapshot'] as const;

/** 주어진 테이블 중 현재 DB 에 없는 것. INFORMATION_SCHEMA 조회 1회. */
export async function findMissingTables(db: Queryable, names: readonly string[]): Promise<string[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT TABLE_NAME AS t FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)`,
    [names as unknown as string[]],
  );
  const have = new Set((rows ?? []).map((r) => String(r.t ?? r.TABLE_NAME)));
  return names.filter((n) => !have.has(n));
}

/** MariaDB/MySQL "테이블 없음"(errno 1146, ER_NO_SUCH_TABLE). */
export function isNoSuchTableError(e: unknown): boolean {
  const x = e as { code?: string; errno?: number } | null;
  return !!x && (x.code === 'ER_NO_SUCH_TABLE' || x.errno === 1146);
}

/**
 * 수집 대상 해외 심볼 = 보유(position_state overseas) ∪ 즐겨찾기(해외 형식) ∪ 정적 universe 50(env 오버라이드 포함).
 * 각 SELECT 가 실패해도 나머지로 계속한다(그 출처 이름을 errors 에 남김). 심볼 이름 외의 값(수량·평단)은 읽지 않는다.
 */
export async function loadUsTargetSymbols(db: Queryable): Promise<{ symbols: string[]; errors: string[] }> {
  const set = new Set<string>();
  const errors: string[] = [];
  try {
    const [rows] = await db.query<RowDataPacket[]>(`SELECT symbol FROM position_state WHERE market = 'overseas'`);
    for (const r of rows ?? []) set.add(String(r.symbol));
  } catch {
    errors.push('position_state');
  }
  try {
    const [rows] = await db.query<RowDataPacket[]>(`SELECT symbol FROM stock_favorites`);
    for (const r of rows ?? []) set.add(String(r.symbol));
  } catch {
    errors.push('stock_favorites');
  }
  for (const s of getStaticOverseasUniverse()) set.add(s);
  const symbols = [...set].filter((s) => isOverseasSymbol(s)).sort();
  return { symbols, errors };
}
