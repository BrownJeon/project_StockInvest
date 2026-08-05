import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import type { EvalFunnelSummary } from '@/lib/strategy/eval-funnel-query';

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
  profitPct: number;
  entryKRW: number;
  currentKRW: number;
  qty: number;
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
            CAST(COALESCE(o.amount_krw, 0)        AS DECIMAL(18,2))  AS amount_krw,
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
  totalKRW: number;
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

/** T-002 §4 — 평가 깔때기 요약 문단 (국내장). eval_funnel 관측 자체가 실패하면 null 전달 → 섹션 생략. */
export function formatFunnelSection(funnel: EvalFunnelSummary): string {
  const lines: string[] = [];
  lines.push('*📊 평가 깔때기 — 국내장*');
  lines.push(
    `런 ${funnel.runs}회${funnel.fullEvalRuns !== funnel.runs ? `(풀평가 ${funnel.fullEvalRuns}회)` : ''} · 종목평가 ${funnel.symbolsEvaluated}건`,
  );

  // 사슬·괄호 모두 **평가 트랙 전용**. exit 엔진 청산 시그널을 여기 합산하면
  // `✅ 시그널 0건 (매도 2)` 같은 자기모순이 생긴다 (T-004 analyst 판정).
  const signalTotal = funnel.buySignals + funnel.sellSignals;
  const stepLine = funnel.steps
    .filter(s => s.key !== 'evaluated')
    // 터미널에 '건'을 붙이지 않는다 — 사슬의 각 항은 건수가 아니라 symbol×run 이라 단위가 다르다.
    .map(s => s.key === 'signal' ? `✅ 시그널 ${s.count}` : `${s.label} ${s.count}`)
    .join(' → ');
  if (stepLine) {
    const sideDetail = signalTotal > 0
      ? ` (매수 ${funnel.buySignals} · 매도 ${funnel.sellSignals})`
      : '';
    lines.push(stepLine + sideDetail);
  }

  // exit 트랙은 깔때기와 모수가 다르므로 사슬에 넣지 않고 별도 줄로 표기한다.
  if (funnel.exitSignals > 0) {
    lines.push(`청산(보유관리) 매도 ${funnel.exitSignals}건`);
  }

  if (funnel.bottlenecks.length > 0 && funnel.symbolsEvaluated > 0) {
    const parts = funnel.bottlenecks.map((b, i) => i === 0
      ? `${b.label} ${b.count}/${funnel.symbolsEvaluated}종목 (${Math.round((b.count / funnel.symbolsEvaluated) * 100)}%)`
      : `${i + 1}위 ${b.label} ${b.count}건`);
    lines.push(`병목: ${parts.join(' · ')}`);
  }

  const anomalyParts = funnel.anomalies.map(a => `${a.label} ${a.count}회`);
  if (funnel.neutralPct != null && funnel.neutralPct > 0) {
    anomalyParts.push(`neutral 상태 ${funnel.neutralPct}% (30m 룰 전체 비활성)`);
  }
  if (anomalyParts.length > 0) lines.push(`⚠ 이상: ${anomalyParts.join(' · ')}`);

  return lines.join('\n');
}

export function formatReportMessage(rep: TradeReport, totalKRW: number, baselineKRW: number | null, candidates?: SignalCandidates, funnel?: EvalFunnelSummary | null): string {
  const hours = Math.round((rep.rangeEnd.getTime() - rep.rangeStart.getTime()) / 3600_000);
  const lines: string[] = [];
  lines.push(`*📊 거래 리포트 (${hours}h)*`);
  lines.push(`🕐 분석 기간: ${fmtKstDate(rep.rangeStart)} ${fmtKstHHMM(rep.rangeStart)} ~ ${fmtKstHHMM(rep.rangeEnd)} KST`);
  lines.push('');
  lines.push('*포트폴리오*');
  if (baselineKRW != null && baselineKRW > 0) {
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
      lines.push(`${icon} ${p.symbol} ${fmtKRW(p.pnlKRW)} (${sign}${p.pnlPct.toFixed(2)}%) [${kind}]`);
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
    lines.push(`• 회전매매: ${rep.churnSymbols.join(', ')} (사이클 ≥ ${FEE_THRESHOLD_CYCLES})`);
  }

  // ── 보유 현황 ──
  if (candidates?.holdings && candidates.holdings.length > 0) {
    lines.push('');
    lines.push('*📦 현재 보유*');
    for (const h of candidates.holdings) {
      const sign = h.profitPct >= 0 ? '+' : '';
      const icon = h.profitPct >= 2.5 ? '🔴' : h.profitPct <= -1.5 ? '🔵' : '⚪';
      const warn = h.profitPct <= -1.5 ? ' ← 손절 임박' : h.profitPct >= 2.5 ? ' ← 익절 임박' : '';
      lines.push(`${icon} ${h.symbol} ${sign}${h.profitPct.toFixed(2)}% (${h.qty}주)${warn}`);
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
      lines.push(`${rsiBadge} ${c.symbol} ${rsiStr}${confStr}${evStr} [${label}]`);
    }
  }

  // ── 평가 깔때기 (T-002) ──
  if (funnel) {
    lines.push('');
    lines.push(formatFunnelSection(funnel));
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

export async function fetchPortfolioBaselineKRW(rangeStart: Date): Promise<number | null> {
  try {
    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT total_krw FROM portfolio_snapshots
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
      return v;
    }
    return null;
  } catch {
    return null;
  }
}

// ─── 매수 후보 + 보유 현황 조회 ─────────────────────────────────────────────

export async function fetchSignalCandidates(): Promise<SignalCandidates> {
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

  // 현재 보유 포지션 (position_state)
  const [posRows] = await pool.query<RowDataPacket[]>(`
    SELECT symbol, market, entry_price, peak_price, qty,
      ROUND((peak_price - entry_price) / entry_price * 100, 2) AS profit_pct
    FROM position_state
    ORDER BY ROUND((peak_price - entry_price) / entry_price * 100, 2) DESC
  `);

  const holdings: HoldingStatus[] = posRows.map(r => ({
    symbol:     String(r.symbol),
    profitPct:  Number(r.profit_pct ?? 0),
    entryKRW:   Number(r.entry_price ?? 0),
    currentKRW: Number(r.peak_price ?? 0),
    qty:        Number(r.qty ?? 0),
  }));

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
