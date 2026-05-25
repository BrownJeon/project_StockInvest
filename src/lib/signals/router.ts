import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import type { OrderSide, OrderType } from '@/lib/exchanges/types';

export type SignalStatus =
  | 'pending'
  | 'pending_approval'
  | 'approved'
  | 'approved_pending_entry'
  | 'rejected'
  | 'auto_submitted'
  | 'executing'
  | 'expired'
  | 'superseded';

export interface SignalInput {
  strategyId?: string;
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  price?: number;
  quantity?: number;
  amountKRW: number;
  reasoning?: string;
  indicators?: unknown;
  expiresAt?: Date | string | null;
}

export interface RouterConfig {
  defaultTtlMin: number;
}

export interface RoutingDecision {
  route: 'auto_submit' | 'pending_approval';
  expiresAt: Date;
}

export async function getRouterConfig(): Promise<RouterConfig & { hybridModeEnabled: boolean }> {
  let defaultTtlMin = 30;
  let hybridModeEnabled = false;
  try {
    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & { key: string; value: string })[]>(
      "SELECT `key`, value FROM system_config WHERE `key` IN (?, ?)",
      ['safety_signal_default_ttl_min', 'hybrid_mode_enabled'],
    );
    for (const row of rows) {
      if (row.key === 'safety_signal_default_ttl_min') {
        const ttl = Number(JSON.parse(row.value));
        if (Number.isFinite(ttl) && ttl > 0) defaultTtlMin = ttl;
      }
      if (row.key === 'hybrid_mode_enabled') {
        hybridModeEnabled = JSON.parse(row.value) === true;
      }
    }
  } catch { /* fall through */ }
  if (!hybridModeEnabled) {
    const envTtl = Number(process.env.SIGNAL_DEFAULT_TTL_MIN ?? 30);
    if (defaultTtlMin === 30) defaultTtlMin = Number.isFinite(envTtl) && envTtl > 0 ? envTtl : 30;
    hybridModeEnabled = String(process.env.HYBRID_MODE_ENABLED ?? 'false').toLowerCase() === 'true';
  }
  return { defaultTtlMin, hybridModeEnabled };
}

export async function isAnalystEnabled(): Promise<boolean> {
  try {
    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & { value: string })[]>(
      'SELECT value FROM system_config WHERE `key` = ? LIMIT 1', ['strategy_analyst_enabled'],
    );
    if (rows.length > 0) return JSON.parse(rows[0].value) === true;
  } catch { /* fall through */ }
  return String(process.env.ANALYST_ENABLED ?? 'false').toLowerCase() === 'true';
}

/**
 * hybrid_mode_enabled=true  → pending_approval (analystEnabled 무관, 진입 감시 모델)
 * ANALYST_ENABLED=true      → auto_submit (AI 분석가가 시그널 선별·승인)
 * ANALYST_ENABLED=false     → pending_approval (사람이 직접 검토·승인 필요)
 */
export function routeSignal(
  input: SignalInput,
  cfg: RouterConfig & { hybridModeEnabled?: boolean },
  analystEnabled: boolean,
  now: Date = new Date(),
): RoutingDecision {
  const expiresAt = resolveExpiry(input.expiresAt, cfg.defaultTtlMin, now);
  // 하이브리드 모드: analystEnabled 값에 관계없이 사람 승인 후 진입 감시 경로
  if (cfg.hybridModeEnabled) {
    return { route: 'pending_approval', expiresAt };
  }
  const route = analystEnabled ? 'auto_submit' : 'pending_approval';
  return { route, expiresAt };
}

function resolveExpiry(raw: Date | string | null | undefined, defaultTtlMin: number, now: Date): Date {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw;
  if (typeof raw === 'string' && raw.length > 0) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date(now.getTime() + defaultTtlMin * 60_000);
}
