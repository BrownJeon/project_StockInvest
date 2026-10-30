/**
 * T-108 보유(계좌 전체, D3) — 거래 › 보유·주문 「보유」 행과 X5 구간 집계 (가이드 §4.4 holdings).
 *
 * 원천(전부 SELECT, KIS 호출 없음):
 *  - 최신 `portfolio_snapshots`(positions JSON) — 현금 행(KRW·USD)을 뺀 종목 = 계좌 보유. `price` 는 스냅샷 시점 값(해외는 원화 환산 —
 *    청산 엔진이 비교하는 `getTicker` 값과 같은 단위).
 *  - `position_state` — 진입가(KIS 평단)·고점·시나리오 청산값. 청산 엔진이 매 틱 갱신한다.
 *  - 자동 귀속: `orders.source IN ('signal','auto')` ∧ 체결(`filled`·`partially_filled`) ⋈ `executions` 수량(매수 − 매도) > 0 인 종목.
 *  - 임계: `getStyleConfig()`(청산 엔진과 같은 판독기 — 코드 기본값 ⊕ `style_default_*`).
 *
 * 스냅샷이 3시간보다 오래되면 `stale`(kill-switch 의 현재값 신뢰 한도·월 수익률의 END_MAX_AGE_MS 와 같은 3h).
 */
import { CASH_CURRENCIES } from '@/lib/safety/snapshot-composition';
import { DEFAULT_STYLE_CONFIG, getStyleConfig } from '@/lib/strategy/style';
import { withDeadline } from '@/lib/strategy/records/safe-text';
import { classifyExitZone, type ZoneThresholds } from './exit-zone';
import { num, parseJsonObject, type OpsReader } from './read-only';
import { isSessionOpenAt, isoOrNull, toMs, type ClosedDays } from './sessions';
import type { ExitZone, Market, TradeDTO, TradeHoldingRow } from './types';

export const SNAPSHOT_MAX_AGE_MS = 3 * 3600_000;

/** 심볼 → 시장. `exchanges/kis-symbols` 의 패턴과 같다(그 모듈을 import 하지 않는 이유: ops 는 거래소 모듈 0 — 시험이 패턴 일치를 대조). */
const OVERSEAS_SYMBOL = /^[A-Z]{3}:[A-Z][A-Z0-9.]*$/;
const DOMESTIC_SYMBOL = /^\d{6}$/;
export function marketOfSymbol(symbol: string): Market | null {
  if (OVERSEAS_SYMBOL.test(symbol)) return 'overseas';
  if (DOMESTIC_SYMBOL.test(symbol)) return 'domestic';
  return null;
}

export interface SnapshotPositionView { symbol: string; qty: number | null; price: number | null; valueKrw: number | null }
export interface SnapshotView {
  ts: number;
  /** 현금 행을 뺀 종목 */
  stocks: SnapshotPositionView[];
  /** 통화 → 현금 행(KRW·USD). USD 는 `cash.get('USD')` 로만 읽는다(스냅샷 행 — 잔고 배열이 아니다). */
  cash: Map<string, { qty: number | null; valueKrw: number | null; price: number | null }>;
}

export const LATEST_SNAPSHOT_SQL = 'SELECT ts, positions FROM portfolio_snapshots ORDER BY ts DESC LIMIT 1';


export async function readLatestSnapshot(r: OpsReader): Promise<SnapshotView | null> {
  return r.memo('snapshot', () => readLatestSnapshotOnce(r));
}

async function readLatestSnapshotOnce(r: OpsReader): Promise<SnapshotView | null> {
  const rows = await r.rows<{ ts: unknown; positions: unknown }>(LATEST_SNAPSHOT_SQL);
  const x = rows[0];
  if (!x) return null;
  const ts = toMs(x.ts);
  if (ts == null) return null;
  let arr: unknown = x.positions;
  if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch { arr = null; } }
  const stocks: SnapshotPositionView[] = [];
  const cash: SnapshotView['cash'] = new Map();
  if (Array.isArray(arr)) {
    for (const p of arr) {
      if (!p || typeof p !== 'object') continue;
      const o = p as Record<string, unknown>;
      const code = typeof o.currency === 'string' ? o.currency : '';
      if (!code) continue;
      const v = { qty: num(o.qty), price: num(o.price), valueKrw: num(o.value_krw) };
      if (CASH_CURRENCIES.has(code)) cash.set(code, v);   // 현금 행 판별 = 킬스위치 구성 비교와 같은 상수
      else stocks.push({ symbol: code, ...v });
    }
  }
  return { ts, stocks, cash };
}

interface PositionStateView { entry: number | null; peak: number | null; scenario: { targetLo: number; targetHi: number; stopLo: number; stopHi: number } | null }

export const POSITION_STATE_SQL = 'SELECT symbol, market, entry_price, peak_price, scenario_exit FROM position_state';

export async function readPositionStates(r: OpsReader): Promise<Map<string, PositionStateView & { market: Market }>> {
  return r.memo('position_state', () => readPositionStatesOnce(r));
}

async function readPositionStatesOnce(r: OpsReader): Promise<Map<string, PositionStateView & { market: Market }>> {
  const rows = await r.rows<Record<string, unknown>>(POSITION_STATE_SQL);
  const out = new Map<string, PositionStateView & { market: Market }>();
  for (const row of rows) {
    const m = String(row.market);
    if (m !== 'domestic' && m !== 'overseas') continue;
    const sc = parseJsonObject(row.scenario_exit);
    const scenario = sc && ['targetLo', 'targetHi', 'stopLo', 'stopHi'].every((k) => num(sc[k]) != null)
      ? { targetLo: num(sc.targetLo)!, targetHi: num(sc.targetHi)!, stopLo: num(sc.stopLo)!, stopHi: num(sc.stopHi)! }
      : null;
    out.set(`${m}|${String(row.symbol)}`, { market: m, entry: num(row.entry_price), peak: num(row.peak_price), scenario });
  }
  return out;
}

export const AUTO_SYMBOLS_SQL =
  `SELECT o.symbol, o.side, SUM(e.quantity) AS q
     FROM orders o JOIN executions e ON e.order_id = o.id
    WHERE o.source IN ('signal', 'auto') AND o.status IN ('filled', 'partially_filled')
    GROUP BY o.symbol, o.side`;

/** 자동 귀속 보유 종목 — 체결 수량(매수 − 매도) > 0. */
export async function readAutoSymbols(r: OpsReader): Promise<Set<string>> {
  return r.memo('auto_symbols', () => readAutoSymbolsOnce(r));
}

async function readAutoSymbolsOnce(r: OpsReader): Promise<Set<string>> {
  const rows = await r.rows<{ symbol: unknown; side: unknown; q: unknown }>(AUTO_SYMBOLS_SQL);
  const net = new Map<string, number>();
  for (const row of rows) {
    const q = num(row.q) ?? 0;
    const s = String(row.symbol);
    net.set(s, (net.get(s) ?? 0) + (String(row.side) === 'sell' ? -q : q));
  }
  return new Set([...net].filter(([, q]) => q > 1e-9).map(([s]) => s));
}

export interface StyleView { thresholds: ZoneThresholds; thresholdSource: 'override' | 'default'; trailingSource: 'override' | 'default' }

/** 엔진과 같은 판독기. 상한 2.5초 — 넘으면 던진다(섹션 error). 기본값과 다르면 override 로 표기. */
export async function readStyle(r?: OpsReader): Promise<StyleView> {
  return r ? r.memo('style', readStyleOnce) : readStyleOnce();
}

async function readStyleOnce(): Promise<StyleView> {
  const s = await withDeadline(getStyleConfig(), 2500);
  if (!s) throw new Error('style_timeout');
  const d = DEFAULT_STYLE_CONFIG;
  const thresholds: ZoneThresholds = {
    hardStopPct: s.hardStopPct, eodLossCutPct: s.eodLossCutPct, targetProfitPct: s.targetProfitPct,
    trailingActivatePct: s.trailingActivatePct, trailingDrawdownPct: s.trailingDrawdownPct,
  };
  const thresholdSource = s.hardStopPct !== d.hardStopPct || s.eodLossCutPct !== d.eodLossCutPct || s.targetProfitPct !== d.targetProfitPct
    ? 'override' : 'default';
  const trailingSource = s.trailingActivatePct !== d.trailingActivatePct || s.trailingDrawdownPct !== d.trailingDrawdownPct ? 'override' : 'default';
  return { thresholds, thresholdSource, trailingSource };
}

export type HoldingsData = Extract<TradeDTO['holdings'], { state: 'ok' }>['data'];

export async function readHoldings(r: OpsReader, closed: ClosedDays): Promise<HoldingsData> {
  const [snap, states, auto, style] = await Promise.all([readLatestSnapshot(r), readPositionStates(r), readAutoSymbols(r), readStyle(r)]);
  const now = new Date(r.nowMs);
  const overseasOpen = closed.overseas ? isSessionOpenAt('overseas', r.nowMs, closed.overseas) : false;
  const rows: TradeHoldingRow[] = [];
  for (const p of snap?.stocks ?? []) {
    const market = marketOfSymbol(p.symbol);
    if (!market) continue;
    if (!(p.qty != null && p.qty > 0)) continue;
    const st = states.get(`${market}|${p.symbol}`) ?? null;
    const z = classifyExitZone({
      market, price: p.price, entry: st?.entry ?? null, peak: st?.peak ?? null, scenario: st?.scenario ?? null,
      thresholds: style.thresholds, now, overseasOpen,
    });
    rows.push({ symbol: p.symbol, market, auto: auto.has(p.symbol), pnlPct: z.pnlPct, zone: z.zone, detail: z.detail });
  }
  const t = style.thresholds;
  return {
    snapshotAt: snap ? isoOrNull(snap.ts) : null,
    stale: !snap || r.nowMs - snap.ts > SNAPSHOT_MAX_AGE_MS,
    trailing: { activatePct: t.trailingActivatePct, drawdownPct: t.trailingDrawdownPct, source: style.trailingSource },
    thresholds: { hardStopPct: t.hardStopPct, eodLossCutPct: t.eodLossCutPct, targetProfitPct: t.targetProfitPct, source: style.thresholdSource },
    accountCount: rows.length,
    autoCount: rows.filter((x) => x.auto).length,
    rows,
  };
}

/** X5 — 구간별 종목 수. */
export function summarizeZones(rows: readonly TradeHoldingRow[]): Record<ExitZone, number> {
  const out: Record<ExitZone, number> = { hard_stop: 0, eod_cut: 0, take_profit: 0, trailing_active: 0, neutral: 0, not_evaluated: 0 };
  for (const x of rows) out[x.zone]++;
  return out;
}
