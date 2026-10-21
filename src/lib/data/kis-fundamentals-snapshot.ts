/**
 * `kis-fundamentals-snapshot` 본체 (T-059 Part A) — KIS 해외 현재가상세(HHDFS76200200) 원값 → `us_fundamentals_snapshot`.
 *
 *  - 읽기 전용 GET 만. 주문·잔고 API 를 부르지 않는다. 요청에는 거래소·티커만 실린다(보유 수량·평단 없음).
 *  - 대상 = 보유 ∪ 즐겨찾기 ∪ universe 50 (해외 형식). ETF 도 포함한다(EDGAR 와 달리 KIS 는 ETF 시세를 준다 — `etp_type` 으로 구분).
 *  - **직렬**로 부르고 `withKisPriority('bulk')` 로 감싸 장중·주문 경로(critical/normal) 토큰을 뺏지 않는다.
 *  - 종목 단위 격리: 한 종목이 실패하면 그 종목만 행을 쓰지 않는다(0·NULL 로 채우지 않음). 기존 행은 지우지 않는다.
 *    유량 대기열 초과·대기 시간초과(`isKisThrottleFailure`)는 남은 종목도 같은 결과일 것이므로 **그 자리에서 멈춘다**(증폭 방지).
 *  - 하루 1행(`uq_symbol_day` = symbol + KST 날짜) — 같은 날 재실행하면 갱신한다. (C-2) 측정값 열은
 *    `COALESCE(VALUES(col), col)` — **새 응답에서 빠진(null) 값은 그날 앞서 받은 값을 보존**한다(부분 응답이 정상 값을 NULL 로
 *    지우지 않게). `raw_output`·`observed_at` 은 항상 최신으로. 첫 삽입이 부분이면 NULL 그대로다.
 *  - (C-3) DB 쓰기도 종목 단위로 격리한다 — 한 종목의 INSERT 가 거부돼도 `failed` 에 남기고 다음 종목으로 간다. `observed_at`·`snapshot_date` 는 DB `NOW()`·`CURDATE()`
 *    (DB 시간대 KST)로 넣는다 — JS 의 UTC 문자열을 DATETIME 에 넣지 않는다(T-046).
 *
 * 쓰는 테이블: us_fundamentals_snapshot 뿐.
 */
import { getPriceDetail, type OverseasPriceDetail } from '@/lib/exchanges/kis-overseas';
import { withKisPriority, isKisThrottleFailure } from '@/lib/exchanges/kis-throttle';
import { SNAPSHOT_TABLES, findMissingTables, loadUsTargetSymbols, type Queryable } from './us-data-db';

export interface SnapshotDeps {
  db: Queryable;
  /** 테스트용 주입. 기본은 KIS 실호출(`getPriceDetail`). */
  fetchDetail?: (symbol: string) => Promise<OverseasPriceDetail>;
  log?: (line: string) => void;
}

export interface SnapshotResult {
  ok: boolean;
  skipped?: 'tables_missing' | 'already_running';
  missing?: string[];
  aborted?: 'kis_throttle';
  targets?: number;
  written?: number;
  failed?: Array<{ symbol: string; error: string }>;
}

let running = false;

/** 측정값 열 — 같은 날 재실행에서 새 값이 null 이면 기존 값 보존(C-2). */
export const SNAPSHOT_VALUE_COLUMNS = [
  'per', 'pbr', 'eps', 'bps', 'market_cap', 'shares', 'h52', 'l52', 'h52_date', 'l52_date',
  'last_price', 'currency', 'sector', 'etp_type',
] as const;

export const SNAPSHOT_UPSERT_SQL = `INSERT INTO us_fundamentals_snapshot
         (symbol, snapshot_date, per, pbr, eps, bps, market_cap, shares, h52, l52, h52_date, l52_date,
          last_price, currency, sector, etp_type, raw_output, source, observed_at)
       VALUES (?, CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'kis_price_detail', NOW())
       ON DUPLICATE KEY UPDATE ${SNAPSHOT_VALUE_COLUMNS.map((c) => `${c} = COALESCE(VALUES(${c}), ${c})`).join(', ')},
         raw_output = VALUES(raw_output), source = VALUES(source), observed_at = NOW()`;

export async function runKisFundamentalsSnapshot(deps: SnapshotDeps): Promise<SnapshotResult> {
  if (running) return { ok: false, skipped: 'already_running' };
  running = true;
  try {
    return await inner(deps);
  } finally {
    running = false;
  }
}

async function inner(deps: SnapshotDeps): Promise<SnapshotResult> {
  const { db } = deps;
  const log = deps.log ?? ((l: string) => console.log(l));
  const missing = await findMissingTables(db, SNAPSHOT_TABLES);
  if (missing.length > 0) {
    log(`[kis-fundamentals-snapshot] skipped: tables_missing (${missing.join(',')}) — scripts/migrations/T-059-us-data-collector.sql 미적용`);
    return { ok: true, skipped: 'tables_missing', missing };
  }
  const fetchDetail = deps.fetchDetail ?? getPriceDetail;
  const { symbols } = await loadUsTargetSymbols(db);
  const res: SnapshotResult = { ok: true, targets: symbols.length, written: 0, failed: [] };

  for (const symbol of symbols) {
    let d: OverseasPriceDetail;
    try {
      d = await withKisPriority('bulk', () => fetchDetail(symbol));
    } catch (e) {
      const msg = (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 200);
      res.failed!.push({ symbol, error: msg });
      if (isKisThrottleFailure(e)) {
        res.ok = false;
        res.aborted = 'kis_throttle';
        break;
      }
      continue;
    }
    try {
      await db.query(SNAPSHOT_UPSERT_SQL, [
        d.symbol, d.per, d.pbr, d.eps, d.bps, d.marketCap, d.shares, d.high52, d.low52, d.high52Date, d.low52Date,
        d.lastPrice, d.currency, d.sector, d.etpType, JSON.stringify(d.raw),
      ]);
      res.written!++;
    } catch (e) {
      // 오류 코드·이름만(값·본문 없음). 다음 종목은 계속 처리한다.
      const x = e as { code?: string; name?: string } | null;
      res.failed!.push({ symbol, error: `db_write_failed: ${String(x?.code ?? x?.name ?? 'unknown').slice(0, 60)}` });
    }
  }
  log(`[kis-fundamentals-snapshot] done ok=${res.ok} targets=${res.targets} written=${res.written} failed=${res.failed!.length}`
    + (res.aborted ? ` aborted=${res.aborted}` : '')
    + (res.failed!.length ? ` failed_list=${res.failed!.map((f) => f.symbol).join(',')}` : ''));
  return res;
}
