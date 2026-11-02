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
 * ## 🔴 창이 끝난 뒤 **한 틱**은 더 불린다 (T-145 ④-조각)
 * ⑥-4 로 일시 오류가 그 달을 닫지 않게 바꾸면서, 창이 끝날 때 **아무 종결 기록 없이 미완**으로 남는 경로가
 * 생겼다. 그 침묵을 막으려고 러너가 창 끝(기본 05:50)에 **한 번 더** 부르고(`scripts/cron-runner.sh` 의
 * `overseas-universe-refresh` 블록), 이 라우트는 그 호출을 「창 밖」으로 거절하면서 **그 전에** 이달 run 이
 * 미완인지 보고 텔레그램 warning 을 1회 보낸다. 그 호출은 **외부 호출 0건**이다(run 1줄 + 집계 1줄만 읽는다).
 * 알림이 실패해도 응답·판정은 그대로다(알림은 곁가지다).
 * ⚠ 한계: 러너가 창 도중에 죽어 05:50 호출이 아예 없으면 이 경고도 없다. 그 구멍은 다음 달 창의
 *   `prevMonthIncomplete`(→ `job_run_log` degraded)가 받는다 — ④ 의 나머지(홈 줄·반대 방향 빈틈)는 범위 밖이다.
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
 *   `windowIncomplete`: 창이 끝난 뒤 첫 호출에서만 — 이달 run 이 **미완이라 경고를 보냈나**(T-145 ④-조각).
 *     `{ sent, reason, phase }`. 보내지 않은 이유까지 싣는다(`complete`·`no_run`·`closed`·`already_notified` 등).
 *     🔴 그 호출은 **창 슬롯의 마지막 기록**이라 `ok`·`failCode`·`skipped` 를 그 달의 실제 상태에 맞춘다
 *     (미완 → `failed:universe_window_incomplete` · `complete` → `ok` · run 없음 → `skipped`). 아래 관문 3 주석 참고.
 *   `skipped`: 관문 거절의 사유 코드. **`already_running` 을 뺀 모든 거절이 싣는다** — 없으면 `classifyRun` 이
 *     `ok` 로 분류해 「한 번도 안 돈 달」이 성공으로 보인다(M-8). `universe_disabled`·`universe_wrong_weekday`·
 *     `universe_outside_window`·`holidays_unknown`·`us_session_open`·`tables_missing`.
 *   `status`: config_unreadable(설정 판독 실패 — `ok:false`, 건너뜀이 **아니다**) · disabled(스위치 꺼짐) ·
 *             wrong_weekday · outside_window · calendar_unknown · us_session_open · already_running ·
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
import { readAutoRefreshConfigChecked } from '@/lib/universe/refresh-config';
import { readUniverseParts, type Queryable } from '@/lib/universe/store';
import { notifyUniverseRefresh, notifyUniverseWindowIncomplete } from '@/lib/universe/refresh-notify';

export const dynamic = 'force-dynamic';

const KST_OFFSET_MS = 9 * 3600_000;

/** 아직 끝나지 않은 단계 — 창 종료 점검이 「미완」으로 보는 run 단계다(`complete`·`failed`·`expired` 가 아니다). */
const INCOMPLETE_PHASES: readonly string[] = ['listing', 'scan', 'retry', 'finalize'];

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
  const { cfg, readFailed: cfgUnreadable } = await readAutoRefreshConfigChecked(db);
  /**
   * 🔴 **판독 실패를 「꺼짐」보다 먼저 가른다**(Codex C2 지적 1 — Reviewer 채택).
   *
   * 전에는 `readAutoRefreshConfig` 가 판독 실패를 기본값(`enabled:false`)으로 축약해 이 관문이
   * **사용자가 끈 경우와 글자 그대로 같은 응답**(`skipped:'universe_disabled'`)을 돌려줬다. 그러면
   *  · `classifyRun` 이 `skipped` 로 분류해 `job_run_log` 에 정상 꺼짐과 같은 줄만 남고
   *  · 창 안 모든 호출이 같은 한 가지 응답이라 **판독 장애가 창 내내 이어지면 창 전체가 조용히 지나가고**
   *  · 05:50 호출에서는 이 관문이 창 종료 점검보다 앞이라 **미완 경고가 아예 호출되지 않으며**,
   *    그 `skipped` 가 슬롯의 마지막 기록이 되어 앞선 `failed` 기록까지 덮는다.
   * 그래서 **`skipped` 를 싣지 않는다** — 싣는 순간 다시 「건너뜀」으로 접힌다. `ok:false` + `failCode` 로
   * 그 회차를 `failed` 로 남기고(HTTP 는 200 — 러너는 본문으로 판정한다) **그 뒤 일은 하지 않는다**
   * (관문 3 이후·창 종료 점검·외부 호출 0건). `final:false` 라 러너는 창 안에서 다시 부른다.
   * 「모름」을 「꺼짐」으로 접지 않는다는 ③-4 의 기준을 관문 쪽에도 적용한 것이다.
   */
  if (cfgUnreadable) {
    return NextResponse.json({
      ok: false,
      status: 'config_unreadable',
      failCode: 'universe_config_unreadable',
      final: false,
      runKey: runKeyOf(now.getTime()),
    });
  }
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
    /**
     * 🔴 **창이 끝난 뒤**(창 시작보다 뒤인데 끝 이후)의 호출이면, 거절하기 전에 이달 run 이 미완인지 보고
     * 텔레그램 warning 을 **1회** 보낸다(T-145 ④-조각). 창 **시작 전**(`hhmm < windowStart`)에는 보지 않는다 —
     * 그때 미완은 당연하다.
     *
     * 던지지 않는 함수이고 **외부 호출 0건**이다. 실패해도 응답은 그대로 `outside_window` 다.
     */
    const windowIncomplete = hhmm >= cfg.windowEnd
      ? await notifyUniverseWindowIncomplete({ runKey, nowMs: now.getTime(), db })
        .catch((e): null => {
          console.error(`[cron/overseas-universe-refresh] 미완 경고 실패: ${e instanceof Error ? e.message : String(e)}`);
          return null;
        })
      : null;
    /**
     * 🔴 **이 호출이 창 슬롯의 마지막 기록이 된다** — `job_run_log` 슬롯은 01:10 + `windowMin` 285분(= 05:55)이라
     * 05:50 호출도 **같은 슬롯**에 들어가고 `RUN_ODKU` 가 마지막 호출 상태로 덮어쓴다(`job-slots.ts`).
     * 그래서 관문 거절의 기본값(`skipped: universe_outside_window`)을 그대로 쓰면 **끝난 달이 「건너뜀」으로 덮인다.**
     * 응답이 그 달의 실제 상태를 말하게 한다:
     *  - 미완(`listing`·`scan`·`retry`·`finalize`) → `ok:false` + `failCode` → 회차가 `failed` 로 남는다
     *    (텔레그램 경고와 **별개로** `job_run_log` 에도 분류어가 남는다 — 홈 질의 교체는 범위 밖이다)
     *  - `complete` → `ok:true` · `skipped` 없음 → 그 달의 `ok` 를 유지한다
     *  - `failed`·`expired` → `ok:false` + 그 단계 → 앞 호출이 남긴 실패를 유지한다
     *  - run 조회가 **DB 오류**(`read_failed`) → `ok:false` + `failCode:'universe_state_unreadable'`.
     *    🔴 전에는 이것도 `skipped` 로 접혔다(Reviewer 권고 C — 지적 1 과 같은 뿌리: 「모름을 건너뜀 어휘로
     *    접어 정상과 구별하지 못한다」). 표가 없는 것(`not_migrated`)도 이 사유로 오므로 적용 전 구간에서도
     *    실패로 남는데, 그쪽은 러너가 `final:false` 로 다시 부르고 사람이 보면 되는 상태다.
     *  - run 이 **정말로 없음**(`no_run`) → **종전처럼 `skipped`** (한 번도 안 돈 달을 성공으로 만들지 않는다 — M-8)
     * 창 **시작 전** 호출(`windowIncomplete === null`)도 마지막 분기로 가 종전 응답 그대로다.
     */
    const phase = windowIncomplete?.phase ?? null;
    const reason = windowIncomplete?.reason ?? null;
    const body: Record<string, unknown> = {
      ok: true, status: 'outside_window', final: false, runKey, kst: hhmm,
    };
    if (windowIncomplete) body.windowIncomplete = windowIncomplete;
    if (phase != null && INCOMPLETE_PHASES.includes(phase)) {
      body.ok = false;
      body.failCode = 'universe_window_incomplete';
    } else if (phase === 'failed' || phase === 'expired') {
      body.ok = false;
      body.failCode = phase;
    } else if (reason === 'read_failed') {
      // 🔴 권고 C — run 상태를 **못 읽었다**. 건너뜀이 아니다(모름을 정상과 구별한다)
      body.ok = false;
      body.failCode = 'universe_state_unreadable';
    } else if (phase !== 'complete') {
      body.skipped = 'universe_outside_window';
    }
    return NextResponse.json(body);
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
