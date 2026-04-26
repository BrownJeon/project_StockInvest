import type { Candle, Ticker } from '@/lib/exchanges/types';
import type { SignalInput } from '@/lib/signals/router';

export interface AnalystInput {
  symbol: string;
  ticker: Ticker;
  candles: Candle[];
}

export interface AnalystConfig {
  baseAmountKRW: number;
  strategyId?: string;
}

export function simpleMovingAverage(values: number[], period: number): number | null {
  if (values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i];
  return sum / period;
}

export function rsi(closes: number[], period = 14): number | null {
  if (closes.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function simpleRsiMomentum(input: AnalystInput, cfg: AnalystConfig): SignalInput[] {
  const { symbol, ticker, candles } = input;
  if (candles.length < 21) return [];
  const closes = candles.map((c) => c.close);
  const r = rsi(closes, 14);
  const ma20 = simpleMovingAverage(closes, 20);
  if (r == null || ma20 == null) return [];

  const price = ticker.price;
  const signals: SignalInput[] = [];
  const strategyId = cfg.strategyId ?? 'rsi_momentum_v1';

  if (r < 30 && price < ma20) {
    signals.push({
      strategyId,
      symbol,
      side: 'buy',
      orderType: 'limit',
      price,
      amountKRW: cfg.baseAmountKRW,
      reasoning: `RSI14=${r.toFixed(1)} < 30, price=${price} < MA20=${ma20.toFixed(0)} → 과매도 반등 가설`,
      indicators: { rsi14: r, ma20, price },
    });
  }
  if (r > 70 && price > ma20 * 1.03) {
    signals.push({
      strategyId,
      symbol,
      side: 'sell',
      orderType: 'limit',
      price,
      amountKRW: cfg.baseAmountKRW,
      reasoning: `RSI14=${r.toFixed(1)} > 70, price=${price} > MA20*1.03=${(ma20 * 1.03).toFixed(0)} → 과열 청산 가설`,
      indicators: { rsi14: r, ma20, price },
    });
  }
  return signals;
}
