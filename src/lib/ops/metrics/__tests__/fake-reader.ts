/**
 * 시험 대역 — SQL 조각으로 응답을 고르는 OpsReader. 실제 래퍼(read-only.ts)의 SELECT 전용 검사를 그대로 거친다.
 * 응답이 Error 면 그 쿼리는 던진다(섹션 실패 격리 시험). 맞는 경로가 없으면 빈 배열.
 */
import { assertSelectOnly, classifyDbError, type OpsReader } from '../read-only';

export type Route = [match: string | RegExp, reply: unknown[] | Error | ((params: unknown[]) => unknown[] | Error)];

export interface FakeReader extends OpsReader { calls: { sql: string; params: unknown[] }[] }

export function fakeReader(nowMs: number, routes: Route[]): FakeReader {
  const calls: { sql: string; params: unknown[] }[] = [];
  const memo = new Map<string, Promise<unknown>>();
  return {
    nowMs,
    calls,
    memo<T>(key: string, fn: () => Promise<T>): Promise<T> {
      let p = memo.get(key) as Promise<T> | undefined;
      if (!p) { p = fn(); memo.set(key, p); }
      return p;
    },
    async rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      assertSelectOnly(sql);
      calls.push({ sql, params });
      for (const [m, reply] of routes) {
        const hit = typeof m === 'string' ? sql.includes(m) : m.test(sql);
        if (!hit) continue;
        const v = typeof reply === 'function' ? reply(params) : reply;
        if (v instanceof Error) throw classifyDbError(v);
        return v as T[];
      }
      return [];
    },
  };
}

/** mysql2 모양의 오류(errno). */
export function dbError(errno: number, message = `errno ${errno}`): Error {
  return Object.assign(new Error(message), { errno });
}

/** KST 벽시계 → epoch ms. */
export function kst(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) throw new Error(s);
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)) - 9 * 3600_000;
}
