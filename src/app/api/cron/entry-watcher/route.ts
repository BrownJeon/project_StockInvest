/**
 * entry-watcher cron — 승인 대기 시그널의 진입 구간 도달 여부를 감시해 자동 주문 실행.
 *
 * 흐름:
 *  1. checkCronAuth 인증
 *  2. 장중 여부 확인 (국내 09:00~15:30 KST) — 장외이면 즉시 종료
 *  3. approved_pending_entry 상태 시그널 전체 조회
 *  4. 각 시그널: price_zone 파싱 → KIS 현재가 조회 → 구간 내이면 submitOrder 호출
 *  5. 주문 성공 → status=executing, expiresAt 초과 → status=expired
 */
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { checkCronAuth } from '@/lib/cron-auth';
import { kis } from '@/lib/exchanges/kis';
import { submitOrder } from '@/lib/safety/dry-run';
import { isDomesticOpen, isOverseasOpen } from '@/lib/strategy/market-hours';
import { parsePriceZone } from '@/lib/signals/scenario-builder';
import { getStyleConfig } from '@/lib/strategy/style';
import { setPositionScenarioExit } from '@/lib/strategy/position-state';
import type { ScenarioExitParams } from '@/lib/strategy/position-state';

/** holding_deadline (YYYY-MM-DD) 또는 holding_days 문자열 → Date */
function resolveHoldingDeadline(exitObj: Record<string, unknown>): Date | null {
  const dl = exitObj['holding_deadline'];
  if (typeof dl === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dl)) {
    const d = new Date(`${dl}T23:59:59+09:00`); // KST 당일 마감
    return Number.isFinite(d.getTime()) ? d : null;
  }
  // 구형 호환: holding_days 문자열 파싱
  const hd = String(exitObj['holding_days'] ?? '');
  if (hd === '당일') return new Date(Date.now() + 1 * 86400000);
  if (hd === '1주')  return new Date(Date.now() + 7 * 86400000);
  const m = hd.match(/(\d+)일/g);
  if (m) return new Date(Date.now() + Math.max(...m.map(s => parseInt(s, 10))) * 86400000);
  return null;
}

export const dynamic = 'force-dynamic';

interface PendingEntryRow {
  id: number;
  symbol: string;
  side: 'buy' | 'sell';
  order_type: 'limit' | 'market';
  price: string | null;
  quantity: string | null;
  amount_krw: string;
  indicators: string | null;
  expires_at: Date | null;
  market: string | null;
}

interface WatchResult {
  signalId: number;
  symbol: string;
  outcome: 'submitted' | 'expired' | 'out_of_zone' | 'no_zone' | 'price_fetch_failed' | 'order_failed' | 'blocked_by_prior_split';
  detail?: string;
}

function getEffectiveChasePctSync(stylePct: number): number {
  // cron 컨텍스트에서는 동기 폴백만 사용 — DB 체크는 service.ts의 getEffectiveChasePct와 동일 원칙이나
  // cron은 단순화해서 style 값을 그대로 사용 (safety_limit_chase_disabled는 submitOrder 내부 안전장치가 아님).
  return stylePct;
}

export async function POST(req: NextRequest) {
  const authErr = checkCronAuth(req);
  if (authErr) return authErr;

  // 국내·해외 개장 여부를 병렬 조회 — 둘 다 닫혀있으면 스킵
  const [domOpen, ovsOpen] = await Promise.all([isDomesticOpen(), isOverseasOpen()]);
  if (!domOpen && !ovsOpen) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'market_closed', processed: 0 });
  }

  const pool = getPool();
  const now = new Date();

  // approved_pending_entry 상태 시그널 전체 조회
  const [rows] = await pool.query<(RowDataPacket & PendingEntryRow)[]>(
    `SELECT id, symbol, side, order_type, price, quantity, amount_krw,
            indicators, expires_at, market
     FROM signals
     WHERE status = 'approved_pending_entry'
     ORDER BY created_at ASC`,
  );

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, results: [] });
  }

  const style = await getStyleConfig();
  const chasePct = getEffectiveChasePctSync(style.limitChasePct);

  const results: WatchResult[] = [];

  for (const row of rows) {
    const signalId = row.id;

    // 만료 체크
    if (row.expires_at && new Date(row.expires_at) < now) {
      await pool.query(
        `UPDATE signals SET status='expired', updated_at=NOW() WHERE id=?`,
        [signalId],
      ).catch(e => console.error(`[entry-watcher] expire update failed signal=${signalId}:`, e));
      results.push({ signalId, symbol: row.symbol, outcome: 'expired' });
      continue;
    }

    // 시그널 시장 개장 여부 확인 — 해당 시장이 닫혀 있으면 스킵
    const { getMarketFromSymbol: gmfs } = await import('@/lib/exchanges/kis-symbols');
    const sigMarket = (row.market as 'domestic' | 'overseas') ?? gmfs(row.symbol);
    const sigMarketOpen = sigMarket === 'overseas' ? ovsOpen : domOpen;
    if (!sigMarketOpen) {
      results.push({
        signalId,
        symbol: row.symbol,
        outcome: 'out_of_zone',
        detail: `${sigMarket === 'overseas' ? '해외' : '국내'} 장외 시간`,
      });
      continue;
    }

    // indicators.ai.scenario.entry.price_zone 파싱
    let priceZone: [number, number] | null = null;
    try {
      const ind: unknown = typeof row.indicators === 'string'
        ? JSON.parse(row.indicators)
        : row.indicators;
      if (ind != null && typeof ind === 'object') {
        const ai = (ind as Record<string, unknown>)['ai'];
        if (ai != null && typeof ai === 'object') {
          const scenario = (ai as Record<string, unknown>)['scenario'];
          if (scenario != null && typeof scenario === 'object') {
            const entry = (scenario as Record<string, unknown>)['entry'];
            if (entry != null && typeof entry === 'object') {
              const pzRaw = (entry as Record<string, unknown>)['price_zone'];
              if (typeof pzRaw === 'string') {
                priceZone = parsePriceZone(pzRaw);
              }
            }
          }
        }
      }
    } catch {
      // indicators 파싱 실패 — no_zone으로 처리
    }

    if (priceZone === null) {
      results.push({ signalId, symbol: row.symbol, outcome: 'no_zone', detail: 'price_zone 없음' });
      continue;
    }

    // KIS 현재가 조회
    let currentPrice: number;
    try {
      const ticker = await kis.getTicker(row.symbol);
      currentPrice = ticker.price;
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      console.warn(`[entry-watcher] getTicker failed signal=${signalId} symbol=${row.symbol}:`, detail);
      results.push({ signalId, symbol: row.symbol, outcome: 'price_fetch_failed', detail });
      continue;
    }

    const [zoneLo, zoneHi] = priceZone;
    if (currentPrice < zoneLo || currentPrice > zoneHi) {
      results.push({
        signalId,
        symbol: row.symbol,
        outcome: 'out_of_zone',
        detail: `현재가=${currentPrice} zone=${zoneLo}~${zoneHi}`,
      });
      continue;
    }

    // 순차 트리거 게이트: 같은 group의 이전 회차 중 pending이 있으면 skip
    let splitIndex: number | undefined;
    let splitTotal: number | undefined;
    let splitGroupId: string | undefined;
    try {
      const ind = typeof row.indicators === 'string' ? JSON.parse(row.indicators) : row.indicators;
      if (ind?.split) {
        splitIndex = ind.split.index;
        splitTotal = ind.split.total;
        splitGroupId = ind.split.group_id;
      }
    } catch { /* indicators 파싱 실패 무시 */ }

    if (splitGroupId && splitIndex !== undefined && splitIndex > 1) {
      const [priorRows] = await pool.query<RowDataPacket[]>(
        `SELECT id, status FROM signals
         WHERE JSON_EXTRACT(indicators, '$.split.group_id') = ?
           AND JSON_EXTRACT(indicators, '$.split.index') < ?
           AND status = 'approved_pending_entry'`,
        [splitGroupId, splitIndex],
      );
      if (priorRows.length > 0) {
        results.push({ signalId, symbol: row.symbol, outcome: 'blocked_by_prior_split', detail: `waiting for index<${splitIndex}` });
        continue;
      }
    }
    // splitTotal은 현재 사용되지 않으나 향후 확장을 위해 파싱해 둠
    void splitTotal;

    // 진입 구간 도달 — 주문 실행 (submitOrder 내부에서 DRY_RUN·KILL_SWITCH 동작)
    const basePrice = row.price != null ? Number(row.price) : currentPrice;
    let chasedPrice: number | undefined = basePrice;
    if (chasePct > 0 && row.order_type === 'limit' && basePrice > 0) {
      const factor = row.side === 'buy' ? 1 + chasePct : 1 - chasePct;
      chasedPrice = basePrice * factor;
    }

    let quantity: number | undefined = row.quantity != null ? Number(row.quantity) : undefined;
    if (row.order_type === 'limit' && quantity == null && chasedPrice != null && chasedPrice > 0) {
      quantity = Math.floor((Number(row.amount_krw) / chasedPrice) * 1e8) / 1e8;
    }

    const market = sigMarket;

    const orderReq = {
      exchange: 'kis' as const,
      symbol: row.symbol,
      side: row.side,
      type: row.order_type,
      price: chasedPrice,
      quantity,
      amountKRW: Number(row.amount_krw),
      market,
      currency: market === 'overseas' ? 'USD' as const : 'KRW' as const,
    };

    try {
      const orderResult = await submitOrder(orderReq, kis.createOrder, {
        assetClass: 'stock',
        source: 'auto',
      });

      if (orderResult.ok || orderResult.dryRun) {
        await pool.query(
          `UPDATE signals SET status='executing', consumed_order_id=?, updated_at=NOW() WHERE id=?`,
          [orderResult.orderId ?? null, signalId],
        );

        // 사용자 시나리오 진입: position_state에 scenario_exit·holding_deadline 기록
        if (row.indicators) {
          try {
            const ind = (typeof row.indicators === 'string'
              ? JSON.parse(row.indicators) : row.indicators) as Record<string, unknown>;
            const aiBlock = ind?.['ai'] as Record<string, unknown> | undefined;
            const scenarioBlock = aiBlock?.['scenario'] as Record<string, unknown> | undefined;
            const exitObj = scenarioBlock?.['exit'] as Record<string, unknown> | undefined;
            if (exitObj) {
              const targetLo = Number(exitObj['target_pct']    ?? exitObj['target_pct_lo']  ?? 0);
              const targetHi = Number(exitObj['target_pct_hi'] ?? targetLo);
              const stopLo   = Math.abs(Number(exitObj['stop_pct']    ?? exitObj['stop_pct_lo']  ?? 0));
              const stopHi   = Math.abs(Number(exitObj['stop_pct_hi'] ?? stopLo));
              if (targetLo > 0 && stopLo > 0) {
                const sc: ScenarioExitParams = { targetLo, targetHi, stopLo, stopHi };
                const holdingDeadline = resolveHoldingDeadline(exitObj);
                await setPositionScenarioExit(row.symbol, sigMarket, sc, holdingDeadline).catch(e =>
                  console.warn(`[entry-watcher] setPositionScenarioExit failed ${row.symbol}:`, e),
                );
              }
            }
          } catch { /* indicators 파싱 실패 무시 */ }
        }

        results.push({
          signalId,
          symbol: row.symbol,
          outcome: 'submitted',
          detail: `orderId=${orderResult.orderId ?? 'dry_run'} price=${currentPrice}`,
        });
      } else {
        results.push({
          signalId,
          symbol: row.symbol,
          outcome: 'order_failed',
          detail: orderResult.error ?? orderResult.blockedBy ?? 'unknown',
        });
      }
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      console.error(`[entry-watcher] submitOrder failed signal=${signalId}:`, detail);
      results.push({ signalId, symbol: row.symbol, outcome: 'order_failed', detail });
    }
  }

  const submitted = results.filter(r => r.outcome === 'submitted').length;
  const expired   = results.filter(r => r.outcome === 'expired').length;
  const blocked   = results.filter(r => r.outcome === 'blocked_by_prior_split').length;
  console.log(
    `[cron/entry-watcher] total=${rows.length} submitted=${submitted} expired=${expired} ` +
    `out_of_zone=${results.filter(r => r.outcome === 'out_of_zone').length} blocked_prior=${blocked}`,
  );

  return NextResponse.json({ ok: true, processed: rows.length, results });
}
