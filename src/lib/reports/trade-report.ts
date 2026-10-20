import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { getKisTickers, getKisOverseasTickers } from '@/lib/exchanges/kis';
import { getMarketFromSymbol } from '@/lib/exchanges/kis-symbols';
import { PRECURSOR_NOTE } from '@/lib/research/pattern/precursor-analysis';
import {
  evaluateBuySignal,
  evaluateSellSignal,
  type BuyRecommendation,
  type SellAssessment,
} from '@/lib/research/pattern/recommendation';
import {
  currencyForMarket,
  displayableBuyZone,
  displayableSellTarget,
  formatTargetPrice,
  unreachableReasonKo,
} from '@/lib/research/pattern/price-targets';
import { getLatestResearchResults } from '@/lib/research/storage';
import type { PriceTargets, ResearchMarket } from '@/lib/research/types';
import {
  isFxConverted,
  isFxFallback,
  toDisplayAmount,
  type DisplayAmount,
  type SymbolQuote,
} from '@/lib/display-amount';

export interface BuyCandidate {
  symbol: string;
  rsi: number | null;
  aiConf: number | null;
  evPct: number | null;
  status: 'watchlist' | 'ai_pass' | 'ai_rejected' | 'blocked';
  skipReason: string | null;
}

export interface HoldingStatus {
  symbol: string;
  /**
   * 🔴 **"고점대비"다.** `(peak_price - entry_price) / entry_price * 100` —
   * 진입가 대비 **보유 중 관측된 최고가** 기준이며 현재가 대비도, 리포트 주기 대비도 아니다.
   * 이름이 그렇게 안 읽혀서 과거에 "익절 임박" 오판을 만들었다(T-033). 그 판정에는 더 이상
   * 쓰지 않으며, 표시할 때는 반드시 "고점대비"라는 라벨을 붙인다.
   */
  profitPct: number;
  entryKRW: number;
  currentKRW: number;
  qty: number;
  /** 매입금액 = 진입단가 × 수량 (KRW) */
  investedKRW: number;
  /** 리포트 구간 시작 시점의 KRW 환산 단가. 스냅샷이 없으면 null */
  periodStartKRW: number | null;
  /** 현재 KRW 환산 단가. 시세 조회 실패 시 null */
  nowPriceKRW: number | null;
  /** 리포트 주기 동안의 단가 변동률(%) — "고점대비"와 다른 값이다 */
  periodChangePct: number | null;
  /** 리서치(사후 관찰) 기준 매도 고려 판단. 자동매매와 무관한 참고 정보 */
  sellSignal: SellAssessment | null;
  /**
   * T-034 — 차트 기반 목표가. **진입가와 무관**하며 통화는 `currency` 필드에 들어 있다
   * (해외 종목은 USD — 위 `entryKRW`/`nowPriceKRW` 와 섞어 계산하지 말 것).
   */
  priceTargets: PriceTargets | null;
  /**
   * T-035 — **표시 전용** 금액. 해외 종목이면 같은 시점 시세 쌍의 환율로 환산한 USD 다.
   * 🔴 위 KRW 필드들이 여전히 계산의 원본이고, 이 값은 화면에 찍는 용도로만 쓴다.
   */
  display: HoldingDisplay;
}

/**
 * 보유종목 금액의 표시용 통화·값 (T-035).
 * 환산은 `src/lib/display-amount.ts` 한 곳에서만 일어난다 — 여기서 다시 계산하지 않는다.
 *
 * 🔴 현재 리포트가 **종목 단위 금액**으로 찍는 것은 투자금 한 줄뿐이다. 진입가·현재가는
 *    금액이 아니라 "진입가 대비 -17.8%" 같은 **비율**로만 나오므로 환산 대상이 아니다
 *    (비율은 KRW 끼리 계산돼 통화와 무관하다). 새 금액 줄을 추가할 때 이 필드를 늘린다.
 */
export interface HoldingDisplay {
  /** 투자금 = 진입단가 × 수량 */
  invested: DisplayAmount;
}

export interface SellPnl {
  symbol: string;
  exitKind: string;
  pnlPct: number;
  pnlKRW: number;     // (current_price - entry_price) × qty
  sellAmountKRW: number;
}

export interface SignalCandidates {
  buyWatchlist: BuyCandidate[];
  holdings: HoldingStatus[];
  sellPnl: SellPnl[];
}

/** 조회가 통째로 실패했을 때 쓰는 빈 값 — 호출부마다 리터럴을 다시 쓰지 않게 상수로 둔다. */
export const EMPTY_CANDIDATES: SignalCandidates = { buyWatchlist: [], holdings: [], sellPnl: [] };

/**
 * 리포트에 싣는 리서치 요약 1건 — T-033.
 * `asOfDate` 는 **종가 기준일**이다. 국내 리서치는 16:00(전일 종가), 해외는 07:00(당일 종가)에만
 * 갱신되므로 실시간이 아니다. 이 값을 추천 옆에 항상 같이 노출한다.
 */
export interface ResearchDigestItem {
  symbol: string;
  market: 'domestic' | 'overseas';
  asOfDate: string | null;
  buy: BuyRecommendation;
  /** T-034 — 차트 기반 매수 희망가. 통화는 `targets.currency`(해외는 USD) */
  targets: PriceTargets | null;
}

export interface ResearchDigest {
  /** 리서치 추적중(`research_enabled=1`) 종목 수 */
  trackedCount: number;
  /** 그중 "매수 고려"로 판정된 종목 수 */
  activeCount: number;
  /** 리포트에 실을 항목 — 매수 고려 + (오늘 규칙은 걸렸으나 표본부족)인 것만 */
  items: ResearchDigestItem[];
  /** 과신 방지 고정 문구 */
  note: string;
}

export const EMPTY_RESEARCH_DIGEST: ResearchDigest = {
  trackedCount: 0,
  activeCount: 0,
  items: [],
  note: PRECURSOR_NOTE,
};

/**
 * 정기 거래 리포트 빌더 — 분석 기간(rangeStart~rangeEnd) 의 거래·잔액 변동을 집계해
 * Slack/Telegram 발송용 mrkdwn 메시지를 생성한다.
 *
 * P&L 두 가지 동시 산출:
 *  - headerPnl  : 단순 합산 (sells_krw - buys_krw). 미체결 매수·페어 미완성 영향 받음.
 *  - lifoPnl    : LIFO 페어링 실현 손익. 분석 기간 시작 시점 보유 stack 을 build 한 뒤
 *                 기간 내 sell 발생 시 stack top 부터 차감해 cost basis 산출.
 */

export interface OrderRow {
  symbol: string;
  side: 'buy' | 'sell';
  price: number | null;        // executions.price 또는 orders.price
  quantity: number;            // executions.quantity 또는 orders.quantity
  amount_krw: number;
  fee: number;                 // executions.fee 합산 (없으면 0)
  ts: number;                  // executed_at 또는 created_at (epoch ms)
}

export interface SymbolPnl {
  symbol: string;
  realizedKRW: number;
  cycles: number;              // min(buys, sells) — 회전매매 판정용
  sellCount: number;           // 분석 기간 내 매도 건수 — UI 표기용
}

export interface TradeReport {
  rangeStart: Date;
  rangeEnd: Date;
  buys: number;
  sells: number;
  buysAmountKRW: number;
  sellsAmountKRW: number;
  headerPnlKRW: number;
  lifoPnlKRW: number;
  perSymbol: SymbolPnl[];
  churnSymbols: string[];      // cycles ≥ 2 종목
}

const FEE_THRESHOLD_CYCLES = 2;

export type Market = 'domestic' | 'overseas' | 'all';

/**
 * 시간 ASC OrderRow 들을 받아 LIFO 매칭으로 종목별 실현 손익 산출.
 * `rangeStart` 이전 row 는 stack 만 빌드 (cost basis 준비).
 * `rangeStart` 이후 row 는 PnL 누적.
 */
export function computeLifoPnl(
  rows: OrderRow[],
  rangeStart: Date,
): { totalKRW: number; perSymbol: Map<string, number> } {
  const stacks = new Map<string, Array<{ price: number; qty: number }>>();
  const perSymbol = new Map<string, number>();
  const startMs = rangeStart.getTime();
  let total = 0;

  for (const r of rows) {
    const stack = stacks.get(r.symbol) ?? [];
    if (r.side === 'buy') {
      const price = r.price ?? (r.quantity > 0 ? r.amount_krw / r.quantity : 0);
      if (Number.isFinite(price) && price > 0 && r.quantity > 0) {
        stack.push({ price, qty: r.quantity });
      }
      stacks.set(r.symbol, stack);
    } else {
      // sell — LIFO 차감하며 cost basis 계산
      let toRemove = r.quantity;
      let costBasis = 0;
      while (toRemove > 1e-12 && stack.length > 0) {
        const top = stack[stack.length - 1];
        if (top.qty <= toRemove + 1e-12) {
          costBasis += top.price * top.qty;
          toRemove -= top.qty;
          stack.pop();
        } else {
          costBasis += top.price * toRemove;
          top.qty -= toRemove;
          toRemove = 0;
        }
      }
      stacks.set(r.symbol, stack);

      // 분석 기간 내 sell 만 PnL 에 합산
      if (r.ts >= startMs) {
        const matchedQty = r.quantity - toRemove;
        const sellRevenue = matchedQty > 0 && r.price != null
          ? r.price * matchedQty
          : r.amount_krw;  // price 없으면 amount_krw fallback
        const pnl = sellRevenue - costBasis - r.fee;
        total += pnl;
        perSymbol.set(r.symbol, (perSymbol.get(r.symbol) ?? 0) + pnl);
      }
    }
  }
  return { totalKRW: total, perSymbol };
}

interface FetchOptions {
  rangeStart: Date;
  rangeEnd: Date;
  market?: Market;             // SI 시장 분리, TI 는 'all'
  prefetchDays?: number;       // rangeStart 이전 stack 빌드용 fetch 깊이 (기본 30일)
}

/**
 * orders + executions 에서 시간 ASC OrderRow 들을 fetch.
 * `prefetchDays` 만큼 rangeStart 이전 데이터도 포함해 LIFO stack 정확성 확보.
 *
 * ## 🔴 T-019 — `amount_krw` 는 **체결 비율만큼** 축소한다
 *
 * `quantity` 는 원래부터 `COALESCE(e.quantity, o.quantity)` 라 체결 기록이 있으면 참값을
 * 집는다. 그런데 `amount_krw` 는 `orders.amount_krw`(=**주문 금액**)를 그대로 썼다.
 * 부분체결로 종결된 주문에서는 이 둘이 서로 모순된다 — 수량은 3주인데 금액은 10주치다.
 * `buysAmountKRW`/`sellsAmountKRW` 와 `headerPnlKRW`(= sells − buys)가 그 금액을 쓰고,
 * `computeLifoPnl` 도 `price` 가 없을 때 `amount_krw` 로 폴백하므로 오차가 손익까지 간다.
 *
 * → 체결 기록이 있으면 `amount_krw × (체결수량 / 주문수량)` 으로 실제 집행액에 맞춘다.
 * 통화 중립이라 해외(USD 단가) 주문에도 안전하다 — `e.price × e.quantity` 로 다시 계산하면
 * USD 값이 KRW 컬럼에 들어가므로 그 방법은 쓸 수 없다.
 *
 * 체결 기록이 없는 주문(=현재 운영 DB 전량, `executions` 0행)은 `ELSE` 로 떨어져
 * **기존과 완전히 동일**하다. 즉 과거 데이터와의 혼재가 리포트를 바꾸지 않는다.
 */
export async function fetchOrderRows(opts: FetchOptions): Promise<OrderRow[]> {
  const pool = getPool();
  const prefetchStart = new Date(opts.rangeStart.getTime() - (opts.prefetchDays ?? 30) * 86400_000);
  const params: Array<string | Date> = [prefetchStart, opts.rangeEnd];
  let marketClause = '';
  if (opts.market && opts.market !== 'all') {
    marketClause = ' AND o.market = ?';
    params.push(opts.market);
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT o.symbol AS symbol,
            o.side   AS side,
            CAST(COALESCE(e.price,    o.price)    AS DECIMAL(36,8))  AS price,
            CAST(COALESCE(e.quantity, o.quantity) AS DECIMAL(36,18)) AS quantity,
            CAST(CASE WHEN e.quantity IS NOT NULL AND o.quantity IS NOT NULL AND o.quantity > 0
                      THEN COALESCE(o.amount_krw, 0) * (e.quantity / o.quantity)
                      ELSE COALESCE(o.amount_krw, 0)
                 END                              AS DECIMAL(18,2))  AS amount_krw,
            CAST(COALESCE(SUM(e.fee), 0)          AS DECIMAL(36,8))  AS fee,
            COALESCE(MAX(e.executed_at), o.updated_at, o.created_at) AS ts
       FROM orders o
       LEFT JOIN executions e ON e.order_id = o.id
      WHERE o.status = 'filled'
        AND o.side IN ('buy','sell')
        AND o.created_at >= ?
        AND o.created_at <= ?
        ${marketClause}
      GROUP BY o.id
      ORDER BY ts ASC, o.id ASC`,
    params,
  );
  return rows.map(r => ({
    symbol: String(r.symbol),
    side: String(r.side) as 'buy' | 'sell',
    price: r.price != null ? Number(r.price) : null,
    quantity: Number(r.quantity),
    amount_krw: Number(r.amount_krw),
    fee: Number(r.fee),
    ts: new Date(r.ts as string).getTime(),
  }));
}

export interface BuildOptions {
  rangeStart: Date;
  rangeEnd: Date;
  /** 현재 총자산. null = 조회 불가(T-056 — 예수금·환율 확인 불가). 리포트 본문 계산에는 쓰지 않는다. */
  totalKRW: number | null;
  baselineKRW: number | null;
  market?: Market;
  rows?: OrderRow[];           // 테스트 주입
}

export async function buildTradeReport(opts: BuildOptions): Promise<TradeReport> {
  const rows = opts.rows ?? await fetchOrderRows({
    rangeStart: opts.rangeStart,
    rangeEnd: opts.rangeEnd,
    market: opts.market,
  });

  const startMs = opts.rangeStart.getTime();
  let buys = 0, sells = 0, buysAmt = 0, sellsAmt = 0;
  const symbolBuyCnt = new Map<string, number>();
  const symbolSellCnt = new Map<string, number>();

  for (const r of rows) {
    if (r.ts < startMs) continue;
    if (r.side === 'buy') {
      buys++;
      buysAmt += r.amount_krw;
      symbolBuyCnt.set(r.symbol, (symbolBuyCnt.get(r.symbol) ?? 0) + 1);
    } else {
      sells++;
      sellsAmt += r.amount_krw;
      symbolSellCnt.set(r.symbol, (symbolSellCnt.get(r.symbol) ?? 0) + 1);
    }
  }

  const lifo = computeLifoPnl(rows, opts.rangeStart);
  // 분석 기간 내 **매도가 발생한 종목만** 리스트 — buy-only 종목(미실현 평가 대상)은 제외.
  const perSymbol: SymbolPnl[] = [];
  for (const sym of symbolSellCnt.keys()) {
    perSymbol.push({
      symbol: sym,
      realizedKRW: lifo.perSymbol.get(sym) ?? 0,
      cycles: Math.min(symbolBuyCnt.get(sym) ?? 0, symbolSellCnt.get(sym) ?? 0),
      sellCount: symbolSellCnt.get(sym) ?? 0,
    });
  }
  perSymbol.sort((a, b) => Math.abs(b.realizedKRW) - Math.abs(a.realizedKRW));

  const churnSymbols = perSymbol
    .filter(p => p.cycles >= FEE_THRESHOLD_CYCLES)
    .map(p => p.symbol);

  return {
    rangeStart: opts.rangeStart,
    rangeEnd: opts.rangeEnd,
    buys, sells,
    buysAmountKRW: buysAmt,
    sellsAmountKRW: sellsAmt,
    headerPnlKRW: sellsAmt - buysAmt,
    lifoPnlKRW: lifo.totalKRW,
    perSymbol,
    churnSymbols,
  };
}

// ─── 메시지 포맷 ────────────────────────────────────────────────────────────

function fmtKRW(n: number): string {
  const sign = n < 0 ? '−' : (n > 0 ? '+' : '');
  return `${sign}₩${Math.abs(Math.round(n)).toLocaleString('ko-KR')}`;
}
function fmtKRWPlain(n: number): string {
  return `₩${Math.round(n).toLocaleString('ko-KR')}`;
}
function fmtKstHHMM(d: Date): string {
  return d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false });
}
function fmtKstDate(d: Date): string {
  return d.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' })
    .replace(/\. /g, '-').replace('.', '');
}

/** 부호 있는 퍼센트. 값이 없으면 "데이터 없음" — 0 이나 빈칸으로 얼버무리지 않는다. */
function fmtSignedPct(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '데이터 없음';
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`;
}

const CONFIDENCE_KO: Record<string, string> = { low: '낮음', medium: '보통', high: '높음' };

/**
 * 선행지표 규칙 라벨(`RSI14 < 30`, `누적낙폭 > 15%` …)을 **메시지에 넣어도 안전한 형태**로.
 *
 * 이 body 는 두 채널에 서로 다른 방식으로 실린다:
 *  - 슬랙 — mrkdwn 그대로. 짝이 맞는 `<…>` 는 링크로 해석돼 문장이 통째로 사라질 수 있다
 *    (규칙 라벨 두 개가 한 메시지에 들어가면 `<`·`>` 가 실제로 짝을 이룬다)
 *  - 텔레그램 — `mrkdwnToTelegramHtml` 이 **body 전체를 다시 escape** 한다.
 *    그래서 여기서 `&lt;` 로 미리 escape 하면 `&amp;lt;` 가 되어 화면에 `&lt;` 가 그대로 보인다
 *
 * 즉 어느 쪽으로 escape 해도 한 채널이 깨진다. 부등호를 **전각 문자로 치환**하면 마크업이
 * 아니게 되어 두 채널 모두 의도한 대로 렌더된다. 표시 전용 변환이며 규칙 id·통계에는 영향 없다.
 */
function messageSafeLabel(label: string): string {
  return label.replace(/</g, '＜').replace(/>/g, '＞');
}

/**
 * 매수 추천 1건의 **근거 줄**. "확률"이라는 단어를 쓰지 않는다 —
 * 우리가 가진 건 과거 조건부 적중률(precision)뿐이다.
 */
function formatBuyEvidence(buy: BuyRecommendation): string | null {
  if (buy.ruleLabel == null || buy.precision == null) return null;
  const hits = Math.round(buy.precision * buy.triggerCount);
  const liftStr = buy.lift != null ? `, lift ×${buy.lift.toFixed(2)}` : '';
  const confStr = buy.confidence ? `, 표본 신뢰도 ${CONFIDENCE_KO[buy.confidence] ?? buy.confidence}` : '';
  return `   근거: ${messageSafeLabel(buy.ruleLabel)} — 과거 적중률 ${(buy.precision * 100).toFixed(0)}%(${buy.triggerCount}건 중 ${hits}건)${liftStr}${confStr}`;
}

/**
 * 목표가 한 조각 — 도달 근거가 확인된 레벨만 숫자로 쓰고, 아니면 사유를 대신 쓴다(T-034).
 * 통화 기호는 `targets.currency` 가 결정한다 — 해외 종목은 `$`, 국내는 `₩`.
 */
function formatTargetFragment(
  t: PriceTargets | null | undefined,
  side: 'buy' | 'sell',
  horizonDays: number | null,
): string {
  const label = side === 'buy' ? '매수 희망가' : '매도 목표가';
  const level = side === 'buy' ? displayableBuyZone(t) : displayableSellTarget(t);
  if (!level || !t) return `${label}: ${unreachableReasonKo(t, side)}`;
  const within = horizonDays != null ? `, ${horizonDays}일 이내` : '';
  return `${label} ${formatTargetPrice(level.price, t.currency)} (${messageSafeLabel(level.basis)})${within}`;
}

/**
 * 보유종목의 리서치 매도 판단 한 줄. 자동매매 청산 로직과 **무관한 참고 정보**임이 드러나도록
 * "고려"라는 말과 근거(차트 레벨)를 반드시 함께 적는다.
 *
 * 🔴 T-034 — 판단 근거는 **차트뿐**이다. 진입가 대비 진행률(과거평균 기반)도, 보유기간(기간 초과)도
 *    판정에서 뺐다. 보유일수·손익은 아래 `formatHoldingInfoLine()` 이 **별도 정보 줄**로 내보내
 *    매도 판단 근거로 읽히지 않게 한다.
 */
function formatSellSignalLine(h: HoldingStatus): string | null {
  const s = h.sellSignal;
  if (!s) return null;

  if (s.action === 'insufficient_data') {
    return `   └ 🔬 판단 보류 (${unreachableReasonKo(h.priceTargets, 'sell')})`;
  }

  if (s.action === 'sell') {
    const level = displayableSellTarget(h.priceTargets);
    if (!level || !h.priceTargets) {
      return '   └ 🔬 매도 고려 — 차트 저항선 돌파(현재가 위 저항 근거 없음)';
    }
    const price = formatTargetPrice(level.price, h.priceTargets.currency);
    return `   └ 🔬 매도 고려 — 매도 목표가 ${price} (${messageSafeLabel(level.basis)}) 근접`;
  }

  return `   └ 🔬 관망 — ${formatTargetFragment(h.priceTargets, 'sell', s.horizonDays)}`;
}

/**
 * 보유 정보 줄 — 🔴 **판단이 아니라 사실 나열이다.**
 * 위 🔬 줄(차트 판단)과 시각적으로 분리해서, 보유기간·손익이 매도 근거로 읽히지 않게 한다.
 */
function formatHoldingInfoLine(h: HoldingStatus): string | null {
  const s = h.sellSignal;
  if (!s) return null;
  const parts: string[] = [];
  if (s.daysSinceEntry != null) parts.push(`보유 ${s.daysSinceEntry}일째`);
  if (s.gainPct != null) parts.push(`진입가 대비 ${fmtSignedPct(s.gainPct, 1)}`);
  if (parts.length === 0) return null;
  return `   └ ℹ️ ${parts.join(' · ')} (참고 정보)`;
}

/**
 * 종목별 금액 한 조각 (T-035) — 해외 종목은 달러, 국내는 원화.
 *
 * 목표가와 **같은 포맷터**(`formatTargetPrice`)를 쓴다. 한 줄 안에서 목표가는 `$`, 진입가는 `₩`
 * 로 갈리던 것이 사용자가 지적한 문제였으므로, 표기가 어긋날 여지를 남기지 않는다.
 *
 * 🔴 두 가지를 반드시 드러낸다:
 *  - 환산본이면 원화 원본과 "현재 환율 환산"이라는 사실 (매수 당시 체결가가 아니다)
 *  - 달러로 못 바꿨으면 그 사실 (통화 기호만 바꾸거나 숫자를 지어내지 않는다)
 */
function formatDisplayAmount(d: DisplayAmount | null | undefined, fallbackKRW: number | null): string {
  // `display` 자체가 없는 경우(구버전 호출부)에는 원화 원본으로 되돌아간다 — 금액을 감추지 않는다.
  if (!d || d.value == null) {
    return fallbackKRW != null && Number.isFinite(fallbackKRW) ? fmtKRWPlain(fallbackKRW) : '데이터 없음';
  }
  const main = formatTargetPrice(d.value, d.currency);
  if (isFxFallback(d)) return `${main} (달러 환산 불가 — 원화 표시)`;
  if (isFxConverted(d) && d.sourceKRW != null) {
    return `${main} (원화 ${fmtKRWPlain(d.sourceKRW)} · 현재 환율 환산)`;
  }
  return main;
}

/** 리서치 요약 문단 (T-033). 추적 0종목·활성 0종목도 조용히 생략하지 않고 명시한다. */
function formatResearchSection(research: ResearchDigest, nameOf: (s: string) => string): string {
  const lines: string[] = [];
  lines.push('*🔬 리서치분석 요약 (참고용)*');

  if (research.trackedCount === 0) {
    lines.push('추적 중인 종목이 없습니다 — 즐겨찾기에서 리서치 추적을 켜주세요.');
  } else {
    lines.push(`추적 ${research.trackedCount}종목 중 매수 고려 ${research.activeCount}종목`);
    if (research.items.length === 0) {
      lines.push('기준일 종가에서 조건을 충족한 종목이 없습니다.');
    }
  }

  for (const item of research.items) {
    const asOf = item.asOfDate ? `${item.asOfDate} 종가 기준` : '기준일 데이터 없음';
    if (item.buy.action === 'buy') {
      lines.push(`📈 ${nameOf(item.symbol)} — 매수 고려 (${asOf})`);
      const evidence = formatBuyEvidence(item.buy);
      if (evidence) lines.push(evidence);
      // T-034 — "얼마에" 를 차트 지지선으로 제시한다. 도달 근거가 없으면 숫자 대신 그 사실을 쓴다.
      lines.push(`   가격: ${formatTargetFragment(item.targets, 'buy', item.targets?.horizonDays ?? null)}`);
    } else {
      const trig = item.buy.triggerCount > 0 ? `표본부족, 트리거 ${item.buy.triggerCount}건` : '표본부족';
      lines.push(`⚪ ${nameOf(item.symbol)} — 판단 보류 (${trig}) (${asOf})`);
    }
  }

  lines.push('');
  lines.push(research.note);
  return lines.join('\n');
}

/**
 * @param labels 심볼 → 한글 종목명 Map. 이 함수는 **동기 순수 함수로 유지한다** —
 *   `getSymbolLabels()` 는 비동기이므로 호출부에서 미리 조회해 넘긴다. 옵션 인자라
 *   넘기지 않으면 기존처럼 심볼 코드가 그대로 표시된다.
 */
export function formatReportMessage(
  rep: TradeReport,
  /** null = 현재 총자산 조회 불가(T-056). 0 으로 적지 않는다 — "총 자산 0원(-100%)" 같은 거짓 숫자가 나간다. */
  totalKRW: number | null,
  baselineKRW: number | null,
  candidates?: SignalCandidates,
  research?: ResearchDigest | null,
  labels?: Map<string, string>,
): string {
  const nameOf = (sym: string) => labels?.get(sym) ?? sym;
  const hours = Math.round((rep.rangeEnd.getTime() - rep.rangeStart.getTime()) / 3600_000);
  const lines: string[] = [];
  lines.push(`*📊 거래 리포트 (${hours}h)*`);
  lines.push(`🕐 분석 기간: ${fmtKstDate(rep.rangeStart)} ${fmtKstHHMM(rep.rangeStart)} ~ ${fmtKstHHMM(rep.rangeEnd)} KST`);
  lines.push('');
  lines.push('*포트폴리오*');
  if (totalKRW == null) {
    lines.push(`• 총 자산: 조회 불가 (증권사 잔고·예수금·환율을 확인하지 못함)${
      baselineKRW != null && baselineKRW > 0 ? `  (기간 시작 ${fmtKRWPlain(baselineKRW)})` : ''}`);
  } else if (baselineKRW != null && baselineKRW > 0) {
    const deltaPct = ((totalKRW - baselineKRW) / baselineKRW) * 100;
    const sign = deltaPct >= 0 ? '+' : '';
    lines.push(`• 총 자산: ${fmtKRWPlain(totalKRW)}  (기간 시작 ${fmtKRWPlain(baselineKRW)}, ${sign}${deltaPct.toFixed(2)}%)`);
  } else {
    lines.push(`• 총 자산: ${fmtKRWPlain(totalKRW)}  (기간 시작 스냅샷 없음)`);
  }
  lines.push('');
  lines.push('*거래 요약*');
  lines.push(`• 매수 ${rep.buys}건 / ${fmtKRWPlain(rep.buysAmountKRW)}`);
  lines.push(`• 매도 ${rep.sells}건 / ${fmtKRWPlain(rep.sellsAmountKRW)}`);

  // 매도 손익 — exit-engine indicators(entry_price/pnl_pct) 기준 실손익
  const sellPnlList = candidates?.sellPnl ?? [];
  if (sellPnlList.length > 0) {
    const totalPnl = sellPnlList.reduce((s, p) => s + p.pnlKRW, 0);
    const exitLabel: Record<string, string> = {
      hard_stop:     '손절',
      trailing_stop: '트레일',
      target_profit: '익절',
      eod_loss_cut:  '마감손절',
      ai_sell:       'AI매도',
    };
    lines.push('');
    lines.push(`*📉 매도 손익 (총 ${fmtKRW(totalPnl)})*`);
    for (const p of sellPnlList) {
      const icon = p.pnlKRW >= 0 ? '🔴' : '🔵';
      const sign = p.pnlPct >= 0 ? '+' : '';
      const kind = exitLabel[p.exitKind] ?? p.exitKind;
      lines.push(`${icon} ${nameOf(p.symbol)} ${fmtKRW(p.pnlKRW)} (${sign}${p.pnlPct.toFixed(2)}%) [${kind}]`);
    }
  } else if (rep.sells > 0) {
    lines.push(`• 실현 손익: ${fmtKRW(rep.lifoPnlKRW)}`);
  } else {
    lines.push('');
    lines.push('*매도 없음*');
  }
  if (rep.churnSymbols.length > 0) {
    lines.push('');
    lines.push('*경고*');
    lines.push(`• 회전매매: ${rep.churnSymbols.map(nameOf).join(', ')} (사이클 ≥ ${FEE_THRESHOLD_CYCLES})`);
  }

  // ── 보유 현황 ──
  // 🔴 "익절 임박" 문구는 T-033 에서 제거했다. 그 판정이 `profitPct`(= **고점대비**)를 현재
  //    수익률로 오독한 결과였기 때문이다. 이름 때문에 다시 살아나지 않도록 라벨을 명시한다.
  if (candidates?.holdings && candidates.holdings.length > 0) {
    lines.push('');
    lines.push('*📦 현재 보유*');
    for (const h of candidates.holdings) {
      const icon = h.profitPct >= 2.5 ? '🔴' : h.profitPct <= -1.5 ? '🔵' : '⚪';
      const warn = h.profitPct <= -1.5 ? ' ← 손절 임박' : '';
      lines.push(
        `${icon} ${nameOf(h.symbol)} 고점대비 ${fmtSignedPct(h.profitPct)} · ` +
        `최근추이 ${fmtSignedPct(h.periodChangePct)} (${h.qty}주)${warn}`,
      );
      // T-035 — 해외 종목이면 달러로. 원본 KRW(`investedKRW`)가 유효할 때만 줄을 만든다.
      lines.push(
        h.investedKRW > 0
          ? `   └ 투자금 ${formatDisplayAmount(h.display?.invested, h.investedKRW)}`
          : '   └ 투자금 데이터 없음',
      );
      const sellLine = formatSellSignalLine(h);
      if (sellLine) lines.push(sellLine);
      const infoLine = formatHoldingInfoLine(h);
      if (infoLine) lines.push(infoLine);
    }
  }

  // ── 매수 후보 ──
  if (candidates?.buyWatchlist && candidates.buyWatchlist.length > 0) {
    lines.push('');
    lines.push('*👀 매수 후보 모니터링*');
    const statusLabel: Record<string, string> = {
      watchlist:   '대기중',
      ai_pass:     '✅ AI승인',
      ai_rejected: '❌ AI거절',
      blocked:     '차단',
    };
    for (const c of candidates.buyWatchlist) {
      const rsiStr = c.rsi != null ? `RSI ${c.rsi.toFixed(1)}` : 'RSI -';
      const evStr  = c.evPct != null ? ` EV ${c.evPct > 0 ? '+' : ''}${c.evPct.toFixed(2)}%` : '';
      const confStr = c.aiConf != null && c.aiConf > 0 ? ` AI${c.aiConf}%` : '';
      const label  = statusLabel[c.status] ?? c.status;
      const rsiBadge = c.rsi != null && c.rsi < 30 ? '🔥' : c.rsi != null && c.rsi < 35 ? '⚡' : '•';
      lines.push(`${rsiBadge} ${nameOf(c.symbol)} ${rsiStr}${confStr}${evStr} [${label}]`);
    }
  }

  // ── 리서치분석 요약 (T-033) — 평가 깔때기를 대체했다.
  //    깔때기는 대시보드(`eval-funnel-query`)에 그대로 남아 있고, 텔레그램에서만 뺐다.
  if (research) {
    lines.push('');
    lines.push(formatResearchSection(research, nameOf));
  }

  return lines.join('\n');
}

// ─── 변동률 baseline 조회 (재사용) ──────────────────────────────────────────

/**
 * 분석 기간 시작 시점의 portfolio baseline 조회.
 *
 * Outlier 보호 (사후 안전망 — savePortfolioSnapshot sanity guard 보완):
 *  1. 절대 범위 [1000, 100,000,000] 외 행 제외 (KIS 환율 결함으로 박힌 historical outlier 차단)
 *  2. 24h median 대비 ±5배 초과 행 제외 (단일 시점 비정상 점프)
 *  3. 위 둘 통과한 첫 행을 baseline 으로 채택
 *
 * 모두 제외돼 행이 없으면 null — 호출자(formatReportMessage)가 "기간 시작 스냅샷 없음" 표시.
 */
const BASELINE_MIN_KRW = 1_000;
const BASELINE_MAX_KRW = 100_000_000;
const BASELINE_RATIO   = 5;

/** 스냅샷 1행의 보유 항목(`portfolio_snapshots.positions` JSON 원소). */
interface SnapshotPositionRow {
  currency: string;
  qty: number;
  /** KRW 환산 단가. 현금 KRW 는 1, USD 는 환율 */
  price: number;
  value_krw: number;
}

export interface PortfolioBaselineSnapshot {
  totalKRW: number;
  positions: SnapshotPositionRow[];
}

function parsePositions(v: unknown): SnapshotPositionRow[] {
  let raw: unknown = v;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((p) => {
    if (!p || typeof p !== 'object') return [];
    const o = p as Record<string, unknown>;
    const currency = typeof o.currency === 'string' ? o.currency : null;
    if (!currency) return [];
    return [{
      currency,
      qty:       Number(o.qty ?? 0),
      price:     Number(o.price ?? 0),
      value_krw: Number(o.value_krw ?? 0),
    }];
  });
}

/**
 * 🔴 **outlier 가드의 단일 구현.** `fetchPortfolioBaselineKRW` 와 `fetchSymbolBaselinePrices`
 * 가 **같은 행**을 근거로 삼도록 여기 한 곳에서만 행을 고른다. 총액은 정상 판정된 행에서
 * 가져왔는데 종목별 단가는 걸러진 행에서 가져오는 상황(= 총액과 종목 단가가 서로 다른 시점)을
 * 구조적으로 불가능하게 만드는 것이 이 함수의 존재 이유다.
 */
async function fetchPortfolioBaselineSnapshot(rangeStart: Date): Promise<PortfolioBaselineSnapshot | null> {
  try {
    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT total_krw, positions FROM portfolio_snapshots
        WHERE ts >= ?
          AND total_krw BETWEEN ? AND ?
        ORDER BY ts ASC
        LIMIT 20`,
      [rangeStart, BASELINE_MIN_KRW, BASELINE_MAX_KRW],
    );
    if (rows.length === 0) return null;

    // 24h median (ratio 검증용)
    const [medRows] = await pool.query<RowDataPacket[]>(
      `SELECT total_krw FROM portfolio_snapshots
        WHERE ts >= DATE_SUB(?, INTERVAL 24 HOUR)
          AND ts <  DATE_ADD(?, INTERVAL 24 HOUR)
          AND total_krw BETWEEN ? AND ?
        ORDER BY total_krw ASC`,
      [rangeStart, rangeStart, BASELINE_MIN_KRW, BASELINE_MAX_KRW],
    );
    const median = medRows.length > 0
      ? Number(medRows[Math.floor(medRows.length / 2)].total_krw)
      : null;

    for (const r of rows) {
      const v = Number(r.total_krw);
      if (median != null && median > 0) {
        const ratio = v / median;
        if (ratio > BASELINE_RATIO || ratio < 1 / BASELINE_RATIO) {
          console.warn(
            `[trade-report] baseline candidate ${v} skipped (median=${median} ratio=${ratio.toFixed(2)}x)`,
          );
          continue;
        }
      }
      return { totalKRW: v, positions: parsePositions(r.positions) };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 분석 기간 시작 시점의 portfolio baseline 조회.
 *
 * Outlier 보호 (사후 안전망 — savePortfolioSnapshot sanity guard 보완):
 *  1. 절대 범위 [1000, 100,000,000] 외 행 제외 (KIS 환율 결함으로 박힌 historical outlier 차단)
 *  2. 24h median 대비 ±5배 초과 행 제외 (단일 시점 비정상 점프)
 *  3. 위 둘 통과한 첫 행을 baseline 으로 채택
 *
 * 모두 제외돼 행이 없으면 null — 호출자(formatReportMessage)가 "기간 시작 스냅샷 없음" 표시.
 *
 * ⚠ 시그니처·동작은 T-033 이전과 100% 동일하다. 내부에서 행 선택만
 *   `fetchPortfolioBaselineSnapshot` 에 위임한다.
 */
export async function fetchPortfolioBaselineKRW(rangeStart: Date): Promise<number | null> {
  const snap = await fetchPortfolioBaselineSnapshot(rangeStart);
  return snap ? snap.totalKRW : null;
}

/**
 * 같은 baseline 행에서 **종목별 KRW 환산 단가**를 뽑는다 (T-033).
 *
 * 새 테이블을 만들지 않는다 — `portfolio_snapshots.positions` 에 이미 종목별 단가가 들어 있고,
 * 총액과 같은 행에서 꺼내야 "총 자산 변동률"과 "종목별 주기 변동률"이 같은 시점을 가리킨다.
 * 그 시점에 보유하지 않았던 종목은 Map 에 아예 없다(0 으로 채우지 않는다 — 0 은 -100% 가 된다).
 */
export async function fetchSymbolBaselinePrices(
  rangeStart: Date,
  symbols: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const want = new Set(symbols);
  if (want.size === 0) return out;

  const snap = await fetchPortfolioBaselineSnapshot(rangeStart);
  if (!snap) return out;

  for (const p of snap.positions) {
    if (!want.has(p.currency)) continue;
    if (!Number.isFinite(p.price) || p.price <= 0) continue;   // 시세 실패 sentinel 방어
    out.set(p.currency, p.price);
  }
  return out;
}

/**
 * 시세 조회 대상의 시장 판별 — `market` 컬럼을 우선 믿되, 값이 손상됐으면 심볼 포맷으로 본다.
 * 통화 판별(`currencyForMarket`)과 시세 라우팅이 **같은 답**을 쓰도록 한 곳으로 모아 둔다.
 */
function resolveMarket(symbol: string, market: string | null | undefined): ResearchMarket {
  return market === 'domestic' || market === 'overseas'
    ? market
    : getMarketFromSymbol(symbol) === 'overseas' ? 'overseas' : 'domestic';
}

/**
 * 현재 시세 조회 — **KRW 환산가와 (해외의) USD 원가를 쌍으로** 돌려준다 (T-033 확장, T-035).
 *
 * `getKisTickers` / `getKisOverseasTickers` 는 **중복 제거를 하지 않고**, 국내/해외 통합 함수도
 * 없다. 그래서 여기서 심볼을 중복 제거하고 시장별로 나눠 각각 호출한다
 * (`src/lib/strategy/universe.ts` 와 같은 패턴 — 그 파일은 import 도 하지 않고 형태만 따랐다).
 *
 * 해외 티커의 `price` 는 이미 KRW 환산값이고(`kis-overseas.getTicker` 가 환율을 곱해 반환),
 * 같은 응답의 `priceUsd` 가 **환산 전 USD 원가**다. 🔴 두 값이 **동일 시점 쌍**이라는 점이
 * T-035 의 달러 표기 근거다 — 이 쌍에서 나온 비율만이 그 가격에 실제로 적용된 환율이다
 * (자세한 근거·한계는 `src/lib/display-amount.ts` 헤더 참조).
 *
 * 조회에 실패한 심볼은 Map 에 없다 — 소비자가 "데이터 없음"으로 표시하게 한다.
 * 시세 조회 실패로 리포트 전체가 실패하면 안 되므로 시장별로 개별 catch 한다.
 */
export async function fetchCurrentQuotes(
  targets: { symbol: string; market: string }[],
): Promise<Map<string, SymbolQuote>> {
  const out = new Map<string, SymbolQuote>();
  if (!targets || targets.length === 0) return out;

  const domestic: string[] = [];
  const overseas: string[] = [];
  for (const t of targets) {
    if (!t?.symbol) continue;
    (resolveMarket(t.symbol, t.market) === 'overseas' ? overseas : domestic).push(t.symbol);
  }

  const collect = (tickers: { symbol: string; price: number; priceUsd?: number }[]) => {
    for (const tk of tickers) {
      const price = Number(tk.price);
      if (!Number.isFinite(price) || price <= 0) continue;
      // USD 원가는 해외 티커에만 있다. 없거나 0 이하면 null — 추정하지 않는다.
      const usdRaw = tk.priceUsd != null ? Number(tk.priceUsd) : Number.NaN;
      const usd = Number.isFinite(usdRaw) && usdRaw > 0 ? usdRaw : null;
      out.set(tk.symbol, { krw: price, usd });
    }
  };

  const jobs: Promise<void>[] = [];
  const uniqDomestic = [...new Set(domestic)];
  const uniqOverseas = [...new Set(overseas)];

  if (uniqDomestic.length > 0) {
    jobs.push(
      getKisTickers(uniqDomestic).then(collect).catch((e) => {
        console.warn(`[trade-report] 국내 현재가 조회 실패(${uniqDomestic.length}종목): ${e instanceof Error ? e.message : String(e)}`);
      }),
    );
  }
  if (uniqOverseas.length > 0) {
    jobs.push(
      getKisOverseasTickers(uniqOverseas).then(collect).catch((e) => {
        console.warn(`[trade-report] 해외 현재가 조회 실패(${uniqOverseas.length}종목): ${e instanceof Error ? e.message : String(e)}`);
      }),
    );
  }
  await Promise.all(jobs);
  return out;
}

/**
 * 현재 KRW 환산 단가만 필요한 소비자용 얇은 래퍼 (T-033 시그니처 유지).
 * 달러 표기가 필요하면 `fetchCurrentQuotes()` 를 직접 쓴다.
 */
export async function fetchCurrentPricesKRW(
  targets: { symbol: string; market: string }[],
): Promise<Map<string, number>> {
  const quotes = await fetchCurrentQuotes(targets);
  const out = new Map<string, number>();
  for (const [symbol, q] of quotes) out.set(symbol, q.krw);
  return out;
}

/**
 * 보유종목 매도 판단에 필요한 심볼별 **차트 목표가**(최신 1건). 추적이 꺼진 종목도 과거 행이
 * 있으면 쓴다. T-034 이전에는 과거 평균 상승폭·소요일을 읽었지만, 그 값으로 만든 목표가가
 * 진입가 기반이라 폐기됐다 — 지금은 리서치 cron 이 캔들로 계산해 저장한 값을 그대로 읽는다.
 */
async function fetchPriceTargetsForSymbols(symbols: string[]): Promise<Map<string, PriceTargets>> {
  const out = new Map<string, PriceTargets>();
  const unique = [...new Set(symbols)];
  if (unique.length === 0) return out;

  try {
    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT r.symbol, r.price_targets
         FROM research_rally_results r
         JOIN (
           SELECT symbol, MAX(run_date) AS run_date
             FROM research_rally_results
            WHERE symbol IN (?)
            GROUP BY symbol
         ) latest ON latest.symbol = r.symbol AND latest.run_date = r.run_date`,
      [unique],
    );
    for (const r of rows) {
      const raw = r.price_targets;
      if (raw == null) continue;
      let parsed: PriceTargets | null = null;
      if (typeof raw === 'string') {
        try { parsed = JSON.parse(raw) as PriceTargets; } catch { parsed = null; }
      } else {
        parsed = raw as PriceTargets;
      }
      if (parsed) out.set(String(r.symbol), parsed);
    }
  } catch (e) {
    // 목표가는 부가정보다 — 없으면 매도 판단만 "판단 보류"로 떨어지고 리포트는 그대로 나간다.
    console.warn(`[trade-report] 리서치 목표가 조회 실패: ${e instanceof Error ? e.message : String(e)}`);
  }
  return out;
}

// ─── 매수 후보 + 보유 현황 조회 ─────────────────────────────────────────────

/**
 * @param rangeStart 리포트 구간 시작. 종목별 "주기 변동률"의 기준 시점이다.
 *                   생략하면 baseline 조회를 건너뛰고 `periodStartKRW`/`periodChangePct` 가 null 이 된다.
 */
export async function fetchSignalCandidates(rangeStart?: Date): Promise<SignalCandidates> {
  const pool = getPool();

  // 최근 4시간 내 buy 시그널 발화 종목 (최신 1건/종목)
  const [buyRows] = await pool.query<RowDataPacket[]>(`
    SELECT s1.symbol, s1.market,
      JSON_EXTRACT(s1.indicators, '$.rsi14')              AS rsi,
      JSON_EXTRACT(s1.indicators, '$.ai.confidence')      AS ai_conf,
      JSON_EXTRACT(s1.indicators, '$.ai.ev.evPct')        AS ev_pct,
      JSON_UNQUOTE(JSON_EXTRACT(s1.indicators, '$.ai.skipCategory')) AS skip_reason,
      s1.status
    FROM signals s1
    INNER JOIN (
      SELECT symbol, MAX(created_at) AS latest
      FROM signals
      WHERE side = 'buy' AND created_at > DATE_SUB(NOW(), INTERVAL 4 HOUR)
      GROUP BY symbol
    ) s2 ON s1.symbol = s2.symbol AND s1.created_at = s2.latest
    WHERE s1.side = 'buy'
    ORDER BY CAST(JSON_EXTRACT(s1.indicators, '$.rsi14') AS DECIMAL(6,2)) ASC
    LIMIT 15
  `);

  const buyWatchlist: BuyCandidate[] = buyRows.map(r => {
    const st = String(r.status ?? '');
    const skip = r.skip_reason ? String(r.skip_reason) : null;
    let status: BuyCandidate['status'] = 'blocked';
    if (st === 'auto_submitted' || st === 'approved') status = 'ai_pass';
    else if (skip === 'ai_rejected') status = 'ai_rejected';
    else if (skip === 'rule_prefilter' || skip === 'strong_counter_trend') status = 'watchlist';
    return {
      symbol:     String(r.symbol),
      rsi:        r.rsi != null ? Number(r.rsi) : null,
      aiConf:     r.ai_conf != null ? Number(r.ai_conf) : null,
      evPct:      r.ev_pct != null ? Number(r.ev_pct) : null,
      status,
      skipReason: skip,
    };
  });

  // 현재 보유 포지션 (position_state) — 🔴 SELECT 전용. 이 함수는 position_state 를 쓰지 않는다.
  const [posRows] = await pool.query<RowDataPacket[]>(`
    SELECT symbol, market, entry_price, peak_price, qty, first_seen_at,
      ROUND((peak_price - entry_price) / entry_price * 100, 2) AS profit_pct
    FROM position_state
    ORDER BY ROUND((peak_price - entry_price) / entry_price * 100, 2) DESC
  `);

  const positions = posRows.map(r => ({
    symbol:      String(r.symbol),
    market:      String(r.market ?? ''),
    profitPct:   Number(r.profit_pct ?? 0),
    entryKRW:    Number(r.entry_price ?? 0),
    currentKRW:  Number(r.peak_price ?? 0),
    qty:         Number(r.qty ?? 0),
    firstSeenAt: r.first_seen_at ? new Date(r.first_seen_at as string | Date) : null,
  }));
  const heldSymbols = positions.map(p => p.symbol);

  // 세 조회는 서로 독립이라 병렬. 어느 하나가 실패해도 나머지 정보는 그대로 나가야 한다.
  const [baselinePrices, nowQuotes, researchTargets] = await Promise.all([
    rangeStart ? fetchSymbolBaselinePrices(rangeStart, heldSymbols) : Promise.resolve(new Map<string, number>()),
    fetchCurrentQuotes(positions.map(p => ({ symbol: p.symbol, market: p.market })))
      .catch(() => new Map<string, SymbolQuote>()),
    fetchPriceTargetsForSymbols(heldSymbols),
  ]);

  const nowMs = Date.now();
  const holdings: HoldingStatus[] = positions.map(p => {
    const periodStartKRW = baselinePrices.get(p.symbol) ?? null;
    const quote          = nowQuotes.get(p.symbol) ?? null;
    const nowPriceKRW    = quote?.krw ?? null;
    // 🔴 변동률은 KRW 끼리만 — 표시 통화(아래 display)와 접점이 0이다.
    const periodChangePct = periodStartKRW != null && periodStartKRW > 0 && nowPriceKRW != null
      ? ((nowPriceKRW - periodStartKRW) / periodStartKRW) * 100
      : null;

    // 보유 달력일 — 🔴 표시 전용이다. T-034 에서 기간초과 매도 판정을 폐기해 판정에 쓰지 않는다.
    const daysSinceEntry = p.firstSeenAt && !Number.isNaN(p.firstSeenAt.getTime())
      ? Math.max(0, Math.floor((nowMs - p.firstSeenAt.getTime()) / 86_400_000))
      : null;

    const priceTargets = researchTargets.get(p.symbol) ?? null;
    // 리서치 행 자체가 없으면 "판단 보류"조차 만들지 않는다 — 빈 값을 표시할 이유가 없다.
    // 🔴 진입가·현재가·보유일수는 표시용 두 번째 인자로만 넘어간다(판정·목표가에 미사용).
    const sellSignal = priceTargets
      ? evaluateSellSignal(priceTargets, {
          daysSinceEntry,
          entryPriceKRW: p.entryKRW,
          currentPriceKRW: nowPriceKRW,
        })
      : null;

    // T-035 — 해외 종목 금액을 달러로 표기하기 위한 **표시 전용** 변환.
    // 위 판정·집계는 전부 KRW 원본으로 이미 끝났고, 여기서 만든 값은 문자열로만 흘러간다.
    const investedKRW = p.entryKRW * p.qty;
    const displayCurrency = currencyForMarket(resolveMarket(p.symbol, p.market));
    const display: HoldingDisplay = {
      invested: toDisplayAmount(investedKRW, displayCurrency, quote),
    };

    return {
      symbol:     p.symbol,
      profitPct:  p.profitPct,
      entryKRW:   p.entryKRW,
      currentKRW: p.currentKRW,
      qty:        p.qty,
      investedKRW,
      periodStartKRW,
      nowPriceKRW,
      periodChangePct,
      sellSignal,
      priceTargets,
      display,
    };
  });

  // 최근 25시간 매도 시그널에서 실제 손익 (exit-engine indicators 기준)
  const [sellRows] = await pool.query<RowDataPacket[]>(`
    SELECT s.symbol,
      JSON_UNQUOTE(JSON_EXTRACT(s.indicators, '$.exit_kind'))   AS exit_kind,
      CAST(JSON_EXTRACT(s.indicators, '$.pnl_pct')     AS DECIMAL(10,4)) AS pnl_pct,
      CAST(JSON_EXTRACT(s.indicators, '$.entry_price') AS DECIMAL(20,4)) AS entry_price,
      CAST(JSON_EXTRACT(s.indicators, '$.current_price') AS DECIMAL(20,4)) AS current_price,
      o.amount_krw AS sell_amount_krw,
      o.quantity
    FROM signals s
    LEFT JOIN orders o ON o.id = s.consumed_order_id
    WHERE s.side = 'sell'
      AND s.status = 'auto_submitted'
      AND JSON_EXTRACT(s.indicators, '$.pnl_pct') IS NOT NULL
      AND s.created_at > DATE_SUB(NOW(), INTERVAL 25 HOUR)
    ORDER BY s.created_at DESC
  `);

  const sellPnl: SellPnl[] = sellRows.map(r => {
    const pnlPct   = Number(r.pnl_pct ?? 0);
    const entry    = Number(r.entry_price ?? 0);
    const qty      = Number(r.quantity ?? 0);
    const sellAmt  = Number(r.sell_amount_krw ?? 0);
    // 실제 손익 = (현재가 - 매입가) × 수량 = 매도금액 - 매입원가
    const costBasis = entry * qty;
    const pnlKRW   = costBasis > 0 ? sellAmt - costBasis : pnlPct / 100 * sellAmt;
    return {
      symbol:        String(r.symbol),
      exitKind:      String(r.exit_kind ?? ''),
      pnlPct,
      pnlKRW,
      sellAmountKRW: sellAmt,
    };
  });

  return { buyWatchlist, holdings, sellPnl };
}

// ─── 리서치 요약 (T-033) ────────────────────────────────────────────────────

/**
 * 리서치분석(T-032) 결과를 리포트용 요약으로 압축한다.
 *
 * 🔴 **여기서 확률·목표가를 다시 계산하지 않는다.** 화면(ResearchTab)과 08:00 리포트가
 * `evaluateBuySignal()` 이라는 **같은 함수**에 **같은 저장값**(`todayActiveRuleIds`,
 * `precursorAnalysis.rules`)을 넣어 같은 답을 얻는다. 어느 한쪽에서 재계산하면 두 화면의
 * 숫자가 조용히 어긋나고, 그 순간 이 기능의 신뢰도는 끝난다.
 *
 * 🔴 이 반환값은 리포트 문자열로만 흘러간다 — `createSignal()`·`submitOrder()`·전략 엔진
 * 어디에도 연결되지 않는다.
 *
 * 실을 항목은 "말할 것이 있는" 종목만 고른다:
 *  - `buy`               — 매수 고려
 *  - `insufficient_data` 중 오늘 규칙이 실제로 걸린 것(= 표본부족으로 강등된 것)
 * `hold`(관망)은 매일 전 종목이 해당돼 신호 대 잡음비만 떨어뜨리므로 싣지 않는다.
 */
export async function fetchResearchDigest(): Promise<ResearchDigest> {
  try {
    const { tracked, results } = await getLatestResearchResults();
    const bySymbol = new Map(results.map(r => [r.symbol, r]));

    const items: ResearchDigestItem[] = [];
    let activeCount = 0;

    for (const t of tracked) {
      const r = bySymbol.get(t.symbol);
      if (!r || r.error) continue;
      // T-034 — 저장된 차트 목표가를 그대로 넘긴다. ResearchTab 과 **같은 함수·같은 저장값**을
      // 써야 "화면엔 관망인데 리포트엔 매수 고려"라는 불일치가 안 생긴다(도달가능성 게이트 포함).
      const buy = evaluateBuySignal(r.todayActiveRuleIds, r.precursorAnalysis?.rules ?? null, r.priceTargets);
      if (buy.action === 'buy') activeCount++;
      const worthShowing =
        buy.action === 'buy' ||
        (buy.action === 'insufficient_data' && buy.ruleId != null);
      if (!worthShowing) continue;
      items.push({
        symbol: t.symbol, market: t.market, asOfDate: r.dataRangeTo, buy,
        targets: r.priceTargets ?? null,
      });
    }

    // 매수 고려 먼저, 그 안에서는 lift 내림차순 — 사용자가 위에서부터 읽으면 된다.
    items.sort((a, b) => {
      const rank = (x: ResearchDigestItem) => (x.buy.action === 'buy' ? 0 : 1);
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      return (b.buy.lift ?? -1) - (a.buy.lift ?? -1);
    });

    return { trackedCount: tracked.length, activeCount, items, note: PRECURSOR_NOTE };
  } catch (e) {
    console.warn(`[trade-report] 리서치 요약 조회 실패: ${e instanceof Error ? e.message : String(e)}`);
    return EMPTY_RESEARCH_DIGEST;
  }
}

/**
 * 리포트 한 통에 등장하는 **모든 심볼**을 모은다 — 한글 종목명을 쿼리 1번으로 받기 위한 목록.
 * 중복 제거는 `getSymbolLabels()` 가 하지만, 여기서도 Set 으로 접어 호출 크기를 줄인다.
 */
export function collectReportSymbols(
  rep: TradeReport,
  candidates?: SignalCandidates | null,
  research?: ResearchDigest | null,
): string[] {
  const out = new Set<string>();
  for (const p of rep.perSymbol) out.add(p.symbol);
  for (const s of rep.churnSymbols) out.add(s);
  for (const h of candidates?.holdings ?? []) out.add(h.symbol);
  for (const c of candidates?.buyWatchlist ?? []) out.add(c.symbol);
  for (const s of candidates?.sellPnl ?? []) out.add(s.symbol);
  for (const i of research?.items ?? []) out.add(i.symbol);
  return [...out];
}
