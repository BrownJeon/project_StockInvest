import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import type { ExchangeId, OrderRequest } from '@/lib/exchanges/types';
import type { Market } from '@/lib/exchanges/kis-symbols';
import { getMarketFromSymbol } from '@/lib/exchanges/kis-symbols';
import { kstTodayStart } from '@/lib/time';

export interface LimitCheck {
  ok: boolean;
  reason?: 'order_limit' | 'daily_limit' | 'symbol_not_allowed';
  detail?: string;
}

function inferMarket(req: OrderRequest): Market {
  return req.market ?? getMarketFromSymbol(req.symbol);
}

export function resolveOrderAmountKRW(req: OrderRequest): number {
  if (req.amountKRW != null && req.amountKRW > 0) return req.amountKRW;
  if (req.price && req.quantity) return req.price * req.quantity;
  return 0;
}

/**
 * USD 단위 주문(해외)을 KRW로 환산한 주문금액 반환.
 * KRW 단위 주문은 그대로 반환. amountKRW가 이미 채워졌으면 그대로 사용.
 */
export async function resolveOrderAmountKRWAsync(req: OrderRequest): Promise<number> {
  if (req.amountKRW != null && req.amountKRW > 0) return req.amountKRW;
  if (req.price && req.quantity) {
    const amount = req.price * req.quantity;
    if (req.currency === 'USD' || inferMarket(req) === 'overseas') {
      const { usdToKrw } = await import('@/lib/exchanges/fx');
      return usdToKrw(amount);
    }
    return amount;
  }
  return 0;
}

/**
 * 시장별 블랙리스트 조회 (화이트리스트 폐기 — 2026-04-25).
 * DB `safety_blocked_symbols` (domestic) / `safety_blocked_symbols_overseas` (overseas).
 * 환경변수 폴백: `BLOCKED_SYMBOLS_DOMESTIC` / `BLOCKED_SYMBOLS_OVERSEAS`.
 *
 * 정책: 거래정지/관리종목/SPAC 등 명시적으로 매매 금지된 종목만 블랙리스트로 등록.
 *       universe + 보유 심볼 외 추가 화이트리스트는 적용하지 않음.
 */
async function getBlockedSymbols(market: Market = 'domestic'): Promise<string[]> {
  const blockedKey = market === 'overseas' ? 'safety_blocked_symbols_overseas' : 'safety_blocked_symbols';
  const envKey = market === 'overseas' ? 'BLOCKED_SYMBOLS_OVERSEAS' : 'BLOCKED_SYMBOLS_DOMESTIC';
  try {
    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & { value: string })[]>(
      "SELECT value FROM system_config WHERE `key` = ? LIMIT 1",
      [blockedKey],
    );
    if (rows.length > 0) {
      const parsed = JSON.parse(rows[0].value);
      if (Array.isArray(parsed)) return parsed as string[];
    }
  } catch { /* fall through */ }
  return (process.env[envKey] ?? '').split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * 시장별 블랙리스트 검사. 등록된 심볼만 차단 (allow-by-default).
 */
export async function checkSymbolBlacklist(symbol: string, _exchange?: ExchangeId, market?: Market): Promise<LimitCheck> {
  const m = market ?? getMarketFromSymbol(symbol);
  const blocked = await getBlockedSymbols(m);
  if (blocked.includes(symbol)) return { ok: false, reason: 'symbol_not_allowed', detail: `${symbol} is blacklisted` };
  return { ok: true };
}

/** @deprecated 화이트리스트 정책 폐기 — checkSymbolBlacklist만 사용 */
export const checkSymbolWhitelist = checkSymbolBlacklist;

/**
 * 1회 주문 최대 KRW = **해당 시장(국내/해외)** 평가액 × pct%.
 * 우선순위: DB `safety_order_max_pct` → env `ORDER_MAX_PCT` → 0(=무제한).
 * pct가 0이거나 해당 시장 평가액이 0이면 Infinity 반환.
 *
 * 정책 (2026-04-27): 시장별 분리 한도. 국내 주문은 국내 평가액 기준, 해외 주문은 해외 평가액 기준.
 * 시장 무관 합산 한도는 폐기 — 한쪽 시장 비중이 작아도 다른 쪽 합계로 한도가 부풀려지는 문제 방지.
 */
async function readPctOverride(key: string, _envKey: string): Promise<number> {
  // 정책: 한도는 무조건 설정 메뉴(DB) 값만 기준. .env fallback 제거.
  try {
    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & { value: string })[]>(
      'SELECT value FROM system_config WHERE `key` = ? LIMIT 1', [key],
    );
    if (rows.length > 0) {
      const v = Number(JSON.parse(rows[0].value));
      if (Number.isFinite(v)) return v;
    }
  } catch { /* fall through to safe default */ }
  return 0;  // DB 키 부재 → 0 (= 비활성, getEffectiveOrderMax/DailyMax 가 Infinity 반환)
}

export async function getEffectiveOrderMax(_exchange?: ExchangeId, market: Market = 'domestic'): Promise<number> {
  const pct = await readPctOverride('safety_order_max_pct', 'ORDER_MAX_PCT');
  if (!(pct > 0)) return Infinity;
  const { getPortfolioTotalByMarketKRW } = await import('@/lib/safety/portfolio-total');
  const total = await getPortfolioTotalByMarketKRW(market);
  if (!(total > 0)) return Infinity;
  return total * (pct / 100);
}

/**
 * 일일 누적 최대 KRW = **해당 시장** 평가액 × pct%.
 * 우선순위: DB `safety_daily_order_max_pct` → env `DAILY_ORDER_MAX_PCT` → 0(=무제한).
 */
export async function getEffectiveDailyMax(_exchange?: ExchangeId, market: Market = 'domestic'): Promise<number> {
  const pct = await readPctOverride('safety_daily_order_max_pct', 'DAILY_ORDER_MAX_PCT');
  if (!(pct > 0)) return Infinity;
  const { getPortfolioTotalByMarketKRW } = await import('@/lib/safety/portfolio-total');
  const total = await getPortfolioTotalByMarketKRW(market);
  if (!(total > 0)) return Infinity;
  return total * (pct / 100);
}

/** @deprecated dry-run.ts에서 async 버전으로 교체됨 — 직접 호출 금지 */
export function getEnvOrderMax(_exchange?: ExchangeId): number {
  return Number(process.env.ORDER_MAX_COINONE_KRW ?? process.env.ORDER_MAX_KRW ?? 0);
}

/** @deprecated dry-run.ts에서 async 버전으로 교체됨 — 직접 호출 금지 */
export function getEnvDailyMax(_exchange?: ExchangeId): number {
  return Number(process.env.DAILY_ORDER_MAX_COINONE_KRW ?? process.env.DAILY_ORDER_MAX_KRW ?? 0);
}

/**
 * 1회 주문 한도 체크.
 * @param effectiveMax  단계별 한도와 ENV ORDER_MAX_KRW 중 작은 값을 호출부에서 계산해 전달
 */
export function checkOrderMax(req: OrderRequest, effectiveMax: number): LimitCheck {
  const amount = resolveOrderAmountKRW(req);
  if (amount <= 0) return { ok: false, reason: 'order_limit', detail: 'amount unresolved' };
  if (effectiveMax === Infinity) return { ok: true }; // unlimited
  if (amount > effectiveMax) return { ok: false, reason: 'order_limit', detail: `${amount} > ${effectiveMax}` };
  return { ok: true };
}

/**
 * 일일 누적 주문 한도 체크. 오늘 00:00 KST 이후의 **해당 시장** non-blocked 주문 amount_krw 합산.
 * 이번 주문을 포함했을 때 한도 초과 여부를 반환.
 *
 * 정책 (2026-04-27): 시장별 누적 분리 — orders.market 필터로 국내/해외 별도 카운트.
 */
export async function checkDailyMax(req: OrderRequest, effectiveDailyMax: number): Promise<LimitCheck> {
  if (effectiveDailyMax === Infinity) return { ok: true }; // unlimited
  const amount = await resolveOrderAmountKRWAsync(req);
  if (amount <= 0) return { ok: false, reason: 'daily_limit', detail: 'amount unresolved' };

  try {
    const pool = getPool();
    const start = kstTodayStart();
    const market = inferMarket(req);
    // 일일 한도 = 매수 capital deployment. 매도는 자본 회수 (checkOrderMax 와 일관).
    // cancelled = 자본 환불 → 한도에서 제외 (자동 취소가 한도 점유 못 하도록).
    // pending = submitOrder INSERT 직후 자기 자신 self-double-count 방지.
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(amount_krw), 0) AS sum_krw
       FROM orders
       WHERE created_at >= ?
         AND market = ?
         AND side = 'buy'
         AND status NOT IN ('rejected','failed','blocked','cancelled','pending')`,
      [start, market],
    );
    const already = Number(rows[0]?.sum_krw ?? 0);
    if (already + amount > effectiveDailyMax) {
      return { ok: false, reason: 'daily_limit', detail: `${market} ${already}+${amount} > ${effectiveDailyMax}` };
    }
    return { ok: true };
  } catch (e) {
    console.error('[order-limits] daily aggregate failed:', e);
    return { ok: false, reason: 'daily_limit', detail: 'aggregate query failed' };
  }
}
