/**
 * T-108 `GET /api/ops/trade` 본체 → `TradeDTO` (가이드 §4.4 · §2.4).
 *
 * - counts: 승인 대기(시장별, 홈과 **같은 함수** `countApproval`) · 관측 기록(`detected`) · 진입 감시(감시 중/다음 세션 예정/선점) ·
 *   오늘 주문 전 단계에서 막힌 매수 시그널 수(`status='skipped'` ∧ `indicators.gate='validation_gate'`, 청산 엔진 제외).
 * - executing: 종료 주문(filled/cancelled)을 제외한 executing 줄과 연결 주문 결과(취소 불가 — 버튼 없음).
 * - blockedPostMarket: 시장별 마지막 장마감 분석 슬롯 이후 차단된 장마감 시그널 최대 2(관찰 단계 0건 화면).
 * - holdings: 계좌 전체 보유 + 청산 임계 구간(`holdings.ts`).
 * - openOrders: 오늘(시장별 세션일) `accepted`·`partially_filled` 주문 + 체결 수량 합.
 * 읽기 전용, KIS 호출 없음.
 */
import { VALIDATION_GATE_INDICATOR } from '@/lib/signals/paper-fill';
import { EXIT_STRATEGY_ID } from '@/lib/strategy/exit-engine';
import { specFor } from '@/lib/strategy/records/job-slots';
import { POST_MARKET_JOB } from './analysis-runs';
import { readHoldings } from './holdings';
import { count, createReader, num, parseJsonObject, section, type OpsReader } from './read-only';
import { ACTIVE_EXECUTING_ORDER_SQL, countApproval, countDetected, countWatch } from './signal-counts';
import {
  currentSessionDay, isoOrNull, kstDateOf, kstIso, kstSql, lastDailySlotMs, loadClosedDays, localDateOf, sessionRef, toMs,
} from './sessions';
import type { Market, TradeDTO } from './types';

export const PRE_ORDER_BLOCKED_SQL =
  `SELECT COUNT(*) AS n FROM signals
    WHERE market = ? AND created_at >= ? AND created_at < ? AND side = 'buy' AND status = 'skipped'
      AND JSON_VALUE(indicators, '$.gate') = ? AND (strategy_id IS NULL OR strategy_id <> ?)`;
export const EXECUTING_SQL =
  `SELECT s.id, s.symbol, s.market, s.side, s.updated_at, s.consumed_order_id, o.status AS order_status,
          o.blocked_by AS order_blocked_by
     FROM signals s LEFT JOIN orders o ON o.id = s.consumed_order_id
    WHERE s.status = 'executing' AND ${ACTIVE_EXECUTING_ORDER_SQL}
    ORDER BY s.updated_at DESC LIMIT 20`;
export const BLOCKED_POST_MARKET_SQL =
  `SELECT id, symbol, market, indicators, created_at FROM signals
    WHERE market = ? AND scenario_source = 'post-market' AND status = 'skipped' AND created_at >= ?
    ORDER BY created_at DESC LIMIT 2`;
export const OPEN_ORDERS_SQL =
  `SELECT o.id, o.symbol, o.market, o.side, o.quantity,
          (SELECT SUM(e.quantity) FROM executions e WHERE e.order_id = o.id) AS filled
     FROM orders o
    WHERE o.market = ? AND o.status IN ('accepted', 'partially_filled') AND o.created_at >= ? AND o.created_at < ?
    ORDER BY o.created_at DESC LIMIT 50`;

const MARKETS: readonly Market[] = ['domestic', 'overseas'];

/** `indicators.ai.confidence` — 화면(`scenario-card-display.ts confidenceOf`)과 같은 키·같은 범위(0~100). */
export function confidenceFromIndicators(raw: unknown): number | null {
  const ai = parseJsonObject(parseJsonObject(raw)?.ai ?? null);
  const c = ai?.confidence;
  return typeof c === 'number' && Number.isFinite(c) && c >= 0 && c <= 100 ? c : null;
}

/** `indicators.gate` — 검증 관문 감사 행이면 `validation_gate`. 문자열이 아니면 null (T-130 D7-A: `skipped` 의 두 경우를 가른다). */
export function gateFromIndicators(raw: unknown): string | null {
  const g = parseJsonObject(raw)?.gate;
  return typeof g === 'string' && g ? g : null;
}

async function readCounts(r: OpsReader): Promise<Extract<TradeDTO['counts'], { state: 'ok' }>['data']> {
  const blocked = async (m: Market) => {
    const day = currentSessionDay(m, r.nowMs);
    const rows = await r.rows<{ n: unknown }>(PRE_ORDER_BLOCKED_SQL, [m, kstSql(day.startMs), kstSql(day.endMs), VALIDATION_GATE_INDICATOR, EXIT_STRATEGY_ID]);
    return count(rows[0]?.n);
  };
  const [approval, detected, watch, bd, bo] = await Promise.all([countApproval(r), countDetected(r), countWatch(r), blocked('domestic'), blocked('overseas')]);
  return {
    approval: approval.approval,
    detected,
    watching: { domestic: watch.domestic.watching, overseas: watch.overseas.watching },
    executing: watch.domestic.executing + watch.overseas.executing,
    nextSession: watch.domestic.nextSession + watch.overseas.nextSession,
    preOrderBlockedToday: bd + bo,
  };
}

async function readExecuting(r: OpsReader): Promise<Extract<TradeDTO['executing'], { state: 'ok' }>['data']> {
  const rows = await r.rows<Record<string, unknown>>(EXECUTING_SQL);
  return rows.map((x) => ({
    id: Number(x.id), symbol: String(x.symbol), market: String(x.market) === 'overseas' ? 'overseas' as const : 'domestic' as const,
    side: String(x.side) === 'sell' ? 'sell' as const : 'buy' as const, since: isoOrNull(x.updated_at),
    consumedOrderId: num(x.consumed_order_id),
    orderStatus: typeof x.order_status === 'string' ? x.order_status : null,
    orderBlockedBy: typeof x.order_blocked_by === 'string' ? x.order_blocked_by : null,
  }));
}

async function readBlockedPostMarket(r: OpsReader): Promise<Extract<TradeDTO['blockedPostMarket'], { state: 'ok' }>['data']> {
  const per = await Promise.all(MARKETS.map(async (m) => {
    const spec = specFor(POST_MARKET_JOB[m]);
    if (!spec?.slotTime) return [];
    const since = lastDailySlotMs(spec.slotTime, r.nowMs, 0);
    const rows = await r.rows<Record<string, unknown>>(BLOCKED_POST_MARKET_SQL, [m, kstSql(since)]);
    return rows.map((x) => {
      const ms = toMs(x.created_at);
      return ms == null ? null : {
        id: Number(x.id), symbol: String(x.symbol), market: m, confidence: confidenceFromIndicators(x.indicators),
        gate: gateFromIndicators(x.indicators),
        createdAt: kstIso(ms), session: sessionRef(m, m === 'domestic' ? kstDateOf(ms) : localDateOf('overseas', ms)),
      };
    }).filter((v): v is NonNullable<typeof v> => v != null);
  }));
  return per.flat().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 2);
}

async function readOpenOrders(r: OpsReader): Promise<Extract<TradeDTO['openOrders'], { state: 'ok' }>['data']> {
  const per = await Promise.all(MARKETS.map(async (m) => {
    const day = currentSessionDay(m, r.nowMs);
    const rows = await r.rows<Record<string, unknown>>(OPEN_ORDERS_SQL, [m, kstSql(day.startMs), kstSql(day.endMs)]);
    return rows.map((x) => ({
      id: Number(x.id), symbol: String(x.symbol), market: m, side: String(x.side) === 'sell' ? 'sell' as const : 'buy' as const,
      qty: num(x.quantity) ?? 0, filled: num(x.filled) ?? 0,
    }));
  }));
  return per.flat();
}

export async function buildTrade(nowMs: number = Date.now(), reader: OpsReader = createReader({ nowMs })): Promise<TradeDTO> {
  const r = reader;
  const closed = await loadClosedDays(r);
  const [counts, executing, blockedPostMarket, holdings, openOrders] = await Promise.all([
    section('trade.counts', () => readCounts(r)),
    section('trade.executing', () => readExecuting(r)),
    section('trade.blockedPostMarket', () => readBlockedPostMarket(r)),
    section('trade.holdings', () => readHoldings(r, closed)),
    section('trade.openOrders', () => readOpenOrders(r)),
  ]);
  return { generatedAt: kstIso(nowMs), counts, executing, blockedPostMarket, holdings, openOrders };
}
