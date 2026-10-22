/**
 * stop-alert cron — 손절가 도달 텔레그램 알림 (T-068 WP-C).
 *
 * 보유 종목의 현재가가 사용자 정책(`risk_policy`, T-066)의 **예상 손절가**에 닿거나 아래로 내려가면 알린다.
 * 🔴 **알림만** 한다 — 주문·매도·시그널을 만들지 않고, `position_state`·`orders`·`signals` 에 쓰지 않는다.
 *    거래소는 시세 조회(`kis.getTicker`)만 쓴다. 쓰기는 `system_config.risk_stop_alert_state` 한 키뿐이다.
 *
 * 흐름 (1분 cron, `scripts/cron-runner.sh`):
 *  1. `risk_stop_alert_enabled` — 키 없음 = 켜짐, JSON `false` = 꺼짐
 *  2. `risk_policy` 읽기(T-066 `readRiskPolicy`). 없음·손상 → 알림 없음, 상태 불변
 *  3. 장 열림 판정 — 국내 `isDomesticOpen`, 미국 `loadUsClosedDaysStrict`+`isUsRegularSessionOpen`(휴장·반일장 닫힘, 휴장 표를
 *     못 읽으면 닫힘 = fail-closed). 둘 다 닫혔으면 여기서 끝(KIS 호출 0, 상태 불변)
 *  4. `position_state` 읽기(평균단가·고점·수량, entry_price>0·qty>0 만 보유로 본다)
 *  5. 열린 시장 보유 종목만 시세 조회 — 틱당 최대 10종목·시간 예산 안에서, 실패한 종목은 건너뛴다(상태 불변)
 *  6. 순수 모듈 `planStopAlerts` → `dispatchAlert` 발송(결과 확인) → `settleStopAlerts` → 상태 저장
 *
 * 발송은 `@/lib/notify` 의 `dispatchAlert`(기존 export — `sendAlert` 와 같은 채널 정책·로그, 결과를 돌려준다)를 쓴다.
 * `sendAlert` 는 결과를 버리는 fire-and-forget 이라 "발송 실패 시 상태 불변·재시도" 규칙을 지킬 수 없다.
 */
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { checkCronAuth } from '@/lib/cron-auth';
import { dispatchAlert, getSymbolLabel } from '@/lib/notify';
import { kis } from '@/lib/exchanges/kis';
import { isDomesticOpen } from '@/lib/strategy/market-hours';
import { etDateOf, isUsRegularSessionOpen, loadUsClosedDaysStrict, type SessionQueryable } from '@/lib/strategy/us-session';
import { readRiskPolicy } from '@/lib/risk/policy-store';
import {
  formatStopAlert, parseStopAlertState, planStopAlerts, settleStopAlerts,
  type PlannedStopAlert, type StopAlertHoldingInput, type StopAlertMarket, type StopAlertOutcome,
} from '@/lib/risk/stop-alert';

export const dynamic = 'force-dynamic';

const STOP_ALERT_ENABLED_KEY = 'risk_stop_alert_enabled';
const STOP_ALERT_STATE_KEY = 'risk_stop_alert_state';
/** 틱당 시세 조회 상한 (보유 최대 10종목 정책) */
const MAX_TICKERS_PER_TICK = 10;
/** 시세 조회에 쓰는 시간 예산 — 넘으면 남은 종목은 이번 틱에 평가하지 않는다 */
const TICKER_BUDGET_MS = 10_000;
/** 알림 1건 발송 대기 상한 — 넘으면 실패로 보고 다음 틱에 재시도 */
const SEND_TIMEOUT_MS = 6_000;
/** 시작부터 이 시간이 지나면 남은 알림은 시도하지 않는다(다음 틱) — 러너 curl --max-time 20초 안에 끝내기 위함 */
const SEND_BUDGET_MS = 15_000;
/** 앞선 실행이 이보다 오래 끝나지 않았으면 걸린 것으로 보고 새 실행을 허용한다 */
const STALE_RUN_MS = 5 * 60_000;
const LOG = '[stop-alert]';

/** 같은 프로세스 안 겹침 방지 — 겹치면 같은 알림을 두 번 보낼 수 있다 (route 파일은 Next 규칙상 HTTP 핸들러·설정 외 export 금지) */
let runningSince: number | null = null;

/**
 * (Reviewer M-2) 발송 성공 기록 — `alert.id → { 마지막 전달 성공 시각(ms), 그동안 전달한 종목 키 집합 }`. 발송은 됐는데 상태
 * 저장이 실패하면 상태가 'above'(또는 상태 없음)로 남아 다음 틱마다 같은 알림이 다시 나간다. 이 시간 안에 같은 id 가 다시 계획되고
 * **그 종목 키가 전부 이미 전달한 집합 안에 있을 때만** 다시 보내지 않고 '이미 전달됨(sent)' 으로 처리한다.
 * (R-1) 최초 요약의 id 는 시장당 하나(`summary:<market>`)라 id 만 보면 내용이 다른 요약(새 종목 포함)까지 억제돼 알림이 누락된다 —
 * 새 키가 하나라도 있으면 억제하지 않고 정상 발송한다(성공 시 키 집합은 합집합, 시각은 이번 전달 시각).
 * 상태 저장이 성공해 'below' 가 기록되면 이 항목은 쓰이지 않는다(무해). 프로세스 메모리라 재시작하면 비워진다.
 */
const RESEND_GUARD_MS = 10 * 60_000;
const RESEND_GUARD_MAX = 200;
const recentlySent = new Map<string, { at: number; keys: Set<string> }>();

/** 이번 알림의 종목 키가 전부 최근(만료 전) 전달 집합 안에 있는가 */
function alreadyDelivered(alert: PlannedStopAlert, nowMs: number): boolean {
  const e = recentlySent.get(alert.id);
  if (!e || nowMs - e.at >= RESEND_GUARD_MS) return false;
  return alert.keys.length > 0 && alert.keys.every(k => e.keys.has(k));
}

function recordDelivered(alert: PlannedStopAlert, nowMs: number): void {
  const e = recentlySent.get(alert.id);
  const keys = e && nowMs - e.at < RESEND_GUARD_MS ? new Set([...e.keys, ...alert.keys]) : new Set(alert.keys);
  recentlySent.delete(alert.id);   // 삽입 순서 = 오래된 순(상한 정리용)
  recentlySent.set(alert.id, { at: nowMs, keys });
  pruneRecentlySent(nowMs);
}

function pruneRecentlySent(nowMs: number): void {
  for (const [id, e] of recentlySent) if (nowMs - e.at >= RESEND_GUARD_MS) recentlySent.delete(id);
  // 상한 — Map 은 삽입 순서라 앞쪽이 오래된 항목
  while (recentlySent.size > RESEND_GUARD_MAX) {
    const oldest = recentlySent.keys().next().value as string;
    recentlySent.delete(oldest);
  }
}

/** (Reviewer L-2) 해외 시세의 원화 환산이 정상 환율로 된 것인지 — `fetchUsdKrwRate` 실패로 1 이 곱해지면 원화 칸에 달러 값이 온다 */
const FX_SANE_MIN = 300;
const FX_SANE_MAX = 5000;

interface PositionRow extends RowDataPacket {
  symbol: string;
  market: string;
  entry_price: string | number;
  peak_price: string | number;
  qty: string | number | null;
}

async function readEnabled(): Promise<boolean> {
  const [rows] = await getPool().query<(RowDataPacket & { value: unknown })[]>(
    'SELECT value FROM system_config WHERE `key` = ? LIMIT 1',
    [STOP_ALERT_ENABLED_KEY],
  );
  if (rows.length === 0) return true;
  const raw = rows[0].value;
  try {
    return (typeof raw === 'string' ? JSON.parse(raw) : raw) !== false;
  } catch {
    console.warn(`${LOG} ${STOP_ALERT_ENABLED_KEY} 값을 해석할 수 없어 켜진 것으로 본다`);
    return true;
  }
}

async function openMarkets(now: Date): Promise<StopAlertMarket[]> {
  const out: StopAlertMarket[] = [];
  try {
    if (await isDomesticOpen(now)) out.push('domestic');
  } catch (e) {
    console.warn(`${LOG} 국내 개장 판정 실패 — 국내 평가 생략: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    const year = Number(etDateOf(now).slice(0, 4));
    const closed = await loadUsClosedDaysStrict(getPool() as unknown as SessionQueryable, [year]);
    if (isUsRegularSessionOpen(now, closed)) out.push('overseas');
  } catch (e) {
    console.warn(`${LOG} 미국 개장 판정 불확실 — 미국 평가 생략(fail-closed): ${e instanceof Error ? e.message : String(e)}`);
  }
  return out;
}

async function readHeld(): Promise<StopAlertHoldingInput[]> {
  const [rows] = await getPool().query<PositionRow[]>(
    `SELECT symbol, market, entry_price, peak_price, qty
       FROM position_state
      WHERE entry_price > 0 AND qty > 0`,
  );
  const out: StopAlertHoldingInput[] = [];
  for (const r of rows) {
    if (r.market !== 'domestic' && r.market !== 'overseas') continue;
    const qty = Number(r.qty);
    const avg = Number(r.entry_price);
    const peak = Number(r.peak_price);
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(avg) || avg <= 0) continue;
    out.push({
      symbol: String(r.symbol),
      market: r.market,
      qty,
      avgKrw: avg,
      peakKrw: Number.isFinite(peak) && peak > 0 ? peak : null,
      priceKrw: null,
      fx: null,
    });
  }
  return out.sort((a, b) => `${a.market}|${a.symbol}`.localeCompare(`${b.market}|${b.symbol}`));
}

async function readState() {
  const [rows] = await getPool().query<(RowDataPacket & { value: unknown })[]>(
    'SELECT value FROM system_config WHERE `key` = ? LIMIT 1',
    [STOP_ALERT_STATE_KEY],
  );
  if (rows.length === 0) return { prev: null, raw: null as string | null };
  const raw = typeof rows[0].value === 'string' ? rows[0].value : JSON.stringify(rows[0].value);
  const prev = parseStopAlertState(rows[0].value);
  if (!prev) console.warn(`${LOG} 저장된 상태가 손상돼 새로 시작한다(최초 요약이 다시 갈 수 있음)`);
  return { prev, raw };
}

async function saveState(json: string): Promise<void> {
  await getPool().query(
    'INSERT INTO system_config (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
    [STOP_ALERT_STATE_KEY, json],
  );
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t = new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), ms); });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

/** 열린 시장 종목을 상한만큼 고른다 — 상한을 넘으면 분 단위로 돌려 가며 모두 평가되게 한다 */
function pickTargets(held: StopAlertHoldingInput[], markets: StopAlertMarket[], now: Date): StopAlertHoldingInput[] {
  const open = held.filter(h => markets.includes(h.market));
  if (open.length <= MAX_TICKERS_PER_TICK) return open;
  const start = (Math.floor(now.getTime() / 60_000) * MAX_TICKERS_PER_TICK) % open.length;
  console.warn(`${LOG} 열린 시장 보유 ${open.length}종목 > 틱당 상한 ${MAX_TICKERS_PER_TICK} — 이번 틱은 ${MAX_TICKERS_PER_TICK}종목만`);
  return Array.from({ length: MAX_TICKERS_PER_TICK }, (_, i) => open[(start + i) % open.length]);
}

async function run(startedAt: number) {
  const now = new Date(startedAt);

  if (!(await readEnabled())) return { ok: true, skipped: 'disabled' };

  const pr = await readRiskPolicy();
  if (pr.status === 'absent') return { ok: true, skipped: 'no_policy' };
  if (pr.status === 'invalid') {
    console.warn(`${LOG} risk_policy 손상(${pr.detail}) — 평가 생략`);
    return { ok: true, skipped: 'policy_invalid' };
  }
  const p = pr.policy;
  const policy = { version: p.version, stopPct: p.stopPct, heatCapPct: p.heatCapPct, stopBasis: p.stopBasis };

  const markets = await openMarkets(now);
  if (markets.length === 0) return { ok: true, skipped: 'markets_closed' };

  const held = await readHeld();
  const targets = pickTargets(held, markets, now);

  let priced = 0;
  let tickerFailed = 0;
  let fxRejected = 0;
  for (const h of targets) {
    if (Date.now() - startedAt > TICKER_BUDGET_MS) {
      console.warn(`${LOG} 시세 시간 예산 초과 — 남은 종목은 다음 틱`);
      break;
    }
    try {
      const t = await kis.getTicker(h.symbol);
      const price = Number(t.price);
      if (!Number.isFinite(price) || price <= 0) { tickerFailed++; continue; }
      const usd = Number(t.priceUsd);
      const fx = h.market === 'overseas' && Number.isFinite(usd) && usd > 0 ? price / usd : null;
      if (h.market === 'overseas' && (fx === null || fx < FX_SANE_MIN || fx > FX_SANE_MAX)) {
        // 환율을 확인할 수 없으면 원화 현재가를 믿을 수 없다 — 이 종목은 이번 틱 평가 생략(상태 불변)
        fxRejected++;
        console.warn(`${LOG} 환율 이상(${fx === null ? '없음' : fx.toFixed(2)}, 허용 ${FX_SANE_MIN}~${FX_SANE_MAX}) ${h.symbol} — 이번 틱 평가 생략`);
        continue;
      }
      h.priceKrw = price;
      h.fx = fx;
      priced++;
    } catch (e) {
      tickerFailed++;
      console.warn(`${LOG} 시세 실패 ${h.symbol} — 이번 틱 평가 생략: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const { prev, raw } = await readState();
  const plan = planStopAlerts({ now, policy, holdings: held, prev });
  for (const l of plan.logs) console.log(`${LOG} ${l}`);

  const results: { alert: PlannedStopAlert; outcome: StopAlertOutcome }[] = [];
  let resendSuppressed = 0;
  pruneRecentlySent(Date.now());
  for (const alert of plan.alerts) {
    if (Date.now() - startedAt > SEND_BUDGET_MS) {
      results.push({ alert, outcome: 'not_attempted' });
      continue;
    }
    if (alreadyDelivered(alert, Date.now())) {
      // 직전 발송은 성공했으나 상태 저장이 안 된 경우 — 다시 보내지 않고 전달된 것으로 기록해 이번에 저장되게 한다
      resendSuppressed++;
      results.push({ alert, outcome: 'sent' });
      console.warn(`${LOG} ${alert.id} 최근 ${RESEND_GUARD_MS / 60_000}분 안에 이미 전달됨 — 재발송하지 않음(상태 저장 재시도)`);
      continue;
    }
    const labels: Record<string, string> = {};
    for (const it of alert.items) labels[it.key] = await getSymbolLabel(it.symbol);
    const { title, body } = formatStopAlert(alert, labels);
    let outcome: StopAlertOutcome = 'failed';
    try {
      const d = await withTimeout(dispatchAlert('warning', title, body), SEND_TIMEOUT_MS);
      if (d === 'timeout') console.warn(`${LOG} 발송 대기 ${SEND_TIMEOUT_MS}ms 초과 — 실패로 보고 재시도 (${alert.id})`);
      else if (d.delivered.length > 0) {
        outcome = 'sent';
        recordDelivered(alert, Date.now());
      }
      else console.warn(`${LOG} 전달된 채널 없음(channel=${d.channel}) — 재시도 (${alert.id})`);
    } catch (e) {
      console.error(`${LOG} 발송 예외 ${alert.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
    results.push({ alert, outcome });
    console.log(`${LOG} ${alert.id} ${alert.kind} ${alert.keys.length}종목 → ${outcome}`);
  }

  const next = settleStopAlerts(plan.state, results, now);
  const json = JSON.stringify(next);
  if (json !== raw) await saveState(json);

  const count = (o: StopAlertOutcome) => results.filter(r => r.outcome === o).length;
  return {
    ok: true,
    markets,
    held: held.length,
    priced,
    tickerFailed,
    fxRejected,
    sent: count('sent') - resendSuppressed,
    resendSuppressed,
    failed: count('failed'),
    deferred: count('not_attempted'),
  };
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
    return NextResponse.json(await run(startedAt));
  } catch (e) {
    // 알림 경로 오류가 cron·거래로 번지지 않게 여기서 끝낸다(상태 불변 — 저장 전 실패면 다음 틱에 다시 평가).
    console.error(`${LOG} 실패: ${e instanceof Error ? e.message : String(e)}`);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  } finally {
    if (runningSince === startedAt) runningSince = null;
  }
}
