import type { Candle } from '@/lib/exchanges/types';
import type { RuleFunction } from './rules/types';
import { STYLE_PRESETS } from './style';

export interface BacktestConfig {
  feePct: number;    // e.g. 0.05 → 0.05%
  slipPct: number;   // e.g. 0.10 → 0.10%
  initialKRW: number;
  strategyId: string;
  symbol: string;
}

export interface BacktestTrade {
  entryTs: number;
  exitTs: number;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnlKRW: number;
  pnlPct: number;
  won: boolean;
}

export interface EquityPoint {
  ts: number;
  value: number;
}

export interface BacktestMetrics {
  totalReturnPct: number;
  sharpe: number;
  mdd: number;
  winRate: number;
  profitFactor: number;
  tradeCount: number;
  period: string;
}

export interface BacktestResult {
  trades: BacktestTrade[];
  equityCurve: EquityPoint[];
  metrics: BacktestMetrics;
}

function computeMetrics(
  trades: BacktestTrade[],
  equityCurve: EquityPoint[],
  initialKRW: number,
  periodDays: number,
): BacktestMetrics {
  const tradeCount = trades.length;
  const finalValue = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].value : initialKRW;
  const totalReturnPct = ((finalValue - initialKRW) / initialKRW) * 100;

  const wins = trades.filter(t => t.won).length;
  const winRate = tradeCount > 0 ? (wins / tradeCount) * 100 : 0;

  const grossProfit = trades.filter(t => t.pnlKRW > 0).reduce((s, t) => s + t.pnlKRW, 0);
  const grossLoss   = trades.filter(t => t.pnlKRW < 0).reduce((s, t) => s + Math.abs(t.pnlKRW), 0);
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  // MDD from equity curve
  let peak = initialKRW;
  let mdd = 0;
  for (const pt of equityCurve) {
    if (pt.value > peak) peak = pt.value;
    const drawdown = (peak - pt.value) / peak;
    if (drawdown > mdd) mdd = drawdown;
  }

  // Sharpe: daily returns from equity curve → annualized
  let sharpe = 0;
  if (equityCurve.length >= 2) {
    const dailyReturns: number[] = [];
    for (let i = 1; i < equityCurve.length; i++) {
      dailyReturns.push((equityCurve[i].value - equityCurve[i - 1].value) / equityCurve[i - 1].value);
    }
    const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
    const variance = dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / dailyReturns.length;
    const std = Math.sqrt(variance);
    sharpe = std > 0 ? (mean / std) * Math.sqrt(365) : 0;
  }

  return {
    totalReturnPct: Number(totalReturnPct.toFixed(2)),
    sharpe: Number(sharpe.toFixed(2)),
    mdd: Number((-mdd * 100).toFixed(2)),
    winRate: Number(winRate.toFixed(1)),
    profitFactor: Number(Math.min(profitFactor, 99.99).toFixed(2)),
    tradeCount,
    period: `${periodDays}일`,
  };
}

/**
 * Walk-forward backtest engine.
 * - Signal at bar i → execute at bar i+1 open price (no look-ahead bias)
 * - Only one position at a time (buy → hold until sell signal)
 * - Fee and slippage applied to both entry and exit
 */
export function runBacktest(
  candles: Candle[],
  ruleFn: RuleFunction,
  cfg: BacktestConfig,
): BacktestResult {
  const { feePct, slipPct, initialKRW, strategyId, symbol } = cfg;
  const feeRatio  = feePct  / 100;
  const slipRatio = slipPct / 100;

  const trades: BacktestTrade[] = [];
  const equityCurve: EquityPoint[] = [{ ts: candles[0]?.ts ?? 0, value: initialKRW }];

  let cash = initialKRW;
  let position: { price: number; quantity: number; entryTs: number } | null = null;

  for (let i = 1; i < candles.length - 1; i++) {
    const slice = candles.slice(0, i + 1);
    // Provide a minimal Ticker from current candle
    const ticker = {
      symbol,
      price: candles[i].close,
      timestamp: candles[i].ts,
    };

    const signals = ruleFn({ strategyId, symbol, candles: slice, ticker, amountKRW: cash, style: STYLE_PRESETS.neutral });
    const nextOpen = candles[i + 1].open;

    for (const sig of signals) {
      if (sig.side === 'buy' && !position) {
        const execPrice = nextOpen * (1 + slipRatio) * (1 + feeRatio);
        const qty = cash / execPrice;
        position = { price: execPrice, quantity: qty, entryTs: candles[i + 1].ts };
        cash = 0;
      } else if (sig.side === 'sell' && position) {
        const execPrice = nextOpen * (1 - slipRatio) * (1 - feeRatio);
        const proceeds = execPrice * position.quantity;
        const pnlKRW = proceeds - position.price * position.quantity;
        const pnlPct = (proceeds / (position.price * position.quantity) - 1) * 100;
        trades.push({
          entryTs: position.entryTs,
          exitTs: candles[i + 1].ts,
          entryPrice: position.price,
          exitPrice: execPrice,
          quantity: position.quantity,
          pnlKRW: Number(pnlKRW.toFixed(0)),
          pnlPct: Number(pnlPct.toFixed(2)),
          won: pnlKRW > 0,
        });
        cash = proceeds;
        position = null;
        equityCurve.push({ ts: candles[i + 1].ts, value: Number(cash.toFixed(0)) });
      }
    }
  }

  // Force-close open position at last bar
  if (position && candles.length > 0) {
    const lastCandle = candles[candles.length - 1];
    const execPrice = lastCandle.close * (1 - slipRatio) * (1 - feeRatio);
    const proceeds = execPrice * position.quantity;
    const pnlKRW = proceeds - position.price * position.quantity;
    const pnlPct = (proceeds / (position.price * position.quantity) - 1) * 100;
    trades.push({
      entryTs: position.entryTs,
      exitTs: lastCandle.ts,
      entryPrice: position.price,
      exitPrice: execPrice,
      quantity: position.quantity,
      pnlKRW: Number(pnlKRW.toFixed(0)),
      pnlPct: Number(pnlPct.toFixed(2)),
      won: pnlKRW > 0,
    });
    cash = proceeds;
    equityCurve.push({ ts: lastCandle.ts, value: Number(cash.toFixed(0)) });
  }

  const periodDays = candles.length > 1
    ? Math.round((candles[candles.length - 1].ts - candles[0].ts) / 86400000)
    : 0;

  return {
    trades,
    equityCurve,
    metrics: computeMetrics(trades, equityCurve, initialKRW, periodDays),
  };
}
