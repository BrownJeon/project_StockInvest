export type OrderStatus =
  | 'pending' | 'accepted' | 'partially_filled' | 'filled'
  | 'cancelled' | 'rejected' | 'failed' | 'dry_run' | 'blocked';

export interface Order {
  id: number;
  client_order_id: string;
  exchange_order_id: string | null;
  asset_class: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: 'limit' | 'market';
  price: string | null;
  quantity: string | null;
  amount_krw: string | null;
  status: OrderStatus;
  blocked_by: string | null;
  source: 'manual' | 'signal' | 'auto';
  created_at: string;
  updated_at: string;
}

export interface Execution {
  id: number;
  price: string;
  quantity: string;
  fee: string;
  executed_at: string;
}

export interface TradeLog {
  id: number;
  event: string;
  payload: Record<string, unknown> | null;
  occurred_at: string;
}

export interface SignalInfo {
  id: number;
  strategy_id: string | null;
  reasoning: string | null;
  indicators: { ai?: { confidence: number; warnings: string[] } } | null;
  amount_krw: string;
  created_at: string;
}
