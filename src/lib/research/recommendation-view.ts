/**
 * 리서치 화면(ResearchTab)에 실을 매수/매도 추천 조립 — T-033, 목표가 재설계 T-034.
 *
 * 저장된 리서치 결과(차트 목표가 포함) + `position_state`(보유 여부·진입가·진입시각) + 현재가를
 * 합쳐 심볼별 추천 1건을 만든다. 조회 라우트 2개(`/api/research/tracked`,
 * `/api/research/tracked/[symbol]/run`)가 **같은 답**을 내도록 로직을 여기 하나로 모은다.
 *
 * ## 🔴 안전 경계
 *
 * - `position_state` 는 **SELECT 만** 한다. 이 파일은 어떤 테이블도 쓰지 않는다.
 * - 결과는 화면 표시용이다. `createSignal()`·`submitOrder()`·`src/lib/strategy/` 로
 *   흘러가지 않으며, 그렇게 연결하려면 T-033 의 전제를 다시 논의해야 한다.
 *
 * ## 🔴 통화 경계 (T-034)
 *
 * `PriceTargets`(목표가)는 **캔들 통화**(국내 KRW / 해외 USD)이고,
 * `HoldingContext.entryPriceKRW`·`nowPriceKRW` 는 **항상 KRW** 다.
 * 이 파일에서 두 계열이 만나는 연산은 **하나도 없다** — 목표가는 그대로 전달만 하고,
 * 손익률(`gainPct`)은 KRW 끼리만 계산한다. 새 계산을 추가할 때 이 경계를 먼저 확인할 것.
 *
 * ## 현재가 조회를 주입받는 이유
 *
 * 현재가 조회(`fetchCurrentPricesKRW`)는 `src/lib/reports/trade-report.ts` 에 있고 그 파일은
 * 이미 `src/lib/research/*` 를 import 한다. 여기서 되받아 import 하면 디렉토리 사이에 순환이
 * 생긴다. 그래서 **함수로 주입**받는다 — 라우트(앱 계층)가 두 모듈을 각각 알고 연결한다.
 */
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import {
  evaluateBuySignal,
  evaluateSellSignal,
  type BuyRecommendation,
  type SellAssessment,
} from './pattern/recommendation';
import type { PrecursorAnalysis, PriceTargets, ResearchMarket } from './types';

/** 추천을 만들기 위해 필요한 최소 입력 — `ResearchReport` 와 `StoredResearchResult` 둘 다 만족한다. */
export interface RecommendationInput {
  symbol: string;
  market: ResearchMarket;
  dataRangeTo: string | null;
  todayActiveRuleIds: string[] | null;
  precursorAnalysis: PrecursorAnalysis | null;
  /** T-034 — 차트 기반 목표가(리서치 cron 이 계산해 저장한 값) */
  priceTargets: PriceTargets | null;
  error?: string | null;
}

export interface HoldingContext {
  entryPriceKRW: number;
  qty: number;
  /** 진입 후 경과 **달력일** */
  daysSinceEntry: number | null;
  nowPriceKRW: number | null;
}

export interface ResearchRecommendationView {
  /** 판단의 기준이 된 **종가 기준일**. 실시간이 아님을 화면에서 반드시 함께 보여준다. */
  asOfDate: string | null;
  /**
   * 차트 목표가 — 매수/매도 공통. **사용자 포지션과 무관**하며 보유 여부에 따라 달라지지 않는다.
   * 통화는 `targets.currency` 에 들어 있다(해외 종목은 USD).
   */
  targets: PriceTargets | null;
  buy: BuyRecommendation;
  /** 보유중일 때만. 미보유 종목은 매도 판단 자체가 성립하지 않는다 */
  sell: SellAssessment | null;
  holding: HoldingContext | null;
}

interface PositionRow {
  symbol: string;
  market: string;
  entryPriceKRW: number;
  qty: number;
  firstSeenAt: Date | null;
}

/** 보유 포지션 조회 — SELECT 전용. 실패해도 던지지 않는다(추천 전체가 사라지지 않게). */
async function fetchPositions(symbols: string[]): Promise<Map<string, PositionRow>> {
  const out = new Map<string, PositionRow>();
  const unique = [...new Set(symbols)];
  if (unique.length === 0) return out;
  try {
    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT symbol, market, entry_price, qty, first_seen_at
         FROM position_state
        WHERE symbol IN (?)`,
      [unique],
    );
    for (const r of rows) {
      out.set(String(r.symbol), {
        symbol:        String(r.symbol),
        market:        String(r.market ?? ''),
        entryPriceKRW: Number(r.entry_price ?? 0),
        qty:           Number(r.qty ?? 0),
        firstSeenAt:   r.first_seen_at ? new Date(r.first_seen_at as string | Date) : null,
      });
    }
  } catch (e) {
    console.warn(`[research/recommendation-view] position_state 조회 실패: ${e instanceof Error ? e.message : String(e)}`);
  }
  return out;
}

export type PriceFetcher = (targets: { symbol: string; market: string }[]) => Promise<Map<string, number>>;

export async function buildResearchRecommendations(
  inputs: RecommendationInput[],
  fetchPrices: PriceFetcher,
  now: Date = new Date(),
): Promise<Map<string, ResearchRecommendationView>> {
  const out = new Map<string, ResearchRecommendationView>();
  if (inputs.length === 0) return out;

  const positions = await fetchPositions(inputs.map((i) => i.symbol));

  // T-034 — 시세 조회는 **보유 종목만**. 목표가가 차트에서 나오므로 미보유 종목에는 현재가가
  // 필요 없어졌다(T-033 때는 "매수 고려" 종목의 목표가 계산에 현재가가 필요해 함께 조회했다).
  // 보유 종목의 현재가는 오직 사용자 손익(gainPct) 표시에만 쓴다 — 판정에는 안 쓴다.
  const priceTargets = inputs
    .filter((i) => positions.has(i.symbol))
    .map((i) => ({ symbol: i.symbol, market: positions.get(i.symbol)?.market || i.market }));
  const prices = priceTargets.length > 0
    ? await fetchPrices(priceTargets).catch((e) => {
        console.warn(`[research/recommendation-view] 현재가 조회 실패: ${e instanceof Error ? e.message : String(e)}`);
        return new Map<string, number>();
      })
    : new Map<string, number>();

  for (const input of inputs) {
    const targets = input.priceTargets ?? null;
    const buy = evaluateBuySignal(input.todayActiveRuleIds, input.precursorAnalysis?.rules ?? null, targets);
    const pos = positions.get(input.symbol) ?? null;

    let sell: SellAssessment | null = null;
    let holding: HoldingContext | null = null;

    if (pos) {
      const nowPriceKRW = prices.get(input.symbol) ?? null;
      const daysSinceEntry = pos.firstSeenAt && !Number.isNaN(pos.firstSeenAt.getTime())
        ? Math.max(0, Math.floor((now.getTime() - pos.firstSeenAt.getTime()) / 86_400_000))
        : null;
      // 🔴 진입가·현재가·보유일수는 전부 **표시 전용**으로 두 번째 인자에만 넘어간다.
      //    매도 목표가·판정은 첫 인자(차트)에서만 나온다 — 기간초과 판정은 T-034에서 폐기됐다.
      sell = evaluateSellSignal(targets, {
        daysSinceEntry,
        entryPriceKRW: pos.entryPriceKRW,
        currentPriceKRW: nowPriceKRW,
      });
      holding = {
        entryPriceKRW: pos.entryPriceKRW,
        qty: pos.qty,
        daysSinceEntry,
        nowPriceKRW,
      };
    }

    out.set(input.symbol, { asOfDate: input.dataRangeTo, targets, buy, sell, holding });
  }

  return out;
}
