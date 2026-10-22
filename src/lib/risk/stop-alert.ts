/**
 * T-068 WP-C — 손절가 도달 알림 판정 (순수 모듈).
 *
 * 보유 종목의 현재가가 **예상 손절가**(T-066 정책 `risk_policy` — 기준가 × (1 − 손절폭))에 닿거나 그 아래로 내려가면
 * 알릴지 정한다. **알림만** 정한다 — 주문·매도·시그널을 만들지 않는다.
 *
 * 규칙: DB·fetch·notify·exchanges·Node 전용 API 금지. 입력(보유·현재가·정책·이전 상태·시각)만으로 결과가 정해진다.
 * 예상 손절가·'이미 아래' 판정·손절 시 손익은 T-066 의 `computeRisk`(compute.ts) 를 그대로 쓴다(정의는 한 곳).
 *
 * 흐름 (cron 라우트 `src/app/api/cron/stop-alert/route.ts`):
 *   1. `planStopAlerts` — 알림 없이 바뀌는 상태(재무장·정책 변경 재설정·처음 위인 종목·일일 상한 초과분)를 반영한 상태와
 *      보낼 알림 목록을 돌려준다. 알림 대상 종목은 아직 'below' 로 바꾸지 않는다.
 *   2. 라우트가 알림을 보낸다.
 *   3. `settleStopAlerts` — 보낸 알림만 'below'·발송 시각·일일 건수에 반영하고, 실패는 재시도 기록만 남긴다(상태 불변).
 *
 * 알림 규칙 (T-068 명세):
 *   1. 교차: 'above' 였던 종목이 현재가 ≤ 예상 손절가가 되면 종목별 1건.
 *   2. 최초 요약: 상태가 없는 종목이 이미 아래이면 종목마다 보내지 않고 시장별 1건 요약 후 'below'.
 *   3. 재무장: 'below' 종목이 손절가 대비 +0.5% 이상 위로 2회 연속 확인되면 'above'(회복 알림 없음).
 *      같은 종목 재알림 쿨다운 60분(쿨다운 중 교차는 미룬다 — 끝난 뒤에도 아래이면 그때 알린다). 일일(KST) 최대 20건,
 *      초과분은 로그만 남기고 'below' 로 기록한다.
 *   4. 정책 version 이 바뀐 뒤 그 종목의 첫 평가는 알림 없이 상태만 새로 맞춘다.
 *   5. 현재가 없음(장 마감·시세 실패)·평균단가 없음: 평가하지 않고 상태 불변.
 *   6. 발송 실패: 상태를 바꾸지 않아 다음 틱에 재시도, 3회 연속 실패하면 10분 대기(Reviewer M-3 — 장애 한 번이 1시간 침묵이 되지 않게).
 */
import { computeRisk, type HoldingInput, type HoldingRow } from './compute';
import type { RiskPolicyEditable, StopBasis } from './defaults';

export type StopAlertMarket = 'domestic' | 'overseas';

export const STOP_ALERT_RULES = {
  /** 재무장 — 손절가보다 이만큼(%) 이상 위 */
  rearmPct: 0.5,
  /** 재무장 — 연속 확인 횟수 */
  rearmConfirm: 2,
  /** 같은 종목 재알림 쿨다운(분) */
  cooldownMin: 60,
  /** 하루(KST) 최대 발송 건수 */
  dailyMax: 20,
  /** 연속 발송 실패 허용 횟수 — 넘으면 대기 */
  retryMax: 3,
  /** 연속 실패 뒤 대기(분) — 명세 60분에서 10분으로 줄임(Reviewer M-3: 손절 알림이 장애 한 번에 1시간 침묵이 되지 않게) */
  retryWaitMin: 10,
} as const;

const MIN_MS = 60_000;

export interface StopAlertSymbolState {
  state: 'above' | 'below';
  /** 지금 상태가 시작된 시각 (ISO) */
  since: string;
  /** 마지막으로 이 종목 알림을 보낸 시각 (ISO) — 요약 포함 */
  lastAlertAt: string | null;
  /** 'below' 에서 손절가 +0.5% 이상 위로 연속 확인된 횟수 */
  rearm: number;
  /** 이 상태를 정한 정책 version */
  pv: number;
}

export interface StopAlertRetry {
  /** 연속 발송 실패 횟수 (대기에 들어가면 0 으로 되돌린다) */
  failures: number;
  /** 이 시각까지 재시도하지 않는다 (ISO) */
  until: string | null;
}

/** `system_config.risk_stop_alert_state` 에 저장되는 JSON */
export interface StopAlertState {
  v: 1;
  /** 마지막 평가에 쓴 정책 version */
  policyVersion: number | null;
  /** 일일 건수의 기준 날짜 (KST YYYY-MM-DD) */
  day: string;
  sentToday: number;
  /** 키 = `${market}|${symbol}` */
  symbols: Record<string, StopAlertSymbolState>;
  /** 키 = `cross:${market}|${symbol}` 또는 `summary:${market}` */
  retry: Record<string, StopAlertRetry>;
}

export interface StopAlertPolicy extends RiskPolicyEditable {
  version: number;
}

export interface StopAlertHoldingInput {
  symbol: string;
  market: StopAlertMarket;
  qty: number;
  /** 평균단가(원화) */
  avgKrw: number | null;
  /** 보유 중 고점(원화) — 고점 기준일 때만 필요 */
  peakKrw: number | null;
  /** 이번 틱 현재가(원화). 장이 닫혔거나 시세를 못 얻었으면 null → 평가하지 않고 상태 불변 */
  priceKrw: number | null;
  /** 해외 표시용 원/USD (현재가 원화 ÷ USD 원가). 없으면 원화로만 표시 */
  fx?: number | null;
}

export interface StopAlertInput {
  now: Date;
  policy: StopAlertPolicy;
  /** 지금 보유 중인 전 종목 (닫힌 시장 종목은 priceKrw=null 로 — 상태 정리에서 빠지지 않게) */
  holdings: StopAlertHoldingInput[];
  prev: StopAlertState | null;
}

/** 알림 메시지에 쓰는 종목 값 */
export interface StopAlertItem {
  key: string;
  symbol: string;
  market: StopAlertMarket;
  qty: number;
  priceKrw: number;
  stopKrw: number;
  refKrw: number;
  avgKrw: number;
  unrealPct: number | null;
  pnlAtStopKrw: number | null;
  pnlAtStopPct: number | null;
  /** 손절가보다 낮은 정도 % */
  underPct: number | null;
  fx: number | null;
}

export interface PlannedStopAlert {
  /** 재시도 기록 키 */
  id: string;
  kind: 'cross' | 'summary';
  market: StopAlertMarket;
  /** 성공 시 'below' 로 기록할 종목 키 */
  keys: string[];
  items: StopAlertItem[];
  policy: StopAlertPolicy;
}

export interface StopAlertPlan {
  state: StopAlertState;
  alerts: PlannedStopAlert[];
  /** 로그 줄 (발송하지 않은 사유 등) */
  logs: string[];
}

export type StopAlertOutcome = 'sent' | 'failed' | 'not_attempted';

// ─── 보조 ──────────────────────────────────────────────────────────────────

export const symbolKey = (market: StopAlertMarket, symbol: string) => `${market}|${symbol}`;

/** KST 날짜 YYYY-MM-DD */
export function kstDay(now: Date): string {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

export function emptyStopAlertState(now: Date): StopAlertState {
  return { v: 1, policyVersion: null, day: kstDay(now), sentToday: 0, symbols: {}, retry: {} };
}

const isoOk = (s: unknown): s is string => typeof s === 'string' && Number.isFinite(Date.parse(s));
const nonNegInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

/**
 * 저장된 상태 JSON → 상태. 형식이 맞지 않으면 null(호출부는 '상태 없음'으로 다루고 로그를 남긴다).
 * 종목 하나가 깨졌으면 그 종목만 버린다(다음 평가에서 새 종목처럼 다룬다).
 */
export function parseStopAlertState(raw: unknown): StopAlertState | null {
  let v: unknown = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return null; }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (o.v !== 1) return null;
  if (typeof o.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.day)) return null;
  if (!nonNegInt(o.sentToday)) return null;
  if (!(o.policyVersion === null || (typeof o.policyVersion === 'number' && Number.isInteger(o.policyVersion)))) return null;
  const symbols: Record<string, StopAlertSymbolState> = {};
  if (o.symbols && typeof o.symbols === 'object' && !Array.isArray(o.symbols)) {
    for (const [k, s] of Object.entries(o.symbols as Record<string, unknown>)) {
      if (!s || typeof s !== 'object') continue;
      const e = s as Record<string, unknown>;
      if (e.state !== 'above' && e.state !== 'below') continue;
      if (!isoOk(e.since)) continue;
      if (!(e.lastAlertAt === null || isoOk(e.lastAlertAt))) continue;
      if (!nonNegInt(e.rearm) || !(typeof e.pv === 'number' && Number.isInteger(e.pv))) continue;
      symbols[k] = { state: e.state, since: e.since, lastAlertAt: e.lastAlertAt as string | null, rearm: e.rearm, pv: e.pv };
    }
  }
  const retry: Record<string, StopAlertRetry> = {};
  if (o.retry && typeof o.retry === 'object' && !Array.isArray(o.retry)) {
    for (const [k, r] of Object.entries(o.retry as Record<string, unknown>)) {
      if (!r || typeof r !== 'object') continue;
      const e = r as Record<string, unknown>;
      if (!nonNegInt(e.failures) || !(e.until === null || isoOk(e.until))) continue;
      retry[k] = { failures: e.failures, until: e.until as string | null };
    }
  }
  return { v: 1, policyVersion: o.policyVersion as number | null, day: o.day, sentToday: o.sentToday, symbols, retry };
}

function clone(s: StopAlertState): StopAlertState {
  return {
    ...s,
    symbols: Object.fromEntries(Object.entries(s.symbols).map(([k, v]) => [k, { ...v }])),
    retry: Object.fromEntries(Object.entries(s.retry).map(([k, v]) => [k, { ...v }])),
  };
}

function waiting(r: StopAlertRetry | undefined, now: Date): boolean {
  return !!r?.until && Date.parse(r.until) > now.getTime();
}

function toItem(key: string, row: HoldingRow, fx: number | null): StopAlertItem {
  return {
    key,
    symbol: row.symbol,
    market: row.market,
    qty: row.qty,
    priceKrw: row.priceKrw as number,
    stopKrw: row.stopKrw as number,
    refKrw: row.refKrw as number,
    avgKrw: row.avgKrw as number,
    unrealPct: row.unrealPct,
    pnlAtStopKrw: row.pnlAtStopKrw,
    pnlAtStopPct: row.pnlAtStopPct,
    underPct: row.underPct,
    fx,
  };
}

// ─── 판정 ──────────────────────────────────────────────────────────────────

/**
 * 이번 틱의 알림 계획. 반환 상태에는 알림 없이 바뀌는 것만 반영돼 있다 — 알림 대상 종목은
 * `settleStopAlerts` 가 발송 성공을 확인한 뒤에만 'below' 가 된다.
 */
export function planStopAlerts(input: StopAlertInput): StopAlertPlan {
  const { now, policy } = input;
  const nowIso = now.toISOString();
  const logs: string[] = [];
  const state = input.prev ? clone(input.prev) : emptyStopAlertState(now);

  const today = kstDay(now);
  if (state.day !== today) { state.day = today; state.sentToday = 0; }

  // 보유에서 빠진 종목 정리 (보유 목록 = 닫힌 시장 포함 전 종목)
  const held = new Set(input.holdings.map(h => symbolKey(h.market, h.symbol)));
  for (const k of Object.keys(state.symbols)) if (!held.has(k)) delete state.symbols[k];
  for (const k of Object.keys(state.retry)) {
    if (k.startsWith('cross:') && !held.has(k.slice('cross:'.length))) delete state.retry[k];
  }

  // 정책이 바뀐 직후 평가 — 이전 상태가 있었고 version 이 다르면 처음 보는 종목도 조용히 맞춘다
  const versionChanged = input.prev !== null && input.prev.policyVersion !== null && input.prev.policyVersion !== policy.version;

  // 평가 대상: 현재가가 있고 수량이 있는 종목. 계산은 T-066 computeRisk 그대로.
  const evalHoldings: HoldingInput[] = input.holdings
    .filter(h => typeof h.priceKrw === 'number' && Number.isFinite(h.priceKrw) && h.priceKrw > 0 && Number.isFinite(h.qty) && h.qty > 0)
    .map(h => ({ symbol: h.symbol, market: h.market, qty: h.qty, avgKrw: h.avgKrw, peakKrw: h.peakKrw, priceKrw: h.priceKrw }));
  const fxOf = new Map(input.holdings.map(h => [symbolKey(h.market, h.symbol), typeof h.fx === 'number' && Number.isFinite(h.fx) && h.fx > 0 ? h.fx : null]));
  const rows = computeRisk(evalHoldings, 0, policy).rows
    .slice()
    .sort((a, b) => symbolKey(a.market, a.symbol).localeCompare(symbolKey(b.market, b.symbol)));

  const alerts: PlannedStopAlert[] = [];
  const firstBelow: Record<StopAlertMarket, StopAlertItem[]> = { domestic: [], overseas: [] };
  const capReached = () => state.sentToday + alerts.length >= STOP_ALERT_RULES.dailyMax;
  const markBelow = (key: string, prev: StopAlertSymbolState | undefined): StopAlertSymbolState => ({
    state: 'below',
    since: prev?.state === 'below' ? prev.since : nowIso,
    lastAlertAt: prev?.lastAlertAt ?? null,
    rearm: 0,
    pv: policy.version,
  });

  for (const row of rows) {
    const key = symbolKey(row.market, row.symbol);
    if (row.stopKrw === null || row.priceKrw === null || row.reason !== null) {
      logs.push(`${key} 평가 불가(${row.reason ?? 'no_stop'}) — 상태 불변`);
      continue;
    }
    const below = row.below;
    const s = state.symbols[key];
    const crossId = `cross:${key}`;

    // 4. 정책 변경 후 첫 평가 → 알림 없이 맞춘다
    if ((s && s.pv !== policy.version) || (!s && versionChanged)) {
      const nextState = below ? 'below' : 'above';
      state.symbols[key] = {
        state: nextState,
        since: s && s.state === nextState ? s.since : nowIso,
        lastAlertAt: s?.lastAlertAt ?? null,
        rearm: 0,
        pv: policy.version,
      };
      delete state.retry[crossId];
      logs.push(`${key} 정책 version ${s?.pv ?? input.prev?.policyVersion ?? '-'}→${policy.version} — 알림 없이 '${nextState}' 로 재설정`);
      continue;
    }

    if (!s) {
      if (below) firstBelow[row.market].push(toItem(key, row, fxOf.get(key) ?? null));
      else state.symbols[key] = { state: 'above', since: nowIso, lastAlertAt: null, rearm: 0, pv: policy.version };
      continue;
    }

    if (s.state === 'above') {
      if (!below) { delete state.retry[crossId]; continue; }
      // 1. 교차
      if (s.lastAlertAt && now.getTime() - Date.parse(s.lastAlertAt) < STOP_ALERT_RULES.cooldownMin * MIN_MS) {
        logs.push(`${key} 손절가 아래지만 쿨다운 중(마지막 알림 ${s.lastAlertAt}) — 미룸`);
        continue;
      }
      if (waiting(state.retry[crossId], now)) {
        logs.push(`${key} 발송 실패 대기 중(${state.retry[crossId].until}까지) — 미룸`);
        continue;
      }
      if (capReached()) {
        state.symbols[key] = markBelow(key, s);
        logs.push(`${key} 손절가 도달 — 일일 상한 ${STOP_ALERT_RULES.dailyMax}건 초과로 발송하지 않음(로그만)`);
        continue;
      }
      alerts.push({ id: crossId, kind: 'cross', market: row.market, keys: [key], items: [toItem(key, row, fxOf.get(key) ?? null)], policy });
      continue;
    }

    // 3. 'below' — 재무장 확인
    const rearmLine = (row.stopKrw as number) * (1 + STOP_ALERT_RULES.rearmPct / 100);
    if ((row.priceKrw as number) >= rearmLine) {
      const n = s.rearm + 1;
      state.symbols[key] = n >= STOP_ALERT_RULES.rearmConfirm
        ? { state: 'above', since: nowIso, lastAlertAt: s.lastAlertAt, rearm: 0, pv: policy.version }
        : { ...s, rearm: n };
    } else if (s.rearm !== 0) {
      state.symbols[key] = { ...s, rearm: 0 };
    }
  }

  // 2. 최초 요약 — 시장별 1건
  for (const market of ['domestic', 'overseas'] as const) {
    const items = firstBelow[market];
    if (items.length === 0) continue;
    const id = `summary:${market}`;
    if (waiting(state.retry[id], now)) {
      logs.push(`${market} 최초 요약 발송 실패 대기 중(${state.retry[id].until}까지) — 미룸`);
      continue;
    }
    if (capReached()) {
      for (const it of items) state.symbols[it.key] = markBelow(it.key, undefined);
      logs.push(`${market} 최초 요약(${items.length}종목) — 일일 상한 초과로 발송하지 않고 'below' 로 기록(로그만)`);
      continue;
    }
    alerts.push({ id, kind: 'summary', market, keys: items.map(i => i.key), items, policy });
  }

  state.policyVersion = policy.version;
  return { state, alerts, logs };
}

/**
 * 발송 결과 반영. 보낸 알림의 종목만 'below'·발송 시각을 기록하고 일일 건수를 올린다.
 * 실패는 상태를 바꾸지 않고 재시도 기록만 남긴다(3회 연속이면 10분 대기). 시도하지 않은 알림은 아무것도 바꾸지 않는다.
 */
export function settleStopAlerts(
  planned: StopAlertState,
  results: { alert: PlannedStopAlert; outcome: StopAlertOutcome }[],
  now: Date,
): StopAlertState {
  const state = clone(planned);
  const nowIso = now.toISOString();
  for (const { alert, outcome } of results) {
    if (outcome === 'sent') {
      for (const key of alert.keys) {
        const prev = state.symbols[key];
        state.symbols[key] = {
          state: 'below',
          since: prev?.state === 'below' ? prev.since : nowIso,
          lastAlertAt: nowIso,
          rearm: 0,
          pv: alert.policy.version,
        };
      }
      state.sentToday += 1;
      delete state.retry[alert.id];
    } else if (outcome === 'failed') {
      const r = state.retry[alert.id] ?? { failures: 0, until: null };
      const failures = r.failures + 1;
      state.retry[alert.id] = failures >= STOP_ALERT_RULES.retryMax
        ? { failures: 0, until: new Date(now.getTime() + STOP_ALERT_RULES.retryWaitMin * MIN_MS).toISOString() }
        : { failures, until: null };
    }
  }
  return state;
}

// ─── 메시지 ────────────────────────────────────────────────────────────────

const MINUS = '−';
const group = (n: number) => Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const signed = (n: number, body: string) => (n < 0 ? `${MINUS}${body}` : n > 0 ? `+${body}` : body);

export function fmtKrw(n: number): string {
  return `${n < 0 ? MINUS : ''}${group(n)}원`;
}
export function fmtSignedKrw(n: number): string {
  return signed(Math.round(n), `${group(n)}원`);
}
export function fmtSignedPct(n: number): string {
  return signed(Number(n.toFixed(2)), `${Math.abs(n).toFixed(2)}%`);
}
function fmtUsd(n: number): string {
  const [i, d] = Math.abs(n).toFixed(2).split('.');
  return `${n < 0 ? MINUS : ''}$${i.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${d}`;
}
/** 가격 표시 — 해외는 USD(원화), 국내는 원화 */
export function fmtPrice(krw: number, market: StopAlertMarket, fx: number | null): string {
  if (market === 'overseas' && fx) return `${fmtUsd(krw / fx)} (${fmtKrw(krw)})`;
  return fmtKrw(krw);
}

const BASIS_LABEL: Record<StopBasis, string> = { avg: '평균단가', peak: '보유 중 고점' };
const MARKET_LABEL: Record<StopAlertMarket, string> = { domestic: '국내', overseas: '미국' };
const pctText = (n: number) => `${Number(n.toFixed(2))}%`;

export const STOP_ALERT_FOOTER = '주문은 자동으로 나가지 않습니다. 직접 판단하세요.';

/**
 * 텔레그램 HTML·슬랙 mrkdwn 양쪽에 그대로 들어가는 제목·본문. `labels` 값은 호출부가 이스케이프한 표시 문자열
 * (`getSymbolLabel` 반환값)이어야 한다 — 이 함수가 만드는 나머지 문자는 숫자·고정 문구뿐이고 `<`·`>`·`&` 를 쓰지 않는다.
 */
export function formatStopAlert(alert: PlannedStopAlert, labels: Record<string, string>): { title: string; body: string } {
  const p = alert.policy;
  const basis = `${BASIS_LABEL[p.stopBasis]} 기준 ${MINUS}${pctText(p.stopPct)}`;
  const label = (it: StopAlertItem) => labels[it.key] ?? it.symbol;

  if (alert.kind === 'cross') {
    const it = alert.items[0];
    const lines = [
      `현재가: ${fmtPrice(it.priceKrw, it.market, it.fx)}`,
      `예상 손절가: ${fmtPrice(it.stopKrw, it.market, it.fx)} (${basis})`,
      ...(p.stopBasis === 'peak' ? [`보유 중 고점: ${fmtPrice(it.refKrw, it.market, it.fx)}`] : []),
      `평균단가: ${fmtPrice(it.avgKrw, it.market, it.fx)}`,
      `평가손익률: ${it.unrealPct === null ? '-' : fmtSignedPct(it.unrealPct)}`,
      `손절 시 손익: ${it.pnlAtStopKrw === null ? '-' : fmtSignedKrw(it.pnlAtStopKrw)}${it.pnlAtStopPct === null ? '' : ` (${fmtSignedPct(it.pnlAtStopPct)}, ${group(it.qty)}주)`}`,
      '',
      STOP_ALERT_FOOTER,
    ];
    return { title: `🔻 손절가 도달 — ${label(it)}`, body: lines.join('\n') };
  }

  const n = alert.items.length;
  const lines = [
    `현재 ${n}종목이 이미 예상 손절가 아래입니다 (${basis}).`,
    ...alert.items.map(it =>
      `• ${label(it)}: 현재가 ${fmtPrice(it.priceKrw, it.market, it.fx)} / 예상 손절가 ${fmtPrice(it.stopKrw, it.market, it.fx)}`
      + (it.underPct === null ? '' : ` (손절가보다 ${Math.abs(it.underPct).toFixed(2)}% 낮음)`)),
    '',
    '손절가 위로 다시 올라왔다가 내려오면 그때 종목별로 알립니다.',
    STOP_ALERT_FOOTER,
  ];
  return { title: `🔻 이미 손절가 아래 — ${MARKET_LABEL[alert.market]} ${n}종목`, body: lines.join('\n') };
}
