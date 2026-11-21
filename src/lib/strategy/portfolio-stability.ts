/**
 * 포트폴리오 안정성 가드 — 매수 시그널이 사용자의 투자 성향(코어 비율·종목당 한도)을
 * 위반하는지 사전 검사한다. AI 호출 전에 거절 가능한 패턴을 차단해 비용·노이즈 절감.
 *
 * 가드 항목 (모두 BUY에만 적용 — SELL은 항상 통과):
 *  1) `stableCoreRatioMin` — 매수 후 포트폴리오 KRW 가중 비율 중 코어(KOSPI200 편입 — T-181) 종목 비중이
 *     사용자 임계 미만으로 떨어지면 거절. 안정 모드(0.70)는 위성·투기 종목 비중 30% 초과 차단.
 *     등급은 `index-tier-store.ts` 보존소에서 최신성 한도(24시간) 안의 값만 쓴다(T-184).
 *  2) `maxPositionsPerSymbol` — 같은 심볼로 최근 24h 내 createSignal로 누적 발화된 BUY 시그널 수
 *     (status=executed/accepted/auto_submitted) ≥ max면 거절. 분할 매수 제한.
 *
 * 미적용 케이스:
 *  - 보유 KRW value 데이터가 없거나(평균단가 0) 보유 합이 0 — 가드 통과(부트스트랩, 아래 calcCoreRatio).
 *    ⚠ 등급 정보가 없거나 낡은 종목은 통과가 아니라 'unknown'(코어로 세지 않음 — 차단 방향)이다.
 *  - SELL 시그널 — 청산은 안정성 가드 무관.
 *  - 해외 시장 (market='overseas') — KOSPI tier 분류 미적용, volume-top universe만 사용.
 *
 * 동작 위치: engine.applyFilters()에서 prefilter·dedup 다음, AI 호출 전.
 */
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import type { Market } from '@/lib/exchanges/kis-symbols';
import type { StyleConfig } from './style';
import { loadIndexTierSnapshot, resolveHeldTier, type HeldTier } from './index-tier-store';

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
  tier: HeldTier;
}

/**
 * 보유 종목별 KRW value + tier 조합. heldAmounts는 engine에서 받은 (symbol → qty/avgPrice) 맵.
 * avgPrice 없으면 0으로 처리하여 비중 계산에서 제외.
 *
 * T-184 — 등급은 `symbol_universe`(전략 점수 선별을 통과한 종목만 저장, 48시간 보존)가 아니라 갱신 때 시세를 받은
 * 전 종목의 등급 보존소에서 읽는다. 예전 `lookupTier` 는 행의 나이를 보지 않아, 선별에서 빠진 보유 종목이 강등돼도
 * 과거 core 로 통과하거나(최대 48시간) 행이 지워진 뒤 unknown 으로 막혔다.
 */
function buildHoldingValues(
  heldAmounts: Map<string, { qty: number; avgPrice?: number }>,
  tierOf: (symbol: string) => HeldTier,
): HoldingValue[] {
  const result: HoldingValue[] = [];
  for (const [symbol, h] of heldAmounts) {
    const price = h.avgPrice ?? 0;
    if (price <= 0 || h.qty <= 0) continue;
    result.push({ symbol, qty: h.qty, value: h.qty * price, tier: tierOf(symbol) });
  }
  return result;
}

/**
 * 매수 후 가설 포트폴리오의 코어 비율 계산.
 * coreValue / totalValue.
 *
 * Bootstrap 처리: 기존 보유 합(heldSum)이 0이면 (보유 없음 또는 KIS avgPrice 미수신 등 데이터 누락)
 *   → 신규 매수 자유 통과 (return 1).
 *   이 처리가 없으면 빈 포트폴리오 + speculative 신규 매수가 영구히 차단되는 데드락 발생.
 *   doc(파일 상단 미적용 케이스 ②)와 일치.
 */
function calcCoreRatio(holdings: HoldingValue[], buySymbol: string, buyValue: number, buyTier: HoldingValue['tier']): number {
  let coreSum = 0;
  let heldSum = 0;
  for (const h of holdings) {
    // 동일 심볼 추가 매수 시 분리하지 않고 신규 발화로만 카운트 (avgPrice 변동 단순화 위해 기존 value 그대로)
    if (h.tier === 'core') coreSum += h.value;
    heldSum += h.value;
  }
  // Bootstrap / 데이터 누락 — 기존 보유 합이 0이면 신규 매수 자유 통과
  if (heldSum <= 0) return 1;
  if (buyTier === 'core') coreSum += buyValue;
  const totalSum = heldSum + buyValue;
  return coreSum / totalSum;
}

/**
 * 같은 심볼로 최근 24h 내 실제 체결/진행 중인 buy 주문 카운트.
 * signals.auto_submitted 기준이면 dry_run·blocked 주문도 포함되어 실거래 없이
 * 한도에 도달하는 버그 발생 → orders 테이블 실주문 기준으로 변경.
 */
async function countRecentBuysForSymbol(symbol: string): Promise<number> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM orders
     WHERE symbol = ? AND side = 'buy'
       AND status IN ('filled','accepted','partially_filled')
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

  // 2) stableCoreRatioMin — 매수 후 코어(KOSPI200 편입) 비율 가설 계산
  if (style.stableCoreRatioMin > 0) {
    // 보존소는 검사 1회에 한 번만 읽고, 같은 시각 기준으로 보유·매수 종목 등급을 함께 정한다.
    const snapshot = await loadIndexTierSnapshot();
    const nowMs = Date.now();
    const tierOf = (s: string): HeldTier => resolveHeldTier(snapshot, s, nowMs);
    const holdings = buildHoldingValues(heldAmounts, tierOf);
    const buyTier = tierOf(symbol);
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
