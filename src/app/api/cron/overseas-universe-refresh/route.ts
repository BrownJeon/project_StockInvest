/**
 * POST /api/cron/overseas-universe-refresh — NYSE 시가총액 상위 N 월간 산출 (T-143 WP-A).
 *
 * ⚠ 이 라우트는 **주문·시그널을 만들지 않는다.** SEC 상장 목록 1회 + KIS 종목 마스터 1회 + KIS 현재가상세 N회(읽기 GET)
 *   → `overseas_universe_run`·`_candidate` 기록 → `overseas_universe_auto` 교체 → `_proposal` INSERT IGNORE 가 전부다.
 *   `src/lib/safety/**` 를 import 하지 않고 `orders`·`signals`·`position_state` 에 쓰지 않는다.
 *
 * ## 한 번에 끝나지 않는다 — 러너가 창 안에서 매 틱 부른다
 * 후보 약 2,000종목 × 실측 0.46~0.93초 = 15~43분이라 300초 하트비트에 들어가지 않는다. 호출 1회는
 * **100초 예산 안에서 한 단계만**(listing → scan 청크 → retry → finalize) 처리하고 커서를 저장하고 돌아간다.
 * 러너(`scripts/cron-runner.sh`)는 응답의 **`final` 만** 본다: `true` 면 그 달 더 부르지 않는다.
 *
 * ## 실행 창 = 매월 첫째 일요일 01:10~05:50 KST (설정 `overseas_universe_refresh`)
 * 평일 야간은 전부 **미국 정규장**(KST 23:30~06:00)이다. 그 시간에 30~75분 걸리는 산출을 돌리면 종목마다
 * **다른 시각의 가격**으로 순위를 매기게 된다 — 시총 순위에서 받아들일 수 없다. 일요일 KST = 토요일 ET 라
 * 미국·국내 모두 닫혀 있고 모든 종목의 `last`·`tomv` 가 **금요일 종가 하나**다(서머타임과도 무관하다).
 *
 * 응답: 인증 실패 401(아무것도 하지 않음) · 그 밖은 200(러너가 본문으로 판정한다).
 *   `expiredRuns`: 이 호출이 **지난 달 미완료 run 을 닫은 수**(로그·관측용). ⚠ 분류의 근거로 쓰지 않는다 —
 *     단 한 호출에서만 0보다 커서 슬롯 ODKU 가 **덮어쓴다**.
 *   `prevMonthIncomplete`: **직전 달 run 이 `complete` 가 아니다**(매 호출 다시 읽는다). `classifyRun` 이 이 값으로
 *     그 회차를 `degraded`(`universe_run_expired`)로 남긴다 — 조건이 되풀이되므로 슬롯 최종값에 끝까지 남는다(M-2).
 *   `failCode`: 실패·만료의 분류어(`job_run_log.error_code` 용). `lastError` 는 사람이 읽는 문장이다.
 *   `skipped`: 관문 거절의 사유 코드. **`already_running` 을 뺀 모든 거절이 싣는다** — 없으면 `classifyRun` 이
 *     `ok` 로 분류해 「한 번도 안 돈 달」이 성공으로 보인다(M-8). `universe_disabled`·`universe_wrong_weekday`·
 *     `universe_outside_window`·`holidays_unknown`·`us_session_open`·`tables_missing`.
 *   `status`: disabled(스위치 꺼짐) · wrong_weekday · outside_window · calendar_unknown · us_session_open · already_running ·
 *             tables_missing · listing · scan_partial · scan_done · retry_done · throttled · complete · failed · expired
 * 인증: `checkCronAuth()`(x-cron-secret, fail-closed).
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkCronAuth } from '@/lib/cron-auth';
import { getPool } from '@/lib/db';
import { toSecTicker } from '@/lib/data/us-edgar/parse';
import { SecClient, readSecUserAgent } from '@/lib/data/us-edgar/sec-client';
import { PriceDetailUnavailableError, getPriceDetailByExcd } from '@/lib/exchanges/kis-overseas';
import { isKisThrottleFailure, withKisPriority } from '@/lib/exchanges/kis-throttle';
import { isUsRegularSessionOpen, loadUsClosedDaysStrict, yearsNeededFor } from '@/lib/strategy/us-session';
import { fetchNyseMaster } from '@/lib/universe/kis-overseas-master';
import {
  SEC_COMPANY_TICKERS_EXCHANGE_URL, runKeyOf, runUniverseRefresh,
  type FetchPriceOutcome, type RefreshDeps,
} from '@/lib/universe/refresh-engine';
import { expireOldRuns, readPrevMonthRunPhase } from '@/lib/universe/refresh-store';
import { readAutoRefreshConfig, readUniverseParts, type Queryable } from '@/lib/universe/store';
import { notifyUniverseRefresh } from '@/lib/universe/refresh-notify';

export const dynamic = 'force-dynamic';

const KST_OFFSET_MS = 9 * 3600_000;

/**
 * 🔴 프로세스 안 단일 실행 — 러너는 직렬이지만 **수동 호출이 겹칠 수 있다.** 두 호출이 같은 run 의 같은 청크를
 * 집으면 같은 종목을 두 번 불러 유량만 쓴다(결과는 멱등이라 데이터가 깨지지는 않는다).
 * pm2 `stockinvest` 는 `instances: 1` 이라 이 깃발로 충분하다(`kis-throttle.ts`·`universe-overseas-static.ts` 와 같은 전제).
 */
let inFlight = false;

/** KST 벽시계 `HH:MM` 과 요일(0=일). */
function kstClock(now: Date): { hhmm: string; weekday: number } {
  const w = new Date(now.getTime() + KST_OFFSET_MS);
  const hh = String(w.getUTCHours()).padStart(2, '0');
  const mm = String(w.getUTCMinutes()).padStart(2, '0');
  return { hhmm: `${hh}:${mm}`, weekday: w.getUTCDay() };
}

/** 그 달에서 몇 번째 그 요일인가(1 = 첫째). */
function nthWeekdayOccurrence(now: Date): number {
  const w = new Date(now.getTime() + KST_OFFSET_MS);
  return Math.floor((w.getUTCDate() - 1) / 7) + 1;
}

/**
 * KIS 현재가상세 1건 — 오류를 **셋으로 가른다**(사양 §3.3).
 *
 * ⚠ 어댑터가 「판정 불가」와 「HTTP 오류」를 **같은 예외 클래스**로 던지므로 메시지로 가른다. 깨지기 쉬운 판정이라
 * 전용 예외 클래스를 두는 쪽이 맞지만 그것은 `src/lib/exchanges/` 의 기존 동작을 바꾸는 일이라 이 작업 범위 밖이다
 * (별 task). 틀려도 **방향이 안전한 쪽**으로 틀린다: 모르면 `error` 로 보고 `retry` 가 한 번 더 본다.
 */
async function fetchPrice(kisSymb: string): Promise<FetchPriceOutcome> {
  try {
    const d = await withKisPriority('bulk', () => getPriceDetailByExcd('NYS', kisSymb));
    return {
      kind: 'ok',
      values: {
        tomv: d.marketCap, shar: d.shares, last: d.lastPrice,
        curr: d.currency, etypNm: d.etpType,
        rsym: typeof d.raw?.rsym === 'string' ? (d.raw.rsym as string) : null,
      },
    };
  } catch (e) {
    if (isKisThrottleFailure(e)) {
      return { kind: 'throttled', error: e instanceof Error ? e.message.slice(0, 150) : 'throttle' };
    }
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof PriceDetailUnavailableError) {
      if (msg.includes('레이트리밋')) return { kind: 'throttled', error: msg.slice(0, 150) };
      if (msg.includes('판정 불가')) return { kind: 'missing', error: msg.slice(0, 150) };
    }
    return { kind: 'error', error: msg.slice(0, 150) };
  }
}

export async function POST(req: NextRequest) {
  const authErr = checkCronAuth(req);
  if (authErr) return authErr;

  const now = new Date();
  const db = getPool() as unknown as Queryable;

  // ── 관문 2: 산출 스위치. **키 없음·해석 불가 = 꺼짐**(새 기능 = 꺼짐 규칙). 외부 호출 0건으로 끝낸다.
  const cfg = await readAutoRefreshConfig(db);
  if (!cfg.enabled) {
    // 🔴 `skipped` 를 실어야 실행 기록이 **건너뜀**으로 남는다. 없으면 `classifyRun` 이 `ok` 로 분류해
    //   「한 번도 안 돈 달」이 성공으로 보인다(러너는 스위치를 모르고 창 안에서 계속 부른다).
    return NextResponse.json({
      ok: true, status: 'disabled', skipped: 'universe_disabled', final: true, runKey: runKeyOf(now.getTime()),
    });
  }

  // ── 관문 3: 요일·회차·창(설정값). 러너도 같은 조건을 보지만 러너는 `system_config` 를 읽지 못해 상수다 → 둘 다 본다.
  const { hhmm, weekday } = kstClock(now);
  const runKey = runKeyOf(now.getTime());
  /**
   * 🔴 **관문 거절에는 `skipped` 를 반드시 싣는다**(Reviewer r3 M-8). `classifyRun` 은 200 + `ok:true` +
   * `skipped` 없음을 **`ok`(성공)** 으로 분류한다. 그래서 전에는 설정(`system_config`)과 러너 상수가
   * 어긋나 **한 달 내내 거절돼도 실행 기록이 성공**이었고, 그 달은 run 행조차 없어 다음 달
   * `prevMonthIncomplete` 도 false 였다 — 침묵이 겹쳐 아무 데도 드러나지 않는다.
   *
   * 사유 어휘: 뜻이 같은 기존 코드는 재사용하고(`holidays_unknown`·`us_session_open` — 사전에 중복
   * 항목을 만들지 않는다), 이 잡의 창 계산 고유 사유만 `universe_` 접두로 새로 넣는다.
   */
  if (weekday !== cfg.weekday || nthWeekdayOccurrence(now) !== cfg.nth) {
    return NextResponse.json({
      ok: true, status: 'wrong_weekday', skipped: 'universe_wrong_weekday', final: false, runKey, kst: hhmm, weekday,
    });
  }
  if (!(hhmm >= cfg.windowStart && hhmm < cfg.windowEnd)) {
    return NextResponse.json({
      ok: true, status: 'outside_window', skipped: 'universe_outside_window', final: false, runKey, kst: hhmm,
    });
  }

  // ── 관문 4: 휴장 관문. `loadUsClosedDaysStrict` 는 그 연도 행이 없으면 **던진다** → 「열려 있을지 모름」으로 보고
  //   호출을 거부한다(모르는 채로 미국 장중일 수 있는 시각에 2,000건을 부르지 않는다).
  let closed: ReadonlySet<string>;
  try {
    closed = await loadUsClosedDaysStrict(db, yearsNeededFor(now));
  } catch (e) {
    console.warn(`[cron/overseas-universe-refresh] 휴장표 모름 — 산출을 거부한다: ${e instanceof Error ? e.message : String(e)}`);
    return NextResponse.json({
      ok: true, status: 'calendar_unknown', skipped: 'holidays_unknown', final: false, runKey, kst: hhmm,
    });
  }
  if (isUsRegularSessionOpen(now, closed)) {
    // 설정이 잘못돼 장중 창을 가리키는 경우의 마지막 방어(일요일 KST 는 미국 토요일이라 정상적으로는 닿지 않는다)
    return NextResponse.json({
      ok: true, status: 'us_session_open', skipped: 'us_session_open', final: false, runKey, kst: hhmm,
    });
  }

  // ── 관문 5: 단일 실행
  //   ⚠ 여기만 `skipped` 를 **일부러 싣지 않는다**(M-8 범위 밖). 창 안에서 앞 호출이 도는 동안 나는
  //   정상 동작이고, 이 회차를 건너뜀으로 남기면 **정상 산출 중인 슬롯이 건너뜀으로 덮인다**.
  if (inFlight) {
    return NextResponse.json({ ok: true, status: 'already_running', final: false, runKey, kst: hhmm });
  }
  inFlight = true;
  try {
    /**
      * 지난 달에 못 끝낸 run 은 여기서 닫는다 — 이달 창이 열렸으므로 그 run 은 더 이어갈 수 없다.
      *
      * 🔴 **그 사실을 응답에 싣는다**(M-2). 전에는 `UPDATE` + `console.warn` 뿐이어서 「한 달 산출이 끝나지
      * 않았다」가 응답·`job_run_log`·홈 **어디에도 오르지 않았다** — 자동 목록은 지난달 것(첫 달이면 빈 목록)으로
      * 조용히 남는다. `classifyRun` 이 이 수를 보고 그 회차를 `degraded` 로 남긴다.
      */
    const expired = await expireOldRuns({ runKey, nowMs: now.getTime(), db });
    const expiredRuns = expired.kind === 'ok' ? expired.data : 0;
    if (expiredRuns > 0) {
      console.warn(`[cron/overseas-universe-refresh] 지난 달 미완료 run ${expiredRuns}건을 expired 로 닫았다`);
    }
    /**
     * 🔴 **판정의 근거는 「닫은 수」가 아니라 이 값이다**(Reviewer r2 ②). `expiredRuns` 는 단 한 호출에서만
     * 0보다 크고, 창 안 호출이 전부 같은 슬롯으로 모여 `RUN_ODKU` 가 마지막 호출로 **덮어쓰므로** 그 신호는
     * 슬롯 최종값에서 사라진다. 「직전 달 run 이 complete 가 아니다」는 **매 호출 같은 값**이라 끝까지 남는다
     * (실패 쪽이 살아남는 이유와 같은 방식 — 조건을 되풀이한다).
     */
    const prevPhase = await readPrevMonthRunPhase({ runKey, db });
    const prevMonthIncomplete = prevPhase.kind === 'ok' && prevPhase.data != null && prevPhase.data !== 'complete';

    const ua = readSecUserAgent();
    const sec = ua ? new SecClient({ userAgent: ua }) : null;
    const deps: RefreshDeps = {
      db,
      getConnection: undefined,
      nowMs: () => Date.now(),
      fetchSecListing: sec
        ? async () => {
          const r = await sec.getJson(SEC_COMPANY_TICKERS_EXCHANGE_URL);
          if (r.status !== 200) throw new Error(`SEC HTTP ${r.status}`);
          return { json: r.json, sha256: r.sha256 };
        }
        : null,
      fetchMaster: () => fetchNyseMaster(),
      fetchPrice,
      readManualList: async () => (await readUniverseParts(db, Date.now())).manual,
      secTickerOf: toSecTicker,
    };

    const result = await runUniverseRefresh(deps, { topN: cfg.topN, excludeDr: cfg.excludeDr }, runKey);
    // 표가 없으면 「건너뜀」이다 — `edgar-sync` 의 `{ok:true, skipped:'tables_missing'}` 과 같은 규약으로 남긴다
    if (result.status === 'tables_missing') {
      return NextResponse.json({ ...result, skipped: 'tables_missing', kst: hhmm, expiredRuns, prevMonthIncomplete });
    }

    // 알림은 **산출이 확정된 뒤 1회**다. 여기서 실패해도 산출은 그대로다(알림 실패로 run 을 되돌리지 않는다).
    if (result.status === 'complete' && result.runId != null) {
      try {
        await notifyUniverseRefresh({
          runId: result.runId,
          added: result.changes?.added ?? [],
          removed: result.changes?.removed ?? [],
          // 🔴 1회차는 diff 가 비어도 알린다(high-2) — 0 → 상위 N 이 가장 큰 변화다
          firstRun: result.changes?.firstRun === true,
          top: result.changes?.top ?? [],
          nowMs: Date.now(),
          db,
        });
      } catch (e) {
        console.error(`[cron/overseas-universe-refresh] 알림 실패(산출은 확정됨): ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return NextResponse.json({ ...result, kst: hhmm, expiredRuns, prevMonthIncomplete });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[cron/overseas-universe-refresh] fatal error:', error);
    return NextResponse.json({ ok: false, status: 'failed', final: false, runKey, error }, { status: 500 });
  } finally {
    inFlight = false;
  }
}
