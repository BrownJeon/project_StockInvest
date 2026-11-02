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
 *
 * ## 🔴 1회 실행 마감 90초 + 이어받기 (T-145 ⑨ — 08시 틱 시간 예산)
 * 전에는 **마감이 없어** 대상 종목 수에 비례해 한 호출이 길어졌다(2026-10-29 운영 실측 **156초**). 러너의 하트비트는
 * **틱 시작에만** 쓰이고 HOME-SERVER 순찰이 **300초** 무응답에 `pm2 restart stockinvest-cron` 을 돌리므로, 자동 목록을
 * 켜 대상이 +30~50 늘면 그 틱이 300초를 넘어 **cron 이 재시작된다**(틱 345~427초 추정).
 *
 * 그래서 ① 한 호출은 **`SNAPSHOT_DEFAULT_BUDGET_MS`(기본 90초)** 안에서 처리하고 끊는다 ② 끊긴 뒤는 **DB 가 이어받는다** —
 * 표가 `uq_symbol_day (symbol, snapshot_date)` 이고 `snapshot_date = CURDATE()` 로 upsert 하므로
 * **「오늘 행이 없는 대상 종목」이 곧 남은 일**이다. 새 표·`system_config` 행·진행률 파일을 만들지 않는다(DDL 변경 0) —
 * 프로세스 재시작·대상 집합 변경에 저절로 안전하고 upsert 라 중복 처리도 무해하다.
 *
 * 🔴 **마감 종료는 실패가 아니다** — `ok: true` · `complete: false` · `partial: true` · `remaining` 이고 라우트는 200 이다
 * (`aborted: 'kis_throttle'` 만 503 이다). 503 으로 두면 `job_run_log` 가 `failed` 가 되어 「끊고 이어받는 정상 동작」이
 * 매일 실패로 보인다. `partial: true` 는 `classifyRun` 이 그 회차를 `partial`(남은 수)로 남기게 하는 기존 규약이다.
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
  /** 테스트용 주입(마감 판정). 기본 `Date.now`. */
  nowMs?: () => number;
  /** 테스트용 주입(마감 길이). 기본 `SNAPSHOT_DEFAULT_BUDGET_MS` 또는 `KIS_FUND_BUDGET_MS`. */
  budgetMs?: number;
}

/**
 * 🔴 **1회 실행 마감 기본값 90초**(T-145 ⑨-1). 환경변수 `KIS_FUND_BUDGET_MS` 로 조정한다(양의 정수만, 그 밖은 이 값).
 *
 * 왜 90초인가: 러너의 이 호출 curl 상한이 110초(`KIS_FUND_CURL_MAX_TIME`)이고, 창의 한 틱 최악은
 * 스냅샷 110 + 매 분 잡 약 50 + `sleep 60` ≈ 220초로 순찰 한도 300초 안이다. 마감을 60초로 낮추면 틱은 더 짧아지지만
 * 창 안에서 더 많은 틱이 필요하다(사양 9-5 의 대가).
 */
export const SNAPSHOT_DEFAULT_BUDGET_MS = 90_000;

/**
 * 🔴 **환경변수 값의 상한 100초**(Reviewer L-7). 왜 안전장치인가: 이 파일은 커밋 훅 감시 대상이라 「마감을 지우거나
 * 올리는 **코드** 변경」은 독립 감사를 거친다. 그런데 `.env` 에 `KIS_FUND_BUDGET_MS=600000` 한 줄을 넣으면
 * **코드 한 줄 없이 같은 결과**가 된다 — 환경변수는 훅이 막지 못한다. 그래서 값 자체에 상한을 둔다.
 *
 * 왜 100초인가 — 러너의 이 호출 curl 상한 `KIS_FUND_CURL_MAX_TIME=110`(`scripts/cron-runner.sh`) 안에서
 * **서버가 반드시 먼저 끝나야** 한다:
 *  · 틱 길이 자체는 curl 상한이 지킨다(110 + stop-alert 20 + 매 분 잡 약 30 + sleep 60 = 약 220초 < 300초 순찰 한도).
 *  · 그러나 마감이 110초를 넘으면 **러너는 110초에 포기하고 서버는 계속 돈다** → 다음 틱의 호출이
 *    `already_running`(이 모듈의 단일 실행 깃발)으로 거절되고 **창이 진행을 멈춘다**. 마감만 늘려도 그 달이 미완이 된다.
 *  · 마지막 종목의 KIS 왕복(실측 0.46~0.93초, 최악 2.9초)과 upsert·응답 직렬화에 여유 10초를 남겨 110 − 10 = 100 이다.
 * ⚠ `KIS_FUND_CURL_MAX_TIME` 을 함께 올리면 이 상한의 근거가 달라진다 — 그 파일도 훅 감시 대상이므로
 *   그 변경은 독립 감사를 거친다(둘을 함께 올리는 것은 감사 사항이다).
 */
export const SNAPSHOT_MAX_BUDGET_MS = 100_000;
/**
 * 🔴 **환경변수 값의 하한 30초**(Reviewer L-7). 마감이 너무 짧으면 한 호출이 한두 종목만 처리해
 * **창 안에 그날 수집이 끝나지 않는다**(첫 종목은 `i > 0` 가드로 늘 처리되므로 멈추지는 않지만 끝나지도 않는다).
 * 근거: 최악 요율 2.9초/종목에서 30초면 약 10종목이고, 창(08:30~08:55)에서 틱이 150초면 최소 6~10회 호출 =
 * 60~100종목이다. 현재 대상 54종목과 자동 목록을 켠 뒤의 +30~50 을 덮는다. 그 아래로는 「끝나지 않는 창」이 된다.
 */
export const SNAPSHOT_MIN_BUDGET_MS = 30_000;

/**
 * 환경변수에서 마감을 읽는다. 양의 정수가 아니면 기본값, **범위를 벗어나면 클램프하고 경고를 남긴다**
 * (조용히 무시하면 운영자가 「600초로 설정했다」고 믿는다 — Reviewer L-7).
 *
 * ⚠ `deps.budgetMs`(시험 주입)는 **클램프하지 않는다**. 그 경로는 `.env` 로 닿을 수 없고(라우트는 `{ db }` 만 넘긴다)
 * 경계 동작을 시험이 직접 재현해야 한다. 운영에서 값이 들어오는 길은 이 함수 하나다.
 */
function envBudgetMs(): number {
  const raw = Number(process.env.KIS_FUND_BUDGET_MS);
  if (!Number.isFinite(raw) || raw <= 0) return SNAPSHOT_DEFAULT_BUDGET_MS;
  const want = Math.trunc(raw);
  if (want > SNAPSHOT_MAX_BUDGET_MS) {
    console.warn(
      `[kis-fundamentals-snapshot] KIS_FUND_BUDGET_MS=${want}ms 는 상한 ${SNAPSHOT_MAX_BUDGET_MS}ms 를 넘습니다 —`
      + ` ${SNAPSHOT_MAX_BUDGET_MS}ms 로 줄여 씁니다. 러너 curl 상한(KIS_FUND_CURL_MAX_TIME=110초)보다 길면`
      + ' 러너가 먼저 포기하고 서버가 계속 돌아 다음 틱이 already_running 으로 거절되고 창이 멈춥니다.',
    );
    return SNAPSHOT_MAX_BUDGET_MS;
  }
  if (want < SNAPSHOT_MIN_BUDGET_MS) {
    console.warn(
      `[kis-fundamentals-snapshot] KIS_FUND_BUDGET_MS=${want}ms 는 하한 ${SNAPSHOT_MIN_BUDGET_MS}ms 보다 작습니다 —`
      + ` ${SNAPSHOT_MIN_BUDGET_MS}ms 로 올려 씁니다. 더 짧으면 한 호출이 한두 종목만 처리해 창 안에 그날 수집이 끝나지 않습니다.`,
    );
    return SNAPSHOT_MIN_BUDGET_MS;
  }
  return want;
}

export interface SnapshotResult {
  ok: boolean;
  skipped?: 'tables_missing' | 'already_running';
  missing?: string[];
  /** 🔴 유량(스로틀)으로 **중단**했다 — 실패다(`ok:false`, 라우트 503). 마감 종료(`stopped`)와 구분한다. */
  aborted?: 'kis_throttle';
  /**
   * 🔴 **마감으로 끊었다** — 실패가 **아니다**(`ok:true`, 라우트 200). 남은 일은 다음 호출이 DB 로 이어받는다.
   * `aborted` 와 같은 자리에 두지 않는 이유: 라우트가 `aborted` 만 503 으로 보내고, `job_run_log` 는 그것을
   * `failed` 로 남긴다 — 정상 동작을 매일 실패로 기록하게 된다(T-145 ⑨-1 · 사양 9-7).
   */
  stopped?: 'budget';
  targets?: number;
  /** 이번 호출이 **건너뛴** 대상 수(오늘 이미 행이 있다) — 이어받기가 돌고 있다는 증거. */
  alreadyDone?: number;
  written?: number;
  failed?: Array<{ symbol: string; error: string }>;
  /**
   * 이번 호출이 **남은 일을 끝까지 돌았나**. 마감·유량으로 끊겼으면 false.
   * ⚠ 「오늘 모든 종목에 행이 있다」는 뜻이 **아니다** — 조회가 실패한 종목은 오늘 행이 없어 다음 호출이 다시 본다(의도).
   */
  complete?: boolean;
  /** 마감·유량으로 끊겨 **아직 손대지 못한** 대상 수. 끊기지 않았으면 0. */
  remaining?: number;
  /** `classifyRun` 이 그 회차를 `partial`(남은 수)로 남기게 한다 — **마감 종료일 때만** 싣는다(실패가 아니다). */
  partial?: boolean;
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

/**
 * 🔴 **오늘 이미 받은 종목** — 이어받기의 **유일한 상태**다(T-145 ⑨-2). 새 표·설정 행·진행률 파일을 만들지 않는다.
 *
 * 조회가 실패하면 **빈 집합**이다 = 전부 다시 돈다. 덜 하는 쪽이 아니라 **더 하는 쪽으로** 틀린다 —
 * upsert 라 중복 처리가 무해하고, 틀려서 빠뜨리면 그날 그 종목이 조용히 비기 때문이다.
 */
async function readDoneToday(db: Queryable, log: (line: string) => void): Promise<Set<string>> {
  try {
    const [rows] = await db.query<Array<{ symbol?: unknown }>>(
      'SELECT symbol FROM us_fundamentals_snapshot WHERE snapshot_date = CURDATE()',
    );
    const out = new Set<string>();
    for (const r of Array.isArray(rows) ? rows : []) {
      const sym = r?.symbol == null ? '' : String(r.symbol).trim();
      if (sym) out.add(sym);
    }
    return out;
  } catch (e) {
    const x = e as { code?: string; name?: string } | null;
    log(`[kis-fundamentals-snapshot] 오늘 수집분 조회 실패(전부 다시 돈다): ${String(x?.code ?? x?.name ?? 'unknown').slice(0, 60)}`);
    return new Set();
  }
}

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
  const nowMs = deps.nowMs ?? (() => Date.now());
  const budget = deps.budgetMs != null && deps.budgetMs > 0 ? Math.trunc(deps.budgetMs) : envBudgetMs();
  const t0 = nowMs();
  const { symbols } = await loadUsTargetSymbols(db);
  // 🔴 이어받기 — 오늘 행이 있는 종목은 **부르지 않는다**(⑨-2). 대상 집합이 틱 사이에 바뀌어도 저절로 맞는다
  const done = await readDoneToday(db, log);
  const pending = symbols.filter((s) => !done.has(s));
  const res: SnapshotResult = {
    ok: true, targets: symbols.length, alreadyDone: symbols.length - pending.length,
    written: 0, failed: [], complete: true, remaining: 0,
  };

  for (let i = 0; i < pending.length; i += 1) {
    const symbol = pending[i];
    /**
     * 🔴 마감 검사는 종목 처리 **전**이다(⑨-1). 단, **첫 종목은 언제나 처리한다**(`i > 0`) —
     * 앞의 조회(`loadUsTargetSymbols`·`readDoneToday`)가 마감을 다 써 버린 경우에 `written:0` 으로 돌아가면
     * 다음 틱도 같은 자리에서 멈춰 **아무 진행도 없는 고리**가 된다. 한 종목씩이라도 반드시 전진시킨다.
     */
    if (i > 0 && nowMs() - t0 >= budget) {
      res.stopped = 'budget';
      res.complete = false;
      res.partial = true;
      res.remaining = pending.length - i;
      break;
    }
    let d: OverseasPriceDetail;
    try {
      d = await withKisPriority('bulk', () => fetchDetail(symbol));
    } catch (e) {
      const msg = (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 200);
      res.failed!.push({ symbol, error: msg });
      if (isKisThrottleFailure(e)) {
        res.ok = false;
        res.aborted = 'kis_throttle';
        res.complete = false;
        // 이 종목도 못 했다 → 남은 수에 포함한다(`partial` 은 싣지 않는다 — ok:false 라 그 회차는 `failed` 다)
        res.remaining = pending.length - i;
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
  log(`[kis-fundamentals-snapshot] done ok=${res.ok} targets=${res.targets} already_done=${res.alreadyDone}`
    + ` written=${res.written} failed=${res.failed!.length} complete=${res.complete} remaining=${res.remaining}`
    + (res.aborted ? ` aborted=${res.aborted}` : '')
    + (res.stopped ? ` stopped=${res.stopped}` : '')
    + (res.failed!.length ? ` failed_list=${res.failed!.map((f) => f.symbol).join(',')}` : ''));
  return res;
}
