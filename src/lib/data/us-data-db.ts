/**
 * T-059 Part A 공용 — 신규 테이블 존재 확인·수집 대상 심볼 (DB 읽기).
 *
 * 테이블은 `scripts/migrations/T-059-us-data-collector.sql` 을 **사람이 승인 후 적용**해야 생긴다(앱 부팅 DDL 아님).
 * 그래서 이 데이터를 쓰는 모든 경로는 먼저 `findMissingTables()` 로 확인하고, 없으면 크래시 대신 건너뛴다.
 * 이 모듈은 signals·orders·position_state 에 **쓰지 않는다**(position_state 는 보유 심볼 이름만 SELECT).
 */
import type { RowDataPacket } from 'mysql2';
import { isOverseasSymbol } from '@/lib/exchanges/kis-symbols';
import { readOverseasUniverse } from '@/lib/strategy/universe-overseas-static';

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
 * 수집 대상 해외 심볼 = 보유(position_state overseas) ∪ 즐겨찾기(해외 형식) ∪ **분석 대상 목록**(수동 ∪ 자동).
 * 각 SELECT 가 실패해도 나머지로 계속한다(그 출처 이름을 errors 에 남김). 심볼 이름 외의 값(수량·평단)은 읽지 않는다.
 *
 * (T-143) 목록은 `readOverseasUniverse()` 가 **DB > 마지막 성공 > 환경변수 > 코드 하드코딩** 순으로 준다. 같은 연결(`db`)을
 * 넘겨 시험 대역·트랜잭션 연결이 그대로 쓰이게 하고, 그 함수는 어떤 실패에도 던지지 않으므로 여기에 try 를 더하지 않는다.
 *
 * 🔴 목록 조회가 **제대로 안 된 사실도 `errors` 에 남긴다**(`universe_list`). 이 배열은 호출자가
 * `symbol_source_fail:*` 로 실행 기록에 남기는 값이라(`post-market-overseas.ts`), 새 출처를 그 계약에 편입하지 않으면
 * 「사용자가 저장한 목록이 빠진 채 분석이 돌았다」가 **흔적 없이** 지나간다(Reviewer high-1).
 * 🔴 **표가 없는 상태(1146)도 남긴다.** 2026-11-01 C2 Codex 지적 ①·Reviewer 재판정으로 **옛 설계가 뒤집혔다** — 처음에는
 * 「마이그레이션 전은 실패가 아니므로 남기지 않는다(거짓 경보 방지)」였는데, 그 침묵이 **「적용 뒤 재시작 + 표 소실」이라는
 * 흔한 조합까지** 덮었다(적용 후 세계에서 재시작은 일상이다 — 2026-11-01 하루에만 운영 릴리스 3회 + `max_memory_restart`).
 * DDL 이 코드보다 먼저 적용되는 것이 정식 순서이므로, 코드가 먼저 떠서 표를 못 찾는 구간의 흔적은 거짓 경보가 아니라
 * **순서 위반 신호**다. 사유만 가른다(`not_migrated` / `table_missing`). **이 문장을 되돌려 조용하게 만들지 말 것.**
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
  const universe = await readOverseasUniverse(db);
  for (const s of universe.symbols) set.add(s);
  if (universe.degraded) errors.push('universe_list');
  const symbols = [...set].filter((s) => isOverseasSymbol(s)).sort();
  return { symbols, errors };
}
