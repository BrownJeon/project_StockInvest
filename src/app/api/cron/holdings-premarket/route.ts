/**
 * holdings-premarket cron — 보유 미국 종목 개장 전 공시 체크포인트 (T-119, 2차 설계 단계 4 대체안 "B").
 *
 * 🔴 **알림만** 한다 — 주문·매도·시그널·분석 입력을 만들지 않는다. KIS·M4·LLM 을 부르지 않는다. `us_filings` 에 쓰지 않는다.
 *    쓰기는 `ci_raw_item(sec_filing)` 과 `system_config.holdings_premarket_status` 뿐이다(`src/lib/corp-intel/holdings-premarket.ts`).
 *
 * 러너(`scripts/cron-runner.sh` holdings-premarket 블록)가 미국 동부 08시(서머타임 KST 21시 / 표준시 KST 22시) 평일 하루 1회 부른다.
 * 흐름:
 *  1. 인증 fail-closed(`checkCronAuth`). 같은 프로세스 겹침 방지.
 *  2. 스위치 `holdings_premarket_enabled` — 키 없음·해석 불가 = 꺼짐 → `{ok:true, skipped:'switch_off'}` (SEC 호출 0)
 *  3. `SEC_USER_AGENT` 없음 → `no_user_agent` (SEC 호출 0)
 *  4. 보유 목록 = DB 의 가장 최근 `portfolio_snapshots.positions`(60분 주기 저장) — KIS 를 부르지 않는다.
 *     스냅샷 없음·3시간 초과 → `stale_holdings` / 미국 보유 0 → `no_holdings` (둘 다 SEC 호출 0)
 *  5. CIK = `symbol_cik_map`(T-059 edgar-sync 가 채운 매핑) — 매핑 없는 종목(ETF·미등재)은 건너뛰고 `unmapped` 로 보고(추가 SEC 요청 없음)
 *  6. CIK 마다 submissions 1회(`SecClient` — 250ms 간격·429/403 쿨다운·User-Agent). 요청 수 상한 8(재시도 포함)·시간 예산.
 *     `SecBlockedError` → 즉시 중단(`blocked`). 종목 하나의 HTTP·형식 오류는 그 종목만 건너뛰고 상태 `failed`.
 *  7. `parseSubmissions`(us_filings 와 같은 양식 집합) → 24시간 창 후보 → `recordPremarketFilings` 가 새 공시만 돌려준다
 *     (`us_filings` 에 있거나 `ci_raw_item` 에 이미 있으면 알림 없음)
 *  8. 새 공시마다 정보 알림 1건(10건 넘으면 요약 1건). 상태 기록. 연속 2회 failed/blocked 면 실패 알림(ET 하루 1건).
 *     T-175: 알림 전송이 실패하면 같은 실행 안에서 간격(2초·5초)을 두고 최대 2회 더 보낸다(`@/lib/notify/send-retry` — 중복 발송 없음).
 *     끝내 못 보낸 공시는 식별자(심볼·양식·접수번호·SEC 링크)를 `HP_ALERT_UNDELIVERED` 줄로 남긴다 — 다음 실행에서는 「이미 수집됨」이라
 *     다시 알리지 않으므로 사람이 이 줄로 확인한다. 상태 보고(`failed`·`alert_undelivered=N`)는 그대로다.
 *
 * 시간: 라우트 전체 약 60초 안(SEC 단계는 시작 후 40초 안에서만 새 종목을 시작, 요청 시간 상한 10초×최대 2회) — 러너 curl 상한
 * HOLDINGS_PREMARKET_CURL_MAX_TIME(90초)보다 짧다.
 */
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { checkCronAuth } from '@/lib/cron-auth';
import { dispatchAlert } from '@/lib/notify';
import { sendWithRetry, type SendRetryResult } from '@/lib/notify/send-retry';
import { SecBlockedError, SecClient, readSecUserAgent, secSubmissionsUrl } from '@/lib/data/us-edgar/sec-client';
import { parseSubmissions } from '@/lib/data/us-edgar/parse';
import {
  HP_MAX_ALERTS, HP_MAX_REQUESTS, etDateOf, formatPremarketAlert, formatPremarketFailureAlert, formatPremarketSummary,
  isSnapshotStale, nextHpStatus, readHpStatus, readPremarketSwitch, recordPremarketFilings, selectPremarketCandidates,
  shouldSendFailureAlert, usHoldingsFromPositions, writeHpStatus,
  type HpStatus, type HpStatusInput, type PremarketCandidate, type PremarketFilingInput,
} from '@/lib/corp-intel/holdings-premarket';

export const dynamic = 'force-dynamic';

const LOG = '[holdings-premarket]';
/** SEC 요청 1회 시간 상한 — SEC 는 보통 1초 안에 답한다. SecClient 는 네트워크·5xx 에 1회 재시도(1초 대기)한다. */
const SEC_REQUEST_TIMEOUT_MS = 10_000;
/** CIK 1개 최악 = 간격 0.25 + 10 + 1 + 10 ≈ 21.25초 → 22초로 본다. */
const CIK_WORST_MS = 22_000;
/** SEC 단계 끝 — 시작 후 이 시각까지 끝날 수 있을 때만 새 CIK 를 시작한다. */
const SEC_STAGE_END_MS = 40_000;
/** 알림 1건 발송 대기 상한(시도 1회) */
const SEND_TIMEOUT_MS = 5_000;
/**
 * T-175 — 전송 실패 시 재시도 전 간격. 시도는 최대 3회(첫 시도 + 2회). 텔레그램 계층이 이미 0.5초 뒤 1회 재시도하므로
 * 그보다 길게 둔다 — 순간적인 연결 실패(2026-11-18 22:01 ETIMEDOUT/ENETUNREACH)가 지나가기를 기다린다.
 * 알림 1건 최악 = 5 + 2 + 5 + 5 + 5 = 22초지만, 새 시도는 아래 알림 단계 끝(55초) 전에만 시작한다.
 */
const SEND_RETRY_GAPS_MS = [2_000, 5_000] as const;
/** 시작 후 이 시각이 지나면 새 알림 시도(재시도 포함)를 시작하지 않는다(총 예산 약 60초). */
const SEND_STAGE_END_MS = 55_000;
/** 미전달 식별자 로그 줄 수 상한(요약 알림 실패 시 새 공시 전부를 적는다) */
const UNDELIVERED_LOG_MAX = 50;
/** 앞선 실행이 이보다 오래 끝나지 않았으면 걸린 것으로 보고 새 실행을 허용한다 */
const STALE_RUN_MS = 5 * 60_000;

let runningSince: number | null = null;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t = new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), ms); });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

const errName = (e: unknown) => (e instanceof Error ? `${e.name}${e.message ? `: ${e.message}` : ''}` : String(e)).slice(0, 100);

interface RunOutcome {
  status: HpStatus;
  holdings: number;
  checked: number;
  newFilings: number;
  alerted: number;
  detail?: string;
  extra?: Record<string, unknown>;
}

/** 로그 한 줄 안전화 — 외부(SEC) 문자열의 제어문자를 지우고 길이를 자른다. */
const oneLine = (v: unknown, max = 200) => String(v ?? '').replace(/[\u0000-\u001F\u007F]+/g, ' ').slice(0, max);

/** T-175 — 알림 1건을 같은 실행 안에서 간격을 두고 다시 보낸다. 던지지 않는다. */
async function sendOne(title: string, body: string, canStart: (gapMs: number) => boolean): Promise<SendRetryResult> {
  const r = await sendWithRetry(() => dispatchAlert('info', title, body), {
    timeoutMs: SEND_TIMEOUT_MS, gapsMs: SEND_RETRY_GAPS_MS, canStart,
  });
  if (r.delivered) {
    if (r.attempts > 1) console.log(`${LOG} 알림 재시도 끝에 전달(시도 ${r.attempts}회)`);
  } else {
    console.warn(`${LOG} 알림 미전달 reason=${r.reason} attempts=${r.attempts}`
      + (r.reason === 'unresolved' ? ` (마지막 시도가 ${SEND_TIMEOUT_MS}ms 안에 끝나지 않음 — 늦게 도착했을 수 있다)` : '')
      + (r.lastError ? ` last=${oneLine(r.lastError, 300)}` : ''));
  }
  return r;
}

/**
 * 끝내 보내지 못한 공시의 식별자 — 다음 실행은 이 공시를 「이미 수집됨」으로 보고 다시 알리지 않으므로(실행 간 재전송 없음),
 * 사람이 `HP_ALERT_UNDELIVERED` 로 찾아 SEC 링크로 확인할 수 있게 남긴다. 비밀값 없음(공개 SEC 식별자뿐).
 */
function logUndelivered(list: readonly PremarketCandidate[], why: string): void {
  for (const c of list.slice(0, UNDELIVERED_LOG_MAX)) {
    console.warn(`${LOG} HP_ALERT_UNDELIVERED reason=${oneLine(why, 20)} symbols=${oneLine(c.symbols.join(','), 80)}`
      + ` form=${oneLine(c.form, 16)} accession=${oneLine(c.accession, 30)} url=${oneLine(c.url, 200)}`);
  }
  if (list.length > UNDELIVERED_LOG_MAX) console.warn(`${LOG} HP_ALERT_UNDELIVERED … 외 ${list.length - UNDELIVERED_LOG_MAX}건(ci_raw_item 에 기록됨)`);
}

async function run(startedAt: number): Promise<RunOutcome> {
  const now = new Date(startedAt);
  const elapsed = () => Date.now() - startedAt;

  const sw = await readPremarketSwitch();
  if (!sw.enabled) return { status: 'switch_off', holdings: 0, checked: 0, newFilings: 0, alerted: 0, detail: sw.source };

  const ua = readSecUserAgent(process.env);
  if (!ua) {
    console.error(`${LOG} SEC_USER_AGENT 가 비었거나 연락 이메일이 없다 — SEC 를 호출하지 않는다`);
    return { status: 'no_user_agent', holdings: 0, checked: 0, newFilings: 0, alerted: 0 };
  }

  // ── 보유 목록: 가장 최근 스냅샷(DB) — KIS 호출 없음 ──
  const pool = getPool();
  const [snaps] = await pool.query<RowDataPacket[]>(
    'SELECT ts, positions FROM portfolio_snapshots ORDER BY ts DESC, id DESC LIMIT 1',
  );
  const snap = Array.isArray(snaps) ? snaps[0] : undefined;
  const snapAt = snap ? new Date(snap.ts as string) : null;
  if (!snap || isSnapshotStale(snapAt, now)) {
    const age = snapAt && !Number.isNaN(snapAt.getTime()) ? `${Math.round((now.getTime() - snapAt.getTime()) / 60_000)}min` : 'none';
    console.warn(`${LOG} 보유 스냅샷이 없거나 오래됨(age=${age}) — 이번 확인을 건너뜀`);
    return { status: 'stale_holdings', holdings: 0, checked: 0, newFilings: 0, alerted: 0, detail: `snapshot_age=${age}` };
  }
  const holdings = usHoldingsFromPositions(snap.positions);
  if (holdings.length === 0) return { status: 'no_holdings', holdings: 0, checked: 0, newFilings: 0, alerted: 0 };

  // ── CIK 매핑(T-059 symbol_cik_map) ──
  let mapRows: RowDataPacket[];
  try {
    [mapRows] = await pool.query<RowDataPacket[]>('SELECT symbol, cik FROM symbol_cik_map WHERE symbol IN (?)', [holdings]);
  } catch (e) {
    const o = e as { code?: unknown; errno?: unknown } | null;
    if (o && (o.code === 'ER_NO_SUCH_TABLE' || o.errno === 1146)) {
      return { status: 'skipped_no_table', holdings: holdings.length, checked: 0, newFilings: 0, alerted: 0, detail: 'symbol_cik_map' };
    }
    throw e;
  }
  const byCik = new Map<number, string[]>();
  for (const r of mapRows ?? []) {
    const cik = Number(r.cik);
    const sym = String(r.symbol);
    if (!Number.isSafeInteger(cik) || cik <= 0 || !holdings.includes(sym)) continue;
    byCik.set(cik, [...(byCik.get(cik) ?? []), sym]);
  }
  const unmapped = holdings.filter((s) => ![...byCik.values()].some((v) => v.includes(s)));
  if (unmapped.length > 0) console.warn(`${LOG} CIK 매핑 없음(건너뜀 — ETF·SEC 미등재·edgar-sync 대상 밖): ${unmapped.join(',')}`);

  // ── SEC submissions — CIK 당 1회, 요청 상한·시간 예산 ──
  const client = new SecClient({ userAgent: ua, timeoutMs: SEC_REQUEST_TIMEOUT_MS });
  const filings: PremarketFilingInput[] = [];
  const failedCiks: string[] = [];
  let checked = 0;
  let blocked = false;
  let capped = 0;
  const order = [...byCik.entries()].sort((a, b) => a[0] - b[0]);
  for (const [cik, syms] of order) {
    // 요청 상한: 이 CIK 가 재시도까지 2회를 써도 상한을 넘지 않을 때만 시작 / 시간: SEC 단계 끝까지 최악 경로가 들어갈 때만
    if (client.requestCount + 2 > HP_MAX_REQUESTS || elapsed() + CIK_WORST_MS > SEC_STAGE_END_MS) { capped++; continue; }
    try {
      const r = await client.getJson(secSubmissionsUrl(cik));
      checked++;
      if (r.status !== 200) { failedCiks.push(`${cik}:http_${r.status}`); continue; }
      const parsed = parseSubmissions(r.json, cik);
      for (const f of parsed.filings) {
        filings.push({
          symbols: syms, cik, accession: f.accession, form: f.form, items: f.items, filed: f.filed,
          acceptedAtUtc: f.acceptedAtUtc, primaryDocUrl: f.primaryDocUrl,
        });
      }
    } catch (e) {
      if (e instanceof SecBlockedError) {
        blocked = true;
        console.error(`${LOG} ${e.message} — 중단`);
        break;
      }
      checked++;
      failedCiks.push(`${cik}:${e instanceof Error ? e.name : 'error'}`);
      console.warn(`${LOG} CIK ${cik}(${syms.join(',')}) 확인 실패 — 건너뜀: ${errName(e)}`);
    }
  }

  // ── 새 공시 판정·기록 ──
  const sel = selectPremarketCandidates(filings, now);
  const rec = await recordPremarketFilings(sel.candidates, now);

  // ── 알림 — 새 행이 생긴 것만 ──
  // 새 시도(재시도 포함)는 알림 단계 끝 전에만 시작한다 — 기존 「55초가 지나면 남은 알림을 시도하지 않는다」와 같은 기준.
  const canStart = (gapMs: number) => elapsed() + gapMs <= SEND_STAGE_END_MS;
  let alerted = 0;
  let undelivered = 0;
  if (rec.status !== 'skipped_no_table' && rec.fresh.length > 0) {
    if (rec.fresh.length > HP_MAX_ALERTS) {
      const s = formatPremarketSummary(rec.fresh, now);
      const r = await sendOne(s.title, s.body, canStart);
      if (r.delivered) alerted++;
      else { undelivered++; logUndelivered(rec.fresh, r.reason ?? 'failed'); }
    } else {
      for (const c of rec.fresh) {
        const a = formatPremarketAlert(c, now);
        const r = await sendOne(a.title, a.body, canStart);
        if (r.delivered) alerted++;
        else { undelivered++; logUndelivered([c], r.reason ?? 'failed'); }
      }
    }
  }

  let status: HpStatus = 'ok';
  const details: string[] = [];
  if (rec.status === 'skipped_no_table') { status = 'skipped_no_table'; details.push(rec.missingTable ?? 'table'); }
  if (blocked) status = 'blocked';
  else if (status === 'ok' && (failedCiks.length > 0 || capped > 0 || rec.status === 'failed' || undelivered > 0)) status = 'failed';
  if (failedCiks.length > 0) details.push(`cik_failed=${failedCiks.slice(0, 5).join(',')}`);
  if (capped > 0) details.push(`unchecked_cap=${capped}`);
  if (rec.status === 'failed') details.push(`db_failed=${rec.insertFailed || 1}`);
  if (undelivered > 0) details.push(`alert_undelivered=${undelivered}`);
  if (unmapped.length > 0) details.push(`unmapped=${unmapped.join(',')}`);

  return {
    status,
    holdings: holdings.length,
    checked,
    newFilings: rec.fresh.length,
    alerted,
    ...(details.length ? { detail: details.join(' ').slice(0, 120) } : {}),
    extra: {
      requests: client.requestCount, unmapped, candidates: sel.candidates.length, outOfWindow: sel.outOfWindow,
      noAcceptance: sel.noAcceptance, inUsFilings: rec.inUsFilings, alreadyCaptured: rec.alreadyCaptured,
    },
  };
}

/** 상태 기록 + 연속 실패 알림. 실패해도 응답에 영향 없음. */
async function finish(out: RunOutcome, now: Date): Promise<{ failureAlert: boolean }> {
  try {
    const prev = await readHpStatus();
    const input: HpStatusInput = {
      status: out.status, holdings: out.holdings, checked: out.checked, newFilings: out.newFilings, alerted: out.alerted, detail: out.detail,
    };
    const next = nextHpStatus(prev, input, now);
    const etToday = etDateOf(now);
    let failureAlert = false;
    if (shouldSendFailureAlert(next, etToday)) {
      const a = formatPremarketFailureAlert(next);
      try {
        const d = await withTimeout(dispatchAlert('warning', a.title, a.body), SEND_TIMEOUT_MS);
        failureAlert = d !== 'timeout' && d.delivered.length > 0;
      } catch { /* 아래 기록만 */ }
      if (failureAlert) next.failureAlertEtDate = etToday;
    }
    await writeHpStatus(next);
    return { failureAlert };
  } catch (e) {
    console.warn(`${LOG} 상태 기록 예외(무시): ${errName(e)}`);
    return { failureAlert: false };
  }
}

export async function POST(req: NextRequest) {
  const authErr = checkCronAuth(req);
  if (authErr) return authErr;

  const startedAt = Date.now();
  if (runningSince !== null && startedAt - runningSince < STALE_RUN_MS) {
    return NextResponse.json({ ok: true, skipped: 'in_progress' });
  }
  runningSince = startedAt;
  try {
    let out: RunOutcome;
    try {
      out = await run(startedAt);
    } catch (e) {
      console.error(`${LOG} 실패: ${errName(e)}`);
      out = { status: 'failed', holdings: 0, checked: 0, newFilings: 0, alerted: 0, detail: errName(e) };
    }
    const fin = await finish(out, new Date(startedAt));
    console.log(`${LOG} ${out.status} holdings=${out.holdings} checked=${out.checked} new=${out.newFilings} alerted=${out.alerted}`
      + (out.detail ? ` detail=${out.detail}` : ''));
    const body = {
      ok: out.status !== 'failed' && out.status !== 'blocked',
      ...(out.status === 'switch_off' ? { skipped: 'switch_off' } : {}),
      status: out.status, holdings: out.holdings, checked: out.checked, newFilings: out.newFilings, alerted: out.alerted,
      ...(out.detail ? { detail: out.detail } : {}),
      ...(out.extra ?? {}),
      failureAlert: fin.failureAlert,
    };
    // failed·blocked 는 503 — 러너 로그에 본문이 남는다(edgar-sync 의 중단 응답과 같은 방식). 날짜파일은 러너가 결과와 무관하게 쓴다.
    return NextResponse.json(body, { status: body.ok ? 200 : 503 });
  } finally {
    if (runningSince === startedAt) runningSince = null;
  }
}
