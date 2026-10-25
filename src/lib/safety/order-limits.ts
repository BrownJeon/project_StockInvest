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

/**
 * 🔴 T-027 — `price * quantity` 가 **NaN 이 될 수 있고, NaN 은 모든 한도 비교를 통과한다.**
 *
 * `price: 'abc'` 처럼 비-number 가 섞이면 곱은 NaN 이다. 그 NaN 이 그대로 반환되면
 * `checkOrderMax` 의 `amount <= 0`(→false) 도 `amount > effectiveMax`(→false) 도 걸리지 않아
 * **1회·일일 한도가 통째로 무력화된다.** 원래의 [[T-027]] 결함(비-number quantity)과 같은
 * 계열이되, 이쪽은 자금 한도를 우회하므로 성격이 더 무겁다. 산출 불가는 0(= 한도 검사에서
 * 즉시 거부)으로 되돌린다 — 애매하면 막는다.
 */
export function resolveOrderAmountKRW(req: OrderRequest): number {
  if (req.amountKRW != null && req.amountKRW > 0) return req.amountKRW;
  if (req.price && req.quantity) {
    const amount = req.price * req.quantity;
    return Number.isFinite(amount) ? amount : 0;
  }
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
    // 🔴 T-027 — sync 판(`resolveOrderAmountKRW`)과 동일 이유. NaN 을 그대로 흘리면
    //    한도 비교가 전부 false 가 되어 fail-open 이다. 환산 이전에 잘라낸다.
    if (!Number.isFinite(amount)) return 0;
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
 * DB `system_config`에서 한도 pct를 읽는다.
 *
 * 정책: 한도는 무조건 설정 메뉴(DB) 값만 기준. .env fallback 없음.
 * **fail-safe (Phase 0, 2026-08-02)**: 키 부재 / 파싱 실패 / DB 조회 실패 모두 0을 반환한다.
 * 0은 "무제한"이 아니라 "미설정 → 매수 전면 거부"를 의미한다.
 */
async function readPctOverride(key: string, _envKey: string): Promise<number> {
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
  return 0;  // DB 키 부재 → 0 (= 미설정, 호출부가 매수를 전면 거부)
}

/** DB에 설정된 1회 주문 한도 pct (미설정·조회 실패 시 0). 진단·표시용. */
export async function getOrderMaxPct(): Promise<number> {
  return readPctOverride('safety_order_max_pct', 'ORDER_MAX_PCT');
}

/** DB에 설정된 일일 누적 한도 pct (미설정·조회 실패 시 0). 진단·표시용. */
export async function getDailyMaxPct(): Promise<number> {
  return readPctOverride('safety_daily_order_max_pct', 'DAILY_ORDER_MAX_PCT');
}

/**
 * 1회 주문 최대 KRW = **해당 시장(국내/해외)** 평가액 × pct%.
 *
 * **fail-safe (Phase 0, 2026-08-02)**: pct 미설정(≤0) 또는 해당 시장 평가액 조회 실패(≤0)
 * 시 **0**을 반환한다. 이전에는 Infinity(=무제한)를 반환해 안전장치가 fail-open이었다.
 * 0은 곧 "신규 매수 전면 거부" — 호출부는 반드시 0을 매수 스킵으로 처리해야 한다.
 * (매도/청산은 1회·일일 한도 적용 대상이 아니므로 영향 없음 — dry-run.ts 참조)
 *
 * 정책 (2026-04-27): 시장별 분리 한도. 국내 주문은 국내 평가액 기준, 해외 주문은 해외 평가액 기준.
 * 시장 무관 합산 한도는 폐기 — 한쪽 시장 비중이 작아도 다른 쪽 합계로 한도가 부풀려지는 문제 방지.
 */
export async function getEffectiveOrderMax(_exchange?: ExchangeId, market: Market = 'domestic'): Promise<number> {
  return effectiveMaxFromPct('safety_order_max_pct', 'ORDER_MAX_PCT', '1회', market);
}

/**
 * 일일 누적 최대 KRW = **해당 시장** 평가액 × pct%.
 *
 * **fail-safe (Phase 0, 2026-08-02)**: getEffectiveOrderMax와 동일 — 미설정·조회 실패 시 0.
 */
export async function getEffectiveDailyMax(_exchange?: ExchangeId, market: Market = 'domestic'): Promise<number> {
  return effectiveMaxFromPct('safety_daily_order_max_pct', 'DAILY_ORDER_MAX_PCT', '일일', market);
}

/**
 * 1회·일일 한도 공통 본체 — **숫자를 돌려주고 절대 던지지 않는다** (T-056 불변식).
 *
 * 🔴 왜 "던지지 않음"이 필수인가: `submitOrder`(`dry-run.ts`)는 이 두 함수를 매수·매도 구분 없이 **먼저** 호출한다(결과는
 *    매도면 쓰지 않는다). 여기서 하나라도 던지면 매도 주문이 바깥 catch 로 떨어져 `failed` 가 된다 = **청산 불가**.
 *    T-056 은 이 아래 계층에 새 실패 원인(CTRP6504R USD 예수금)을 더하므로, 그 불변식을 여기서 직접 보장한다.
 *
 * 평가액 상태가 `unknown`(USD 예수금·환율·KRW 예수금 확인 불가, 잔고 실패에 직전값 없음)이면 사유를 남기고 0 —
 * 그 시장 신규 매수 차단. `unknown` 을 숫자 0 으로 받아 캐시 폴백이 되살리는 경로(Codex C1-2)는 portfolio-total 이 막는다.
 */
async function effectiveMaxFromPct(key: string, envKey: string, label: string, market: Market): Promise<number> {
  try {
    const pct = await readPctOverride(key, envKey);
    if (!(pct > 0)) {
      console.warn(`[order-limits] ${key} 미설정 → ${label} 한도 0 (${market} 신규 매수 차단)`);
      return 0;
    }
    const { getMarketTotal } = await import('@/lib/safety/portfolio-total');
    const t = await getMarketTotal(market);
    if (!t || t.status !== 'ok') {
      const why = t && t.status === 'unknown' ? `${t.reason}: ${t.detail}` : '상태 없음';
      console.warn(`[order-limits] ${market} 포트폴리오 평가액 모름(${why}) → ${label} 한도 0 (신규 매수 차단)`);
      return 0;
    }
    if (!(t.krw > 0)) {
      console.warn(`[order-limits] ${market} 포트폴리오 평가액 0 → ${label} 한도 0 (신규 매수 차단)`);
      return 0;
    }
    const v = t.krw * (pct / 100);
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch (e) {
    console.error(`[order-limits] ${label} 한도 계산 예외 → 0 (신규 매수 차단, 매도 경로는 영향 없음):`,
      e instanceof Error ? e.message : String(e));
    return 0;
  }
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
 * @param effectiveMax  getEffectiveOrderMax() 결과. **0이면 한도 미설정 → 전면 거부** (fail-safe).
 *                      Infinity(무제한) 경로는 Phase 0에서 제거됨.
 */
export function checkOrderMax(req: OrderRequest, effectiveMax: number): LimitCheck {
  const amount = resolveOrderAmountKRW(req);
  // 🔴 T-027 — `amount <= 0` 이 아니라 `!(amount > 0)`. NaN 은 **모든** 관계연산에서 false 라
  //    `<= 0` 도 `> effectiveMax` 도 통과시켜 한도 검사 전체가 무력화된다. 부정형으로 뒤집으면
  //    NaN 이 여기서 멈춘다. 유한한 양수에 대해서는 두 식이 완전히 동치라 회귀가 없다.
  if (!(amount > 0)) return { ok: false, reason: 'order_limit', detail: 'amount unresolved' };
  if (!Number.isFinite(effectiveMax) || effectiveMax <= 0) {
    return { ok: false, reason: 'order_limit', detail: 'order limit not configured (0) — buy blocked' };
  }
  if (amount > effectiveMax) return { ok: false, reason: 'order_limit', detail: `${amount} > ${effectiveMax}` };
  return { ok: true };
}

/**
 * 일일 누적 주문 한도 체크. 오늘 00:00 KST 이후의 **해당 시장** non-blocked 주문 amount_krw 합산.
 * 이번 주문을 포함했을 때 한도 초과 여부를 반환.
 *
 * 정책 (2026-04-27): 시장별 누적 분리 — orders.market 필터로 국내/해외 별도 카운트.
 *
 * 🔴 T-081 WP-B (F10) — `pending` 은 **다른 주문의 것이면 합산한다**(송신 중 = KIS 응답 대기도 예산을 쓴다). 예전에는 자기 행 이중 계산을
 *    피하려고 `pending` 전부를 뺐는데, 그러면 거의 동시에 들어온 두 매수가 서로의 `pending` 을 못 보고 둘 다 통과해 한도를 넘었다
 *    (일회용 MariaDB 재현: 남은 한도 40 에 동시 10건 × 15 → 150 통과). 이제 **자기 행만** 뺀다 — 자기 행을 INSERT 한 뒤 검사하는
 *    `submitOrder` 순서와 합쳐 어떤 끼어들기에서도 통과 합계가 한도를 넘지 않는다(대신 동시 두 건이 서로를 보고 둘 다 거부될 수 있다 — 보수 방향).
 * @param selfOrderId 호출자가 이미 INSERT 한 자기 `pending` 행 id(`submitOrder` 는 항상 넘긴다). 자기 행이 없는 호출(승인 알림의 사전 판정 —
 *    `approval-context.ts`)은 생략 → 오늘 `pending` 전부를 합산한다. 양의 정수가 아니면 아무 행도 빼지 않는다(자기 행이 있다면 이중 계산 →
 *    자기 주문 거부 = fail-closed).
 */
export async function checkDailyMax(req: OrderRequest, effectiveDailyMax: number, selfOrderId?: number): Promise<LimitCheck> {
  // fail-safe (Phase 0): 한도 미설정(0)·비정상값이면 무제한이 아니라 전면 거부.
  if (!Number.isFinite(effectiveDailyMax) || effectiveDailyMax <= 0) {
    return { ok: false, reason: 'daily_limit', detail: 'daily limit not configured (0) — buy blocked' };
  }
  const amount = await resolveOrderAmountKRWAsync(req);
  // 🔴 T-027 — `checkOrderMax` 와 동일 이유로 부정형. NaN 이면 `already + NaN > max` 도
  //    false 라 일일 누적 한도까지 통째로 빠져나간다.
  if (!(amount > 0)) return { ok: false, reason: 'daily_limit', detail: 'amount unresolved' };

  try {
    const pool = getPool();
    const start = kstTodayStart();
    const market = inferMarket(req);
    // 일일 한도 = 매수 capital deployment. 매도는 자본 회수 (checkOrderMax 와 일관).
    // cancelled = 자본 환불 → 한도에서 제외 (자동 취소가 한도 점유 못 하도록).
    // pending = 다른 주문의 송신 중 예약은 합산, **자기 행만** 제외(T-081 WP-B). id 0 은 AUTO_INCREMENT 에 없다 → 아무것도 빼지 않음.
    const selfId = typeof selfOrderId === 'number' && Number.isSafeInteger(selfOrderId) && selfOrderId > 0 ? selfOrderId : 0;
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(amount_krw), 0) AS sum_krw
       FROM orders
       WHERE created_at >= ?
         AND market = ?
         AND side = 'buy'
         AND status NOT IN ('rejected','failed','blocked','cancelled')
         AND NOT (status = 'pending' AND id = ?)`,
      [start, market, selfId],
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
