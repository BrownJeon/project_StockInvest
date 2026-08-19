/**
 * 리서치 사이클 실행기 — T-032.
 *
 * cron route 2개(국내·해외)가 공유하는 본체. route 파일 자체는 SAFETY_PATHS 대상이라
 * 얇게 유지하고(인증 + 위임), 실제 로직은 여기(SAFETY_PATHS 밖)에 둔다.
 *
 * 흐름: `stock_favorites WHERE research_enabled=1` → 심볼 포맷으로 시장 분리 →
 *       동시성 `CONCURRENCY`개 배치로 `buildResearchReport()` → upsert.
 * 심볼 하나가 실패해도 나머지는 계속 처리하고, 실패 사유는 `error` 컬럼에 남긴다.
 */
import { buildResearchReport, kstDateString } from './research-report';
import { listTrackedSymbols, upsertResearchResult } from './storage';
import type { ResearchMarket } from './types';

/** 동시 처리 심볼 수 — Yahoo에 과도한 동시 요청을 보내지 않기 위한 상한. */
export const CONCURRENCY = 4;

/**
 * 심볼 1개에 허용하는 총 소요 시간(설계 확정치 8초).
 * 국내 심볼은 `.KS`·`.KQ` 두 후보를 조회하지만 **병렬**이라(history-source) 소요 시간은
 * 합이 아니라 최대값이다. 개별 HTTP 타임아웃은 예산 안에 여유를 두고 6초로 잡는다.
 */
export const SYMBOL_TIMEOUT_MS = 8000;
const PER_FETCH_TIMEOUT_MS = 6000;

export interface ResearchCycleResult {
  market: ResearchMarket;
  runDate: string;
  total: number;
  succeeded: number;
  failed: number;
  failures: { symbol: string; error: string }[];
  durationMs: number;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms: ${label}`)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export async function runResearchCycle(market: ResearchMarket): Promise<ResearchCycleResult> {
  const startedAt = Date.now();
  // 배치 도중 자정을 넘겨도 한 사이클의 run_date는 하나로 고정한다(UNIQUE 키 일관성).
  const runDate = kstDateString();
  const tracked = await listTrackedSymbols(market);
  const failures: { symbol: string; error: string }[] = [];
  let succeeded = 0;

  for (let i = 0; i < tracked.length; i += CONCURRENCY) {
    const batch = tracked.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async ({ symbol }) => {
        try {
          const report = await withTimeout(
            buildResearchReport(symbol, { runDate, history: { timeoutMs: PER_FETCH_TIMEOUT_MS } }),
            SYMBOL_TIMEOUT_MS,
            symbol,
          );
          await upsertResearchResult(report);
          if (report.error) {
            failures.push({ symbol, error: report.error });
          } else {
            succeeded++;
          }
        } catch (e) {
          // 타임아웃·DB 오류 등 — 사이클은 계속 진행한다.
          const error = e instanceof Error ? e.message : String(e);
          console.error(`[research/run-cycle] ${symbol} failed:`, error);
          failures.push({ symbol, error });
        }
      }),
    );
  }

  return {
    market,
    runDate,
    total: tracked.length,
    succeeded,
    failed: failures.length,
    failures,
    durationMs: Date.now() - startedAt,
  };
}
