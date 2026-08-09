import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { kis, BalancesIncompleteError } from '@/lib/exchanges/kis';
import type { Ticker } from '@/lib/exchanges/types';
import { kstTodayStart } from '@/lib/time';
import { usdToKrw } from '@/lib/exchanges/fx';
import { savePortfolioSnapshot } from '@/lib/safety/volatility-guard';

export const dynamic = 'force-dynamic';

/**
 * 단가의 출처. **"조회 실패"를 "0원"으로 표시하지 않기 위해** 존재한다 (T-012).
 *  - `market`   : 실시간 시세 조회 성공
 *  - `avg_cost` : 시세 조회 실패 → 매입평단가(KIS `pchs_avg_pric`)로 대체 평가. 추정치다.
 *  - `unknown`  : 시세도 평단가도 없음 → 이 종목은 평가할 수 없다.
 */
export type PriceSource = 'market' | 'avg_cost' | 'unknown';

interface HoldingView {
  currency: string;
  symbol: string | null;
  qty: number;
  price: number;
  value_krw: number;
  open24h_krw: number;
  change_24h_pct: number | null;
  is_cash: boolean;
  /** UI 가 "실시간 아님"을 표시할 수 있도록 노출한다. */
  price_source: PriceSource;
}

async function saveSnapshot(totalKRW: number, holdings: HoldingView[]): Promise<void> {
  try {
    // sanity guard 가 있는 통합 저장 함수 사용 — outlier(USD raw 환율 미적용 등) 자동 차단
    const positions = holdings.map((h) => ({
      currency: h.currency, qty: h.qty, price: h.price, value_krw: h.value_krw,
    }));
    await savePortfolioSnapshot(totalKRW, positions, 'dashboard');
  } catch (e) {
    console.error('[portfolio] snapshot save failed:', e);
  }
}

async function fetchTodayOpenKRW(): Promise<number | null> {
  try {
    const pool = getPool();
    const start = kstTodayStart();
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT total_krw FROM portfolio_snapshots WHERE ts <= ? ORDER BY ts DESC LIMIT 1',
      [start],
    );
    const row = rows[0];
    if (!row) return null;
    return Number(row.total_krw);
  } catch (e) {
    console.error('[portfolio] today open fetch failed:', e);
    return null;
  }
}

export async function GET() {
  try {
    const balances = await kis.getBalances();
    const DUST_THRESHOLD_KRW = 10_000;

    // 보유 종목 (현금 KRW/USD 제외) — symbol == currency (국내 6자리 또는 해외 EXCD:TICKER)
    const stockHoldings = balances.filter((b) => b.currency !== 'KRW' && b.currency !== 'USD' && (b.free + b.locked) > 0);
    const tickerResults = await Promise.allSettled(
      stockHoldings.map((b) => kis.getTicker(b.currency)),
    );
    const tickerMap = new Map<string, Ticker>();
    tickerResults.forEach((r, i) => {
      if (r.status === 'fulfilled') tickerMap.set(stockHoldings[i].currency, r.value);
    });

    // FX 1회 조회 (USD 환산용)
    let usdKrwRate = 0;
    try { usdKrwRate = await usdToKrw(1); } catch { /* fx 실패 시 USD 잔고 0 처리 */ }

    const holdings: HoldingView[] = await Promise.all(balances.map(async (b): Promise<HoldingView> => {
      const qty = b.free + b.locked;
      if (b.currency === 'KRW') {
        // 자산평가는 D+2 확정 예수금(free)만. 결제 대기(locked)는 미포함.
        const value = b.free;
        return {
          currency: 'KRW', symbol: null, qty: b.free,
          price: 1, value_krw: value, open24h_krw: value,
          change_24h_pct: 0, is_cash: true, price_source: 'market',
        };
      }
      if (b.currency === 'USD') {
        const value_krw = usdKrwRate > 0 ? qty * usdKrwRate : 0;
        return {
          currency: 'USD', symbol: null, qty,
          price: usdKrwRate, value_krw, open24h_krw: value_krw,
          change_24h_pct: 0, is_cash: true,
          price_source: usdKrwRate > 0 ? 'market' : 'unknown',
        };
      }
      /**
       * T-012 — 여기가 오염 스냅샷 12행을 전부 만들어낸 자리다.
       *
       * 기존 `const price = t?.price ?? 0` 은 **시세 조회 실패를 0원으로 기록**했다.
       * 그 결과 (a) 그 종목이 총액에서 통째로 빠져 화면에 -74% 짜리 가짜 총액이 뜨고,
       * (b) 같은 값이 `portfolio_snapshots` 에 저장돼 킬스위치 기준선을 오염시켰다.
       *
       * cron 경로는 몇 달째 **매입평단가 폴백**으로 같은 실패를 처리해 왔다(로그 43건).
       * 평단가는 같은 잔고 응답에 들어 있는 *실제로 아는 값*이라 0 보다 훨씬 나은 추정이고,
       * 실측상 항상 존재한다(`avgPrice 없음` 로그 0건). 두 경로의 동작을 일치시킨다.
       *
       * 다만 평단가를 *현재가인 척* 표시하면 그것 역시 "실패한 조회를 사실로 표시"하는
       * 것이므로 `price_source='avg_cost'` 로 구분해 내보내고, 24h 변동률은 **null**
       * (계산 불가)로 둔다 — 평단가 대비 변동률은 아무 의미가 없다.
       */
      const t = tickerMap.get(b.currency);
      if (t && Number.isFinite(t.price) && t.price > 0) {
        const price = t.price;
        const open = t.open24h ?? price;
        // kis-overseas.getTicker가 USD→KRW 환산 후 반환 (2026-04-28) — 추가 fxMul 불필요
        const value_krw = qty * price;
        return {
          currency: b.currency, symbol: b.currency, qty,
          price, value_krw, open24h_krw: qty * open,
          change_24h_pct: open > 0 ? ((price - open) / open) * 100 : null,
          is_cash: false, price_source: 'market',
        };
      }
      const avg = Number(b.avgPrice ?? 0);
      if (Number.isFinite(avg) && avg > 0) {
        console.warn(`[api/portfolio] ticker 실패 ${b.currency} — avgPrice 폴백 ${avg.toFixed(0)}KRW`);
        const value_krw = qty * avg;
        return {
          currency: b.currency, symbol: b.currency, qty,
          price: avg, value_krw, open24h_krw: value_krw,
          change_24h_pct: null, is_cash: false, price_source: 'avg_cost',
        };
      }
      console.error(`[api/portfolio] ticker·avgPrice 모두 없음 ${b.currency} — 평가 불가`);
      return {
        currency: b.currency, symbol: b.currency, qty,
        price: 0, value_krw: 0, open24h_krw: 0,
        change_24h_pct: null, is_cash: false, price_source: 'unknown',
      };
    }));

    /**
     * 평가할 수 없는 보유가 하나라도 있으면 **총액을 사실로 내보내지 않는다.**
     * 그 종목을 0원으로 둔 총액은 조용히 과소 계상된 값이고, 화면에 뜨는 순간
     * 사용자는 그것을 진짜 자산으로 읽는다. 숫자 대신 실패를 보여주는 쪽이 옳다.
     * (실측상 도달한 적 없는 경로 — `avgPrice` 는 항상 존재했다.)
     */
    const unpriced = holdings.filter((h) => h.price_source === 'unknown' && h.qty > 0);
    if (unpriced.length > 0) {
      return Response.json({
        ok: false,
        error: `시세·평단가를 모두 확인할 수 없는 보유 종목이 있어 평가액을 계산할 수 없습니다: ${
          unpriced.map((h) => h.currency).join(', ')}`,
      }, { status: 503 });
    }

    const total_krw = holdings.reduce((s, h) => s + h.value_krw, 0);
    const visibleHoldings = holdings.filter((h) => h.is_cash || h.value_krw >= DUST_THRESHOLD_KRW);
    const total_open24h_krw = holdings.reduce((s, h) => s + h.open24h_krw, 0);
    const change_24h_krw = total_krw - total_open24h_krw;
    const change_24h_pct = total_open24h_krw > 0 ? (change_24h_krw / total_open24h_krw) * 100 : 0;
    const cash_krw = holdings.filter((h) => h.is_cash).reduce((s, h) => s + h.value_krw, 0);
    const cash_pct = total_krw > 0 ? (cash_krw / total_krw) * 100 : 0;

    // 오늘 00:00 KST 기준 시작값 조회 + 현재 값 스냅샷 저장 (병렬)
    const [today_open_krw] = await Promise.all([
      fetchTodayOpenKRW(),
      saveSnapshot(total_krw, holdings),
    ]);
    const today_change_krw = today_open_krw != null ? total_krw - today_open_krw : null;
    const today_change_pct =
      today_open_krw != null && today_open_krw > 0
        ? ((total_krw - today_open_krw) / today_open_krw) * 100
        : null;

    return Response.json({
      ok: true,
      data: {
        total_krw,
        cash_krw,
        cash_pct,
        change_24h_krw,
        change_24h_pct,
        today_open_krw,
        today_change_krw,
        today_change_pct,
        holdings: visibleHoldings,
        updated_at: new Date().toISOString(),
      },
    });
  } catch (e) {
    // T-012: 잔고 부분 실패는 "낮은 총액"이 아니라 **실패**로 보여준다.
    // 대시보드(Dashboard.tsx:215)는 ok:false 를 오류 상태로 렌더하므로, 사용자는 가짜
    // 숫자 대신 오류를 본다. 폴링 주기가 30초라 대개 다음 회차에 자동 복구된다.
    if (e instanceof BalancesIncompleteError) {
      console.error('[api/portfolio] 잔고 부분 실패 — 평가액 미표시:', e.message);
      return Response.json({
        ok: false,
        error: `증권사 잔고 일부(${e.failed.map(f => f.market).join(', ')})를 조회하지 못해 `
             + '평가액을 표시할 수 없습니다. 잠시 후 자동으로 다시 시도합니다.',
      }, { status: 503 });
    }
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/portfolio]', error);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
