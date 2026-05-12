import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';

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

export function formatReportMessage(rep: TradeReport, totalKRW: number, baselineKRW: number | null): string {
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
  lines.push(`• 헤더 P&L (단순 합산): ${fmtKRW(rep.headerPnlKRW)}  ⚠ 미체결 매수 영향 가능`);
  lines.push(`• 실현 P&L (LIFO 페어): ${fmtKRW(rep.lifoPnlKRW)} (수수료 차감)`);
  if (rep.perSymbol.length > 0) {
    lines.push('');
    lines.push(`*매도 발생 종목 손익 (${rep.perSymbol.length}건)*`);
    for (const p of rep.perSymbol.slice(0, 10)) {
      const icon = p.realizedKRW > 0 ? '🔴' : (p.realizedKRW < 0 ? '🔵' : '⚪');
      lines.push(`${icon} ${p.symbol} ${fmtKRW(p.realizedKRW)} (매도 ${p.sellCount}건)`);
    }
    if (rep.perSymbol.length > 10) {
      lines.push(`  …외 ${rep.perSymbol.length - 10}종목`);
    }
  } else {
    lines.push('');
    lines.push('*매도 발생 종목 없음 — 실현 손익 산정 대상 없음*');
  }
  if (rep.churnSymbols.length > 0) {
    lines.push('');
    lines.push('*경고*');
    lines.push(`• 회전매매: ${rep.churnSymbols.join(', ')} (사이클 ≥ ${FEE_THRESHOLD_CYCLES})`);
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
