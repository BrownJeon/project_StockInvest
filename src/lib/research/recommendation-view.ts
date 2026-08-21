/**
 * 리서치 화면(ResearchTab)에 실을 매수/매도 추천 조립 — T-033.
 *
 * 저장된 리서치 결과 + `position_state`(보유 여부·진입가·진입시각) + 현재가를 합쳐
 * 심볼별 추천 1건을 만든다. 조회 라우트 2개(`/api/research/tracked`,
 * `/api/research/tracked/[symbol]/run`)가 **같은 답**을 내도록 로직을 여기 하나로 모은다.
 *
 * ## 🔴 안전 경계
 *
 * - `position_state` 는 **SELECT 만** 한다. 이 파일은 어떤 테이블도 쓰지 않는다.
 * - 결과는 화면 표시용이다. `createSignal()`·`submitOrder()`·`src/lib/strategy/` 로
 *   흘러가지 않으며, 그렇게 연결하려면 T-033 의 전제를 다시 논의해야 한다.
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
  targetProgressPct,
  type BuyRecommendation,
  type SellAssessment,
} from './pattern/recommendation';
import type { PrecursorAnalysis, ResearchMarket } from './types';

/** 추천을 만들기 위해 필요한 최소 입력 — `ResearchReport` 와 `StoredResearchResult` 둘 다 만족한다. */
export interface RecommendationInput {
  symbol: string;
  market: ResearchMarket;
  dataRangeTo: string | null;
  todayActiveRuleIds: string[] | null;
  precursorAnalysis: PrecursorAnalysis | null;
  avgRallyPct: number | null;
  avgDaysToRally: number | null;
  eventCount: number;
  error?: string | null;
}

export interface HoldingContext {
  entryPriceKRW: number;
  qty: number;
  /** 진입 후 경과 **달력일** */
  daysSinceEntry: number | null;
  nowPriceKRW: number | null;
  /** 목표(과거 평균 상승폭) 대비 진행률(%) — 표시 전용 */
  targetProgressPct: number | null;
}

export interface ResearchRecommendationView {
  /** 판단의 기준이 된 **종가 기준일**. 실시간이 아님을 화면에서 반드시 함께 보여준다. */
  asOfDate: string | null;
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

  // 시세 조회는 **보유중인 추적 종목**으로만 좁힌다 — 미보유 종목은 매도 판단이 없어 현재가가
  // 필요 없고, 화면 로딩마다 증권사 API 를 필요 이상으로 두드릴 이유도 없다.
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
    const buy = evaluateBuySignal(input.todayActiveRuleIds, input.precursorAnalysis?.rules ?? null);
    const pos = positions.get(input.symbol) ?? null;

    let sell: SellAssessment | null = null;
    let holding: HoldingContext | null = null;

    if (pos) {
      const nowPriceKRW = prices.get(input.symbol) ?? null;
      const daysSinceEntry = pos.firstSeenAt && !Number.isNaN(pos.firstSeenAt.getTime())
        ? Math.max(0, Math.floor((now.getTime() - pos.firstSeenAt.getTime()) / 86_400_000))
        : null;
      sell = evaluateSellSignal(
        pos.entryPriceKRW, nowPriceKRW, daysSinceEntry,
        input.avgRallyPct, input.avgDaysToRally, input.eventCount,
      );
      holding = {
        entryPriceKRW: pos.entryPriceKRW,
        qty: pos.qty,
        daysSinceEntry,
        nowPriceKRW,
        targetProgressPct: targetProgressPct(sell.gainPct, input.avgRallyPct),
      };
    }

    out.set(input.symbol, { asOfDate: input.dataRangeTo, buy, sell, holding });
  }

  return out;
}
