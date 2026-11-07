/**
 * 승인 요청에 붙일 **계좌 맥락**과 "이 매수가 지금 실행될 수 있는가" 판정 (T-042 / D2).
 *
 * ## 왜 필요한가
 * 이스케이프 결함을 고치면 도착하는 승인 요청이 하루 약 8건 → 약 36건으로 늘고, 버튼이 붙으면 오탭 위험도 커진다.
 * 그런데 지금 계좌는 현금이 8만 원이고 매수 1건이 약 112만 원이라 **받아도 주문이 거부될 요청**이 대부분이다.
 * 그런 요청에는 **알림을 보내지 않는다** — 서버 로그 1줄만 남긴다(T-044 가 T-042 D2-b 의 시간당 요약을 제거했다. 판정 결과를 쓰는 곳은
 * `approval-notify.ts`). 이 판정은 스냅샷 현금·일일 한도·1회 한도를 본다. 실시간 현금 부족 매수는 그보다 앞서 시그널 생성 단계에서
 * 이미 걸러진다(T-058 `signal-cash-gate.ts`) — 여기까지 오는 매수는 현금을 몰랐거나(unknown) 충분했던 것이다.
 *
 * ## 실패 방향 — 의심스러우면 *보낸다*
 * 이 판정은 알림을 **줄이는** 쪽이다. 잘못 줄이면 사용자가 실행 가능한 시그널을 못 본다. 그래서 조회가 실패하거나
 * 값이 불확실하면 항상 "실행 가능"으로 본다(알림을 보낸다). 한도 판정은 주문 경로가 실제로 쓰는 `checkOrderMax`·
 * `checkDailyMax` 를 **그대로** 부른다 — 별도로 흉내 내면 기준이 어긋난다. 현금만 스냅샷으로 근사한다.
 */
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import type { OrderRequest } from '@/lib/exchanges/types';
import { getMarketFromSymbol, type Market } from '@/lib/exchanges/kis-symbols';
import { checkDailyMax, checkOrderMax, getEffectiveDailyMax, getEffectiveOrderMax } from '@/lib/safety/order-limits';

export type NonExecutableReason = 'cash' | 'daily_limit' | 'order_limit';

export interface ApprovalContext {
  /** 모르면 null — 메시지는 모르는 값을 적지 않는다 */
  totalKRW: number | null;
  cashKRW: number | null;
  dailyRemainingKRW: number | null;
}

export interface ExecutabilityAssessment {
  executable: boolean;
  reasons: NonExecutableReason[];
  ctx: ApprovalContext;
}

/** 현금이 시그널 금액의 이 비율에 못 미치면 "현금 부족"으로 본다. 1.0 이 아닌 이유: 정수 주식 수로 내림하고, 환율·호가 추격으로 실제 소요가 달라진다. */
export const CASH_SHORTFALL_RATIO = 0.5;
/** 스냅샷이 이보다 오래되면 현금을 믿지 않는다 (킬스위치의 현재값 신뢰 한계와 같은 3시간) */
const SNAPSHOT_MAX_AGE_MS = 3 * 60 * 60 * 1000;
const CACHE_TTL_MS = 60_000;

/**
 * 시장별 현금(KRW 환산). **그 시장의 현금 행이 스냅샷에 없으면 null(모름)** — 0 으로 세지 않는다.
 *
 * T-056: 예전에는 KRW+USD 행을 합쳐 "현금"으로 봤다. USD 행은 늘 없어서 드러나지 않았지만, USD 예수금이 기록되기 시작하면
 * **국내 매수의 실행 가능 판정에 달러를 현금으로 세는** 오분류가 된다(달러로 국내 주식은 못 산다). 그래서 시장별로 나눈다:
 * 국내 매수 = KRW 행, 해외 매수 = USD 행. 배포 전 구형 스냅샷에는 USD 행이 없으므로 해외 현금은 "모름" → 사유로 세지 않는다
 * (이 판정의 실패 방향 = 의심스러우면 보낸다).
 */
interface SnapshotCash { totalKRW: number; cashByMarket: Record<Market, number | null> }

let snapCache: { at: number; value: SnapshotCash | null } | null = null;

/** 테스트용 */
export function resetApprovalContextCache(): void { snapCache = null; }

interface SnapPosition { currency?: unknown; value_krw?: unknown }

const CASH_ROW: Record<Market, 'KRW' | 'USD'> = { domestic: 'KRW', overseas: 'USD' };

/** 최신 스냅샷에서 총자산·시장별 현금. 오래됐거나 읽을 수 없으면 null. */
async function readSnapshot(now: number): Promise<SnapshotCash | null> {
  if (snapCache && now - snapCache.at < CACHE_TTL_MS) return snapCache.value;
  let value: SnapshotCash | null = null;
  try {
    const [rows] = await getPool().query<RowDataPacket[]>(
      'SELECT total_krw, positions, ts FROM portfolio_snapshots ORDER BY ts DESC LIMIT 1',
    );
    const r = rows[0];
    if (r) {
      const age = now - new Date(r.ts as string | Date).getTime();
      const total = Number(r.total_krw);
      const positions: unknown = typeof r.positions === 'string' ? JSON.parse(r.positions) : r.positions;
      if (Number.isFinite(age) && age >= 0 && age <= SNAPSHOT_MAX_AGE_MS && total > 0 && Array.isArray(positions)) {
        const cashByMarket: Record<Market, number | null> = { domestic: null, overseas: null };
        for (const m of ['domestic', 'overseas'] as const) {
          let found = false;
          let cash = 0;
          for (const p of positions as SnapPosition[]) {
            if (p && p.currency === CASH_ROW[m]) { found = true; cash += Number(p.value_krw) || 0; }
          }
          cashByMarket[m] = found ? cash : null;
        }
        value = { totalKRW: total, cashByMarket };
      }
    }
  } catch { /* 모르면 null — 아래에서 "실행 가능"으로 본다 */ }
  snapCache = { at: now, value };
  return value;
}

/** 화면 표시용 오늘 사용액(주문 경로의 `checkDailyMax` 와 같은 조건). 판정에는 쓰지 않는다 — 판정은 `checkDailyMax` 본체가 한다. */
async function dailyUsedKRW(market: Market): Promise<number | null> {
  try {
    const start = new Date();
    // KST 오늘 00:00 — order-limits 의 kstTodayStart 와 같은 의도 (표시 전용이라 근사로 충분)
    const kst = new Date(start.getTime() + 9 * 3600_000);
    kst.setUTCHours(0, 0, 0, 0);
    const startUtc = new Date(kst.getTime() - 9 * 3600_000);
    const [rows] = await getPool().query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(amount_krw), 0) AS sum_krw FROM orders
       WHERE created_at >= ? AND market = ? AND side = 'buy'
         AND status NOT IN ('rejected','failed','blocked','cancelled','pending')`,
      [startUtc, market],
    );
    const n = Number(rows[0]?.sum_krw ?? 0);
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}

/**
 * 한도 검사가 **진짜로 한도를 넘었다**고 말하는가.
 *
 * `checkOrderMax`/`checkDailyMax` 의 `ok:false` 는 주문 경로에서는 fail-closed 로 옳지만(집계 쿼리 실패·금액 미확정도 차단),
 * 알림을 *줄이는* 이 판정에서는 "넘었다"와 "확인하지 못했다"를 구분해야 한다 — 후자를 사유로 세면 DB 가 한 번 흔들릴 때
 * 실행 가능한 시그널의 개별 알림이 요약으로 사라진다(T-042 감사 D-3).
 * 진짜 초과의 상세는 항상 `<금액> > <한도>` 꼴이다(`1000000 > 900000`, `domestic 1500000+1000000 > 2300000`).
 * 형식이 바뀌면 `approval-context.test.ts` 의 실제 함수 대조 테스트가 깨진다.
 */
export function exceedsLimit(r: { ok: boolean; detail?: string }): boolean {
  return !r.ok && /\d\s*>\s*\d/.test(r.detail ?? '');
}

export async function assessExecutability(args: {
  symbol: string;
  side: 'buy' | 'sell';
  amountKRW: number;
  price?: number;
  now?: number;
}): Promise<ExecutabilityAssessment> {
  const now = args.now ?? Date.now();
  const ctx: ApprovalContext = { totalKRW: null, cashKRW: null, dailyRemainingKRW: null };

  // 매도는 포지션 청산이라 1회·일일 한도와 현금의 제약을 받지 않는다(주문 경로와 동일 원칙) — 항상 실행 가능.
  if (args.side !== 'buy') return { executable: true, reasons: [], ctx };

  const reasons: NonExecutableReason[] = [];
  const market = getMarketFromSymbol(args.symbol) as Market;
  const req: OrderRequest = { exchange: 'kis', symbol: args.symbol, side: 'buy', type: 'limit', price: args.price, amountKRW: args.amountKRW, market };

  // 한도: 주문 경로가 쓰는 검사를 그대로 호출한다.
  //
  // 🔴 한도가 0 이하면 **모른다**로 본다 (T-042 감사 D-3). `getEffectiveOrderMax/DailyMax` 는 "정책 비율 미설정"과
  //    "KIS 잔고(평가액) 조회 실패"를 둘 다 *예외 없이 0* 으로 돌려주고, 0 은 곧 "신규 매수 전면 거부"로 읽힌다.
  //    일시적인 조회 실패를 "실행 불가"로 오판하면 이 알림이 요약으로만 가 사용자가 실행 가능한 시그널을 놓친다.
  //    (그 순간 주문 경로도 막히므로 자금 위험은 없다 — 위험은 알림 누락이다.) 양의 한도가 있고 금액이 그걸 넘을 때만 사유로 센다.
  try {
    const [orderMax, dailyMax] = await Promise.all([getEffectiveOrderMax('kis', market), getEffectiveDailyMax('kis', market)]);
    const orderMaxKnown = typeof orderMax === 'number' && Number.isFinite(orderMax) && orderMax > 0;
    const dailyMaxKnown = typeof dailyMax === 'number' && Number.isFinite(dailyMax) && dailyMax > 0;
    if (orderMaxKnown && exceedsLimit(checkOrderMax(req, orderMax))) reasons.push('order_limit');
    if (dailyMaxKnown && exceedsLimit(await checkDailyMax(req, dailyMax))) reasons.push('daily_limit');
    if (dailyMaxKnown) {
      const used = await dailyUsedKRW(market);
      if (used != null) ctx.dailyRemainingKRW = Math.max(0, dailyMax - used);
    }
  } catch { /* 한도를 못 읽으면 판정하지 않는다 */ }

  const snap = await readSnapshot(now);
  if (snap) {
    ctx.totalKRW = snap.totalKRW;
    // 이 매수의 시장 현금만 본다(T-056). 그 시장 현금 행이 없으면 모름 → 사유로 세지 않는다.
    const cash = snap.cashByMarket[market];
    ctx.cashKRW = cash;
    if (cash != null && cash < args.amountKRW * CASH_SHORTFALL_RATIO) reasons.push('cash');
  }
  return { executable: reasons.length === 0, reasons, ctx };
}
