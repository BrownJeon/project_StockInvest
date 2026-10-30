/**
 * T-108 홈 실거래 세트 B(B1~B7) — 단계가 mixed·live 일 때만 그린다 (가이드 §2.3.4 · §4.7 B1~B7).
 *
 * **지금 운영 단계(관찰)에서는 그려지지 않는다** — 실데이터 대조가 불가능해 합성 DTO 시험만 있다(가이드 §6).
 * KIS 실시간 호출 없음: 매수 가능액(B7)도 최신 스냅샷 현금 행 기준이다(가이드 B7 「v1 = 최신 portfolio_snapshots 현금 행」).
 *
 * B7 한도: 주문 경로의 `getEffectiveOrderMax` 는 평가액을 KIS 잔고로 다시 읽을 수 있어 쓰지 않는다. 대신 같은 설정
 * (`safety_order_max_pct` — 주문 경로 `readPctOverride` 와 같은 해석 `Number(JSON.parse(value))`)에 **스냅샷 기준 시장별 평가액**을 곱한
 * 근사다(reason 'limit_from_snapshot' — 1회 한도만, 일일 한도·실시간 예수금 미반영). 키 없음·숫자 아님·≤0 이면 주문 경로처럼
 * 0 = 매수 차단(`blocked`/order_max_unset). **조회 실패는 `unknown`**(order_max_unknown) — `getOrderMaxPct` 는 DB 오류를 0 으로 삼켜
 * 「미설정」과 구분할 수 없어 쓰지 않는다.
 *
 * USD 예수금: 스냅샷 positions 의 현금 행을 `cash.get('USD')` 로 읽는다 — T-056 이 스냅샷에 남기는 USD 행이다(잔고 배열이 아니다).
 * 행이 없으면 `unknown`(0 금지 — T-056). 환율은 `fx_rates` 행이 24시간 이내일 때만 환산한다(그 밖 krw=null·fxSource='fallback').
 */
import { EXIT_STRATEGY_ID } from '@/lib/strategy/exit-engine';
import { FX_LIMIT_MS, FX_ROW_SQL } from './anomalies';
import { marketOfSymbol, readAutoSymbols, readLatestSnapshot, SNAPSHOT_MAX_AGE_MS, type SnapshotView } from './holdings';
import { counted, metric } from './metric';
import { count, num, type OpsReader } from './read-only';
import { countWatch, type WatchCounts } from './signal-counts';
import { currentSessionDay, isoOrNull, kstIso, kstSql, toMs } from './sessions';
import type { ByMarket, LiveSet, Market, Metric, OpsStage } from './types';

export const FILLS_TODAY_SQL =
  `SELECT COUNT(DISTINCT e.order_id) AS fills,
          COUNT(DISTINCT CASE WHEN s.strategy_id = ? AND o.side = 'sell' THEN e.order_id END) AS exit_sells
     FROM executions e JOIN orders o ON o.id = e.order_id
     LEFT JOIN signals s ON s.consumed_order_id = o.id
    WHERE o.market = ? AND e.executed_at >= ? AND e.executed_at < ?`;

export async function readFillsToday(r: OpsReader, market: Market): Promise<{ fills: number; exitSells: number }> {
  const day = currentSessionDay(market, r.nowMs);
  const rows = await r.rows<Record<string, unknown>>(FILLS_TODAY_SQL, [EXIT_STRATEGY_ID, market, kstSql(day.startMs), kstSql(day.endMs)]);
  return { fills: count(rows[0]?.fills), exitSells: count(rows[0]?.exit_sells) };
}

export const ORDER_MAX_PCT_SQL = "SELECT value FROM system_config WHERE `key` = 'safety_order_max_pct' LIMIT 1";

/** 1회 한도 pct — 키 없음·해석 불가 0(주문 경로와 같은 fail-safe), 조회 실패는 던진다(호출자가 unknown). */
export async function readOrderMaxPct(r: OpsReader): Promise<number> {
  const rows = await r.rows<{ value: unknown }>(ORDER_MAX_PCT_SQL);
  if (rows.length === 0) return 0;
  try {
    const v = Number(JSON.parse(String(rows[0].value)));
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

export interface FxView { rate: number | null; atMs: number | null }

export async function readFx(r: OpsReader): Promise<FxView> {
  return r.memo('fx', async () => {
    const rows = await r.rows<{ rate: unknown; fetched_at: unknown }>(FX_ROW_SQL);
    const x = rows[0];
    const rate = x ? num(x.rate) : null;
    const atMs = x ? toMs(x.fetched_at) : null;
    return { rate: rate != null && rate > 0 ? rate : null, atMs };
  });
}

/** 스냅샷 기준 시장별 평가액(현금 행 포함) — 순수. */
export function snapshotMarketTotals(s: SnapshotView): ByMarket<number> {
  const t: ByMarket<number> = { domestic: num(s.cash.get('KRW')?.valueKrw) ?? 0, overseas: num(s.cash.get('USD')?.valueKrw) ?? 0 };
  for (const p of s.stocks) {
    const m = marketOfSymbol(p.symbol);
    if (m && p.valueKrw != null) t[m] += p.valueKrw;
  }
  return t;
}

/** B7 — 순수. stage mixed 면 금액 대신 차단 사유. */
export function buyableMetric(market: Market, stage: OpsStage, snap: SnapshotView | null, pct: number | null, fx: FxView, nowMs: number): LiveSet['buyable']['domestic'] {
  if (stage === 'mixed') return metric('blocked', null, null, 'validation_gate');
  if (!snap) return metric('unknown', null, null, 'no_snapshot');
  const asOf = kstIso(snap.ts);
  const stale = nowMs - snap.ts > SNAPSHOT_MAX_AGE_MS;
  if (pct == null) return metric('unknown', null, asOf, 'order_max_unknown');
  if (!(pct > 0)) return metric('blocked', null, asOf, 'order_max_unset');
  const totals = snapshotMarketTotals(snap);
  const limitKrw = totals[market] * (pct / 100);
  const fxFresh = fx.rate != null && fx.atMs != null && nowMs - fx.atMs <= FX_LIMIT_MS;
  const fxAt = fx.atMs != null ? kstIso(fx.atMs) : null;
  let v: NonNullable<LiveSet['buyable']['domestic']['value']>;
  let reason = 'limit_from_snapshot';
  if (market === 'domestic') {
    const cash = snap.cash.get('KRW');
    const q = cash ? num(cash.qty) : null;
    if (q == null) return metric('unknown', null, asOf, 'krw_cash_unknown');
    const native = Math.max(0, Math.min(q, limitKrw));
    v = { native, currency: 'KRW', krw: native, fxAt: null, fxSource: null };
  } else {
    const cash = snap.cash.get('USD');
    const q = cash ? num(cash.qty) : null;
    if (q == null) return metric('unknown', null, asOf, 'usd_cash_unknown');
    if (fxFresh) {
      const native = Math.max(0, Math.min(q, limitKrw / (fx.rate as number)));
      v = { native, currency: 'USD', krw: native * (fx.rate as number), fxAt, fxSource: 'fx_rates' };
    } else {
      // 환율이 없거나 24시간 넘음 — 한도(원화)를 달러로 바꿀 수 없다. 예수금만 보이고 환산은 숨긴다.
      v = { native: Math.max(0, q), currency: 'USD', krw: null, fxAt, fxSource: 'fallback' };
      reason = 'limit_not_applied_fx';
    }
  }
  return metric(stale ? 'stale' : v.native > 0 ? 'available' : 'zero', v, asOf, stale ? 'snapshot_old' : reason);
}

export async function readLiveSet(r: OpsReader, stage: OpsStage): Promise<LiveSet> {
  const [watch, snap, auto, fills, pct, fx] = await Promise.all([
    countWatch(r),
    readLatestSnapshot(r),
    readAutoSymbols(r),
    Promise.all([readFillsToday(r, 'domestic'), readFillsToday(r, 'overseas')]),
    readOrderMaxPct(r).then((v) => v, () => null),
    readFx(r),
  ]);
  const asOfNow = kstIso(r.nowMs);
  const watchMetric = (w: WatchCounts): Metric<{ watching: number; executing: number; nextSession: number }> => {
    const v = { watching: w.watching, executing: w.executing, nextSession: w.nextSession };
    if (stage === 'mixed') return metric('blocked', v, asOfNow, 'validation_gate');
    return { ...counted(w.watching + w.executing + w.nextSession, asOfNow), value: v };
  };

  let positions: LiveSet['positions'];
  if (!snap) positions = metric('unknown', null, null, 'no_snapshot');
  else {
    const held = snap.stocks.filter((p) => p.qty != null && p.qty > 0 && marketOfSymbol(p.symbol) != null);
    const autoRows = held.filter((p) => auto.has(p.symbol));
    const autoValue = autoRows.reduce((a, p) => (a == null || p.valueKrw == null ? null : a + p.valueKrw), 0 as number | null);
    const snapAt = isoOrNull(snap.ts);
    const v = { autoCount: autoRows.length, autoValueKrw: autoRows.length === 0 ? 0 : autoValue, accountCount: held.length, snapshotAt: snapAt };
    const stale = r.nowMs - snap.ts > SNAPSHOT_MAX_AGE_MS;
    positions = metric(stale ? 'stale' : autoRows.length === 0 ? 'zero' : 'available', v, snapAt, stale ? 'snapshot_old' : undefined);
  }

  const fill = (m: Market, f: { fills: number; exitSells: number }): LiveSet['fillsToday']['domestic'] =>
    ({ ...counted(f.fills, asOfNow), value: { fills: f.fills, session: currentSessionDay(m, r.nowMs).ref, exitSells: f.exitSells } });

  return {
    watch: { domestic: watchMetric(watch.domestic), overseas: watchMetric(watch.overseas) },
    positions,
    fillsToday: { domestic: fill('domestic', fills[0]), overseas: fill('overseas', fills[1]) },
    allocation: metric<null>('unknown', null, null, 'not_set'),
    autoPnl: metric<null>('unknown', null, null, 'baseline_unset'),
    buyable: {
      domestic: buyableMetric('domestic', stage, snap, pct, fx, r.nowMs),
      overseas: buyableMetric('overseas', stage, snap, pct, fx, r.nowMs),
    },
  };
}
