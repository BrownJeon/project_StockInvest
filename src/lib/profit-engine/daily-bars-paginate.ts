/**
 * T-070 일봉 연속조회(페이지네이션) — 페이지 조회 함수를 주입받는 순수 루프.
 *
 * 커서 = 다음 요청의 기준일(포함). 한 페이지를 받으면 "이번 페이지가 빠짐없이 덮은 가장 이른 날"(국내는 요청 기간 시작일,
 * 해외는 받은 가장 오래된 날)의 하루 전으로 옮긴다.
 *
 * 종료 조건(먼저 걸리는 것):
 *  - reached     : 덮은 하한이 stopAt 이하 — 필요한 만큼 받았다
 *  - exhausted   : 빈 페이지 — 상장 이전에 닿았다(국내는 요청 기간이 stopAt 까지 덮였으면 빈 페이지라도 reached)
 *  - no_progress : 새 날짜가 하나도 없거나 하한이 과거로 움직이지 않았다 — KIS 가 커서를 무시하는 경우의 무한 루프 방지
 *  - page_cap    : 종목당 페이지 상한
 *  - budget      : 실행 예산(호출 수·시간) 소진 — 다음 실행이 저장된 MIN(trade_date) 에서 이어 간다
 *  - error       : 조회 실패 — 그때까지 받은 페이지는 돌려준다(호출자가 쓸지 정한다)
 */
import { mergePages, type AdjMode, type MergeResult, type RawBar } from './daily-bars-quality';
import { addDays, type BarMarket } from './daily-bars-time';
import type { FetchDailyPage } from './daily-bars-kis';

export type PaginateReason = 'reached' | 'exhausted' | 'no_progress' | 'page_cap' | 'budget' | 'error';

export interface PaginateOptions {
  fetchPage: FetchDailyPage;
  market: BarMarket;
  symbol: string;
  adjMode: AdjMode;
  /** 첫 요청 기준일(null = 오늘) */
  startCursor: string | null;
  stopAt: string;
  /**
   * (R-1b) 연속성 기준일. 받은 하한이 stopAt 까지 못 갔어도 이 날짜 이하이면 'reached' 로 끝낸다 —
   * 증분에서 기준일(저장 MAX) 행까지 받았으면 저장분과 이어진 것이고, stopAt(기준일−10일)은 조정 감지용 겹침일 뿐이다.
   * (상장 직후라 기준일−10일 이전 거래가 아예 없는 종목이 여기서 막히지 않게 한다.)
   */
  satisfiedAt?: string;
  maxPages: number;
  /** 호출 직전 예산 확인. false 면 호출하지 않고 'budget' 으로 끝낸다. true 를 돌려주면 호출 1회를 쓴 것으로 센다. */
  takeCall: () => boolean;
  /** 같은 종목 안 두 번째 호출부터 그 앞에 기다리는 함수(호출 간격). */
  pace?: () => Promise<void>;
}

export interface PaginateResult {
  merge: MergeResult;
  calls: number;
  reason: PaginateReason;
  error?: unknown;
  rowsPerCall: number[];
  dropped: number;
  /** 빠짐없이 덮은 가장 이른 날(받은 페이지 기준). 페이지가 없으면 null */
  coveredFloor: string | null;
}

export async function paginateDaily(o: PaginateOptions): Promise<PaginateResult> {
  const pages: RawBar[][] = [];
  const seen = new Set<string>();
  const rowsPerCall: number[] = [];
  let calls = 0;
  let dropped = 0;
  let cursor = o.startCursor;
  let floor: string | null = null;
  let reason: PaginateReason;
  let error: unknown;

  for (;;) {
    if (calls >= o.maxPages) { reason = 'page_cap'; break; }
    if (!o.takeCall()) { reason = 'budget'; break; }
    if (calls > 0 && o.pace) await o.pace();
    let page;
    try {
      page = await o.fetchPage({ market: o.market, symbol: o.symbol, endDate: cursor, stopAt: o.stopAt, adjMode: o.adjMode });
    } catch (e) {
      calls++;
      reason = 'error';
      error = e;
      break;
    }
    calls++;
    rowsPerCall.push(page.rawCount);
    dropped += page.dropped;
    if (page.rows.length === 0) {
      // 국내: 요청 기간을 빠짐없이 받았는데 비어 있으면(휴장·거래정지) 그 기간은 덮은 것이다
      if (page.coveredFrom && page.coveredFrom <= o.stopAt) {
        if (floor === null || page.coveredFrom < floor) floor = page.coveredFrom;
        reason = 'reached';
      } else reason = 'exhausted';
      break;
    }

    const before = seen.size;
    for (const r of page.rows) seen.add(r.tradeDate);
    const added = seen.size - before;
    pages.push(page.rows);

    let earliest = page.rows[0].tradeDate;
    for (const r of page.rows) if (r.tradeDate < earliest) earliest = r.tradeDate;
    const pageFloor = page.coveredFrom && page.coveredFrom < earliest ? page.coveredFrom : earliest;
    const prevFloor = floor;
    if (floor === null || pageFloor < floor) floor = pageFloor;

    if (pageFloor <= o.stopAt || (o.satisfiedAt !== undefined && pageFloor <= o.satisfiedAt)) { reason = 'reached'; break; }
    if (added === 0 || (prevFloor !== null && pageFloor >= prevFloor)) { reason = 'no_progress'; break; }
    cursor = addDays(pageFloor, -1);
  }

  return { merge: mergePages(pages), calls, reason, error, rowsPerCall, dropped, coveredFloor: floor };
}
