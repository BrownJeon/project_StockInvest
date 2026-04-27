/**
 * 포트폴리오 안정성 가드 — 매수 시그널이 사용자의 투자 성향(코어 비율·종목당 한도)을
 * 위반하는지 사전 검사한다. AI 호출 전에 거절 가능한 패턴을 차단해 비용·노이즈 절감.
 *
 * 가드 항목 (모두 BUY에만 적용 — SELL은 항상 통과):
 *  1) `stableCoreRatioMin` — 매수 후 포트폴리오 KRW 가중 비율 중 KOSPI 100 코어 종목 비중이
 *     사용자 임계 미만으로 떨어지면 거절. 안정 모드(0.70)는 위성·투기 종목 비중 30% 초과 차단.
 *  2) `maxPositionsPerSymbol` — 같은 심볼로 최근 24h 내 createSignal로 누적 발화된 BUY 시그널 수
 *     (status=executed/accepted/auto_submitted) ≥ max면 거절. 분할 매수 제한.
 *
 * 미적용 케이스:
 *  - 보유 KRW value 데이터가 없거나(종목 가격 0) tier 정보 부재 — 가드 통과 (보수적 fallback).
 *  - SELL 시그널 — 청산은 안정성 가드 무관.
 *  - 해외 시장 (market='overseas') — KOSPI tier 분류 미적용, volume-top universe만 사용.
 *
 * 동작 위치: engine.applyFilters()에서 prefilter·dedup 다음, AI 호출 전.
 */
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import type { Market } from '@/lib/exchanges/kis-symbols';
import type { StyleConfig } from './style';

export type GuardReason =
  | 'core_ratio_below_min'
  | 'max_positions_exceeded';

export interface PortfolioGuardDecision {
  verdict: 'pass' | 'skip';
  reason?: GuardReason;
  detail?: string;
}

export interface HoldingValue {
  symbol: string;
  qty: number;
  /** approximate KRW value: qty × (avgPrice ?? lastPrice) */
  value: number;
  tier: 'core' | 'satellite' | 'speculative' | 'unknown';
}

/** 심볼별 universe.tier 조회 (최신 refreshed_at 기준). symbol_universe에 없으면 'unknown'. */
async function lookupTier(symbol: string): Promise<'core' | 'satellite' | 'speculative' | 'unknown'> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT tier FROM symbol_universe WHERE symbol = ?
     ORDER BY refreshed_at DESC LIMIT 1`,
    [symbol],
  );
  if (rows.length === 0) return 'unknown';
  const t = rows[0].tier as string;
  if (t === 'core' || t === 'satellite' || t === 'speculative') return t;
  return 'unknown';
}

/**
 * 보유 종목별 KRW value + tier 조합. heldAmounts는 engine에서 받은 (symbol → qty/avgPrice) 맵.
 * avgPrice 없으면 0으로 처리하여 비중 계산에서 제외.
 */
async function buildHoldingValues(
  heldAmounts: Map<string, { qty: number; avgPrice?: number }>,
): Promise<HoldingValue[]> {
  const result: HoldingValue[] = [];
  for (const [symbol, h] of heldAmounts) {
    const price = h.avgPrice ?? 0;
    if (price <= 0 || h.qty <= 0) continue;
    const tier = await lookupTier(symbol);
    result.push({ symbol, qty: h.qty, value: h.qty * price, tier });
  }
  return result;
}

/**
 * 매수 후 가설 포트폴리오의 코어 비율 계산.
 * coreValue / totalValue. holdings 비어있고 신규 buy만 있을 때는 신규 종목 tier로 계산.
 */
function calcCoreRatio(holdings: HoldingValue[], buySymbol: string, buyValue: number, buyTier: HoldingValue['tier']): number {
  let coreSum = 0;
  let totalSum = 0;
  for (const h of holdings) {
    // 동일 심볼 추가 매수 시 분리하지 않고 신규 발화로만 카운트 (avgPrice 변동 단순화 위해 기존 value 그대로)
    if (h.tier === 'core') coreSum += h.value;
    totalSum += h.value;
  }
  if (buyTier === 'core') coreSum += buyValue;
  totalSum += buyValue;
  if (totalSum <= 0) return 1; // empty portfolio + speculative buy → 분모 0 회피, pass
  return coreSum / totalSum;
}

/** 같은 심볼로 최근 24h 내 EXECUTED/ACCEPTED/AUTO_SUBMITTED buy 시그널 카운트. */
async function countRecentBuysForSymbol(symbol: string): Promise<number> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM signals
     WHERE symbol = ? AND side = 'buy'
       AND status IN ('executed','accepted','auto_submitted','approved')
       AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
    [symbol],
  );
  return Number(rows[0]?.n ?? 0);
}

export interface CheckPortfolioStabilityArgs {
  symbol: string;
  side: 'buy' | 'sell';
  amountKRW: number;
  market: Market;
  style: StyleConfig;
  heldAmounts: Map<string, { qty: number; avgPrice?: number }>;
}

/**
 * 매수 시그널의 안정성 가드 검사. AI 호출 전 prefilter 다음 단계로 사용.
 *
 * @returns
 *  - `pass`: 모든 가드 통과 또는 적용 불가(SELL/해외/데이터 부재 등)
 *  - `skip`: stableCoreRatioMin 또는 maxPositionsPerSymbol 위반
 */
export async function checkPortfolioStability(
  args: CheckPortfolioStabilityArgs,
): Promise<PortfolioGuardDecision> {
  const { symbol, side, amountKRW, market, style, heldAmounts } = args;

  if (side === 'sell') return { verdict: 'pass' };
  if (market !== 'domestic') return { verdict: 'pass' };

  // 1) maxPositionsPerSymbol — 24h 내 동일 심볼 누적 buy 시그널 수
  const recentBuys = await countRecentBuysForSymbol(symbol);
  if (recentBuys >= style.maxPositionsPerSymbol) {
    return {
      verdict: 'skip',
      reason: 'max_positions_exceeded',
      detail: `24h 내 ${symbol} buy ${recentBuys}건 ≥ 한도 ${style.maxPositionsPerSymbol}`,
    };
  }

  // 2) stableCoreRatioMin — 매수 후 코어(KOSPI 100) 비율 가설 계산
  if (style.stableCoreRatioMin > 0) {
    const holdings = await buildHoldingValues(heldAmounts);
    const buyTier = await lookupTier(symbol);
    const projectedRatio = calcCoreRatio(holdings, symbol, amountKRW, buyTier);
    if (projectedRatio < style.stableCoreRatioMin) {
      return {
        verdict: 'skip',
        reason: 'core_ratio_below_min',
        detail: `매수 후 core 비율 ${(projectedRatio * 100).toFixed(1)}% < 임계 ${(style.stableCoreRatioMin * 100).toFixed(0)}% (${symbol} tier=${buyTier})`,
      };
    }
  }

  return { verdict: 'pass' };
}
