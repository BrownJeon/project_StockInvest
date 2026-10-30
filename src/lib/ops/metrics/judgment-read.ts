/**
 * T-108 운용 지표 — **판단 기록(T-112) 읽기 전용 reader**. 판단 기록 표 이름을 쓰는 ops 파일은 이것 하나다
 * (기록 모듈 경계 시험이 src 전체에서 표 이름 문자열을 허용 목록 밖에서 금지한다 — Leader 결정 2026-10-30 으로 이 파일 1개만 정확 일치 허용).
 *
 * 규칙:
 *  - 고정 SELECT 상수만(쓰기 키워드 0). 기록 모듈(기록기·추적기)을 import 하지 않는다 — 스위치 판독은 호출자가 한다.
 *  - **`judgment_role='baseline' AND engine_release IS NOT NULL`** 만 센다(개발 서버 행 제외 — T-112 Reviewer Info ②).
 *  - 표가 없으면(1146) `not_migrated` 로 돌려준다(던지지 않는다). 그 밖 실패는 던진다 — 호출 섹션이 「조회 실패」로 둔다.
 *  - 「불완전」: 헤더의 candidate_count ≠ 패턴이 있는 후보 행 수(기록기가 후보를 패턴 있는 것부터 넣고 상한에서 자른다).
 */
import { count, num, OpsQueryError, type OpsReader } from './read-only';
import { kstSql, toMs } from './sessions';
import type { Market } from './types';

export const JUDGMENT_RUN_SQL =
  `SELECT judgment_run_id AS id, candidate_count, started_at FROM judgment_run
    WHERE market = ? AND judgment_role = 'baseline' AND engine_release IS NOT NULL
      AND started_at >= ? AND started_at < ?
    ORDER BY started_at DESC LIMIT 1`;

export const JUDGMENT_COUNTS_SQL =
  `SELECT SUM(ai_decision = 'BUY') AS buy, SUM(pattern IS NOT NULL) AS with_pattern, COUNT(*) AS total
     FROM judgment_candidate WHERE judgment_run_id = ? AND judgment_role = 'baseline'`;

export const TOP_EXCLUSION_SQL =
  `SELECT exclusion_code, COUNT(*) AS n FROM judgment_candidate
    WHERE judgment_run_id = ? AND judgment_role = 'baseline' AND exclusion_code IS NOT NULL
    GROUP BY exclusion_code ORDER BY n DESC, exclusion_code ASC LIMIT 1`;

export const JUDGMENT_SKIP_ROWS_SQL =
  `SELECT symbol, ai_decision, confidence, exclusion_code FROM judgment_candidate
    WHERE judgment_run_id = ? AND judgment_role = 'baseline' AND (ai_decision = 'SKIP' OR exclusion_code IS NOT NULL)
    ORDER BY candidate_id ASC LIMIT 200`;

export type JudgmentHeader =
  | { kind: 'not_migrated' }
  | { kind: 'none' }
  | { kind: 'found'; id: number; buy: number; withPattern: number; candidateCount: number; top: { code: string; count: number } | null; startedMs: number | null };

/** 창 [startMs, endMs) 안 그 시장의 최근 판단 기록 1회 + 건수·제외 사유 1위. */
export async function readJudgmentHeader(r: OpsReader, market: Market, startMs: number, endMs: number): Promise<JudgmentHeader> {
  let runs: Record<string, unknown>[];
  try {
    runs = await r.rows(JUDGMENT_RUN_SQL, [market, kstSql(startMs), kstSql(endMs)]);
  } catch (e) {
    if (e instanceof OpsQueryError && e.code === 'not_migrated') return { kind: 'not_migrated' };
    throw e;
  }
  const run = runs[0];
  const id = run ? num(run.id) : null;
  if (!run || id == null) return { kind: 'none' };
  const [cnt, top] = await Promise.all([
    r.rows<Record<string, unknown>>(JUDGMENT_COUNTS_SQL, [id]),
    r.rows<Record<string, unknown>>(TOP_EXCLUSION_SQL, [id]),
  ]);
  const c = cnt[0] ?? {};
  const t = top[0];
  return {
    kind: 'found', id,
    buy: count(c.buy), withPattern: count(c.with_pattern), candidateCount: count(run.candidate_count),
    top: t && t.exclusion_code != null ? { code: String(t.exclusion_code), count: count(t.n) } : null,
    startedMs: toMs(run.started_at),
  };
}

export interface JudgmentSkipRow { symbol: string; aiDecision: 'BUY' | 'SKIP' | null; confidence: number | null; exclusionCode: string | null }

/** 그 판단 기록의 「매수 안 함」·제외 행. */
export async function readJudgmentSkipRows(r: OpsReader, runId: number): Promise<JudgmentSkipRow[]> {
  const rows = await r.rows<Record<string, unknown>>(JUDGMENT_SKIP_ROWS_SQL, [runId]);
  return rows.map((k) => {
    const dec = String(k.ai_decision);
    return {
      symbol: String(k.symbol),
      aiDecision: dec === 'BUY' ? 'BUY' : dec === 'SKIP' ? 'SKIP' : null,
      confidence: num(k.confidence),
      exclusionCode: k.exclusion_code == null ? null : String(k.exclusion_code),
    };
  });
}
